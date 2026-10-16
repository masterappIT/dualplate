import { db, id, hashPassword, DEFAULT_TENANT } from './db.js'

const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase()
const name = String(process.env.ADMIN_NAME || '').trim()
const password = String(process.env.ADMIN_PASSWORD || '')
const tenantId = process.env.TENANT_ID || DEFAULT_TENANT
if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username) || !name || password.length < 10) {
  console.error('請設定 ADMIN_USERNAME（3–32 位，英文字母開頭）、ADMIN_NAME 和最少 10 字元的 ADMIN_PASSWORD')
  process.exit(1)
}
if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) {
  console.error('此管理員帳號已存在')
  process.exit(1)
}
if (!db.prepare('SELECT id FROM tenants WHERE id=?').get(tenantId)) {
  console.error('租戶不存在')
  process.exit(1)
}
const email = `admin-${id()}@internal.invalid`
db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id) VALUES (?,?,?,?,?,?,?,?)').run(id(), 'admin', name, email, hashPassword(password), null, username, tenantId)
console.log('管理員帳號已建立：' + username)
