import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 上牌狀態（docs/tasks/self-managed-fixes-plan.md 第 6 步，管理者 2026-10-18 改提示）：已上牌而沒有出租時要先綁定車輛，規則不變
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'install-status-'))
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
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `install${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const save = (ids, plateId, body) => request(`/plate-assets/${plateId}`, 'PATCH', body, ids.token)
const status = plateId => state.db.prepare('SELECT installation_status FROM plate_assets WHERE id=?').get(plateId).installation_status

test('自管客戶選已上牌但沒有綁定車輛：400，提示先綁定車輛', async () => {
  const ids = client(), plateId = await plate(ids)
  const result = await save(ids, plateId, { installationStatus: '已上牌' })
  assert.equal(result.status, 400)
  assert.equal(result.body.error, '已上牌請先綁定車輛')
  assert.equal(status(plateId), '待核對')
})
test('托管客戶選已上牌但沒有綁定車輛：同樣提示', async () => {
  const ids = client('托管'), plateId = await plate(ids)
  assert.equal((await save(ids, plateId, { installationStatus: '已上牌' })).body.error, '已上牌請先綁定車輛')
})
test('自管客戶選未上牌：儲存成功', async () => {
  const ids = client(), plateId = await plate(ids)
  assert.equal((await save(ids, plateId, { installationStatus: '未上牌' })).status, 200)
  assert.equal(status(plateId), '未上牌')
})
