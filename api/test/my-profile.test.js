import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 我的資料（2026-10-18）：客戶看和改自己的顯示名稱、密碼、委託人資料；登入電郵／手機只顯示
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'my-profile-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, tenant] of [['first', 'default'], ['second', 'default'], ['foreign', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,notes,tenant_id) VALUES (?,?,?,?,?,?)').run(state[key], `委託人${key}`, '個人', '+852 6123 4567', '內部備註：不可給客戶看', tenant)
  }
  const users = [['admin', 'admin', null, 'default', 'admin@test.invalid', null], ['staff', 'staff', null, 'default', 'staff@test.invalid', null],
    ['client', 'customer', state.first, 'default', 'owner@example.com', '+85261234567'], ['assistant', 'customer', state.first, 'default', '+85269990000@phone.invalid', '+85269990000'],
    ['second-client', 'customer', state.second, 'default', 'second@example.com', null], ['foreign-client', 'customer', state.foreign, 'other', 'foreign@example.com', null]]
  for (const [token, role, customer, tenant, email, phone] of users) {
    const uid = randomUUID(); state[`${token}-id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username,phone) VALUES (?,?,?,?,?,?,?,?,?)').run(uid, role, token === 'assistant' ? '助手阿明' : token, email, hashPassword('ProfilePass123'), customer, tenant, role === 'customer' ? null : token, phone)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'client') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.59.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const customerRow = id => state.db.prepare('SELECT * FROM customers WHERE id=?').get(id)
const pendingFields = id => state.db.prepare("SELECT field FROM customer_changes WHERE entity_type='customer' AND entity_id=? AND status='待核對' ORDER BY field").all(id).map(row => row.field)

// ── 查看 ──
test('我的資料列出登入帳號、委託人資料和其他登入', async () => {
  const result = await request('/my/profile')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.me, { name: 'client', email: 'owner@example.com', phone: '+85261234567', wechatBound: false })
  assert.deepEqual(result.body.customer, { name: '委託人first', kind: '個人', phone: '+852 6123 4567' })
  assert.deepEqual(result.body.otherLogins, ['助手阿明'])
})
test('我的資料不含內部備註', async () => { assert.ok(!JSON.stringify((await request('/my/profile')).body).includes('內部備註')) })
test('只用手機登入的帳號不顯示系統的佔位電郵', async () => {
  const me = (await request('/my/profile', 'GET', undefined, 'assistant')).body.me
  assert.equal(me.email, ''); assert.equal(me.phone, '+85269990000')
})
test('其他登入只列名字，不含電郵或電話', async () => {
  const others = (await request('/my/profile', 'GET', undefined, 'assistant')).body.otherLogins
  assert.deepEqual(others, ['client'])
})
test('員工和管理者不能用我的資料', async () => {
  for (const token of ['admin', 'staff']) assert.equal((await request('/my/profile', 'GET', undefined, token)).status, 403)
})
test('我的資料只接受 GET', async () => { assert.equal((await request('/my/profile', 'POST', {})).status, 405) })

// ── 顯示名稱 ──
test('客戶可直接改自己的顯示名稱，不列入待核對', async () => {
  const result = await request('/my/profile/name', 'PATCH', { name: '  陳大文  ' }, 'second-client')
  assert.equal(result.status, 200); assert.equal(result.body.name, '陳大文')
  assert.equal(state.db.prepare('SELECT name FROM users WHERE id=?').get(state['second-client-id']).name, '陳大文')
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=?").get(state.second).count, 0)
})
test('顯示名稱空白、錯誤類型、多餘欄位都被拒', async () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 123 }, { name: null }, { name: ['a'] }, { name: '甲', email: 'x@y.z' }]) assert.equal((await request('/my/profile/name', 'PATCH', body)).status, 400, JSON.stringify(body))
})
test('顯示名稱只接受 PATCH', async () => { assert.equal((await request('/my/profile/name', 'POST', { name: '甲' })).status, 405) })

// ── 委託人資料 ──
test('客戶改委託人名稱、類型、電話，立即生效並逐欄列入待核對', async () => {
  const result = await request('/my/customer', 'PATCH', { name: '陳氏有限公司', kind: '公司', phone: '+852 9876 5432' })
  assert.equal(result.status, 200); assert.deepEqual(result.body, { name: '陳氏有限公司', kind: '公司', phone: '+852 9876 5432' })
  const row = customerRow(state.first)
  assert.deepEqual([row.name, row.kind, row.phone], ['陳氏有限公司', '公司', '+852 9876 5432'])
  assert.deepEqual(pendingFields(state.first), ['kind', 'name', 'phone'])
})
test('委託人資料改回原值時撤銷待核對', async () => {
  await request('/my/customer', 'PATCH', { phone: '+852 6123 4567' })
  assert.ok(!pendingFields(state.first).includes('phone'))
})
test('管理者可把客戶改的委託人名稱改回', async () => {
  const change = state.db.prepare("SELECT id FROM customer_changes WHERE entity_type='customer' AND entity_id=? AND field='name' AND status='待核對'").get(state.first)
  const result = await request(`/customer-changes/${change.id}/revert`, 'POST', {}, 'admin')
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(customerRow(state.first).name, '委託人first')
})
test('委託人資料被改回時，通知帶客戶去我的資料', async () => {
  const notice = state.db.prepare("SELECT link FROM notifications WHERE customer_id=? AND kind='change_reverted'").get(state.first)
  assert.equal(notice?.link, '/pages/profile/profile')
})
test('管理者可核對無誤', async () => {
  const change = state.db.prepare("SELECT id FROM customer_changes WHERE entity_type='customer' AND entity_id=? AND field='kind' AND status='待核對'").get(state.first)
  assert.equal((await request(`/customer-changes/${change.id}/accept`, 'POST', {}, 'admin')).status, 200)
  assert.equal(customerRow(state.first).kind, '公司')
})
test('待核對清單顯示為委託人資料', async () => {
  await request('/my/customer', 'PATCH', { phone: '+852 6000 0000' })
  const list = (await request('/customer-changes', 'GET', undefined, 'admin')).body
  const items = Array.isArray(list) ? list : list.items || list.pending || []
  const row = items.find(item => item.entityType === 'customer' && item.entityId === state.first)
  assert.ok(row); assert.equal(row.entityName, '委託人資料')
})
test('委託人名稱不可空白，類型只可個人或公司，電話格式要對', async () => {
  for (const body of [{ name: '' }, { name: '  ' }, { kind: '集團' }, { kind: '' }, { phone: 'abc' }, { phone: '12' }]) assert.equal((await request('/my/customer', 'PATCH', body)).status, 400, JSON.stringify(body))
})
test('委託人資料拒絕空內容、錯誤類型和不可改的欄位', async () => {
  for (const body of [{}, { name: 1 }, { kind: null }, { phone: ['1'] }, { notes: '改備註' }, { tenantId: 'other' }, { advisorName: '自己' }]) assert.equal((await request('/my/customer', 'PATCH', body)).status, 400, JSON.stringify(body))
  assert.equal(customerRow(state.first).notes, '內部備註：不可給客戶看')
})
test('電話可以清空', async () => {
  assert.equal((await request('/my/customer', 'PATCH', { phone: '' }, 'second-client')).status, 200)
  assert.equal(customerRow(state.second).phone, null)
})
test('客戶只能改自己的委託人資料，不影響其他客戶和租戶', async () => {
  await request('/my/customer', 'PATCH', { name: '外租戶新名' }, 'foreign-client')
  assert.equal(customerRow(state.foreign).name, '外租戶新名')
  assert.equal(customerRow(state.second).name, '委託人second')
})
test('員工和管理者不能用客戶的委託人資料修改', async () => {
  for (const token of ['admin', 'staff']) assert.equal((await request('/my/customer', 'PATCH', { name: '甲' }, token)).status, 403)
})
test('委託人資料只接受 PATCH', async () => { assert.equal((await request('/my/customer', 'GET')).status, 405) })

// ── 密碼 ──
test('客戶可改自己的密碼，目前密碼不對時拒絕', async () => {
  assert.equal((await request('/me/password', 'POST', { currentPassword: 'WrongPass123', newPassword: 'NewProfile456' }, 'second-client')).status, 400)
  assert.equal((await request('/me/password', 'POST', { currentPassword: 'ProfilePass123', newPassword: 'NewProfile456' }, 'second-client')).status, 200)
})
