import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const state = {}
const request = (path, method = 'GET', body, token = 'admin') => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    state.server.emit('request', incoming, outgoing)
  })
}
const add = (sql, ...values) => state.db.prepare(sql).run(...values)

before(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'entrustment-'))
  process.env.DB_PATH = join(state.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const imported = await import(`../src/server.js?entrustment=${randomUUID()}`)
  state.server = imported.server
  state.db = new DatabaseSync(process.env.DB_PATH)
  state.tenant = 'default'
  state.otherTenant = randomUUID()
  state.customer = randomUUID(); state.otherCustomer = randomUUID(); state.foreignCustomer = randomUUID(); state.selfCustomer = state.db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get(state.tenant).id; state.selfPlate = randomUUID()
  add('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', state.otherTenant, '其他租戶', new Date().toISOString())
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.customer, '委託客戶', '公司', state.tenant)
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.otherCustomer, '其他客戶', '公司', state.tenant)
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.foreignCustomer, '別的租戶客戶', '公司', state.otherTenant)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, state.tenant], ['staff', 'staff', null, state.tenant], ['client', 'customer', state.customer, state.tenant], ['foreign-admin', 'admin', null, state.otherTenant]]) {
    const userId = randomUUID()
    add('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)', userId, role, token, `${token}-${userId}@test.invalid`, 'unused', customerId, `${token}-${userId}`, tenant)
    add('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)', token, userId, '2099-01-01T00:00:00Z')
    state[`${token}Id`] = userId
  }
  state.group = randomUUID(); state.hkCompany = randomUUID(); state.cnCompany = randomUUID(); state.vehicle = randomUUID(); state.plate = randomUUID(); state.siblingPlate = randomUUID(); state.foreignPlate = randomUUID()
  const now = new Date().toISOString()
  add('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)', state.group, state.tenant, state.customer, '公司組', now)
  add('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', state.hkCompany, state.tenant, state.customer, state.group, '香港', '香港公司', now, now)
  add('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', state.cnCompany, state.tenant, state.customer, state.group, '內地', '內地公司', now, now)
  add('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)', state.vehicle, state.customer, '粵港', '香港', '私家車', '粵Z·TEST')
  for (const [id, customer, groupId] of [[state.plate, state.customer, state.group], [state.siblingPlate, state.customer, state.group], [state.foreignPlate, state.foreignCustomer, null]]) add('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,card_number,mainland_plate,local_plate,group_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, customer, '粵港', id === state.plate ? state.vehicle : null, id, '粵Z' + id.slice(0, 4), 'AB' + id.slice(0, 3), groupId, now, now)
  add('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?)', state.selfPlate, state.selfCustomer, '粵港', state.selfPlate, now, now)
})
after(() => { state.db?.close(); state.server?.close(); if (state.directory) rmSync(state.directory, { recursive: true, force: true }) })

test('委託範圍新增並回傳目前負責方', async () => {
  const result = await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hkCompany, service: 'secretary', handler: 'outsourced', providerName: '香港秘書公司', notes: '年度合約' })
  assert.equal(result.status, 200)
  assert.equal(result.body.services.find(item => item.service === 'secretary').handler, 'outsourced')
  assert.equal(result.body.services.find(item => item.service === 'secretary').providerName, '香港秘書公司')
})
test('委託範圍修改會結束舊記錄並保留歷史', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hkCompany, service: 'secretary', handler: 'us' })).status, 200)
  const result = await request('/service-scopes?ownerType=company&ownerId=' + state.hkCompany)
  assert.equal(result.status, 200)
  assert.equal(result.body.history.filter(item => item.service === 'secretary').length, 2)
  assert.equal(result.body.history.filter(item => item.service === 'secretary' && !item.endedOn).length, 1)
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM service_scopes WHERE tenant_id=? AND owner_type='company' AND owner_id=? AND service=? AND ended_on IS NULL").get(state.tenant, state.hkCompany, 'secretary').count, 1)
})
test('委託範圍不適用組合回 400', async () => {
  const result = await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.cnCompany, service: 'secretary', handler: 'us' })
  assert.equal(result.status, 400)
})
test('委託範圍外包缺少 provider_name 回 400', async () => {
  const result = await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hkCompany, service: 'secretary', handler: 'outsourced' })
  assert.equal(result.status, 400)
})
test('委託範圍 null 請求內容回 400', async () => {
  assert.equal((await request('/service-scopes', 'PUT', null)).status, 400)
})
test('委託範圍陣列請求內容回 400', async () => {
  assert.equal((await request('/service-scopes', 'PUT', [])).status, 400)
})
test('委託範圍缺少必填欄位回 400', async () => {
  assert.equal((await request('/service-scopes', 'PUT', {})).status, 400)
})
test('委託範圍欄位錯誤類型回 400', async () => {
  for (const body of [{ ownerType: [], ownerId: state.hkCompany, service: 'secretary', handler: 'us' }, { ownerType: 'company', ownerId: null, service: 'secretary', handler: 'us' }, { ownerType: 'company', ownerId: state.hkCompany, service: null, handler: 'us' }, { ownerType: 'company', ownerId: state.hkCompany, service: 'secretary', handler: [] }]) assert.equal((await request('/service-scopes', 'PUT', body)).status, 400)
})
test('委託範圍不存在對象回 404', async () => {
  assert.equal((await request('/service-scopes?ownerType=company&ownerId=' + randomUUID())).status, 404)
})
test('委託範圍別的租戶與客戶帳號越權拒絕', async () => {
  assert.equal((await request('/service-scopes?ownerType=plate&ownerId=' + state.foreignPlate)).status, 404)
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' }, 'client')).status, 403)
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' }, 'staff')).status, 403)
})
test('今日工作委託資訊的計算來源在沒有記錄時等同我們做', async () => {
  const result = await request('/overview?days=365')
  assert.equal(result.status, 200)
  const item = result.body.deadlines.find(entry => entry.ownerId === state.plate)
  assert.ok(item)
  assert.equal(item.handler, 'us')
  assert.equal(item.service, 'plate_service')
})
test('車輛規則跟隨所屬牌照的 plate_service 委託', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' })).status, 200)
  add('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)', state.tenant, 'vehicle', state.vehicle, 'local_insurance', '2027-01-01', new Date().toISOString())
  const result = await request('/overview?days=365')
  const item = result.body.deadlines.find(entry => entry.ownerId === state.vehicle && entry.ruleCode === 'local_insurance')
  assert.ok(item)
  assert.equal(item.handler, 'client')
})
test('委託範本三種結果正確', async () => {
  const cases = [['full', 'us', 'us'], ['plates_only', 'client', 'us'], ['plates_and_mainland', 'client', 'us']]
  for (const [template, companyHandler, plateHandler] of cases) {
    const preview = await request(`/customers/${state.customer}/apply-template`, 'POST', { template })
    assert.equal(preview.status, 200)
    const company = preview.body.changes.find(item => item.ownerId === state.hkCompany)
    const plate = preview.body.changes.find(item => item.ownerId === state.plate)
    assert.equal(company?.to || 'us', companyHandler)
    assert.equal(plate?.to || 'us', plateHandler)
  }
})
test('委託範本重複套用不產生多餘歷史', async () => {
  assert.equal((await request(`/customers/${state.customer}/apply-template`, 'POST', { template: 'full', dryRun: false })).status, 200)
  const first = state.db.prepare("SELECT COUNT(*) count FROM service_scopes WHERE owner_type='plate' AND owner_id=? AND service='plate_service'").get(state.plate).count
  assert.equal((await request(`/customers/${state.customer}/apply-template`, 'POST', { template: 'full', dryRun: false })).status, 200)
  const second = state.db.prepare("SELECT COUNT(*) count FROM service_scopes WHERE owner_type='plate' AND owner_id=? AND service='plate_service'").get(state.plate).count
  assert.equal(second, first)
})
test('自有客戶不可刪除、不可開通登入、不可設為客戶自理', async () => {
  assert.equal((await request(`/customers/${state.selfCustomer}`, 'DELETE')).status, 409)
  assert.equal((await request(`/customer-users`, 'POST', { customerId: state.selfCustomer, name: '自有', email: 'self@test.invalid', password: 'password123456' })).status, 409)
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.selfPlate, service: 'plate_service', handler: 'client' })).status, 400)
})
test('每個租戶最多建立一個自有客戶', async () => {
  const { ensureSelfCustomer } = await import('../src/db.js')
  ensureSelfCustomer(state.tenant)
  ensureSelfCustomer(state.otherTenant)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM customers WHERE tenant_id=? AND is_self=1').get(state.tenant).count, 1)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM customers WHERE tenant_id=? AND is_self=1').get(state.otherTenant).count, 1)
})
test('牌照轉讓同公司組有其他牌照時回 409 並列出 otherPlates', async () => {
  const result = await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.otherCustomer, transferredOn: '2026-10-16' })
  assert.equal(result.status, 409)
  assert.equal(result.body.otherPlates[0].id, state.siblingPlate)
})
test('牌照轉讓 includePlateIds 整組成功並搬移車輛公司組及公司', async () => {
  const result = await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.otherCustomer, transferredOn: '2026-10-16', includePlateIds: [state.siblingPlate] })
  assert.equal(result.status, 200)
  assert.deepEqual(new Set(result.body.transferred), new Set([state.plate, state.siblingPlate]))
  assert.equal(state.db.prepare('SELECT customer_id FROM plate_assets WHERE id=?').get(state.plate).customer_id, state.otherCustomer)
  assert.equal(state.db.prepare('SELECT customer_id FROM vehicles WHERE id=?').get(state.vehicle).customer_id, state.otherCustomer)
  assert.equal(state.db.prepare('SELECT customer_id FROM company_groups WHERE id=?').get(state.group).customer_id, state.otherCustomer)
  assert.equal(state.db.prepare('SELECT customer_id FROM companies WHERE id=?').get(state.hkCompany).customer_id, state.otherCustomer)
})
test('牌照轉讓跨租戶與轉給原客戶拒絕', async () => {
  const original = state.db.prepare('SELECT customer_id FROM plate_assets WHERE id=?').get(state.plate).customer_id
  assert.equal((await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.foreignCustomer, transferredOn: '2026-10-16' })).status, 404)
  assert.equal((await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: original, transferredOn: '2026-10-16' })).status, 400)
})
test('牌照轉讓重複提交不重複搬移', async () => {
  const result = await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.customer, transferredOn: '2026-10-16', includePlateIds: [state.siblingPlate] })
  assert.equal(result.status, 200)
  const before = state.db.prepare('SELECT COUNT(*) count FROM plate_transfers WHERE plate_asset_id=?').get(state.plate).count
  const repeat = await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.customer, transferredOn: '2026-10-16', includePlateIds: [state.siblingPlate] })
  assert.equal(repeat.status, 400)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM plate_transfers WHERE plate_asset_id=?').get(state.plate).count, before)
})
test('普通公司車輛牌照編輯不可修改 customer_id', async () => {
  const vehicleCustomer = state.db.prepare('SELECT customer_id FROM vehicles WHERE id=?').get(state.vehicle).customer_id
  const plateCustomer = state.db.prepare('SELECT customer_id FROM plate_assets WHERE id=?').get(state.plate).customer_id
  assert.equal((await request(`/companies/${state.hkCompany}`, 'PATCH', { customerId: state.otherCustomer })).status, 400)
  assert.equal((await request(`/vehicles/${state.vehicle}`, 'PATCH', { customerId: state.otherCustomer, plate: '新車牌' })).status, 200)
  assert.equal(state.db.prepare('SELECT customer_id FROM vehicles WHERE id=?').get(state.vehicle).customer_id, vehicleCustomer)
  const movedBack = await request(`/vehicles/${state.vehicle}`, 'PATCH', { customerId: state.customer, plate: '再改車牌' })
  assert.equal(movedBack.status, 200)
  assert.equal(state.db.prepare('SELECT customer_id FROM vehicles WHERE id=?').get(state.vehicle).customer_id, vehicleCustomer)
  assert.equal((await request(`/plate-assets/${state.plate}`, 'PATCH', { customerId: state.customer })).status, 200)
  assert.equal(state.db.prepare('SELECT customer_id FROM plate_assets WHERE id=?').get(state.plate).customer_id, plateCustomer)
})

test('委託範圍整批提交：全部合格才寫入', async () => {
  const before = state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count
  const bad = await request('/service-scopes/batch', 'PUT', { changes: [{ ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' }, { ownerType: 'plate', ownerId: state.plate, service: 'secretary', handler: 'us' }] })
  assert.equal(bad.status, 400)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count, before)
})
test('委託範圍整批提交：成功時一次寫入全部', async () => {
  const result = await request('/service-scopes/batch', 'PUT', { changes: [{ ownerType: 'plate', ownerId: state.plate, service: 'rental_management', handler: 'client' }] })
  assert.equal(result.status, 200)
  assert.equal(result.body.updated, 1)
})
test('委託範圍整批提交：空值、重複、別的租戶與員工被拒', async () => {
  for (const body of [null, {}, { changes: [] }, { changes: 'x' }]) assert.equal((await request('/service-scopes/batch', 'PUT', body)).status, 400)
  const dup = { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'us' }
  assert.equal((await request('/service-scopes/batch', 'PUT', { changes: [dup, dup] })).status, 400)
})
