import { db, id, now, hashPassword, seedRules } from './db.js'

const tenantName = String(process.env.TENANT_NAME || '').trim()
const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase()
const adminName = String(process.env.ADMIN_NAME || '').trim()
const password = String(process.env.ADMIN_PASSWORD || '')
if (!tenantName || !/^[a-z][a-z0-9._-]{2,31}$/.test(username) || !adminName || password.length < 8) {
  console.error('請設定 TENANT_NAME、ADMIN_USERNAME（3–32 位，英文字母開頭）、ADMIN_NAME 和最少 8 字元的 ADMIN_PASSWORD')
  process.exit(1)
}
if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) {
  console.error('此管理員帳號已存在')
  process.exit(1)
}
const tenantId = id()
db.exec('BEGIN IMMEDIATE')
try {
  db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run(tenantId, tenantName, now())
  seedRules(tenantId)
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)').run(id(), 'admin', adminName, `admin-${id()}@internal.invalid`, hashPassword(password), null, username, tenantId)
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }
console.log(`租戶及管理員已建立：${tenantName} · ${username}`)
