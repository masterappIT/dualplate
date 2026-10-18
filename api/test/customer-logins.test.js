import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 新增登入（docs/tasks/customer-lifecycle-plan.md 第 1 步）：托管客戶可開多個登入、權限相同；自管客戶暫時只可開一個
const state = {}
const PASSWORD = 'OriginalPass123', NEW_PASSWORD = 'NewAccount2026'
const SELF_LIMIT = '自管客戶目前只可開一個登入，多人登入稍後推出（收費功能）'
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-logins-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  const customers = [
    ['managed', '托管客戶', 'default', '托管'],
    ['selfOne', '自管一個登入', 'default', '自管'], ['selfDisabled', '自管停用登入', 'default', '自管'], ['selfEmpty', '自管未開登入', 'default', '自管'],
    ['selfDelete', '自管刪除後重開', 'default', '自管'], ['selfExtra', '轉自管多登入', 'default', '自管'], ['managedWarn', '托管多登入', 'default', '托管'],
    ['closed', '已注銷客戶', 'default', '自管'], ['foreign', '外租戶客戶', 'other', '托管']
  ]
  for (const [key, name, tenant, mode] of customers) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(state[key], name, '個人', tenant, mode)
  }
  state.self = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get('default')?.id
  if (!state.self) { state.self = randomUUID(); db.prepare('INSERT INTO customers(id,name,kind,tenant_id,is_self) VALUES (?,?,?,?,1)').run(state.self, '本公司', '公司', 'default') }
  const users = [
    ['admin', 'admin', null, 'default', 'boss', null, 1], ['staff', 'staff', null, 'default', 'clerk', null, 1], ['foreign-admin', 'admin', null, 'other', 'otherboss', null, 1],
    ['managed-first', 'customer', state.managed, 'default', null, '+85261000001', 1],
    ['self-one', 'customer', state.selfOne, 'default', null, '+85261000002', 1],
    ['self-disabled', 'customer', state.selfDisabled, 'default', null, '+85261000003', 0],
    ['self-delete', 'customer', state.selfDelete, 'default', null, '+85261000004', 1],
    ['self-extra-1', 'customer', state.selfExtra, 'default', null, '+85261000005', 1], ['self-extra-2', 'customer', state.selfExtra, 'default', null, '+85261000006', 1],
    ['managed-warn-1', 'customer', state.managedWarn, 'default', null, '+85261000007', 1], ['managed-warn-2', 'customer', state.managedWarn, 'default', null, '+85261000008', 1]
  ]
  for (const [token, role, customer, tenant, username, phone, active] of users) {
    const uid = randomUUID()
    state[`${token}Id`] = uid
    const email = phone ? `${phone}@phone.invalid` : `${token}@test.invalid`
    db.prepare('INSERT INTO users(id,role,name,email,phone,password_hash,customer_id,tenant_id,username,active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(uid, role, token, email, phone, hashPassword(PASSWORD), customer, tenant, username, active)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  // closed_on 欄位由 account-closure.js 在載入時加上
  db.prepare('UPDATE customers SET closed_on=? WHERE id=?').run('2026-10-01', state.closed)
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

let ipCounter = 0
function request(path, method = 'GET', body, token = 'admin', raw) {
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': `10.78.0.${++ipCounter % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
let phoneCounter = 100
const nextPhone = () => `+85262000${String(++phoneCounter).padStart(3, '0')}`
const open = (customerId, extra = {}, token = 'admin') => request('/customer-users', 'POST', { customerId, name: '新登入', phone: nextPhone(), password: NEW_PASSWORD, ...extra }, token)
const login = (value, password) => request('/login', 'POST', { login: value, password }, '')
const loginsOf = customerId => state.db.prepare("SELECT COUNT(*) count FROM users WHERE customer_id=? AND role='customer'").get(customerId).count
const warningKinds = async customerId => (await request(`/customers/${customerId}/service-mode`)).body.warnings.map(item => item.kind)

// ── 托管客戶：多個登入 ──
test('托管客戶開第二個登入', async () => {
  const phone = nextPhone()
  const r = await open(state.managed, { phone, name: '助手' })
  assert.equal(r.status, 201)
  assert.equal(loginsOf(state.managed), 2)
  state.managedSecondPhone = phone
})
test('托管客戶開第三個登入（用電郵）', async () => {
  const r = await open(state.managed, { phone: undefined, email: 'Third@Example.com', name: '同事' })
  assert.equal(r.status, 201)
  assert.equal(state.db.prepare('SELECT email FROM users WHERE id=?').get(r.body.id).email, 'third@example.com')
  assert.equal(loginsOf(state.managed), 3)
})
test('托管客戶新開的登入都能登入，並屬於同一位客戶', async () => {
  const second = await login(state.managedSecondPhone, NEW_PASSWORD)
  const third = await login('third@example.com', NEW_PASSWORD)
  assert.equal(second.status, 200); assert.equal(third.status, 200)
  assert.equal(second.body.user.customer_id ?? second.body.user.customerId, state.managed)
  assert.equal(third.body.user.customer_id ?? third.body.user.customerId, state.managed)
})
test('托管客戶多個登入不產生提示', async () => { assert.ok(!(await warningKinds(state.managedWarn)).includes('extra_logins')) })

// ── 自管客戶：暫時只可一個登入 ──
test('自管客戶已有一個登入，再開被拒並說明是收費功能', async () => {
  const r = await open(state.selfOne)
  assert.equal(r.status, 409); assert.equal(r.body.error, SELF_LIMIT)
  assert.equal(loginsOf(state.selfOne), 1)
})
test('自管客戶唯一的登入已停用，仍不能再開', async () => {
  const r = await open(state.selfDisabled)
  assert.equal(r.status, 409); assert.equal(r.body.error, SELF_LIMIT)
})
test('自管客戶還沒有登入，可以開第一個', async () => {
  assert.equal((await open(state.selfEmpty)).status, 201)
  assert.equal(loginsOf(state.selfEmpty), 1)
})
test('自管客戶開了第一個後，第二個被拒', async () => { assert.equal((await open(state.selfEmpty)).status, 409) })
test('自管客戶刪除唯一的登入後，可以重新開', async () => {
  assert.equal((await request(`/customer-users/${state['self-deleteId']}`, 'DELETE')).status, 200)
  assert.equal((await open(state.selfDelete)).status, 201)
})
test('由托管轉自管、已有兩個登入：現有登入照常可用', async () => {
  assert.equal((await login('+85261000005', PASSWORD)).status, 200)
  assert.equal((await login('+85261000006', PASSWORD)).status, 200)
})
test('由托管轉自管、已有兩個登入：不能再開', async () => { assert.equal((await open(state.selfExtra)).status, 409) })
test('由托管轉自管、已有兩個登入：客戶頁提示多出的登入', async () => {
  const view = (await request(`/customers/${state.selfExtra}/service-mode`)).body
  const warning = view.warnings.find(item => item.kind === 'extra_logins')
  assert.ok(warning)
  assert.match(warning.text, /有 2 個登入/)
})
test('自管客戶只有一個登入時沒有多登入提示', async () => { assert.ok(!(await warningKinds(state.selfOne)).includes('extra_logins')) })

// ── 不適用的客戶 ──
test('自有客戶不開登入', async () => { const r = await open(state.self); assert.equal(r.status, 409); assert.equal(r.body.error, '本公司（自有）不開通客戶端登入') })
test('已注銷的客戶不開登入', async () => { const r = await open(state.closed); assert.equal(r.status, 409); assert.equal(r.body.error, '這位客戶已自行注銷，不能再開通登入') })
test('別的租戶的客戶回 404', async () => { assert.equal((await open(state.foreign)).status, 404) })
test('不存在的客戶回 404', async () => { assert.equal((await open(randomUUID())).status, 404) })

// ── 權限 ──
test('員工不能開登入', async () => { assert.equal((await open(state.managed, {}, 'staff')).status, 403) })
test('客戶不能替自己開登入', async () => { assert.equal((await open(state.managed, {}, 'managed-first')).status, 403) })
test('未登入不能開登入', async () => { assert.equal((await open(state.managed, {}, '')).status, 401) })
test('別的租戶的管理者不能替本租戶客戶開登入', async () => { assert.equal((await open(state.managed, {}, 'foreign-admin')).status, 404) })

// ── 重複 ──
test('手機已被其他登入使用', async () => { const r = await open(state.managed, { phone: '+85261000001' }); assert.equal(r.status, 409); assert.equal(r.body.error, '這個手機號碼已被使用') })
test('電郵已被其他登入使用（不分大小寫、前後空格）', async () => { const r = await open(state.managed, { phone: undefined, email: '  THIRD@example.com ' }); assert.equal(r.status, 409); assert.equal(r.body.error, '這個電郵已被使用') })

// ── 內容格式 ──
test('null 請求內容被拒', async () => { assert.equal((await request('/customer-users', 'POST', undefined, 'admin', 'null')).status, 400) })
test('陣列請求內容被拒', async () => { assert.equal((await request('/customer-users', 'POST', [])).status, 400) })
test('空白姓名被拒', async () => { assert.equal((await open(state.managed, { name: '   ' })).status, 400) })
test('姓名類型錯誤被拒', async () => { assert.equal((await open(state.managed, { name: 5 })).status, 400) })
test('客戶 ID 類型錯誤被拒', async () => { assert.equal((await open([state.managed])).status, 400) })
test('電郵和手機都沒有被拒', async () => { assert.equal((await open(state.managed, { phone: '', email: '' })).status, 400) })
test('有手機但電郵類型錯誤被拒，不會把數字存成電郵', async () => {
  const before = loginsOf(state.managed)
  const r = await open(state.managed, { email: 12345 })
  assert.equal(r.status, 400); assert.equal(loginsOf(state.managed), before)
})
test('手機類型錯誤被拒', async () => { assert.equal((await open(state.managed, { phone: 85262000999, email: 'typed@example.com' })).status, 400) })
test('電郵格式錯誤被拒', async () => { const r = await open(state.managed, { phone: undefined, email: 'not-an-email' }); assert.equal(r.status, 400); assert.equal(r.body.error, '電郵格式無效') })
test('內部保留的電郵格式被拒', async () => { assert.equal((await open(state.managed, { phone: undefined, email: '+85269990000@phone.invalid' })).status, 400) })
test('沒有區號的手機被拒', async () => { assert.equal((await open(state.managed, { phone: '62000999' })).status, 400) })
test('密碼太弱被拒', async () => { assert.equal((await open(state.managed, { password: '123' })).status, 400) })
