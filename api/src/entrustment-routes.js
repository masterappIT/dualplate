import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { checkScope, loadOwner, scopesFor, templateChanges, templates, writeScope } from './entrustment.js'

// Entrustment scope, templates and plate transfers (docs/tasks/entrustment-brief.md §1, §4, §6). Admin only.
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

export async function entrustmentRoutes(req, res, url, user, h) {
  const { json, fail, parseBody } = h
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const templateMatch = path.match(/^\/api\/customers\/([^/]+)\/apply-template$/)
  const transferMatch = path.match(/^\/api\/plates\/([^/]+)\/transfers?$/)
  if (path !== '/api/service-scopes' && !templateMatch && !transferMatch) return false
  if (user.role !== 'admin') return fail(res, 403, '無權限'), true

  if (path === '/api/service-scopes' && method === 'GET') {
    const result = scopesFor(tenant, url.searchParams.get('ownerType'), url.searchParams.get('ownerId'))
    return (result ? json(res, 200, result) : fail(res, 404, '對象不存在')), true
  }
  if (path === '/api/service-scopes' && method === 'PUT') {
    const body = await parseBody(req)
    if (!isObject(body)) return fail(res, 400, '內容無效'), true
    const owner = loadOwner(tenant, body.ownerType, body.ownerId)
    if (!owner) return fail(res, 404, '對象不存在'), true
    const problem = checkScope(owner, body.ownerType, body)
    if (problem) return fail(res, 400, problem), true
    db.exec('BEGIN IMMEDIATE')
    try { writeScope({ tenantId: tenant, ownerType: body.ownerType, ownerId: owner.id, service: body.service, handler: body.handler, providerName: body.providerName, notes: body.notes, userId: user.id }); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, scopesFor(tenant, body.ownerType, owner.id)), true
  }
  if (templateMatch && method === 'POST') {
    const body = await parseBody(req)
    if (!isObject(body) || !Object.hasOwn(templates, body.template)) return fail(res, 400, '委託範本無效'), true
    const preview = templateChanges(tenant, templateMatch[1], body.template)
    if (!preview) return fail(res, 404, '客戶不存在'), true
    if (body.dryRun !== false) return json(res, 200, { ...preview, applied: false }), true
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const change of preview.changes) writeScope({ tenantId: tenant, ownerType: change.ownerType, ownerId: change.ownerId, service: change.service, handler: change.to, providerName: '', notes: `套用範本：${preview.label}`, userId: user.id })
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { ...preview, applied: true }), true
  }
  if (transferMatch && method === 'GET' && path.endsWith('/transfers')) {
    const plate = loadOwner(tenant, 'plate', transferMatch[1])
    if (!plate) return fail(res, 404, '兩地牌不存在'), true
    return json(res, 200, db.prepare('SELECT t.*, f.name from_name, c.name to_name FROM plate_transfers t JOIN customers f ON f.id=t.from_customer_id JOIN customers c ON c.id=t.to_customer_id WHERE t.plate_asset_id=? AND t.tenant_id=? ORDER BY t.created_at DESC').all(plate.id, tenant)), true
  }
  if (transferMatch && method === 'POST' && path.endsWith('/transfer')) {
    const body = await parseBody(req)
    if (!isObject(body) || typeof body.toCustomerId !== 'string' || !validDate(body.transferredOn) || body.includePlateIds !== undefined && (!Array.isArray(body.includePlateIds) || body.includePlateIds.some(item => typeof item !== 'string'))) return fail(res, 400, '請選擇接收客戶和轉讓日期'), true
    const plate = loadOwner(tenant, 'plate', transferMatch[1])
    if (!plate) return fail(res, 404, '兩地牌不存在'), true
    const target = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(body.toCustomerId, tenant)
    if (!target) return fail(res, 404, '接收客戶不存在'), true
    if (target.id === plate.customer_id) return fail(res, 400, '這個牌照已屬於該客戶'), true
    // A company group moves as a whole; if it holds other plates, they must be named so nothing is split by accident.
    const siblings = plate.group_id ? db.prepare('SELECT id, mainland_plate, local_plate, card_number FROM plate_assets WHERE group_id=? AND id<>?').all(plate.group_id, plate.id) : []
    const included = new Set(body.includePlateIds || [])
    const missing = siblings.filter(item => !included.has(item.id))
    if (missing.length) return json(res, 409, { error: '同一公司組還有其他牌照，須一併轉讓', otherPlates: missing.map(item => ({ id: item.id, label: [item.mainland_plate, item.local_plate].filter(Boolean).join(' · ') || item.card_number })) }), true
    if ([...included].some(id => !siblings.some(item => item.id === id))) return fail(res, 400, '一併轉讓的牌照必須屬於同一公司組'), true
    const plateIds = [plate.id, ...siblings.map(item => item.id)]
    const now = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of plateIds) {
        db.prepare('INSERT INTO plate_transfers(id,tenant_id,plate_asset_id,from_customer_id,to_customer_id,transferred_on,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, id, plate.customer_id, target.id, body.transferredOn, String(body.notes || '').slice(0, 500), user.id, now)
        db.prepare('UPDATE plate_assets SET customer_id=?, updated_at=? WHERE id=?').run(target.id, now, id)
        db.prepare('UPDATE vehicles SET customer_id=? WHERE id IN (SELECT vehicle_id FROM plate_assets WHERE id=? AND vehicle_id IS NOT NULL)').run(target.id, id)
      }
      if (plate.group_id) {
        db.prepare('UPDATE company_groups SET customer_id=? WHERE id=? AND tenant_id=?').run(target.id, plate.group_id, tenant)
        db.prepare('UPDATE companies SET customer_id=?, updated_at=? WHERE group_id=? AND tenant_id=?').run(target.id, now, plate.group_id, tenant)
      }
      // Moving into our own stock cannot keep 'client' items; they become ours.
      if (target.is_self) {
        const owners = [...plateIds.map(id => ['plate', id]), ...(plate.group_id ? db.prepare('SELECT id FROM companies WHERE group_id=?').all(plate.group_id).map(item => ['company', item.id]) : [])]
        for (const [ownerType, ownerId] of owners) for (const row of db.prepare("SELECT * FROM service_scopes WHERE owner_type=? AND owner_id=? AND ended_on IS NULL AND handler='client'").all(ownerType, ownerId)) writeScope({ tenantId: tenant, ownerType, ownerId, service: row.service, handler: 'us', providerName: '', notes: '轉入本公司自有', userId: user.id })
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { transferred: plateIds, toCustomerId: target.id, transferredOn: body.transferredOn }), true
  }
  return fail(res, 405, '不支援此操作'), true
}
