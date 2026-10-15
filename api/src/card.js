import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const tessdataPath = resolve(dirname(fileURLToPath(import.meta.url)), '../tessdata')
const TEMPLATE_WIDTH = 1015
const TEMPLATE_HEIGHT = 645
const MAX_CONFIDENCE = 100

export const cardFields = ['cardNumber','company','contractor','crossing','serial','mainlandPlate','localPlate','driver1','driver2','driver3','currentApproval','previousApproval','color','seats','purpose','validFrom','validTo','notes']

const rectangles = {
  front: {
    cardNumber: { left: 205, top: 148, width: 270, height: 60 },
    company: { left: 206, top: 213, width: 750, height: 62 },
    contractor: { left: 204, top: 368, width: 630, height: 80 },
    crossing: { left: 202, top: 488, width: 260, height: 65 },
    serial: { left: 770, top: 554, width: 220, height: 60 }
  },
  back: {
    mainlandPlate: { left: 210, top: 37, width: 320, height: 66 },
    localPlate: { left: 210, top: 101, width: 320, height: 64 },
    driver1: { left: 244, top: 153, width: 300, height: 59 },
    driver2: { left: 244, top: 210, width: 300, height: 59 },
    driver3: { left: 244, top: 267, width: 300, height: 59 },
    currentApproval: { left: 677, top: 39, width: 336, height: 64 },
    previousApproval: { left: 677, top: 101, width: 336, height: 63 },
    color: { left: 685, top: 157, width: 210, height: 58 },
    seats: { left: 687, top: 216, width: 210, height: 58 },
    purpose: { left: 201, top: 312, width: 220, height: 72 },
    validity: { left: 195, top: 412, width: 540, height: 75 },
    notes: { left: 197, top: 481, width: 760, height: 110 }
  }
}

const fieldConfig = {
  cardNumber: { language: 'eng', whitelist: '0123456789', psm: '7' },
  serial: { language: 'eng', whitelist: '0123456789', psm: '7' },
  mainlandPlate: { language: 'chi_sim', whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789粵粤港澳', psm: '7' },
  localPlate: { language: 'eng', whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', psm: '7' },
  currentApproval: { language: 'chi_sim', whitelist: '0123456789第号號ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', psm: '7' },
  previousApproval: { language: 'chi_sim', whitelist: '0123456789第号號ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', psm: '7' },
  validFrom: { language: 'eng', whitelist: '0123456789-/.至年月日', psm: '7' },
  validTo: { language: 'eng', whitelist: '0123456789-/.至年月日', psm: '7' },
  driver1: { language: 'chi_sim', whitelist: '', psm: '7' },
  driver2: { language: 'chi_sim', whitelist: '', psm: '7' },
  driver3: { language: 'chi_sim', whitelist: '', psm: '7' },
  company: { language: 'chi_sim', whitelist: '', psm: '7' },
  contractor: { language: 'chi_sim', whitelist: '', psm: '7' },
  crossing: { language: 'chi_sim', whitelist: '', psm: '7' },
  color: { language: 'chi_sim', whitelist: '', psm: '7' },
  seats: { language: 'chi_sim', whitelist: '0123456789.座噸吨T', psm: '7' },
  purpose: { language: 'chi_sim', whitelist: '', psm: '7' },
  notes: { language: 'chi_sim', whitelist: '', psm: '6' }
}

const knownPorts = ['大橋', '大桥', '深圳灣', '深圳湾', '蓮塘', '莲塘', '皇崗', '皇岗', '落馬洲', '落马洲', '文錦渡', '文锦渡', '沙頭角', '沙头角', '拱北', '橫琴', '横琴', '港珠澳大橋', '港珠澳大桥']
const knownPurposes = ['延期', '新辦', '新办', '換車', '换车', '變更駕駛人', '变更驾驶人', '補辦', '补办', '註銷', '注销', '變更', '变更']
const colors = new Map([['黑色', '黑'], ['白色', '白'], ['灰色', '灰'], ['銀色', '銀'], ['银色', '银'], ['紅色', '紅'], ['红色', '红'], ['藍色', '藍'], ['蓝色', '蓝'], ['黃色', '黃'], ['黄色', '黄'], ['綠色', '綠'], ['绿色', '绿'], ['棕色', '棕'], ['金色', '金'], ['紫色', '紫'], ['橙色', '橙']])
// Common surnames (simplified and traditional). A driver name whose first character is not a
// surname is far more likely to be OCR noise than a real name, so it is rejected.
const surnames = new Set([...'王李张張刘劉陈陳杨楊黄黃赵趙吴吳周徐孙孫马馬朱胡郭何高林罗羅郑鄭梁谢謝宋唐许許韩韓冯馮邓鄧曹彭曾肖萧蕭田董袁潘于蒋蔣蔡余杜叶葉程苏蘇魏吕呂丁任沈姚卢盧姜崔钟鐘谭譚陆陸汪范金石廖贾賈夏韦韋付方白邹鄒孟熊秦邱江尹薛闫閻段雷侯龙龍史陶黎贺賀顾顧毛郝龚龔邵万萬钱錢严嚴覃武戴莫孔向汤湯麦麥区區温溫冼岑翁容欧歐伍甘练練骆駱凌柯关關游卓'])
const hanRatio = value => { const chars = String(value).replace(/\s/g, ''); return chars ? (chars.match(/[\u3400-\u9fff]/g) || []).length / chars.length : 0 }
const onlyHan = value => (String(value).match(/[\u3400-\u9fff]/g) || []).join('')
const traditionalToSimplified = value => String(value ?? '').replace(/[華]/g, '华').replace(/[鐘]/g, '钟').replace(/[廣]/g, '广').replace(/[東]/g, '东').replace(/[廳]/g, '厅').replace(/[灣]/g, '湾').replace(/[橋]/g, '桥').replace(/[號]/g, '号').replace(/[門]/g, '门').replace(/[內]/g, '内').replace(/[承]/g, '承').replace(/[單]/g, '单').replace(/[駕]/g, '驾').replace(/[駛]/g, '驶').replace(/[顏]/g, '颜').replace(/[色]/g, '色').replace(/[請]/g, '请').replace(/[辦]/g, '办').replace(/[備]/g, '备').replace(/[註]/g, '注').replace(/[冊]/g, '册')
const simplify = value => traditionalToSimplified(value).replace(/繁體|繁体/g, '')
const tidy = value => simplify(value).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').replace(/^[：:，,;；\s]+/, '').trim()
const compact = value => tidy(value).replace(/[\s·•,，;；:：]/g, '')
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const emptyCard = () => Object.fromEntries(cardFields.map(key => [key, '']))

export function cardData(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return Object.fromEntries(cardFields.map(key => [key, String(parsed?.[key] ?? '')]))
  } catch {
    return emptyCard()
  }
}

export function cleanCard(input) {
  return Object.fromEntries(cardFields.map(key => [key, String(input?.[key] ?? '').trim().slice(0, key === 'notes' ? 500 : 150)]))
}

function normalizeDate(value) {
  const match = tidy(value).match(/(20\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?/)
  if (!match) return ''
  const [, year, month, day] = match
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` ? '' : date.toISOString().slice(0, 10)
}

export function extractValidityDates(value) {
  const dates = [...tidy(value).matchAll(/20\d{2}\s*[.\-/年]\s*\d{1,2}\s*[.\-/月]\s*\d{1,2}\s*日?/g)].map(match => normalizeDate(match[0])).filter(Boolean)
  if (dates.length !== 2 || dates[0] >= dates[1]) return { validFrom: '', validTo: '' }
  return { validFrom: dates[0], validTo: dates[1] }
}

function normalizeApproval(value) {
  const text = compact(value).replace(/號/g, '号').replace(/[Oo]/g, '0').replace(/[Il]/g, '1')
  const match = text.match(/(20\d{2})第([0-9]{7})号?/)
  return match ? `${match[1]}第${match[2]}号` : ''
}

export function normalizeCardField(key, value) {
  const text = tidy(value)
  if (['cardNumber', 'serial'].includes(key)) {
    const wanted = key === 'serial' ? 8 : 7
    const candidates = text.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').match(/\d{6,8}/g) || []
    const match = candidates.find(item => item.length === wanted || (key === 'serial' && item.length === 7) || (key === 'cardNumber' && item.length >= 6)) || ''
    return key === 'serial' && match.length === 7 ? `0${match}` : match
  }
  if (key === 'company' || key === 'contractor') return text.replace(/[，、]/g, ',').replace(/\bC0\b/gi, 'CO').replace(/\s+([,.)])/g, '$1').replace(/([(.])\s+/g, '$1').replace(/\s+/g, ' ').replace(/\s+(?=[\u4e00-\u9fff])/g, '').replace(/(?<=[\u4e00-\u9fff])\s+(?=[A-Za-z])/g, ' ')
  // Mainland plates never use the letters I and O, so those are misread digits.
  if (key === 'mainlandPlate') return compact(text).toUpperCase().replace(/^粤/, '粵').replace(/[洪鸿]/g, '港').replace(/^(粵Z)(.*)([港澳])$/, (all, head, body, tail) => head + body.replace(/I/g, '1').replace(/O/g, '0') + tail)
  if (key === 'localPlate') return compact(text).toUpperCase()
  if (key.startsWith('driver')) return text.replace(/\s+/g, '')
  if (key === 'currentApproval' || key === 'previousApproval') return normalizeApproval(text)
  if (key === 'color') return colors.get(text.replace(/\s+/g, '')) || text.replace(/\s+/g, '').replace(/[;；]$/, '')
  if (key === 'seats') return compact(text).replace(/噸/g, '吨')
  if (key === 'crossing' || key === 'purpose') return text.replace(/[;；]$/, '').replace(/\s+/g, '')
  if (key === 'validFrom' || key === 'validTo') return normalizeDate(text)
  // OCR spaces out Chinese characters; spaces between them carry no meaning.
  if (key === 'notes') return text.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '').replace(/\s*([:：,，()（）])\s*/g, '$1').replace(/^注[,，:：]?/, '')
  return text
}

export const normalize = normalizeCardField

function validDateValue(value) {
  const date = new Date(`${value}T00:00:00Z`)
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateCardField(key, value, context = {}) {
  const text = normalizeCardField(key, value)
  if (!text) return false
  if (key === 'cardNumber') return /^\d{6,8}$/.test(text)
  if (key === 'serial') return /^\d{8}$/.test(text)
  if (key === 'mainlandPlate') return /^粵Z[A-Z0-9]{4}[港澳]$/.test(text)
  if (key === 'localPlate') return /^[A-Z0-9]{1,8}$/.test(text) && (!context.route?.endsWith('澳') || text.startsWith('M'))
  if (['currentApproval', 'previousApproval'].includes(key)) return /^20\d{2}第\d{7}号$/.test(text)
  if (key === 'color') return [...colors.values()].includes(text) || [...colors.keys()].includes(text)
  if (key === 'seats') return /^\d+(?:\.\d+)?(?:座|吨|T)$/.test(text)
  if (key.startsWith('driver')) return /^[\u3400-\u9fff]{2,4}$/.test(text) && surnames.has(text[0])
  if (key === 'crossing') return knownPorts.includes(onlyHan(text)) && onlyHan(text).length === text.replace(/\s/g, '').length
  if (key === 'purpose') return knownPurposes.includes(text)
  if (key === 'validFrom' || key === 'validTo') return validDateValue(text)
  if (key === 'company') return /^[\u3400-\u9fffA-Za-z0-9（）()·\-.,，、&\s]{4,150}$/.test(text) && /^[\u3400-\u9fff]/.test(text) && (/公司/.test(text) || /LIMITED/i.test(text))
  if (key === 'contractor') return /^[\u3400-\u9fff（）()]{6,80}$/.test(text) && /公司$/.test(text)
  if (key === 'notes') return /^[\u3400-\u9fffA-Za-z0-9（）()\-，,：:；;。\s]{6,500}$/.test(text) && /司机|驾驶/.test(text) && hanRatio(text.replace(/[\d()（）:：,，;；。\-]/g, '')) >= 0.6
  if (key === 'validity') return Boolean(extractValidityDates(text).validFrom)
  return false
}

export const validate = validateCardField

function confidenceValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? clamp(Math.round(number), 0, MAX_CONFIDENCE) : 0
}

function makeFieldStatus(value, confidence, attempted = true) {
  if (!attempted) return undefined
  if (!value) return { value: '', status: 'failed', confidence: confidenceValue(confidence) }
  return { value, status: confidenceValue(confidence) >= 70 ? 'ok' : 'uncertain', confidence: confidenceValue(confidence) }
}

function wordsFromBlocks(blocks) {
  const words = []
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) for (const word of line.words || []) words.push(word)
  return words
}

function linesFromBlocks(blocks) {
  const lines = []
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) lines.push(line)
  return lines
}

const labelAliases = {
  front: { cardNumber: ['编号', '編號'], company: ['商号', '商號'], contractor: ['内承单位', '內承單位'], crossing: ['通行口岸'], serial: ['流水号', '流水號'] },
  back: { mainlandPlate: ['内地车牌号', '內地車牌號'], localPlate: ['港澳车牌号', '港澳車牌號'], driver1: ['驾驶人', '駕駛人'], currentApproval: ['现批文号', '現批文號'], previousApproval: ['原批文号', '原批文號'], color: ['颜色', '顏色'], seats: ['座位/吨位', '座位／噸位'], purpose: ['请予办理', '請予辦理'], validity: ['有效期', '有效期'], notes: ['备注', '備註'] }
}

function normalizeLabel(value) {
  return compact(value).replace(/[号號]/g, '号').replace(/[单單]/g, '單')
}

function locateFieldRectangles(side, lines) {
  const located = Object.fromEntries(Object.entries(rectangles[side]).map(([key, rect]) => [key, { ...rect }]))
  const aliases = labelAliases[side]
  for (const line of lines) {
    const lineText = normalizeLabel(line.text)
    const aliasEntry = Object.entries(aliases).find(([, names]) => names.some(name => lineText.includes(normalizeLabel(name))))
    if (!aliasEntry || !line.bbox) continue
    const [field] = aliasEntry
    const rect = located[field]
    if (!rect) continue
    if (line.bbox.x1 < rect.left - 8) {
      const rightEdge = clamp(line.bbox.x1 + 12, rect.left, rect.left + Math.min(100, rect.width / 2))
      rect.left = rightEdge
      rect.width = Math.max(40, Math.min(rect.width - (rightEdge - rectangles[side][field].left), TEMPLATE_WIDTH - rect.left - 2))
    }
  }
  return located
}

async function prepareVariants(image) {
  const source = await sharp(image).rotate().trim({ background: { r: 255, g: 255, b: 255, alpha: 1 }, threshold: 5 }).png().toBuffer()
  const rawSource = await sharp(image).rotate().png().toBuffer()
  const make = (angle, enhanced, threshold) => {
    let pipeline = sharp(source).rotate(angle, { background: '#ffffff' }).trim({ background: '#ffffff', threshold: 5 }).resize({ width: TEMPLATE_WIDTH * 2, height: TEMPLATE_HEIGHT * 2, fit: 'fill' })
    if (enhanced) pipeline = pipeline.grayscale().normalise().linear(1.18, -18).sharpen({ sigma: 1.1 })
    if (threshold) pipeline = pipeline.grayscale().normalise().threshold(185)
    return pipeline.png().toBuffer()
  }
  const variants = []
  variants.push({ name: 'raw', scale: 2, buffer: await sharp(rawSource).resize({ width: TEMPLATE_WIDTH * 2, height: TEMPLATE_HEIGHT * 2, fit: 'fill' }).png().toBuffer() })
  for (const [name, angle] of [['enhanced', 0], ['deskew-left', -2], ['deskew-right', 2]]) variants.push({ name, scale: 2, buffer: await make(angle, true, false) })
  variants.push({ name: 'threshold', scale: 2, buffer: await make(0, false, true) })
  return variants
}

async function recognizeLayout(worker, variant) {
  await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' })
  return worker.recognize(variant.buffer, {}, { text: true, blocks: true })
}

async function recognizeCandidate(worker, variant, field, rectangle, psm) {
  const config = fieldConfig[field] || { language: 'chi_sim', whitelist: '', psm: '7' }
  await worker.setParameters({ tessedit_pageseg_mode: psm || config.psm, tessedit_char_whitelist: config.whitelist, preserve_interword_spaces: '1' })
  const scaled = Object.fromEntries(Object.entries(rectangle).map(([key, value]) => [key, Math.round(value * variant.scale)]))
  const result = await worker.recognize(variant.buffer, { rectangle: scaled })
  return { raw: result.data.text, confidence: confidenceValue(result.data.confidence) }
}

function extractDriverNames(notes) {
  const names = []
  const pattern = /(?:主|副)?\s*司\s*机\s*[:：]?\s*([\u3400-\u9fff]{2,4})/g
  for (const match of String(notes || '').matchAll(pattern)) if (!names.includes(match[1]) && surnames.has(match[1][0])) names.push(match[1])
  return names
}

function chooseCandidate(field, candidates, context) {
  const valid = []
  for (const candidate of candidates) {
    const value = normalizeCardField(field, candidate.raw)
    if (validateCardField(field, value, context)) valid.push({ value, confidence: candidate.confidence })
  }
  const counts = new Map(valid.map(candidate => [candidate.value, 0]))
  for (const candidate of valid) counts.set(candidate.value, counts.get(candidate.value) + 1)
  valid.sort((left, right) => counts.get(right.value) - counts.get(left.value) || right.confidence - left.confidence)
  if (valid[0]) return { value: valid[0].value, confidence: valid[0].confidence }
  return { value: '', confidence: Math.max(0, ...candidates.map(candidate => candidate.confidence)) }
}

function layoutCandidates(field, lines) {
  const candidates = []
  const aliases = {
    company: ['商号', '商號'], contractor: ['内承单位', '內承單位'], crossing: ['通行口岸'],
    mainlandPlate: ['内地车牌号', '內地車牌號'], localPlate: ['港澳车牌号', '港澳車牌號'],
    currentApproval: ['现批文号', '現批文號'], previousApproval: ['原批文号', '原批文號'],
    color: ['颜色', '顏色'], seats: ['座位/吨位', '座位／噸位'], purpose: ['请予办理', '請予辦理'], validity: ['有效期'], notes: ['备注', '備註']
  }
  const valueAfterLabel = (text, names) => {
    const normalized = normalizeLabel(text)
    const label = names.find(name => normalized.includes(normalizeLabel(name)))
    if (!label) return ''
    const index = normalized.indexOf(normalizeLabel(label))
    return normalized.slice(index + normalizeLabel(label).length).replace(/^[：:，,\s]+/, '').trim()
  }
  for (let index = 0; index < lines.length; index += 1) {
    const text = tidy(lines[index].text)
    const confidence = confidenceValue(lines[index].confidence)
    if (field === 'notes' && /司机/.test(text)) candidates.push({ raw: text, confidence })
    if (field.startsWith('driver') && new RegExp(`(?:^|[：:，,])\s*${field.slice(-1)}[.、，,]?\s*[\u3400-\u9fff]{2,4}`).test(text)) candidates.push({ raw: text, confidence })
    const names = aliases[field]
    if (!names) continue
    const value = valueAfterLabel(text, names)
    if (!value) continue
    if (field === 'company' && index + 1 < lines.length && /[A-Za-z]/.test(lines[index + 1].text)) candidates.push({ raw: `${value} ${tidy(lines[index + 1].text)}`, confidence })
    else candidates.push({ raw: value, confidence })
  }
  return candidates
}

function makeValidityCandidates(candidates) {
  return candidates.map(candidate => ({ ...candidate, dates: extractValidityDates(candidate.raw) })).filter(candidate => candidate.dates.validFrom && candidate.dates.validTo)
}

function correctTraditionalField(key, value) {
  if (key === 'serial' && value.length === 7) return `0${value}`
  if (key === 'localPlate') return value.replace(/S(?=\d)/g, '5')
  if (key === 'notes') return value.replace(/主司\s*机/g, '主司机').replace(/副司\s*机/g, '副司机')
  return value
}

// Checks that need more than one field: numbers read with low confidence and approval numbers
// that contradict each other are kept but flagged so staff check them against the card.
function crossCheck(result, fieldStatus) {
  const flag = key => { if (fieldStatus[key]?.status === 'ok') fieldStatus[key] = { ...fieldStatus[key], status: 'uncertain' } }
  for (const key of ['cardNumber', 'serial']) if (fieldStatus[key]?.value && fieldStatus[key].confidence < 90) flag(key)
  const current = result.currentApproval, previous = result.previousApproval
  if (current && previous && (current === previous || current.slice(0, 4) <= previous.slice(0, 4))) { flag('currentApproval'); flag('previousApproval') }
  for (const key of ['driver1', 'driver2', 'driver3']) if (fieldStatus[key]?.value && fieldStatus[key].confidence < 80) flag(key)
  // A single wrong digit in an approval number still passes the format check, so only very
  // confident reads count as checked; an earlier approval without a current one is suspicious.
  for (const key of ['currentApproval', 'previousApproval']) if (fieldStatus[key]?.value && fieldStatus[key].confidence < 90) flag(key)
  if (previous && !current) flag('previousApproval')
  // Truncated names and notes usually lose a closing bracket.
  const balanced = value => (value.match(/[(（]/g) || []).length === (value.match(/[)）]/g) || []).length
  for (const key of ['company', 'contractor']) if (result[key] && !balanced(result[key])) flag(key)
  // Notes are free text; OCR rarely gets every character, so staff always check them.
  flag('notes')
}

export async function recognizeCard(image, side, options = {}) {
  if (!rectangles[side]) throw new Error('無效的批文卡面')
  const variants = await prepareVariants(image)
  const result = emptyCard()
  const fieldStatus = {}
  const worker = await createWorker('chi_sim', 1, { langPath: tessdataPath, gzip: false, cachePath: tessdataPath, cacheMethod: 'readOnly' })
  const started = Date.now()
  try {
    const layout = await recognizeLayout(worker, variants[0])
    if (options.debug) console.log('OCR LAYOUT', JSON.stringify(layout.data.text))
    const layoutLines = linesFromBlocks(layout.data.blocks)
    const located = locateFieldRectangles(side, layoutLines)
    if (options.debug) console.log('OCR LOCATED', JSON.stringify(located), JSON.stringify(layoutLines.map(line => ({ text: line.text, bbox: line.bbox }))))
    const fields = Object.keys(rectangles[side])
    let language = 'chi_sim'
    for (const field of fields) {
      const fieldConfigValue = fieldConfig[field === 'validity' ? 'validFrom' : field] || { language: 'chi_sim' }
      if (fieldConfigValue.language !== language) {
        await worker.reinitialize(fieldConfigValue.language)
        language = fieldConfigValue.language
      }
      const candidates = []
      const candidateField = field === 'validity' ? 'validFrom' : field
      const modes = ['company', 'contractor', 'crossing', 'driver1', 'driver2', 'driver3', 'color', 'purpose', 'notes'].includes(candidateField) ? ['7', '8', '6'] : [fieldConfig[candidateField]?.psm || '7']
      for (const variant of variants) for (const psm of modes) candidates.push(await recognizeCandidate(worker, variant, candidateField, located[field], psm))
      candidates.push(...layoutCandidates(field, layoutLines))
      if (options.debug) console.log('OCR DEBUG', side, field, located[field], candidates.map(candidate => ({ raw: candidate.raw, confidence: candidate.confidence })))
      if (field === 'validity') {
        const validity = makeValidityCandidates(candidates).sort((left, right) => right.confidence - left.confidence)[0]
        if (validity) {
          result.validFrom = validity.dates.validFrom
          result.validTo = validity.dates.validTo
          fieldStatus.validFrom = makeFieldStatus(validity.dates.validFrom, validity.confidence)
          fieldStatus.validTo = makeFieldStatus(validity.dates.validTo, validity.confidence)
        } else {
          fieldStatus.validFrom = makeFieldStatus('', Math.max(0, ...candidates.map(candidate => candidate.confidence)))
          fieldStatus.validTo = makeFieldStatus('', Math.max(0, ...candidates.map(candidate => candidate.confidence)))
        }
        continue
      }
      const chosen = chooseCandidate(field, candidates, options)
      result[field] = correctTraditionalField(field, chosen.value)
      fieldStatus[field] = makeFieldStatus(chosen.value, chosen.confidence)
    }
  } finally {
    await worker.terminate()
  }
  const driverNames = extractDriverNames(result.notes)
  if (driverNames.length) for (const [index, key] of ['driver1', 'driver2', 'driver3'].entries()) {
    const corrected = driverNames[index] || ''
    const agreed = corrected && result[key] === corrected
    result[key] = corrected
    fieldStatus[key] = corrected ? { value: corrected, status: agreed ? 'ok' : 'uncertain', confidence: agreed ? Math.max(fieldStatus[key]?.confidence || 0, 80) : Math.min(fieldStatus[key]?.confidence || 55, 79) } : makeFieldStatus('', fieldStatus[key]?.confidence || 0)
  }
  result.notes = correctTraditionalField('notes', result.notes)
  crossCheck(result, fieldStatus)
  if (options.logger) options.logger({ side, durationMs: Date.now() - started, fields: Object.keys(fieldStatus).length })
  return { cardData: cleanCard(result), fieldStatus }
}

export const cardRectangles = rectangles
