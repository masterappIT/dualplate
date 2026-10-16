import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

const state = {}
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const month = () => day().slice(0, 7)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'filings-redesign-'))
  process.env.DB_PATH = join(state.dir, 'fresh.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('default'); seedRules('other')
  for (const [key, tenant] of [['customer', 'default'], ['foreignCustomer', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state[key], key, '個人', tenant)
  }
  for (const [key, tenant, customer, jurisdiction, taxpayer] of [['one', 'default', state.customer, '內地', '小規模納稅人'], ['two', 'default', state.customer, '內地', '小規模納稅人'], ['general', 'default', state.customer, '內地', '一般納稅人'], ['hk', 'default', state.customer, '香港', ''], ['foreign', 'other', state.foreignCustomer, '內地', '']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO companies(id,tenant_id,customer_id,name,jurisdiction,status,taxpayer_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(state[key], tenant, customer, key, jurisdiction, '存續', taxpayer, new Date().toISOString(), new Date().toISOString())
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const id = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(id, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customer, tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, id, '2099-01-01T00:00:00Z')
  }
  state.server = (await import('../src/server.js')).server
  state.firm = randomUUID(); state.foreignFirm = randomUUID()
  const insertFirm = db.prepare('INSERT INTO accounting_firms(id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
  insertFirm.run(state.firm, 'default', '本地會計', day(), day())
  insertFirm.run(state.foreignFirm, 'other', '外租戶會計', day(), day())
  await request('/filings')
  await request('/filings', 'GET', undefined, 'foreign-admin')
  const get = company => db.prepare('SELECT id FROM filing_periods WHERE company_id=? AND period=?').get(company, month())?.id
  state.periodOne = get(state.one); state.periodTwo = get(state.two); state.periodGeneral = get(state.general); state.periodForeign = get(state.foreign)
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { let value = null; try { value = typeof data === 'string' && data ? JSON.parse(data) : null } catch {} resolve({ status: this.status, body: value }) } }))
}
const bulk = (ids, action = 'docs_received', token = 'admin') => request('/filings/bulk', 'POST', { ids, action }, token)
const setup = (companyIds, accountingFirmId = state.firm, filingCycle = 'monthly', token = 'admin') => request('/companies/filing-setup', 'PUT', { companyIds, accountingFirmId, filingCycle }, token)
const row = id => state.db.prepare('SELECT * FROM filing_periods WHERE id=?').get(id)

test('批量期數：空陣列被拒', async () => assert.equal((await bulk([])).status, 400))
test('批量期數：null 被拒', async () => assert.equal((await request('/filings/bulk', 'POST', null)).status, 400))
test('批量期數：非陣列被拒', async () => assert.equal((await request('/filings/bulk', 'POST', { ids: 'bad', action: 'docs_received' })).status, 400))
test('批量期數：錯誤類型 ID 被拒', async () => assert.equal((await bulk([17])).status, 400))
test('批量期數：空白 ID 被拒', async () => assert.equal((await bulk([' '])).status, 400))
test('批量期數：不支援的操作被拒', async () => assert.equal((await bulk([state.periodOne], 'paid')).status, 400))
test('批量期數：不存在 ID 略過並說明', async () => { const result = await bulk(['missing']); assert.equal(result.status, 200); assert.equal(result.body.updated.length, 0); assert.equal(result.body.skipped.length, 1); assert.match(result.body.skipped[0].reason, /不存在/) })
test('批量期數：別的租戶 ID 略過且不洩露', async () => { const result = await bulk([state.periodForeign]); assert.equal(result.status, 200); assert.deepEqual(result.body.skipped[0], { id: state.periodForeign, reason: '期數不存在或無權限' }); assert.equal(row(state.periodForeign).docs_received_on, null) })
test('批量期數：員工越權', async () => assert.equal((await bulk([state.periodOne], 'docs_received', 'staff')).status, 403))
test('批量期數：客戶越權', async () => assert.equal((await bulk([state.periodOne], 'docs_received', 'client')).status, 403))
test('批量期數：只更新下一步相符的期數', async () => { const result = await bulk([state.periodOne], 'docs_received'); assert.deepEqual(result.body.updated, [state.periodOne]); assert.equal(row(state.periodOne).docs_received_on, day()) })
test('批量期數：重複執行第二次全略過', async () => { const result = await bulk([state.periodOne], 'docs_received'); assert.equal(result.body.updated.length, 0); assert.equal(result.body.skipped.length, 1) })
test('批量期數：步驟不對略過並寫原因', async () => { const result = await bulk([state.periodTwo], 'sent_to_firm'); assert.equal(result.body.updated.length, 0); assert.match(result.body.skipped[0].reason, /步驟/) })
test('批量期數：交會計公司只更新下一步相符期數', async () => { const result = await bulk([state.periodOne, state.periodTwo], 'sent_to_firm'); assert.deepEqual(result.body.updated, [state.periodOne]); assert.equal(result.body.skipped.length, 1); assert.equal(row(state.periodOne).sent_to_firm_on, day()) })
test('啟用前已處理：狀態完成且不逾期不缺回執', async () => { const result = await bulk([state.periodTwo], 'pre_system'); assert.deepEqual(result.body.updated, [state.periodTwo]); const view = (await request(`/filings/${state.periodTwo}`)).body; assert.equal(view.status, '啟用前已處理'); assert.equal(view.level, 'ok'); assert.equal(view.missingReceipt, false) })
test('啟用前已處理：不出現在到期列表', async () => { const overview = (await request('/overview')).body; assert.equal(overview.deadlines.some(item => item.filingId === state.periodTwo), false) })
test('啟用前已處理：客戶端顯示已完成', async () => { const mine = (await request('/my/filings', 'GET', undefined, 'client')).body; assert.equal(mine.find(company => company.companyId === state.two).periods.find(period => period.period === month()).status, '已完成') })
test('啟用前已處理：重複標記略過', async () => { const result = await bulk([state.periodTwo], 'pre_system'); assert.equal(result.body.updated.length, 0); assert.equal(result.body.skipped.length, 1) })
test('啟用前已處理：已申報期數不能標', async () => { await request(`/filings/${state.periodGeneral}`, 'PATCH', { filedOn: day() }); const result = await bulk([state.periodGeneral], 'pre_system'); assert.equal(result.body.updated.length, 0); assert.match(result.body.skipped[0].reason, /已申報/) })
test('批量期數：已申報但沒有票據日期也不可倒填第一步', async () => { const result = await bulk([state.periodGeneral], 'docs_received'); assert.equal(result.body.updated.length, 0); assert.match(result.body.skipped[0].reason, /步驟/) })
test('啟用前已處理：可取消標記', async () => { const result = await request(`/filings/${state.periodTwo}/pre-system`, 'DELETE'); assert.equal(result.status, 200); assert.equal(result.body.closedReason, ''); assert.equal(result.body.status, '未開始') })
test('啟用前已處理：未標記時不可取消', async () => assert.equal((await request(`/filings/${state.periodTwo}/pre-system`, 'DELETE')).status, 409))
test('啟用前已處理：別的租戶不可取消', async () => assert.equal((await request(`/filings/${state.periodForeign}/pre-system`, 'DELETE')).status, 404))
test('啟用前已處理：員工不可取消', async () => assert.equal((await request(`/filings/${state.periodOne}/pre-system`, 'DELETE', undefined, 'staff')).status, 403))
test('啟用前已處理：客戶不可取消', async () => assert.equal((await request(`/filings/${state.periodOne}/pre-system`, 'DELETE', undefined, 'client')).status, 403))
test('批量公司設定：空陣列被拒', async () => assert.equal((await setup([])).status, 400))
test('批量公司設定：null 被拒', async () => assert.equal((await request('/companies/filing-setup', 'PUT', null)).status, 400))
test('批量公司設定：非陣列被拒', async () => assert.equal((await setup('bad')).status, 400))
test('批量公司設定：錯誤類型公司 ID 被拒', async () => assert.equal((await setup([12])).status, 400))
test('批量公司設定：空白公司 ID 被拒', async () => assert.equal((await setup([' '])).status, 400))
test('批量公司設定：不存在 ID 被拒', async () => assert.equal((await setup(['missing'])).status, 404))
test('批量公司設定：別的租戶公司被拒且不修改其他公司', async () => { const result = await setup([state.one, state.foreign]); assert.equal(result.status, 404); assert.equal(state.db.prepare('SELECT accounting_firm_id FROM companies WHERE id=?').get(state.one).accounting_firm_id, null) })
test('批量公司設定：非內地公司被拒', async () => assert.equal((await setup([state.hk])).status, 400))
test('批量公司設定：無效週期被拒', async () => assert.equal((await setup([state.one], state.firm, 'yearly')).status, 400))
test('批量公司設定：無效會計公司被拒', async () => assert.equal((await setup([state.one], 'missing')).status, 404))
test('批量公司設定：別的租戶會計公司被拒', async () => assert.equal((await setup([state.one], state.foreignFirm)).status, 404))
test('批量公司設定：一般納稅人不可按季', async () => assert.equal((await setup([state.one, state.general], state.firm, 'quarterly')).status, 400))
test('批量公司設定：員工越權', async () => assert.equal((await setup([state.one], state.firm, 'monthly', 'staff')).status, 403))
test('批量公司設定：客戶越權', async () => assert.equal((await setup([state.one], state.firm, 'monthly', 'client')).status, 403))
test('批量公司設定：多間公司一次儲存', async () => { const result = await setup([state.one, state.two], state.firm, 'quarterly'); assert.equal(result.status, 200); assert.deepEqual(result.body.updated, [state.one, state.two]); assert.equal(state.db.prepare('SELECT filing_cycle FROM companies WHERE id=?').get(state.two).filing_cycle, 'quarterly') })
test('批量公司設定：重複操作保持同樣結果', async () => { const result = await setup([state.one, state.two], state.firm, 'quarterly'); assert.equal(result.status, 200); assert.equal(state.db.prepare('SELECT accounting_firm_id FROM companies WHERE id=?').get(state.one).accounting_firm_id, state.firm) })
