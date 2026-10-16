import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-edit-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant, self] of [['first', '測試客戶甲', 'default', 0], ['second', '測試客戶乙', 'default', 0], ['foreign', '外租戶客戶', 'other', 0], ['self', '本公司（自有）', 'default', 1]]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id,is_self) VALUES (?,?,?,?,?,?)').run(state[key], name, self ? '公司' : '個人', '12345678', tenant, self)
  }
  for (const [token, role, customer, tenant, login] of [['admin', 'admin', null, 'default', 'boss'], ['staff', 'staff', null, 'default', 'clerk'], ['client', 'customer', state.first, 'default', null], ['foreign-admin', 'admin', null, 'other', 'otherboss']]) {
    const uid = randomUUID()
    state[`${token}Id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,phone,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, token === 'client' ? '+85291234567' : null, hashPassword('OriginalPass123'), customer, tenant, login)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin', ip = '10.55.0.1') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': ip } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const edit = (id, body, token = 'admin') => request(`/customers/${id}`, 'PATCH', body, token)
const reset = (id, body, token = 'admin') => request(`/customer-users/${id}/reset-password`, 'POST', body, token)
const row = id => state.db.prepare('SELECT * FROM customers WHERE id=?').get(id)

test('編輯客戶可同時修改名稱、類型及電話', async () => { const r = await edit(state.first, { name: '  新客戶甲  ', kind: '公司', phone: ' 87654321 ' }); assert.equal(r.status, 200); assert.equal(r.body.name, '新客戶甲'); assert.equal(r.body.kind, '公司'); assert.equal(r.body.phone, '87654321') })
test('編輯客戶只修改傳入欄位，其他欄位不變', async () => { const before = row(state.first); const r = await edit(state.first, { phone: '55555555' }); assert.equal(r.status, 200); assert.equal(r.body.name, before.name); assert.equal(r.body.kind, before.kind); assert.equal(r.body.phone, '55555555') })
test('編輯客戶拒絕空白名稱', async () => { const r = await edit(state.first, { name: '   ' }); assert.equal(r.status, 400); assert.equal(r.body.error, '請填寫客戶名稱') })
test('編輯客戶拒絕 null 內容', async () => { const r = await edit(state.first, null); assert.equal(r.status, 400); assert.equal(r.body.error, '內容無效') })
test('編輯客戶拒絕陣列內容', async () => { const r = await edit(state.first, []); assert.equal(r.status, 400); assert.equal(r.body.error, '內容無效') })
test('編輯客戶拒絕字串內容', async () => { const r = await edit(state.first, 'abc'); assert.equal(r.status, 400); assert.equal(r.body.error, '內容無效') })
test('編輯客戶拒絕數字名稱', async () => { assert.equal((await edit(state.first, { name: 123 })).status, 400) })
test('編輯客戶拒絕物件名稱', async () => { assert.equal((await edit(state.first, { name: {} })).status, 400) })
test('編輯客戶拒絕 null 名稱', async () => { assert.equal((await edit(state.first, { name: null })).status, 400) })
test('編輯客戶拒絕超長名稱', async () => { assert.equal((await edit(state.first, { name: '甲'.repeat(121) })).status, 400) })
test('編輯客戶拒絕無效類型', async () => { const r = await edit(state.first, { kind: '團體' }); assert.equal(r.status, 400); assert.equal(r.body.error, '客戶類型無效') })
test('編輯客戶拒絕陣列類型', async () => { assert.equal((await edit(state.first, { kind: ['公司'] })).status, 400) })
test('編輯客戶拒絕 null 類型', async () => { assert.equal((await edit(state.first, { kind: null })).status, 400) })
test('編輯客戶拒絕同租戶同名', async () => { const r = await edit(state.first, { name: '測試客戶乙' }); assert.equal(r.status, 409); assert.equal(r.body.error, '已有同名客戶') })
test('編輯客戶保持自己原名不算重名', async () => { const r = await edit(state.first, { name: '新客戶甲' }); assert.equal(r.status, 200) })
test('編輯客戶可使用其他租戶的相同名稱', async () => { const r = await edit(state.first, { name: '外租戶客戶' }); assert.equal(r.status, 200) })
test('編輯客戶不能修改其他租戶客戶', async () => { const r = await edit(state.foreign, { name: '不應修改' }); assert.equal(r.status, 404); assert.equal(r.body.error, '客戶不存在') })
test('編輯客戶不存在 ID 回 404', async () => { const r = await edit(randomUUID(), { name: '無' }); assert.equal(r.status, 404); assert.equal(r.body.error, '客戶不存在') })
test('員工不能編輯客戶', async () => { assert.equal((await edit(state.first, { name: '無' }, 'staff')).status, 403) })
test('客戶帳號不能編輯客戶', async () => { assert.equal((await edit(state.first, { name: '無' }, 'client')).status, 403) })
test('本公司（自有）不能修改類型', async () => { const r = await edit(state.self, { kind: '個人' }); assert.equal(r.status, 409); assert.equal(r.body.error, '本公司（自有）的類型不可更改') })
test('本公司（自有）可修改名稱', async () => { const r = await edit(state.self, { name: '測試自有公司' }); assert.equal(r.status, 200); assert.equal(r.body.name, '測試自有公司'); assert.equal(r.body.kind, '公司') })
test('編輯客戶可清空電話', async () => { const r = await edit(state.first, { phone: '' }); assert.equal(r.status, 200); assert.equal(r.body.phone, null) })
test('編輯客戶拒絕 null 電話', async () => { assert.equal((await edit(state.first, { phone: null })).status, 400) })
test('編輯客戶拒絕陣列電話', async () => { assert.equal((await edit(state.first, { phone: [] })).status, 400) })
test('編輯客戶拒絕超長電話', async () => { assert.equal((await edit(state.first, { phone: '1'.repeat(41) })).status, 400) })
test('重複提交相同客戶資料保持成功及內容不變', async () => { const body = { name: '外租戶客戶', kind: '公司', phone: '' }; const first = await edit(state.first, body); const again = await edit(state.first, body); assert.equal(first.status, 200); assert.equal(again.status, 200); assert.deepEqual(again.body, first.body) })
test('編輯客戶操作記錄可在設定中查到', async () => { const r = await request('/audit-logs?entity=customers'); assert.equal(r.status, 200); assert.ok(r.body.some(item => item.path === `/api/customers/${state.first}` && item.method === 'PATCH' && item.action === '修改')) })

test('重設密碼拒絕 null 內容', async () => { assert.equal((await reset(state.clientId, null)).status, 400) })
test('重設密碼拒絕陣列內容', async () => { assert.equal((await reset(state.clientId, [])).status, 400) })
test('重設密碼拒絕空白密碼', async () => { assert.equal((await reset(state.clientId, { password: '   ' })).status, 400) })
test('重設密碼拒絕錯誤型別', async () => { assert.equal((await reset(state.clientId, { password: 12345678901 })).status, 400) })
test('重設密碼拒絕不存在 ID', async () => { assert.equal((await reset(randomUUID(), { password: 'Replacement123' })).status, 404) })
test('重設密碼拒絕其他租戶', async () => { assert.equal((await reset(state.clientId, { password: 'Replacement123' }, 'foreign-admin')).status, 404) })
test('員工不能重設客戶密碼', async () => { assert.equal((await reset(state.clientId, { password: 'Replacement123' }, 'staff')).status, 403) })
test('客戶不能重設客戶密碼', async () => { assert.equal((await reset(state.clientId, { password: 'Replacement123' }, 'client')).status, 403) })
test('重設後電郵與手機帳號的登入失敗鎖定均清除', async () => {
  const { recordFailure } = await import('../src/security.js')
  for (let i = 0; i < 5; i++) { recordFailure('customer', 'client@test.invalid', `10.55.1.${i}`); recordFailure('customer', '+85291234567', `10.55.2.${i}`) }
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'OriginalPass123' }, '', '10.55.9.1')).status, 429)
  assert.equal((await request('/login', 'POST', { login: '+85291234567', password: 'OriginalPass123' }, '', '10.55.9.2')).status, 429)
  assert.equal((await reset(state.clientId, { password: 'Replacement123' })).status, 200)
  assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'Replacement123' }, '', '10.55.9.3')).status, 200)
  assert.equal((await request('/login', 'POST', { login: '+85291234567', password: 'Replacement123' }, '', '10.55.9.4')).status, 200)
})
test('重設後舊密碼登入失敗', async () => { assert.equal((await request('/login', 'POST', { login: 'client@test.invalid', password: 'OriginalPass123' }, '', '10.55.9.5')).status, 401) })
test('重複重設密碼仍會使上一登入會話失效', async () => { const logged = await request('/login', 'POST', { login: 'client@test.invalid', password: 'Replacement123' }, '', '10.55.9.6'); assert.equal(logged.status, 200); assert.equal((await reset(state.clientId, { password: 'SecondReplace123' })).status, 200); assert.equal((await request('/me', 'GET', undefined, logged.body.token)).status, 401) })
