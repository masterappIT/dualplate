import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶自行辦理後更新資料（docs/tasks/self-handled-changes-design.md）：換車、續期、換司機、不再續期，
// 立即生效、管理者整件核對
const state = {}
const photo = `data:image/png;base64,${Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64')}`
const hkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const shift = days => new Date(Date.parse(hkToday() + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'self-handled-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('other')
  for (const [key, name, tenant] of [['first', '測試客戶甲', 'default'], ['second', '測試客戶乙', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['second-client', 'customer', state.second, 'default'], ['foreign-admin', 'admin', null, 'other'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'client') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.58.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, headers: this.headers, raw: data, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
// 每個測試用自己的牌照，互不影響
function makePlate({ customer = state.first, route = '粵港', vehiclePlate = 'AB1234', card = {} } = {}) {
  const now = new Date().toISOString(), plateId = randomUUID(), vehicleId = vehiclePlate ? randomUUID() : null
  if (vehicleId) state.db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(vehicleId, customer, route, route === '粵澳' ? '澳門' : '香港', '私家車', vehiclePlate)
  const cardNumber = 'C-' + plateId.slice(0, 8)
  state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,card_number,card_expires_on,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(plateId, customer, route, '粵Z' + plateId.slice(0, 4).toUpperCase() + '港', vehiclePlate, vehicleId, vehicleId ? '已上牌' : '未上牌', cardNumber, card.validTo || null, JSON.stringify({ cardNumber, ...card }), now, now)
  return { plateId, vehicleId }
}
const submit = (plateId, body, token = 'client') => request(`/my/plates/${plateId}/self-handled`, 'POST', body, token)
const vehicleChange = (plateId, extra = {}) => submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'NEW' + plateId.slice(0, 4).toUpperCase(), brand: 'Toyota', model: 'Alphard' }, ...extra })
const plateRow = plateId => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(plateId)
const vehicleRow = vehicleId => state.db.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId)
const dateOf = (type, ownerId, code) => state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_type=? AND owner_id=? AND code=?').get(type, ownerId, code)?.expires_on
const deadlines = async plateId => (await request(`/my/plates/${plateId}`)).body.deadlines
const setDate = (type, ownerId, code, value, tenant = 'default') => state.db.prepare('INSERT OR REPLACE INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(tenant, type, ownerId, code, value, '', null, new Date().toISOString())
function addDriver(plateId, name, role, customer = state.first) {
  const driverId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(driverId, 'default', customer, name, now, now)
  state.db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role,sort,registered_on) VALUES (?,?,?,?,?)').run(plateId, driverId, role, role === '主' ? 0 : 1, '2026-01-01')
  return driverId
}

// ── 換車 ──
test('客戶自行換車：新車建檔並綁定牌照', async () => {
  const { plateId, vehicleId } = makePlate()
  const r = await vehicleChange(plateId)
  assert.equal(r.status, 201)
  const plate = plateRow(plateId)
  assert.notEqual(plate.vehicle_id, vehicleId)
  assert.equal(plate.local_plate, 'NEW' + plateId.slice(0, 4).toUpperCase())
  assert.equal(vehicleRow(plate.vehicle_id).brand, 'Toyota')
  assert.equal(r.body.status, '待核對')
})
test('換走的舊車保留記錄並停止提醒', async () => {
  const { plateId, vehicleId } = makePlate()
  setDate('vehicle', vehicleId, 'local_insurance', shift(10))
  assert.ok((await deadlines(plateId)).some(item => item.ownerId === vehicleId))
  assert.equal((await vehicleChange(plateId)).status, 201)
  const old = vehicleRow(vehicleId)
  assert.equal(old.retired_on, hkToday())
  assert.equal(old.replaced_by, plateRow(plateId).vehicle_id)
  assert.ok(!(await deadlines(plateId)).some(item => item.ownerId === vehicleId))
})
test('換走的舊車在管理端到期清單也不再出現', async () => {
  const { plateId, vehicleId } = makePlate()
  setDate('vehicle', vehicleId, 'local_insurance', shift(10))
  assert.ok((await request('/overview', 'GET', undefined, 'admin')).body.deadlines.some(item => item.ownerId === vehicleId))
  assert.equal((await vehicleChange(plateId)).status, 201)
  const admin = async () => (await request('/overview', 'GET', undefined, 'admin')).body.deadlines
  assert.ok(!(await admin()).some(item => item.ownerId === vehicleId))
})
test('換車時填的新車到期日寫入新車', async () => {
  const { plateId } = makePlate()
  const r = await vehicleChange(plateId, { dates: { local_insurance: shift(300), cn_ctpl: shift(200) } })
  assert.equal(r.status, 201)
  const vehicleId = plateRow(plateId).vehicle_id
  assert.equal(dateOf('vehicle', vehicleId, 'local_insurance'), shift(300))
  assert.equal(dateOf('vehicle', vehicleId, 'cn_ctpl'), shift(200))
  assert.ok(r.body.details.missing.includes('香港車輛牌照'))
})
test('換車時到期日可留空', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { dates: { local_insurance: '' } })).status, 201) })
test('舊車同時掛在另一個牌照時不停止提醒', async () => {
  const { plateId, vehicleId } = makePlate()
  const other = makePlate({ vehiclePlate: null })
  state.db.prepare('UPDATE plate_assets SET vehicle_id=? WHERE id=?').run(vehicleId, other.plateId)
  const r = await vehicleChange(plateId)
  assert.equal(r.status, 201)
  assert.equal(vehicleRow(vehicleId).retired_on, null)
  assert.equal(r.body.details.oldVehicle.retired, false)
})
test('名下已有同車牌的車時沿用，不重複建檔', async () => {
  const { plateId } = makePlate()
  const spare = makePlate({ vehiclePlate: 'SPARE' + plateId.slice(0, 3).toUpperCase() })
  state.db.prepare('UPDATE plate_assets SET vehicle_id=NULL WHERE id=?').run(spare.plateId)
  const before = state.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n
  const r = await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'spare' + plateId.slice(0, 3) } })
  assert.equal(r.status, 201)
  assert.equal(plateRow(plateId).vehicle_id, spare.vehicleId)
  assert.equal(state.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n, before)
  assert.equal(r.body.details.newVehicle.reused, true)
})
test('沒有綁定車輛的牌照也可自行換車', async () => {
  const { plateId } = makePlate({ vehiclePlate: null })
  const r = await vehicleChange(plateId)
  assert.equal(r.status, 201)
  assert.equal(plateRow(plateId).installation_status, '已上牌')
  assert.equal(r.body.details.oldVehicle, null)
})
test('新車車牌與現在的車相同回 400', async () => {
  const { plateId } = makePlate({ vehiclePlate: 'SAME01' })
  const r = await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'same 01' } })
  assert.equal(r.status, 400); assert.match(r.body.error, /直接修改車牌/)
})
test('換車缺新車資料回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'vehicle_change' })).status, 400) })
test('換車新車車牌空白回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: '   ' } })).status, 400) })
test('換車新車資料為陣列回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'vehicle_change', vehicle: ['AB'] })).status, 400) })
test('換車品牌為數字回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'X1', brand: 5 } })).status, 400) })
test('換車首次登記日期無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'X2', firstRegisteredOn: '2026-02-30' } })).status, 400) })
test('澳門車不接受香港車輛牌照到期日', async () => {
  const { plateId } = makePlate({ route: '粵澳', vehiclePlate: 'MA1234' })
  assert.equal((await vehicleChange(plateId, { dates: { hk_licence: shift(100) } })).status, 400)
})
test('換車不接受未知的到期事項', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { dates: { made_up: shift(10) } })).status, 400) })
test('換車到期日格式無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { dates: { local_insurance: '31/12/2027' } })).status, 400) })
test('換車失敗時不留下任何改動', async () => {
  const { plateId, vehicleId } = makePlate()
  const before = state.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n
  assert.equal((await vehicleChange(plateId, { dates: { local_insurance: 'bad' } })).status, 400)
  assert.equal(plateRow(plateId).vehicle_id, vehicleId)
  assert.equal(state.db.prepare('SELECT COUNT(*) n FROM vehicles').get().n, before)
})
test('批文卡上的港澳車牌和新車不符時標示給員工', async () => {
  const { plateId } = makePlate({ card: { localPlate: 'OLD999' } })
  const r = await vehicleChange(plateId)
  assert.equal(r.body.details.cardMismatch, 'OLD999')
})
test('原屬我們代辦時標示客戶自行辦理', async () => {
  const { plateId } = makePlate()
  const r = await vehicleChange(plateId)
  assert.equal(typeof r.body.details.ours, 'boolean')
})
test('有開着的換車工單時列出給員工', async () => {
  const { plateId } = makePlate()
  const requestId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(requestId, state.first, 'vehicle_change', '粵港', '換車', '進行中', '新舊車資料核對', now, now, plateId)
  const r = await vehicleChange(plateId)
  assert.deepEqual(r.body.details.openRequests.map(item => item.id), [requestId])
})
test('已結案的工單不列出', async () => {
  const { plateId } = makePlate()
  const now = new Date().toISOString()
  state.db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), state.first, 'vehicle_change', '粵港', '換車', '已完成', '交付', now, now, plateId)
  assert.deepEqual((await vehicleChange(plateId)).body.details.openRequests, [])
})
test('同類自辦待核對時不能重複提交', async () => {
  const { plateId } = makePlate()
  assert.equal((await vehicleChange(plateId)).status, 201)
  const r = await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'AGAIN1' } })
  assert.equal(r.status, 409)
})
test('辦好日期在今天之後回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { handledOn: shift(1) })).status, 400) })
test('辦好日期無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { handledOn: '2026-13-01' })).status, 400) })
test('辦好日期可選過去的日子', async () => {
  const { plateId, vehicleId } = makePlate()
  assert.equal((await vehicleChange(plateId, { handledOn: shift(-5) })).status, 201)
  assert.equal(vehicleRow(vehicleId).retired_on, shift(-5))
})

// ── 續期 ──
test('自行續期：更新批文有效期和香港 CRP', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(20), validFrom: shift(-345) } })
  setDate('plate', plateId, 'hk_crp', shift(20))
  const r = await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(385) }, hk_crp: { done: true, expiresOn: shift(380) } } })
  assert.equal(r.status, 201)
  assert.equal(plateRow(plateId).card_expires_on, shift(385))
  assert.equal(JSON.parse(plateRow(plateId).card_data).validTo, shift(385))
  assert.equal(dateOf('plate', plateId, 'hk_crp'), shift(380))
})
test('續期未辦好的文件照舊提醒', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(20) } })
  setDate('plate', plateId, 'hk_crp', shift(20))
  const r = await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(385) }, hk_crp: { done: false } } })
  assert.equal(r.status, 201)
  assert.equal(dateOf('plate', plateId, 'hk_crp'), shift(20))
  assert.deepEqual(r.body.details.notDone, ['香港封閉道路通行許可證（CRP）'])
})
test('續期全部未辦好回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: false } } })).status, 400) })
test('續期沒有文件回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal' })).status, 400) })
test('續期已辦好但沒有新到期日回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: true } } })).status, 400) })
test('續期新到期日不在辦好日期之後回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: hkToday() } } })).status, 400) })
test('續期新到期日不比現在的晚回 400', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(200) } })
  const r = await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(200) } } })
  assert.equal(r.status, 400); assert.match(r.body.error, /直接修改日期/)
})
test('續期 CRP 新到期日早於現在的回 400', async () => {
  const { plateId } = makePlate()
  setDate('plate', plateId, 'hk_crp', shift(300))
  assert.equal((await submit(plateId, { kind: 'renewal', documents: { hk_crp: { done: true, expiresOn: shift(100) } } })).status, 400)
})
test('續期是否辦好不是真假值回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: 'yes', expiresOn: shift(300) } } })).status, 400) })
test('粵港牌照不接受澳門通行證', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { mo_permit: { done: true, expiresOn: shift(300) } } })).status, 400) })
test('續期時新批文備案已辦記為完成', async () => {
  const { plateId } = makePlate({ card: { validFrom: shift(-10), validTo: shift(20) } })
  assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(385) } }, newCardFiling: true })).status, 201)
  assert.ok(state.db.prepare("SELECT 1 FROM rule_completions WHERE code='new_card_filing' AND owner_id=? AND period=?").get(plateId, shift(-10)))
})
test('續期新批文備案格式無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(300) } }, newCardFiling: 'yes' })).status, 400) })

// ── 換司機 ──
test('自行換司機：按新名單登記主司機和副司機', async () => {
  const { plateId } = makePlate()
  addDriver(plateId, '舊主司機' + plateId.slice(0, 4), '主')
  const r = await submit(plateId, { kind: 'driver_change', drivers: [{ name: '新主司機' + plateId.slice(0, 4), role: '主', phone: '+852 9123 4567' }, { name: '新副司機' + plateId.slice(0, 4), role: '副' }] })
  assert.equal(r.status, 201)
  const rows = state.db.prepare('SELECT d.name, pd.role FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY pd.sort').all(plateId)
  assert.deepEqual(rows.map(row => [row.name, row.role]), [['新主司機' + plateId.slice(0, 4), '主'], ['新副司機' + plateId.slice(0, 4), '副']])
})
test('換走而沒有開其他牌照的司機停止提醒', async () => {
  const { plateId } = makePlate()
  const oldId = addDriver(plateId, '離開司機' + plateId.slice(0, 4), '主')
  setDate('driver', oldId, 'home_return_permit', shift(15))
  assert.ok((await request('/overview', 'GET', undefined, 'admin')).body.deadlines.some(item => item.ownerId === oldId))
  assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '接手司機' + plateId.slice(0, 4), role: '主' }] })).status, 201)
  assert.equal(state.db.prepare('SELECT retired_on FROM drivers WHERE id=?').get(oldId).retired_on, hkToday())
  assert.ok(!(await request('/overview', 'GET', undefined, 'admin')).body.deadlines.some(item => item.ownerId === oldId))
})
test('換走但仍開其他牌照的司機繼續提醒', async () => {
  const { plateId } = makePlate(), other = makePlate()
  const sharedId = addDriver(plateId, '兩牌司機' + plateId.slice(0, 4), '副')
  state.db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role,sort,registered_on) VALUES (?,?,?,?,?)').run(other.plateId, sharedId, '主', 0, '2026-01-01')
  const r = await submit(plateId, { kind: 'driver_change', drivers: [{ name: '只開這牌' + plateId.slice(0, 4), role: '主' }] })
  assert.equal(r.status, 201)
  assert.equal(state.db.prepare('SELECT retired_on FROM drivers WHERE id=?').get(sharedId).retired_on, null)
  assert.equal(r.body.details.removed[0].stillDrivesOther, true)
})
test('再次登記之前換走的司機會恢復提醒', async () => {
  const { plateId } = makePlate()
  const name = '回來司機' + plateId.slice(0, 4)
  const driverId = addDriver(plateId, name, '主')
  state.db.prepare('UPDATE drivers SET retired_on=? WHERE id=?').run('2026-01-01', driverId)
  assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name, role: '主' }] })).status, 201)
  assert.equal(state.db.prepare('SELECT retired_on FROM drivers WHERE id=?').get(driverId).retired_on, null)
})
test('換司機時填的證件到期日寫入司機', async () => {
  const { plateId } = makePlate()
  const name = '證件司機' + plateId.slice(0, 4)
  assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name, role: '主', dates: { home_return_permit: shift(500) } }] })).status, 201)
  const driverId = state.db.prepare('SELECT id FROM drivers WHERE name=?').get(name).id
  assert.equal(dateOf('driver', driverId, 'home_return_permit'), shift(500))
})
test('換司機沒有主司機回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '甲', role: '副' }] })).status, 400) })
test('換司機兩位主司機回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '甲', role: '主' }, { name: '乙', role: '主' }] })).status, 400) })
test('換司機重複同一位司機回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '甲', role: '主' }, { name: '甲', role: '副' }] })).status, 400) })
test('換司機超過 3 位回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [['甲', '主'], ['乙', '副'], ['丙', '副'], ['丁', '副']].map(([name, role]) => ({ name, role })) })).status, 400) })
test('換司機姓名空白回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '  ', role: '主' }] })).status, 400) })
test('換司機名單空白回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [] })).status, 400) })
test('換司機角色無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '甲', role: '老闆' }] })).status, 400) })
test('換司機電話格式無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'driver_change', drivers: [{ name: '甲', role: '主', phone: 'abc' }] })).status, 400) })
test('換司機與批文卡駕駛人不符時標示給員工', async () => {
  const { plateId } = makePlate({ card: { driver1: '卡上司機' } })
  const r = await submit(plateId, { kind: 'driver_change', drivers: [{ name: '另一位' + plateId.slice(0, 4), role: '主' }] })
  assert.equal(r.body.details.cardMismatch, '卡上司機')
})

// ── 不再續期 ──
test('不再續期：停止牌照的到期提醒', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(20) } })
  setDate('plate', plateId, 'hk_crp', shift(20))
  assert.ok((await deadlines(plateId)).some(item => item.ownerType === 'plate'))
  const r = await submit(plateId, { kind: 'stop_renewal', reason: '已賣車／不再使用', note: '車已賣' })
  assert.equal(r.status, 201)
  assert.equal(plateRow(plateId).stopped_on, hkToday())
  assert.ok(!(await deadlines(plateId)).some(item => item.ownerType === 'plate'))
})
test('不再續期原因無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '不想' })).status, 400) })
test('不再續期補充說明不是文字回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '其他', note: 5 })).status, 400) })
test('不再續期的牌照不能再提交其他自辦', async () => {
  const { plateId } = makePlate()
  assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '放棄指標' })).status, 201)
  assert.equal((await vehicleChange(plateId)).status, 409)
})

// ── 共通檢查 ──
test('自辦拒絕 null 內容', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, null)).status, 400) })
test('自辦拒絕陣列內容', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, [])).status, 400) })
test('自辦拒絕未知類別', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'repaint' })).status, 400) })
test('不能為同租戶其他客戶的牌照提交自辦', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, {}).then(() => submit(plateId, { kind: 'stop_renewal', reason: '其他' }, 'second-client'))).status, 404) })
test('不能為其他租戶的牌照提交自辦', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '其他' }, 'foreign-client')).status, 404) })
test('不存在的牌照提交自辦回 404', async () => { assert.equal((await submit(randomUUID(), { kind: 'stop_renewal', reason: '其他' })).status, 404) })
test('員工不能代客戶提交自辦', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '其他' }, 'staff')).status, 403) })
test('未登入不能提交自辦', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'stop_renewal', reason: '其他' }, '')).status, 401) })
test('自辦相片超過 6 張回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { photos: Array(7).fill(photo) })).status, 400) })
test('自辦相片不是圖片回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { photos: ['data:application/pdf;base64,AAAA'] })).status, 400) })
test('自辦相片不是陣列回 400', async () => { const { plateId } = makePlate(); assert.equal((await vehicleChange(plateId, { photos: photo })).status, 400) })
test('客戶可查看自己牌照的自辦記錄', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const r = await request(`/my/plates/${plateId}/self-handled`)
  assert.equal(r.status, 200)
  assert.equal(r.body[0].kindName, '自行換車')
})

test('客戶取得自辦表單：粵港牌照列出批文、CRP，不列澳門通行證', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(30), localPlate: 'AB1234' } })
  const r = await request(`/my/plates/${plateId}/self-handled/form`)
  assert.equal(r.status, 200)
  const codes = r.body.renewalDocuments.map(item => item.code)
  assert.ok(codes.includes('approval') && codes.includes('hk_crp') && !codes.includes('mo_permit'))
  assert.equal(r.body.renewalDocuments.find(item => item.code === 'approval').expiresOn, shift(30))
  assert.ok(r.body.vehicleDates.some(item => item.code === 'hk_licence'))
})
test('粵澳牌照的換車表單不列香港車輛牌照', async () => {
  const { plateId } = makePlate({ route: '粵澳', vehiclePlate: 'MB1234' })
  assert.ok(!(await request(`/my/plates/${plateId}/self-handled/form`)).body.vehicleDates.some(item => item.code === 'hk_licence'))
})
test('自辦表單列出待核對的類別', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  assert.deepEqual((await request(`/my/plates/${plateId}/self-handled/form`)).body.pending, ['vehicle_change'])
})
test('其他客戶取不到自辦表單', async () => { const { plateId } = makePlate(); assert.equal((await request(`/my/plates/${plateId}/self-handled/form`, 'GET', undefined, 'second-client')).status, 404) })

// ── 驗車、備案由客戶標記已辦好 ──
// 第 6 年上線檢驗：首次登記日推回 6 年，令今年那一期在 20 天後到期
function inspectionPlate() {
  const made = makePlate()
  const due = shift(20), registered = `${Number(due.slice(0, 4)) - 6}${due.slice(4)}`
  state.db.prepare('UPDATE vehicles SET first_registered_on=? WHERE id=?').run(registered, made.vehicleId)
  return { ...made, period: due.slice(0, 4) }
}
const markInspection = (plateId, extra = {}) => submit(plateId, { kind: 'inspection_done', photos: [photo], ...extra })
test('客戶端到期項目標示驗車可標記已辦好', async () => {
  const { plateId, vehicleId, period } = inspectionPlate()
  const item = (await deadlines(plateId)).find(entry => entry.code === 'inspection' && entry.ownerId === vehicleId)
  assert.equal(item.markable, true); assert.equal(item.period, period)
})
test('按日期記錄的到期項目不標示可標記', async () => {
  const { plateId } = makePlate()
  setDate('plate', plateId, 'hk_crp', shift(20))
  assert.ok(!(await deadlines(plateId)).find(entry => entry.code === 'hk_crp').markable)
})
test('客戶標記驗車已辦好後不再提醒', async () => {
  const { plateId, vehicleId, period } = inspectionPlate()
  const r = await markInspection(plateId, { period })
  assert.equal(r.status, 201)
  assert.ok(state.db.prepare("SELECT 1 FROM rule_completions WHERE code='inspection' AND owner_id=? AND period=?").get(vehicleId, period))
  assert.ok(!(await deadlines(plateId)).some(entry => entry.code === 'inspection' && entry.period === period))
  assert.equal(r.body.details.label, '第 6 年上線檢驗')
})
test('標記驗車沒有附相片回 400', async () => { const { plateId, period } = inspectionPlate(); const r = await markInspection(plateId, { period, photos: [] }); assert.equal(r.status, 400); assert.match(r.body.error, /相片/) })
test('標記驗車期數不是現在這一期回 400', async () => { const { plateId } = inspectionPlate(); assert.equal((await markInspection(plateId, { period: '1999' })).status, 400) })
test('標記驗車沒有期數回 400', async () => { const { plateId } = inspectionPlate(); assert.equal((await markInspection(plateId, {})).status, 400) })
test('標記驗車期數不是文字回 400', async () => { const { plateId } = inspectionPlate(); assert.equal((await markInspection(plateId, { period: 2026 })).status, 400) })
test('已標記辦好的一期不能再標記', async () => {
  const { plateId, vehicleId, period } = inspectionPlate()
  state.db.prepare('INSERT INTO rule_completions(tenant_id,code,owner_id,period,completed_by,completed_at) VALUES (?,?,?,?,?,?)').run('default', 'inspection', vehicleId, period, null, new Date().toISOString())
  assert.equal((await markInspection(plateId, { period })).status, 409)
})
test('沒有綁定車輛的牌照不能標記驗車', async () => { const { plateId } = makePlate({ vehiclePlate: null }); assert.equal((await markInspection(plateId, { period: hkToday().slice(0, 4) })).status, 400) })
test('標記驗車的車不屬於這個牌照回 400', async () => {
  const { plateId, period } = inspectionPlate(), other = makePlate()
  assert.equal((await markInspection(plateId, { period, ownerId: other.vehicleId })).status, 400)
})
test('其他客戶不能標記驗車', async () => { const { plateId, period } = inspectionPlate(); assert.equal((await submit(plateId, { kind: 'inspection_done', period, photos: [photo] }, 'second-client')).status, 404) })
test('客戶標記新批文備案已辦好', async () => {
  const validFrom = shift(-170)
  const { plateId } = makePlate({ card: { validFrom } })
  const item = (await deadlines(plateId)).find(entry => entry.code === 'new_card_filing')
  assert.equal(item.markable, true)
  const r = await submit(plateId, { kind: 'filing_done', period: item.period, photos: [photo] })
  assert.equal(r.status, 201)
  assert.ok(!(await deadlines(plateId)).some(entry => entry.code === 'new_card_filing'))
})
test('標記備案沒有附相片的錯誤訊息說明要回執', async () => {
  const { plateId } = makePlate({ card: { validFrom: shift(-170) } })
  const r = await submit(plateId, { kind: 'filing_done', period: shift(-170) })
  assert.equal(r.status, 400); assert.match(r.body.error, /備案回執/)
})
test('退回驗車標記後恢復提醒', async () => {
  const { plateId, vehicleId, period } = inspectionPlate()
  await markInspection(plateId, { period })
  const row = (await request('/self-handled', 'GET', undefined, 'admin')).body.find(item => item.plateId === plateId)
  assert.equal((await request(`/self-handled/${row.id}/return`, 'POST', { note: '相片看不到檢驗標誌' }, 'admin')).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) n FROM rule_completions WHERE code='inspection' AND owner_id=?").get(vehicleId).n, 0)
  assert.ok((await deadlines(plateId)).some(entry => entry.code === 'inspection' && entry.period === period))
})
test('核對驗車標記後保持已辦好', async () => {
  const { plateId, vehicleId, period } = inspectionPlate()
  await markInspection(plateId, { period })
  const row = (await request('/self-handled', 'GET', undefined, 'admin')).body.find(item => item.plateId === plateId)
  assert.equal((await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')).status, 200)
  assert.ok(state.db.prepare("SELECT 1 FROM rule_completions WHERE code='inspection' AND owner_id=? AND period=?").get(vehicleId, period))
})

// ── 口岸變更、商號變更、補領 ──
const cardOf = plateId => JSON.parse(plateRow(plateId).card_data)
test('自行口岸變更：更新批文卡通行口岸和香港 CRP', async () => {
  const { plateId } = makePlate({ card: { crossing: '深圳灣' } })
  setDate('plate', plateId, 'hk_crp', shift(30))
  const r = await submit(plateId, { kind: 'crossing_change', crossing: '港珠澳大橋', crpExpiresOn: shift(400) })
  assert.equal(r.status, 201)
  assert.equal(cardOf(plateId).crossing, '港珠澳大橋')
  assert.equal(dateOf('plate', plateId, 'hk_crp'), shift(400))
  assert.deepEqual(r.body.details.crp, { before: shift(30), after: shift(400) })
})
test('口岸變更可不填 CRP 到期日', async () => { const { plateId } = makePlate({ card: { crossing: '深圳灣' } }); const r = await submit(plateId, { kind: 'crossing_change', crossing: '皇崗' }); assert.equal(r.status, 201); assert.equal(r.body.details.crp, null) })
test('粵澳牌照不能自行口岸變更', async () => { const { plateId } = makePlate({ route: '粵澳', vehiclePlate: 'MC1234' }); assert.equal((await submit(plateId, { kind: 'crossing_change', crossing: '橫琴' })).status, 400) })
test('口岸變更沒有新口岸回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'crossing_change', crossing: '  ' })).status, 400) })
test('口岸變更新口岸不是文字回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'crossing_change', crossing: ['皇崗'] })).status, 400) })
test('口岸與現在相同回 400', async () => { const { plateId } = makePlate({ card: { crossing: '皇崗' } }); const r = await submit(plateId, { kind: 'crossing_change', crossing: '皇崗' }); assert.equal(r.status, 400); assert.match(r.body.error, /直接修改/) })
test('口岸變更 CRP 到期日無效回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'crossing_change', crossing: '皇崗', crpExpiresOn: '2027-02-30' })).status, 400) })
test('自行商號變更：只改批文卡名稱，不搬公司組', async () => {
  const { plateId } = makePlate({ card: { company: '舊商號有限公司', contractor: '旧内承有限公司' } })
  const groupBefore = plateRow(plateId).group_id
  const r = await submit(plateId, { kind: 'company_change', company: '新商號有限公司', contractor: '旧内承有限公司' })
  assert.equal(r.status, 201)
  assert.equal(cardOf(plateId).company, '新商號有限公司')
  assert.equal(plateRow(plateId).group_id, groupBefore)
  assert.deepEqual(r.body.details.changes, [{ label: '商號', before: '舊商號有限公司', after: '新商號有限公司' }])
})
test('商號變更兩項都沒改變回 400', async () => { const { plateId } = makePlate({ card: { company: '甲有限公司' } }); assert.equal((await submit(plateId, { kind: 'company_change', company: '甲有限公司' })).status, 400) })
test('商號變更不可把商號留空', async () => { const { plateId } = makePlate({ card: { company: '甲有限公司' } }); assert.equal((await submit(plateId, { kind: 'company_change', company: '   ' })).status, 400) })
test('商號變更內承單位不是文字回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'company_change', contractor: 7 })).status, 400) })
test('自行補領：更新卡面流水號', async () => {
  const { plateId } = makePlate({ card: { serial: 'S0001' } })
  const r = await submit(plateId, { kind: 'replacement', serial: 'S0099' })
  assert.equal(r.status, 201)
  assert.equal(cardOf(plateId).serial, 'S0099')
  assert.equal(r.body.details.cardNumber, null)
})
test('補領時可一併更新批文卡編號', async () => {
  const { plateId } = makePlate({ card: { serial: 'S0001' } })
  const next = 'NEWNO-' + plateId.slice(0, 6)
  const r = await submit(plateId, { kind: 'replacement', serial: 'S0100', cardNumber: next })
  assert.equal(r.status, 201)
  assert.equal(plateRow(plateId).card_number, next)
  assert.equal(cardOf(plateId).cardNumber, next)
})
test('補領不能用名下另一張卡的編號', async () => {
  const { plateId } = makePlate(), other = makePlate()
  assert.equal((await submit(plateId, { kind: 'replacement', serial: 'S2', cardNumber: plateRow(other.plateId).card_number })).status, 409)
})
test('補領沒有流水號回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'replacement' })).status, 400) })
test('補領批文卡編號留空回 400', async () => { const { plateId } = makePlate(); assert.equal((await submit(plateId, { kind: 'replacement', serial: 'S3', cardNumber: ' ' })).status, 400) })
test('補領流水號與現在相同回 400', async () => { const { plateId } = makePlate({ card: { serial: 'S7' } }); assert.equal((await submit(plateId, { kind: 'replacement', serial: 'S7' })).status, 400) })
test('補領時新卡有效期不同會提示員工核對', async () => {
  const { plateId } = makePlate({ card: { serial: 'S1', validTo: shift(100) } })
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { ...cardOf(plateId), validTo: shift(200) } })).status, 200)
  const r = await submit(plateId, { kind: 'replacement', serial: 'S2' })
  assert.deepEqual(r.body.details.validityChanged, { before: shift(100), after: shift(200) })
})
test('先改批文卡口岸再說明是自行變更也可提交', async () => {
  const { plateId } = makePlate({ card: { crossing: '深圳灣' } })
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { ...cardOf(plateId), crossing: '皇崗' } })).status, 200)
  const form = (await request(`/my/plates/${plateId}/self-handled/form`)).body
  assert.equal(form.cardBefore.crossing, '深圳灣'); assert.equal(form.card.crossing, '皇崗')
  const r = await submit(plateId, { kind: 'crossing_change', crossing: '皇崗' })
  assert.equal(r.status, 201); assert.equal(r.body.details.before, '深圳灣')
})
test('先改批文卡有效期再說明是自行續期也可提交', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(20) } })
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { ...cardOf(plateId), validTo: shift(385) } })).status, 200)
  const r = await submit(plateId, { kind: 'renewal', documents: { approval: { done: true, expiresOn: shift(385) } } })
  assert.equal(r.status, 201); assert.equal(r.body.details.done[0].before, shift(20))
})
test('先改流水號再說明是自行補領也可提交', async () => {
  const { plateId } = makePlate({ card: { serial: 'S10' } })
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { ...cardOf(plateId), serial: 'S11' } })).status, 200)
  assert.equal((await submit(plateId, { kind: 'replacement', serial: 'S11' })).status, 201)
})
test('自辦表單帶出批文卡口岸、商號和流水號', async () => {
  const { plateId } = makePlate({ card: { crossing: '皇崗', company: '甲有限公司', serial: 'S5' } })
  const form = (await request(`/my/plates/${plateId}/self-handled/form`)).body
  assert.equal(form.card.crossing, '皇崗'); assert.equal(form.card.company, '甲有限公司'); assert.equal(form.card.serial, 'S5')
})

// ── 管理端核對 ──
const pendingFor = async plateId => (await request('/self-handled', 'GET', undefined, 'admin')).body.find(item => item.plateId === plateId)
test('員工可查看客戶自辦待核對清單', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId, { photos: [photo] })
  const r = await request('/self-handled', 'GET', undefined, 'staff')
  assert.equal(r.status, 200)
  const row = r.body.find(item => item.plateId === plateId)
  assert.equal(row.customerName, '測試客戶甲')
  assert.equal(row.files.length, 1)
  assert.deepEqual(row.cardSides, [])
})
test('客戶不能查看待核對清單', async () => { assert.equal((await request('/self-handled', 'GET', undefined, 'client')).status, 403) })
test('待核對清單狀態無效回 400', async () => { assert.equal((await request('/self-handled?status=亂寫', 'GET', undefined, 'admin')).status, 400) })
test('其他租戶看不到本租戶的自辦', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  assert.ok(!(await request('/self-handled', 'GET', undefined, 'foreign-admin')).body.some(item => item.plateId === plateId))
})
test('管理者核對自辦', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  const r = await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')
  assert.equal(r.status, 200); assert.equal(r.body.status, '已核對')
})
test('核對自辦時一併核對同一牌照的批文卡修改', async () => {
  const { plateId } = makePlate()
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { cardNumber: plateRow(plateId).card_number, localPlate: 'CARD01' } })).status, 200)
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  assert.ok(row.cardChanges >= 1)
  assert.equal((await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) n FROM customer_changes WHERE entity_id=? AND status='待核對'").get(plateId).n, 0)
  assert.equal(plateRow(plateId).card_status, '已核對')
})
test('已包在自辦裏的批文卡修改在客戶更新清單標示出來', async () => {
  const { plateId } = makePlate()
  assert.equal((await request(`/plate-assets/${plateId}`, 'PUT', { cardData: { cardNumber: plateRow(plateId).card_number, localPlate: 'COVER1' } })).status, 200)
  const flagged = async () => (await request('/customer-changes', 'GET', undefined, 'admin')).body.filter(item => item.entityId === plateId).map(item => item.inSelfHandled)
  assert.deepEqual(await flagged(), [false])
  await vehicleChange(plateId)
  assert.deepEqual(await flagged(), [true])
  const row = await pendingFor(plateId)
  await request(`/self-handled/${row.id}/return`, 'POST', { note: '請重拍' }, 'admin')
  assert.deepEqual(await flagged(), [false])
})
test('員工不能核對自辦', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  assert.equal((await request(`/self-handled/${(await pendingFor(plateId)).id}/accept`, 'POST', {}, 'staff')).status, 403)
})
test('已核對的自辦不能再核對', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')
  assert.equal((await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')).status, 409)
})
test('核對其他租戶的自辦回 404', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  assert.equal((await request(`/self-handled/${(await pendingFor(plateId)).id}/accept`, 'POST', {}, 'foreign-admin')).status, 404)
})
test('核對不存在的自辦回 404', async () => { assert.equal((await request(`/self-handled/${randomUUID()}/accept`, 'POST', {}, 'admin')).status, 404) })
test('退回自辦必須寫原因', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  assert.equal((await request(`/self-handled/${(await pendingFor(plateId)).id}/return`, 'POST', { note: '   ' }, 'admin')).status, 400)
})
test('退回自辦時通知客戶', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  const r = await request(`/self-handled/${row.id}/return`, 'POST', { note: '新車保單相片看不清楚' }, 'admin')
  assert.equal(r.status, 200); assert.equal(r.body.status, '已退回')
  const note = state.db.prepare("SELECT * FROM notifications WHERE customer_id=? AND kind='self_handled_returned' ORDER BY created_at DESC").get(state.first)
  assert.match(note.body, /新車保單相片看不清楚/)
})
test('確認自辦時通知客戶，按通知打開牌照頁', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')).status, 200)
  const note = state.db.prepare("SELECT * FROM notifications WHERE customer_id=? AND kind='self_handled_accepted' AND link LIKE ?").get(state.first, `%${plateId}%`)
  assert.match(note.title, /顧問已確認你自行辦理的「自行換車」/)
  assert.match(note.body, /已核對無誤/)
})
test('退回自辦不發確認通知', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/return`, 'POST', { note: '資料不齊' }, 'admin')).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='self_handled_accepted' AND link LIKE ?").get(`%${plateId}%`).n, 0)
})
test('確認自辦時一併核對的批文卡修改不另發通知', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/accept`, 'POST', {}, 'admin')).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='change_accepted' AND link LIKE ?").get(`%${plateId}%`).n, 0)
})
test('退回不再續期時恢復提醒', async () => {
  const { plateId } = makePlate({ card: { validTo: shift(20) } })
  await submit(plateId, { kind: 'stop_renewal', reason: '其他' })
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/return`, 'POST', { note: '客戶已改變主意' }, 'admin')).status, 200)
  assert.equal(plateRow(plateId).stopped_on, null)
  assert.ok((await deadlines(plateId)).some(item => item.ownerType === 'plate'))
})
test('退回後客戶可重新提交', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId)
  await request(`/self-handled/${(await pendingFor(plateId)).id}/return`, 'POST', { note: '請重拍' }, 'admin')
  assert.equal((await submit(plateId, { kind: 'vehicle_change', vehicle: { plate: 'RETRY' + plateId.slice(0, 3) } })).status, 201)
})
test('員工可取回自辦相片', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId, { photos: [photo] })
  const row = await pendingFor(plateId)
  const r = await request(`/self-handled/${row.id}/files/${row.files[0]}`, 'GET', undefined, 'staff')
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png')
})
test('其他租戶取回自辦相片回 404', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId, { photos: [photo] })
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/files/${row.files[0]}`, 'GET', undefined, 'foreign-admin')).status, 404)
})
test('客戶不能取回自辦相片的後台地址', async () => {
  const { plateId } = makePlate()
  await vehicleChange(plateId, { photos: [photo] })
  const row = await pendingFor(plateId)
  assert.equal((await request(`/self-handled/${row.id}/files/${row.files[0]}`, 'GET', undefined, 'client')).status, 403)
})
