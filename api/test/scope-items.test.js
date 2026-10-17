// 逐件委託、客戶事項清單與分段矩陣（docs/tasks/scope-items-design.md）
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const state = {}
const request = (path, method = 'GET', body, token = 'admin') => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    state.server.emit('request', incoming, outgoing)
  })
}
const add = (sql, ...values) => state.db.prepare(sql).run(...values)
const now = () => new Date().toISOString()
const company = (customer, jurisdiction, group = null, name = `${jurisdiction}公司 ${randomUUID().slice(0, 4)}`) => { const id = randomUUID(); add('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, state.tenant, customer, group, jurisdiction, name, now(), now()); return id }
const customer = (name, tenant = state.tenant) => { const id = randomUUID(); add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', id, name, '個人', tenant); return id }
const scope = async customerId => (await request(`/customers/${customerId}/scope`)).body
const section = (body, category) => body.sections.find(item => item.category === category)
const deadlines = async () => (await request('/overview?days=365')).body.deadlines

before(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'scope-items-'))
  process.env.DB_PATH = join(state.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  state.server = (await import(`../src/server.js?scope-items=${randomUUID()}`)).server
  state.db = new DatabaseSync(process.env.DB_PATH)
  state.tenant = 'default'
  state.otherTenant = randomUUID()
  add('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', state.otherTenant, '其他租戶', now())
  state.a = customer('甲客戶'); state.b = customer('乙客戶'); state.foreign = customer('別的租戶客戶', state.otherTenant)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, state.tenant], ['staff', 'staff', null, state.tenant], ['client', 'customer', state.a, state.tenant]]) {
    const userId = randomUUID()
    add('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)', userId, role, token, `${token}-${userId}@test.invalid`, 'unused', customerId, `${token}-${userId}`, tenant)
    add('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)', token, userId, '2099-01-01T00:00:00Z')
  }
  state.group = randomUUID()
  add('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)', state.group, state.tenant, state.a, '甲組', now())
  state.hk = company(state.a, '香港', state.group, '甲香港公司'); state.mo = company(state.a, '澳門'); state.cn = company(state.a, '內地', state.group)
  state.bHk = company(state.b, '香港'); state.bCn = company(state.b, '內地')
  state.plate = randomUUID(); state.bPlate = randomUUID()
  add('INSERT INTO plate_assets(id,customer_id,route,card_number,mainland_plate,local_plate,group_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', state.plate, state.a, '粵港', 'CARD-A', '粵Z·A001港', 'AA1', state.group, now(), now())
  add('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?)', state.bPlate, state.b, '粵港', 'CARD-B', now(), now())
  add('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)', state.tenant, 'company', state.hk, 'hk_br', '2027-03-01', now())
})
after(() => { state.db?.close(); state.server?.close(); if (state.directory) rmSync(state.directory, { recursive: true, force: true }) })

test('委託範圍按香港、澳門、內地公司及車牌分段', async () => {
  const body = await scope(state.a)
  assert.deepEqual(body.sections.map(item => item.category), ['hk', 'mo', 'cn', 'plate'])
  assert.deepEqual(section(body, 'hk').owners.map(item => item.id), [state.hk])
  assert.deepEqual(section(body, 'mo').owners.map(item => item.id), [state.mo])
  assert.deepEqual(section(body, 'cn').owners.map(item => item.id), [state.cn])
  assert.deepEqual(section(body, 'plate').owners.map(item => item.id), [state.plate])
})
test('每段只列適用的事項', async () => {
  const body = await scope(state.a)
  assert.deepEqual(section(body, 'hk').items.map(item => item.code).sort(), ['hk_br', 'hk_nar1', 'hk_registered_office'])
  assert.deepEqual(section(body, 'mo').items.map(item => item.code), ['mo_tax'])
  assert.ok(section(body, 'plate').items.every(item => item.group))
})
test('審計及利得稅預設停用，不出現在委託範圍', async () => {
  const body = await scope(state.a)
  assert.ok(body.sections.every(item => !item.items.some(entry => entry.code === 'hk_audit_tax') && !item.available.some(entry => entry.code === 'hk_audit_tax')))
})
test('每月報帳報稅只在內地公司段，排第一', async () => {
  const body = await scope(state.a)
  assert.equal(section(body, 'cn').items[0].code, 'monthly_filing')
  assert.ok(!section(body, 'hk').items.some(item => item.code === 'monthly_filing'))
  assert.ok(!section(body, 'mo').items.some(item => item.code === 'monthly_filing'))
})
test('公司行列出同一公司組的牌照', async () => {
  const row = section(await scope(state.a), 'hk').owners[0]
  assert.deepEqual(row.plates, ['粵Z·A001港 · AA1'])
})
test('車牌段的出租事項是租金跟進', async () => {
  const item = section(await scope(state.a), 'plate').items.find(entry => entry.code === 'rent_overdue')
  assert.equal(item.group, 'rental')
})
test('香港公司設定每月報帳回 400', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hk, item: 'monthly_filing', handler: 'us' })).status, 400)
})
test('舊大項代碼 bookkeeping 對香港公司回 400', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hk, service: 'bookkeeping', handler: 'us' })).status, 400)
})
test('舊大項代碼 bookkeeping 對澳門公司轉為澳門報稅', async () => {
  const result = await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.mo, service: 'bookkeeping', handler: 'outsourced', providerName: '澳門會計' })
  assert.equal(result.status, 200)
  assert.equal(result.body.items.find(item => item.item === 'mo_tax').providerName, '澳門會計')
})
test('事項代碼錯誤類型回 400', async () => {
  for (const item of [null, [], 3, '']) assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hk, item, handler: 'us' })).status, 400, JSON.stringify(item))
})
test('移除事項預覽不寫入並列出影響', async () => {
  const result = await request(`/customers/${state.a}/items`, 'PUT', { remove: ['hk_br'] })
  assert.equal(result.status, 200)
  assert.equal(result.body.applied, false)
  assert.deepEqual(result.body.removed.map(item => [item.code, item.owners]), [['hk_br', 1]])
  assert.equal(state.db.prepare('SELECT items_customized FROM customers WHERE id=?').get(state.a).items_customized, 0)
})
test('移除事項後該客戶不再有該到期項目，其他客戶不受影響', async () => {
  assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { remove: ['hk_br'], dryRun: false })).status, 200)
  const list = await deadlines()
  assert.ok(!list.some(item => item.ownerId === state.hk && item.ruleCode === 'hk_br'))
  assert.ok(list.some(item => item.ownerId === state.bHk && item.ruleCode === 'hk_br'))
  assert.ok(!section(await scope(state.a), 'hk').items.some(item => item.code === 'hk_br'))
  assert.ok(section(await scope(state.a), 'hk').available.some(item => item.code === 'hk_br'))
})
test('不在清單的事項不可設定負責方', async () => {
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hk, item: 'hk_br', handler: 'client' })).status, 400)
})
test('加回事項後到期項目恢復，已填日期保留', async () => {
  assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { add: ['hk_br'], dryRun: false })).status, 200)
  const item = (await deadlines()).find(entry => entry.ownerId === state.hk && entry.ruleCode === 'hk_br')
  assert.equal(item?.dueOn, '2027-03-01')
})
test('加入停用事項回 400', async () => {
  assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { add: ['hk_audit_tax'] })).status, 400)
})
test('加入不存在事項回 400', async () => {
  assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { add: ['no_such_item'] })).status, 400)
})
test('同一事項同時加入及移除回 400', async () => {
  assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { add: ['hk_br'], remove: ['hk_br'] })).status, 400)
})
test('事項清單請求內容 null、陣列、錯誤類型、空清單回 400', async () => {
  for (const body of [null, [], { add: 'hk_br' }, { add: [1] }, { remove: [null] }, {}, { add: [], remove: [] }, { remove: ['hk_br'], dryRun: 'no' }]) assert.equal((await request(`/customers/${state.a}/items`, 'PUT', body)).status, 400, JSON.stringify(body))
})
test('事項清單與委託範圍：別的租戶客戶回 404', async () => {
  assert.equal((await request(`/customers/${state.foreign}/items`, 'PUT', { remove: ['hk_br'] })).status, 404)
  assert.equal((await request(`/customers/${state.foreign}/scope`)).status, 404)
  assert.equal((await request(`/customers/${randomUUID()}/scope`)).status, 404)
})
test('事項清單與委託範圍：員工與客戶帳號回 403', async () => {
  for (const token of ['staff', 'client']) {
    assert.equal((await request(`/customers/${state.a}/items`, 'PUT', { remove: ['hk_br'] }, token)).status, 403)
    assert.equal((await request(`/customers/${state.a}/scope`, 'GET', undefined, token)).status, 403)
  }
})
test('移除每月報帳後不再生成報帳期數', async () => {
  const c = customer('丙客戶'), cn = company(c, '內地')
  assert.equal((await request(`/customers/${c}/items`, 'PUT', { remove: ['monthly_filing'], dryRun: false })).status, 200)
  await deadlines()
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM filing_periods WHERE company_id=?').get(cn).count, 0)
  assert.ok(state.db.prepare('SELECT COUNT(*) count FROM filing_periods WHERE company_id=?').get(state.bCn).count > 0)
})
test('套用範本後新增的公司跟隨範本', async () => {
  const d = customer('丁客戶')
  assert.equal((await request(`/customers/${d}/apply-template`, 'POST', { template: 'plates_only', dryRun: false })).status, 200)
  const hk = company(d, '香港')
  const item = (await deadlines()).find(entry => entry.ownerId === hk && entry.ruleCode === 'hk_br')
  assert.equal(item?.handler, 'client')
  assert.equal(section(await scope(d), 'hk').owners[0].cells.hk_br.defaulted, true)
})
test('套用範本只改寫已有的逐件記錄，不為每格新增記錄', async () => {
  const e = customer('戊客戶'), hk = company(e, '香港'), cn = company(e, '內地')
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: hk, item: 'hk_nar1', handler: 'outsourced', providerName: '秘書公司' })).status, 200)
  const result = await request(`/customers/${e}/apply-template`, 'POST', { template: 'plates_and_mainland', dryRun: false })
  assert.equal(result.status, 200)
  assert.equal(state.db.prepare('SELECT handler FROM service_scopes WHERE owner_id=? AND service=? AND ended_on IS NULL').get(hk, 'hk_nar1').handler, 'client')
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM service_scopes WHERE owner_id=? AND ended_on IS NULL').get(hk).count, 1)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM service_scopes WHERE owner_id=?').get(cn).count, 0)
  assert.equal(section(await scope(e), 'hk').owners[0].cells.hk_br.handler, 'client')
  assert.equal(section(await scope(e), 'cn').owners[0].cells.monthly_filing.handler, 'us')
})
test('整批提交 dryRun 回傳影響且不寫入', async () => {
  const before = state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count
  const result = await request('/service-scopes/batch', 'PUT', { dryRun: true, changes: [{ ownerType: 'plate', ownerId: state.plate, item: 'approval', handler: 'client' }, { ownerType: 'plate', ownerId: state.plate, item: 'hk_crp', handler: 'client' }] })
  assert.equal(result.status, 200)
  assert.equal(result.body.impact.toClient, 2)
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count, before)
})
test('整批提交 dryRun 列出相關進行中工單', async () => {
  const requestId = randomUUID()
  add("INSERT INTO requests(id,customer_id,plate_asset_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,'進行中','辦理',?,?)", requestId, state.a, state.plate, 'renewal', '粵港', '批文續期', now(), now())
  const result = await request('/service-scopes/batch', 'PUT', { dryRun: true, changes: [{ ownerType: 'plate', ownerId: state.plate, item: 'approval', handler: 'client' }] })
  assert.deepEqual(result.body.impact.openRequests.map(item => item.id), [requestId])
})
test('整批提交 dryRun 錯誤類型回 400', async () => {
  assert.equal((await request('/service-scopes/batch', 'PUT', { dryRun: 'yes', changes: [{ ownerType: 'plate', ownerId: state.plate, item: 'approval', handler: 'client' }] })).status, 400)
})
test('新增規則預設加到已自訂清單的客戶', async () => {
  const result = await request('/rules', 'POST', { code: 'test_added_all', name: '測試事項甲', scope: 'company', method: 'expiry', match: { jurisdiction: ['香港'] }, params: {}, remindDays: 30 })
  assert.equal(result.status, 201)
  assert.ok(section(await scope(state.a), 'hk').items.some(item => item.code === 'test_added_all'))
})
test('新增規則 addToAll=false 不加到已自訂清單的客戶，預設清單客戶仍有', async () => {
  assert.equal((await request('/rules', 'POST', { code: 'test_not_added', name: '測試事項乙', scope: 'company', method: 'expiry', match: { jurisdiction: ['香港'] }, params: {}, remindDays: 30, addToAll: false })).status, 201)
  assert.ok(section(await scope(state.a), 'hk').available.some(item => item.code === 'test_not_added'))
  assert.ok(section(await scope(state.b), 'hk').items.some(item => item.code === 'test_not_added'))
})
test('新增車牌規則可選小組', async () => {
  assert.equal((await request('/rules', 'POST', { code: 'test_plate_group', name: '測試備案', scope: 'plate', method: 'expiry', match: {}, params: {}, remindDays: 30, itemGroup: 'filing' })).status, 201)
  assert.equal(section(await scope(state.b), 'plate').items.find(item => item.code === 'test_plate_group')?.group, 'filing')
})
test('規則小組無效或公司規則設小組回 400', async () => {
  assert.equal((await request('/rules', 'POST', { code: 'test_bad_group', name: '測試', scope: 'plate', method: 'expiry', match: {}, params: {}, remindDays: 30, itemGroup: 'nope' })).status, 400)
  assert.equal((await request('/rules', 'POST', { code: 'test_company_group', name: '測試', scope: 'company', method: 'expiry', match: {}, params: {}, remindDays: 30, itemGroup: 'filing' })).status, 400)
  assert.equal((await request('/rules', 'POST', { code: 'test_bad_add', name: '測試', scope: 'plate', method: 'expiry', match: {}, params: {}, remindDays: 30, addToAll: 'yes' })).status, 400)
})
test('規則代碼不可用內建事項代碼', async () => {
  assert.equal((await request('/rules', 'POST', { code: 'monthly_filing', name: '測試', scope: 'company', method: 'expiry', match: {}, params: {}, remindDays: 30 })).status, 409)
})
test('自有客戶套用只管牌照範本仍為我們做', async () => {
  const self = state.db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get(state.tenant).id
  const hk = company(self, '香港')
  const preview = await request(`/customers/${self}/apply-template`, 'POST', { template: 'plates_only' })
  assert.equal(preview.status, 200)
  assert.ok(!preview.body.changes.some(item => item.ownerId === hk))
})
