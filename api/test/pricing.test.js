// 價目表、客戶特別價與結案收費（docs/tasks/scope-items-design.md §5）
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
const now = () => new Date().toISOString()
const find = (body, code) => body.items.find(item => item.code === code)
const workOrder = (customer, serviceCode, route = '粵港') => { const id = randomUUID(); add("INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,assignee_id,created_at,updated_at) VALUES (?,?,?,?,?,'進行中','辦理',?,?,?)", id, customer, serviceCode, route, `${serviceCode} 工單`, state.staffId, now(), now()); return id }
const fees = requestId => state.db.prepare('SELECT * FROM fee_items WHERE request_id=?').all(requestId)

before(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'pricing-'))
  process.env.DB_PATH = join(state.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  state.server = (await import(`../src/server.js?pricing=${randomUUID()}`)).server
  state.db = new DatabaseSync(process.env.DB_PATH)
  state.tenant = 'default'; state.otherTenant = randomUUID()
  add('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', state.otherTenant, '其他租戶', now())
  state.customer = randomUUID(); state.foreign = randomUUID()
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.customer, '收費客戶', '個人', state.tenant)
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.foreign, '別的租戶客戶', '個人', state.otherTenant)
  state.self = state.db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get(state.tenant).id
  for (const [token, role, customerId] of [['admin', 'admin', null], ['staff', 'staff', null], ['client', 'customer', state.customer]]) {
    const userId = randomUUID()
    add('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)', userId, role, token, `${token}-${userId}@test.invalid`, 'unused', customerId, `${token}-${userId}`, state.tenant)
    add('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)', token, userId, '2099-01-01T00:00:00Z')
    state[`${token}Id`] = userId
  }
  state.company = randomUUID()
  add('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,incorporated_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', state.company, state.tenant, state.customer, '香港', '收費香港公司', '2020-01-01', now(), now())
})
after(() => { state.db?.close(); state.server?.close(); if (state.directory) rmSync(state.directory, { recursive: true, force: true }) })

test('價目表列出事項與按次業務，業務按路線分開', async () => {
  const result = await request('/price-list')
  assert.equal(result.status, 200)
  assert.deepEqual(find(result.body, 'job:vehicle_change').routes, ['粵港', '粵澳'])
  assert.deepEqual(find(result.body, 'hk_nar1').routes, [''])
  assert.deepEqual(find(result.body, 'approval').routes, ['粵港', '粵澳'])
})
test('未設定價目時業務為按次收費未定價、事項為年費內', async () => {
  const body = (await request('/price-list')).body
  assert.equal(find(body, 'job:vehicle_change').prices['粵港'].billing, 'per_time')
  assert.equal(find(body, 'job:vehicle_change').prices['粵港'].amount, null)
  assert.equal(find(body, 'hk_nar1').prices[''].billing, 'annual')
})
test('設定價目：粵港與粵澳分開', async () => {
  assert.equal((await request('/price-list', 'PUT', { code: 'job:vehicle_change', route: '粵港', billing: 'per_time', currency: 'HKD', amount: 300000 })).status, 200)
  const body = (await request('/price-list', 'PUT', { code: 'job:vehicle_change', route: '粵澳', billing: 'per_time', currency: 'MOP', amount: 280000 })).body
  assert.deepEqual([find(body, 'job:vehicle_change').prices['粵港'].amount, find(body, 'job:vehicle_change').prices['粵澳'].currency], [300000, 'MOP'])
})
test('按次收費缺金額或幣種回 400', async () => {
  for (const body of [{ code: 'job:inspection', route: '粵港', billing: 'per_time', currency: 'HKD' }, { code: 'job:inspection', route: '粵港', billing: 'per_time', currency: 'USD', amount: 100 }, { code: 'job:inspection', route: '粵港', billing: 'per_time', currency: 'HKD', amount: 0 }, { code: 'job:inspection', route: '粵港', billing: 'per_time', currency: 'HKD', amount: 1.5 }]) assert.equal((await request('/price-list', 'PUT', body)).status, 400, JSON.stringify(body))
})
test('收費方式無效、路線不適用、事項不存在回 400', async () => {
  assert.equal((await request('/price-list', 'PUT', { code: 'job:inspection', route: '粵港', billing: 'monthly' })).status, 400)
  assert.equal((await request('/price-list', 'PUT', { code: 'hk_nar1', route: '粵港', billing: 'annual' })).status, 400)
  assert.equal((await request('/price-list', 'PUT', { code: 'job:crossing_change', route: '粵澳', billing: 'annual' })).status, 400)
  assert.equal((await request('/price-list', 'PUT', { code: 'nothing', route: '', billing: 'annual' })).status, 400)
})
test('價目請求內容 null、陣列、錯誤類型回 400', async () => {
  for (const body of [null, [], { code: 3, route: '', billing: 'annual' }, { code: 'hk_nar1', route: null, billing: 'annual' }, { code: 'hk_nar1', route: '', reset: 'yes' }]) assert.equal((await request('/price-list', 'PUT', body)).status, 400, JSON.stringify(body))
})
test('員工與客戶帳號讀取或修改價目回 403', async () => {
  for (const token of ['staff', 'client']) {
    assert.equal((await request('/price-list', 'GET', undefined, token)).status, 403)
    assert.equal((await request('/price-list', 'PUT', { code: 'hk_nar1', route: '', billing: 'free' }, token)).status, 403)
    assert.equal((await request(`/customers/${state.customer}/prices`, 'GET', undefined, token)).status, 403)
  }
})
test('客戶特別價覆蓋預設價', async () => {
  const body = (await request(`/customers/${state.customer}/prices`, 'PUT', { code: 'job:vehicle_change', route: '粵港', billing: 'per_time', currency: 'HKD', amount: 250000 })).body
  assert.deepEqual([find(body, 'job:vehicle_change').prices['粵港'].amount, find(body, 'job:vehicle_change').prices['粵港'].source], [250000, 'customer'])
  assert.equal(find(body, 'job:vehicle_change').prices['粵澳'].source, 'tenant')
})
test('客戶特別價可恢復預設', async () => {
  await request(`/customers/${state.customer}/prices`, 'PUT', { code: 'hk_nar1', route: '', billing: 'per_time', currency: 'HKD', amount: 50000 })
  const body = (await request(`/customers/${state.customer}/prices`, 'PUT', { code: 'hk_nar1', route: '', reset: true })).body
  assert.deepEqual([find(body, 'hk_nar1').prices[''].billing, find(body, 'hk_nar1').prices[''].source], ['annual', 'default'])
})
test('自有客戶不設收費', async () => {
  assert.equal((await request(`/customers/${state.self}/prices`, 'PUT', { code: 'job:renewal', route: '粵港', billing: 'free' })).status, 400)
})
test('不在客戶清單的事項不可設特別價，也不列出', async () => {
  const other = randomUUID()
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', other, '清單客戶', '個人', state.tenant)
  assert.equal((await request(`/customers/${other}/items`, 'PUT', { remove: ['hk_br'], dryRun: false })).status, 200)
  assert.equal((await request(`/customers/${other}/prices`, 'PUT', { code: 'hk_br', route: '', billing: 'free' })).status, 400)
  assert.equal(find((await request(`/customers/${other}/prices`)).body, 'hk_br'), undefined)
})
test('別的租戶客戶的收費回 404', async () => {
  assert.equal((await request(`/customers/${state.foreign}/prices`)).status, 404)
  assert.equal((await request(`/customers/${state.foreign}/prices`, 'PUT', { code: 'job:renewal', route: '粵港', billing: 'free' })).status, 404)
})
test('工單結案預填：按次收費帶入客戶價', async () => {
  const id = workOrder(state.customer, 'vehicle_change')
  const detail = (await request(`/requests/${id}`)).body
  assert.equal(detail.feeBasis, 'price')
  assert.deepEqual([detail.expectedFees[0].amount, detail.expectedFees[0].currency], [250000, 'HKD'])
})
test('工單結案預填：年費內不預填', async () => {
  await request('/price-list', 'PUT', { code: 'job:filing', route: '粵港', billing: 'annual' })
  const detail = (await request(`/requests/${workOrder(state.customer, 'filing')}`)).body
  assert.deepEqual([detail.feeBasis, detail.expectedFees.length], ['annual', 0])
})
test('員工看不到結案收費預填', async () => {
  const detail = (await request(`/requests/${workOrder(state.customer, 'vehicle_change')}`, 'GET', undefined, 'staff')).body
  assert.equal(detail.expectedFees, undefined)
  assert.equal(detail.feeBasis, undefined)
})
test('員工結案按次收費工單，自動產生一筆未收收費', async () => {
  const id = workOrder(state.customer, 'vehicle_change')
  assert.equal((await request(`/requests/${id}`, 'PATCH', { status: '已完成' }, 'staff')).status, 200)
  const rows = fees(id)
  assert.deepEqual([rows.length, rows[0]?.amount, rows[0]?.notes], [1, 250000, '員工結案自動產生，請核對'])
})
test('員工結案後改回進行中再結案，不重複產生收費', async () => {
  const id = workOrder(state.customer, 'vehicle_change')
  for (const status of ['已完成', '進行中', '已完成']) assert.equal((await request(`/requests/${id}`, 'PATCH', { status }, 'staff')).status, 200)
  assert.equal(fees(id).length, 1)
})
test('員工結案年費內工單不產生收費', async () => {
  const id = workOrder(state.customer, 'filing')
  assert.equal((await request(`/requests/${id}`, 'PATCH', { status: '已完成' }, 'staff')).status, 200)
  assert.equal(fees(id).length, 0)
})
test('員工結案自有客戶工單不產生收費', async () => {
  const id = workOrder(state.self, 'vehicle_change')
  assert.equal((await request(`/requests/${id}`, 'PATCH', { status: '已完成' }, 'staff')).status, 200)
  assert.equal(fees(id).length, 0)
})
test('管理者結案略過收費時不自動產生', async () => {
  const id = workOrder(state.customer, 'vehicle_change')
  assert.equal((await request(`/requests/${id}`, 'PATCH', { status: '已完成', skipFees: true })).status, 200)
  assert.equal(fees(id).length, 0)
})
test('管理者標記按次收費事項辦好，回傳收費建議', async () => {
  await request(`/customers/${state.customer}/prices`, 'PUT', { code: 'hk_nar1', route: '', billing: 'per_time', currency: 'HKD', amount: 80000 })
  const result = await request('/rule-completions', 'POST', { ruleCode: 'hk_nar1', ownerId: state.company, period: '2026' })
  assert.equal(result.status, 200)
  assert.deepEqual([result.body.feeSuggestion?.amount, result.body.feeSuggestion?.customerId], [80000, state.customer])
})
test('員工標記按次收費事項辦好，自動記一筆未收且重複標記不重複', async () => {
  for (let index = 0; index < 2; index++) assert.equal((await request('/rule-completions', 'POST', { ruleCode: 'hk_nar1', ownerId: state.company, period: '2027' }, 'staff')).status, 200)
  const rows = state.db.prepare("SELECT * FROM fee_items WHERE customer_id=? AND notes='員工標記辦好自動產生，請核對'").all(state.customer)
  assert.deepEqual([rows.length, rows[0]?.amount], [1, 80000])
})
test('年費內事項標記辦好沒有收費建議', async () => {
  await request(`/customers/${state.customer}/prices`, 'PUT', { code: 'hk_nar1', route: '', reset: true })
  const result = await request('/rule-completions', 'POST', { ruleCode: 'hk_nar1', ownerId: state.company, period: '2028' })
  assert.equal(result.body.feeSuggestion, undefined)
})
