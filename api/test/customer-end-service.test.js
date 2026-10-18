import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 結束服務、恢復服務（docs/tasks/customer-lifecycle-plan.md 第 3 步）
const state = {}
const PASSWORD = 'OriginalPass123'
const ENDED = '這位客戶已結束服務，資料只可查看；如需修改，請先恢復服務'
const at = () => new Date().toISOString()
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-end-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  state.server = (await import('../src/server.js')).server
  state.deadlineOwners = (await import('../src/deadline-owners.js')).deadlineOwners
  state.ensureAnnualFees = (await import('../src/fees.js')).ensureAnnualFees
  state.insertFee = (await import('../src/fees.js')).insertFee
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', at())
  for (const [key, name, tenant, mode] of [['ending', '結束客戶', 'default', '托管'], ['active', '照常客戶', 'default', '托管'], ['selfManaged', '自管客戶', 'default', '自管'], ['foreign', '外租戶客戶', 'other', '托管']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode,contract_ends_on) VALUES (?,?,?,?,?,?)').run(state[key], name, '個人', tenant, mode, day(10))
  }
  state.self = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get('default')?.id
  if (!state.self) { state.self = randomUUID(); db.prepare('INSERT INTO customers(id,name,kind,tenant_id,is_self) VALUES (?,?,?,?,1)').run(state.self, '本公司', '公司', 'default') }
  const users = [
    ['admin', 'admin', null, 'default', 'boss', null, 1], ['staff', 'staff', null, 'default', 'clerk', null, 1],
    ['end-a', 'customer', state.ending, 'default', null, '+85264000001', 1], ['end-b', 'customer', state.ending, 'default', null, '+85264000002', 1],
    ['end-off', 'customer', state.ending, 'default', null, '+85264000003', 0], ['active-a', 'customer', state.active, 'default', null, '+85264000004', 1]
  ]
  for (const [token, role, customer, tenant, username, phone, active] of users) {
    const uid = randomUUID()
    state[`${token}Id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,phone,password_hash,customer_id,tenant_id,username,active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(uid, role, token, phone ? `${phone}@phone.invalid` : `${token}@test.invalid`, phone, hashPassword(PASSWORD), customer, tenant, username, active)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', at())
  }
  // 結束客戶名下：一間內地公司（有未報期數）、一部車、一張未完成工單、一筆未收費用、年費設定；照常客戶也有年費設定和公司
  for (const key of ['ending', 'active']) {
    state[`${key}Company`] = randomUUID()
    db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state[`${key}Company`], 'default', state[key], '內地', `${key}公司`, at(), at())
    db.prepare('INSERT INTO customer_billing(customer_id,tenant_id,annual_amount,currency,bill_month,active,updated_at) VALUES (?,?,?,?,?,1,?)').run(state[key], 'default', 5000, 'HKD', 1, at())
  }
  state.filing = randomUUID()
  db.prepare('INSERT INTO filing_periods(id,tenant_id,company_id,period,due_on,updated_at) VALUES (?,?,?,?,?,?)').run(state.filing, 'default', state.endingCompany, '2026-09', '2026-10-15', at())
  state.vehicle = randomUUID()
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(state.vehicle, state.ending, '粵港', '香港', '私家車', 'AB1234')
  state.request = randomUUID()
  db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at,priority) VALUES (?,?,?,?,?,?,?,?,?,?)').run(state.request, state.ending, 'renewal', '粵港', '批文續期', '進行中', '準備', at(), at(), '一般')
  state.insertFee('default', { customerId: state.ending, kind: 'service', description: '代辦費', currency: 'HKD', amount: 800, dueOn: day(-3) }, null)
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

let ipCounter = 0
function request(path, method = 'GET', body, token = 'admin', raw) {
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': `10.80.0.${++ipCounter % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const preview = (id, token = 'admin') => request(`/customers/${id}/end-service`, 'GET', undefined, token)
const end = (id, body, token = 'admin', raw) => request(`/customers/${id}/end-service`, 'POST', body, token, raw)
const restore = (id, token = 'admin') => request(`/customers/${id}/restore-service`, 'POST', {}, token)
const valid = { endedOn: day(0), reason: '合約期滿不續約' }
const login = phone => request('/login', 'POST', { login: phone, password: PASSWORD }, '')
const userActive = key => state.db.prepare('SELECT active FROM users WHERE id=?').get(state[`${key}Id`]).active
const ownerCustomers = () => new Set(state.deadlineOwners('default').owners.map(owner => owner.customerId))
const contractEndingIds = async () => (await request('/service-mode/contract-endings')).body.map(row => row.customerId)

// ── 結束前預覽 ──
test('預覽列出未完成工單、未收費用和會停用的登入', async () => {
  const r = await preview(state.ending)
  assert.equal(r.status, 200); assert.equal(r.body.canEnd, true); assert.equal(r.body.ended, false)
  assert.deepEqual(r.body.openRequests.map(row => row.title), ['批文續期'])
  assert.deepEqual(r.body.unpaidFees.map(row => [row.description, row.outstanding]), [['代辦費', 800]])
  assert.deepEqual(r.body.activeLogins.sort(), ['end-a', 'end-b'])
})
test('預覽：自管客戶不適用', async () => { const r = await preview(state.selfManaged); assert.equal(r.body.canEnd, false); assert.match(r.body.problem, /自管客戶不適用/) })
test('預覽：員工無權限', async () => { assert.equal((await preview(state.ending, 'staff')).status, 403) })
test('預覽：別的租戶的客戶回 404', async () => { assert.equal((await preview(state.foreign)).status, 404) })

// ── 結束服務的內容檢查 ──
test('null 請求內容被拒', async () => { assert.equal((await end(state.ending, undefined, 'admin', 'null')).status, 400) })
test('陣列請求內容被拒', async () => { assert.equal((await end(state.ending, [valid])).status, 400) })
test('多出的欄位被拒', async () => { assert.equal((await end(state.ending, { ...valid, logins: 2 })).status, 400) })
test('沒有結束日期被拒', async () => { assert.equal((await end(state.ending, { reason: '不續約' })).status, 400) })
test('結束日期格式錯誤被拒', async () => { assert.equal((await end(state.ending, { ...valid, endedOn: '2026-02-30' })).status, 400) })
test('結束日期在將來被拒', async () => { const r = await end(state.ending, { ...valid, endedOn: day(2) }); assert.equal(r.status, 400); assert.equal(r.body.error, '結束日期不可遲於今天') })
test('空白原因被拒', async () => { assert.equal((await end(state.ending, { ...valid, reason: '   ' })).status, 400) })
test('原因類型錯誤被拒', async () => { assert.equal((await end(state.ending, { ...valid, reason: 5 })).status, 400) })
test('原因過長被拒', async () => { assert.equal((await end(state.ending, { ...valid, reason: '長'.repeat(201) })).status, 400) })
test('員工不能結束服務', async () => { assert.equal((await end(state.ending, valid, 'staff')).status, 403) })
test('客戶不能結束自己的服務', async () => { assert.equal((await end(state.ending, valid, 'end-a')).status, 403) })
test('別的租戶的客戶回 404', async () => { assert.equal((await end(state.foreign, valid)).status, 404) })
test('不存在的客戶回 404', async () => { assert.equal((await end(randomUUID(), valid)).status, 404) })
test('自有客戶不能結束服務', async () => { assert.equal((await end(state.self, valid)).status, 409) })
test('自管客戶不能結束服務', async () => { assert.equal((await end(state.selfManaged, valid)).status, 409) })
test('內容檢查失敗時客戶沒有被結束', async () => { assert.equal(state.db.prepare('SELECT ended_on FROM customers WHERE id=?').get(state.ending).ended_on, null) })

// ── 結束前：照常提醒 ──
test('結束前：到期事項、合約到期提醒照常', async () => {
  assert.ok(ownerCustomers().has(state.ending))
  assert.ok((await contractEndingIds()).includes(state.ending))
})

// ── 結束服務 ──
test('結束服務：記下日期、原因和操作人', async () => {
  const r = await end(state.ending, valid)
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.ended, r.body.endedOn, r.body.reason, r.body.endedByName], [true, valid.endedOn, '合約期滿不續約', 'admin'])
})
test('結束服務：啟用中的登入全部停用', async () => { assert.equal(userActive('end-a'), 0); assert.equal(userActive('end-b'), 0) })
test('結束服務：已登入的客戶即時登出', async () => { assert.equal((await request('/me', 'GET', undefined, 'end-a')).status, 401) })
test('結束服務：客戶用正確密碼登入時看到服務已結束', async () => {
  const r = await login('+85264000001')
  assert.equal(r.status, 403); assert.equal(r.body.ended, true)
  assert.match(r.body.error, new RegExp(`服務已於 ${valid.endedOn} 結束`))
})
test('結束服務：密碼錯誤時不透露服務已結束', async () => {
  const r = await request('/login', 'POST', { login: '+85264000002', password: 'WrongPass12345' }, '')
  assert.equal(r.status, 401); assert.equal(r.body.ended, undefined)
})
test('結束服務：不再有到期提醒', async () => { assert.ok(!ownerCustomers().has(state.ending)); assert.ok(ownerCustomers().has(state.active)) })
test('結束服務：不出現在合約到期提醒', async () => { const ids = await contractEndingIds(); assert.ok(!ids.includes(state.ending)); assert.ok(ids.includes(state.active)) })
test('結束服務：今日工作不列這位客戶的事項', async () => {
  const r = await request('/overview?days=365')
  assert.equal(r.status, 200); assert.ok(!r.body.deadlines.some(item => item.customerId === state.ending))
})
test('結束服務：未報的報帳期數不再跟進', async () => {
  assert.equal(state.db.prepare('SELECT closed_reason FROM filing_periods WHERE id=?').get(state.filing).closed_reason, 'service_ended')
  const r = await request(`/filings?customerId=${state.ending}`)
  if (r.status === 200 && Array.isArray(r.body)) assert.ok(r.body.filter(row => row.id === state.filing).every(row => row.status === '客戶已結束服務'))
})
test('結束服務：不再產生年費，照常客戶仍會產生', async () => {
  state.ensureAnnualFees('default')
  const annual = id => state.db.prepare("SELECT COUNT(*) count FROM fee_items WHERE customer_id=? AND kind='annual'").get(id).count
  assert.equal(annual(state.ending), 0); assert.equal(annual(state.active), 1)
})
test('結束服務：不能重複結束', async () => { const r = await end(state.ending, valid); assert.equal(r.status, 409); assert.equal(r.body.error, '這位客戶已結束服務') })

// ── 結束後只可查看 ──
test('結束後可以查看客戶的登入', async () => { assert.equal((await request(`/customers/${state.ending}/users`)).status, 200) })
test('結束後可以查看車輛', async () => { assert.equal((await request(`/vehicles/${state.vehicle}`)).status, 200) })
test('結束後不能修改客戶資料', async () => { const r = await request(`/customers/${state.ending}`, 'PATCH', { name: '改名' }); assert.equal(r.status, 409); assert.equal(r.body.error, ENDED) })
test('結束後不能新增登入', async () => { const r = await request('/customer-users', 'POST', { customerId: state.ending, name: '新', phone: '+85264000009', password: 'NewAccount2026' }); assert.equal(r.status, 409); assert.equal(r.body.error, ENDED) })
test('結束後不能重新啟用登入', async () => { assert.equal((await request(`/customer-users/${state['end-aId']}`, 'PATCH', { active: true })).status, 409); assert.equal(userActive('end-a'), 0) })
test('結束後不能重設登入密碼', async () => { assert.equal((await request(`/customer-users/${state['end-aId']}/reset-password`, 'POST', { password: 'Another2026xx' })).status, 409) })
test('結束後不能新增車輛', async () => { assert.equal((await request('/vehicles', 'POST', { customerId: state.ending, route: '粵港', origin: '香港', type: '私家車', plate: 'CD5678' })).status, 409) })
test('結束後不能修改車輛', async () => { assert.equal((await request(`/vehicles/${state.vehicle}`, 'PATCH', { plate: 'XY9999' })).status, 409) })
test('結束後不能修改公司', async () => { assert.equal((await request(`/companies/${state.endingCompany}`, 'PATCH', { name: '改名公司' })).status, 409) })
test('結束後不能新增公司組', async () => { assert.equal((await request('/company-groups', 'POST', { customerId: state.ending, name: '新組' })).status, 409) })
test('結束後不能新增司機', async () => { assert.equal((await request('/drivers', 'POST', { customerId: state.ending, name: '司機甲' })).status, 409) })
test('結束後不能開新工單', async () => { assert.equal((await request('/work-orders', 'POST', { customerId: state.ending, serviceCode: 'renewal', route: '粵港' })).status, 409) })
test('結束後不能切換自管或托管', async () => { assert.equal((await request(`/customers/${state.ending}/service-mode`, 'PUT', { mode: '自管' })).status, 409) })
test('結束後員工也不能修改', async () => { assert.equal((await request(`/vehicles/${state.vehicle}`, 'PATCH', { plate: 'XY9999' }, 'staff')).status, 409) })
test('結束後仍可記錄收費（結清用）', async () => {
  const r = await request('/fees', 'POST', { customerId: state.ending, kind: 'other', description: '結算費', currency: 'HKD', amount: 100 })
  assert.notEqual(r.body?.error, ENDED)
})
test('照常客戶不受影響', async () => { assert.equal((await request(`/customers/${state.active}`, 'PATCH', { name: '照常客戶（改）' })).status, 200) })
test('結束後的客戶沒有業務資料以外的東西時仍走刪除檢查', async () => {
  const r = await request(`/customers/${state.ending}`, 'DELETE', { logins: 3 })
  assert.equal(r.status, 409); assert.match(r.body.error, /客戶名下仍有/)
})

// ── 恢復服務 ──
test('員工不能恢復服務', async () => { assert.equal((await restore(state.ending, 'staff')).status, 403) })
test('沒有結束服務的客戶不能恢復', async () => { assert.equal((await restore(state.active)).status, 409) })
test('別的租戶的客戶不能恢復', async () => { assert.equal((await restore(state.foreign)).status, 404) })
test('恢復服務：只重新啟用結束時被停用的登入', async () => {
  const r = await restore(state.ending)
  assert.equal(r.status, 200); assert.equal(r.body.ended, false); assert.equal(r.body.restoredLogins, 2)
  assert.equal(userActive('end-a'), 1); assert.equal(userActive('end-b'), 1); assert.equal(userActive('end-off'), 0)
})
test('恢復服務：客戶可以再登入', async () => { assert.equal((await login('+85264000001')).status, 200) })
test('恢復服務：報帳期數重新跟進', async () => { assert.equal(state.db.prepare('SELECT closed_reason FROM filing_periods WHERE id=?').get(state.filing).closed_reason, null) })
test('恢復服務：到期提醒回來', async () => { assert.ok(ownerCustomers().has(state.ending)); assert.ok((await contractEndingIds()).includes(state.ending)) })
test('恢復服務：可以再修改資料', async () => { assert.equal((await request(`/vehicles/${state.vehicle}`, 'PATCH', { plate: 'AB1235' })).status, 200) })
test('恢復服務：不能重複恢復', async () => { assert.equal((await restore(state.ending)).status, 409) })
test('恢復後可以再結束', async () => { assert.equal((await end(state.ending, valid)).status, 200); assert.equal(userActive('end-a'), 0) })
