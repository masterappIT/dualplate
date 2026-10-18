import { db } from './db.js'

// 今日工作待處理數目（2026-10-18 管理者要求：客戶提交申請後後台要有反應）：導航「今日工作」旁顯示，管理端每分鐘讀一次。
// 只數客戶那邊送來、要員工處理的事：註冊申請（只限管理者）、未讀客戶訊息、客戶更新待核對（按「客戶 × 對象」合成一件，
// 與今日工作的列法相同）、客戶自行辦理待核對、客戶新增出租未看、帳戶已注銷未確認（只限管理者）。到期事項另有統計卡，不計在內。
const count = (sql, ...params) => db.prepare(sql).get(...params).count

export function todayCounts(user) {
  const tenant = user.tenant_id, admin = user.role === 'admin'
  const counts = {
    signups: admin ? count("SELECT COUNT(*) count FROM signup_applications WHERE tenant_id=? AND status='審批中'", tenant) : 0,
    messages: count('SELECT COUNT(DISTINCT customer_id) count FROM support_messages WHERE tenant_id=? AND from_staff=0 AND read_at IS NULL', tenant),
    changes: count("SELECT COUNT(*) count FROM (SELECT 1 FROM customer_changes WHERE tenant_id=? AND status='待核對' GROUP BY customer_id, entity_type, entity_id)", tenant),
    selfHandled: count("SELECT COUNT(*) count FROM self_handled WHERE tenant_id=? AND status='待核對'", tenant),
    clientRentals: count("SELECT COUNT(*) count FROM rental_contracts WHERE tenant_id=? AND source='client' AND staff_seen_at IS NULL", tenant),
    closures: admin ? count('SELECT COUNT(*) count FROM account_closures WHERE tenant_id=? AND acknowledged_at IS NULL', tenant) : 0
  }
  return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }
}

export async function todayCountRoutes(req, res, url, user, { json, fail }) {
  if (url.pathname !== '/api/today-counts') return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
  return json(res, 200, todayCounts(user)), true
}
