import { db, id, now } from './db.js'
import { plateFacts } from './plate-facts.js'
import { deadlineOwners } from './deadline-owners.js'
import { driverFor } from './drivers.js'
import { rentOverview } from './rentals.js'
import { filingDeadlines } from './bookkeeping.js'
import { scopeMap } from './entrustment.js'
import { computeDeadlines, ruleMatches, ruleScopes, ruleMethods, matchKeys, dateFields } from './rules.js'

const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const validMatch = value => object(value) && Object.entries(value).every(([key, entry]) => matchKeys.includes(key) && (key === 'crossingReminder' ? entry === 1 : typeof entry === 'string' || Array.isArray(entry) && entry.every(part => typeof part === 'string')))
const validParams = (method, value) => {
  if (!object(value)) return false
  const keys = Object.keys(value)
  if (method === 'expiry') return keys.length === 0 || keys.length === 1 && value.field === 'cardExpiresOn'
  if (method === 'anniversary') return keys.length === 1 && integer(value.offsetDays, -3650, 3650)
  if (method === 'yearly') return keys.length === 2 && integer(value.month, 1, 12) && integer(value.day, 1, new Date(Date.UTC(2024, value.month, 0)).getUTCDate())
  if (method === 'inspection') return keys.length === 3 && ['markYears', 'inspectYears'].every(key => Array.isArray(value[key]) && value[key].every(year => integer(year, 1, 200))) && integer(value.yearlyFrom, 1, 200)
  if (method === 'since_last' || method === 'after_field') return keys.length === 2 && dateFields[method].includes(value.field) && integer(value.days, 1, 3650)
  if (method === 'periodic') return keys.every(key => ['months', 'officialUrl'].includes(key)) && Array.isArray(value.months) && value.months.length > 0 && value.months.every(month => integer(month, 1, 12)) && (!('officialUrl' in value) || typeof value.officialUrl === 'string' && /^https?:\/\//.test(value.officialUrl))
  return false
}
const decoded = row => ({ ...row, match: JSON.parse(row.match_json), params: JSON.parse(row.params_json), remindDays: row.remind_days, customerVisible: Boolean(row.customer_visible) })

export async function phase1Routes(req, res, url, user, h) {
  const { json, fail, parseBody, canAccessCustomer, vehicleFor, plateFor, query, one, clean } = h
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  if (!(/^\/api\/(company-groups|companies|tracked-items|rules|rule-completions|overview)(\/[^/]+)?$/.test(path) || path === '/api/tracked-items/bulk' || /^\/api\/companies\/[^/]+\/hk-lookup$/.test(path))) return false
  const staffReadOnly = user.role === 'staff' && ((method === 'GET' && /^\/api\/(company-groups|companies|tracked-items|rules|overview)(\/[^/]+)?$/.test(path)) || ['/api/tracked-items', '/api/tracked-items/bulk'].includes(path) && method === 'PUT' || path === '/api/rule-completions' && ['POST', 'DELETE'].includes(method))
  if (user.role !== 'admin' && !staffReadOnly) { fail(res, 403, '無權限'); return true }
  const send = (status, value) => { json(res, status, value); return true }
  const error = (status, message) => { fail(res, status, message); return true }
  const customer = customerId => canAccessCustomer(user, customerId)
  const group = groupId => one('SELECT * FROM company_groups WHERE id=? AND tenant_id=?', groupId, tenant)
  const company = companyId => one('SELECT * FROM companies WHERE id=? AND tenant_id=?', companyId, tenant)
  const owner = (type, ownerId) => {
    if (type === 'plate') return plateFor(user, ownerId)
    if (type === 'vehicle') return vehicleFor(user, ownerId)
    if (type === 'company') return company(ownerId)
    if (type === 'driver') return driverFor(tenant, ownerId)
    return null
  }
  const facts = (type, item) => type === 'driver' ? {} : type === 'plate' ? plateFacts(item) : type === 'vehicle' ? { route: item.route, origin: item.origin, firstRegisteredOn: item.first_registered_on } : { jurisdiction: item.jurisdiction, status: item.status || '存續', companyStatus: item.status || '存續', incorporatedOn: item.incorporated_on }
  const statusWarnings = companies => [...new Set(companies.filter(item => item.jurisdiction === '內地' && ['已註銷', '註銷中'].includes(item.status)).map(item => item.status === '已註銷' ? '內承單位已註銷' : '內承單位註銷中'))]
  const companyStatusInfo = (groupId, customerId) => query('SELECT id,jurisdiction,name,status,status_changed_on FROM companies WHERE tenant_id=? AND group_id=? AND customer_id=? ORDER BY jurisdiction,name', tenant, groupId, customerId)
  const rules = () => query('SELECT * FROM rules WHERE tenant_id=? ORDER BY sort,name', tenant).map(decoded)
  const companySummary = item => {
    if (item.jurisdiction !== '香港') return item
    const br = one('SELECT expires_on FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code=?', tenant, 'company', item.id, 'hk_br')
    const nar1Rule = rules().find(rule => rule.code === 'hk_nar1' && rule.active)
    const completions = new Set(query('SELECT code,owner_id,period FROM rule_completions WHERE tenant_id=? AND code=? AND owner_id=?', tenant, 'hk_nar1', item.id).map(entry => `${entry.code}:${entry.owner_id}:${entry.period}`))
    const nar1 = nar1Rule && computeDeadlines({ rules: [nar1Rule], owners: [{ ownerType: 'company', ownerId: item.id, label: item.name, customerId: item.customer_id, facts: facts('company', item) }], tracked: new Map(), completions, windowDays: 365 }).find(entry => entry.ruleCode === 'hk_nar1')
    return { ...item, brExpiresOn: br?.expires_on || null, nar1DueOn: nar1?.dueOn || null }
  }
  const customerId = url.searchParams.get('customerId')

  if (path === '/api/company-groups' && method === 'GET') {
    if (customerId && !customer(customerId)) return error(404, '客戶不存在')
    const groups = customerId ? query('SELECT * FROM company_groups WHERE tenant_id=? AND customer_id=? ORDER BY created_at DESC', tenant, customerId) : query('SELECT * FROM company_groups WHERE tenant_id=? ORDER BY created_at DESC', tenant)
    return send(200, groups.map(item => {
      const companies = companyStatusInfo(item.id, item.customer_id), warnings = statusWarnings(companies)
      return { ...item, companies: query('SELECT * FROM companies WHERE tenant_id=? AND group_id=? AND customer_id=? ORDER BY name', tenant, item.id, item.customer_id).map(companySummary), warnings, plates: query('SELECT id,route,mainland_plate,local_plate,indicator_category,port,usage_status FROM plate_assets WHERE group_id=? AND customer_id=?', item.id, item.customer_id).map(plate => ({ ...plate, companyStatuses: companies, warnings })) }
    }))
  }
  if (path === '/api/company-groups' && method === 'POST') {
    const body = await parseBody(req)
    if (!customer(body.customerId)) return error(404, '客戶不存在')
    if (!clean(body.name)) return error(400, '請填寫公司組名稱')
    const groupId = id()
    db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,notes,created_at) VALUES (?,?,?,?,?,?)').run(groupId, tenant, body.customerId, clean(body.name, 160), clean(body.notes, 1000), now())
    return send(201, group(groupId))
  }
  const groupMatch = path.match(/^\/api\/company-groups\/([^/]+)$/)
  if (groupMatch && method === 'PATCH') {
    const old = group(groupMatch[1]); if (!old) return error(404, '公司組不存在')
    const body = await parseBody(req)
    if (body.name !== undefined && !clean(body.name)) return error(400, '請填寫公司組名稱')
    db.prepare('UPDATE company_groups SET name=?,notes=? WHERE id=? AND tenant_id=?').run(body.name === undefined ? old.name : clean(body.name, 160), body.notes === undefined ? old.notes : clean(body.notes, 1000), old.id, tenant)
    return send(200, group(old.id))
  }
  if (path === '/api/companies' && method === 'GET') {
    if (customerId && !customer(customerId)) return error(404, '客戶不存在')
    return send(200, (customerId ? query('SELECT * FROM companies WHERE tenant_id=? AND customer_id=? ORDER BY name', tenant, customerId) : query('SELECT * FROM companies WHERE tenant_id=? ORDER BY name', tenant)).map(companySummary))
  }
  if (path === '/api/companies' && method === 'POST' || /^\/api\/companies\/[^/]+$/.test(path) && method === 'PATCH') {
    const old = method === 'PATCH' ? company(path.split('/').pop()) : null
    if (method === 'PATCH' && !old) return error(404, '公司不存在')
    const body = await parseBody(req), targetCustomer = body.customerId ?? old?.customer_id
    if (body.customerId === null || body.name === null || body.jurisdiction === null) return error(400, '公司必填欄位不可為空')
    if (old && body.customerId !== undefined && body.customerId !== old.customer_id) return error(400, '公司不可搬到其他客戶')
    if (typeof targetCustomer !== 'string' || !targetCustomer.trim()) return error(400, '客戶 ID 無效')
    if (!customer(targetCustomer)) return error(404, '客戶不存在')
    if (body.name !== undefined && typeof body.name !== 'string' || body.jurisdiction !== undefined && typeof body.jurisdiction !== 'string' || body.registrationNo !== undefined && body.registrationNo !== null && typeof body.registrationNo !== 'string' || body.groupId !== undefined && body.groupId !== null && typeof body.groupId !== 'string') return error(400, '公司欄位類型無效')
    const jurisdiction = body.jurisdiction ?? old?.jurisdiction, name = body.name ?? old?.name
    if (!['香港', '澳門', '內地'].includes(jurisdiction) || !clean(name)) return error(400, '公司名稱或司法區無效')
    if (jurisdiction === '內地' && body.taxpayerType !== undefined && body.taxpayerType !== null && typeof body.taxpayerType !== 'string') return error(400, '納稅人類型無效')
    if (body.incorporatedOn !== undefined && body.incorporatedOn !== '' && body.incorporatedOn !== null && !date(body.incorporatedOn)) return error(400, '成立日期無效')
    const statuses = ['存續', '經營異常', '註銷中', '已註銷']
    const status = body.status === undefined ? old?.status ?? '存續' : body.status
    if (!statuses.includes(status)) return error(400, '公司狀態無效')
    if (body.statusChangedOn !== undefined && body.statusChangedOn !== '' && body.statusChangedOn !== null && !date(body.statusChangedOn)) return error(400, '狀態變更日期無效')
    const groupId = body.groupId === undefined ? old?.group_id : body.groupId || null
    if (groupId) { const parent = group(groupId); if (!parent) return error(404, '公司組不存在'); if (parent.customer_id !== targetCustomer) return error(400, '公司組與客戶不符') }
    const taxpayerType = jurisdiction === '內地' ? body.taxpayerType ?? (old?.jurisdiction === '內地' ? old.taxpayer_type : '') : ''
    if (jurisdiction === '內地' && taxpayerType && !['小規模納稅人', '一般納稅人'].includes(taxpayerType)) return error(400, '納稅人類型無效')
    if (body.companyNumber !== undefined && body.companyNumber !== null && typeof body.companyNumber !== 'string') return error(400, '公司編號無效')
    const companyNumber = jurisdiction === '香港' ? clean(body.companyNumber ?? (old?.jurisdiction === '香港' ? old.company_number : ''), 100) : ''
    const values = [tenant, targetCustomer, groupId || null, jurisdiction, clean(name, 160), clean(body.registrationNo ?? old?.registration_no, 100), body.incorporatedOn === undefined ? old?.incorporated_on || null : body.incorporatedOn || null, clean(taxpayerType, 100), clean(body.notes ?? old?.notes, 1000), status, body.statusChangedOn === undefined ? old?.status_changed_on || null : body.statusChangedOn || null, companyNumber]
    if (old) {
      db.prepare('UPDATE companies SET tenant_id=?,customer_id=?,group_id=?,jurisdiction=?,name=?,registration_no=?,incorporated_on=?,taxpayer_type=?,notes=?,status=?,status_changed_on=?,company_number=?,updated_at=? WHERE id=? AND tenant_id=?').run(...values, now(), old.id, tenant)
      return send(200, company(old.id))
    }
    const companyId = id()
    db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,registration_no,incorporated_on,taxpayer_type,notes,status,status_changed_on,company_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId, ...values, now(), now())
    return send(201, company(companyId))
  }
  const hkLookupMatch = path.match(/^\/api\/companies\/([^/]+)\/hk-lookup$/)
  if (hkLookupMatch && method === 'POST') {
    const item = company(hkLookupMatch[1]); if (!item) return error(404, '公司不存在')
    if (item.jurisdiction !== '香港') return error(400, '只有香港公司可向公司註冊處查詢')
    if (!/^\d{8}$/.test(String(item.registration_no || ''))) return error(400, '請先填寫 8 位商業登記號碼')
    const endpoint = process.env.HK_COMPANY_LOOKUP_URL || 'https://data.cr.gov.hk/cr/api/api/v1/api_builder/json/local/search'
    const lookupUrl = new URL(endpoint)
    lookupUrl.searchParams.set('query[0][key1]', 'Brn')
    lookupUrl.searchParams.set('query[0][key2]', 'equal')
    lookupUrl.searchParams.set('query[0][key3]', item.registration_no)
    let response
    try {
      response = await fetch(lookupUrl, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
      if (!response.ok) return error(502, `公司註冊處接口回應錯誤（HTTP ${response.status}）`)
    } catch (lookupError) {
      if (lookupError.name === 'TimeoutError' || lookupError.name === 'AbortError') return error(504, '公司註冊處查詢逾時，請稍後再試')
      return error(502, '無法連線公司註冊處，請稍後再試')
    }
    let payload
    try { payload = await response.json() } catch { return error(502, '公司註冊處回傳格式無法辨識') }
    const records = []
    const collect = value => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') { if (value.Brn || value.Chinese_Company_Name || value.English_Company_Name) records.push(value); Object.values(value).forEach(collect) } }
    collect(payload)
    const found = records.find(record => String(record.Brn || '').replace(/\D/g, '') === item.registration_no)
    if (!found) return error(404, '公司註冊處查無此存續公司，請人工核實')
    const convertDate = value => { const match = String(value || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : null }
    return send(200, { registrationNo: String(found.Brn || item.registration_no), name: found.Chinese_Company_Name || found.English_Company_Name || item.name, englishName: found.English_Company_Name || '', address: found.Address_of_Registered_Office || '', companyType: found.Company_Type || '', incorporatedOn: convertDate(found.Date_of_Incorporation), redomiciliationDate: convertDate(found['Re-domiciliation_Date']) })
  }
  if (path === '/api/rules' && method === 'GET') return send(200, rules())
  if (path === '/api/rules' && method === 'POST' || /^\/api\/rules\/[^/]+$/.test(path) && method === 'PATCH') {
    const old = method === 'PATCH' ? one('SELECT * FROM rules WHERE id=? AND tenant_id=?', path.split('/').pop(), tenant) : null
    if (method === 'PATCH' && !old) return error(404, '規則不存在')
    const body = await parseBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error(400, '規則內容無效')
    if (old && ['code','scope','method'].some(key => body[key] !== undefined)) return error(400, '不可修改規則代碼、對象或計算方式')
    const code = body.code, scope = old?.scope ?? body.scope, ruleMethod = old?.method ?? body.method
    const match = body.match === undefined ? old ? JSON.parse(old.match_json) : {} : body.match, params = body.params === undefined ? old ? JSON.parse(old.params_json) : {} : body.params
    const remindDays = body.remindDays === undefined ? old?.remind_days ?? 30 : body.remindDays
    const customerVisible = body.customerVisible === undefined ? old ? Boolean(old.customer_visible) : true : body.customerVisible
    if (!old && (!/^[a-z][a-z0-9_]{1,39}$/.test(code || '') || !ruleScopes.includes(scope) || !ruleMethods.includes(ruleMethod))) return error(400, '規則代碼、對象或方式無效')
    if (params.field === 'cardExpiresOn' && scope !== 'plate') return error(400, '批文卡有效期來源只適用於兩地牌')
    if (['since_last', 'after_field'].includes(ruleMethod) && scope !== 'plate') return error(400, '過關及批文日期計算只適用於兩地牌')
    if (!clean(body.name ?? old?.name) || !integer(remindDays, 0, 730) || !validMatch(match) || !validParams(ruleMethod, params) || body.active !== undefined && typeof body.active !== 'boolean' || typeof customerVisible !== 'boolean') return error(400, '規則內容無效')
    if (old) {
      db.prepare('UPDATE rules SET name=?,remind_days=?,active=?,customer_visible=?,match_json=?,params_json=? WHERE id=? AND tenant_id=?').run(clean(body.name ?? old.name, 160), remindDays, body.active === undefined ? old.active : Number(body.active), Number(customerVisible), JSON.stringify(match), JSON.stringify(params), old.id, tenant)
      return send(200, decoded(one('SELECT * FROM rules WHERE id=?', old.id)))
    }
    if (one('SELECT id FROM rules WHERE tenant_id=? AND code=?', tenant, code)) return error(409, '規則代碼已存在')
    const ruleId = id()
    db.prepare('INSERT INTO rules(id,tenant_id,code,name,scope,method,match_json,params_json,remind_days,active,customer_visible,sort) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)').run(ruleId, tenant, code, clean(body.name, 160), scope, ruleMethod, JSON.stringify(match), JSON.stringify(params), remindDays, Number(customerVisible), 1000)
    return send(201, decoded(one('SELECT * FROM rules WHERE id=?', ruleId)))
  }
  if (path === '/api/tracked-items' && method === 'GET') {
    const type = url.searchParams.get('ownerType'), ownerId = url.searchParams.get('ownerId'), item = owner(type, ownerId)
    if (!item) return error(404, '對象不存在')
    return send(200, rules().filter(rule => rule.active && rule.scope === type && rule.method === 'expiry' && ruleMatches(rule, facts(type, item))).map(rule => {
      const tracked = one('SELECT * FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code=?', tenant, type, ownerId, rule.code)
      const readOnly = rule.params?.field === 'cardExpiresOn'
      return { code: rule.code, name: rule.name, remindDays: rule.remind_days, expiresOn: readOnly ? item.card_expires_on || null : tracked?.expires_on || null, notes: tracked?.notes || '', updatedBy: tracked?.updated_by || null, updatedAt: tracked?.updated_at || null, ...(readOnly ? { readOnly: true, source: '批文卡有效期' } : {}) }
    }))
  }
  if (path === '/api/tracked-items' && method === 'PUT') {
    const body = await parseBody(req), item = owner(body.ownerType, body.ownerId)
    if (!item) return error(404, '對象不存在')
    const rule = one('SELECT * FROM rules WHERE tenant_id=? AND code=? AND scope=? AND method=? AND active=1', tenant, body.code, body.ownerType, 'expiry')
    if (!rule || !ruleMatches(decoded(rule), facts(body.ownerType, item))) return error(400, '到期規則不適用')
    if (JSON.parse(rule.params_json).field === 'cardExpiresOn') return error(400, '此日期來自批文卡，請在批文卡修改')
    if (body.expiresOn !== '' && !date(body.expiresOn)) return error(400, '到期日期無效')
    db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(tenant, body.ownerType, body.ownerId, body.code, body.expiresOn || null, clean(body.notes, 1000), user.id, now())
    return send(200, one('SELECT * FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code=?', tenant, body.ownerType, body.ownerId, body.code))
  }
  if (path === '/api/tracked-items/bulk' && method === 'PUT') {
    const body = await parseBody(req)
    if (!Array.isArray(body.plateIds) || !body.plateIds.length || body.plateIds.length > 500 || new Set(body.plateIds).size !== body.plateIds.length || body.plateIds.some(plateId => typeof plateId !== 'string' || !plateId.trim()) || typeof body.code !== 'string' || !body.code.trim() || typeof body.expiresOn !== 'string' || !date(body.expiresOn)) return error(400, '牌照或到期日期無效')
    const rule = one('SELECT * FROM rules WHERE tenant_id=? AND code=? AND scope=? AND method=? AND active=1', tenant, body.code, 'plate', 'expiry')
    if (!rule || JSON.parse(rule.params_json).field === 'cardExpiresOn') return error(400, '到期規則不適用')
    const plates = body.plateIds.map(plateId => plateFor(user, plateId))
    if (plates.some(plate => !plate || !ruleMatches(decoded(rule), facts('plate', plate)))) return error(400, '牌照不存在或規則不適用')
    db.exec('BEGIN IMMEDIATE')
    try {
      const statement = db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
      for (const plateId of body.plateIds) statement.run(tenant, 'plate', plateId, body.code, body.expiresOn, '', user.id, now())
      db.exec('COMMIT')
    } catch (failure) { db.exec('ROLLBACK'); throw failure }
    return send(200, { updated: body.plateIds.length })
  }
  if (path === '/api/rule-completions' && ['POST','DELETE'].includes(method)) {
    const body = await parseBody(req), rule = one('SELECT * FROM rules WHERE tenant_id=? AND code=? AND method<>?', tenant, body.ruleCode, 'expiry')
    const item = rule && owner(rule.scope, body.ownerId)
    if (!rule || !item) return error(404, '規則或對象不存在')
    if (method === 'POST' && (!rule.active || !ruleMatches(decoded(rule), facts(rule.scope, item)))) return error(400, '規則不適用於此對象')
    if (rule.method === 'since_last') return error(400, '此事項請錄入最近一次日期，不用標記完成')
    if (typeof body.period !== 'string' || !(rule.method === 'after_field' ? date(body.period) : /^(\d{4}|\d{4}-(0[1-9]|1[0-2]))$/.test(body.period))) return error(400, '期數無效')
    if (method === 'POST') db.prepare('INSERT INTO rule_completions(tenant_id,code,owner_id,period,completed_by,completed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(code,owner_id,period) DO UPDATE SET completed_by=excluded.completed_by,completed_at=excluded.completed_at').run(tenant, rule.code, body.ownerId, body.period, user.id, now())
    else db.prepare('DELETE FROM rule_completions WHERE tenant_id=? AND code=? AND owner_id=? AND period=?').run(tenant, rule.code, body.ownerId, body.period)
    return send(200, { ok: true })
  }
  if (path === '/api/overview' && method === 'GET') {
    const days = url.searchParams.has('days') ? Number(url.searchParams.get('days')) : 90
    if (!integer(days, 7, 365)) return error(400, '天數須為 7–365')
    const { customers, plates, companies, owners } = deadlineOwners(tenant)
    const tracked = new Map(query('SELECT * FROM tracked_items WHERE tenant_id=?', tenant).map(item => [`${item.owner_type}:${item.owner_id}:${item.code}`, item]))
    const completions = new Set(query('SELECT * FROM rule_completions WHERE tenant_id=?', tenant).map(item => `${item.code}:${item.owner_id}:${item.period}`))
    const { rent, deadlines: rentDeadlines } = rentOverview(tenant)
    // 司機證件未填日期時只在司機列表顯示「待錄入」，不計入今日工作（大部分司機不會三種證件都有）
    const deadlines = [...computeDeadlines({ rules: rules(), owners, tracked, completions, scopes: scopeMap(tenant), windowDays: days }).filter(item => item.level !== 'ok' && !(item.ownerType === 'driver' && item.level === 'missing')), ...rentDeadlines, ...filingDeadlines(tenant)]
    // Items the client handles themselves are listed (for the client view) but never counted as our work.
    const ours = deadlines.filter(item => item.handler !== 'client')
    const counts = Object.fromEntries(['overdue','due','missing','upcoming'].map(level => [level, ours.filter(item => item.level === level).length]))
    const byUsage = Object.fromEntries([...new Set(plates.map(item => item.usage_status))].map(status => [status, plates.filter(item => item.usage_status === status).length]))
    return send(200, { deadlines, counts, rent, plates: { total: plates.length, byUsage }, customers: customers.map(item => {
      const entries = ours.filter(entry => entry.customerId === item.id), overdue = entries.filter(entry => entry.level === 'overdue').length, due = entries.filter(entry => entry.level === 'due').length, missing = entries.filter(entry => entry.level === 'missing').length
      const customerCompanies = companies.filter(company => company.customer_id === item.id)
      return { ...item, plates: plates.filter(plate => plate.customer_id === item.id).length, companies: customerCompanies.filter(company => company.status !== '已註銷').length, dissolvedCompanies: customerCompanies.filter(company => company.status === '已註銷').length, overdue, due, missing, health: overdue ? 'red' : due || missing ? 'amber' : 'green' }
    }) })
  }
  return error(404, '找不到此頁')
}
