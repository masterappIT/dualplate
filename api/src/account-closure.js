import { randomUUID } from 'node:crypto'
import { db, verifyPassword, now } from './db.js'
import { lockedMinutes, recordFailure, clearFailures } from './security.js'
import { businessToday } from './rules.js'
import { services } from './catalog.js'

// 自管客戶自行注銷帳號（docs/requirements.md 5.6.2，2026-10-18 管理者決定）：不設冷靜期，輸入密碼確認後即時刪除帳號、牌照、
// 公司、車輛、司機、證件相片和訊息，不能復原。按次收費的帳單和相關工單只保留法定要求的最少記錄並去除個人資料；
// 有未完成的委託時先完成或取消；托管客戶不能自助注銷。注銷後在今日工作通知管理者（附原因），通知 30 天後刪除。
db.exec(`CREATE TABLE IF NOT EXISTS account_closures(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_name TEXT NOT NULL, reason TEXT, reason_text TEXT, plate_count INTEGER NOT NULL DEFAULT 0, kept_records INTEGER NOT NULL DEFAULT 0, closed_at TEXT NOT NULL, acknowledged_at TEXT, acknowledged_by TEXT);`)
if (!db.prepare('PRAGMA table_info(customers)').all().some(column => column.name === 'closed_on')) db.exec('ALTER TABLE customers ADD COLUMN closed_on TEXT')

export const closeReasons = ['不再需要', '改由別人代辦', '太複雜', '其他']
const KEEP_NOTICE_DAYS = 30, MAX_REASON_TEXT = 200
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const ids = rows => JSON.stringify(rows.map(row => row.id))
const inList = 'IN (SELECT value FROM json_each(?))'
const all = (sql, ...params) => db.prepare(sql).all(...params)
const run = (sql, ...params) => db.prepare(sql).run(...params)

const openRequests = customerId => all("SELECT id, title, status FROM requests WHERE customer_id=? AND status NOT IN ('已完成','已取消') ORDER BY created_at", customerId)
function counts(customerId) {
  const count = table => db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE customer_id=?`).get(customerId).count
  return { plates: count('plate_assets'), companies: count('companies'), vehicles: count('vehicles'), drivers: count('drivers') }
}

// 檢查能否注銷；回傳 { customer } 或 { status, error, openRequests? }
function check(user) {
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(user.customer_id, user.tenant_id)
  if (!customer || customer.closed_on) return { status: 404, error: '帳戶不存在' }
  if (customer.is_self || customer.service_mode !== '自管') return { status: 403, error: '托管客戶不能自行注銷，請聯絡你的顧問終止合約' }
  const open = openRequests(customer.id)
  if (open.length) return { status: 409, error: `你有 ${open.length} 件委託仍在辦理，請先聯絡我們完成或取消，才可以注銷`, openRequests: open.map(row => ({ id: row.id, title: row.title, status: row.status })) }
  return { customer }
}

// 刪除這位客戶的全部資料；按次收費的帳單和相關工單保留，去除個人資料。回傳是否保留了記錄。在呼叫者的交易內
function erase(tenantId, customer) {
  const cid = customer.id
  const plates = all('SELECT id FROM plate_assets WHERE customer_id=?', cid), vehicles = all('SELECT id FROM vehicles WHERE customer_id=?', cid)
  const companies = all('SELECT id FROM companies WHERE customer_id=?', cid), drivers = all('SELECT id FROM drivers WHERE customer_id=?', cid)
  const users = all("SELECT id, phone, email FROM users WHERE customer_id=? AND role='customer'", cid)
  const owners = JSON.stringify([cid, ...[plates, vehicles, companies, drivers].flatMap(rows => rows.map(row => row.id))])
  const p = ids(plates), v = ids(vehicles), c = ids(companies), d = ids(drivers), u = ids(users)

  // 要保留的帳目：收費、報價、分期、租金結算；只保留這些帳目引用的工單
  const kept = new Set(all('SELECT request_id id FROM fee_items WHERE customer_id=? AND request_id IS NOT NULL UNION SELECT request_id FROM quotes WHERE customer_id=? AND request_id IS NOT NULL UNION SELECT request_id FROM installment_plans WHERE customer_id=? AND request_id IS NOT NULL', cid, cid, cid).map(row => row.id))
  const keepCustomer = ['fee_items', 'quotes', 'installment_plans', 'rent_settlements'].some(table => db.prepare(`SELECT 1 FROM ${table} WHERE customer_id=? LIMIT 1`).get(cid))
  const requests = all('SELECT id FROM requests WHERE customer_id=?', cid)
  const dropped = JSON.stringify(requests.filter(row => !kept.has(row.id)).map(row => row.id)), keptIds = JSON.stringify([...kept])

  // 工單：不保留的整張刪除；保留的去掉描述、車輛、牌照和往來記錄，標題改為服務名稱
  for (const ids of [dropped, keptIds]) {
    run(`DELETE FROM request_attachments WHERE request_id ${inList}`, ids)
    run(`DELETE FROM activities WHERE request_id ${inList}`, ids)
  }
  run(`DELETE FROM tasks WHERE request_id ${inList}`, dropped)
  run(`UPDATE tasks SET notes=NULL, documents_json='[]' WHERE request_id ${inList}`, keptIds)
  run(`UPDATE inspections SET request_id=NULL WHERE request_id ${inList}`, dropped)
  run(`DELETE FROM requests WHERE id ${inList}`, dropped)
  for (const row of all(`SELECT id, service_code FROM requests WHERE id ${inList}`, keptIds)) {
    run('UPDATE requests SET title=?, description=NULL, vehicle_id=NULL, plate_asset_id=NULL, cancelled_reason=NULL WHERE id=?', services.find(item => item.code === row.service_code)?.name || '代辦服務', row.id)
  }
  run(`UPDATE fee_items SET plate_asset_id=NULL WHERE customer_id=?`, cid)
  run(`UPDATE fee_payments SET proof=NULL, proof_mime=NULL WHERE fee_item_id IN (SELECT id FROM fee_items WHERE customer_id=?)`, cid)
  run('UPDATE rent_settlements SET notes=NULL WHERE customer_id=?', cid)

  // 牌照及附屬：批文卡相片、出租合約和租金、過關、司機登記、自行辦理記錄
  const contracts = JSON.stringify(all(`SELECT id FROM rental_contracts WHERE plate_asset_id ${inList}`, p).map(row => row.id))
  run(`DELETE FROM rental_link_visits WHERE link_id IN (SELECT id FROM rental_links WHERE contract_id ${inList})`, contracts)
  for (const table of ['rental_links', 'rental_acknowledgements', 'renter_uploads']) run(`DELETE FROM ${table} WHERE contract_id ${inList}`, contracts)
  run(`DELETE FROM rent_invoice_proofs WHERE invoice_id IN (SELECT id FROM rent_invoices WHERE contract_id ${inList})`, contracts)
  run(`DELETE FROM rent_invoices WHERE contract_id ${inList}`, contracts)
  run(`DELETE FROM rental_contracts WHERE id ${inList}`, contracts)
  run(`DELETE FROM self_handled_files WHERE record_id IN (SELECT id FROM self_handled WHERE customer_id=?)`, cid)
  run('DELETE FROM self_handled WHERE customer_id=?', cid)
  for (const table of ['approval_card_images', 'plate_photos', 'plate_rentals', 'plate_crossings', 'plate_drivers', 'plate_transfers']) run(`DELETE FROM ${table} WHERE plate_asset_id ${inList}`, p)
  run(`DELETE FROM plate_assets WHERE id ${inList}`, p)

  // 車輛、公司、司機
  for (const table of ['credentials', 'inspections', 'vehicle_documents']) run(`DELETE FROM ${table} WHERE vehicle_id ${inList}`, v)
  run(`DELETE FROM vehicles WHERE id ${inList}`, v)
  run(`DELETE FROM filing_receipts WHERE filing_id IN (SELECT id FROM filing_periods WHERE company_id ${inList})`, c)
  run(`DELETE FROM filing_periods WHERE company_id ${inList}`, c)
  run(`DELETE FROM companies WHERE id ${inList}`, c)
  run('DELETE FROM company_groups WHERE customer_id=?', cid)
  run(`DELETE FROM drivers WHERE id ${inList}`, d)

  // 到期事項、代理範圍、客戶設定
  for (const table of ['tracked_items', 'service_scopes']) run(`DELETE FROM ${table} WHERE tenant_id=? AND owner_id ${inList}`, tenantId, owners)
  run(`DELETE FROM rule_completions WHERE tenant_id=? AND owner_id ${inList}`, tenantId, owners)
  for (const table of ['customer_items', 'customer_prices', 'customer_billing', 'notifications', 'support_messages', 'customer_mode_changes', 'customer_changes', 'monthly_reports', 'signup_applications']) run(`DELETE FROM ${table} WHERE customer_id=?`, cid)

  // 登入帳戶：同意記錄、登入、微信綁定、登入失敗記錄；操作記錄保留作保安用途，但去除姓名和內容
  run(`DELETE FROM terms_acceptances WHERE user_id ${inList}`, u)
  run(`DELETE FROM sessions WHERE user_id ${inList}`, u)
  run(`DELETE FROM wechat_bind_codes WHERE user_id ${inList}`, u)
  run(`UPDATE audit_logs SET user_name='已注銷客戶', summary_json=NULL WHERE user_id ${inList}`, u)
  for (const account of users) for (const login of [account.phone, account.email]) if (login) clearFailures('customer', login)
  run(`DELETE FROM users WHERE id ${inList}`, u)

  if (keepCustomer) {
    const day = businessToday().toISOString().slice(0, 10)
    run('UPDATE customers SET name=?, phone=NULL, notes=NULL, advisor_name=NULL, advisor_phone=NULL, advisor_wechat=NULL, contract_ends_on=NULL, closed_on=? WHERE id=?', `已注銷客戶（${day} · ${cid.slice(0, 4)}）`, day, cid)
  } else run('DELETE FROM customers WHERE id=?', cid)
  return keepCustomer
}

// 被通知過的注銷記錄 30 天後刪除
function purgeNotices() {
  run('DELETE FROM account_closures WHERE closed_at<?', new Date(Date.now() - KEEP_NOTICE_DAYS * 86400000).toISOString())
}

// 讀出注銷內容；回傳 { password, reason, reasonText } 或 { error }
function readClose(body) {
  if (!isObject(body) || Object.keys(body).some(key => !['password', 'reason', 'reasonText'].includes(key))) return { error: '內容無效' }
  if (typeof body.password !== 'string' || !body.password) return { error: '請輸入密碼' }
  if (body.reason !== undefined && body.reason !== null && !closeReasons.includes(body.reason)) return { error: '注銷原因無效' }
  if (body.reasonText !== undefined && body.reasonText !== null && typeof body.reasonText !== 'string') return { error: '內容無效' }
  const reasonText = (body.reasonText || '').trim()
  if (reasonText && body.reason !== '其他') return { error: '只有選「其他」才可填寫原因' }
  if (reasonText.length > MAX_REASON_TEXT) return { error: `原因不可超過 ${MAX_REASON_TEXT} 個字` }
  return { password: body.password, reason: body.reason || null, reasonText: reasonText || null }
}

export async function accountClosureRoutes(req, res, url, user, { json, fail, parseBody, clientIp }) {
  const path = url.pathname, method = req.method
  const acknowledge = path.match(/^\/api\/account-closures\/([^/]+)\/acknowledge$/)
  if (path !== '/api/my/account/close' && path !== '/api/account-closures' && !acknowledge) return false

  // 客戶：先看會刪除甚麼、能否注銷；再輸入密碼確認
  if (path === '/api/my/account/close') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    if (method === 'GET') {
      const result = check(user)
      if (result.status === 404 || result.status === 403) return fail(res, result.status, result.error), true
      return json(res, 200, { allowed: !result.error, error: result.error || null, openRequests: result.openRequests || [], counts: counts(user.customer_id), reasons: closeReasons }), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const input = readClose(await parseBody(req))
    if (input.error) return fail(res, 400, input.error), true
    const result = check(user)
    if (result.error) return json(res, result.status, { error: result.error, openRequests: result.openRequests }), true
    const account = db.prepare('SELECT * FROM users WHERE id=?').get(user.id), login = account.phone || account.email, ip = clientIp(req)
    const wait = lockedMinutes('customer', login, ip)
    if (wait) return fail(res, 429, `密碼錯誤次數過多，請 ${wait} 分鐘後再試`), true
    if (!verifyPassword(input.password, account.password_hash)) { recordFailure('customer', login, ip); return fail(res, 403, '密碼不正確'), true }
    const customer = result.customer, plateCount = counts(customer.id).plates
    db.exec('BEGIN IMMEDIATE')
    try {
      const keptRecords = erase(user.tenant_id, customer)
      run('INSERT INTO account_closures(id,tenant_id,customer_name,reason,reason_text,plate_count,kept_records,closed_at) VALUES (?,?,?,?,?,?,?,?)', randomUUID(), user.tenant_id, customer.name, input.reason, input.reasonText, plateCount, keptRecords ? 1 : 0, now())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { closed: true }), true
  }

  // 管理者：今日工作的「帳戶已注銷」
  if (user.role !== 'admin') return fail(res, 403, '無權限'), true
  purgeNotices()
  if (!acknowledge) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, all('SELECT * FROM account_closures WHERE tenant_id=? AND acknowledged_at IS NULL ORDER BY closed_at DESC', user.tenant_id)
      .map(row => ({ id: row.id, customerName: row.customer_name, reason: row.reason, reasonText: row.reason_text, plateCount: row.plate_count, keptRecords: Boolean(row.kept_records), closedAt: row.closed_at }))), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const row = db.prepare('SELECT * FROM account_closures WHERE id=? AND tenant_id=?').get(acknowledge[1], user.tenant_id)
  if (!row) return fail(res, 404, '記錄不存在'), true
  if (row.acknowledged_at) return fail(res, 409, '已標記為知道了'), true
  run('UPDATE account_closures SET acknowledged_at=?, acknowledged_by=? WHERE id=?', now(), user.name, row.id)
  return json(res, 200, { ok: true }), true
}
