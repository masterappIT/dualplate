import { db, id, now } from './db.js'
import { businessToday } from './rules.js'
import { scopeMap } from './entrustment.js'
import { sniff, notify } from './client-portal.js'
import { rentCommission } from './fees.js'

// 出租合約與每月租金（docs/tasks/rentals-brief.md 第 A 輪）。金額一律以「分」為單位的整數，不做匯率換算。
// 用語（管理者 2026-10-18）：客戶端、承租人連結、協議一律寫「出租、租金、承租人」，不再用「車輛使用安排／使用費」。
db.exec(`CREATE TABLE IF NOT EXISTS rental_contracts(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plate_asset_id TEXT NOT NULL, renter_name TEXT NOT NULL, renter_type TEXT NOT NULL DEFAULT '個人', renter_phone TEXT, renter_vehicle_plate TEXT, renter_driver TEXT,
  starts_on TEXT NOT NULL, ends_on TEXT, rent_amount INTEGER NOT NULL DEFAULT 0, lessor_type TEXT NOT NULL DEFAULT 'client', lessor_company_id TEXT, currency TEXT NOT NULL DEFAULT 'HKD', cycle TEXT NOT NULL DEFAULT 'monthly', due_day INTEGER NOT NULL DEFAULT 1,
  deposit_amount INTEGER NOT NULL DEFAULT 0, collection_mode TEXT NOT NULL DEFAULT '直付', fee_type TEXT NOT NULL DEFAULT 'none', fee_value REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '草擬', prev_usage_status TEXT, terminated_reason TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_plate ON rental_contracts(plate_asset_id);
CREATE TABLE IF NOT EXISTS rent_invoices(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, period TEXT NOT NULL, due_on TEXT NOT NULL, amount INTEGER NOT NULL, received_on TEXT, received_amount INTEGER, received_by TEXT, confirmed_by TEXT, voided INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, UNIQUE(contract_id, period));
CREATE TABLE IF NOT EXISTS rent_invoice_proofs(invoice_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, uploaded_at TEXT NOT NULL);`)

// 客戶自行新增出租（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項）：source=client；handling＝agent（交給我們代理）或 self（自行負責）。
// 協議：agreement_body 是客戶正在改的稿；按「發給承租人」時鎖定為 agreement_sent_body，版本加一，承租人要按最新版本確認。
const addColumn = (table, column, definition) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
addColumn('rental_contracts', 'source', "TEXT NOT NULL DEFAULT 'staff'")
for (const column of ['handling', 'renter_id_no', 'agreement_body', 'agreement_sent_body', 'agreement_sent_at', 'staff_seen_at', 'created_by']) addColumn('rental_contracts', column, 'TEXT')
addColumn('rental_contracts', 'agreement_version', 'INTEGER NOT NULL DEFAULT 0')
// 出租要辦的換車、換司機：handler＝us 開工單（request_id），client 由客戶自行辦理後在「有變動？」回報
db.exec(`CREATE TABLE IF NOT EXISTS rental_procedures(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, kind TEXT NOT NULL, handler TEXT NOT NULL, request_id TEXT, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rental_signed_files(contract_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, uploaded_at TEXT NOT NULL);`)

export const currencies = ['HKD', 'RMB', 'MOP']
const cycles = { monthly: 1, quarterly: 3, yearly: 12 }
const lessorTypes = ['company', 'client', 'agent']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const cents = value => Number.isInteger(value) && value >= 0 && value <= 1e12
const today = () => businessToday().toISOString().slice(0, 10)
const addMonths = (month, count) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + count, 1)); return d.toISOString().slice(0, 7) }

// 舊 plate_rentals 中「出租中」的記錄遷移為生效合約；金額未知記 0 並標註待補充。舊表保留。
const rentalsMigration = '2026-10-16-rental-contracts'
if (!db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(rentalsMigration)) {
  db.exec('BEGIN')
  try {
    for (const old of db.prepare("SELECT r.*, c.tenant_id, p.usage_status FROM plate_rentals r JOIN plate_assets p ON p.id=r.plate_asset_id JOIN customers c ON c.id=p.customer_id WHERE r.status='出租中'").all()) {
      db.prepare("INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,renter_vehicle_plate,starts_on,ends_on,rent_amount,status,prev_usage_status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,'生效','待核對',?,?,?)")
        .run(id(), old.tenant_id, old.plate_asset_id, old.renter_name, old.renter_vehicle_plate, old.starts_on || old.created_at.slice(0, 10), old.ends_on, `由舊出租記錄遷移，租金、收款方式待補充${old.notes ? `；${old.notes}` : ''}`, now(), now())
    }
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(rentalsMigration, now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

const contractFor = (tenantId, contractId) => typeof contractId === 'string' ? db.prepare('SELECT * FROM rental_contracts WHERE id=? AND tenant_id=?').get(contractId, tenantId) || null : null
const plateOf = (tenantId, plateId) => typeof plateId === 'string' ? db.prepare('SELECT p.*, c.is_self, c.name customer_name FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND c.tenant_id=?').get(plateId, tenantId) || null : null

// 合約生效時兩地牌改為「出租中」並記住原本狀態；結束或終止時還原。用途只由合約推算，不再兩處維護。
function activate(contract) {
  const plate = db.prepare('SELECT usage_status FROM plate_assets WHERE id=?').get(contract.plate_asset_id)
  db.prepare('UPDATE rental_contracts SET prev_usage_status=COALESCE(prev_usage_status, ?) WHERE id=?').run(plate?.usage_status === '出租中' ? '待核對' : plate?.usage_status || '待核對', contract.id)
  db.prepare("UPDATE plate_assets SET usage_status='出租中', updated_at=? WHERE id=?").run(now(), contract.plate_asset_id)
}
function release(contract) {
  if (db.prepare("SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND status='生效' AND id<>?").get(contract.plate_asset_id, contract.id)) return
  db.prepare('UPDATE plate_assets SET usage_status=?, updated_at=? WHERE id=?').run(contract.prev_usage_status || '待核對', now(), contract.plate_asset_id)
}

export const procedureNames = { vehicle: '換車', driver: '換司機' }
// 客戶端看到的狀態
export const statusWord = contract => contract.status === '草擬' ? (contract.agreement_version ? '待承租人確認' : contract.source !== 'client' ? '草擬' : contract.handling === 'agent' ? '交給我們代理' : '未發出協議') : contract.status === '生效' ? '出租中' : contract.status === '已終止' && contract.terminated_reason === '客戶取消' ? '已取消' : contract.status
const selfKinds = { vehicle: 'vehicle_change', driver: 'driver_change' }
// 手續進度：我們辦的看工單是否完成；客戶自行辦理的，看出租建立後有沒有在「有變動？」回報（退回的不算）
export function procedureState(procedure, plateId) {
  if (procedure.handler === 'us') {
    const status = db.prepare('SELECT status FROM requests WHERE id=?').get(procedure.request_id)?.status
    return status === '已完成' ? 'done' : status === '已取消' ? 'cancelled' : 'open'
  }
  return db.prepare("SELECT 1 FROM self_handled WHERE plate_asset_id=? AND kind=? AND created_at>=? AND status<>'已退回'").get(plateId, selfKinds[procedure.kind], procedure.created_at) ? 'done' : 'open'
}
export const proceduresOf = contract => db.prepare("SELECT * FROM rental_procedures WHERE contract_id=? ORDER BY CASE kind WHEN 'vehicle' THEN 0 ELSE 1 END, created_at").all(contract.id).map(row => ({ ...row, state: procedureState(row, contract.plate_asset_id) }))
export const confirmedVersion = contract => contract.agreement_version > 0 && Boolean(db.prepare('SELECT 1 FROM rental_acknowledgements WHERE contract_id=? AND version=?').get(contract.id, contract.agreement_version))
const plateLabelOf = plateId => { const plate = db.prepare('SELECT mainland_plate, local_plate, customer_id FROM plate_assets WHERE id=?').get(plateId); return { label: [plate?.mainland_plate, plate?.local_plate].filter(Boolean).join(' · ') || '牌照', customerId: plate?.customer_id } }
// 客戶新增的出租：承租人按最新版本確認後，手續未辦妥是「待換車」，全部辦妥才「生效」（客戶端顯示出租中）。
// 租期由可以使用之日起計（協議第二條第 2 款），所以生效時起租日早於今天就改為今天。
export function advanceClientRental(contract) {
  if (!contract || contract.source !== 'client' || !['草擬', '待換車'].includes(contract.status)) return contract
  // 協議重新發出後要再確認；未確認最新版本前不推進
  if (!confirmedVersion(contract)) return contract
  const { label, customerId } = plateLabelOf(contract.plate_asset_id)
  const ready = proceduresOf(contract).every(item => item.state === 'done')
  if (!ready || db.prepare("SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND status='生效' AND id<>?").get(contract.plate_asset_id, contract.id)) {
    if (contract.status === '草擬') {
      db.prepare("UPDATE rental_contracts SET status='待換車', updated_at=? WHERE id=?").run(now(), contract.id)
      notify({ tenantId: contract.tenant_id, customerId, kind: 'rental', title: `${contract.renter_name} 已確認出租協議`, body: `${label}：換車、換司機手續辦妥後就會開始出租。`, link: `/pages/rental/rental?id=${contract.id}`, dedupeKey: `rental_waiting:${contract.id}` })
    }
    return db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contract.id)
  }
  const startsOn = contract.starts_on < today() ? today() : contract.starts_on
  db.prepare("UPDATE rental_contracts SET status='生效', starts_on=?, updated_at=? WHERE id=?").run(startsOn, now(), contract.id)
  activate(db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contract.id))
  notify({ tenantId: contract.tenant_id, customerId, kind: 'rental', title: `${label} 已開始出租`, body: `承租人 ${contract.renter_name}，由 ${startsOn} 起計租金。`, link: `/pages/rental/rental?id=${contract.id}`, dedupeKey: `rental_active:${contract.id}` })
  return refreshContract(db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contract.id))
}

// 按週期生成從起租到「今天起 3 個月」的應收款；冪等（同期只一筆）。到了結束日的合約自動轉為已結束。
export function refreshContract(contract) {
  if (contract.status !== '生效') return contract
  const day = today()
  if (contract.ends_on && contract.ends_on < day) {
    db.prepare("UPDATE rental_contracts SET status='已結束', updated_at=? WHERE id=?").run(now(), contract.id)
    release(contract)
  }
  const step = cycles[contract.cycle] || 1, horizon = addMonths(day.slice(0, 7), 3)
  for (let period = contract.starts_on.slice(0, 7); period <= horizon; period = addMonths(period, step)) {
    if (contract.ends_on && period > contract.ends_on.slice(0, 7)) break
    let dueOn = `${period}-${String(contract.due_day).padStart(2, '0')}`
    if (dueOn < contract.starts_on) dueOn = contract.starts_on
    db.prepare('INSERT OR IGNORE INTO rent_invoices(id,contract_id,period,due_on,amount,created_at) VALUES (?,?,?,?,?,?)').run(id(), contract.id, period, dueOn, contract.rent_amount, now())
  }
  return db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contract.id)
}
export function refreshTenant(tenantId) {
  for (const contract of db.prepare("SELECT * FROM rental_contracts WHERE tenant_id=? AND source='client' AND status IN ('草擬','待換車')").all(tenantId)) advanceClientRental(contract)
  for (const contract of db.prepare("SELECT * FROM rental_contracts WHERE tenant_id=? AND status='生效'").all(tenantId)) refreshContract(contract)
}

export function invoiceStatus(row, day = today()) {
  if (row.voided) return '作廢'
  if (row.received_on && row.received_amount >= row.amount) return '已收'
  if (row.received_on) return '部分收'
  return row.due_on < day ? '逾期' : '待收'
}
const invoiceView = row => ({ id: row.id, contractId: row.contract_id, period: row.period, dueOn: row.due_on, amount: row.amount, receivedOn: row.received_on, receivedAmount: row.received_amount, receivedBy: row.received_by, notes: row.notes || '', status: invoiceStatus(row), hasProof: Boolean(db.prepare('SELECT 1 FROM rent_invoice_proofs WHERE invoice_id=?').get(row.id)) })
function contractView(contract) {
  const plate = db.prepare('SELECT p.mainland_plate, p.local_plate, p.customer_id, c.name customer_name, c.is_self FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').get(contract.plate_asset_id)
  const invoices = db.prepare('SELECT * FROM rent_invoices WHERE contract_id=? ORDER BY period').all(contract.id).map(invoiceView)
  const current = invoices.filter(item => item.status !== '作廢' && item.dueOn <= today()).at(-1) || invoices.find(item => item.status !== '作廢') || null
  return { id: contract.id, plateId: contract.plate_asset_id, plateLabel: [plate?.mainland_plate, plate?.local_plate].filter(Boolean).join(' · ') || '車牌待補', customerId: plate?.customer_id, customerName: plate?.customer_name, isSelf: Boolean(plate?.is_self),
    renter: { name: contract.renter_name, type: contract.renter_type, phone: contract.renter_phone || '', vehiclePlate: contract.renter_vehicle_plate || '', driver: contract.renter_driver || '' },
    startsOn: contract.starts_on, endsOn: contract.ends_on, rentAmount: contract.rent_amount, currency: contract.currency, cycle: contract.cycle, dueDay: contract.due_day, depositAmount: contract.deposit_amount,
    lessorType: contract.lessor_type, lessorCompanyId: contract.lessor_company_id, collectionMode: contract.collection_mode, feeType: contract.fee_type, feeValue: contract.fee_value,
    status: contract.status, terminatedReason: contract.terminated_reason || '', notes: contract.notes || '', currentInvoice: current, invoices, updatedAt: contract.updated_at,
    source: contract.source || 'staff', handling: contract.handling || null, agreementVersion: contract.agreement_version || 0, confirmed: confirmedVersion(contract),
    procedures: proceduresOf(contract).map(item => ({ id: item.id, kind: item.kind, name: procedureNames[item.kind], handler: item.handler, requestId: item.request_id, state: item.state })) }
}

// 驗證合約內容；creating 時要求必填。回傳錯誤訊息或 null。
function checkContract(body, plate, existing, tenantId) {
  if (!isObject(body)) return '內容無效'
  const renterName = body.renter?.name ?? body.renterName ?? existing?.renter_name
  if (typeof renterName !== 'string' || !renterName.trim()) return '請填寫承租方名稱'
  const startsOn = body.startsOn ?? existing?.starts_on, endsOn = body.endsOn === undefined ? existing?.ends_on : body.endsOn
  if (!validDate(startsOn)) return '起租日期無效'
  if (endsOn !== null && endsOn !== undefined && endsOn !== '' && (!validDate(endsOn) || endsOn < startsOn)) return '結束日期無效或早於起租日期'
  for (const [key, column] of [['rentAmount', 'rent_amount'], ['depositAmount', 'deposit_amount']]) { const amount = body[key] ?? existing?.[column] ?? 0; if (!cents(amount)) return '金額須為以「分」為單位的非負整數' }
  const currency = body.currency ?? existing?.currency ?? 'HKD'; if (!currencies.includes(currency)) return '幣種須為 HKD、RMB 或 MOP'
  const cycle = body.cycle ?? existing?.cycle ?? 'monthly'; if (!cycles[cycle]) return '收款週期無效'
  const dueDay = body.dueDay ?? existing?.due_day ?? 1; if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return '每期收款日須為 1–28'
  const mode = body.collectionMode ?? existing?.collection_mode ?? '直付'; if (!['代收', '直付'].includes(mode)) return '收款方式須為代收或直付'
  const feeType = body.feeType ?? existing?.fee_type ?? 'none', feeValue = body.feeValue ?? existing?.fee_value ?? 0
  if (!['none', 'fixed', 'percent'].includes(feeType)) return '管理費類型無效'
  if (feeType === 'fixed' && !cents(feeValue)) return '固定管理費須為以「分」為單位的非負整數'
  if (feeType === 'percent' && !(typeof feeValue === 'number' && feeValue >= 0 && feeValue <= 100)) return '管理費百分比須為 0–100'
  if (feeType !== 'none' && mode !== '代收') return '只有代收的合約可設管理費'
  const lessorType = body.lessorType ?? existing?.lessor_type ?? 'client'; if (!lessorTypes.includes(lessorType)) return '出租方類型無效'
  if (lessorType === 'agent' && plate.is_self) return '本公司自有的牌照不可設為代理出租'
  if (lessorType === 'company') {
    const company = db.prepare("SELECT id FROM companies WHERE id=? AND tenant_id=? AND customer_id=? AND jurisdiction IN ('香港','澳門')").get(body.lessorCompanyId ?? existing?.lessor_company_id ?? '', tenantId, plate.customer_id)
    if (!company) return '出租方公司須為同一客戶名下的香港／澳門公司'
  }
  for (const key of ['renterPhone', 'renterVehiclePlate', 'renterDriver', 'notes']) if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') return '承租方資料格式無效'
  if (body.renter !== undefined && !isObject(body.renter)) return '承租方資料格式無效'
  const status = body.status ?? existing?.status ?? '草擬'; if (!['草擬', '生效'].includes(status) && status !== existing?.status) return '合約狀態只可設為草擬或生效；結束請用終止'
  return null
}
function contractRow(body, existing) {
  const pick = (key, column, fallback) => body[key] !== undefined ? body[key] : existing ? existing[column] : fallback
  const renter = body.renter || {}
  return {
    renter_name: clean(renter.name ?? body.renterName ?? existing?.renter_name, 120), renter_type: ['個人', '公司'].includes(renter.type ?? body.renterType) ? (renter.type ?? body.renterType) : existing?.renter_type || '個人',
    renter_phone: clean(renter.phone ?? body.renterPhone ?? existing?.renter_phone, 30) || null, renter_vehicle_plate: clean(renter.vehiclePlate ?? body.renterVehiclePlate ?? existing?.renter_vehicle_plate, 50) || null, renter_driver: clean(renter.driver ?? body.renterDriver ?? existing?.renter_driver, 60) || null,
    starts_on: pick('startsOn', 'starts_on'), ends_on: pick('endsOn', 'ends_on', null) || null, rent_amount: pick('rentAmount', 'rent_amount', 0), currency: pick('currency', 'currency', 'HKD'), cycle: pick('cycle', 'cycle', 'monthly'), due_day: pick('dueDay', 'due_day', 1),
    deposit_amount: pick('depositAmount', 'deposit_amount', 0), lessor_type: pick('lessorType', 'lessor_type', 'client'), lessor_company_id: pick('lessorType', 'lessor_type', 'client') === 'company' ? pick('lessorCompanyId', 'lessor_company_id', null) : null,
    collection_mode: pick('collectionMode', 'collection_mode', '直付'), fee_type: pick('feeType', 'fee_type', 'none'), fee_value: pick('feeType', 'fee_type', 'none') === 'none' ? 0 : pick('feeValue', 'fee_value', 0), status: pick('status', 'status', '草擬'), notes: clean(pick('notes', 'notes', ''), 1000) || null
  }
}

// 管理總覽：本月應收、已收、逾期（客戶自理代管的牌照不列入我們的工作）
// 舊的「出租記錄」接口改為建立／結束合約，確保用途只由合約推算（管理端出租畫面改版前仍可用）
export function legacyStart(tenantId, plateId, { renterName, renterVehiclePlate, startsOn, endsOn, notes }) {
  const contractId = id()
  db.prepare("INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,renter_vehicle_plate,starts_on,ends_on,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'生效',?,?,?)")
    .run(contractId, tenantId, plateId, renterName, renterVehiclePlate || null, startsOn || today(), endsOn || null, `租金、收款方式待補充${notes ? `；${notes}` : ''}`, now(), now())
  activate(contractFor(tenantId, contractId)); refreshContract(contractFor(tenantId, contractId))
}
export function legacyEnd(tenantId, plateId, endedOn) {
  const contract = db.prepare("SELECT * FROM rental_contracts WHERE plate_asset_id=? AND tenant_id=? AND status='生效'").get(plateId, tenantId)
  if (!contract) return
  db.prepare("UPDATE rental_contracts SET status='已結束', ends_on=COALESCE(?, ends_on, ?), updated_at=? WHERE id=?").run(endedOn || null, today(), now(), contract.id)
  db.prepare('UPDATE rent_invoices SET voided=1 WHERE contract_id=? AND due_on>? AND received_on IS NULL').run(contract.id, endedOn || today())
  release(contract)
}
export const activeContract = plateId => db.prepare("SELECT id FROM rental_contracts WHERE plate_asset_id=? AND status='生效'").get(plateId) || null

// 登記一期收款（管理端收款、確認承租方上傳的憑證都用這裡）。invoice 須帶 collection_mode。回傳 { error } 或 { ok: true }。
export function receiveInvoice(tenant, invoice, body, userId) {
  if (!isObject(body) || !validDate(body.receivedOn)) return { error: '收款日期無效' }
  if (!cents(body.receivedAmount) || body.receivedAmount === 0) return { error: '收款金額須為以「分」為單位的正整數' }
  const receivedBy = body.receivedBy ?? (invoice.collection_mode === '代收' ? '代辦公司' : '客戶')
  if (!['代辦公司', '客戶'].includes(receivedBy)) return { error: '收款方須為代辦公司或客戶' }
  let proof = body.proofFile || null
  if (!proof && body.proof !== undefined && body.proof !== null) {
    if (typeof body.proof !== 'string') return { error: '轉帳憑證格式無效' }
    const data = Buffer.from(body.proof.replace(/^data:[^,]+,/, ''), 'base64')
    if (!data.length || data.length > 5 * 1024 * 1024) return { error: '轉帳憑證須小於 5 MB' }
    const mime = sniff(data); if (!mime) return { error: '轉帳憑證只接受 JPG、PNG 或 PDF' }
    proof = { data, mime }
  }
  db.prepare('UPDATE rent_invoices SET received_on=?, received_amount=?, received_by=?, confirmed_by=?, notes=? WHERE id=?').run(body.receivedOn, body.receivedAmount, receivedBy, userId, clean(body.notes, 300) || invoice.notes, invoice.id)
  // 代收租金入帳時自動產生租金管理費（冪等）
  rentCommission(tenant, contractFor(tenant, invoice.contract_id), db.prepare('SELECT * FROM rent_invoices WHERE id=?').get(invoice.id), true)
  if (proof) db.prepare('INSERT INTO rent_invoice_proofs(invoice_id,mime,data,uploaded_at) VALUES (?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, uploaded_at=excluded.uploaded_at').run(invoice.id, proof.mime, proof.data, now())
  return { ok: true }
}
export { contractFor, contractView, invoiceView }

export function rentOverview(tenantId) {
  refreshTenant(tenantId)
  const day = today(), month = day.slice(0, 7), scopes = scopeMap(tenantId)
  const rows = db.prepare("SELECT i.*, c.plate_asset_id, c.currency, c.renter_name, p.mainland_plate, p.local_plate, p.customer_id, cu.name customer_name FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id JOIN plate_assets p ON p.id=c.plate_asset_id JOIN customers cu ON cu.id=p.customer_id WHERE c.tenant_id=? AND i.voided=0").all(tenantId)
  // Rent follow-up off the customer's list counts as the client's own, so it leaves our numbers.
  const handlerOf = row => scopes.handling('plate', row.plate_asset_id, 'rent_overdue', row.customer_id)?.handler ?? 'client'
  const ours = rows.filter(row => handlerOf(row) !== 'client')
  const sum = list => Object.fromEntries(currencies.map(currency => [currency, list.filter(row => row.currency === currency).reduce((total, row) => total + row.amount, 0)]).filter(([, total]) => total))
  const thisMonth = ours.filter(row => row.due_on.slice(0, 7) === month)
  const late = row => invoiceStatus(row, day) === '逾期' || (invoiceStatus(row, day) === '部分收' && row.due_on < day)
  const overdue = ours.filter(late)
  // 到期列表照樣列出客戶自理的逾期租金（handler=client），但不計入我們的數字
  const deadlines = rows.filter(row => late(row) && scopes.handling('plate', row.plate_asset_id, 'rent_overdue', row.customer_id)).map(row => ({ ruleCode: 'rent_overdue', name: '租金逾期', method: 'rent', service: 'rental_management', item: 'rent_overdue', handler: handlerOf(row), providerName: '', ownerType: 'plate', ownerId: row.plate_asset_id, ownerLabel: [row.mainland_plate, row.local_plate].filter(Boolean).join(' · ') || '車牌待補', customerId: row.customer_id, customerName: row.customer_name,
    dueOn: row.due_on, daysLeft: Math.round((Date.parse(row.due_on) - Date.parse(day)) / 86400000), level: 'overdue', period: row.period, detail: `${row.renter_name} · ${row.currency} ${(row.amount / 100).toFixed(2)}`, invoiceId: row.id, contractId: row.contract_id }))
  return { rent: { month, due: { count: thisMonth.length, amount: sum(thisMonth) }, received: { count: thisMonth.filter(row => ['已收'].includes(invoiceStatus(row, day))).length, amount: sum(thisMonth.filter(row => invoiceStatus(row, day) === '已收')) }, overdue: { count: overdue.length, amount: sum(overdue) } }, deadlines }
}

export async function rentalRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  // 客戶：自己的出租，承租人只回傳名稱和使用車牌
  if (path === '/api/my/rentals') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    // 員工的草擬不給客戶看；客戶自己新增的出租由一開始就列出
    const contracts = db.prepare("SELECT c.* FROM rental_contracts c JOIN plate_assets p ON p.id=c.plate_asset_id WHERE p.customer_id=? AND c.tenant_id=? AND (c.status<>'草擬' OR c.source='client') ORDER BY c.created_at DESC").all(user.customer_id, tenant).map(advanceClientRental).map(refreshContract)
    return json(res, 200, contracts.map(contract => { const view = contractView(contract); return { id: view.id, plateId: view.plateId, plateLabel: view.plateLabel, user: { name: view.renter.name, vehiclePlate: view.renter.vehiclePlate }, startsOn: view.startsOn, endsOn: view.endsOn, amount: view.rentAmount, currency: view.currency, cycle: view.cycle, collectionMode: view.collectionMode, status: view.status, statusWord: statusWord(contract), source: view.source, confirmed: view.confirmed, sent: view.agreementVersion > 0, invoices: view.invoices.filter(item => item.status !== '作廢').slice(-6).map(({ id: invoiceId, period, dueOn, amount, status, receivedOn }) => ({ id: invoiceId, period, dueOn, amount, status, receivedOn })) } })), true
  }
  const contractMatch = path.match(/^\/api\/rental-contracts(?:\/([^/]+)(\/terminate)?)?$/)
  const invoiceMatch = path.match(/^\/api\/rent-invoices(?:\/([^/]+)\/(receive|unreceive|proof))?$/)
  if (!contractMatch && !invoiceMatch) return false
  if (user.role !== 'admin') return fail(res, 403, '出租與租金只限管理者'), true

  if (contractMatch && !contractMatch[1]) {
    if (method === 'GET') {
      refreshTenant(tenant)
      const { plateId, customerId, status } = Object.fromEntries(url.searchParams)
      const rows = db.prepare(`SELECT c.* FROM rental_contracts c JOIN plate_assets p ON p.id=c.plate_asset_id WHERE c.tenant_id=? ${plateId ? 'AND c.plate_asset_id=?' : ''} ${customerId ? 'AND p.customer_id=?' : ''} ${status ? 'AND c.status=?' : ''} ORDER BY c.status='生效' DESC, c.starts_on DESC`).all(tenant, ...[plateId, customerId, status].filter(Boolean))
      return json(res, 200, rows.map(contractView)), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body)) return fail(res, 400, '內容無效'), true
    const plate = plateOf(tenant, body.plateId)
    if (!plate) return fail(res, 404, '牌照不存在'), true
    const problem = checkContract(body, plate, null, tenant)
    if (problem) return fail(res, 400, problem), true
    const row = contractRow(body, null)
    if (row.status === '生效' && db.prepare("SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND status='生效'").get(plate.id)) return fail(res, 409, '這個牌照已有生效中的合約'), true
    const contractId = id()
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,${Object.keys(row).join(',')},created_at,updated_at) VALUES (?,?,?,${Object.keys(row).map(() => '?').join(',')},?,?)`).run(contractId, tenant, plate.id, ...Object.values(row), now(), now())
      if (row.status === '生效') { activate(contractFor(tenant, contractId)); refreshContract(contractFor(tenant, contractId)) }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 201, contractView(contractFor(tenant, contractId))), true
  }
  if (contractMatch) {
    const contract = contractFor(tenant, contractMatch[1])
    if (!contract) return fail(res, 404, '合約不存在'), true
    if (contractMatch[2]) {
      if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
      const body = await parseBody(req)
      if (contract.status !== '生效') return fail(res, 409, '只有生效中的合約可以終止'), true
      if (!isObject(body) || !validDate(body.endedOn) || body.endedOn < contract.starts_on) return fail(res, 400, '終止日期無效'), true
      if (!clean(body.reason, 300)) return fail(res, 400, '請填寫終止原因'), true
      db.exec('BEGIN')
      try {
        db.prepare("UPDATE rental_contracts SET status='已終止', ends_on=?, terminated_reason=?, updated_at=? WHERE id=?").run(body.endedOn, clean(body.reason, 300), now(), contract.id)
        // 終止日之後、未收款的應收款作廢（保留記錄）
        db.prepare('UPDATE rent_invoices SET voided=1 WHERE contract_id=? AND due_on>? AND received_on IS NULL').run(contract.id, body.endedOn)
        release(contract)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, contractView(contractFor(tenant, contract.id))), true
    }
    if (method === 'GET') return json(res, 200, contractView(refreshContract(contract))), true
    if (method !== 'PATCH') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!isObject(body)) return fail(res, 400, '內容無效'), true
    if (['已結束', '已終止'].includes(contract.status)) return fail(res, 409, '已結束的合約不可修改'), true
    if (body.plateId !== undefined && body.plateId !== contract.plate_asset_id) return fail(res, 400, '合約不可搬到其他牌照'), true
    if (contract.status === '生效' && body.status === '草擬') return fail(res, 400, '生效中的合約不可改回草擬，請用終止'), true
    const plate = plateOf(tenant, contract.plate_asset_id)
    const problem = checkContract(body, plate, contract, tenant)
    if (problem) return fail(res, 400, problem), true
    const row = contractRow(body, contract)
    if (row.status === '生效' && contract.status !== '生效' && db.prepare("SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND status='生效' AND id<>?").get(contract.plate_asset_id, contract.id)) return fail(res, 409, '這個牌照已有生效中的合約'), true
    db.exec('BEGIN')
    try {
      db.prepare(`UPDATE rental_contracts SET ${Object.keys(row).map(key => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...Object.values(row), now(), contract.id)
      // 金額改動只影響尚未到期、未收款的應收款
      if (row.rent_amount !== contract.rent_amount) db.prepare('UPDATE rent_invoices SET amount=? WHERE contract_id=? AND due_on>=? AND received_on IS NULL AND voided=0').run(row.rent_amount, contract.id, today())
      if (row.status === '生效' && contract.status !== '生效') activate(contractFor(tenant, contract.id))
      refreshContract(contractFor(tenant, contract.id))
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, contractView(contractFor(tenant, contract.id))), true
  }

  // 應收款
  if (!invoiceMatch[1]) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    refreshTenant(tenant)
    const contractId = url.searchParams.get('contractId'), status = url.searchParams.get('status')
    if (contractId && !contractFor(tenant, contractId)) return fail(res, 404, '合約不存在'), true
    const rows = db.prepare(`SELECT i.* FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id WHERE c.tenant_id=? ${contractId ? 'AND i.contract_id=?' : ''} ORDER BY i.due_on`).all(tenant, ...(contractId ? [contractId] : [])).map(invoiceView)
    return json(res, 200, status ? rows.filter(item => item.status === status) : rows), true
  }
  const invoice = db.prepare('SELECT i.*, c.tenant_id, c.collection_mode FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id WHERE i.id=? AND c.tenant_id=?').get(invoiceMatch[1], tenant)
  if (!invoice) return fail(res, 404, '應收款不存在'), true
  if (invoiceMatch[2] === 'proof') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const proof = db.prepare('SELECT * FROM rent_invoice_proofs WHERE invoice_id=?').get(invoice.id)
    if (!proof) return fail(res, 404, '沒有轉帳憑證'), true
    res.writeHead(200, { 'content-type': proof.mime }); res.end(proof.data); return true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (invoice.voided) return fail(res, 409, '已作廢的應收款不可操作'), true
  if (invoiceMatch[2] === 'unreceive') {
    if (!invoice.received_on) return fail(res, 409, '這期尚未登記收款'), true
    db.prepare('UPDATE rent_invoices SET received_on=NULL, received_amount=NULL, received_by=NULL, confirmed_by=NULL WHERE id=?').run(invoice.id)
    rentCommission(tenant, contractFor(tenant, invoice.contract_id), invoice, false)
    db.prepare('DELETE FROM rent_invoice_proofs WHERE invoice_id=?').run(invoice.id)
    return json(res, 200, invoiceView(db.prepare('SELECT * FROM rent_invoices WHERE id=?').get(invoice.id))), true
  }
  const body = await parseBody(req)
  const result = receiveInvoice(tenant, invoice, body, user.id)
  if (result.error) return fail(res, 400, result.error), true
  return json(res, 200, invoiceView(db.prepare('SELECT * FROM rent_invoices WHERE id=?').get(invoice.id))), true
}
