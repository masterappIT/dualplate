import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 建檔時問新批文備案（docs/tasks/self-managed-fixes-plan.md 第 10 步）：剛建好的牌照、這一期已逾期時，客戶說已辦好可免附回執；期限規則不變
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'filing-creation-'))
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
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `filing${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', stamp())
  return ids
}
async function plate(ids, cardData = {}, route = '粵港') {
  const result = await request('/plate-assets', 'POST', { customerId: ids.customer, route, cardData: { cardNumber: `10${++seq}`, ...cardData } }, ids.token)
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.id
}
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
// 新批文開始日起 183 天要備案：開始日在 193 天前＝逾期 10 天
const overdueCard = () => ({ validFrom: daysAgo(193), validTo: daysAgo(-500) })
const filingItem = async (ids, plateId) => (await request(`/my/plates/${plateId}`, 'GET', undefined, ids.token)).body.deadlines.find(item => item.code === 'new_card_filing')
const confirm = (ids, plateId, body) => request(`/my/plates/${plateId}/self-handled`, 'POST', { kind: 'filing_done', confirmedAtCreation: true, ...body }, ids.token)
const records = plateId => state.db.prepare('SELECT * FROM self_handled WHERE plate_asset_id=?').all(plateId)
const completed = plateId => state.db.prepare("SELECT 1 FROM rule_completions WHERE code='new_card_filing' AND owner_id=?").get(plateId) !== undefined

test('剛建檔、新批文備案已逾期：建檔後顯示逾期', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard())
  const item = await filingItem(ids, plateId)
  assert.equal(item.level, 'overdue')
})
test('自管客戶建檔時說已辦好：免附相片，直接記為已辦，不進待核對', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  const result = await confirm(ids, plateId, { period: item.period })
  assert.equal(result.status, 201, JSON.stringify(result.body))
  assert.equal(records(plateId)[0].status, '已核對')
  assert.equal(JSON.parse(records(plateId)[0].details_json).source, '建檔時客戶確認')
  assert.ok(completed(plateId))
  assert.equal(await filingItem(ids, plateId), undefined)
})
test('托管客戶建檔時說已辦好：記為已辦，列入待核對由員工核實', async () => {
  const ids = client('托管'), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  assert.equal((await confirm(ids, plateId, { period: item.period })).status, 201)
  assert.equal(records(plateId)[0].status, '待核對')
  assert.ok(completed(plateId))
  const queue = (await request('/self-handled', 'GET')).body
  assert.ok(queue.some(row => row.plateId === plateId && row.details.source === '建檔時客戶確認'))
})
test('員工退回：撤銷已辦，恢復逾期提醒', async () => {
  const ids = client('托管'), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  await confirm(ids, plateId, { period: item.period })
  const back = await request(`/self-handled/${records(plateId)[0].id}/return`, 'POST', { note: '請補回執' })
  assert.equal(back.status, 200)
  assert.ok(!completed(plateId))
  assert.equal((await filingItem(ids, plateId)).level, 'overdue')
})
test('期限未過：不能用建檔確認', async () => {
  const ids = client(), plateId = await plate(ids, { validFrom: daysAgo(100), validTo: daysAgo(-500) }), item = await filingItem(ids, plateId)
  assert.equal((await confirm(ids, plateId, { period: item.period })).status, 400)
  assert.ok(!completed(plateId))
})
test('逾期太久、本來就不提醒的：不能用建檔確認', async () => {
  const ids = client(), plateId = await plate(ids, { validFrom: daysAgo(400), validTo: daysAgo(-500) })
  assert.equal(await filingItem(ids, plateId), undefined)
  assert.equal((await confirm(ids, plateId, { period: daysAgo(400) })).status, 400)
})
test('不是剛建檔的牌照：照舊要附相片', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  state.db.prepare('UPDATE plate_assets SET created_at=? WHERE id=?').run(new Date(Date.now() - 3600000).toISOString(), plateId)
  assert.equal((await confirm(ids, plateId, { period: item.period })).status, 400)
})
test('沒有說是建檔確認、也沒有相片：照舊要附相片', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  const result = await request(`/my/plates/${plateId}/self-handled`, 'POST', { kind: 'filing_done', period: item.period }, ids.token)
  assert.equal(result.body.error, '請附上備案回執相片')
})
test('建檔確認格式錯誤：400', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  assert.equal((await confirm(ids, plateId, { period: item.period, confirmedAtCreation: 'yes' })).status, 400)
})
test('建檔確認只限新批文備案，不適用於驗車', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard())
  assert.equal((await confirm(ids, plateId, { kind: 'inspection_done', period: '2026' })).status, 400)
})
test('重複確認：409', async () => {
  const ids = client(), plateId = await plate(ids, overdueCard()), item = await filingItem(ids, plateId)
  await confirm(ids, plateId, { period: item.period })
  assert.equal((await confirm(ids, plateId, { period: item.period })).status, 409)
})
test('別人的牌照：404', async () => {
  const owner = client(), other = client(), plateId = await plate(owner, overdueCard()), item = await filingItem(owner, plateId)
  assert.equal((await confirm(other, plateId, { period: item.period })).status, 404)
})
