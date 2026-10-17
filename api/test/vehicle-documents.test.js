import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { extractVehicleFields, merge, parseDates, parseHongKongPlate, parseMacauPlate, parseMainlandPlate, parseVin, parseYear, recognizeVehicleDocument } from '../src/vehicle-ocr.js'

// 車輛證件（內地行駛證、香港車輛牌照與牌簿、澳門車輛登記文件）與澳門車輛規則。進程內請求，不開連接埠。
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'vehicle-docs-'))
  process.env.DB_PATH = join(state.dir, 'api.db'); process.env.DEMO_SEED = '0'; process.env.API_NO_LISTEN = '1'
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const key of ['customer', 'second', 'foreign']) state[key] = randomUUID()
  for (const [customerId, tenant] of [[state.customer, 'default'], [state.second, 'default'], [state.foreign, 'other']]) db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId.slice(0, 4)}`, '個人', tenant)
  seedRules('default'); seedRules('other')
  state.self = db.prepare("SELECT id FROM customers WHERE tenant_id='default' AND is_self=1").get().id
  for (const [token, role, customerId, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.customer, 'default'], ['second-client', 'customer', state.second, 'default'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customerId, tenant)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  state.server = (await import('../src/server.js')).server
  state.images = {
    cn: await documentImage(['中华人民共和国机动车行驶证', '号牌号码 粤Z76L2港    车辆类型 小型普通客车', '所有人 曲坤有限公司', '品牌型号 丰田牌GTH6490', '车辆识别代号 JTMHV05J804012345', '注册日期 2019-05-10    发证日期 2023-06-01']),
    hk: await documentImage(['車輛牌照 VEHICLE LICENCE', '登記號碼 Registration Mark AB1234', '底盤號碼 Chassis No. JTMHV05J804012345', '有效期至 Expiry Date 15/03/2027']),
    mo: await documentImage(['車輛登記 REGISTO DE VEICULO', '車牌號碼 Matricula MX-12-34', '牌子 Marca TOYOTA', '型號 Modelo ALPHARD', '車架號碼 Quadro JTMHV05J804012345', '製造年份 Ano de fabrico 2020'])
  }
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, headers: this.headers, raw: data, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
async function documentImage(lines) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${120 + lines.length * 90}"><rect width="100%" height="100%" fill="#f7f7f2"/>${lines.map((line, index) => `<text x="60" y="${110 + index * 90}" font-family="Arial, Noto Sans CJK SC, Noto Sans CJK TC, PingFang SC, sans-serif" font-size="40" fill="#111">${escape(line)}</text>`).join('')}</svg>`
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')}`
}
// 1×1 圖片：用來測試不需辨識的保險單、權限與驗證
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
function makeVehicle({ customer = state.customer, route = '粵港', origin = route === '粵澳' ? '澳門' : '香港', plate = 'AB1234', vin = null, mainlandPlate = null } = {}) {
  const vehicleId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,vin) VALUES (?,?,?,?,?,?,?)').run(vehicleId, customer, route, origin, '私家車', plate, vin)
  const plateId = randomUUID()
  state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,card_number,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(plateId, customer, route, mainlandPlate, plate, vehicleId, '已上牌', 'C-' + plateId.slice(0, 8), '{}', now, now)
  return { vehicleId, plateId }
}
const vehicleRow = id => state.db.prepare('SELECT * FROM vehicles WHERE id=?').get(id)
const tracked = (id, code) => state.db.prepare("SELECT expires_on FROM tracked_items WHERE owner_type='vehicle' AND owner_id=? AND code=?").get(id, code)?.expires_on || null
const setTracked = (id, code, value) => state.db.prepare("INSERT OR REPLACE INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_by,updated_at) VALUES ('default','vehicle',?,?,?,'',NULL,?)").run(id, code, value, new Date().toISOString())
const upload = (vehicleId, kind, image, token = 'admin') => request(`/vehicles/${vehicleId}/documents/${kind}`, 'POST', { image }, token)
const lines = list => list.map(text => ({ text, confidence: 92 }))

// ── 欄位驗證與正規化 ──
test('內地車牌：OCR 的「粤」改為「粵」，格式不符留空', () => {
  assert.equal(parseMainlandPlate('粤Z76L2港'), '粵Z76L2港')
  assert.equal(parseMainlandPlate('锣77RA!D港'), null)
  assert.equal(parseMainlandPlate('粵Z76L2'), null)
})
test('香港車牌只接受標準登記號碼', () => {
  assert.equal(parseHongKongPlate('AB 1234'), 'AB1234')
  assert.equal(parseHongKongPlate('REGISTRATIONMARK'), null)
  assert.equal(parseHongKongPlate('AB12345'), null)
})
test('澳門車牌正規化為 MX-12-34', () => {
  assert.equal(parseMacauPlate('MX1234'), 'MX-12-34')
  assert.equal(parseMacauPlate('M-12-34'), 'M-12-34')
  assert.equal(parseMacauPlate('AB1234'), null)
})
test('車架號碼：17 位 VIN 改正 O、I，日本車架編號照收，亂碼留空', () => {
  assert.equal(String(parseVin('JTMHVO5J8O4O12345')), 'JTMHV05J804012345')
  assert.equal(parseVin('AGH30-0123456'), 'AGH30-0123456')
  assert.equal(parseVin('全人二DO0OD24人等'), null)
  assert.equal(parseVin('12345678901234567'), null)
})
test('日期：年月日與日月年都讀，不合法日期不收', () => {
  assert.deepEqual(parseDates('注册日期2019-05-10发证日期2023年6月1日'), ['2019-05-10', '2023-06-01'])
  assert.deepEqual(parseDates('15/03/2027'), ['2027-03-15'])
  assert.deepEqual(parseDates('31/02/2027 2027-13-01'), [])
})
test('製造年份只收合理年份', () => {
  assert.equal(parseYear('Year of Manufacture 2019'), '2019')
  assert.equal(parseYear('1899'), null)
  assert.equal(parseYear('2999'), null)
})

// ── 按標籤讀欄位 ──
test('內地行駛證：同一行兩個日期分別歸入註冊日期與發證日期', () => {
  const { fields, fieldStatus } = extractVehicleFields('cn_licence', lines(['号牌号码 粤Z76L2港  车辆类型 小型普通客车', '品牌型号 丰田牌GTH6490', '车辆识别代号 JTMHV05J804012345', '注册日期 2019-05-10 发证日期 2023-06-01']))
  assert.deepEqual(fields, { plate: '粵Z76L2港', vehicleType: '小型普通客车', brandModel: '丰田牌GTH6490', vin: 'JTMHV05J804012345', registeredOn: '2019-05-10', issuedOn: '2023-06-01' })
  assert.equal(fieldStatus.vin.status, 'ok'); assert.equal(fieldStatus.vehicleType.status, 'uncertain')
})
test('香港車輛牌照：英文副標不會被當成車牌，有效期取到期日', () => {
  const { fields } = extractVehicleFields('hk_licence', lines(['登記號碼 Registration Mark AB1234', '底盤號碼 Chassis No. AGH30-0123456', '有效期 由 16/03/2026 至 15/03/2027']))
  assert.deepEqual(fields, { plate: 'AB1234', vin: 'AGH30-0123456', expiresOn: '2027-03-15' })
})
test('香港牌簿：品牌、型號保留空格且不混淆，值在下一行也讀到', () => {
  const same = extractVehicleFields('hk_registration', lines(['廠名 Make: TOYOTA 型號 Model: ALPHARD 2.5', '首次登記日期 Date of First Registration 01/06/2019'])).fields
  assert.equal(same.brand, 'TOYOTA'); assert.equal(same.model, 'ALPHARD 2.5'); assert.equal(same.firstRegisteredOn, '2019-06-01')
  const below = extractVehicleFields('hk_registration', lines(['登記號碼 Registration Mark', 'AB1234', '製造年份 Year of Manufacture', '2019'])).fields
  assert.equal(below.plate, 'AB1234'); assert.equal(below.manufacturedYear, '2019')
})
test('澳門登記文件：葡文標籤也讀到', () => {
  const { fields } = extractVehicleFields('mo_registration', lines(['車牌號碼 Matrícula MX-12-34', '牌子 Marca: 豐田 型號 Modelo: 埃爾法', '車架號碼 N.º do quadro JTMHV05J804012345', '製造年份 Ano de fabrico 2020']))
  assert.deepEqual([fields.plate, fields.brand, fields.model, fields.vin, fields.manufacturedYear], ['MX-12-34', '豐田', '埃爾法', 'JTMHV05J804012345', '2020'])
})
test('品牌標籤讀不到時，不會把下一行的標籤和數值當成品牌', () => {
  const { fields } = extractVehicleFields('hk_registration', lines(['廠名 Make', '秽造年份 Year of Manufacture 2016']))
  assert.equal(fields.brand, '')
})
test('多次辨識時，取較多次讀出的同一個值', () => {
  const read = text => extractVehicleFields('hk_registration', [{ text, confidence: 60 }])
  const merged = merge([read('廠名 Make: TOYOTA'), { ...read('廠名 Make: T0Y0TA'), fieldStatus: { ...read('廠名 Make: T0Y0TA').fieldStatus, brand: { value: 'T0Y0TA', status: 'uncertain', confidence: 90 } } }, read('廠名 Make: TOYOTA')])
  assert.equal(merged.fields.brand, 'TOYOTA')
})
test('品牌、型號等自由文字最多標「請核對」', () => {
  const { fieldStatus } = extractVehicleFields('mo_registration', lines(['牌子 Marca TOYOTA']))
  assert.equal(fieldStatus.brand.status, 'uncertain')
})
test('沒有標籤時整頁只有一個車架號碼才採用，並標「請核對」', () => {
  assert.equal(extractVehicleFields('cn_licence', lines(['JTMHV05J804012345'])).fieldStatus.vin.status, 'uncertain')
  assert.equal(extractVehicleFields('cn_licence', lines(['JTMHV05J804012345', 'LFV2A21K673123456'])).fields.vin, '')
})
test('要改字才合格的車架號碼標「請核對」', () => {
  const { fields, fieldStatus } = extractVehicleFields('cn_licence', lines(['车辆识别代号 JIMHV05J804012345']))
  assert.equal(fields.vin, 'J1MHV05J804012345'); assert.equal(fieldStatus.vin.status, 'uncertain')
})
test('兩次辨識讀出的值不一致時，即使信心高也標「請核對」', () => {
  const first = extractVehicleFields('hk_licence', lines(['底盤號碼 JTMHV05J804012345']))
  const second = extractVehicleFields('hk_licence', lines(['底盤號碼 JTMHV05J804012346']))
  assert.equal(merge([first, second]).fieldStatus.vin.status, 'uncertain')
  assert.equal(merge([first, first]).fieldStatus.vin.status, 'ok')
})
test('合併時取讀到值的一次，沒讀到的不影響', () => {
  const empty = extractVehicleFields('hk_licence', lines(['VEHICLE LICENCE']))
  const read = extractVehicleFields('hk_licence', lines(['有效期至 15/03/2027']))
  assert.equal(merge([empty, read]).fields.expiresOn, '2027-03-15'); assert.equal(merge([empty, read]).fieldStatus.expiresOn.status, 'ok')
})
test('低信心的標籤值標「請核對」', () => {
  const { fieldStatus } = extractVehicleFields('hk_licence', [{ text: '底盤號碼 AGH30-0123456', confidence: 40 }])
  assert.equal(fieldStatus.vin.status, 'uncertain')
})
test('亂碼一律留空，沒有任何欄位輸出未驗證的文字', () => {
  for (const kind of ['cn_licence', 'hk_licence', 'hk_registration', 'mo_registration']) {
    const { fields, fieldStatus } = extractVehicleFields(kind, lines(['门门门芭Am人-mr广己', '号牌号码 锣77RA!D', '車架號碼 全人二DO0', '有效期至 区期', '首次登記日期 99/99/9999', '製造年份 人']))
    for (const key of Object.keys(fields)) if (!['brand', 'model'].includes(key)) assert.equal(fields[key], '', `${kind}.${key}`)
    assert.ok(Object.values(fieldStatus).every(item => item.value === '' ? item.status === 'failed' : true))
  }
})
test('辨識結果是 null、非陣列或空行時不出錯', () => {
  for (const value of [null, undefined, 'text', [null, { text: null }]]) assert.equal(extractVehicleFields('hk_licence', value).fields.vin, '')
  assert.throws(() => extractVehicleFields('unknown', []))
})

// ── 合成圖片整頁辨識 ──
const bytesOf = image => Buffer.from(image.split(',')[1], 'base64')
test('合成內地行駛證：讀出車牌、車架號碼、註冊日期', { timeout: 120000 }, async () => {
  const { fields } = await recognizeVehicleDocument(bytesOf(state.images.cn), 'cn_licence')
  assert.equal(fields.plate, '粵Z76L2港'); assert.equal(fields.vin, 'JTMHV05J804012345'); assert.equal(fields.registeredOn, '2019-05-10')
})
test('合成香港車輛牌照：讀出車牌、車架號碼、有效期', { timeout: 120000 }, async () => {
  const { fields } = await recognizeVehicleDocument(bytesOf(state.images.hk), 'hk_licence')
  assert.deepEqual(fields, { plate: 'AB1234', vin: 'JTMHV05J804012345', expiresOn: '2027-03-15' })
})
test('合成澳門車輛登記文件：讀出車牌、車架號碼、製造年份', { timeout: 120000 }, async () => {
  const { fields } = await recognizeVehicleDocument(bytesOf(state.images.mo), 'mo_registration')
  assert.equal(fields.plate, 'MX-12-34'); assert.equal(fields.vin, 'JTMHV05J804012345'); assert.equal(fields.manufacturedYear, '2020')
})
test('不需辨識的證件類別不能送去辨識', async () => { await assert.rejects(recognizeVehicleDocument(bytesOf(tinyPng), 'local_insurance')) })

// ── 證件清單 ──
test('香港車列出行駛證、香港車輛牌照、牌簿和保險單，沒有澳門登記文件', async () => {
  const { vehicleId } = makeVehicle()
  const kinds = (await request(`/vehicles/${vehicleId}/documents`)).body.documents.map(item => item.kind)
  assert.deepEqual(kinds, ['cn_licence', 'cn_licence_back', 'hk_licence', 'hk_registration', 'local_insurance', 'cn_ctpl'])
})
test('澳門車列出澳門登記文件與澳門汽車保險單，沒有香港證件', async () => {
  const { vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const documents = (await request(`/vehicles/${vehicleId}/documents`)).body.documents
  assert.deepEqual(documents.map(item => item.kind), ['cn_licence', 'cn_licence_back', 'mo_registration', 'local_insurance', 'cn_ctpl'])
  assert.equal(documents.find(item => item.kind === 'local_insurance').label, '澳門汽車保險單')
})
test('未上傳的證件顯示未上傳、沒有欄位', async () => {
  const { vehicleId } = makeVehicle()
  const item = (await request(`/vehicles/${vehicleId}/documents`)).body.documents[0]
  assert.equal(item.uploaded, false); assert.deepEqual(item.fields, [])
})

// ── 上傳與自動填入 ──
test('上傳香港車輛牌照：存原件，填入空白的車架號碼和牌照到期日', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle()
  const result = await upload(vehicleId, 'hk_licence', state.images.hk)
  assert.equal(result.status, 200)
  assert.equal(vehicleRow(vehicleId).vin, 'JTMHV05J804012345')
  assert.equal(tracked(vehicleId, 'hk_licence'), '2027-03-15')
  assert.deepEqual(result.body.applied.map(item => item.field).sort(), ['date:hk_licence', 'vin'])
  assert.equal(result.body.documents.find(item => item.kind === 'hk_licence').uploaded, true)
  state.hkVehicle = vehicleId
})
test('上傳不會覆蓋車輛資料中已有的車架號碼', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle({ vin: 'AGH30-0999999' })
  await upload(vehicleId, 'hk_licence', state.images.hk)
  assert.equal(vehicleRow(vehicleId).vin, 'AGH30-0999999')
})
test('已有的牌照到期日比讀出的日期遲時不被覆蓋', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle()
  setTracked(vehicleId, 'hk_licence', '2028-01-01')
  await upload(vehicleId, 'hk_licence', state.images.hk)
  assert.equal(tracked(vehicleId, 'hk_licence'), '2028-01-01')
})
test('客戶上傳而自動填入的資料列入「客戶更新待核對」', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await upload(vehicleId, 'hk_licence', state.images.hk, 'client')).status, 200)
  const fields = state.db.prepare("SELECT field FROM customer_changes WHERE entity_type='vehicle' AND entity_id=? AND status='待核對'").all(vehicleId).map(row => row.field).sort()
  assert.deepEqual(fields, ['date:hk_licence', 'vin'])
})
test('上傳澳門車輛登記文件：填入空白的車架號碼、品牌、型號和製造年份', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  assert.equal((await upload(vehicleId, 'mo_registration', state.images.mo)).status, 200)
  const row = vehicleRow(vehicleId)
  assert.deepEqual([row.vin, row.brand, row.model, row.manufactured_year], ['JTMHV05J804012345', 'TOYOTA', 'ALPHARD', 2020])
})
test('內地行駛證的註冊日期不填進港澳首次註冊日期', { timeout: 120000 }, async () => {
  const { vehicleId } = makeVehicle()
  await upload(vehicleId, 'cn_licence', state.images.cn)
  assert.equal(vehicleRow(vehicleId).first_registered_on, null)
  assert.equal(vehicleRow(vehicleId).vin, 'JTMHV05J804012345')
})
test('保險單只存原件，不辨識也不改資料', async () => {
  const { vehicleId } = makeVehicle()
  const result = await upload(vehicleId, 'local_insurance', tinyPng)
  assert.equal(result.status, 200); assert.deepEqual(result.body.applied, []); assert.deepEqual(result.body.fieldStatus, {})
  assert.equal(result.body.documents.find(item => item.kind === 'local_insurance').uploaded, true)
})
test('同一類證件重新上傳只保留最新一張', async () => {
  const { vehicleId } = makeVehicle()
  await upload(vehicleId, 'cn_ctpl', tinyPng)
  await upload(vehicleId, 'cn_ctpl', tinyPng, 'staff')
  const rows = state.db.prepare("SELECT uploaded_by_name FROM vehicle_documents WHERE vehicle_id=? AND kind='cn_ctpl'").all(vehicleId)
  assert.deepEqual(rows.map(row => row.uploaded_by_name), ['staff'])
})

// ── 比對 ──
test('證件與車輛資料的車架號碼不一致時提示', async () => {
  const { vehicleId } = makeVehicle({ vin: 'AGH30-0999999' })
  state.db.prepare("INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,fields_json,uploaded_at) VALUES (?,?,?,?,?,?)").run(vehicleId, 'hk_licence', 'image/png', Buffer.from('x'), JSON.stringify({ fieldStatus: { vin: { value: 'JTMHV05J804012345', status: 'ok' } } }), new Date().toISOString())
  const checks = (await request(`/vehicles/${vehicleId}/documents`)).body.checks
  assert.equal(checks.length, 1); assert.equal(checks[0].code, 'vin_mismatch')
})
test('寫法不同但相同的車架號碼不算不一致', async () => {
  const { vehicleId } = makeVehicle({ vin: 'agh30 0123456' })
  state.db.prepare("INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,fields_json,uploaded_at) VALUES (?,?,?,?,?,?)").run(vehicleId, 'hk_licence', 'image/png', Buffer.from('x'), JSON.stringify({ fieldStatus: { vin: { value: 'AGH30-0123456', status: 'ok' } } }), new Date().toISOString())
  assert.deepEqual((await request(`/vehicles/${vehicleId}/documents`)).body.checks, [])
})
test('內地行駛證車牌與牌照的內地車牌不一致時提示', async () => {
  const { vehicleId } = makeVehicle({ mainlandPlate: '粵Z11111港' })
  state.db.prepare("INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,fields_json,uploaded_at) VALUES (?,?,?,?,?,?)").run(vehicleId, 'cn_licence', 'image/png', Buffer.from('x'), JSON.stringify({ fieldStatus: { plate: { value: '粵Z76L2港', status: 'ok' } } }), new Date().toISOString())
  assert.deepEqual((await request(`/vehicles/${vehicleId}/documents`)).body.checks.map(item => item.code), ['mainland_plate_mismatch'])
})
test('香港證件車牌與車輛車牌不一致時提示', async () => {
  const { vehicleId } = makeVehicle({ plate: 'CD5678' })
  state.db.prepare("INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,fields_json,uploaded_at) VALUES (?,?,?,?,?,?)").run(vehicleId, 'hk_licence', 'image/png', Buffer.from('x'), JSON.stringify({ fieldStatus: { plate: { value: 'AB1234', status: 'ok' } } }), new Date().toISOString())
  assert.deepEqual((await request(`/vehicles/${vehicleId}/documents`)).body.checks.map(item => item.code), ['hk_licence_plate_mismatch'])
})

// ── 原件與權限 ──
test('原件以私有、不快取的方式回傳', async () => {
  const { vehicleId } = makeVehicle()
  await upload(vehicleId, 'cn_ctpl', tinyPng)
  const result = await request(`/vehicles/${vehicleId}/documents/cn_ctpl/image`)
  assert.equal(result.status, 200); assert.equal(result.headers['content-type'], 'image/png'); assert.equal(result.headers['cache-control'], 'private, no-store')
  assert.ok(Buffer.isBuffer(result.raw) && result.raw.length > 0)
})
test('未上傳的原件回 404', async () => { const { vehicleId } = makeVehicle(); assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl/image`)).status, 404) })
test('客戶可看和上傳自己車輛的證件', async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await request(`/vehicles/${vehicleId}/documents`, 'GET', undefined, 'client')).status, 200)
  assert.equal((await upload(vehicleId, 'cn_ctpl', tinyPng, 'client')).status, 200)
  assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl/image`, 'GET', undefined, 'client')).status, 200)
})
test('其他客戶看不到、不能上傳、不能下載', async () => {
  const { vehicleId } = makeVehicle()
  await upload(vehicleId, 'cn_ctpl', tinyPng)
  assert.equal((await request(`/vehicles/${vehicleId}/documents`, 'GET', undefined, 'second-client')).status, 404)
  assert.equal((await upload(vehicleId, 'cn_ctpl', tinyPng, 'second-client')).status, 404)
  assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl/image`, 'GET', undefined, 'second-client')).status, 404)
})
test('其他租戶的管理者看不到', async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await request(`/vehicles/${vehicleId}/documents`, 'GET', undefined, 'foreign-admin')).status, 404)
  assert.equal((await upload(vehicleId, 'cn_ctpl', tinyPng, 'foreign-admin')).status, 404)
})
test('員工可看和上傳', async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await request(`/vehicles/${vehicleId}/documents`, 'GET', undefined, 'staff')).status, 200)
  assert.equal((await upload(vehicleId, 'cn_ctpl', tinyPng, 'staff')).status, 200)
})
test('不存在的車輛 404', async () => { assert.equal((await request(`/vehicles/${randomUUID()}/documents`)).status, 404) })
test('不存在的證件類別、別的路線的證件類別 404', async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await upload(vehicleId, 'passport', tinyPng)).status, 404)
  assert.equal((await upload(vehicleId, 'mo_registration', tinyPng)).status, 404)
  assert.equal((await upload(vehicleId, '__proto__', tinyPng)).status, 404)
  const macau = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  assert.equal((await upload(macau.vehicleId, 'hk_licence', tinyPng)).status, 404)
})
test('只支援列表 GET、上傳 POST、原件 GET', async () => {
  const { vehicleId } = makeVehicle()
  assert.equal((await request(`/vehicles/${vehicleId}/documents`, 'POST', {})).status, 405)
  assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl`, 'DELETE')).status, 405)
  assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl/image`, 'POST', {})).status, 405)
})
test('上傳內容無效時拒絕：空白、null、陣列、錯誤類型、非圖片、格式不符', async () => {
  const { vehicleId } = makeVehicle()
  const bad = [undefined, {}, { image: '' }, { image: '   ' }, { image: null }, { image: ['x'] }, { image: 123 }, { image: 'data:application/pdf;base64,JVBERi0=' }, { image: 'data:image/png;base64,' }, { image: `data:image/jpeg;base64,${tinyPng.split(',')[1]}` }]
  for (const body of bad) assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl`, 'POST', body)).status, 400, JSON.stringify(body))
  for (const body of [null, []]) assert.equal((await request(`/vehicles/${vehicleId}/documents/cn_ctpl`, 'POST', body)).status >= 400, true, JSON.stringify(body))
  assert.equal(state.db.prepare('SELECT COUNT(*) count FROM vehicle_documents WHERE vehicle_id=?').get(vehicleId).count, 0)
})
test('超過 3.5 MB 的圖片被拒', async () => {
  const { vehicleId } = makeVehicle()
  const big = Buffer.alloc(3600000, 0); big.set([0x89, 0x50, 0x4e, 0x47])
  assert.equal((await upload(vehicleId, 'cn_ctpl', `data:image/png;base64,${big.toString('base64')}`)).status, 400)
})
test('已換走的車不能再上傳證件，但仍可查看', async () => {
  const { vehicleId } = makeVehicle()
  state.db.prepare('UPDATE vehicles SET retired_on=? WHERE id=?').run('2026-01-01', vehicleId)
  assert.equal((await upload(vehicleId, 'cn_ctpl', tinyPng)).status, 400)
  assert.equal((await request(`/vehicles/${vehicleId}/documents`)).body.retired, true)
})

// ── 澳門車輛規則 ──
const customerDeadlines = async (plateId, token = 'client') => (await request(`/my/plates/${plateId}`, 'GET', undefined, token)).body.deadlines
test('澳門車有澳門定期檢驗和行車稅，香港車沒有', async () => {
  const macau = makeVehicle({ route: '粵澳', plate: 'MX-12-34' }), hk = makeVehicle()
  setTracked(macau.vehicleId, 'mo_inspection', '2026-11-01')
  const overview = (await request('/overview?days=365')).body.deadlines
  const codes = id => overview.filter(item => item.ownerId === id).map(item => item.ruleCode)
  assert.ok(codes(macau.vehicleId).includes('mo_inspection')); assert.ok(codes(macau.vehicleId).includes('mo_vehicle_tax'))
  assert.ok(!codes(hk.vehicleId).includes('mo_inspection')); assert.ok(!codes(hk.vehicleId).includes('mo_vehicle_tax'))
})
test('行車稅的到期日是三月三十一日', async () => {
  const { vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const item = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ownerId === vehicleId && entry.ruleCode === 'mo_vehicle_tax')
  assert.match(item.dueOn, /^\d{4}-03-31$/)
})
test('行車稅只提醒客戶自理', async () => {
  const { vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const item = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ownerId === vehicleId && entry.ruleCode === 'mo_vehicle_tax')
  assert.equal(item.handler, 'client')
})
test('本公司自有的澳門車，行車稅由我們跟進', async () => {
  const { vehicleId } = makeVehicle({ customer: state.self, route: '粵澳', plate: 'MX-98-76' })
  const item = (await request('/overview?days=365')).body.deadlines.find(entry => entry.ownerId === vehicleId && entry.ruleCode === 'mo_vehicle_tax')
  assert.equal(item.handler, 'us')
})
test('客戶端行車稅顯示由客戶處理，可標記已繳', async () => {
  const { plateId, vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const item = (await customerDeadlines(plateId)).find(entry => entry.code === 'mo_vehicle_tax' && entry.ownerId === vehicleId)
  assert.equal(item.handledBy, 'you'); assert.equal(item.markable, true)
})
test('行車稅不在委託範圍矩陣，澳門定期檢驗在', async () => {
  makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  for (const view of ['scope']) {
    const result = await request(`/customers/${state.customer}/${view}`)
    assert.equal(result.status, 200)
    const all = JSON.stringify(result.body)
    assert.ok(!all.includes('mo_vehicle_tax'), view); assert.ok(all.includes('mo_inspection'), view)
  }
})
test('委託範圍不接受把行車稅設為我們做', async () => {
  const { plateId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: plateId, item: 'mo_vehicle_tax', handler: 'us' })).status, 400)
})
test('客戶附收據相片標記行車稅已繳，這一期不再提醒', async () => {
  const { plateId, vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const item = (await customerDeadlines(plateId)).find(entry => entry.code === 'mo_vehicle_tax' && entry.ownerId === vehicleId)
  const result = await request(`/my/plates/${plateId}/self-handled`, 'POST', { kind: 'tax_paid', period: item.period, photos: [tinyPng] }, 'client')
  assert.equal(result.status, 201, JSON.stringify(result.body))
  assert.ok(!(await customerDeadlines(plateId)).some(entry => entry.code === 'mo_vehicle_tax' && entry.ownerId === vehicleId && entry.period === item.period))
})
test('標記行車稅已繳須附相片', async () => {
  const { plateId, vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const item = (await customerDeadlines(plateId)).find(entry => entry.code === 'mo_vehicle_tax' && entry.ownerId === vehicleId)
  const result = await request(`/my/plates/${plateId}/self-handled`, 'POST', { kind: 'tax_paid', period: item.period, photos: [] }, 'client')
  assert.equal(result.status, 400); assert.match(result.body.error, /行車稅繳費收據/)
})
test('香港車不能標記行車稅', async () => {
  const { plateId } = makeVehicle()
  assert.equal((await request(`/my/plates/${plateId}/self-handled`, 'POST', { kind: 'tax_paid', period: '2027', photos: [tinyPng] }, 'client')).status, 400)
})
test('澳門車的驗車指引列出澳門定期檢驗和行車稅的官方來源', async () => {
  const { vehicleId } = makeVehicle({ route: '粵澳', plate: 'MX-12-34' })
  const ids = (await request(`/vehicles/${vehicleId}`)).body.inspectionGuidance.map(item => item.sourceId)
  assert.ok(ids.includes('MO-INSPECTION')); assert.ok(ids.includes('MO-VEHICLE-TAX'))
})

// ── 一次性遷移 ──
test('已固定事項清單的客戶升級後加上澳門定期檢驗', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vehicle-docs-migration-')), path = join(dir, 'api.db')
  const launch = () => spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'"], { cwd: new URL('../', import.meta.url), env: { ...process.env, DB_PATH: path, DEMO_SEED: '0' }, encoding: 'utf8' })
  try {
    assert.equal(launch().status, 0)
    const db = new DatabaseSync(path), customerId = randomUUID()
    db.prepare("INSERT INTO customers(id,name,kind,tenant_id,items_customized) VALUES (?,?,?,'default',1)").run(customerId, '舊客戶', '個人')
    db.prepare("DELETE FROM schema_migrations WHERE name='macau-vehicle-rules-v1'").run()
    db.close()
    assert.equal(launch().status, 0)
    const after = new DatabaseSync(path)
    assert.ok(after.prepare("SELECT 1 FROM customer_items WHERE customer_id=? AND item_code='mo_inspection'").get(customerId))
    assert.ok(!after.prepare("SELECT 1 FROM customer_items WHERE customer_id=? AND item_code='mo_vehicle_tax'").get(customerId))
    after.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 由牌照登記車輛（從批文卡建檔的牌照沒有車輛記錄） ──
function makePlate({ customer = state.customer, route = '粵港', local = 'PQ4321', installation = '待核對', vehicleId = null } = {}) {
  const plateId = randomUUID(), now = new Date().toISOString()
  state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,card_number,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(plateId, customer, route, '粵Z1234港', local, vehicleId, installation, 'C-' + plateId.slice(0, 8), '{}', now, now)
  return plateId
}
const plateRow = id => state.db.prepare('SELECT * FROM plate_assets WHERE id=?').get(id)
test('沒有車輛的香港牌照可按港澳車牌登記車輛並綁定', async () => {
  const plateId = makePlate({ local: ' pq4321 ' })
  const result = await request(`/plate-assets/${plateId}/vehicle`, 'POST')
  assert.equal(result.status, 201)
  assert.deepEqual([result.body.vehicle.plate, result.body.vehicle.origin, result.body.vehicle.route], ['PQ4321', '香港', '粵港'])
  assert.equal(plateRow(plateId).vehicle_id, result.body.vehicle.id); assert.equal(plateRow(plateId).installation_status, '已上牌')
})
test('澳門牌照登記的車輛來源地為澳門', async () => {
  const plateId = makePlate({ route: '粵澳', local: 'MY-56-78' })
  assert.equal((await request(`/plate-assets/${plateId}/vehicle`, 'POST')).body.vehicle.origin, '澳門')
})
test('同客戶已有同車牌而未綁定的車，直接綁定不重複建立', async () => {
  const vehicleId = randomUUID()
  state.db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(vehicleId, state.customer, '粵港', '香港', '私家車', 'RS 9876')
  const plateId = makePlate({ local: 'RS9876' })
  const result = await request(`/plate-assets/${plateId}/vehicle`, 'POST')
  assert.equal(result.status, 200); assert.equal(result.body.vehicle.id, vehicleId)
})
test('已綁定車輛的牌照不可再登記', async () => {
  const { plateId } = makeVehicle()
  assert.equal((await request(`/plate-assets/${plateId}/vehicle`, 'POST')).status, 409)
})
test('未上牌、沒有港澳車牌的牌照不可登記車輛', async () => {
  assert.equal((await request(`/plate-assets/${makePlate({ installation: '未上牌' })}/vehicle`, 'POST')).status, 400)
  assert.equal((await request(`/plate-assets/${makePlate({ local: '' })}/vehicle`, 'POST')).status, 400)
  assert.equal((await request(`/plate-assets/${makePlate({ local: '   ' })}/vehicle`, 'POST')).status, 400)
})
test('客戶可為自己的牌照登記車輛，綁定列入待核對', async () => {
  const plateId = makePlate({ local: 'TU1111' })
  assert.equal((await request(`/plate-assets/${plateId}/vehicle`, 'POST', undefined, 'client')).status, 201)
  assert.ok(state.db.prepare("SELECT 1 FROM customer_changes WHERE entity_type='plate' AND entity_id=? AND field='vehicleId' AND status='待核對'").get(plateId))
})
test('其他客戶、其他租戶不能為牌照登記車輛，不存在的牌照 404', async () => {
  const plateId = makePlate({ local: 'VW2222' })
  assert.equal((await request(`/plate-assets/${plateId}/vehicle`, 'POST', undefined, 'second-client')).status, 404)
  assert.equal((await request(`/plate-assets/${plateId}/vehicle`, 'POST', undefined, 'foreign-admin')).status, 404)
  assert.equal((await request(`/plate-assets/${randomUUID()}/vehicle`, 'POST')).status, 404)
  assert.equal(plateRow(plateId).vehicle_id, null)
})
test('登記車輛只接受 POST', async () => { assert.equal((await request(`/plate-assets/${makePlate()}/vehicle`, 'GET')).status, 405) })
test('重複按登記只建立一部車', async () => {
  const plateId = makePlate({ local: 'XY3333' })
  await request(`/plate-assets/${plateId}/vehicle`, 'POST'); await request(`/plate-assets/${plateId}/vehicle`, 'POST')
  assert.equal(state.db.prepare("SELECT COUNT(*) count FROM vehicles WHERE customer_id=? AND plate='XY3333'").get(state.customer).count, 1)
})
