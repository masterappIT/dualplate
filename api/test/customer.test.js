import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID, scryptSync } from 'node:crypto'

const hash = password => { const salt = randomUUID(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
const isoDay = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

let directory, db, server
const ids = { customerA: randomUUID(), customerB: randomUUID(), plateA: randomUUID(), plateA2: randomUUID(), plateB: randomUUID(), vehicleA: randomUUID(), groupA: randomUUID(), hkA: randomUUID(), cnA: randomUUID() }
const tokens = {}
const request = (path, token = '', method = 'GET', body) => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    server.emit('request', incoming, outgoing)
  })
}

before(async () => {
  directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.customer-api-'))
  const databasePath = join(directory, 'test.db')
  process.env.DB_PATH = databasePath
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const imported = await import(`../src/server.js?customer-test=${randomUUID()}`)
  server = imported.server
  db = new DatabaseSync(databasePath)
  const now = new Date().toISOString()
  for (const [customer, email] of [[ids.customerA, 'a@test.invalid'], [ids.customerB, 'b@test.invalid']]) {
    db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customer, '客戶' + email[0], '公司', 'default')
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), 'customer', '客戶', email, hash('password123'), customer, 'default')
  }
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,username,tenant_id) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), 'admin', '專員', 'admin@test.invalid', hash('password123'), 'staff', 'default')
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(ids.groupA, 'default', ids.customerA, '第一組', now)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.hkA, 'default', ids.customerA, ids.groupA, '香港', '甲香港公司', now, now)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.cnA, 'default', ids.customerA, ids.groupA, '內地', '甲內地公司', now, now)
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(ids.vehicleA, ids.customerA, '粵港', '香港', '私家車', 'AB123')
  // plateA: approval due in 20 days (due), mounted on vehicleA, in groupA. plateA2: approval overdue. plateB: other customer.
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,usage_status,card_number,card_expires_on,group_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(ids.plateA, ids.customerA, '粵港', '粵Z0001港', 'AB123', ids.vehicleA, '自用', 'A1', isoDay(20), ids.groupA, now, now)
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,usage_status,card_number,card_expires_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(ids.plateA2, ids.customerA, '粵港', '粵Z0002港', 'CD456', '自用', 'A2', isoDay(-3), now, now)
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,card_number,card_expires_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.plateB, ids.customerB, '粵港', '粵Z9999港', 'B1', isoDay(10), now, now)
  db.prepare("INSERT INTO plate_rentals(id,plate_asset_id,renter_name,status,created_at) VALUES (?,?,?,'出租中',?)").run(randomUUID(), ids.plateA, '承租甲', now)
  const requestId = randomUUID()
  db.prepare('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(requestId, ids.customerA, 'vehicle_change', '粵港', '換車', '待客戶配合', '收集資料', now, now, ids.plateA)
  db.prepare("INSERT INTO tasks(id,request_id,title,jurisdiction,status) VALUES (?,?,?,?,'待客戶配合')").run(randomUUID(), requestId, '提供新車保險單', '通用')
  for (const [key, email] of [['a', 'a@test.invalid'], ['b', 'b@test.invalid']]) tokens[key] = (await request('/login', '', 'POST', { email, password: 'password123' })).body.token
  tokens.admin = (await request('/admin/login', '', 'POST', { username: 'staff', password: 'password123' })).body.token
})
after(() => { db?.close(); server?.close(); rmSync(directory, { recursive: true, force: true }) })

test('overview counts plate health and lists only the customer own plates', async () => {
  const { status, body } = await request('/my/overview', tokens.a)
  assert.equal(status, 200)
  assert.deepEqual(body.plates.map(p => p.id).sort(), [ids.plateA, ids.plateA2].sort())
  assert.deepEqual(body.counts, { pending: 0, ok: 0, due: 1, overdue: 1 })
  assert.ok(!JSON.stringify(body).includes(ids.plateB))
})

test('overview hides missing-data items and internal fields', async () => {
  const { body } = await request('/my/overview', tokens.a)
  assert.ok(body.deadlines.length > 0)
  assert.ok(body.deadlines.every(item => item.level !== 'missing'))
  for (const key of ['ruleId', 'ruleCode', 'remindDays', 'customerId', 'tenant_id']) assert.ok(body.deadlines.every(item => !(key in item)), key)
})

test('customer-internal rules are hidden from every customer deadline endpoint', async () => {
  const now = new Date().toISOString()
  db.prepare('INSERT INTO rules(id,tenant_id,code,name,scope,method,match_json,params_json,remind_days,active,customer_visible,sort) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)').run(randomUUID(), 'default', 'internal_customer_rule', '客戶不可見測試規則', 'company', 'expiry', JSON.stringify({ jurisdiction: '香港' }), '{}', 30, 0, 999)
  db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_at) VALUES (?,?,?,?,?,?,?)').run('default', 'company', ids.hkA, 'internal_customer_rule', isoDay(-1), '', now)
  const overview = await request('/my/overview', tokens.a)
  const companies = await request('/my/companies', tokens.a)
  const plate = await request(`/my/plates/${ids.plateA}`, tokens.a)
  const customerPayload = JSON.stringify([overview.body, companies.body, plate.body])
  assert.equal(overview.status, 200)
  assert.equal(companies.status, 200)
  assert.equal(plate.status, 200)
  assert.ok(!customerPayload.includes('核對內地公司登記狀態'))
  assert.ok(!customerPayload.includes('客戶不可見測試規則'))
  const adminOverview = await request('/overview', tokens.admin)
  assert.equal(adminOverview.status, 200)
  assert.ok(adminOverview.body.deadlines.some(item => item.ruleCode === 'cn_status_check'))
  assert.ok(adminOverview.body.deadlines.some(item => item.ruleCode === 'internal_customer_rule'))
})

test('overview lists tasks waiting for the customer as to-dos', async () => {
  const { body } = await request('/my/overview', tokens.a)
  assert.deepEqual(body.todos.map(item => item.title), ['提供新車保險單'])
})

test('to-do for an internal step asked of the customer names the documents, not the internal step', async () => {
  const requestId = db.prepare("SELECT id FROM requests WHERE customer_id=? AND title='換車'").get(ids.customerA).id
  const taskId = randomUUID()
  db.prepare("INSERT INTO tasks(id,request_id,title,jurisdiction,status,owner,documents_json) VALUES (?,?,?,?,'待辦','client',?)").run(taskId, requestId, '各證件有效期核對', '通用', JSON.stringify(['香港身份證副本', '車輛登記文件']))
  try {
    const { body } = await request('/my/overview', tokens.a)
    const titles = body.todos.map(item => item.title)
    assert.ok(titles.includes('請提供：香港身份證副本、車輛登記文件'), titles.join(' / '))
    assert.ok(!titles.includes('各證件有效期核對'))
  } finally { db.prepare('DELETE FROM tasks WHERE id=?').run(taskId) }
})

test('to-do keeps a customer step title that already says what to do, without the 客戶 prefix', async () => {
  const requestId = db.prepare("SELECT id FROM requests WHERE customer_id=? AND title='換車'").get(ids.customerA).id
  const taskId = randomUUID()
  db.prepare("INSERT INTO tasks(id,request_id,title,jurisdiction,status,owner,documents_json) VALUES (?,?,?,?,'待辦','client',?)").run(taskId, requestId, '客戶提供身份證及車輛登記文件', '通用', JSON.stringify(['香港身份證副本']))
  try {
    const { body } = await request('/my/overview', tokens.a)
    assert.ok(body.todos.some(item => item.title === '提供身份證及車輛登記文件'))
  } finally { db.prepare('DELETE FROM tasks WHERE id=?').run(taskId) }
})

test('plate summary carries holder, contractor, rental and vehicle deadlines', async () => {
  const { status, body } = await request(`/my/plates/${ids.plateA}`, tokens.a)
  assert.equal(status, 200)
  assert.equal(body.holder, '甲香港公司')
  assert.equal(body.contractor, '甲內地公司')
  assert.equal(body.rental.renter, '承租甲')
  assert.equal(body.health, 'due')
  assert.ok(body.deadlines.some(item => item.name === '批文／指標有效期'))
  assert.equal(body.requests.length, 1)
})

test('companies list groups offshore and mainland companies with their plates', async () => {
  const { body } = await request('/my/companies', tokens.a)
  assert.equal(body.groups.length, 1)
  assert.deepEqual(body.groups[0].offshore.map(c => c.name), ['甲香港公司'])
  assert.deepEqual(body.groups[0].mainland.map(c => c.name), ['甲內地公司'])
  assert.deepEqual(body.groups[0].plates.map(p => p.id), [ids.plateA])
})

test('another customer cannot read the plate', async () => {
  assert.equal((await request(`/my/plates/${ids.plateA}`, tokens.b)).status, 404)
  assert.ok(!JSON.stringify((await request('/my/overview', tokens.b)).body).includes(ids.plateA))
})

test('staff accounts are refused on customer routes', async () => {
  assert.equal((await request('/my/overview', tokens.admin)).status, 403)
})

test('customer routes are read only', async () => {
  assert.equal((await request('/my/overview', tokens.a, 'POST')).status, 405)
})
