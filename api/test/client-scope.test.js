import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 客戶端「委託內容」與委託變更通知（docs/tasks/client-scope-view-design.md，管理者 2026-10-18 確認）
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'client-scope-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [key, name, tenant, mode] of [['first', '客戶甲', 'default', '托管'], ['second', '客戶乙', 'default', '托管'], ['selfManaged', '自管客戶', 'default', '自管'], ['foreign', '外租戶客戶', 'other', '托管']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id,service_mode) VALUES (?,?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant, mode)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['client2', 'customer', state.second, 'default'], ['self-client', 'customer', state.selfManaged, 'default'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
  state.vehicle = (await request('/vehicles', 'POST', { customerId: state.first, route: '粵港', origin: '香港', type: '私家車', plate: 'AB1234' })).body.id
  state.plate = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵港', vehicleId: state.vehicle, cardData: { cardNumber: 'CS-001', validTo: '2027-01-31' } })).body.id
  state.moPlate = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵澳', cardData: { cardNumber: 'CS-002', validTo: '2027-01-31' } })).body.id
  state.hk = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '甲香港有限公司', nameEn: 'Jia HK Limited' })).body.id
  state.cn = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '內地', name: '深圳甲贸易有限公司' })).body.id
  state.closed = (await request('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '甲已註銷有限公司', nameEn: 'Closed Limited' })).body.id
  db.prepare("UPDATE companies SET status='已註銷' WHERE id=?").run(state.closed)
  state.otherPlate = (await request('/plate-assets', 'POST', { customerId: state.second, route: '粵港', cardData: { cardNumber: 'CS-901' } })).body.id
  state.otherCompany = (await request('/companies', 'POST', { customerId: state.second, jurisdiction: '香港', name: '乙香港有限公司', nameEn: 'Yi HK Limited' })).body.id
  state.selfPlate = (await request('/plate-assets', 'POST', { customerId: state.selfManaged, route: '粵港', cardData: { cardNumber: 'CS-801' } })).body.id
  state.firm = randomUUID()
  db.prepare('INSERT INTO accounting_firms(id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(state.firm, 'default', '信達會計師事務所', new Date().toISOString(), new Date().toISOString())
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.57.0.2' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const scope = async (token = 'client') => (await request('/my/scope', 'GET', undefined, token)).body
const owner = async (id, token = 'client') => (await scope(token)).sections.flatMap(section => section.owners).find(item => item.id === id)
const names = list => list.map(item => item.name)
const setScope = (ownerType, ownerId, item, handler, extra = {}) => request('/service-scopes', 'PUT', { ownerType, ownerId, item, handler, ...extra })
const notices = (customerId = state.first) => state.db.prepare("SELECT * FROM notifications WHERE customer_id=? AND kind='scope_changed' ORDER BY created_at, rowid").all(customerId)
const clearNotices = () => state.db.prepare("DELETE FROM notifications WHERE kind='scope_changed'").run()

// —— 客戶看到的委託內容 ——
test('客戶只看到自己的牌照和公司', async () => {
  const ids = (await scope()).sections.flatMap(section => section.owners).map(item => item.id)
  assert.ok(ids.includes(state.plate) && ids.includes(state.hk) && ids.includes(state.cn))
  assert.ok(!ids.includes(state.otherPlate) && !ids.includes(state.otherCompany) && !ids.includes(state.selfPlate))
})
test('分段按車牌、香港公司、內地公司，沒有的分段不列出', async () => {
  assert.deepEqual((await scope()).sections.map(section => section.label), ['香港公司', '內地公司', '車牌'])
})
test('已註銷的公司不列出', async () => {
  assert.equal(await owner(state.closed), undefined)
})
test('外包對客戶顯示為我們負責，不透露外包單位', async () => {
  const saved = await setScope('company', state.cn, 'monthly_filing', 'outsourced', { providerId: state.firm, providerName: '信達會計師事務所' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  const cn = await owner(state.cn)
  assert.ok(names(cn.us).includes('每月報帳報稅'))
  assert.doesNotMatch(JSON.stringify(await scope()), /信達會計/)
})
test('客戶自理的事項顯示為你自行辦理', async () => {
  assert.equal((await setScope('company', state.hk, 'hk_br', 'client')).status, 200)
  const hk = await owner(state.hk)
  assert.ok(names(hk.you).includes('香港商業登記證'))
  assert.ok(!names(hk.us).includes('香港商業登記證'))
})
test('不回傳起始日、外包單位或內部負責方代號', async () => {
  const text = JSON.stringify(await scope())
  assert.doesNotMatch(text, /startedOn|providerName|outsourced|"handler"/)
})
test('粵港牌照不列澳門車輛的事項', async () => {
  const plate = await owner(state.plate)
  assert.ok(!names([...plate.us, ...plate.you]).some(name => name.includes('澳門')))
  assert.ok(names(plate.us).includes('香港車輛牌照'))
})
test('未綁車的粵澳牌照按路線列澳門車輛事項，不列香港車輛牌照', async () => {
  const plate = await owner(state.moPlate)
  assert.ok(names(plate.us).includes('澳門車輛定期檢驗'))
  assert.ok(!names(plate.us).includes('香港車輛牌照'))
})
test('不在客戶委託清單內的事項不列出', async () => {
  assert.equal((await request(`/customers/${state.second}/items`, 'PUT', { remove: ['hk_nar1'], dryRun: false })).status, 200)
  assert.ok(!names((await owner(state.otherCompany, 'client2')).us).includes('香港周年申報表 NAR1'))
})
test('不再續期的牌照標明已標記不再續期', async () => {
  state.db.prepare("UPDATE plate_assets SET stopped_on='2026-10-01', stop_reason='不再續期' WHERE id=?").run(state.moPlate)
  assert.equal((await owner(state.moPlate)).stopped, true)
  assert.equal((await owner(state.plate)).stopped, false)
  state.db.prepare('UPDATE plate_assets SET stopped_on=NULL, stop_reason=NULL WHERE id=?').run(state.moPlate)
})
test('員工不能用客戶的委託內容接口', async () => {
  assert.equal((await request('/my/scope', 'GET', undefined, 'staff')).status, 403)
  assert.equal((await request('/my/scope', 'GET', undefined, 'admin')).status, 403)
})
test('未登入不能看委託內容', async () => {
  assert.equal((await request('/my/scope', 'GET', undefined, null)).status, 401)
})
test('別的租戶的客戶看不到這個租戶的資料', async () => {
  const text = JSON.stringify(await scope('foreign-client'))
  assert.doesNotMatch(text, new RegExp(`${state.plate}|${state.hk}|甲香港`))
})
test('委託內容只能看，不能改', async () => {
  assert.equal((await request('/my/scope', 'PUT', { ownerId: state.hk }, 'client')).status, 405)
})

// —— 委託變更通知 ——
test('改為客戶自理時通知客戶，按通知打開那間公司的委託內容', async () => {
  clearNotices()
  assert.equal((await setScope('company', state.hk, 'hk_nar1', 'client')).status, 200)
  const list = notices()
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '香港周年申報表 NAR1改為由你自行辦理')
  assert.match(list[0].body, /甲香港有限公司：由 \d{4}-\d{2}-\d{2} 起/)
  assert.match(list[0].body, /到期前我們會提醒你/)
  assert.equal(list[0].link, `/pages/scope/scope?id=${state.hk}`)
})
test('改回我們負責時通知客戶', async () => {
  clearNotices()
  assert.equal((await setScope('company', state.hk, 'hk_nar1', 'us')).status, 200)
  assert.equal(notices()[0]?.title, '香港周年申報表 NAR1改為由我們負責')
})
test('外包和我們做之間互換不通知客戶', async () => {
  clearNotices()
  assert.equal((await setScope('company', state.cn, 'monthly_filing', 'us')).status, 200)
  assert.equal(notices().length, 0)
})
test('重存相同的負責方不通知', async () => {
  clearNotices()
  assert.equal((await setScope('company', state.hk, 'hk_br', 'client')).status, 200)
  assert.equal(notices().length, 0)
})
test('整批修改同一間公司多項時合成一則', async () => {
  clearNotices()
  const changes = ['hk_nar1', 'hk_br'].map(item => ({ ownerType: 'company', ownerId: state.hk, item, handler: item === 'hk_br' ? 'us' : 'client' }))
  assert.equal((await request('/service-scopes/batch', 'PUT', { changes })).status, 200)
  const list = notices()
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '「甲香港有限公司」的委託內容有 2 項更新')
  assert.match(list[0].body, /香港周年申報表 NAR1改為由你自行辦理/)
  assert.match(list[0].body, /香港商業登記證改為由我們負責/)
})
test('整批預覽不通知', async () => {
  clearNotices()
  const changes = [{ ownerType: 'company', ownerId: state.hk, item: 'hk_nar1', handler: 'us' }]
  assert.equal((await request('/service-scopes/batch', 'PUT', { changes, dryRun: true })).status, 200)
  assert.equal(notices().length, 0)
})
test('整批有一項不合格時全部不改，也不通知', async () => {
  clearNotices()
  const changes = [{ ownerType: 'company', ownerId: state.hk, item: 'hk_nar1', handler: 'us' }, { ownerType: 'company', ownerId: randomUUID(), item: 'hk_br', handler: 'us' }]
  assert.equal((await request('/service-scopes/batch', 'PUT', { changes })).status, 404)
  assert.equal(notices().length, 0)
})
test('改不存在的對象回 404，不通知', async () => {
  clearNotices()
  assert.equal((await setScope('company', randomUUID(), 'hk_br', 'client')).status, 404)
  assert.equal(notices().length, 0)
})
test('從委託清單移除事項時通知不再列入', async () => {
  clearNotices()
  assert.equal((await request(`/customers/${state.first}/items`, 'PUT', { remove: ['hk_registered_office'], dryRun: false })).status, 200)
  const list = notices()
  assert.equal(list.length, 1)
  assert.match(list[0].title, /不再列入委託內容$/)
  assert.match(list[0].body, /我們不再跟進或提醒/)
})
test('把事項加回委託清單時通知加入', async () => {
  clearNotices()
  assert.equal((await request(`/customers/${state.first}/items`, 'PUT', { add: ['hk_registered_office'], dryRun: false })).status, 200)
  assert.match(notices()[0]?.title || '', /加入委託，由我們負責$/)
})
test('事項清單預覽不通知', async () => {
  clearNotices()
  assert.equal((await request(`/customers/${state.first}/items`, 'PUT', { remove: ['hk_registered_office'] })).status, 200)
  assert.equal(notices().length, 0)
})
test('套用範本時每間有改動的公司各收一則，沒改動的牌照不通知', async () => {
  for (const card of ['CS-003', 'CS-004']) state[card] = (await request('/plate-assets', 'POST', { customerId: state.first, route: '粵港', cardData: { cardNumber: card } })).body.id
  assert.equal((await request(`/customers/${state.first}/apply-template`, 'POST', { template: 'full', dryRun: false })).status, 200)
  clearNotices()
  assert.equal((await request(`/customers/${state.first}/apply-template`, 'POST', { template: 'plates_only', dryRun: false })).status, 200)
  const links = notices().map(item => item.link).sort()
  assert.deepEqual(links, [`/pages/scope/scope?id=${state.cn}`, `/pages/scope/scope?id=${state.hk}`].sort())
})
test('套用範本預覽不通知', async () => {
  clearNotices()
  assert.equal((await request(`/customers/${state.first}/apply-template`, 'POST', { template: 'full' })).status, 200)
  assert.equal(notices().length, 0)
})
test('一次改動四個或以上牌照或公司時合成一則，打開整頁委託內容', async () => {
  clearNotices()
  const changes = [state.plate, state.moPlate, state['CS-003'], state['CS-004']].map(ownerId => ({ ownerType: 'plate', ownerId, item: 'cn_ctpl', handler: 'client' }))
  assert.equal((await request('/service-scopes/batch', 'PUT', { changes })).status, 200)
  const list = notices()
  assert.equal(list.length, 1, JSON.stringify(list.map(item => item.title)))
  assert.equal(list[0].title, '你的委託內容有更新')
  assert.match(list[0].body, /4 個牌照或公司/)
  assert.equal(list[0].link, '/pages/scope/scope')
})
test('委託變更只通知該客戶', async () => {
  const before = notices(state.second).length
  assert.equal((await setScope('company', state.hk, 'hk_br', 'us')).status, 200)
  assert.equal(notices(state.second).length, before)
})
test('自管客戶不收委託變更通知', async () => {
  assert.equal((await request(`/customers/${state.selfManaged}/items`, 'PUT', { remove: ['hk_licence'], dryRun: false })).status, 200)
  assert.equal(notices(state.selfManaged).length, 0)
})
test('只有管理者可以改委託範圍，員工改不了也不會發通知', async () => {
  clearNotices()
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'company', ownerId: state.hk, item: 'hk_br', handler: 'client' }, 'staff')).status, 403)
  assert.equal(notices().length, 0)
})
