import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

const file = resolve(process.env.DB_PATH || './data/app.sqlite')
mkdirSync(dirname(file), { recursive: true })
export const db = new DatabaseSync(file)
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, customer_id TEXT, username TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT, owner_id TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS vehicles(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, origin TEXT NOT NULL, type TEXT NOT NULL, plate TEXT NOT NULL, brand TEXT, model TEXT, vin TEXT, manufactured_year INTEGER, notes TEXT);
CREATE TABLE IF NOT EXISTS plate_assets(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, mainland_plate TEXT, local_plate TEXT, vehicle_id TEXT, installation_status TEXT NOT NULL DEFAULT '待核對', usage_status TEXT NOT NULL DEFAULT '待核對', card_number TEXT, card_expires_on TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(vehicle_id) REFERENCES vehicles(id));
CREATE TABLE IF NOT EXISTS plate_rentals(id TEXT PRIMARY KEY, plate_asset_id TEXT NOT NULL, renter_name TEXT NOT NULL, renter_vehicle_plate TEXT, starts_on TEXT, ends_on TEXT, status TEXT NOT NULL DEFAULT '出租中', notes TEXT, created_at TEXT NOT NULL, FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS approval_card_images(plate_asset_id TEXT NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(plate_asset_id,side), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS approval_card_versions(id TEXT PRIMARY KEY, plate_asset_id TEXT NOT NULL, version_number INTEGER NOT NULL, card_data TEXT NOT NULL, card_status TEXT NOT NULL, updated_by TEXT, created_at TEXT NOT NULL, source TEXT NOT NULL, UNIQUE(plate_asset_id,version_number), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS approval_card_version_images(version_id TEXT NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(version_id,side), FOREIGN KEY(version_id) REFERENCES approval_card_versions(id));
CREATE TABLE IF NOT EXISTS plate_photos(plate_asset_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(plate_asset_id,kind), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT, number TEXT, expires_on TEXT, status TEXT NOT NULL DEFAULT '待核對', source_id TEXT);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, vehicle_id TEXT, service_code TEXT NOT NULL, route TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, stage TEXT NOT NULL, assignee_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, title TEXT NOT NULL, jurisdiction TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待辦', source_id TEXT, due_on TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, request_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL, appointment_on TEXT, result_on TEXT, source_id TEXT, notes TEXT);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_plate_assets_customer ON plate_assets(customer_id);
CREATE INDEX IF NOT EXISTS idx_plate_rentals_asset ON plate_rentals(plate_asset_id);
CREATE INDEX IF NOT EXISTS idx_card_versions_asset ON approval_card_versions(plate_asset_id,version_number DESC);
CREATE INDEX IF NOT EXISTS idx_credentials_vehicle ON credentials(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_request ON tasks(request_id);`)

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
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_plate_asset ON requests(plate_asset_id)')

// Preserve cards created before version history was introduced, including both scans.
const unversionedCards = db.prepare(`SELECT p.* FROM plate_assets p WHERE p.card_updated_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM approval_card_versions v WHERE v.plate_asset_id=p.id)`).all()
if (unversionedCards.length) {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const card of unversionedCards) {
      const versionId = randomUUID()
      db.prepare('INSERT INTO approval_card_versions(id,plate_asset_id,version_number,card_data,card_status,updated_by,created_at,source) VALUES (?,?,?,?,?,?,?,?)')
        .run(versionId, card.id, 1, card.card_data || '{}', card.card_status || '待核對', card.card_updated_by, card.card_updated_at, '既有版本')
      db.prepare('INSERT INTO approval_card_version_images(version_id,side,mime,data) SELECT ?,side,mime,data FROM approval_card_images WHERE plate_asset_id=?')
        .run(versionId, card.id)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export const id = () => randomUUID()
export const now = () => new Date().toISOString()
export function hashPassword(password) { const salt = randomUUID(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
export function verifyPassword(password, stored) { const [salt, hex] = stored.split(':'); if (!salt || !hex) return false; const expected = Buffer.from(hex, 'hex'); const got = scryptSync(password, salt, expected.length); return timingSafeEqual(expected, got) }

if (process.env.DEMO_SEED === '1' && db.prepare('SELECT COUNT(*) count FROM users').get().count === 0) {
  const adminId = id(), customerId = id(), customerUserId = id(), vehicleId = id(), requestId = id()
  db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(customerId, '示範客戶 · 陳先生', '個人', '13800000000', adminId, '僅供本機演示')
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,username) VALUES (?,?,?,?,?,?,?)').run(adminId, 'admin', '代辦主管', 'admin@demo.local', hashPassword('AdminDemo123!'), null, 'admin')
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id) VALUES (?,?,?,?,?,?)').run(customerUserId, 'customer', '陳先生', 'customer@demo.local', hashPassword('CustomerDemo123!'), customerId)
  db.prepare('INSERT INTO vehicles VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(vehicleId, customerId, '粵港', '香港', '私家車', '粵Z·示範港', 'Toyota', 'Alphard', 'DEMO-VIN-001', 2020, '演示資料，並非真實車輛')
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
  ]) db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run(id(), requestId, title, jurisdiction, '待辦', sourceId, null, null)
}
