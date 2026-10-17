import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管第一期第 5 步：app 內文字訊息（共用收件匣）、WhatsApp／微信聯絡方式
const state = {}
const png = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64')
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'support-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword, ensureSelfCustomer } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  ensureSelfCustomer('default')
  state.selfCo = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  for (const [key, mode, tenant] of [['self', '自管', 'default'], ['custody', '托管', 'default'], ['foreign', '自管', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(state[key], `客戶${key}`, '個人', tenant, mode)
  }
  const stamp = new Date().toISOString()
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['self-client', 'customer', state.self, 'default'], ['custody-client', 'customer', state.custody, 'default'], ['foreign-client', 'customer', state.foreign, 'other'], ['other-admin', 'admin', null, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('SupportPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.64.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const send = (body, token = 'self-client') => request('/my/messages', 'POST', body, token)
const reply = (customerId, body, token = 'staff') => request(`/support/conversations/${customerId}`, 'POST', body, token)

// ── 客戶發訊息 ──
test('自管客戶在 app 內發訊息，自動帶出帳號', async () => {
  const result = await send({ body: '  請問批文續期要準備甚麼？ ' })
  assert.equal(result.status, 201)
  assert.equal(result.body.messages.at(-1).body, '請問批文續期要準備甚麼？'); assert.equal(result.body.messages.at(-1).fromStaff, false)
  assert.equal(state.db.prepare('SELECT customer_id FROM support_messages WHERE body=?').get('請問批文續期要準備甚麼？').customer_id, state.self)
})
test('自管客戶可以發訊息，托管客戶不顯示發訊息', async () => {
  assert.equal((await request('/my/messages', 'GET', undefined, 'self-client')).body.canSend, true)
  assert.equal((await request('/my/messages', 'GET', undefined, 'custody-client')).body.canSend, false)
})
test('托管客戶發訊息被拒，請直接聯絡顧問', async () => {
  const result = await send({ body: '你好' }, 'custody-client')
  assert.equal(result.status, 403); assert.match(result.body.error, /顧問/)
})
test('訊息空白、錯誤類型、多餘欄位、過長都被拒', async () => {
  for (const body of [{}, { body: '' }, { body: '   ' }, { body: null }, { body: 5 }, { body: ['a'] }, { body: '你好', customerId: state.custody }, { body: 'x'.repeat(1001) }]) assert.equal((await send(body)).status, 400, JSON.stringify(body).slice(0, 40))
})
test('null 或陣列請求內容被拒', async () => {
  assert.equal((await send('null')).status, 400)
  assert.equal((await send('[]')).status, 400)
})
test('一小時內發太多訊息會被擋', async () => {
  const uid = randomUUID(), stamp = new Date().toISOString()
  for (let i = 0; i < 30; i += 1) state.db.prepare('INSERT INTO support_messages(id,tenant_id,customer_id,from_staff,sender_id,sender_name,body,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'other', state.foreign, 0, uid, '洗版', `第${i}則`, stamp)
  assert.equal((await send({ body: '再來一則' }, 'foreign-client')).status, 429)
})
test('員工和管理者不能用客戶的訊息接口', async () => {
  for (const token of ['admin', 'staff']) assert.equal((await request('/my/messages', 'GET', undefined, token)).status, 403)
})
test('客戶訊息只接受 GET 和 POST', async () => {
  assert.equal((await request('/my/messages', 'PUT', { body: 'x' }, 'self-client')).status, 405)
})

// ── 員工收件匣 ──
test('收件匣列出有訊息的客戶和未讀數，未讀排最前', async () => {
  const list = (await request('/support/inbox', 'GET', undefined, 'staff')).body
  const row = list.find(item => item.customerId === state.self)
  assert.ok(row); assert.equal(row.unread, 1); assert.equal(row.customerName, '客戶self'); assert.equal(row.serviceMode, '自管')
  assert.ok(!list.some(item => item.customerId === state.foreign))
})
test('員工打開對話後客戶訊息變已讀', async () => {
  const convo = await request(`/support/conversations/${state.self}`, 'GET', undefined, 'staff')
  assert.equal(convo.status, 200); assert.equal(convo.body.customer.name, '客戶self')
  assert.equal((await request('/support/inbox', 'GET', undefined, 'staff')).body.find(item => item.customerId === state.self).unread, 0)
})
test('員工回覆後客戶收到通知，打開對話即已讀', async () => {
  const result = await reply(state.self, { body: '要準備批文卡正本和身份證明。' })
  assert.equal(result.status, 201)
  const notice = state.db.prepare("SELECT * FROM notifications WHERE customer_id=? AND kind='support_reply'").get(state.self)
  assert.ok(notice); assert.equal(notice.link, '/pages/messages/messages')
  const mine = (await request('/my/messages', 'GET', undefined, 'self-client')).body.messages
  const last = mine.at(-1)
  assert.equal(last.fromStaff, true); assert.equal(last.senderName, 'staff名')
  assert.equal(state.db.prepare('SELECT read_at FROM support_messages WHERE body=?').get('要準備批文卡正本和身份證明。').read_at !== null, true)
})
test('員工可以主動聯絡沒有訊息的客戶', async () => {
  assert.equal((await reply(state.custody, { body: '你好，有事可以找我們。' }, 'admin')).status, 201)
})
test('員工回覆空白或多餘欄位被拒', async () => {
  for (const body of [{}, { body: ' ' }, { body: 1 }, { body: 'x', from: 'y' }]) assert.equal((await reply(state.self, body)).status, 400)
})
test('別的租戶、不存在或本公司自有的對話找不到', async () => {
  assert.equal((await reply(state.foreign, { body: 'x' })).status, 404)
  assert.equal((await request(`/support/conversations/${randomUUID()}`, 'GET', undefined, 'staff')).status, 404)
  assert.equal((await request(`/support/conversations/${state.selfCo}`, 'GET', undefined, 'staff')).status, 404)
  assert.equal((await request(`/support/conversations/${state.self}`, 'GET', undefined, 'other-admin')).status, 404)
})
test('客戶不能用員工收件匣', async () => {
  assert.equal((await request('/support/inbox', 'GET', undefined, 'self-client')).status, 403)
  assert.equal((await reply(state.self, { body: 'x' }, 'self-client')).status, 403)
})
test('收件匣只接受 GET，對話只接受 GET 和 POST', async () => {
  assert.equal((await request('/support/inbox', 'POST', {})).status, 405)
  assert.equal((await request(`/support/conversations/${state.self}`, 'DELETE')).status, 405)
})

// ── WhatsApp／微信聯絡方式 ──
test('管理者設定 WhatsApp、微信號、二維碼和企業微信連結', async () => {
  const result = await request('/support/contact', 'PUT', { whatsapp: '+852 9123 4567', wechatId: 'plate_service', wechatQr: png, wecomLink: 'https://work.weixin.qq.com/kfid/kfc123' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { whatsapp: '+85291234567', whatsappLink: 'https://wa.me/85291234567', wechatId: 'plate_service', wechatQr: png, wecomLink: 'https://work.weixin.qq.com/kfid/kfc123' })
})
test('客戶看到聯絡方式', async () => {
  const result = await request('/my/contact', 'GET', undefined, 'custody-client')
  assert.equal(result.status, 200); assert.equal(result.body.whatsappLink, 'https://wa.me/85291234567'); assert.equal(result.body.wechatId, 'plate_service')
})
test('只改提供的欄位，空字串即清除', async () => {
  const result = await request('/support/contact', 'PUT', { wecomLink: '' })
  assert.equal(result.body.wecomLink, ''); assert.equal(result.body.wechatId, 'plate_service')
})
test('聯絡方式格式不對被拒', async () => {
  for (const body of [{}, { whatsapp: '123' }, { whatsapp: 85291234567 }, { wechatId: '1abc' }, { wechatId: 'ab' }, { wecomLink: 'http://work.weixin.qq.com/x' }, { wecomLink: 'https://evil.example.com/x' }, { wechatQr: 'data:image/gif;base64,AAAA' }, { wechatQr: 'not-an-image' }, { wechatQr: 'data:image/png;base64,' + 'A'.repeat(600000) }, { phone: '+85291234567' }]) {
    assert.equal((await request('/support/contact', 'PUT', body)).status, 400, JSON.stringify(body).slice(0, 50))
  }
})
test('只限管理者設定聯絡方式，員工可以看', async () => {
  assert.equal((await request('/support/contact', 'PUT', { wechatId: 'staff_try' }, 'staff')).status, 403)
  assert.equal((await request('/support/contact', 'GET', undefined, 'staff')).status, 200)
  assert.equal((await request('/support/contact', 'PUT', { wechatId: 'client_try' }, 'self-client')).status, 403)
})
test('每個租戶的聯絡方式分開', async () => {
  assert.equal((await request('/my/contact', 'GET', undefined, 'foreign-client')).body.wechatId, '')
})
