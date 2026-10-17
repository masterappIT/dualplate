import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { toSimplified, traditionalChars } from '../src/hans.js'
import { requiredHeaders } from '../src/plate-import.js'

const fixture = {}
before(async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'company-names-'))
  process.env.DB_PATH = join(fixture.directory, 'fresh.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  fixture.server = (await import('../src/server.js')).server
  fixture.db = new DatabaseSync(process.env.DB_PATH)
  fixture.customer = randomUUID()
  fixture.otherCustomer = randomUUID()
  fixture.foreignCustomer = randomUUID()
  fixture.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [id, tenant] of [[fixture.customer, 'default'], [fixture.otherCustomer, 'default'], [fixture.foreignCustomer, 'other']]) fixture.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(id, `客戶${id}`, '公司', tenant)
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
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    fixture.server.emit('request', incoming, outgoing)
  })
}
const hk = (name = '香港測試有限公司', nameEn = 'Hong Kong Test Limited') => ({ customerId: fixture.customer, jurisdiction: '香港', name, nameEn })
const mainland = name => ({ customerId: fixture.customer, jurisdiction: '內地', name })
const csvHeaders = [...requiredHeaders.slice(0, 8), '香港公司英文名', requiredHeaders[8]]
const csvRow = (card, foreign = '', english = '', inland = '') => [`客戶${fixture.customer}`, '粵港', '粵Z1234港', 'AB123', card, '2028-01-01', '2028-02-01', foreign, english, inland]
const csv = row => `${csvHeaders.join(',')}\n${row.join(',')}`
const preview = body => request('/import/plates?dryRun=1', 'POST', body)

test('香港公司新增缺英文名稱拒絕', async () => { const { nameEn, ...body } = hk(); const result = await request('/companies', 'POST', body); assert.equal(result.status, 400); assert.equal(result.body.error, '香港公司必須填寫英文名稱') })
test('香港公司新增英文名稱空字串拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文甲', ''))).status, 400) })
test('香港公司新增英文名稱空白字串拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文乙', ' \t '))).status, 400) })
test('香港公司新增英文名稱 null 拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文丙', null))).status, 400) })
test('香港公司新增英文名稱陣列拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文丁', []))).status, 400) })
test('香港公司新增英文名稱數字拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文戊', 123))).status, 400) })
test('香港公司新增英文名稱物件拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('空英文己', {}))).status, 400) })
test('香港公司英文名稱含中文拒絕', async () => { const result = await request('/companies', 'POST', hk('香港乙', '香港 Test Ltd')); assert.equal(result.status, 400); assert.match(result.body.error, /英文名稱只可用/) })
test('香港公司英文名稱超過 160 字拒絕', async () => { assert.equal((await request('/companies', 'POST', hk('香港長名', 'A'.repeat(161)))).status, 400) })
test('香港公司英文名稱保留大小寫並合併空白', async () => { const result = await request('/companies', 'POST', hk('香港大小寫', '  Hong   Kong & Co.  ')); assert.equal(result.status, 201); assert.equal(result.body.nameEn, 'Hong Kong & Co.') })
test('香港公司重複相同修改結果穩定', async () => { const made = await request('/companies', 'POST', hk('香港重複')); assert.equal(made.status, 201); const first = await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 'Repeated Ltd' }); const second = await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 'Repeated Ltd' }); assert.equal(first.status, 200); assert.equal(second.body.nameEn, first.body.nameEn) })
test('香港公司修改英文名稱空字串拒絕', async () => { const made = await request('/companies', 'POST', hk('香港修改空')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: '' })).status, 400) })
test('香港公司修改英文名稱空白字串拒絕', async () => { const made = await request('/companies', 'POST', hk('香港修改白')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: '  ' })).status, 400) })
test('香港公司修改英文名稱 null 拒絕', async () => { const made = await request('/companies', 'POST', hk('香港修改空值')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: null })).status, 400) })
test('香港公司修改英文名稱陣列拒絕', async () => { const made = await request('/companies', 'POST', hk('香港修改陣列')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: [] })).status, 400) })
test('香港公司修改英文名稱數字拒絕', async () => { const made = await request('/companies', 'POST', hk('香港修改數字')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 42 })).status, 400) })
test('舊香港公司無英文名稱時修改其他欄位拒絕', async () => { const id = randomUUID(); fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, 'default', fixture.customer, '香港', '舊公司', new Date().toISOString(), new Date().toISOString()); const result = await request(`/companies/${id}`, 'PATCH', { notes: '修改' }); assert.equal(result.status, 400); assert.equal(result.body.error, '香港公司必須填寫英文名稱') })
test('舊香港公司補英文名稱後可修改', async () => { const id = randomUUID(); fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, 'default', fixture.customer, '香港', '舊公司二', new Date().toISOString(), new Date().toISOString()); const result = await request(`/companies/${id}`, 'PATCH', { nameEn: 'Legacy Limited' }); assert.equal(result.status, 200); assert.equal(result.body.nameEn, 'Legacy Limited') })
test('內地公司送英文名稱會清空', async () => { const result = await request('/companies', 'POST', { ...mainland('广州测试有限公司'), nameEn: 'Ignored Ltd' }); assert.equal(result.status, 201); assert.equal(result.body.nameEn, ''); assert.equal(fixture.db.prepare('SELECT name_en FROM companies WHERE id=?').get(result.body.id).name_en, '') })
test('澳門公司送英文名稱會清空', async () => { const result = await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '澳門', name: '澳門測試有限公司', nameEn: 'Ignored Ltd' }); assert.equal(result.status, 201); assert.equal(result.body.nameEn, '') })
test('內地公司繁體名稱拒絕並給正確建議', async () => { const result = await request('/companies', 'POST', mainland('廣州達昌商貿有限公司')); assert.equal(result.status, 400); assert.match(result.body.error, /廣→广/); assert.equal(result.body.suggestion, '广州达昌商贸有限公司') })
test('內地公司修改為繁體名稱拒絕', async () => { const made = await request('/companies', 'POST', mainland('广州公司')); const result = await request(`/companies/${made.body.id}`, 'PATCH', { name: '廣州公司' }); assert.equal(result.status, 400); assert.equal(result.body.suggestion, '广州公司') })
test('舊內地繁體名稱修改其他欄位仍要求改為簡體', async () => { const id = randomUUID(); fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, 'default', fixture.customer, '內地', '廣州公司', new Date().toISOString(), new Date().toISOString()); const result = await request(`/companies/${id}`, 'PATCH', { notes: '修改' }); assert.equal(result.status, 400); assert.equal(result.body.suggestion, '广州公司') })
for (const character of ['乾', '於', '著', '瞭', '藉', '俱']) test(`簡體允許字「${character}」不被轉換或拒絕`, async () => { assert.deepEqual(traditionalChars(character), []); assert.equal(toSimplified(character), character); assert.equal((await request('/companies', 'POST', mainland(`${character}测试有限公司`))).status, 201) })
test('內地公司新增半形括號轉全形', async () => { const result = await request('/companies', 'POST', mainland('广州公司(分公司)')); assert.equal(result.status, 201); assert.equal(result.body.name, '广州公司（分公司）') })
test('內地公司修改半形括號轉全形', async () => { const made = await request('/companies', 'POST', mainland('广州括号公司')); const result = await request(`/companies/${made.body.id}`, 'PATCH', { name: '广州括号公司(一)' }); assert.equal(result.status, 200); assert.equal(result.body.name, '广州括号公司（一）') })
test('香港公司中文名稱保持原字', async () => { const result = await request('/companies', 'POST', hk('香港廣貿有限公司')); assert.equal(result.body.name, '香港廣貿有限公司') })
test('澳門公司中文名稱保持原字', async () => { const result = await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '澳門', name: '澳門廣貿有限公司' }); assert.equal(result.body.name, '澳門廣貿有限公司') })
test('公司新增請求 null 回 400', async () => { assert.equal((await request('/companies', 'POST', null)).status, 400) })
test('公司新增請求陣列回 400', async () => { assert.equal((await request('/companies', 'POST', [])).status, 400) })
test('公司修改請求 null 回 400', async () => { const made = await request('/companies', 'POST', hk('香港修改請求')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', null)).status, 400) })
test('公司修改請求陣列回 400', async () => { const made = await request('/companies', 'POST', hk('香港修改陣列請求')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', [])).status, 400) })
test('不存在公司 ID 修改回 404', async () => { assert.equal((await request(`/companies/${randomUUID()}`, 'PATCH', { nameEn: 'X Ltd' })).status, 404) })
test('別的租戶公司 ID 修改回 404', async () => { const made = await request('/companies', 'POST', { customerId: fixture.foreignCustomer, jurisdiction: '香港', name: '別租公司', nameEn: 'Other Ltd' }, 'other-token'); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 'No Ltd' })).status, 404) })
test('別的租戶客戶 ID 新增回 404', async () => { assert.equal((await request('/companies', 'POST', { ...hk('別租客戶'), customerId: fixture.foreignCustomer })).status, 404) })
test('公司不可搬到別的客戶', async () => { const made = await request('/companies', 'POST', hk('禁止搬移')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { customerId: fixture.otherCustomer })).status, 400) })
test('員工不可新增公司', async () => { assert.equal((await request('/companies', 'POST', hk('員工新增'), 'staff-token')).status, 403) })
test('員工不可修改公司', async () => { const made = await request('/companies', 'POST', hk('員工修改')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 'Staff Ltd' }, 'staff-token')).status, 403) })
test('客戶不可新增公司', async () => { assert.equal((await request('/companies', 'POST', hk('客戶新增'), 'client-token')).status, 403) })
test('客戶不可修改公司', async () => { const made = await request('/companies', 'POST', hk('客戶修改')); assert.equal((await request(`/companies/${made.body.id}`, 'PATCH', { nameEn: 'Client Ltd' }, 'client-token')).status, 403) })
test('客戶端公司接口回傳英文名稱', async () => { const made = await request('/companies', 'POST', hk('客戶端顯示', 'Client Display Ltd')); const result = await request('/my/companies', 'GET', undefined, 'client-token'); assert.equal(result.status, 200); assert.match(JSON.stringify(result.body), /Client Display Ltd/); assert.ok(made.body.id) })
test('公司列表空客戶參數回傳全部本租戶公司', async () => { const result = await request('/companies?customerId='); assert.equal(result.status, 200); assert.ok(Array.isArray(result.body)) })
test('公司列表 null 客戶參數回 404', async () => { assert.equal((await request('/companies?customerId=null')).status, 404) })
test('公司列表陣列形狀客戶參數回 404', async () => { assert.equal((await request('/companies?customerId=%5B%5D')).status, 404) })
test('公司列表錯誤類型客戶參數回 404', async () => { assert.equal((await request('/companies?customerId=42')).status, 404) })
test('公司列表不存在客戶 ID 回 404', async () => { assert.equal((await request(`/companies?customerId=${randomUUID()}`)).status, 404) })
test('公司列表別的租戶客戶 ID 回 404', async () => { assert.equal((await request(`/companies?customerId=${fixture.foreignCustomer}`)).status, 404) })
test('公司列表員工可讀英文名稱', async () => { const result = await request(`/companies?customerId=${fixture.customer}`, 'GET', undefined, 'staff-token'); assert.equal(result.status, 200); assert.ok(result.body.some(item => item.nameEn === 'Client Display Ltd')) })
test('公司列表客戶帳號越權回 403', async () => { assert.equal((await request(`/companies?customerId=${fixture.customer}`, 'GET', undefined, 'client-token')).status, 403) })
test('公司列表重複讀取結果穩定', async () => { const path = `/companies?customerId=${fixture.customer}`; const first = await request(path); const second = await request(path); assert.deepEqual(second.body, first.body) })
test('客戶端公司接口不回傳其他客戶公司', async () => { const made = await request('/companies', 'POST', { ...hk('其他客戶公司', 'Other Customer Ltd'), customerId: fixture.otherCustomer }); assert.equal(made.status, 201); const result = await request('/my/companies', 'GET', undefined, 'client-token'); assert.equal(result.status, 200); assert.doesNotMatch(JSON.stringify(result.body), /Other Customer Ltd/) })
test('客戶端公司接口重複讀取結果穩定', async () => { const first = await request('/my/companies', 'GET', undefined, 'client-token'); const second = await request('/my/companies', 'GET', undefined, 'client-token'); assert.deepEqual(second.body, first.body) })
test('CSV 繁體內地名稱預覽顯示轉換', async () => { const result = await preview({ csv: csv(csvRow('CARD-CONVERT', '', '', '廣州達昌商貿有限公司')) }); assert.equal(result.status, 200); assert.equal(result.body.rows[0].values['內地公司'], '广州达昌商贸有限公司'); assert.match(result.body.rows[0].conversions[0], /已轉為簡體：廣州達昌商貿有限公司 → 广州达昌商贸有限公司/) })
test('CSV 繁體內地名稱轉換後與現有公司同名不重複建立', async () => { const original = await request('/companies', 'POST', mainland('广州达昌商贸有限公司')); const input = csv(csvRow('CARD-DUPLICATE', '香港配對甲', 'Pair One Ltd', '廣州達昌商貿有限公司')); const result = await preview({ csv: input }); assert.equal(result.body.summary.error, 0); assert.match(result.body.rows[0].conversions.join('；'), /沿用現有公司：广州达昌商贸有限公司/); const confirmed = await request('/import/plates', 'POST', { csv: input, previewKey: result.body.previewKey, confirm: true }); assert.equal(confirmed.status, 200); const company = fixture.db.prepare('SELECT id,group_id FROM companies WHERE customer_id=? AND name=?').all(fixture.customer, original.body.name); const plate = fixture.db.prepare('SELECT group_id FROM plate_assets WHERE customer_id=? AND card_number=?').get(fixture.customer, 'CARD-DUPLICATE'); assert.equal(company.length, 1); assert.equal(company[0].id, original.body.id); assert.ok(plate.group_id); assert.equal(company[0].group_id, plate.group_id) })
test('CSV 已歸組內地公司不會被搬進新公司組', async () => { const group = await request('/company-groups', 'POST', { customerId: fixture.customer, name: '既有內地組' }); assert.equal(group.status, 201); const original = await request('/companies', 'POST', { ...mainland('广州已归组公司'), groupId: group.body.id }); assert.equal(original.status, 201); const result = await preview({ csv: csv(csvRow('CARD-CN-GROUPED', '香港配對乙', 'Pair Two Ltd', '廣州已歸組公司')) }); assert.equal(result.body.summary.error, 1); assert.match(result.body.rows[0].errors.join('；'), /內地公司已屬公司組（既有內地組），請先在客戶的公司頁調整/); assert.equal(fixture.db.prepare('SELECT group_id FROM companies WHERE id=?').get(original.body.id).group_id, group.body.id) })
test('CSV 未分組香港公司會掛進新公司組', async () => { const original = await request('/companies', 'POST', hk('香港沿用甲', 'Reuse One Ltd')); assert.equal(original.status, 201); const input = csv(csvRow('CARD-HK-LOOSE', '香港沿用甲', '', '广州新配对公司')); const result = await preview({ csv: input }); assert.equal(result.body.summary.error, 0); assert.match(result.body.rows[0].conversions.join('；'), /沿用現有公司：香港沿用甲/); const confirmed = await request('/import/plates', 'POST', { csv: input, previewKey: result.body.previewKey, confirm: true }); assert.equal(confirmed.status, 200); const company = fixture.db.prepare('SELECT group_id FROM companies WHERE id=?').get(original.body.id); const plate = fixture.db.prepare('SELECT group_id FROM plate_assets WHERE customer_id=? AND card_number=?').get(fixture.customer, 'CARD-HK-LOOSE'); assert.ok(plate.group_id); assert.equal(company.group_id, plate.group_id) })
test('CSV 已歸組香港公司不會被搬進新公司組', async () => { const group = await request('/company-groups', 'POST', { customerId: fixture.customer, name: '既有香港組' }); assert.equal(group.status, 201); const original = await request('/companies', 'POST', { ...hk('香港已歸組', 'Grouped HK Ltd'), groupId: group.body.id }); assert.equal(original.status, 201); const result = await preview({ csv: csv(csvRow('CARD-HK-GROUPED', '香港已歸組', '', '广州新配对乙')) }); assert.equal(result.body.summary.error, 1); assert.match(result.body.rows[0].errors.join('；'), /香港公司已屬公司組（既有香港組），請先在客戶的公司頁調整/); assert.equal(fixture.db.prepare('SELECT group_id FROM companies WHERE id=?').get(original.body.id).group_id, group.body.id) })
test('CSV 同檔新香港公司英文名稱不一致時第二列報錯', async () => { const first = csvRow('CARD-HK-DIFF-ONE', '香港同檔甲', 'B One Ltd', '广州配对丙'); const second = csvRow('CARD-HK-DIFF-TWO', '香港同檔甲', 'B Two Ltd', '广州配对丙'); const result = await preview({ csv: `${csv(first)}\n${second.join(',')}` }); assert.equal(result.body.rows[0].errors.length, 0); assert.match(result.body.rows[1].errors.join('；'), /同一檔案內香港公司英文名稱不一致/); assert.equal(result.body.summary.error, 1) })
test('CSV 同檔新香港公司第二列英文名稱留空視為一致', async () => { const first = csvRow('CARD-HK-BLANK-ONE', '香港同檔乙', 'B One Ltd', '广州配对丁'); const second = csvRow('CARD-HK-BLANK-TWO', '香港同檔乙', '', '广州配对丁'); const input = `${csv(first)}\n${second.join(',')}`; const result = await preview({ csv: input }); assert.equal(result.body.summary.error, 0); const confirmed = await request('/import/plates', 'POST', { csv: input, previewKey: result.body.previewKey, confirm: true }); assert.equal(confirmed.status, 200); const company = fixture.db.prepare('SELECT group_id,name_en FROM companies WHERE customer_id=? AND name=?').get(fixture.customer, '香港同檔乙'); const plates = fixture.db.prepare('SELECT group_id FROM plate_assets WHERE customer_id=? AND card_number IN (?,?)').all(fixture.customer, 'CARD-HK-BLANK-ONE', 'CARD-HK-BLANK-TWO'); assert.equal(company.name_en, 'B One Ltd'); assert.equal(plates.length, 2); assert.ok(plates.every(plate => plate.group_id === company.group_id)) })
test('CSV 現有香港公司缺英文名稱時補上並保持牌照歸組', async () => { const companyId = randomUUID(); fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(companyId, 'default', fixture.customer, '香港', '香港舊英文缺漏', new Date().toISOString(), new Date().toISOString()); const input = csv(csvRow('CARD-HK-FILL', '香港舊英文缺漏', 'Filled Legacy Ltd', '广州新配对戊')); const result = await preview({ csv: input }); assert.equal(result.body.summary.error, 0); assert.match(result.body.rows[0].conversions.join('；'), /補上英文名稱：Filled Legacy Ltd/); const confirmed = await request('/import/plates', 'POST', { csv: input, previewKey: result.body.previewKey, confirm: true }); assert.equal(confirmed.status, 200); const company = fixture.db.prepare('SELECT group_id,name_en FROM companies WHERE id=?').get(companyId); const plate = fixture.db.prepare('SELECT group_id FROM plate_assets WHERE customer_id=? AND card_number=?').get(fixture.customer, 'CARD-HK-FILL'); assert.equal(company.name_en, 'Filled Legacy Ltd'); assert.ok(plate.group_id); assert.equal(company.group_id, plate.group_id) })
test('CSV 內地半形括號轉全形', async () => { const result = await preview({ csv: csv(csvRow('CARD-PARENS', '', '', '广州公司(分公司)')) }); assert.equal(result.body.rows[0].values['內地公司'], '广州公司（分公司）') })
test('CSV 新建香港公司缺英文名稱逐列報錯', async () => { const result = await preview({ csv: csv(csvRow('CARD-NEW-HK', '香港新公司', '', '广州公司')) }); assert.equal(result.body.summary.error, 1); assert.match(result.body.rows[0].errors.join(''), /新建香港公司必須填寫英文名稱/) })
test('CSV 已存在香港公司英文名稱不同逐列報錯', async () => { await request('/companies', 'POST', hk('香港已有公司', 'Existing Ltd')); const result = await preview({ csv: csv(csvRow('CARD-HK-DIFF', '香港已有公司', 'Different Ltd', '广州公司')) }); assert.equal(result.body.summary.error, 1); assert.match(result.body.rows[0].errors.join(''), /英文名稱與現有資料不符/) })
test('CSV 已存在香港公司英文欄可留空', async () => { await request('/companies', 'POST', hk('香港留空公司', 'Existing Ltd')); const result = await preview({ csv: csv(csvRow('CARD-HK-BLANK', '香港留空公司', '', '广州公司')) }); assert.equal(result.body.summary.error, 0) })
test('CSV 香港公司英文名稱合併連續空白後比對', async () => { await request('/companies', 'POST', hk('香港空白公司', 'Existing  Company Ltd')); const result = await preview({ csv: csv(csvRow('CARD-HK-SPACES', '香港空白公司', 'Existing   Company Ltd', '广州公司')) }); assert.equal(result.body.summary.error, 0) })
test('CSV 舊表頭沒有英文欄仍可匯入內地公司', async () => { const row = [`客戶${fixture.customer}`, '粵港', '粵Z1234港', 'AB123', 'CARD-OLD', '2028-01-01', '2028-02-01', '', '广州老公司']; const result = await preview({ csv: `${requiredHeaders.join(',')}\n${row.join(',')}` }); assert.equal(result.status, 200); assert.equal(result.body.summary.error, 0) })
test('CSV 舊表頭新建香港公司仍要求英文名稱', async () => { const row = [`客戶${fixture.customer}`, '粵港', '粵Z1234港', 'AB123', 'CARD-OLD-HK', '2028-01-01', '2028-02-01', '香港舊欄公司', '广州公司']; const result = await preview({ csv: `${requiredHeaders.join(',')}\n${row.join(',')}` }); assert.equal(result.body.summary.error, 1) })
test('CSV 粵澳英文欄有值仍被忽略', async () => { const row = csvRow('CARD-MACAO', '澳門公司', 'Ignored Ltd', '广州公司'); row[1] = '粵澳'; const result = await preview({ csv: csv(row) }); assert.equal(result.body.summary.error, 0) })
test('CSV 預覽空請求回 400', async () => { assert.equal((await preview({})).status, 400) })
test('CSV 預覽空白字串回 400', async () => { assert.equal((await preview({ csv: '  ' })).status, 400) })
test('CSV 預覽 null 回 400', async () => { assert.equal((await preview(null)).status, 400) })
test('CSV 預覽陣列回 400', async () => { assert.equal((await preview({ csv: [] })).status, 400) })
test('CSV 預覽錯誤類型回 400', async () => { assert.equal((await preview({ csv: 123 })).status, 400) })
test('CSV 預覽別的租戶客戶逐列報錯', async () => { const row = csvRow('CARD-FOREIGN'); row[0] = `客戶${fixture.foreignCustomer}`; const result = await preview({ csv: csv(row) }); assert.equal(result.body.summary.error, 1) })
test('CSV 預覽員工越權回 403', async () => { assert.equal((await request('/import/plates?dryRun=1', 'POST', { csv: csv(csvRow('CARD-STAFF')) }, 'staff-token')).status, 403) })
test('CSV 預覽客戶越權回 403', async () => { assert.equal((await request('/import/plates?dryRun=1', 'POST', { csv: csv(csvRow('CARD-CLIENT')) }, 'client-token')).status, 403) })
test('CSV 確認沒有預覽金鑰回 400', async () => { assert.equal((await request('/import/plates', 'POST', { csv: csv(csvRow('CARD-NOKEY')), confirm: true })).status, 400) })
test('CSV 重複列逐列報錯', async () => { const row = csvRow('CARD-REPEAT'); const result = await preview({ csv: `${csv(row)}\n${row.join(',')}` }); assert.equal(result.body.summary.error, 1); assert.match(result.body.rows[1].errors.join(''), /重複/) })
