import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 要選牌照的委託（docs/tasks/self-managed-fixes-plan.md 第 8 步）：客戶提交新申請、其他代辦要求以外的服務，必須選自己的牌照
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'request-plate-'))
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
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `reqplate${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const submit = (ids, body, token = ids.token) => request('/requests', 'POST', { route: '粵港', title: '測試要求', ...body }, token)
const NEED_PLATE = '請先選擇牌照；還沒有牌照請先新增牌照'

test('自管客戶沒有牌照時提交續期：400，請先新增牌照', async () => {
  const ids = client(), result = await submit(ids, { serviceCode: 'renewal' })
  assert.equal(result.status, 400)
  assert.equal(result.body.error, NEED_PLATE)
})
test('托管客戶沒有選牌照時提交換車：同樣 400', async () => {
  const ids = client('托管')
  assert.equal((await submit(ids, { serviceCode: 'vehicle_change' })).body.error, NEED_PLATE)
})
test('牌照是空字串或 null：當作沒有選', async () => {
  const ids = client()
  assert.equal((await submit(ids, { serviceCode: 'replacement', plateAssetId: '' })).body.error, NEED_PLATE)
  assert.equal((await submit(ids, { serviceCode: 'replacement', plateAssetId: null })).body.error, NEED_PLATE)
})
test('新申請不用選牌照', async () => {
  const ids = client()
  assert.equal((await submit(ids, { serviceCode: 'new_application' })).status, 201)
})
test('其他代辦要求可以不指定牌照', async () => {
  const ids = client()
  assert.equal((await submit(ids, { serviceCode: 'other' })).status, 201)
})
test('選了自己的牌照：可以提交', async () => {
  const ids = client(), plateId = await plate(ids)
  assert.equal((await submit(ids, { serviceCode: 'renewal', plateAssetId: plateId })).status, 201)
})
test('選了別人的牌照：400', async () => {
  const owner = client(), other = client(), plateId = await plate(owner)
  assert.equal((await submit(other, { serviceCode: 'renewal', plateAssetId: plateId })).status, 400)
})
test('選了另一條路線的牌照：400', async () => {
  const ids = client(), plateId = await plate(ids, {}, '粵澳')
  assert.equal((await submit(ids, { serviceCode: 'renewal', plateAssetId: plateId })).status, 400)
})
test('管理者建立案件照舊可以不選牌照', async () => {
  const ids = client()
  assert.equal((await submit(ids, { serviceCode: 'renewal', customerId: ids.customer }, 'admin')).status, 201)
})
