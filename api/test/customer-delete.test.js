import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 刪除空白客戶（docs/tasks/customer-lifecycle-plan.md 第 2 步）：沒有業務資料的客戶可連同登入帳號一併刪除，
// 刪除前要確認登入數目；有業務資料的不能刪
const state = {}
const PASSWORD = 'OriginalPass123'
const at = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-delete-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  state.server = (await import('../src/server.js')).server
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', at())
  for (const [key, name, tenant] of [['blank', '空白客戶', 'default'], ['twoLogins', '兩個登入客戶', 'default'], ['raced', '確認後又開登入', 'default'], ['settings', '有設定的客戶', 'default'], ['withGroup', '有公司組客戶', 'default'], ['withMessage', '有訊息客戶', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state[key], name, '個人', tenant)
  }
  state.self = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get('default')?.id
  if (!state.self) { state.self = randomUUID(); db.prepare('INSERT INTO customers(id,name,kind,tenant_id,is_self) VALUES (?,?,?,?,1)').run(state.self, '本公司', '公司', 'default') }
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), 'default', state.withGroup, '甲組', at())
  db.prepare('INSERT INTO support_messages(id,tenant_id,customer_id,from_staff,sender_name,body,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), 'default', state.withMessage, 0, '客戶', '你好', at())
  const users = [
    ['admin', 'admin', null, 'default', 'boss', null, 1], ['staff', 'staff', null, 'default', 'clerk', null, 1], ['foreign-admin', 'admin', null, 'other', 'otherboss', null, 1],
    ['two-a', 'customer', state.twoLogins, 'default', null, '+85263000001', 1], ['two-b', 'customer', state.twoLogins, 'default', null, '+85263000002', 0],
    ['raced-a', 'customer', state.raced, 'default', null, '+85263000003', 1],
    ['settings-a', 'customer', state.settings, 'default', null, '+85263000004', 1],
    ['group-a', 'customer', state.withGroup, 'default', null, '+85263000005', 1]
  ]
  for (const [token, role, customer, tenant, username, phone, active] of users) {
    const uid = randomUUID()
    state[`${token}Id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,phone,password_hash,customer_id,tenant_id,username,active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(uid, role, token, phone ? `${phone}@phone.invalid` : `${token}@test.invalid`, phone, hashPassword(PASSWORD), customer, tenant, username, active)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', at())
  }
  // 「有設定的客戶」：同意條款、微信綁定碼、委託項目、自訂價錢、模式切換、申請記錄、客戶端改動記錄、通知，都不算業務資料
  db.prepare('INSERT INTO terms_acceptances(id,tenant_id,user_id,customer_id,version,accepted_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), 'default', state['settings-aId'], state.settings, 1, at())
  db.prepare('INSERT INTO wechat_bind_codes(code,user_id,expires_at) VALUES (?,?,?)').run('BIND' + Date.now(), state['settings-aId'], '2099-01-01T00:00:00Z')
  db.prepare('INSERT INTO customer_items(customer_id,tenant_id,item_code,added_at) VALUES (?,?,?,?)').run(state.settings, 'default', 'hk_br', at())
  db.prepare('INSERT INTO customer_mode_changes(id,tenant_id,customer_id,to_mode,effective_on,changed_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), 'default', state.settings, '自管', '2026-10-01', at())
  db.prepare('INSERT INTO signup_applications(id,tenant_id,phone,name,terms_version,status,created_at,customer_id) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', '+85263000004', '有設定的客戶', 1, '已批准', at(), state.settings)
  db.prepare('INSERT INTO notifications(id,tenant_id,customer_id,kind,title,body,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), 'default', state.settings, 'notice', '通知', '內容', at())
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

let ipCounter = 0
function request(path, method = 'GET', body, token = 'admin', raw) {
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': `10.79.0.${++ipCounter % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const preview = (id, token = 'admin') => request(`/customers/${id}/deletion`, 'GET', undefined, token)
const remove = (id, body, token = 'admin', raw) => request(`/customers/${id}`, 'DELETE', body, token, raw)
const exists = (table, column, value) => Boolean(state.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(value))

// ── 刪除前預覽 ──
test('預覽：空白客戶可以刪除，沒有登入', async () => {
  const r = await preview(state.blank)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { canDelete: true, blockers: [], logins: [] })
})
test('預覽：列出會一併刪除的登入（含已停用），手機登入不顯示內部電郵', async () => {
  const r = await preview(state.twoLogins)
  assert.equal(r.body.canDelete, true)
  assert.deepEqual(r.body.logins.map(row => [row.name, row.phone, row.email, row.active]), [['two-a', '+85263000001', '', true], ['two-b', '+85263000002', '', false]])
})
test('預覽：有業務資料時不能刪除，並說明有甚麼', async () => {
  const r = await preview(state.withGroup)
  assert.equal(r.body.canDelete, false); assert.deepEqual(r.body.blockers, ['公司組'])
})
test('預覽：有訊息往來算業務資料', async () => { assert.deepEqual((await preview(state.withMessage)).body.blockers, ['訊息']) })
test('預覽：自有客戶不可刪除', async () => {
  const r = await preview(state.self)
  assert.equal(r.status, 200); assert.equal(r.body.canDelete, false); assert.equal(r.body.reason, '本公司（自有）客戶不可刪除')
})
test('預覽：員工無權限', async () => { assert.equal((await preview(state.blank, 'staff')).status, 403) })
test('預覽：客戶帳號無權限', async () => { assert.equal((await preview(state.twoLogins, 'two-a')).status, 403) })
test('預覽：別的租戶的客戶回 404', async () => { assert.equal((await preview(state.foreign)).status, 404) })
test('預覽：別的租戶的管理者看不到本租戶客戶', async () => { assert.equal((await preview(state.blank, 'foreign-admin')).status, 404) })
test('預覽：不存在的客戶回 404', async () => { assert.equal((await preview(randomUUID())).status, 404) })

// ── 連同登入刪除 ──
test('有登入的客戶未確認登入數目，不能刪除', async () => {
  const r = await remove(state.twoLogins)
  assert.equal(r.status, 409); assert.equal(r.body.error, '這位客戶有 2 個登入帳號，請確認一併刪除')
  assert.ok(exists('customers', 'id', state.twoLogins))
})
test('確認的登入數目不對，不能刪除', async () => { assert.equal((await remove(state.twoLogins, { logins: 1 })).status, 409) })
test('確認的登入數目類型錯誤，不能刪除', async () => { assert.equal((await remove(state.twoLogins, { logins: '2' })).status, 409) })
test('確認後又多開了登入，要重新確認', async () => {
  const before = (await preview(state.raced)).body.logins.length
  assert.equal((await request('/customer-users', 'POST', { customerId: state.raced, name: '後來的', phone: '+85263000009', password: 'NewAccount2026' })).status, 201)
  assert.equal((await remove(state.raced, { logins: before })).status, 409)
  assert.ok(exists('customers', 'id', state.raced))
})
test('確認登入數目後，客戶和全部登入一併刪除', async () => {
  const r = await remove(state.twoLogins, { logins: 2 })
  assert.equal(r.status, 200); assert.equal(r.body.deletedLogins, 2)
  assert.ok(!exists('customers', 'id', state.twoLogins))
  assert.ok(!exists('users', 'customer_id', state.twoLogins))
})
test('刪除後原有的登入狀態失效', async () => { assert.equal((await request('/me', 'GET', undefined, 'two-a')).status, 401) })
test('刪除後不能再用原手機登入', async () => { assert.equal((await request('/login', 'POST', { login: '+85263000001', password: PASSWORD }, '')).status, 401) })
test('刪除後原手機可以給新登入使用', async () => {
  const other = randomUUID()
  state.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(other, '新客戶', '個人', 'default')
  assert.equal((await request('/customer-users', 'POST', { customerId: other, name: '新登入', phone: '+85263000001', password: 'NewAccount2026' })).status, 201)
})
test('連同刪除同意記錄、綁定碼、委託項目、模式記錄、申請記錄和通知', async () => {
  assert.equal((await remove(state.settings, { logins: 1 })).status, 200)
  assert.ok(!exists('terms_acceptances', 'user_id', state['settings-aId']))
  assert.ok(!exists('wechat_bind_codes', 'user_id', state['settings-aId']))
  assert.ok(!exists('sessions', 'user_id', state['settings-aId']))
  for (const table of ['customer_items', 'customer_mode_changes', 'signup_applications', 'notifications']) assert.ok(!exists(table, 'customer_id', state.settings), table)
})
test('空白客戶沒有登入時不用確認，直接刪除', async () => {
  const r = await remove(state.blank)
  assert.equal(r.status, 200); assert.equal(r.body.deletedLogins, 0)
})
test('重複刪除同一客戶回 404', async () => { assert.equal((await remove(state.blank)).status, 404) })

// ── 不能刪除的情況 ──
test('有業務資料的客戶即使確認登入也不能刪除', async () => {
  const r = await remove(state.withGroup, { logins: 1 })
  assert.equal(r.status, 409); assert.equal(r.body.error, '客戶名下仍有公司組，不能刪除')
  assert.ok(exists('users', 'id', state['group-aId']))
})
test('有訊息往來的客戶不能刪除', async () => { const r = await remove(state.withMessage); assert.equal(r.status, 409); assert.equal(r.body.error, '客戶名下仍有訊息，不能刪除') })
test('自有客戶不能刪除', async () => { assert.equal((await remove(state.self)).status, 409) })
test('員工不能刪除客戶', async () => { assert.equal((await remove(state.raced, { logins: 2 }, 'staff')).status, 403) })
test('客戶帳號不能刪除客戶', async () => { assert.equal((await remove(state.raced, { logins: 2 }, 'raced-a')).status, 403) })
test('別的租戶的客戶回 404', async () => { assert.equal((await remove(state.foreign)).status, 404) })
test('不存在的客戶回 404', async () => { assert.equal((await remove(randomUUID())).status, 404) })
test('null 請求內容被拒', async () => { assert.equal((await remove(state.raced, undefined, 'admin', 'null')).status, 400); assert.ok(exists('customers', 'id', state.raced)) })
test('陣列請求內容被拒', async () => { assert.equal((await remove(state.raced, [2])).status, 400); assert.ok(exists('customers', 'id', state.raced)) })
