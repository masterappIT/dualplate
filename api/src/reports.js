import { db, id, now } from './db.js'
import { businessToday, computeDeadlines } from './rules.js'
import { scopeMap } from './entrustment.js'
import { deadlineOwners } from './deadline-owners.js'
import { services } from './catalog.js'
import { feeKinds, feeStatus, ensureAnnualFees } from './fees.js'
import { refreshTenant, invoiceStatus, currencies } from './rentals.js'
import { ensureFilings, filingStatus } from './bookkeeping.js'

// 每月客戶報告（docs/tasks/monthly-report-brief.md）。草稿可重算；管理者確認後凍結數字，客戶才看得到；更正會產生新版本並保留舊版。
db.exec(`CREATE TABLE IF NOT EXISTS monthly_reports(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT '草稿', snapshot_json TEXT NOT NULL, confirmed_by TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(customer_id, period, version));`)

const today = () => businessToday().toISOString().slice(0, 10)
const addMonths = (month, count) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + count, 1)).toISOString().slice(0, 7) }
const previousMonth = () => addMonths(today().slice(0, 7), -1)
const totals = rows => Object.fromEntries(currencies.map(currency => [currency, rows.filter(row => row.currency === currency).reduce((sum, row) => sum + row.value, 0)]).filter(([, sum]) => sum))
const inMonth = (date, period) => Boolean(date) && String(date).slice(0, 7) === period

// 計算一位客戶某月的六節內容（純讀取）
export function computeReport(tenantId, customerId, period) {
  refreshTenant(tenantId); ensureAnnualFees(tenantId); ensureFilings(tenantId)
  const customer = db.prepare('SELECT id, name FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId)
  // 1. 本月完成的工作
  const completed = db.prepare("SELECT r.id, r.title, r.service_code, r.completed_at, p.mainland_plate, p.local_plate FROM requests r LEFT JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.customer_id=? AND r.status='已完成' ORDER BY r.completed_at").all(customerId)
    .filter(row => inMonth(row.completed_at, period)).map(row => ({ title: row.title, service: services.find(item => item.code === row.service_code)?.name || row.title, plate: [row.mainland_plate, row.local_plate].filter(Boolean).join(' · '), completedOn: row.completed_at.slice(0, 10) }))
  // 2. 已逾期及 60 天內到期（只列客戶看得到的規則；委託客戶自理的標「請你處理」）
  const { owners } = deadlineOwners(tenantId)
  const rules = db.prepare('SELECT * FROM rules WHERE tenant_id=? AND active=1 AND customer_visible=1').all(tenantId).map(rule => ({ ...rule, match: JSON.parse(rule.match_json), params: JSON.parse(rule.params_json), remindDays: rule.remind_days }))
  const tracked = new Map(db.prepare('SELECT * FROM tracked_items WHERE tenant_id=?').all(tenantId).map(item => [`${item.owner_type}:${item.owner_id}:${item.code}`, item]))
  const completions = new Set(db.prepare('SELECT * FROM rule_completions WHERE tenant_id=?').all(tenantId).map(item => `${item.code}:${item.owner_id}:${item.period}`))
  const limit = new Date(Date.parse(today()) + 60 * 86400000).toISOString().slice(0, 10)
  const upcoming = computeDeadlines({ rules, owners: owners.filter(owner => owner.customerId === customerId), tracked, completions, scopes: scopeMap(tenantId), windowDays: 60 })
    .filter(item => item.dueOn && item.dueOn <= limit && item.level !== 'ok').sort((a, b) => a.dueOn.localeCompare(b.dueOn))
    .map(item => ({ name: item.name, owner: item.ownerLabel, dueOn: item.dueOn, daysLeft: item.daysLeft, level: item.level, handledBy: item.handler === 'client' ? 'you' : 'us' }))
  // 3. 出租與租金
  const invoices = db.prepare("SELECT i.*, c.currency, c.collection_mode, c.renter_name, p.mainland_plate FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id JOIN plate_assets p ON p.id=c.plate_asset_id WHERE p.customer_id=? AND i.voided=0").all(customerId)
  const monthInvoices = invoices.filter(row => row.period === period)
  const usage = { items: monthInvoices.map(row => ({ plate: row.mainland_plate || '車牌待補', user: row.renter_name, currency: row.currency, amount: row.amount, received: row.received_amount || 0, status: invoiceStatus(row), collectedByUs: row.collection_mode === '代收' })),
    due: totals(monthInvoices.map(row => ({ currency: row.currency, value: row.amount }))), received: totals(monthInvoices.map(row => ({ currency: row.currency, value: row.received_amount || 0 }))), outstanding: totals(monthInvoices.map(row => ({ currency: row.currency, value: Math.max(0, row.amount - (row.received_amount || 0)) }))) }
  // 4. 收費（本月發生）
  const fees = db.prepare('SELECT * FROM fee_items WHERE customer_id=? AND voided=0').all(customerId)
  const paid = feeId => db.prepare('SELECT COALESCE(SUM(amount),0) total FROM fee_payments WHERE fee_item_id=?').get(feeId).total
  const monthFees = fees.filter(row => inMonth(row.incurred_on, period))
  const charges = { items: monthFees.map(row => ({ kind: row.kind, kindLabel: row.kind === 'rent_commission' ? '代收服務費' : feeKinds[row.kind], description: row.description.replace('租金管理費', '代收租金服務費'), currency: row.currency, amount: row.amount, status: feeStatus(row, paid(row.id)) })),
    byKind: Object.fromEntries(Object.keys(feeKinds).map(kind => [kind, totals(monthFees.filter(row => row.kind === kind).map(row => ({ currency: row.currency, value: row.amount })))]).filter(([, value]) => Object.keys(value).length)) }
  // 5. 淨額：本月代收租金 − 本月代收服務費 − 截至月底未付的其他收費（含代墊）。正數＝我們應付客戶，負數＝客戶應付。
  const collected = invoices.filter(row => row.collection_mode === '代收' && row.received_by === '代辦公司' && inMonth(row.received_on, period)).map(row => ({ currency: row.currency, value: row.received_amount }))
  const commission = monthFees.filter(row => row.kind === 'rent_commission').map(row => ({ currency: row.currency, value: row.amount }))
  const unpaid = fees.filter(row => row.kind !== 'rent_commission' && (row.incurred_on || '').slice(0, 7) <= period).map(row => ({ currency: row.currency, value: Math.max(0, row.amount - paid(row.id)) }))
  const sums = { collected: totals(collected), commission: totals(commission), unpaid: totals(unpaid) }
  const net = Object.fromEntries(currencies.map(currency => [currency, (sums.collected[currency] || 0) - (sums.commission[currency] || 0) - (sums.unpaid[currency] || 0)]).filter(([currency, value]) => value || sums.collected[currency] || sums.unpaid[currency]))
  // 6. 內地公司報帳
  const filings = db.prepare("SELECT p.*, co.name company_name, (SELECT 1 FROM filing_receipts r WHERE r.filing_id=p.id) has_receipt FROM filing_periods p JOIN companies co ON co.id=p.company_id WHERE co.customer_id=? AND p.period=? ORDER BY co.name").all(customerId, period)
    .map(row => ({ company: row.company_name, status: filingStatus(row), dueOn: row.due_on, taxAmount: row.tax_amount, zeroFiling: Boolean(row.zero_filing), hasReceipt: Boolean(row.has_receipt) }))
  return { customerName: customer?.name || '', period, generatedOn: today(), completed, upcoming, usage, charges, net: { ...sums, net }, filings }
}

function ensureReports(tenantId) {
  const period = previousMonth()
  // 自管客戶沒有月報（月報是我們向托管客戶交代的工作）
  for (const customer of db.prepare("SELECT id FROM customers WHERE tenant_id=? AND COALESCE(is_self,0)=0 AND service_mode<>'自管'").all(tenantId)) {
    if (db.prepare('SELECT 1 FROM monthly_reports WHERE customer_id=? AND period=?').get(customer.id, period)) continue
    const report = computeReport(tenantId, customer.id, period)
    // 這個月沒有任何工作、租金、收費、報帳和結算時不產生空白報告（例如月中才成為客戶）
    if (!report.completed.length && !report.usage.items.length && !report.charges.items.length && !report.filings.length && !Object.values(report.net.net).some(Boolean)) continue
    db.prepare("INSERT OR IGNORE INTO monthly_reports(id,tenant_id,customer_id,period,version,status,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,1,'草稿',?,?,?)").run(id(), tenantId, customer.id, period, JSON.stringify(report), now(), now())
  }
}
const reportView = (row, withSnapshot = true) => {
  const snapshot = JSON.parse(row.snapshot_json)
  return { id: row.id, customerId: row.customer_id, customerName: snapshot.customerName, period: row.period, version: row.version, status: row.status, confirmedAt: row.confirmed_at, net: snapshot.net.net, ...(withSnapshot ? { report: snapshot } : {}) }
}

export async function reportRoutes(req, res, url, user, { json, fail }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const myMatch = path.match(/^\/api\/my\/reports(?:\/([^/]+))?$/)
  if (myMatch) {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    // 每月只給最新的已確認版本
    const rows = db.prepare("SELECT * FROM monthly_reports WHERE customer_id=? AND tenant_id=? AND status='已確認' ORDER BY period DESC").all(user.customer_id, tenant)
    if (!myMatch[1]) return json(res, 200, rows.map(row => reportView(row, false))), true
    const row = rows.find(item => item.id === myMatch[1])
    if (!row) return fail(res, 404, '報告不存在'), true
    return json(res, 200, reportView(row)), true
  }
  const match = path.match(/^\/api\/reports(?:\/([^/]+)(?:\/(recalculate|confirm|correct))?)?$/)
  if (!match) return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  ensureReports(tenant)
  if (!match[1]) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const { customerId, period, status } = Object.fromEntries(url.searchParams)
    const rows = db.prepare(`SELECT * FROM monthly_reports WHERE tenant_id=? ${customerId ? 'AND customer_id=?' : ''} ${period ? 'AND period=?' : ''} ${status ? 'AND status=?' : ''} ORDER BY period DESC, customer_id, version DESC`).all(tenant, ...[customerId, period, status].filter(Boolean))
    return json(res, 200, rows.map(row => reportView(row, false))), true
  }
  const row = db.prepare('SELECT * FROM monthly_reports WHERE id=? AND tenant_id=?').get(match[1], tenant)
  if (!row) return fail(res, 404, '報告不存在'), true
  if (!match[2]) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const versions = db.prepare('SELECT id, version, status, confirmed_at FROM monthly_reports WHERE customer_id=? AND period=? ORDER BY version').all(row.customer_id, row.period)
    return json(res, 200, { ...reportView(row), versions: versions.map(item => ({ id: item.id, version: item.version, status: item.status, confirmedAt: item.confirmed_at })) }), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (user.role !== 'admin') return fail(res, 403, '只有管理者可確認或更正報告'), true
  if (match[2] === 'recalculate' || match[2] === 'confirm') {
    if (row.status !== '草稿') return fail(res, 409, '已確認的報告已鎖定，如需更正請產生更正版'), true
    const snapshot = JSON.stringify(computeReport(tenant, row.customer_id, row.period))
    db.exec('BEGIN')
    try {
      if (match[2] === 'confirm') {
        db.prepare("UPDATE monthly_reports SET status='已確認', snapshot_json=?, confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?").run(snapshot, user.id, now(), now(), row.id)
        // 新版本確認後，同月舊的已確認版本標為已更正
        db.prepare("UPDATE monthly_reports SET status='已更正', updated_at=? WHERE customer_id=? AND period=? AND id<>? AND status='已確認'").run(now(), row.customer_id, row.period, row.id)
      } else db.prepare('UPDATE monthly_reports SET snapshot_json=?, updated_at=? WHERE id=?').run(snapshot, now(), row.id)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, reportView(db.prepare('SELECT * FROM monthly_reports WHERE id=?').get(row.id))), true
  }
  // 更正：從已確認的版本產生下一版草稿；客戶在新版確認前仍看到舊版
  if (row.status !== '已確認') return fail(res, 409, '只有已確認的報告可以產生更正版'), true
  if (db.prepare("SELECT 1 FROM monthly_reports WHERE customer_id=? AND period=? AND status='草稿'").get(row.customer_id, row.period)) return fail(res, 409, '這個月已有未確認的更正版'), true
  const version = db.prepare('SELECT MAX(version) version FROM monthly_reports WHERE customer_id=? AND period=?').get(row.customer_id, row.period).version + 1
  const reportId = id()
  db.prepare("INSERT INTO monthly_reports(id,tenant_id,customer_id,period,version,status,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,'草稿',?,?,?)").run(reportId, tenant, row.customer_id, row.period, version, JSON.stringify(computeReport(tenant, row.customer_id, row.period)), now(), now())
  return json(res, 201, reportView(db.prepare('SELECT * FROM monthly_reports WHERE id=?').get(reportId))), true
}
