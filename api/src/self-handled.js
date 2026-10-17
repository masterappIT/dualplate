import { db, id, now } from './db.js'
import { cardData, cardFields } from './card.js'
import { notify } from './client-portal.js'
import { scopeMap } from './entrustment.js'
import { plateFacts, vehicleFacts } from './plate-facts.js'
import { computeDeadlines, ruleMatches } from './rules.js'
import { plateLabel, selfManagedCustomer } from './client-edits.js'

// 客戶自行辦理後更新資料（docs/tasks/self-handled-changes-design.md，管理者 2026-10-17 決定）：
// 客戶自己辦了換車、續期、換司機，或決定不再續期，在客戶端一次過更新；資料立即生效，
// 管理者在今日工作按「整件」核對，不是零散欄位。年費內的自辦只記錄，不扣減。
db.exec(`CREATE TABLE IF NOT EXISTS self_handled(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, plate_asset_id TEXT NOT NULL, kind TEXT NOT NULL, handled_on TEXT NOT NULL, details_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待核對', created_by TEXT, created_by_name TEXT, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_by_name TEXT, reviewed_at TEXT, review_note TEXT);
CREATE INDEX IF NOT EXISTS idx_self_handled_status ON self_handled(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_self_handled_plate ON self_handled(plate_asset_id);
CREATE TABLE IF NOT EXISTS self_handled_files(id TEXT PRIMARY KEY, record_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_self_handled_files ON self_handled_files(record_id);`)

export const kinds = { vehicle_change: '自行換車', renewal: '自行續期', driver_change: '自行換司機', stop_renewal: '不再續期', inspection_done: '自行驗車', filing_done: '自行備案', tax_paid: '自行繳交行車稅', crossing_change: '自行口岸變更', company_change: '自行商號變更', replacement: '自行補領' }
// 客戶可自行標記辦好的到期事項（第七節第 4 項）：哪一類對應哪條規則、掛在甚麼對象上
export const markable = { inspection_done: { code: 'inspection', ownerType: 'vehicle' }, filing_done: { code: 'new_card_filing', ownerType: 'plate' }, tax_paid: { code: 'mo_vehicle_tax', ownerType: 'vehicle' } }
// 和這次自辦同類、仍未結案的工單：提示員工取消，以免重複辦理
const sameService = { vehicle_change: ['vehicle_change'], renewal: ['renewal'], driver_change: ['driver_change'], stop_renewal: null, inspection_done: ['inspection'], filing_done: ['filing'], tax_paid: null, crossing_change: ['crossing_change'], company_change: ['company_change'], replacement: ['replacement'] }
const stopReasons = ['已賣車／不再使用', '放棄指標', '其他']
const MAX_PHOTOS = 6, MAX_PHOTO_BYTES = 3500000

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const todayHk = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TZ || 'Asia/Hong_Kong' }).format(new Date())
const one = (sql, ...params) => db.prepare(sql).get(...params)
const all = (sql, ...params) => db.prepare(sql).all(...params)
const bad = (status, error) => ({ status, error })

function decodedRules(tenantId, scope) {
  return all("SELECT * FROM rules WHERE tenant_id=? AND scope=? AND method='expiry' AND active=1 AND customer_visible=1 ORDER BY sort", tenantId, scope)
    .map(rule => ({ ...rule, match: JSON.parse(rule.match_json || '{}'), params: JSON.parse(rule.params_json || '{}') }))
}
// 客戶可填的到期日：按日期記錄、客戶看得到、適用於這個對象（例如香港車輛牌照只限香港車）
function dateRules(tenantId, scope, facts) { return decodedRules(tenantId, scope).filter(rule => !rule.params.field && ruleMatches(rule, facts)) }
function checkDates(dates, rules) {
  if (dates === undefined) return { values: {} }
  if (!isObject(dates)) return bad(400, '到期日格式無效')
  const codes = new Set(rules.map(rule => rule.code)), values = {}
  for (const [code, value] of Object.entries(dates)) {
    if (!codes.has(code)) return bad(400, '包含不適用的到期事項')
    if (value === '' || value === null) continue
    if (!validDate(value)) return bad(400, '到期日期無效')
    values[code] = value
  }
  return { values }
}
function checkPhotos(photos) {
  if (photos === undefined) return { files: [] }
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) return bad(400, `相片最多 ${MAX_PHOTOS} 張`)
  const files = []
  for (const photo of photos) {
    const matched = typeof photo === 'string' && /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(photo)
    if (!matched) return bad(400, '相片只接受 JPG 或 PNG')
    const bytes = Buffer.from(matched[2], 'base64')
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return bad(400, '相片不可超過 3.5 MB')
    files.push({ mime: matched[1], bytes })
  }
  return { files }
}
const writeDate = (tenantId, ownerType, ownerId, code, value, userId) => db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(tenantId, ownerType, ownerId, code, value, '', userId, now())
const dateOf = (ownerType, ownerId, code) => one('SELECT expires_on FROM tracked_items WHERE owner_type=? AND owner_id=? AND code=?', ownerType, ownerId, code)?.expires_on || ''

// ── 各類自辦：先檢查（不寫入），通過後在同一個交易內寫入 ──

function prepareVehicleChange(ctx, body) {
  const { plate, tenantId } = ctx
  if (!isObject(body.vehicle)) return bad(400, '請填寫新車資料')
  const plateNo = clean(body.vehicle.plate, 50).toUpperCase().replace(/\s+/g, ' ')
  if (!plateNo) return bad(400, '請填寫新車車牌')
  for (const key of ['brand', 'model', 'vin', 'firstRegisteredOn']) if (body.vehicle[key] !== undefined && body.vehicle[key] !== null && typeof body.vehicle[key] !== 'string') return bad(400, '新車資料格式無效')
  if (body.vehicle.firstRegisteredOn && !validDate(body.vehicle.firstRegisteredOn)) return bad(400, '首次登記日期無效')
  const old = plate.vehicle_id ? one('SELECT * FROM vehicles WHERE id=?', plate.vehicle_id) : null
  const samePlate = value => clean(value, 50).toUpperCase().replace(/\s+/g, '') === plateNo.replace(/\s+/g, '')
  if (old && samePlate(old.plate)) return bad(400, '新車車牌與現在的車相同；如只是之前填錯，請直接修改車牌')
  // 客戶名下已有這輛車（例如由另一個牌照換過來）：沿用，不重複建檔
  const existing = all('SELECT * FROM vehicles WHERE customer_id=? AND route=?', plate.customer_id, plate.route).find(item => samePlate(item.plate)) || null
  const origin = existing?.origin || old?.origin || (plate.route === '粵澳' ? '澳門' : '香港')
  const rules = dateRules(tenantId, 'vehicle', vehicleFacts({ route: plate.route, origin, first_registered_on: body.vehicle.firstRegisteredOn || null }))
  const dates = checkDates(body.dates, rules)
  if (dates.error) return dates
  return {
    write(userId) {
      let vehicleId = existing?.id
      const fields = { brand: clean(body.vehicle.brand, 60), model: clean(body.vehicle.model, 60), vin: clean(body.vehicle.vin, 100), first_registered_on: body.vehicle.firstRegisteredOn || '' }
      if (existing) {
        // 只補空白欄位，不覆寫已有資料；重新啟用（之前換走過的車再換回來）
        for (const [column, value] of Object.entries(fields)) if (value && !existing[column]) db.prepare(`UPDATE vehicles SET ${column}=? WHERE id=?`).run(value, existing.id)
        db.prepare('UPDATE vehicles SET retired_on=NULL, replaced_by=NULL WHERE id=?').run(existing.id)
      } else {
        vehicleId = id()
        db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,brand,model,vin,manufactured_year,notes,first_registered_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(vehicleId, plate.customer_id, plate.route, origin, old?.type || '私家車', plateNo, fields.brand || null, fields.model || null, fields.vin || null, null, null, fields.first_registered_on || null)
      }
      db.prepare("UPDATE plate_assets SET vehicle_id=?, local_plate=?, installation_status='已上牌', updated_at=? WHERE id=?").run(vehicleId, plateNo, now(), plate.id)
      // 舊車同時掛在另一個牌照（例如粵港、粵澳兩塊牌同一輛車）時仍在使用，不停止提醒
      const oldStillUsed = old && one('SELECT id FROM plate_assets WHERE vehicle_id=? AND id<>?', old.id, plate.id)
      if (old && !oldStillUsed) db.prepare('UPDATE vehicles SET retired_on=?, replaced_by=? WHERE id=?').run(ctx.handledOn, vehicleId, old.id)
      for (const [code, value] of Object.entries(dates.values)) writeDate(tenantId, 'vehicle', vehicleId, code, value, userId)
      const card = cardData(plate.card_data)
      const missing = rules.filter(rule => !dates.values[rule.code] && !dateOf('vehicle', vehicleId, rule.code)).map(rule => rule.name)
      return {
        oldVehicle: old ? { id: old.id, plate: old.plate, retired: !oldStillUsed } : null,
        newVehicle: { id: vehicleId, plate: plateNo, brand: fields.brand, model: fields.model, reused: !!existing },
        dates: rules.filter(rule => dates.values[rule.code]).map(rule => ({ name: rule.name, expiresOn: dates.values[rule.code] })),
        missing,
        // 批文卡是官方文件，不代客戶改；卡上車牌和新車不符時請員工對照正本
        cardMismatch: card.localPlate && clean(card.localPlate, 50).toUpperCase().replace(/\s+/g, '') !== plateNo.replace(/\s+/g, '') ? card.localPlate : ''
      }
    }
  }
}

// 續期：批文、香港 CRP／澳門通行證、海關及邊檢備案逐份「已辦好／未辦」；未辦的照舊提醒
function prepareRenewal(ctx, body) {
  const { plate, tenantId } = ctx
  if (!isObject(body.documents)) return bad(400, '請說明哪些文件已續期')
  const facts = plateFacts(plate)
  const rules = decodedRules(tenantId, 'plate').filter(rule => ruleMatches(rule, facts) && (rule.code === 'approval' || !rule.params.field))
  const known = new Map(rules.map(rule => [rule.code, rule]))
  const done = [], notDone = []
  for (const [code, entry] of Object.entries(body.documents)) {
    if (!known.has(code)) return bad(400, '包含不適用的文件')
    if (!isObject(entry) || typeof entry.done !== 'boolean') return bad(400, '請逐份說明是否已辦好')
    if (!entry.done) { notDone.push(code); continue }
    if (!validDate(entry.expiresOn)) return bad(400, `請填寫${known.get(code).name}的新到期日`)
    if (entry.expiresOn <= ctx.handledOn) return bad(400, `${known.get(code).name}的新到期日應在辦好日期之後`)
    const current = code === 'approval' ? (cardBefore(plate).validTo || plate.card_expires_on || '') : dateOf('plate', plate.id, code)
    if (current && entry.expiresOn <= current) return bad(400, `${known.get(code).name}的新到期日應比現在的 ${current} 晚；如只是之前填錯，請直接修改日期`)
    done.push([code, entry.expiresOn])
  }
  if (!done.length) return bad(400, '請至少選一份已續期的文件；全部未辦好可先不更新')
  const filingDone = body.newCardFiling === true
  if (body.newCardFiling !== undefined && typeof body.newCardFiling !== 'boolean') return bad(400, '新批文備案格式無效')
  return {
    write(userId) {
      const card = cardData(plate.card_data), before = {}
      for (const [code, value] of done) {
        if (code === 'approval') {
          // 批文有效期來自批文卡：更新卡上的「有效期結束」
          before[code] = cardBefore(plate).validTo || plate.card_expires_on || ''
          db.prepare('UPDATE plate_assets SET card_data=?, card_expires_on=?, updated_at=? WHERE id=?').run(JSON.stringify({ ...card, validTo: value }), value, now(), plate.id)
        } else { before[code] = dateOf('plate', plate.id, code); writeDate(tenantId, 'plate', plate.id, code, value, userId) }
      }
      // 新批文開始日起 183 天內要備案：客戶說已辦就記為完成
      const fresh = cardData(one('SELECT card_data FROM plate_assets WHERE id=?', plate.id).card_data)
      if (filingDone && fresh.validFrom) db.prepare('INSERT OR IGNORE INTO rule_completions(tenant_id,code,owner_id,period,completed_by,completed_at) VALUES (?,?,?,?,?,?)').run(tenantId, 'new_card_filing', plate.id, fresh.validFrom, userId, now())
      return {
        done: done.map(([code, value]) => ({ code, name: known.get(code).name, before: before[code], expiresOn: value })),
        notDone: notDone.map(code => known.get(code).name),
        newCardFiling: body.newCardFiling === undefined ? null : filingDone
      }
    }
  }
}

// 換司機：按新批文卡填主司機和副司機（最多 3 位）；換走而沒有開其他牌照的司機停止證件提醒
function prepareDriverChange(ctx, body) {
  const { plate, tenantId } = ctx
  if (!Array.isArray(body.drivers) || !body.drivers.length || body.drivers.length > 3) return bad(400, '請填寫 1 至 3 位司機')
  const list = []
  for (const entry of body.drivers) {
    if (!isObject(entry) || typeof entry.name !== 'string' || !['主', '副'].includes(entry.role)) return bad(400, '司機資料格式無效')
    const name = clean(entry.name, 60)
    if (!name) return bad(400, '司機姓名不可為空')
    if (list.some(item => item.name === name)) return bad(400, '同一位司機不可重複填寫')
    if (entry.phone !== undefined && (typeof entry.phone !== 'string' || (entry.phone.trim() && !/^\+?[\d\s-]{8,20}$/.test(entry.phone.trim())))) return bad(400, '電話號碼格式無效')
    const dates = checkDates(entry.dates, dateRules(tenantId, 'driver', {}))
    if (dates.error) return dates
    list.push({ name, role: entry.role, phone: clean(entry.phone, 30), dates: dates.values })
  }
  if (list.filter(item => item.role === '主').length !== 1) return bad(400, '請選一位主司機')
  const ordered = [...list.filter(item => item.role === '主'), ...list.filter(item => item.role === '副')]
  const rules = dateRules(tenantId, 'driver', {})
  return {
    write(userId) {
      const before = all("SELECT d.id, d.name, pd.role FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY CASE pd.role WHEN '主' THEN 0 ELSE 1 END, pd.sort", plate.id)
      const rows = ordered.map(item => {
        let driver = one('SELECT * FROM drivers WHERE tenant_id=? AND customer_id=? AND name=?', tenantId, plate.customer_id, item.name)
        if (!driver) { driver = { id: id() }; db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(driver.id, tenantId, plate.customer_id, item.name, item.phone || null, now(), now()) }
        else {
          db.prepare('UPDATE drivers SET retired_on=NULL, updated_at=? WHERE id=?').run(now(), driver.id)
          if (item.phone && !driver.phone) db.prepare('UPDATE drivers SET phone=? WHERE id=?').run(item.phone, driver.id)
        }
        for (const [code, value] of Object.entries(item.dates)) writeDate(tenantId, 'driver', driver.id, code, value, userId)
        const kept = before.find(entry => entry.id === driver.id)
        return { ...item, driverId: driver.id, isNew: !kept, missing: rules.filter(rule => !item.dates[rule.code] && !dateOf('driver', driver.id, rule.code)).map(rule => rule.name) }
      })
      db.prepare('DELETE FROM plate_drivers WHERE plate_asset_id=?').run(plate.id)
      rows.forEach((row, index) => db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role,sort,registered_on) VALUES (?,?,?,?,?)').run(plate.id, row.driverId, row.role, index, ctx.handledOn))
      const removed = before.filter(entry => !rows.some(row => row.driverId === entry.id))
      const retired = removed.filter(entry => !one('SELECT 1 FROM plate_drivers WHERE driver_id=? LIMIT 1', entry.id))
      for (const entry of retired) db.prepare('UPDATE drivers SET retired_on=?, updated_at=? WHERE id=?').run(ctx.handledOn, now(), entry.id)
      const card = cardData(plate.card_data), cardNames = ['driver1', 'driver2', 'driver3'].map(key => clean(card[key], 60)).filter(Boolean)
      return {
        before: before.map(entry => ({ name: entry.name, role: entry.role })),
        after: rows.map(row => ({ name: row.name, role: row.role, isNew: row.isNew, missing: row.missing })),
        removed: removed.map(entry => ({ name: entry.name, stillDrivesOther: !retired.some(item => item.id === entry.id) })),
        cardMismatch: cardNames.length && cardNames.slice().sort().join('、') !== rows.map(row => row.name).sort().join('、') ? cardNames.join('、') : ''
      }
    }
  }
}

function prepareStop(ctx, body) {
  if (!stopReasons.includes(body.reason)) return bad(400, '請選擇不再續期的原因')
  if (body.note !== undefined && typeof body.note !== 'string') return bad(400, '補充說明格式無效')
  if (ctx.plate.stopped_on) return bad(409, '這個牌照已標記為不再續期')
  return {
    write() {
      db.prepare('UPDATE plate_assets SET stopped_on=?, stop_reason=?, updated_at=? WHERE id=?').run(ctx.handledOn, body.reason, now(), ctx.plate.id)
      return { reason: body.reason, note: clean(body.note, 300) }
    }
  }
}
const markPhotoHint = { inspection_done: '請附上檢驗標誌或檢驗結果相片', filing_done: '請附上備案回執相片', tax_paid: '請附上行車稅繳費收據相片' }
// 驗車、備案、澳門行車稅由客戶標記辦好：只限這個牌照（或它綁定的車）現在仍未完成的那一期，並須附相片作證明
function prepareMarkDone(ctx, body, kind) {
  const { plate, tenantId } = ctx, { code, ownerType } = markable[kind]
  if (typeof body.period !== 'string' || !body.period.trim()) return bad(400, '請選擇要標記的期數')
  const owner = ownerType === 'plate' ? plate : plate.vehicle_id ? one('SELECT * FROM vehicles WHERE id=?', plate.vehicle_id) : null
  if (!owner || owner.retired_on) return bad(400, '這個牌照沒有綁定車輛')
  if (body.ownerId !== undefined && body.ownerId !== owner.id) return bad(400, '標記的對象不屬於這個牌照')
  if (one('SELECT 1 FROM rule_completions WHERE code=? AND owner_id=? AND period=?', code, owner.id, body.period)) return bad(409, '這一期已標記辦好')
  const rule = one('SELECT * FROM rules WHERE tenant_id=? AND code=? AND active=1 AND customer_visible=1', tenantId, code)
  if (!rule) return bad(400, '這項目前不需要標記')
  const decoded = { ...rule, match: JSON.parse(rule.match_json || '{}'), params: JSON.parse(rule.params_json || '{}'), remindDays: rule.remind_days }
  const facts = ownerType === 'plate' ? plateFacts(owner) : vehicleFacts(owner)
  const open = computeDeadlines({ rules: [decoded], owners: [{ ownerType, ownerId: owner.id, label: '', facts }], tracked: new Map(), completions: new Set(), windowDays: 180 })
    .find(item => item.completable && item.period === body.period)
  if (!open) return bad(400, '這一期目前不需要標記')
  if (!ctx.photoCount) return bad(400, markPhotoHint[kind])
  return {
    write(userId) {
      db.prepare('INSERT INTO rule_completions(tenant_id,code,owner_id,period,completed_by,completed_at) VALUES (?,?,?,?,?,?)').run(tenantId, code, owner.id, body.period, userId, now())
      return { code, name: rule.name, period: body.period, label: open.detail, dueOn: open.dueOn, ownerType, ownerId: owner.id, ownerLabel: ownerType === 'vehicle' ? owner.plate : '' }
    }
  }
}
// 寫回批文卡上的幾個欄位（批文卡編號同時寫在牌照欄，與 PUT /plate-assets/:id 一致）
function writeCard(plate, changes) {
  const card = { ...cardData(one('SELECT card_data FROM plate_assets WHERE id=?', plate.id).card_data), ...changes }
  db.prepare('UPDATE plate_assets SET card_data=?, card_number=?, updated_at=? WHERE id=?').run(JSON.stringify(card), card.cardNumber || plate.card_number, now(), plate.id)
}
// 批文卡欄位「原來」的值：客戶剛改卡或上傳新卡、顧問還沒核對時，以改之前的值為準
// （客戶多是先改卡再說明是自己辦了變更；那些未核對的修改屬於這次自辦，核對時一併處理）
function cardBefore(plate) {
  const card = cardData(plate.card_data), result = { ...card }
  for (const row of all("SELECT field, before_value FROM customer_changes WHERE entity_type='card' AND entity_id=? AND status='待核對'", plate.id)) if (row.field in card || cardFields.includes(row.field)) result[row.field] = row.before_value ?? ''
  if (!result.cardNumber) result.cardNumber = plate.card_number || ''
  return result
}
const optionalText = (body, key, max) => body[key] === undefined ? { value: undefined } : typeof body[key] !== 'string' ? { error: true } : { value: clean(body[key], max) }

// 口岸變更（只限粵港）：更新批文卡「通行口岸」，可同時填新的香港 CRP 到期日；牌照的口岸欄由管理者按新卡設定
function prepareCrossingChange(ctx, body) {
  const { plate, tenantId } = ctx
  if (plate.route !== '粵港') return bad(400, '口岸變更只適用於粵港牌照')
  const crossing = optionalText(body, 'crossing', 120)
  if (crossing.error || !crossing.value) return bad(400, '請填寫新的通行口岸')
  const card = cardBefore(plate)
  if (crossing.value === clean(card.crossing, 120)) return bad(400, '通行口岸與原來相同；如只是之前填錯，請直接修改批文卡')
  if (body.crpExpiresOn !== undefined && body.crpExpiresOn !== '' && !validDate(body.crpExpiresOn)) return bad(400, '香港 CRP 到期日無效')
  return {
    write(userId) {
      writeCard(plate, { crossing: crossing.value })
      const crpBefore = dateOf('plate', plate.id, 'hk_crp')
      if (body.crpExpiresOn) writeDate(tenantId, 'plate', plate.id, 'hk_crp', body.crpExpiresOn, userId)
      return { before: card.crossing || '', after: crossing.value, port: plate.port || '', crp: body.crpExpiresOn ? { before: crpBefore, after: body.crpExpiresOn } : null }
    }
  }
}
// 商號／內承單位變更：只改批文卡上的名稱；牌照所屬公司組不自動搬，由員工核對後處理（避免搬錯公司）
function prepareCompanyChange(ctx, body) {
  const company = optionalText(body, 'company', 150), contractor = optionalText(body, 'contractor', 150)
  if (company.error || contractor.error) return bad(400, '商號或內承單位格式無效')
  if (company.value === '' || contractor.value === '') return bad(400, '商號和內承單位不可留空')
  const card = cardBefore(ctx.plate), changes = {}
  if (company.value !== undefined && company.value !== clean(card.company, 150)) changes.company = company.value
  if (contractor.value !== undefined && contractor.value !== clean(card.contractor, 150)) changes.contractor = contractor.value
  if (!Object.keys(changes).length) return bad(400, '商號和內承單位都沒有改變')
  return {
    write() {
      writeCard(ctx.plate, changes)
      return { changes: Object.keys(changes).map(key => ({ label: key === 'company' ? '商號' : '內承單位', before: card[key] || '', after: changes[key] })) }
    }
  }
}
// 補領：新卡的流水號（及編號，如有改變）；有效期應不變，上傳新卡讀出的有效期不同時提示員工核對
function prepareReplacement(ctx, body) {
  const { plate } = ctx
  const serial = optionalText(body, 'serial', 60), cardNumber = optionalText(body, 'cardNumber', 60)
  if (serial.error || !serial.value) return bad(400, '請填寫新卡的卡面流水號')
  if (cardNumber.error || cardNumber.value === '') return bad(400, '批文卡編號不可留空')
  const card = cardBefore(plate)
  if (serial.value === clean(card.serial, 60) && (cardNumber.value === undefined || cardNumber.value === clean(card.cardNumber, 60))) return bad(400, '流水號與原來相同；如只是之前填錯，請直接修改批文卡')
  if (cardNumber.value && cardNumber.value !== plate.card_number && one('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?', plate.customer_id, plate.route, cardNumber.value, plate.id)) return bad(409, '這張批文卡已在名下建檔')
  return {
    write() {
      writeCard(plate, { serial: serial.value, ...(cardNumber.value ? { cardNumber: cardNumber.value } : {}) })
      const validity = one("SELECT before_text, after_text FROM customer_changes WHERE entity_type='card' AND entity_id=? AND field='validTo' AND status='待核對'", plate.id)
      return { serial: { before: card.serial || '', after: serial.value }, cardNumber: cardNumber.value && cardNumber.value !== card.cardNumber ? { before: card.cardNumber || '', after: cardNumber.value } : null, validityChanged: validity ? { before: validity.before_text, after: validity.after_text } : null }
    }
  }
}
const prepare = { crossing_change: prepareCrossingChange, company_change: prepareCompanyChange, replacement: prepareReplacement, vehicle_change: prepareVehicleChange, renewal: prepareRenewal, driver_change: prepareDriverChange, stop_renewal: prepareStop, inspection_done: (ctx, body) => prepareMarkDone(ctx, body, 'inspection_done'), filing_done: (ctx, body) => prepareMarkDone(ctx, body, 'filing_done'), tax_paid: (ctx, body) => prepareMarkDone(ctx, body, 'tax_paid') }

// 客戶端表單需要的資料：這個牌照適用哪些文件、新車和司機要填哪些到期日、現況
function formFor(plate, tenantId) {
  const card = cardData(plate.card_data), facts = plateFacts(plate)
  const vehicle = plate.vehicle_id ? one('SELECT * FROM vehicles WHERE id=?', plate.vehicle_id) : null
  const origin = vehicle?.origin || (plate.route === '粵澳' ? '澳門' : '香港')
  const renewal = decodedRules(tenantId, 'plate').filter(rule => ruleMatches(rule, facts) && (rule.code === 'approval' || !rule.params.field))
  return {
    route: plate.route, crpExpiresOn: dateOf('plate', plate.id, 'hk_crp'), stoppedOn: plate.stopped_on || null, stopReason: plate.stop_reason || '',
    pending: all("SELECT kind FROM self_handled WHERE plate_asset_id=? AND status='待核對'", plate.id).map(row => row.kind),
    card: { localPlate: card.localPlate || '', crossing: card.crossing || '', company: card.company || '', contractor: card.contractor || '', serial: card.serial || '', cardNumber: card.cardNumber || plate.card_number || '', validFrom: card.validFrom || '', validTo: card.validTo || plate.card_expires_on || '', drivers: ['driver1', 'driver2', 'driver3'].map(key => card[key] || '').filter(Boolean) },
    cardBefore: (({ localPlate = '', crossing = '', company = '', contractor = '', serial = '', cardNumber = '', validTo = '' }) => ({ localPlate, crossing, company, contractor, serial, cardNumber, validTo: validTo || plate.card_expires_on || '' }))(cardBefore(plate)),
    vehicle: vehicle ? { plate: vehicle.plate, brand: vehicle.brand || '', model: vehicle.model || '' } : null,
    renewalDocuments: renewal.map(rule => ({ code: rule.code, name: rule.name, expiresOn: rule.code === 'approval' ? (card.validTo || plate.card_expires_on || '') : dateOf('plate', plate.id, rule.code) })),
    vehicleDates: dateRules(tenantId, 'vehicle', vehicleFacts({ route: plate.route, origin })).map(rule => ({ code: rule.code, name: rule.name })),
    driverDates: dateRules(tenantId, 'driver', {}).map(rule => ({ code: rule.code, name: rule.name })),
    drivers: all("SELECT d.name, pd.role FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY CASE pd.role WHEN '主' THEN 0 ELSE 1 END, pd.sort", plate.id),
    stopReasons
  }
}
const recordView = (row, extra = {}) => ({ id: row.id, kind: row.kind, kindName: kinds[row.kind], plateId: row.plate_asset_id, handledOn: row.handled_on, details: JSON.parse(row.details_json), status: row.status, createdByName: row.created_by_name, createdAt: row.created_at, reviewedByName: row.reviewed_by_name, reviewedAt: row.reviewed_at, reviewNote: row.review_note, ...extra })

// 客戶端：提交自辦、查看自己的提交
export async function selfHandledClientRoutes(req, res, url, user, { json, fail, parseBody }) {
  const match = url.pathname.match(/^\/api\/my\/plates\/([^/]+)\/self-handled(\/form)?$/)
  if (!match) return false
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  const tenantId = user.tenant_id
  const plate = one('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND p.customer_id=? AND c.tenant_id=?', match[1], user.customer_id, tenantId)
  if (!plate) return fail(res, 404, '兩地牌不存在'), true
  if (match[2]) return req.method === 'GET' ? json(res, 200, formFor(plate, tenantId)) : fail(res, 405, '不支援此操作'), true
  if (req.method === 'GET') return json(res, 200, all('SELECT * FROM self_handled WHERE plate_asset_id=? ORDER BY created_at DESC LIMIT 20', plate.id).map(row => recordView(row))), true
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  if (!kinds[body.kind]) return fail(res, 400, '請選擇辦了甚麼'), true
  const handledOn = body.handledOn === undefined ? todayHk() : body.handledOn
  if (!validDate(handledOn)) return fail(res, 400, '辦好日期無效'), true
  if (handledOn > todayHk()) return fail(res, 400, '辦好日期不可在今天之後'), true
  if (plate.stopped_on && body.kind !== 'stop_renewal') return fail(res, 409, '這個牌照已標記為不再續期；如要恢復，請聯絡你的顧問'), true
  if (one("SELECT id FROM self_handled WHERE plate_asset_id=? AND kind=? AND status='待核對'", plate.id, body.kind)) return fail(res, 409, `已提交「${kinds[body.kind]}」，顧問核對中；如需修改請聯絡你的顧問`), true
  const photos = checkPhotos(body.photos)
  if (photos.error) return fail(res, photos.status, photos.error), true
  const ctx = { plate, tenantId, handledOn, photoCount: photos.files.length }
  const plan = prepare[body.kind](ctx, body)
  if (plan.error) return fail(res, plan.status, plan.error), true
  const recordId = id()
  db.exec('BEGIN IMMEDIATE')
  try {
    const details = plan.write(user.id)
    // 原屬我們代辦（批文由我們負責）：讓管理者知道這次是客戶自己辦的
    const handling = scopeMap(tenantId).handling('plate', plate.id, 'approval', plate.customer_id)
    details.ours = handling?.handler === 'us'
    const services = sameService[body.kind]
    details.openRequests = all(`SELECT id, title, status FROM requests WHERE plate_asset_id=? AND status NOT IN ('已完成','已取消') ${services ? `AND service_code IN (${services.map(() => '?').join(',')})` : ''} ORDER BY created_at`, plate.id, ...(services || []))
    details.plateLabel = plateLabel(one('SELECT * FROM plate_assets WHERE id=?', plate.id))
    // 自管客戶自辦的事不經員工核對：直接記為已核對，不進「客戶自行辦理待核對」
    const selfManaged = selfManagedCustomer(plate.customer_id)
    db.prepare('INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,status,created_by,created_by_name,created_at,reviewed_by_name,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(recordId, tenantId, plate.customer_id, plate.id, body.kind, handledOn, JSON.stringify(details), selfManaged ? '已核對' : '待核對', user.id, user.name, now(), selfManaged ? '自管客戶，不經核對' : null, selfManaged ? now() : null)
    for (const file of photos.files) db.prepare('INSERT INTO self_handled_files(id,record_id,mime,data,created_at) VALUES (?,?,?,?,?)').run(id(), recordId, file.mime, file.bytes, now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 201, recordView(one('SELECT * FROM self_handled WHERE id=?', recordId))), true
}

// 後台：整件核對；退回時寫明原因並通知客戶（不再續期退回時恢復提醒）
export async function selfHandledReviewRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname
  const itemMatch = path.match(/^\/api\/self-handled\/([^/]+)\/(accept|return)$/)
  const fileMatch = path.match(/^\/api\/self-handled\/([^/]+)\/files\/([^/]+)$/)
  if (path !== '/api/self-handled' && !itemMatch && !fileMatch) return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  const tenantId = user.tenant_id
  const record = recordId => typeof recordId === 'string' ? one('SELECT * FROM self_handled WHERE id=? AND tenant_id=?', recordId, tenantId) : null
  if (path === '/api/self-handled') {
    if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const status = url.searchParams.get('status') || '待核對'
    if (!['待核對', '已核對', '已退回'].includes(status)) return fail(res, 400, '狀態無效'), true
    const rows = all(`SELECT s.*, c.name customer_name FROM self_handled s JOIN customers c ON c.id=s.customer_id WHERE s.tenant_id=? AND s.status=? ORDER BY ${status === '待核對' ? 's.created_at' : 's.reviewed_at DESC'} LIMIT 200`, tenantId, status)
    return json(res, 200, rows.map(row => recordView(row, {
      customerId: row.customer_id, customerName: row.customer_name,
      files: all('SELECT id FROM self_handled_files WHERE record_id=? ORDER BY created_at', row.id).map(file => file.id),
      cardSides: all('SELECT side FROM approval_card_images WHERE plate_asset_id=? ORDER BY side DESC', row.plate_asset_id).map(image => image.side),
      cardChanges: one("SELECT COUNT(*) n FROM customer_changes WHERE entity_type='card' AND entity_id=? AND status='待核對'", row.plate_asset_id).n
    }))), true
  }
  if (fileMatch) {
    if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
    if (!record(fileMatch[1])) return fail(res, 404, '記錄不存在'), true
    const file = one('SELECT mime, data FROM self_handled_files WHERE id=? AND record_id=?', fileMatch[2], fileMatch[1])
    if (!file) return fail(res, 404, '相片不存在'), true
    res.writeHead(200, { 'content-type': file.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
    return res.end(file.data), true
  }
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (user.role !== 'admin') return fail(res, 403, '只有管理者可以核對客戶自辦'), true
  const row = record(itemMatch[1])
  if (!row) return fail(res, 404, '記錄不存在'), true
  if (row.status !== '待核對') return fail(res, 409, '這件已處理，請重新整理'), true
  const body = await parseBody(req)
  if (itemMatch[2] === 'accept') {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE self_handled SET status='已核對', reviewed_by=?, reviewed_by_name=?, reviewed_at=? WHERE id=?").run(user.id, user.name, now(), row.id)
      // 同一次自辦時上傳的新批文卡欄位修改一併核對
      const cardChanges = db.prepare("UPDATE customer_changes SET status='已核對', reviewed_by=?, reviewed_by_name=?, reviewed_at=? WHERE entity_type='card' AND entity_id=? AND status='待核對'").run(user.id, user.name, now(), row.plate_asset_id).changes
      if (cardChanges) db.prepare("UPDATE plate_assets SET card_status='已核對', card_updated_by=?, card_updated_at=? WHERE id=?").run(user.name, now(), row.plate_asset_id)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    // 確認了也通知客戶（管理者 2026-10-18）；同一次一併核對的批文卡修改包在這一則，不另發
    notify({ tenantId, customerId: row.customer_id, kind: 'self_handled_accepted', title: `顧問已確認你自行辦理的「${kinds[row.kind]}」`, body: (label => `${label ? label + '：' : ''}資料已核對無誤。`)(JSON.parse(row.details_json).plateLabel), link: `/pages/plate-detail/plate-detail?id=${row.plate_asset_id}`, dedupeKey: `self_handled_accepted:${row.id}` })
    return json(res, 200, recordView(record(row.id))), true
  }
  const note = clean(body.note, 300)
  if (!note) return fail(res, 400, '請寫明退回原因，會通知客戶'), true
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE self_handled SET status='已退回', reviewed_by=?, reviewed_by_name=?, reviewed_at=?, review_note=? WHERE id=?").run(user.id, user.name, now(), note, row.id)
    if (row.kind === 'stop_renewal') db.prepare('UPDATE plate_assets SET stopped_on=NULL, stop_reason=NULL, updated_at=? WHERE id=?').run(now(), row.plate_asset_id)
    // 驗車、備案退回：撤銷客戶的「已辦好」，照舊提醒（員工之後自己標記的不動）
    if (markable[row.kind]) { const d = JSON.parse(row.details_json); db.prepare('DELETE FROM rule_completions WHERE code=? AND owner_id=? AND period=? AND completed_by=?').run(d.code, d.ownerId, d.period, row.created_by) }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  notify({ tenantId, customerId: row.customer_id, kind: 'self_handled_returned', title: `顧問未能確認你的「${kinds[row.kind]}」更新`, body: `${note}${row.kind === 'stop_renewal' || markable[row.kind] ? '。這一項會照常提醒。' : '。請按顧問說明修正資料，或聯絡你的顧問。'}`, link: `/pages/plate-detail/plate-detail?id=${row.plate_asset_id}`, dedupeKey: `self_handled:${row.id}` })
  return json(res, 200, recordView(record(row.id))), true
}
