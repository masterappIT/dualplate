import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const projectRoot = new URL('../', import.meta.url)
const databaseExists = (db, name) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
const launchDatabase = databasePath => spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'"], {
  cwd: projectRoot,
  env: { ...process.env, DB_PATH: databasePath, DEMO_SEED: '0' },
  encoding: 'utf8'
})
const createLegacyDatabase = () => {
  const directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.card-latest-only-'))
  const databasePath = join(directory, 'legacy.db')
  const db = new DatabaseSync(databasePath)
  const customerId = randomUUID()
  const plateId = randomUUID()
  const versionId = randomUUID()
  db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL);
CREATE TABLE vehicles(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, origin TEXT NOT NULL, type TEXT NOT NULL, plate TEXT NOT NULL);
CREATE TABLE plate_assets(id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, route TEXT NOT NULL, mainland_plate TEXT, local_plate TEXT, vehicle_id TEXT, installation_status TEXT NOT NULL DEFAULT '待核對', usage_status TEXT NOT NULL DEFAULT '待核對', card_number TEXT, card_expires_on TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, card_data TEXT NOT NULL DEFAULT '{}', card_status TEXT NOT NULL DEFAULT '待核對', card_updated_by TEXT, card_updated_at TEXT);
CREATE TABLE approval_card_images(plate_asset_id TEXT NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(plate_asset_id,side), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE approval_card_versions(id TEXT PRIMARY KEY, plate_asset_id TEXT NOT NULL, version_number INTEGER NOT NULL, card_data TEXT NOT NULL, card_status TEXT NOT NULL, updated_by TEXT, created_at TEXT NOT NULL, source TEXT NOT NULL, UNIQUE(plate_asset_id,version_number), FOREIGN KEY(plate_asset_id) REFERENCES plate_assets(id));
CREATE TABLE approval_card_version_images(version_id TEXT NOT NULL, side TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(version_id,side), FOREIGN KEY(version_id) REFERENCES approval_card_versions(id));
CREATE INDEX idx_card_versions_asset ON approval_card_versions(plate_asset_id,version_number DESC);`)
  db.prepare('INSERT INTO customers(id,name,kind) VALUES (?,?,?)').run(customerId, '舊資料客戶', '公司')
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at,card_data,card_status,card_updated_by,card_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(plateId, customerId, '粵港', 'CURRENT-001', new Date().toISOString(), new Date().toISOString(), JSON.stringify({ cardNumber: 'CURRENT-001', company: '目前卡面' }), '已核對', '專員', new Date().toISOString())
  db.prepare('INSERT INTO approval_card_images VALUES (?,?,?,?)').run(plateId, 'front', 'image/png', Buffer.from('current-original'))
  db.prepare('INSERT INTO approval_card_versions VALUES (?,?,?,?,?,?,?,?)').run(versionId, plateId, 1, JSON.stringify({ cardNumber: 'OLD-001' }), '待核對', '舊專員', new Date().toISOString(), '舊版')
  db.prepare('INSERT INTO approval_card_version_images VALUES (?,?,?,?)').run(versionId, 'front', 'image/png', Buffer.from('old-original'))
  db.close()
  return { directory, databasePath, plateId }
}

test('舊版本資料庫遷移清除版本資料並保留目前卡面與原件', () => {
  const legacy = createLegacyDatabase()
  try {
    const result = launchDatabase(legacy.databasePath)
    assert.equal(result.status, 0, result.stderr)
    const db = new DatabaseSync(legacy.databasePath)
    assert.equal(databaseExists(db, 'approval_card_versions'), undefined)
    assert.equal(databaseExists(db, 'approval_card_version_images'), undefined)
    assert.ok(databaseExists(db, 'approval_card_images'))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM approval_card_images WHERE plate_asset_id=?').get(legacy.plateId).count, 1)
    assert.equal(Buffer.from(db.prepare('SELECT data FROM approval_card_images WHERE plate_asset_id=? AND side=?').get(legacy.plateId, 'front').data).toString(), 'current-original')
    const plate = db.prepare('SELECT card_data,card_status,card_updated_by,card_updated_at FROM plate_assets WHERE id=?').get(legacy.plateId)
    assert.equal(JSON.parse(plate.card_data).company, '目前卡面')
    assert.equal(plate.card_status, '已核對')
    assert.equal(plate.card_updated_by, '專員')
    assert.ok(plate.card_updated_at)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE name=?').get('card-latest-only').count, 1)
    db.close()
  } finally {
    rmSync(legacy.directory, { recursive: true, force: true })
  }
})

test('批文卡最新版遷移只執行一次', () => {
  const legacy = createLegacyDatabase()
  try {
    const first = launchDatabase(legacy.databasePath)
    assert.equal(first.status, 0, first.stderr)
    let db = new DatabaseSync(legacy.databasePath)
    db.exec('CREATE TABLE approval_card_versions(id TEXT PRIMARY KEY)')
    db.close()
    const second = launchDatabase(legacy.databasePath)
    assert.equal(second.status, 0, second.stderr)
    db = new DatabaseSync(legacy.databasePath)
    assert.ok(databaseExists(db, 'approval_card_versions'))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE name=?').get('card-latest-only').count, 1)
    db.close()
  } finally {
    rmSync(legacy.directory, { recursive: true, force: true })
  }
})
