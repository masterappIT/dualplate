import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶在客戶端看自己上傳的批文卡正本照片：只看得到自己名下的，正本照原樣取回
const state = {}
const front = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'card-original-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant] of [['first', '測試客戶甲', 'default'], ['second', '測試客戶乙', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['second-client', 'customer', state.second, 'default'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  state.plate = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵港', cardData: { cardNumber: 'ORIG-001' }, cardImages: { front: `data:image/png;base64,${front.toString('base64')}` } }, 'client')).body.id
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.57.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, headers: this.headers, raw: data, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const original = (side, token = 'client', id = state.plate) => request(`/plate-assets/${id}/image/card-${side}`, 'GET', undefined, token)

test('客戶可取回自己上傳的批文卡正本', async () => {
  const r = await original('front')
  assert.equal(r.status, 200)
  assert.equal(r.headers['content-type'], 'image/png')
  assert.deepEqual(Buffer.from(r.raw), front)
})
test('客戶取回正本不會被快取', async () => { assert.equal((await original('front')).headers['cache-control'], 'private, no-store') })
test('客戶的牌照詳情只標示有哪一面正本，不夾帶圖片內容', async () => {
  const r = await request(`/plate-assets/${state.plate}`, 'GET', undefined, 'client')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.cardImages, { front: true })
})
test('沒有上傳的那一面回 404', async () => { assert.equal((await original('back')).status, 404) })
test('同租戶其他客戶看不到正本', async () => { assert.equal((await original('front', 'second-client')).status, 404) })
test('其他租戶的客戶看不到正本', async () => { assert.equal((await original('front', 'foreign-client')).status, 404) })
test('不存在的牌照回 404', async () => { assert.equal((await original('front', 'client', randomUUID())).status, 404) })
test('未登入不能取回正本', async () => { assert.equal((await original('front', '')).status, 401) })
test('員工可取回客戶上傳的正本核對', async () => {
  const r = await original('front', 'staff')
  assert.equal(r.status, 200)
  assert.deepEqual(Buffer.from(r.raw), front)
})
test('員工打開牌照時拿到可顯示的原件圖片', async () => {
  const r = await request(`/plate-assets/${state.plate}`, 'GET', undefined, 'staff')
  assert.equal(r.status, 200)
  const [header, data] = r.body.cardImages.front.split(',')
  assert.equal(header, 'data:image/png;base64')
  assert.deepEqual(Buffer.from(data, 'base64'), front)
})
test('客戶重新上傳一面後取回的是新照片', async () => {
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
  const upload = await request(`/plate-assets/${state.plate}/card/front`, 'POST', { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` }, 'client')
  assert.equal(upload.status, 200)
  const r = await original('front')
  assert.equal(r.headers['content-type'], 'image/jpeg')
  assert.deepEqual(Buffer.from(r.raw), jpeg)
})
test('伺服器仍拒絕壓縮後超過 3.5 MB 的照片', async () => {
  const big = Buffer.alloc(3500001, 1).toString('base64')
  const r = await request(`/plate-assets/${state.plate}/card/back`, 'POST', { image: `data:image/jpeg;base64,${big}` }, 'client')
  assert.equal(r.status, 400)
  assert.equal((await original('back')).status, 404)
})
