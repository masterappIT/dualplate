import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { businessToday, itemGroups, defaultGroup, ruleMatches, clientOnlyItems } from './rules.js'
import { plateFacts } from './plate-facts.js'

// What a client entrusts to us (docs/tasks/scope-items-design.md). Three layers: the tenant's item catalogue (every rule
// plus two built-in items), each customer's own item list, and who handles each listed item per company or plate.
// service_scopes.service holds the item code; rows with the six old broad codes are history only (migration scope-items-v1).
export const legacyServices = { company_upkeep: '公司維護', bookkeeping: '每月報帳報稅', audit_tax: '審計及利得稅', secretary: '公司秘書', plate_service: '牌照業務代辦', rental_management: '出租代管' }
export const handlers = ['us', 'outsourced', 'client']
export const handlerLabels = { us: '我們做', outsourced: '外包', client: '客戶自理' }
export const categories = { hk: '香港公司', mo: '澳門公司', cn: '內地公司', plate: '車牌' }
const categoryOf = { 香港: 'hk', 澳門: 'mo', 內地: 'cn' }
// Items that are not rules: monthly filings (bookkeeping.js) and rent follow-up (rentals.js).
const builtins = [
  { code: 'monthly_filing', name: '每月報帳報稅', scope: 'company', categories: ['cn'], group: null, legacy: 'bookkeeping' },
  { code: 'rent_overdue', name: '租金跟進', scope: 'plate', categories: ['plate'], group: 'rental', legacy: 'rental_management' }
]

export function catalogue(tenantId) {
  // Client-only items (rules.js clientOnlyItems) are never entrusted, so they stay out of every list built from here.
  const rules = db.prepare('SELECT code, name, scope, match_json, active, service, item_group FROM rules WHERE tenant_id=? ORDER BY sort, name').all(tenantId).filter(rule => !clientOnlyItems.has(rule.code)).map(rule => {
    const jurisdiction = JSON.parse(rule.match_json).jurisdiction
    const companyCategories = jurisdiction ? [].concat(jurisdiction).map(value => categoryOf[value]).filter(Boolean) : ['hk', 'mo', 'cn']
    return { code: rule.code, name: rule.name, scope: rule.scope, match: JSON.parse(rule.match_json), categories: rule.scope === 'company' ? companyCategories : ['plate'], group: rule.scope === 'company' ? null : rule.item_group || defaultGroup(rule.scope), legacy: rule.service, active: Boolean(rule.active), builtin: false }
  })
  return [...builtins.map(item => ({ ...item, active: true, builtin: true })), ...rules]
}

const ownerCategory = (ownerType, owner) => ownerType === 'company' ? categoryOf[owner?.jurisdiction] : 'plate'
export const itemApplies = (item, ownerType, owner) => (ownerType === 'company') === (item.scope === 'company') && item.categories.includes(ownerCategory(ownerType, owner))
// Same, and the rule's own conditions hold for this company or plate (e.g. a 粵港 plate has no Macau permit, a plate
// without crossing reminders has no 90-day item). Vehicle and driver rules are checked on their own owners later.
const factsOf = (ownerType, owner) => ownerType === 'plate' ? plateFacts(owner) : { jurisdiction: owner.jurisdiction, companyStatus: owner.status || '存續' }
export const itemMatches = (item, ownerType, owner, facts = null) => itemApplies(item, ownerType, owner) && (item.scope !== ownerType || !item.match || ruleMatches(item, facts || factsOf(ownerType, owner)))
const itemView = item => ({ code: item.code, name: item.name, group: item.group, groupLabel: itemGroups[item.group] || '', builtin: item.builtin })

// A customer who never edited the list has every active item; the first edit freezes the list into customer_items.
export function customerCodes(tenantId, customer, items = catalogue(tenantId)) {
  if (!customer?.items_customized) return new Set(items.filter(item => item.active).map(item => item.code))
  const known = new Set(items.map(item => item.code))
  return new Set(db.prepare('SELECT item_code FROM customer_items WHERE customer_id=?').all(customer.id).map(row => row.item_code).filter(code => known.has(code)))
}

// Templates set who handles each category; the latest applied template is also the default for rows not set yet,
// so companies and plates added later follow it.
export const templates = {
  full: { label: '全權托管', handler: () => 'us' },
  plates_only: { label: '只管牌照', handler: category => category === 'plate' ? 'us' : 'client' },
  plates_and_mainland: { label: '牌照＋內地公司', handler: category => ['plate', 'cn'].includes(category) ? 'us' : 'client' }
}
const templateHandler = (customer, category, key = customer?.scope_template) => {
  const handler = templates[key]?.handler(category) || 'us'
  return customer?.is_self && handler === 'client' ? 'us' : handler
}

export function loadOwner(tenantId, ownerType, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) return null
  if (ownerType === 'company') return db.prepare('SELECT co.*, c.is_self FROM companies co JOIN customers c ON c.id=co.customer_id WHERE co.id=? AND co.tenant_id=?').get(ownerId, tenantId) || null
  if (ownerType === 'plate') return db.prepare('SELECT p.*, c.is_self FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.tenant_id=?').get(ownerId, tenantId) || null
  return null
}
const customerOf = (tenantId, customerId) => db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId) || null

// The book every deadline source asks: handling() gives { handler, providerName }, or null when the item is not on the
// customer's list (then nothing is reminded to anyone). get() returns the current explicit row, if any.
export function scopeMap(tenantId) {
  const items = catalogue(tenantId)
  const rows = new Map(db.prepare('SELECT * FROM service_scopes WHERE tenant_id=? AND ended_on IS NULL').all(tenantId).map(row => [`${row.owner_type}:${row.owner_id}:${row.service}`, row]))
  const customers = new Map(db.prepare('SELECT id, is_self, items_customized, scope_template FROM customers WHERE tenant_id=?').all(tenantId).map(row => [row.id, row]))
  const jurisdictions = new Map(db.prepare('SELECT id, jurisdiction FROM companies WHERE tenant_id=?').all(tenantId).map(row => [row.id, row.jurisdiction]))
  // Outsourced monthly filings name the accounting firm set on the company (one source with the filings page).
  const firms = new Map(db.prepare('SELECT co.id, f.name FROM companies co JOIN accounting_firms f ON f.id=co.accounting_firm_id WHERE co.tenant_id=?').all(tenantId).map(row => [row.id, row.name]))
  const lists = new Map()
  const listOf = customer => { if (!lists.has(customer.id)) lists.set(customer.id, customerCodes(tenantId, customer, items)); return lists.get(customer.id) }
  return {
    get: key => rows.get(key),
    handling(ownerType, ownerId, code, customerId) {
      const customer = customers.get(customerId)
      if (clientOnlyItems.has(code)) return { handler: customer?.is_self ? 'us' : 'client', providerName: '' }
      if (customer && !listOf(customer).has(code)) return null
      const row = rows.get(`${ownerType}:${ownerId}:${code}`)
      if (row) return { handler: row.handler, providerName: code === 'monthly_filing' && row.handler === 'outsourced' && firms.get(ownerId) || row.provider_name || '' }
      return { handler: templateHandler(customer, ownerType === 'company' ? categoryOf[jurisdictions.get(ownerId)] : 'plate'), providerName: '' }
    }
  }
}

// Items of one owner that are active, on its customer's list and apply to it.
export function ownerItems(tenantId, ownerType, owner) {
  const items = catalogue(tenantId), codes = customerCodes(tenantId, customerOf(tenantId, owner.customer_id), items)
  return items.filter(item => item.active && codes.has(item.code) && itemMatches(item, ownerType, owner))
}

export function scopesFor(tenantId, ownerType, ownerId) {
  const owner = loadOwner(tenantId, ownerType, ownerId)
  if (!owner) return null
  const book = scopeMap(tenantId), names = new Map(catalogue(tenantId).map(item => [item.code, item.name]))
  const rows = db.prepare('SELECT * FROM service_scopes WHERE tenant_id=? AND owner_type=? AND owner_id=? ORDER BY started_on DESC, updated_at DESC').all(tenantId, ownerType, ownerId)
  return {
    ownerType, ownerId,
    items: ownerItems(tenantId, ownerType, owner).map(item => {
      const current = book.get(`${ownerType}:${owner.id}:${item.code}`), handling = book.handling(ownerType, owner.id, item.code, owner.customer_id)
      return { ...itemView(item), item: item.code, label: item.name, handler: handling.handler, providerName: handling.providerName, startedOn: current?.started_on || null, notes: current?.notes || '', defaulted: !current }
    }),
    history: rows.map(row => ({ id: row.id, item: row.service, label: names.get(row.service) || legacyServices[row.service] || row.service, handler: row.handler, providerName: row.provider_name || '', startedOn: row.started_on, endedOn: row.ended_on, updatedBy: row.updated_by, updatedAt: row.updated_at }))
  }
}

// One requested change → item-level changes. `item` names one item; the old `service` codes expand to every listed item
// under that broad service, so older callers keep working. Returns { changes } or { error }.
export function expandChange(tenantId, ownerType, owner, change) {
  const items = ownerItems(tenantId, ownerType, owner)
  if (typeof change.item === 'string' && change.item) {
    if (!items.some(item => item.code === change.item)) return { error: '此事項不在該客戶的委託清單，或不適用於這個對象' }
    return { changes: [{ ...change, item: change.item }] }
  }
  if (typeof change.service === 'string' && Object.hasOwn(legacyServices, change.service)) {
    const matched = items.filter(item => item.legacy === change.service)
    if (!matched.length) return { error: '此服務項目不適用於這個對象' }
    return { changes: matched.map(item => ({ ...change, item: item.code })) }
  }
  if (typeof change.service === 'string' && items.some(item => item.code === change.service)) return { changes: [{ ...change, item: change.service }] }
  return { error: '此事項不在該客戶的委託清單，或不適用於這個對象' }
}

// Validates handler and provider; returns an error message or null.
export function checkScope(owner, { handler, providerName }) {
  if (!handlers.includes(handler)) return '負責方必須是我們做、外包或客戶自理'
  if (providerName !== undefined && providerName !== null && typeof providerName !== 'string') return '外包單位名稱無效'
  if (handler === 'outsourced' && (typeof providerName !== 'string' || !providerName.trim())) return '外包須填寫外包單位名稱'
  if (handler === 'client' && owner.is_self) return '本公司自有的項目不可設為客戶自理'
  return null
}

// Applies one change inside the caller's transaction. A change to what is already in effect (explicit row or template
// default) is a no-op, so history stays clean.
export function writeScope({ tenantId, ownerType, ownerId, item, handler, providerName, notes, userId }) {
  const current = db.prepare('SELECT * FROM service_scopes WHERE tenant_id=? AND owner_type=? AND owner_id=? AND service=? AND ended_on IS NULL').get(tenantId, ownerType, ownerId, item)
  const provider = handler === 'outsourced' ? String(providerName).trim().slice(0, 120) : ''
  if (!current) {
    const owner = loadOwner(tenantId, ownerType, ownerId)
    if (owner && templateHandler(customerOf(tenantId, owner.customer_id), ownerCategory(ownerType, owner)) === handler && !provider) return false
  } else if (current.handler === handler && (current.provider_name || '') === provider) return false
  const today = businessToday().toISOString().slice(0, 10), now = new Date().toISOString()
  if (current) db.prepare('UPDATE service_scopes SET ended_on=?, updated_at=? WHERE id=?').run(today, now, current.id)
  db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,provider_name,started_on,ended_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(), tenantId, ownerType, ownerId, item, handler, provider, today, String(notes || '').slice(0, 500), userId, now)
  return true
}

const plateLabel = plate => [plate.mainland_plate, plate.local_plate].filter(Boolean).join(' · ') || plate.card_number || '車牌待補'
const ownersOf = (tenantId, customerId) => ({
  companies: db.prepare('SELECT * FROM companies WHERE customer_id=? AND tenant_id=? ORDER BY name').all(customerId, tenantId),
  plates: db.prepare('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.customer_id=? AND c.tenant_id=? ORDER BY p.created_at').all(customerId, tenantId)
})

export function templateChanges(tenantId, customerId, templateKey) {
  const template = templates[templateKey]
  const customer = customerOf(tenantId, customerId)
  if (!template || !customer) return null
  const { companies, plates } = ownersOf(tenantId, customerId)
  const book = scopeMap(tenantId), items = catalogue(tenantId), codes = customerCodes(tenantId, customer, items)
  const changes = []
  for (const [ownerType, owner, label] of [...companies.map(item => ['company', item, item.name]), ...plates.map(item => ['plate', item, plateLabel(item)])]) {
    const to = templateHandler(customer, ownerCategory(ownerType, owner), templateKey)
    for (const item of items.filter(entry => entry.active && codes.has(entry.code) && itemMatches(entry, ownerType, owner))) {
      const from = book.handling(ownerType, owner.id, item.code, customer.id).handler
      // Outsourced is still ours to follow up, so a template that hands an item to us keeps the outsourcing.
      if (from !== to && !(from === 'outsourced' && to === 'us')) changes.push({ ownerType, ownerId: owner.id, ownerLabel: label, item: item.code, itemLabel: item.name, from, to, explicit: Boolean(book.get(`${ownerType}:${owner.id}:${item.code}`)) })
    }
  }
  return { template: templateKey, label: template.label, changes }
}

// Applying a template: it becomes the customer's default, and explicit rows that differ are rewritten. Inside a transaction.
export function applyTemplate(tenantId, customerId, preview, userId) {
  db.prepare('UPDATE customers SET scope_template=? WHERE id=? AND tenant_id=?').run(preview.template, customerId, tenantId)
  for (const change of preview.changes.filter(item => item.explicit)) writeScope({ tenantId, ownerType: change.ownerType, ownerId: change.ownerId, item: change.item, handler: change.to, providerName: '', notes: `套用範本：${preview.label}`, userId })
}

// The whole matrix of one customer, by category (docs/tasks/scope-items-design.md §6).
export function customerScope(tenantId, customerId) {
  const customer = customerOf(tenantId, customerId)
  if (!customer) return null
  const items = catalogue(tenantId).filter(item => item.active), codes = customerCodes(tenantId, customer, items)
  const book = scopeMap(tenantId), { companies, plates } = ownersOf(tenantId, customerId)
  const sections = Object.keys(categories).map(category => {
    const forCategory = items.filter(item => item.categories.includes(category) && (category === 'plate') === (item.scope !== 'company'))
    const listed = forCategory.filter(item => codes.has(item.code))
    const owners = category === 'plate'
      ? plates.map(plate => ({ row: plate, type: 'plate', id: plate.id, label: plateLabel(plate), route: plate.route || '' }))
      : companies.filter(company => categoryOf[company.jurisdiction] === category).map(company => ({ row: company, type: 'company', id: company.id, label: company.name, nameEn: company.name_en || '', status: company.status || '存續', plates: plates.filter(plate => plate.group_id && plate.group_id === company.group_id).map(plate => plate.mainland_plate || plate.local_plate || plate.card_number || '車牌待補') }))
    // Cells only for items whose conditions hold for that owner; the page shows the rest as 不適用.
    return {
      category, label: categories[category], items: listed.map(itemView), available: forCategory.filter(item => !codes.has(item.code)).map(itemView),
      owners: owners.map(({ row, ...owner }) => {
        const facts = factsOf(owner.type, row)
        return { ...owner, cells: Object.fromEntries(listed.filter(item => itemMatches(item, owner.type, row, facts)).map(item => { const handling = book.handling(owner.type, owner.id, item.code, customer.id); return [item.code, { ...handling, defaulted: !book.get(`${owner.type}:${owner.id}:${item.code}`) }] })) }
      })
    }
  })
  return { customer: { id: customer.id, name: customer.name, isSelf: Boolean(customer.is_self), template: customer.scope_template || null, customized: Boolean(customer.items_customized) }, templates: Object.fromEntries(Object.entries(templates).map(([key, value]) => [key, value.label])), groups: itemGroups, sections }
}

const openRequests = (customerId, plateIds) => plateIds.length ? db.prepare(`SELECT id, title, plate_asset_id FROM requests WHERE customer_id=? AND status NOT IN ('已完成','已取消') AND plate_asset_id IN (${plateIds.map(() => '?').join(',')}) ORDER BY created_at`).all(customerId, ...plateIds) : []

// Adding or removing items from one customer's list. Returns { error } or { added, removed, openRequests } as the impact;
// writes only when apply is true (inside the caller's transaction).
export function changeItems(tenantId, customer, { add = [], remove = [] }, userId, apply) {
  const all = catalogue(tenantId), codes = customerCodes(tenantId, customer, all)
  const known = new Map(all.map(item => [item.code, item]))
  if ([...add, ...remove].some(code => typeof code !== 'string' || !known.has(code))) return { error: '事項不存在' }
  if (add.some(code => !known.get(code).active)) return { error: '事項已停用，請先在規則頁啟用' }
  if (add.some(code => remove.includes(code)) || new Set([...add, ...remove]).size !== add.length + remove.length) return { error: '同一事項不可重複' }
  const { companies, plates } = ownersOf(tenantId, customer.id), book = scopeMap(tenantId)
  const owners = [...companies.filter(item => item.status !== '已註銷').map(item => ['company', item]), ...plates.map(item => ['plate', item])]
  const impact = code => {
    const applicable = owners.filter(([type, owner]) => itemMatches(known.get(code), type, owner))
    return { code, name: known.get(code).name, owners: applicable.length, ours: applicable.filter(([type, owner]) => book.handling(type, owner.id, code, customer.id)?.handler !== 'client').length, plateIds: applicable.filter(([type]) => type === 'plate').map(([, owner]) => owner.id) }
  }
  const removed = remove.filter(code => codes.has(code)).map(impact), added = add.filter(code => !codes.has(code)).map(impact)
  const result = { added: added.map(({ plateIds, ...rest }) => rest), removed: removed.map(({ plateIds, ...rest }) => rest), openRequests: openRequests(customer.id, [...new Set(removed.flatMap(item => item.plateIds))]).map(row => ({ id: row.id, title: row.title })) }
  if (!apply) return result
  const now = new Date().toISOString()
  if (!customer.items_customized) {
    for (const code of codes) db.prepare('INSERT OR IGNORE INTO customer_items(customer_id,tenant_id,item_code,added_by,added_at) VALUES (?,?,?,?,?)').run(customer.id, tenantId, code, userId, now)
    db.prepare('UPDATE customers SET items_customized=1 WHERE id=?').run(customer.id)
  }
  for (const item of added) db.prepare('INSERT OR IGNORE INTO customer_items(customer_id,tenant_id,item_code,added_by,added_at) VALUES (?,?,?,?,?)').run(customer.id, tenantId, item.code, userId, now)
  for (const item of removed) db.prepare('DELETE FROM customer_items WHERE customer_id=? AND item_code=?').run(customer.id, item.code)
  return result
}

// The filings page assigned (or changed) a company's accounting firm: monthly filings we were doing ourselves become
// outsourced to that firm. Client-handled or unlisted filings are left alone. Inside the caller's transaction.
export function syncFilingFirm(tenantId, companyId, userId) {
  const company = db.prepare('SELECT co.customer_id, f.name FROM companies co JOIN accounting_firms f ON f.id=co.accounting_firm_id WHERE co.id=? AND co.tenant_id=?').get(companyId, tenantId)
  if (!company) return
  const handling = scopeMap(tenantId).handling('company', companyId, 'monthly_filing', company.customer_id)
  if (handling?.handler === 'us') writeScope({ tenantId, ownerType: 'company', ownerId: companyId, item: 'monthly_filing', handler: 'outsourced', providerName: company.name, notes: '報帳頁指派會計公司', userId })
}

// Impact of a batch of handler changes before it is submitted: how many reminders go to the client only, how many come
// back to us, and open work orders on the plates that become the client's.
export function scopeImpact(tenantId, checked) {
  const book = scopeMap(tenantId)
  let toClient = 0, fromClient = 0
  const plateIds = new Map()
  for (const change of checked) {
    const before = book.handling(change.ownerType, change.ownerId, change.item, change.customerId)?.handler
    if (before !== 'client' && change.handler === 'client') { toClient += 1; if (change.ownerType === 'plate') plateIds.set(change.ownerId, change.customerId) }
    if (before === 'client' && change.handler !== 'client') fromClient += 1
  }
  const requests = [...new Set(plateIds.values())].flatMap(customerId => openRequests(customerId, [...plateIds].filter(([, owner]) => owner === customerId).map(([id]) => id)))
  return { toClient, fromClient, openRequests: requests.map(row => ({ id: row.id, title: row.title })) }
}
