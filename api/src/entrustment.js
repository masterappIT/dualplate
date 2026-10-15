import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { businessToday } from './rules.js'

// What a client entrusts to us, per company or plate and service (docs/tasks/entrustment-brief.md).
// No row means 'us', which keeps behaviour unchanged for existing data.
export const companyServices = ['company_upkeep', 'bookkeeping', 'audit_tax', 'secretary']
export const plateServices = ['plate_service', 'rental_management']
export const handlers = ['us', 'outsourced', 'client']
export const serviceLabels = { company_upkeep: '公司維護', bookkeeping: '每月報帳報稅', audit_tax: '審計及利得稅', secretary: '公司秘書', plate_service: '牌照業務代辦', rental_management: '出租代管' }
export const handlerLabels = { us: '我們做', outsourced: '外包', client: '客戶自理' }

// audit_tax only for Hong Kong / Macau companies, secretary only for Hong Kong ones.
export function serviceApplies(ownerType, owner, service) {
  if (ownerType === 'plate') return plateServices.includes(service)
  if (ownerType !== 'company' || !companyServices.includes(service)) return false
  if (service === 'audit_tax') return ['香港', '澳門'].includes(owner.jurisdiction)
  if (service === 'secretary') return owner.jurisdiction === '香港'
  return true
}
export const servicesFor = (ownerType, owner) => (ownerType === 'plate' ? plateServices : companyServices).filter(service => serviceApplies(ownerType, owner, service))

export function loadOwner(tenantId, ownerType, ownerId) {
  if (typeof ownerId !== 'string' || !ownerId) return null
  if (ownerType === 'company') return db.prepare('SELECT co.*, c.is_self FROM companies co JOIN customers c ON c.id=co.customer_id WHERE co.id=? AND co.tenant_id=?').get(ownerId, tenantId) || null
  if (ownerType === 'plate') return db.prepare('SELECT p.*, c.is_self FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.tenant_id=?').get(ownerId, tenantId) || null
  return null
}

// Current rows as the Map computeDeadlines expects.
export function scopeMap(tenantId) {
  return new Map(db.prepare('SELECT * FROM service_scopes WHERE tenant_id=? AND ended_on IS NULL').all(tenantId).map(row => [`${row.owner_type}:${row.owner_id}:${row.service}`, row]))
}

export function scopesFor(tenantId, ownerType, ownerId) {
  const owner = loadOwner(tenantId, ownerType, ownerId)
  if (!owner) return null
  const rows = db.prepare('SELECT * FROM service_scopes WHERE tenant_id=? AND owner_type=? AND owner_id=? ORDER BY started_on DESC, updated_at DESC').all(tenantId, ownerType, ownerId)
  return {
    ownerType, ownerId,
    services: servicesFor(ownerType, owner).map(service => {
      const current = rows.find(row => row.service === service && !row.ended_on)
      return { service, label: serviceLabels[service], handler: current?.handler || 'us', providerName: current?.provider_name || '', startedOn: current?.started_on || null, notes: current?.notes || '' }
    }),
    history: rows.map(row => ({ id: row.id, service: row.service, handler: row.handler, providerName: row.provider_name || '', startedOn: row.started_on, endedOn: row.ended_on, updatedBy: row.updated_by, updatedAt: row.updated_at }))
  }
}

// Validates one change; returns an error message or null.
export function checkScope(owner, ownerType, { service, handler, providerName }) {
  if (!serviceApplies(ownerType, owner, service)) return '此服務項目不適用於這個對象'
  if (!handlers.includes(handler)) return '負責方必須是我們做、外包或客戶自理'
  if (handler === 'outsourced' && (typeof providerName !== 'string' || !providerName.trim())) return '外包須填寫外包單位名稱'
  if (providerName !== undefined && providerName !== null && typeof providerName !== 'string') return '外包單位名稱無效'
  if (handler === 'client' && owner.is_self) return '本公司自有的項目不可設為客戶自理'
  return null
}

// Applies one change inside the caller's transaction. Same value as now is a no-op so history stays clean.
export function writeScope({ tenantId, ownerType, ownerId, service, handler, providerName, notes, userId }) {
  const current = db.prepare('SELECT * FROM service_scopes WHERE owner_type=? AND owner_id=? AND service=? AND ended_on IS NULL').get(ownerType, ownerId, service)
  const provider = handler === 'outsourced' ? String(providerName).trim().slice(0, 120) : ''
  if ((current?.handler || 'us') === handler && (current?.provider_name || '') === provider) return false
  const today = businessToday().toISOString().slice(0, 10), now = new Date().toISOString()
  if (current) db.prepare('UPDATE service_scopes SET ended_on=?, updated_at=? WHERE id=?').run(today, now, current.id)
  db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,provider_name,started_on,ended_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(), tenantId, ownerType, ownerId, service, handler, provider, today, String(notes || '').slice(0, 500), userId, now)
  return true
}

// Templates applied to every company and plate of one customer.
export const templates = {
  full: { label: '全權托管', handler: () => 'us' },
  plates_only: { label: '只管牌照', handler: ownerType => ownerType === 'plate' ? 'us' : 'client' },
  plates_and_mainland: { label: '牌照＋內地公司', handler: (ownerType, owner) => ownerType === 'plate' || owner.jurisdiction === '內地' ? 'us' : 'client' }
}

export function templateChanges(tenantId, customerId, templateKey) {
  const template = templates[templateKey]
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId)
  if (!template || !customer) return null
  const owners = [
    ...db.prepare('SELECT * FROM companies WHERE customer_id=? AND tenant_id=?').all(customerId, tenantId).map(item => ['company', item, item.name]),
    ...db.prepare('SELECT * FROM plate_assets WHERE customer_id=?').all(customerId).map(item => ['plate', item, [item.mainland_plate, item.local_plate].filter(Boolean).join(' · ') || item.card_number])
  ]
  const current = scopeMap(tenantId)
  const changes = []
  for (const [ownerType, owner, label] of owners) for (const service of servicesFor(ownerType, owner)) {
    let handler = template.handler(ownerType, owner)
    if (customer.is_self && handler === 'client') handler = 'us'
    const now = current.get(`${ownerType}:${owner.id}:${service}`)
    if ((now?.handler || 'us') !== handler) changes.push({ ownerType, ownerId: owner.id, ownerLabel: label, service, serviceLabel: serviceLabels[service], from: now?.handler || 'us', to: handler })
  }
  return { template: templateKey, label: template.label, changes }
}
