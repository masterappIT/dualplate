import { db } from './db.js'

// 自管客戶刪除建錯的牌照（docs/tasks/self-managed-fixes-plan.md 第 13 步，管理者 2026-10-18）：
// 批文卡輸入有錯或錯誤建檔時，客戶可以刪除這個牌照，即時刪除、不能復原（與注銷帳號一致）。
// 只限自管客戶；托管客戶的牌照是我們代管的業務記錄，目前狀態不動（管理者 2026-10-18）。
// 一併刪除：批文卡正本、口岸、到期日和已辦記錄、司機登記、客戶自己記的出租、自行辦理記錄。
// 公司：同一公司組沒有其他牌照時，列出供客戶選擇一併刪除（預設全選，輸入錯誤時這些公司通常也是錯的）。
// 司機：只移除這個牌照的登記；沒有其他牌照、也沒有填過證件日期的司機一併刪除。車輛保留，只解除連結。
// 有未完成的委託、或有由我們代收租金的出租時不能刪除；已完成的委託和收費記錄保留，只去掉牌照連結。
const inList = 'IN (SELECT value FROM json_each(?))'
const all = (sql, ...params) => db.prepare(sql).all(...params)
const run = (sql, ...params) => db.prepare(sql).run(...params)
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

const openRequests = plateId => all("SELECT id, title, status FROM requests WHERE plate_asset_id=? AND status NOT IN ('已完成','已取消') ORDER BY created_at", plateId)

// 能否刪除；回傳 { customer, plate } 或 { status, error, openRequests? }
function check(user, plateId) {
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(user.customer_id, user.tenant_id)
  const plate = customer && db.prepare('SELECT * FROM plate_assets WHERE id=? AND customer_id=?').get(plateId, customer.id)
  if (!plate) return { status: 404, error: '牌照不存在' }
  if (customer.is_self || customer.service_mode !== '自管') return { status: 403, error: '托管客戶的牌照不能自行刪除，請聯絡我們處理' }
  const open = openRequests(plate.id)
  if (open.length) return { status: 409, plate, error: `這個牌照有 ${open.length} 件委託仍在辦理，請先完成或取消才可以刪除；還未開始辦理的，可按進去自行取消`, openRequests: open.map(row => ({ id: row.id, title: row.title, status: row.status })) }
  // 由我們代收租金的出租是我們的業務記錄（托管時期留下的），要先由我們處理
  if (db.prepare("SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND collection_mode='代收' LIMIT 1").get(plate.id)) return { status: 409, plate, error: '這個牌照有由我們代收租金的出租，請先聯絡我們處理，才可以刪除', openRequests: [] }
  return { customer, plate }
}

// 可以一併刪除的公司：牌照所屬公司組沒有其他牌照時，組內這位客戶的公司
function companiesWith(plate) {
  if (!plate.group_id) return []
  if (db.prepare('SELECT 1 FROM plate_assets WHERE group_id=? AND id<>? LIMIT 1').get(plate.group_id, plate.id)) return []
  return all('SELECT id, name, jurisdiction FROM companies WHERE group_id=? AND customer_id=? ORDER BY jurisdiction, name', plate.group_id, plate.customer_id)
}

function preview(plate) {
  const count = (sql, ...params) => db.prepare(sql).get(...params).count
  return {
    label: [plate.mainland_plate, plate.local_plate].filter(Boolean).join(' · ') || `批文卡 ${plate.card_number || ''}`.trim(),
    cardNumber: plate.card_number || '',
    companies: companiesWith(plate),
    drivers: count('SELECT COUNT(*) count FROM plate_drivers WHERE plate_asset_id=?', plate.id),
    rentals: count('SELECT COUNT(*) count FROM rental_contracts WHERE plate_asset_id=?', plate.id),
    vehicleKept: Boolean(plate.vehicle_id)
  }
}

// 讀出要一併刪除的公司；只可以是 companiesWith 列出的公司。回傳 { companyIds } 或 { error }
function readDelete(body, plate) {
  if (!isObject(body) || Object.keys(body).some(key => key !== 'companyIds')) return { error: '內容無效' }
  if (body.companyIds === undefined) return { companyIds: [] }
  if (!Array.isArray(body.companyIds) || body.companyIds.some(value => typeof value !== 'string')) return { error: '公司選擇無效' }
  const allowed = new Set(companiesWith(plate).map(company => company.id)), companyIds = [...new Set(body.companyIds)]
  if (companyIds.some(value => !allowed.has(value))) return { error: '只可以一併刪除屬於這個牌照的公司' }
  return { companyIds }
}

// 刪除牌照及附屬資料，並刪除選定的公司。在呼叫者的交易內
function erase(tenantId, plate, companyIds) {
  const p = plate.id, drivers = all('SELECT driver_id id FROM plate_drivers WHERE plate_asset_id=?', p).map(row => row.id)

  // 出租合約和租金、自行辦理記錄、批文卡正本等附屬
  const contracts = JSON.stringify(all('SELECT id FROM rental_contracts WHERE plate_asset_id=?', p).map(row => row.id))
  run(`DELETE FROM rental_link_visits WHERE link_id IN (SELECT id FROM rental_links WHERE contract_id ${inList})`, contracts)
  for (const table of ['rental_links', 'rental_acknowledgements', 'renter_uploads']) run(`DELETE FROM ${table} WHERE contract_id ${inList}`, contracts)
  run(`DELETE FROM rent_invoice_proofs WHERE invoice_id IN (SELECT id FROM rent_invoices WHERE contract_id ${inList})`, contracts)
  run(`DELETE FROM rent_invoices WHERE contract_id ${inList}`, contracts)
  run(`DELETE FROM rental_contracts WHERE id ${inList}`, contracts)
  run('DELETE FROM self_handled_files WHERE record_id IN (SELECT id FROM self_handled WHERE plate_asset_id=?)', p)
  run('DELETE FROM self_handled WHERE plate_asset_id=?', p)
  for (const table of ['approval_card_images', 'plate_photos', 'plate_rentals', 'plate_crossings', 'plate_drivers', 'plate_transfers']) run(`DELETE FROM ${table} WHERE plate_asset_id=?`, p)
  // 已完成的委託和收費記錄保留，只去掉牌照連結
  run('UPDATE requests SET plate_asset_id=NULL WHERE plate_asset_id=?', p)
  run('UPDATE fee_items SET plate_asset_id=NULL WHERE plate_asset_id=?', p)

  // 司機：沒有其他牌照登記、也沒有填過證件日期的，一併刪除
  const unusedDrivers = JSON.stringify(drivers.filter(driverId => !db.prepare('SELECT 1 FROM plate_drivers WHERE driver_id=? LIMIT 1').get(driverId)
    && !db.prepare("SELECT 1 FROM tracked_items WHERE owner_type='driver' AND owner_id=? AND expires_on IS NOT NULL LIMIT 1").get(driverId)))
  run(`DELETE FROM drivers WHERE id ${inList}`, unusedDrivers)

  // 公司（客戶選定的）及其報帳記錄；公司組沒有公司也沒有牌照時一併刪除
  const companies = JSON.stringify(companyIds)
  run(`DELETE FROM filing_receipts WHERE filing_id IN (SELECT id FROM filing_periods WHERE company_id ${inList})`, companies)
  run(`DELETE FROM filing_periods WHERE company_id ${inList}`, companies)
  run(`DELETE FROM companies WHERE id ${inList}`, companies)
  run('DELETE FROM plate_assets WHERE id=?', p)
  if (plate.group_id && !db.prepare('SELECT 1 FROM companies WHERE group_id=? UNION ALL SELECT 1 FROM plate_assets WHERE group_id=? LIMIT 1').get(plate.group_id, plate.group_id)) run('DELETE FROM company_groups WHERE id=?', plate.group_id)

  // 到期事項、代理範圍、已辦記錄、改動記錄、指向這個牌照的通知
  const owners = JSON.stringify([p, ...companyIds, ...JSON.parse(unusedDrivers)])
  for (const table of ['tracked_items', 'service_scopes', 'rule_completions']) run(`DELETE FROM ${table} WHERE tenant_id=? AND owner_id ${inList}`, tenantId, owners)
  run(`DELETE FROM customer_changes WHERE customer_id=? AND entity_id ${inList}`, plate.customer_id, owners)
  run('DELETE FROM notifications WHERE customer_id=? AND link LIKE ?', plate.customer_id, `%id=${p}%`)
}

export async function plateDeleteRoutes(req, res, url, user, { json, fail, parseBody }) {
  const match = url.pathname.match(/^\/api\/my\/plates\/([^/]+)\/delete$/)
  if (!match) return false
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  // 先看會刪除甚麼、能否刪除；再確認刪除
  if (req.method === 'GET') {
    const result = check(user, match[1])
    if (result.status === 404 || result.status === 403) return fail(res, result.status, result.error), true
    return json(res, 200, { allowed: !result.error, error: result.error || null, openRequests: result.openRequests || [], ...preview(result.plate) }), true
  }
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  const result = check(user, match[1])
  if (result.error) return json(res, result.status, { error: result.error, openRequests: result.openRequests }), true
  const input = readDelete(body, result.plate)
  if (input.error) return fail(res, 400, input.error), true
  db.exec('BEGIN IMMEDIATE')
  try {
    erase(user.tenant_id, result.plate, input.companyIds)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, { deleted: true, companies: input.companyIds.length }), true
}
