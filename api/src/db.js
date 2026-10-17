import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { defaultRules, defaultGroup, ruleScopes } from './rules.js'
import { services, planFor } from './catalog.js'

const file = resolve(process.env.DB_PATH || './data/app.sqlite')
mkdirSync(dirname(file), { recursive: true })
export const db = new DatabaseSync(file)
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, customer_id TEXT, username TEXT UNIQUE, active INTEGER NOT NULL DEFAULT 1, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT, owner_id TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, origin TEXT NOT NULL, type TEXT NOT NULL, plate TEXT NOT NULL, brand TEXT, model TEXT, vin TEXT, manufactured_year INTEGER, notes TEXT);
CREATE TABLE IF NOT EXISTS plate_assets(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, mainland_plate TEXT, local_plate TEXT, vehicle_id TEXT, installation_status TEXT NOT NULL DEFAULT '待核對', usage_status TEXT NOT NULL DEFAULT '待核對', card_number TEXT, card_expires_on TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(vehicle_id) REFERENCES vehicles(id));
CREATE TABLE IF NOT EXISTS plate_rentals(id TEXT PRIMARY KEY, plate_asset_id TEXT NOT NULL, renter_name TEXT NOT NULL, renter_vehicle_plate TEXT, starts_on TEXT, ends_on TEXT, status TEXT NOT NULL DEFAULT '出租中', notes TEXT, created_at TEXT NOT NULL, FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS approval_card_images(plate_asset_id TEXT NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(plate_asset_id,side), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS plate_photos(plate_asset_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(plate_asset_id,kind), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT, number TEXT, expires_on TEXT, status TEXT NOT NULL DEFAULT '待核對', source_id TEXT);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, vehicle_id TEXT, service_code TEXT NOT NULL, route TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, stage TEXT NOT NULL, assignee_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, due_on TEXT, template_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', completed_at TEXT, cancelled_reason TEXT);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, title TEXT NOT NULL, jurisdiction TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待辦', source_id TEXT, due_on TEXT, notes TEXT, owner TEXT NOT NULL DEFAULT 'us', documents_json TEXT NOT NULL DEFAULT '[]', completed_by TEXT, completed_at TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, request_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL, appointment_on TEXT, result_on TEXT, source_id TEXT, notes TEXT);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_plate_assets_customer ON plate_assets(customer_id);
CREATE INDEX IF NOT EXISTS idx_plate_rentals_asset ON plate_rentals(plate_asset_id);
CREATE INDEX IF NOT EXISTS idx_credentials_vehicle ON credentials(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_id);`)
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')

const cardLatestOnlyMigration = 'card-latest-only'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(cardLatestOnlyMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('approval_card_version_images')) db.exec('DELETE FROM approval_card_version_images')
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('approval_card_versions')) db.exec('DELETE FROM approval_card_versions')
    db.exec('DROP TABLE IF EXISTS approval_card_version_images')
    db.exec('DROP TABLE IF EXISTS approval_card_versions')
    db.exec('DROP INDEX IF EXISTS idx_card_versions_asset')
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(cardLatestOnlyMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  db.exec('VACUUM')
}

// Apply additive schema changes to existing local databases.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(x => x.name)
if (!userColumns.includes('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)')
// Existing administrators receive a login name based on the part before @.
for (const account of db.prepare("SELECT id,email FROM users WHERE role='admin' AND username IS NULL ORDER BY rowid").all()) {
  const base = String(account.email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'admin'
  let username = base, suffix = 2
  while (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) username = `${base}${suffix++}`
  db.prepare('UPDATE users SET username=? WHERE id=?').run(username, account.id)
}
const rentalColumns = db.prepare('PRAGMA table_info(plate_rentals)').all().map(x => x.name)
if (!rentalColumns.includes('renter_vehicle_plate')) db.exec('ALTER TABLE plate_rentals ADD COLUMN renter_vehicle_plate TEXT')
const plateColumns = db.prepare('PRAGMA table_info(plate_assets)').all().map(x => x.name)
if (!plateColumns.includes('card_data')) db.exec("ALTER TABLE plate_assets ADD COLUMN card_data TEXT NOT NULL DEFAULT '{}'")
if (!plateColumns.includes('card_updated_by')) db.exec('ALTER TABLE plate_assets ADD COLUMN card_updated_by TEXT')
if (!plateColumns.includes('card_updated_at')) db.exec('ALTER TABLE plate_assets ADD COLUMN card_updated_at TEXT')
if (!plateColumns.includes('card_status')) db.exec("ALTER TABLE plate_assets ADD COLUMN card_status TEXT NOT NULL DEFAULT '待核對'")
const requestColumns = db.prepare('PRAGMA table_info(requests)').all().map(x => x.name)
if (!requestColumns.includes('plate_asset_id')) db.exec('ALTER TABLE requests ADD COLUMN plate_asset_id TEXT REFERENCES plate_assets(id)')
if (!requestColumns.includes('due_on')) db.exec('ALTER TABLE requests ADD COLUMN due_on TEXT')
if (!requestColumns.includes('template_id')) db.exec('ALTER TABLE requests ADD COLUMN template_id TEXT')
if (!requestColumns.includes('priority')) db.exec("ALTER TABLE requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'")
if (!requestColumns.includes('completed_at')) db.exec('ALTER TABLE requests ADD COLUMN completed_at TEXT')
if (!requestColumns.includes('cancelled_reason')) db.exec('ALTER TABLE requests ADD COLUMN cancelled_reason TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_plate_asset ON requests(plate_asset_id)')
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map(x => x.name)
if (!taskColumns.includes('owner')) db.exec("ALTER TABLE tasks ADD COLUMN owner TEXT NOT NULL DEFAULT 'us'")
if (!taskColumns.includes('documents_json')) db.exec("ALTER TABLE tasks ADD COLUMN documents_json TEXT NOT NULL DEFAULT '[]'")
if (!taskColumns.includes('completed_by')) db.exec('ALTER TABLE tasks ADD COLUMN completed_by TEXT')
if (!taskColumns.includes('completed_at')) db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT')
if (!taskColumns.includes('sort')) db.exec('ALTER TABLE tasks ADD COLUMN sort INTEGER NOT NULL DEFAULT 0')
const userColumnNames = db.prepare('PRAGMA table_info(users)').all().map(x => x.name)
if (!userColumnNames.includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
if (!userColumnNames.includes('last_login_at')) db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT')
db.exec(`CREATE TABLE IF NOT EXISTS work_templates(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  route TEXT NOT NULL,
  name TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, service_code, route, name)
);
CREATE INDEX IF NOT EXISTS idx_work_templates_tenant ON work_templates(tenant_id, active, sort);
CREATE INDEX IF NOT EXISTS idx_requests_assignee ON requests(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sort ON tasks(request_id, sort);`)

const workOrdersMigration = 'work-orders-v1'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(workOrdersMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("UPDATE requests SET status=CASE WHEN status='已完成' THEN '已完成' WHEN status='新要求' THEN '待開始' ELSE '進行中' END")
    db.exec("UPDATE tasks SET owner='client',status='待辦' WHERE status='待客戶配合'")
    db.exec("UPDATE requests SET priority='normal' WHERE priority IS NULL OR priority NOT IN ('normal','urgent')")
    db.exec("UPDATE tasks SET owner='us' WHERE owner IS NULL OR owner NOT IN ('us','client')")
    db.exec("UPDATE tasks SET documents_json='[]' WHERE documents_json IS NULL OR TRIM(documents_json)=''")
    db.exec("UPDATE tasks SET sort=rowid WHERE sort IS NULL OR sort=0")
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(workOrdersMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// Phase 1: tenants, company groups and configurable expiry rules (docs/phase1-design.md).
db.exec(`CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS company_groups(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, name TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, group_id TEXT, jurisdiction TEXT NOT NULL, name TEXT NOT NULL, registration_no TEXT, incorporated_on TEXT, taxpayer_type TEXT, notes TEXT, status TEXT NOT NULL DEFAULT '存續', status_changed_on TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(group_id) REFERENCES company_groups(id));
CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, scope TEXT NOT NULL, method TEXT NOT NULL, match_json TEXT NOT NULL DEFAULT '{}', params_json TEXT NOT NULL DEFAULT '{}', remind_days INTEGER NOT NULL DEFAULT 30, active INTEGER NOT NULL DEFAULT 1, customer_visible INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, UNIQUE(tenant_id,code));
CREATE TABLE IF NOT EXISTS tracked_items(tenant_id TEXT NOT NULL, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, code TEXT NOT NULL, expires_on TEXT, notes TEXT, updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(owner_type,owner_id,code));
CREATE TABLE IF NOT EXISTS rule_completions(tenant_id TEXT NOT NULL, code TEXT NOT NULL, owner_id TEXT NOT NULL, period TEXT NOT NULL, completed_by TEXT, completed_at TEXT NOT NULL, PRIMARY KEY(code,owner_id,period));
CREATE INDEX IF NOT EXISTS idx_company_groups_customer ON company_groups(customer_id);
CREATE INDEX IF NOT EXISTS idx_companies_group ON companies(group_id);
CREATE INDEX IF NOT EXISTS idx_tracked_items_tenant ON tracked_items(tenant_id);`)
const addColumn = (table, column, definition) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
addColumn('users', 'tenant_id', 'TEXT')
// 會話最近使用時間：閒置 7 天失效（docs/tasks/production-brief.md 第 2 節）
addColumn('sessions', 'last_seen_at', 'TEXT')
addColumn('customers', 'tenant_id', 'TEXT')
addColumn('plate_assets', 'group_id', 'TEXT REFERENCES company_groups(id)')
addColumn('plate_assets', 'indicator_category', 'TEXT')
addColumn('plate_assets', 'port', 'TEXT')
addColumn('vehicles', 'first_registered_on', 'TEXT')
// 客戶自行換車／換司機／不再續期（docs/tasks/self-handled-changes-design.md）：保留舊記錄，只停止提醒
addColumn('vehicles', 'retired_on', 'TEXT')
addColumn('vehicles', 'replaced_by', 'TEXT')
addColumn('plate_assets', 'stopped_on', 'TEXT')
addColumn('plate_assets', 'stop_reason', 'TEXT')
addColumn('companies', 'status', "TEXT NOT NULL DEFAULT '存續'")
addColumn('companies', 'status_changed_on', 'TEXT')
addColumn('companies', 'company_number', 'TEXT')
addColumn('companies', 'name_en', "TEXT NOT NULL DEFAULT ''")
const companyJurisdictionMigration = 'company-jurisdiction-fields-v1'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(companyJurisdictionMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("UPDATE companies SET taxpayer_type='' WHERE jurisdiction<>'內地' AND COALESCE(taxpayer_type,'')<>''")
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(companyJurisdictionMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
addColumn('rules', 'customer_visible', 'INTEGER NOT NULL DEFAULT 1')
addColumn('rules', 'service', 'TEXT')
// 90-day crossing reminders are opt-in per plate: many plates cross often and need no reminder.
addColumn('plate_assets', 'crossing_reminder', 'INTEGER NOT NULL DEFAULT 0')
// 客戶端補強（第 15 輪）：顧問聯絡、手機號碼登入、微信綁定、上傳文件、站內通知
addColumn('customers', 'advisor_name', 'TEXT')
addColumn('customers', 'advisor_phone', 'TEXT')
addColumn('customers', 'advisor_wechat', 'TEXT')
addColumn('users', 'phone', 'TEXT')
addColumn('users', 'wechat_openid', 'TEXT')
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone<>'';
CREATE UNIQUE INDEX IF NOT EXISTS users_openid_unique ON users(wechat_openid) WHERE wechat_openid IS NOT NULL;
CREATE TABLE IF NOT EXISTS wechat_bind_codes(code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS request_attachments(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, task_id TEXT, uploaded_by TEXT, file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, status TEXT NOT NULL DEFAULT '待確認', review_note TEXT, reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, dedupe_key TEXT, read_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(customer_id, dedupe_key) WHERE dedupe_key IS NOT NULL`)
addColumn('customers', 'is_self', 'INTEGER NOT NULL DEFAULT 0')
// 自管／托管（docs/requirements.md 5.6.2，2026-10-18）：由管理者人手切換；現有客戶都是托管
addColumn('customers', 'service_mode', "TEXT NOT NULL DEFAULT '托管'")
addColumn('customers', 'mode_since', 'TEXT')
addColumn('customers', 'mode_by', 'TEXT')
addColumn('customers', 'contract_ends_on', 'TEXT')
// Per-customer item list (docs/tasks/scope-items-design.md §2): 0 = every active item; 1 = the rows in customer_items.
addColumn('customers', 'items_customized', 'INTEGER NOT NULL DEFAULT 0')
addColumn('customers', 'scope_template', 'TEXT')
addColumn('rules', 'item_group', 'TEXT')
// Entrustment per company / plate and service, with history: a change ends the current row and adds a new one.
db.exec(`CREATE TABLE IF NOT EXISTS service_scopes(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, service TEXT NOT NULL, handler TEXT NOT NULL, provider_name TEXT, started_on TEXT NOT NULL, ended_on TEXT, notes TEXT, updated_by TEXT, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS service_scopes_current ON service_scopes(owner_type, owner_id, service) WHERE ended_on IS NULL;
CREATE TABLE IF NOT EXISTS customer_items(customer_id TEXT NOT NULL, tenant_id TEXT NOT NULL, item_code TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL, PRIMARY KEY(customer_id, item_code));
CREATE TABLE IF NOT EXISTS plate_transfers(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plate_asset_id TEXT NOT NULL, from_customer_id TEXT NOT NULL, to_customer_id TEXT NOT NULL, transferred_on TEXT NOT NULL, notes TEXT, created_by TEXT, created_at TEXT NOT NULL)`)
// Border crossings per plate (two-way plates must cross about every 90 days); kept on the plate so a vehicle change does not reset it.
db.exec('CREATE TABLE IF NOT EXISTS plate_crossings(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plate_asset_id TEXT NOT NULL, crossed_on TEXT NOT NULL, source TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, UNIQUE(plate_asset_id,crossed_on), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id))')
const companyStatusMigration = 'company-status-fields'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(companyStatusMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("UPDATE companies SET status='存續' WHERE status IS NULL OR TRIM(status)=''")
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(companyStatusMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id)')
const customerVisibleMigration = 'rules-customer-visible'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(customerVisibleMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("UPDATE rules SET customer_visible=CASE WHEN code='cn_status_check' THEN 0 ELSE customer_visible END")
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(customerVisibleMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export const DEFAULT_TENANT = 'default'
if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(DEFAULT_TENANT)) db.prepare('INSERT INTO tenants VALUES (?,?,?)').run(DEFAULT_TENANT, process.env.DEFAULT_TENANT_NAME || '本公司', new Date().toISOString())
db.prepare('UPDATE users SET tenant_id=? WHERE tenant_id IS NULL').run(DEFAULT_TENANT)
db.prepare('UPDATE customers SET tenant_id=? WHERE tenant_id IS NULL').run(DEFAULT_TENANT)
// Every tenant gets any default rule it does not have yet; edited rules are left alone.
export function seedRules(tenantId) {
  defaultRules.forEach((rule, index) => db.prepare('INSERT OR IGNORE INTO rules(id,tenant_id,code,name,scope,method,match_json,params_json,remind_days,active,customer_visible,sort,service,item_group) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), tenantId, rule.code, rule.name, rule.scope, rule.method, JSON.stringify(rule.match), JSON.stringify(rule.params), rule.remindDays, rule.active === false ? 0 : 1, Number(rule.customerVisible), index, rule.service, rule.group || defaultGroup(rule.scope)))
  for (const rule of defaultRules) db.prepare('UPDATE rules SET item_group=? WHERE tenant_id=? AND code=? AND item_group IS NULL').run(rule.group || defaultGroup(rule.scope), tenantId, rule.code)
  for (const scope of ruleScopes) db.prepare('UPDATE rules SET item_group=? WHERE tenant_id=? AND scope=? AND item_group IS NULL').run(defaultGroup(scope), tenantId, scope)
  // Rules created before services existed take the default service of their code, or of their scope.
  for (const rule of defaultRules) db.prepare('UPDATE rules SET service=? WHERE tenant_id=? AND code=? AND service IS NULL').run(rule.service, tenantId, rule.code)
  db.prepare("UPDATE rules SET service=CASE scope WHEN 'company' THEN 'company_upkeep' ELSE 'plate_service' END WHERE tenant_id=? AND service IS NULL").run(tenantId)
  // The 90-day rule became opt-in after release; tenants seeded before keep their edits but gain the condition.
  db.prepare("UPDATE rules SET match_json=? WHERE tenant_id=? AND code='crossing_90' AND match_json='{}'").run(JSON.stringify({ crossingReminder: 1 }), tenantId)
  ensureSelfCustomer(tenantId)
  ensureWorkTemplates(tenantId)
}
// Every tenant has exactly one built-in 「本公司（自有）」 customer for its own indicators.
export function ensureSelfCustomer(tenantId) {
  if (db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get(tenantId)) return
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,is_self) VALUES (?,?,?,?,1)').run(randomUUID(), '本公司（自有）', '公司', tenantId)
}
export function ensureWorkTemplates(tenantId) {
  for (const service of services) for (const route of service.routes) {
    if (db.prepare('SELECT id FROM work_templates WHERE tenant_id=? AND service_code=? AND route=? AND name=?').get(tenantId, service.code, route, service.name)) continue
    const plan = planFor(service, route)
    const steps = plan.stages.map((title, index) => ({ title, owner: 'us', documents: [], days: null, sourceId: plan.sourceIds[index] || null }))
    db.prepare('INSERT INTO work_templates(id,tenant_id,service_code,route,name,steps_json,active,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)')
      .run(randomUUID(), tenantId, service.code, route, service.name, JSON.stringify(steps), service.routes.indexOf(route), new Date().toISOString(), new Date().toISOString())
  }
}
for (const tenant of db.prepare('SELECT id FROM tenants').all()) seedRules(tenant.id)
// Entrustment moves from six broad services to one row per item (rule code), docs/tasks/scope-items-design.md §7.
// Each current broad row becomes rows for the items under it that apply to the owner, keeping handler, provider and
// start date; the broad row is ended so it stays as history. Customers keep the default list, so nothing disappears.
const scopeItemsMigration = 'scope-items-v1'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(scopeItemsMigration)) {
  const legacy = ['company_upkeep', 'bookkeeping', 'audit_tax', 'secretary', 'plate_service', 'rental_management']
  const jurisdictions = rule => { const value = JSON.parse(rule.match_json).jurisdiction; return value ? [].concat(value) : null }
  db.exec('BEGIN IMMEDIATE')
  try {
    const day = new Date().toISOString().slice(0, 10), stamp = new Date().toISOString()
    db.exec("UPDATE rules SET active=0 WHERE code='hk_audit_tax'")
    const rows = db.prepare(`SELECT * FROM service_scopes WHERE ended_on IS NULL AND service IN (${legacy.map(() => '?').join(',')})`).all(...legacy)
    for (const row of rows) {
      const rules = db.prepare('SELECT * FROM rules WHERE tenant_id=? AND service=?').all(row.tenant_id, row.service)
      let codes = []
      if (row.owner_type === 'company') {
        const company = db.prepare('SELECT jurisdiction FROM companies WHERE id=?').get(row.owner_id)
        if (company) {
          codes = rules.filter(rule => rule.scope === 'company' && (!jurisdictions(rule) || jurisdictions(rule).includes(company.jurisdiction))).map(rule => rule.code)
          if (row.service === 'bookkeeping' && company.jurisdiction === '內地') codes.push('monthly_filing')
        }
      } else {
        codes = rules.filter(rule => rule.scope !== 'company').map(rule => rule.code)
        if (row.service === 'rental_management') codes.push('rent_overdue')
      }
      for (const code of codes) {
        if (db.prepare('SELECT id FROM service_scopes WHERE owner_type=? AND owner_id=? AND service=? AND ended_on IS NULL').get(row.owner_type, row.owner_id, code)) continue
        db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,provider_name,started_on,ended_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)')
          .run(randomUUID(), row.tenant_id, row.owner_type, row.owner_id, code, row.handler, row.provider_name || '', row.started_on, '由大項改為逐件設定', row.updated_by, stamp)
      }
      db.prepare('UPDATE service_scopes SET ended_on=?, updated_at=? WHERE id=?').run(day, stamp, row.id)
    }
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(scopeItemsMigration, stamp)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
// 澳門車輛定期檢驗是新的預設事項：已固定自己清單的客戶也加上（同規則頁「加到所有客戶的事項清單」）。
// 行車稅只提醒客戶，不在清單上（rules.js clientOnlyItems）。
const macauVehicleRulesMigration = 'macau-vehicle-rules-v1'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(macauVehicleRulesMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const stamp = new Date().toISOString()
    db.prepare("INSERT OR IGNORE INTO customer_items(customer_id,tenant_id,item_code,added_by,added_at) SELECT c.id, c.tenant_id, 'mo_inspection', NULL, ? FROM customers c WHERE c.items_customized=1 AND EXISTS (SELECT 1 FROM rules r WHERE r.tenant_id=c.tenant_id AND r.code='mo_inspection' AND r.active=1)").run(stamp)
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(macauVehicleRulesMigration, stamp)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
const approvalRuleMigration = 'approval-rule-card-expires-on'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(approvalRuleMigration)) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE rules SET params_json=? WHERE code='approval' AND params_json='{}'").run(JSON.stringify({ field: 'cardExpiresOn' }))
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(approvalRuleMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const credentialMigration = 'credentials-to-expiry-v1'
function migrateCredentials() {
  if (db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(credentialMigration)) return
  db.exec('BEGIN IMMEDIATE')
  try {
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    const credentials = db.prepare('SELECT c.*,v.customer_id FROM credentials c JOIN vehicles v ON v.id=c.vehicle_id ORDER BY c.id').all()
    for (const credential of credentials) {
      const name = String(credential.name || '')
      const code = name.includes('封閉道路通行許可證') ? 'hk_crp' : name.includes('澳門') && name.includes('通行證') ? 'mo_permit' : null
      if (name.includes('批文')) continue
      const route = code === 'hk_crp' ? '粵港' : '粵澳'
      const plates = code ? db.prepare('SELECT id FROM plate_assets WHERE vehicle_id=? AND customer_id=? AND route=?').all(credential.vehicle_id, credential.customer_id, route) : []
      if (code && plates.length === 1 && valid(credential.expires_on)) {
        const tenant = db.prepare('SELECT tenant_id FROM customers WHERE id=?').get(credential.customer_id)?.tenant_id
        if (tenant && db.prepare('INSERT OR IGNORE INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_at) VALUES (?,?,?,?,?,?,?)').run(tenant, 'plate', plates[0].id, code, credential.expires_on, `舊資料遷移：${name}`, new Date().toISOString()).changes) continue
      }
      const note = `舊牌證資料：${name}${credential.issuer ? `；簽發機關：${credential.issuer}` : ''}${credential.number ? `；編號：${credential.number}` : ''}${credential.expires_on ? `；有效期：${credential.expires_on}` : ''}`
      db.prepare("UPDATE vehicles SET notes=COALESCE(NULLIF(notes,''),'') || CASE WHEN COALESCE(notes,'')='' THEN '' ELSE CHAR(10) END || ? WHERE id=?").run(note, credential.vehicle_id)
    }
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(credentialMigration, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const id = () => randomUUID()
export const now = () => new Date().toISOString()
export function hashPassword(password) { const salt = randomUUID(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
export function verifyPassword(password, stored) { const [salt, hex] = stored.split(':'); if (!salt || !hex) return false; const expected = Buffer.from(hex, 'hex'); const got = scryptSync(password, salt, expected.length); return timingSafeEqual(expected, got) }

if (process.env.DEMO_SEED === '1' && db.prepare('SELECT COUNT(*) count FROM users').get().count === 0) {
  const adminId = id(), customerId = id(), customerUserId = id(), vehicleId = id(), requestId = id()
  db.prepare('INSERT INTO customers(id,name,kind,phone,owner_id,notes,tenant_id) VALUES (?,?,?,?,?,?,?)').run(customerId, '示範客戶 · 陳先生', '個人', '13800000000', adminId, '僅供本機演示', DEFAULT_TENANT)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)').run(adminId, 'admin', '代辦主管', 'admin@demo.local', hashPassword('AdminDemo123!'), null, 'admin', DEFAULT_TENANT)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(customerUserId, 'customer', '陳先生', 'customer@demo.local', hashPassword('CustomerDemo123!'), customerId, DEFAULT_TENANT)
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,brand,model,vin,manufactured_year,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(vehicleId, customerId, '粵港', '香港', '私家車', '粵Z·示範港', 'Toyota', 'Alphard', 'DEMO-VIN-001', 2020, '演示資料，並非真實車輛')
  db.prepare('INSERT INTO credentials VALUES (?,?,?,?,?,?,?,?)').run(id(), vehicleId, '廣東批文卡', '廣東省公安廳', 'DEMO-001', '2027-01-20', '待核對', 'GD-WEB-2026')
  db.prepare('INSERT INTO credentials VALUES (?,?,?,?,?,?,?,?)').run(id(), vehicleId, '香港封閉道路通行許可證', '香港運輸署', 'DEMO-CRP', '2027-02-12', '待核對', 'HK-CRP')
  db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,service_code,route,title,description,status,stage,assignee_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, customerId, vehicleId, 'renewal', '粵港', '批文卡及香港許可證續期', '示範案件', '待收件', '官方材料收集', adminId, now(), now())
  db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), requestId, adminId, 'created', '示範案件已建立', now())
  for (const [title, jurisdiction, sourceId] of [
    ['各證件有效期核對', '通用', null],
    ['內地指標延期適用性核對', '內地', 'GD-WEB-2026'],
    ['內地延期辦理與回執', '內地', 'GD-WEB-2026'],
    ['香港 TD547 續期材料與提交', '香港', 'HK-CRP'],
    ['香港 CRP 回執與新有效期核對', '香港', 'HK-CRP'],
    ['相關備案核對', '通用', null]
  ]) db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,source_id,due_on,notes,sort) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), requestId, title, jurisdiction, '待辦', sourceId, null, null, db.prepare('SELECT COUNT(*) count FROM tasks WHERE request_id=?').get(requestId).count)
}
migrateCredentials()
