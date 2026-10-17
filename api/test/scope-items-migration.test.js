// 委託範圍由 6 個大項改為逐件設定的一次性遷移（docs/tasks/scope-items-design.md §7）
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const state = {}
const current = (ownerId, item) => state.db.prepare('SELECT * FROM service_scopes WHERE owner_id=? AND service=? AND ended_on IS NULL').get(ownerId, item)

before(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'scope-migration-'))
  process.env.DB_PATH = join(state.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  await import(`../src/db.js?first=${randomUUID()}`)
  state.db = new DatabaseSync(process.env.DB_PATH)
  const add = (sql, ...values) => state.db.prepare(sql).run(...values), now = new Date().toISOString()
  state.customer = randomUUID(); state.group = randomUUID(); state.hk = randomUUID(); state.mo = randomUUID(); state.cn = randomUUID(); state.plate = randomUUID(); state.kept = randomUUID()
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.customer, '遷移客戶', '個人', 'default')
  add('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)', state.group, 'default', state.customer, '組', now)
  for (const [id, jurisdiction] of [[state.hk, '香港'], [state.mo, '澳門'], [state.cn, '內地'], [state.kept, '香港']]) add('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, 'default', state.customer, state.group, jurisdiction, `${jurisdiction}公司`, now, now)
  add('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?)', state.plate, state.customer, '粵港', 'MIGRATE-1', now, now)
  const legacy = (ownerType, ownerId, service, handler, provider = '') => add("INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,provider_name,started_on,ended_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,'2026-09-01',NULL,'',NULL,?)", randomUUID(), 'default', ownerType, ownerId, service, handler, provider, now)
  legacy('company', state.hk, 'company_upkeep', 'client')
  legacy('company', state.hk, 'bookkeeping', 'outsourced', '舊會計')
  legacy('company', state.mo, 'bookkeeping', 'outsourced', '澳門會計')
  legacy('company', state.cn, 'bookkeeping', 'outsourced', '廣州會計')
  legacy('plate', state.plate, 'plate_service', 'client')
  legacy('plate', state.plate, 'rental_management', 'client')
  // 已有逐件記錄的不可被大項覆蓋
  add("INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,provider_name,started_on,ended_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,'2026-09-01',NULL,'',NULL,?)", randomUUID(), 'default', 'company', state.kept, 'hk_nar1', 'us', '', now)
  legacy('company', state.kept, 'company_upkeep', 'client')
  add("UPDATE rules SET active=1 WHERE code='hk_audit_tax'")
  add("DELETE FROM schema_migrations WHERE name='scope-items-v1'")
  await import(`../src/db.js?second=${randomUUID()}`)
  state.afterFirst = state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count
  await import(`../src/db.js?third=${randomUUID()}`)
})
after(() => { state.db?.close(); if (state.directory) rmSync(state.directory, { recursive: true, force: true }) })

test('遷移：香港公司「公司維護」展開為周年申報與商業登記，負責方不變', () => {
  assert.equal(current(state.hk, 'hk_nar1')?.handler, 'client')
  assert.equal(current(state.hk, 'hk_br')?.handler, 'client')
  assert.equal(current(state.hk, 'hk_nar1')?.started_on, '2026-09-01')
})
test('遷移：舊大項記錄結束並保留為歷史', () => {
  const row = state.db.prepare("SELECT * FROM service_scopes WHERE owner_id=? AND service='company_upkeep'").get(state.hk)
  assert.ok(row.ended_on)
})
test('遷移：香港公司舊的每月報帳沒有對應事項，只結束不新增', () => {
  assert.equal(current(state.hk, 'monthly_filing'), undefined)
  assert.equal(current(state.hk, 'cn_cit_annual'), undefined)
  assert.ok(state.db.prepare("SELECT ended_on FROM service_scopes WHERE owner_id=? AND service='bookkeeping'").get(state.hk).ended_on)
})
test('遷移：澳門公司舊的每月報帳轉到澳門報稅，外包單位不變', () => {
  assert.equal(current(state.mo, 'mo_tax')?.handler, 'outsourced')
  assert.equal(current(state.mo, 'mo_tax')?.provider_name, '澳門會計')
})
test('遷移：內地公司每月報帳展開為每月報帳報稅與所得稅匯算清繳', () => {
  assert.equal(current(state.cn, 'monthly_filing')?.provider_name, '廣州會計')
  assert.equal(current(state.cn, 'cn_cit_annual')?.provider_name, '廣州會計')
})
test('遷移：牌照代辦展開到牌照、車輛、司機事項，出租代管轉為租金跟進', () => {
  for (const item of ['approval', 'hk_crp', 'local_insurance', 'inspection', 'home_return_permit', 'crossing_90']) assert.equal(current(state.plate, item)?.handler, 'client', item)
  assert.equal(current(state.plate, 'rent_overdue')?.handler, 'client')
})
test('遷移：已有的逐件記錄不被大項覆蓋', () => {
  assert.equal(current(state.kept, 'hk_nar1')?.handler, 'us')
  assert.equal(current(state.kept, 'hk_br')?.handler, 'client')
})
test('遷移：審計及利得稅規則改為停用', () => {
  assert.equal(state.db.prepare("SELECT active FROM rules WHERE code='hk_audit_tax'").get().active, 0)
})
test('遷移：重跑不重複新增或結束', () => {
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM service_scopes').get().count, state.afterFirst)
})
test('遷移：客戶保持預設清單（甚麼都不會消失）', () => {
  assert.equal(state.db.prepare('SELECT items_customized FROM customers WHERE id=?').get(state.customer).items_customized, 0)
})
