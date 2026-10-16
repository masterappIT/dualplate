import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 17 輪收費、代墊與報價。進程內請求，不開連接埠。
const state = {}
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const month = Number(hk().slice(5, 7)), year = hk().slice(0, 4)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'fees-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'otherCustomer', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.otherCustomer, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  state.self = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  const now = new Date().toISOString()
  state.plate = randomUUID()
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(state.plate, state.customer, '粵港', '粵Z收費港', state.plate, '自用', now, now)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['other-client', 'customer', state.otherCustomer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID(); state[`${token}Id`] = userId
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { const text = typeof data === 'string' ? data : ''; resolve({ status: this.status, headers: this.headers, text, body: text && !text.startsWith('<') ? JSON.parse(text) : null }) } }))
}
const fee = extra => ({ customerId: state.customer, kind: 'gov_fee', currency: 'HKD', amount: 54000, description: 'CRP 續期規費', dueOn: hk(), ...extra })

// ── 年費 ──
test('設定年費後，計費月份已到時自動產生當年年費', async () => {
  const result = await request(`/customers/${state.customer}/billing`, 'PUT', { annualAmount: 1200000, currency: 'HKD', billMonth: month })
  assert.equal(result.status, 200)
  const items = (await request(`/fees?customerId=${state.customer}&kind=annual`)).body.items
  assert.equal(items.length, 1); assert.equal(items[0].description, `${year} 年度年費`)
})
test('年費每年只產生一次', async () => {
  await request(`/customers/${state.customer}/billing`, 'PUT', { annualAmount: 1200000, currency: 'HKD', billMonth: month })
  await request('/fees'); await request('/fees')
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM fee_items WHERE customer_id=? AND kind='annual'").get(state.customer).count, 1)
})
test('計費月份未到不產生年費', async () => {
  if (month === 12) return
  await request(`/customers/${state.otherCustomer}/billing`, 'PUT', { annualAmount: 500000, currency: 'MOP', billMonth: month + 1 })
  assert.equal((await request(`/fees?customerId=${state.otherCustomer}&kind=annual`)).body.items.length, 0)
})
test('年費設定資料錯誤被拒，自有客戶不可設年費', async () => {
  for (const body of [null, {}, { annualAmount: -1, currency: 'HKD', billMonth: 1 }, { annualAmount: 100, currency: 'USD', billMonth: 1 }, { annualAmount: 100, currency: 'HKD', billMonth: 13 }]) assert.equal((await request(`/customers/${state.customer}/billing`, 'PUT', body)).status, 400)
  assert.equal((await request(`/customers/${state.self}/billing`, 'PUT', { annualAmount: 100, currency: 'HKD', billMonth: 1 })).status, 400)
})

// ── 收費與收款 ──
test('新增政府規費與代墊，分開記錄', async () => {
  const gov = await request('/fees', 'POST', fee())
  const advance = await request('/fees', 'POST', fee({ kind: 'advance', amount: 30000, description: '代墊保險費' }))
  assert.equal(gov.status, 201); assert.equal(advance.status, 201); assert.equal(gov.body.kindLabel, '政府規費'); assert.equal(advance.body.kindLabel, '代墊')
  state.gov = gov.body.id; state.advance = advance.body.id
})
test('金額為負、零、小數或非數字被拒', async () => { for (const amount of [-1, 0, 12.5, '100', null]) assert.equal((await request('/fees', 'POST', fee({ amount }))).status, 400, String(amount)) })
test('收費資料其他錯誤被拒', async () => {
  for (const extra of [{ kind: 'rent_commission' }, { kind: 'x' }, { currency: 'USD' }, { description: '  ' }, { dueOn: '2026-02-30' }]) assert.equal((await request('/fees', 'POST', fee(extra))).status, 400, JSON.stringify(extra))
  assert.equal((await request('/fees', 'POST', null)).status, 400)
  assert.equal((await request('/fees', 'POST', fee({ customerId: randomUUID() }))).status, 404)
})
test('自有客戶不產生收費', async () => assert.equal((await request('/fees', 'POST', fee({ customerId: state.self }))).status, 400))
test('部分收款後狀態為部分收，收足後為已收', async () => {
  assert.equal((await request(`/fees/${state.gov}/payments`, 'POST', { paidOn: hk(), amount: 20000, method: '轉數快' })).body.status, '部分收')
  const full = await request(`/fees/${state.gov}/payments`, 'POST', { paidOn: hk(), amount: 34000, method: '現金' })
  assert.equal(full.body.status, '已收'); assert.equal(full.body.outstanding, 0)
})
test('收款超過未收金額或資料錯誤被拒', async () => {
  assert.equal((await request(`/fees/${state.advance}/payments`, 'POST', { paidOn: hk(), amount: 30001, method: '現金' })).status, 400)
  for (const body of [{}, { paidOn: 'x', amount: 100, method: '現金' }, { paidOn: hk(), amount: 100 }, { paidOn: hk(), amount: 100, method: '現金', proof: 'aGVsbG8=' }]) assert.equal((await request(`/fees/${state.advance}/payments`, 'POST', body)).status, 400)
})
test('撤銷收款回到未收', async () => {
  const paid = (await request(`/fees/${state.gov}`)).body
  const result = await request(`/fees/${state.gov}/payments/${paid.payments[1].id}`, 'DELETE')
  assert.equal(result.body.status, '部分收')
})
test('作廢須寫原因，已有收款不可作廢，作廢後不可收款', async () => {
  assert.equal((await request(`/fees/${state.gov}/void`, 'POST', { reason: '重複' })).status, 409)
  assert.equal((await request(`/fees/${state.advance}/void`, 'POST', {})).status, 400)
  assert.equal((await request(`/fees/${state.advance}/void`, 'POST', { reason: '客戶自行支付' })).body.status, '作廢')
  assert.equal((await request(`/fees/${state.advance}/payments`, 'POST', { paidOn: hk(), amount: 100, method: '現金' })).status, 409)
})
test('按幣種分開合計，不換算', async () => {
  await request('/fees', 'POST', fee({ currency: 'RMB', amount: 10000, description: '內地規費' }))
  const totals = (await request(`/fees?customerId=${state.customer}`)).body.totals
  assert.ok(totals.outstanding.HKD > 0); assert.equal(totals.outstanding.RMB, 10000); assert.equal(totals.outstanding.MOP, undefined)
})
test('修改金額不可少於已收、不可轉客戶', async () => {
  assert.equal((await request(`/fees/${state.gov}`, 'PATCH', { amount: 100 })).status, 400)
  assert.equal((await request(`/fees/${state.gov}`, 'PATCH', { customerId: state.otherCustomer })).status, 400)
  assert.equal((await request(`/fees/${state.gov}`, 'PATCH', { description: 'CRP 續期規費（兩年）' })).status, 200)
})

// ── 工單結案收費 ──
async function newRequest() {
  const requestId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO requests(id,customer_id,plate_asset_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(requestId, state.customer, state.plate, 'renewal', '粵港', '續期', '進行中', '辦理', now, now)
  return requestId
}
test('工單結案時記錄本單代辦費和規費', async () => {
  const requestId = await newRequest()
  const result = await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', fees: [{ kind: 'service', currency: 'HKD', amount: 300000, description: '續期代辦費' }, { kind: 'gov_fee', currency: 'RMB', amount: 5000, description: '內地規費' }] })
  assert.equal(result.status, 200)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM fee_items WHERE request_id=?').get(requestId).count, 2)
})
test('結案略過收費不產生收費', async () => {
  const requestId = await newRequest()
  assert.equal((await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', skipFees: true, fees: [{ kind: 'service', currency: 'HKD', amount: 1, description: 'x' }] })).status, 200)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM fee_items WHERE request_id=?').get(requestId).count, 0)
})
test('結案收費資料錯誤時整個結案不進行', async () => {
  const requestId = await newRequest()
  assert.equal((await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', fees: [{ kind: 'annual', currency: 'HKD', amount: 100, description: 'x' }] })).status, 400)
  assert.equal(state.db.prepare('SELECT status FROM requests WHERE id=?').get(requestId).status, '進行中')
})
test('員工結案不可記錄收費', async () => {
  const requestId = await newRequest()
  assert.equal((await request(`/requests/${requestId}`, 'PATCH', { status: '已完成', fees: [{ kind: 'service', currency: 'HKD', amount: 100, description: 'x' }] }, 'staff')).status, 403)
})

// ── 租金管理費 ──
test('代收租金入帳時自動產生租金管理費，重複收款不重複', async () => {
  const start = `${hk().slice(0, 7)}-01`
  const contract = (await request('/rental-contracts', 'POST', { plateId: state.plate, renter: { name: '承租人' }, startsOn: start, rentAmount: 1000000, currency: 'HKD', cycle: 'monthly', dueDay: 1, collectionMode: '代收', feeType: 'percent', feeValue: 10, status: '生效' })).body
  const invoice = contract.invoices[0]
  await request(`/rent-invoices/${invoice.id}/receive`, 'POST', { receivedOn: hk(), receivedAmount: 1000000 })
  await request(`/rent-invoices/${invoice.id}/receive`, 'POST', { receivedOn: hk(), receivedAmount: 1000000 })
  const items = (await request(`/fees?customerId=${state.customer}&kind=rent_commission`)).body.items
  assert.equal(items.length, 1); assert.equal(items[0].amount, 100000); assert.equal(items[0].status, '已收')
  state.invoice = invoice.id
})
test('撤銷租金收款時租金管理費作廢', async () => {
  await request(`/rent-invoices/${state.invoice}/unreceive`, 'POST')
  assert.equal((await request(`/fees?customerId=${state.customer}&kind=rent_commission`)).body.items[0].status, '作廢')
})
test('租金管理費不可手動修改', async () => {
  const item = (await request(`/fees?customerId=${state.customer}&kind=rent_commission`)).body.items[0]
  assert.equal((await request(`/fees/${item.id}`, 'PATCH', { amount: 1 })).status, 409)
})

// ── 分期 ──
test('建立分期：每期一筆收費，客戶確認後記錄時間', async () => {
  const plan = await request('/installment-plans', 'POST', { customerId: state.customer, name: '新辦粵港牌', currency: 'HKD', installments: [{ name: '定金', amount: 1000000, dueOn: hk() }, { name: '稅款', amount: 2000000, dueOn: hk() }, { name: '尾數', amount: 500000, dueOn: hk() }] })
  assert.equal(plan.status, 201); assert.equal(plan.body.items.length, 3)
  const mine = (await request('/my/fees', 'GET', undefined, 'client')).body
  const first = mine.items.find(item => item.description === '新辦粵港牌：定金')
  assert.equal(first.needsConfirm, true)
  assert.equal((await request(`/my/fees/${first.id}/confirm`, 'POST', undefined, 'client')).status, 200)
  assert.equal((await request(`/my/fees/${first.id}/confirm`, 'POST', undefined, 'client')).status, 409)
  assert.equal((await request(`/my/fees/${first.id}/confirm`, 'POST', undefined, 'other-client')).status, 404)
})
test('分期少於 2 期或資料錯誤被拒', async () => {
  for (const installments of [[], [{ name: '一次', amount: 100, dueOn: hk() }], [{ name: 'a', amount: -1, dueOn: hk() }, { name: 'b', amount: 1, dueOn: hk() }]]) assert.equal((await request('/installment-plans', 'POST', { customerId: state.customer, name: '分期', currency: 'HKD', installments })).status, 400)
})
test('非分期款項不需要客戶確認', async () => assert.equal((await request(`/my/fees/${state.gov}/confirm`, 'POST', undefined, 'client')).status, 400))

// ── 報價 ──
const quote = extra => ({ customerId: state.customer, title: '新辦粵港兩地牌報價', currency: 'HKD', validUntil: '2099-12-31', serviceCode: 'renewal', route: '粵港', items: [{ kind: 'service', description: '代辦費', amount: 800000 }, { kind: 'gov_fee', description: '規費預估', amount: 54000 }], ...extra })
test('報價流程：草擬 → 發出 → 接受，只有草擬可修改', async () => {
  const created = await request('/quotes', 'POST', quote())
  assert.equal(created.status, 201); assert.equal(created.body.total, 854000); state.quote = created.body.id
  assert.equal((await request(`/quotes/${state.quote}/accept`, 'POST')).status, 409)
  assert.equal((await request(`/quotes/${state.quote}/send`, 'POST')).body.status, '已發出')
  assert.equal((await request(`/quotes/${state.quote}`, 'PATCH', { title: '改' })).status, 409)
  assert.equal((await request(`/quotes/${state.quote}/accept`, 'POST')).body.status, '已接受')
})
test('報價資料錯誤被拒', async () => {
  for (const extra of [{ items: [] }, { items: [{ kind: 'annual', description: 'x', amount: 1 }] }, { currency: 'USD' }, { validUntil: 'x' }, { title: '' }]) assert.equal((await request('/quotes', 'POST', quote(extra))).status, 400, JSON.stringify(extra))
  assert.equal((await request('/quotes', 'POST', quote({ customerId: state.self }))).status, 400)
})
test('過了有效期的已發出報價變為已失效', async () => {
  const created = (await request('/quotes', 'POST', quote({ validUntil: '2020-01-01' }))).body
  state.db.prepare("UPDATE quotes SET status='已發出' WHERE id=?").run(created.id)
  assert.equal((await request(`/quotes/${created.id}`)).body.status, '已失效')
})
test('已接受的報價可開工單，結案時帶入預計收費，同一報價只可開一次', async () => {
  const order = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', quoteId: state.quote })
  assert.equal(order.status, 201, JSON.stringify(order.body))
  assert.equal((await request(`/requests/${order.body.id}`)).body.expectedFees.length, 2)
  assert.equal((await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', quoteId: state.quote })).status, 400)
})
test('報價可列印成 A4 頁面', async () => {
  const result = await request(`/quotes/${state.quote}/print`)
  assert.equal(result.status, 200); assert.match(result.headers['content-type'], /text\/html/); assert.match(result.text, /報價單/); assert.match(result.text, /HKD 8,540\.00/)
})

// ── 權限 ──
test('員工與客戶不能使用收費接口', async () => {
  for (const token of ['staff', 'client']) for (const path of ['/fees', '/quotes', `/customers/${state.customer}/billing`]) assert.equal((await request(path, 'GET', undefined, token)).status, 403, `${token} ${path}`)
})
test('別的租戶看不到收費和報價', async () => {
  assert.equal((await request(`/fees/${state.gov}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/quotes/${state.quote}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/customers/${state.customer}/billing`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request('/fees', 'POST', fee(), 'foreign-admin')).status, 404)
})
test('客戶帳單只看到自己的、不含作廢，並按幣種列出未收', async () => {
  const mine = (await request('/my/fees', 'GET', undefined, 'client')).body
  assert.ok(mine.items.every(item => item.status !== '作廢')); assert.ok(mine.outstanding.HKD > 0)
  assert.equal((await request('/my/fees', 'GET', undefined, 'other-client')).body.items.filter(item => item.kind !== 'annual').length, 0)
  assert.equal((await request('/my/fees')).status, 403)
})
