import { computeDeadlines } from './rules.js'
import { plateFacts, vehicleFacts } from './plate-facts.js'
import { addCrossing, crossingSummary, setReminder } from './crossings.js'
import { scopeMap } from './entrustment.js'
import { driverOwners, mainPlate } from './drivers.js'
import { deadlineNotices } from './client-portal.js'
import { services, planFor } from './catalog.js'
import { companyGaps } from './plate-companies.js'

// Customer-facing summaries for the client app. Customers only see their own records, never
// internal "missing data" items, rule codes or tenant details.
const levelRank = { overdue: 0, due: 1, upcoming: 2, ok: 3 }
// editable：客戶可在客戶端直接改這個到期日（按日期記錄、不是來自批文卡的事項）
// 客戶可自行標記「已辦好」的事項（驗車、新批文備案；docs/tasks/self-handled-changes-design.md 第七節第 4 項）
const markableCodes = new Set(['inspection', 'new_card_filing', 'mo_vehicle_tax'])
const publicDeadline = (item, editable = false) => ({ code: item.ruleCode, editable, handledBy: item.handler === 'client' ? 'you' : 'us', name: item.name, ownerType: item.ownerType, ownerId: item.ownerId, ownerLabel: item.ownerLabel, dueOn: item.dueOn, daysLeft: item.daysLeft, level: item.level, detail: item.method === 'expiry' ? '' : item.detail, ...(markableCodes.has(item.ruleCode) && item.completable ? { markable: true, period: item.period } : {}) })
const plateLabel = plate => `${plate.mainland_plate || '內地車牌待補'} · ${plate.local_plate || '港澳車牌待補'}`
const companyStatus = company => company.status || '存續'
const companyFields = item => ({ id: item.id, name: item.name, nameEn: item.name_en || '', jurisdiction: item.jurisdiction, registrationNo: item.registration_no || '', companyNumber: item.company_number || '', incorporatedOn: item.incorporated_on || '', taxpayerType: item.taxpayer_type || '', status: companyStatus(item) })
// 更新紀錄裡的內部狀態字眼換成客戶看得懂的說法
const customerWords = text => String(text || '').replace(/待客戶提供|待客戶配合|待開始|新要求|待收件|進行中/g, word => requestStatus(word)).replace(/：待辦$/, '：待處理')
export const requestStatus = status => ({ '待開始': '已收到', '新要求': '已收到', '進行中': '辦理中', '待收件': '辦理中', '待客戶提供': '需要你提供資料', '待客戶配合': '需要你提供資料', '已完成': '已完成', '已取消': '已取消' }[status] || status)

export async function customerRoutes(req, res, url, user, h) {
  const { json, fail, query, one, plateFor } = h
  const path = url.pathname
  const requestMatch = path.match(/^\/api\/requests\/([^/]+)$/)
  if (requestMatch && req.method === 'GET') {
    if (user.role !== 'customer') { fail(res, 403, '此功能只供客戶使用'); return true }
    const item = one('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=? AND r.customer_id=? AND c.tenant_id=?', requestMatch[1], user.customer_id, user.tenant_id)
    if (!item) { fail(res, 404, '工單不存在'); return true }
    const tasks = query('SELECT * FROM tasks WHERE request_id=? ORDER BY sort,rowid', item.id).map(task => ({ ...task, documents: (() => { try { return JSON.parse(task.documents_json || '[]') } catch { return [] } })() }))
    const service = services.find(entry => entry.code === item.service_code)
    const clientTodos = tasks.filter(task => (task.owner === 'client' || task.status === '待客戶配合') && !['已完成', '不適用'].includes(task.status)).map(task => ({ id: task.id, title: task.title, owner: 'client', status: task.status, documents: task.documents }))
    const vehicle = item.vehicle_id ? one('SELECT * FROM vehicles WHERE id=? AND customer_id=?', item.vehicle_id, user.customer_id) : null
    const plateAsset = item.plate_asset_id ? plateFor(user, item.plate_asset_id) : null
    return json(res, 200, { ...item, status: requestStatus(item.status), activities: query('SELECT a.*,u.name actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.request_id=? ORDER BY a.created_at DESC', item.id).map(activity => ({ ...activity, detail: customerWords(activity.detail) })), tasks, clientTodos, vehicle, plateAsset, plan: service ? planFor(service, item.route) : null, inspectionGuidance: [] }), true
  }
  if (!path.startsWith('/api/my/')) return false
  if (user.role !== 'customer') { fail(res, 403, '此功能只供客戶使用'); return true }
  const crossingPost = req.method === 'POST' && /^\/api\/my\/plates\/[^/]+\/crossings$/.test(path)
  const reminderPut = req.method === 'PUT' && /^\/api\/my\/plates\/[^/]+\/crossing-reminder$/.test(path)
  if (req.method !== 'GET' && !crossingPost && !reminderPut) { fail(res, 405, '不支援此操作'); return true }
  const customer = one('SELECT id,name,tenant_id,advisor_name,advisor_phone,advisor_wechat,service_mode,is_self FROM customers WHERE id=? AND tenant_id=?', user.customer_id, user.tenant_id)
  if (!customer) { fail(res, 404, '客戶不存在'); return true }

  const plates = query("SELECT * FROM plate_assets WHERE customer_id=? AND card_number IS NOT NULL AND TRIM(card_number)<>'' ORDER BY created_at DESC", customer.id)
  const companies = query('SELECT * FROM companies WHERE customer_id=? AND tenant_id=? ORDER BY jurisdiction,name', customer.id, customer.tenant_id)
  const groups = query('SELECT * FROM company_groups WHERE customer_id=? AND tenant_id=? ORDER BY created_at', customer.id, customer.tenant_id)
  const vehicles = query('SELECT * FROM vehicles WHERE customer_id=?', customer.id)

  // Includes 'missing' items for internal use; strip them with visible() before responding.
  function deadlines() {
    const rules = query('SELECT * FROM rules WHERE tenant_id=? AND active=1 AND customer_visible=1 ORDER BY sort,name', customer.tenant_id)
      .map(rule => ({ ...rule, match: JSON.parse(rule.match_json), params: JSON.parse(rule.params_json), remindDays: rule.remind_days }))
    const owners = [
      ...plates.map(item => ({ ownerType: 'plate', ownerId: item.id, label: plateLabel(item), facts: plateFacts(item) })),
      ...companies.filter(item => companyStatus(item) !== '已註銷').map(item => ({ ownerType: 'company', ownerId: item.id, label: item.name, facts: { jurisdiction: item.jurisdiction, incorporatedOn: item.incorporated_on, status: companyStatus(item), companyStatus: companyStatus(item) } })),
      ...vehicles.map(item => { const plate = plates.find(entry => entry.vehicle_id === item.id); return { ownerType: 'vehicle', ownerId: item.id, label: item.plate, facts: vehicleFacts(item), scopeOwner: plate ? { type: 'plate', id: plate.id } : null } }),
      ...driverOwners(customer.tenant_id, customer.id)
    ]
    const tracked = new Map(query('SELECT * FROM tracked_items WHERE tenant_id=?', customer.tenant_id).map(item => [`${item.owner_type}:${item.owner_id}:${item.code}`, item]))
    const completions = new Set(query('SELECT * FROM rule_completions WHERE tenant_id=?', customer.tenant_id).map(item => `${item.code}:${item.owner_id}:${item.period}`))
    const editable = new Set(rules.filter(rule => rule.method === 'expiry' && !rule.params?.field).map(rule => rule.code))
    // 帶上客戶編號，委託範圍才按這位客戶判斷（自管客戶一律自理、客戶的事項清單）
    for (const owner of owners) owner.customerId ||= customer.id
    return computeDeadlines({ rules, owners, tracked, completions, scopes: scopeMap(customer.tenant_id), windowDays: 180 }).map(item => ({ ...publicDeadline(item, editable.has(item.ruleCode)), plateId: plateOf(item) || null }))
  }
  // Vehicle deadlines belong to the plate the vehicle is mounted on.
  const visible = list => list.filter(item => item.level !== 'missing')
  // Company deadlines point at a plate of the same company group, when there is one.
  const plateOf = item => item.ownerType === 'plate' ? item.ownerId : item.ownerType === 'driver' ? mainPlate(item.ownerId) : item.ownerType === 'vehicle' ? plates.find(plate => plate.vehicle_id === item.ownerId)?.id : plates.find(plate => plate.group_id && companies.some(company => company.id === item.ownerId && company.group_id === plate.group_id))?.id
  function groupCompanies(groupId) {
    const members = companies.filter(item => item.group_id === groupId)
    const pick = list => list.map(companyFields)
    return { offshore: pick(members.filter(item => item.jurisdiction !== '內地')), mainland: pick(members.filter(item => item.jurisdiction === '內地')) }
  }
  function plateSummary(plate, all) {
    const own = all.filter(item => plateOf(item) === plate.id || (item.ownerType === 'company' && companies.some(company => company.id === item.ownerId && company.group_id && company.group_id === plate.group_id)))
    const known = visible(own)
    const next = known.slice().sort((a, b) => levelRank[a.level] - levelRank[b.level] || String(a.dueOn).localeCompare(String(b.dueOn)))[0] || null
    // Without any known date the plate is still being set up, so do not call it "normal".
    const health = next && ['overdue', 'due'].includes(next.level) ? next.level : known.length ? 'ok' : 'pending'
    const members = plate.group_id ? groupCompanies(plate.group_id) : { offshore: [], mainland: [] }
    const card = (() => { try { return JSON.parse(plate.card_data || '{}') } catch { return {} } })()
    const rental = one("SELECT renter_name,renter_vehicle_plate,starts_on,ends_on FROM plate_rentals WHERE plate_asset_id=? AND status='出租中' ORDER BY created_at DESC LIMIT 1", plate.id)
    const warnings = members.mainland.filter(item => ['已註銷', '註銷中'].includes(item.status)).map(item => item.status === '已註銷' ? '內承單位已註銷' : '內承單位註銷中')
    return {
      id: plate.id, route: plate.route, mainlandPlate: plate.mainland_plate || '', localPlate: plate.local_plate || '', cardNumber: plate.card_number,
      usageStatus: plate.usage_status, installationStatus: plate.installation_status, indicatorCategory: plate.indicator_category || '', port: plate.port || card.crossing || '',
      holder: members.offshore[0]?.name || card.company || '', contractor: members.mainland[0]?.name || card.contractor || '',
      health, next, warnings, rental: rental ? { renter: rental.renter_name, vehiclePlate: rental.renter_vehicle_plate || '', startsOn: rental.starts_on || '', endsOn: rental.ends_on || '' } : null
    }
  }

  // 步驟名稱是內部用語（例如「各證件有效期核對」）時，改為告訴客戶要交甚麼
  const clientTodoTitle = (title, documentsJson) => {
    const text = String(title || '').replace(/^客戶/, '')
    if (/^(提供|上傳|簽|確認|填)/.test(text)) return text
    let documents = []
    try { documents = JSON.parse(documentsJson || '[]').filter(Boolean) } catch {}
    return documents.length ? `請提供：${documents.join('、')}` : text
  }
  if (path === '/api/my/overview') {
    const all = deadlines()
    const summaries = plates.map(plate => plateSummary(plate, all))
    const requests = query('SELECT r.id,r.title,r.status,r.stage,r.route,r.updated_at,r.plate_asset_id,p.mainland_plate FROM requests r LEFT JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.customer_id=? ORDER BY r.updated_at DESC', customer.id)
    const waiting = query("SELECT t.id,t.title,t.documents_json,t.request_id,r.title request_title,p.mainland_plate FROM tasks t JOIN requests r ON r.id=t.request_id LEFT JOIN plate_assets p ON p.id=r.plate_asset_id WHERE r.customer_id=? AND r.status NOT IN ('已完成','已取消') AND ((t.owner='client' AND t.status NOT IN ('已完成','不適用')) OR t.status='待客戶配合') ORDER BY r.updated_at DESC", customer.id)
    const todos = [
      ...waiting.map(item => ({ kind: 'task', requestId: item.request_id, title: clientTodoTitle(item.title, item.documents_json), subtitle: [item.mainland_plate, item.request_title].filter(Boolean).join(' · ') })),
      ...requests.filter(item => item.status === '待客戶配合' && !waiting.some(task => task.request_id === item.id)).map(item => ({ kind: 'request', requestId: item.id, title: item.stage, subtitle: [item.mainland_plate, item.title].filter(Boolean).join(' · ') }))
    ]
    deadlineNotices(customer, visible(all))
    const unread = one('SELECT COUNT(*) count FROM notifications WHERE customer_id=? AND tenant_id=? AND read_at IS NULL', customer.id, customer.tenant_id).count
    return json(res, 200, {
      unreadNotifications: unread,
      advisor: { name: customer.advisor_name || '', phone: customer.advisor_phone || '', wechat: customer.advisor_wechat || '' },
      customerName: customer.name,
      serviceMode: customer.service_mode === '自管' && !customer.is_self ? '自管' : '托管',
      counts: { pending: summaries.filter(item => item.health === 'pending').length, ok: summaries.filter(item => item.health === 'ok').length, due: summaries.filter(item => item.health === 'due').length, overdue: summaries.filter(item => item.health === 'overdue').length },
      plates: summaries,
      deadlines: visible(all).filter(item => item.level !== 'ok').sort((a, b) => levelRank[a.level] - levelRank[b.level] || String(a.dueOn).localeCompare(String(b.dueOn))),
      todos,
      activeRequests: requests.filter(item => !['已完成', '已取消'].includes(item.status)).slice(0, 5).map(item => ({ id: item.id, title: item.title, status: requestStatus(item.status), stage: item.stage, plate: item.mainland_plate || '', updatedAt: item.updated_at })),
      rentals: { active: summaries.filter(item => item.rental).length }
    }), true
  }
  if (path === '/api/my/companies') {
    const all = deadlines()
    const linked = new Set()
    const result = groups.map(group => {
      const members = groupCompanies(group.id)
      group.plates = plates.filter(plate => plate.group_id === group.id)
      group.plates.forEach(plate => linked.add(plate.id))
      return { id: group.id, name: group.name, ...members, plates: group.plates.map(plate => ({ id: plate.id, label: plateLabel(plate), indicatorCategory: plate.indicator_category || '', port: plate.port || '' })),
        deadlines: visible(all).filter(item => item.ownerType === 'company' && companies.some(company => company.id === item.ownerId && company.group_id === group.id)) }
    })
    const loose = companies.filter(item => !item.group_id).map(companyFields)
    return json(res, 200, { groups: result, ungrouped: loose }), true
  }
  if (reminderPut) {
    // The client decides which plates need the 90-day reminder.
    const plate = plateFor(user, path.split('/')[4])
    if (!plate || !plates.some(item => item.id === plate.id)) return fail(res, 404, '兩地牌不存在'), true
    const body = await h.parseBody(req), problem = setReminder({ plateId: plate.id, enabled: body?.enabled })
    if (problem) return fail(res, problem.status, problem.error), true
    const summary = crossingSummary(customer.tenant_id, plate.id)
    return json(res, 200, { enabled: summary.enabled, lastCrossedOn: summary.lastCrossedOn, nextDueOn: summary.nextDueOn, days: summary.days }), true
  }
  if (crossingPost) {
    // The client taps 「今天已過關」 (or picks another date) on a plate of their own.
    const plateId = path.split('/')[4], plate = plateFor(user, plateId)
    if (!plate || !plates.some(item => item.id === plate.id)) return fail(res, 404, '兩地牌不存在'), true
    const body = await h.parseBody(req)
    const result = addCrossing({ tenantId: customer.tenant_id, plateId: plate.id, crossedOn: body?.crossedOn, source: 'customer', userId: user.id })
    return (result.error ? fail(res, result.status, result.error) : json(res, result.status, { lastCrossedOn: result.body.lastCrossedOn, nextDueOn: result.body.nextDueOn })), true
  }
  const plateMatch = path.match(/^\/api\/my\/plates\/([^/]+)$/)
  if (plateMatch) {
    const plate = plateFor(user, plateMatch[1])
    if (!plate || !plates.some(item => item.id === plate.id)) return fail(res, 404, '兩地牌不存在'), true
    const all = deadlines()
    const summary = plateSummary(plate, all)
    const own = all.filter(item => plateOf(item) === plate.id || (item.ownerType === 'company' && companies.some(company => company.id === item.ownerId && company.group_id && company.group_id === plate.group_id)))
    const requests = query('SELECT id,title,status,stage,updated_at FROM requests WHERE customer_id=? AND plate_asset_id=? ORDER BY updated_at DESC', customer.id, plate.id)
    const crossing = crossingSummary(customer.tenant_id, plate.id)
    return json(res, 200, { ...summary, crossing: { enabled: crossing.enabled, lastCrossedOn: crossing.lastCrossedOn, nextDueOn: crossing.nextDueOn, days: crossing.days }, deadlines: visible(own).sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn))), requests: requests.map(item => ({ id: item.id, title: item.title, status: requestStatus(item.status), stage: item.stage, updatedAt: item.updated_at })), companyGaps: companyGaps(customer.tenant_id, plate.group_id), drivers: query("SELECT d.id, d.name, pd.role FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY CASE pd.role WHEN '主' THEN 0 ELSE 1 END, pd.sort", plate.id) }), true
  }
  return fail(res, 404, '找不到此頁'), true
}
