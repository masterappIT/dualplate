import { db, now } from './db.js'
import { services } from './catalog.js'
import { currencies } from './rentals.js'
import { catalogue, categories, customerCodes } from './entrustment.js'
import { insertFee } from './fees.js'

// How each item is charged (docs/tasks/scope-items-design.md §5): the tenant price list holds defaults per item and route;
// a customer's special price overrides one item and route. Plate items and one-off jobs are priced per route (粵港／粵澳);
// company items have one price (route ''). Amounts are cents. Admin only; the client app never shows prices.
db.exec(`CREATE TABLE IF NOT EXISTS price_items(tenant_id TEXT NOT NULL, item_code TEXT NOT NULL, route TEXT NOT NULL, billing TEXT NOT NULL, currency TEXT, amount INTEGER, updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id, item_code, route));
CREATE TABLE IF NOT EXISTS customer_prices(customer_id TEXT NOT NULL, tenant_id TEXT NOT NULL, item_code TEXT NOT NULL, route TEXT NOT NULL, billing TEXT NOT NULL, currency TEXT, amount INTEGER, updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(customer_id, item_code, route))`)

export const billings = { annual: '年費內', per_time: '按次收費', free: '不收' }
const routes = ['粵港', '粵澳']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Everything that can carry a price: listed items by category, then the one-off jobs (work-order services).
export function priceItems(tenantId) {
  const items = catalogue(tenantId).filter(item => item.active).map(item => {
    const category = item.scope === 'company' ? item.categories.length === 1 ? item.categories[0] : 'company' : 'plate'
    return { code: item.code, name: item.name, kind: 'item', category, group: item.group, routes: category === 'plate' ? routes : [''] }
  })
  const jobs = services.map(service => ({ code: `job:${service.code}`, name: service.name, kind: 'job', category: 'job', group: null, routes: service.routes }))
  return [...items, ...jobs]
}
export const priceCategories = { ...categories, company: '公司（各地）', job: '按次業務' }

const fallback = (item, route) => item.kind === 'job' ? { billing: 'per_time', currency: route === '粵澳' ? 'MOP' : 'HKD', amount: null } : { billing: 'annual', currency: null, amount: null }
const view = row => ({ billing: row.billing, currency: row.currency || null, amount: row.amount ?? null })

// The price in effect for one customer (or the tenant default when customerId is null), with where it came from.
export function priceFor(tenantId, customerId, code, route = '') {
  const item = priceItems(tenantId).find(entry => entry.code === code)
  if (!item) return null
  const key = item.routes.includes(route) ? route : item.routes[0]
  const special = customerId && db.prepare('SELECT * FROM customer_prices WHERE customer_id=? AND item_code=? AND route=?').get(customerId, code, key)
  if (special) return { ...view(special), source: 'customer' }
  const base = db.prepare('SELECT * FROM price_items WHERE tenant_id=? AND item_code=? AND route=?').get(tenantId, code, key)
  return { ...(base ? view(base) : fallback(item, key)), source: base ? 'tenant' : 'default' }
}

// Validates { code, route, billing, currency, amount }; returns { error } or the clean row.
function checkPrice(tenantId, body) {
  if (!isObject(body) || typeof body.code !== 'string' || typeof body.route !== 'string') return { error: '內容無效' }
  const item = priceItems(tenantId).find(entry => entry.code === body.code)
  if (!item) return { error: '事項或業務不存在' }
  if (!item.routes.includes(body.route)) return { error: '路線不適用於此事項' }
  if (body.reset !== undefined) return body.reset === true ? { item, reset: true } : { error: '內容無效' }
  if (!Object.hasOwn(billings, body.billing)) return { error: '收費方式須為年費內、按次收費或不收' }
  if (body.billing !== 'per_time') return { item, row: { billing: body.billing, currency: null, amount: null } }
  if (!currencies.includes(body.currency)) return { error: '幣種須為 HKD、RMB 或 MOP' }
  if (!Number.isInteger(body.amount) || body.amount <= 0 || body.amount > 1e12) return { error: '按次收費須填寫金額' }
  return { item, row: { billing: 'per_time', currency: body.currency, amount: body.amount } }
}

export function priceList(tenantId, customer = null) {
  const codes = customer ? customerCodes(tenantId, customer) : null
  return {
    categories: priceCategories, billings,
    items: priceItems(tenantId).filter(item => !codes || item.kind === 'job' || codes.has(item.code)).map(item => ({ ...item, prices: Object.fromEntries(item.routes.map(route => [route, priceFor(tenantId, customer?.id || null, item.code, route)])) }))
  }
}

// Work-order close: fees to suggest. An accepted quote wins (handled in fees.js); otherwise the customer's price for the job.
export function jobPrice(tenantId, request) {
  return priceFor(tenantId, request.customer_id, `job:${request.service_code}`, request.route)
}
export function priceSuggestion(tenantId, request) {
  const price = jobPrice(tenantId, request), service = services.find(item => item.code === request.service_code)
  if (!price) return { basis: 'none', fees: [] }
  if (price.billing === 'annual') return { basis: 'annual', fees: [] }
  if (price.billing === 'free') return { basis: 'free', fees: [] }
  return price.amount ? { basis: 'price', fees: [{ kind: 'service', description: `${service?.name || request.title}代辦費`, currency: price.currency, amount: price.amount }] } : { basis: 'unpriced', fees: [] }
}
// Staff cannot see or record fees; when they close a job charged per time, an unpaid fee is recorded for the admin to check.
export function staffCloseFee(tenantId, request, userId) {
  const customer = db.prepare('SELECT is_self FROM customers WHERE id=?').get(request.customer_id)
  if (customer?.is_self || db.prepare("SELECT id FROM quotes WHERE request_id=? AND status='已接受'").get(request.id)) return null
  const suggestion = priceSuggestion(tenantId, request)
  if (suggestion.basis !== 'price') return null
  const fee = suggestion.fees[0]
  return insertFee(tenantId, { customerId: request.customer_id, kind: 'service', requestId: request.id, plateId: request.plate_asset_id, description: fee.description, currency: fee.currency, amount: fee.amount, periodKey: `close:${request.id}`, notes: '員工結案自動產生，請核對' }, userId)
}

export async function pricingRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const customerMatch = path.match(/^\/api\/customers\/([^/]+)\/prices$/)
  if (path !== '/api/price-list' && !customerMatch) return false
  if (user.role !== 'admin') return fail(res, 403, '收費只限管理者'), true
  if (path === '/api/price-list') {
    if (method === 'GET') return json(res, 200, priceList(tenant)), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req), checked = checkPrice(tenant, body)
    if (checked.error) return fail(res, 400, checked.error), true
    if (checked.reset) db.prepare('DELETE FROM price_items WHERE tenant_id=? AND item_code=? AND route=?').run(tenant, checked.item.code, body.route)
    else db.prepare('INSERT INTO price_items(tenant_id,item_code,route,billing,currency,amount,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,item_code,route) DO UPDATE SET billing=excluded.billing,currency=excluded.currency,amount=excluded.amount,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
      .run(tenant, checked.item.code, body.route, checked.row.billing, checked.row.currency, checked.row.amount, user.id, now())
    return json(res, 200, priceList(tenant)), true
  }
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerMatch[1], tenant)
  if (!customer) return fail(res, 404, '客戶不存在'), true
  if (method === 'GET') return json(res, 200, priceList(tenant, customer)), true
  if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
  if (customer.is_self) return fail(res, 400, '本公司自有不設收費'), true
  const body = await parseBody(req), checked = checkPrice(tenant, body)
  if (checked.error) return fail(res, 400, checked.error), true
  if (checked.item.kind === 'item' && !customerCodes(tenant, customer).has(checked.item.code)) return fail(res, 400, '此事項不在該客戶的委託清單'), true
  if (checked.reset) db.prepare('DELETE FROM customer_prices WHERE customer_id=? AND item_code=? AND route=?').run(customer.id, checked.item.code, body.route)
  else db.prepare('INSERT INTO customer_prices(customer_id,tenant_id,item_code,route,billing,currency,amount,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(customer_id,item_code,route) DO UPDATE SET billing=excluded.billing,currency=excluded.currency,amount=excluded.amount,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
    .run(customer.id, tenant, checked.item.code, body.route, checked.row.billing, checked.row.currency, checked.row.amount, user.id, now())
  return json(res, 200, priceList(tenant, customer)), true
}
