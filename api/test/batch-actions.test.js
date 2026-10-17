import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'

// 一次處理多項：公司批量填到期日、批量標記已辦好、一次記多筆收款
const fixture = {}
before(async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'batch-actions-'))
  process.env.DB_PATH = join(fixture.directory, 'fresh.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  fixture.server = (await import('../src/server.js')).server
  fixture.db = new DatabaseSync(process.env.DB_PATH)
  const at = new Date().toISOString()
  fixture.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', at)
  fixture.customer = randomUUID(); fixture.foreignCustomer = randomUUID()
  for (const [id, tenant] of [[fixture.customer, 'default'], [fixture.foreignCustomer, 'other']]) fixture.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(id, `客戶${id}`, '公司', tenant)
  const company = (tenant, customer, jurisdiction, name, nameEn = '') => { const id = randomUUID(); fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,name_en,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, tenant, customer, jurisdiction, name, nameEn, at, at); return id }
  fixture.hk1 = company('default', fixture.customer, '香港', '香港甲有限公司', 'HK A Limited')
  fixture.hk2 = company('default', fixture.customer, '香港', '香港乙有限公司', 'HK B Limited')
  fixture.cn1 = company('default', fixture.customer, '內地', '广州甲有限公司')
  fixture.cn2 = company('default', fixture.customer, '內地', '广州乙有限公司')
  fixture.foreignHk = company('other', fixture.foreignCustomer, '香港', '他租公司', 'Other Limited')
  for (const [token, role, customerId, tenant] of [['admin-token', 'admin', null, 'default'], ['staff-token', 'staff', null, 'default'], ['client-token', 'customer', fixture.customer, 'default'], ['other-token', 'admin', null, 'other']]) {
    const id = randomUUID()
    fixture.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(id, role, role, `${token}@test.invalid`, 'unused', customerId, tenant)
    fixture.db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, id, '2099-01-01T00:00:00Z')
  }
})
after(() => { fixture.db?.close(); fixture.server?.close(); if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin-token') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }) } }
    fixture.server.emit('request', incoming, outgoing)
  })
}
const tracked = (ownerId, code) => fixture.db.prepare('SELECT expires_on,notes FROM tracked_items WHERE owner_type=? AND owner_id=? AND code=?').get('company', ownerId, code)
const bulkDates = (body, token) => request('/tracked-items/bulk', 'PUT', body, token)
const companyBulk = (ownerIds, extra = {}) => ({ ownerType: 'company', ownerIds, code: 'hk_registered_office', expiresOn: '2027-06-30', ...extra })
const completions = (code, ownerId) => fixture.db.prepare('SELECT COUNT(*) AS n FROM rule_completions WHERE code=? AND owner_id=?').get(code, ownerId).n
const batchDone = (body, token) => request('/rule-completions/batch', 'POST', body, token)
const done = (ownerId, period = '2026', ruleCode = 'cn_annual_report') => ({ ruleCode, ownerId, period })
const newFee = async (amount = 10000, description = '代辦費') => (await request('/fees', 'POST', { customerId: fixture.customer, kind: 'service', currency: 'HKD', amount, description })).body
const payments = feeId => fixture.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE fee_item_id=?').get(feeId)
const batchPay = (body, token) => request('/fees/batch-payments', 'POST', body, token)

// ── 公司批量填到期日 ──
test('公司批量填到期日一次寫入多間公司', async () => {
  const result = await bulkDates(companyBulk([fixture.hk1, fixture.hk2]))
  assert.equal(result.status, 200)
  assert.equal(result.body.updated, 2)
  assert.equal(tracked(fixture.hk1, 'hk_registered_office').expires_on, '2027-06-30')
  assert.equal(tracked(fixture.hk2, 'hk_registered_office').expires_on, '2027-06-30')
})
test('公司批量填到期日保留原有備註', async () => {
  assert.equal((await request('/tracked-items', 'PUT', { ownerType: 'company', ownerId: fixture.hk1, code: 'hk_br', expiresOn: '2026-12-01', notes: '已交續期費' })).status, 200)
  assert.equal((await bulkDates(companyBulk([fixture.hk1, fixture.hk2], { code: 'hk_br', expiresOn: '2027-12-01' }))).status, 200)
  assert.deepEqual({ ...tracked(fixture.hk1, 'hk_br') }, { expires_on: '2027-12-01', notes: '已交續期費' })
})
test('公司批量填到期日重複操作結果相同', async () => {
  const first = await bulkDates(companyBulk([fixture.hk1], { expiresOn: '2027-07-31' }))
  const second = await bulkDates(companyBulk([fixture.hk1], { expiresOn: '2027-07-31' }))
  assert.equal(first.status, 200); assert.equal(second.status, 200)
  assert.equal(tracked(fixture.hk1, 'hk_registered_office').expires_on, '2027-07-31')
})
test('公司批量請求 null 回 400', async () => { assert.equal((await bulkDates(null)).status, 400) })
test('公司批量請求陣列回 400', async () => { assert.equal((await bulkDates([fixture.hk1])).status, 400) })
test('公司批量空公司清單回 400', async () => { assert.equal((await bulkDates(companyBulk([]))).status, 400) })
test('公司批量公司清單不是陣列回 400', async () => { assert.equal((await bulkDates(companyBulk(fixture.hk1))).status, 400) })
test('公司批量公司 ID 錯誤類型回 400', async () => { assert.equal((await bulkDates(companyBulk([42]))).status, 400) })
test('公司批量空白公司 ID 回 400', async () => { assert.equal((await bulkDates(companyBulk(['  ']))).status, 400) })
test('公司批量重複公司 ID 回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1, fixture.hk1]))).status, 400) })
test('公司批量日期無效回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1], { expiresOn: '2027-02-30' }))).status, 400) })
test('公司批量日期 null 回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1], { expiresOn: null }))).status, 400) })
test('公司批量對象類型錯誤回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1], { ownerType: 'vehicle' }))).status, 400) })
test('公司批量不存在的公司回 400 且不寫入', async () => {
  const before = tracked(fixture.hk2, 'hk_registered_office').expires_on
  assert.equal((await bulkDates(companyBulk([fixture.hk2, randomUUID()], { expiresOn: '2030-01-01' }))).status, 400)
  assert.equal(tracked(fixture.hk2, 'hk_registered_office').expires_on, before)
})
test('公司批量別的租戶公司回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.foreignHk]))).status, 400) })
test('公司批量規則不適用的公司回 400 且不寫入', async () => {
  assert.equal((await bulkDates(companyBulk([fixture.hk1, fixture.cn1], { expiresOn: '2031-01-01' }))).status, 400)
  assert.equal(tracked(fixture.cn1, 'hk_registered_office'), undefined)
  assert.notEqual(tracked(fixture.hk1, 'hk_registered_office').expires_on, '2031-01-01')
})
test('公司批量停用的規則回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1], { code: 'hk_audit_tax' }))).status, 400) })
test('公司批量不是到期類規則回 400', async () => { assert.equal((await bulkDates(companyBulk([fixture.cn1], { code: 'cn_annual_report' }))).status, 400) })
test('公司批量員工可以填', async () => { assert.equal((await bulkDates(companyBulk([fixture.cn1, fixture.cn2], { code: 'cn_registered_address' }), 'staff-token')).status, 200) })
test('公司批量客戶帳號越權回 403', async () => { assert.equal((await bulkDates(companyBulk([fixture.hk1]), 'client-token')).status, 403) })

// ── 批量標記已辦好 ──
test('批量已辦好一次標記多項', async () => {
  const result = await batchDone({ items: [done(fixture.cn1), done(fixture.cn2)] })
  assert.equal(result.status, 200)
  assert.equal(result.body.completed, 2)
  assert.equal(completions('cn_annual_report', fixture.cn1), 1)
  assert.equal(completions('cn_annual_report', fixture.cn2), 1)
})
test('批量已辦好重複操作不重複記錄', async () => {
  assert.equal((await batchDone({ items: [done(fixture.cn1)] })).status, 200)
  assert.equal(completions('cn_annual_report', fixture.cn1), 1)
})
test('批量已辦好請求 null 回 400', async () => { assert.equal((await batchDone(null)).status, 400) })
test('批量已辦好請求陣列回 400', async () => { assert.equal((await batchDone([done(fixture.cn1)])).status, 400) })
test('批量已辦好空清單回 400', async () => { assert.equal((await batchDone({ items: [] })).status, 400) })
test('批量已辦好超過 200 項回 400', async () => { assert.equal((await batchDone({ items: Array.from({ length: 201 }, () => done(fixture.cn1)) })).status, 400) })
test('批量已辦好項目錯誤類型回 400 且不寫入', async () => {
  const result = await batchDone({ items: [done(fixture.cn1, '2027'), { ruleCode: 'cn_annual_report', ownerId: fixture.cn2, period: 2027 }] })
  assert.equal(result.status, 400); assert.match(result.body.error, /第 2 項/)
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM rule_completions WHERE period='2027'").get().n, 0)
})
test('批量已辦好項目 null 回 400', async () => { assert.equal((await batchDone({ items: [null] })).status, 400) })
test('批量已辦好不存在的公司回 400', async () => { assert.match((await batchDone({ items: [done(randomUUID())] })).body.error, /規則或對象不存在/) })
test('批量已辦好別的租戶公司回 400', async () => { assert.equal((await batchDone({ items: [done(fixture.foreignHk, '2026', 'hk_nar1')] })).status, 400) })
test('批量已辦好規則不適用的公司回 400', async () => { assert.match((await batchDone({ items: [done(fixture.hk1)] })).body.error, /規則不適用/) })
test('批量已辦好到期類事項回 400', async () => { assert.equal((await batchDone({ items: [done(fixture.hk1, '2026', 'hk_br')] })).status, 400) })
test('批量已辦好期數無效回 400', async () => { assert.match((await batchDone({ items: [done(fixture.cn1, '2026-13')] })).body.error, /期數無效/) })
test('批量已辦好同一項重複選擇回 400', async () => { assert.equal((await batchDone({ items: [done(fixture.cn1, '2028'), done(fixture.cn1, '2028')] })).status, 400) })
test('批量已辦好客戶帳號越權回 403', async () => { assert.equal((await batchDone({ items: [done(fixture.cn1, '2029')] }, 'client-token')).status, 403) })
test('批量已辦好管理者取得按次收費建議', async () => {
  fixture.db.prepare("INSERT OR REPLACE INTO price_items(tenant_id,item_code,route,billing,currency,amount,updated_at) VALUES ('default','cn_annual_report','','per_time','HKD',50000,?)").run(new Date().toISOString())
  const result = await batchDone({ items: [done(fixture.cn1, '2030'), done(fixture.cn2, '2030')] })
  assert.equal(result.status, 200)
  assert.equal(result.body.feeSuggestions.length, 2)
  assert.equal(result.body.feeSuggestions[0].amount, 50000)
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM fee_items WHERE description LIKE '%2030%'").get().n, 0)
})
test('批量已辦好員工自動記未收代辦費且不重複', async () => {
  assert.equal((await batchDone({ items: [done(fixture.cn1, '2031'), done(fixture.cn2, '2031')] }, 'staff-token')).status, 200)
  assert.equal((await batchDone({ items: [done(fixture.cn1, '2031')] }, 'staff-token')).status, 200)
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM fee_items WHERE description LIKE '%2031%'").get().n, 2)
})

// ── 一次記多筆收款 ──
test('一次記多筆收款全數收妥', async () => {
  const [a, b] = [await newFee(10000, '甲費'), await newFee(20000, '乙費')]
  const result = await batchPay({ feeIds: [a.id, b.id], paidOn: '2026-10-17', method: '轉帳' })
  assert.equal(result.status, 200)
  assert.equal(result.body.paid, 2)
  assert.deepEqual([payments(a.id).total, payments(b.id).total], [10000, 20000])
  assert.ok(result.body.items.every(item => item.outstanding === 0))
})
test('一次記收款只收部分已收收費的餘額', async () => {
  const fee = await newFee(30000, '分次費')
  assert.equal((await request(`/fees/${fee.id}/payments`, 'POST', { paidOn: '2026-10-01', amount: 10000, method: '現金' })).status, 201)
  assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' })).status, 200)
  assert.deepEqual({ ...payments(fee.id) }, { n: 2, total: 30000 })
})
test('一次記收款重複操作回 409 且不重複收', async () => {
  const fee = await newFee(5000, '重收費')
  assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' })).status, 200)
  assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' })).status, 409)
  assert.equal(payments(fee.id).n, 1)
})
test('一次記收款請求 null 回 400', async () => { assert.equal((await batchPay(null)).status, 400) })
test('一次記收款請求陣列回 400', async () => { assert.equal((await batchPay([])).status, 400) })
test('一次記收款空清單回 400', async () => { assert.equal((await batchPay({ feeIds: [], paidOn: '2026-10-17', method: '轉帳' })).status, 400) })
test('一次記收款清單不是陣列回 400', async () => { assert.equal((await batchPay({ feeIds: 'x', paidOn: '2026-10-17', method: '轉帳' })).status, 400) })
test('一次記收款收費 ID 錯誤類型回 400', async () => { assert.equal((await batchPay({ feeIds: [1], paidOn: '2026-10-17', method: '轉帳' })).status, 400) })
test('一次記收款重複收費 ID 回 400', async () => { const fee = await newFee(); assert.equal((await batchPay({ feeIds: [fee.id, fee.id], paidOn: '2026-10-17', method: '轉帳' })).status, 400) })
test('一次記收款日期無效回 400', async () => { const fee = await newFee(); assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '17/10/2026', method: '轉帳' })).status, 400) })
test('一次記收款收款方式空白回 400', async () => { const fee = await newFee(); assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '  ' })).status, 400) })
test('一次記收款不存在的收費回 404 且不寫入', async () => {
  const fee = await newFee(7000, '不寫入費')
  assert.equal((await batchPay({ feeIds: [fee.id, randomUUID()], paidOn: '2026-10-17', method: '轉帳' })).status, 404)
  assert.equal(payments(fee.id).n, 0)
})
test('一次記收款別的租戶收費回 404', async () => {
  const foreign = (await request('/fees', 'POST', { customerId: fixture.foreignCustomer, kind: 'service', currency: 'HKD', amount: 1000, description: '他租費' }, 'other-token')).body
  assert.equal((await batchPay({ feeIds: [foreign.id], paidOn: '2026-10-17', method: '轉帳' })).status, 404)
})
test('一次記收款已作廢收費回 409', async () => {
  const fee = await newFee(1000, '作廢費')
  assert.equal((await request(`/fees/${fee.id}/void`, 'POST', { reason: '開錯' })).status, 200)
  assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' })).status, 409)
})
test('一次記收款員工回 403', async () => { const fee = await newFee(); assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' }, 'staff-token')).status, 403) })
test('一次記收款客戶帳號越權回 403', async () => { const fee = await newFee(); assert.equal((await batchPay({ feeIds: [fee.id], paidOn: '2026-10-17', method: '轉帳' }, 'client-token')).status, 403) })
