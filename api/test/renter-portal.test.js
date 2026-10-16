import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 出租第 B 輪：承租方專屬連結、憑證待確認、合約範本、代收結算。進程內請求，不開連接埠。
const state = {}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'renter-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs'), PUBLIC_BASE_URL: 'https://api.example.com' })
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('default'); seedRules('other')
  state.customer = randomUUID(); state.plate = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state.customer, '牌主甲', '個人', 'default')
  const now = new Date().toISOString()
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(state.plate, state.customer, '粵港', '粵Z連結港', state.plate, '自用', now, now)
  for (const [token, role, tenant] of [['admin', 'admin', 'default'], ['staff', 'staff', 'default'], ['foreign-admin', 'admin', 'other']]) {
    const userId = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id) VALUES (?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, userId, '2099-01-01T00:00:00Z', now)
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function raw(url, method = 'GET', payload = '', headers = {}) {
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url, headers: { host: 'api.example.com', 'x-forwarded-for': '10.1.1.1', ...headers } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, headers: this.headers, text: typeof data === 'string' ? data : '' }) } }))
}
const api = async (path, method = 'GET', body, token = 'admin') => { const result = await raw(`/api${path}`, method, body === undefined ? '' : JSON.stringify(body), { authorization: `Bearer ${token}` }); return { ...result, body: result.text ? JSON.parse(result.text) : null } }
const tokenOf = url => url.split('/r/')[1]
async function enter(token, tail = '6789') { const result = await raw(`/r/${token}/verify`, 'POST', `tail=${tail}`); return result.headers.location ? new URL(result.headers.location, 'https://x').searchParams.get('k') : null }

test('準備一份生效合約', async () => {
  const contract = await api('/rental-contracts', 'POST', { plateId: state.plate, renter: { name: '承租人乙', phone: '+852 6123 6789', vehiclePlate: 'AB 1234' }, startsOn: `${hk().slice(0, 7)}-01`, rentAmount: 600000, currency: 'HKD', cycle: 'monthly', dueDay: 5, collectionMode: '代收', feeType: 'fixed', feeValue: 50000, status: '生效' })
  assert.equal(contract.status, 201); state.contract = contract.body.id; state.invoice = contract.body.invoices[0].id
})
test('合約沒有承租方電話時不能產生連結', async () => {
  const other = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(other, state.customer, '粵港', '粵Z無電話', other, '自用', now, now)
  const contract = (await api('/rental-contracts', 'POST', { plateId: other, renter: { name: '無電話' }, startsOn: hk(), rentAmount: 1, status: '草擬' })).body
  assert.equal((await api(`/rental-contracts/${contract.id}/link`, 'POST', {})).status, 400)
})
test('產生連結：資料庫只存雜湊，連結只顯示一次', async () => {
  const result = await api(`/rental-contracts/${state.contract}/link`, 'POST', { expiresInDays: 30 })
  assert.equal(result.status, 201); assert.match(result.body.url, /^https:\/\/api\.example\.com\/r\/[0-9a-f]{64}$/)
  state.token = tokenOf(result.body.url)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM rental_links WHERE token_hash=?').get(state.token).count, 0, '不存明文')
  assert.equal((await api(`/rental-contracts/${state.contract}/link`)).body.active, true)
})
test('打開連結先要核對電話末 4 碼，頁面不含客戶資料', async () => {
  const page = await raw(`/r/${state.token}`)
  assert.equal(page.status, 200); assert.match(page.text, /電話最後 4 位/); assert.ok(!page.text.includes('牌主甲'))
})
test('末 4 碼錯誤 5 次後連結暫時鎖定', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await raw(`/r/${state.token}/verify`, 'POST', 'tail=0000')).status, 401)
  assert.equal((await raw(`/r/${state.token}/verify`, 'POST', 'tail=0000')).status, 401)
  assert.equal((await raw(`/r/${state.token}/verify`, 'POST', 'tail=6789')).status, 429)
  assert.equal((await api(`/rental-contracts/${state.contract}/link`)).body.locked, true)
  state.db.prepare('UPDATE rental_links SET locked_until=NULL, failures=0').run()
})
test('核對成功後看到安排內容與各期使用費，不出現「租金」「出租」', async () => {
  state.key = await enter(state.token)
  assert.ok(state.key)
  const page = await raw(`/r/${state.token}?k=${state.key}`)
  assert.match(page.text, /承租人乙/); assert.match(page.text, /HKD 6,000\.00/); assert.match(page.text, /車輛使用安排確認書/)
  assert.ok(!/租金|出租/.test(page.text)); assert.ok(!page.text.includes('牌主甲'))
})
test('沒有有效的瀏覽憑證不能看內容', async () => assert.match((await raw(`/r/${state.token}?k=${'0'.repeat(48)}`)).text, /電話最後 4 位/))
test('承租方上傳轉帳憑證，同一期不能重複上傳', async () => {
  const body = { key: state.key, invoiceId: state.invoice, paidOn: hk(), amount: 600000, data: `data:image/png;base64,${PNG}` }
  assert.equal((await raw(`/r/${state.token}/upload`, 'POST', JSON.stringify(body))).status, 201)
  assert.equal((await raw(`/r/${state.token}/upload`, 'POST', JSON.stringify(body))).status, 409)
})
test('上傳格式錯誤或期數不屬於這份合約被拒', async () => {
  for (const body of [{ key: state.key, invoiceId: randomUUID(), paidOn: hk(), amount: 1, data: PNG }, { key: state.key, invoiceId: state.invoice, paidOn: 'x', amount: 1, data: PNG }, { key: 'bad', invoiceId: state.invoice, paidOn: hk(), amount: 1, data: PNG }]) assert.ok([400, 401, 409].includes((await raw(`/r/${state.token}/upload`, 'POST', JSON.stringify(body))).status))
  const invoices = (await api(`/rent-invoices?contractId=${state.contract}`)).body
  assert.equal((await raw(`/r/${state.token}/upload`, 'POST', JSON.stringify({ key: state.key, invoiceId: invoices[1].id, paidOn: hk(), amount: 1, data: Buffer.from('hello').toString('base64') }))).status, 400)
})
test('管理者確認憑證：該期登記收款、附上憑證、自動產生代收服務費', async () => {
  const [upload] = (await api('/renter-uploads?status=待確認')).body
  assert.equal(upload.renterName, '承租人乙')
  const result = await api(`/renter-uploads/${upload.id}/confirm`, 'POST', {})
  assert.equal(result.status, 200); assert.equal(result.body.status, '已確認')
  const invoice = (await api(`/rent-invoices?contractId=${state.contract}`)).body.find(item => item.id === state.invoice)
  assert.equal(invoice.status, '已收'); assert.equal(invoice.hasProof, true)
  assert.equal((await api(`/fees?customerId=${state.customer}&kind=rent_commission`)).body.items[0].amount, 50000)
  assert.equal((await api(`/renter-uploads/${upload.id}/confirm`, 'POST', {})).status, 409)
})
test('管理者要求重交須寫原因，承租方頁面看到原因', async () => {
  const invoices = (await api(`/rent-invoices?contractId=${state.contract}`)).body
  await raw(`/r/${state.token}/upload`, 'POST', JSON.stringify({ key: state.key, invoiceId: invoices[1].id, paidOn: hk(), amount: 600000, data: PNG }))
  const pending = (await api('/renter-uploads?status=待確認')).body[0]
  assert.equal((await api(`/renter-uploads/${pending.id}/reject`, 'POST', {})).status, 400)
  assert.equal((await api(`/renter-uploads/${pending.id}/reject`, 'POST', { reason: '金額不符' })).status, 200)
  assert.match((await raw(`/r/${state.token}?k=${state.key}`)).text, /憑證需重交：金額不符/)
})
test('承租方確認已閱讀，記錄姓名與時間，只記一次', async () => {
  assert.equal((await raw(`/r/${state.token}/acknowledge`, 'POST', `key=${state.key}&name=`)).status, 400)
  assert.equal((await raw(`/r/${state.token}/acknowledge`, 'POST', `key=${state.key}&name=${encodeURIComponent('承租人乙')}`)).status, 303)
  await raw(`/r/${state.token}/acknowledge`, 'POST', `key=${state.key}&name=${encodeURIComponent('別人')}`)
  assert.equal((await api(`/rental-contracts/${state.contract}/link`)).body.acknowledgement.name, '承租人乙')
  assert.match((await raw(`/r/${state.token}?k=${state.key}`)).text, /這不是電子簽署|已由 承租人乙/)
})
test('重發連結後舊連結失效；作廢後連結無效', async () => {
  const fresh = tokenOf((await api(`/rental-contracts/${state.contract}/link`, 'POST', {})).body.url)
  assert.equal((await raw(`/r/${state.token}`)).status, 404)
  assert.equal((await raw(`/r/${fresh}`)).status, 200)
  await api(`/rental-contracts/${state.contract}/link`, 'DELETE')
  assert.equal((await raw(`/r/${fresh}`)).status, 404)
})
test('過期或格式錯誤的連結無效', async () => {
  const fresh = tokenOf((await api(`/rental-contracts/${state.contract}/link`, 'POST', { expiresInDays: 1 })).body.url)
  state.db.prepare("UPDATE rental_links SET expires_at='2000-01-01T00:00:00Z' WHERE revoked_at IS NULL").run()
  assert.equal((await raw(`/r/${fresh}`)).status, 404)
  assert.equal((await raw('/r/not-a-token')).status, 404)
  assert.equal((await api(`/rental-contracts/${state.contract}/link`, 'POST', { expiresInDays: 0 })).status, 400)
})
test('合約範本可修改，佔位符會填入；不可寫「出租」「租金」', async () => {
  assert.equal((await api('/rental-template', 'PUT', { body: '出租協議 {{使用人}}' })).status, 400)
  assert.equal((await api('/rental-template', 'PUT', { body: '' })).status, 400)
  assert.equal((await api('/rental-template', 'PUT', { body: '使用安排：{{使用人}} 使用 {{牌照}}，每期 {{使用費}}' })).status, 200)
  const fresh = tokenOf((await api(`/rental-contracts/${state.contract}/link`, 'POST', {})).body.url)
  const key = await enter(fresh)
  assert.match((await raw(`/r/${fresh}?k=${key}`)).text, /使用安排：承租人乙 使用 粵Z連結港，每期 HKD 6,000\.00/)
})
test('代收結算按客戶與幣種計算淨額，可標記一次已結算', async () => {
  const period = hk().slice(0, 7)
  const { rows } = (await api(`/rent-settlements?period=${period}`)).body
  const row = rows.find(item => item.customerId === state.customer)
  assert.equal(row.collected, 600000); assert.equal(row.fees, 50000); assert.equal(row.net, 550000); assert.equal(row.settled, false)
  assert.equal((await api('/rent-settlements', 'POST', { customerId: state.customer, period, currency: 'HKD', settledOn: hk() })).status, 201)
  assert.equal((await api('/rent-settlements', 'POST', { customerId: state.customer, period, currency: 'HKD', settledOn: hk() })).status, 409)
  assert.equal((await api('/rent-settlements', 'POST', { customerId: state.customer, period, currency: 'MOP', settledOn: hk() })).status, 404)
  assert.equal((await api('/rent-settlements', 'POST', { customerId: state.customer, period: '2026-13', currency: 'HKD', settledOn: hk() })).status, 400)
})
test('員工與別的租戶不能使用連結與結算接口', async () => {
  for (const path of [`/rental-contracts/${state.contract}/link`, '/renter-uploads', '/rental-template', '/rent-settlements']) assert.equal((await api(path, 'GET', undefined, 'staff')).status, 403, path)
  assert.equal((await api(`/rental-contracts/${state.contract}/link`, 'POST', {}, 'foreign-admin')).status, 404)
  assert.equal((await api('/renter-uploads', 'GET', undefined, 'foreign-admin')).body.length, 0)
})
