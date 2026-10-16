import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 19 輪內地公司報帳報稅追蹤。進程內請求，不開連接埠。
const state = {}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const month = (offset = 0) => { const [y, m] = hk().split('-').map(Number); return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7) }
const plusDays = days => new Date(Date.parse(hk()) + days * 86400000).toISOString().slice(0, 10)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'bookkeeping-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'otherCustomer', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.otherCustomer, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  const now = new Date().toISOString()
  for (const [key, customerId, tenant, jurisdiction, status, taxpayer] of [['monthly', state.customer, 'default', '內地', '存續', '一般納稅人'], ['quarterly', state.customer, 'default', '內地', '存續', '小規模納稅人'], ['dissolving', state.customer, 'default', '內地', '存續', ''], ['clientHandled', state.customer, 'default', '內地', '存續', ''], ['hk', state.customer, 'default', '香港', '存續', ''], ['other', state.otherCustomer, 'default', '內地', '存續', ''], ['foreign', state.foreign, 'other', '內地', '存續', '']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO companies(id,tenant_id,customer_id,name,jurisdiction,status,taxpayer_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(state[key], tenant, customerId, `${key}公司`, jurisdiction, status, taxpayer, now, now)
  }
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
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
const periodsOf = companyId => state.db.prepare('SELECT period FROM filing_periods WHERE company_id=? ORDER BY period').all(companyId).map(row => row.period)
const filing = async (companyId, period) => (await request(`/filings?companyId=${companyId}&period=${period}`)).body[0]

// ── 會計公司與設定 ──
test('新增會計公司並指派給內地公司', async () => {
  const firm = await request('/accounting-firms', 'POST', { name: '信達會計', contact: '何小姐', phone: '+86 755 1234 5678', email: 'ho@example.com' })
  assert.equal(firm.status, 201); state.firm = firm.body.id
  assert.equal((await request(`/companies/${state.monthly}/filing-setup`, 'PUT', { accountingFirmId: state.firm })).status, 200)
})
test('會計公司資料錯誤被拒', async () => { for (const body of [null, {}, { name: ' ' }, { name: 'x', email: 'bad' }, { name: 'x', phone: 1 }]) assert.equal((await request('/accounting-firms', 'POST', body)).status, 400) })
test('香港公司不可設定報帳；一般納稅人不可按季', async () => {
  assert.equal((await request(`/companies/${state.hk}/filing-setup`, 'PUT', { filingCycle: 'monthly' })).status, 400)
  assert.equal((await request(`/companies/${state.monthly}/filing-setup`, 'PUT', { filingCycle: 'quarterly' })).status, 400)
  assert.equal((await request(`/companies/${state.monthly}/filing-setup`, 'PUT', { accountingFirmId: randomUUID() })).status, 404)
  assert.equal((await request(`/companies/${state.quarterly}/filing-setup`, 'PUT', { filingCycle: 'quarterly' })).status, 200)
})

// ── 生成 ──
test('每間內地公司生成到本月為止最近 3 期，重複讀取不重複', async () => {
  await request('/filings'); await request('/filings')
  assert.deepEqual(periodsOf(state.monthly), [month(-2), month(-1), month(0)])
})
test('按季申報只在季首月生成', async () => assert.ok(periodsOf(state.quarterly).every(period => (Number(period.slice(5)) - 1) % 3 === 0)))
test('香港公司不生成報帳工作', async () => assert.equal(periodsOf(state.hk).length, 0))
test('報帳報稅設為客戶自理時不生成', async () => {
  state.db.prepare('DELETE FROM filing_periods WHERE company_id=?').run(state.clientHandled)
  await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.clientHandled, service: 'bookkeeping', handler: 'client' })
  await request('/filings')
  assert.equal(periodsOf(state.clientHandled).length, 0)
})
test('公司註銷後未完成的期數標記「公司已註銷」，不刪除也不再生成', async () => {
  await request('/filings')
  const before = periodsOf(state.dissolving).length
  state.db.prepare("UPDATE companies SET status='已註銷' WHERE id=?").run(state.dissolving)
  const rows = (await request(`/filings?companyId=${state.dissolving}`)).body
  assert.equal(rows.length, before); assert.ok(rows.every(row => row.status === '公司已註銷'))
  assert.equal((await request(`/filings/${rows[0].id}`, 'PATCH', { docsReceivedOn: hk() })).status, 409)
})

// ── 狀態 ──
test('狀態由步驟推算', async () => {
  const row = await filing(state.monthly, month(0))
  assert.equal(row.status, '未開始')
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { docsReceivedOn: hk() })).body.status, '資料已收')
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { sentToFirmOn: hk() })).body.status, '會計處理中')
  const filed = (await request(`/filings/${row.id}`, 'PATCH', { filedOn: hk(), taxAmount: 123456 })).body
  assert.equal(filed.status, '已申報'); assert.equal(filed.missingReceipt, true)
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { paidOn: hk() })).body.status, '已完成')
  state.done = row.id
})
test('零申報在已申報時即完成，不可記錄繳款', async () => {
  const row = await filing(state.monthly, month(-1))
  const result = (await request(`/filings/${row.id}`, 'PATCH', { filedOn: hk(), zeroFiling: true })).body
  assert.equal(result.status, '已完成'); assert.equal(result.taxAmount, 0)
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { paidOn: hk() })).status, 400)
})
test('步驟日期不可早於前一步，未申報不可繳款', async () => {
  const row = await filing(state.monthly, month(-2))
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { docsReceivedOn: hk(), sentToFirmOn: plusDays(-3) })).status, 400)
  assert.equal((await request(`/filings/${row.id}`, 'PATCH', { paidOn: hk() })).status, 400)
  for (const body of [null, { filedOn: '2026-02-30' }, { taxAmount: -1 }, { taxAmount: 1.5 }, { zeroFiling: 'yes' }]) assert.equal((await request(`/filings/${row.id}`, 'PATCH', body)).status, 400)
})
test('過了截止日未申報為已逾期，並列入總覽', async () => {
  const row = await filing(state.monthly, month(-2))
  assert.equal(row.level, 'overdue')
  const overview = (await request('/overview')).body
  assert.ok(overview.deadlines.some(item => item.ruleCode === 'monthly_filing' && item.filingId === row.id && item.name === `報稅：monthly公司 ${month(-2)}`))
})
test('截止前 5 天內未申報為需處理，6 天以上為即將到期', async () => {
  // 上個月的期數截止日在本月，可設在今天之後 3 天和 6 天
  assert.equal((await request(`/filing-calendar/${month(-1)}`, 'PUT', { dueOn: plusDays(3) })).status, 200)
  assert.equal((await filing(state.other, month(-1))).level, 'due')
  assert.equal((await request(`/filing-calendar/${month(-1)}`, 'PUT', { dueOn: plusDays(6) })).status, 200)
  assert.equal((await filing(state.other, month(-1))).level, 'upcoming')
})
test('自訂截止日跟隨到未申報的期數，已申報的不變', async () => {
  const target = `${month(1)}-20`
  assert.equal((await request(`/filing-calendar/${month(0)}`, 'PUT', { dueOn: target })).body.dueOn, target)
  assert.equal((await filing(state.other, month(0))).dueOn, target)
  assert.notEqual((await request(`/filings/${state.done}`)).body.dueOn, target)
  assert.equal((await request(`/filing-calendar/${month(0)}`)).body.custom, true)
})
test('截止日格式錯誤或早於該期被拒', async () => {
  assert.equal((await request('/filing-calendar/2026-13', 'PUT', { dueOn: '2027-01-15' })).status, 400)
  assert.equal((await request(`/filing-calendar/${month(0)}`, 'PUT', { dueOn: `${month(0)}-10` })).status, 400)
  assert.equal((await request(`/filing-calendar/${month(0)}`, 'PUT', { dueOn: 'x' })).status, 400)
})

// ── 回執 ──
test('上傳回執後不再缺回執，可讀回', async () => {
  const result = await request(`/filings/${state.done}/receipt`, 'POST', { data: PNG })
  assert.equal(result.status, 200); assert.equal(result.body.missingReceipt, false)
  assert.equal((await request(`/filings?status=缺回執`)).body.some(row => row.id === state.done), false)
})
test('回執格式或大小錯誤被拒', async () => {
  for (const body of [null, {}, { data: Buffer.from('hello').toString('base64') }, { data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }]) assert.equal((await request(`/filings/${state.done}/receipt`, 'POST', body)).status, 400)
})

// ── 矩陣與客戶 ──
test('矩陣回傳公司 × 月份的狀態', async () => {
  const matrix = (await request('/filings/matrix?months=6')).body
  assert.equal(matrix.months.length, 6); assert.equal(matrix.months.at(-1), month(0))
  const row = matrix.rows.find(item => item.companyId === state.monthly)
  assert.equal(row.firmName, '信達會計'); assert.equal(row.cells.at(-1).status, '已完成')
  assert.equal((await request('/filings/matrix?months=0')).status, 400)
})
test('客戶只看到自己的內地公司，不含會計公司和內部備註', async () => {
  await request(`/filings/${state.done}`, 'PATCH', { notes: '內部：客戶票據遲交' })
  const mine = (await request('/my/filings', 'GET', undefined, 'client')).body
  assert.ok(mine.every(item => item.companyId !== state.other && item.companyId !== state.hk))
  const text = JSON.stringify(mine)
  assert.ok(!text.includes('信達') && !text.includes('內部'))
})
test('員工與客戶不能使用報帳管理接口', async () => {
  for (const token of ['staff', 'client']) for (const path of ['/filings', '/accounting-firms', '/filings/matrix']) assert.equal((await request(path, 'GET', undefined, token)).status, 403)
  assert.equal((await request('/my/filings')).status, 403)
})
test('別的租戶看不到報帳期數與會計公司', async () => {
  assert.equal((await request(`/filings/${state.done}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/accounting-firms/${state.firm}`, 'PATCH', { name: 'x' }, 'foreign-admin')).status, 404)
  assert.equal((await request(`/companies/${state.monthly}/filing-setup`, 'PUT', { filingCycle: 'monthly' }, 'foreign-admin')).status, 404)
  assert.ok((await request('/filings', 'GET', undefined, 'foreign-admin')).body.every(row => row.companyId === state.foreign))
})
