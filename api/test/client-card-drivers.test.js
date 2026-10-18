import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶建檔時按批文卡登記司機（docs/tasks/self-managed-fixes-plan.md 第 3 步）：與員工「按批文卡登記」同一做法；
// 客戶修改批文卡駕駛人時重新登記，沒有改駕駛人就不動登記
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'card-drivers-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  const uid = randomUUID()
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, 'admin', '管理者', 'admin@test.invalid', hashPassword('DriverPass123'), 'default', 'admin')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run('admin', uid, '2099-01-01T00:00:00Z', stamp())
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.73.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
function client(mode = '自管') {
  const { db, hashPassword } = state, n = ++seq, ids = { customer: randomUUID(), user: randomUUID(), token: `client-${n}` }
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(ids.customer, `客戶${n}`, '個人', 'default', mode)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `drivers${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
const card = (extra = {}) => ({ cardNumber: `10${++seq}`, mainlandPlate: `粵Z${seq}港`, ...extra })
async function create(ids, cardData, token = ids.token) {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const registered = plateId => state.db.prepare('SELECT d.name, pd.role FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY pd.sort').all(plateId).map(row => `${row.name}:${row.role}`)
const driverCount = customerId => state.db.prepare('SELECT COUNT(*) count FROM drivers WHERE customer_id=?').get(customerId).count

test('自管客戶建檔：按批文卡駕駛人登記司機，駕駛人 1 為主司機', async () => {
  const ids = client(), plate = await create(ids, card({ driver1: '陳大文', driver2: '李小明', driver3: '黃志強' }))
  assert.deepEqual(registered(plate), ['陳大文:主', '李小明:副', '黃志強:副'])
  assert.equal(driverCount(ids.customer), 3)
})
test('托管客戶建檔：同樣按批文卡登記司機', async () => {
  const ids = client('托管'), plate = await create(ids, card({ driver1: '張三' }))
  assert.deepEqual(registered(plate), ['張三:主'])
})
test('批文卡沒有駕駛人：不建立司機，也不登記', async () => {
  const ids = client(), plate = await create(ids, card())
  assert.deepEqual(registered(plate), [])
  assert.equal(driverCount(ids.customer), 0)
})
test('同一客戶已有同名司機：沿用，不重複建立', async () => {
  const ids = client()
  await create(ids, card({ driver1: '陳大文' }))
  const second = await create(ids, card({ driver1: '陳大文', driver2: '李小明' }))
  assert.deepEqual(registered(second), ['陳大文:主', '李小明:副'])
  assert.equal(driverCount(ids.customer), 2)
})
test('批文卡上同一個名字出現兩次：只登記一次', async () => {
  const ids = client(), plate = await create(ids, card({ driver1: '陳大文', driver2: '陳大文' }))
  assert.deepEqual(registered(plate), ['陳大文:主'])
})
test('別的客戶的同名司機不會被沿用', async () => {
  const mine = client(), theirs = client()
  await create(theirs, card({ driver1: '陳大文' }))
  const plate = await create(mine, card({ driver1: '陳大文' }))
  const owner = state.db.prepare('SELECT d.customer_id FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=?').get(plate).customer_id
  assert.equal(owner, mine.customer)
})
test('客戶修改批文卡駕駛人：按新的批文卡重新登記，舊司機資料保留', async () => {
  const ids = client(), cardData = card({ driver1: '陳大文', driver2: '李小明' }), plate = await create(ids, cardData)
  const result = await request(`/plate-assets/${plate}`, 'PUT', { cardData: { ...cardData, driver2: '黃志強' } }, ids.token)
  assert.equal(result.status, 200)
  assert.deepEqual(registered(plate), ['陳大文:主', '黃志強:副'])
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM drivers WHERE customer_id=? AND name=?').get(ids.customer, '李小明').count, 1)
})
test('客戶修改批文卡但沒有改駕駛人：司機登記不變（保留之後調整過的登記）', async () => {
  const ids = client(), cardData = card({ driver1: '陳大文', driver2: '李小明' }), plate = await create(ids, cardData)
  // 之後把副司機調走（例如經「自行換司機」或員工調整）
  state.db.prepare("DELETE FROM plate_drivers WHERE plate_asset_id=? AND role='副'").run(plate)
  assert.equal((await request(`/plate-assets/${plate}`, 'PUT', { cardData: { ...cardData, serial: '00999999' } }, ids.token)).status, 200)
  assert.deepEqual(registered(plate), ['陳大文:主'])
})
test('客戶把批文卡駕駛人全部清空：不會刪掉現有登記', async () => {
  const ids = client(), cardData = card({ driver1: '陳大文' }), plate = await create(ids, cardData)
  assert.equal((await request(`/plate-assets/${plate}`, 'PUT', { cardData: { ...cardData, driver1: '' } }, ids.token)).status, 200)
  assert.deepEqual(registered(plate), ['陳大文:主'])
})
test('管理者在後台建檔：照舊不自動登記（後台用「按批文卡登記」）', async () => {
  const ids = client('托管'), plate = await create(ids, card({ driver1: '王五' }), 'admin')
  assert.deepEqual(registered(plate), [])
})
test('管理者修改批文卡駕駛人：照舊不自動登記', async () => {
  const ids = client('托管'), cardData = card({ driver1: '王五' }), plate = await create(ids, cardData, 'admin')
  assert.equal((await request(`/plate-assets/${plate}`, 'PUT', { cardData: { ...cardData, driver1: '趙六' } })).status, 200)
  assert.deepEqual(registered(plate), [])
})
