import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  cardFields,
  extractValidityDates,
  normalizeCardField,
  recognizeCard,
  validateCardField
} from '../src/card.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures', 'cards')
const expectedPath = join(fixtures, 'expected.json')

const frontData = {
  cardNumber: '1030381',
  company: '曲坤有限公司',
  contractor: '深圳市曲坤软件技术服务有限公司',
  crossing: '深圳湾',
  serial: '00121698'
}
const backData = {
  mainlandPlate: '粵Z76L2港',
  localPlate: 'HK1234',
  driver1: '王振华',
  driver2: '何思时',
  driver3: '钟家德',
  currentApproval: '2025第0630016号',
  previousApproval: '2024第0447302号',
  color: '黑色',
  seats: '5座',
  purpose: '延期',
  validFrom: '2025-11-27',
  validTo: '2027-01-01',
  notes: '主司机:王振华(7378),副司机:何思时(4146),副司机:钟家德(6927)。'
}

function svgText(x, y, value, size = 25, weight = 600) {
  return `<text x="${x}" y="${y}" font-family="Arial, Noto Sans CJK TC, sans-serif" font-size="${size}" font-weight="${weight}" fill="#172c34">${value}</text>`
}

function makeCardSvg(side, data) {
  const labels = side === 'front'
    ? [
        svgText(45, 185, '編號:', 31, 500), svgText(45, 252, '商號:', 31, 500),
        svgText(45, 410, '內承單位:', 31, 500), svgText(45, 530, '通行口岸:', 31, 500),
        svgText(735, 596, '流水號:', 31, 500)
      ]
    : [
        svgText(45, 78, '內地車牌號:', 28, 500), svgText(45, 142, '港澳車牌號:', 28, 500),
        svgText(45, 194, '駕駛人:', 28, 500), svgText(45, 251, '2.', 28, 500), svgText(45, 308, '3.', 28, 500),
        svgText(575, 78, '現批文號:', 28, 500), svgText(575, 142, '原批文號:', 28, 500),
        svgText(575, 194, '顏色:', 28, 500), svgText(575, 251, '座位/噸位:', 28, 500),
        svgText(45, 350, '請予辦理:', 28, 500), svgText(45, 450, '有效期:', 28, 500), svgText(45, 520, '備註:', 28, 500)
      ]
  const values = side === 'front'
    ? [
        svgText(215, 190, data.cardNumber, 50, 700), svgText(215, 255, data.company, 48, 700),
        svgText(215, 410, data.contractor, 48, 700), svgText(215, 530, data.crossing, 48, 700),
        svgText(795, 596, data.serial, 48, 700)
      ]
    : [
        svgText(215, 83, data.mainlandPlate, 50, 700), svgText(215, 147, data.localPlate, 50, 700),
        svgText(244, 205, data.driver1, 50, 700), svgText(244, 262, data.driver2, 50, 700), svgText(244, 319, data.driver3, 50, 700),
        svgText(677, 83, data.currentApproval, 38, 700), svgText(677, 147, data.previousApproval, 38, 700),
        svgText(685, 205, data.color, 50, 700), svgText(687, 262, data.seats, 50, 700),
        svgText(201, 360, data.purpose, 50, 700), svgText(195, 460, `${data.validFrom} 至 ${data.validTo}`, 38, 700),
        svgText(197, 520, data.notes, 30, 700)
      ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2026" height="1286" viewBox="0 0 1013 643"><rect width="1013" height="643" rx="28" fill="#eaf4f7" stroke="#7d9aa1" stroke-width="3"/><rect x="14" y="14" width="985" height="615" rx="20" fill="none" stroke="#bad2d7" stroke-width="2"/>${labels.join('')}${values.join('')}</svg>`
}

async function makeSyntheticCards() {
  const front = await sharp(Buffer.from(makeCardSvg('front', frontData))).png().toBuffer()
  const back = await sharp(Buffer.from(makeCardSvg('back', backData))).png().toBuffer()
  const degrade = async image => sharp(image)
    .resize({ width: 507, height: 322, fit: 'fill' })
    .blur(1.2)
    .rotate(2, { background: '#ffffff' })
    .extend({ top: 30, bottom: 20, left: 42, right: 18, background: '#ffffff' })
    .jpeg({ quality: 40 })
    .toBuffer()
  return { front, back, degradedFront: await degrade(front), degradedBack: await degrade(back) }
}

function combine(...values) {
  const result = Object.fromEntries(cardFields.map(key => [key, '']))
  for (const valuesObject of values) for (const [key, value] of Object.entries(valuesObject)) if (value) result[key] = value
  return result
}

// Spacing inside names and notes varies between OCR runs and is not an error.
const sameValue = (field, got, want) => normalizeCardField(field, got).replace(/\s+/g, '') === normalizeCardField(field, want).replace(/\s+/g, '')

// A wrong value is acceptable only when it is flagged for staff; a wrong value marked 'ok' is not.
function confidentlyWrong(recognized, expected) {
  return Object.entries(expected).filter(([field, value]) => cardFields.includes(field) && recognized.cardData[field]
    && !sameValue(field, recognized.cardData[field], value)
    && recognized.fieldStatus?.[field]?.status === 'ok').map(([field]) => [field, recognized.cardData[field]])
}

function nonEmptyEntries(data) {
  return Object.entries(data).filter(([, value]) => value !== '')
}

function sampleCases(expected) {
  const result = []
  const files = readdirSync(fixtures).filter(file => /\.(png|jpe?g|webp)$/i.test(file))
  const lookup = (file, side) => {
    const stem = file.replace(/\.[^.]+$/, '')
    const cardId = stem.replace(/-(front|back)$/i, '')
    return expected[file] || expected[stem] || expected[cardId]?.[side] || expected.cards?.[cardId]?.[side] || expected.samples?.[file] || expected.samples?.[cardId]?.[side]
  }
  for (const file of files) {
    const side = file.includes('-back') ? 'back' : file.includes('-front') ? 'front' : null
    const values = side && lookup(file, side)
    if (side && values && typeof values === 'object') result.push({ file, side, values })
  }
  return result
}

test('OCR validators normalize and reject invalid values for every card field', () => {
  const cases = {
    cardNumber: ['1030381', '12345'],
    company: ['曲坤有限公司(QUKUN CO., LIMITED)', '2宣昌达 En'],
    contractor: ['深圳市曲坤软件技术服务有限公司', 'TI大桥'],
    crossing: ['深圳灣', '不存在口岸'],
    serial: ['00121698', '12345'],
    mainlandPlate: ['粤Z76L2港', '锣77RA!D港'],
    localPlate: ['HK1234', 'H K 123456789'],
    driver1: ['王振華', '委交村'],
    driver2: ['李小明', '站人攻'],
    driver3: ['鐘家德', '王振華五六'],
    currentApproval: ['2025第0630016號', '2025第1234号'],
    previousApproval: ['2024第0447302号', '2024-0447302'],
    color: ['黑色', '人'],
    seats: ['5座', '座'],
    purpose: ['延期', '区期'],
    validFrom: ['2025/11/27', '2025-02-30'],
    validTo: ['2027.01.01', '2027-13-01'],
    notes: ['主司机:王振华(7378),副司机:何思时(4146)', 'Eee']
  }
  for (const field of cardFields) {
    const [valid, invalid] = cases[field]
    const normalized = normalizeCardField(field, valid)
    assert.equal(validateCardField(field, normalized, { route: field === 'localPlate' ? '粵港' : undefined }), true, field)
    assert.equal(validateCardField(field, normalizeCardField(field, invalid), { route: field === 'localPlate' ? '粵港' : undefined }), false, field)
  }
  assert.deepEqual(extractValidityDates('有效期：2025-11-27 至 2027-01-01'), { validFrom: '2025-11-27', validTo: '2027-01-01' })
  assert.deepEqual(extractValidityDates('2027-01-01 至 2025-11-27'), { validFrom: '', validTo: '' })
})

test('synthetic approval cards never return confidently wrong values', async () => {
  const cards = await makeSyntheticCards()
  const runs = {
    original: [await recognizeCard(cards.front, 'front'), await recognizeCard(cards.back, 'back')],
    degraded: [await recognizeCard(cards.degradedFront, 'front'), await recognizeCard(cards.degradedBack, 'back')]
  }
  for (const [name, [front, back]] of Object.entries(runs)) {
    assert.deepEqual([...confidentlyWrong(front, frontData), ...confidentlyWrong(back, backData)], [], `${name} 有標為正常的錯誤值`)
    const combined = combine(front.cardData, back.cardData)
    for (const [field, value] of nonEmptyEntries(combined)) assert.equal(validateCardField(field, value, { route: '粵港' }), true, `${name} ${field} 輸出未通過驗證：${value}`)
    const fields = nonEmptyEntries(combine(frontData, backData))
    const correct = fields.filter(([field, value]) => sameValue(field, combined[field], value)).length
    console.log(`合成${name === 'original' ? '原圖' : '劣化圖'}逐欄準確率：${correct}/${fields.length}`)
    if (name === 'original') assert.ok(correct / fields.length >= 0.7, `合成原圖準確率過低：${correct}/${fields.length}`)
  }
})

test('real card fixtures never return confidently wrong values', async t => {
  if (!existsSync(fixtures) || !existsSync(expectedPath)) {
    console.log('未提供真實樣本')
    return
  }
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
  const cases = sampleCases(expected)
  assert.ok(cases.length > 0, 'expected.json 未提供可辨識的真實樣本對照')
  for (const sample of cases) {
    await t.test(`${sample.file} ${sample.side} 逐欄比對`, async () => {
      const recognized = await recognizeCard(join(fixtures, sample.file), sample.side, { debug: Boolean(process.env.OCR_DEBUG) })
      console.log(`真實樣本辨識結果 ${sample.file}: ${JSON.stringify(recognized.cardData)}`)
      console.log(`真實樣本預期 ${sample.file}: ${JSON.stringify(sample.values)}`)
      const fields = Object.entries(sample.values).filter(([field]) => cardFields.includes(field))
      const failures = fields.filter(([field, value]) => !sameValue(field, recognized.cardData[field], value))
      const correct = fields.length - failures.length
      console.log(`真實樣本 ${sample.file} 逐欄準確率：${correct}/${fields.length}（${(correct / fields.length * 100).toFixed(1)}%）`)
      assert.deepEqual(confidentlyWrong(recognized, sample.values), [], `${sample.file} 有標為正常的錯誤值`)
    })
  }
})
