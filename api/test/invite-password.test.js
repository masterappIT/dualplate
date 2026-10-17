import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID, randomBytes } from 'node:crypto'

// 自管第一期第 2 步（docs/tasks/self-managed-phase1-plan.md）：管理員新增自管客戶（來源：邀請）；管理者查看客戶密碼（加密副本，每次查看有記錄）
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'invite-password-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  delete process.env.PASSWORD_VIEW_KEY
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  state.legacyCustomer = randomUUID(); state.foreignCustomer = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.legacyCustomer, '舊客戶', '個人', 'default')
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.foreignCustomer, '外租戶客戶', '個人', 'other')
  const stamp = new Date().toISOString()
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['legacy', 'customer', state.legacyCustomer, 'default'], ['foreign', 'customer', state.foreignCustomer, 'other']]) {
    const uid = randomUUID(); state[`${token}Id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('LegacyPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
  state.vault = await import('../src/password-vault.js')
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.62.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const view = (userId, token = 'admin') => request(`/customer-users/${userId}/password-view`, 'POST', {}, token)
const customerRow = id => state.db.prepare('SELECT * FROM customers WHERE id=?').get(id)

// ── 新增自管客戶 ──
test('新增客戶時選自管，記下來源「邀請」和切換記錄', async () => {
  const result = await request('/customers', 'POST', { name: '自管陳先生', kind: '個人', serviceMode: '自管' })
  assert.equal(result.status, 201)
  state.invited = result.body.id
  const row = customerRow(state.invited)
  assert.deepEqual([row.service_mode, row.signup_source, row.mode_by], ['自管', '邀請', 'admin名'])
  const mode = (await request(`/customers/${state.invited}/service-mode`)).body
  assert.equal(mode.source, '邀請'); assert.equal(mode.history.length, 1); assert.equal(mode.history[0].fromMode, null)
})
test('新增客戶不選委託方式即托管，沒有來源', async () => {
  const result = await request('/customers', 'POST', { name: '托管黃先生', kind: '個人' })
  const row = customerRow(result.body.id)
  assert.equal(row.service_mode, '托管'); assert.equal(row.signup_source, null)
})
test('委託方式只接受托管或自管', async () => {
  for (const serviceMode of ['全權', '', null, 1, ['自管']]) assert.equal((await request('/customers', 'POST', { name: `錯誤${JSON.stringify(serviceMode)}`, kind: '個人', serviceMode })).status, 400, JSON.stringify(serviceMode))
})
test('員工不能新增自管客戶', async () => {
  assert.equal((await request('/customers', 'POST', { name: '員工新增', kind: '個人', serviceMode: '自管' }, 'staff')).status, 403)
})

// ── 查看密碼 ──
test('開通登入後，管理者看得到初始密碼', async () => {
  const created = await request('/customer-users', 'POST', { customerId: state.invited, name: '陳先生', phone: '+85261112222', password: 'InvitePass123' })
  assert.equal(created.status, 201)
  state.invitedUser = created.body.id
  const result = await view(state.invitedUser)
  assert.equal(result.status, 200); assert.equal(result.body.password, 'InvitePass123')
})
test('資料庫不存可讀的密碼', () => {
  const row = state.db.prepare('SELECT password_hash, password_enc FROM users WHERE id=?').get(state.invitedUser)
  assert.ok(row.password_enc.startsWith('v1:'))
  assert.ok(!row.password_enc.includes('InvitePass123')); assert.ok(!row.password_hash.includes('InvitePass123'))
})
test('帳號列表標示密碼可否查看', async () => {
  const accounts = (await request(`/customers/${state.invited}/users`)).body
  assert.equal(accounts.find(item => item.id === state.invitedUser).passwordViewable, true)
  assert.equal((await request(`/customers/${state.legacyCustomer}/users`)).body[0].passwordViewable, false)
})
test('重設密碼後，管理者看到新密碼', async () => {
  assert.equal((await request(`/customer-users/${state.invitedUser}/reset-password`, 'POST', { password: 'ResetPass4567' })).status, 200)
  assert.equal((await view(state.invitedUser)).body.password, 'ResetPass4567')
})
test('客戶自己改密碼後，管理者看到新密碼', async () => {
  assert.equal((await request(`/customer-users/${state.legacyId}/reset-password`, 'POST', { password: 'LegacyPass123' })).status, 200)
  state.db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run('legacy-2', state.legacyId, '2099-01-01T00:00:00Z', new Date().toISOString())
  assert.equal((await request('/me/password', 'POST', { currentPassword: 'LegacyPass123', newPassword: 'ChangedPass789' }, 'legacy-2')).status, 200)
  assert.equal((await view(state.legacyId)).body.password, 'ChangedPass789')
})
test('員工和管理者改自己的密碼不保存副本', async () => {
  assert.equal((await request('/me/password', 'POST', { currentPassword: 'LegacyPass123', newPassword: 'StaffNewPass123' }, 'staff')).status, 200)
  assert.equal(state.db.prepare('SELECT password_enc FROM users WHERE id=?').get(state.staffId).password_enc, null)
})
test('功能上線前設定的密碼看不到，並說明要重設', async () => {
  const uid = randomUUID()
  state.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(uid, 'customer', '舊帳號', `old-${uid}@test.invalid`, 'x:y', state.legacyCustomer, 'default')
  const result = await view(uid)
  assert.equal(result.status, 200); assert.equal(result.body.password, null); assert.match(result.body.reason, /重設/)
})
test('金鑰更換後解不開，說明要重設', async () => {
  process.env.PASSWORD_VIEW_KEY = randomBytes(32).toString('base64')
  try {
    const result = await view(state.invitedUser)
    assert.equal(result.body.password, null); assert.match(result.body.reason, /金鑰已更換/)
  } finally { delete process.env.PASSWORD_VIEW_KEY }
})
test('正式環境未設定金鑰時不保存副本', () => {
  const env = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try { assert.equal(state.vault.vaultReady(), false); assert.equal(state.vault.seal('AnyPass12345'), null) } finally { process.env.NODE_ENV = env }
})
test('金鑰長度不對時當作未設定', () => {
  process.env.PASSWORD_VIEW_KEY = Buffer.from('short').toString('base64')
  try { assert.equal(state.vault.vaultReady(), false) } finally { delete process.env.PASSWORD_VIEW_KEY }
})
test('每次查看都寫入操作記錄', async () => {
  const before = state.db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE path LIKE '%/password-view'").get().count
  await view(state.invitedUser); await view(state.invitedUser)
  const rows = state.db.prepare("SELECT * FROM audit_logs WHERE path LIKE '%/password-view' ORDER BY created_at DESC").all()
  assert.equal(rows.length, before + 2)
  assert.equal(rows[0].user_name, 'admin名'); assert.equal(rows[0].entity_id, state.invitedUser)
  const logs = (await request('/audit-logs')).body
  assert.ok(logs.some(item => item.action === '查看密碼'))
})
test('員工和客戶不能查看密碼', async () => {
  assert.equal((await view(state.invitedUser, 'staff')).status, 403)
  assert.equal((await view(state.invitedUser, 'legacy-2')).status, 403)
})
test('別的租戶、不存在或非客戶的帳號找不到', async () => {
  assert.equal((await view(state.foreignId)).status, 404)
  assert.equal((await view(randomUUID())).status, 404)
  assert.equal((await view(state.staffId)).status, 404)
})
test('查看密碼只接受 POST', async () => {
  assert.equal((await request(`/customer-users/${state.invitedUser}/password-view`, 'GET')).status, 405)
})
