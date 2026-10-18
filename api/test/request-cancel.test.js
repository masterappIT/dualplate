import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶自行取消委託（docs/tasks/self-managed-fixes-plan.md 第 12 步）：只限「已收到」——員工還沒開始、還沒報價；員工在今日工作看到
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'request-cancel-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  for (const [token, role] of [['admin', 'admin'], ['staff', 'staff']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('CompanyPass123'), 'default', token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.74.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
function client(mode = '自管') {
  const { db, hashPassword } = state, n = ++seq, ids = { customer: randomUUID(), user: randomUUID(), token: `client-${n}` }
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(ids.customer, `客戶${n}`, '個人', 'default', mode)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `cancel${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const submit = async ids => { const result = await request('/requests', 'POST', { route: '粵港', serviceCode: 'other', title: '測試委託' }, ids.token); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.id }
const cancel = (ids, requestId, body = {}) => request(`/my/requests/${requestId}/cancel`, 'POST', body, ids.token)
const row = requestId => state.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId)
const view = (ids, requestId) => request(`/requests/${requestId}`, 'GET', undefined, ids.token)
const CONTACT_US = '已開始辦理或已報價，如要取消請聯絡我們'

test('自管客戶取消已收到的委託：已取消，記下原因', async () => {
  const ids = client(), requestId = await submit(ids)
  const result = await cancel(ids, requestId, { reason: '按錯了' })
  assert.equal(result.status, 200)
  assert.equal(row(requestId).status, '已取消')
  assert.equal(row(requestId).cancelled_reason, '客戶自行取消：按錯了')
  assert.equal((await view(ids, requestId)).body.status, '已取消')
})
test('托管客戶取消已收到的委託：一樣可以', async () => {
  const ids = client('托管'), requestId = await submit(ids)
  assert.equal((await cancel(ids, requestId)).status, 200)
  assert.equal(row(requestId).cancelled_reason, '客戶自行取消')
})
test('已收到的委託：客戶看到可以取消', async () => {
  const ids = client(), requestId = await submit(ids)
  const detail = (await view(ids, requestId)).body
  assert.equal(detail.canCancel, true)
  assert.equal(detail.cancelBlock, null)
})
test('員工已開始其中一步：不能自行取消，請聯絡我們', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("UPDATE tasks SET status='進行中' WHERE rowid=(SELECT rowid FROM tasks WHERE request_id=? LIMIT 1)").run(requestId)
  const result = await cancel(ids, requestId)
  assert.equal(result.status, 409)
  assert.equal(result.body.error, CONTACT_US)
  const detail = (await view(ids, requestId)).body
  assert.equal(detail.canCancel, false)
  assert.equal(detail.cancelBlock, CONTACT_US)
})
test('辦理中的委託：不能自行取消', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("UPDATE requests SET status='進行中' WHERE id=?").run(requestId)
  assert.equal((await cancel(ids, requestId)).status, 409)
  assert.equal(row(requestId).status, '進行中')
})
test('已發出報價：不能自行取消', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("INSERT INTO quotes(id,tenant_id,customer_id,title,currency,items_json,valid_until,status,request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', ids.customer, '報價', 'HKD', '[]', '2099-01-01', '已發出', requestId, stamp(), stamp())
  assert.equal((await cancel(ids, requestId)).body.error, CONTACT_US)
})
test('報價還在草擬（客戶未收到）：仍可以自行取消', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("INSERT INTO quotes(id,tenant_id,customer_id,title,currency,items_json,valid_until,status,request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', ids.customer, '報價', 'HKD', '[]', '2099-01-01', '草擬', requestId, stamp(), stamp())
  assert.equal((await cancel(ids, requestId)).status, 200)
})
test('出租的手續工單：請在出租頁處理', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare('INSERT INTO rental_procedures(id,contract_id,kind,handler,request_id,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), randomUUID(), 'vehicle', 'us', requestId, stamp())
  assert.equal((await cancel(ids, requestId)).body.error, '這是出租的手續，請在出租頁取消出租')
})
test('重複取消：409', async () => {
  const ids = client(), requestId = await submit(ids)
  await cancel(ids, requestId)
  assert.equal((await cancel(ids, requestId)).body.error, '這個委託已取消')
})
test('已完成的委託：不能取消', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("UPDATE requests SET status='已完成' WHERE id=?").run(requestId)
  assert.equal((await cancel(ids, requestId)).status, 409)
})
test('別人的委託、不存在的委託：404', async () => {
  const owner = client(), other = client(), requestId = await submit(owner)
  assert.equal((await cancel(other, requestId)).status, 404)
  assert.equal((await cancel(owner, randomUUID())).status, 404)
  assert.equal(row(requestId).status, '新要求')
})
test('內容格式錯誤：400', async () => {
  const ids = client(), requestId = await submit(ids)
  assert.equal((await cancel(ids, requestId, null)).status, 400)
  assert.equal((await cancel(ids, requestId, [])).status, 400)
  assert.equal((await cancel(ids, requestId, { reason: 1 })).status, 400)
  assert.equal((await cancel(ids, requestId, { reason: 'x', other: 1 })).status, 400)
  assert.equal(row(requestId).status, '新要求')
})
test('員工和管理者不能用客戶的取消接口', async () => {
  const ids = client(), requestId = await submit(ids)
  assert.equal((await request(`/my/requests/${requestId}/cancel`, 'POST', {}, 'staff')).status, 403)
  assert.equal((await request(`/my/requests/${requestId}/cancel`, 'POST', {}, 'admin')).status, 403)
})
test('今日工作列出客戶取消的委託，按知道了後不再列出', async () => {
  const ids = client(), requestId = await submit(ids)
  await cancel(ids, requestId, { reason: '改變主意' })
  const before = (await request('/today-counts', 'GET', undefined, 'staff')).body.clientCancels
  const listed = (await request('/client-cancels', 'GET', undefined, 'staff')).body.find(item => item.id === requestId)
  assert.equal(listed.reason, '改變主意')
  assert.equal((await request(`/client-cancels/${requestId}/seen`, 'POST', {}, 'staff')).status, 200)
  assert.ok(!(await request('/client-cancels', 'GET', undefined, 'staff')).body.some(item => item.id === requestId))
  assert.equal((await request('/today-counts', 'GET', undefined, 'staff')).body.clientCancels, before - 1)
})
test('客戶不能看今日工作的取消清單', async () => {
  const ids = client()
  assert.equal((await request('/client-cancels', 'GET', undefined, ids.token)).status, 403)
})
test('員工自己取消的工單不列在客戶取消清單', async () => {
  const ids = client(), requestId = await submit(ids)
  state.db.prepare("UPDATE requests SET status='已取消', cancelled_reason='員工取消' WHERE id=?").run(requestId)
  assert.ok(!(await request('/client-cancels', 'GET', undefined, 'staff')).body.some(item => item.id === requestId))
})
