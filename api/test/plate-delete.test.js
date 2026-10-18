import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管客戶刪除建錯的牌照（docs/tasks/self-managed-fixes-plan.md 第 13 步）：即時刪除牌照及附屬資料；
// 只屬於這個牌照的公司可選一併刪除；共用的公司和司機、車輛保留；托管客戶不能刪除；有未完成委託不能刪除
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'plate-delete-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', stamp())
  for (const [token, role] of [['admin', 'admin'], ['staff', 'staff']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('DeletePass123'), 'default', token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.71.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const count = (sql, ...params) => state.db.prepare(sql).get(...params).count
const remove = (ids, body = { companyIds: [ids.hkCompany, ids.mlCompany] }) => request(`/my/plates/${ids.plate}/delete`, 'POST', body, ids.token)
const preview = ids => request(`/my/plates/${ids.plate}/delete`, 'GET', undefined, ids.token)

// 一位客戶：一個牌照（批文卡正本、口岸、司機登記、出租、自行辦理、到期事項、改動記錄、通知、已完成委託和收費）、
// 同組的香港和內地公司、車輛。可選：同組第二個牌照、托管、未完成委託、別的牌照共用的司機、填過證件日期的司機
function seed({ mode = '自管', tenant = 'default', secondPlate = false, openJob = false } = {}) {
  const { db, hashPassword } = state, t = stamp(), n = ++seq
  const ids = { customer: randomUUID(), user: randomUUID(), token: `client-${n}`, plate: randomUUID(), plate2: randomUUID(), vehicle: randomUUID(), group: randomUUID(), hkCompany: randomUUID(), mlCompany: randomUUID(),
    driver: randomUUID(), sharedDriver: randomUUID(), datedDriver: randomUUID(), contract: randomUUID(), selfHandled: randomUUID(), doneJob: randomUUID(), openJob: randomUUID(), fee: randomUUID() }
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(ids.customer, `客戶${n}`, '個人', tenant, mode)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `client${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, tenant)
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', t)
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(ids.vehicle, ids.customer, '粵港', '香港', '私家車', 'AB1234')
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(ids.group, tenant, ids.customer, '組一', t)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.hkCompany, tenant, ids.customer, ids.group, '香港', '輸錯有限公司', t, t)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.mlCompany, tenant, ids.customer, ids.group, '內地', '深圳市輸錯有限公司', t, t)
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,group_id,card_number,mainland_plate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(ids.plate, ids.customer, '粵港', ids.vehicle, ids.group, '1099999', '粵ZA123港', t, t)
  db.prepare('INSERT INTO approval_card_images(plate_asset_id,side,mime,data) VALUES (?,?,?,?)').run(ids.plate, 'front', 'image/jpeg', Buffer.from('card'))
  db.prepare('INSERT INTO plate_crossings(id,tenant_id,plate_asset_id,crossed_on,source,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.plate, '2026-10-01', 'client', t)
  for (const [driver, name] of [[ids.driver, '司機甲'], [ids.sharedDriver, '司機乙'], [ids.datedDriver, '司機丙']]) {
    db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(driver, tenant, ids.customer, name, t, t)
    db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role) VALUES (?,?,?)').run(ids.plate, driver, driver === ids.driver ? '主' : '副')
  }
  db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)').run(tenant, 'driver', ids.datedDriver, 'home_return_permit', '2028-01-01', t)
  db.prepare('INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,starts_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ids.contract, tenant, ids.plate, '租客乙', '2026-01-01', t, t)
  db.prepare('INSERT INTO rent_invoices(id,contract_id,period,due_on,amount,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), ids.contract, '2026-10', '2026-10-05', 1000, t)
  db.prepare('INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.selfHandled, tenant, ids.customer, ids.plate, 'renewal', '2026-10-01', '{}', t)
  db.prepare('INSERT INTO self_handled_files(id,record_id,mime,data,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), ids.selfHandled, 'image/png', Buffer.from('photo'), t)
  for (const [type, owner] of [['plate', ids.plate], ['company', ids.hkCompany], ['vehicle', ids.vehicle]]) db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)').run(tenant, type, owner, 'crp', '2027-01-01', t)
  db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,started_on,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, 'plate', ids.plate, 'renewal', 'client', '2026-01-01', t)
  db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,changed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 'card', ids.plate, '粵ZA123港', 'created', '新建批文卡', t)
  db.prepare('INSERT INTO notifications(id,tenant_id,customer_id,kind,title,link,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 'deadline', 'CRP 快到期', `/pages/plate-detail/plate-detail?id=${ids.plate}`, t)
  db.prepare('INSERT INTO notifications(id,tenant_id,customer_id,kind,title,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 'message', '其他通知', t)
  const job = (id, status) => db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,plate_asset_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, ids.customer, ids.vehicle, ids.plate, 'renewal', '粵港', '續期', status, status, t, t)
  job(ids.doneJob, '已完成')
  db.prepare('INSERT INTO fee_items(id,tenant_id,customer_id,kind,request_id,plate_asset_id,description,currency,amount,incurred_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(ids.fee, tenant, ids.customer, 'job', ids.doneJob, ids.plate, '續期代辦費', 'HKD', 1800, '2026-10-01', t, t)
  if (openJob) job(ids.openJob, '進行中')
  // 別的牌照：共用司機乙；secondPlate 時放在同一公司組
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,group_id,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ids.plate2, ids.customer, '粵港', secondPlate ? ids.group : null, '1088888', t, t)
  db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role) VALUES (?,?,?)').run(ids.plate2, ids.sharedDriver, '主')
  return ids
}
const exists = (table, id) => count(`SELECT COUNT(*) count FROM ${table} WHERE id=?`, id) === 1

test('先看會刪除甚麼：列出只屬於這個牌照的公司、司機和出租數量，車輛會保留', async () => {
  const ids = seed(), result = await preview(ids)
  assert.equal(result.status, 200)
  assert.equal(result.body.allowed, true)
  assert.deepEqual(result.body.companies.map(company => company.id).sort(), [ids.hkCompany, ids.mlCompany].sort())
  assert.equal(result.body.drivers, 3)
  assert.equal(result.body.rentals, 1)
  assert.equal(result.body.vehicleKept, true)
  assert.equal(result.body.cardNumber, '1099999')
})
test('刪除牌照：牌照和附屬資料全部刪除', async () => {
  const ids = seed(), result = await remove(ids)
  assert.equal(result.status, 200)
  assert.equal(exists('plate_assets', ids.plate), false)
  for (const table of ['approval_card_images', 'plate_crossings', 'self_handled']) assert.equal(count(`SELECT COUNT(*) count FROM ${table} WHERE plate_asset_id=?`, ids.plate), 0, table)
  assert.equal(count('SELECT COUNT(*) count FROM self_handled_files WHERE record_id=?', ids.selfHandled), 0)
  assert.equal(exists('rental_contracts', ids.contract), false)
  assert.equal(count('SELECT COUNT(*) count FROM rent_invoices WHERE contract_id=?', ids.contract), 0)
  assert.equal(count('SELECT COUNT(*) count FROM plate_drivers WHERE plate_asset_id=?', ids.plate), 0)
})
test('刪除牌照：到期事項、代理範圍、改動記錄和指向這個牌照的通知一併刪除，其他通知保留', async () => {
  const ids = seed()
  assert.equal((await remove(ids)).status, 200)
  for (const table of ['tracked_items', 'service_scopes']) assert.equal(count(`SELECT COUNT(*) count FROM ${table} WHERE owner_id=?`, ids.plate), 0, table)
  assert.equal(count('SELECT COUNT(*) count FROM customer_changes WHERE entity_id=?', ids.plate), 0)
  assert.equal(count('SELECT COUNT(*) count FROM notifications WHERE customer_id=?', ids.customer), 1)
})
test('刪除牌照：選定的公司和空了的公司組一併刪除', async () => {
  const ids = seed()
  assert.equal((await remove(ids)).body.companies, 2)
  assert.equal(exists('companies', ids.hkCompany), false)
  assert.equal(exists('companies', ids.mlCompany), false)
  assert.equal(exists('company_groups', ids.group), false)
  assert.equal(count('SELECT COUNT(*) count FROM tracked_items WHERE owner_id=?', ids.hkCompany), 0)
})
test('刪除牌照：客戶不選公司時公司和公司組保留', async () => {
  const ids = seed()
  assert.equal((await remove(ids, { companyIds: [] })).status, 200)
  assert.equal(exists('companies', ids.hkCompany), true)
  assert.equal(exists('companies', ids.mlCompany), true)
  assert.equal(exists('company_groups', ids.group), true)
})
test('刪除牌照：只選其中一間公司，另一間保留', async () => {
  const ids = seed()
  assert.equal((await remove(ids, { companyIds: [ids.hkCompany] })).status, 200)
  assert.equal(exists('companies', ids.hkCompany), false)
  assert.equal(exists('companies', ids.mlCompany), true)
  assert.equal(exists('company_groups', ids.group), true)
})
test('同一公司組還有其他牌照：不列出公司，也不能一併刪除', async () => {
  const ids = seed({ secondPlate: true })
  assert.deepEqual((await preview(ids)).body.companies, [])
  const result = await remove(ids, { companyIds: [ids.hkCompany] })
  assert.equal(result.status, 400)
  assert.equal(exists('plate_assets', ids.plate), true)
  assert.equal(exists('companies', ids.hkCompany), true)
})
test('刪除牌照：只屬於這個牌照的司機刪除；別的牌照共用、或填過證件日期的司機保留', async () => {
  const ids = seed()
  assert.equal((await remove(ids)).status, 200)
  assert.equal(exists('drivers', ids.driver), false)
  assert.equal(exists('drivers', ids.sharedDriver), true)
  assert.equal(count('SELECT COUNT(*) count FROM plate_drivers WHERE driver_id=?', ids.sharedDriver), 1)
  assert.equal(exists('drivers', ids.datedDriver), true)
})
test('刪除牌照：車輛保留；已完成的委託和收費記錄保留，只去掉牌照連結', async () => {
  const ids = seed()
  assert.equal((await remove(ids)).status, 200)
  assert.equal(exists('vehicles', ids.vehicle), true)
  assert.equal(count('SELECT COUNT(*) count FROM tracked_items WHERE owner_id=?', ids.vehicle), 1)
  assert.equal(state.db.prepare('SELECT plate_asset_id FROM requests WHERE id=?').get(ids.doneJob).plate_asset_id, null)
  assert.equal(state.db.prepare('SELECT plate_asset_id FROM fee_items WHERE id=?').get(ids.fee).plate_asset_id, null)
})
test('別的牌照不受影響', async () => {
  const ids = seed()
  assert.equal((await remove(ids)).status, 200)
  assert.equal(exists('plate_assets', ids.plate2), true)
})
test('托管客戶不能刪除牌照，看也不可以', async () => {
  const ids = seed({ mode: '托管' })
  assert.equal((await preview(ids)).status, 403)
  const result = await remove(ids)
  assert.equal(result.status, 403)
  assert.equal(exists('plate_assets', ids.plate), true)
})
test('有未完成的委託：可以看到原因和委託，但不能刪除', async () => {
  const ids = seed({ openJob: true })
  const look = await preview(ids)
  assert.equal(look.status, 200)
  assert.equal(look.body.allowed, false)
  assert.deepEqual(look.body.openRequests.map(row => row.id), [ids.openJob])
  const result = await remove(ids)
  assert.equal(result.status, 409)
  assert.deepEqual(result.body.openRequests.map(row => row.id), [ids.openJob])
  assert.equal(exists('plate_assets', ids.plate), true)
})
test('有由我們代收租金的出租（托管時期留下的）：不能刪除', async () => {
  const ids = seed()
  state.db.prepare("UPDATE rental_contracts SET collection_mode='代收' WHERE id=?").run(ids.contract)
  const look = await preview(ids)
  assert.equal(look.body.allowed, false)
  const result = await remove(ids)
  assert.equal(result.status, 409)
  assert.equal(exists('plate_assets', ids.plate), true)
  assert.equal(exists('rental_contracts', ids.contract), true)
})
test('不能刪除別的客戶的牌照', async () => {
  const mine = seed(), theirs = seed()
  assert.equal((await request(`/my/plates/${theirs.plate}/delete`, 'GET', undefined, mine.token)).status, 404)
  assert.equal((await request(`/my/plates/${theirs.plate}/delete`, 'POST', { companyIds: [] }, mine.token)).status, 404)
  assert.equal(exists('plate_assets', theirs.plate), true)
})
test('不能刪除別的租戶的牌照', async () => {
  const mine = seed(), theirs = seed({ tenant: 'other' })
  assert.equal((await request(`/my/plates/${theirs.plate}/delete`, 'POST', { companyIds: [] }, mine.token)).status, 404)
  assert.equal(exists('plate_assets', theirs.plate), true)
})
test('不能一併刪除別的客戶的公司', async () => {
  const mine = seed(), theirs = seed()
  assert.equal((await remove(mine, { companyIds: [theirs.hkCompany] })).status, 400)
  assert.equal(exists('companies', theirs.hkCompany), true)
  assert.equal(exists('plate_assets', mine.plate), true)
})
test('不存在的牌照回 404；同一個牌照刪除兩次，第二次回 404', async () => {
  const ids = seed()
  assert.equal((await request('/my/plates/no-such-plate/delete', 'POST', { companyIds: [] }, ids.token)).status, 404)
  assert.equal((await remove(ids)).status, 200)
  assert.equal((await remove(ids)).status, 404)
})
test('員工和管理者不能用客戶的刪除接口', async () => {
  const ids = seed()
  assert.equal((await request(`/my/plates/${ids.plate}/delete`, 'POST', { companyIds: [] }, 'admin')).status, 403)
  assert.equal((await request(`/my/plates/${ids.plate}/delete`, 'POST', { companyIds: [] }, 'staff')).status, 403)
  assert.equal(exists('plate_assets', ids.plate), true)
})
test('請求內容是 null：400，甚麼都不刪（與全站一致）', async () => {
  const ids = seed()
  assert.equal((await remove(ids, null)).status, 400)
  assert.equal(exists('plate_assets', ids.plate), true)
})
test('請求內容空白：照樣刪除牌照，公司保留', async () => {
  const ids = seed()
  assert.equal((await request(`/my/plates/${ids.plate}/delete`, 'POST', undefined, ids.token)).status, 200)
  assert.equal(exists('plate_assets', ids.plate), false)
  assert.equal(exists('companies', ids.hkCompany), true)
})
test('請求內容格式錯誤：一律 400，甚麼都不刪', async () => {
  const ids = seed()
  for (const body of [[], 'text', { companyIds: 'all' }, { companyIds: [1] }, { companyIds: [null] }, { companyIds: [ids.hkCompany], extra: true }]) {
    assert.equal((await remove(ids, body)).status, 400, JSON.stringify(body))
  }
  assert.equal(exists('plate_assets', ids.plate), true)
})
test('不支援的操作回 405', async () => {
  const ids = seed()
  assert.equal((await request(`/my/plates/${ids.plate}/delete`, 'PUT', {}, ids.token)).status, 405)
  assert.equal(exists('plate_assets', ids.plate), true)
})
