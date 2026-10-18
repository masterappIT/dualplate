import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 用途（docs/tasks/self-managed-fixes-plan.md 第 11 步）：自管客戶自己填自用／出租中／空置；托管客戶照舊由我們記錄
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'self-usage-'))
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
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `usage${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const save = (ids, plateId, body) => request(`/plate-assets/${plateId}`, 'PATCH', body, ids.token)
const usage = plateId => state.db.prepare('SELECT usage_status FROM plate_assets WHERE id=?').get(plateId).usage_status
const activeRental = plateId => state.db.prepare("INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,starts_on,collection_mode,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', plateId, '租客', '2026-01-01', '直付', '生效', stamp(), stamp())

test('自管客戶填自用：儲存', async () => {
  const ids = client(), plateId = await plate(ids)
  assert.equal((await save(ids, plateId, { usageStatus: '自用' })).status, 200)
  assert.equal(usage(plateId), '自用')
})
test('自管客戶填空置：存為暫停使用', async () => {
  const ids = client(), plateId = await plate(ids)
  assert.equal((await save(ids, plateId, { usageStatus: '暫停使用' })).status, 200)
  assert.equal(usage(plateId), '暫停使用')
})
test('自管客戶不能直接填出租中：要在出租區新增出租', async () => {
  const ids = client(), plateId = await plate(ids)
  const result = await save(ids, plateId, { usageStatus: '出租中' })
  assert.equal(result.status, 400)
  assert.match(result.body.error, /出租區新增出租/)
})
test('自管客戶不能把用途改回待核對或亂填', async () => {
  const ids = client(), plateId = await plate(ids)
  await save(ids, plateId, { usageStatus: '自用' })
  assert.equal((await save(ids, plateId, { usageStatus: '待核對' })).status, 400)
  assert.equal((await save(ids, plateId, { usageStatus: '借給朋友' })).status, 400)
  assert.equal((await save(ids, plateId, { usageStatus: 1 })).status, 400)
  assert.equal(usage(plateId), '自用')
})
test('有生效中的出租時，自管客戶不能改成自用或空置', async () => {
  const ids = client(), plateId = await plate(ids)
  activeRental(plateId)
  state.db.prepare("UPDATE plate_assets SET usage_status='出租中' WHERE id=?").run(plateId)
  assert.equal((await save(ids, plateId, { usageStatus: '自用' })).status, 400)
  assert.equal(usage(plateId), '出租中')
})
test('托管客戶不能自己改用途', async () => {
  const ids = client('托管'), plateId = await plate(ids)
  assert.equal((await save(ids, plateId, { usageStatus: '自用' })).status, 403)
  assert.equal(usage(plateId), '待核對')
})
test('自管客戶不能改別人的牌照', async () => {
  const owner = client(), other = client(), plateId = await plate(owner)
  assert.equal((await save(other, plateId, { usageStatus: '自用' })).status, 404)
})
