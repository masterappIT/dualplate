import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 今日工作待處理數目：導航「今日工作」旁的數字
const state = {}
const at = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'today-counts-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  state.server = (await import('../src/server.js')).server
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', at())
  for (const [key, tenant] of [['a', 'default'], ['b', 'default'], ['foreign', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state[key], `客戶${key}`, '個人', tenant)
  }
  for (const [token, role, customer, tenant, username] of [['admin', 'admin', null, 'default', 'boss'], ['staff', 'staff', null, 'default', 'clerk'], ['foreign-admin', 'admin', null, 'other', 'otherboss'], ['client', 'customer', state.a, 'default', null]]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customer, tenant, username)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', at())
  }
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', token = 'admin') {
  const incoming = Readable.from([])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const counts = async (token = 'admin') => (await request('/today-counts', 'GET', token)).body
const signup = (tenant, status) => state.db.prepare('INSERT INTO signup_applications(id,tenant_id,phone,name,terms_version,status,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), tenant, `+8526${String(Math.random()).slice(2, 9)}`, '申請人', 1, status, at())
const message = (customer, tenant, fromStaff, readAt = null) => state.db.prepare('INSERT INTO support_messages(id,tenant_id,customer_id,from_staff,sender_name,body,created_at,read_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, customer, fromStaff, '某人', '內容', at(), readAt)
const change = (customer, entityId, status = '待核對', tenant = 'default') => state.db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,changed_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, customer, 'plate', entityId, '牌照', 'notes', '備註', at(), status)

test('沒有任何待處理時全部為 0', async () => {
  assert.deepEqual(await counts(), { signups: 0, messages: 0, changes: 0, selfHandled: 0, clientRentals: 0, clientCancels: 0, closures: 0, total: 0 })
})
test('審批中的註冊申請計入；已批准、已拒絕不計', async () => {
  signup('default', '審批中'); signup('default', '已批准'); signup('default', '已拒絕')
  assert.equal((await counts()).signups, 1)
})
test('員工看不到註冊申請數目（只限管理者審批）', async () => { assert.equal((await counts('staff')).signups, 0) })
test('客戶的未讀訊息按客戶計：同一客戶兩則算一件', async () => {
  message(state.a, 'default', 0); message(state.a, 'default', 0)
  assert.equal((await counts()).messages, 1)
})
test('已讀和員工發出的訊息不計', async () => {
  message(state.b, 'default', 0, at()); message(state.b, 'default', 1)
  assert.equal((await counts()).messages, 1)
})
test('員工也看到未讀訊息數目', async () => { assert.equal((await counts('staff')).messages, 1) })
test('客戶更新待核對按「客戶 × 對象」合成一件', async () => {
  const plate = randomUUID()
  change(state.a, plate); change(state.a, plate); change(state.a, randomUUID())
  assert.equal((await counts()).changes, 2)
})
test('已核對、已改回的客戶更新不計', async () => {
  change(state.b, randomUUID(), '已核對'); change(state.b, randomUUID(), '已改回')
  assert.equal((await counts()).changes, 2)
})
test('客戶自行辦理待核對計入，已核對不計', async () => {
  for (const status of ['待核對', '已核對']) state.db.prepare('INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', state.a, randomUUID(), 'renewal', '2026-10-01', '{}', status, at())
  assert.equal((await counts()).selfHandled, 1)
})
test('客戶新增的出租未看計入；已看和員工登記的不計', async () => {
  for (const [source, seen] of [['client', null], ['client', at()], ['admin', null]]) state.db.prepare('INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,starts_on,created_at,updated_at,source,staff_seen_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', randomUUID(), '承租人', '2026-10-01', at(), at(), source, seen)
  assert.equal((await counts()).clientRentals, 1)
})
test('未確認的帳戶注銷計入（只限管理者）', async () => {
  state.db.prepare('INSERT INTO account_closures(id,tenant_id,customer_name,closed_at) VALUES (?,?,?,?)').run(randomUUID(), 'default', '已注銷', at())
  state.db.prepare('INSERT INTO account_closures(id,tenant_id,customer_name,closed_at,acknowledged_at) VALUES (?,?,?,?,?)').run(randomUUID(), 'default', '已確認', at(), at())
  assert.equal((await counts()).closures, 1)
  assert.equal((await counts('staff')).closures, 0)
})
test('合計是各項之和', async () => {
  const result = await counts()
  assert.equal(result.total, 1 + 1 + 2 + 1 + 1 + 1)
})
test('員工合計不含只限管理者的項目', async () => { assert.equal((await counts('staff')).total, 1 + 2 + 1 + 1) })
test('別的租戶的待處理不計入', async () => {
  signup('other', '審批中'); message(state.foreign, 'other', 0); change(state.foreign, randomUUID(), '待核對', 'other')
  assert.equal((await counts()).total, 7)
  assert.deepEqual(await counts('foreign-admin'), { signups: 1, messages: 1, changes: 1, selfHandled: 0, clientRentals: 0, clientCancels: 0, closures: 0, total: 3 })
})
test('客戶帳號不能讀取', async () => { assert.equal((await request('/today-counts', 'GET', 'client')).status, 403) })
test('未登入不能讀取', async () => { assert.equal((await request('/today-counts', 'GET', '')).status, 401) })
test('不支援 POST', async () => { assert.equal((await request('/today-counts', 'POST')).status, 405) })
