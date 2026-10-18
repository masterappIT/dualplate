import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { businessToday } from './rules.js'
import { customerScope } from './entrustment.js'
import { priceFor } from './pricing.js'
import { services } from './catalog.js'

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

// 自管客戶暫時只可開一個登入（停用的也算）；多人登入日後作為收費功能推出（docs/requirements.md 5.6.2 第 6 點，管理者 2026-10-18），
// 屆時從這條規則放開。托管客戶不限，全部登入權限相同
export const SELF_MANAGED_LOGIN_LIMIT = 1
export const loginLimit = customer => modeOf(customer) === '自管' ? SELF_MANAGED_LOGIN_LIMIT : Infinity
const loginCount = customerId => db.prepare("SELECT COUNT(*) count FROM users WHERE customer_id=? AND role='customer'").get(customerId).count

// 托管時期留下、切換為自管後仍要我們處理的事（docs/tasks/self-managed-fixes-plan.md 第 5 步）：由我們代收租金的出租、未完成的工單。
// 只提示並連到該處處理，不自動改任何資料；未完成的工單會擋住客戶注銷帳號（account-closure.js）
const collectedRentals = (tenantId, customerId) => db.prepare("SELECT COUNT(*) count FROM rental_contracts r JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.tenant_id=? AND p.customer_id=? AND r.collection_mode='代收' AND r.status IN ('草擬','待換車','生效')").get(tenantId, customerId).count
// before：只算這個時間之前開的工單（自管期間的按次委託照常辦理，不算）；不填即全部
const openOrders = (customerId, before = '9999-12-31') => db.prepare("SELECT COUNT(*) count FROM requests WHERE customer_id=? AND status NOT IN ('已完成','已取消') AND created_at<?").get(customerId, before).count
const lastSelfManagedSwitch = customerId => db.prepare("SELECT changed_at FROM customer_mode_changes WHERE customer_id=? AND from_mode='托管' AND to_mode='自管' ORDER BY changed_at DESC LIMIT 1").get(customerId)?.changed_at
const rentalsLink = customerId => ({ label: '查看出租', to: { path: '/rentals', query: { customerId } } })
const ordersLink = customerId => ({ label: '查看工單', to: { path: `/customers/${customerId}`, query: { tab: 'business' } } })

// 托管客戶切換為自管之前，在切換框列出要另行處理的事
function beforeSelfManaged(tenantId, customer) {
  if (modeOf(customer) !== '托管') return []
  const list = [], rentals = collectedRentals(tenantId, customer.id), orders = openOrders(customer.id)
  if (rentals) list.push({ kind: 'collected_rentals', text: `有 ${rentals} 份出租由我們代收：切換後不會自動停止代收，請和客戶確定之後的收租安排`, link: rentalsLink(customer.id) })
  if (orders) list.push({ kind: 'open_orders', text: `有 ${orders} 張工單未完成：切換後照常辦理，請辦完或取消；未完成時客戶不能注銷帳號`, link: ordersLink(customer.id) })
  return list
}

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
    const rentals = collectedRentals(tenantId, customer.id)
    if (rentals) list.push({ kind: 'collected_rentals', text: `標為自管，但仍有 ${rentals} 份出租由我們代收；請和客戶確定之後的收租安排`, link: rentalsLink(customer.id) })
    const switchedAt = lastSelfManagedSwitch(customer.id), orders = switchedAt ? openOrders(customer.id, switchedAt) : 0
    if (orders) list.push({ kind: 'open_orders', text: `標為自管，但仍有 ${orders} 張托管時期的工單未完成；請辦完或取消，未完成時客戶不能注銷帳號`, link: ordersLink(customer.id) })
    { const logins = loginCount(customer.id); if (logins > SELF_MANAGED_LOGIN_LIMIT) list.push({ kind: 'extra_logins', text: `標為自管，但有 ${logins} 個登入；自管客戶目前只可有 ${SELF_MANAGED_LOGIN_LIMIT} 個，現有的照常可用，不能再新增` }) }
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
    beforeSelfManaged: beforeSelfManaged(tenantId, customer),
    history: history.map(row => ({ fromMode: row.from_mode, toMode: row.to_mode, effectiveOn: row.effective_on, contractEndsOn: row.contract_ends_on, changedByName: row.changed_by_name, changedAt: row.changed_at }))
  }
}

// 今日工作：托管合約 30 天內結束或已結束
export function contractEndings(tenantId) {
  const limit = new Date(Date.parse(today() + 'T00:00:00Z') + REMIND_DAYS * 86400000).toISOString().slice(0, 10)
  return db.prepare("SELECT id, name, contract_ends_on FROM customers WHERE tenant_id=? AND COALESCE(is_self,0)=0 AND service_mode='托管' AND ended_on IS NULL AND contract_ends_on IS NOT NULL AND contract_ends_on<=? ORDER BY contract_ends_on, name").all(tenantId, limit)
    .map(row => ({ customerId: row.id, name: row.name, contractEndsOn: row.contract_ends_on, daysLeft: daysBetween(today(), row.contract_ends_on) }))
}

export async function serviceModeRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const match = path.match(/^\/api\/customers\/([^/]+)\/service-mode$/)
  if (!match && path !== '/api/service-mode/contract-endings' && path !== '/api/my/entrust-price') return false
  // 按次委託的參考價（docs/requirements.md 5.6.2）：按通用價目表或這位客戶的收費，按次收費且有金額才回傳「由 X 起」，否則由顧問報價
  if (path === '/api/my/entrust-price') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const code = url.searchParams.get('service'), route = url.searchParams.get('route') || ''
    const service = services.find(item => item.code === code)
    if (!service || route && !service.routes.includes(route)) return fail(res, 400, '服務類型與路線不相符'), true
    const price = priceFor(tenant, user.customer_id, `job:${service.code}`, route || service.routes[0])
    const from = price?.billing === 'per_time' && price.amount ? { amount: price.amount, currency: price.currency } : null
    return json(res, 200, { service: service.code, name: service.name, from }), true
  }
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
