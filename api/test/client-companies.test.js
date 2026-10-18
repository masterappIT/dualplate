import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 公司（docs/tasks/self-managed-fixes-plan.md 第 4 步）：客戶在「我的公司」新增公司；客戶改批文卡商號、內承單位時自動建立並連上公司
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'client-companies-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  for (const [token, role] of [['admin', 'admin'], ['staff', 'staff']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('CompanyPass123'), 'default', token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.74.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
function client(mode = '自管') {
  const { db, hashPassword } = state, n = ++seq, ids = { customer: randomUUID(), user: randomUUID(), token: `client-${n}` }
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(ids.customer, `客戶${n}`, '個人', 'default', mode)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `companies${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const add = (ids, body) => request('/my/companies', 'POST', body, ids.token)
const companies = customerId => state.db.prepare('SELECT * FROM companies WHERE customer_id=? ORDER BY jurisdiction, name').all(customerId)
const pending = customerId => state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=? AND status='待核對'").get(customerId).count
const groupOf = plateId => state.db.prepare('SELECT group_id FROM plate_assets WHERE id=?').get(plateId).group_id

// ── 新增公司 ──
test('自管客戶新增公司（不屬於任何牌照）：建立公司，不列入待核對', async () => {
  const ids = client(), result = await add(ids, { jurisdiction: '香港', name: '新加有限公司' })
  assert.equal(result.status, 201)
  assert.equal(result.body.groupId, null)
  assert.deepEqual(companies(ids.customer).map(item => `${item.jurisdiction}:${item.name}`), ['香港:新加有限公司'])
  assert.equal(pending(ids.customer), 0)
  const list = (await request('/my/companies', 'GET', undefined, ids.token)).body
  assert.equal(list.ungrouped[0].name, '新加有限公司')
})
test('不屬於任何牌照的香港公司：我的公司列出還沒有填日期的商業登記證和周年申報表', async () => {
  const ids = client()
  await add(ids, { jurisdiction: '香港', name: '未分組有限公司' })
  const company = (await request('/my/companies', 'GET', undefined, ids.token)).body.ungrouped[0]
  assert.deepEqual(company.undated.map(item => `${item.code}:${item.fill}`).sort(), ['hk_br:date', 'hk_nar1:other', 'hk_registered_office:date'])
  assert.deepEqual(company.deadlines, [])
})
test('不屬於任何牌照的內地公司：按年的公司事項列在公司事項', async () => {
  const ids = client()
  await add(ids, { jurisdiction: '內地', name: '未分组贸易有限公司' })
  const company = (await request('/my/companies', 'GET', undefined, ids.token)).body.ungrouped[0]
  assert.ok(company.deadlines.some(item => item.code === 'cn_annual_report'))
  assert.ok(company.undated.some(item => item.code === 'cn_registered_address'))
})
test('不屬於任何牌照的公司填了到期日：從還沒有填日期移到公司事項', async () => {
  const ids = client()
  const companyId = (await add(ids, { jurisdiction: '香港', name: '補日期有限公司' })).body.id
  const saved = await request('/my/dates', 'PUT', { ownerType: 'company', ownerId: companyId, code: 'hk_br', expiresOn: '2027-03-31' }, ids.token)
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  const company = (await request('/my/companies', 'GET', undefined, ids.token)).body.ungrouped[0]
  assert.ok(company.deadlines.some(item => item.code === 'hk_br' && item.dueOn === '2027-03-31'))
  assert.ok(!company.undated.some(item => item.code === 'hk_br'))
})
test('不屬於任何牌照的公司：別的客戶看不到', async () => {
  const owner = client(), other = client()
  await add(owner, { jurisdiction: '香港', name: '別人有限公司' })
  assert.deepEqual((await request('/my/companies', 'GET', undefined, other.token)).body.ungrouped, [])
})
test('托管客戶新增的公司先設為客戶自理（等員工設定委託範圍）', async () => {
  const ids = client('托管'), result = await add(ids, { jurisdiction: '香港', name: '自理有限公司' })
  const handlers = state.db.prepare("SELECT DISTINCT handler FROM service_scopes WHERE owner_type='company' AND owner_id=? AND ended_on IS NULL").all(result.body.id).map(row => row.handler)
  assert.ok(handlers.length > 0)
  assert.deepEqual(handlers, ['client'])
})
test('托管客戶新增公司：列入客戶更新待核對', async () => {
  const ids = client('托管')
  assert.equal((await add(ids, { jurisdiction: '香港', name: '托管新加有限公司' })).status, 201)
  assert.equal(pending(ids.customer), 1)
})
test('新增公司並選牌照：牌照沒有公司組時建立公司組並連上', async () => {
  const ids = client(), p = await plate(ids), result = await add(ids, { jurisdiction: '香港', name: '持牌有限公司', plateId: p })
  assert.equal(result.status, 201)
  assert.equal(groupOf(p), result.body.groupId)
  const group = (await request('/my/companies', 'GET', undefined, ids.token)).body.groups.find(item => item.id === result.body.groupId)
  assert.deepEqual([group.offshore[0].name, group.plates[0].id], ['持牌有限公司', p])
})
test('新增內地公司並選已有公司組的牌照：放進同一公司組', async () => {
  const ids = client(), p = await plate(ids, { company: '甲有限公司' })
  const result = await add(ids, { jurisdiction: '內地', name: '深圳市甲贸易有限公司', plateId: p })
  assert.equal(result.status, 201)
  assert.equal(result.body.groupId, groupOf(p))
})
test('牌照已有同一地區的公司：不能再新增，請改名', async () => {
  const ids = client(), p = await plate(ids, { company: '甲有限公司' })
  const result = await add(ids, { jurisdiction: '香港', name: '乙有限公司', plateId: p })
  assert.equal(result.status, 409)
  assert.equal(companies(ids.customer).length, 1)
})
test('粵港牌照不能選澳門公司做持牌公司', async () => {
  const ids = client(), p = await plate(ids)
  assert.equal((await add(ids, { jurisdiction: '澳門', name: '澳門有限公司', plateId: p })).status, 400)
})
test('內地公司名稱用繁體字：拒絕並建議簡體；簡體可以', async () => {
  const ids = client(), wrong = await add(ids, { jurisdiction: '內地', name: '深圳市貿易有限公司' })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.suggestion, '深圳市贸易有限公司')
  assert.equal((await add(ids, { jurisdiction: '內地', name: '深圳市贸易有限公司' })).status, 201)
})
test('名下已有同名公司（繁簡、空格不同也算同名）：409，不重複建立', async () => {
  const ids = client()
  assert.equal((await add(ids, { jurisdiction: '香港', name: '重複 有限公司' })).status, 201)
  assert.equal((await add(ids, { jurisdiction: '香港', name: '重复有限公司' })).status, 409)
  assert.equal(companies(ids.customer).length, 1)
})
test('內容格式錯誤：一律 400，不建立公司', async () => {
  const ids = client()
  for (const body of [{}, { jurisdiction: '香港' }, { jurisdiction: '香港', name: '   ' }, { jurisdiction: '香港', name: null }, { jurisdiction: '香港', name: 123 }, { jurisdiction: '台灣', name: '台灣公司' }, { jurisdiction: '香港', name: '甲', extra: 1 }, { jurisdiction: '香港', name: '甲', plateId: 5 }]) {
    assert.equal((await add(ids, body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await request('/my/companies', 'POST', null, ids.token)).status, 400)
  assert.equal((await request('/my/companies', 'POST', [], ids.token)).status, 400)
  assert.equal(companies(ids.customer).length, 0)
})
test('不存在的牌照、別的客戶的牌照：404', async () => {
  const mine = client(), theirs = client(), p = await plate(theirs)
  assert.equal((await add(mine, { jurisdiction: '香港', name: '甲有限公司', plateId: 'no-such-plate' })).status, 404)
  assert.equal((await add(mine, { jurisdiction: '香港', name: '甲有限公司', plateId: p })).status, 404)
  assert.equal(groupOf(p), null)
})
test('員工和管理者不能用客戶的新增公司接口', async () => {
  assert.equal((await request('/my/companies', 'POST', { jurisdiction: '香港', name: '員工有限公司' }, 'admin')).status, 403)
  assert.equal((await request('/my/companies', 'POST', { jurisdiction: '香港', name: '員工有限公司' }, 'staff')).status, 403)
})

// ── 改批文卡時自動建公司 ──
test('牌照沒有公司（建檔時沒填商號）：改批文卡補上商號和內承單位，自動建立並連上公司', async () => {
  const ids = client(), cardData = { cardNumber: `10${++seq}` }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id
  const result = await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, company: '補上有限公司', contractor: '深圳市补上贸易有限公司' } }, ids.token)
  assert.equal(result.status, 200)
  assert.ok(groupOf(p))
  assert.deepEqual(companies(ids.customer).map(item => `${item.jurisdiction}:${item.name}:${item.group_id === groupOf(p)}`), ['內地:深圳市补上贸易有限公司:true', '香港:補上有限公司:true'])
})
test('已有公司組只有香港公司：改批文卡補上內承單位，內地公司建在同一公司組', async () => {
  const ids = client(), cardData = { cardNumber: `10${++seq}`, company: '甲有限公司' }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id, group = groupOf(p)
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, contractor: '深圳市甲贸易有限公司' } }, ids.token)).status, 200)
  assert.equal(groupOf(p), group)
  assert.equal(state.db.prepare("SELECT group_id FROM companies WHERE customer_id=? AND jurisdiction='內地'").get(ids.customer).group_id, group)
})
test('已有香港公司時改商號：不另建公司、不搬動牌照（改名經商號變更或修改公司資料）', async () => {
  const ids = client(), cardData = { cardNumber: `10${++seq}`, company: '舊名有限公司' }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id, group = groupOf(p)
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, company: '新名有限公司' } }, ids.token)).status, 200)
  assert.equal(groupOf(p), group)
  assert.deepEqual(companies(ids.customer).map(item => item.name), ['舊名有限公司'])
})
test('改批文卡但沒有改商號和內承單位：公司不變', async () => {
  const ids = client(), cardData = { cardNumber: `10${++seq}` }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, serial: '00123456' } }, ids.token)).status, 200)
  assert.equal(companies(ids.customer).length, 0)
  assert.equal(groupOf(p), null)
})
test('名下已有未分組的同名公司：改批文卡時放進公司組，不重複建立', async () => {
  const ids = client()
  await add(ids, { jurisdiction: '香港', name: '已有有限公司' })
  const cardData = { cardNumber: `10${++seq}` }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, company: '已有有限公司' } }, ids.token)).status, 200)
  assert.equal(companies(ids.customer).length, 1)
  assert.equal(companies(ids.customer)[0].group_id, groupOf(p))
})
test('托管客戶改批文卡建立的公司：列入客戶更新待核對', async () => {
  const ids = client('托管'), cardData = { cardNumber: `10${++seq}` }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, ids.token)).body.id
  const before = state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=? AND entity_type='company'").get(ids.customer).count
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, company: '托管補上有限公司' } }, ids.token)).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=? AND entity_type='company'").get(ids.customer).count, before + 1)
})
test('管理者改批文卡：照舊不自動建公司', async () => {
  const ids = client('托管'), cardData = { cardNumber: `10${++seq}` }
  const p = (await request('/plate-assets', 'POST', { customerId: ids.customer, route: '粵港', cardData }, 'admin')).body.id
  assert.equal((await request(`/plate-assets/${p}`, 'PUT', { cardData: { ...cardData, company: '後台有限公司' } })).status, 200)
  assert.equal(companies(ids.customer).length, 0)
})
