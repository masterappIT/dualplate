import { db, id, now } from './db.js'
import { businessToday } from './rules.js'
import { scopeMap } from './entrustment.js'
import { sniff } from './client-portal.js'

// 內地公司每月報帳報稅追蹤（docs/tasks/bookkeeping-brief.md）。做帳外包給會計公司，系統只追蹤進度、回執與截止日。
db.exec(`CREATE TABLE IF NOT EXISTS accounting_firms(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS filing_periods(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, company_id TEXT NOT NULL, period TEXT NOT NULL, due_on TEXT NOT NULL, docs_received_on TEXT, sent_to_firm_on TEXT, filed_on TEXT, paid_on TEXT, tax_amount INTEGER, zero_filing INTEGER NOT NULL DEFAULT 0, closed_reason TEXT, notes TEXT, updated_by TEXT, updated_at TEXT NOT NULL, UNIQUE(company_id, period));
CREATE TABLE IF NOT EXISTS filing_receipts(filing_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, uploaded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS filing_calendar(tenant_id TEXT NOT NULL, period TEXT NOT NULL, due_on TEXT NOT NULL, PRIMARY KEY(tenant_id, period));`)
const addColumn = (table, column, definition) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
addColumn('companies', 'accounting_firm_id', 'TEXT')
addColumn('companies', 'filing_cycle', "TEXT NOT NULL DEFAULT 'monthly'")

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)
const validDate = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value }
const validPeriod = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
const today = () => businessToday().toISOString().slice(0, 10)
const addMonths = (month, count) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + count, 1)).toISOString().slice(0, 7) }
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
const activeStatuses = ['存續', '經營異常', '註銷中']

// 截止日：租戶逐月設定；沒有設定時預設次月 15 日
export const dueFor = (tenantId, period) => db.prepare('SELECT due_on FROM filing_calendar WHERE tenant_id=? AND period=?').get(tenantId, period)?.due_on || `${addMonths(period, 1)}-15`

// 每間在營內地公司生成到本月為止、最近 3 期的報帳工作（冪等）；客戶自理的不生成；按季者只在季首月。已註銷公司未完成的期數標記，不刪除。
export function ensureFilings(tenantId) {
  const month = today().slice(0, 7), scopes = scopeMap(tenantId)
  const companies = db.prepare("SELECT * FROM companies WHERE tenant_id=? AND jurisdiction='內地'").all(tenantId)
  for (const company of companies) {
    const status = company.status || '存續'
    if (!activeStatuses.includes(status)) {
      db.prepare("UPDATE filing_periods SET closed_reason='公司已註銷', updated_at=? WHERE company_id=? AND filed_on IS NULL AND closed_reason IS NULL").run(now(), company.id)
      continue
    }
    if ((scopes.handling('company', company.id, 'monthly_filing', company.customer_id)?.handler ?? 'client') === 'client') continue
    for (let back = 2; back >= 0; back--) {
      const period = addMonths(month, -back)
      if (company.filing_cycle === 'quarterly' && (Number(period.slice(5)) - 1) % 3 !== 0) continue
      db.prepare('INSERT OR IGNORE INTO filing_periods(id,tenant_id,company_id,period,due_on,updated_at) VALUES (?,?,?,?,?,?)').run(id(), tenantId, company.id, period, dueFor(tenantId, period), now())
    }
  }
}

export function filingStatus(row) {
  if (row.closed_reason === 'pre_system') return '啟用前已處理'
  if (row.closed_reason) return '公司已註銷'
  if (row.paid_on || (row.filed_on && row.zero_filing)) return '已完成'
  if (row.filed_on) return '已申報'
  if (row.sent_to_firm_on) return '會計處理中'
  if (row.docs_received_on) return '資料已收'
  return '未開始'
}
// 截止前 5 天仍未申報為需處理，過了截止日為已逾期
export function filingLevel(row, day = today()) {
  if (row.closed_reason || row.filed_on) return 'ok'
  const left = daysBetween(day, row.due_on)
  return left < 0 ? 'overdue' : left <= 5 ? 'due' : 'upcoming'
}
const hasReceipt = filingId => Boolean(db.prepare('SELECT 1 FROM filing_receipts WHERE filing_id=?').get(filingId))
function filingView(row) {
  const company = db.prepare('SELECT co.name, co.customer_id, co.accounting_firm_id, co.taxpayer_type, co.filing_cycle, c.name customer_name, f.name firm_name FROM companies co JOIN customers c ON c.id=co.customer_id LEFT JOIN accounting_firms f ON f.id=co.accounting_firm_id WHERE co.id=?').get(row.company_id)
  const receipt = hasReceipt(row.id), status = filingStatus(row)
  return { id: row.id, companyId: row.company_id, companyName: company?.name, customerId: company?.customer_id, customerName: company?.customer_name, firmId: company?.accounting_firm_id || null, firmName: company?.firm_name || '', taxpayerType: company?.taxpayer_type || '', filingCycle: company?.filing_cycle || 'monthly',
    period: row.period, dueOn: row.due_on, docsReceivedOn: row.docs_received_on, sentToFirmOn: row.sent_to_firm_on, filedOn: row.filed_on, paidOn: row.paid_on, taxAmount: row.tax_amount, zeroFiling: Boolean(row.zero_filing), notes: row.notes || '', closedReason: row.closed_reason || '',
    status, level: filingLevel(row), hasReceipt: receipt, missingReceipt: !row.closed_reason && Boolean(row.filed_on) && !receipt, updatedAt: row.updated_at }
}

// 管理總覽的到期項目：名稱「報稅：公司名 YYYY-MM」；外包時帶外包單位
export function filingDeadlines(tenantId) {
  ensureFilings(tenantId)
  const scopes = scopeMap(tenantId)
  return db.prepare('SELECT p.*, co.name company_name, co.customer_id, c.name customer_name FROM filing_periods p JOIN companies co ON co.id=p.company_id JOIN customers c ON c.id=co.customer_id WHERE p.tenant_id=? AND p.filed_on IS NULL AND p.closed_reason IS NULL').all(tenantId)
    .filter(row => ['due', 'overdue'].includes(filingLevel(row)))
    .map(row => ({ row, scope: scopes.handling('company', row.company_id, 'monthly_filing', row.customer_id) })).filter(entry => entry.scope)
    .map(({ row, scope }) => { return { ruleCode: 'monthly_filing', name: `報稅：${row.company_name} ${row.period}`, method: 'filing', service: 'bookkeeping', item: 'monthly_filing', handler: scope.handler, providerName: scope.providerName, ownerType: 'company', ownerId: row.company_id, ownerLabel: row.company_name, customerId: row.customer_id, customerName: row.customer_name, dueOn: row.due_on, daysLeft: daysBetween(today(), row.due_on), level: filingLevel(row), period: row.period, detail: filingStatus(row), filingId: row.id } })
}

export async function bookkeepingRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  if (path === '/api/my/filings') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    ensureFilings(tenant)
    // 客戶只看狀態、稅額、零申報；不含會計公司聯絡資料和內部備註
    const companies = db.prepare("SELECT id, name, status FROM companies WHERE tenant_id=? AND customer_id=? AND jurisdiction='內地' ORDER BY name").all(tenant, user.customer_id)
    return json(res, 200, companies.map(company => ({ companyId: company.id, companyName: company.name, periods: db.prepare('SELECT * FROM filing_periods WHERE company_id=? ORDER BY period DESC LIMIT 6').all(company.id).map(row => ({ period: row.period, dueOn: row.due_on, status: row.closed_reason === 'pre_system' ? '已完成' : filingStatus(row), taxAmount: row.tax_amount, zeroFiling: Boolean(row.zero_filing), filedOn: row.filed_on })) }))), true
  }
  const firmMatch = path.match(/^\/api\/accounting-firms(?:\/([^/]+))?$/)
  const filingMatch = path.match(/^\/api\/filings(?:\/(matrix|bulk|[^/]+)(\/(receipt|pre-system))?)?$/)
  const calendarMatch = path.match(/^\/api\/filing-calendar\/([^/]+)$/)
  const bulkSetup = path === '/api/companies/filing-setup'
  const setupMatch = bulkSetup ? null : path.match(/^\/api\/companies\/([^/]+)\/filing-setup$/)
  if (!firmMatch && !filingMatch && !calendarMatch && !setupMatch && !bulkSetup) return false
  const staffRead = user.role === 'staff' && method === 'GET' && (path === '/api/filings' || path === '/api/filings/matrix') && url.searchParams.has('customerId') && Boolean(url.searchParams.get('customerId'))
  if (user.role !== 'admin' && !staffRead) return fail(res, 403, '報帳報稅只限管理者'), true

  if (firmMatch) {
    const checkFirm = body => !isObject(body) ? '內容無效' : (body.name !== undefined || !firmMatch[1]) && (typeof body.name !== 'string' || !body.name.trim()) ? '請填寫會計公司名稱' : ['contact', 'phone', 'email', 'notes'].some(key => body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') ? '會計公司資料格式無效' : body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? '電郵格式無效' : null
    const view = row => ({ id: row.id, name: row.name, contact: row.contact || '', phone: row.phone || '', email: row.email || '', notes: row.notes || '', companies: db.prepare('SELECT COUNT(*) count FROM companies WHERE accounting_firm_id=?').get(row.id).count })
    if (!firmMatch[1]) {
      if (method === 'GET') return json(res, 200, db.prepare('SELECT * FROM accounting_firms WHERE tenant_id=? ORDER BY name').all(tenant).map(view)), true
      if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
      const body = await parseBody(req), problem = checkFirm(body)
      if (problem) return fail(res, 400, problem), true
      const firmId = id()
      db.prepare('INSERT INTO accounting_firms(id,tenant_id,name,contact,phone,email,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(firmId, tenant, clean(body.name, 120), clean(body.contact, 60) || null, clean(body.phone, 30) || null, clean(body.email, 120) || null, clean(body.notes, 500) || null, now(), now())
      return json(res, 201, view(db.prepare('SELECT * FROM accounting_firms WHERE id=?').get(firmId))), true
    }
    const firm = db.prepare('SELECT * FROM accounting_firms WHERE id=? AND tenant_id=?').get(firmMatch[1], tenant)
    if (!firm) return fail(res, 404, '會計公司不存在'), true
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req), problem = checkFirm(body)
    if (problem) return fail(res, 400, problem), true
    const pick = (key, max) => body[key] === undefined ? firm[key] : clean(body[key], max) || null
    db.prepare('UPDATE accounting_firms SET name=?,contact=?,phone=?,email=?,notes=?,updated_at=? WHERE id=?').run(body.name === undefined ? firm.name : clean(body.name, 120), pick('contact', 60), pick('phone', 30), pick('email', 120), pick('notes', 500), now(), firm.id)
    return json(res, 200, view(db.prepare('SELECT * FROM accounting_firms WHERE id=?').get(firm.id))), true
  }

  if (bulkSetup) {
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body) || !Array.isArray(body.companyIds) || !body.companyIds.length || body.companyIds.some(value => typeof value !== 'string' || !value.trim()) || new Set(body.companyIds).size !== body.companyIds.length) return fail(res, 400, '請選擇有效且不重複的公司'), true
    if (!['monthly', 'quarterly'].includes(body.filingCycle)) return fail(res, 400, '申報週期須為每月或每季'), true
    if (body.accountingFirmId !== null && (typeof body.accountingFirmId !== 'string' || !body.accountingFirmId.trim())) return fail(res, 400, '會計公司無效'), true
    if (body.accountingFirmId && !db.prepare('SELECT id FROM accounting_firms WHERE id=? AND tenant_id=?').get(body.accountingFirmId, tenant)) return fail(res, 404, '會計公司不存在'), true
    const companies = body.companyIds.map(companyId => db.prepare('SELECT * FROM companies WHERE id=? AND tenant_id=?').get(companyId, tenant))
    if (companies.some(company => !company)) return fail(res, 404, '公司不存在'), true
    if (companies.some(company => company.jurisdiction !== '內地')) return fail(res, 400, '報帳報稅只適用於內地公司'), true
    if (body.filingCycle === 'quarterly' && companies.some(company => company.taxpayer_type === '一般納稅人')) return fail(res, 400, '一般納稅人須按月申報'), true
    const update = db.prepare('UPDATE companies SET accounting_firm_id=?, filing_cycle=?, updated_at=? WHERE id=? AND tenant_id=?')
    db.exec('BEGIN')
    try { for (const company of companies) update.run(body.accountingFirmId, body.filingCycle, now(), company.id, tenant); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { updated: body.companyIds }), true
  }
  if (setupMatch) {
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const company = db.prepare('SELECT * FROM companies WHERE id=? AND tenant_id=?').get(setupMatch[1], tenant)
    if (!company) return fail(res, 404, '公司不存在'), true
    if (company.jurisdiction !== '內地') return fail(res, 400, '報帳報稅只適用於內地公司'), true
    const body = await parseBody(req)
    if (!isObject(body) || (body.filingCycle !== undefined && !['monthly', 'quarterly'].includes(body.filingCycle))) return fail(res, 400, '申報週期須為每月或每季'), true
    if (body.filingCycle === 'quarterly' && (company.taxpayer_type || '') === '一般納稅人') return fail(res, 400, '一般納稅人須按月申報'), true
    if (body.accountingFirmId !== undefined && body.accountingFirmId !== null && !db.prepare('SELECT id FROM accounting_firms WHERE id=? AND tenant_id=?').get(body.accountingFirmId, tenant)) return fail(res, 404, '會計公司不存在'), true
    db.prepare('UPDATE companies SET accounting_firm_id=?, filing_cycle=?, updated_at=? WHERE id=?').run(body.accountingFirmId === undefined ? company.accounting_firm_id : body.accountingFirmId, body.filingCycle || company.filing_cycle || 'monthly', now(), company.id)
    const updated = db.prepare('SELECT accounting_firm_id, filing_cycle FROM companies WHERE id=?').get(company.id)
    return json(res, 200, { companyId: company.id, accountingFirmId: updated.accounting_firm_id, filingCycle: updated.filing_cycle }), true
  }

  if (calendarMatch) {
    const period = calendarMatch[1]
    if (!validPeriod(period)) return fail(res, 400, '期數格式須為 YYYY-MM'), true
    if (method === 'GET') return json(res, 200, { period, dueOn: dueFor(tenant, period), custom: Boolean(db.prepare('SELECT 1 FROM filing_calendar WHERE tenant_id=? AND period=?').get(tenant, period)) }), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body) || !validDate(body.dueOn) || body.dueOn.slice(0, 7) <= period) return fail(res, 400, '截止日須為該期之後的日期'), true
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO filing_calendar(tenant_id,period,due_on) VALUES (?,?,?) ON CONFLICT(tenant_id,period) DO UPDATE SET due_on=excluded.due_on').run(tenant, period, body.dueOn)
      // 已生成但未申報的期數跟隨新截止日
      db.prepare('UPDATE filing_periods SET due_on=?, updated_at=? WHERE tenant_id=? AND period=? AND filed_on IS NULL').run(body.dueOn, now(), tenant, period)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { period, dueOn: body.dueOn, custom: true }), true
  }

  if ((path === '/api/filings' || path === '/api/filings/matrix') && (url.searchParams.getAll('customerId').length > 1 || [...url.searchParams.keys()].some(key => key.startsWith('customerId[')))) return fail(res, 400, '客戶篩選無效'), true
  const customerId = url.searchParams.get('customerId') || ''
  if ((path === '/api/filings' || path === '/api/filings/matrix') && customerId && !db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenant)) return fail(res, 404, '找不到客戶'), true
  ensureFilings(tenant)
  if (filingMatch[1] === 'bulk') {
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body) || !Array.isArray(body.ids) || !body.ids.length || body.ids.some(value => typeof value !== 'string' || !value.trim()) || !['docs_received', 'sent_to_firm', 'pre_system'].includes(body.action)) return fail(res, 400, '批量內容無效'), true
    const updated = [], skipped = [], seen = new Set()
    const find = db.prepare('SELECT * FROM filing_periods WHERE id=? AND tenant_id=?')
    const update = db.prepare('UPDATE filing_periods SET docs_received_on=?,sent_to_firm_on=?,closed_reason=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?')
    db.exec('BEGIN')
    try {
      for (const filingId of body.ids) {
        if (seen.has(filingId)) { skipped.push({ id: filingId, reason: '重複選取' }); continue }
        seen.add(filingId)
        const row = find.get(filingId, tenant)
        if (!row) { skipped.push({ id: filingId, reason: '期數不存在或無權限' }); continue }
        if (row.closed_reason) { skipped.push({ id: filingId, reason: '這期已結束' }); continue }
        if (body.action === 'pre_system' && row.filed_on) { skipped.push({ id: filingId, reason: '已申報不可標記' }); continue }
        if (body.action === 'docs_received' && (row.docs_received_on || row.sent_to_firm_on || row.filed_on || row.paid_on) || body.action === 'sent_to_firm' && (!row.docs_received_on || row.sent_to_firm_on || row.filed_on || row.paid_on)) { skipped.push({ id: filingId, reason: '目前步驟不符' }); continue }
        update.run(body.action === 'docs_received' ? today() : row.docs_received_on, body.action === 'sent_to_firm' ? today() : row.sent_to_firm_on, body.action === 'pre_system' ? 'pre_system' : row.closed_reason, user.id, now(), filingId, tenant)
        updated.push(filingId)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { updated, skipped }), true
  }
  if (!filingMatch[1]) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const { period, companyId, firmId, status } = Object.fromEntries(url.searchParams)
    let rows = db.prepare(`SELECT p.* FROM filing_periods p JOIN companies co ON co.id=p.company_id WHERE p.tenant_id=? ${period ? 'AND p.period=?' : ''} ${companyId ? 'AND p.company_id=?' : ''} ${firmId ? 'AND co.accounting_firm_id=?' : ''} ${customerId ? 'AND co.customer_id=?' : ''} ORDER BY p.period DESC, co.name`).all(tenant, ...[period, companyId, firmId, customerId].filter(Boolean)).map(filingView)
    if (status === '需處理') rows = rows.filter(row => row.level === 'due'); else if (status === '已逾期') rows = rows.filter(row => row.level === 'overdue'); else if (status === '缺回執') rows = rows.filter(row => row.missingReceipt); else if (status) rows = rows.filter(row => row.status === status)
    return json(res, 200, rows), true
  }
  if (filingMatch[1] === 'matrix') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const months = Number(url.searchParams.get('months') || 6)
    if (!Number.isInteger(months) || months < 1 || months > 24) return fail(res, 400, '月數須為 1–24'), true
    const current = today().slice(0, 7), columns = Array.from({ length: months }, (_, index) => addMonths(current, index - months + 1))
    const firmId = url.searchParams.get('firmId') || ''
    const companies = db.prepare(`SELECT co.id, co.name, co.customer_id, co.status, co.filing_cycle, c.name customer_name, f.name firm_name FROM companies co JOIN customers c ON c.id=co.customer_id LEFT JOIN accounting_firms f ON f.id=co.accounting_firm_id WHERE co.tenant_id=? AND co.jurisdiction='內地' AND co.id IN (SELECT company_id FROM filing_periods) ${customerId ? 'AND co.customer_id=?' : ''} ${firmId ? 'AND co.accounting_firm_id=?' : ''} ORDER BY c.name, co.name`).all(tenant, ...[customerId, firmId].filter(Boolean))
    return json(res, 200, { months: columns, rows: companies.map(company => ({ companyId: company.id, companyName: company.name, customerId: company.customer_id, customerName: company.customer_name, firmName: company.firm_name || '', filingCycle: company.filing_cycle, cells: columns.map(month => { const row = db.prepare('SELECT * FROM filing_periods WHERE company_id=? AND period=?').get(company.id, month); return row ? { filingId: row.id, period: month, status: filingStatus(row), level: filingLevel(row), missingReceipt: !row.closed_reason && Boolean(row.filed_on) && !hasReceipt(row.id) } : { period: month, status: null } }) })) }), true
  }
  const filing = db.prepare('SELECT * FROM filing_periods WHERE id=? AND tenant_id=?').get(filingMatch[1], tenant)
  if (!filing) return fail(res, 404, '報帳期數不存在'), true
  if (filingMatch[2]) {
    if (filingMatch[3] === 'pre-system') {
      if (method !== 'DELETE') return fail(res, 405, '不支援此操作'), true
      if (filing.closed_reason !== 'pre_system') return fail(res, 409, '這期沒有啟用前標記'), true
      db.prepare('UPDATE filing_periods SET closed_reason=NULL,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?').run(user.id, now(), filing.id, tenant)
      return json(res, 200, filingView(db.prepare('SELECT * FROM filing_periods WHERE id=?').get(filing.id))), true
    }
    if (method === 'GET') {
      const receipt = db.prepare('SELECT * FROM filing_receipts WHERE filing_id=?').get(filing.id)
      if (!receipt) return fail(res, 404, '沒有回執'), true
      res.writeHead(200, { 'content-type': receipt.mime }); res.end(receipt.data); return true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    const data = isObject(body) && typeof body.data === 'string' ? Buffer.from(body.data.replace(/^data:[^,]+,/, ''), 'base64') : null
    if (!data?.length) return fail(res, 400, '請選擇回執檔案'), true
    if (data.length > 5 * 1024 * 1024) return fail(res, 400, '回執不能超過 5 MB'), true
    const mime = sniff(data); if (!mime) return fail(res, 400, '回執只接受 JPG、PNG 或 PDF'), true
    db.prepare('INSERT INTO filing_receipts(filing_id,mime,data,uploaded_at) VALUES (?,?,?,?) ON CONFLICT(filing_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, uploaded_at=excluded.uploaded_at').run(filing.id, mime, data, now())
    return json(res, 200, filingView(filing)), true
  }
  if (method === 'GET') return json(res, 200, filingView(filing)), true
  if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
  if (filing.closed_reason) return fail(res, 409, '公司已註銷，這期不再處理'), true
  const body = await parseBody(req)
  if (!isObject(body)) return fail(res, 400, '內容無效'), true
  const steps = ['docsReceivedOn', 'sentToFirmOn', 'filedOn', 'paidOn'], columns = ['docs_received_on', 'sent_to_firm_on', 'filed_on', 'paid_on']
  for (const key of steps) if (body[key] !== undefined && body[key] !== null && !validDate(body[key])) return fail(res, 400, '步驟日期無效'), true
  if (body.taxAmount !== undefined && body.taxAmount !== null && !(Number.isInteger(body.taxAmount) && body.taxAmount >= 0)) return fail(res, 400, '稅額須為以「分」為單位的非負整數'), true
  if (body.zeroFiling !== undefined && typeof body.zeroFiling !== 'boolean') return fail(res, 400, '零申報欄位無效'), true
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') return fail(res, 400, '備註格式無效'), true
  const next = Object.fromEntries(columns.map((column, index) => [column, body[steps[index]] === undefined ? filing[column] : body[steps[index]]]))
  const zero = body.zeroFiling === undefined ? Boolean(filing.zero_filing) : body.zeroFiling
  // 步驟要按順序：後面的日期不能早於前面的；零申報不需要繳款
  const filled = columns.map(column => next[column]).filter(Boolean)
  if (filled.some((value, index) => index && value < filled[index - 1])) return fail(res, 400, '步驟日期不能早於前一步'), true
  if (next.paid_on && !next.filed_on) return fail(res, 400, '須先記錄已申報，才能記錄已繳款'), true
  if (zero && next.paid_on) return fail(res, 400, '零申報不需要記錄繳款'), true
  db.prepare('UPDATE filing_periods SET docs_received_on=?, sent_to_firm_on=?, filed_on=?, paid_on=?, tax_amount=?, zero_filing=?, notes=?, updated_by=?, updated_at=? WHERE id=?')
    .run(next.docs_received_on, next.sent_to_firm_on, next.filed_on, next.paid_on, zero ? 0 : body.taxAmount === undefined ? filing.tax_amount : body.taxAmount, zero ? 1 : 0, body.notes === undefined ? filing.notes : clean(body.notes, 1000) || null, user.id, now(), filing.id)
  return json(res, 200, filingView(db.prepare('SELECT * FROM filing_periods WHERE id=?').get(filing.id))), true
}
