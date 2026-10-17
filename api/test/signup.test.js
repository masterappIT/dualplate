import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管第一期第 6 步：自行申請（申請審批制）、登入時的審批狀態、後台批准或拒絕、被拒絕 30 天後刪除
const state = {}
let ipSeq = 0, phoneSeq = 0
const freshIp = () => `10.66.0.${++ipSeq}`
const freshPhone = () => `+8526${String(10000000 + ++phoneSeq).slice(1)}`
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'signup-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  await import('../src/terms.js')
  db.prepare('INSERT INTO terms_versions(tenant_id,version,terms,privacy,published_at) VALUES (?,?,?,?,?)').run('default', 1, '條款一', '私隱一', '2026-10-01T00:00:00Z')
  db.prepare('INSERT INTO terms_versions(tenant_id,version,terms,privacy,published_at) VALUES (?,?,?,?,?)').run('default', 2, '條款二', '私隱二', '2026-10-10T00:00:00Z')
  state.client = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.client, '現有客戶', '個人', 'default')
  const stamp = new Date().toISOString()
  for (const [token, role, customer, tenant, phone] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.client, 'default', '+85298887777'], ['other-admin', 'admin', null, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username,phone) VALUES (?,?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('SignupPass123'), customer, tenant, role === 'customer' ? null : token, phone || null)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin', ip = '10.65.0.1') {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': ip } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const form = (overrides = {}) => ({ phone: freshPhone(), name: '黃先生', password: 'MyOwnPass123', acceptTerms: true, termsVersion: 2, ...overrides })
const apply = (body, ip = freshIp()) => request('/public/signup', 'POST', body, null, ip)
const login = (phone, password = 'MyOwnPass123') => request('/login', 'POST', { login: phone, password }, null, freshIp())
const list = (token = 'admin') => request('/signup-applications', 'GET', undefined, token)
const approve = (id, body = { confirmed: true }, token = 'admin') => request(`/signup-applications/${id}/approve`, 'POST', body, token)
const reject = (id, body = {}, token = 'admin') => request(`/signup-applications/${id}/reject`, 'POST', body, token)
async function applied(overrides) {
  const body = form(overrides)
  assert.equal((await apply(body)).status, 201)
  return { ...body, id: (await list()).body.find(row => row.phone === body.phone).id }
}

test('提交申請後登入只顯示「申請已收到」', async () => {
  const body = form()
  const result = await apply(body)
  assert.equal(result.status, 201)
  assert.equal(result.body.status, '審批中')
  const entry = await login(body.phone)
  assert.equal(entry.status, 403)
  assert.equal(entry.body.code, 'SIGNUP_PENDING')
  assert.match(entry.body.error, /申請已收到/)
  assert.equal(entry.body.token, undefined)
})

test('審批中用錯密碼登入，照常回覆帳號或密碼不正確', async () => {
  const body = form()
  await apply(body)
  const entry = await login(body.phone, 'WrongPass999')
  assert.equal(entry.status, 401)
  assert.equal(entry.body.code, undefined)
})

test('手機號碼必填且要符合香港、澳門或內地格式', async () => {
  assert.match((await apply(form({ phone: '' }))).body.error, /請填寫手機號碼/)
  assert.equal((await apply(form({ phone: '+85212' }))).status, 400)
  assert.equal((await apply(form({ phone: '+4412345678' }))).status, 400)
})

test('接受澳門和內地號碼', async () => {
  assert.equal((await apply(form({ phone: '+85366112233' }))).status, 201)
  assert.equal((await apply(form({ phone: '+8613912345678' }))).status, 201)
})

test('稱呼必填、不可只有空白、不可過長', async () => {
  assert.match((await apply(form({ name: '' }))).body.error, /請填寫稱呼/)
  assert.match((await apply(form({ name: '   ' }))).body.error, /請填寫稱呼/)
  assert.match((await apply(form({ name: '長'.repeat(41) }))).body.error, /不可超過 40/)
})

test('密碼至少 10 個字元，且不可與手機號碼相同', async () => {
  assert.match((await apply(form({ password: 'short' }))).body.error, /至少 10/)
  const phone = freshPhone()
  assert.match((await apply(form({ phone, password: phone }))).body.error, /不可與/)
})

test('未勾選同意條款不能提交', async () => {
  assert.match((await apply(form({ acceptTerms: false }))).body.error, /同意服務條款/)
  assert.equal((await apply(form({ acceptTerms: 'true' }))).status, 400)
})

test('看的是舊版條款時要重新閱讀', async () => {
  const result = await apply(form({ termsVersion: 1 }))
  assert.equal(result.status, 409)
  assert.match(result.body.error, /條款已更新/)
})

test('服務條款未發佈時不能申請', async () => {
  process.env.DEFAULT_TENANT_ID = 'other'
  try {
    const result = await apply(form())
    assert.equal(result.status, 503)
    assert.match(result.body.error, /尚未發佈/)
  } finally { delete process.env.DEFAULT_TENANT_ID }
})

test('請求內容為 null、陣列、錯誤類型或多餘欄位時拒絕', async () => {
  assert.equal((await apply('null')).status, 400)
  assert.equal((await apply('[]')).status, 400)
  assert.equal((await apply('{bad')).status, 400)
  assert.equal((await apply(form({ phone: 85291234567 }))).status, 400)
  assert.equal((await apply(form({ name: ['黃'] }))).status, 400)
  assert.equal((await apply(form({ role: 'admin' }))).status, 400)
})

test('已有帳戶的手機號碼不能申請', async () => {
  const result = await apply(form({ phone: '+85298887777' }))
  assert.equal(result.status, 409)
  assert.match(result.body.error, /已有帳戶/)
})

test('同一號碼審批中不能重複申請', async () => {
  const body = form()
  await apply(body)
  const again = await apply({ ...body, name: '另一人' })
  assert.equal(again.status, 409)
  assert.match(again.body.error, /已提交申請/)
})

test('同一網絡地址一天最多提交 5 份申請', async () => {
  const ip = freshIp()
  for (let index = 0; index < 5; index++) assert.equal((await apply(form(), ip)).status, 201)
  assert.equal((await apply(form(), ip)).status, 429)
})

test('只接受 POST 提交申請', async () => {
  assert.equal((await request('/public/signup', 'GET', undefined, null)).status, 405)
})

test('未登入也可看客服聯絡方式', async () => {
  const result = await request('/public/contact', 'GET', undefined, null)
  assert.equal(result.status, 200)
  assert.deepEqual(Object.keys(result.body).sort(), ['wechatId', 'wechatQr', 'wecomLink', 'whatsapp', 'whatsappLink'])
})

test('管理者看到申請列表，審批中排最前，不含密碼', async () => {
  const done = await applied()
  await reject(done.id)
  const waiting = await applied()
  const rows = (await list()).body
  assert.equal(rows[0].status, '審批中')
  assert.ok(rows.findIndex(row => row.id === waiting.id) < rows.findIndex(row => row.id === done.id))
  for (const row of rows) for (const key of Object.keys(row)) assert.doesNotMatch(key, /password/i)
})

test('員工和客戶不能看或處理申請', async () => {
  const row = await applied()
  for (const token of ['staff', 'client']) {
    assert.equal((await list(token)).status, 403)
    assert.equal((await approve(row.id, { confirmed: true }, token)).status, 403)
    assert.equal((await reject(row.id, {}, token)).status, 403)
  }
})

test('未登入不能看或處理申請', async () => {
  assert.equal((await list(null)).status, 401)
  assert.equal((await approve('x', { confirmed: true }, null)).status, 401)
})

test('別的租戶的管理者看不到也不能處理', async () => {
  const row = await applied()
  assert.ok(!(await list('other-admin')).body.some(item => item.id === row.id))
  assert.equal((await approve(row.id, { confirmed: true }, 'other-admin')).status, 404)
  assert.equal((await reject(row.id, {}, 'other-admin')).status, 404)
})

test('不存在的申請回覆 404', async () => {
  assert.equal((await approve(randomUUID())).status, 404)
  assert.equal((await reject(randomUUID())).status, 404)
})

test('批准前必須確認已聯絡申請人', async () => {
  const row = await applied()
  assert.match((await approve(row.id, {})).body.error, /確認手機號碼屬於本人/)
  assert.equal((await approve(row.id, { confirmed: 'yes' })).status, 400)
  assert.equal((await approve(row.id, { confirmed: true, extra: 1 })).status, 400)
  assert.equal((await approve(row.id, 'null')).status, 400)
})

test('只接受 POST 處理申請', async () => {
  const row = await applied()
  assert.equal((await request(`/signup-applications/${row.id}/approve`, 'GET')).status, 405)
  assert.equal((await request('/signup-applications', 'POST', {})).status, 405)
})

test('批准後開自管客戶，來源為申請，可用申請時的密碼登入', async () => {
  const row = await applied({ name: '何太' })
  const result = await approve(row.id)
  assert.equal(result.status, 200)
  assert.equal(result.body.status, '已批准')
  const customer = state.db.prepare('SELECT * FROM customers WHERE id=?').get(result.body.customerId)
  assert.equal(customer.name, '何太')
  assert.equal(customer.service_mode, '自管')
  assert.equal(customer.signup_source, '申請')
  assert.equal(customer.phone, row.phone)
  const entry = await login(row.phone)
  assert.equal(entry.status, 200)
  assert.equal(entry.body.user.serviceMode, '自管')
  assert.equal(entry.body.user.customerId, customer.id)
})

test('批准後申請時同意的條款版本記入同意記錄', async () => {
  const row = await applied()
  const customerId = (await approve(row.id)).body.customerId
  const account = state.db.prepare('SELECT id FROM users WHERE customer_id=?').get(customerId)
  assert.equal(state.db.prepare('SELECT version FROM terms_acceptances WHERE user_id=?').get(account.id).version, 2)
})

test('批准後管理者可查看客戶密碼，申請記錄不再保存密碼', async () => {
  const row = await applied()
  const customerId = (await approve(row.id)).body.customerId
  const account = state.db.prepare('SELECT id FROM users WHERE customer_id=?').get(customerId)
  const view = await request(`/customer-users/${account.id}/password-view`, 'POST', {})
  assert.equal(view.status, 200)
  assert.equal(view.body.password, row.password)
  const stored = state.db.prepare('SELECT password_hash, password_enc FROM signup_applications WHERE id=?').get(row.id)
  assert.equal(stored.password_hash, null)
  assert.equal(stored.password_enc, null)
})

test('批准時已有同名客戶，名稱加上手機末 4 位', async () => {
  const row = await applied({ name: '現有客戶' })
  const customerId = (await approve(row.id)).body.customerId
  assert.equal(state.db.prepare('SELECT name FROM customers WHERE id=?').get(customerId).name, `現有客戶（${row.phone.slice(-4)}）`)
})

test('已批准的申請不能再批准或拒絕', async () => {
  const row = await applied()
  await approve(row.id)
  assert.equal((await approve(row.id)).status, 409)
  assert.equal((await reject(row.id)).status, 409)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM customers WHERE phone=?').get(row.phone).count, 1)
})

test('批准時號碼已被邀請帳戶使用，不開第二個帳戶', async () => {
  const row = await applied()
  state.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,phone) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'customer', '已邀請', `${row.phone}@phone.invalid`, 'x:y', state.client, 'default', row.phone)
  const result = await approve(row.id)
  assert.equal(result.status, 409)
  assert.match(result.body.error, /已有帳戶/)
  assert.equal(state.db.prepare('SELECT status FROM signup_applications WHERE id=?').get(row.id).status, '審批中')
})

test('拒絕後登入顯示「申請未獲批准」', async () => {
  const row = await applied()
  const result = await reject(row.id, { note: '號碼不屬於本人' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, '已拒絕')
  assert.equal(result.body.rejectNote, '號碼不屬於本人')
  const entry = await login(row.phone)
  assert.equal(entry.status, 403)
  assert.equal(entry.body.code, 'SIGNUP_REJECTED')
  assert.match(entry.body.error, /未獲批准/)
})

test('拒絕後即時刪除密碼加密副本', async () => {
  const row = await applied()
  await reject(row.id)
  assert.equal(state.db.prepare('SELECT password_enc FROM signup_applications WHERE id=?').get(row.id).password_enc, null)
})

test('被拒絕的號碼 30 天內不能再申請', async () => {
  const row = await applied()
  await reject(row.id)
  const again = await apply(form({ phone: row.phone }))
  assert.equal(again.status, 409)
  assert.match(again.body.error, /未獲批准/)
})

test('拒絕原因錯誤類型、過長或多餘欄位時拒絕', async () => {
  const row = await applied()
  assert.equal((await reject(row.id, { note: 123 })).status, 400)
  assert.equal((await reject(row.id, { note: '長'.repeat(201) })).status, 400)
  assert.equal((await reject(row.id, { reason: 'x' })).status, 400)
  assert.equal(state.db.prepare('SELECT status FROM signup_applications WHERE id=?').get(row.id).status, '審批中')
})

test('被拒絕的申請 30 天後刪除，號碼可以再申請', async () => {
  const row = await applied()
  await reject(row.id)
  state.db.prepare('UPDATE signup_applications SET decided_at=? WHERE id=?').run(new Date(Date.now() - 31 * 86400000).toISOString(), row.id)
  assert.equal((await login(row.phone)).status, 401)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM signup_applications WHERE id=?').get(row.id).count, 0)
  assert.equal((await apply(form({ phone: row.phone }))).status, 201)
})

test('被拒絕未滿 30 天的申請保留', async () => {
  const row = await applied()
  await reject(row.id)
  state.db.prepare('UPDATE signup_applications SET decided_at=? WHERE id=?').run(new Date(Date.now() - 29 * 86400000).toISOString(), row.id)
  assert.equal((await login(row.phone)).body.code, 'SIGNUP_REJECTED')
})
