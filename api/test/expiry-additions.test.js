import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { computeDeadlines } from '../src/rules.js'

// ── 計算方式：since_last（上次過關後 N 天）與 after_field（批文有效期開始後 N 天，一次性） ──
const today = new Date('2026-05-01T00:00:00Z')
const plate = facts => ({ ownerType: 'plate', ownerId: 'p1', label: '測試牌照', customerId: 'c1', facts })
const crossing = { id: 'r1', code: 'crossing_90', name: '90 天過關', scope: 'plate', method: 'since_last', params: { field: 'lastCrossedOn', days: 90 }, match: {}, remindDays: 15, active: 1 }
const filing = { id: 'r2', code: 'new_card_filing', name: '新批文備案期限', scope: 'plate', method: 'after_field', params: { field: 'cardValidFrom', days: 183 }, match: {}, remindDays: 30, active: 1 }
const run = (rule, facts, completions = new Set()) => computeDeadlines({ rules: [rule], owners: [plate(facts)], tracked: new Map(), completions, today, windowDays: 365 })

test('90 天過關：沒有過關記錄顯示待錄入', () => {
  const [item] = run(crossing, {})
  assert.equal(item.level, 'missing')
  assert.equal(item.detail, '待錄入最近過關日期')
})
test('90 天過關：上次過關後 90 天到期且正常', () => {
  const [item] = run(crossing, { lastCrossedOn: '2026-04-01' })
  assert.equal(item.dueOn, '2026-06-30')
  assert.equal(item.level, 'upcoming')
})
test('90 天過關：剩 15 天內為快到期', () => assert.equal(run(crossing, { lastCrossedOn: '2026-02-10' })[0].level, 'due'))
test('90 天過關：超過 90 天為逾期', () => assert.equal(run(crossing, { lastCrossedOn: '2026-01-01' })[0].level, 'overdue'))
test('90 天過關：天數參數可改', () => assert.equal(run({ ...crossing, params: { field: 'lastCrossedOn', days: 60 } }, { lastCrossedOn: '2026-04-01' })[0].dueOn, '2026-05-31'))
test('新批文備案：沒有有效期開始日不產生', () => assert.equal(run(filing, {}).length, 0))
test('新批文備案：有效期開始後 183 天到期', () => assert.equal(run(filing, { cardValidFrom: '2026-03-01' })[0].dueOn, '2026-08-31'))
test('新批文備案：已標記完成不再出現', () => assert.equal(run(filing, { cardValidFrom: '2026-03-01' }, new Set(['new_card_filing:p1:2026-03-01'])).length, 0))
test('新批文備案：多年前的舊批文不當作逾期', () => assert.equal(run(filing, { cardValidFrom: '2020-01-01' }).length, 0))

// ── API ──
const fixture = {}
before(async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'expiry-additions-'))
  process.env.DB_PATH = join(fixture.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const { server } = await import('../src/server.js')
  fixture.server = server
  fixture.db = new DatabaseSync(process.env.DB_PATH)
  fixture.customer = randomUUID(); fixture.otherCustomer = randomUUID(); fixture.foreignCustomer = randomUUID()
  fixture.plate = randomUUID(); fixture.siblingPlate = randomUUID(); fixture.foreignPlate = randomUUID()
  fixture.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [id, tenant] of [[fixture.customer, 'default'], [fixture.otherCustomer, 'default'], [fixture.foreignCustomer, 'other']]) fixture.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(id, `客戶${id}`, '個人', tenant)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['foreign-admin', 'admin', null, 'other'], ['client', 'customer', fixture.customer, 'default']]) {
    const userId = randomUUID()
    fixture.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, role, `${token}@test.invalid`, 'unused', customerId, tenant)
    fixture.db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  const now = new Date().toISOString()
  for (const [id, customerId] of [[fixture.plate, fixture.customer], [fixture.siblingPlate, fixture.otherCustomer], [fixture.foreignPlate, fixture.foreignCustomer]]) fixture.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?)').run(id, customerId, '粵港', id, now, now, '{}')
})
after(() => { fixture.db?.close(); fixture.server?.close(); if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => fixture.server.emit('request', incoming, { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }))
}
const isoDaysAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

const newCodes = ['customs_filing', 'new_card_filing', 'crossing_90', 'hk_registered_office', 'cn_registered_address']
test('新增的預設規則已為現有租戶建立', () => {
  for (const code of newCodes) assert.ok(fixture.db.prepare('SELECT id FROM rules WHERE tenant_id=? AND code=?').get('default', code), code)
})
test('新租戶建立時同樣取得新增的預設規則', async () => {
  const { seedRules } = await import('../src/db.js')
  seedRules('other')
  for (const code of newCodes) assert.ok(fixture.db.prepare('SELECT id FROM rules WHERE tenant_id=? AND code=?').get('other', code), code)
})
test('管理端錄入過關後回傳下次到期日', async () => {
  const result = await request(`/plates/${fixture.plate}/crossings`, 'POST', { crossedOn: isoDaysAgo(10) })
  assert.equal(result.status, 201)
  assert.equal(result.body.lastCrossedOn, isoDaysAgo(10))
  assert.equal(result.body.nextDueOn, isoDaysAgo(-80))
})
test('同一天重複錄入不新增記錄', async () => {
  const result = await request(`/plates/${fixture.plate}/crossings`, 'POST', { crossedOn: isoDaysAgo(10) })
  assert.equal(result.status, 200)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM plate_crossings WHERE plate_asset_id=?').get(fixture.plate).count, 1)
})
test('過關日期無效時拒絕', async () => {
  for (const crossedOn of [null, '', [], 20260101, '2026-02-30', '2026/01/01', isoDaysAgo(-1), '1999-12-31']) assert.equal((await request(`/plates/${fixture.plate}/crossings`, 'POST', { crossedOn })).status, 400, String(crossedOn))
  for (const body of [null, []]) assert.equal((await request(`/plates/${fixture.plate}/crossings`, 'POST', body)).status, 400)
})
test('不存在或別的租戶的牌照回 404', async () => {
  assert.equal((await request(`/plates/${randomUUID()}/crossings`, 'POST', { crossedOn: isoDaysAgo(1) })).status, 404)
  assert.equal((await request(`/plates/${fixture.foreignPlate}/crossings`, 'POST', { crossedOn: isoDaysAgo(1) })).status, 404)
  assert.equal((await request(`/plates/${fixture.plate}/crossings`, 'GET', undefined, 'foreign-admin')).status, 404)
})
test('客戶不可使用管理端過關接口', async () => assert.equal((await request(`/plates/${fixture.plate}/crossings`, 'GET', undefined, 'client')).status, 403))
test('客戶為自己的牌照按「已過關」', async () => {
  const result = await request(`/my/plates/${fixture.plate}/crossings`, 'POST', { crossedOn: isoDaysAgo(0) }, 'client')
  assert.equal(result.status, 201)
  assert.deepEqual(Object.keys(result.body).sort(), ['lastCrossedOn', 'nextDueOn'])
  assert.equal(fixture.db.prepare("SELECT source FROM plate_crossings WHERE plate_asset_id=? AND crossed_on=?").get(fixture.plate, isoDaysAgo(0)).source, 'customer')
})
test('客戶不可為別人的牌照錄入過關', async () => {
  assert.equal((await request(`/my/plates/${fixture.siblingPlate}/crossings`, 'POST', { crossedOn: isoDaysAgo(0) }, 'client')).status, 404)
  assert.equal((await request(`/my/plates/${fixture.foreignPlate}/crossings`, 'POST', { crossedOn: isoDaysAgo(0) }, 'client')).status, 404)
})
test('客戶的其他寫入仍被拒絕', async () => assert.equal((await request(`/my/plates/${fixture.plate}`, 'POST', {}, 'client')).status, 405))
test('客戶牌照詳情帶最近過關與下次期限', async () => {
  const result = await request(`/my/plates/${fixture.plate}`, 'GET', undefined, 'client')
  assert.equal(result.body.crossing.lastCrossedOn, isoDaysAgo(0))
  assert.equal(result.body.crossing.days, 90)
})
test('過關記錄使到期總覽的 90 天過關按最近日期計', async () => {
  const item = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ruleCode === 'crossing_90' && entry.ownerId === fixture.plate)
  assert.equal(item.level, 'upcoming', '剛過關，還未到提醒期')
  assert.equal(item.dueOn, isoDaysAgo(-90))
  const missing = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ruleCode === 'crossing_90' && entry.ownerId === fixture.siblingPlate)
  assert.equal(missing.level, 'missing')
})
test('客戶錄入超過 7 天的記錄不可刪除，管理端記錄可刪除', async () => {
  const old = randomUUID()
  fixture.db.prepare('INSERT INTO plate_crossings(id,tenant_id,plate_asset_id,crossed_on,source,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(old, 'default', fixture.plate, isoDaysAgo(40), 'customer', null, new Date(Date.now() - 8 * 86400000).toISOString())
  assert.equal((await request(`/plates/${fixture.plate}/crossings/${old}`, 'DELETE')).status, 409)
  const own = fixture.db.prepare("SELECT id FROM plate_crossings WHERE plate_asset_id=? AND source='admin'").get(fixture.plate).id
  assert.equal((await request(`/plates/${fixture.plate}/crossings/${own}`, 'DELETE')).status, 200)
  assert.equal((await request(`/plates/${fixture.plate}/crossings/${randomUUID()}`, 'DELETE')).status, 404)
})
test('90 天過關不可用「標記完成」', async () => assert.equal((await request('/rule-completions', 'POST', { ruleCode: 'crossing_90', ownerId: fixture.plate, period: '2026' })).status, 400))
test('新批文備案可標記完成並以有效期開始日為期數', async () => {
  fixture.db.prepare('UPDATE plate_assets SET card_data=? WHERE id=?').run(JSON.stringify({ validFrom: isoDaysAgo(30) }), fixture.plate)
  assert.equal((await request('/rule-completions', 'POST', { ruleCode: 'new_card_filing', ownerId: fixture.plate, period: '2026' })).status, 400)
  assert.equal((await request('/rule-completions', 'POST', { ruleCode: 'new_card_filing', ownerId: fixture.plate, period: isoDaysAgo(30) })).status, 200)
  const item = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ruleCode === 'new_card_filing' && entry.ownerId === fixture.plate)
  assert.equal(item, undefined)
})
test('過關與批文日期計算方式只可用於兩地牌', async () => {
  assert.equal((await request('/rules', 'POST', { code: 'company_since', name: '公司測試', scope: 'company', method: 'since_last', params: { field: 'lastCrossedOn', days: 30 } })).status, 400)
  assert.equal((await request('/rules', 'POST', { code: 'plate_since', name: '牌照測試', scope: 'plate', method: 'since_last', params: { field: 'lastCrossedOn', days: 30 } })).status, 201)
  assert.equal((await request('/rules', 'POST', { code: 'plate_bad', name: '牌照測試', scope: 'plate', method: 'since_last', params: { field: 'other', days: 30 } })).status, 400)
})
