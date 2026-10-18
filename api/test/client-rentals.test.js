import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'

// 客戶自行新增出租（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項）：新增、協議發出與確認、換車換司機、狀態、後台面板
const state = {}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
// 手寫簽名：一張真正的 PNG（帶一條斜線），以 data URL 送出，與瀏覽器 canvas.toDataURL 一樣
function signaturePng(seed = 0) {
  const width = 300, height = 100, rows = []
  for (let y = 0; y < height; y++) { const row = Buffer.alloc(1 + width * 4); for (let x = 0; x < width; x++) if ((x * 7 + y * 13 + seed) % 17 < 3) row.writeUInt32BE(0x14201bff, 1 + x * 4); rows.push(row) }
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const SIGN = signaturePng()
const hk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const shift = days => new Date(Date.parse(hk() + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'client-rentals-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs'), PUBLIC_BASE_URL: 'https://api.example.com' })
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('default'); seedRules('other')
  const now = new Date().toISOString()
  for (const [key, name, tenant, mode] of [['first', '牌主甲', 'default', '托管'], ['second', '客戶乙', 'default', '托管'], ['selfManaged', '自管丙', 'default', '自管'], ['foreign', '外租戶丁', 'other', '托管']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id,service_mode) VALUES (?,?,?,?,?,?)').run(state[key], name, '個人', '91234567', tenant, mode)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['client2', 'customer', state.second, 'default'], ['self-client', 'customer', state.selfManaged, 'default'], ['foreign-client', 'customer', state.foreign, 'other'], ['foreign-admin', 'admin', null, 'other']]) {
    const userId = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(userId, role, token, `${token}@test.invalid`, hashPassword('Password12345'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, userId, '2099-01-01T00:00:00Z', now)
  }
  state.server = (await import('../src/server.js')).server
  state.vehicle = (await api('/vehicles', 'POST', { customerId: state.first, route: '粵港', origin: '香港', type: '私家車', plate: 'AB1234' })).body.id
  state.hkCompany = (await api('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '甲香港有限公司', nameEn: 'Jia HK Limited' })).body.id
  state.otherCompany = (await api('/companies', 'POST', { customerId: state.second, jurisdiction: '香港', name: '乙香港有限公司', nameEn: 'Yi HK Limited' })).body.id
  state.driver = (await api('/drivers', 'POST', { customerId: state.first, name: '陳大文', phone: '91234567' })).body.id
  state.otherDriver = (await api('/drivers', 'POST', { customerId: state.second, name: '黃乙' })).body.id
  state.plates = {}
  for (const [key, customer, route, extra] of [['main', state.first, '粵港', { vehicle_id: state.vehicle, local_plate: 'AB1234' }], ['agent', state.first, '粵港', {}], ['selfDo', state.first, '粵港', {}], ['plain', state.first, '粵港', { local_plate: 'CD5678' }], ['stopped', state.first, '粵港', { stopped_on: '2026-10-01' }], ['other', state.second, '粵港', {}], ['self', state.selfManaged, '粵港', {}]]) {
    const plateId = randomUUID(); state.plates[key] = plateId
    db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,card_number,usage_status,stopped_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(plateId, customer, route, `粵Z${key}港`, extra.local_plate || null, extra.vehicle_id || null, `CR-${key}`, '自用', extra.stopped_on || null, now, now)
  }
  db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role) VALUES (?,?,?)').run(state.plates.main, state.driver, '主')
  // 持牌公司：甲香港有限公司與主牌照同一公司組；另一間自家香港公司不在組內
  state.group = randomUUID()
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(state.group, 'default', state.first, '甲組', now)
  db.prepare('UPDATE companies SET group_id=? WHERE id=?').run(state.group, state.hkCompany)
  db.prepare('UPDATE plate_assets SET group_id=? WHERE id=?').run(state.group, state.plates.main)
  state.unrelatedCompany = (await api('/companies', 'POST', { customerId: state.first, jurisdiction: '香港', name: '甲另一間有限公司', nameEn: 'Jia Other Limited' })).body.id
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })

function raw(url, method = 'GET', payload = '', headers = {}) {
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url, headers: { host: 'api.example.com', 'x-forwarded-for': '10.1.2.3', ...headers } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers || {} }, end(data) { resolve({ status: this.status, headers: this.headers, text: typeof data === 'string' ? data : '', data }) } }))
}
async function api(path, method = 'GET', body, token = 'admin') { const result = await raw(`/api${path}`, method, body === undefined ? '' : JSON.stringify(body), { authorization: `Bearer ${token}` }); let parsed = null; try { parsed = result.text ? JSON.parse(result.text) : null } catch { parsed = null } return { ...result, body: parsed } }
const client = (path, method = 'GET', body) => api(path, method, body, 'client')
const form = (overrides = {}) => ({ renter: { name: '承租人乙', phone: '+852 6123 6789', idNo: 'A123456(7)' }, lessorType: 'client', useCurrentVehicle: true, driverIds: [state.driver], startsOn: shift(3), endsOn: shift(368), rentAmount: 800000, depositAmount: 1600000, cycle: 'monthly', dueDay: 5, handling: 'self', ...overrides })
const contract = id => state.db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(id)
const requestsOf = plateId => state.db.prepare('SELECT * FROM requests WHERE plate_asset_id=? ORDER BY created_at').all(plateId)
async function confirmAsRenter(url) {
  const token = url.split('/r/')[1]
  const verified = await raw(`/r/${token}/verify`, 'POST', 'tail=6789')
  const key = new URL(verified.headers.location, 'https://x').searchParams.get('k')
  return raw(`/r/${token}/acknowledge`, 'POST', `key=${key}&name=${encodeURIComponent('承租人乙')}&signature=${encodeURIComponent(SIGN)}`)
}
const send = (id, signature = SIGN) => client(`/my/rentals/${id}/send`, 'POST', signature === null ? {} : { signature })

// —— 新增前的選項與限制 ——
test('托管客戶可以新增出租，列出出租人、現有車、登記司機和手續收費', async () => {
  const result = await client(`/my/plates/${state.plates.main}/rental-options`)
  assert.equal(result.status, 200)
  assert.equal(result.body.allowed, true)
  assert.deepEqual(result.body.lessors.map(item => item.label), ['牌主甲', '甲香港有限公司'])
  assert.equal(result.body.currentVehicle, 'AB1234')
  assert.deepEqual(result.body.drivers.map(item => item.name), ['陳大文'])
  assert.equal(result.body.prices.vehicle, '由顧問報價')
})
// 管理者 2026-10-18 決定（docs/tasks/self-managed-fixes-plan.md 第 11 步）：自管客戶可以自己記出租，但只可自行負責、租客直接付款
test('自管客戶不能把出租交給我們代理或代收', async () => {
  assert.equal((await api(`/my/plates/${state.plates.self}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'XY1', driverIds: [], newDriverName: '新司機', handling: 'agent', collectionMode: '代收' }), 'self-client')).status, 400)
  assert.equal((await api(`/my/plates/${state.plates.self}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'XY1', driverIds: [], newDriverName: '新司機', handling: 'agent', collectionMode: '直付' }), 'self-client')).status, 400)
})
test('自管客戶可以新增自行負責、租客直接付款的出租', async () => {
  assert.equal((await api(`/my/plates/${state.plates.self}/rental-options`, 'GET', undefined, 'self-client')).body.allowed, true)
  const result = await api(`/my/plates/${state.plates.self}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'XY1', driverIds: [], newDriverName: '新司機' }), 'self-client')
  assert.equal(result.status, 201, JSON.stringify(result.body))
  assert.equal(result.body.collectionMode, '直付')
  assert.equal(result.body.handling, 'self')
})
test('已標記不再續期的牌照不能新增出租', async () => {
  assert.match((await client(`/my/plates/${state.plates.stopped}/rental-options`)).body.reason, /不再續期/)
  assert.equal((await client(`/my/plates/${state.plates.stopped}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'XY1', driverIds: [], newDriverName: '新司機' }))).status, 409)
})
test('不能為別的客戶的牌照新增出租', async () => {
  assert.equal((await client(`/my/plates/${state.plates.other}/rental-options`)).status, 404)
  assert.equal((await client(`/my/plates/${state.plates.other}/rentals`, 'POST', form())).status, 404)
  assert.equal((await client(`/my/plates/${randomUUID()}/rentals`, 'POST', form())).status, 404)
})
test('別的租戶的客戶不能為這個租戶的牌照新增出租', async () => {
  assert.equal((await api(`/my/plates/${state.plates.main}/rentals`, 'POST', form(), 'foreign-client')).status, 404)
})
test('員工不能用客戶的出租接口', async () => {
  assert.equal((await api(`/my/plates/${state.plates.main}/rental-options`, 'GET', undefined, 'staff')).status, 403)
  assert.equal((await api(`/my/plates/${state.plates.main}/rentals`, 'POST', form(), 'admin')).status, 403)
})

// —— 新增出租的內容檢查 ——
test('新增出租拒絕 null、陣列和空內容', async () => {
  for (const payload of ['null', '[]', '"文字"']) assert.equal((await raw(`/api/my/plates/${state.plates.main}/rentals`, 'POST', payload, { authorization: 'Bearer client' })).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', {})).status, 400)
})
test('承租人姓名不可空白', async () => {
  assert.match((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ renter: { name: '   ', phone: '61236789' } }))).body.error, /承租人姓名/)
})
test('承租人電話無效時不能新增', async () => {
  for (const phone of ['', '1234', 'abc12345678', 12345678]) assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ renter: { name: '承租人乙', phone } }))).status, 400)
})
test('只可以用持牌公司的名義出租，自家其他公司也不行', async () => {
  assert.match((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ lessorType: 'company', lessorCompanyId: state.unrelatedCompany }))).body.error, /持有這個牌照/)
  assert.ok(!(await client(`/my/plates/${state.plates.main}/rental-options`)).body.lessors.some(item => item.id === state.unrelatedCompany))
})
test('出租的公司必須是自己的香港或澳門公司', async () => {
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ lessorType: 'company', lessorCompanyId: state.otherCompany }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ lessorType: 'someone' }))).status, 400)
})
test('所選司機必須是這個牌照的登記司機', async () => {
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ driverIds: [state.otherDriver] }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ driverIds: 'abc' }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ driverIds: [] }))).status, 400)
})
test('日期和租金無效時不能新增', async () => {
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ startsOn: '2026-02-30' }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ endsOn: shift(1) }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ rentAmount: 0 }))).status, 400)
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ rentAmount: '8000' }))).status, 400)
})
test('自行負責的出租不能選由我們代收租金', async () => {
  assert.match((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form({ collectionMode: '代收' }))).body.error, /代理/)
})
test('沒有登記車輛又選用現有的車時要填承租人的車牌', async () => {
  assert.equal((await client(`/my/plates/${state.plates.selfDo}/rentals`, 'POST', form({ driverIds: [], newDriverName: '新司機' }))).status, 400)
})

// —— 新增後：手續與工單 ——
test('用現有的車和登記司機：不用換車換司機，也不開工單', async () => {
  const result = await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form())
  assert.equal(result.status, 201, JSON.stringify(result.body))
  state.mainRental = result.body.id
  assert.equal(result.body.statusWord, '未發出協議')
  assert.deepEqual(result.body.procedures, [])
  assert.equal(requestsOf(state.plates.main).length, 0)
})
test('同一個牌照已有出租在處理中，不能再新增', async () => {
  assert.equal((await client(`/my/plates/${state.plates.main}/rentals`, 'POST', form())).status, 409)
  assert.equal((await client(`/my/plates/${state.plates.main}/rental-options`)).body.allowed, false)
})
test('協議預先填好出租人、承租人、牌照和租金', async () => {
  const body = (await client(`/my/rentals/${state.mainRental}`)).body.agreement.body
  assert.match(body, /兩地牌照出租協議/)
  assert.match(body, /出租人：牌主甲（個人）/)
  assert.match(body, /承租人：承租人乙　證件號碼：A123456\(7\)/)
  assert.match(body, /租金為 HKD 8,000\.00，每月繳付/)
  assert.doesNotMatch(body, /\{\{/)
})
test('換新車和新司機交給我們辦：各開一張工單', async () => {
  const result = await client(`/my/plates/${state.plates.agent}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'XY 9999', driverIds: [], newDriverName: '李承租', handling: 'agent', collectionMode: '代收' }))
  assert.equal(result.status, 201, JSON.stringify(result.body))
  state.agentRental = result.body.id
  assert.deepEqual(result.body.procedures.map(item => [item.name, item.handler, item.state]), [['換車', 'us', 'open'], ['換司機', 'us', 'open']])
  assert.equal(result.body.statusWord, '交給我們代理')
  assert.deepEqual(requestsOf(state.plates.agent).map(item => item.title).sort(), ['出租代理：粵Zagent港', '出租換司機：粵Zagent港', '出租換車：粵Zagent港'].sort())
  assert.equal(result.body.procedures[0].price, '由顧問報價')
})
test('交給我們代理的出租，客戶不能自行改協議或發出', async () => {
  assert.equal((await client(`/my/rentals/${state.agentRental}/agreement`, 'PUT', { body: '改了' })).status, 409)
  assert.equal((await send(state.agentRental)).status, 409)
})
test('換車選自行辦理：不開工單，等客戶在「有變動？」回報', async () => {
  const result = await client(`/my/plates/${state.plates.selfDo}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'ZZ1111', driverIds: [], newDriverName: '王司機', procedures: { vehicle: 'client', driver: 'us' } }))
  assert.equal(result.status, 201, JSON.stringify(result.body))
  state.selfRental = result.body.id
  assert.deepEqual(result.body.procedures.map(item => [item.name, item.handler]), [['換車', 'client'], ['換司機', 'us']])
  assert.deepEqual(requestsOf(state.plates.selfDo).map(item => item.title), ['出租換司機：粵ZselfDo港'])
})
test('手續的辦理方只可選交給我們或自行辦理', async () => {
  assert.equal((await client(`/my/plates/${state.plates.plain}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'QQ1', driverIds: [], newDriverName: '甲', procedures: { vehicle: 'someone' } }))).status, 400)
})

// —— 協議：修改、發出、版本 ——
test('協議不可改成空白', async () => {
  assert.equal((await client(`/my/rentals/${state.mainRental}/agreement`, 'PUT', { body: '   ' })).status, 400)
  assert.equal((await client(`/my/rentals/${state.mainRental}/agreement`, 'PUT', { body: ['甲'] })).status, 400)
})
// —— 手寫簽名（管理者 2026-10-18）——
test('沒有簽名不能發給承租人', async () => {
  const result = await send(state.mainRental, null)
  assert.equal(result.status, 400); assert.match(result.body.error, /簽名/)
  assert.equal((await client(`/my/rentals/${state.mainRental}`)).body.agreement.version, 0)
})
test('簽名不是 PNG 相片時不能發出', async () => {
  for (const signature of ['', 'abc', 'data:image/png;base64,' + Buffer.from('not png').toString('base64'), PNG, 123, ['x']]) assert.equal((await send(state.mainRental, signature)).status, 400, String(signature).slice(0, 20))
})
test('第一次發給承租人：鎖定為第 1 版並產生連結', async () => {
  const result = await send(state.mainRental)
  assert.equal(result.status, 200)
  assert.equal(result.body.agreement.version, 1)
  assert.match(result.body.link.url, /^https:\/\/api\.example\.com\/r\/[0-9a-f]{64}$/)
  assert.equal(result.body.statusWord, '待承租人確認')
  state.mainLink = result.body.link.url
})
test('協議沒有改動再發出，版本不變，舊連結作廢', async () => {
  const result = await send(state.mainRental)
  assert.equal(result.body.agreement.version, 1)
  assert.equal((await raw(`/r/${state.mainLink.split('/r/')[1]}`)).status, 404)
  state.mainLink = result.body.link.url
})
test('協議沒有改動只重發連結，不用再簽名', async () => {
  const result = await send(state.mainRental, null)
  assert.equal(result.status, 200); assert.equal(result.body.agreement.version, 1)
  assert.equal(result.body.agreement.lessorSigned.name, 'client')
  state.mainLink = result.body.link.url
})
test('承租人看到的是發出的版本，不是之後改的稿', async () => {
  assert.equal((await client(`/my/rentals/${state.mainRental}/agreement`, 'PUT', { body: '未發出的新稿' })).status, 200)
  assert.equal((await client(`/my/rentals/${state.mainRental}`)).body.agreement.changed, true)
  const token = state.mainLink.split('/r/')[1]
  const verified = await raw(`/r/${token}/verify`, 'POST', 'tail=6789')
  const page = await raw(verified.headers.location.replace('https://x', ''))
  assert.match(page.text, /出租協議（第 1 版）/)
  assert.match(page.text, /兩地牌照出租協議/)
  assert.doesNotMatch(page.text, /未發出的新稿/)
  assert.match(page.text, /網上確認與簽署具同等效力/)
})
test('改了協議再發出一定要重新簽名', async () => {
  assert.equal((await send(state.mainRental, null)).status, 400)
  assert.equal((await client(`/my/rentals/${state.mainRental}`)).body.agreement.version, 1)
})
test('改了協議再發出：升為第 2 版，承租人要重新確認', async () => {
  const result = await send(state.mainRental)
  assert.equal(result.body.agreement.version, 2)
  assert.equal(result.body.agreement.confirmed, false)
  state.mainLink = result.body.link.url
})

// —— 狀態：確認、待換車、出租中 ——
test('承租人沒有簽名不能同意，也不記錄確認', async () => {
  const token = state.mainLink.split('/r/')[1]
  const verified = await raw(`/r/${token}/verify`, 'POST', 'tail=6789')
  const key = new URL(verified.headers.location, 'https://x').searchParams.get('k')
  for (const extra of ['', '&signature=', `&signature=${encodeURIComponent('data:image/png;base64,AAAA')}`]) {
    const result = await raw(`/r/${token}/acknowledge`, 'POST', `key=${key}&name=${encodeURIComponent('承租人乙')}${extra}`)
    assert.equal(result.status, 400); assert.match(result.text, /請在簽名框內簽名/)
  }
  assert.equal((await client(`/my/rentals/${state.mainRental}`)).body.agreement.confirmed, false)
})
test('承租人頁有簽名框，並顯示出租人已簽、承租人未簽', async () => {
  const token = state.mainLink.split('/r/')[1]
  const verified = await raw(`/r/${token}/verify`, 'POST', 'tail=6789')
  const page = (await raw(verified.headers.location.replace('https://x', ''))).text
  assert.match(page, /<canvas id="pad">/)
  // 簽名相片要是真正的 PNG（base64 以 iVBORw0KGgo 開頭），不是一串數字
  assert.match(page, /出租人簽署<\/span><img alt="出租人簽名" src="data:image\/png;base64,iVBORw0KGgo/)
  assert.match(page, /承租人簽署<\/span><div class="sign-blank"><\/div><span class="muted">未簽/)
})
test('沒有手續的出租：承租人確認後直接出租中，牌照改為出租中，並通知客戶', async () => {
  assert.equal((await confirmAsRenter(state.mainLink)).status, 303)
  const detail = (await client(`/my/rentals/${state.mainRental}`)).body
  assert.equal(detail.statusWord, '出租中')
  assert.equal(detail.agreement.confirmedBy, '承租人乙')
  assert.equal(state.db.prepare('SELECT usage_status FROM plate_assets WHERE id=?').get(state.plates.main).usage_status, '出租中')
  assert.ok(state.db.prepare("SELECT 1 FROM notifications WHERE customer_id=? AND kind='rental' AND title LIKE '%已開始出租'").get(state.first))
})
test('承租人同意後，協議下方顯示雙方簽名', async () => {
  const token = state.mainLink.split('/r/')[1]
  const verified = await raw(`/r/${token}/verify`, 'POST', 'tail=6789')
  const page = (await raw(verified.headers.location.replace('https://x', ''))).text
  assert.match(page, /承租人簽署<\/span><img alt="承租人簽名" src="data:image\/png;base64,iVBORw0KGgo/)
  assert.match(page, /承租人乙 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
})
test('客戶可以看雙方的簽名相片，別的客戶不行', async () => {
  for (const party of ['lessor', 'renter']) {
    const image = await client(`/my/rentals/${state.mainRental}/signature-${party}`)
    assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/png')
    assert.equal((await api(`/my/rentals/${state.mainRental}/signature-${party}`, 'GET', undefined, 'client2')).status, 404)
  }
  assert.equal((await client(`/my/rentals/${state.mainRental}/signature-someone`)).status, 404)
})
test('起租日已過才可以使用時，起租日改為可以使用的那天', async () => {
  const id = (await client(`/my/plates/${state.plates.plain}/rentals`, 'POST', form({ useCurrentVehicle: true, driverIds: [], newDriverName: '丁司機', startsOn: shift(-10), procedures: { driver: 'client' } }))).body.id
  state.plainRental = id
  await confirmAsRenter((await send(id)).body.link.url)
  assert.equal((await client(`/my/rentals/${id}`)).body.statusWord, '待換車')
  state.db.prepare("INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', state.first, state.plates.plain, 'driver_change', hk(), '{}', '待核對', new Date().toISOString())
  const detail = (await client(`/my/rentals/${id}`)).body
  assert.equal(detail.statusWord, '出租中')
  assert.equal(detail.startsOn, hk())
})
test('有手續未辦妥：承租人確認後是待換車，並通知客戶', async () => {
  await confirmAsRenter((await send(state.selfRental)).body.link.url)
  assert.equal((await client(`/my/rentals/${state.selfRental}`)).body.statusWord, '待換車')
  assert.ok(state.db.prepare("SELECT 1 FROM notifications WHERE customer_id=? AND kind='rental' AND title LIKE '%已確認出租協議'").get(state.first))
  assert.equal(state.db.prepare('SELECT usage_status FROM plate_assets WHERE id=?').get(state.plates.selfDo).usage_status, '自用')
})
test('只辦妥一項手續仍是待換車', async () => {
  state.db.prepare("UPDATE requests SET status='已完成' WHERE plate_asset_id=? AND title LIKE '出租換司機%'").run(state.plates.selfDo)
  assert.equal((await client(`/my/rentals/${state.selfRental}`)).body.statusWord, '待換車')
})
test('被退回的自行辦理回報不算辦妥', async () => {
  state.db.prepare("INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', state.first, state.plates.selfDo, 'vehicle_change', hk(), '{}', '已退回', new Date().toISOString())
  assert.equal((await client(`/my/rentals/${state.selfRental}`)).body.statusWord, '待換車')
})
test('換車、換司機都辦妥後轉為出租中', async () => {
  state.db.prepare("INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(randomUUID(), 'default', state.first, state.plates.selfDo, 'vehicle_change', hk(), '{}', '待核對', new Date().toISOString())
  const detail = (await client(`/my/rentals/${state.selfRental}`)).body
  assert.equal(detail.statusWord, '出租中')
  assert.ok(detail.procedures.every(item => item.state === 'done'))
})
test('出租中的協議改了再發出，未重新確認前仍是出租中', async () => {
  assert.equal((await client(`/my/rentals/${state.selfRental}/agreement`, 'PUT', { body: '補充條款' })).status, 200)
  const result = await send(state.selfRental)
  assert.equal(result.body.agreement.confirmed, false)
  assert.equal(result.body.statusWord, '出租中')
})
test('協議改版後，承租人在新版要重新簽名', async () => {
  const detail = (await client(`/my/rentals/${state.selfRental}`)).body
  assert.equal(detail.agreement.version, 2)
  assert.ok(detail.agreement.lessorSigned)
  assert.equal(detail.agreement.renterSigned, null)
  assert.equal((await client(`/my/rentals/${state.selfRental}/signature-renter`)).status, 404)
})

// —— 取消、簽署本 ——
test('出租開始後客戶不能自行取消', async () => {
  assert.match((await client(`/my/rentals/${state.mainRental}/cancel`, 'POST', {})).body.error, /聯絡你的顧問/)
})
test('未開始的出租可以取消，連結作廢，牌照可以重新新增', async () => {
  const result = await client(`/my/rentals/${state.agentRental}/cancel`, 'POST', {})
  assert.equal(result.status, 200)
  assert.equal(result.body.statusWord, '已取消')
  assert.equal((await client(`/my/rentals/${state.agentRental}/cancel`, 'POST', {})).status, 409)
  assert.equal((await client(`/my/plates/${state.plates.agent}/rental-options`)).body.allowed, true)
})
test('上傳簽署本只接受相片或 PDF', async () => {
  assert.equal((await client(`/my/rentals/${state.mainRental}/signed`, 'POST', { data: Buffer.from('not a file').toString('base64') })).status, 400)
  assert.equal((await client(`/my/rentals/${state.mainRental}/signed`, 'POST', {})).status, 400)
  assert.equal((await client(`/my/rentals/${state.mainRental}/signed`, 'GET')).status, 404)
})
test('上傳簽署本後可以下載', async () => {
  const result = await client(`/my/rentals/${state.mainRental}/signed`, 'POST', { data: PNG })
  assert.equal(result.status, 200)
  assert.equal(result.body.signed, true)
  const file = await client(`/my/rentals/${state.mainRental}/signed`)
  assert.equal(file.status, 200); assert.equal(file.headers['content-type'], 'image/png')
})
test('客戶看不到別的客戶的出租', async () => {
  assert.equal((await api(`/my/rentals/${state.mainRental}`, 'GET', undefined, 'client2')).status, 404)
  assert.equal((await api(`/my/rentals/${state.mainRental}/send`, 'POST', {}, 'client2')).status, 404)
  assert.ok(!(await api('/my/rentals', 'GET', undefined, 'client2')).body.some(item => item.id === state.mainRental))
})
test('出租列表列出客戶自己新增、未發出的出租', async () => {
  const fresh = (await client(`/my/plates/${state.plates.agent}/rentals`, 'POST', form({ useCurrentVehicle: false, renterVehiclePlate: 'NEW1', driverIds: [], newDriverName: '新人' }))).body.id
  assert.ok((await client('/my/rentals')).body.some(item => item.id === fresh && item.sent === false))
})

// —— 後台：客戶新增出租 ——
test('後台列出客戶新增的出租和相關工單，員工可以按知道了', async () => {
  const list = (await api('/client-rentals', 'GET', undefined, 'staff')).body
  const row = list.find(item => item.id === state.selfRental)
  assert.ok(row)
  assert.equal(row.customerName, '牌主甲')
  assert.deepEqual(row.procedures.map(item => item.name), ['換車', '換司機'])
  assert.equal((await api(`/client-rentals/${state.selfRental}/seen`, 'POST', {}, 'staff')).status, 200)
  assert.ok(!(await api('/client-rentals')).body.some(item => item.id === state.selfRental))
})
test('客戶取消出租後重新出現在後台，讓員工知道', async () => {
  assert.equal((await api(`/client-rentals/${state.agentRental}/seen`, 'POST', {})).status, 200)
  const fresh = (await client('/my/rentals')).body.find(item => item.plateId === state.plates.agent && item.status === '草擬').id
  await client(`/my/rentals/${fresh}/cancel`, 'POST', {})
  assert.ok((await api('/client-rentals')).body.some(item => item.id === fresh && item.statusWord === '已取消'))
})
test('客戶不能用後台的客戶新增出租接口', async () => {
  assert.equal((await client('/client-rentals')).status, 403)
  assert.equal((await client(`/client-rentals/${state.mainRental}/seen`, 'POST', {})).status, 403)
})
test('別的租戶看不到也不能標記這個租戶的出租', async () => {
  assert.ok(!(await api('/client-rentals', 'GET', undefined, 'foreign-admin')).body.some(item => item.id === state.mainRental))
  assert.equal((await api(`/client-rentals/${state.mainRental}/seen`, 'POST', {}, 'foreign-admin')).status, 404)
})
test('員工的出租管理看得到客戶新增的出租和來源', async () => {
  const rows = (await api(`/rental-contracts?plateId=${state.plates.main}`)).body
  assert.equal(rows[0].source, 'client')
  assert.equal(rows[0].status, '生效')
})
test('出租中的牌照在客戶的牌照摘要顯示承租人', async () => {
  const summary = (await client(`/my/plates/${state.plates.main}`)).body
  assert.equal(summary.rental?.renter, '承租人乙')
})
