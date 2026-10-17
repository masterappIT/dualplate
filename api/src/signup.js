import { randomUUID } from 'node:crypto'
import { db, hashPassword, verifyPassword, now, DEFAULT_TENANT } from './db.js'
import { seal } from './password-vault.js'
import { loginPhone, PHONE_RULE, passwordProblem } from './security.js'
import { startSelfManaged } from './service-mode.js'
import { contactView } from './support.js'

// 自管客戶自行申請（docs/requirements.md 5.6.2，2026-10-18 管理者決定）：現階段用申請審批制，短信註冊另排。
// 客戶填手機號碼、稱呼、密碼，勾選同意條款後提交；管理員先聯絡申請人確認號碼屬於本人，才批准。
// 審批中或被拒絕時，登入只顯示狀態，不能進入 app；被拒絕的申請 30 天後刪除。批准後開自管客戶和登入帳號，來源記「申請」。
db.exec(`CREATE TABLE IF NOT EXISTS signup_applications(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT NOT NULL, password_hash TEXT, password_enc TEXT, terms_version INTEGER NOT NULL, status TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decided_by_name TEXT, reject_note TEXT, customer_id TEXT);
CREATE INDEX IF NOT EXISTS idx_signup_applications_phone ON signup_applications(phone);`)

export const PENDING = '審批中', APPROVED = '已批准', REJECTED = '已拒絕'
const KEEP_REJECTED_DAYS = 30, DAILY_LIMIT_PER_IP = 5, MAX_NAME = 40, MAX_NOTE = 200
const tenantOf = () => process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString()
const latestTerms = tenantId => db.prepare('SELECT version FROM terms_versions WHERE tenant_id=? ORDER BY version DESC LIMIT 1').get(tenantId)?.version || null
export const pendingText = '申請已收到，管理員批准後即可使用'
export const rejectedText = '申請未獲批准，如有疑問請聯絡我們'

// 被拒絕的申請保留 30 天後刪除（每次用到申請資料時順帶清理）
export function purgeRejected() {
  db.prepare('DELETE FROM signup_applications WHERE status=? AND decided_at<?').run(REJECTED, daysAgo(KEEP_REJECTED_DAYS))
}

// 登入時：手機號碼沒有帳號，但有申請且密碼正確，回傳要顯示的狀態；密碼不對或沒有申請回傳 null
export function applicationLogin(login, password) {
  if (!loginPhone(login)) return null
  purgeRejected()
  const row = db.prepare('SELECT * FROM signup_applications WHERE phone=? AND status IN (?,?) ORDER BY created_at DESC LIMIT 1').get(login, PENDING, REJECTED)
  if (!row?.password_hash || !verifyPassword(String(password || ''), row.password_hash)) return null
  return row.status === PENDING ? { code: 'SIGNUP_PENDING', error: pendingText } : { code: 'SIGNUP_REJECTED', error: rejectedText }
}

// 讀出申請內容；回傳 { phone, name, password } 或 { error }
function readApplication(body, tenantId) {
  const keys = ['phone', 'name', 'password', 'acceptTerms', 'termsVersion']
  if (!isObject(body) || Object.keys(body).some(key => !keys.includes(key))) return { error: '內容無效' }
  if (['phone', 'name', 'password'].some(key => body[key] !== undefined && typeof body[key] !== 'string')) return { error: '內容無效' }
  const phone = loginPhone(body.phone)
  if (!phone) return { error: body.phone ? PHONE_RULE : '請填寫手機號碼' }
  const name = (body.name || '').trim()
  if (!name) return { error: '請填寫稱呼' }
  if (name.length > MAX_NAME) return { error: `稱呼不可超過 ${MAX_NAME} 個字` }
  const problem = passwordProblem(body.password, { phone })
  if (problem) return { error: problem }
  const version = latestTerms(tenantId)
  if (!version) return { error: '服務條款尚未發佈，暫時不能申請；請用 WhatsApp 或微信聯絡我們', status: 503 }
  if (body.acceptTerms !== true) return { error: '請先閱讀並同意服務條款及私隱聲明' }
  if (body.termsVersion !== version) return { error: '服務條款已更新，請重新閱讀後再提交', status: 409 }
  return { phone, name, password: body.password, version }
}

const applicationView = row => ({ id: row.id, phone: row.phone, name: row.name, status: row.status, createdAt: row.created_at, decidedAt: row.decided_at, decidedByName: row.decided_by_name, rejectNote: row.reject_note, customerId: row.customer_id })

// 批准：開自管客戶（同名時加上手機末 4 位）和登入帳號，沿用申請時設定的密碼，記下申請時同意的條款版本。在交易內
function approve(user, row) {
  const taken = db.prepare('SELECT 1 FROM customers WHERE tenant_id=? AND name=?').get(user.tenant_id, row.name)
  const customerId = randomUUID(), userId = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,phone,owner_id,tenant_id) VALUES (?,?,?,?,?,?)').run(customerId, taken ? `${row.name}（${row.phone.slice(-4)}）` : row.name, '個人', row.phone, user.id, user.tenant_id)
  startSelfManaged(user, customerId, '申請')
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,password_enc,customer_id,tenant_id,phone) VALUES (?,?,?,?,?,?,?,?,?)').run(userId, 'customer', row.name, `${row.phone}@phone.invalid`, row.password_hash, row.password_enc, customerId, user.tenant_id, row.phone)
  db.prepare('INSERT OR IGNORE INTO terms_acceptances(id,tenant_id,user_id,customer_id,version,accepted_at,ip) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), user.tenant_id, userId, customerId, row.terms_version, row.created_at, row.ip)
  db.prepare('UPDATE signup_applications SET status=?, decided_at=?, decided_by=?, decided_by_name=?, customer_id=?, password_hash=NULL, password_enc=NULL WHERE id=?').run(APPROVED, now(), user.id, user.name, customerId, row.id)
  return customerId
}

// 未登入：提交申請、看聯絡方式（審批中、被拒絕的畫面要顯示 WhatsApp／微信）
export async function signupPublicRoutes(req, res, url, { json, fail, parseBody, clientIp }) {
  const path = url.pathname, method = req.method
  if (path !== '/api/public/signup' && path !== '/api/public/contact') return false
  if (path === '/api/public/contact') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, contactView(tenantOf())), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const tenantId = tenantOf(), ip = clientIp(req)
  const body = await parseBody(req), input = readApplication(body, tenantId)
  if (input.error) return fail(res, input.status || 400, input.error), true
  purgeRejected()
  if (db.prepare('SELECT COUNT(*) count FROM signup_applications WHERE ip=? AND created_at>?').get(ip, daysAgo(1)).count >= DAILY_LIMIT_PER_IP) return fail(res, 429, '今天提交的申請太多，請明天再試，或用 WhatsApp、微信聯絡我們'), true
  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(input.phone)) { db.exec('ROLLBACK'); return fail(res, 409, '這個手機號碼已有帳戶，請直接登入'), true }
    const earlier = db.prepare('SELECT status FROM signup_applications WHERE phone=? AND status IN (?,?)').get(input.phone, PENDING, REJECTED)
    if (earlier) { db.exec('ROLLBACK'); return fail(res, 409, earlier.status === PENDING ? `這個手機號碼已提交申請。${pendingText}` : rejectedText), true }
    db.prepare('INSERT INTO signup_applications(id,tenant_id,phone,name,password_hash,password_enc,terms_version,status,ip,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), tenantId, input.phone, input.name, hashPassword(input.password), seal(input.password), input.version, PENDING, ip, now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 201, { status: PENDING, message: pendingText }), true
}

// 後台「註冊申請」：只限管理者
export async function signupRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const decide = path.match(/^\/api\/signup-applications\/([^/]+)\/(approve|reject)$/)
  if (path !== '/api/signup-applications' && !decide) return false
  if (user.role !== 'admin') return fail(res, 403, '無權限'), true
  purgeRejected()
  if (!decide) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const rows = db.prepare('SELECT * FROM signup_applications WHERE tenant_id=? ORDER BY CASE status WHEN ? THEN 0 ELSE 1 END, COALESCE(decided_at, created_at) DESC LIMIT 200').all(user.tenant_id, PENDING)
    return json(res, 200, rows.map(applicationView)), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  const row = db.prepare('SELECT * FROM signup_applications WHERE id=? AND tenant_id=?').get(decide[1], user.tenant_id)
  if (!row) return fail(res, 404, '申請不存在'), true
  if (decide[2] === 'approve') {
    if (Object.keys(body).some(key => key !== 'confirmed')) return fail(res, 400, '內容無效'), true
    if (body.confirmed !== true) return fail(res, 400, '請先聯絡申請人，確認手機號碼屬於本人'), true
  } else {
    if (Object.keys(body).some(key => key !== 'note') || body.note !== undefined && body.note !== null && typeof body.note !== 'string') return fail(res, 400, '內容無效'), true
    if ((body.note || '').trim().length > MAX_NOTE) return fail(res, 400, `原因不可超過 ${MAX_NOTE} 個字`), true
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const fresh = db.prepare('SELECT * FROM signup_applications WHERE id=?').get(row.id)
    if (fresh.status !== PENDING) { db.exec('ROLLBACK'); return fail(res, 409, `這份申請${fresh.status}`), true }
    if (decide[2] === 'approve') {
      if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(fresh.phone)) { db.exec('ROLLBACK'); return fail(res, 409, '這個手機號碼已有帳戶（可能已由管理員邀請），請拒絕這份申請'), true }
      approve(user, fresh)
    } else {
      // 被拒絕：保留密碼校驗值，登入時才可只向本人顯示「未獲批准」；加密副本即時刪除
      db.prepare('UPDATE signup_applications SET status=?, decided_at=?, decided_by=?, decided_by_name=?, reject_note=?, password_enc=NULL WHERE id=?').run(REJECTED, now(), user.id, user.name, (body.note || '').trim() || null, fresh.id)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, applicationView(db.prepare('SELECT * FROM signup_applications WHERE id=?').get(row.id))), true
}
