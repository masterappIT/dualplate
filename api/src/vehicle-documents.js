import { db, now } from './db.js'
import { logChanges } from './client-edits.js'
import { vehicleFacts } from './plate-facts.js'
import { ruleMatches } from './rules.js'
import { fieldLabels, recognizeVehicleDocument } from './vehicle-ocr.js'

// 車輛證件（負責人 2026-10-17，管理者確認）：車輛綁定內地行駛證與香港車輛牌照／澳門車輛登記文件。
// 上傳原件相片 → 辨識 → 只填入車輛資料中仍是空白的欄位（不覆蓋已有資料），香港車輛牌照的有效期寫入到期日；
// 各證件與車輛資料的車架號碼、車牌互相比對，不一致時提示。每類證件只保留最新一張（同批文卡）。
// 保險單只存相片作原件，不辨識（各保險公司版式不同），到期日照常在到期日區填寫。
db.exec(`CREATE TABLE IF NOT EXISTS vehicle_documents(vehicle_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, fields_json TEXT NOT NULL DEFAULT '{}', uploaded_by TEXT, uploaded_by_name TEXT, uploaded_at TEXT NOT NULL, PRIMARY KEY(vehicle_id, kind), FOREIGN KEY(vehicle_id) REFERENCES vehicles(id))`)

const insuranceLabel = vehicle => vehicle.route === '粵澳' ? '澳門汽車保險單' : '香港汽車保險單'
export const documentKinds = {
  cn_licence: { label: () => '內地行駛證', hint: '有車輛識別代號的主頁', recognize: true, primary: true, applies: () => true },
  cn_licence_back: { label: () => '內地行駛證副頁', hint: '檢驗記錄那一頁，只存原件', recognize: false, applies: () => true },
  hk_licence: { label: () => '香港車輛牌照', hint: '牌費行車證，印有有效期', recognize: true, primary: true, applies: vehicle => vehicle.origin === '香港' },
  hk_registration: { label: () => '香港車輛登記文件（牌簿）', hint: '印有首次登記日期、製造年份', recognize: true, applies: vehicle => vehicle.origin === '香港' },
  mo_registration: { label: () => '澳門車輛登記文件', hint: '印有車牌、車架號碼', recognize: true, primary: true, applies: vehicle => vehicle.origin === '澳門' },
  local_insurance: { label: insuranceLabel, hint: '只存原件，到期日在到期項目填寫', recognize: false, applies: () => true },
  cn_ctpl: { label: () => '內地交強險保單', hint: '只存原件，到期日在到期項目填寫', recognize: false, applies: () => true }
}
// 辨識出的值可以填進車輛資料的哪一欄（只在該欄空白時）
const vehicleColumns = { vin: ['vin', '車架號碼'], brand: ['brand', '品牌'], model: ['model', '型號'], manufacturedYear: ['manufactured_year', '製造年份'], firstRegisteredOn: ['first_registered_on', '首次登記日期'] }
// 內地行駛證的註冊日期是內地註冊，不是港澳首次註冊，不填進車輛資料
const fillable = { cn_licence: ['vin'], hk_licence: ['vin'], hk_registration: ['vin', 'brand', 'model', 'manufacturedYear', 'firstRegisteredOn'], mo_registration: ['vin', 'brand', 'model', 'manufacturedYear', 'firstRegisteredOn'] }
const MAX_BYTES = 3500000

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const one = (sql, ...params) => db.prepare(sql).get(...params)
const all = (sql, ...params) => db.prepare(sql).all(...params)
const sameText = value => String(value ?? '').normalize('NFKC').toUpperCase().replace(/[\s\-–—·.]/g, '').replace(/粤/g, '粵')

// 員工、管理者可看同一租戶的車輛；客戶只可看自己的。其他一律當作不存在（404）。
function vehicleFor(user, vehicleId) {
  const vehicle = one('SELECT v.*, c.tenant_id FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE v.id=?', vehicleId)
  if (!vehicle || vehicle.tenant_id !== user.tenant_id) return null
  if (['admin', 'staff'].includes(user.role)) return vehicle
  return user.role === 'customer' && user.customer_id === vehicle.customer_id ? vehicle : null
}
const kindsFor = vehicle => Object.entries(documentKinds).filter(([, kind]) => kind.applies(vehicle))
const parseFields = row => { try { const value = JSON.parse(row?.fields_json || '{}'); return isObject(value) ? value : {} } catch { return {} } }

// 車架號碼、車牌互相比對：同一部車的各份證件和車輛資料應該一致
export function documentChecks(vehicle, rows) {
  const checks = []
  const read = (kind, key) => { const status = parseFields(rows.find(row => row.kind === kind))?.fieldStatus?.[key]; return status && status.status !== 'failed' && status.value ? status.value : '' }
  const vins = [['車輛資料', vehicle.vin], ...rows.filter(row => documentKinds[row.kind]?.recognize).map(row => [documentKinds[row.kind].label(vehicle), read(row.kind, 'vin')])].filter(([, value]) => value)
  if (new Set(vins.map(([, value]) => sameText(value))).size > 1) checks.push({ code: 'vin_mismatch', text: `車架號碼不一致：${vins.map(([name, value]) => `${name} ${value}`).join('、')}，請核對是否同一部車` })
  const mainland = read('cn_licence', 'plate')
  const plate = one('SELECT mainland_plate FROM plate_assets WHERE vehicle_id=? ORDER BY updated_at DESC LIMIT 1', vehicle.id)
  if (mainland && plate?.mainland_plate && sameText(mainland) !== sameText(plate.mainland_plate)) checks.push({ code: 'mainland_plate_mismatch', text: `內地行駛證車牌 ${mainland} 與牌照的內地車牌 ${plate.mainland_plate} 不一致` })
  for (const kind of ['hk_licence', 'hk_registration', 'mo_registration']) {
    const local = read(kind, 'plate')
    if (local && vehicle.plate && sameText(local) !== sameText(vehicle.plate)) checks.push({ code: `${kind}_plate_mismatch`, text: `${documentKinds[kind].label(vehicle)}車牌 ${local} 與車輛車牌 ${vehicle.plate} 不一致` })
  }
  return checks
}

function documentsView(vehicle) {
  const rows = all('SELECT vehicle_id, kind, mime, fields_json, uploaded_by_name, uploaded_at FROM vehicle_documents WHERE vehicle_id=?', vehicle.id)
  return {
    vehicleId: vehicle.id,
    retired: !!vehicle.retired_on,
    documents: kindsFor(vehicle).map(([code, kind]) => {
      const row = rows.find(item => item.kind === code), stored = parseFields(row)
      const fields = kind.recognize && row ? Object.entries(stored.fieldStatus || {}).map(([key, status]) => ({ key, label: fieldLabels[key] || key, value: status.value || '', status: status.status })) : []
      return { kind: code, label: kind.label(vehicle), hint: kind.hint, recognizable: kind.recognize, primary: !!kind.primary, uploaded: !!row, uploadedAt: row?.uploaded_at || null, uploadedByName: row?.uploaded_by_name || '', fields }
    }),
    checks: documentChecks(vehicle, rows)
  }
}

// 只填空白欄；香港車輛牌照有效期：沒有記錄時填入，已有記錄而新讀出的日期較遲且清楚（ok）時更新。
function applyRecognized({ vehicle, kind, recognized, user }) {
  const applied = [], changes = []
  for (const key of fillable[kind] || []) {
    const status = recognized.fieldStatus[key]
    if (!status || status.status === 'failed' || !status.value) continue
    const [column, label] = vehicleColumns[key]
    if (vehicle[column] !== null && vehicle[column] !== undefined && String(vehicle[column]).trim() !== '') continue
    const value = column === 'manufactured_year' ? Number(status.value) : status.value
    db.prepare(`UPDATE vehicles SET ${column}=? WHERE id=?`).run(value, vehicle.id)
    applied.push({ field: key, label, value: String(status.value) })
    changes.push({ field: key, label, before: vehicle[column], after: String(status.value), isDate: column === 'first_registered_on' })
  }
  const expiry = kind === 'hk_licence' ? recognized.fieldStatus.expiresOn : null
  if (expiry?.value && expiry.status !== 'failed') {
    const rule = one("SELECT * FROM rules WHERE tenant_id=? AND code='hk_licence' AND scope='vehicle' AND method='expiry' AND active=1", vehicle.tenant_id)
    const decoded = rule && { ...rule, match: JSON.parse(rule.match_json || '{}') }
    const current = one("SELECT expires_on FROM tracked_items WHERE tenant_id=? AND owner_type='vehicle' AND owner_id=? AND code='hk_licence'", vehicle.tenant_id, vehicle.id)?.expires_on || ''
    if (decoded && ruleMatches(decoded, vehicleFacts(vehicle)) && (!current || (expiry.status === 'ok' && expiry.value > current))) {
      db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(vehicle.tenant_id, 'vehicle', vehicle.id, 'hk_licence', expiry.value, '', user.id, now())
      applied.push({ field: 'date:hk_licence', label: rule.name, value: expiry.value })
      changes.push({ field: 'date:hk_licence', label: rule.name, before: current, after: expiry.value, isDate: true })
    }
  }
  // 客戶上傳而自動填入的資料，同樣列入「客戶更新待核對」
  if (user.role === 'customer' && changes.length) logChanges({ tenantId: vehicle.tenant_id, customerId: vehicle.customer_id, user, entityType: 'vehicle', entityId: vehicle.id, entityLabel: vehicle.plate, changes })
  return applied
}

export async function vehicleDocumentRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const listMatch = path.match(/^\/api\/vehicles\/([^/]+)\/documents$/)
  const kindMatch = path.match(/^\/api\/vehicles\/([^/]+)\/documents\/([^/]+)$/)
  const imageMatch = path.match(/^\/api\/vehicles\/([^/]+)\/documents\/([^/]+)\/image$/)
  if (!listMatch && !kindMatch && !imageMatch) return false
  const vehicle = vehicleFor(user, decodeURIComponent((listMatch || kindMatch || imageMatch)[1]))
  if (!vehicle) return fail(res, 404, '車輛不存在'), true

  if (listMatch) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, documentsView(vehicle)), true
  }
  const code = decodeURIComponent((kindMatch || imageMatch)[2])
  const kind = Object.hasOwn(documentKinds, code) ? documentKinds[code] : null
  if (!kind || !kind.applies(vehicle)) return fail(res, 404, '這部車沒有此類證件'), true

  if (imageMatch) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const row = one('SELECT mime, data FROM vehicle_documents WHERE vehicle_id=? AND kind=?', vehicle.id, code)
    if (!row) return fail(res, 404, '尚未上傳此證件'), true
    res.writeHead(200, { 'content-type': row.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
    return res.end(Buffer.from(row.data)), true
  }

  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (vehicle.retired_on) return fail(res, 400, '這部車已換走，保留作記錄，不可再上傳證件'), true
  const body = await parseBody(req)
  if (!isObject(body) || typeof body.image !== 'string') return fail(res, 400, '請上傳 JPG 或 PNG 圖片'), true
  const matched = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(body.image)
  if (!matched) return fail(res, 400, '請上傳 JPG 或 PNG 圖片'), true
  const bytes = Buffer.from(matched[2], 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES) return fail(res, 400, '圖片不可超過 3.5 MB'), true
  const signature = matched[1] === 'image/png' ? bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) : bytes[0] === 0xff && bytes[1] === 0xd8
  if (!signature) return fail(res, 400, '圖片內容與格式不符，請重新拍攝'), true

  let recognized = { fields: {}, fieldStatus: {} }, recognitionFailed = false
  if (kind.recognize) {
    try { recognized = await recognizeVehicleDocument(bytes, code) } catch (error) { recognitionFailed = true; console.error('Vehicle document OCR failed:', error.message) }
  }
  let applied = []
  db.exec('BEGIN IMMEDIATE')
  try {
    // 辨識期間車輛可能被改過，重新讀取再填
    const fresh = { ...one('SELECT * FROM vehicles WHERE id=?', vehicle.id), tenant_id: vehicle.tenant_id }
    db.prepare('INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,fields_json,uploaded_by,uploaded_by_name,uploaded_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(vehicle_id,kind) DO UPDATE SET mime=excluded.mime,data=excluded.data,fields_json=excluded.fields_json,uploaded_by=excluded.uploaded_by,uploaded_by_name=excluded.uploaded_by_name,uploaded_at=excluded.uploaded_at')
      .run(vehicle.id, code, matched[1], bytes, JSON.stringify(recognized), user.id, user.name || '', now())
    if (kind.recognize && !recognitionFailed) applied = applyRecognized({ vehicle: fresh, kind: code, recognized, user })
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  const updated = one('SELECT * FROM vehicles WHERE id=?', vehicle.id)
  return json(res, 200, { kind: code, uploaded: true, recognitionFailed, fieldStatus: recognized.fieldStatus, applied, vehicle: updated, ...documentsView({ ...updated, tenant_id: vehicle.tenant_id }) }), true
}
