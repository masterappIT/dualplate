import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { businessToday } from '../src/rules.js'

const fixture = {}
before(async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'view-routes-'))
  process.env.DB_PATH = join(fixture.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const migration = spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'"], { cwd: new URL('../', import.meta.url), env: process.env, encoding: 'utf8' })
  assert.equal(migration.status, 0, migration.stderr)
  fixture.db = new DatabaseSync(process.env.DB_PATH)
  const { server } = await import('../src/server.js')
  fixture.server = server
  fixture.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other-view', '其他租戶', new Date().toISOString())
  fixture.customer = randomUUID()
  fixture.otherCustomer = randomUUID()
  for (const [customerId, tenant] of [[fixture.customer, 'default'], [fixture.otherCustomer, 'other-view']]) fixture.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, '測試客戶', '公司', tenant)
  for (const [token, role, customerId, tenant] of [['view-admin', 'admin', null, 'default'], ['view-staff', 'staff', null, 'default'], ['view-client', 'customer', fixture.customer, 'default'], ['view-other', 'admin', null, 'other-view']]) {
    const userId = randomUUID()
    fixture.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, role, `${token}@test.invalid`, 'unused', customerId, tenant)
    fixture.db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
})
after(() => { fixture.db?.close(); fixture.server?.close(); if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true }) })

async function request(path, token = 'view-admin', method = 'GET') {
  const incoming = Readable.from([])
  incoming.url = `/api${path}`
  incoming.method = method
  incoming.headers = { host: 'localhost', authorization: `Bearer ${token}` }
  return new Promise(resolve => fixture.server.emit('request', incoming, { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }))
}

test('本週進度空資料回傳零且不含別的租戶', async () => {
  const result = await request('/views/weekly-progress')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { done: 0, total: 0 })
})

test('本週進度計入同租戶本週到期牌照', async () => {
  const plateId = randomUUID()
  const date = businessToday().toISOString().slice(0, 10)
  fixture.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,card_expires_on,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?,?)').run(plateId, fixture.customer, '粵港', 'VIEW-CARD', date, new Date().toISOString(), new Date().toISOString(), '{}')
  const result = await request('/views/weekly-progress')
  assert.equal(result.status, 200)
  assert.ok(result.body.total >= 1)
  assert.equal(result.body.done, 0)
})

test('本週進度計入已完成的同週週期事項', async () => {
  const today = businessToday()
  const date = today.toISOString().slice(0, 10)
  const code = `weekly-complete-${randomUUID()}`
  const companyId = randomUUID()
  fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,incorporated_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(companyId, 'default', fixture.customer, '香港', '本週測試公司', date, date, date)
  fixture.db.prepare('INSERT INTO rules(id,tenant_id,code,name,scope,method,match_json,params_json,remind_days,active,sort) VALUES (?,?,?,?,?,?,?,?,?,1,?)').run(randomUUID(), 'default', code, '本週週期事項', 'company', 'yearly', '{}', JSON.stringify({ month: today.getUTCMonth() + 1, day: today.getUTCDate() }), 30, 900)
  const before = await request('/views/weekly-progress')
  fixture.db.prepare('INSERT INTO rule_completions(tenant_id,code,owner_id,period,completed_at) VALUES (?,?,?,?,?)').run('default', code, companyId, String(today.getUTCFullYear()), date)
  const afterCompletion = await request('/views/weekly-progress')
  assert.equal(afterCompletion.body.total, before.body.total)
  assert.equal(afterCompletion.body.done, before.body.done + 1)
})

test('本週進度員工可讀', async () => {
  assert.equal((await request('/views/weekly-progress', 'view-staff')).status, 200)
})

test('本週進度客戶帳號越權 403', async () => {
  assert.equal((await request('/views/weekly-progress', 'view-client')).status, 403)
})

test('本週進度不同租戶互不混入', async () => {
  const other = await request('/views/weekly-progress', 'view-other')
  assert.equal(other.status, 200)
  assert.deepEqual(other.body, { done: 0, total: 0 })
})

test('本週進度拒絕非唯讀方法', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request('/views/weekly-progress', 'view-admin', method)).status, 405)
})

test('本週進度不存在的路徑不被接管', async () => {
  assert.equal((await request('/views/not-found')).status, 404)
})
