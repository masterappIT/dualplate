import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 20 輪每月客戶報告。進程內請求，不開連接埠。
const state = {}
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const month = (offset = 0) => { const [y, m] = hk().split('-').map(Number); return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7) }
const last = month(-1)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'reports-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'otherCustomer', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.otherCustomer, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  state.self = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  const now = new Date().toISOString(), soon = new Date(Date.parse(hk()) + 20 * 86400000).toISOString().slice(0, 10)
  state.plate = randomUUID()
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,card_expires_on,usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(state.plate, state.customer, '粵港', '粵Z報告港', state.plate, soon, '自用', now, now)
  // 上月完成的工單
  db.prepare('INSERT INTO requests(id,customer_id,plate_asset_id,service_code,route,title,status,stage,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), state.customer, state.plate, 'renewal', '粵港', '批文續期', '已完成', '完成', now, now, `${last}-20T08:00:00.000Z`)
  // 上月的內地公司報帳
  state.company = randomUUID()
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,name,jurisdiction,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(state.company, 'default', state.customer, '示範內地貿易', '內地', '存續', now, now)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['other-client', 'customer', state.otherCustomer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID()
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
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const reportOf = async customerId => (await request(`/reports?customerId=${customerId}&period=${last}`)).body

test('準備上月的使用費、收費與報帳資料', async () => {
  const contract = (await request('/rental-contracts', 'POST', { plateId: state.plate, renter: { name: '承租人甲' }, startsOn: `${last}-01`, rentAmount: 1000000, currency: 'HKD', cycle: 'monthly', dueDay: 5, collectionMode: '代收', feeType: 'percent', feeValue: 10, status: '生效' })).body
  const invoice = contract.invoices.find(item => item.period === last)
  assert.equal((await request(`/rent-invoices/${invoice.id}/receive`, 'POST', { receivedOn: `${last}-06`, receivedAmount: 1000000 })).status, 200)
  assert.equal((await request('/fees', 'POST', { customerId: state.customer, kind: 'advance', currency: 'HKD', amount: 50000, description: '代墊保險', incurredOn: `${last}-10` })).status, 201)
  assert.equal((await request('/fees', 'POST', { customerId: state.customer, kind: 'gov_fee', currency: 'RMB', amount: 8000, description: '內地規費', incurredOn: `${last}-12` })).status, 201)
  await request('/filings')
  const filing = (await request(`/filings?companyId=${state.company}&period=${last}`)).body[0]
  assert.equal((await request(`/filings/${filing.id}`, 'PATCH', { filedOn: `${month(0)}-02`, zeroFiling: true })).status, 200)
})
test('打開報告列表時為每位客戶產生上月草稿，重複打開不重複', async () => {
  await request('/reports'); await request('/reports')
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM monthly_reports WHERE customer_id=? AND period=?').get(state.customer, last).count, 1)
})
test('本公司自有客戶不產生報告', async () => assert.equal((await request(`/reports?customerId=${state.self}`)).body.length, 0))
test('草稿重算後六節內容正確', async () => {
  const [draft] = await reportOf(state.customer)
  const report = (await request(`/reports/${draft.id}/recalculate`, 'POST')).body.report
  assert.equal(report.completed.length, 1)
  assert.ok(report.upcoming.some(item => item.name === '批文／指標有效期' && item.handledBy === 'us'))
  assert.equal(report.usage.received.HKD, 1000000)
  assert.ok(report.charges.byKind.advance.HKD === 50000 && report.charges.byKind.rent_commission.HKD === 100000)
  assert.equal(report.filings[0].status, '已完成')
  state.draft = draft.id
})
test('淨額按幣種分列不換算：港幣為應付客戶（正），人民幣為客戶應付（負）', async () => {
  const net = (await request(`/reports/${state.draft}`)).body.report.net.net
  assert.equal(net.HKD, 1000000 - 100000 - 50000); assert.equal(net.RMB, -8000)
})
test('客戶自理的到期項目標示「請你處理」', async () => {
  await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' })
  const report = (await request(`/reports/${state.draft}/recalculate`, 'POST')).body.report
  assert.ok(report.upcoming.filter(item => item.name === '批文／指標有效期').every(item => item.handledBy === 'you'))
})
test('客戶看不到草稿', async () => assert.equal((await request('/my/reports', 'GET', undefined, 'client')).body.length, 0))
test('員工可以看報告但不能確認', async () => {
  assert.equal((await request(`/reports/${state.draft}`, 'GET', undefined, 'staff')).status, 200)
  assert.equal((await request(`/reports/${state.draft}/confirm`, 'POST', undefined, 'staff')).status, 403)
})
test('確認後客戶看得到，數字凍結，之後改收費不影響', async () => {
  assert.equal((await request(`/reports/${state.draft}/confirm`, 'POST')).body.status, '已確認')
  await request('/fees', 'POST', { customerId: state.customer, kind: 'service', currency: 'HKD', amount: 99999, description: '補記代辦費', incurredOn: `${last}-25` })
  const mine = (await request(`/my/reports/${state.draft}`, 'GET', undefined, 'client')).body
  assert.equal(mine.report.net.net.HKD, 850000)
  assert.equal((await request(`/reports/${state.draft}/recalculate`, 'POST')).status, 409)
  assert.equal((await request(`/reports/${state.draft}/confirm`, 'POST')).status, 409)
})
test('更正版保留舊版；新版確認前客戶仍看到舊版，確認後舊版標為已更正', async () => {
  const correction = await request(`/reports/${state.draft}/correct`, 'POST')
  assert.equal(correction.status, 201); assert.equal(correction.body.version, 2)
  assert.equal((await request(`/reports/${state.draft}/correct`, 'POST')).status, 409)
  assert.equal((await request('/my/reports', 'GET', undefined, 'client')).body[0].id, state.draft)
  await request(`/reports/${correction.body.id}/confirm`, 'POST')
  const mine = (await request('/my/reports', 'GET', undefined, 'client')).body
  assert.equal(mine.length, 1); assert.equal(mine[0].version, 2); assert.equal(mine[0].net.HKD, 850000 - 99999)
  assert.equal((await request(`/reports/${state.draft}`)).body.status, '已更正')
  assert.equal((await request(`/reports/${correction.body.id}`)).body.versions.length, 2)
})
test('客戶看不到別人的報告', async () => {
  assert.equal((await request(`/my/reports/${state.draft}`, 'GET', undefined, 'other-client')).status, 404)
  assert.equal((await request('/reports', 'GET', undefined, 'client')).status, 403)
})
test('別的租戶看不到報告', async () => {
  assert.equal((await request(`/reports/${state.draft}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.ok((await request('/reports', 'GET', undefined, 'foreign-admin')).body.every(item => item.customerId === state.foreign))
})
test('報告內容不出現「租金」字眼', async () => {
  const [latest] = (await request('/my/reports', 'GET', undefined, 'client')).body
  const text = JSON.stringify((await request(`/my/reports/${latest.id}`, 'GET', undefined, 'client')).body)
  assert.ok(text.includes('代收服務費')); assert.ok(!text.includes('租金'))
})
test('沒有任何內容的客戶不產生空白月報', async () => {
  const empty = randomUUID()
  state.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(empty, '新客戶空白', '個人', 'default')
  assert.equal((await request(`/reports?customerId=${empty}`)).body.length, 0)
})
