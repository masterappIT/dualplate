import { db, id, now } from './db.js'
import { businessToday } from './rules.js'
import { currencies } from './rentals.js'
import { sniff } from './client-portal.js'

// 收費、代墊與報價（docs/tasks/fees-brief.md）。只限管理者；金額以「分」為單位的整數，按幣種分開合計，不換算。
db.exec(`CREATE TABLE IF NOT EXISTS fee_items(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT, plate_asset_id TEXT, description TEXT NOT NULL, currency TEXT NOT NULL, amount INTEGER NOT NULL,
  incurred_on TEXT NOT NULL, due_on TEXT, voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, installment_plan_id TEXT, installment_seq INTEGER, customer_confirmed_at TEXT, period_key TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fee_items_customer ON fee_items(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_items_period ON fee_items(customer_id, kind, period_key) WHERE period_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS fee_payments(id TEXT PRIMARY KEY, fee_item_id TEXT NOT NULL, paid_on TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, proof_mime TEXT, proof BLOB, recorded_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS installment_plans(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, request_id TEXT, name TEXT NOT NULL, currency TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customer_billing(customer_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, annual_amount INTEGER NOT NULL, currency TEXT NOT NULL, bill_month INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_by TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, service_code TEXT, route TEXT, title TEXT NOT NULL, currency TEXT NOT NULL, items_json TEXT NOT NULL, valid_until TEXT NOT NULL, status TEXT NOT NULL DEFAULT '草擬', request_id TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`)

export const feeKinds = { annual: '年費', service: '代辦費', gov_fee: '政府規費', advance: '代墊', rent_commission: '租金管理費' }
const manualKinds = ['annual', 'service', 'gov_fee', 'advance']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString?.().slice(0, 10) === value
const safeDate = value => { try { return validDate(value) } catch { return false } }
const cents = value => Number.isInteger(value) && value > 0 && value <= 1e12
const today = () => businessToday().toISOString().slice(0, 10)
const sumBy = list => Object.fromEntries(currencies.map(currency => [currency, list.filter(item => item.currency === currency).reduce((total, item) => total + item.value, 0)]).filter(([, total]) => total))

const customerOf = (tenantId, customerId) => typeof customerId === 'string' ? db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId) || null : null
const feeFor = (tenantId, feeId) => typeof feeId === 'string' ? db.prepare('SELECT * FROM fee_items WHERE id=? AND tenant_id=?').get(feeId, tenantId) || null : null
const paidOf = feeId => db.prepare('SELECT COALESCE(SUM(amount),0) total FROM fee_payments WHERE fee_item_id=?').get(feeId).total
export function feeStatus(row, paid = paidOf(row.id)) { return row.voided ? '作廢' : paid >= row.amount ? '已收' : paid > 0 ? '部分收' : '未收' }
function feeView(row) {
  const paid = paidOf(row.id), status = feeStatus(row, paid)
  const payments = db.prepare('SELECT id, paid_on, amount, method, proof_mime IS NOT NULL has_proof FROM fee_payments WHERE fee_item_id=? ORDER BY paid_on').all(row.id)
  return { id: row.id, customerId: row.customer_id, kind: row.kind, kindLabel: feeKinds[row.kind], requestId: row.request_id, plateId: row.plate_asset_id, description: row.description, currency: row.currency, amount: row.amount, paid, outstanding: status === '作廢' ? 0 : Math.max(0, row.amount - paid),
    incurredOn: row.incurred_on, dueOn: row.due_on, status, overdue: ['未收', '部分收'].includes(status) && Boolean(row.due_on) && row.due_on < today(), voidReason: row.void_reason || '', installmentPlanId: row.installment_plan_id, installmentSeq: row.installment_seq, customerConfirmedAt: row.customer_confirmed_at, notes: row.notes || '',
    payments: payments.map(item => ({ id: item.id, paidOn: item.paid_on, amount: item.amount, method: item.method, hasProof: Boolean(item.has_proof) })) }
}
export function insertFee(tenantId, fields, userId) {
  const feeId = id()
  const result = db.prepare('INSERT OR IGNORE INTO fee_items(id,tenant_id,customer_id,kind,request_id,plate_asset_id,description,currency,amount,incurred_on,due_on,installment_plan_id,installment_seq,period_key,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(feeId, tenantId, fields.customerId, fields.kind, fields.requestId || null, fields.plateId || null, fields.description, fields.currency, fields.amount, fields.incurredOn || today(), fields.dueOn || null, fields.planId || null, fields.seq || null, fields.periodKey || null, fields.notes || null, userId || null, now(), now())
  return result.changes ? feeId : null
}
// 驗證一筆收費；回傳錯誤訊息或 null
function checkFee(item, { allowKinds = manualKinds } = {}) {
  if (!isObject(item)) return '收費資料無效'
  if (!allowKinds.includes(item.kind)) return '收費類別無效'
  if (!currencies.includes(item.currency)) return '幣種須為 HKD、RMB 或 MOP'
  if (!cents(item.amount)) return '金額須為以「分」為單位的正整數'
  if (typeof item.description !== 'string' || !item.description.trim()) return '請填寫收費說明'
  for (const key of ['incurredOn', 'dueOn']) if (item[key] !== undefined && item[key] !== null && item[key] !== '' && !safeDate(item[key])) return '日期無效'
  return null
}

// 每年該月 1 日起自動產生年費（冪等：同客戶同年只一筆）
export function ensureAnnualFees(tenantId) {
  const day = today(), year = day.slice(0, 4), month = Number(day.slice(5, 7))
  for (const billing of db.prepare("SELECT b.*, c.is_self FROM customer_billing b JOIN customers c ON c.id=b.customer_id WHERE b.tenant_id=? AND b.active=1").all(tenantId)) {
    if (billing.is_self || month < billing.bill_month) continue
    const start = `${year}-${String(billing.bill_month).padStart(2, '0')}-01`
    insertFee(tenantId, { customerId: billing.customer_id, kind: 'annual', description: `${year} 年度年費`, currency: billing.currency, amount: billing.annual_amount, incurredOn: start, dueOn: start, periodKey: year })
  }
}

// 代收租金入帳時產生租金管理費（從應付客戶的租金中扣除，所以同時記為已收）；撤銷收款時作廢。由 rentals 呼叫。
export function rentCommission(tenantId, contract, invoice, received) {
  const plate = db.prepare('SELECT p.customer_id, p.mainland_plate, c.is_self FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').get(contract.plate_asset_id)
  const key = `rent:${invoice.id}`
  const existing = db.prepare("SELECT * FROM fee_items WHERE customer_id=? AND kind='rent_commission' AND period_key=?").get(plate.customer_id, key)
  if (!received) { if (existing && !existing.voided) { db.prepare('DELETE FROM fee_payments WHERE fee_item_id=?').run(existing.id); db.prepare("UPDATE fee_items SET voided=1, void_reason='撤銷租金收款', updated_at=? WHERE id=?").run(now(), existing.id) } return }
  if (plate.is_self || contract.collection_mode !== '代收' || contract.fee_type === 'none') return
  const amount = contract.fee_type === 'fixed' ? contract.fee_value : Math.round(invoice.received_amount * contract.fee_value / 100)
  if (!amount) return
  if (existing) { db.prepare('DELETE FROM fee_items WHERE id=?').run(existing.id); db.prepare('DELETE FROM fee_payments WHERE fee_item_id=?').run(existing.id) }
  const feeId = insertFee(tenantId, { customerId: plate.customer_id, kind: 'rent_commission', plateId: contract.plate_asset_id, description: `${invoice.period} 租金管理費（${plate.mainland_plate || '車牌待補'}）`, currency: contract.currency, amount, incurredOn: invoice.received_on, dueOn: invoice.received_on, periodKey: key })
  if (feeId) db.prepare("INSERT INTO fee_payments(id,fee_item_id,paid_on,amount,method,created_at) VALUES (?,?,?,?,'從代收租金扣除',?)").run(id(), feeId, invoice.received_on, amount, now())
}

// 工單結案時記錄本單收費：[{kind, currency, amount, description}]；回傳筆數，資料無效回傳 null
export function checkRequestFees(fees) {
  if (fees === undefined) return null
  if (!Array.isArray(fees) || fees.length > 20) return '本單收費格式無效'
  for (const fee of fees) { const problem = checkFee(fee, { allowKinds: ['service', 'gov_fee', 'advance'] }); if (problem) return problem }
  return null
}
export function recordRequestFees(tenantId, request, fees, userId) {
  const customer = db.prepare('SELECT is_self FROM customers WHERE id=?').get(request.customer_id)
  if (!fees?.length || customer?.is_self) return 0
  for (const fee of fees) insertFee(tenantId, { customerId: request.customer_id, kind: fee.kind, requestId: request.id, plateId: request.plate_asset_id, description: clean(fee.description), currency: fee.currency, amount: fee.amount, dueOn: fee.dueOn || null }, userId)
  return fees.length
}
// 報價轉成工單後，結案對話框可帶入預計收費
export function expectedFees(requestId) {
  const quote = db.prepare("SELECT * FROM quotes WHERE request_id=? AND status='已接受'").get(requestId)
  return quote ? JSON.parse(quote.items_json).map(item => ({ ...item, currency: quote.currency })) : []
}

function quoteView(row) {
  if (row.status === '已發出' && row.valid_until < today()) { db.prepare("UPDATE quotes SET status='已失效', updated_at=? WHERE id=?").run(now(), row.id); row = { ...row, status: '已失效' } }
  const items = JSON.parse(row.items_json), customer = db.prepare('SELECT name FROM customers WHERE id=?').get(row.customer_id)
  return { id: row.id, customerId: row.customer_id, customerName: customer?.name || '', serviceCode: row.service_code, route: row.route, title: row.title, currency: row.currency, items, total: items.reduce((total, item) => total + item.amount, 0), validUntil: row.valid_until, status: row.status, requestId: row.request_id, notes: row.notes || '', createdAt: row.created_at }
}
function checkQuote(body, existing) {
  if (!isObject(body)) return '內容無效'
  const title = body.title ?? existing?.title; if (typeof title !== 'string' || !title.trim()) return '請填寫報價標題'
  const currency = body.currency ?? existing?.currency; if (!currencies.includes(currency)) return '幣種須為 HKD、RMB 或 MOP'
  const validUntil = body.validUntil ?? existing?.valid_until; if (!safeDate(validUntil)) return '有效期無效'
  const items = body.items ?? (existing ? JSON.parse(existing.items_json) : undefined)
  if (!Array.isArray(items) || !items.length || items.length > 30) return '報價須有 1–30 個項目'
  for (const item of items) if (!isObject(item) || !['service', 'gov_fee', 'advance'].includes(item.kind) || !cents(item.amount) || typeof item.description !== 'string' || !item.description.trim()) return '報價項目無效（類別、說明、金額）'
  return null
}
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const money = (currency, value) => `${currency} ${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function quotePrint(quote, tenantName) {
  const rows = quote.items.map(item => `<tr><td>${html(feeKinds[item.kind])}</td><td>${html(item.description)}</td><td class="n">${money(quote.currency, item.amount)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>報價單 ${html(quote.title)}</title><style>
@page{size:A4;margin:18mm}body{font-family:-apple-system,'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif;color:#14201B;margin:0}
.sheet{max-width:174mm;margin:0 auto;padding:24px 0}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0F5C4A;padding-bottom:14px}
.seal{width:52px;height:52px;border:3px solid #0F5C4A;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#0F5C4A;font-weight:900;font-size:22px}
h1{margin:0;font-size:22px;color:#0B3B30}.eyebrow{color:#0F5C4A;font-size:12px;letter-spacing:2px;font-weight:800}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0;font-size:13px}.meta b{display:block;color:#4E5D55;font-size:11px;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 6px;border-bottom:1px solid #E2E1D8;text-align:left}th{color:#4E5D55;font-size:11px}.n{text-align:right;font-variant-numeric:tabular-nums}
.total td{border-top:2px solid #0F5C4A;font-weight:800;font-size:15px}.note{margin-top:18px;color:#4E5D55;font-size:12px;line-height:1.7}.rule{margin:22px -6px;border-top:2px dashed #E2E1D8}
</style></head><body><div class="sheet"><div class="head"><div><div class="eyebrow">報價單</div><h1>${html(quote.title)}</h1><div style="margin-top:6px;font-size:13px">${html(tenantName)}</div></div><div class="seal">牌</div></div>
<div class="meta"><div><b>客戶</b>${html(quote.customerName)}</div><div><b>有效期至</b>${html(quote.validUntil)}</div><div><b>幣種</b>${html(quote.currency)}</div></div>
<table><thead><tr><th>類別</th><th>項目</th><th class="n">金額</th></tr></thead><tbody>${rows}<tr class="total"><td></td><td>合計</td><td class="n">${money(quote.currency, quote.total)}</td></tr></tbody></table>
<div class="rule"></div><div class="note">政府規費按官方實際收費為準，代墊項目按實際支出向客戶收回。${quote.notes ? `<br>${html(quote.notes)}` : ''}</div></div></body></html>`
}

export async function feeRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  // 客戶：自己的帳單（只讀）與分期確認
  if (path === '/api/my/fees' || /^\/api\/my\/fees\/[^/]+\/confirm$/.test(path)) {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    ensureAnnualFees(tenant)
    if (path === '/api/my/fees') {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const items = db.prepare('SELECT * FROM fee_items WHERE customer_id=? AND tenant_id=? AND voided=0 ORDER BY COALESCE(due_on, incurred_on) DESC').all(user.customer_id, tenant).map(feeView)
      // 客戶端不寫「租金」：代收使用費的管理費稱「代收服務費」
      const words = item => item.kind === 'rent_commission' ? { ...item, kindLabel: '代收服務費', description: item.description.replace('租金管理費', '代收使用費服務費') } : item
      return json(res, 200, { outstanding: sumBy(items.map(item => ({ currency: item.currency, value: item.outstanding }))), items: items.map(words).map(({ id: feeId, kind, kindLabel, description, currency, amount, paid, outstanding, dueOn, status, overdue, installmentPlanId, customerConfirmedAt }) => ({ id: feeId, kind, kindLabel, description, currency, amount, paid, outstanding, dueOn, status, overdue, needsConfirm: Boolean(installmentPlanId) && !customerConfirmedAt })) }), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const fee = db.prepare('SELECT * FROM fee_items WHERE id=? AND customer_id=? AND tenant_id=? AND voided=0').get(path.split('/')[4], user.customer_id, tenant)
    if (!fee) return fail(res, 404, '帳單不存在'), true
    if (!fee.installment_plan_id) return fail(res, 400, '只有分期款項需要確認'), true
    if (fee.customer_confirmed_at) return fail(res, 409, '這期已確認'), true
    db.prepare('UPDATE fee_items SET customer_confirmed_at=?, updated_at=? WHERE id=?').run(now(), now(), fee.id)
    return json(res, 200, feeView(feeFor(tenant, fee.id))), true
  }
  // 一次記多筆收款（例如客戶一次付清幾筆）：每筆按未收金額全數收妥；全部合格才在同一交易內寫入
  if (path === '/api/fees/batch-payments') {
    if (user.role !== 'admin') return fail(res, 403, '收費只限管理者'), true
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body) || !Array.isArray(body.feeIds) || !body.feeIds.length || body.feeIds.length > 200 || body.feeIds.some(feeId => typeof feeId !== 'string' || !feeId.trim()) || new Set(body.feeIds).size !== body.feeIds.length) return fail(res, 400, '請選擇 1–200 筆收費'), true
    if (!safeDate(body.paidOn)) return fail(res, 400, '收款日期無效'), true
    if (typeof body.method !== 'string' || !body.method.trim()) return fail(res, 400, '請填寫收款方式'), true
    ensureAnnualFees(tenant)
    const fees = body.feeIds.map(feeId => feeFor(tenant, feeId))
    const missing = fees.findIndex(fee => !fee)
    if (missing >= 0) return fail(res, 404, `第 ${missing + 1} 筆收費不存在`), true
    const blocked = fees.findIndex(fee => fee.voided || fee.amount - paidOf(fee.id) <= 0)
    if (blocked >= 0) return fail(res, 409, `「${fees[blocked].description}」${fees[blocked].voided ? '已作廢' : '已全數收妥'}`), true
    const insert = db.prepare('INSERT INTO fee_payments(id,fee_item_id,paid_on,amount,method,proof_mime,proof,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const fee of fees) insert.run(id(), fee.id, body.paidOn, fee.amount - paidOf(fee.id), clean(body.method, 40), null, null, user.id, now())
      db.exec('COMMIT')
    } catch (failure) { db.exec('ROLLBACK'); throw failure }
    return json(res, 200, { paid: fees.length, items: fees.map(fee => feeView(feeFor(tenant, fee.id))) }), true
  }
  const feeMatch = path.match(/^\/api\/fees(?:\/([^/]+)(?:\/(void|payments)(?:\/([^/]+))?)?)?$/)
  const billingMatch = path.match(/^\/api\/customers\/([^/]+)\/billing$/)
  const planMatch = path === '/api/installment-plans'
  const quoteMatch = path.match(/^\/api\/quotes(?:\/([^/]+)(?:\/(send|accept|print))?)?$/)
  if (!feeMatch && !billingMatch && !planMatch && !quoteMatch) return false
  if (user.role !== 'admin') return fail(res, 403, '收費只限管理者'), true
  ensureAnnualFees(tenant)

  if (billingMatch) {
    const customer = customerOf(tenant, billingMatch[1]); if (!customer) return fail(res, 404, '客戶不存在'), true
    const current = db.prepare('SELECT * FROM customer_billing WHERE customer_id=?').get(customer.id)
    const view = row => row ? { annualAmount: row.annual_amount, currency: row.currency, billMonth: row.bill_month, active: Boolean(row.active) } : null
    if (method === 'GET') return json(res, 200, view(current)), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    if (customer.is_self) return fail(res, 400, '本公司自有客戶不產生收費'), true
    const body = await parseBody(req)
    if (!isObject(body) || !cents(body.annualAmount) || !currencies.includes(body.currency) || !Number.isInteger(body.billMonth) || body.billMonth < 1 || body.billMonth > 12 || (body.active !== undefined && typeof body.active !== 'boolean')) return fail(res, 400, '年費金額、幣種或計費月份無效'), true
    db.prepare('INSERT INTO customer_billing(customer_id,tenant_id,annual_amount,currency,bill_month,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET annual_amount=excluded.annual_amount,currency=excluded.currency,bill_month=excluded.bill_month,active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
      .run(customer.id, tenant, body.annualAmount, body.currency, body.billMonth, body.active === false ? 0 : 1, user.id, now())
    ensureAnnualFees(tenant)
    return json(res, 200, view(db.prepare('SELECT * FROM customer_billing WHERE customer_id=?').get(customer.id))), true
  }

  if (planMatch) {
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body)) return fail(res, 400, '內容無效'), true
    const customer = customerOf(tenant, body.customerId); if (!customer) return fail(res, 404, '客戶不存在'), true
    if (customer.is_self) return fail(res, 400, '本公司自有客戶不產生收費'), true
    if (typeof body.name !== 'string' || !body.name.trim() || !currencies.includes(body.currency)) return fail(res, 400, '請填寫分期名稱與幣種'), true
    if (!Array.isArray(body.installments) || body.installments.length < 2 || body.installments.length > 12) return fail(res, 400, '分期須有 2–12 期'), true
    for (const item of body.installments) if (!isObject(item) || typeof item.name !== 'string' || !item.name.trim() || !cents(item.amount) || !safeDate(item.dueOn)) return fail(res, 400, '每期須有名稱、金額和到期日'), true
    if (body.requestId !== undefined && body.requestId !== null && !db.prepare('SELECT id FROM requests WHERE id=? AND customer_id=?').get(body.requestId, customer.id)) return fail(res, 400, '工單不屬於這位客戶'), true
    const planId = id()
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO installment_plans(id,tenant_id,customer_id,request_id,name,currency,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(planId, tenant, customer.id, body.requestId || null, clean(body.name), body.currency, user.id, now())
      body.installments.forEach((item, index) => insertFee(tenant, { customerId: customer.id, kind: 'service', requestId: body.requestId, description: `${clean(body.name)}：${clean(item.name)}`, currency: body.currency, amount: item.amount, dueOn: item.dueOn, planId, seq: index + 1 }, user.id))
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 201, { id: planId, items: db.prepare('SELECT * FROM fee_items WHERE installment_plan_id=? ORDER BY installment_seq').all(planId).map(feeView) }), true
  }

  if (quoteMatch) {
    if (!quoteMatch[1]) {
      if (method === 'GET') {
        const customerId = url.searchParams.get('customerId')
        return json(res, 200, db.prepare(`SELECT * FROM quotes WHERE tenant_id=? ${customerId ? 'AND customer_id=?' : ''} ORDER BY created_at DESC`).all(tenant, ...(customerId ? [customerId] : [])).map(quoteView)), true
      }
      if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
      const body = await parseBody(req), problem = checkQuote(body, null)
      if (problem) return fail(res, 400, problem), true
      const customer = customerOf(tenant, body.customerId); if (!customer) return fail(res, 404, '客戶不存在'), true
      if (customer.is_self) return fail(res, 400, '本公司自有客戶不產生收費'), true
      const quoteId = id()
      db.prepare('INSERT INTO quotes(id,tenant_id,customer_id,service_code,route,title,currency,items_json,valid_until,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(quoteId, tenant, customer.id, clean(body.serviceCode, 40) || null, clean(body.route, 10) || null, clean(body.title), body.currency, JSON.stringify(body.items.map(item => ({ kind: item.kind, description: clean(item.description), amount: item.amount }))), body.validUntil, '草擬', clean(body.notes, 1000) || null, user.id, now(), now())
      return json(res, 201, quoteView(db.prepare('SELECT * FROM quotes WHERE id=?').get(quoteId))), true
    }
    const row = db.prepare('SELECT * FROM quotes WHERE id=? AND tenant_id=?').get(quoteMatch[1], tenant)
    if (!row) return fail(res, 404, '報價不存在'), true
    const quote = quoteView(row)
    if (quoteMatch[2] === 'print') {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const tenantName = db.prepare('SELECT name FROM tenants WHERE id=?').get(tenant)?.name || ''
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(quotePrint(quote, tenantName)); return true
    }
    if (quoteMatch[2]) {
      if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
      const from = quoteMatch[2] === 'send' ? '草擬' : '已發出', to = quoteMatch[2] === 'send' ? '已發出' : '已接受'
      if (quote.status !== from) return fail(res, 409, `只有「${from}」的報價可以${quoteMatch[2] === 'send' ? '發出' : '標記為已接受'}`), true
      db.prepare('UPDATE quotes SET status=?, updated_at=? WHERE id=?').run(to, now(), quote.id)
      return json(res, 200, quoteView(db.prepare('SELECT * FROM quotes WHERE id=?').get(quote.id))), true
    }
    if (method === 'GET') return json(res, 200, quote), true
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    if (quote.status !== '草擬') return fail(res, 409, '只有草擬的報價可以修改'), true
    const body = await parseBody(req), problem = checkQuote(body, row)
    if (problem) return fail(res, 400, problem), true
    if (body.customerId !== undefined && body.customerId !== row.customer_id) return fail(res, 400, '報價不可轉到其他客戶'), true
    db.prepare('UPDATE quotes SET title=?, currency=?, items_json=?, valid_until=?, notes=?, service_code=?, route=?, updated_at=? WHERE id=?')
      .run(clean(body.title ?? row.title), body.currency ?? row.currency, JSON.stringify((body.items ?? JSON.parse(row.items_json)).map(item => ({ kind: item.kind, description: clean(item.description), amount: item.amount }))), body.validUntil ?? row.valid_until, body.notes === undefined ? row.notes : clean(body.notes, 1000) || null, body.serviceCode === undefined ? row.service_code : clean(body.serviceCode, 40) || null, body.route === undefined ? row.route : clean(body.route, 10) || null, now(), row.id)
    return json(res, 200, quoteView(db.prepare('SELECT * FROM quotes WHERE id=?').get(row.id))), true
  }

  // 收費項目
  if (!feeMatch[1]) {
    if (method === 'GET') {
      const { customerId, status, kind, overdue } = Object.fromEntries(url.searchParams)
      if (customerId && !customerOf(tenant, customerId)) return fail(res, 404, '客戶不存在'), true
      let items = db.prepare(`SELECT * FROM fee_items WHERE tenant_id=? ${customerId ? 'AND customer_id=?' : ''} ${kind ? 'AND kind=?' : ''} ORDER BY COALESCE(due_on, incurred_on) DESC`).all(tenant, ...[customerId, kind].filter(Boolean)).map(feeView)
      if (status) items = items.filter(item => item.status === status)
      if (overdue === '1') items = items.filter(item => item.overdue)
      const names = new Map(db.prepare('SELECT id,name FROM customers WHERE tenant_id=?').all(tenant).map(item => [item.id, item.name]))
      const live = items.filter(item => item.status !== '作廢')
      return json(res, 200, { totals: { amount: sumBy(live.map(item => ({ currency: item.currency, value: item.amount }))), paid: sumBy(live.map(item => ({ currency: item.currency, value: item.paid }))), outstanding: sumBy(live.map(item => ({ currency: item.currency, value: item.outstanding }))) }, items: items.map(item => ({ ...item, customerName: names.get(item.customerId) || '' })) }), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req), problem = checkFee(body)
    if (problem) return fail(res, 400, problem), true
    const customer = customerOf(tenant, body.customerId); if (!customer) return fail(res, 404, '客戶不存在'), true
    if (customer.is_self) return fail(res, 400, '本公司自有客戶不產生收費'), true
    if (body.requestId && !db.prepare('SELECT id FROM requests WHERE id=? AND customer_id=?').get(body.requestId, customer.id)) return fail(res, 400, '工單不屬於這位客戶'), true
    if (body.plateId && !db.prepare('SELECT id FROM plate_assets WHERE id=? AND customer_id=?').get(body.plateId, customer.id)) return fail(res, 400, '牌照不屬於這位客戶'), true
    const feeId = insertFee(tenant, { ...body, customerId: customer.id, description: clean(body.description), notes: clean(body.notes, 1000) }, user.id)
    return json(res, 201, feeView(feeFor(tenant, feeId))), true
  }
  const fee = feeFor(tenant, feeMatch[1])
  if (!fee) return fail(res, 404, '收費項目不存在'), true
  if (feeMatch[2] === 'void') {
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (fee.voided) return fail(res, 409, '已作廢'), true
    if (paidOf(fee.id) > 0) return fail(res, 409, '已有收款記錄，請先撤銷收款'), true
    if (!isObject(body) || !clean(body.reason, 300)) return fail(res, 400, '請填寫作廢原因'), true
    db.prepare('UPDATE fee_items SET voided=1, void_reason=?, updated_at=? WHERE id=?').run(clean(body.reason, 300), now(), fee.id)
    return json(res, 200, feeView(feeFor(tenant, fee.id))), true
  }
  if (feeMatch[2] === 'payments') {
    if (feeMatch[3]) {
      if (method !== 'DELETE') return fail(res, 405, '不支援此操作'), true
      if (fee.kind === 'rent_commission') return fail(res, 400, '租金管理費隨租金收款撤銷'), true
      const removed = db.prepare('DELETE FROM fee_payments WHERE id=? AND fee_item_id=?').run(feeMatch[3], fee.id).changes
      if (!removed) return fail(res, 404, '收款記錄不存在'), true
      return json(res, 200, feeView(feeFor(tenant, fee.id))), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (fee.voided) return fail(res, 409, '已作廢的收費不可收款'), true
    if (!isObject(body) || !safeDate(body.paidOn) || !cents(body.amount)) return fail(res, 400, '收款日期或金額無效'), true
    if (typeof body.method !== 'string' || !body.method.trim()) return fail(res, 400, '請填寫收款方式'), true
    if (body.amount > fee.amount - paidOf(fee.id)) return fail(res, 400, '收款金額超過未收金額'), true
    let proof = null
    if (body.proof !== undefined && body.proof !== null) {
      const data = typeof body.proof === 'string' ? Buffer.from(body.proof.replace(/^data:[^,]+,/, ''), 'base64') : null
      if (!data?.length || data.length > 5 * 1024 * 1024 || !sniff(data)) return fail(res, 400, '收款憑證只接受 5 MB 以內的 JPG、PNG 或 PDF'), true
      proof = { data, mime: sniff(data) }
    }
    db.prepare('INSERT INTO fee_payments(id,fee_item_id,paid_on,amount,method,proof_mime,proof,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), fee.id, body.paidOn, body.amount, clean(body.method, 40), proof?.mime || null, proof?.data || null, user.id, now())
    return json(res, 201, feeView(feeFor(tenant, fee.id))), true
  }
  if (method === 'GET') return json(res, 200, feeView(fee)), true
  if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
  if (fee.voided) return fail(res, 409, '已作廢的收費不可修改'), true
  if (fee.kind === 'rent_commission') return fail(res, 400, '租金管理費由租金收款自動計算'), true
  const body = await parseBody(req)
  if (!isObject(body)) return fail(res, 400, '內容無效'), true
  if (body.customerId !== undefined && body.customerId !== fee.customer_id) return fail(res, 400, '收費不可轉到其他客戶'), true
  const merged = { kind: fee.kind, currency: body.currency ?? fee.currency, amount: body.amount ?? fee.amount, description: body.description ?? fee.description, dueOn: body.dueOn === undefined ? fee.due_on : body.dueOn }
  const problem = checkFee(merged); if (problem) return fail(res, 400, problem), true
  if (merged.amount < paidOf(fee.id)) return fail(res, 400, '金額不可少於已收金額'), true
  if (merged.currency !== fee.currency && paidOf(fee.id) > 0) return fail(res, 400, '已有收款記錄，不可改幣種'), true
  db.prepare('UPDATE fee_items SET currency=?, amount=?, description=?, due_on=?, notes=?, updated_at=? WHERE id=?').run(merged.currency, merged.amount, clean(merged.description), merged.dueOn || null, body.notes === undefined ? fee.notes : clean(body.notes, 1000) || null, now(), fee.id)
  return json(res, 200, feeView(feeFor(tenant, fee.id))), true
}
