import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管／托管（docs/requirements.md 5.6.2，2026-10-18）：管理者人手切換；自管客戶的事項一律客戶自理、不產生年費
const state = {}
const day = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'service-mode-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword, ensureSelfCustomer } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  ensureSelfCustomer('default')
  state.self = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  for (const [key, tenant] of [['li', 'default'], ['chan', 'default'], ['wong', 'default'], ['empty', 'default'], ['foreign', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(state[key], `客戶${key}`, '個人', tenant)
  }
  const stamp = new Date().toISOString()
  for (const key of ['li', 'chan', 'wong']) {
    state[`${key}Plate`] = randomUUID()
    db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?)').run(state[`${key}Plate`], state[key], '粵港', `CARD-${key}`, stamp, stamp, '{}')
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.li, 'default'], ['other-admin', 'admin', null, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('ModePass12345'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
  state.fees = await import('../src/fees.js')
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.61.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const mode = (key, token) => request(`/customers/${state[key]}/service-mode`, 'GET', undefined, token)
const setMode = (key, body, token) => request(`/customers/${state[key]}/service-mode`, 'PUT', body, token)
const plateCells = async key => (await request(`/customers/${state[key]}/scope`)).body.sections.find(section => section.category === 'plate').owners.flatMap(owner => Object.values(owner.cells))
const historyCount = key => state.db.prepare('SELECT COUNT(*) count FROM customer_mode_changes WHERE customer_id=?').get(state[key]).count

// ── 預設與查看 ──
test('現有客戶預設為托管，未有切換記錄', async () => {
  const result = await mode('li')
  assert.equal(result.status, 200)
  assert.equal(result.body.mode, '托管'); assert.equal(result.body.since, null); assert.deepEqual(result.body.history, [])
})
test('客戶列表帶出自管或托管', async () => {
  const list = (await request('/customers')).body
  assert.equal(list.find(row => row.id === state.li).service_mode, '托管')
})
test('員工可以查看自管或托管', async () => { assert.equal((await mode('li', 'staff')).status, 200) })
test('客戶帳號不能查看或切換', async () => {
  assert.equal((await mode('li', 'client')).status, 403)
  assert.equal((await setMode('li', { mode: '自管' }, 'client')).status, 403)
})

// ── 切換 ──
test('管理者把客戶切換為自管，記下生效日和操作人', async () => {
  const result = await setMode('chan', { mode: '自管', effectiveOn: day(-3) })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.mode, '自管'); assert.equal(result.body.since, day(-3)); assert.equal(result.body.by, 'admin名')
  assert.equal(result.body.history.length, 1)
  assert.deepEqual([result.body.history[0].fromMode, result.body.history[0].toMode, result.body.history[0].changedByName], ['托管', '自管', 'admin名'])
})
test('沒有填生效日時以今天生效', async () => {
  const result = await setMode('wong', { mode: '自管' })
  assert.equal(result.body.since, day(0))
  await setMode('wong', { mode: '托管' })
})
test('自管客戶的事項一律客戶自理', async () => {
  const cells = await plateCells('chan')
  assert.ok(cells.length > 0)
  assert.ok(cells.every(cell => cell.handler === 'client'))
})
test('托管客戶的事項照舊由我們負責', async () => {
  assert.ok((await plateCells('li')).some(cell => cell.handler === 'us'))
})
test('自管客戶的事項不能設為我們做或外包', async () => {
  const item = (await request(`/customers/${state.chan}/scope`)).body.sections.find(section => section.category === 'plate').items[0].code
  for (const handler of ['us', 'outsourced']) {
    const result = await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.chanPlate, item, handler, providerName: '外包公司' })
    assert.equal(result.status, 400); assert.match(result.body.error, /自管客戶/)
  }
})
test('自管客戶不能套用委託範本', async () => {
  assert.equal((await request(`/customers/${state.chan}/apply-template`, 'POST', { template: 'full' })).status, 409)
  assert.equal((await request(`/customers/${state.chan}/apply-template`, 'POST', { template: 'full', dryRun: true })).status, 409)
})
test('自管客戶不產生年費', () => {
  state.db.prepare('INSERT INTO customer_billing(customer_id,tenant_id,annual_amount,currency,bill_month,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(state.chan, 'default', 120000, 'HKD', 1, 1, 'test', new Date().toISOString())
  state.fees.ensureAnnualFees('default')
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM fee_items WHERE customer_id=? AND kind='annual'").get(state.chan).count, 0)
})
test('切回托管後恢復由我們負責', async () => {
  await setMode('wong', { mode: '自管', effectiveOn: day(0) })
  assert.ok((await plateCells('wong')).every(cell => cell.handler === 'client'))
  const back = await setMode('wong', { mode: '托管', effectiveOn: day(0) })
  assert.equal(back.body.mode, '托管')
  assert.ok((await plateCells('wong')).some(cell => cell.handler === 'us'))
})
test('同一模式再提交不加記錄', async () => {
  const before = historyCount('chan')
  const result = await setMode('chan', { mode: '自管' })
  assert.equal(result.status, 200); assert.equal(historyCount('chan'), before)
})

// ── 生效日 ──
test('生效日不可遲於今天', async () => {
  const result = await setMode('li', { mode: '自管', effectiveOn: day(1) })
  assert.equal(result.status, 400); assert.equal((await mode('li')).body.mode, '托管')
})
test('生效日不可早於上次切換日', async () => {
  assert.equal((await setMode('chan', { mode: '托管', effectiveOn: day(-10) })).status, 400)
})
test('沒有切換時不用填生效日', async () => {
  assert.equal((await setMode('li', { effectiveOn: day(0) })).status, 400)
})

// ── 合約結束日 ──
test('只改合約結束日不改上次切換日', async () => {
  const result = await setMode('li', { contractEndsOn: day(200) })
  assert.equal(result.status, 200)
  assert.equal(result.body.contractEndsOn, day(200)); assert.equal(result.body.since, null); assert.equal(result.body.mode, '托管')
})
test('合約結束日可以清空', async () => {
  assert.equal((await setMode('li', { contractEndsOn: null })).body.contractEndsOn, null)
  await setMode('li', { contractEndsOn: day(200) })
  assert.equal((await setMode('li', { contractEndsOn: '' })).body.contractEndsOn, null)
})
test('自管客戶不可填合約結束日', async () => {
  assert.equal((await setMode('chan', { contractEndsOn: day(100) })).status, 400)
})
test('切換為自管時清除合約結束日', async () => {
  await setMode('wong', { contractEndsOn: day(100) })
  const result = await setMode('wong', { mode: '自管' })
  assert.equal(result.body.contractEndsOn, null)
  await setMode('wong', { mode: '托管' })
})
test('合約結束日不可早於生效日', async () => {
  assert.equal((await setMode('wong', { contractEndsOn: day(-30) })).status, 400)
})
test('合約 30 天內結束出現在今日工作，超過 30 天不出現', async () => {
  await setMode('li', { contractEndsOn: day(20) })
  await setMode('wong', { contractEndsOn: day(45) })
  const list = (await request('/service-mode/contract-endings')).body
  const li = list.find(row => row.customerId === state.li)
  assert.ok(li); assert.equal(li.daysLeft, 20); assert.equal(li.contractEndsOn, day(20))
  assert.ok(!list.some(row => row.customerId === state.wong))
})
test('合約到期提醒只給管理者', async () => {
  assert.equal((await request('/service-mode/contract-endings', 'GET', undefined, 'staff')).status, 403)
  assert.equal((await request('/service-mode/contract-endings', 'POST', {})).status, 405)
})

// ── 對不上的提示 ──
test('合約快到期時客戶頁提示', async () => {
  assert.ok((await mode('li')).body.warnings.some(item => item.kind === 'contract_ending'))
})
test('自管但年費仍生效時提示', async () => {
  assert.ok((await mode('chan')).body.warnings.some(item => item.kind === 'billing_active'))
})
test('自管但代理範圍仍有我們負責的逐項設定時提示', async () => {
  const item = (await request(`/customers/${state.wong}/scope`)).body.sections.find(section => section.category === 'plate').items[0].code
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.wongPlate, item, handler: 'outsourced', providerName: '外包公司' })).status, 200)
  await setMode('wong', { mode: '自管' })
  const warning = (await mode('wong')).body.warnings.find(item => item.kind === 'leftover_scope')
  assert.ok(warning); assert.match(warning.text, /1 項/)
  await setMode('wong', { mode: '托管' })
})
test('托管但代理範圍沒有我們負責的事項時提示', async () => {
  const items = Object.keys((await request(`/customers/${state.wong}/scope`)).body.sections.find(section => section.category === 'plate').owners[0].cells)
  const result = await request('/service-scopes/batch', 'PUT', { changes: items.map(item => ({ ownerType: 'plate', ownerId: state.wongPlate, item, handler: 'client' })) })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.ok((await mode('wong')).body.warnings.some(item => item.kind === 'empty_scope'))
})
test('還沒有牌照或公司的托管客戶不提示範圍空白', async () => {
  assert.ok(!(await mode('empty')).body.warnings.some(item => item.kind === 'empty_scope'))
})

// ── 權限與錯誤輸入 ──
test('員工不能切換', async () => {
  assert.equal((await setMode('li', { mode: '自管' }, 'staff')).status, 403)
})
test('別的租戶或不存在的客戶找不到', async () => {
  assert.equal((await mode('foreign')).status, 404)
  assert.equal((await setMode('foreign', { mode: '自管' })).status, 404)
  assert.equal((await request(`/customers/${randomUUID()}/service-mode`)).status, 404)
  assert.equal((await request(`/customers/${state.li}/service-mode`, 'GET', undefined, 'other-admin')).status, 404)
})
test('本公司自有不分自管或托管', async () => {
  assert.equal((await request(`/customers/${state.self}/service-mode`)).status, 409)
  assert.equal((await request(`/customers/${state.self}/service-mode`, 'PUT', { mode: '自管' })).status, 409)
})
test('空內容、多餘欄位、錯誤類型都被拒', async () => {
  for (const body of [{}, { mode: '' }, { mode: '全權' }, { mode: null }, { mode: ['自管'] }, { mode: '自管', note: 'x' }, { mode: '自管', effectiveOn: '2026-13-01' }, { mode: '自管', effectiveOn: 20261018 }, { contractEndsOn: '明年' }, { contractEndsOn: 123 }]) {
    assert.equal((await setMode('li', body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await mode('li')).body.mode, '托管')
})
test('null 或陣列請求內容被拒', async () => {
  assert.equal((await setMode('li', 'null')).status, 400)
  assert.equal((await setMode('li', '[]')).status, 400)
})
test('只接受 GET 和 PUT', async () => {
  assert.equal((await request(`/customers/${state.li}/service-mode`, 'POST', { mode: '自管' })).status, 405)
})
