import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { recognizeCard, normalizeCardField } from '../src/card.js'

// 批文卡對準框（管理者 2026-10-18）：客戶端 CardCapture、後台 CardCropper 只上傳框內卡面（2030×1290 JPEG）。
// 這裏用真實樣本模擬「卡放在桌上用手機拍、再按框裁出卡面」，每種拍攝情況一個測試：必須讀對卡號（背面讀對內地車牌），
// 而且不可以有標為正常的錯誤值。
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cards')
const expected = JSON.parse(readFileSync(join(fixtures, 'expected.json'), 'utf8'))
const OUT_W = 2030, OUT_H = 1290, TABLE = '#6e5b47'

// 卡寬 cardWidth 像素的卡放在桌面中間（可傾斜），框比卡大 margin（每邊佔框寬的比例），裁出框內並輸出成上傳用的卡面
async function framed(file, { cardWidth = 1800, margin = 0, tilt = 0, photoWidth } = {}) {
  const card = await sharp(join(fixtures, file)).resize({ width: cardWidth }).rotate(tilt, { background: '#00000000' }).png().toBuffer()
  const meta = await sharp(card).metadata()
  const width = photoWidth || Math.round(cardWidth / 0.8), height = Math.round(width * 4 / 3)
  const photo = await sharp({ create: { width, height, channels: 3, background: TABLE } })
    .composite([{ input: card, left: Math.round((width - meta.width) / 2), top: Math.round((height - meta.height) / 2) }]).jpeg({ quality: 90 }).toBuffer()
  const frameWidth = Math.round(cardWidth / (1 - margin * 2)), frameHeight = Math.round(frameWidth * 645 / 1015)
  return sharp(photo).extract({ left: Math.round((width - frameWidth) / 2), top: Math.round((height - frameHeight) / 2), width: frameWidth, height: frameHeight })
    .resize(OUT_W, OUT_H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer()
}
// 比對規則與 ocr.test.js 的 sameValue 相同：正規化後忽略空白
const same = (field, left, right) => normalizeCardField(field, left || '').replace(/\s+/g, '') === normalizeCardField(field, right || '').replace(/\s+/g, '')
// 標為正常（ok）卻和原卡不同的欄位：比留空更危險
const confidentlyWrong = (result, values) => Object.entries(values).filter(([field, value]) => result.fieldStatus[field]?.status === 'ok' && result.cardData[field] && !same(field, result.cardData[field], value)).map(([field]) => `${field}: ${result.cardData[field]}`)
async function readFramed(file, options) {
  const side = file.includes('front') ? 'front' : 'back', result = await recognizeCard(await framed(file, options), side)
  const values = expected[file], correct = Object.entries(values).filter(([field, value]) => same(field, result.cardData[field], value)).length
  console.log(`${file} ${JSON.stringify(options || {})} 逐欄準確率：${correct}/${Object.keys(values).length} ${JSON.stringify(result.cardData)}`)
  return { result, values }
}

test('對準框：曲坤正面剛好對齊，讀對卡號', async () => {
  const { result, values } = await readFramed('1030381-front.png')
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：宜昌達正面剛好對齊，讀對卡號', async () => {
  const { result, values } = await readFramed('1034896-front.png')
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：四邊各留 2% 桌面，仍讀對卡號', async () => {
  const { result, values } = await readFramed('1030381-front.png', { margin: 0.02 })
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：卡片傾斜 1.5 度，仍讀對卡號', async () => {
  const { result, values } = await readFramed('1030381-front.png', { tilt: 1.5 })
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：高解像度手機相片（卡寬 2300 像素），讀對卡號', async () => {
  const { result, values } = await readFramed('1034896-front.png', { cardWidth: 2300 })
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：低解像度相片（卡寬 600 像素），讀對卡號', async () => {
  const { result, values } = await readFramed('1034896-front.png', { cardWidth: 600 })
  assert.equal(result.cardData.cardNumber, values.cardNumber)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：曲坤背面剛好對齊，讀對內地車牌', async () => {
  const { result, values } = await readFramed('1030381-back.png')
  assert.equal(result.cardData.mainlandPlate, values.mainlandPlate)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框：宜昌達背面（三位駕駛人）剛好對齊，讀對內地車牌', async () => {
  const { result, values } = await readFramed('1034896-back.png')
  assert.equal(result.cardData.mainlandPlate, values.mainlandPlate)
  assert.deepEqual(confidentlyWrong(result, values), [])
})
test('對準框卡面固定 2030×1290，即使原相片很大也不超過伺服器上限 3.5 MB', async () => {
  const image = await framed('1030381-front.png', { cardWidth: 3000, photoWidth: 4032 })
  const meta = await sharp(image).metadata()
  assert.deepEqual([meta.width, meta.height, meta.format], [OUT_W, OUT_H, 'jpeg'])
  assert.ok(image.length < 3500000, `卡面 ${image.length} bytes`)
})

// ── 經伺服器上傳：後台牌照頁、客戶新增牌照 ──
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'card-frame-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  state.db = db
  const stamp = new Date().toISOString()
  state.customer = randomUUID(); state.plate = randomUUID()
  db.prepare('INSERT INTO customers(id,name,kind,tenant_id,service_mode) VALUES (?,?,?,?,?)').run(state.customer, '對準框客戶', '公司', 'default', '自管')
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,card_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state.plate, state.customer, '粵港', '1030381', '{}', stamp, stamp)
  for (const [token, role, customer] of [['admin', 'admin', null], ['client', 'customer', state.customer]]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('ClientPass123'), customer, 'default', role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp)
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': '10.63.0.2' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const dataUrl = buffer => 'data:image/jpeg;base64,' + buffer.toString('base64')

test('後台上傳對準框卡面並讀取：讀對卡號、標為待核對、保存的正本就是這張卡面', async () => {
  const image = await framed('1030381-front.png')
  const result = await request(`/plate-assets/${state.plate}/card/front`, 'POST', { image: dataUrl(image), recognize: true })
  assert.equal(result.status, 200)
  assert.equal(result.body.cardData.cardNumber, '1030381')
  const row = state.db.prepare('SELECT card_status FROM plate_assets WHERE id=?').get(state.plate)
  assert.equal(row.card_status, '待核對')
  const saved = state.db.prepare("SELECT data FROM approval_card_images WHERE plate_asset_id=? AND side='front'").get(state.plate)
  assert.equal(Buffer.compare(Buffer.from(saved.data), image), 0)
})
test('客戶新增牌照時辨識對準框卡面：讀對卡號', async () => {
  const image = await framed('1034896-front.png')
  const result = await request('/card-recognize', 'POST', { side: 'front', image: dataUrl(image) }, 'client')
  assert.equal(result.status, 200)
  assert.equal(result.body.cardData.cardNumber, '1034896')
})
