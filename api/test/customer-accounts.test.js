import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶帳號：修改登入資料、區號手機、刪除帳號；刪除空白客戶
const state = {}
const PASSWORD = 'OriginalPass123'
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-accounts-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant] of [['main', '甲客戶', 'default'], ['empty', '空白客戶', 'default'], ['withAccount', '有帳號客戶', 'default'], ['withGroup', '有公司組客戶', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state[key], name, '個人', tenant)
  }
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), 'default', state.withGroup, '甲組', new Date().toISOString())
  const users = [
    ['admin', 'admin', null, 'default', 'boss', null],
    ['staff', 'staff', null, 'default', 'clerk', null],
    ['foreign-admin', 'admin', null, 'other', 'otherboss', null],
    ['client', 'customer', state.main, 'default', null, '+85261110000'],
    ['second', 'customer', state.main, 'default', null, '+85362220000'],
    ['busy', 'customer', state.main, 'default', null, '+8613800138000'],
    ['owner', 'customer', state.withAccount, 'default', null, '+85263330000'],
    ['foreign-client', 'customer', state.foreign, 'other', null, '+85264440000']
  ]
  for (const [token, role, customer, tenant, username, phone] of users) {
    const uid = randomUUID()
    state[`${token}Id`] = uid
    const email = phone ? `${phone}@phone.invalid` : `${token}@test.invalid`
    db.prepare('INSERT INTO users(id,role,name,email,phone,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?,?)').run(uid, role, token, email, phone, hashPassword(PASSWORD), customer, tenant, username)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  // 「busy」帳號在工單有動態，不可刪除
  const requestId = randomUUID(), at = new Date().toISOString()
  db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at,priority) VALUES (?,?,?,?,?,?,?,?,?,?)').run(requestId, state.main, 'renewal', '粵港', '續期', '進行中', '準備', at, at, '一般')
  db.prepare('INSERT INTO activities(id,request_id,actor_id,kind,detail,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), requestId, state.busyId, 'comment', '客戶留言', at)
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

let ipCounter = 0
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': `10.77.0.${++ipCounter % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const edit = (id, body, token = 'admin') => request(`/customer-users/${id}`, 'PATCH', body, token)
const remove = (id, token = 'admin') => request(`/customer-users/${id}`, 'DELETE', undefined, token)
const login = (value, password = PASSWORD) => request('/login', 'POST', { login: value, password }, '')
const PHONE_RULE = '手機號碼格式無效（香港、澳門 8 位，內地 11 位）'

// ── 修改登入資料 ──
test('改登入手機：存成區號格式，原有登入失效，新手機可登入、舊手機不可', async () => {
  const r = await edit(state.clientId, { phone: '+852 6111 9999' })
  assert.equal(r.status, 200)
  assert.equal(r.body.phone, '+85261119999')
  assert.equal((await request('/me', 'GET', undefined, 'client')).status, 401)
  assert.equal((await login('+85261119999')).status, 200)
  assert.equal((await login('+85261110000')).status, 401)
})
test('登入時手機號碼帶空格也能登入', async () => { assert.equal((await login('+852 6111 9999')).status, 200) })
test('改成澳門手機', async () => { const r = await edit(state.clientId, { phone: '+85366667777' }); assert.equal(r.status, 200); assert.equal(r.body.phone, '+85366667777') })
test('改成內地手機', async () => { const r = await edit(state.clientId, { phone: '+86 139 0000 1111' }); assert.equal(r.status, 200); assert.equal(r.body.phone, '+8613900001111'); assert.equal((await login('+8613900001111')).status, 200) })
test('香港手機少於 8 位被拒', async () => { const r = await edit(state.clientId, { phone: '+8526111999' }); assert.equal(r.status, 400); assert.equal(r.body.error, PHONE_RULE) })
test('內地手機不是 1 字頭被拒', async () => { assert.equal((await edit(state.clientId, { phone: '+8623900001111' })).status, 400) })
test('沒有區號的手機被拒', async () => { assert.equal((await edit(state.clientId, { phone: '61119999' })).status, 400) })
test('不支援的區號被拒', async () => { assert.equal((await edit(state.clientId, { phone: '+4412345678' })).status, 400) })
test('改成只用電郵登入（清空手機）', async () => {
  const r = await edit(state.clientId, { email: 'Client@Example.com', phone: '' })
  assert.equal(r.status, 200); assert.equal(r.body.email, 'client@example.com'); assert.equal(r.body.phone, '')
  assert.equal((await login('client@example.com')).status, 200)
})
test('電郵和手機都清空被拒', async () => { const r = await edit(state.clientId, { email: '', phone: '' }); assert.equal(r.status, 400); assert.equal(r.body.error, '電郵和手機號碼至少要保留一項') })
test('電郵格式錯誤被拒', async () => { assert.equal((await edit(state.clientId, { email: 'not-an-email' })).status, 400) })
test('內部保留的電郵格式被拒', async () => { assert.equal((await edit(state.clientId, { email: '+85261110000@phone.invalid' })).status, 400) })
test('手機已被其他帳號使用', async () => { const r = await edit(state.clientId, { phone: '+85362220000' }); assert.equal(r.status, 409); assert.equal(r.body.error, '這個手機號碼已被使用') })
test('電郵已被其他帳號使用', async () => { const r = await edit(state.secondId, { email: 'client@example.com' }); assert.equal(r.status, 409); assert.equal(r.body.error, '這個電郵已被使用') })
test('保留自己原有的手機不算重複', async () => { assert.equal((await edit(state.secondId, { phone: '+85362220000' })).status, 200) })
test('只改顯示名稱，登入資料不變、原有登入保留', async () => {
  const r = await edit(state.secondId, { name: '  李太  ' })
  assert.equal(r.status, 200); assert.equal(r.body.name, '李太'); assert.equal(r.body.phone, '+85362220000')
  assert.equal((await request('/me', 'GET', undefined, 'second')).status, 200)
})
test('空白顯示名稱被拒', async () => { assert.equal((await edit(state.secondId, { name: '   ' })).status, 400) })
test('顯示名稱類型錯誤被拒', async () => { assert.equal((await edit(state.secondId, { name: 5 })).status, 400) })
test('手機類型錯誤被拒', async () => { assert.equal((await edit(state.secondId, { phone: 85362220000 })).status, 400) })
test('null 請求內容被拒', async () => { assert.equal((await edit(state.secondId, null)).status, 400) })
test('陣列請求內容被拒', async () => { assert.equal((await edit(state.secondId, [])).status, 400) })
test('沒有可修改欄位被拒', async () => { const r = await edit(state.secondId, {}); assert.equal(r.status, 400); assert.equal(r.body.error, '請指定要修改的資料') })
test('員工不能修改客戶帳號', async () => { assert.equal((await edit(state.secondId, { name: '甲' }, 'staff')).status, 403) })
test('客戶不能修改客戶帳號', async () => { assert.equal((await edit(state.secondId, { name: '甲' }, 'second')).status, 403) })
test('別的租戶的客戶帳號回 404', async () => { assert.equal((await edit(state['foreign-clientId'], { name: '甲' })).status, 404) })
test('不存在的客戶帳號回 404', async () => { assert.equal((await edit(randomUUID(), { name: '甲' })).status, 404) })
test('開通登入時用沒有區號的手機被拒', async () => { const r = await request('/customer-users', 'POST', { customerId: state.main, name: '新帳號', phone: '61234567', password: 'NewAccount2026' }); assert.equal(r.status, 400); assert.equal(r.body.error, PHONE_RULE) })
test('開通登入時區號手機存成統一格式', async () => {
  const r = await request('/customer-users', 'POST', { customerId: state.main, name: '新帳號', phone: '+853 6123 4567', password: 'NewAccount2026' })
  assert.equal(r.status, 201); state.newId = r.body.id
  assert.equal(state.db.prepare('SELECT phone FROM users WHERE id=?').get(r.body.id).phone, '+85361234567')
})

// ── 刪除客戶帳號 ──
test('刪除沒有紀錄的客戶帳號後無法登入', async () => {
  assert.equal((await remove(state.newId)).status, 200)
  assert.equal(state.db.prepare('SELECT 1 FROM users WHERE id=?').get(state.newId), undefined)
  assert.equal((await login('+85361234567', 'NewAccount2026')).status, 401)
})
test('重複刪除同一帳號回 404', async () => { assert.equal((await remove(state.newId)).status, 404) })
test('有工單動態的客戶帳號不能刪除', async () => { const r = await remove(state.busyId); assert.equal(r.status, 409); assert.equal(r.body.error, '這個帳號已有上傳或操作紀錄，不能刪除，請改用停用') })
test('員工不能刪除客戶帳號', async () => { assert.equal((await remove(state.secondId, 'staff')).status, 403) })
test('客戶不能刪除客戶帳號', async () => { assert.equal((await remove(state.secondId, 'second')).status, 403) })
test('不能刪除別的租戶的客戶帳號', async () => { assert.equal((await remove(state['foreign-clientId'])).status, 404) })

// ── 刪除客戶 ──
const removeCustomer = (id, token = 'admin') => request(`/customers/${id}`, 'DELETE', undefined, token)
test('有登入帳號的客戶未確認登入數目不能刪除', async () => { const r = await removeCustomer(state.withAccount); assert.equal(r.status, 409); assert.equal(r.body.error, '這位客戶有 1 個登入帳號，請確認一併刪除') })
test('名下有公司組的客戶不能刪除，並說明原因', async () => { const r = await removeCustomer(state.withGroup); assert.equal(r.status, 409); assert.equal(r.body.error, '客戶名下仍有公司組，不能刪除') })
test('員工不能刪除客戶', async () => { assert.equal((await removeCustomer(state.empty, 'staff')).status, 403) })
test('不能刪除別的租戶的客戶', async () => { assert.equal((await removeCustomer(state.foreign)).status, 404) })
test('刪除空白客戶', async () => {
  assert.equal((await removeCustomer(state.empty)).status, 200)
  assert.equal(state.db.prepare('SELECT 1 FROM customers WHERE id=?').get(state.empty), undefined)
})
test('重複刪除同一客戶回 404', async () => { assert.equal((await removeCustomer(state.empty)).status, 404) })
test('先刪除登入帳號後，空白客戶可以刪除', async () => {
  assert.equal((await remove(state.ownerId)).status, 200)
  assert.equal((await removeCustomer(state.withAccount)).status, 200)
})
