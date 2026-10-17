import { db, id, now } from './db.js'
import { cardData, cardFields } from './card.js'
import { notify } from './client-portal.js'
import { maskHkId } from './drivers.js'
import { mainlandName, toSimplified, traditionalChars } from './hans.js'
import { plateFacts, vehicleFacts } from './plate-facts.js'
import { ruleMatches } from './rules.js'

// 客戶自行修改，後台核對（管理者 2026-10-17）：客戶改的資料立即生效，每個欄位留下改前改後，
// 標為「待核對」；管理者在今日工作逐項「核對無誤」或「改回」，改回時通知客戶。
db.exec(`CREATE TABLE IF NOT EXISTS customer_changes(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, entity_label TEXT NOT NULL, field TEXT NOT NULL, field_label TEXT NOT NULL, before_value TEXT, after_value TEXT, before_text TEXT, after_text TEXT, is_date INTEGER NOT NULL DEFAULT 0, changed_by TEXT, changed_by_name TEXT, changed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待核對', reviewed_by TEXT, reviewed_by_name TEXT, reviewed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_customer_changes_status ON customer_changes(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_changes_entity ON customer_changes(entity_type, entity_id, field);`)

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max)
const text = value => value == null ? '' : String(value)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

export const cardLabels = { cardNumber: '批文卡編號', company: '商號', contractor: '內承單位', crossing: '通行口岸', serial: '卡面流水號', mainlandPlate: '內地車牌號', localPlate: '港澳車牌號', driver1: '駕駛人 1', driver2: '駕駛人 2', driver3: '駕駛人 3', currentApproval: '現批文號', previousApproval: '原批文號', color: '顏色', seats: '座位／噸位', purpose: '請予辦理', validFrom: '有效期開始', validTo: '有效期結束', notes: '備註' }
// 批文卡欄位同時寫在牌照的這些欄（與 PUT /plate-assets/:id 一致）
const cardColumns = { cardNumber: 'card_number', validTo: 'card_expires_on', mainlandPlate: 'mainland_plate', localPlate: 'local_plate' }
const cardDates = new Set(['validFrom', 'validTo'])
// 每類資料可改的欄位：介面名 → [資料欄, 標籤, 是否日期]
const specs = {
  plate: { table: 'plate_assets', fields: { mainlandPlate: ['mainland_plate', '內地車牌號'], localPlate: ['local_plate', '香港／澳門車牌號'], installationStatus: ['installation_status', '上牌狀態'], vehicleId: ['vehicle_id', '綁定車輛'], cardExpiresOn: ['card_expires_on', '批文卡有效期至', true], notes: ['notes', '備註'], cardNumber: ['card_number', '批文卡編號'] } },
  company: { table: 'companies', fields: { name: ['name', '公司名稱'], nameEn: ['name_en', '英文名稱'], registrationNo: ['registration_no', '登記號碼'], companyNumber: ['company_number', '公司編號'], incorporatedOn: ['incorporated_on', '成立日期', true], taxpayerType: ['taxpayer_type', '納稅人類型'] } },
  vehicle: { table: 'vehicles', fields: { plate: ['plate', '車牌'], brand: ['brand', '品牌'], model: ['model', '型號'], vin: ['vin', '車架號碼'], manufacturedYear: ['manufactured_year', '製造年份'], firstRegisteredOn: ['first_registered_on', '首次登記日期', true] } },
  driver: { table: 'drivers', fields: { name: ['name', '姓名'], phone: ['phone', '電話'], hkIdNo: ['hk_id_no', '香港身份證號碼'], homeReturnPermitNo: ['home_return_permit_no', '回鄉證號碼'] } },
  // 委託人資料（我的資料，2026-10-18）：名稱會用在合約和帳單，所以改了也要管理者核對
  customer: { table: 'customers', fields: { name: ['name', '委託人名稱'], kind: ['kind', '類型'], phone: ['phone', '聯絡電話'] } }
}
// 沒有 updated_at 欄的資料表
const noUpdatedAt = new Set(['vehicles', 'customers'])
const registrationLabel = jurisdiction => jurisdiction === '內地' ? '統一社會信用代碼' : jurisdiction === '澳門' ? '商業登記編號' : '商業登記號碼'
const entityName = { card: '批文卡', plate: '牌照', company: '公司', vehicle: '車輛', driver: '司機', customer: '委託人資料' }
// 通知裏按一下打開的頁面
const changeLink = change => ['card', 'plate'].includes(change.entity_type) ? `/pages/plate-detail/plate-detail?id=${change.entity_id}` : change.entity_type === 'company' ? '/pages/companies/companies' : change.entity_type === 'customer' ? '/pages/profile/profile' : change.entity_type === 'vehicle' ? '/pages/vehicles/vehicles' : ''
// 核對無誤也通知客戶（管理者 2026-10-18）：同一對象合成一則，每個對象每天最多一則，免得逐欄核對時連發
function notifyAccepted(tenantId, rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.customer_id}:${row.entity_type}:${row.entity_id}`
    groups.set(key, [...(groups.get(key) || []), row])
  }
  const day = now().slice(0, 10)
  for (const group of groups.values()) {
    const first = group[0], fields = [...new Set(group.map(row => row.field_label))]
    notify({ tenantId, customerId: first.customer_id, kind: 'change_accepted', title: `顧問已核對你更新的「${first.entity_label}」`, body: `${fields.slice(0, 5).join('、')}${fields.length > 5 ? ` 等 ${fields.length} 項` : ''}已核對無誤。`, link: changeLink(first), dedupeKey: `change_accepted:${first.entity_type}:${first.entity_id}:${day}` })
  }
}

export const plateLabel = plate => plate.mainland_plate || plate.local_plate || `批文卡 ${plate.card_number || ''}`.trim()
const vehicleText = vehicleId => vehicleId ? db.prepare('SELECT plate FROM vehicles WHERE id=?').get(vehicleId)?.plate || '' : '未綁定'
const ownerRow = (type, ownerId) => type === 'card' || type === 'plate' ? db.prepare('SELECT * FROM plate_assets WHERE id=?').get(ownerId) : specs[type] ? db.prepare(`SELECT * FROM ${specs[type].table} WHERE id=?`).get(ownerId) : null
function labelOf(type, row) {
  if (type === 'card' || type === 'plate') return plateLabel(row)
  if (type === 'company') return row.name
  if (type === 'vehicle') return row.plate
  if (type === 'customer') return row.name
  return `司機 ${row.name}`
}

// 自管客戶（docs/requirements.md 5.6.2）改資料不進「客戶更新待核對」，以免淹沒托管客戶的核對；資料照樣即時生效
export const selfManagedCustomer = customerId => db.prepare("SELECT 1 FROM customers WHERE id=? AND service_mode='自管' AND COALESCE(is_self,0)=0").get(customerId) !== undefined
// 記錄一批欄位修改。同一欄位已有待核對的修改時合併成一筆（保留最初的改前值）；改回原值則撤銷該筆。
export function logChanges({ tenantId, customerId, user, entityType, entityId, entityLabel, changes }) {
  if (selfManagedCustomer(customerId)) return
  for (const change of changes) {
    const before = text(change.before), after = text(change.after)
    if (before === after) continue
    const pending = db.prepare("SELECT * FROM customer_changes WHERE tenant_id=? AND entity_type=? AND entity_id=? AND field=? AND status='待核對'").get(tenantId, entityType, entityId, change.field)
    if (pending && text(pending.before_value) === after) { db.prepare('DELETE FROM customer_changes WHERE id=?').run(pending.id); continue }
    if (pending) { db.prepare('UPDATE customer_changes SET after_value=?,after_text=?,entity_label=?,changed_by=?,changed_by_name=?,changed_at=? WHERE id=?').run(after, change.afterText ?? after, entityLabel, user.id, user.name, now(), pending.id); continue }
    db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,before_value,after_value,before_text,after_text,is_date,changed_by,changed_by_name,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(), tenantId, customerId, entityType, entityId, entityLabel, change.field, change.label, before, after, change.beforeText ?? before, change.afterText ?? after, change.isDate ? 1 : 0, user.id, user.name, now())
  }
}
// 客戶新建批文卡：記一筆「新建檔」，讓管理者在同一個清單看到
export function logCreated({ tenantId, user, plate }) {
  if (selfManagedCustomer(plate.customer_id)) return
  db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,before_value,after_value,before_text,after_text,is_date,changed_by,changed_by_name,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(), tenantId, plate.customer_id, 'card', plate.id, plateLabel(plate), 'created', '新建批文卡', '', plate.card_number, '', `批文卡 ${plate.card_number}`, 0, user.id, user.name, now())
}
// 客戶建檔批文卡時按名稱新建的公司：同樣列在待核對清單
export function logCompanyCreated({ tenantId, user, customerId, company }) {
  if (selfManagedCustomer(customerId)) return
  const label = `${company.jurisdiction}公司 ${company.name}`
  db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,before_value,after_value,before_text,after_text,is_date,changed_by,changed_by_name,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(), tenantId, customerId, 'company', company.id, company.name, 'created', '由批文卡新建公司', '', company.name, '', label, 0, user.id, user.name, now())
}
// 批文卡的改動（建檔後修改或上傳新卡）
export function logCardChanges({ tenantId, user, plate, before, after }) {
  const oldCard = cardData(JSON.stringify(before)), newCard = cardData(JSON.stringify(after))
  logChanges({ tenantId, customerId: plate.customer_id, user, entityType: 'card', entityId: plate.id, entityLabel: plateLabel({ ...plate, mainland_plate: newCard.mainlandPlate || plate.mainland_plate, card_number: newCard.cardNumber || plate.card_number }),
    changes: cardFields.map(key => ({ field: key, label: cardLabels[key], before: oldCard[key], after: newCard[key], isDate: cardDates.has(key) })) })
}
// 牌照資料的改動（PATCH /plate-assets/:id）
export function logPlateChanges({ tenantId, user, before, after }) {
  logChanges({ tenantId, customerId: before.customer_id, user, entityType: 'plate', entityId: before.id, entityLabel: plateLabel(after),
    changes: Object.entries(specs.plate.fields).map(([field, [column, label, isDate]]) => ({ field, label, before: before[column], after: after[column], isDate, ...(field === 'vehicleId' ? { beforeText: vehicleText(before[column]), afterText: vehicleText(after[column]) } : {}) })) })
}

// 讀出、寫入單一欄位（核對「改回」用）
function readField(change) {
  const row = ownerRow(change.entity_type, change.entity_id)
  if (!row) return { missing: true }
  if (change.field.startsWith('date:')) return { row, value: db.prepare('SELECT expires_on FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code=?').get(change.tenant_id, change.entity_type, change.entity_id, change.field.slice(5))?.expires_on ?? '' }
  if (change.entity_type === 'card') return { row, value: cardData(row.card_data)[change.field] }
  return { row, value: row[specs[change.entity_type].fields[change.field][0]] }
}
function writeField(change, value) {
  const type = change.entity_type, field = change.field
  if (field.startsWith('date:')) return db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(change.tenant_id, type, change.entity_id, field.slice(5), value || null, '', change.reviewed_by, now())
  if (type === 'card') {
    const row = ownerRow('card', change.entity_id), card = { ...cardData(row.card_data), [field]: value }
    db.prepare('UPDATE plate_assets SET card_data=?,updated_at=? WHERE id=?').run(JSON.stringify(card), now(), row.id)
    if (cardColumns[field]) db.prepare(`UPDATE plate_assets SET ${cardColumns[field]}=? WHERE id=?`).run(value || null, row.id)
    return
  }
  const { table, fields } = specs[type], column = fields[field][0]
  const stored = column === 'manufactured_year' ? (value === '' ? null : Number(value)) : column === 'name_en' ? value : value === '' && !['name', 'plate'].includes(column) ? null : value
  db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(stored, change.entity_id)
  if (!noUpdatedAt.has(table)) db.prepare(`UPDATE ${table} SET updated_at=? WHERE id=?`).run(now(), change.entity_id)
}
// 改回前檢查：改回後的資料仍要合乎原本的規則
function revertProblem(change, row) {
  const value = text(change.before_value)
  if (change.field === 'cardNumber') {
    if (!value) return '批文卡編號不能留空'
    if (db.prepare('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?').get(row.customer_id, row.route, value, row.id)) return '名下已有另一張相同編號的批文卡'
  }
  if (change.entity_type === 'plate' && ['installationStatus', 'vehicleId'].includes(change.field)) {
    const installation = change.field === 'installationStatus' ? value : row.installation_status, vehicleId = change.field === 'vehicleId' ? value : row.vehicle_id
    if (installation === '未上牌' && vehicleId) return '改回後「未上牌」卻綁定了車輛，請在牌照頁一併修改'
    if (installation === '已上牌' && !vehicleId && row.usage_status !== '出租中') return '改回後「已上牌」卻沒有綁定車輛，請在牌照頁一併修改'
    if (vehicleId && !db.prepare('SELECT id FROM vehicles WHERE id=? AND customer_id=?').get(vehicleId, row.customer_id)) return '原綁定的車輛已不存在'
  }
  if (change.entity_type === 'driver' && change.field === 'name' && db.prepare('SELECT id FROM drivers WHERE tenant_id=? AND customer_id=? AND name=? AND id<>?').get(row.tenant_id, row.customer_id, value, row.id)) return '這位客戶已有同名司機'
  if (['name', 'plate'].includes(change.field) && change.entity_type !== 'card' && !value) return '原值為空白，不能改回'
  return null
}

const changeView = row => ({ id: row.id, customerId: row.customer_id, customerName: row.customer_name, entityType: row.entity_type, entityName: entityName[row.entity_type], entityId: row.entity_id, entityLabel: row.entity_label, field: row.field, fieldLabel: row.field_label, beforeText: row.before_text, afterText: row.after_text, isDate: !!row.is_date, created: row.field === 'created', changedByName: row.changed_by_name, changedAt: row.changed_at, status: row.status, reviewedByName: row.reviewed_by_name, reviewedAt: row.reviewed_at, plateId: ['card', 'plate'].includes(row.entity_type) ? row.entity_id : row.entity_type === 'vehicle' ? db.prepare('SELECT id FROM plate_assets WHERE vehicle_id=? LIMIT 1').get(row.entity_id)?.id || null : row.entity_type === 'driver' ? db.prepare("SELECT plate_asset_id id FROM plate_drivers WHERE driver_id=? ORDER BY CASE role WHEN '主' THEN 0 ELSE 1 END LIMIT 1").get(row.entity_id)?.id || null : null })
const markCardChecked = (change, user) => { if (change.entity_type === 'card' && !db.prepare("SELECT id FROM customer_changes WHERE entity_type='card' AND entity_id=? AND status='待核對'").get(change.entity_id)) db.prepare("UPDATE plate_assets SET card_status='已核對',card_updated_by=?,card_updated_at=? WHERE id=?").run(user.name, now(), change.entity_id) }

// 後台：客戶更新待核對清單、核對無誤、改回
export async function changeReviewRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const itemMatch = path.match(/^\/api\/customer-changes\/([^/]+)\/(accept|revert)$/)
  if (path !== '/api/customer-changes' && path !== '/api/customer-changes/accept-batch' && !itemMatch) return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  const tenant = user.tenant_id
  if (path === '/api/customer-changes') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const status = url.searchParams.get('status') || '待核對', customerId = url.searchParams.get('customerId')
    if (!['待核對', '已核對', '已改回'].includes(status)) return fail(res, 400, '狀態無效'), true
    const rows = db.prepare(`SELECT cc.*, c.name customer_name FROM customer_changes cc JOIN customers c ON c.id=cc.customer_id WHERE cc.tenant_id=? AND cc.status=? ${customerId ? 'AND cc.customer_id=?' : ''} ORDER BY ${status === '待核對' ? 'cc.is_date DESC, cc.changed_at DESC' : 'cc.reviewed_at DESC'} LIMIT 500`).all(...(customerId ? [tenant, status, customerId] : [tenant, status]))
    // 同一牌照已有客戶自辦待核對時，批文卡的欄位修改已包在那一件（核對自辦時一併核對），這裏標出來不重複列
    let covered = new Set()
    try { covered = new Set(db.prepare("SELECT plate_asset_id FROM self_handled WHERE tenant_id=? AND status='待核對'").all(tenant).map(row => row.plate_asset_id)) } catch { covered = new Set() }
    return json(res, 200, rows.map(row => ({ ...changeView(row), inSelfHandled: row.entity_type === 'card' && covered.has(row.entity_id) }))), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (user.role !== 'admin') return fail(res, 403, '只有管理者可以核對客戶修改'), true
  const pendingRow = changeId => typeof changeId === 'string' ? db.prepare('SELECT * FROM customer_changes WHERE id=? AND tenant_id=?').get(changeId, tenant) : null
  const accept = change => { db.prepare("UPDATE customer_changes SET status='已核對',reviewed_by=?,reviewed_by_name=?,reviewed_at=? WHERE id=?").run(user.id, user.name, now(), change.id); markCardChecked(change, user) }
  if (path === '/api/customer-changes/accept-batch') {
    const body = await parseBody(req)
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some(item => typeof item !== 'string') || new Set(body.ids).size !== body.ids.length) return fail(res, 400, '請選擇要核對的修改'), true
    const rows = body.ids.map(pendingRow)
    if (rows.some(row => !row)) return fail(res, 404, '修改記錄不存在'), true
    if (rows.some(row => row.status !== '待核對')) return fail(res, 409, '部分修改已處理，請重新整理'), true
    db.exec('BEGIN IMMEDIATE')
    try { rows.forEach(accept); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    notifyAccepted(tenant, rows)
    return json(res, 200, { accepted: rows.length }), true
  }
  const change = pendingRow(itemMatch[1])
  if (!change) return fail(res, 404, '修改記錄不存在'), true
  if (change.status !== '待核對') return fail(res, 409, '這項修改已處理'), true
  if (itemMatch[2] === 'accept') {
    db.exec('BEGIN IMMEDIATE')
    try { accept(change); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    notifyAccepted(tenant, [change])
    return json(res, 200, changeView({ ...pendingRow(change.id), customer_name: '' })), true
  }
  if (change.field === 'created') return fail(res, 400, change.entity_type === 'card' ? '新建的批文卡不能改回，請到牌照頁處理' : '新建的公司不能改回，請到客戶的公司頁處理'), true
  const current = readField(change)
  if (current.missing) return fail(res, 404, `${entityName[change.entity_type]}已不存在`), true
  if (text(current.value) !== text(change.after_value)) return fail(res, 409, '這個欄位之後又改過，不能直接改回；請到資料頁修改'), true
  const problem = revertProblem(change, current.row)
  if (problem) return fail(res, 409, problem), true
  db.exec('BEGIN IMMEDIATE')
  try {
    writeField({ ...change, reviewed_by: user.id }, text(change.before_value))
    db.prepare("UPDATE customer_changes SET status='已改回',reviewed_by=?,reviewed_by_name=?,reviewed_at=? WHERE id=?").run(user.id, user.name, now(), change.id)
    markCardChecked(change, user)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  notify({ tenantId: tenant, customerId: change.customer_id, kind: 'change_reverted', title: `顧問已把「${change.field_label}」改回原來的資料`, body: `${change.entity_label}：${change.after_text || '（空白）'} → ${change.before_text || '（空白）'}。如有疑問請聯絡你的顧問。`, link: changeLink(change), dedupeKey: `change_reverted:${change.id}` })
  return json(res, 200, changeView({ ...pendingRow(change.id), customer_name: '' })), true
}

// 客戶端：修改公司、車輛、司機和到期日；列出待核對的欄位
export async function clientEditRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const companyMatch = path.match(/^\/api\/my\/companies\/([^/]+)$/)
  const vehicleMatch = path.match(/^\/api\/my\/vehicles\/([^/]+)$/)
  const driverMatch = path.match(/^\/api\/my\/drivers\/([^/]+)$/)
  const known = path === '/api/my/pending' || path === '/api/my/drivers' || path === '/api/my/dates' || path === '/api/my/profile' || path === '/api/my/profile/name' || path === '/api/my/customer' || companyMatch || vehicleMatch || driverMatch
  if (!known) return false
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  const tenant = user.tenant_id, customerId = user.customer_id
  if (!db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenant)) return fail(res, 404, '客戶不存在'), true

  if (path === '/api/my/pending') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, db.prepare("SELECT entity_type entityType, entity_id entityId, field FROM customer_changes WHERE tenant_id=? AND customer_id=? AND status='待核對'").all(tenant, customerId)), true
  }
  // 我的資料（2026-10-18）：登入帳號＋委託人資料＋同一委託人的其他登入（只列名字）
  if (path === '/api/my/profile') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const me = db.prepare('SELECT name,email,phone,wechat_openid FROM users WHERE id=?').get(user.id)
    const customer = db.prepare('SELECT name,kind,phone FROM customers WHERE id=?').get(customerId)
    const others = db.prepare('SELECT name FROM users WHERE customer_id=? AND tenant_id=? AND id<>? AND active=1 ORDER BY name').all(customerId, tenant, user.id)
    // 系統建立帳號時，沒有電郵的會用內部佔位地址，不顯示給客戶
    const email = me.email && !/@(phone|wechat)\.invalid$/i.test(me.email) ? me.email : ''
    return json(res, 200, { me: { name: me.name, email, phone: me.phone || '', wechatBound: !!me.wechat_openid }, customer: { name: customer.name, kind: customer.kind, phone: customer.phone || '' }, otherLogins: others.map(row => row.name), serviceMode: selfManagedCustomer(customerId) ? '自管' : '托管' }), true
  }
  if (path === '/api/my/drivers') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, db.prepare('SELECT * FROM drivers WHERE tenant_id=? AND customer_id=? ORDER BY name').all(tenant, customerId).map(driverView)), true
  }

  // 只接受列出的欄位，每個值都要是字串；有其他欄位一律拒絕，避免客戶改到顧問維護的資料
  const readBody = async allowed => {
    const body = await parseBody(req)
    const keys = Object.keys(body)
    if (!keys.length) return { error: '沒有要修改的內容' }
    if (keys.some(key => !allowed.includes(key))) return { error: '包含不可修改的欄位' }
    if (keys.some(key => typeof body[key] !== 'string')) return { error: '欄位格式無效' }
    return { body }
  }
  const save = (type, row, next, extra = {}) => {
    const { table, fields } = specs[type], changes = []
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const [field, value] of Object.entries(next)) {
        const [column, label, isDate] = fields[field]
        changes.push({ field, label: extra.labels?.[field] || label, before: row[column], after: value, isDate })
        db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(value === '' && !['name', 'plate', 'name_en'].includes(column) ? null : column === 'manufactured_year' ? Number(value) : value, row.id)
      }
      if (!noUpdatedAt.has(table)) db.prepare(`UPDATE ${table} SET updated_at=? WHERE id=?`).run(now(), row.id)
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id)
      logChanges({ tenantId: tenant, customerId, user, entityType: type, entityId: row.id, entityLabel: labelOf(type, updated), changes })
      db.exec('COMMIT')
      return updated
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }

  if (path === '/api/my/profile/name') {
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const { body, error } = await readBody(['name'])
    if (error) return fail(res, 400, error), true
    const name = clean(body.name, 60)
    if (!name) return fail(res, 400, '顯示名稱不可為空'), true
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name, user.id)
    return json(res, 200, { name }), true
  }
  if (path === '/api/my/customer') {
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenant)
    const { body, error } = await readBody(['name', 'kind', 'phone'])
    if (error) return fail(res, 400, error), true
    const next = {}
    if (body.name !== undefined) { next.name = clean(body.name, 120); if (!next.name) return fail(res, 400, '委託人名稱不可為空'), true }
    if (body.kind !== undefined) { if (!['個人', '公司'].includes(body.kind)) return fail(res, 400, '類型只可以是個人或公司'), true; next.kind = body.kind }
    if (body.phone !== undefined) { if (body.phone.trim() && !/^\+?[\d\s-]{8,20}$/.test(body.phone.trim())) return fail(res, 400, '聯絡電話格式無效'), true; next.phone = clean(body.phone, 30) }
    const updated = save('customer', customer, next)
    return json(res, 200, { name: updated.name, kind: updated.kind, phone: updated.phone || '' }), true
  }
  if (companyMatch) {
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const company = db.prepare('SELECT * FROM companies WHERE id=? AND tenant_id=? AND customer_id=?').get(companyMatch[1], tenant, customerId)
    if (!company) return fail(res, 404, '公司不存在'), true
    const { body, error } = await readBody(['name', 'nameEn', 'registrationNo', 'companyNumber', 'incorporatedOn', 'taxpayerType'])
    if (error) return fail(res, 400, error), true
    const hk = company.jurisdiction === '香港', mainland = company.jurisdiction === '內地', next = {}
    if (body.name !== undefined) {
      const name = mainland ? clean(mainlandName(body.name), 160) : clean(body.name, 160)
      if (!name) return fail(res, 400, '公司名稱不可為空'), true
      const traditional = mainland ? traditionalChars(name) : []
      if (traditional.length) return json(res, 400, { error: `內地公司名稱須用簡體字（${traditional.map(item => `${item.from}→${item.to}`).join('、')}），建議：${toSimplified(name)}`, suggestion: toSimplified(name) }), true
      next.name = name
    }
    if (body.nameEn !== undefined) {
      if (!hk) return fail(res, 400, '只有香港公司有英文名稱'), true
      const nameEn = body.nameEn.trim().replace(/\s+/g, ' ')
      if (!nameEn) return fail(res, 400, '香港公司必須填寫英文名稱'), true
      if (nameEn.length > 160 || !/^[A-Za-z0-9 ., &()'\-/]+$/.test(nameEn)) return fail(res, 400, '英文名稱只可用英文字母、數字和常見符號'), true
      next.nameEn = nameEn
    }
    if (body.registrationNo !== undefined) next.registrationNo = clean(body.registrationNo, 100)
    if (body.companyNumber !== undefined) { if (!hk) return fail(res, 400, '只有香港公司有公司編號'), true; next.companyNumber = clean(body.companyNumber, 100) }
    if (body.incorporatedOn !== undefined) { if (body.incorporatedOn && !validDate(body.incorporatedOn)) return fail(res, 400, '成立日期無效'), true; next.incorporatedOn = body.incorporatedOn }
    if (body.taxpayerType !== undefined) {
      if (!mainland) return fail(res, 400, '只有內地公司有納稅人類型'), true
      if (body.taxpayerType && !['小規模納稅人', '一般納稅人'].includes(body.taxpayerType)) return fail(res, 400, '納稅人類型無效'), true
      next.taxpayerType = body.taxpayerType
    }
    const updated = save('company', company, next, { labels: { registrationNo: registrationLabel(company.jurisdiction) } })
    return json(res, 200, companyView(updated)), true
  }
  if (vehicleMatch) {
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id=? AND customer_id=?').get(vehicleMatch[1], customerId)
    if (!vehicle) return fail(res, 404, '車輛不存在'), true
    const { body, error } = await readBody(['plate', 'brand', 'model', 'vin', 'manufacturedYear', 'firstRegisteredOn'])
    if (error) return fail(res, 400, error), true
    const next = {}
    if (body.plate !== undefined) { next.plate = clean(body.plate, 50).toUpperCase(); if (!next.plate) return fail(res, 400, '車牌不可為空'), true }
    for (const [key, max] of [['brand', 60], ['model', 60], ['vin', 100]]) if (body[key] !== undefined) next[key] = clean(body[key], max)
    if (body.manufacturedYear !== undefined) {
      const year = body.manufacturedYear.trim()
      if (year && (!/^\d{4}$/.test(year) || Number(year) < 1886 || Number(year) > new Date().getFullYear() + 1)) return fail(res, 400, '製造年份無效'), true
      next.manufacturedYear = year
    }
    if (body.firstRegisteredOn !== undefined) { if (body.firstRegisteredOn && !validDate(body.firstRegisteredOn)) return fail(res, 400, '首次登記日期無效'), true; next.firstRegisteredOn = body.firstRegisteredOn }
    return json(res, 200, save('vehicle', vehicle, next)), true
  }
  if (driverMatch) {
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const driver = db.prepare('SELECT * FROM drivers WHERE id=? AND tenant_id=? AND customer_id=?').get(driverMatch[1], tenant, customerId)
    if (!driver) return fail(res, 404, '司機不存在'), true
    const { body, error } = await readBody(['name', 'phone', 'hkIdNo', 'homeReturnPermitNo'])
    if (error) return fail(res, 400, error), true
    const next = {}
    if (body.name !== undefined) {
      next.name = clean(body.name, 60)
      if (!next.name) return fail(res, 400, '司機姓名不可為空'), true
      if (db.prepare('SELECT id FROM drivers WHERE tenant_id=? AND customer_id=? AND name=? AND id<>?').get(tenant, customerId, next.name, driver.id)) return fail(res, 409, '已有同名司機'), true
    }
    if (body.phone !== undefined) { if (body.phone.trim() && !/^\+?[\d\s-]{8,20}$/.test(body.phone.trim())) return fail(res, 400, '電話號碼格式無效'), true; next.phone = clean(body.phone, 30) }
    // 已遮蔽的身份證號碼原樣送回時不覆寫
    if (body.hkIdNo !== undefined && !/^\*+/.test(body.hkIdNo)) {
      if (body.hkIdNo.trim() && !/^[A-Z]{1,2}\d{6}\(?[\dA]\)?$/i.test(body.hkIdNo.replace(/\s/g, ''))) return fail(res, 400, '香港身份證號碼格式無效'), true
      next.hkIdNo = maskHkId(body.hkIdNo) || ''
    }
    if (body.homeReturnPermitNo !== undefined) next.homeReturnPermitNo = clean(body.homeReturnPermitNo, 30)
    return json(res, 200, driverView(save('driver', driver, next))), true
  }
  // 到期日：只限客戶看得到、按日期記錄的事項；批文卡有效期在批文卡修改
  if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  if (!['plate', 'company', 'vehicle', 'driver'].includes(body.ownerType) || typeof body.ownerId !== 'string' || typeof body.code !== 'string') return fail(res, 400, '到期事項無效'), true
  if (typeof body.expiresOn !== 'string' || !validDate(body.expiresOn)) return fail(res, 400, '到期日期無效'), true
  const owner = ownerRow(body.ownerType, body.ownerId)
  const mine = owner && (body.ownerType === 'company' || body.ownerType === 'driver' ? owner.tenant_id === tenant && owner.customer_id === customerId : owner.customer_id === customerId)
  if (!mine) return fail(res, 404, '對象不存在'), true
  const rule = db.prepare("SELECT * FROM rules WHERE tenant_id=? AND code=? AND scope=? AND method='expiry' AND active=1 AND customer_visible=1").get(tenant, body.code, body.ownerType)
  const decoded = rule && { ...rule, match: JSON.parse(rule.match_json || '{}'), params: JSON.parse(rule.params_json || '{}') }
  if (!decoded || decoded.params.field) return fail(res, 400, decoded?.params.field === 'cardExpiresOn' ? '此日期來自批文卡，請在批文卡修改' : '到期規則不適用'), true
  if (!ruleMatches(decoded, ownerFacts(body.ownerType, owner))) return fail(res, 400, '到期規則不適用'), true
  const before = db.prepare('SELECT expires_on FROM tracked_items WHERE tenant_id=? AND owner_type=? AND owner_id=? AND code=?').get(tenant, body.ownerType, owner.id, body.code)?.expires_on || ''
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(tenant, body.ownerType, owner.id, body.code, body.expiresOn, '', user.id, now())
    logChanges({ tenantId: tenant, customerId, user, entityType: body.ownerType, entityId: owner.id, entityLabel: labelOf(body.ownerType, owner), changes: [{ field: `date:${body.code}`, label: rule.name, before, after: body.expiresOn, isDate: true }] })
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, { ownerType: body.ownerType, ownerId: owner.id, code: body.code, expiresOn: body.expiresOn }), true
}

function ownerFacts(type, row) {
  if (type === 'plate') return plateFacts(row)
  if (type === 'vehicle') return vehicleFacts(row)
  if (type === 'company') return { jurisdiction: row.jurisdiction, status: row.status || '存續', companyStatus: row.status || '存續', incorporatedOn: row.incorporated_on }
  return {}
}
const companyView = row => ({ id: row.id, name: row.name, nameEn: row.name_en || '', jurisdiction: row.jurisdiction, registrationNo: row.registration_no || '', companyNumber: row.company_number || '', incorporatedOn: row.incorporated_on || '', taxpayerType: row.taxpayer_type || '', status: row.status || '存續' })
const driverView = row => ({ id: row.id, name: row.name, phone: row.phone || '', hkIdNo: row.hk_id_no || '', homeReturnPermitNo: row.home_return_permit_no || '' })
