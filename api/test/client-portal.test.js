import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 15 輪客戶端補強：上傳文件、顧問、手機號碼登入、微信登入框架、站內通知。全部進程內請求，不開連接埠。
const state = {}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'client-portal-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  delete process.env.WECHAT_APPID; delete process.env.WECHAT_SECRET
  const { server } = await import('../src/server.js')
  const { hashPassword } = await import('../src/db.js')
  state.server = server; state.db = new DatabaseSync(process.env.DB_PATH)
  state.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'other', 'foreign']) state[key] = randomUUID()
  for (const [id, tenant] of [[state.customer, 'default'], [state.other, 'default'], [state.foreign, 'other']]) state.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(id, `客戶${id.slice(0, 4)}`, '個人', tenant)
  const users = [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['other-client', 'customer', state.other, 'default'], ['foreign-admin', 'admin', null, 'other']]
  for (const [token, role, customerId, tenant] of users) {
    const userId = randomUUID(); state[`${token}Id`] = userId
    state.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant)
    state.db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  const now = new Date().toISOString()
  for (const [key, customerId, status] of [['request', state.customer, '進行中'], ['closed', state.customer, '已完成'], ['otherRequest', state.other, '進行中']]) {
    state[key] = randomUUID()
    state.db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(state[key], customerId, 'renewal', '粵港', '續期', status, '辦理', now, now)
  }
  state.task = randomUUID()
  state.db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status) VALUES (?,?,?,?,?)').run(state.task, state.request, '交身份證', '通用', '待辦')
})
after(() => { state.db?.close(); state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { const text = typeof data === 'string' ? data : null; resolve({ status: this.status, headers: this.headers, raw: data, body: text ? JSON.parse(text) : null }) } }))
}
const upload = (requestId, body, token = 'client') => request(`/my/requests/${requestId}/attachments`, 'POST', body, token)

// ── 上傳文件 ──
test('客戶可為自己的工單上傳相片', async () => {
  const result = await upload(state.request, { fileName: '身份證.png', data: PNG, taskId: state.task })
  assert.equal(result.status, 201); assert.equal(result.body.status, '待確認'); state.attachment = result.body.id
})
test('上傳只認真實檔頭，改名的文字檔被拒', async () => assert.equal((await upload(state.request, { fileName: '假相片.jpg', data: Buffer.from('hello').toString('base64') })).status, 400))
test('上傳超過 5 MB 被拒', async () => assert.equal((await upload(state.request, { fileName: 'big.png', data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') })).status, 400))
test('上傳空值、錯誤類型被拒', async () => { for (const body of [{}, { fileName: 'a.png' }, { fileName: '', data: PNG }, { fileName: 'a.png', data: 123 }]) assert.equal((await upload(state.request, body)).status, 400) })
test('不可上傳到別人的工單或已結束的工單', async () => {
  assert.equal((await upload(state.otherRequest, { fileName: 'a.png', data: PNG })).status, 404)
  assert.equal((await upload(state.closed, { fileName: 'a.png', data: PNG })).status, 409)
})
test('步驟不屬於該工單時被拒', async () => assert.equal((await upload(state.request, { fileName: 'a.png', data: PNG, taskId: randomUUID() })).status, 400))
test('客戶可下載自己上傳的檔案', async () => { const result = await request(`/my/requests/${state.request}/attachments/${state.attachment}/file`, 'GET', undefined, 'client'); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.headers['content-type'], 'image/png') })
test('客戶不能使用管理端文件接口', async () => assert.equal((await request(`/requests/${state.request}/attachments`, 'GET', undefined, 'client')).status, 403))
test('別的租戶管理員看不到文件', async () => assert.equal((await request(`/requests/${state.request}/attachments`, 'GET', undefined, 'foreign-admin')).status, 404))
test('要求重交必須寫原因，並通知客戶', async () => {
  assert.equal((await request(`/requests/${state.request}/attachments/${state.attachment}`, 'PATCH', { status: '需重交' }, 'staff')).status, 400)
  const result = await request(`/requests/${state.request}/attachments/${state.attachment}`, 'PATCH', { status: '需重交', reviewNote: '相片模糊' }, 'staff')
  assert.equal(result.status, 200)
  const notes = (await request('/my/notifications', 'GET', undefined, 'client')).body
  assert.ok(notes.items.some(item => item.kind === 'attachment' && item.body.includes('相片模糊')))
})
test('全部確認後回傳 allConfirmed', async () => assert.equal((await request(`/requests/${state.request}/attachments/${state.attachment}`, 'PATCH', { status: '已確認' })).body.allConfirmed, true))

// ── 顧問 ──
test('管理者可設定顧問，客戶在總覽與顧問接口看到', async () => {
  assert.equal((await request(`/customers/${state.customer}/advisor`, 'PUT', { name: '陳顧問', phone: '+852 9123 4567', wechat: 'chen_adv' })).status, 200)
  assert.equal((await request('/my/advisor', 'GET', undefined, 'client')).body.name, '陳顧問')
  assert.equal((await request('/my/overview', 'GET', undefined, 'client')).body.advisor.wechat, 'chen_adv')
})
test('顧問電話格式錯誤、員工修改、別的租戶都被拒', async () => {
  assert.equal((await request(`/customers/${state.customer}/advisor`, 'PUT', { phone: 'abc' })).status, 400)
  assert.equal((await request(`/customers/${state.customer}/advisor`, 'PUT', { name: 'x' }, 'staff')).status, 403)
  assert.equal((await request(`/customers/${state.customer}/advisor`, 'PUT', { name: 'x' }, 'foreign-admin')).status, 404)
})

// ── 手機號碼登入 ──
test('開通客戶登入可只填手機號碼，並用手機號碼登入', async () => {
  assert.equal((await request('/customer-users', 'POST', { customerId: state.customer, name: '李先生助手', phone: '+85291234567', password: 'Assistant12345' })).status, 201)
  const login = await request('/login', 'POST', { phone: '+852 9123 4567', password: 'Assistant12345' }, '')
  assert.equal(login.status, 200); assert.equal(login.body.user.customerId, state.customer)
})
test('手機號碼重複或格式錯誤被拒', async () => {
  assert.equal((await request('/customer-users', 'POST', { customerId: state.customer, name: 'x', phone: '+85291234567', password: 'Assistant12345' })).status, 409)
  assert.equal((await request('/customer-users', 'POST', { customerId: state.customer, name: 'x', phone: '12ab', password: 'Assistant12345' })).status, 400)
  assert.equal((await request('/customer-users', 'POST', { customerId: state.customer, name: 'x', password: 'Assistant12345' })).status, 400)
})
test('電郵登入照常可用、錯誤密碼被拒', async () => {
  assert.equal((await request('/login', 'POST', { email: 'client@test.invalid', password: 'Password12345' }, '')).status, 200)
  assert.equal((await request('/login', 'POST', { phone: '+85291234567', password: 'wrong-password' }, '')).status, 401)
})

// ── 微信登入框架 ──
test('未設定微信環境變數時回 503', async () => assert.equal((await request('/wechat/login', 'POST', { code: 'x' }, '')).status, 503))
test('微信：未綁定 → 用綁定碼綁定 → 之後直接登入', async () => {
  process.env.WECHAT_APPID = 'test-app'; process.env.WECHAT_SECRET = 'test-secret'
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => ({ json: async () => (String(url).includes('js_code=good') ? { openid: 'openid-1' } : { errcode: 40029 }) })
  try {
    assert.equal((await request('/wechat/login', 'POST', { code: 'bad' }, '')).status, 400)
    const unbound = await request('/wechat/login', 'POST', { code: 'good' }, '')
    assert.equal(unbound.status, 409); assert.equal(unbound.body.needsBinding, true)
    const code = (await request(`/customer-users/${state.clientId}/wechat-bind-code`, 'POST')).body.code
    assert.match(code, /^\d{6}$/)
    assert.equal((await request('/wechat/bind', 'POST', { code: 'good', bindCode: '000000' === code ? '111111' : '000000' }, '')).status, 400)
    assert.equal((await request('/wechat/bind', 'POST', { code: 'good', bindCode: code }, '')).status, 200)
    assert.equal((await request('/wechat/bind', 'POST', { code: 'good', bindCode: code }, '')).status, 400, '綁定碼只能用一次')
    assert.equal((await request('/wechat/login', 'POST', { code: 'good' }, '')).status, 200)
  } finally { globalThis.fetch = realFetch; delete process.env.WECHAT_APPID; delete process.env.WECHAT_SECRET }
})
test('過期綁定碼被拒、員工不可產生綁定碼', async () => {
  state.db.prepare('INSERT INTO wechat_bind_codes(code,user_id,expires_at) VALUES (?,?,?)').run('222222', state['other-clientId'], '2000-01-01T00:00:00Z')
  process.env.WECHAT_APPID = 'a'; process.env.WECHAT_SECRET = 'b'
  const realFetch = globalThis.fetch; globalThis.fetch = async () => ({ json: async () => ({ openid: 'openid-2' }) })
  try { assert.equal((await request('/wechat/bind', 'POST', { code: 'x', bindCode: '222222' }, '')).status, 400) } finally { globalThis.fetch = realFetch; delete process.env.WECHAT_APPID; delete process.env.WECHAT_SECRET }
  assert.equal((await request(`/customer-users/${state.clientId}/wechat-bind-code`, 'POST', undefined, 'staff')).status, 403)
})

// ── 站內通知 ──
test('工單狀態改變通知客戶一次', async () => {
  await request(`/requests/${state.request}`, 'PATCH', { status: '待客戶提供' })
  await request(`/requests/${state.request}`, 'PATCH', { status: '待客戶提供' })
  const items = (await request('/my/notifications', 'GET', undefined, 'client')).body.items.filter(item => item.kind === 'request')
  assert.equal(items.length, 1); assert.ok(items[0].title.includes('需要你提供資料'))
})
test('單筆與全部標記已讀，別人的通知不可標記', async () => {
  const list = (await request('/my/notifications', 'GET', undefined, 'client')).body
  assert.ok(list.unread > 0)
  assert.equal((await request('/my/notifications/read', 'POST', { id: list.items[0].id }, 'other-client')).status, 404)
  assert.equal((await request('/my/notifications/read', 'POST', { id: list.items[0].id }, 'client')).status, 200)
  assert.equal((await request('/my/notifications/read', 'POST', { all: true }, 'client')).status, 200)
  assert.equal((await request('/my/notifications', 'GET', undefined, 'client')).body.unread, 0)
  assert.equal((await request('/my/notifications/read', 'POST', {}, 'client')).status, 400)
})
test('管理員不能讀客戶通知接口', async () => assert.equal((await request('/my/notifications', 'GET')).status, 403))
test('客戶看到的工單狀態和更新紀錄不出現內部字眼', async () => {
  const list = (await request('/requests', 'GET', undefined, 'client')).body
  assert.ok(list.every(item => !['待客戶提供', '待客戶配合', '待開始', '新要求', '進行中'].includes(item.status)))
  const detail = (await request(`/requests/${state.request}`, 'GET', undefined, 'client')).body
  assert.ok(detail.activities.every(item => !/待客戶提供|待客戶配合/.test(item.detail)))
})
test('同一工單第二個客戶步驟會再通知一次', async () => {
  const second = randomUUID()
  state.db.prepare("UPDATE tasks SET owner='client' WHERE id=?").run(state.task)
  state.db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,owner,sort) VALUES (?,?,?,?,?,?,?)').run(second, state.request, '簽署授權書', '通用', '待辦', 'client', 99)
  await request(`/tasks/${state.task}`, 'PATCH', { status: '已完成' })
  const items = (await request('/my/notifications', 'GET', undefined, 'client')).body.items.filter(item => item.kind === 'request' && item.body.includes('簽署授權書'))
  assert.equal(items.length, 1)
})
test('管理端可列出客戶的登入帳號，不顯示手機帳號的佔位電郵', async () => {
  const list = (await request(`/customers/${state.customer}/users`)).body
  assert.ok(list.some(item => item.phone === '+85291234567' && item.email === ''))
  assert.ok(list.some(item => item.id === state.clientId && item.wechatBound === true))
  assert.equal((await request(`/customers/${state.customer}/users`, 'GET', undefined, 'client')).status, 403)
  assert.equal((await request(`/customers/${state.customer}/users`, 'GET', undefined, 'foreign-admin')).status, 404)
})
test('停用客戶帳號後即時不能使用，重新啟用後可再登入', async () => {
  assert.equal((await request(`/customer-users/${state['other-clientId']}`, 'PATCH', { active: 'no' })).status, 400)
  assert.equal((await request(`/customer-users/${state['other-clientId']}`, 'PATCH', { active: false }, 'staff')).status, 403)
  assert.equal((await request(`/customer-users/${state['other-clientId']}`, 'PATCH', { active: false })).body.active, false)
  assert.equal((await request('/my/notifications', 'GET', undefined, 'other-client')).status, 401)
  assert.equal((await request('/login', 'POST', { email: 'other-client@test.invalid', password: 'Password12345' }, '')).status, 401)
  assert.equal((await request(`/customer-users/${state['other-clientId']}`, 'PATCH', { active: true })).body.active, true)
  assert.equal((await request('/login', 'POST', { email: 'other-client@test.invalid', password: 'Password12345' }, '')).status, 200)
})
test('更新紀錄的「進行中」對客戶顯示為「辦理中」', async () => {
  state.db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(randomUUID(), state.request, state.adminId, 'status', '進行中', new Date().toISOString())
  const detail = (await request(`/requests/${state.request}`, 'GET', undefined, 'client')).body
  assert.ok(detail.activities.some(item => item.detail === '辦理中')); assert.ok(!detail.activities.some(item => item.detail === '進行中'))
})
