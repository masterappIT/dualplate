import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 還沒有填日期的事項（docs/tasks/self-managed-fixes-plan.md 第 2 步）：按事項分，「你自行辦理」又沒有日期的事項列給客戶自己填；
// 我們負責的不列。自管客戶全部自理；托管客戶只有設定為客戶自理的事項才列
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'undated-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.72.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}

// 一位客戶：粵港牌照（沒有批文有效期）、裝在牌照上的香港車輛、同組香港公司（沒有成立日期）、主司機
function seed(mode = '自管') {
  const { db, hashPassword } = state, t = stamp(), n = ++seq
  const ids = { customer: randomUUID(), user: randomUUID(), token: `client-${n}`, plate: randomUUID(), vehicle: randomUUID(), group: randomUUID(), company: randomUUID(), driver: randomUUID() }
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(ids.customer, `客戶${n}`, '個人', 'default', mode)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(ids.user, 'customer', `客戶${n}`, `undated${n}@test.invalid`, hashPassword('ClientPass123'), ids.customer, 'default')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', t)
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(ids.vehicle, ids.customer, '粵港', '香港', '私家車', `UD${n}`)
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(ids.group, 'default', ids.customer, '組一', t)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.company, 'default', ids.customer, ids.group, '香港', `未填日期有限公司${n}`, t, t)
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,group_id,card_number,mainland_plate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(ids.plate, ids.customer, '粵港', ids.vehicle, ids.group, `10${n}0000`, `粵Z${n}港`, t, t)
  db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(ids.driver, 'default', ids.customer, '司機甲', t, t)
  db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role) VALUES (?,?,?)').run(ids.plate, ids.driver, '主')
  return ids
}
const plate = ids => request(`/my/plates/${ids.plate}`, 'GET', undefined, ids.token)
const codes = list => list.map(item => item.code)
const find = (list, code, ownerId) => list.find(item => item.code === code && (!ownerId || item.ownerId === ownerId))

test('自管客戶：牌照頁列出還沒有填日期的事項（牌照、車輛、司機、公司）', async () => {
  const ids = seed(), result = await plate(ids)
  assert.equal(result.status, 200)
  const list = result.body.undated
  for (const code of ['hk_crp', 'customs_filing', 'hk_licence', 'local_insurance', 'home_return_permit', 'hk_br']) assert.ok(codes(list).includes(code), code)
  assert.equal(find(list, 'hk_crp').fill, 'date')
  assert.equal(find(list, 'hk_crp').ownerId, ids.plate)
  assert.equal(find(list, 'home_return_permit').ownerId, ids.driver)
})
test('由別的資料推算的事項寫明在哪裏補，不給直接填日期', async () => {
  const ids = seed(), list = (await plate(ids)).body.undated
  assert.deepEqual([find(list, 'approval').fill, find(list, 'approval').hint], ['other', '在「批文卡」補上有效期'])
  assert.deepEqual([find(list, 'hk_nar1').fill, find(list, 'hk_nar1').hint], ['other', '在「我的公司」補上公司成立日期'])
  assert.equal(find(list, 'inspection').hint, '在「車輛與證件」補上首次登記日期')
})
test('填了日期之後：從「還沒有填日期」移走，出現在到期項目', async () => {
  const ids = seed()
  const saved = await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: ids.plate, code: 'hk_crp', expiresOn: '2027-03-01' }, ids.token)
  assert.equal(saved.status, 200)
  const body = (await plate(ids)).body
  assert.equal(find(body.undated, 'hk_crp'), undefined)
  assert.equal(find(body.deadlines, 'hk_crp').dueOn, '2027-03-01')
})
test('自管客戶填日期直接生效，不列入待核對', async () => {
  const ids = seed()
  await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: ids.plate, code: 'customs_filing', expiresOn: '2027-04-01' }, ids.token)
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=? AND status='待核對'").get(ids.customer).count, 0)
})
test('托管客戶：我們負責的事項沒有日期也不列出', async () => {
  const ids = seed('托管'), list = (await plate(ids)).body.undated
  assert.equal(find(list, 'hk_crp'), undefined)
  assert.equal(find(list, 'customs_filing'), undefined)
})
test('托管客戶：設定為客戶自理的事項沒有日期就列出（按事項分）', async () => {
  const ids = seed('托管')
  state.db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,started_on,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', 'plate', ids.plate, 'hk_crp', 'client', '2026-01-01', stamp())
  const list = (await plate(ids)).body.undated
  assert.equal(find(list, 'hk_crp').fill, 'date')
  assert.equal(find(list, 'customs_filing'), undefined)
})
test('托管客戶填自理事項的日期，列入待核對', async () => {
  const ids = seed('托管')
  state.db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,started_on,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', 'plate', ids.plate, 'hk_crp', 'client', '2026-01-01', stamp())
  assert.equal((await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: ids.plate, code: 'hk_crp', expiresOn: '2027-03-01' }, ids.token)).status, 200)
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM customer_changes WHERE customer_id=? AND status='待核對'").get(ids.customer).count, 1)
})
test('公司頁：每個公司組列出公司還沒有填日期的事項', async () => {
  const ids = seed(), result = await request('/my/companies', 'GET', undefined, ids.token)
  assert.equal(result.status, 200)
  const group = result.body.groups.find(item => item.id === ids.group)
  assert.equal(find(group.undated, 'hk_br', ids.company).fill, 'date')
  assert.ok(group.undated.every(item => item.ownerType === 'company'))
})
test('已填日期的事項不會列在「還沒有填日期」', async () => {
  const ids = seed()
  state.db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)').run('default', 'vehicle', ids.vehicle, 'hk_licence', '2027-05-01', stamp())
  assert.equal(find((await plate(ids)).body.undated, 'hk_licence'), undefined)
})
test('看不到別的客戶的牌照，也不能替別人填日期', async () => {
  const mine = seed(), theirs = seed()
  assert.equal((await request(`/my/plates/${theirs.plate}`, 'GET', undefined, mine.token)).status, 404)
  assert.equal((await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: theirs.plate, code: 'hk_crp', expiresOn: '2027-03-01' }, mine.token)).status, 404)
})
test('填日期：空白、錯誤格式、null 一律拒絕', async () => {
  const ids = seed()
  for (const expiresOn of ['', '2027-13-01', null, 20270301]) {
    assert.equal((await request('/my/dates', 'PUT', { ownerType: 'plate', ownerId: ids.plate, code: 'hk_crp', expiresOn }, ids.token)).status, 400, String(expiresOn))
  }
  assert.ok(find((await plate(ids)).body.undated, 'hk_crp'))
})
test('首頁統計不把還沒有填日期的事項算成逾期', async () => {
  const ids = seed(), overview = (await request('/my/overview', 'GET', undefined, ids.token)).body
  assert.equal(overview.counts.overdue, 0)
  assert.equal(overview.deadlines.filter(item => item.level === 'missing').length, 0)
})
