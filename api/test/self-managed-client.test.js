import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管第一期第 3 步：客戶端知道自己是自管；自管客戶改資料、自行辦理不進員工核對清單；不產生月報
const state = {}
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) + '-10' }
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'self-managed-client-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  const stamp = new Date().toISOString()
  for (const [key, mode] of [['self', '自管'], ['custody', '托管']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(state[key], `客戶${key}`, '個人', 'default', mode)
    state[`${key}Plate`] = randomUUID()
    db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,card_expires_on,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(state[`${key}Plate`], state[key], '粵港', `粵Z${key}港`, `C-${key}`, '2027-01-01', '{}', stamp, stamp)
  }
  for (const [token, role, customer] of [['admin', 'admin', null], ['self-client', 'customer', state.self], ['custody-client', 'customer', state.custody]]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('ClientPass123'), customer, 'default', role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
  for (const key of ['self', 'custody']) db.prepare("INSERT INTO fee_items(id,tenant_id,customer_id,kind,description,currency,amount,incurred_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', state[key], 'service', '按次代辦', 'HKD', 50000, lastMonth(), stamp, stamp)
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.63.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const changeCount = customerId => state.db.prepare('SELECT COUNT(*) count FROM customer_changes WHERE customer_id=?').get(customerId).count

test('客戶首頁帶出自管或托管', async () => {
  assert.equal((await request('/my/overview', 'GET', undefined, 'self-client')).body.serviceMode, '自管')
  assert.equal((await request('/my/overview', 'GET', undefined, 'custody-client')).body.serviceMode, '托管')
})
test('客戶登入時帶回自管或托管', async () => {
  const login = async email => (await request('/login', 'POST', { email, password: 'ClientPass123' }, 'none')).body.user.serviceMode
  assert.equal(await login('self-client@test.invalid'), '自管')
  assert.equal(await login('custody-client@test.invalid'), '托管')
})
test('我的資料帶出自管或托管', async () => {
  assert.equal((await request('/my/profile', 'GET', undefined, 'self-client')).body.serviceMode, '自管')
  assert.equal((await request('/my/profile', 'GET', undefined, 'custody-client')).body.serviceMode, '托管')
})
test('自管客戶改資料即時生效，不進客戶更新待核對', async () => {
  assert.equal((await request('/my/customer', 'PATCH', { name: '自管新名' }, 'self-client')).status, 200)
  assert.equal(state.db.prepare('SELECT name FROM customers WHERE id=?').get(state.self).name, '自管新名')
  assert.equal(changeCount(state.self), 0)
})
test('托管客戶改資料照舊進客戶更新待核對', async () => {
  await request('/my/customer', 'PATCH', { name: '托管新名' }, 'custody-client')
  assert.equal(changeCount(state.custody), 1)
})
test('自管客戶自行辦理直接記為已核對，不進待核對清單', async () => {
  const result = await request(`/my/plates/${state.selfPlate}/self-handled`, 'POST', { kind: 'stop_renewal', reason: '放棄指標' }, 'self-client')
  assert.equal(result.status, 201, JSON.stringify(result.body))
  assert.equal(state.db.prepare('SELECT status FROM self_handled WHERE plate_asset_id=?').get(state.selfPlate).status, '已核對')
  assert.ok(!(await request('/self-handled')).body.some(item => item.plateId === state.selfPlate || item.plate_asset_id === state.selfPlate))
})
test('托管客戶自行辦理照舊待核對', async () => {
  assert.equal((await request(`/my/plates/${state.custodyPlate}/self-handled`, 'POST', { kind: 'stop_renewal', reason: '放棄指標' }, 'custody-client')).status, 201)
  assert.equal(state.db.prepare('SELECT status FROM self_handled WHERE plate_asset_id=?').get(state.custodyPlate).status, '待核對')
})
test('自管客戶不產生月報，托管客戶照舊產生', async () => {
  assert.equal((await request('/reports')).status, 200)
  const has = customerId => Boolean(state.db.prepare('SELECT 1 FROM monthly_reports WHERE customer_id=?').get(customerId))
  assert.equal(has(state.self), false); assert.equal(has(state.custody), true)
})

// ── 第 4 步：委託入口 ──
test('按次委託有定價時回傳「由 X 起」', async () => {
  state.db.prepare("INSERT INTO price_items(tenant_id,item_code,route,billing,currency,amount,updated_at) VALUES (?,?,?,?,?,?,?)").run('default', 'job:renewal', '粵港', 'per_time', 'HKD', 150000, new Date().toISOString())
  const result = await request('/my/entrust-price?service=renewal&route=粵港', 'GET', undefined, 'self-client')
  assert.equal(result.status, 200); assert.deepEqual(result.body.from, { amount: 150000, currency: 'HKD' }); assert.equal(result.body.name, '指標／牌證續期')
})
test('按次委託沒有定價時由顧問報價', async () => {
  const result = await request('/my/entrust-price?service=other&route=粵港', 'GET', undefined, 'self-client')
  assert.equal(result.status, 200); assert.equal(result.body.from, null)
})
test('按次參考價拒絕錯誤的服務或路線', async () => {
  for (const query of ['', '?service=x', '?service=renewal&route=粵京', '?service=']) assert.equal((await request(`/my/entrust-price${query}`, 'GET', undefined, 'self-client')).status, 400, query)
})
test('按次參考價只供客戶、只接受 GET', async () => {
  assert.equal((await request('/my/entrust-price?service=renewal', 'GET')).status, 403)
  assert.equal((await request('/my/entrust-price?service=renewal', 'POST', {}, 'self-client')).status, 405)
})
test('自管客戶提交長期委託洽談，員工在業務清單看到', async () => {
  const created = await request('/requests', 'POST', { serviceCode: 'other', route: '粵港', title: '長期委託洽談', description: '想交給你們管全部牌照續期' }, 'self-client')
  assert.equal(created.status, 201)
  const list = (await request('/requests')).body
  assert.ok(list.some(item => item.id === created.body.id && item.title === '長期委託洽談'))
})
test('客戶端的到期項目：自管客戶一律自行辦理，托管客戶照舊由我們負責', async () => {
  const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), stamp = new Date().toISOString(), fresh = {}
  for (const key of ['self', 'custody']) {
    fresh[key] = randomUUID()
    state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,card_expires_on,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(fresh[key], state[key], '粵港', `粵Z新${key}港`, `C-new-${key}`, soon, '{}', stamp, stamp)
  }
  const approval = async token => (await request('/my/overview', 'GET', undefined, token)).body.deadlines.find(item => item.code === 'approval' && Object.values(fresh).includes(item.ownerId))
  assert.equal((await approval('self-client')).handledBy, 'you')
  assert.equal((await approval('custody-client')).handledBy, 'us')
})
