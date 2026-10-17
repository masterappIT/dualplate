import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶在客戶端修改及建檔自己的批文卡：改後一律回到待核對，員工不能改
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'customer-card-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant] of [['first', '測試客戶甲', 'default'], ['second', '測試客戶乙', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  state.own = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵港', cardData: { cardNumber: 'OWN-001', company: '原商號' } })).body.id
  state.other = (await request('/plate-assets', 'POST', { customerId: state.second, route: '粵港', cardData: { cardNumber: 'OTHER-001', company: '乙商號' } })).body.id
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.56.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const saveCard = (id, cardData, token = 'client') => request(`/plate-assets/${id}`, 'PUT', { cardData }, token)
const createCard = (body, token = 'client') => request('/plate-assets', 'POST', body, token)
const row = id => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(id)

test('客戶可修改自己的批文卡內容', async () => {
  const r = await saveCard(state.own, { cardNumber: 'OWN-001', company: '客戶改的商號', mainlandPlate: '粵Z1234港', validTo: '2027-12-31' })
  assert.equal(r.status, 200)
  assert.equal(r.body.cardData.company, '客戶改的商號')
  assert.equal(row(state.own).mainland_plate, '粵Z1234港')
  assert.equal(row(state.own).card_expires_on, '2027-12-31')
})
test('客戶修改已核對的批文卡後回到待核對', async () => {
  assert.equal((await saveCard(state.own, { cardNumber: 'OWN-001', company: '專員核對' }, 'admin')).status, 200)
  assert.equal(row(state.own).card_status, '已核對')
  assert.equal((await saveCard(state.own, { cardNumber: 'OWN-001', company: '客戶再改' })).status, 200)
  assert.equal(row(state.own).card_status, '待核對')
  assert.equal(row(state.own).card_updated_by, 'client')
})
test('客戶修改批文卡不能清空編號', async () => {
  const r = await saveCard(state.own, { cardNumber: '   ', company: '無編號' })
  assert.equal(r.status, 400); assert.equal(r.body.error, '批文卡編號不能留空')
  assert.equal(row(state.own).card_number, 'OWN-001')
})
test('客戶修改批文卡拒絕缺少 cardData', async () => { assert.equal((await request(`/plate-assets/${state.own}`, 'PUT', {}, 'client')).status, 400) })
test('客戶修改批文卡拒絕 null 內容', async () => { assert.equal((await request(`/plate-assets/${state.own}`, 'PUT', null, 'client')).status, 400) })
test('客戶修改批文卡拒絕陣列內容', async () => { assert.equal((await request(`/plate-assets/${state.own}`, 'PUT', [], 'client')).status, 400) })
test('客戶修改批文卡拒絕陣列 cardData', async () => { assert.equal((await saveCard(state.own, ['OWN-001'])).status, 400) })
test('客戶修改批文卡拒絕字串 cardData', async () => { assert.equal((await saveCard(state.own, 'OWN-001')).status, 400) })
test('客戶修改批文卡不能用名下另一張卡的編號', async () => {
  const second = (await createCard({ customerId: state.first, route: '粵港', cardData: { cardNumber: 'OWN-002' } })).body.id
  const r = await saveCard(second, { cardNumber: 'OWN-001' })
  assert.equal(r.status, 409); assert.equal(row(second).card_number, 'OWN-002')
})
test('客戶不能修改同租戶其他客戶的批文卡', async () => {
  const r = await saveCard(state.other, { cardNumber: 'OTHER-001', company: '越權修改' })
  assert.equal(r.status, 404); assert.equal(JSON.parse(row(state.other).card_data).company, '乙商號')
})
test('其他租戶的客戶不能修改批文卡', async () => { assert.equal((await saveCard(state.own, { cardNumber: 'OWN-001', company: '越權' }, 'foreign-client')).status, 404) })
test('客戶修改不存在的牌照回 404', async () => { assert.equal((await saveCard(randomUUID(), { cardNumber: 'X-1' })).status, 404) })
test('員工不能修改批文卡', async () => { assert.equal((await saveCard(state.own, { cardNumber: 'OWN-001', company: '員工改' }, 'staff')).status, 403) })
test('未登入不能修改批文卡', async () => { assert.equal((await saveCard(state.own, { cardNumber: 'OWN-001' }, '')).status, 401) })
test('客戶重複儲存相同內容仍成功', async () => {
  const card = { cardNumber: 'OWN-001', company: '重複儲存' }
  assert.equal((await saveCard(state.own, card)).status, 200)
  assert.equal((await saveCard(state.own, card)).status, 200)
})

test('客戶可為自己建檔批文卡並標為待核對', async () => {
  const r = await createCard({ customerId: state.first, route: '粵澳', cardData: { cardNumber: 'NEW-001', company: '客戶建檔' } })
  assert.equal(r.status, 201)
  assert.equal(row(r.body.id).customer_id, state.first)
  assert.equal(row(r.body.id).card_status, '待核對')
})
test('客戶不能為其他客戶建檔', async () => {
  const r = await createCard({ customerId: state.second, route: '粵港', cardData: { cardNumber: 'NEW-OTHER' } })
  assert.equal(r.status, 403); assert.equal(r.body.error, '只能建立自己的兩地牌')
})
test('客戶不能為其他租戶客戶建檔', async () => { assert.equal((await createCard({ customerId: state.foreign, route: '粵港', cardData: { cardNumber: 'NEW-FOREIGN' } })).status, 403) })
test('客戶建檔不能重複同一張批文卡', async () => { assert.equal((await createCard({ customerId: state.first, route: '粵澳', cardData: { cardNumber: 'NEW-001' } })).status, 409) })
test('客戶建檔必須有批文卡編號', async () => { assert.equal((await createCard({ customerId: state.first, route: '粵港', cardData: { cardNumber: ' ' } })).status, 400) })
test('客戶建檔拒絕無效路線', async () => { assert.equal((await createCard({ customerId: state.first, route: '粵京', cardData: { cardNumber: 'NEW-ROUTE' } })).status, 400) })
test('客戶建檔拒絕缺少客戶', async () => { assert.equal((await createCard({ route: '粵港', cardData: { cardNumber: 'NEW-NOCUST' } })).status, 400) })
test('客戶建檔拒絕 null 內容', async () => { assert.equal((await request('/plate-assets', 'POST', null, 'client')).status, 400) })
test('客戶建檔拒絕陣列內容', async () => { assert.equal((await request('/plate-assets', 'POST', [], 'client')).status, 400) })
test('客戶建檔拒絕數字客戶 ID', async () => { assert.equal((await createCard({ customerId: 123, route: '粵港', cardData: { cardNumber: 'NEW-NUM' } })).status, 400) })
test('客戶建檔不能從申請案件建立', async () => { assert.equal((await createCard({ customerId: state.first, route: '粵港', sourceRequestId: randomUUID(), cardData: { cardNumber: 'NEW-REQ' } })).status, 403) })
test('員工不能建檔批文卡', async () => { assert.equal((await createCard({ customerId: state.first, route: '粵港', cardData: { cardNumber: 'NEW-STAFF' } }, 'staff')).status, 403) })
