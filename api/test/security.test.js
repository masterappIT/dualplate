import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 21 輪上線準備：登入鎖定、會話、密碼、操作記錄、錯誤記錄、健康檢查、備份還原、全路由權限掃描。
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'security-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs'), BACKUP_DIR: join(state.dir, 'backups') })
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('default'); seedRules('other')
  for (const key of ['customer', 'foreign']) state[key] = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.customer, '客戶甲', '個人', 'default')
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.foreign, '別家客戶', '個人', 'other')
  for (const [token, role, customerId, tenant, username] of [['admin', 'admin', null, 'default', 'boss'], ['staff', 'staff', null, 'default', 'clerk'], ['client', 'customer', state.customer, 'default', null], ['foreign-admin', 'admin', null, 'other', 'otherboss']]) {
    const userId = randomUUID(); state[`${token}Id`] = userId
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant, username)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, userId, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin', ip = '10.0.0.1') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': ip } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}

// ── 健康檢查與錯誤記錄 ──
test('健康檢查回報資料庫可讀與版本號', async () => {
  const result = await request('/health', 'GET', undefined, '')
  assert.equal(result.status, 200); assert.equal(result.body.database, 'ok'); assert.match(result.body.version, /^\d+\.\d+\.\d+$/)
})

// ── 登入鎖定 ──
test('管理端登入失敗 5 次後鎖定 15 分鐘，正確密碼也不能登入', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await request('/admin/login', 'POST', { username: 'clerk', password: 'wrong-password' }, '', '10.0.0.2')).status, 401)
  const locked = await request('/admin/login', 'POST', { username: 'clerk', password: 'Password12345' }, '', '10.0.0.3')
  assert.equal(locked.status, 429); assert.match(locked.body.error, /分鐘後再試/)
})
test('同一 IP 對不同帳號連續失敗也會鎖定', async () => {
  for (let i = 0; i < 5; i++) await request('/login', 'POST', { login: `nobody${i}@test.invalid`, password: 'x' }, '', '10.0.0.9')
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'Password12345' }, '', '10.0.0.9')).status, 429)
})
test('登入成功會清除該帳號的失敗次數', async () => {
  for (let i = 0; i < 3; i++) await request('/login', 'POST', { login: 'client@test.invalid', password: 'x' }, '', '10.0.1.1')
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'Password12345' }, '', '10.0.1.1')).status, 200)
  for (let i = 0; i < 3; i++) await request('/login', 'POST', { login: 'client@test.invalid', password: 'x' }, '', '10.0.1.2')
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'Password12345' }, '', '10.0.1.3')).status, 200)
})

// ── 會話 ──
test('新登入的會話 30 天到期', async () => {
  const result = await request('/admin/login', 'POST', { username: 'boss', password: 'Password12345' }, '', '10.0.2.1')
  const row = state.db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(result.body.token)
  const days = (Date.parse(row.expires_at) - Date.now()) / 86400000
  assert.ok(days > 29.9 && days <= 30)
})
test('閒置超過 7 天的會話失效', async () => {
  const token = randomUUID()
  state.db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, state.adminId, '2099-01-01T00:00:00Z', new Date(Date.now() - 8 * 86400000).toISOString())
  assert.equal((await request('/me', 'GET', undefined, token)).status, 401)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM sessions WHERE token=?').get(token).count, 0)
})

// ── 密碼 ──
test('修改密碼：目前密碼錯、太短、與帳號相同、與舊密碼相同都被拒', async () => {
  const other = randomUUID()
  state.db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(other, state.staffId, '2099-01-01T00:00:00Z', new Date().toISOString())
  for (const body of [{ currentPassword: 'bad', newPassword: 'NewPassword123' }, { currentPassword: 'Password12345', newPassword: 'short' }, { currentPassword: 'Password12345', newPassword: 'clerk' }, { currentPassword: 'Password12345', newPassword: 'staff@test.invalid' }, { currentPassword: 'Password12345', newPassword: 'Password12345' }]) assert.equal((await request('/me/password', 'POST', body, other)).status, 400, JSON.stringify(body))
})
test('修改密碼後其他裝置的登入失效，目前的保留', async () => {
  const current = randomUUID()
  state.db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(current, state.staffId, '2099-01-01T00:00:00Z', new Date().toISOString())
  assert.equal((await request('/me/password', 'POST', { currentPassword: 'Password12345', newPassword: 'NewPassword123' }, current)).status, 200)
  assert.equal((await request('/me', 'GET', undefined, current)).status, 200)
  assert.equal((await request('/me', 'GET', undefined, 'staff')).status, 401)
})
test('新增員工密碼少於 10 位或與帳號相同被拒', async () => {
  assert.equal((await request('/staff', 'POST', { name: '新員工', username: 'newbie', password: 'short123', role: 'staff' })).status, 400)
  assert.equal((await request('/staff', 'POST', { name: '新員工', username: 'newbie12345', password: 'newbie12345', role: 'staff' })).status, 400)
})
test('管理者可重設客戶密碼，舊會話失效；員工不可', async () => {
  assert.equal((await request(`/customer-users/${state.clientId}/reset-password`, 'POST', { password: 'ClientReset2026' }, 'staff')).status, 401, '員工的舊會話已在上一個測試失效')
  assert.equal((await request(`/customer-users/${state.clientId}/reset-password`, 'POST', { password: 'short' })).status, 400)
  assert.equal((await request(`/customer-users/${state.clientId}/reset-password`, 'POST', { password: 'ClientReset2026' }, 'foreign-admin')).status, 404)
  assert.equal((await request(`/customer-users/${state.clientId}/reset-password`, 'POST', { password: 'ClientReset2026' })).status, 200)
  assert.equal((await request('/me', 'GET', undefined, 'client')).status, 401)
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'ClientReset2026' }, '', '10.0.3.1')).status, 200)
})

// ── 操作記錄 ──
test('修改操作寫入操作記錄，敏感欄位遮蔽', async () => {
  await request('/drivers', 'POST', { customerId: state.customer, name: '司機乙', hkIdNo: 'A123456(7)' })
  const logs = (await request('/audit-logs?entity=drivers')).body
  assert.equal(logs[0].entityLabel, '司機'); assert.equal(logs[0].userName, 'admin'); assert.equal(logs[0].summary.hkIdNo, '（已遮蔽）'); assert.equal(logs[0].ip, '10.0.0.1')
  const text = JSON.stringify((await request('/audit-logs')).body)
  assert.ok(!text.includes('ClientReset2026') && !text.includes('A123456'))
})
test('失敗的請求和讀取不寫操作記錄', async () => {
  const before = state.db.prepare('SELECT COUNT(*) count FROM audit_logs').get().count
  await request('/drivers', 'POST', { customerId: state.customer, name: '' }); await request('/drivers')
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM audit_logs').get().count, before)
})
test('操作記錄只限管理者，且只看到自己租戶', async () => {
  const staffToken = randomUUID()
  state.db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(staffToken, state.staffId, '2099-01-01T00:00:00Z', new Date().toISOString())
  assert.equal((await request('/audit-logs', 'GET', undefined, staffToken)).status, 403)
  assert.ok((await request('/audit-logs', 'GET', undefined, 'foreign-admin')).body.every(item => item.userId !== state.adminId))
})

// ── 錯誤記錄 ──
test('伺服器錯誤寫入當日記錄檔，回應不洩露細節', async () => {
  const realPrepare = state.db.prepare
  const { db } = await import('../src/db.js')
  db.prepare = sql => { if (String(sql).includes('FROM accounting_firms')) throw new Error('模擬資料庫故障 secret-detail'); return realPrepare.call(db, sql) }
  try {
    const result = await request('/accounting-firms')
    assert.equal(result.status, 500); assert.ok(!JSON.stringify(result.body).includes('secret-detail'))
  } finally { db.prepare = realPrepare }
  const files = readdirSync(process.env.LOG_DIR)
  assert.ok(files.some(name => /^\d{4}-\d{2}-\d{2}\.log$/.test(name)))
  assert.ok(readFileSync(join(process.env.LOG_DIR, files[0]), 'utf8').includes('secret-detail'))
})

// ── 備份與還原演練 ──
test('備份產生可開啟的完整副本，從備份啟動資料一致', async () => {
  const { runBackup } = await import('../scripts/backup.js')
  const result = await runBackup({ source: process.env.DB_PATH, dir: process.env.BACKUP_DIR })
  assert.ok(existsSync(result.file))
  const copy = new DatabaseSync(result.file, { readOnly: true })
  try {
    for (const table of ['customers', 'users', 'drivers', 'audit_logs']) assert.equal(copy.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, state.db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, table)
    assert.equal(copy.prepare('SELECT name FROM customers WHERE id=?').get(state.customer).name, '客戶甲')
  } finally { copy.close() }
})
test('備份只保留設定天數內的檔案', async () => {
  const { runBackup } = await import('../scripts/backup.js')
  const { utimesSync, writeFileSync } = await import('node:fs')
  const old = join(process.env.BACKUP_DIR, 'app-2000-01-01T00-00-00-000Z.sqlite')
  writeFileSync(old, ''); utimesSync(old, new Date('2000-01-01'), new Date('2000-01-01'))
  const result = await runBackup({ source: process.env.DB_PATH, dir: process.env.BACKUP_DIR, keepDays: 30 })
  assert.ok(result.removed.includes('app-2000-01-01T00-00-00-000Z.sqlite')); assert.ok(!existsSync(old))
})
test('沒有設定備份資料夾時清楚報錯', async () => {
  const { runBackup } = await import('../scripts/backup.js')
  await assert.rejects(runBackup({ source: process.env.DB_PATH, dir: '' }), /BACKUP_DIR/)
})

// ── 全路由權限掃描：未登入 401、客戶不能用管理接口 ──
const adminRoutes = ['/customers', '/plate-assets', '/vehicles', '/companies', '/company-groups', '/overview', '/rules', '/tracked-items?ownerType=plate&ownerId=x', '/work-orders', '/requests', '/staff', '/work-templates', '/service-scopes?ownerType=plate&ownerId=x', '/drivers', '/rental-contracts', '/rent-invoices', '/fees', '/quotes', '/filings', '/filings/matrix', '/accounting-firms', '/reports', '/audit-logs', '/views/weekly-progress', `/customers/${randomUUID()}/users`]
const clientRoutes = ['/my/overview', '/my/notifications', '/my/advisor', '/my/rentals', '/my/fees', '/my/filings', '/my/reports']
test('所有接口未登入一律 401', async () => { for (const path of [...adminRoutes, ...clientRoutes, '/me', '/catalog']) assert.equal((await request(path, 'GET', undefined, '')).status, 401, path) })
test('客戶帳號呼叫管理接口一律被擋', async () => {
  const token = (await request('/login', 'POST', { login: 'client@test.invalid', password: 'ClientReset2026' }, '', '10.0.5.1')).body.token
  const leaked = []
  for (const path of adminRoutes.filter(path => !['/customers', '/plate-assets', '/vehicles', '/requests'].includes(path))) { const result = await request(path, 'GET', undefined, token); if (![403, 404].includes(result.status)) leaked.push(`${path} → ${result.status}`) }
  assert.deepEqual(leaked, [])
})
test('客戶讀自己的牌照、車輛、工單只看到自己的', async () => {
  const token = (await request('/login', 'POST', { login: 'client@test.invalid', password: 'ClientReset2026' }, '', '10.0.5.2')).body.token
  const self = (await request('/customers', 'GET', undefined, token)).body
  assert.deepEqual(self.map(item => item.id), [state.customer]); assert.ok(!('notes' in self[0]), '不含內部備註')
  for (const path of ['/plate-assets', '/vehicles', '/requests']) { const result = await request(path, 'GET', undefined, token); assert.equal(result.status, 200); assert.ok(result.body.every(item => !item.customer_id || item.customer_id === state.customer), path) }
})
test('管理人員呼叫客戶接口一律 403', async () => { for (const path of clientRoutes) assert.equal((await request(path)).status, 403, path) })
test('公司名稱可由管理者修改，員工不可', async () => {
  assert.equal((await request('/tenant', 'PUT', { name: '  ' })).status, 400)
  assert.equal((await request('/tenant', 'PUT', { name: '示範代辦有限公司' })).body.name, '示範代辦有限公司')
  assert.equal((await request('/tenant')).body.name, '示範代辦有限公司')
})
test('操作記錄寫出具體動作名稱', async () => {
  await request(`/customers/${state.customer}/advisor`, 'PUT', { name: '顧問甲' })
  const [latest] = (await request('/audit-logs')).body
  assert.equal(latest.action, '顧問設定')
})
