import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶自行修改、後台核對（管理者 2026-10-17）
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'client-edits-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant] of [['first', '客戶甲', 'default'], ['second', '客戶乙', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['client2', 'customer', state.second, 'default'], ['foreign-client', 'customer', state.foreign, 'other'], ['foreign-admin', 'admin', null, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  state.plate = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵港', cardData: { cardNumber: 'CE-001', company: '原商號', validTo: '2027-01-31' } })).body.id
  state.otherPlate = (await request('/plate-assets', 'POST', { customerId: state.second, route: '粵港', cardData: { cardNumber: 'CE-901' } })).body.id
  state.hk = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '甲香港有限公司', nameEn: 'Jia HK Limited', incorporatedOn: '2020-05-01' })).body.id
  state.cn = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '內地', name: '深圳甲贸易有限公司' })).body.id
  state.otherCompany = (await request('/companies', 'POST', { customerId: state.second, jurisdiction: '香港', name: '乙香港有限公司', nameEn: 'Yi HK Limited' })).body.id
  state.vehicle = (await request('/vehicles', 'POST', { customerId: state.first, route: '粵港', origin: '香港', type: '私家車', plate: 'AB1234', brand: 'Toyota' })).body.id
  state.otherVehicle = (await request('/vehicles', 'POST', { customerId: state.second, route: '粵港', origin: '香港', type: '私家車', plate: 'ZZ9999' })).body.id
  state.driver = (await request('/drivers', 'POST', { customerId: state.first, name: '陳大文', phone: '91234567' })).body.id
  state.driver2 = (await request('/drivers', 'POST', { customerId: state.first, name: '李小明' })).body.id
  state.otherDriver = (await request('/drivers', 'POST', { customerId: state.second, name: '黃乙' })).body.id
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.57.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const pending = async (token = 'admin') => (await request('/customer-changes', 'GET', undefined, token)).body
const findChange = async (entityId, field) => (await pending()).find(item => item.entityId === entityId && item.field === field)
const company = id => state.db.prepare('SELECT * FROM companies WHERE id=?').get(id)
const plate = id => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(id)
const card = id => JSON.parse(plate(id).card_data)
// 十天後到期：落在提醒期內，客戶首頁會列出
const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)

// —— 記錄修改 ——
test('客戶修改批文卡後，後台清單逐欄列出改前改後', async () => {
  assert.equal((await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { cardNumber: 'CE-001', company: '新商號', validTo: '2027-01-31' } }, 'client')).status, 200)
  const change = await findChange(state.plate, 'company')
  assert.equal(change.beforeText, '原商號'); assert.equal(change.afterText, '新商號'); assert.equal(change.entityType, 'card'); assert.equal(change.customerName, '客戶甲'); assert.equal(change.changedByName, 'client')
})
test('專員修改批文卡不進待核對清單', async () => {
  assert.equal((await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { cardNumber: 'CE-001', company: '新商號', contractor: '專員填的', validTo: '2027-01-31' } })).status, 200)
  assert.equal(await findChange(state.plate, 'contractor'), undefined)
})
test('同一欄位再改只保留一筆，改前值仍是最初的值', async () => {
  await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { ...card(state.plate), color: '白' } }, 'client')
  await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { ...card(state.plate), color: '黑' } }, 'client')
  const rows = (await pending()).filter(item => item.entityId === state.plate && item.field === 'color')
  assert.equal(rows.length, 1); assert.equal(rows[0].beforeText, ''); assert.equal(rows[0].afterText, '黑')
})
test('客戶把欄位改回原值時撤銷待核對', async () => {
  await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { ...card(state.plate), seats: '5' } }, 'client')
  assert.ok(await findChange(state.plate, 'seats'))
  await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { ...card(state.plate), seats: '' } }, 'client')
  assert.equal(await findChange(state.plate, 'seats'), undefined)
})
test('日期欄位標記為日期並排在清單最前', async () => {
  await request(`/plate-assets/${state.plate}`, 'PUT', { cardData: { ...card(state.plate), validTo: '2028-01-31' } }, 'client')
  const list = await pending()
  assert.equal(list[0].isDate, true)
  assert.ok(list.find(item => item.field === 'validTo' && item.isDate))
})
test('客戶修改牌照資料記錄車牌和綁定車輛', async () => {
  const r = await request(`/plate-assets/${state.plate}`, 'PATCH', { localPlate: 'AB1234', installationStatus: '已上牌', vehicleId: state.vehicle }, 'client')
  assert.equal(r.status, 200)
  assert.equal((await findChange(state.plate, 'localPlate')).afterText, 'AB1234')
  const bound = await findChange(state.plate, 'vehicleId')
  assert.equal(bound.beforeText, '未綁定'); assert.equal(bound.afterText, 'AB1234')
})
test('客戶建檔批文卡記一筆新建檔', async () => {
  const created = await request('/plate-assets', 'POST', { customerId: state.first, route: '粵澳', cardData: { cardNumber: 'CE-NEW' } }, 'client')
  assert.equal(created.status, 201)
  const change = await findChange(created.body.id, 'created')
  assert.equal(change.created, true); assert.equal(change.afterText, '批文卡 CE-NEW')
  state.createdPlate = created.body.id
})

// —— 公司 ——
test('客戶可修改自己香港公司的名稱、英文名和成立日期', async () => {
  const r = await request(`/my/companies/${state.hk}`, 'PATCH', { name: '甲香港控股有限公司', nameEn: 'Jia HK Holdings Limited', incorporatedOn: '2020-06-01' }, 'client')
  assert.equal(r.status, 200); assert.equal(r.body.nameEn, 'Jia HK Holdings Limited')
  assert.equal(company(state.hk).incorporated_on, '2020-06-01')
  assert.equal((await findChange(state.hk, 'incorporatedOn')).isDate, true)
})
test('客戶修改公司登記號碼按司法區顯示標籤', async () => {
  assert.equal((await request(`/my/companies/${state.cn}`, 'PATCH', { registrationNo: '91440300MA5XXXXXX' }, 'client')).status, 200)
  assert.equal((await findChange(state.cn, 'registrationNo')).fieldLabel, '統一社會信用代碼')
})
test('客戶修改內地公司名稱不能用繁體字', async () => {
  const r = await request(`/my/companies/${state.cn}`, 'PATCH', { name: '深圳甲貿易有限公司' }, 'client')
  assert.equal(r.status, 400); assert.equal(r.body.suggestion, '深圳甲贸易有限公司')
})
test('客戶修改公司名稱不能留空', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { name: '  ' }, 'client')).status, 400) })
test('客戶修改香港公司英文名不能留空', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { nameEn: '' }, 'client')).status, 400) })
test('客戶修改英文名不能用中文', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { nameEn: '甲公司' }, 'client')).status, 400) })
test('內地公司不能填英文名稱', async () => { assert.equal((await request(`/my/companies/${state.cn}`, 'PATCH', { nameEn: 'Jia' }, 'client')).status, 400) })
test('香港公司不能填納稅人類型', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { taxpayerType: '一般納稅人' }, 'client')).status, 400) })
test('內地公司納稅人類型只接受兩種', async () => { assert.equal((await request(`/my/companies/${state.cn}`, 'PATCH', { taxpayerType: '大型' }, 'client')).status, 400) })
test('客戶修改成立日期拒絕無效日期', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { incorporatedOn: '2020-02-30' }, 'client')).status, 400) })
test('客戶不能修改公司狀態', async () => {
  const r = await request(`/my/companies/${state.hk}`, 'PATCH', { status: '已註銷' }, 'client')
  assert.equal(r.status, 400); assert.equal(company(state.hk).status, '存續')
})
test('客戶不能把公司搬到其他客戶', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { customerId: state.second }, 'client')).status, 400) })
test('客戶修改公司拒絕數字值', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { name: 123 }, 'client')).status, 400) })
test('客戶修改公司拒絕 null 值', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { name: null }, 'client')).status, 400) })
test('客戶修改公司拒絕空內容', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', {}, 'client')).status, 400) })
test('客戶修改公司拒絕 null 內容', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', null, 'client')).status, 400) })
test('客戶修改公司拒絕陣列內容', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', ['name'], 'client')).status, 400) })
test('客戶不能修改其他客戶的公司', async () => {
  assert.equal((await request(`/my/companies/${state.otherCompany}`, 'PATCH', { name: '越權' }, 'client')).status, 404)
  assert.equal(company(state.otherCompany).name, '乙香港有限公司')
})
test('其他租戶客戶不能修改公司', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { name: '越權' }, 'foreign-client')).status, 404) })
test('客戶修改不存在的公司回 404', async () => { assert.equal((await request(`/my/companies/${randomUUID()}`, 'PATCH', { name: '無' }, 'client')).status, 404) })
test('專員不能用客戶端修改公司接口', async () => { assert.equal((await request(`/my/companies/${state.hk}`, 'PATCH', { name: '專員' }, 'admin')).status, 403) })
test('客戶公司資料帶出編輯需要的欄位', async () => {
  const data = (await request('/my/companies', 'GET', undefined, 'client')).body
  const hk = [...data.ungrouped, ...data.groups.flatMap(group => [...group.offshore, ...group.mainland])].find(item => item.id === state.hk)
  assert.equal(hk.incorporatedOn, '2020-06-01'); assert.equal(hk.companyNumber, ''); assert.equal(hk.taxpayerType, '')
})

// —— 車輛 ——
test('客戶可修改自己車輛的品牌型號和年份', async () => {
  const r = await request(`/my/vehicles/${state.vehicle}`, 'PATCH', { brand: 'Honda', model: 'Odyssey', manufacturedYear: '2021', firstRegisteredOn: '2021-03-01' }, 'client')
  assert.equal(r.status, 200); assert.equal(r.body.brand, 'Honda'); assert.equal(r.body.manufactured_year, 2021)
  assert.equal((await findChange(state.vehicle, 'brand')).beforeText, 'Toyota')
})
test('客戶修改車牌不能留空', async () => { assert.equal((await request(`/my/vehicles/${state.vehicle}`, 'PATCH', { plate: ' ' }, 'client')).status, 400) })
test('客戶修改製造年份拒絕無效年份', async () => { assert.equal((await request(`/my/vehicles/${state.vehicle}`, 'PATCH', { manufacturedYear: '1700' }, 'client')).status, 400) })
test('客戶修改製造年份拒絕數字類型', async () => { assert.equal((await request(`/my/vehicles/${state.vehicle}`, 'PATCH', { manufacturedYear: 2020 }, 'client')).status, 400) })
test('客戶不能修改車輛路線', async () => { assert.equal((await request(`/my/vehicles/${state.vehicle}`, 'PATCH', { route: '粵澳' }, 'client')).status, 400) })
test('客戶不能修改其他客戶的車輛', async () => { assert.equal((await request(`/my/vehicles/${state.otherVehicle}`, 'PATCH', { brand: '越權' }, 'client')).status, 404) })
test('客戶修改不存在的車輛回 404', async () => { assert.equal((await request(`/my/vehicles/${randomUUID()}`, 'PATCH', { brand: 'X' }, 'client')).status, 404) })

// —— 司機 ——
test('客戶可列出自己的司機', async () => {
  const list = (await request('/my/drivers', 'GET', undefined, 'client')).body
  assert.deepEqual(list.map(item => item.name).sort(), ['李小明', '陳大文'].sort())
})
test('客戶可修改司機電話和回鄉證號碼', async () => {
  const r = await request(`/my/drivers/${state.driver}`, 'PATCH', { phone: '98765432', homeReturnPermitNo: 'H1234567' }, 'client')
  assert.equal(r.status, 200); assert.equal(r.body.phone, '98765432')
  assert.equal((await findChange(state.driver, 'phone')).beforeText, '91234567')
})
test('客戶修改司機身份證只保存遮蔽號碼', async () => {
  const r = await request(`/my/drivers/${state.driver}`, 'PATCH', { hkIdNo: 'A123456(7)' }, 'client')
  assert.equal(r.status, 200); assert.equal(r.body.hkIdNo, '******6(7)')
  assert.equal((await findChange(state.driver, 'hkIdNo')).afterText, '******6(7)')
})
test('客戶原樣送回遮蔽身份證號碼不算修改', async () => {
  await request(`/my/drivers/${state.driver}`, 'PATCH', { hkIdNo: '******6(7)' }, 'client')
  assert.equal(state.db.prepare('SELECT hk_id_no FROM drivers WHERE id=?').get(state.driver).hk_id_no, '******6(7)')
})
test('客戶修改司機拒絕無效身份證號碼', async () => { assert.equal((await request(`/my/drivers/${state.driver}`, 'PATCH', { hkIdNo: '12345' }, 'client')).status, 400) })
test('客戶修改司機拒絕無效電話', async () => { assert.equal((await request(`/my/drivers/${state.driver}`, 'PATCH', { phone: 'abc' }, 'client')).status, 400) })
test('客戶修改司機姓名不能留空', async () => { assert.equal((await request(`/my/drivers/${state.driver}`, 'PATCH', { name: '' }, 'client')).status, 400) })
test('客戶修改司機姓名不能與另一司機同名', async () => { assert.equal((await request(`/my/drivers/${state.driver}`, 'PATCH', { name: '李小明' }, 'client')).status, 409) })
test('客戶不能修改其他客戶的司機', async () => { assert.equal((await request(`/my/drivers/${state.otherDriver}`, 'PATCH', { phone: '91111111' }, 'client')).status, 404) })
test('客戶修改司機拒絕不可改欄位', async () => { assert.equal((await request(`/my/drivers/${state.driver}`, 'PATCH', { notes: '內部備註' }, 'client')).status, 400) })

// —— 到期日 ——
test('客戶可修改公司到期日並進待核對', async () => {
  const r = await request('/my/dates', 'PUT', { ownerType: 'company', ownerId: state.hk, code: 'hk_br', expiresOn: soon }, 'client')
  assert.equal(r.status, 200)
  const change = await findChange(state.hk, 'date:hk_br')
  assert.equal(change.fieldLabel, '香港商業登記證'); assert.equal(change.isDate, true); assert.equal(change.beforeText, '')
})
test('客戶修改的到期日立即用於到期提醒', async () => {
  const overview = (await request('/my/overview', 'GET', undefined, 'client')).body
  const item = overview.deadlines.find(entry => entry.ownerId === state.hk && entry.code === 'hk_br')
  assert.equal(item.dueOn, soon); assert.equal(item.editable, true)
})
test('客戶可修改司機證件到期日', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'driver', ownerId: state.driver, code: 'home_return_permit', expiresOn: '2030-01-01' }, 'client')).status, 200) })
test('客戶不能在到期日修改批文卡有效期', async () => {
  const r = await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: state.plate, code: 'approval', expiresOn: '2030-01-01' }, 'client')
  assert.equal(r.status, 400); assert.equal(r.body.error, '此日期來自批文卡，請在批文卡修改')
})
test('客戶填不存在的月份回 400 而不是出錯', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'driver', ownerId: state.driver, code: 'home_return_permit', expiresOn: '2030-13-01' }, 'client')).status, 400) })
test('規則不適用的對象不能填到期日', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'company', ownerId: state.cn, code: 'hk_br', expiresOn: '2030-01-01' }, 'client')).status, 400) })
test('客戶不能清空到期日', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'company', ownerId: state.hk, code: 'hk_br', expiresOn: '' }, 'client')).status, 400) })
test('客戶不能填其他客戶的到期日', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'company', ownerId: state.otherCompany, code: 'hk_br', expiresOn: '2030-01-01' }, 'client')).status, 404) })
test('到期日拒絕未知對象類型', async () => { assert.equal((await request('/my/dates', 'PUT', { ownerType: 'customer', ownerId: state.first, code: 'hk_br', expiresOn: '2030-01-01' }, 'client')).status, 400) })
test('到期日拒絕 null 內容', async () => { assert.equal((await request('/my/dates', 'PUT', null, 'client')).status, 400) })
test('客戶到期項目標明可否修改', async () => {
  const detail = (await request(`/my/plates/${state.plate}`, 'GET', undefined, 'client')).body
  const approval = detail.deadlines.find(item => item.code === 'approval')
  assert.equal(approval.editable, false)
  const crp = detail.deadlines.find(item => item.code === 'hk_crp')
  if (crp) assert.equal(crp.editable, true)
})

// —— 客戶端待核對標記 ——
test('客戶可看到自己哪些欄位待核對', async () => {
  const list = (await request('/my/pending', 'GET', undefined, 'client')).body
  assert.ok(list.some(item => item.entityId === state.hk && item.field === 'name'))
  assert.ok(list.every(item => item.entityId !== state.otherCompany))
})
test('其他客戶看不到別人的待核對欄位', async () => {
  const list = (await request('/my/pending', 'GET', undefined, 'client2')).body
  assert.equal(list.length, 0)
})

// —— 後台核對 ——
test('員工可查看客戶更新清單', async () => { assert.equal((await request('/customer-changes', 'GET', undefined, 'staff')).status, 200) })
test('員工不能核對客戶修改', async () => {
  const change = await findChange(state.vehicle, 'model')
  assert.equal((await request(`/customer-changes/${change.id}/accept`, 'POST', {}, 'staff')).status, 403)
})
test('客戶不能查看後台清單', async () => { assert.equal((await request('/customer-changes', 'GET', undefined, 'client')).status, 403) })
test('其他租戶看不到客戶更新', async () => { assert.equal((await pending('foreign-admin')).length, 0) })
test('其他租戶不能核對客戶修改', async () => {
  const change = await findChange(state.vehicle, 'model')
  assert.equal((await request(`/customer-changes/${change.id}/accept`, 'POST', {}, 'foreign-admin')).status, 404)
})
test('清單拒絕無效狀態篩選', async () => { assert.equal((await request('/customer-changes?status=x', 'GET')).status, 400) })
test('核對無誤後離開待核對清單', async () => {
  const change = await findChange(state.vehicle, 'model')
  const r = await request(`/customer-changes/${change.id}/accept`, 'POST', {})
  assert.equal(r.status, 200); assert.equal(r.body.status, '已核對')
  assert.equal(await findChange(state.vehicle, 'model'), undefined)
  assert.ok((await request('/customer-changes?status=已核對', 'GET')).body.some(item => item.id === change.id))
})
test('重複核對同一修改回 409', async () => {
  const done = (await request('/customer-changes?status=已核對', 'GET')).body[0]
  assert.equal((await request(`/customer-changes/${done.id}/accept`, 'POST', {})).status, 409)
})
test('核對不存在的修改回 404', async () => { assert.equal((await request(`/customer-changes/${randomUUID()}/accept`, 'POST', {})).status, 404) })
test('改回後資料恢復原值並通知客戶', async () => {
  const change = await findChange(state.vehicle, 'brand')
  const r = await request(`/customer-changes/${change.id}/revert`, 'POST', {})
  assert.equal(r.status, 200); assert.equal(r.body.status, '已改回')
  assert.equal(state.db.prepare('SELECT brand FROM vehicles WHERE id=?').get(state.vehicle).brand, 'Toyota')
  const notice = state.db.prepare("SELECT * FROM notifications WHERE customer_id=? AND kind='change_reverted'").get(state.first)
  assert.match(notice.title, /品牌/)
})
test('改回批文卡欄位同步更新牌照欄', async () => {
  const change = await findChange(state.plate, 'validTo')
  assert.equal((await request(`/customer-changes/${change.id}/revert`, 'POST', {})).status, 200)
  assert.equal(card(state.plate).validTo, '2027-01-31'); assert.equal(plate(state.plate).card_expires_on, '2027-01-31')
})
test('改回公司到期日恢復原值', async () => {
  const change = await findChange(state.hk, 'date:hk_br')
  assert.equal((await request(`/customer-changes/${change.id}/revert`, 'POST', {})).status, 200)
  assert.equal(state.db.prepare("SELECT expires_on FROM tracked_items WHERE owner_id=? AND code='hk_br'").get(state.hk).expires_on, null)
})
test('欄位之後又被改過時不能改回', async () => {
  const change = await findChange(state.hk, 'name')
  assert.equal((await request(`/companies/${state.hk}`, 'PATCH', { name: '專員改的名稱' })).status, 200)
  const r = await request(`/customer-changes/${change.id}/revert`, 'POST', {})
  assert.equal(r.status, 409); assert.equal(company(state.hk).name, '專員改的名稱')
})
test('改回會造成上牌狀態與車輛不一致時拒絕', async () => {
  const change = await findChange(state.plate, 'vehicleId')
  const r = await request(`/customer-changes/${change.id}/revert`, 'POST', {})
  assert.equal(r.status, 409); assert.equal(plate(state.plate).vehicle_id, state.vehicle)
})
test('新建批文卡不能改回', async () => {
  const change = await findChange(state.createdPlate, 'created')
  assert.equal((await request(`/customer-changes/${change.id}/revert`, 'POST', {})).status, 400)
})
test('核對完批文卡全部修改後批文卡變已核對', async () => {
  const ids = (await pending()).filter(item => item.entityType === 'card' && item.entityId === state.plate).map(item => item.id)
  assert.ok(ids.length)
  const r = await request('/customer-changes/accept-batch', 'POST', { ids })
  assert.equal(r.status, 200); assert.equal(r.body.accepted, ids.length)
  assert.equal(plate(state.plate).card_status, '已核對')
})
test('整批核對拒絕空清單', async () => { assert.equal((await request('/customer-changes/accept-batch', 'POST', { ids: [] })).status, 400) })
test('整批核對拒絕非陣列', async () => { assert.equal((await request('/customer-changes/accept-batch', 'POST', { ids: 'x' })).status, 400) })
test('整批核對拒絕重複 ID', async () => {
  const change = (await pending())[0]
  assert.equal((await request('/customer-changes/accept-batch', 'POST', { ids: [change.id, change.id] })).status, 400)
})
test('整批核對有不存在的 ID 時整批不處理', async () => {
  const change = (await pending())[0]
  assert.equal((await request('/customer-changes/accept-batch', 'POST', { ids: [change.id, randomUUID()] })).status, 404)
  assert.ok(await findChange(change.entityId, change.field))
})
test('整批核對包含已處理的修改時回 409', async () => {
  const done = (await request('/customer-changes?status=已核對', 'GET')).body[0], open = (await pending())[0]
  assert.equal((await request('/customer-changes/accept-batch', 'POST', { ids: [open.id, done.id] })).status, 409)
})
