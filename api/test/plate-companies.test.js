import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶建檔批文卡時按商號、內承單位自動連到公司（管理者 2026-10-17）
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'plate-companies-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant] of [['first', '客戶甲', 'default'], ['second', '客戶乙', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['client2', 'customer', state.second, 'default'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  // 客戶乙已有一組公司，用來測試不能選別人的公司組
  state.otherGroup = (await request('/company-groups', 'POST', { customerId: state.second, name: '乙組' })).body.id
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.58.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const createCard = (cardData, extra = {}, token = 'client', customerId = state.first) => request('/plate-assets', 'POST', { customerId, route: '粵港', cardData, ...extra }, token)
const plate = id => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(id)
const companiesOf = customerId => state.db.prepare('SELECT * FROM companies WHERE customer_id=? ORDER BY created_at').all(customerId)
const groupCompanies = groupId => state.db.prepare('SELECT * FROM companies WHERE group_id=? ORDER BY jurisdiction').all(groupId)

test('沒有對應公司時按商號和內承單位新建公司組和兩間公司', async () => {
  const r = await createCard({ cardNumber: 'PC-001', company: '甲貿易（香港）有限公司', contractor: '深圳甲贸易有限公司' })
  assert.equal(r.status, 201)
  const created = plate(r.body.id)
  assert.ok(created.group_id)
  const list = groupCompanies(created.group_id)
  assert.deepEqual(list.map(item => [item.jurisdiction, item.name]), [['內地', '深圳甲贸易有限公司'], ['香港', '甲貿易（香港）有限公司']])
  state.firstGroup = created.group_id
})
test('新建的公司組以兩間公司命名', () => {
  assert.equal(state.db.prepare('SELECT name FROM company_groups WHERE id=?').get(state.firstGroup).name, '甲貿易（香港）有限公司 · 深圳甲贸易有限公司')
})
test('按名稱新建的公司列入客戶更新待核對', async () => {
  const list = (await request('/customer-changes')).body.filter(item => item.entityType === 'company' && item.created)
  assert.deepEqual(list.map(item => item.afterText).sort(), ['內地公司 深圳甲贸易有限公司', '香港公司 甲貿易（香港）有限公司'])
})
test('按名稱新建的公司不能改回', async () => {
  const change = (await request('/customer-changes')).body.find(item => item.entityType === 'company' && item.created)
  assert.equal((await request(`/customer-changes/${change.id}/revert`, 'POST', {})).status, 400)
})
test('同一商號的第二張批文卡連到原有公司組，不重複建立公司', async () => {
  const before = companiesOf(state.first).length
  const r = await createCard({ cardNumber: 'PC-002', company: '甲貿易（香港）有限公司', contractor: '深圳甲贸易有限公司' })
  assert.equal(r.status, 201)
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
  assert.equal(companiesOf(state.first).length, before)
})
test('名稱繁簡、括號和空格不同仍連到原有公司', async () => {
  const before = companiesOf(state.first).length
  const r = await createCard({ cardNumber: 'PC-003', company: '甲贸易 (香港) 有限公司', contractor: '深圳甲貿易有限公司' })
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
  assert.equal(companiesOf(state.first).length, before)
})
test('原有香港公司配新的內承單位時，新內地公司放進同一公司組', async () => {
  const r = await createCard({ cardNumber: 'PC-004', company: '甲貿易（香港）有限公司', contractor: '广州甲新贸易有限公司' })
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
  assert.ok(groupCompanies(state.firstGroup).some(item => item.name === '广州甲新贸易有限公司' && item.jurisdiction === '內地'))
})
test('內承單位用繁體字時新建的內地公司名稱轉為簡體', async () => {
  const r = await createCard({ cardNumber: 'PC-005', company: '丙實業有限公司', contractor: '東莞丙實業有限公司' })
  assert.ok(groupCompanies(plate(r.body.id).group_id).some(item => item.name === '东莞丙实业有限公司'))
})
test('已屬其他公司組的內地公司不被搬動', async () => {
  const r = await createCard({ cardNumber: 'PC-006', company: '丁控股有限公司', contractor: '深圳甲贸易有限公司' })
  const mainland = companiesOf(state.first).filter(item => item.name === '深圳甲贸易有限公司')
  assert.equal(mainland.length, 1)
  assert.equal(mainland[0].group_id, state.firstGroup)
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
})
test('未分組的同名公司放進新建的公司組', async () => {
  const loose = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '戊有限公司', nameEn: 'Wu Limited' })).body.id
  const r = await createCard({ cardNumber: 'PC-007', company: '戊有限公司' })
  const groupId = plate(r.body.id).group_id
  assert.ok(groupId)
  assert.equal(state.db.prepare('SELECT group_id FROM companies WHERE id=?').get(loose).group_id, groupId)
  assert.equal(companiesOf(state.first).filter(item => item.name === '戊有限公司').length, 1)
})
test('客戶自選公司組時只連過去、不按名稱新建公司', async () => {
  const before = companiesOf(state.first).length
  const r = await createCard({ cardNumber: 'PC-008', company: '辨識錯的名稱有限公司' }, { groupId: state.firstGroup })
  assert.equal(r.status, 201)
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
  assert.equal(companiesOf(state.first).length, before)
})
test('客戶不能把批文卡連到別的客戶的公司組', async () => {
  assert.equal((await createCard({ cardNumber: 'PC-009' }, { groupId: state.otherGroup })).status, 400)
  assert.equal(state.db.prepare("SELECT COUNT(*) n FROM plate_assets WHERE card_number='PC-009'").get().n, 0)
})
test('公司組不存在時拒絕建檔', async () => { assert.equal((await createCard({ cardNumber: 'PC-010' }, { groupId: randomUUID() })).status, 400) })
test('公司組格式錯誤時拒絕建檔', async () => { assert.equal((await createCard({ cardNumber: 'PC-011' }, { groupId: 123 })).status, 400) })
test('公司組為 null 時拒絕建檔', async () => { assert.equal((await createCard({ cardNumber: 'PC-012' }, { groupId: null })).status, 400) })
test('公司組留空時照常自動連公司', async () => {
  const r = await createCard({ cardNumber: 'PC-013', company: '甲貿易（香港）有限公司' }, { groupId: '' })
  assert.equal(plate(r.body.id).group_id, state.firstGroup)
})
test('批文卡沒有商號和內承單位時不連公司', async () => {
  const r = await createCard({ cardNumber: 'PC-014' })
  assert.equal(r.status, 201)
  assert.equal(plate(r.body.id).group_id, null)
})
test('粵澳牌照的商號建為澳門公司', async () => {
  const r = await request('/plate-assets', 'POST', { customerId: state.first, route: '粵澳', cardData: { cardNumber: 'PC-015', company: '己澳門有限公司' } }, 'client')
  assert.deepEqual(groupCompanies(plate(r.body.id).group_id).map(item => item.jurisdiction), ['澳門'])
})
test('建檔失敗時不留下新建的公司', async () => {
  const before = companiesOf(state.first).length
  assert.equal((await createCard({ cardNumber: 'PC-001', company: '重複卡新公司有限公司' })).status, 409)
  assert.equal(companiesOf(state.first).length, before)
})

test('管理員建檔不自動連公司', async () => {
  const before = companiesOf(state.first).length
  const r = await createCard({ cardNumber: 'PC-016', company: '管理員建檔新公司有限公司' }, {}, 'admin')
  assert.equal(r.status, 201)
  assert.equal(plate(r.body.id).group_id, null)
  assert.equal(companiesOf(state.first).length, before)
})

// —— 建檔頁預覽 ——
test('預覽：已有公司時回傳會連到的公司組', async () => {
  const r = await request(`/my/plate-companies?route=粵港&company=${encodeURIComponent('甲貿易（香港）有限公司')}`, 'GET', undefined, 'client')
  assert.equal(r.status, 200); assert.equal(r.body.groupId, state.firstGroup); assert.equal(r.body.companies[0].existing, true)
})
test('預覽：新公司標明會新建', async () => {
  const r = await request(`/my/plate-companies?route=粵港&company=${encodeURIComponent('全新有限公司')}`, 'GET', undefined, 'client')
  assert.equal(r.body.groupId, null); assert.deepEqual(r.body.companies, [{ name: '全新有限公司', jurisdiction: '香港', existing: false }])
})
test('預覽：可改選的公司組只列自己的', async () => {
  const r = await request('/my/plate-companies?route=粵港', 'GET', undefined, 'client')
  assert.ok(r.body.groups.some(item => item.id === state.firstGroup))
  assert.ok(!r.body.groups.some(item => item.id === state.otherGroup))
})
test('預覽：不會找到別的客戶的同名公司', async () => {
  await request('/companies', 'POST', { customerId: state.second, jurisdiction: '香港', name: '乙專有有限公司', nameEn: 'Yi Only Limited', groupId: state.otherGroup })
  const r = await request(`/my/plate-companies?route=粵港&company=${encodeURIComponent('乙專有有限公司')}`, 'GET', undefined, 'client')
  assert.equal(r.body.groupId, null); assert.equal(r.body.companies[0].existing, false)
})
test('預覽：路線無效回 400', async () => { assert.equal((await request('/my/plate-companies?route=x', 'GET', undefined, 'client')).status, 400) })
test('預覽：員工不能使用', async () => { assert.equal((await request('/my/plate-companies', 'GET', undefined, 'staff')).status, 403) })
test('預覽：不支援 POST', async () => { assert.equal((await request('/my/plate-companies', 'POST', {}, 'client')).status, 405) })

// —— 牌照頁補資料提示 ——
test('牌照詳情列出公司缺的資料', async () => {
  const r = await request(`/my/plates/${(await createCard({ cardNumber: 'PC-020', company: '庚有限公司', contractor: '深圳庚有限公司' })).body.id}`, 'GET', undefined, 'client')
  const gaps = Object.fromEntries(r.body.companyGaps.map(item => [item.name, item.missing]))
  assert.deepEqual(gaps['庚有限公司'], ['英文名稱', '商業登記號碼', '成立日期'])
  assert.deepEqual(gaps['深圳庚有限公司'], ['統一社會信用代碼', '成立日期'])
  state.gapPlate = r.body.id
})
test('客戶補齊公司資料後不再列出', async () => {
  const hk = companiesOf(state.first).find(item => item.name === '庚有限公司')
  assert.equal((await request(`/my/companies/${hk.id}`, 'PATCH', { nameEn: 'Geng Limited', registrationNo: '12345678', incorporatedOn: '2020-01-01' }, 'client')).status, 200)
  const r = await request(`/my/plates/${state.gapPlate}`, 'GET', undefined, 'client')
  assert.ok(!r.body.companyGaps.some(item => item.id === hk.id))
})
test('已註銷公司不列入補資料提示', async () => {
  const cn = companiesOf(state.first).find(item => item.name === '深圳庚有限公司')
  state.db.prepare("UPDATE companies SET status='已註銷' WHERE id=?").run(cn.id)
  const r = await request(`/my/plates/${state.gapPlate}`, 'GET', undefined, 'client')
  assert.ok(!r.body.companyGaps.some(item => item.id === cn.id))
})
test('沒有連公司的牌照補資料提示為空', async () => {
  const id = state.db.prepare("SELECT id FROM plate_assets WHERE card_number='PC-014'").get().id
  assert.deepEqual((await request(`/my/plates/${id}`, 'GET', undefined, 'client')).body.companyGaps, [])
})

// —— 新建公司的委託：先客戶自理，員工確認後才產生工作 ——
const scopeItems = async companyId => (await request(`/service-scopes?ownerType=company&ownerId=${companyId}`)).body.items
const periodsOf = companyId => state.db.prepare('SELECT period, due_on FROM filing_periods WHERE company_id=? ORDER BY period').all(companyId)
const runFilings = async () => (await import('../src/bookkeeping.js')).ensureFilings('default')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
test('按名稱新建的公司委託項目全部先設為客戶自理', async () => {
  const r = await createCard({ cardNumber: 'PC-030', company: '辛控股有限公司', contractor: '深圳辛贸易有限公司' })
  const cn = groupCompanies(plate(r.body.id).group_id).find(item => item.jurisdiction === '內地')
  const hk = groupCompanies(plate(r.body.id).group_id).find(item => item.jurisdiction === '香港')
  state.newMainland = cn.id
  for (const company of [cn, hk]) {
    const items = await scopeItems(company.id)
    assert.ok(items.length)
    assert.ok(items.every(item => item.handler === 'client' && !item.defaulted), company.name)
  }
})
test('按名稱新建的內地公司不產生報帳期數', async () => {
  await runFilings()
  assert.deepEqual(periodsOf(state.newMainland), [])
})
test('員工改為我們做後只生成接手日之後截止的報帳期數', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.newMainland, item: 'monthly_filing', handler: 'us' })).status, 200)
  await runFilings()
  const periods = periodsOf(state.newMainland)
  assert.ok(periods.length >= 1)
  assert.ok(periods.every(item => item.due_on >= today), JSON.stringify(periods))
})
test('連到已有公司時不改原有委託', async () => {
  const before = state.db.prepare('SELECT COUNT(*) n FROM service_scopes').get().n
  await createCard({ cardNumber: 'PC-031', company: '辛控股有限公司', contractor: '深圳辛贸易有限公司' })
  assert.equal(state.db.prepare('SELECT COUNT(*) n FROM service_scopes').get().n, before)
})
test('員工新增、從未設為客戶自理的內地公司照舊生成最近 3 期', async () => {
  const id = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '內地', name: '深圳员工新增有限公司' })).body.id
  await runFilings()
  assert.equal(periodsOf(id).length, 3)
})
