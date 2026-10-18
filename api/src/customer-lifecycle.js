import { db, now } from './db.js'
import { businessToday } from './rules.js'

// 結束服務（docs/tasks/customer-lifecycle-plan.md 第 3 步，管理者 2026-10-18 決定）：托管客戶不再合作時不刪除，改為結束服務。
// 結束後全部登入停用、不再產生到期提醒、年費、報帳和月報，也不出現在今日工作；客戶、牌照、公司、車輛、司機、登入和委託範圍
// 只可查看。收費、收款、報價、租金結算和已開的工單仍可處理，方便結清。可以恢復服務：只重新啟用結束時被停用的登入。
for (const [column, type] of [['ended_on', 'TEXT'], ['end_reason', 'TEXT'], ['ended_by_name', 'TEXT'], ['ended_at', 'TEXT'], ['ended_logins', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(customers)').all().some(item => item.name === column)) db.exec(`ALTER TABLE customers ADD COLUMN ${column} ${type}`)
}

const MAX_REASON = 200
export const ENDED_ERROR = '這位客戶已結束服務，資料只可查看；如需修改，請先恢復服務'
const today = () => businessToday().toISOString().slice(0, 10)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const one = (sql, ...params) => db.prepare(sql).get(...params)
const all = (sql, ...params) => db.prepare(sql).all(...params)

export const isEnded = customerId => Boolean(customerId && one('SELECT ended_on FROM customers WHERE id=?', customerId)?.ended_on)
export const endedCustomerIds = tenantId => new Set(all('SELECT id FROM customers WHERE tenant_id=? AND ended_on IS NOT NULL', tenantId).map(row => row.id))

// 修改請求指向哪位客戶的資料（只按網址判斷）；收費、報價、租金和工單不在此列，結束後仍可處理
const ownerSql = [
  [/^\/api\/customers\/([^/]+)(?:\/.*)?$/, 'SELECT id customer_id FROM customers WHERE id=?'],
  [/^\/api\/(?:plate-assets|plates)\/([^/]+)(?:\/.*)?$/, 'SELECT customer_id FROM plate_assets WHERE id=?'],
  [/^\/api\/vehicles\/([^/]+)(?:\/.*)?$/, 'SELECT customer_id FROM vehicles WHERE id=?'],
  [/^\/api\/credentials\/([^/]+)$/, 'SELECT v.customer_id FROM credentials c JOIN vehicles v ON v.id=c.vehicle_id WHERE c.id=?'],
  [/^\/api\/inspections\/([^/]+)$/, 'SELECT v.customer_id FROM inspections i JOIN vehicles v ON v.id=i.vehicle_id WHERE i.id=?'],
  [/^\/api\/companies\/([^/]+)(?:\/.*)?$/, 'SELECT customer_id FROM companies WHERE id=?'],
  [/^\/api\/company-groups\/([^/]+)$/, 'SELECT customer_id FROM company_groups WHERE id=?'],
  [/^\/api\/drivers\/([^/]+)(?:\/.*)?$/, 'SELECT customer_id FROM drivers WHERE id=?'],
  [/^\/api\/customer-users\/([^/]+)(?:\/.*)?$/, "SELECT customer_id FROM users WHERE id=? AND role='customer'"],
  [/^\/api\/plate-rentals\/([^/]+)$/, 'SELECT p.customer_id FROM plate_rentals r JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.id=?'],
  [/^\/api\/rental-contracts\/([^/]+)(?:\/.*)?$/, 'SELECT p.customer_id FROM rental_contracts r JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.id=?']
]
// 結束服務後仍可做的：結束或恢復服務、刪除前預覽和刪除（只限空白客戶，刪除時另有檢查）、查看登入密碼
const allowed = [/^\/api\/customers\/[^/]+\/(?:end-service|restore-service|deletion)$/, /^\/api\/customer-users\/[^/]+\/password-view$/]
// 這些新增請求在內容帶 customerId：開登入、牌照、車輛、公司、公司組、司機、工單
const creates = new Set(['/api/customer-users', '/api/plate-assets', '/api/plates', '/api/vehicles', '/api/companies', '/api/company-groups', '/api/drivers', '/api/requests', '/api/work-orders'])

// 員工修改已結束服務客戶的資料時回傳錯誤訊息；按網址判斷。客戶本人的登入已停用，不必檢查
export function endedPathBlock(user, method, path) {
  if (!['admin', 'staff'].includes(user.role) || method === 'GET') return null
  if (allowed.some(pattern => pattern.test(path)) || (method === 'DELETE' && /^\/api\/customers\/[^/]+$/.test(path))) return null
  for (const [pattern, sql] of ownerSql) {
    const match = path.match(pattern)
    if (!match) continue
    let key
    try { key = decodeURIComponent(match[1]) } catch { return null }
    const row = one(sql, key)
    return row && isEnded(row.customer_id) ? ENDED_ERROR : null
  }
  return null
}

// 新增請求的內容帶 customerId 時檢查（由 parseBody 呼叫）
export function endedBodyBlock(user, method, path, body) {
  if (!['admin', 'staff'].includes(user.role) || method !== 'POST' || !creates.has(path)) return null
  return typeof body?.customerId === 'string' && isEnded(body.customerId) ? ENDED_ERROR : null
}

// 結束前要留意的事：未完成的工單、未收清的收費、會停用的登入
function endPreview(customer) {
  const openRequests = all("SELECT id, title, status FROM requests WHERE customer_id=? AND status NOT IN ('已完成','已取消') ORDER BY created_at", customer.id)
  const unpaidFees = all('SELECT f.id, f.description, f.currency, f.amount, f.due_on, COALESCE((SELECT SUM(amount) FROM fee_payments WHERE fee_item_id=f.id),0) paid FROM fee_items f WHERE f.customer_id=? AND COALESCE(f.voided,0)=0 ORDER BY f.due_on', customer.id)
    .filter(row => row.paid < row.amount).map(row => ({ id: row.id, description: row.description, currency: row.currency, outstanding: row.amount - row.paid, dueOn: row.due_on }))
  const logins = all("SELECT id, name FROM users WHERE customer_id=? AND role='customer' AND active=1 ORDER BY name", customer.id)
  return { openRequests, unpaidFees, activeLogins: logins.map(row => row.name) }
}

const endedView = customer => ({ ended: Boolean(customer.ended_on), endedOn: customer.ended_on || null, reason: customer.end_reason || null, endedByName: customer.ended_by_name || null, endedAt: customer.ended_at || null })

// 不能結束服務的原因；可以時回傳 null
function endProblem(customer) {
  if (customer.is_self) return '本公司（自有）客戶不適用結束服務'
  if (customer.closed_on) return '這位客戶已自行注銷'
  if (customer.service_mode === '自管') return '自管客戶不適用結束服務；不再使用時由客戶自行注銷'
  if (customer.ended_on) return '這位客戶已結束服務'
  return null
}

export async function customerLifecycleRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const match = path.match(/^\/api\/customers\/([^/]+)\/(end-service|restore-service)$/)
  if (!match) return false
  if (user.role !== 'admin') return fail(res, 403, '只限管理者結束或恢復服務'), true
  const customer = one('SELECT * FROM customers WHERE id=? AND tenant_id=?', match[1], tenant)
  if (!customer) return fail(res, 404, '客戶不存在'), true
  if (match[2] === 'end-service') {
    if (method === 'GET') return json(res, 200, { ...endedView(customer), canEnd: !endProblem(customer), problem: endProblem(customer), ...endPreview(customer) }), true
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body) || Object.keys(body).some(key => !['endedOn', 'reason'].includes(key))) return fail(res, 400, '內容無效'), true
    if (!validDate(body.endedOn)) return fail(res, 400, '請填寫有效的結束日期'), true
    if (body.endedOn > today()) return fail(res, 400, '結束日期不可遲於今天'), true
    if (typeof body.reason !== 'string' || !body.reason.trim()) return fail(res, 400, '請填寫結束原因'), true
    if (body.reason.trim().length > MAX_REASON) return fail(res, 400, `結束原因不可超過 ${MAX_REASON} 個字`), true
    const problem = endProblem(customer)
    if (problem) return fail(res, 409, problem), true
    db.exec('BEGIN IMMEDIATE')
    try {
      const logins = all("SELECT id FROM users WHERE customer_id=? AND role='customer' AND active=1", customer.id).map(row => row.id)
      const ids = JSON.stringify(logins)
      db.prepare('UPDATE users SET active=0 WHERE id IN (SELECT value FROM json_each(?))').run(ids)
      db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?))').run(ids)
      // 未報的報帳期數不再跟進；恢復服務時重開
      db.prepare("UPDATE filing_periods SET closed_reason='service_ended', updated_at=? WHERE filed_on IS NULL AND closed_reason IS NULL AND company_id IN (SELECT id FROM companies WHERE customer_id=?)").run(now(), customer.id)
      db.prepare('UPDATE customers SET ended_on=?, end_reason=?, ended_by_name=?, ended_at=?, ended_logins=? WHERE id=?').run(body.endedOn, body.reason.trim(), user.name, now(), ids, customer.id)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, endedView(one('SELECT * FROM customers WHERE id=?', customer.id))), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (!customer.ended_on) return fail(res, 409, '這位客戶沒有結束服務'), true
  db.exec('BEGIN IMMEDIATE')
  let restored = 0
  try {
    const ids = customer.ended_logins || '[]'
    restored = db.prepare("UPDATE users SET active=1 WHERE active=0 AND customer_id=? AND id IN (SELECT value FROM json_each(?))").run(customer.id, ids).changes
    db.prepare("UPDATE filing_periods SET closed_reason=NULL, updated_at=? WHERE closed_reason='service_ended' AND company_id IN (SELECT id FROM companies WHERE customer_id=?)").run(now(), customer.id)
    db.prepare('UPDATE customers SET ended_on=NULL, end_reason=NULL, ended_by_name=NULL, ended_at=NULL, ended_logins=NULL WHERE id=?').run(customer.id)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, { ...endedView(one('SELECT * FROM customers WHERE id=?', customer.id)), restoredLogins: restored }), true
}

// 已結束服務的客戶登入時：密碼正確才說明，不洩露帳號是否存在
export function endedLogin(login, password, verify) {
  const account = login.includes('@') ? one("SELECT * FROM users WHERE role='customer' AND active=0 AND email=?", login) : one("SELECT * FROM users WHERE role='customer' AND active=0 AND phone=?", login)
  if (!account) return null
  const customer = one('SELECT ended_on FROM customers WHERE id=?', account.customer_id)
  if (!customer?.ended_on || !verify(String(password || ''), account.password_hash)) return null
  return { error: `你的服務已於 ${customer.ended_on} 結束，帳號已停用。如需恢復服務，請聯絡我們。`, ended: true, endedOn: customer.ended_on }
}
