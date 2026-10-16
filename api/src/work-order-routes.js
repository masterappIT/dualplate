import { db, id, now, hashPassword } from './db.js'
import { services, planFor } from './catalog.js'
import { notify } from './client-portal.js'
import { passwordProblem } from './security.js'
import { checkRequestFees, recordRequestFees, expectedFees } from './fees.js'

const statuses = ['待開始', '進行中', '待客戶提供', '已完成', '已取消']
const taskStatuses = ['待辦', '進行中', '已完成', '不適用']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const addDays = (date, days) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10)
const parseSteps = row => { try { return JSON.parse(row.steps_json || '[]') } catch { return [] } }
const jsonSteps = steps => JSON.stringify(steps.map((step, index) => ({ title: clean(step.title, 160), owner: step.owner, documents: step.documents, days: step.days ?? null, sourceId: step.sourceId || null, sort: index })))
const parseDocuments = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim() && item.length <= 160) ? value.map(item => item.trim()) : null
const validSteps = value => Array.isArray(value) && value.length > 0 && value.every(step => isObject(step) && typeof step.title === 'string' && step.title.trim() && ['us', 'client'].includes(step.owner) && parseDocuments(step.documents || []) && (step.days === null || step.days === undefined || Number.isInteger(step.days) && step.days >= 0 && step.days <= 365))

export function canManage(user) { return user.role === 'admin' }
function staffUser(tenant, userId, includeInactive = false) {
  return db.prepare(`SELECT id,role,name,email,username,active,last_login_at,tenant_id FROM users WHERE id=? AND tenant_id=? AND role IN ('admin','staff') ${includeInactive ? '' : 'AND active=1'}`).get(userId, tenant)
}
function customerFor(tenant, customerId) { return db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenant) }
function requestFor(tenant, requestId) {
  return db.prepare('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=? AND c.tenant_id=?').get(requestId, tenant)
}
function templateFor(tenant, templateId, activeOnly = false) { return db.prepare(`SELECT * FROM work_templates WHERE id=? AND tenant_id=? ${activeOnly ? 'AND active=1' : ''}`).get(templateId, tenant) }
function currentTemplate(tenant, serviceCode, route) { return db.prepare('SELECT * FROM work_templates WHERE tenant_id=? AND service_code=? AND route=? AND active=1 ORDER BY sort,id LIMIT 1').get(tenant, serviceCode, route) }
function templatePayload(row) { return { ...row, active: Boolean(row.active), steps: parseSteps(row) } }
function stepPayload(row) { return { ...row, documents: (() => { try { return JSON.parse(row.documents_json || '[]') } catch { return [] } })() } }
function nextStatus(requestId, currentStatus) {
  if (['已完成', '已取消'].includes(currentStatus)) return currentStatus
  const next = db.prepare("SELECT owner,status FROM tasks WHERE request_id=? AND status NOT IN ('已完成','不適用') ORDER BY sort,rowid LIMIT 1").get(requestId)
  const progressed = db.prepare("SELECT 1 FROM tasks WHERE request_id=? AND status IN ('進行中','已完成','不適用') LIMIT 1").get(requestId)
  return next?.owner === 'client' ? '待客戶提供' : currentStatus === '待開始' && !progressed ? '待開始' : '進行中'
}
function taskDays(steps) { return steps.reduce((total, step) => total + (Number.isInteger(step.days) ? step.days : 0), 0) }
// 工單狀態改變時通知客戶（每張工單每種狀態只通知一次）
const customerWords = { '進行中': '辦理中', '待客戶提供': '需要你提供資料', '已完成': '已完成', '已取消': '已取消' }
function notifyStatus(requestId, status) {
  const request = db.prepare('SELECT r.id,r.title,r.customer_id,c.tenant_id FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=?').get(requestId)
  if (!request || !customerWords[status]) return
  // 需要客戶提供資料時按步驟去重：同一工單第二個客戶步驟也會再通知
  const step = status === '待客戶提供' ? db.prepare("SELECT id,title FROM tasks WHERE request_id=? AND owner='client' AND status NOT IN ('已完成','不適用') ORDER BY sort,rowid LIMIT 1").get(requestId) : null
  notify({ tenantId: request.tenant_id, customerId: request.customer_id, kind: 'request', title: `${request.title}：${customerWords[status]}`, body: status === '待客戶提供' ? `${step ? step.title + '。' : ''}請查看需要提供的資料並上傳。` : '', link: `/pages/request-detail/request-detail?id=${request.id}`, dedupeKey: `request:${request.id}:${status}${step ? ':' + step.id : ''}` })
}
function updateRequestStatus(requestId) {
  const request = db.prepare('SELECT status FROM requests WHERE id=?').get(requestId)
  if (!request || ['已完成', '已取消'].includes(request.status)) return request?.status
  const status = nextStatus(requestId, request.status)
  if (status !== request.status) db.prepare('UPDATE requests SET status=?,updated_at=? WHERE id=?').run(status, now(), requestId)
  if (status !== request.status || status === '待客戶提供') notifyStatus(requestId, status)
  return status
}
function ensureScope(user, request) { return request && request.customer_id && customerFor(user.tenant_id, request.customer_id) ? request : null }
function ownerBelongsToRequest(tenant, request, ownerType, ownerId) {
  if (ownerType === 'plate') return db.prepare('SELECT p.id FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND p.customer_id=? AND c.tenant_id=?').get(ownerId, request.customer_id, tenant)
  if (ownerType === 'vehicle') return db.prepare('SELECT v.id FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE v.id=? AND v.customer_id=? AND c.tenant_id=?').get(ownerId, request.customer_id, tenant)
  if (ownerType === 'company') return db.prepare('SELECT co.id FROM companies co WHERE co.id=? AND co.customer_id=? AND co.tenant_id=?').get(ownerId, request.customer_id, tenant)
  if (ownerType === 'driver') return db.prepare('SELECT id FROM drivers WHERE id=? AND customer_id=? AND tenant_id=?').get(ownerId, request.customer_id, tenant)
  return null
}
function updateTrackedItems(tenant, request, updates, actorId) {
  if (updates === undefined) return 0
  if (!Array.isArray(updates)) return null
  for (const update of updates) {
    if (!isObject(update) || !['plate', 'vehicle', 'company', 'driver'].includes(update.ownerType) || typeof update.ownerId !== 'string' || typeof update.code !== 'string' || !update.code.trim() || !validDate(update.expiresOn)) return null
    if (!ownerBelongsToRequest(tenant, request, update.ownerType, update.ownerId)) return null
  }
  for (const update of updates) db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET tenant_id=excluded.tenant_id,expires_on=excluded.expires_on,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(tenant, update.ownerType, update.ownerId, update.code.trim(), update.expiresOn, clean(update.notes, 500), actorId, now())
  return updates.length
}
function seedLegacyTemplate(tenant, serviceCode, route) {
  const service = services.find(item => item.code === serviceCode && item.routes.includes(route))
  if (!service) return null
  const plan = planFor(service, route)
  return plan.stages.map((title, index) => ({ title, owner: 'us', documents: [], days: null, sourceId: plan.sourceIds[index] || null, sort: index }))
}
function createTasks(requestId, templateSteps, actorId) {
  for (const [index, step] of templateSteps.entries()) db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,source_id,due_on,notes,owner,documents_json,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(), requestId, step.title, /廣東|內地/.test(step.title) ? '內地' : /香港/.test(step.title) ? '香港' : /澳門/.test(step.title) ? '澳門' : '通用', '待辦', step.sourceId || null, null, null, step.owner, JSON.stringify(step.documents || []), index)
  db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), requestId, actorId, 'created', '工單已建立', now())
}

export async function workOrderRoutes(req, res, url, user, h) {
  const { json, fail, parseBody } = h
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const userMatch = path.match(/^\/api\/staff\/([^/]+)(?:\/(reset-password))?$/)
  const staffCollection = path === '/api/staff'
  const templateMatch = path.match(/^\/api\/work-templates\/([^/]+)$/)
  const requestMatch = path.match(/^\/api\/requests\/([^/]+)$/)
  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
  const allowed = staffCollection || userMatch || path === '/api/permission-matrix' || path === '/api/work-templates' || templateMatch || path === '/api/work-orders' || requestMatch || taskMatch
  if (!allowed) return false
  if (user.role === 'customer') {
    if (requestMatch && method === 'GET') return false
    return fail(res, 403, '客戶不能使用管理端接口'), true
  }

  if (staffCollection && method === 'GET') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    return json(res, 200, db.prepare("SELECT id,role,name,email,username,active,last_login_at,tenant_id FROM users WHERE tenant_id=? AND role IN ('admin','staff') ORDER BY active DESC,name").all(tenant)), true
  }
  if (staffCollection && method === 'POST') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const body = await parseBody(req)
    if (!isObject(body) || typeof body.name !== 'string' || !body.name.trim() || typeof body.username !== 'string' || !/^[a-z][a-z0-9._-]{2,31}$/.test(body.username.trim().toLowerCase()) || typeof body.password !== 'string') return fail(res, 400, '員工姓名、帳號和密碼不可為空'), true
    { const problem = passwordProblem(body.password, { username: body.username.trim() }); if (problem) return fail(res, 400, problem), true }
    if (body.role !== undefined && !['admin', 'staff'].includes(body.role)) return fail(res, 400, '員工角色無效'), true
    if (db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(body.username.trim()) || db.prepare('SELECT id FROM users WHERE email=?').get(`${body.username.trim().toLowerCase()}@internal.invalid`)) return fail(res, 409, '員工帳號已存在'), true
    const staffId = id(), username = body.username.trim().toLowerCase()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,username,tenant_id,active) VALUES (?,?,?,?,?,?,?,?,1)').run(staffId, body.role || 'staff', clean(body.name, 100), `${username}@internal.invalid`, hashPassword(body.password), null, username, tenant)
    return json(res, 201, staffUser(tenant, staffId, true)), true
  }
  if (userMatch && !userMatch[2] && method === 'GET') {
    const target = staffUser(tenant, userMatch[1], true)
    return target ? json(res, 200, target) : fail(res, 404, '員工不存在'), true
  }
  if (userMatch && userMatch[2] === 'reset-password' && method === 'POST') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const target = staffUser(tenant, userMatch[1], true); if (!target) return fail(res, 404, '員工不存在'), true
    const body = await parseBody(req); if (!isObject(body) || passwordProblem(body.password, target)) return fail(res, 400, passwordProblem(body?.password, target) || '密碼無效'), true
    db.prepare('UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?').run(hashPassword(body.password), target.id, tenant)
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id)
    return json(res, 200, { ok: true }), true
  }
  if (userMatch && !userMatch[2] && method === 'PATCH') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const target = staffUser(tenant, userMatch[1], true); if (!target) return fail(res, 404, '員工不存在'), true
    const body = await parseBody(req); if (!isObject(body)) return fail(res, 400, '內容無效'), true
    if (body.active !== undefined && typeof body.active !== 'boolean' || body.role !== undefined && !['admin', 'staff'].includes(body.role)) return fail(res, 400, '員工資料無效'), true
    if (body.active === false && target.id === user.id) return fail(res, 400, '不可停用自己'), true
    if (body.role === 'staff' && target.role === 'admin' && db.prepare("SELECT COUNT(*) count FROM users WHERE tenant_id=? AND role='admin' AND active=1").get(tenant).count <= 1) return fail(res, 409, '不可把最後一位管理者降級'), true
    if (body.active === false && target.role === 'admin' && db.prepare("SELECT COUNT(*) count FROM users WHERE tenant_id=? AND role='admin' AND active=1").get(tenant).count <= 1) return fail(res, 409, '不可停用最後一位管理者'), true
    db.prepare('UPDATE users SET role=COALESCE(?,role),active=COALESCE(?,active),name=COALESCE(?,name) WHERE id=? AND tenant_id=?').run(body.role ?? null, body.active === undefined ? null : Number(body.active), body.name === undefined ? null : clean(body.name, 100), target.id, tenant)
    if (body.active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id)
    return json(res, 200, staffUser(tenant, target.id, true)), true
  }
  if (path === '/api/permission-matrix' && method === 'GET') {
    // 權限全景列出全部員工及最近登入，與員工名單同級，只限管理者
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const users = db.prepare("SELECT id,name,role,active,last_login_at FROM users WHERE tenant_id=? AND role IN ('admin','staff') ORDER BY name").all(tenant)
    const activeUsers = users.filter(item => item.active)
    const cutoff = Date.now() - 30 * 86400000
    const notLoggedIn30Days = users.filter(item => !item.last_login_at || Number.isNaN(Date.parse(item.last_login_at)) || Date.parse(item.last_login_at) < cutoff).length
    const adminCount = activeUsers.filter(item => item.role === 'admin').length
    return json(res, 200, {
      roles: { admin: ['all'], staff: ['customers.read', 'plates.read', 'companies.read', 'requests.manage', 'dates.write', 'crossings.write', 'documents.write'], customer: ['customer.self'] },
      functions: ['customers.read', 'plates.read', 'companies.read', 'requests.manage', 'dates.write', 'crossings.write', 'documents.write'],
      users,
      summary: { employeeCount: users.length, activeCount: activeUsers.length, inactiveCount: users.length - activeUsers.length, notLoggedIn30Days, adminCount, risk: adminCount === 1 ? '只有一位管理者' : null }
    }), true
  }
  if (path === '/api/work-templates' && method === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM work_templates WHERE tenant_id=? ORDER BY sort,service_code,route,name').all(tenant).map(templatePayload)), true
  }
  if (path === '/api/work-templates' && method === 'POST') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const body = await parseBody(req)
    if (!isObject(body) || typeof body.serviceCode !== 'string' || typeof body.route !== 'string' || typeof body.name !== 'string' || !body.name.trim() || !validSteps(body.steps)) return fail(res, 400, '範本資料無效'), true
    if (!services.some(service => service.code === body.serviceCode && service.routes.includes(body.route)) && body.serviceCode !== 'custom') return fail(res, 400, '業務類型或路線無效'), true
    const templateId = id(); db.prepare('INSERT INTO work_templates(id,tenant_id,service_code,route,name,steps_json,active,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)').run(templateId, tenant, body.serviceCode, body.route, clean(body.name, 160), jsonSteps(body.steps), Number.isInteger(body.sort) ? body.sort : 0, now(), now())
    return json(res, 201, templatePayload(templateFor(tenant, templateId))), true
  }
  if (templateMatch && method === 'PATCH') {
    if (!canManage(user)) return fail(res, 403, '無權限'), true
    const template = templateFor(tenant, templateMatch[1]); if (!template) return fail(res, 404, '業務範本不存在'), true
    const body = await parseBody(req); if (!isObject(body)) return fail(res, 400, '內容無效'), true
    if (body.steps !== undefined && !validSteps(body.steps) || body.active !== undefined && typeof body.active !== 'boolean' || body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) return fail(res, 400, '範本資料無效'), true
    db.prepare('UPDATE work_templates SET name=COALESCE(?,name),steps_json=COALESCE(?,steps_json),active=COALESCE(?,active),sort=COALESCE(?,sort),updated_at=? WHERE id=? AND tenant_id=?').run(body.name === undefined ? null : clean(body.name, 160), body.steps === undefined ? null : jsonSteps(body.steps), body.active === undefined ? null : Number(body.active), Number.isInteger(body.sort) ? body.sort : null, now(), template.id, tenant)
    return json(res, 200, templatePayload(templateFor(tenant, template.id))), true
  }
  if (templateMatch && method !== 'PATCH') return fail(res, 405, '不支援此操作'), true

  if (path === '/api/work-orders' && method === 'GET') {
    const query = url.searchParams, assigneeId = query.get('assigneeId'), status = query.get('status'), customerId = query.get('customerId')
    if (assigneeId && !staffUser(tenant, assigneeId)) return fail(res, 404, '員工不存在'), true
    const rows = db.prepare(`SELECT r.*,c.name customer_name,v.plate, u.name assignee_name FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN users u ON u.id=r.assignee_id WHERE c.tenant_id=? ${assigneeId ? 'AND r.assignee_id=?' : ''} ${status ? 'AND r.status=?' : ''} ${customerId ? 'AND r.customer_id=?' : ''} ORDER BY r.updated_at DESC`).all(...[tenant, ...(assigneeId ? [assigneeId] : []), ...(status ? [status] : []), ...(customerId ? [customerId] : [])])
    return json(res, 200, rows), true
  }
  if (path === '/api/work-orders' && method === 'POST') {
    const body = await parseBody(req)
    if (!isObject(body) || typeof body.customerId !== 'string' || typeof body.serviceCode !== 'string' || typeof body.route !== 'string') return fail(res, 400, '客戶、業務和路線不可為空'), true
    const customer = customerFor(tenant, body.customerId); if (!customer) return fail(res, 404, '客戶不存在'), true
    // 表單的「不指定」送空字串，當作沒有指定
    for (const key of ['vehicleId', 'plateAssetId', 'quoteId', 'assigneeId', 'templateId']) if (body[key] === '') body[key] = null
    if (body.dueOn === '' || body.dueOn === null) delete body.dueOn
    const catalogService = services.find(item => item.code === body.serviceCode && item.routes.includes(body.route))
    if (!catalogService && body.serviceCode !== 'custom') return fail(res, 400, '業務類型與路線不相符'), true
    const assigneeId = body.assigneeId || user.id; if (!staffUser(tenant, assigneeId)) return fail(res, 400, '負責員工不存在或已停用'), true
    if (body.priority !== undefined && !['normal', 'urgent'].includes(body.priority)) return fail(res, 400, '優先度無效'), true
    const quote = body.quoteId === undefined || body.quoteId === null ? null : db.prepare("SELECT * FROM quotes WHERE id=? AND tenant_id=? AND customer_id=?").get(String(body.quoteId), tenant, customer.id)
    if (body.quoteId !== undefined && body.quoteId !== null && (!quote || quote.status !== '已接受' || quote.request_id)) return fail(res, 400, '報價不存在、未接受或已開過工單'), true
    const template = body.templateId ? templateFor(tenant, body.templateId, true) : currentTemplate(tenant, body.serviceCode, body.route); if (!template || template.service_code !== body.serviceCode || template.route !== body.route) return fail(res, 400, '業務範本不存在或已停用'), true
    const service = catalogService || { code: 'custom', name: template.name }
    const steps = parseSteps(template), dueOn = body.dueOn === undefined ? addDays(new Date().toISOString().slice(0, 10), taskDays(steps) || 14) : body.dueOn // 範本沒有設定天數時預設 14 天，避免新工單一建立就到期
    if (!validDate(dueOn)) return fail(res, 400, '截止日期無效'), true
    if (body.vehicleId !== undefined && body.vehicleId !== null && (!db.prepare('SELECT id FROM vehicles WHERE id=? AND customer_id=? AND route=?').get(body.vehicleId, customer.id, body.route))) return fail(res, 400, '車輛與客戶或路線不相符'), true
    if (body.plateAssetId !== undefined && body.plateAssetId !== null && (!db.prepare('SELECT id FROM plate_assets WHERE id=? AND customer_id=? AND route=?').get(body.plateAssetId, customer.id, body.route))) return fail(res, 400, '牌照與客戶或路線不相符'), true
    const requestId = id(), initialStatus = steps[0]?.owner === 'client' ? '待客戶提供' : '待開始'; db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,plate_asset_id,service_code,route,title,description,status,stage,assignee_id,created_at,updated_at,due_on,template_id,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, customer.id, body.vehicleId || null, body.plateAssetId || null, body.serviceCode, body.route, clean(body.title || service.name, 160), clean(body.description, 4000), initialStatus, steps[0]?.title || service.name, assigneeId, now(), now(), dueOn, template.id, body.priority || 'normal')
    createTasks(requestId, steps, user.id)
    // 由已接受的報價開單：連結報價，結案時帶入預計收費
    if (quote) db.prepare('UPDATE quotes SET request_id=?, updated_at=? WHERE id=?').run(requestId, now(), quote.id)
    return json(res, 201, requestFor(tenant, requestId)), true
  }
  if (requestMatch && method === 'GET') {
    const request = ensureScope(user, requestFor(tenant, requestMatch[1])); if (!request) return fail(res, 404, '工單不存在'), true
    updateRequestStatus(request.id)
    const template = request.template_id ? templateFor(tenant, request.template_id) : null
    const plateAsset = request.plate_asset_id ? db.prepare('SELECT id, mainland_plate, local_plate, card_number, route FROM plate_assets WHERE id=?').get(request.plate_asset_id) || null : null
    return json(res, 200, { ...requestFor(tenant, request.id), plateAsset, ...(user.role === 'admin' ? { expectedFees: expectedFees(request.id) } : {}), tasks: db.prepare('SELECT * FROM tasks WHERE request_id=? ORDER BY sort,rowid').all(request.id).map(stepPayload), activities: db.prepare('SELECT a.*,u.name actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.request_id=? ORDER BY a.created_at DESC').all(request.id), template: template ? templatePayload(template) : null, plan: (service => service ? planFor(service, request.route) : null)(services.find(entry => entry.code === request.service_code)), clientTodos: db.prepare("SELECT id,title,owner,status,documents_json,sort FROM tasks WHERE request_id=? AND owner='client' AND status NOT IN ('已完成','不適用') ORDER BY sort,rowid").all(request.id).map(stepPayload) }), true
  }
  if (requestMatch && method === 'PATCH') {
    const request = ensureScope(user, requestFor(tenant, requestMatch[1])); if (!request) return fail(res, 404, '工單不存在'), true
    const body = await parseBody(req); if (!isObject(body)) return fail(res, 400, '內容無效'), true
    if (body.customerId !== undefined && body.customerId !== request.customer_id) return fail(res, 400, '工單不可搬到其他客戶'), true
    if (body.status !== undefined && !statuses.includes(body.status)) return fail(res, 400, '工單狀態無效'), true
    if (body.assigneeId !== undefined && !staffUser(tenant, body.assigneeId)) return fail(res, 400, '負責員工不存在或已停用'), true
    if (body.priority !== undefined && !['normal', 'urgent'].includes(body.priority)) return fail(res, 400, '優先度無效'), true
    if (body.status === '已取消' && !clean(body.cancelledReason, 500)) return fail(res, 400, '取消工單必須填寫原因'), true
    if (body.status === '已完成') {
      const unfinished = db.prepare("SELECT COUNT(*) count FROM tasks WHERE request_id=? AND status NOT IN ('已完成','不適用')").get(request.id).count
      if (unfinished) return json(res, 409, { error: `仍有 ${unfinished} 個步驟未完成或未標記不適用`, unfinished }), true
      if (!body.skipDeadlineUpdate && body.deadlineUpdates !== undefined && updateTrackedItems(tenant, request, body.deadlineUpdates, user.id) === null) return fail(res, 400, '到期更新資料無效'), true
      if (body.skipDeadlineUpdate !== undefined && typeof body.skipDeadlineUpdate !== 'boolean') return fail(res, 400, '略過更新欄位無效'), true
      // 本單收費（只限管理者；略過即不產生）。資料錯誤時整個結案不進行。
      if (body.fees !== undefined && user.role !== 'admin') return fail(res, 403, '只有管理者可記錄收費'), true
      const feeProblem = body.skipFees ? null : checkRequestFees(body.fees)
      if (feeProblem) return fail(res, 400, feeProblem), true
    }
    const nextStatusValue = body.status || request.status
    db.prepare('UPDATE requests SET status=?,stage=COALESCE(?,stage),assignee_id=COALESCE(?,assignee_id),due_on=COALESCE(?,due_on),priority=COALESCE(?,priority),completed_at=?,cancelled_reason=?,updated_at=? WHERE id=?').run(nextStatusValue, body.stage || null, body.assigneeId || null, body.dueOn || null, body.priority || null, nextStatusValue === '已完成' ? now() : null, nextStatusValue === '已取消' ? clean(body.cancelledReason, 500) : null, now(), request.id)
    db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), request.id, user.id, 'status', `${nextStatusValue}${body.note ? ` · ${clean(body.note, 1000)}` : ''}`, now())
    if (nextStatusValue !== request.status) notifyStatus(request.id, nextStatusValue)
    if (body.status === '已完成' && request.status !== '已完成' && !body.skipFees && body.fees) recordRequestFees(tenant, request, body.fees, user.id)
    return json(res, 200, requestFor(tenant, request.id)), true
  }
  if (taskMatch && method === 'PATCH') {
    const task = db.prepare('SELECT t.*,r.customer_id,r.service_code,r.route,r.status request_status FROM tasks t JOIN requests r ON r.id=t.request_id JOIN customers c ON c.id=r.customer_id WHERE t.id=? AND c.tenant_id=?').get(taskMatch[1], tenant); if (!task) return fail(res, 404, '步驟不存在'), true
    const body = await parseBody(req); if (!isObject(body) || body.status !== undefined && !taskStatuses.includes(body.status) || body.owner !== undefined && !['us', 'client'].includes(body.owner) || body.documents !== undefined && !parseDocuments(body.documents)) return fail(res, 400, '步驟資料無效'), true
    if (task.request_status === '已完成' || task.request_status === '已取消') return fail(res, 409, '已結案工單不可修改步驟'), true
    if (task.service_code === 'new_application' && /香港 TD547D|澳門邊境通行證申請/.test(task.title) && ['進行中', '已完成'].includes(body.status)) {
      const approval = db.prepare("SELECT status FROM tasks WHERE request_id=? AND title='廣東批文申請與回執'").get(task.request_id); if (approval?.status !== '已完成') return fail(res, 409, '須先記錄廣東批文完成，再開始香港／澳門牌證申請'), true
    }
    const status = body.status || task.status, finished = ['已完成', '不適用'].includes(status)
    db.prepare('UPDATE tasks SET title=COALESCE(?,title),status=?,owner=COALESCE(?,owner),documents_json=COALESCE(?,documents_json),notes=COALESCE(?,notes),completed_by=?,completed_at=? WHERE id=?').run(body.title === undefined ? null : clean(body.title, 160), status, body.owner || null, body.documents === undefined ? null : JSON.stringify(body.documents), body.notes === undefined ? null : clean(body.notes, 1000), finished ? user.id : null, finished ? now() : null, task.id)
    db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), task.request_id, user.id, 'task', `${task.title}：${status}`, now())
    updateRequestStatus(task.request_id)
    return json(res, 200, db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)), true
  }
  return fail(res, 405, '不支援此操作'), true
}
