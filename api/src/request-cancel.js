import { db, id, now } from './db.js'

// 客戶自行取消委託（docs/tasks/self-managed-fixes-plan.md 第 12 步，管理者 2026-10-18）：只限「已收到」——員工還沒開始、還沒報價。
// 誤按或改變主意的委託可以撤回，也不會再擋住注銷帳號。已報價、辦理中的要聯絡我們（可能已產生費用或已向政府遞交文件）。
// 兩種客戶都一樣。員工在今日工作的「客戶取消的委託」看到，按「知道了」後不再列出。
const addColumn = (table, column, definition) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
addColumn('requests', 'client_cancelled_at', 'TEXT')
addColumn('requests', 'cancel_seen_at', 'TEXT')

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const CONTACT_US = '已開始辦理或已報價，如要取消請聯絡我們'

// 為甚麼不能自行取消；null＝可以
export function cancelBlock(request) {
  if (['已完成', '已取消'].includes(request.status)) return null
  if (!['新要求', '待開始'].includes(request.status)) return CONTACT_US
  if (db.prepare("SELECT 1 FROM tasks WHERE request_id=? AND status IN ('進行中','已完成','不適用') LIMIT 1").get(request.id)) return CONTACT_US
  if (db.prepare("SELECT 1 FROM quotes WHERE request_id=? AND status<>'草擬' LIMIT 1").get(request.id)) return CONTACT_US
  if (db.prepare('SELECT 1 FROM fee_items WHERE request_id=? LIMIT 1').get(request.id)) return CONTACT_US
  // 出租的換車、換司機、出租代理工單：跟着出租一起處理
  if (db.prepare('SELECT 1 FROM rental_procedures WHERE request_id=? LIMIT 1').get(request.id) || /^出租代理：/.test(request.title)) return '這是出租的手續，請在出租頁取消出租'
  return null
}
export const canCancel = request => !['已完成', '已取消'].includes(request.status) && !cancelBlock(request)

export async function requestCancelRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname
  const mine = path.match(/^\/api\/my\/requests\/([^/]+)\/cancel$/)
  const staff = path.match(/^\/api\/client-cancels(?:\/([^/]+)\/seen)?$/)
  if (!mine && !staff) return false

  if (staff) {
    if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
    if (!staff[1]) {
      if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const rows = db.prepare("SELECT r.id, r.title, r.route, r.cancelled_reason, r.client_cancelled_at, r.customer_id, c.name customer_name, p.mainland_plate, p.local_plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN plate_assets p ON p.id=r.plate_asset_id WHERE c.tenant_id=? AND r.client_cancelled_at IS NOT NULL AND r.cancel_seen_at IS NULL ORDER BY r.client_cancelled_at DESC").all(user.tenant_id)
      return json(res, 200, rows.map(row => ({ id: row.id, title: row.title, route: row.route, customerId: row.customer_id, customerName: row.customer_name, plateLabel: [row.mainland_plate, row.local_plate].filter(Boolean).join(' · '), reason: String(row.cancelled_reason || '').replace(/^客戶自行取消：?/, ''), cancelledAt: row.client_cancelled_at }))), true
    }
    if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const row = db.prepare('SELECT r.id FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=? AND c.tenant_id=? AND r.client_cancelled_at IS NOT NULL').get(staff[1], user.tenant_id)
    if (!row) return fail(res, 404, '委託不存在'), true
    db.prepare('UPDATE requests SET cancel_seen_at=COALESCE(cancel_seen_at, ?) WHERE id=?').run(now(), row.id)
    return json(res, 200, { ok: true }), true
  }

  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const request = db.prepare('SELECT r.* FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=? AND r.customer_id=? AND c.tenant_id=?').get(mine[1], user.customer_id, user.tenant_id)
  if (!request) return fail(res, 404, '委託不存在'), true
  const body = await parseBody(req)
  if (!isObject(body) || Object.keys(body).some(key => key !== 'reason')) return fail(res, 400, '內容無效'), true
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') return fail(res, 400, '取消原因格式無效'), true
  if (request.status === '已取消') return fail(res, 409, '這個委託已取消'), true
  if (request.status === '已完成') return fail(res, 409, '這個委託已完成，不能取消'), true
  const block = cancelBlock(request)
  if (block) return fail(res, 409, block), true
  const reason = String(body.reason || '').trim().slice(0, 300)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE requests SET status='已取消', cancelled_reason=?, client_cancelled_at=?, updated_at=? WHERE id=?").run(`客戶自行取消${reason ? '：' + reason : ''}`, now(), now(), request.id)
    db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), request.id, user.id, 'status', `客戶自行取消${reason ? '：' + reason : ''}`, now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, { id: request.id, status: '已取消' }), true
}
