import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { db, id, now, hashPassword, verifyPassword } from './db.js'
import { services, sources, inspectionGuidance, planFor } from './catalog.js'
import { cardData, cleanCard, recognizeCard } from './card.js'
import { phase1Routes } from './phase1-routes.js'
import { customerRoutes, requestStatus } from './customer-routes.js'
import { parseCsv, crossingPorts } from './plate-import.js'
import { computeDeadlines } from './rules.js'
import { plateFacts } from './plate-facts.js'
import { addCrossing, deleteCrossing, crossingSummary, setReminder } from './crossings.js'
import { entrustmentRoutes } from './entrustment-routes.js'
import { portalRoutes, publicPortalRoutes } from './client-portal.js'
import { workOrderRoutes } from './work-order-routes.js'
import { viewRoutes } from './view-routes.js'
import { driverRoutes } from './drivers.js'
import { rentalRoutes, legacyStart, legacyEnd, activeContract } from './rentals.js'
import { feeRoutes } from './fees.js'

const port = Number(process.env.PORT || 4100)
const allowedOrigins = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(','))
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const fail = (res, status, message) => json(res, status, { error: message })
const parseBody = async req => { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000000) throw new Error('請求內容過大') } if (!raw) return {}; const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('請求內容格式錯誤'); return body }
const required = (body, keys) => keys.every(key => typeof body[key] === 'string' && body[key].trim())
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const query = (sql, ...params) => db.prepare(sql).all(...params)
const validDate = value => { const text = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text + 'T00:00:00Z')) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text ? text : null }
const one = (sql, ...params) => db.prepare(sql).get(...params)
const normalizeImportDate = value => {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (!match) return null
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return validDate(normalized)
}
const importCompanyGroup = (customerId, route, hongKongOrMacau, mainland) => {
  const groups = query('SELECT * FROM company_groups WHERE customer_id=? ORDER BY created_at', customerId)
  for (const group of groups) {
    const companies = query('SELECT * FROM companies WHERE group_id=? AND customer_id=?', group.id, customerId)
    const jurisdiction = route === '粵港' ? '香港' : '澳門'
    const hasForeign = !hongKongOrMacau || companies.some(item => item.jurisdiction === jurisdiction && item.name === hongKongOrMacau)
    const hasMainland = !mainland || companies.some(item => item.jurisdiction === '內地' && item.name === mainland)
    if (hasForeign && hasMainland && (hongKongOrMacau || mainland)) return group
  }
  return hongKongOrMacau || mainland ? null : undefined
}
const importPreviews = new Map()

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (!token) return null
  return one('SELECT u.id,u.role,u.name,u.email,u.customer_id,u.tenant_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1', token, now())
}
// Every customer belongs to one tenant; admins see their tenant only, customers see themselves only.
function canAccessCustomer(user, customerId) {
  const customer = customerId && one('SELECT tenant_id FROM customers WHERE id=?', customerId)
  return !!customer && customer.tenant_id === user.tenant_id && (user.role === 'admin' || user.role === 'staff' || user.customer_id === customerId)
}
function requestFor(user, requestId) {
  const item = one('SELECT * FROM requests WHERE id=?', requestId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function vehicleFor(user, vehicleId) {
  const item = one('SELECT * FROM vehicles WHERE id=?', vehicleId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function plateFor(user, plateId) {
  const item = one('SELECT * FROM plate_assets WHERE id=?', plateId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function plateDetail(user, plateId) {
  const item = plateFor(user, plateId)
  if (!item) return null
  const images = query('SELECT side,mime,data FROM approval_card_images WHERE plate_asset_id=?', item.id)
  const photos = query('SELECT kind,mime,data FROM plate_photos WHERE plate_asset_id=?', item.id)
  const imageValue = x => ['admin', 'staff'].includes(user.role) ? `data:${x.mime};base64,${x.data.toString('base64')}` : true
  const companyStatuses = ['admin', 'staff'].includes(user.role) && item.group_id ? query('SELECT c.id,c.jurisdiction,c.name,c.status,c.status_changed_on FROM companies c JOIN company_groups g ON g.id=c.group_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.group_id=? AND g.customer_id=? ORDER BY c.jurisdiction,c.name', user.tenant_id, item.group_id, item.customer_id) : []
  const warnings = companyStatuses.filter(company => company.jurisdiction === '內地' && ['已註銷', '註銷中'].includes(company.status)).map(company => company.status === '已註銷' ? '內承單位已註銷' : '內承單位註銷中')
  return { ...item, cardData: cardData(item.card_data), rentals: query('SELECT * FROM plate_rentals WHERE plate_asset_id=? ORDER BY created_at DESC', item.id), rentalContracts: query('SELECT id,renter_name,renter_vehicle_plate,starts_on,ends_on,rent_amount,currency,collection_mode,status FROM rental_contracts WHERE plate_asset_id=? ORDER BY starts_on DESC', item.id), cardImages: Object.fromEntries(images.map(x => [x.side, imageValue(x)])), platePhotos: Object.fromEntries(photos.map(x => [x.kind, imageValue(x)])), companyStatuses, warnings: [...new Set(warnings)] }
}
function plateSummary(item, tenantId) {
  const tracked = query('SELECT code,expires_on FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code IN (?,?) ORDER BY code', tenantId, 'plate', item.id, 'hk_crp', 'mo_permit')
  const groupCompanies = item.group_id ? query('SELECT jurisdiction,name FROM companies WHERE tenant_id=? AND group_id=? AND customer_id=? ORDER BY jurisdiction,name', tenantId, item.group_id, item.customer_id) : []
  const approval = item.card_expires_on
  const permit = tracked.find(entry => entry.code === (item.route === '粵港' ? 'hk_crp' : 'mo_permit'))?.expires_on || null
  const rules = query("SELECT * FROM rules WHERE tenant_id=? AND scope='plate'", tenantId).map(rule => ({ ...rule, match: JSON.parse(rule.match_json), params: JSON.parse(rule.params_json), remindDays: rule.remind_days }))
  const trackedItems = new Map(query("SELECT * FROM tracked_items WHERE tenant_id=? AND owner_type='plate' AND owner_id=?", tenantId, item.id).map(entry => [`plate:${item.id}:${entry.code}`, entry]))
  const levels = computeDeadlines({ rules, owners: [{ ownerType: 'plate', ownerId: item.id, customerId: item.customer_id, label: item.card_number, facts: plateFacts(item) }], tracked: trackedItems, completions: new Set(), windowDays: 365 }).map(entry => entry.level)
  const healthStatus = levels.includes('overdue') ? 'overdue' : levels.includes('due') ? 'due' : levels.includes('missing') || !levels.length ? 'missing' : 'ok'
  return { ...item, card_data: cardData(item.card_data), holder_company: groupCompanies.find(company => company.jurisdiction !== '內地')?.name || null, mainland_company: groupCompanies.find(company => company.jurisdiction === '內地')?.name || null, permit_expires_on: permit, health_status: healthStatus }
}
function pushActivity(requestId, actorId, kind, detail) { db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), requestId, actorId, kind, detail, now()) }
function addTasks(requestId, service, route) {
  const plan = planFor(service, route)
  for (const stage of plan.stages) {
    const jurisdiction = /廣東|內地/.test(stage) ? '內地' : /香港/.test(stage) ? '香港' : /澳門/.test(stage) ? '澳門' : '通用'
    const sourceId = /香港/.test(stage) ? plan.sourceIds.find(x => x.startsWith('HK-')) : /澳門/.test(stage) ? plan.sourceIds.find(x => x.startsWith('MO-')) : /廣東|內地/.test(stage) ? plan.sourceIds.find(x => x.startsWith('GD-')) : null
    db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,source_id,due_on,notes,sort) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), requestId, stage, jurisdiction, '待辦', sourceId || null, null, null, db.prepare('SELECT COUNT(*) count FROM tasks WHERE request_id=?').get(requestId).count)
  }
}

export const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.has(origin)) res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-allow-headers', 'authorization,content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  try {
    if (path === '/api/health') return json(res, 200, { ok: true })
    if (path === '/api/admin/login' && req.method === 'POST') {
      const body = await parseBody(req)
      const username = clean(body.username, 64).toLowerCase()
      const password = String(body.password || '')
      if (!username || !password) return fail(res, 400, '請輸入管理員帳號和密碼')
      const account = one("SELECT * FROM users WHERE role IN ('admin','staff') AND active=1 AND username=? COLLATE NOCASE", username)
      if (!account || !verifyPassword(password, account.password_hash)) return fail(res, 401, '帳號或密碼不正確')
      const token = randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 7 * 86400000).toISOString()
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, account.id, expires)
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), account.id)
      return json(res, 200, { token, user: { id: account.id, name: account.name, username: account.username, role: account.role } })
    }
    if (path === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req)
      // 客戶可用電郵或手機號碼登入（第 15 輪）
      const login = clean(body.email ?? body.phone ?? body.login, 160)
      const account = login.includes('@') ? one("SELECT * FROM users WHERE role='customer' AND active=1 AND email=?", login.toLowerCase()) : one("SELECT * FROM users WHERE role='customer' AND active=1 AND phone=?", login.replace(/[\s-]/g, ''))
      if (!account || !verifyPassword(String(body.password || ''), account.password_hash)) return fail(res, 401, '帳號或密碼不正確')
      const token = randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 7 * 86400000).toISOString()
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, account.id, expires)
      db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), account.id)
      return json(res, 200, { token, user: { id: account.id, name: account.name, email: account.email, role: account.role, customerId: account.customer_id } })
    }
    if (await publicPortalRoutes(req, res, url, { json, fail, parseBody })) return
    const user = auth(req)
    if (!user) return fail(res, 401, '請先登入')
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customer_id })
    if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, { services, sources, routePlans: Object.fromEntries(services.map(s => [s.code, Object.fromEntries(s.routes.map(route => [route, planFor(s, route)]))])) })
    if (await phase1Routes(req, res, url, user, { json, fail, parseBody, canAccessCustomer, vehicleFor, plateFor, query, one, clean })) return
    if (await entrustmentRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (await workOrderRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (await driverRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (viewRoutes(req, res, url, user, { json, fail })) return
    if (await rentalRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (await feeRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (await portalRoutes(req, res, url, user, { json, fail, parseBody })) return
    if (await customerRoutes(req, res, url, user, { json, fail, query, one, plateFor, parseBody })) return
    if (path === '/api/import/plates' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const body = await parseBody(req)
      if (typeof body.csv !== 'string' || !body.csv.trim() || body.csv.length > 3000000) return fail(res, 400, '請上傳 UTF-8 CSV 內容')
      let parsed
      try { parsed = parseCsv(body.csv) } catch (failure) { return fail(res, 400, failure.message) }
      if (parsed.errors.length) return fail(res, 400, parsed.errors.join('；'))
      if (!parsed.rows.length) return fail(res, 400, 'CSV 沒有資料列')
      const seen = new Map()
      const rows = parsed.rows.map(row => {
        const inputValue = row.values
        const value = { ...inputValue }
        const errors = row.columnError ? [row.columnError] : []
        if (Object.values(value).some(entry => entry.length > 1000)) errors.push('欄位內容過長')
        const customerMatches = value['客戶'] ? query('SELECT id,name FROM customers WHERE tenant_id=? AND name=?', user.tenant_id, value['客戶']) : []
        const customer = customerMatches.length === 1 ? customerMatches[0] : null
        if (!value['客戶']) errors.push('客戶不可為空')
        else if (!customerMatches.length) errors.push('找不到同一租戶的客戶')
        else if (customerMatches.length > 1) errors.push('客戶名稱不唯一，請先整理客戶資料')
        if (!['粵港', '粵澳'].includes(value['路線'])) errors.push('路線必須是粵港或粵澳')
        if (!value['批文卡號']) errors.push('批文卡號不可為空')
        if (value['口岸'] && !crossingPorts.includes(value['口岸'])) errors.push('未知口岸名稱')
        for (const header of ['批文到期', 'CRP／通行證到期']) {
          const normalized = normalizeImportDate(value[header])
          if (normalized === null) errors.push(`${header}格式錯誤，請使用 YYYY-MM-DD，例如 2026-11-20`)
          else value[header] = normalized
        }
        const key = customer && ['粵港', '粵澳'].includes(value['路線']) && value['批文卡號'] ? `${customer.id}:${value['路線']}:${value['批文卡號']}` : null
        const existing = key ? one('SELECT * FROM plate_assets WHERE customer_id=? AND route=? AND card_number=?', customer.id, value['路線'], value['批文卡號']) : null
        const existingGroup = existing?.group_id ? one('SELECT * FROM company_groups WHERE id=? AND customer_id=?', existing.group_id, customer.id) : null
        const existingCompanies = existingGroup ? query('SELECT jurisdiction,name FROM companies WHERE group_id=? AND customer_id=?', existingGroup.id, customer.id) : []
        const foreignJurisdiction = value['路線'] === '粵港' ? '香港' : '澳門'
        const incomingCompanies = [[value['香港／澳門公司'], foreignJurisdiction], [value['內地公司'], '內地']].filter(([name]) => name)
        if (existingGroup && incomingCompanies.some(([name, jurisdiction]) => !existingCompanies.some(company => company.jurisdiction === jurisdiction && company.name === name))) {
          errors.push(`公司名稱與現有公司組（${existingGroup.name}）不符；如需更換公司組請在牌照詳情處理`)
        }
        const group = existingGroup || customer && importCompanyGroup(customer.id, value['路線'], value['香港／澳門公司'], value['內地公司'])
        const groupAction = !existingGroup && (value['香港／澳門公司'] || value['內地公司']) && !group ? '新增公司組' : null
        const duplicate = key && seen.has(key)
        if (duplicate) errors.push('同一檔案重複的牌照')
        if (key) seen.set(key, true)
        return {
          rowNumber: row.rowNumber,
          action: existing || duplicate ? '更新' : '新增',
          key,
          customerId: customer?.id || null,
          groupId: group?.id || null,
          groupAction,
          existingId: existing?.id || null,
          values: value,
          errors,
        }
      })
      const summary = {
        create: rows.filter(row => row.action === '新增' && !row.errors.length).length,
        update: rows.filter(row => row.action === '更新' && !row.errors.length).length,
        error: rows.filter(row => row.errors.length).length,
      }
      const dryRun = url.searchParams.get('dryRun') === '1'
      const previewKey = createHash('sha256').update(`${user.tenant_id}:${body.csv}`).digest('hex')
      const previewId = `${user.id}:${previewKey}`
      if (dryRun) {
        for (const [key, expiry] of importPreviews) if (expiry < Date.now()) importPreviews.delete(key)
        if (!summary.error) importPreviews.set(previewId, Date.now() + 15 * 60000)
      }
      if (!dryRun && (body.confirm !== true || body.previewKey !== previewKey || (importPreviews.get(previewId) || 0) < Date.now())) return fail(res, 400, '請先預覽並確認相同的 CSV')
      if (!dryRun && summary.error) return fail(res, 400, 'CSV 含有錯誤列，修正後才可寫入')
      if (!dryRun) {
        db.exec('BEGIN IMMEDIATE')
        try {
          const importedGroups = new Map()
          for (const row of rows) {
            const value = row.values
            let groupId = row.groupId
            const current = row.existingId ? one('SELECT * FROM plate_assets WHERE id=?', row.existingId) : one('SELECT * FROM plate_assets WHERE customer_id=? AND route=? AND card_number=?', row.customerId, value['路線'], value['批文卡號'])
            if (row.groupAction) {
              const groupKey = JSON.stringify([row.customerId, value['香港／澳門公司'], value['內地公司'], value['路線']])
              groupId = importedGroups.get(groupKey)
              if (!groupId) {
                groupId = id()
                importedGroups.set(groupKey, groupId)
                db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,notes,created_at) VALUES (?,?,?,?,?,?)').run(groupId, user.tenant_id, row.customerId, [value['香港／澳門公司'], value['內地公司']].filter(Boolean).join(' · '), 'CSV 匯入', now())
                for (const [name, jurisdiction] of [[value['香港／澳門公司'], value['路線'] === '粵港' ? '香港' : '澳門'], [value['內地公司'], '內地']]) if (name) db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id(), user.tenant_id, row.customerId, groupId, jurisdiction, name, now(), now())
              }
            }
            const incomingCard = { cardNumber: value['批文卡號'], mainlandPlate: value['內地車牌'], localPlate: value['港澳車牌'], validTo: value['批文到期'], company: value['香港／澳門公司'], contractor: value['內地公司'] }
            const oldCard = current ? cardData(current.card_data) : {}
            const importedCard = cleanCard({ ...oldCard, ...Object.fromEntries(Object.entries(incomingCard).filter(([, entry]) => entry)) })
            const plateId = current?.id || id()
            if (current) {
              db.prepare('UPDATE plate_assets SET mainland_plate=?,local_plate=?,card_expires_on=?,group_id=?,card_data=?,port=?,indicator_category=?,updated_at=? WHERE id=?').run(value['內地車牌'] || current.mainland_plate, value['港澳車牌'] || current.local_plate, value['批文到期'] || current.card_expires_on, groupId || current.group_id, JSON.stringify(importedCard), value['口岸'] || current.port, value['指標類別'] || current.indicator_category, now(), plateId)
            } else {
              db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,card_number,card_expires_on,group_id,usage_status,installation_status,notes,created_at,updated_at,card_data,card_status,card_updated_by,card_updated_at,port,indicator_category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(plateId, row.customerId, value['路線'], value['內地車牌'] || null, value['港澳車牌'] || null, value['批文卡號'], value['批文到期'] || null, groupId || null, '待核對', '待核對', '', now(), now(), JSON.stringify(importedCard), '待核對', user.name, now(), value['口岸'] || null, value['指標類別'] || null)
            }
            const code = value['路線'] === '粵港' ? 'hk_crp' : 'mo_permit'
            if (value['CRP／通行證到期']) db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(user.tenant_id, 'plate', plateId, code, value['CRP／通行證到期'], 'CSV 匯入', user.id, now())
          }
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        importPreviews.delete(previewId)
      }
      return json(res, 200, { dryRun, previewKey, headers: parsed.headers, rows: rows.map(({ key, ...row }) => row), summary })
    }
    if (path === '/api/card-recognize' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!['front','back'].includes(body.side)) return fail(res,400,'請選擇批文卡正面或背面')
      const matched=String(body.image||'').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
      if (!matched) return fail(res,400,'只接受 PNG、JPEG 或 WebP 圖片')
      const bytes=Buffer.from(matched[2],'base64')
      if (bytes.length>3500000) return fail(res,400,'圖片不可超過 3.5 MB')
      const recognized = await recognizeCard(bytes, body.side)
      return json(res, 200, { cardData: recognized.cardData, fieldStatus: recognized.fieldStatus })
    }
    if (path === '/api/customers' && req.method === 'GET') {
      return json(res, 200, ['admin', 'staff'].includes(user.role) ? query('SELECT * FROM customers WHERE tenant_id=? ORDER BY is_self DESC, name', user.tenant_id) : query('SELECT * FROM customers WHERE id=?', user.customer_id))
    }
    const reminderMatch = path.match(/^\/api\/plates\/([^/]+)\/crossing-reminder$/)
    if (reminderMatch) {
      if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限')
      if (req.method !== 'PUT') return fail(res, 405, '不支援此操作')
      const plate = plateFor(user, reminderMatch[1]); if (!plate) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req), problem = setReminder({ plateId: plate.id, enabled: b?.enabled })
      return problem ? fail(res, problem.status, problem.error) : json(res, 200, crossingSummary(user.tenant_id, plate.id))
    }
    const crossingMatch = path.match(/^\/api\/plates\/([^/]+)\/crossings(?:\/([^/]+))?$/)
    if (crossingMatch) {
      if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限')
      const plate = plateFor(user, crossingMatch[1])
      if (!plate) return fail(res, 404, '兩地牌不存在')
      const send = result => result.error ? fail(res, result.status, result.error) : json(res, result.status, result.body)
      if (!crossingMatch[2] && req.method === 'GET') return json(res, 200, crossingSummary(user.tenant_id, plate.id))
      if (!crossingMatch[2] && req.method === 'POST') { const b = await parseBody(req); return send(addCrossing({ tenantId: user.tenant_id, plateId: plate.id, crossedOn: b?.crossedOn, source: 'admin', userId: user.id })) }
      if (crossingMatch[2] && req.method === 'DELETE') return send(deleteCrossing({ tenantId: user.tenant_id, plateId: plate.id, crossingId: crossingMatch[2] }))
      return fail(res, 405, '不支援此操作')
    }
    if (path === '/api/plate-assets' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      const condition = "card_number IS NOT NULL AND TRIM(card_number)<>''"
      if (['admin', 'staff'].includes(user.role)) {
        const items = customerId ? (canAccessCustomer(user, customerId) ? query('SELECT * FROM plate_assets WHERE customer_id=? ORDER BY created_at DESC', customerId) : []) : query('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE c.tenant_id=? ORDER BY p.created_at DESC', user.tenant_id)
        return json(res, 200, items.map(item => plateSummary(item, user.tenant_id)))
      }
      return json(res, 200, query(`SELECT * FROM plate_assets WHERE customer_id=? AND ${condition} ORDER BY created_at DESC`, user.customer_id))
    }
    if (path === '/api/plate-assets' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['customerId', 'route'])) return fail(res, 400, '請選擇客戶和路線')
      if (user.role !== 'admin' && b.customerId !== user.customer_id) return fail(res, 403, '只能建立自己的兩地牌')
      if (!canAccessCustomer(user, b.customerId)) return fail(res, 404, '客戶不存在')
      if (!['粵港','粵澳'].includes(b.route)) return fail(res, 400, '路線無效')
      if (b.vehicleId) { const v = one('SELECT * FROM vehicles WHERE id=?', b.vehicleId); if (!v || v.customer_id !== b.customerId || v.route !== b.route) return fail(res, 400, '車輛與客戶或路線不符') }
      if (b.sourceRequestId) {
        if (user.role !== 'admin') return fail(res, 403, '只有專員可從案件建立兩地牌檔案')
        const source = one('SELECT * FROM requests WHERE id=?', b.sourceRequestId)
        if (!source || source.service_code !== 'new_application' || source.customer_id !== b.customerId || source.route !== b.route || source.plate_asset_id) return fail(res, 400, '申請案件與客戶或路線不相符，或已完成建檔')
      }
      const proposedCard = cleanCard(b.cardData)
      const cardNumber = clean(proposedCard.cardNumber || b.cardNumber,80)
      if (!cardNumber) return fail(res, 400, '請先填寫批文卡編號；尚未取得批文卡請使用申請代辦')
      if (one("SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=?",b.customerId,b.route,cardNumber)) return fail(res,409,'這張批文卡已在名下建檔')
      const cardImages=[]
      for (const side of ['front','back']) if (b.cardImages?.[side]) {
        const matched=String(b.cardImages[side]).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
        if (!matched) return fail(res,400,'只接受 PNG、JPEG 或 WebP 圖片')
        const bytes=Buffer.from(matched[2],'base64')
        if (bytes.length>3500000) return fail(res,400,'圖片不可超過 3.5 MB')
        cardImages.push([side,`image/${matched[1]}`,bytes])
      }
      const assetId = id()
      const mainlandPlate=clean(proposedCard.mainlandPlate || b.mainlandPlate,30)||null
      const localPlate=clean(proposedCard.localPlate || b.localPlate,30)||null
      const cardExpiresOn=clean(proposedCard.validTo || b.cardExpiresOn,20)||null
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,usage_status,card_number,card_expires_on,notes,created_at,updated_at,card_data,card_status,card_updated_by,card_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(assetId,b.customerId,b.route,mainlandPlate,localPlate,b.vehicleId||null,'待核對','待核對',cardNumber,cardExpiresOn,clean(b.notes,1000),now(),now(),JSON.stringify({...proposedCard,cardNumber}),'待核對',user.name,now())
        for(const [side,mime,bytes] of cardImages) db.prepare('INSERT INTO approval_card_images VALUES (?,?,?,?)').run(assetId,side,mime,bytes)
        if (b.sourceRequestId) {
          db.prepare('UPDATE requests SET plate_asset_id=?,updated_at=? WHERE id=? AND plate_asset_id IS NULL').run(assetId,now(),b.sourceRequestId)
          pushActivity(b.sourceRequestId,user.id,'plate_created',`已取得批文卡 ${cardNumber}，建立兩地牌檔案`)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 201, plateDetail(user, assetId))
    }
    const plateMatch = path.match(/^\/api\/plate-assets\/([^/]+)$/)
    if (plateMatch && req.method === 'GET') {
      const item = plateDetail(user, plateMatch[1]); return item ? json(res, 200, item) : fail(res, 404, '兩地牌不存在')
    }
    if (plateMatch && req.method === 'PATCH') {
      const old = plateFor(user, plateMatch[1]); if (!old) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      if (user.role !== 'admin' && b.usageStatus !== undefined && b.usageStatus !== old.usage_status) return fail(res, 403, '使用狀態須由專員核對')
      const installation = b.installationStatus ?? old.installation_status
      const usage = b.usageStatus ?? old.usage_status
      if (!['待核對','未上牌','已上牌'].includes(installation) || !['待核對','自用','出租中','暫停使用'].includes(usage)) return fail(res, 400, '牌照狀態無效')
      const vehicleId = b.vehicleId === undefined ? old.vehicle_id : b.vehicleId || null
      if (vehicleId) { const v = one('SELECT * FROM vehicles WHERE id=?', vehicleId); if (!v || v.customer_id !== old.customer_id || v.route !== old.route) return fail(res, 400, '車輛與客戶或路線不符') }
      if (installation === '已上牌' && !vehicleId && usage !== '出租中') return fail(res, 400, '自用已上牌須指定車輛')
      if (installation === '未上牌' && vehicleId) return fail(res, 400, '未上牌不能綁定車輛')
      const groupId = b.groupId === undefined ? old.group_id : b.groupId || null
      if (groupId) { const parent = one('SELECT * FROM company_groups WHERE id=? AND tenant_id=?', groupId, user.tenant_id); if (!parent) return fail(res, 404, '公司組不存在'); if (parent.customer_id !== old.customer_id) return fail(res, 400, '公司組與客戶不符') }
      if (user.role !== 'admin' && (b.groupId !== undefined || b.indicatorCategory !== undefined || b.port !== undefined)) return fail(res, 403, '指標類別、口岸和公司組須由專員維護')
      if (b.port !== undefined && b.port !== null && b.port !== '' && !crossingPorts.includes(b.port)) return fail(res, 400, '未知口岸名稱')
      // 「出租中」只由生效的出租合約推算
      if (usage === '出租中' && !activeContract(old.id)) return fail(res, 400, '出租中須先建立出租合約')
      if (usage !== '出租中' && activeContract(old.id)) return fail(res, 400, '請先終止出租合約')
      const nextCardNumber = clean(b.cardNumber ?? old.card_number,80)
      if (!nextCardNumber) return fail(res,400,'批文卡編號不能留空')
      if (one('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?',old.customer_id,old.route,nextCardNumber,old.id)) return fail(res,409,'這張批文卡已在名下建檔')
      const cardNumberChanged = nextCardNumber !== clean(old.card_number,80)
      const nextCard = cardNumberChanged ? cleanCard({...cardData(old.card_data),cardNumber:nextCardNumber}) : null
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE plate_assets SET mainland_plate=?,local_plate=?,vehicle_id=?,installation_status=?,usage_status=?,card_number=?,card_expires_on=?,notes=?,group_id=?,indicator_category=?,port=?,updated_at=? WHERE id=?').run(clean(b.mainlandPlate ?? old.mainland_plate,30)||null,clean(b.localPlate ?? old.local_plate,30)||null,vehicleId,installation,usage,nextCardNumber,clean(b.cardExpiresOn ?? old.card_expires_on,20)||null,clean(b.notes ?? old.notes,1000),groupId,clean(b.indicatorCategory ?? old.indicator_category,40)||null,clean(b.port ?? old.port,40)||null,now(),old.id)
        if (cardNumberChanged) {
          db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_updated_by=?,card_updated_at=? WHERE id=?').run(JSON.stringify(nextCard),'待核對',user.name,now(),old.id)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, plateDetail(user, old.id))
    }
    if (plateMatch && req.method === 'PUT') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const old = plateFor(user, plateMatch[1]); if (!old) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      const proposed = cleanCard(b.cardData)
      if (!proposed.cardNumber) return fail(res, 400, '批文卡編號不能留空')
      if (one('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?',old.customer_id,old.route,proposed.cardNumber,old.id)) return fail(res,409,'這張批文卡已在名下建檔')
      const nextStatus = user.role === 'admin' ? '已核對' : '待核對'
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_number=?,card_expires_on=?,mainland_plate=?,local_plate=?,card_updated_by=?,card_updated_at=?,updated_at=? WHERE id=?').run(JSON.stringify(proposed),nextStatus,proposed.cardNumber||null,proposed.validTo||null,proposed.mainlandPlate||null,proposed.localPlate||null,user.name,now(),now(),old.id)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, plateDetail(user, old.id))
    }
    const cardMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/card\/(front|back)$/)
    const privateImageMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/image\/(card-front|card-back|plate-mainland|plate-local)$/)
    if (privateImageMatch && req.method === 'GET') {
      const item = plateFor(user, privateImageMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      const kind = privateImageMatch[2]
      const row = kind.startsWith('card-') ? one('SELECT mime,data FROM approval_card_images WHERE plate_asset_id=? AND side=?',item.id,kind.slice(5)) : one('SELECT mime,data FROM plate_photos WHERE plate_asset_id=? AND kind=?',item.id,kind.slice(6))
      if (!row) return fail(res, 404, '圖片不存在')
      res.writeHead(200, {'content-type':row.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'})
      return res.end(row.data)
    }
    if (cardMatch && req.method === 'POST') {
      const item = plateFor(user, cardMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      if (!['admin', 'staff'].includes(user.role) && !one('SELECT id FROM users WHERE id=? AND customer_id=?',user.id,item.customer_id)) return fail(res, 403, '無權限')
      const b = await parseBody(req)
      const matched = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(b.image || '')
      if (!matched) return fail(res, 400, '請上傳 JPG 或 PNG 圖片')
      const bytes = Buffer.from(matched[2], 'base64')
      if (!bytes.length || bytes.length > 3500000) return fail(res, 400, '圖片不可超過 3.5 MB')
      const side=cardMatch[2]
      let recognized={cardData:cardData(null),fieldStatus:{}}
      try { recognized=await recognizeCard(bytes,side) } catch (error) { console.error('Card OCR failed:',error) }
      const existing=cardData(item.card_data)
      const proposed=cleanCard({...existing,...Object.fromEntries(Object.entries(recognized.cardData).filter(([,v])=>v))})
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO approval_card_images VALUES (?,?,?,?) ON CONFLICT(plate_asset_id,side) DO UPDATE SET mime=excluded.mime,data=excluded.data').run(item.id,side,matched[1],bytes)
        db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_number=?,card_expires_on=?,mainland_plate=?,local_plate=?,card_updated_by=?,card_updated_at=?,updated_at=? WHERE id=?').run(JSON.stringify(proposed),'待核對',proposed.cardNumber||null,proposed.validTo||null,proposed.mainlandPlate||null,proposed.localPlate||null,user.name,now(),now(),item.id)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, { side, uploaded: true, recognized: recognized.cardData, fieldStatus: recognized.fieldStatus, cardData: proposed, needsReview: true })
    }
    const photoMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/photo\/(mainland|local)$/)
    if (photoMatch && req.method === 'POST') {
      if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限')
      const item = plateFor(user, photoMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      const matched = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(b.image || '')
      if (!matched) return fail(res, 400, '請上傳 JPG 或 PNG 圖片')
      const bytes = Buffer.from(matched[2], 'base64')
      if (!bytes.length || bytes.length > 3500000) return fail(res, 400, '圖片不可超過 3.5 MB')
      db.prepare('INSERT INTO plate_photos VALUES (?,?,?,?) ON CONFLICT(plate_asset_id,kind) DO UPDATE SET mime=excluded.mime,data=excluded.data').run(item.id,photoMatch[2],matched[1],bytes)
      return json(res, 200, { kind: photoMatch[2], uploaded: true })
    }
    if (path === '/api/plate-rentals' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['plateAssetId','renterName'])) return fail(res, 400, '請填寫兩地牌與承租方')
      const item = plateFor(user, b.plateAssetId); if (!item) return fail(res, 404, '兩地牌不存在')
      if (one("SELECT id FROM plate_rentals WHERE plate_asset_id=? AND status='出租中'", item.id) || activeContract(item.id)) return fail(res, 409, '已有進行中的出租記錄')
      if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) return fail(res, 400, '結束日期早於開始日期')
      const rentalId=id()
      db.prepare('INSERT INTO plate_rentals(id,plate_asset_id,renter_name,renter_vehicle_plate,starts_on,ends_on,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(rentalId,item.id,clean(b.renterName,120),clean(b.renterVehiclePlate,50)||null,clean(b.startsOn,20)||null,clean(b.endsOn,20)||null,'出租中',clean(b.notes,1000),now())
      legacyStart(user.tenant_id, item.id, { renterName: clean(b.renterName,120), renterVehiclePlate: clean(b.renterVehiclePlate,50), startsOn: clean(b.startsOn,20), endsOn: clean(b.endsOn,20), notes: clean(b.notes,1000) })
      return json(res,201,one('SELECT * FROM plate_rentals WHERE id=?',rentalId))
    }
    const rentalMatch = path.match(/^\/api\/plate-rentals\/([^/]+)$/)
    if (rentalMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const old=one('SELECT * FROM plate_rentals WHERE id=?',rentalMatch[1]); if (!old || !plateFor(user,old.plate_asset_id)) return fail(res,404,'出租記錄不存在')
      const b=await parseBody(req); if (!['出租中','已結束'].includes(b.status)) return fail(res,400,'出租狀態無效')
      db.prepare('UPDATE plate_rentals SET status=?,ends_on=?,notes=? WHERE id=?').run(b.status,clean(b.endsOn ?? old.ends_on,20)||null,clean(b.notes ?? old.notes,1000),old.id)
      if (b.status==='已結束') legacyEnd(user.tenant_id, old.plate_asset_id, clean(b.endsOn,20) || null)
      return json(res,200,one('SELECT * FROM plate_rentals WHERE id=?',old.id))
    }
    if (path === '/api/customers' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const body = await parseBody(req)
      if (!required(body, ['name', 'kind'])) return fail(res, 400, '請填寫客戶名稱和類型')
      const customerId = id()
      db.prepare('INSERT INTO customers(id,name,kind,phone,owner_id,notes,tenant_id) VALUES (?,?,?,?,?,?,?)').run(customerId, clean(body.name, 120), clean(body.kind, 20), clean(body.phone, 40), user.id, clean(body.notes, 2000), user.tenant_id)
      return json(res, 201, one('SELECT * FROM customers WHERE id=?', customerId))
    }
    const customerMatch = path.match(/^\/api\/customers\/([^/]+)$/)
    if (customerMatch && req.method === 'DELETE') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const customer = one('SELECT * FROM customers WHERE id=? AND tenant_id=?', customerMatch[1], user.tenant_id)
      if (!customer) return fail(res, 404, '客戶不存在')
      if (customer.is_self) return fail(res, 409, '本公司（自有）客戶不可刪除')
      return fail(res, 405, '不支援此操作')
    }
    if (path === '/api/customer-users' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const body = await parseBody(req)
      if (!required(body, ['customerId', 'name', 'password']) || !(required(body, ['email']) || required(body, ['phone']))) return fail(res, 400, '請填寫姓名、密碼，以及電郵或手機號碼')
      const phone = body.phone ? clean(body.phone, 30).replace(/[\s-]/g, '') : null
      if (phone && !/^\+?\d{8,15}$/.test(phone)) return fail(res, 400, '手機號碼格式無效')
      if (phone && one('SELECT id FROM users WHERE phone=?', phone)) return fail(res, 409, '這個手機號碼已被使用')
      if (body.email && one('SELECT id FROM users WHERE email=?', clean(body.email, 160).toLowerCase())) return fail(res, 409, '這個電郵已被使用')
      if (!canAccessCustomer(user, body.customerId)) return fail(res, 404, '客戶不存在')
      if (one('SELECT is_self FROM customers WHERE id=?', body.customerId)?.is_self) return fail(res, 409, '本公司（自有）不開通客戶端登入')
      if (body.password.length < 12) return fail(res, 400, '密碼至少 12 字元')
      const userId = id()
      db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,phone) VALUES (?,?,?,?,?,?,?,?)').run(userId, 'customer', clean(body.name, 100), body.email ? clean(body.email, 160).toLowerCase() : `${phone}@phone.invalid`, hashPassword(body.password), body.customerId, user.tenant_id, phone)
      return json(res, 201, { id: userId })
    }
    if (path === '/api/vehicles' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      if (['admin', 'staff'].includes(user.role)) return json(res, 200, customerId ? (canAccessCustomer(user, customerId) ? query('SELECT * FROM vehicles WHERE customer_id=? ORDER BY plate', customerId) : []) : query('SELECT v.* FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE c.tenant_id=? ORDER BY v.plate', user.tenant_id))
      return json(res, 200, query('SELECT * FROM vehicles WHERE customer_id=? ORDER BY plate', user.customer_id))
    }
    if (path === '/api/vehicles' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['customerId', 'route', 'origin', 'type', 'plate'])) return fail(res, 400, '車輛資料不完整')
      if (!['粵港', '粵澳'].includes(b.route) || !['香港', '內地', '澳門'].includes(b.origin)) return fail(res, 400, '路線或來源地無效')
      if (b.firstRegisteredOn && !validDate(b.firstRegisteredOn)) return fail(res, 400, '首次註冊日期無效')
      if (!canAccessCustomer(user, b.customerId)) return fail(res, 404, '客戶不存在')
      const vehicleId = id()
      db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,brand,model,vin,manufactured_year,notes,first_registered_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(vehicleId, b.customerId, clean(b.route, 20), clean(b.origin, 20), clean(b.type, 40), clean(b.plate, 50), clean(b.brand, 60), clean(b.model, 60), clean(b.vin, 100), Number(b.manufacturedYear) || null, clean(b.notes, 1000), validDate(b.firstRegisteredOn))
      return json(res, 201, one('SELECT * FROM vehicles WHERE id=?', vehicleId))
    }
    const vehicleMatch = path.match(/^\/api\/vehicles\/([^/]+)$/)
    if (vehicleMatch && req.method === 'GET') {
      const vehicle = vehicleFor(user, vehicleMatch[1])
      if (!vehicle) return fail(res, 404, '車輛不存在')
      return json(res, 200, { ...vehicle, credentials: query('SELECT * FROM credentials WHERE vehicle_id=? ORDER BY expires_on', vehicle.id), inspections: query('SELECT * FROM inspections WHERE vehicle_id=? ORDER BY appointment_on DESC', vehicle.id), inspectionGuidance: inspectionGuidance(vehicle, 'renewal') })
    }
    if (vehicleMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const old = vehicleFor(user, vehicleMatch[1]); if (!old) return fail(res, 404, '車輛不存在')
      const b = await parseBody(req)
      const next = { plate: b.plate === undefined ? old.plate : clean(b.plate, 50), brand: b.brand === undefined ? old.brand : clean(b.brand, 60), model: b.model === undefined ? old.model : clean(b.model, 60), vin: b.vin === undefined ? old.vin : clean(b.vin, 100), notes: b.notes === undefined ? old.notes : clean(b.notes, 1000), firstRegisteredOn: b.firstRegisteredOn === undefined ? old.first_registered_on : b.firstRegisteredOn === '' ? null : validDate(b.firstRegisteredOn), origin: b.origin ?? old.origin, manufacturedYear: b.manufacturedYear === undefined ? old.manufactured_year : b.manufacturedYear === '' ? null : b.manufacturedYear }
      if (!next.plate) return fail(res, 400, '車牌不可為空')
      if (b.firstRegisteredOn != null && b.firstRegisteredOn !== '' && !next.firstRegisteredOn) return fail(res, 400, '首次註冊日期無效')
      if (!['香港', '澳門', '內地'].includes(next.origin)) return fail(res, 400, '來源地無效')
      if (next.manufacturedYear !== null && next.manufacturedYear !== '' && (!Number.isInteger(next.manufacturedYear) || next.manufacturedYear < 1886 || next.manufacturedYear > 9999)) return fail(res, 400, '製造年份無效')
      db.prepare('UPDATE vehicles SET plate=?,brand=?,model=?,vin=?,notes=?,first_registered_on=?,origin=?,manufactured_year=? WHERE id=?').run(next.plate, next.brand, next.model, next.vin, next.notes, next.firstRegisteredOn, next.origin, next.manufacturedYear, old.id)
      return json(res, 200, one('SELECT * FROM vehicles WHERE id=?', old.id))
    }
    if (path === '/api/credentials' && req.method === 'GET') {
      if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限')
      const vehicleId = url.searchParams.get('vehicleId')
      if (vehicleId && !vehicleFor(user, vehicleId)) return fail(res, 404, '車輛不存在')
      return json(res, 200, vehicleId ? query('SELECT * FROM credentials WHERE vehicle_id=? ORDER BY expires_on', vehicleId) : query('SELECT cr.* FROM credentials cr JOIN vehicles v ON v.id=cr.vehicle_id JOIN customers c ON c.id=v.customer_id WHERE c.tenant_id=? ORDER BY cr.expires_on', user.tenant_id))
    }
    if (path === '/api/credentials' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      return fail(res, 405, '舊牌證資料只供查詢，請使用牌照到期項目')
    }
    const credentialMatch = path.match(/^\/api\/credentials\/([^/]+)$/)
    if (credentialMatch && req.method === 'GET') {
      if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限')
      const credential = one('SELECT * FROM credentials WHERE id=?', credentialMatch[1])
      if (!credential || !vehicleFor(user, credential.vehicle_id)) return fail(res, 404, '牌證不存在')
      return json(res, 200, credential)
    }
    if (credentialMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const credential = one('SELECT vehicle_id FROM credentials WHERE id=?', credentialMatch[1])
      if (!credential || !vehicleFor(user, credential.vehicle_id)) return fail(res, 404, '牌證不存在')
      return fail(res, 405, '舊牌證資料只供查詢，請使用牌照到期項目')
    }
    if (path === '/api/requests' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      if (['admin', 'staff'].includes(user.role)) return json(res, 200, customerId ? query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.customer_id=? AND c.tenant_id=? ORDER BY r.created_at DESC', customerId, user.tenant_id) : query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE c.tenant_id=? ORDER BY r.created_at DESC', user.tenant_id))
      return json(res, 200, query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.customer_id=? ORDER BY r.created_at DESC', user.customer_id).map(item => ({ ...item, status: requestStatus(item.status) })))
    }
    if (path === '/api/requests' && req.method === 'POST') {
      const b = await parseBody(req)
      if (!required(b, ['serviceCode', 'route', 'title'])) return fail(res, 400, '請選擇服務並填寫要求')
      const service = services.find(s => s.code === b.serviceCode && s.routes.includes(b.route))
      if (!service) return fail(res, 400, '服務類型與路線不相符')
      const customerId = user.role === 'admin' ? b.customerId : user.customer_id
      if (!customerId || !canAccessCustomer(user, customerId)) return fail(res, 400, '客戶不存在')
      if (b.vehicleId) { const vehicle = one('SELECT * FROM vehicles WHERE id=?', b.vehicleId); if (!vehicle || vehicle.customer_id !== customerId || vehicle.route !== b.route) return fail(res, 400, '車輛與客戶或路線不相符') }
      if (b.plateAssetId) { const plate = one('SELECT * FROM plate_assets WHERE id=?', b.plateAssetId); if (!plate || plate.customer_id !== customerId || plate.route !== b.route || !clean(plate.card_number)) return fail(res, 400, '兩地牌檔案與客戶或路線不相符') }
      if (service.code === 'new_application' && b.plateAssetId) return fail(res, 400, '新申請不應關聯既有兩地牌')
      const requestId = id()
      const firstStage = user.role === 'admin' ? planFor(service, b.route).stages[0] : '待內部受理'
      db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,service_code,route,title,description,status,stage,assignee_id,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, customerId, b.vehicleId || null, service.code, b.route, clean(b.title, 160), clean(b.description, 4000), '新要求', firstStage, user.role === 'admin' ? user.id : null, now(), now(),b.plateAssetId||null)
      pushActivity(requestId, user.id, 'created', user.role === 'admin' ? '管理員建立案件' : '客戶提交代辦要求')
      addTasks(requestId, service, b.route)
      return json(res, 201, one('SELECT * FROM requests WHERE id=?', requestId))
    }
    const requestMatch = path.match(/^\/api\/requests\/([^/]+)$/)
    if (requestMatch && req.method === 'GET') {
      const item = requestFor(user, requestMatch[1]); if (!item) return fail(res, 404, '案件不存在')
      const service = services.find(s => s.code === item.service_code)
      const vehicle = item.vehicle_id ? one('SELECT * FROM vehicles WHERE id=?', item.vehicle_id) : null
      const plateAsset = item.plate_asset_id ? plateFor(user,item.plate_asset_id) : null
      return json(res, 200, { ...item, activities: query('SELECT a.*,u.name actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.request_id=? ORDER BY a.created_at DESC', item.id), tasks: query('SELECT * FROM tasks WHERE request_id=? ORDER BY rowid', item.id), vehicle, plateAsset, plan: service ? planFor(service, item.route) : null, inspectionGuidance: vehicle ? inspectionGuidance(vehicle, item.service_code) : [] })
    }
    if (requestMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const item = requestFor(user, requestMatch[1]); if (!item) return fail(res, 404, '案件不存在')
      const b = await parseBody(req)
      const status = clean(b.status || item.status, 60), stage = clean(b.stage || item.stage, 100)
      const service = services.find(s => s.code === item.service_code)
      if (!['新要求', '待資格核實', '待報價／授權', '待收件', '辦理中', '待客戶配合', '待交付', '已完成', '暫停'].includes(status)) return fail(res, 400, '案件狀態無效')
      if (service && !['待內部受理', ...planFor(service, item.route).stages].includes(stage)) return fail(res, 400, '案件階段與服務路線不相符')
      if (status === '已完成') {
        const unfinished = one("SELECT COUNT(*) count FROM tasks WHERE request_id=? AND status NOT IN ('已完成','不適用')", item.id).count
        if (unfinished) return fail(res, 409, `仍有 ${unfinished} 個辦理節點未完成或未標記不適用`)
      }
      db.prepare('UPDATE requests SET status=?,stage=?,assignee_id=?,updated_at=? WHERE id=?').run(status, stage, b.assigneeId || item.assignee_id || user.id, now(), item.id)
      pushActivity(item.id, user.id, 'status', `${status} · ${stage}${b.note ? ` · ${clean(b.note, 1000)}` : ''}`)
      return json(res, 200, one('SELECT * FROM requests WHERE id=?', item.id))
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const task = one('SELECT * FROM tasks WHERE id=?', taskMatch[1]); if (!task || !requestFor(user, task.request_id)) return fail(res, 404, '任務不存在')
      const b = await parseBody(req)
      const status = clean(b.status || task.status, 40)
      if (!['待辦', '待官方核實', '辦理中', '待客戶配合', '已完成', '不適用'].includes(status)) return fail(res, 400, '任務狀態無效')
      const parent = one('SELECT * FROM requests WHERE id=?', task.request_id)
      if (parent.status === '已完成') return fail(res, 409, '已完成案件須先重新開啟，才可變更辦理節點')
      if (parent.service_code === 'new_application' && /香港 TD547D|澳門邊境通行證申請/.test(task.title) && ['辦理中', '已完成'].includes(status)) {
        const approval = one("SELECT status FROM tasks WHERE request_id=? AND title='廣東批文申請與回執'", parent.id)
        if (approval?.status !== '已完成') return fail(res, 409, '須先記錄廣東批文完成，再開始香港／澳門牌證申請')
      }
      db.prepare('UPDATE tasks SET status=?,due_on=?,notes=? WHERE id=?').run(status, clean(b.dueOn, 20) || task.due_on, clean(b.notes, 1000) || task.notes, task.id)
      pushActivity(task.request_id, user.id, 'task', `${task.title}：${status}`)
      return json(res, 200, one('SELECT * FROM tasks WHERE id=?', task.id))
    }
    if (path === '/api/inspections' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['vehicleId', 'title'])) return fail(res, 400, '請填寫車輛與驗車項目')
      if (!vehicleFor(user, b.vehicleId)) return fail(res, 404, '車輛不存在')
      if (b.requestId) { const parent = one('SELECT vehicle_id FROM requests WHERE id=?', b.requestId); if (!parent || parent.vehicle_id !== b.vehicleId) return fail(res, 400, '案件與車輛不相符') }
      if (b.sourceId && !sources.some(s => s.id === b.sourceId)) return fail(res, 400, '官方來源不存在')
      const inspectionId = id()
      db.prepare('INSERT INTO inspections VALUES (?,?,?,?,?,?,?,?,?)').run(inspectionId, b.vehicleId, b.requestId || null, clean(b.title, 160), '待預約', clean(b.appointmentOn, 20) || null, null, clean(b.sourceId, 60) || null, clean(b.notes, 1000))
      return json(res, 201, one('SELECT * FROM inspections WHERE id=?', inspectionId))
    }
    const inspectionMatch = path.match(/^\/api\/inspections\/([^/]+)$/)
    if (inspectionMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const existing = one('SELECT * FROM inspections WHERE id=?', inspectionMatch[1]); if (!existing || !vehicleFor(user, existing.vehicle_id)) return fail(res, 404, '驗車項目不存在')
      const b = await parseBody(req)
      if (b.status && !['待預約', '已預約', '檢驗中', '合格', '不合格', '不適用'].includes(b.status)) return fail(res, 400, '驗車狀態無效')
      db.prepare('UPDATE inspections SET status=?,appointment_on=?,result_on=?,notes=? WHERE id=?').run(clean(b.status, 40) || existing.status, clean(b.appointmentOn, 20) || existing.appointment_on, clean(b.resultOn, 20) || existing.result_on, clean(b.notes, 1000) || existing.notes, existing.id)
      return json(res, 200, one('SELECT * FROM inspections WHERE id=?', existing.id))
    }
    return fail(res, 404, '找不到此頁')
  } catch (error) {
    if (error instanceof SyntaxError) return fail(res, 400, 'JSON 格式錯誤')
    if (error.message === '請求內容格式錯誤') return fail(res, 400, error.message)
    if (String(error.message).includes('UNIQUE constraint')) return fail(res, 409, '資料已存在')
    console.error(error)
    return fail(res, 500, '伺服器處理失敗')
  }
})
if (process.env.API_NO_LISTEN !== '1') server.listen(port, () => console.log(`API listening on http://localhost:${port}`))
