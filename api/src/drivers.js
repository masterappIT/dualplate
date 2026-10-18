import { db, id, now } from './db.js'

// 司機管理（docs/tasks/drivers-brief.md）。司機是客戶名下的聯絡人，證件到期用現有到期規則（scope='driver'）提醒。
// 兩地牌一主兩副：每個牌照最多 1 位主司機、2 位副司機（批文卡「駕駛人 1–3」）。
db.exec(`CREATE TABLE IF NOT EXISTS drivers(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, hk_id_no TEXT, home_return_permit_no TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_drivers_customer ON drivers(customer_id);
CREATE TABLE IF NOT EXISTS plate_drivers(plate_asset_id TEXT NOT NULL, driver_id TEXT NOT NULL, role TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, registered_on TEXT, PRIMARY KEY(plate_asset_id, driver_id));
CREATE INDEX IF NOT EXISTS idx_plate_drivers_driver ON plate_drivers(driver_id);`)
// 客戶自行換司機後，不再開這個牌照（也沒有其他牌照）的司機：保留記錄，停止證件提醒
if (!db.prepare('PRAGMA table_info(drivers)').all().some(column => column.name === 'retired_on')) db.exec('ALTER TABLE drivers ADD COLUMN retired_on TEXT')

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max)
const optional = value => value === undefined || value === null || typeof value === 'string'
// 香港身份證只保存最後 4 個字元，其餘遮蔽，例如 A123456(7) → ******6(7)
export const maskHkId = value => { const text = clean(value, 20).replace(/\s/g, ''); return text ? '*'.repeat(Math.max(0, text.length - 4)) + text.slice(-4) : null }
const today = () => new Date().toISOString().slice(0, 10)
const cardNames = plate => { try { const card = JSON.parse(plate.card_data || '{}'); return ['driver1', 'driver2', 'driver3'].map(key => clean(card[key], 60)) } catch { return ['', '', ''] } }

// 按批文卡駕駛人 1–3 建立司機（同客戶同名視為同一人）並登記；driver1 為主司機。回傳是否有改動。
function registerFromCard(plate, tenantId) {
  const names = cardNames(plate)
  if (!names.some(Boolean)) return false
  const rows = []
  names.forEach((name, index) => {
    if (!name || rows.some(row => row.name === name)) return
    let driver = db.prepare('SELECT id FROM drivers WHERE tenant_id=? AND customer_id=? AND name=?').get(tenantId, plate.customer_id, name)
    if (!driver) { driver = { id: id() }; db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(driver.id, tenantId, plate.customer_id, name, now(), now()) }
    rows.push({ name, driverId: driver.id, role: index === 0 ? '主' : '副' })
  })
  // 第一欄空白時沒有主司機，其餘最多兩位副司機
  writeRegistration(plate.id, rows.filter(row => row.role === '主').concat(rows.filter(row => row.role === '副').slice(0, 2)))
  return true
}
// 客戶自己建檔、或修改批文卡駕駛人時，按批文卡登記司機（docs/tasks/self-managed-fixes-plan.md 第 3 步；與員工按「按批文卡登記」同一做法）。
// beforeCard：修改前的批文卡；駕駛人沒有改動就不重新登記，以免蓋掉客戶自己調整過的登記。回傳是否有改動
export function registerClientCard(plate, tenantId, beforeCard = null) {
  if (beforeCard && ['driver1', 'driver2', 'driver3'].map(key => clean(beforeCard[key], 60)).join('|') === cardNames(plate).join('|')) return false
  return registerFromCard(plate, tenantId)
}
function writeRegistration(plateId, rows) {
  db.prepare('DELETE FROM plate_drivers WHERE plate_asset_id=?').run(plateId)
  rows.forEach((row, index) => db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role,sort,registered_on) VALUES (?,?,?,?,?)').run(plateId, row.driverId, row.role, index, row.registeredOn || today()))
}

const driversMigration = '2026-10-16-drivers-from-card'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(driversMigration)) {
  db.exec('BEGIN')
  try {
    for (const plate of db.prepare('SELECT p.*, c.tenant_id FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE c.tenant_id IS NOT NULL').all()) {
      if (!db.prepare('SELECT 1 FROM plate_drivers WHERE plate_asset_id=? LIMIT 1').get(plate.id)) registerFromCard(plate, plate.tenant_id)
    }
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(driversMigration, now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

// 到期計算用的司機對象：委託範圍跟隨主司機（沒有主司機時第一位）所在的牌照
export function driverOwners(tenantId, customerId = null) {
  const drivers = db.prepare(`SELECT d.*, c.name customer_name FROM drivers d JOIN customers c ON c.id=d.customer_id WHERE d.tenant_id=? ${customerId ? 'AND d.customer_id=?' : ''} ORDER BY d.name`).all(...(customerId ? [tenantId, customerId] : [tenantId]))
  return drivers.map(driver => {
    const plate = mainPlate(driver.id)
    return { ownerType: 'driver', ownerId: driver.id, label: `司機 ${driver.name}`, customerId: driver.customer_id, customerName: driver.customer_name, facts: { retired: driver.retired_on ? 1 : 0 }, scopeOwner: plate ? { type: 'plate', id: plate } : null, plateId: plate }
  })
}
export const mainPlate = driverId => db.prepare("SELECT plate_asset_id FROM plate_drivers WHERE driver_id=? ORDER BY CASE role WHEN '主' THEN 0 ELSE 1 END, sort LIMIT 1").get(driverId)?.plate_asset_id || null
export const driverFor = (tenantId, driverId) => typeof driverId === 'string' ? db.prepare('SELECT * FROM drivers WHERE id=? AND tenant_id=?').get(driverId, tenantId) || null : null

function driverView(driver) {
  const plates = db.prepare('SELECT pd.role, pd.sort, pd.registered_on, p.id, p.mainland_plate, p.local_plate, p.route FROM plate_drivers pd JOIN plate_assets p ON p.id=pd.plate_asset_id WHERE pd.driver_id=? ORDER BY p.mainland_plate').all(driver.id)
  const documents = db.prepare("SELECT r.code, r.name, t.expires_on FROM rules r LEFT JOIN tracked_items t ON t.tenant_id=r.tenant_id AND t.owner_type='driver' AND t.owner_id=? AND t.code=r.code WHERE r.tenant_id=? AND r.scope='driver' AND r.active=1 ORDER BY r.sort").all(driver.id, driver.tenant_id)
  return { id: driver.id, customerId: driver.customer_id, name: driver.name, phone: driver.phone || '', hkIdNo: driver.hk_id_no || '', homeReturnPermitNo: driver.home_return_permit_no || '', notes: driver.notes || '',
    plates: plates.map(item => ({ plateId: item.id, role: item.role, registeredOn: item.registered_on, mainlandPlate: item.mainland_plate, localPlate: item.local_plate, route: item.route })),
    documents: documents.map(item => ({ code: item.code, name: item.name, expiresOn: item.expires_on || null })), updatedAt: driver.updated_at }
}
function plateView(plate) {
  const drivers = db.prepare('SELECT d.id, d.name, d.phone, pd.role, pd.registered_on FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY CASE pd.role WHEN \'主\' THEN 0 ELSE 1 END, pd.sort').all(plate.id)
  const card = cardNames(plate)
  const registered = [drivers.find(item => item.role === '主')?.name || '', ...drivers.filter(item => item.role === '副').map(item => item.name)]
  while (registered.length < 3) registered.push('')
  // 只在批文卡有填駕駛人時比較；次序不同不算不一致（副司機次序沒有業務意義）
  const mismatch = card.some(Boolean) && (card[0] !== registered[0] || [...card.slice(1)].filter(Boolean).sort().join('|') !== [...registered.slice(1)].filter(Boolean).sort().join('|'))
  return { plateId: plate.id, drivers: drivers.map(item => ({ driverId: item.id, name: item.name, phone: item.phone || '', role: item.role, registeredOn: item.registered_on })), cardDrivers: card, mismatch }
}

// 驗證一組司機資料；回傳錯誤訊息或 null
function checkDriverBody(body, creating) {
  if (!isObject(body)) return '內容無效'
  if (creating && (typeof body.customerId !== 'string' || !body.customerId)) return '請選擇客戶'
  if ((creating || body.name !== undefined) && (typeof body.name !== 'string' || !body.name.trim())) return '司機姓名不可為空'
  for (const key of ['phone', 'hkIdNo', 'homeReturnPermitNo', 'notes']) if (!optional(body[key])) return '司機資料格式無效'
  if (body.phone && !/^\+?[\d\s-]{8,20}$/.test(body.phone.trim())) return '電話號碼格式無效'
  if (body.hkIdNo && !/^[A-Z]{1,2}\d{6}\(?[\dA]\)?$/i.test(body.hkIdNo.replace(/\s/g, '')) && !/^\*+/.test(body.hkIdNo)) return '香港身份證號碼格式無效'
  if (body.customerId !== undefined && !creating) return '司機不可轉到其他客戶'
  return null
}

export async function driverRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const listMatch = path === '/api/drivers'
  const driverMatch = path.match(/^\/api\/drivers\/([^/]+)$/)
  const plateMatch = path.match(/^\/api\/plates\/([^/]+)\/drivers(\/sync-from-card)?$/)
  if (!listMatch && !driverMatch && !plateMatch) return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  const tenant = user.tenant_id
  const customerOf = customerId => typeof customerId === 'string' ? db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenant) : null

  if (listMatch && method === 'GET') {
    const customerId = url.searchParams.get('customerId')
    if (customerId && !customerOf(customerId)) return fail(res, 404, '客戶不存在'), true
    const rows = db.prepare(`SELECT * FROM drivers WHERE tenant_id=? ${customerId ? 'AND customer_id=?' : ''} ORDER BY name`).all(...(customerId ? [tenant, customerId] : [tenant]))
    return json(res, 200, rows.map(driverView)), true
  }
  if (listMatch && method === 'POST') {
    const body = await parseBody(req), problem = checkDriverBody(body, true)
    if (problem) return fail(res, 400, problem), true
    if (!customerOf(body.customerId)) return fail(res, 404, '客戶不存在'), true
    if (db.prepare('SELECT id FROM drivers WHERE tenant_id=? AND customer_id=? AND name=?').get(tenant, body.customerId, clean(body.name, 60))) return fail(res, 409, '這位客戶已有同名司機'), true
    const driverId = id()
    db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,phone,hk_id_no,home_return_permit_no,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(driverId, tenant, body.customerId, clean(body.name, 60), clean(body.phone, 30) || null, maskHkId(body.hkIdNo), clean(body.homeReturnPermitNo, 30) || null, clean(body.notes, 1000) || null, now(), now())
    return json(res, 201, driverView(driverFor(tenant, driverId))), true
  }
  if (driverMatch) {
    const driver = driverFor(tenant, driverMatch[1])
    if (!driver) return fail(res, 404, '司機不存在'), true
    if (method === 'GET') return json(res, 200, driverView(driver)), true
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req), problem = checkDriverBody(body, false)
    if (problem) return fail(res, 400, problem), true
    const name = body.name === undefined ? driver.name : clean(body.name, 60)
    if (name !== driver.name && db.prepare('SELECT id FROM drivers WHERE tenant_id=? AND customer_id=? AND name=? AND id<>?').get(tenant, driver.customer_id, name, driver.id)) return fail(res, 409, '這位客戶已有同名司機'), true
    // 已遮蔽的身份證號碼原樣送回時不覆寫
    const hkId = body.hkIdNo === undefined || /^\*+/.test(body.hkIdNo || '') ? driver.hk_id_no : maskHkId(body.hkIdNo)
    db.prepare('UPDATE drivers SET name=?,phone=?,hk_id_no=?,home_return_permit_no=?,notes=?,updated_at=? WHERE id=?')
      .run(name, body.phone === undefined ? driver.phone : clean(body.phone, 30) || null, hkId, body.homeReturnPermitNo === undefined ? driver.home_return_permit_no : clean(body.homeReturnPermitNo, 30) || null, body.notes === undefined ? driver.notes : clean(body.notes, 1000) || null, now(), driver.id)
    return json(res, 200, driverView(driverFor(tenant, driver.id))), true
  }
  // 牌照的司機登記
  const plate = db.prepare('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.tenant_id=?').get(plateMatch[1], tenant)
  if (!plate) return fail(res, 404, '牌照不存在'), true
  if (plateMatch[2]) {
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    if (!cardNames(plate).some(Boolean)) return fail(res, 400, '批文卡沒有駕駛人資料'), true
    db.exec('BEGIN'); try { registerFromCard(plate, tenant); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, plateView(plate)), true
  }
  if (method === 'GET') return json(res, 200, plateView(plate)), true
  if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  if (!isObject(body) || !Array.isArray(body.drivers) || !body.drivers.every(item => isObject(item) && typeof item.driverId === 'string' && ['主', '副'].includes(item.role))) return fail(res, 400, '司機登記格式無效'), true
  if (body.drivers.filter(item => item.role === '主').length > 1) return fail(res, 400, '每個牌照只可登記 1 位主司機'), true
  if (body.drivers.filter(item => item.role === '副').length > 2) return fail(res, 400, '每個牌照最多登記 2 位副司機'), true
  if (new Set(body.drivers.map(item => item.driverId)).size !== body.drivers.length) return fail(res, 400, '同一司機不可在同一牌照重複登記'), true
  for (const item of body.drivers) {
    const driver = driverFor(tenant, item.driverId)
    if (!driver) return fail(res, 404, '司機不存在'), true
    if (driver.customer_id !== plate.customer_id) return fail(res, 400, '只可登記同一客戶名下的司機'), true
  }
  const before = new Map(db.prepare('SELECT driver_id, registered_on FROM plate_drivers WHERE plate_asset_id=?').all(plate.id).map(row => [row.driver_id, row.registered_on]))
  const ordered = body.drivers.filter(item => item.role === '主').concat(body.drivers.filter(item => item.role === '副'))
  db.exec('BEGIN')
  try { writeRegistration(plate.id, ordered.map(item => ({ driverId: item.driverId, role: item.role, registeredOn: before.get(item.driverId) }))); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, plateView(plate)), true
}
