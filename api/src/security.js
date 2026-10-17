import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { db, id, now, hashPassword, verifyPassword } from './db.js'
import { seal, unseal, vaultReady } from './password-vault.js'

// 上線準備（docs/tasks/production-brief.md）：登入鎖定、會話期限、修改密碼、操作記錄、錯誤記錄、健康檢查。
db.exec(`CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, user_name TEXT, role TEXT, method TEXT NOT NULL, path TEXT NOT NULL, entity TEXT, entity_id TEXT, summary_json TEXT, ip TEXT, status INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at);`)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '0.0.0'
const DAY = 86400000
export const SESSION_DAYS = 30, IDLE_DAYS = 7, MAX_FAILURES = 5, LOCK_MINUTES = 15

// ── 會話：30 天到期；閒置 7 天失效 ──
export function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, userId, new Date(Date.now() + SESSION_DAYS * DAY).toISOString(), now())
  return token
}
export function authenticate(token) {
  if (!token) return null
  const row = db.prepare('SELECT s.token, s.last_seen_at, u.id,u.role,u.name,u.email,u.customer_id,u.tenant_id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1').get(token, now())
  if (!row) return null
  if (row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) > IDLE_DAYS * DAY) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null }
  // 最多每 5 分鐘寫一次最近使用時間，避免每個請求都寫入
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 5 * 60000) db.prepare('UPDATE sessions SET last_seen_at=? WHERE token=?').run(now(), token)
  const { token: _token, last_seen_at: _seen, ...user } = row
  return user
}

// ── 登入失敗鎖定：同一帳號或同一 IP 失敗 5 次，鎖 15 分鐘 ──
export const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
const keysFor = (kind, login, ip) => [`${kind}:${String(login || '').toLowerCase()}`, `ip:${ip}`]
export function lockedMinutes(kind, login, ip) {
  const until = keysFor(kind, login, ip).map(key => db.prepare('SELECT locked_until FROM login_attempts WHERE key=?').get(key)?.locked_until).filter(value => value && value > now()).sort().at(-1)
  return until ? Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60000)) : 0
}
export function recordFailure(kind, login, ip) {
  for (const key of keysFor(kind, login, ip)) {
    const row = db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key)
    const failures = (row && (!row.locked_until || row.locked_until > now() || row.failures < MAX_FAILURES) ? row.failures : 0) + 1
    const locked = failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null
    db.prepare('INSERT INTO login_attempts(key,failures,locked_until,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, locked_until=excluded.locked_until, updated_at=excluded.updated_at').run(key, locked ? 0 : failures, locked, now())
  }
}
export function clearFailures(kind, login) { db.prepare('DELETE FROM login_attempts WHERE key=?').run(`${kind}:${String(login || '').toLowerCase()}`) }

// ── 客戶登入手機：一律存「+區號號碼」；香港 +852、澳門 +853 為 8 位，內地 +86 為 1 字頭 11 位 ──
export const PHONE_RULE = '手機號碼格式無效（香港、澳門 8 位，內地 11 位）'
export function loginPhone(value) {
  const phone = String(value ?? '').replace(/[\s-]/g, '')
  return /^\+(?:85[23]\d{8}|861\d{10})$/.test(phone) ? phone : ''
}

// ── 密碼規則：至少 10 位，不可與帳號、電郵、手機號碼相同 ──
export function passwordProblem(password, account = {}) {
  if (typeof password !== 'string' || password.length < 10) return '密碼至少 10 個字元'
  const lower = password.toLowerCase()
  for (const value of [account.username, account.email, account.phone, String(account.email || '').split('@')[0]]) if (value && lower === String(value).toLowerCase()) return '密碼不可與帳號、電郵或手機號碼相同'
  return null
}

// ── 操作記錄：所有成功的修改請求（敏感欄位與檔案內容遮蔽） ──
const sensitive = /password|hkid|returnpermit|token|secret|^data$|^proof$|^code$|bindcode/i
function mask(value, depth = 0) {
  if (Array.isArray(value)) return value.slice(0, 20).map(item => mask(item, depth + 1))
  if (value && typeof value === 'object' && depth < 4) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '（已遮蔽）' : mask(item, depth + 1)]))
  return typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value
}
const entityOf = path => { const parts = path.replace(/^\/api\//, '').split('/'); const entity = parts[0] === 'my' ? `my/${parts[1] || ''}` : parts[0]; return { entity, entityId: parts.find((part, index) => index > 0 && /^[0-9a-f-]{20,}$/i.test(part)) || null } }
export function audit(req, res, user, path) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !path.startsWith('/api/')) return
  const end = res.end
  res.end = function (...args) {
    const result = end.apply(this, args)
    const status = this.statusCode ?? this.status
    if (status >= 400) return result
    try {
      const { entity, entityId } = entityOf(path)
      db.prepare('INSERT INTO audit_logs(id,tenant_id,user_id,user_name,role,method,path,entity,entity_id,summary_json,ip,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id(), user?.tenant_id || null, user?.id || null, user?.name || null, user?.role || null, req.method, path, entity, entityId, JSON.stringify(mask(req.parsedBody ?? null)), clientIp(req), status ?? null, now())
    } catch (error) { logError(error, { where: 'audit', path }) }
    return result
  }
}
const entityLabels = { customers: '客戶', companies: '公司', 'company-groups': '公司組', 'plate-assets': '牌照', plates: '牌照', vehicles: '車輛', 'tracked-items': '到期日', 'service-scopes': '委託範圍', 'plate-transfers': '轉讓', requests: '工單', 'work-orders': '工單', tasks: '工單步驟', fees: '收費', 'rental-contracts': '出租合約', 'rent-invoices': '租金', reports: '月報', filings: '報帳', 'accounting-firms': '會計公司', drivers: '司機', staff: '員工', 'customer-users': '客戶帳號', me: '本人帳號', rules: '到期規則', 'rule-completions': '完成記錄', quotes: '報價', 'installment-plans': '分期' }
// 操作名稱：路徑最後一段是動作時用動作名，否則按方法
const actionWords = { confirm: '確認', recalculate: '重算', correct: '產生更正版', send: '發出', accept: '接受', terminate: '終止', receive: '登記收款', unreceive: '撤銷收款', void: '作廢', payments: '記收款', 'password-view': '查看密碼', 'reset-password': '重設密碼', link: '產生連結', attachments: '上傳文件', receipt: '上傳回執', 'wechat-bind-code': '產生綁定碼', 'sync-from-card': '按批文卡同步', crossings: '記錄過關', 'crossing-reminder': '過關提醒設定', password: '修改密碼', billing: '年費設定', advisor: '顧問設定', 'filing-setup': '報帳設定', batch: '批量設定', bulk: '批量更新', login: '登入' }
function actionOf(row) {
  const parts = row.path.replace(/^\/api\//, '').split('/').filter(part => !/^[0-9a-f-]{20,}$/i.test(part))
  const tail = parts.length > 1 ? parts.at(-1) : null
  if (tail && actionWords[tail]) return row.method === 'DELETE' && tail === 'link' ? '作廢連結' : actionWords[tail]
  return { POST: '新增', PATCH: '修改', PUT: '設定', DELETE: '刪除' }[row.method] || row.method
}
export function auditRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname
  if (path === '/api/audit-logs') {
    if (user.role !== 'admin') return fail(res, 403, '操作記錄只限管理者'), true
    if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const { entity, userId, from, to } = Object.fromEntries(url.searchParams)
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200)
    const rows = db.prepare(`SELECT * FROM audit_logs WHERE tenant_id=? ${entity ? 'AND entity=?' : ''} ${userId ? 'AND user_id=?' : ''} ${from ? 'AND created_at>=?' : ''} ${to ? 'AND created_at<?' : ''} ORDER BY created_at DESC LIMIT ?`).all(user.tenant_id, ...[entity, userId, from, to].filter(Boolean), limit)
    return json(res, 200, rows.map(row => ({ id: row.id, userId: row.user_id, userName: row.user_name || '', role: row.role, action: actionOf(row), method: row.method, path: row.path, entity: row.entity, entityLabel: entityLabels[row.entity] || row.entity, entityId: row.entity_id, summary: JSON.parse(row.summary_json || 'null'), ip: row.ip, createdAt: row.created_at }))), true
  }
  // 公司資料：名稱用在報價單等對外文件
  if (path === '/api/tenant') {
    if (req.method === 'GET') return json(res, 200, { name: db.prepare('SELECT name FROM tenants WHERE id=?').get(user.tenant_id)?.name || '' }), true
    if (user.role !== 'admin') return fail(res, 403, '只有管理者可修改公司資料'), true
    if (req.method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    return (async () => {
      const body = await parseBody(req)
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
      if (!name) return fail(res, 400, '請填寫公司名稱'), true
      db.prepare('UPDATE tenants SET name=? WHERE id=?').run(name, user.tenant_id)
      return json(res, 200, { name }), true
    })()
  }
  if (path === '/api/me/password') {
    if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
    return (async () => {
      const body = await parseBody(req)
      const account = db.prepare('SELECT * FROM users WHERE id=?').get(user.id)
      if (!body || typeof body !== 'object' || !verifyPassword(String(body.currentPassword || ''), account.password_hash)) return fail(res, 400, '目前密碼不正確'), true
      const problem = passwordProblem(body.newPassword, account); if (problem) return fail(res, 400, problem), true
      if (verifyPassword(body.newPassword, account.password_hash)) return fail(res, 400, '新密碼不可與目前密碼相同'), true
      // 客戶帳號同時更新加密副本，管理者才看得到新密碼
      db.prepare('UPDATE users SET password_hash=?, password_enc=? WHERE id=?').run(hashPassword(body.newPassword), account.role === 'customer' ? seal(body.newPassword) : null, account.id)
      // 改密碼後，其他裝置的登入全部失效，目前這個保留
      const current = (req.headers.authorization || '').replace(/^Bearer /, '')
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(account.id, current)
      return json(res, 200, { ok: true }), true
    })()
  }
  // 管理者查看客戶密碼（2026-10-18 管理者決定）：用 POST 以便每次查看都寫入操作記錄（查看人、時間、帳號）
  const view = path.match(/^\/api\/customer-users\/([^/]+)\/password-view$/)
  if (view) {
    if (user.role !== 'admin') return fail(res, 403, '只限管理者查看客戶密碼'), true
    if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const account = db.prepare("SELECT u.* FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.id=? AND u.role='customer' AND c.tenant_id=?").get(view[1], user.tenant_id)
    if (!account) return fail(res, 404, '客戶帳號不存在'), true
    const password = unseal(account.password_enc)
    if (password) return json(res, 200, { password }), true
    return json(res, 200, { password: null, reason: !vaultReady() ? '伺服器未設定密碼查看金鑰，暫時無法查看' : account.password_enc ? '密碼副本無法解開（金鑰已更換），請重設密碼' : '這個密碼在功能上線前設定，無法還原；重設密碼後就看得到' }), true
  }
  const reset = path.match(/^\/api\/customer-users\/([^/]+)\/reset-password$/)
  if (reset) {
    if (user.role !== 'admin') return fail(res, 403, '無權限'), true
    if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
    return (async () => {
      const account = db.prepare("SELECT u.* FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.id=? AND u.role='customer' AND c.tenant_id=?").get(reset[1], user.tenant_id)
      if (!account) return fail(res, 404, '客戶帳號不存在'), true
      const body = await parseBody(req)
      const problem = passwordProblem(body?.password, account); if (problem) return fail(res, 400, problem), true
      db.prepare('UPDATE users SET password_hash=?, password_enc=? WHERE id=?').run(hashPassword(body.password), seal(body.password), account.id)
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id)
      if (account.email) clearFailures('customer', account.email)
      if (account.phone) clearFailures('customer', account.phone)
      return json(res, 200, { ok: true }), true
    })()
  }
  return false
}

// ── 錯誤記錄：按日寫入 logs/，不把細節回傳給前端 ──
const logDir = () => process.env.LOG_DIR || join(root, 'logs')
export function logError(error, context = {}) {
  try {
    mkdirSync(logDir(), { recursive: true })
    appendFileSync(join(logDir(), `${new Date().toISOString().slice(0, 10)}.log`), `${JSON.stringify({ at: now(), ...context, message: error?.message, stack: error?.stack })}\n`)
  } catch { /* 寫不到記錄檔時不影響回應 */ }
  if (process.env.NODE_ENV !== 'test') console.error(error)
}
export function health() {
  try { db.prepare('SELECT COUNT(*) count FROM tenants').get(); return { ok: true, version, database: 'ok' } } catch { return { ok: false, version, database: 'error' } }
}
