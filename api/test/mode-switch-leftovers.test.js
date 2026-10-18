import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 托管轉自管的提示（docs/tasks/self-managed-fixes-plan.md 第 5 步）：仍由我們代收的出租、托管時期未完成的工單。只提示，不改資料
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'mode-leftovers-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', stamp())
  for (const [token, role, tenant] of [['admin', 'admin', 'default'], ['staff', 'staff', 'default'], ['other-admin', 'admin', 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('LeftoverPass123'), tenant, token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.75.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
function customer(tenant = 'default') {
  const id = randomUUID(), plate = randomUUID()
  state.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(id, `客戶${++seq}`, '個人', tenant)
  state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?)').run(plate, id, '粵港', `CARD-${seq}`, stamp(), stamp(), '{}')
  return { id, plate }
}
function rental(c, { collection = '代收', status = '生效', tenant = 'default' } = {}) {
  state.db.prepare('INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,starts_on,collection_mode,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, c.plate, '租客', '2026-01-01', collection, status, stamp(), stamp())
}
function order(c, { status = '處理中', createdAt = stamp() } = {}) {
  state.db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), c.id, 'change_vehicle', '粵港', '換車', status, '辦理中', createdAt, createdAt)
}
const view = (c, token) => request(`/customers/${c.id}/service-mode`, 'GET', undefined, token)
const toSelf = async c => { const result = await request(`/customers/${c.id}/service-mode`, 'PUT', { mode: '自管' }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body }
const kinds = list => list.map(item => item.kind).sort()

// ── 切換之前（托管）：切換框列出 ──
test('托管客戶有代收出租：切換前列出，連到出租', async () => {
  const c = customer(); rental(c); rental(c)
  const item = (await view(c)).body.beforeSelfManaged.find(entry => entry.kind === 'collected_rentals')
  assert.match(item.text, /有 2 份出租由我們代收/)
  assert.deepEqual(item.link.to, { path: '/rentals', query: { customerId: c.id } })
})
test('托管客戶有未完成工單：切換前列出，連到客戶業務', async () => {
  const c = customer(); order(c)
  const item = (await view(c)).body.beforeSelfManaged.find(entry => entry.kind === 'open_orders')
  assert.match(item.text, /有 1 張工單未完成/)
  assert.deepEqual(item.link.to, { path: `/customers/${c.id}`, query: { tab: 'business' } })
})
test('托管客戶沒有代收出租、沒有未完成工單：切換前不列出', async () => {
  const c = customer()
  assert.deepEqual((await view(c)).body.beforeSelfManaged, [])
})
test('直付、已結束、已終止、作廢的出租不算代收', async () => {
  const c = customer(); rental(c, { collection: '直付' }); rental(c, { status: '已結束' }); rental(c, { status: '已終止' }); rental(c, { status: '作廢' })
  assert.deepEqual((await view(c)).body.beforeSelfManaged, [])
})
test('草擬和待換車的代收出租也算', async () => {
  const c = customer(); rental(c, { status: '草擬' }); rental(c, { status: '待換車' })
  assert.match((await view(c)).body.beforeSelfManaged[0].text, /有 2 份出租/)
})
test('已完成、已取消的工單不算', async () => {
  const c = customer(); order(c, { status: '已完成' }); order(c, { status: '已取消' })
  assert.deepEqual((await view(c)).body.beforeSelfManaged, [])
})
test('別的客戶的出租和工單不算', async () => {
  const c = customer(), other = customer(); rental(other); order(other)
  assert.deepEqual((await view(c)).body.beforeSelfManaged, [])
})

// ── 切換之後（自管）：客戶頁「對不上」提示 ──
test('切換為自管後仍有代收出租：提示', async () => {
  const c = customer(); rental(c)
  const after = await toSelf(c)
  assert.ok(after.warnings.some(item => item.kind === 'collected_rentals' && /仍有 1 份出租由我們代收/.test(item.text)))
})
test('切換為自管後仍有托管時期的工單：提示', async () => {
  const c = customer(); order(c, { createdAt: '2026-01-01T00:00:00.000Z' })
  const after = await toSelf(c)
  assert.ok(after.warnings.some(item => item.kind === 'open_orders' && /仍有 1 張托管時期的工單未完成/.test(item.text)))
})
test('自管期間新開的按次委託不算托管時期的工單', async () => {
  const c = customer()
  await toSelf(c)
  order(c, { createdAt: '2099-01-01T00:00:00.000Z' })
  assert.ok(!(await view(c)).body.warnings.some(item => item.kind === 'open_orders'))
})
test('一開始就是自管的客戶：未完成的工單不算托管時期', async () => {
  const c = customer()
  state.db.prepare("UPDATE customers SET service_mode='自管' WHERE id=?").run(c.id)
  order(c, { createdAt: '2026-01-01T00:00:00.000Z' })
  assert.ok(!(await view(c)).body.warnings.some(item => item.kind === 'open_orders'))
})
test('工單辦完、出租改為直付後，提示消失', async () => {
  const c = customer(); rental(c); order(c, { createdAt: '2026-01-01T00:00:00.000Z' })
  await toSelf(c)
  state.db.prepare("UPDATE requests SET status='已完成' WHERE customer_id=?").run(c.id)
  state.db.prepare("UPDATE rental_contracts SET collection_mode='直付' WHERE plate_asset_id=?").run(c.plate)
  const warnings = (await view(c)).body.warnings
  assert.ok(!warnings.some(item => ['collected_rentals', 'open_orders'].includes(item.kind)))
})
test('自管客戶不再有切換前的提示', async () => {
  const c = customer(); rental(c)
  assert.deepEqual((await toSelf(c)).beforeSelfManaged, [])
})
test('切換只提示，不改出租和工單', async () => {
  const c = customer(); rental(c); order(c)
  await toSelf(c)
  assert.equal(state.db.prepare("SELECT collection_mode FROM rental_contracts WHERE plate_asset_id=?").get(c.plate).collection_mode, '代收')
  assert.equal(state.db.prepare('SELECT status FROM requests WHERE customer_id=?').get(c.id).status, '處理中')
})
test('切回托管後不再有自管的提示', async () => {
  const c = customer(); rental(c)
  await toSelf(c)
  const back = await request(`/customers/${c.id}/service-mode`, 'PUT', { mode: '托管' })
  assert.equal(back.status, 200)
  assert.ok(!back.body.warnings.some(item => item.kind === 'collected_rentals'))
  assert.ok(back.body.beforeSelfManaged.some(item => item.kind === 'collected_rentals'))
})

// ── 權限 ──
test('員工可以看到提示', async () => {
  const c = customer(); rental(c)
  assert.equal((await view(c, 'staff')).body.beforeSelfManaged.length, 1)
})
test('別的租戶看不到這位客戶', async () => {
  const c = customer(); rental(c)
  assert.equal((await view(c, 'other-admin')).status, 404)
})
test('別的租戶的同名資料不會算進來', async () => {
  const c = customer(), foreign = customer('other'); rental(foreign, { tenant: 'other' }); order(foreign)
  assert.deepEqual(kinds((await view(c)).body.beforeSelfManaged), [])
})
