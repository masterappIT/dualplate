import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { applyTemplate, changeItems, checkScope, clientScopeSnapshot, customerScope, notifyScopeChanges, expandChange, loadOwner, scopeImpact, scopesFor, selfManaged, templateChanges, templates, writeScope } from './entrustment.js'

// Entrustment per item, customer item lists, templates and plate transfers (docs/tasks/scope-items-design.md,
// docs/tasks/entrustment-brief.md §6). Admin only.
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const codeList = value => value === undefined ? [] : Array.isArray(value) && value.length <= 200 && value.every(item => typeof item === 'string') ? value : null

export async function entrustmentRoutes(req, res, url, user, h) {
  const { json, fail, parseBody } = h
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const templateMatch = path.match(/^\/api\/customers\/([^/]+)\/apply-template$/)
  const customerScopeMatch = path.match(/^\/api\/customers\/([^/]+)\/(scope|items)$/)
  const transferMatch = path.match(/^\/api\/plates\/([^/]+)\/transfers?$/)
  if (path !== '/api/service-scopes' && path !== '/api/service-scopes/batch' && !templateMatch && !customerScopeMatch && !transferMatch) return false
  if (user.role !== 'admin') return fail(res, 403, '無權限'), true
  // Checks one change and expands it to item level; returns { changes } or { status, error }.
  const resolve = change => {
    if (!isObject(change) || !['company', 'plate'].includes(change.ownerType) || typeof change.ownerId !== 'string' || !change.ownerId.trim() || typeof change.handler !== 'string' || !change.handler.trim() || change.item !== undefined && (typeof change.item !== 'string' || !change.item.trim()) || change.service !== undefined && (typeof change.service !== 'string' || !change.service.trim()) || change.item === undefined && change.service === undefined) return { status: 400, error: '內容無效' }
    const owner = loadOwner(tenant, change.ownerType, change.ownerId)
    if (!owner) return { status: 404, error: '對象不存在' }
    const problem = checkScope(owner, change)
    if (problem) return { status: 400, error: problem }
    const expanded = expandChange(tenant, change.ownerType, owner, change)
    if (expanded.error) return { status: 400, error: expanded.error }
    // Outsourced monthly filings go to a firm from the accounting-firm list, shared with the filings page.
    let firm = null
    if (change.providerId !== undefined && (typeof change.providerId !== 'string' || !change.providerId.trim())) return { status: 400, error: '會計公司無效' }
    if (change.handler === 'outsourced' && expanded.changes.some(item => item.item === 'monthly_filing')) {
      firm = change.providerId ? db.prepare('SELECT id, name FROM accounting_firms WHERE id=? AND tenant_id=?').get(change.providerId, tenant) : db.prepare('SELECT id, name FROM accounting_firms WHERE name=? AND tenant_id=?').get(String(change.providerName || '').trim(), tenant)
      if (!firm) return { status: 400, error: '每月報帳外包須從會計公司名單選擇' }
    }
    return { changes: expanded.changes.map(item => ({ ...item, ownerId: owner.id, customerId: owner.customer_id, ...(firm && item.item === 'monthly_filing' ? { providerName: firm.name, firmId: firm.id } : {}) })) }
  }
  const write = change => {
    writeScope({ tenantId: tenant, ownerType: change.ownerType, ownerId: change.ownerId, item: change.item, handler: change.handler, providerName: change.providerName, notes: change.notes, userId: user.id })
    if (change.firmId) db.prepare('UPDATE companies SET accounting_firm_id=?, updated_at=? WHERE id=? AND tenant_id=?').run(change.firmId, new Date().toISOString(), change.ownerId, tenant)
  }

  // 委託變更通知客戶：寫入前後各取一次客戶看到的委託內容，提交後比較
  const snapshots = customerIds => new Map([...new Set(customerIds)].map(id => [id, clientScopeSnapshot(tenant, id)]))
  const notifyAll = before => { for (const [customerId, snapshot] of before) notifyScopeChanges(tenant, customerId, snapshot) }

  if (path === '/api/service-scopes' && method === 'GET') {
    const result = scopesFor(tenant, url.searchParams.get('ownerType'), url.searchParams.get('ownerId'))
    return (result ? json(res, 200, result) : fail(res, 404, '對象不存在')), true
  }
  if (path === '/api/service-scopes' && method === 'PUT') {
    const resolved = resolve(await parseBody(req))
    if (resolved.error) return fail(res, resolved.status, resolved.error), true
    const before = snapshots(resolved.changes.map(change => change.customerId))
    db.exec('BEGIN IMMEDIATE')
    try { resolved.changes.forEach(write); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    notifyAll(before)
    return json(res, 200, scopesFor(tenant, resolved.changes[0].ownerType, resolved.changes[0].ownerId)), true
  }
  if (path === '/api/service-scopes/batch' && method === 'PUT') {
    // 委託範圍矩陣一次提交：先逐項驗證，全部合格才在同一交易內寫入，任何一項不合格就全部不改；dryRun 只回傳影響
    const body = await parseBody(req)
    if (!isObject(body) || !Array.isArray(body.changes) || !body.changes.length || body.changes.length > 2000 || body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return fail(res, 400, '請提供要修改的項目'), true
    const checked = []
    for (const [index, change] of body.changes.entries()) {
      const resolved = resolve(change)
      if (resolved.error) return fail(res, resolved.status, `第 ${index + 1} 項：${resolved.error}`), true
      for (const item of resolved.changes) {
        if (checked.some(entry => entry.ownerType === item.ownerType && entry.ownerId === item.ownerId && entry.item === item.item)) return fail(res, 400, `第 ${index + 1} 項重複`), true
        checked.push(item)
      }
    }
    const impact = scopeImpact(tenant, checked)
    if (body.dryRun) return json(res, 200, { updated: 0, impact }), true
    const before = snapshots(checked.map(change => change.customerId))
    db.exec('BEGIN IMMEDIATE')
    try { checked.forEach(write); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    notifyAll(before)
    return json(res, 200, { updated: checked.length, impact }), true
  }
  if (customerScopeMatch && customerScopeMatch[2] === 'scope' && method === 'GET') {
    const result = customerScope(tenant, customerScopeMatch[1])
    return (result ? json(res, 200, result) : fail(res, 404, '客戶不存在')), true
  }
  if (customerScopeMatch && customerScopeMatch[2] === 'items' && method === 'PUT') {
    const body = await parseBody(req)
    const add = isObject(body) ? codeList(body.add) : null, remove = isObject(body) ? codeList(body.remove) : null
    if (!add || !remove || !add.length && !remove.length || body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return fail(res, 400, '請提供要加入或移除的事項'), true
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerScopeMatch[1], tenant)
    if (!customer) return fail(res, 404, '客戶不存在'), true
    if (body.dryRun !== false) {
      const preview = changeItems(tenant, customer, { add, remove }, user.id, false)
      return (preview.error ? fail(res, 400, preview.error) : json(res, 200, { ...preview, applied: false })), true
    }
    const before = snapshots([customer.id])
    db.exec('BEGIN IMMEDIATE')
    let result
    try { result = changeItems(tenant, customer, { add, remove }, user.id, true); if (result.error) db.exec('ROLLBACK'); else db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    if (!result.error) notifyAll(before)
    return (result.error ? fail(res, 400, result.error) : json(res, 200, { ...result, applied: true })), true
  }
  if (templateMatch && method === 'POST') {
    const body = await parseBody(req)
    if (!isObject(body) || !Object.hasOwn(templates, body.template) || body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return fail(res, 400, '委託範本無效'), true
    if (selfManaged(db.prepare('SELECT is_self, service_mode FROM customers WHERE id=? AND tenant_id=?').get(templateMatch[1], tenant))) return fail(res, 409, '自管客戶不套用委託範本；要由我們負責，請先把客戶切換為托管'), true
    const preview = templateChanges(tenant, templateMatch[1], body.template)
    if (!preview) return fail(res, 404, '客戶不存在'), true
    if (body.dryRun !== false) return json(res, 200, { ...preview, applied: false }), true
    const before = snapshots([templateMatch[1]])
    db.exec('BEGIN IMMEDIATE')
    try { applyTemplate(tenant, templateMatch[1], preview, user.id); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    notifyAll(before)
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
        for (const [ownerType, ownerId] of owners) for (const row of db.prepare("SELECT * FROM service_scopes WHERE owner_type=? AND owner_id=? AND ended_on IS NULL AND handler='client'").all(ownerType, ownerId)) writeScope({ tenantId: tenant, ownerType, ownerId, item: row.service, handler: 'us', providerName: '', notes: '轉入本公司自有', userId: user.id })
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { transferred: plateIds, toCustomerId: target.id, transferredOn: body.transferredOn }), true
  }
  return fail(res, 405, '不支援此操作'), true
}
