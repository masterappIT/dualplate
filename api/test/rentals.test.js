import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 第 16 輪出租 A：合約、應收款、總覽、客戶只讀。進程內請求，不開連接埠。
const state = {}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const shift = (months, day = 1) => { const [y, m] = hk().split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + months, day)); return d.toISOString().slice(0, 10) }
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'rentals-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  // 先放一筆舊「出租中」記錄，載入伺服器時應遷移為生效合約
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'otherCustomer', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.otherCustomer, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  state.self = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  const now = new Date().toISOString()
  for (const [key, customerId, usage] of [['plate', state.customer, '自用'], ['legacy', state.customer, '出租中'], ['quarter', state.customer, '閒置'], ['selfPlate', state.self, '閒置'], ['otherPlate', state.otherCustomer, '閒置'], ['foreignPlate', state.foreign, '閒置']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(state[key], customerId, '粵港', `粵Z${key}`, state[key], usage, now, now)
  }
  db.prepare("INSERT INTO plate_rentals(id,plate_asset_id,renter_name,starts_on,status,created_at) VALUES (?,?,?,?,'出租中',?)").run(randomUUID(), state.legacy, '舊承租人', '2026-01-01', now)
  state.hkCompany = randomUUID(); state.cnCompany = randomUUID()
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,name,jurisdiction,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state.hkCompany, 'default', state.customer, '示範香港有限公司', '香港', now, now)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,name,jurisdiction,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state.cnCompany, 'default', state.customer, '示範內地公司', '內地', now, now)
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['other-client', 'customer', state.otherCustomer, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const base = extra => ({ plateId: state.plate, renter: { name: '張先生', phone: '+852 6000 0000', vehiclePlate: 'AB1234' }, startsOn: shift(-2), rentAmount: 800000, currency: 'HKD', cycle: 'monthly', dueDay: 5, collectionMode: '代收', feeType: 'percent', feeValue: 10, status: '生效', ...extra })
const usage = plateId => state.db.prepare('SELECT usage_status FROM plate_assets WHERE id=?').get(plateId).usage_status

// ── 遷移 ──
test('舊出租中記錄遷移為生效合約，金額記 0 並標註待補充', async () => {
  const [contract] = (await request(`/rental-contracts?plateId=${state.legacy}`)).body
  assert.equal(contract.status, '生效'); assert.equal(contract.rentAmount, 0); assert.match(contract.notes, /待補充/)
})
test('遷移只執行一次', async () => {
  const { db } = await import('../src/db.js')
  assert.equal(db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE name='2026-10-16-rental-contracts'").get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM rental_contracts WHERE plate_asset_id=?').get(state.legacy).count, 1)
})

// ── 合約與應收款 ──
test('建立生效合約：牌照改為出租中，並生成到今天起 3 個月的應收款', async () => {
  const result = await request('/rental-contracts', 'POST', base())
  assert.equal(result.status, 201, JSON.stringify(result.body)); state.contract = result.body.id
  assert.equal(usage(state.plate), '出租中')
  assert.equal(result.body.invoices.length, 6, result.body.invoices.map(item => item.period).join(','))
  assert.equal(result.body.invoices[0].dueOn, shift(-2, 5))
})
test('重複讀取不重複生成應收款', async () => {
  await request(`/rental-contracts/${state.contract}`); await request('/rent-invoices')
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM rent_invoices WHERE contract_id=?').get(state.contract).count, 6)
})
test('同一牌照已有生效合約時，再建立生效合約被拒', async () => assert.equal((await request('/rental-contracts', 'POST', base({ renter: { name: '李先生' } }))).status, 409))
test('季繳與年繳按期初月份生成期數', async () => {
  const quarterly = (await request('/rental-contracts', 'POST', base({ plateId: state.quarter, cycle: 'quarterly', startsOn: shift(-6) }))).body
  assert.equal(quarterly.invoices.length, 4, quarterly.invoices.map(item => item.period).join(','))
  const yearly = (await request('/rental-contracts', 'POST', base({ plateId: state.otherPlate, cycle: 'yearly', startsOn: shift(-13), collectionMode: '直付', feeType: 'none', feeValue: 0 }))).body
  assert.equal(yearly.invoices.length, 2)
})
test('已過收款日未收的應收款為逾期，未到期為待收', async () => {
  const invoices = (await request(`/rent-invoices?contractId=${state.contract}`)).body
  assert.equal(invoices[0].status, '逾期'); assert.equal(invoices.at(-1).status, '待收')
})
test('登記部分收款與全數收款，可附轉帳憑證', async () => {
  const [first, second] = (await request(`/rent-invoices?contractId=${state.contract}`)).body
  assert.equal((await request(`/rent-invoices/${first.id}/receive`, 'POST', { receivedOn: shift(-2, 6), receivedAmount: 300000 })).body.status, '部分收')
  const full = await request(`/rent-invoices/${second.id}/receive`, 'POST', { receivedOn: shift(-1, 6), receivedAmount: 800000, proof: PNG })
  assert.equal(full.body.status, '已收'); assert.equal(full.body.hasProof, true); assert.equal(full.body.receivedBy, '代辦公司')
  state.received = second.id
})
test('撤銷收款後回到原本狀態並刪除憑證', async () => {
  const result = await request(`/rent-invoices/${state.received}/unreceive`, 'POST')
  assert.equal(result.body.status, '逾期'); assert.equal(result.body.hasProof, false)
  assert.equal((await request(`/rent-invoices/${state.received}/unreceive`, 'POST')).status, 409)
})
test('收款資料錯誤被拒', async () => {
  for (const body of [null, {}, { receivedOn: '2026-02-30', receivedAmount: 100 }, { receivedOn: shift(0), receivedAmount: -1 }, { receivedOn: shift(0), receivedAmount: 1.5 }, { receivedOn: shift(0), receivedAmount: 0 }, { receivedOn: shift(0), receivedAmount: 100, receivedBy: '承租方' }, { receivedOn: shift(0), receivedAmount: 100, proof: Buffer.from('hello').toString('base64') }]) assert.equal((await request(`/rent-invoices/${state.received}/receive`, 'POST', body)).status, 400, JSON.stringify(body))
})
test('修改租金只影響尚未到期的應收款', async () => {
  await request(`/rental-contracts/${state.contract}`, 'PATCH', { rentAmount: 900000 })
  const invoices = (await request(`/rent-invoices?contractId=${state.contract}`)).body
  assert.equal(invoices[0].amount, 800000); assert.equal(invoices.at(-1).amount, 900000)
})
test('提前終止：終止日之後未收的應收款作廢，牌照回到原本用途', async () => {
  assert.equal((await request(`/rental-contracts/${state.contract}/terminate`, 'POST', { endedOn: shift(0) })).status, 400, '須填終止原因')
  const result = await request(`/rental-contracts/${state.contract}/terminate`, 'POST', { endedOn: shift(0), reason: '承租方提前退還' })
  assert.equal(result.status, 200); assert.equal(result.body.status, '已終止')
  assert.ok(result.body.invoices.filter(item => item.dueOn > shift(0)).every(item => item.status === '作廢'))
  assert.equal(usage(state.plate), '自用')
  assert.equal((await request(`/rental-contracts/${state.contract}`, 'PATCH', { notes: 'x' })).status, 409)
})
test('作廢的應收款不可收款', async () => {
  const voided = (await request(`/rent-invoices?contractId=${state.contract}&status=作廢`)).body[0]
  assert.equal((await request(`/rent-invoices/${voided.id}/receive`, 'POST', { receivedOn: shift(0), receivedAmount: 100 })).status, 409)
})

// ── 驗證 ──
test('合約資料錯誤被拒', async () => {
  for (const extra of [{ renter: { name: '' } }, { startsOn: '2026-13-01' }, { endsOn: shift(-5) }, { rentAmount: -1 }, { rentAmount: 12.5 }, { currency: 'USD' }, { dueDay: 29 }, { dueDay: 0 }, { cycle: 'weekly' }, { collectionMode: '轉帳' }, { feeType: 'percent', feeValue: 120 }, { collectionMode: '直付', feeType: 'fixed', feeValue: 100 }, { lessorType: 'company', lessorCompanyId: state.cnCompany }, { lessorType: 'company' }, { status: '已結束' }])
    assert.equal((await request('/rental-contracts', 'POST', base({ status: '草擬', ...extra }))).status, 400, JSON.stringify(extra))
  assert.equal((await request('/rental-contracts', 'POST', null)).status, 400)
})
test('出租方可設為同一客戶的香港公司', async () => {
  const result = await request('/rental-contracts', 'POST', base({ status: '草擬', lessorType: 'company', lessorCompanyId: state.hkCompany }))
  assert.equal(result.status, 201); state.draft = result.body.id
  assert.equal(usage(state.plate), '自用', '草擬合約不改用途')
})
test('本公司自有的牌照不可設為代理出租', async () => assert.equal((await request('/rental-contracts', 'POST', base({ plateId: state.selfPlate, lessorType: 'agent' }))).status, 400))
test('草擬改為生效時才生成應收款，不可搬到其他牌照', async () => {
  assert.equal((await request(`/rental-contracts/${state.draft}`, 'PATCH', { plateId: state.quarter })).status, 400)
  const result = await request(`/rental-contracts/${state.draft}`, 'PATCH', { status: '生效' })
  assert.equal(result.status, 200); assert.ok(result.body.invoices.length > 0); assert.equal(usage(state.plate), '出租中')
  assert.equal((await request(`/rental-contracts/${state.draft}`, 'PATCH', { status: '草擬' })).status, 400)
})
test('牌照手動改用途時須與合約一致', async () => {
  assert.equal((await request(`/plate-assets/${state.plate}`, 'PATCH', { usageStatus: '自用' })).status, 400)
})

// ── 總覽、權限、客戶 ──
test('總覽有本月租金數字，逾期租金列入到期列表', async () => {
  const overview = (await request('/overview')).body
  assert.ok(overview.rent.due.count >= 1); assert.ok(overview.rent.overdue.count >= 1)
  assert.ok(overview.deadlines.some(item => item.ruleCode === 'rent_overdue' && item.level === 'overdue'))
})
test('出租代管設為客戶自理時，逾期租金不列入我們的工作', async () => {
  const scope = await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.quarter, service: 'rental_management', handler: 'client' })
  assert.equal(scope.status, 200, JSON.stringify(scope.body))
  const items = (await request('/overview')).body.deadlines.filter(item => item.ruleCode === 'rent_overdue' && item.ownerId === state.quarter)
  assert.ok(items.length > 0 && items.every(item => item.handler === 'client'), JSON.stringify((await request(`/rent-invoices?contractId=${(await request(`/rental-contracts?plateId=${state.quarter}`)).body[0]?.id}`)).body))
})
test('客戶只看到自己的使用安排，不含承租方電話', async () => {
  const list = (await request('/my/rentals', 'GET', undefined, 'client')).body
  assert.ok(list.length >= 2); assert.ok(list.every(item => item.user && !('phone' in item.user)))
  assert.ok(!JSON.stringify(list).includes('6000 0000'))
  assert.ok(!(await request('/my/rentals', 'GET', undefined, 'other-client')).body.some(item => item.plateId === state.plate))
})
test('客戶與員工不能用出租管理接口', async () => {
  for (const token of ['client', 'staff']) {
    assert.equal((await request('/rental-contracts', 'GET', undefined, token)).status, 403)
    assert.equal((await request('/rent-invoices', 'GET', undefined, token)).status, 403)
  }
  assert.equal((await request('/my/rentals')).status, 403)
})
test('別的租戶看不到合約與應收款', async () => {
  assert.equal((await request(`/rental-contracts/${state.draft}`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request('/rental-contracts', 'POST', base({ status: '草擬' }), 'foreign-admin')).status, 404)
  const invoice = (await request(`/rent-invoices?contractId=${state.draft}`)).body[0]
  assert.equal((await request(`/rent-invoices/${invoice.id}/receive`, 'POST', { receivedOn: shift(0), receivedAmount: 100 }, 'foreign-admin')).status, 404)
})
test('舊出租記錄接口改為建立和結束合約', async () => {
  assert.equal((await request('/plate-rentals', 'POST', { plateAssetId: state.selfPlate, renterName: '臨時承租' })).status, 201)
  assert.equal(usage(state.selfPlate), '出租中')
  assert.equal((await request(`/rental-contracts?plateId=${state.selfPlate}`)).body[0].status, '生效')
  const legacy = state.db.prepare('SELECT id FROM plate_rentals WHERE plate_asset_id=?').get(state.selfPlate)
  assert.equal((await request(`/plate-rentals/${legacy.id}`, 'PATCH', { status: '已結束' })).status, 200)
  assert.equal(usage(state.selfPlate), '閒置')
})
