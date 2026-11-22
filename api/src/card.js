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

// 商號太長時英文轉到第二行（例：CO / ., LIMITED）），在商號下面另讀一行
const companyMore = { left: 206, top: 262, width: 750, height: 52 }

const fieldConfig = {
  companyMore: { language: 'eng', whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,&()'-", psm: '7' },
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
const places = '深圳|东莞|東莞|广州|廣州|珠海|中山|佛山|惠州|江门|江門|肇庆|肇慶|汕头|汕頭|清远|清遠|河源|韶关|韶關|湛江|茂名|阳江|陽江|云浮|雲浮|梅州|潮州|揭阳|揭陽|汕尾|香港|澳门|澳門|上海|北京|天津|重庆|重慶|厦门|廈門|福建|广东|廣東|中国|中國'
const placeBracket = new RegExp(`（\\s*(${places})\\s*[^）\\s]?\\s*(?=有限|股份|集团|集團|实业|實業|科技|贸易|貿易)`, 'g')
const fixPlaceBracket = value => value.includes('）') ? value : value.replace(placeBracket, '（$1）')
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
  // 英文詞之間讀出的冒號、「- 」當空格；第一行末尾多讀的逗號去掉
  if (key === 'company' || key === 'contractor') return fixPlaceBracket(text.replace(/\s*[《〈<「(（]\s*/g, '（').replace(/\s*[》〉>」)）]/g, '）')).replace(/(?<=[A-Za-z])\s*[:：]\s*(?=[A-Za-z])/g, ' ').replace(/(?<=[A-Za-z])-\s+(?=[A-Za-z])/g, ' ').replace(/(?<=[A-Za-z])\s*[,，]$/, '').replace(/[，、]/g, ',').replace(/\bC0\b/gi, 'CO').replace(/\s+([,.)])/g, '$1').replace(/([(.])\s+/g, '$1').replace(/\s+/g, ' ').replace(/\s+(?=[\u4e00-\u9fff])/g, '').replace(/(?<=[\u4e00-\u9fff])\s+(?=[A-Za-z])/g, ' ')
  // Mainland plates never use the letters I and O, so those are misread digits.
  if (key === 'mainlandPlate') return compact(text).toUpperCase().replace(/^粤/, '粵').replace(/[洪鸿]/g, '港').replace(/^(粵Z)(.*)([港澳])$/, (all, head, body, tail) => head + body.replace(/I/g, '1').replace(/O/g, '0') + tail)
  if (key === 'localPlate') return compact(text).toUpperCase()
  if (key.startsWith('driver')) return text.replace(/\s+/g, '')
  if (key === 'currentApproval' || key === 'previousApproval') return normalizeApproval(text)
  if (key === 'color') return colors.get(text.replace(/\s+/g, '')) || text.replace(/\s+/g, '').replace(/[;；]$/, '')
  if (key === 'seats') return compact(text).replace(/噸/g, '吨')
  // 卡上「变更驾驶人;」的分號常讀成逗號
  if (key === 'crossing' || key === 'purpose') return text.replace(/[;；,，]$/, '').replace(/\s+/g, '')
  if (key === 'validFrom' || key === 'validTo') return normalizeDate(text)
  // OCR spaces out Chinese characters; spaces between them carry no meaning.
  // 「(6722)」的左括號常讀成「\」
  if (key === 'notes') return text.replace(/[\\/](?=\s*\d{4}\s*[)）])/g, '(').replace(/，/g, ',').replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '').replace(/\s*([:：,，()（）])\s*/g, '$1').replace(/^注[,，:：]?/, '')
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
  // 標籤中間常多讀出引號（例：「有效”期」）
  return compact(value).replace(/[“”"'‘’`「」]/g, '').replace(/[号號]/g, '号').replace(/[单單]/g, '單')
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
    // 上下對準標籤那一行（版面圖是卡面的兩倍）：卡在框內偏一點時，固定位置會切到下一行的頂部，
    // 例如有效期切進備註、整欄讀不出（2026-11-23 真機）。只用於單行欄位，行高合理、偏差 20 以內才移
    if (field !== 'notes' && field !== 'company') {
      const center = (line.bbox.y0 + line.bbox.y1) / 4, lineHeight = (line.bbox.y1 - line.bbox.y0) / 2
      if (lineHeight >= 15 && lineHeight < rect.height && Math.abs(center - (rect.top + rect.height / 2)) <= 20) rect.top = Math.round(center - rect.height / 2)
    }
  }
  return located
}

// 辨識程式常駐重用（2026-11-23，管理者批准加快辨識）：以前每次辨識都開一個新的，欄位中英文交替時來回換字庫，
// 全部試讀一次一個。現在中文、英文各有一個常駐的辨識程式，兩者同時做；閒置一段時間後關閉，釋放記憶體。
// 一次試讀（設定參數＋讀字）必須獨佔一個辨識程式，否則兩個請求同時用時參數會互相蓋掉。
// 數量固定，同時有幾個人辨識也不會多開：在 768MB 上限的容器實測，舊做法兩人同時辨識會記憶體不足被重啟。
// 中文欄位最多，用兩個中文辨識程式（一中一英最高約 560MB；兩中一英約 710MB，所以 2026-11-23 管理者同意把
// api 容器上限由 768MB 調到 1024MB，見 deploy/compose.yaml）
const WORKERS = { chi_sim: 2, eng: 1 }
// 測試每個檔案是獨立程序，常駐的辨識程式會令程序不結束，所以測試時閒置一秒就關
const IDLE_MS = process.env.NODE_ENV === 'test' ? 1000 : 5 * 60 * 1000
const pools = {}

function pool(language) {
  if (!pools[language]) pools[language] = { slots: [], waiting: [], timer: null }
  return pools[language]
}

async function acquire(language) {
  const p = pool(language)
  clearTimeout(p.timer)
  let slot = p.slots.find(item => !item.busy)
  if (!slot && p.slots.length < WORKERS[language]) {
    slot = { busy: false, worker: createWorker(language, 1, { langPath: tessdataPath, gzip: false, cachePath: tessdataPath, cacheMethod: 'readOnly' }) }
    p.slots.push(slot)
  }
  if (!slot) return new Promise(resolve => p.waiting.push(resolve))
  slot.busy = true
  try {
    await slot.worker
  } catch (error) {
    p.slots.splice(p.slots.indexOf(slot), 1)
    throw error
  }
  return slot
}

function release(language, slot) {
  const p = pool(language)
  const next = p.waiting.shift()
  if (next) return next(slot)
  slot.busy = false
  if (p.slots.every(item => !item.busy)) p.timer = setTimeout(() => closeWorkers(language), IDLE_MS)
}

async function closeWorkers(language) {
  const p = pool(language)
  if (p.slots.some(item => item.busy) || p.waiting.length) return
  const slots = p.slots.splice(0)
  await Promise.all(slots.map(slot => slot.worker.then(worker => worker.terminate()).catch(() => {})))
}

async function withWorker(language, job) {
  const slot = await acquire(language)
  try {
    return await job(await slot.worker)
  } finally {
    release(language, slot)
  }
}

// 每個欄位只把那一小塊圖交給辨識程式（以前每次都交整張卡面再指定範圍，每次都要重新解碼整張圖）
async function rawVariant(name, pipeline) {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  return { name, scale: 2, data, info }
}

function cropVariant(variant, rectangle) {
  const { width, height, channels } = variant.info
  const left = clamp(Math.round(rectangle.left * variant.scale), 0, width - 1), top = clamp(Math.round(rectangle.top * variant.scale), 0, height - 1)
  const crop = { left, top, width: clamp(Math.round(rectangle.width * variant.scale), 1, width - left), height: clamp(Math.round(rectangle.height * variant.scale), 1, height - top) }
  // 註明 72 dpi（和以前整張卡面一樣）；沒有的話辨識程式每次都警告解像度無效
  return sharp(variant.data, { raw: { width, height, channels } }).extract(crop).withMetadata({ density: 72 }).png({ compressionLevel: 1 }).toBuffer()
}

async function prepareVariants(image) {
  const source = await sharp(image).rotate().trim({ background: { r: 255, g: 255, b: 255, alpha: 1 }, threshold: 5 }).png().toBuffer()
  const rawSource = await sharp(image).rotate().png().toBuffer()
  const make = (angle, enhanced, threshold) => {
    let pipeline = sharp(source).rotate(angle, { background: '#ffffff' }).trim({ background: '#ffffff', threshold: 5 }).resize({ width: TEMPLATE_WIDTH * 2, height: TEMPLATE_HEIGHT * 2, fit: 'fill' })
    if (enhanced) pipeline = pipeline.grayscale().normalise().linear(1.18, -18).sharpen({ sigma: 1.1 })
    if (threshold) pipeline = pipeline.grayscale().normalise().threshold(185)
    return pipeline
  }
  // 原圖另存一張 PNG 看版面；逐欄試讀用五種的像素
  const rawResized = sharp(rawSource).resize({ width: TEMPLATE_WIDTH * 2, height: TEMPLATE_HEIGHT * 2, fit: 'fill' })
  const layout = await rawResized.clone().png().toBuffer()
  const variants = await Promise.all([
    rawVariant('raw', rawResized.clone()),
    ...[['enhanced', 0], ['deskew-left', -2], ['deskew-right', 2]].map(([name, angle]) => rawVariant(name, make(angle, true, false))),
    rawVariant('threshold', make(0, false, true))
  ])
  return { layout, variants }
}

// 辨識程式是重用的，參數要每次全部設定（preserve_interword_spaces 上一次可能設成 1）
function recognizeLayout(image) {
  return withWorker('chi_sim', async worker => {
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '', preserve_interword_spaces: '0' })
    return worker.recognize(image, {}, { text: true, blocks: true })
  })
}

async function recognizeCandidate(variant, field, rectangle, psm) {
  const config = fieldConfig[field] || { language: 'chi_sim', whitelist: '', psm: '7' }
  const image = await cropVariant(variant, rectangle)
  return withWorker(config.language, async worker => {
    await worker.setParameters({ tessedit_pageseg_mode: psm || config.psm, tessedit_char_whitelist: config.whitelist, preserve_interword_spaces: '1' })
    const result = await worker.recognize(image)
    return { raw: result.data.text, confidence: confidenceValue(result.data.confidence) }
  })
}

function extractDriverNames(notes) {
  const names = []
  const pattern = /(?:主|副)?\s*司\s*机\s*[:：]?\s*([\u3400-\u9fff]{2,4})/g
  for (const match of String(notes || '').matchAll(pattern)) if (!names.includes(match[1]) && surnames.has(match[1][0])) names.push(match[1])
  return names
}

// 駕駛人名字：逐欄讀到的（2–4 個中文字，姓氏不對也算一票）和每次讀備註時同一位置的名字（只用由「主司机」開始的讀法，
// 位置才對得上）一起按把握度逐字投票：備註字小常錯一兩個字，逐欄有時又讀不到（2026-11-23 真卡第三位副司機）。
// 備註裏沒有這個位置的名字就不投票，回傳空字串
function voteDriverName(index, fieldReads, notesReads) {
  const fromNotes = notesReads.filter(read => /主\s*司\s*机/.test(read.raw)).map(read => ({ text: extractDriverNames(normalizeCardField('notes', read.raw))[index], confidence: read.confidence })).filter(read => read.text)
  if (!fromNotes.length) return ''
  const pool = [...fieldReads.map(read => ({ text: normalizeCardField('driver1', read.raw), confidence: read.confidence })).filter(read => /^[\u3400-\u9fff]{2,4}$/.test(read.text)), ...fromNotes]
  const weight = new Map()
  for (const read of pool) weight.set(read.text.length, (weight.get(read.text.length) || 0) + Math.max(1, read.confidence))
  const length = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const peers = pool.filter(read => read.text.length === length)
  const voted = Array.from({ length }, (_, position) => {
    const tally = new Map()
    for (const peer of peers) tally.set(peer.text[position], (tally.get(peer.text[position]) || 0) + Math.max(1, peer.confidence))
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }).join('')
  return validateCardField('driver1', voted) ? voted : ''
}

export const voteCardDriverName = voteDriverName

// 投票結果可以標為正常，只有在逐欄選出的名字和備註裏選出的名字都是它的時候：投票裏逐欄的讀法票數多（每欄讀好幾次），
// 只和逐欄比對等於自己證明自己。2026-11-23 部署測試機逐欄把「刘子豪」讀成「刘子衰」，投票跟着錯還標為正常
function driverAgreed(voted, fieldValue, notesName) {
  return Boolean(voted) && voted === fieldValue && voted === notesName
}

export const cardDriverAgreed = driverAgreed

function chooseCandidate(field, candidates, context) {
  const valid = []
  for (const candidate of candidates) {
    const value = normalizeCardField(field, candidate.raw)
    if (validateCardField(field, value, context)) valid.push({ value, confidence: candidate.confidence })
  }
  const counts = new Map(valid.map(candidate => [candidate.value, 0]))
  for (const candidate of valid) counts.set(candidate.value, counts.get(candidate.value) + 1)
  valid.sort((left, right) => counts.get(right.value) - counts.get(left.value) || right.confidence - left.confidence)
  if (valid[0] && (field === 'company' || field === 'contractor')) {
    // 逐字投票：每次試讀常錯不同的一兩個字，所以同樣長度的讀法逐個位置按把握度加權取最多的字。
    // 開頭的中文部分用所有讀法（後面讀壞了的也算），其餘部分只用合格的讀法
    const head = value => (value.match(/^[\u3400-\u9fff]+/) || [''])[0]
    const vote = (text, peers) => [...text].map((char, index) => {
      const tally = new Map()
      for (const peer of peers) tally.set(peer.text[index], (tally.get(peer.text[index]) || 0) + Math.max(1, peer.confidence))
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }).join('')
    const winner = valid[0].value, winnerHead = head(winner), tail = winner.slice(winnerHead.length)
    const heads = candidates.map(candidate => { const value = normalizeCardField(field, candidate.raw); return { text: head(value), confidence: candidate.confidence } }).filter(peer => peer.text.length === winnerHead.length)
    // 後面（英文名等）按詞投票：同樣詞數的讀法逐個詞按把握度加權（2026-11-23 把握度最高的一次把 CO 讀成 5C0）
    const tailWords = tail.split(' ')
    const tails = valid.filter(candidate => head(candidate.value).length === winnerHead.length).map(candidate => ({ words: candidate.value.slice(winnerHead.length).split(' '), confidence: candidate.confidence })).filter(peer => peer.words.length === tailWords.length)
    const votedTail = tailWords.map((word, index) => vote([word], tails.map(peer => ({ text: [peer.words[index]], confidence: peer.confidence })))).join(' ')
    const voted = vote(winnerHead, heads) + votedTail
    // 拼出來的名稱沒有一次試讀完整讀到，可能仍有錯字，標為待核對
    if (validateCardField(field, voted, context)) return { value: voted, confidence: valid.some(candidate => candidate.value === voted) ? valid[0].confidence : Math.min(valid[0].confidence, 69) }
  }
  if (valid[0]) return { value: valid[0].value, confidence: valid[0].confidence }
  return { value: '', confidence: Math.max(0, ...candidates.map(candidate => candidate.confidence)) }
}

// 商號只有左括號（英文名轉了行）時，接上商號下面那一行：開頭的標點（例：「.,」）+ 英文直到右括號。
// 按英文部分投票，至少兩次讀到一樣才接上；兩行拼起來的名稱標為待核對
function joinCompanySecondLine(chosen, reads) {
  if (!chosen.value.includes('（') || chosen.value.includes('）')) return chosen
  const lines = reads.map(read => tidy(read.raw).toUpperCase().match(/^([^A-Z]*?)([A-Z][A-Z .,&'-]*?)\s*[)）]/)).filter(match => match && /[A-Z]{3}/.test(match[2]))
  const counts = new Map(lines.map(match => [match[2], lines.filter(item => item[2] === match[2]).length]))
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best || best[1] < 2) return chosen
  const prefix = lines.filter(match => match[2] === best[0]).map(match => match[1]).join('')
  const join = /[.,]/.test(prefix) && /\bCO$/.test(chosen.value) ? '., ' : ' '
  return { value: `${chosen.value}${join}${best[0]}）`, confidence: Math.min(chosen.confidence, 69) }
}

export const chooseCardCandidate = chooseCandidate
export const joinCardCompanyLine = joinCompanySecondLine

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
  const { layout: layoutImage, variants } = await prepareVariants(image)
  const result = emptyCard()
  const fieldStatus = {}
  const started = Date.now()
  const layout = await recognizeLayout(layoutImage)
  if (options.debug) console.log('OCR LAYOUT', JSON.stringify(layout.data.text))
  const layoutLines = linesFromBlocks(layout.data.blocks)
  const located = locateFieldRectangles(side, layoutLines)
  if (options.debug) console.log('OCR LOCATED', JSON.stringify(located), JSON.stringify(layoutLines.map(line => ({ text: line.text, bbox: line.bbox }))))
  const fields = Object.keys(rectangles[side])
  // 所有欄位的試讀一起排隊，中文、英文的辨識程式同時做；每欄的候選仍按原來的次序排
  // 文字欄位用 8、6 兩種讀法：2026-11-23 用 50 個樣本（真實樣本、對準框和找卡邊的各種拍法、合成卡、管理者的實卡）比較，
  // 去掉 7 每個樣本讀對的欄數都不變，試讀少約四分之一
  const reads = await Promise.all(fields.map(field => {
    const candidateField = field === 'validity' ? 'validFrom' : field
    const modes = ['company', 'contractor', 'crossing', 'driver1', 'driver2', 'driver3', 'color', 'purpose', 'notes'].includes(candidateField) ? ['8', '6'] : [fieldConfig[candidateField]?.psm || '7']
    return Promise.all(variants.flatMap(variant => modes.map(psm => recognizeCandidate(variant, candidateField, located[field], psm))))
  }))
  const moreReads = side === 'front' ? await Promise.all(variants.map(variant => recognizeCandidate(variant, 'companyMore', { ...companyMore, left: located.company.left, width: located.company.width }, '7'))) : []
  if (options.debug) console.log('OCR MORE', JSON.stringify(moreReads))
  const seen = {}
  for (const [index, field] of fields.entries()) {
    const candidateField = field === 'validity' ? 'validFrom' : field
    const candidates = [...reads[index], ...layoutCandidates(field, layoutLines)]
    seen[field] = candidates
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
    const chosen = field === 'company' ? joinCompanySecondLine(chooseCandidate(field, candidates, options), moreReads) : chooseCandidate(field, candidates, options)
    result[field] = correctTraditionalField(field, chosen.value)
    fieldStatus[field] = makeFieldStatus(chosen.value, chosen.confidence)
  }
  const driverNames = extractDriverNames(result.notes)
  // 備註以「。」結尾才算讀完整；沒讀到第二行時，備註裏沒有的駕駛人保留逐欄讀到的名字（標為待核對），不要清掉
  const notesComplete = /。$/.test(result.notes)
  if (driverNames.length) for (const [index, key] of ['driver1', 'driver2', 'driver3'].entries()) {
    if (!driverNames[index] && !notesComplete && result[key]) {
      fieldStatus[key] = { ...fieldStatus[key], status: 'uncertain', confidence: Math.min(fieldStatus[key]?.confidence || 0, 79) }
      continue
    }
    const corrected = driverNames[index] ? voteDriverName(index, seen[key] || [], seen.notes || []) || driverNames[index] : ''
    // 備註裏的名字也換成投票結果（備註的字小，常錯一兩個字）
    if (corrected && corrected !== driverNames[index] && corrected.length === driverNames[index].length) result.notes = result.notes.replace(driverNames[index], corrected)
    const agreed = driverAgreed(corrected, result[key], driverNames[index])
    result[key] = corrected
    fieldStatus[key] = corrected ? { value: corrected, status: agreed ? 'ok' : 'uncertain', confidence: agreed ? Math.max(fieldStatus[key]?.confidence || 0, 80) : Math.min(fieldStatus[key]?.confidence || 55, 79) } : makeFieldStatus('', fieldStatus[key]?.confidence || 0)
  }
  result.notes = correctTraditionalField('notes', result.notes)
  if (fieldStatus.notes?.value) fieldStatus.notes = { ...fieldStatus.notes, value: result.notes }
  crossCheck(result, fieldStatus)
  if (options.logger) options.logger({ side, durationMs: Date.now() - started, fields: Object.keys(fieldStatus).length })
  return { cardData: cleanCard(result), fieldStatus }
}

export const cardRectangles = rectangles
