import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 14.5 輪司機管理：遷移、上限、到期、委託範圍、同步批文卡。進程內請求，不開連接埠。
const state = {}
const card = (driver1, driver2 = '', driver3 = '') => JSON.stringify({ cardNumber: randomUUID(), driver1, driver2, driver3 })
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'drivers-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  // 先建立舊資料（批文卡上有駕駛人），再載入伺服器，讓一次性遷移處理它們
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'otherCustomer', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.otherCustomer, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  const now = new Date().toISOString()
  for (const [key, customerId, data] of [['plateA', state.customer, card('陳大文', '李小明', '王五')], ['plateB', state.customer, card('陳大文')], ['plateEmpty', state.customer, card('')], ['plateOther', state.otherCustomer, card('陳大文')], ['plateForeign', state.foreign, card('外人')]]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?,?)').run(state[key], customerId, '粵港', `粵Z${key}`, state[key], now, now, data)
  }
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const driverId = name => state.db.prepare('SELECT id FROM drivers WHERE customer_id=? AND name=?').get(state.customer, name)?.id

// ── 遷移 ──
test('遷移按批文卡駕駛人 1–3 建立司機，駕駛人 1 為主司機', async () => {
  const plate = (await request(`/plates/${state.plateA}/drivers`)).body
  assert.deepEqual(plate.drivers.map(item => [item.name, item.role]), [['陳大文', '主'], ['李小明', '副'], ['王五', '副']])
  assert.equal(plate.mismatch, false)
})
test('遷移時同一客戶同名司機只建立一次', async () => {
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM drivers WHERE customer_id=? AND name=?').get(state.customer, '陳大文').count, 1)
  assert.equal((await request(`/drivers/${driverId('陳大文')}`)).body.plates.length, 2)
})
test('不同客戶的同名司機是不同的人', async () => assert.equal(state.db.prepare("SELECT COUNT(*) count FROM drivers WHERE name='陳大文'").get().count, 2))
test('批文卡沒有駕駛人的牌照不建立登記', async () => assert.equal((await request(`/plates/${state.plateEmpty}/drivers`)).body.drivers.length, 0))

// ── 司機資料 ──
test('新增司機，香港身份證只保存最後 4 位', async () => {
  const result = await request('/drivers', 'POST', { customerId: state.customer, name: '張三', phone: '+852 6123 4567', hkIdNo: 'A123456(7)', homeReturnPermitNo: 'H12345678' })
  assert.equal(result.status, 201); assert.equal(result.body.hkIdNo, '******6(7)'); state.zhang = result.body.id
  assert.equal(state.db.prepare('SELECT hk_id_no FROM drivers WHERE id=?').get(state.zhang).hk_id_no, '******6(7)')
})
test('新增司機時姓名空白、格式錯誤、客戶不存在都被拒', async () => {
  for (const body of [null, [], {}, { customerId: state.customer, name: '  ' }, { customerId: state.customer, name: 123 }, { customerId: state.customer, name: '甲', phone: 'abc' }, { customerId: state.customer, name: '甲', hkIdNo: 'XYZ' }]) assert.equal((await request('/drivers', 'POST', body)).status, 400, JSON.stringify(body))
  assert.equal((await request('/drivers', 'POST', { customerId: randomUUID(), name: '甲' })).status, 404)
})
test('同一客戶同名司機重複新增被拒', async () => assert.equal((await request('/drivers', 'POST', { customerId: state.customer, name: '張三' })).status, 409))
test('修改司機：遮蔽的身份證原樣送回不覆寫，不可轉到其他客戶', async () => {
  const result = await request(`/drivers/${state.zhang}`, 'PATCH', { phone: '+852 6999 0000', hkIdNo: '******6(7)' })
  assert.equal(result.status, 200); assert.equal(result.body.phone, '+852 6999 0000'); assert.equal(result.body.hkIdNo, '******6(7)')
  assert.equal((await request(`/drivers/${state.zhang}`, 'PATCH', { customerId: state.otherCustomer })).status, 400)
  assert.equal((await request(`/drivers/${state.zhang}`, 'PATCH', { name: '' })).status, 400)
})

// ── 主副司機上限 ──
test('第 2 位主司機被拒', async () => assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: driverId('陳大文'), role: '主' }, { driverId: state.zhang, role: '主' }] })).status, 400))
test('第 3 位副司機被拒', async () => {
  const extra = (await request('/drivers', 'POST', { customerId: state.customer, name: '趙六' })).body.id
  assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: driverId('李小明'), role: '副' }, { driverId: driverId('王五'), role: '副' }, { driverId: extra, role: '副' }] })).status, 400)
})
test('同一司機在同一牌照重複登記被拒', async () => assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: state.zhang, role: '主' }, { driverId: state.zhang, role: '副' }] })).status, 400))
test('不可登記其他客戶的司機', async () => {
  const other = state.db.prepare('SELECT id FROM drivers WHERE customer_id=?').get(state.otherCustomer).id
  assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: other, role: '主' }] })).status, 400)
})
test('整組設定主副司機成功', async () => {
  const result = await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: state.zhang, role: '副' }, { driverId: driverId('陳大文'), role: '主' }] })
  assert.equal(result.status, 200); assert.deepEqual(result.body.drivers.map(item => item.role), ['主', '副'])
})
test('登記格式錯誤被拒', async () => { for (const body of [null, {}, { drivers: 'x' }, { drivers: [{ driverId: state.zhang, role: '司機' }] }, { drivers: [{ role: '主' }] }]) assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', body)).status, 400) })

// ── 權限與租戶 ──
test('客戶不能使用司機管理接口', async () => {
  assert.equal((await request('/drivers', 'GET', undefined, 'client')).status, 403)
  assert.equal((await request(`/plates/${state.plateA}/drivers`, 'GET', undefined, 'client')).status, 403)
})
test('員工可讀寫司機', async () => assert.equal((await request(`/drivers/${state.zhang}`, 'PATCH', { notes: '常跑深圳灣' }, 'staff')).status, 200))
test('別的租戶看不到司機和牌照登記', async () => {
  assert.equal((await request(`/drivers/${state.zhang}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/plates/${state.plateA}/drivers`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/drivers?customerId=${state.customer}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.ok((await request('/drivers', 'GET', undefined, 'foreign-admin')).body.every(item => item.customerId === state.foreign))
})

// ── 證件到期 ──
const soon = () => new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
test('司機證件可填到期日，並出現在今日工作', async () => {
  assert.equal((await request('/tracked-items', 'PUT', { ownerType: 'driver', ownerId: driverId('陳大文'), code: 'home_return_permit', expiresOn: soon() })).status, 200)
  const overview = (await request('/overview?days=90')).body
  const items = (overview.deadlines || overview.items || []).filter(item => item.ownerType === 'driver')
  assert.ok(items.some(item => item.ruleCode === 'home_return_permit' && item.ownerId === driverId('陳大文')), JSON.stringify(Object.keys(overview)))
})
test('司機證件規則不可套用到牌照', async () => assert.equal((await request('/tracked-items', 'PUT', { ownerType: 'plate', ownerId: state.plateA, code: 'home_return_permit', expiresOn: soon() })).status, 400))
test('客戶在到期提醒看到自己司機的證件', async () => {
  const overview = (await request('/my/overview', 'GET', undefined, 'client')).body
  const item = overview.deadlines.find(entry => entry.name === '回鄉證')
  assert.ok(item); assert.equal(item.plateId, state.plateA)
})
test('主司機所在牌照設為客戶自理時，司機證件不派工給我們', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plateA, service: 'plate_service', handler: 'client' })).status, 200)
  const item = ((await request('/overview?days=90')).body.deadlines || []).find(entry => entry.ownerType === 'driver' && entry.ruleCode === 'home_return_permit')
  assert.equal(item?.handler, 'client')
})
test('工單結案可更新司機證件到期日，不可更新其他客戶的司機', async () => {
  const requestId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(requestId, state.customer, 'driver_change', '粵港', '換司機', '進行中', '辦理', now, now)
  const other = state.db.prepare('SELECT id FROM drivers WHERE customer_id=?').get(state.otherCustomer).id
  assert.equal((await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', deadlineUpdates: [{ ownerType: 'driver', ownerId: other, code: 'hk_driving_licence', expiresOn: '2030-01-01' }] })).status, 400)
  assert.equal((await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', deadlineUpdates: [{ ownerType: 'driver', ownerId: state.zhang, code: 'hk_driving_licence', expiresOn: '2030-01-01' }] })).status, 200)
  assert.equal(state.db.prepare("SELECT expires_on FROM tracked_items WHERE owner_type='driver' AND owner_id=? AND code='hk_driving_licence'").get(state.zhang).expires_on, '2030-01-01')
})

// ── 批文卡同步 ──
test('批文卡駕駛人改了之後提示不一致，不自動改登記', async () => {
  state.db.prepare('UPDATE plate_assets SET card_data=? WHERE id=?').run(card('陳大文', '新司機'), state.plateA)
  const plate = (await request(`/plates/${state.plateA}/drivers`)).body
  assert.equal(plate.mismatch, true); assert.equal(plate.drivers.length, 3)
})
test('副司機次序不同不算不一致', async () => {
  state.db.prepare('UPDATE plate_assets SET card_data=? WHERE id=?').run(card('陳大文', '王五', '李小明'), state.plateA)
  assert.equal((await request(`/plates/${state.plateA}/drivers`)).body.mismatch, false)
})
test('按同步後按批文卡更新登記', async () => {
  state.db.prepare('UPDATE plate_assets SET card_data=? WHERE id=?').run(card('陳大文', '新司機'), state.plateA)
  const result = await request(`/plates/${state.plateA}/drivers/sync-from-card`, 'POST')
  assert.equal(result.status, 200); assert.deepEqual(result.body.drivers.map(item => item.name), ['陳大文', '新司機']); assert.equal(result.body.mismatch, false)
})
test('批文卡沒有駕駛人時不可同步', async () => assert.equal((await request(`/plates/${state.plateEmpty}/drivers/sync-from-card`, 'POST')).status, 400))
test('不存在的牌照或司機回 404', async () => {
  assert.equal((await request(`/plates/${randomUUID()}/drivers`)).status, 404)
  assert.equal((await request(`/drivers/${randomUUID()}`)).status, 404)
  assert.equal((await request(`/plates/${state.plateB}/drivers`, 'PUT', { drivers: [{ driverId: randomUUID(), role: '主' }] })).status, 404)
})
