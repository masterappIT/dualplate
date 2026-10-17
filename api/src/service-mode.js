import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { businessToday } from './rules.js'
import { customerScope } from './entrustment.js'

// 自管／托管（docs/requirements.md 5.6.2，2026-10-18 管理者決定）：管理者人手切換，記生效日和操作人；托管可填合約結束日，
// 到期前 30 天提醒管理者；標記和代理範圍對不上時提示。自管客戶的事項一律客戶自理（entrustment.js selfManaged），不產生年費。
db.exec(`CREATE TABLE IF NOT EXISTS customer_mode_changes(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, from_mode TEXT, to_mode TEXT NOT NULL, effective_on TEXT NOT NULL, contract_ends_on TEXT, changed_by TEXT, changed_by_name TEXT, changed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customer_mode_changes_customer ON customer_mode_changes(customer_id);`)

export const modes = ['托管', '自管']
const REMIND_DAYS = 30
const today = () => businessToday().toISOString().slice(0, 10)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000)
const modeOf = customer => customer.service_mode || '托管'

// 對不上的情況：托管卻沒有我們負責的事項；自管卻仍有我們負責的逐項設定或生效中的年費；合約快到期或已過期仍標托管
function warnings(tenantId, customer) {
  const list = [], mode = modeOf(customer)
  if (mode === '托管') {
    const scope = customerScope(tenantId, customer.id)
    const owners = scope.sections.flatMap(section => section.owners)
    const ours = owners.flatMap(owner => Object.values(owner.cells)).filter(cell => cell.handler !== 'client').length
    if (owners.length && !ours) list.push({ kind: 'empty_scope', text: '標為托管，但代理範圍沒有由我們負責的事項' })
    if (customer.contract_ends_on) {
      const left = daysBetween(today(), customer.contract_ends_on)
      if (left < 0) list.push({ kind: 'contract_ended', text: `合約已於 ${customer.contract_ends_on} 結束，仍標為托管` })
      else if (left <= REMIND_DAYS) list.push({ kind: 'contract_ending', text: `合約將於 ${customer.contract_ends_on} 結束（尚餘 ${left} 天）` })
    }
  } else {
    const leftover = db.prepare(`SELECT COUNT(*) count FROM service_scopes WHERE tenant_id=? AND ended_on IS NULL AND handler<>'client' AND ((owner_type='plate' AND owner_id IN (SELECT id FROM plate_assets WHERE customer_id=?)) OR (owner_type='company' AND owner_id IN (SELECT id FROM companies WHERE customer_id=?)))`).get(tenantId, customer.id, customer.id).count
    if (leftover) list.push({ kind: 'leftover_scope', text: `標為自管，代理範圍仍有 ${leftover} 項設為我們負責或外包；自管期間一律由客戶自理` })
    if (db.prepare('SELECT 1 FROM customer_billing WHERE customer_id=? AND active=1').get(customer.id)) list.push({ kind: 'billing_active', text: '標為自管，但年費設定仍然生效；自管期間不會產生年費' })
  }
  return list
}

// 新增客戶時直接定為自管（source：邀請；自行申請在第 6 步用「申請」）。在呼叫者的交易內
export function startSelfManaged(user, customerId, source) {
  const day = today()
  db.prepare("UPDATE customers SET service_mode='自管', mode_since=?, mode_by=?, signup_source=? WHERE id=?").run(day, user.name, source, customerId)
  db.prepare('INSERT INTO customer_mode_changes(id,tenant_id,customer_id,from_mode,to_mode,effective_on,contract_ends_on,changed_by,changed_by_name,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), user.tenant_id, customerId, null, '自管', day, null, user.id, user.name, new Date().toISOString())
}

export function modeView(tenantId, customer) {
  const history = db.prepare('SELECT * FROM customer_mode_changes WHERE customer_id=? AND tenant_id=? ORDER BY changed_at DESC').all(customer.id, tenantId)
  return {
    mode: modeOf(customer), since: customer.mode_since || null, by: customer.mode_by || null, contractEndsOn: customer.contract_ends_on || null, source: customer.signup_source || null,
    warnings: warnings(tenantId, customer),
    history: history.map(row => ({ fromMode: row.from_mode, toMode: row.to_mode, effectiveOn: row.effective_on, contractEndsOn: row.contract_ends_on, changedByName: row.changed_by_name, changedAt: row.changed_at }))
  }
}

// 今日工作：托管合約 30 天內結束或已結束
export function contractEndings(tenantId) {
  const limit = new Date(Date.parse(today() + 'T00:00:00Z') + REMIND_DAYS * 86400000).toISOString().slice(0, 10)
  return db.prepare("SELECT id, name, contract_ends_on FROM customers WHERE tenant_id=? AND COALESCE(is_self,0)=0 AND service_mode='托管' AND contract_ends_on IS NOT NULL AND contract_ends_on<=? ORDER BY contract_ends_on, name").all(tenantId, limit)
    .map(row => ({ customerId: row.id, name: row.name, contractEndsOn: row.contract_ends_on, daysLeft: daysBetween(today(), row.contract_ends_on) }))
}

export async function serviceModeRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const match = path.match(/^\/api\/customers\/([^/]+)\/service-mode$/)
  if (!match && path !== '/api/service-mode/contract-endings') return false
  if (path === '/api/service-mode/contract-endings') {
    if (user.role !== 'admin') return fail(res, 403, '無權限'), true
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, contractEndings(tenant)), true
  }
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(match[1], tenant)
  if (!customer) return fail(res, 404, '客戶不存在'), true
  if (method === 'GET') return (customer.is_self ? fail(res, 409, '本公司（自有）不分自管或托管') : json(res, 200, modeView(tenant, customer))), true
  if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
  if (user.role !== 'admin') return fail(res, 403, '只限管理者切換自管或托管'), true
  if (customer.is_self) return fail(res, 409, '本公司（自有）不分自管或托管'), true
  const body = await parseBody(req)
  if (Object.keys(body).some(key => !['mode', 'effectiveOn', 'contractEndsOn'].includes(key)) || !Object.keys(body).length) return fail(res, 400, '內容無效'), true
  if (body.mode !== undefined && !modes.includes(body.mode)) return fail(res, 400, '只可以選托管或自管'), true
  if (body.effectiveOn !== undefined && !validDate(body.effectiveOn)) return fail(res, 400, '生效日無效'), true
  if (body.contractEndsOn !== undefined && body.contractEndsOn !== null && body.contractEndsOn !== '' && !validDate(body.contractEndsOn)) return fail(res, 400, '合約結束日無效'), true
  const from = modeOf(customer), to = body.mode ?? from, switching = to !== from
  if (!switching && body.effectiveOn !== undefined) return fail(res, 400, '沒有切換時不用填生效日'), true
  const effectiveOn = switching ? body.effectiveOn ?? today() : null
  if (switching && effectiveOn > today()) return fail(res, 400, '生效日不可遲於今天；要在將來生效，請到當日再切換'), true
  if (switching && customer.mode_since && effectiveOn < customer.mode_since) return fail(res, 400, `生效日不可早於上次切換日（${customer.mode_since}）`), true
  let endsOn = body.contractEndsOn === undefined ? customer.contract_ends_on || null : body.contractEndsOn || null
  if (to === '自管') {
    if (body.contractEndsOn) return fail(res, 400, '自管客戶沒有合約結束日'), true
    endsOn = null
  }
  // 沒有切換、只改合約結束日時，生效日沿用上次切換日（舊客戶可能沒有）
  const since = switching ? effectiveOn : customer.mode_since || null
  if (endsOn && since && endsOn < since) return fail(res, 400, '合約結束日不可早於生效日'), true
  if (!switching && endsOn === (customer.contract_ends_on || null)) return json(res, 200, modeView(tenant, customer)), true
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE customers SET service_mode=?, mode_since=?, mode_by=?, contract_ends_on=? WHERE id=? AND tenant_id=?').run(to, since, switching ? user.name : customer.mode_by, endsOn, customer.id, tenant)
    db.prepare('INSERT INTO customer_mode_changes(id,tenant_id,customer_id,from_mode,to_mode,effective_on,contract_ends_on,changed_by,changed_by_name,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), tenant, customer.id, from, to, effectiveOn || today(), endsOn, user.id, user.name, new Date().toISOString())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, modeView(tenant, db.prepare('SELECT * FROM customers WHERE id=?').get(customer.id))), true
}
