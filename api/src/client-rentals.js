import { db, id, now } from './db.js'
import { services } from './catalog.js'
import { selfManaged } from './entrustment.js'
import { priceFor } from './pricing.js'
import { sniff } from './client-portal.js'
import { createClientRequest } from './request-tasks.js'
import { advanceClientRental, confirmedVersion, contractFor, contractView, currencies, procedureNames, proceduresOf, refreshContract, saveSignature, signatureImage, signatureOf, statusWord } from './rentals.js'
import { agreementTemplate, fillTemplate, issueRenterLink } from './renter-portal.js'

// 客戶自行新增出租（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項，協議見 docs/tasks/rental-agreement-draft.md）。
// 托管客戶可交給我們代理和代收；自管客戶只可自行負責、租客直接付款（第 11 步）。已有出租在處理中或出租中、已標記不再續期的牌照不能新增。換車、換司機每項預設交給我們辦（開工單），
// 也可自行辦理（辦好後在「有變動？」回報）。交給我們代理的，另開「出租代理」工單由員工接手協議和後續。員工不用批准。
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const cents = value => Number.isInteger(value) && value >= 0 && value <= 1e12
const sameCar = (a, b) => String(a || '').replace(/\s/g, '').toUpperCase() === String(b || '').replace(/\s/g, '').toUpperCase()
const openStatuses = ['草擬', '待換車', '生效']
const cycles = ['monthly', 'quarterly', 'yearly']

const plateLabel = plate => [plate.mainland_plate, plate.local_plate].filter(Boolean).join(' · ') || '牌照'
const myPlate = (customer, plateId) => typeof plateId === 'string' ? db.prepare("SELECT * FROM plate_assets WHERE id=? AND customer_id=? AND card_number IS NOT NULL AND TRIM(card_number)<>''").get(plateId, customer.id) || null : null
const myContract = (customer, contractId) => typeof contractId === 'string' ? db.prepare("SELECT c.* FROM rental_contracts c JOIN plate_assets p ON p.id=c.plate_asset_id WHERE c.id=? AND c.tenant_id=? AND p.customer_id=? AND c.source='client'").get(contractId, customer.tenant_id, customer.id) || null : null
const currentCar = plate => (plate.vehicle_id && db.prepare('SELECT plate FROM vehicles WHERE id=?').get(plate.vehicle_id)?.plate) || plate.local_plate || ''
const registeredDrivers = plate => db.prepare('SELECT d.id, d.name FROM plate_drivers pd JOIN drivers d ON d.id=pd.driver_id WHERE pd.plate_asset_id=? ORDER BY CASE pd.role WHEN \'主\' THEN 0 ELSE 1 END, pd.sort').all(plate.id)
// 能以公司名義出租的，只有持有這個牌照的公司組裏的香港／澳門公司（持牌公司），不是客戶名下任何一間公司
const lessorCompanies = (customer, plate) => plate.group_id ? db.prepare("SELECT id, name, jurisdiction FROM companies WHERE customer_id=? AND tenant_id=? AND group_id=? AND jurisdiction IN ('香港','澳門') AND COALESCE(status,'存續')<>'已註銷' ORDER BY jurisdiction, name").all(customer.id, customer.tenant_id, plate.group_id) : []

// 為甚麼這個牌照不能新增出租；null＝可以
function blockReason(customer, plate) {
  if (customer.is_self) return '自行新增出租暫時只開放給委託我們代辦的客戶'
  if (plate.stopped_on) return '這個牌照已標記不再續期，不能新增出租'
  if (plate.usage_status === '出租中' || db.prepare(`SELECT 1 FROM rental_contracts WHERE plate_asset_id=? AND status IN (${openStatuses.map(() => '?').join(',')})`).get(plate.id, ...openStatuses)) return '這個牌照已有出租在處理中或出租中'
  return null
}
// 交給我們辦的手續：委託範圍內寫「已包含在你的委託內」，否則參考價或由顧問報價（與委託我們辦一致）
function priceText(customer, code, route) {
  const price = priceFor(customer.tenant_id, customer.id, `job:${code}`, route)
  if (price?.billing === 'annual') return '已包含在你的委託內'
  if (price?.billing === 'free') return '不另收費'
  if (price?.billing === 'per_time' && price.amount) return `參考價：由 ${price.currency} ${(price.amount / 100).toLocaleString('en-US')} 起，實價由顧問確認`
  return '由顧問報價'
}
const serviceCode = { vehicle: 'vehicle_change', driver: 'driver_change' }

const requestWord = status => ({ 新要求: '已收到', 待開始: '已收到', 進行中: '辦理中', 待收件: '辦理中', 待客戶提供: '需要你提供資料', 待客戶配合: '需要你提供資料', 已完成: '已辦妥', 已取消: '已取消' }[status] || status || '')
function detailView(customer, contract) {
  const view = contractView(contract)
  const ack = db.prepare('SELECT name, acknowledged_at FROM rental_acknowledgements WHERE contract_id=? AND version=? ORDER BY acknowledged_at DESC').get(contract.id, contract.agreement_version)
  const lessorSign = contract.agreement_version ? signatureOf(contract, 'lessor') : null, renterSign = contract.agreement_version ? signatureOf(contract, 'renter') : null
  const link = db.prepare('SELECT expires_at FROM rental_links WHERE contract_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC').get(contract.id, now())
  const plate = db.prepare('SELECT * FROM plate_assets WHERE id=?').get(contract.plate_asset_id)
  return {
    id: contract.id, plateId: contract.plate_asset_id, plateLabel: view.plateLabel, status: contract.status, statusWord: statusWord(contract), handling: contract.handling,
    renter: { name: contract.renter_name, phone: contract.renter_phone || '', idNo: contract.renter_id_no || '', vehiclePlate: contract.renter_vehicle_plate || '', driver: contract.renter_driver || '' },
    lessor: contract.lessor_type === 'company' ? db.prepare('SELECT name FROM companies WHERE id=?').get(contract.lessor_company_id)?.name || '' : customer.name,
    startsOn: contract.starts_on, endsOn: contract.ends_on, rentAmount: contract.rent_amount, depositAmount: contract.deposit_amount, currency: contract.currency, cycle: contract.cycle, dueDay: contract.due_day, collectionMode: contract.collection_mode,
    agreement: { body: contract.agreement_body || '', version: contract.agreement_version, sentAt: contract.agreement_sent_at, changed: contract.agreement_version > 0 && contract.agreement_body !== contract.agreement_sent_body, confirmed: confirmedVersion(contract), confirmedBy: ack?.name || '', confirmedAt: ack?.acknowledged_at || null, linkActive: Boolean(link), linkExpiresAt: link?.expires_at || null,
      lessorSigned: lessorSign ? { name: lessorSign.signer_name, at: lessorSign.signed_at } : null, renterSigned: renterSign ? { name: renterSign.signer_name, at: renterSign.signed_at } : null },
    procedures: proceduresOf(contract).map(item => {
      const request = item.request_id ? db.prepare('SELECT status FROM requests WHERE id=?').get(item.request_id) : null
      return { id: item.id, kind: item.kind, name: procedureNames[item.kind], handler: item.handler, state: item.state, requestId: item.request_id, requestStatus: request ? requestWord(request.status) : '', price: item.handler === 'us' ? priceText(customer, serviceCode[item.kind], plate.route) : '' }
    }),
    signed: Boolean(db.prepare('SELECT 1 FROM rental_signed_files WHERE contract_id=?').get(contract.id)),
    invoices: view.invoices.filter(item => item.status !== '作廢').slice(-6).map(({ id: invoiceId, period, dueOn, amount, status, receivedOn }) => ({ id: invoiceId, period, dueOn, amount, status, receivedOn })),
    canCancel: ['草擬', '待換車'].includes(contract.status), canSend: contract.handling === 'self' && openStatuses.includes(contract.status)
  }
}

// 新增出租的內容檢查；回傳 { error } 或整理好的資料
function checkNew(customer, plate, body) {
  if (!isObject(body)) return { error: '內容無效' }
  const renter = isObject(body.renter) ? body.renter : null
  if (!renter || !clean(renter.name)) return { error: '請填寫承租人姓名' }
  const phone = clean(renter.phone, 30), digits = phone.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15 || /[^\d\s+()-]/.test(phone)) return { error: '請填寫承租人的聯絡電話，承租人要用電話最後 4 位打開協議' }
  if (renter.idNo !== undefined && renter.idNo !== null && typeof renter.idNo !== 'string') return { error: '證件號碼格式無效' }
  if (!['client', 'company'].includes(body.lessorType)) return { error: '請選擇以誰的名義出租' }
  const company = body.lessorType === 'company' ? lessorCompanies(customer, plate).find(item => item.id === body.lessorCompanyId) : null
  if (body.lessorType === 'company' && !company) return { error: '只可以用持有這個牌照的香港或澳門公司名義出租' }
  if (typeof body.useCurrentVehicle !== 'boolean') return { error: '請選擇承租人用哪一部車' }
  const car = currentCar(plate)
  const vehiclePlate = body.useCurrentVehicle ? car : clean(body.renterVehiclePlate, 20)
  if (!vehiclePlate) return { error: body.useCurrentVehicle ? '這個牌照還沒有登記車輛，請填寫承租人的車牌' : '請填寫承租人的車牌' }
  const driverIds = body.driverIds === undefined ? [] : body.driverIds
  if (!Array.isArray(driverIds) || driverIds.length > 10 || driverIds.some(item => typeof item !== 'string')) return { error: '司機資料格式無效' }
  const registered = registeredDrivers(plate)
  if (driverIds.some(item => !registered.some(driver => driver.id === item))) return { error: '所選司機不是這個牌照的登記司機' }
  if (body.newDriverName !== undefined && body.newDriverName !== null && typeof body.newDriverName !== 'string') return { error: '司機資料格式無效' }
  const newDriver = clean(body.newDriverName, 60)
  if (!driverIds.length && !newDriver) return { error: '請選擇或填寫承租人的司機' }
  if (!validDate(body.startsOn)) return { error: '起租日期無效' }
  if (body.endsOn !== undefined && body.endsOn !== null && body.endsOn !== '' && (!validDate(body.endsOn) || body.endsOn < body.startsOn)) return { error: '結束日期無效或早於起租日期' }
  if (!cents(body.rentAmount) || body.rentAmount === 0) return { error: '請填寫租金' }
  if (body.depositAmount !== undefined && !cents(body.depositAmount)) return { error: '押金金額無效' }
  const currency = body.currency ?? (plate.route === '粵澳' ? 'MOP' : 'HKD'); if (!currencies.includes(currency)) return { error: '幣種須為 HKD、RMB 或 MOP' }
  const cycle = body.cycle ?? 'monthly'; if (!cycles.includes(cycle)) return { error: '收租週期無效' }
  const dueDay = body.dueDay ?? 1; if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return { error: '每期收租日須為 1–28' }
  if (!['agent', 'self'].includes(body.handling)) return { error: '請選擇交給我們代理或自行負責' }
  // 自管客戶自己記出租（docs/tasks/self-managed-fixes-plan.md 第 11 步）：只可自行負責、租客直接付給你；代理和代收是托管服務，可按「交給我們代收」委託我們
  if (selfManaged(customer) && body.handling !== 'self') return { error: '交給我們代理或代收只限托管客戶；可在出租區按「交給我們代收」委託我們' }
  const collection = body.collectionMode ?? '直付'; if (!['直付', '代收'].includes(collection)) return { error: '收租方式無效' }
  if (collection === '代收' && body.handling !== 'agent') return { error: '只有交給我們代理的出租可以由我們代收租金' }
  // 要辦的手續：換了車才要換車；有新司機才要換司機。每項預設交給我們辦
  const needed = [...(sameCar(vehiclePlate, car) ? [] : ['vehicle']), ...(newDriver ? ['driver'] : [])]
  const handlers = isObject(body.procedures) ? body.procedures : {}
  for (const kind of needed) if (handlers[kind] !== undefined && !['us', 'client'].includes(handlers[kind])) return { error: `${procedureNames[kind]}請選擇交給我們辦或自行辦理` }
  return {
    company, needed: needed.map(kind => ({ kind, handler: handlers[kind] || 'us' })),
    row: {
      renter_name: clean(renter.name), renter_type: renter.type === '公司' ? '公司' : '個人', renter_phone: phone, renter_id_no: clean(renter.idNo, 30) || null, renter_vehicle_plate: vehiclePlate,
      renter_driver: [...registered.filter(driver => driverIds.includes(driver.id)).map(driver => driver.name), ...(newDriver ? [newDriver] : [])].join('、'),
      starts_on: body.startsOn, ends_on: body.endsOn || null, rent_amount: body.rentAmount, deposit_amount: body.depositAmount ?? 0, currency, cycle, due_day: dueDay,
      lessor_type: body.lessorType, lessor_company_id: company?.id || null, collection_mode: collection, handling: body.handling
    }
  }
}

export async function clientRentalRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method
  const optionsMatch = path.match(/^\/api\/my\/plates\/([^/]+)\/(rental-options|rentals)$/)
  const rentalMatch = path.match(/^\/api\/my\/rentals\/([^/]+)(?:\/(agreement|send|cancel|signed|signature-lessor|signature-renter))?$/)
  const panelMatch = path.match(/^\/api\/client-rentals(?:\/([^/]+)\/seen)?$/)
  if (!optionsMatch && !rentalMatch && !panelMatch) return false

  // 後台「客戶新增出租」：員工不用批准，只是知道有這件事；按「知道了」後不再列出
  if (panelMatch) {
    if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
    if (!panelMatch[1]) {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const rows = db.prepare("SELECT c.* FROM rental_contracts c WHERE c.tenant_id=? AND c.source='client' AND c.staff_seen_at IS NULL ORDER BY c.created_at DESC").all(user.tenant_id).map(advanceClientRental)
      return json(res, 200, rows.map(contract => { const view = contractView(contract); return { id: contract.id, plateId: view.plateId, plateLabel: view.plateLabel, customerId: view.customerId, customerName: view.customerName, renterName: contract.renter_name, startsOn: contract.starts_on, endsOn: contract.ends_on, handling: contract.handling, status: contract.status, statusWord: statusWord(contract), collectionMode: contract.collection_mode, createdAt: contract.created_at, procedures: view.procedures } })), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const contract = contractFor(user.tenant_id, panelMatch[1])
    if (!contract || contract.source !== 'client') return fail(res, 404, '出租不存在'), true
    db.prepare('UPDATE rental_contracts SET staff_seen_at=COALESCE(staff_seen_at, ?) WHERE id=?').run(now(), contract.id)
    return json(res, 200, { ok: true }), true
  }

  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(user.customer_id, user.tenant_id)
  if (!customer) return fail(res, 404, '客戶不存在'), true

  if (optionsMatch) {
    const plate = myPlate(customer, optionsMatch[1])
    if (!plate) return fail(res, 404, '牌照不存在'), true
    if (optionsMatch[2] === 'rental-options') {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const reason = blockReason(customer, plate)
      return json(res, 200, { allowed: !reason, reason: reason || '', plateLabel: plateLabel(plate), route: plate.route, currency: plate.route === '粵澳' ? 'MOP' : 'HKD',
        lessors: [{ type: 'client', id: '', label: customer.name, hint: '以你本人名義' }, ...lessorCompanies(customer, plate).map(item => ({ type: 'company', id: item.id, label: item.name, hint: `${item.jurisdiction}公司` }))],
        currentVehicle: currentCar(plate), drivers: registeredDrivers(plate), prices: { vehicle: priceText(customer, 'vehicle_change', plate.route), driver: priceText(customer, 'driver_change', plate.route) } }), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const reason = blockReason(customer, plate)
    if (reason) return fail(res, 409, reason), true
    const checked = checkNew(customer, plate, await parseBody(req))
    if (checked.error) return fail(res, 400, checked.error), true
    const contractId = id(), label = plateLabel(plate), row = { ...checked.row, status: '草擬', source: 'client', created_by: user.id }
    db.exec('BEGIN IMMEDIATE')
    try {
      // 同一時間另一個請求已新增（交易內再查一次）
      if (blockReason(customer, plate)) throw Object.assign(new Error('這個牌照已有出租在處理中或出租中'), { status: 409 })
      db.prepare(`INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,${Object.keys(row).join(',')},created_at,updated_at) VALUES (?,?,?,${Object.keys(row).map(() => '?').join(',')},?,?)`).run(contractId, customer.tenant_id, plate.id, ...Object.values(row), now(), now())
      const describe = `承租人 ${row.renter_name}；使用車輛 ${row.renter_vehicle_plate}；司機 ${row.renter_driver}；${row.starts_on} 起${row.ends_on ? ` 至 ${row.ends_on}` : ''}。`
      for (const item of checked.needed) {
        const service = services.find(entry => entry.code === serviceCode[item.kind])
        const requestId = item.handler === 'us' ? createClientRequest({ customerId: customer.id, service, route: plate.route, title: `出租${procedureNames[item.kind]}：${label}`, description: `客戶新增出租，${procedureNames[item.kind]}交給我們辦。${describe}`, plateAssetId: plate.id, actorId: user.id }) : null
        db.prepare('INSERT INTO rental_procedures(id,contract_id,kind,handler,request_id,detail,created_at) VALUES (?,?,?,?,?,?,?)').run(id(), contractId, item.kind, item.handler, requestId, item.kind === 'vehicle' ? row.renter_vehicle_plate : row.renter_driver, now())
      }
      if (row.handling === 'agent') createClientRequest({ customerId: customer.id, service: services.find(entry => entry.code === 'other'), route: plate.route, title: `出租代理：${label}`, description: `客戶新增出租，交給我們代理協議和後續${row.collection_mode === '代收' ? '，由我們代收租金' : ''}。${describe}`, plateAssetId: plate.id, actorId: user.id })
      const contract = contractFor(customer.tenant_id, contractId)
      db.prepare('UPDATE rental_contracts SET agreement_body=? WHERE id=?').run(fillTemplate(agreementTemplate, contract), contractId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); if (error.status) return fail(res, error.status, error.message), true; throw error }
    return json(res, 201, detailView(customer, contractFor(customer.tenant_id, contractId))), true
  }

  const contract = myContract(customer, rentalMatch[1])
  if (!contract) return fail(res, 404, '出租不存在'), true
  const action = rentalMatch[2]
  if (!action) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, detailView(customer, refreshContract(advanceClientRental(contract)))), true
  }
  // 這一版協議的簽名相片
  if (action?.startsWith('signature-')) {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const sign = contract.agreement_version ? signatureOf(contract, action.slice(10)) : null
    if (!sign) return fail(res, 404, '還沒有簽名'), true
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(sign.data); return true
  }
  if (action === 'signed' && method === 'GET') {
    const file = db.prepare('SELECT * FROM rental_signed_files WHERE contract_id=?').get(contract.id)
    if (!file) return fail(res, 404, '還沒有上傳簽署本'), true
    res.writeHead(200, { 'content-type': file.mime, 'cache-control': 'no-store' }); res.end(file.data); return true
  }
  const body = await parseBody(req)
  if (!['PUT', 'POST'].includes(method) || (action === 'agreement') !== (method === 'PUT')) return fail(res, 405, '不支援此操作'), true
  if (!openStatuses.includes(contract.status)) return fail(res, 409, '這次出租已結束或已取消'), true
  if (action === 'cancel') {
    if (!['草擬', '待換車'].includes(contract.status)) return fail(res, 409, `出租已開始，提早結束${selfManaged(customer) ? '請在「我的 › 聯絡我們」發訊息給我們' : '請聯絡你的顧問'}`), true
    db.prepare("UPDATE rental_contracts SET status='已終止', terminated_reason='客戶取消', staff_seen_at=NULL, updated_at=? WHERE id=?").run(now(), contract.id)
    db.prepare('UPDATE rental_links SET revoked_at=? WHERE contract_id=? AND revoked_at IS NULL').run(now(), contract.id)
    return json(res, 200, detailView(customer, contractFor(customer.tenant_id, contract.id))), true
  }
  if (action === 'signed') {
    if (!isObject(body) || typeof body.data !== 'string') return fail(res, 400, '請選擇簽署本的相片或 PDF'), true
    const data = Buffer.from(body.data.replace(/^data:[^,]+,/, ''), 'base64')
    if (!data.length || data.length > 8 * 1024 * 1024) return fail(res, 400, '檔案須小於 8 MB'), true
    const mime = sniff(data); if (!mime) return fail(res, 400, '只接受 JPG、PNG 或 PDF'), true
    db.prepare('INSERT INTO rental_signed_files(contract_id,mime,data,uploaded_at) VALUES (?,?,?,?) ON CONFLICT(contract_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, uploaded_at=excluded.uploaded_at').run(contract.id, mime, data, now())
    return json(res, 200, detailView(customer, contract)), true
  }
  // 交給我們代理的出租，協議由顧問處理
  if (contract.handling !== 'self') return fail(res, 409, '這次出租已交給我們代理，協議由顧問處理'), true
  if (action === 'agreement') {
    if (!isObject(body) || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 20000) return fail(res, 400, '協議內容不可為空，且須少於 20000 字'), true
    db.prepare('UPDATE rental_contracts SET agreement_body=?, updated_at=? WHERE id=?').run(body.body.trim(), now(), contract.id)
    return json(res, 200, detailView(customer, contractFor(customer.tenant_id, contract.id))), true
  }
  // 發給承租人：協議有改動（或第一次發）就鎖定為新版本，出租人要先手寫簽名，承租人要重新確認並簽名；
  // 沒有改動只是重發連結，沿用這一版的簽名。每次都產生新連結，舊連結作廢
  if (!contract.agreement_body?.trim()) return fail(res, 400, '協議內容不可為空'), true
  const newVersion = !contract.agreement_version || contract.agreement_body !== contract.agreement_sent_body
  const image = body?.signature === undefined ? null : signatureImage(body.signature)
  if (body?.signature !== undefined && !image) return fail(res, 400, '簽名無效，請重新簽名'), true
  if (!image && (newVersion || !signatureOf(contract, 'lessor'))) return fail(res, 400, '請先在下面簽名，才可以發給承租人'), true
  db.exec('BEGIN IMMEDIATE')
  try {
    if (newVersion) db.prepare('UPDATE rental_contracts SET agreement_sent_body=agreement_body, agreement_version=agreement_version+1, agreement_sent_at=?, updated_at=? WHERE id=?').run(now(), now(), contract.id)
    if (image) saveSignature(contractFor(customer.tenant_id, contract.id), 'lessor', user.name, image, String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0])
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  const fresh = contractFor(customer.tenant_id, contract.id)
  const link = issueRenterLink(fresh, user.id, req, 90)
  return json(res, 200, { ...detailView(customer, fresh), link: { url: link.url, expiresAt: link.expiresAt } }), true
}

