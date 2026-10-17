import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 批文卡「只保存正本」（管理者 2026-10-18）：資料已對、只想留相片記錄，上傳不辨識、不改資料
const state = {}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const card = { cardNumber: 'SAVE-001', mainlandPlate: '粵Z12345港', localPlate: 'AB1234', driver1: '陳大文', validFrom: '2026-01-01', validTo: '2027-01-01' }
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'card-save-only-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, tenant] of [['first', 'default'], ['second', 'default'], ['foreign', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], `客戶${key}`, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['second-client', 'customer', state.second, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('SaveOnlyPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.58.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, raw: data, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
// 已核對的牌照：只保存正本後應保持原狀
function checkedPlate(customer = state.first) {
  const id = randomUUID(), now = new Date().toISOString()
  state.db.prepare("INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,card_number,card_expires_on,card_data,card_status,card_updated_by,card_updated_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'已核對','代辦主管','2026-01-02T00:00:00.000Z',?,?)")
    .run(id, customer, '粵港', card.mainlandPlate, card.localPlate, card.cardNumber, card.validTo, JSON.stringify(card), now, now)
  return id
}
const row = id => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(id)
const saveOnly = (id, side = 'front', token = 'admin', extra = {}) => request(`/plate-assets/${id}/card/${side}`, 'POST', { image: png, recognize: false, ...extra }, token)

test('只保存正本：相片存好，回應標明沒有辨識', async () => {
  const id = checkedPlate()
  const result = await saveOnly(id)
  assert.equal(result.status, 200)
  assert.equal(result.body.savedOnly, true); assert.deepEqual(result.body.fieldStatus, {}); assert.equal(result.body.needsReview, false)
  assert.ok(state.db.prepare("SELECT 1 FROM approval_card_images WHERE plate_asset_id=? AND side='front'").get(id))
})
test('只保存正本不改批文卡資料', async () => {
  const id = checkedPlate()
  await saveOnly(id)
  assert.deepEqual(JSON.parse(row(id).card_data), card)
})
test('只保存正本不改核對狀態和最後更新人', async () => {
  const id = checkedPlate()
  await saveOnly(id, 'back')
  assert.equal(row(id).card_status, '已核對'); assert.equal(row(id).card_updated_by, '代辦主管'); assert.equal(row(id).card_updated_at, '2026-01-02T00:00:00.000Z')
})
test('只保存正本不改車牌、卡號和到期日', async () => {
  const id = checkedPlate()
  await saveOnly(id)
  const after = row(id)
  assert.deepEqual([after.mainland_plate, after.local_plate, after.card_number, after.card_expires_on], [card.mainlandPlate, card.localPlate, card.cardNumber, card.validTo])
})
test('客戶只保存正本不列入客戶更新待核對', async () => {
  const id = checkedPlate()
  assert.equal((await saveOnly(id, 'front', 'client')).status, 200)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM customer_changes WHERE entity_id=?').get(id).count, 0)
})
test('重新只保存正本會換成新相片', async () => {
  const id = checkedPlate()
  await saveOnly(id)
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`
  await request(`/plate-assets/${id}/card/front`, 'POST', { image: jpeg, recognize: false })
  const images = state.db.prepare("SELECT mime FROM approval_card_images WHERE plate_asset_id=? AND side='front'").all(id)
  assert.deepEqual(images.map(image => image.mime), ['image/jpeg'])
})
test('員工也可只保存正本', async () => { assert.equal((await saveOnly(checkedPlate(), 'front', 'staff')).status, 200) })
test('其他客戶、其他租戶不能只保存正本', async () => {
  const id = checkedPlate()
  assert.equal((await saveOnly(id, 'front', 'second-client')).status, 404)
  assert.equal((await saveOnly(id, 'front', 'foreign-admin')).status, 404)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM approval_card_images WHERE plate_asset_id=?').get(id).count, 0)
})
test('不存在的牌照、錯誤的卡面 404', async () => {
  assert.equal((await saveOnly(randomUUID())).status, 404)
  assert.equal((await request(`/plate-assets/${checkedPlate()}/card/middle`, 'POST', { image: png, recognize: false })).status, 404)
})
test('上傳方式不是 true／false 時拒絕，資料不變', async () => {
  const id = checkedPlate()
  for (const recognize of ['false', 0, null, [], {}]) assert.equal((await saveOnly(id, 'front', 'admin', { recognize })).status, 400, JSON.stringify(recognize))
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM approval_card_images WHERE plate_asset_id=?').get(id).count, 0)
  assert.deepEqual(JSON.parse(row(id).card_data), card)
})
test('只保存正本仍要合格的圖片', async () => {
  const id = checkedPlate()
  for (const image of [undefined, '', 'data:application/pdf;base64,JVBERi0=', 123]) assert.equal((await request(`/plate-assets/${id}/card/front`, 'POST', { image, recognize: false })).status, 400, String(image))
})
test('沒有指定上傳方式時照舊辨識並標待核對', { timeout: 120000 }, async () => {
  const id = checkedPlate()
  const result = await request(`/plate-assets/${id}/card/front`, 'POST', { image: png })
  assert.equal(result.status, 200); assert.notEqual(result.body.savedOnly, true); assert.equal(row(id).card_status, '待核對')
})
