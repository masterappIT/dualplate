import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 車輛證件辨識（負責人 2026-10-17）：內地行駛證、香港車輛牌照、香港車輛登記文件（牌簿）、澳門車輛登記文件。
// 版式因年份和簽發機關而異，所以不用固定座標：整頁辨識成文字行，按標籤（簡體、繁體、英文、葡文）找出欄位，
// 每個值都要通過格式驗證才會填入；找不到標籤、只靠格式猜出的值標「請核對」，驗證不過的一律留空，絕不輸出亂碼。
const tessdataPath = resolve(dirname(fileURLToPath(import.meta.url)), '../tessdata')

export const fieldLabels = { plate: '車牌', vin: '車架號碼', vehicleType: '車輛類型', brandModel: '品牌型號', registeredOn: '內地註冊日期', issuedOn: '發證日期', expiresOn: '牌照有效期至', brand: '品牌', model: '型號', manufacturedYear: '製造年份', firstRegisteredOn: '首次登記日期' }

const iso = date => date.toISOString().slice(0, 10)
const businessYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TZ || 'Asia/Hong_Kong', year: 'numeric' }).format(new Date()))
function makeDate(year, month, day) {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && iso(date) === value ? value : null
}

// 全形轉半形、去掉空白，標籤與數值都用這個比對。
export function compact(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\s　]+/g, '').toUpperCase()
}

// ── 欄位驗證與正規化：只回傳合格的值，否則 null ──

export function parseMainlandPlate(text) {
  const value = compact(text).replace(/粤/g, '粵').match(/粵Z[A-Z0-9]{4}[港澳]/)
  return value ? value[0] : null
}
export function parseHongKongPlate(text) {
  // 只接受標準登記號碼（一至兩個字母加 1–4 位數字）；自訂車牌格式太寬，容易把副標讀成車牌，留給人手填
  const value = compact(text).replace(separators, '').match(/^([A-HJ-NPR-Z]{1,2})(\d{1,4})(?![0-9])/)
  return value ? `${value[1]}${value[2]}` : null
}
export function parseMacauPlate(text) {
  const value = compact(text).replace(/[–—_]/g, '-').match(/M([A-Z]?)-?(\d{2})-?(\d{2})/)
  return value ? `M${value[1]}-${value[2]}-${value[3]}` : null
}
// 車架號碼：17 位 VIN（不含 I、O、Q；OCR 讀錯的 O/Q→0、I→1 先改回），或日本車常見的車架編號（例如 AGH30-0123456）。
export function parseVin(text) {
  const raw = compact(text).replace(/[–—_]/g, '-')
  for (const token of raw.match(/[A-Z0-9]{17}/g) || []) {
    const fixed = token.replace(/[OQ]/g, '0').replace(/I/g, '1')
    // 要改字才合格的，多半是 OCR 把某個字母讀錯（例如 T 讀成 I），標記為「請核對」
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(fixed) && /[A-Z]/.test(fixed) && /\d/.test(fixed)) return fixed === token ? fixed : doubtful(fixed)
  }
  const frame = raw.match(/[A-Z]{2,5}\d{1,3}[A-Z]?-\d{6,7}/)
  return frame ? frame[0] : null
}
// 格式合格但有理由懷疑的值：照填，但只標「請核對」
const doubtful = value => Object.assign(new String(value), { doubtful: true })
const plain = value => value == null ? null : String(value)

// 日期：年月日（內地）或日月年（香港、澳門）。range 限定合理範圍，避免把別的數字當成日期。
export function parseDates(text) {
  const raw = compact(text)
  const found = []
  const ymd = /(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})日?/g
  const dmy = /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/g
  let match
  while ((match = ymd.exec(raw))) { const value = makeDate(match[1], match[2], match[3]); if (value) found.push({ index: match.index, value }) }
  while ((match = dmy.exec(raw))) { const value = makeDate(match[3], match[2], match[1]); if (value) found.push({ index: match.index, value }) }
  return found.sort((a, b) => a.index - b.index).map(item => item.value)
}
export function parseYear(text) {
  const value = compact(text).match(/(?<!\d)(19[5-9]\d|20\d{2})(?!\d)/)
  return value && Number(value[1]) <= businessYear() + 1 ? value[1] : null
}
// 證件上其他欄位的標籤字眼：自由文字裏出現這些，多半是 OCR 讀錯標籤後把下一行當成了值
const labelWords = /年份|日期|號碼|号码|編號|编号|登記|登记|類別|类别|有效|YEAR|DATE|NO\.|NUMBER|REGIST|MANUFACT|CHASSIS|EXPIR|VALID|MATR|QUADRO|FABRICO|CLASS/i
const freeText = (text, max = 30) => {
  const value = String(text ?? '').normalize('NFKC').replace(/^[\s:：.\-]+/, '').replace(/\s+/g, ' ').trim()
  if (!value || value.length > max || labelWords.test(value)) return null
  if (!/^[A-Za-z0-9一-鿿][A-Za-z0-9一-鿿 .\-()/&]*$/.test(value)) return null
  return (value.match(/[A-Za-z0-9一-鿿]/g) || []).length >= 2 ? value : null
}
export function parseVehicleType(text) {
  const value = compact(text).match(/[一-鿿]{2,10}[车車]/)
  return value ? value[0] : null
}
export function parseBrandModel(text) {
  const value = compact(text).match(/[一-鿿]{1,10}牌[A-Z0-9][A-Z0-9-]{1,19}/)
  return value ? value[0] : null
}

const dateIn = (minYear, maxOffset) => (text, pick = 'first') => {
  const max = businessYear() + maxOffset
  const dates = parseDates(text).filter(value => Number(value.slice(0, 4)) >= minYear && Number(value.slice(0, 4)) <= max)
  return dates.length ? (pick === 'last' ? dates[dates.length - 1] : dates[0]) : null
}
const pastDate = dateIn(1950, 0)
const expiryDate = dateIn(2000, 4)

// ── 每類證件的欄位：標籤（已 compact）、解析方法、是否可在沒有標籤時按格式找（fallback）、是否自由文字（最多「請核對」） ──
const plateLabels = { hk: /登記號碼|登记号码|登記標記|REGISTRATIONMARK|REGISTRATIONNO\.?|REGN\.?MARK|REG\.?MARK/, mo: /車牌號碼|车牌号码|登記編號|登記號碼|登记号码|MATR[IÍ]CULA|REGISTRATIONMARK|車牌|车牌/ }
const vinLabels = /車輛識別代號|车辆识别代号|底盤號碼|底盘号码|車架號碼|车架号码|車身號碼|车身号码|CHASSIS(NO|NUMBER)?|N\.?[ºO°]?DOQUADRO|QUADRO|VIN/
export const documentFields = {
  cn_licence: [
    { key: 'plate', labels: /號牌號碼|号牌号码|PLATENO/, parse: parseMainlandPlate, fallback: true },
    { key: 'vehicleType', labels: /車輛類型|车辆类型|VEHICLETYPE/, parse: parseVehicleType, free: true },
    { key: 'brandModel', labels: /品牌型號|品牌型号/, parse: parseBrandModel, free: true },
    { key: 'vin', labels: vinLabels, parse: parseVin, fallback: true },
    { key: 'registeredOn', labels: /註冊日期|注册日期|REGISTERDATE/, parse: text => pastDate(text) },
    { key: 'issuedOn', labels: /發證日期|发证日期|ISSUEDATE/, parse: text => pastDate(text) }
  ],
  hk_licence: [
    { key: 'plate', labels: plateLabels.hk, parse: parseHongKongPlate },
    { key: 'vin', labels: vinLabels, parse: parseVin, fallback: true },
    // 「有效期至／屆滿日期」直接是到期日；只寫「有效期 由…至…」時取最後一個日期
    { key: 'expiresOn', labels: /有效期至|屆滿日期|届满日期|EXPIRYDATE|DATEOFEXPIRY|VALIDUNTIL|EXPIRESON|有效期|VALIDITY/, parse: text => expiryDate(text, 'last') }
  ],
  hk_registration: [
    { key: 'plate', labels: plateLabels.hk, parse: parseHongKongPlate },
    { key: 'vin', labels: vinLabels, parse: parseVin, fallback: true },
    { key: 'brand', labels: /廠名|厂名|MAKE/, parse: freeText, free: true, spaced: true },
    { key: 'model', labels: /型號|型号|MODEL/, parse: freeText, free: true, spaced: true },
    { key: 'manufacturedYear', labels: /製造年份|制造年份|YEAROFMANUFACTURE|MANUFACTUREYEAR/, parse: parseYear },
    { key: 'firstRegisteredOn', labels: /首次登記日期|首次登记日期|首次登記|DATEOFFIRSTREGISTRATION|FIRSTREGISTRATION/, parse: text => pastDate(text) }
  ],
  mo_registration: [
    { key: 'plate', labels: plateLabels.mo, parse: parseMacauPlate, fallback: true },
    { key: 'vin', labels: vinLabels, parse: parseVin, fallback: true },
    { key: 'brand', labels: /牌子|廠名|厂名|品牌|MARCA|MAKE/, parse: freeText, free: true, spaced: true },
    { key: 'model', labels: /型號|型号|MODELO|MODEL/, parse: freeText, free: true, spaced: true },
    { key: 'manufacturedYear', labels: /製造年份|制造年份|出廠年份|出厂年份|ANODEFABRICO|YEAROFMANUFACTURE/, parse: parseYear },
    { key: 'firstRegisteredOn', labels: /首次登記日期|首次登记日期|首次註冊日期|首次登記|DATADO1|PRIMEIRAMATR|DATEOFFIRSTREGISTRATION/, parse: text => pastDate(text) }
  ]
}
export const recognizableKinds = Object.keys(documentFields)

const OK_CONFIDENCE = 70
const separators = /^[:：.\-/|]+/
// 標籤之後的文字（已 compact）。雙語標籤（「登記號碼 Registration Mark」）要把後面的副標一併去掉，否則副標會被當成值。
function afterLabel(text, label) {
  const match = text.match(label)
  if (!match) return null
  let rest = text.slice(match.index + match[0].length)
  for (let guard = 0; guard < 4; guard++) {
    rest = rest.replace(separators, '')
    const again = rest.match(label)
    if (!again || again.index !== 0) break
    rest = rest.slice(again[0].length)
  }
  return rest
}
const cutAtLabels = (text, labels) => {
  let cut = text.length
  for (const label of labels) { const hit = text.search(label); if (hit > 0 && hit < cut) cut = hit }
  return text.slice(0, cut)
}
// 品牌、型號要保留空格（「ALPHARD 2.5」），所以從原文取：找到標籤在原文的位置，去掉後面的副標和分隔符，截在下一個標籤之前。
function spacedAfter(original, label, others) {
  let text = String(original).normalize('NFKC')
  const match = text.toUpperCase().match(label)
  if (match) {
    text = text.slice(match.index + match[0].length)
    for (let guard = 0; guard < 4; guard++) {
      text = text.replace(/^[\s:：.\-]+/, '')
      const again = text.toUpperCase().match(label)
      if (!again || again.index !== 0) break
      text = text.slice(again[0].length)
    }
  }
  return text.slice(0, cutAtLabels(text.toUpperCase(), others).length).trim()
}

// lines: [{ text, confidence }]，按閱讀順序。回傳 { fields, fieldStatus }。
export function extractVehicleFields(kind, lines) {
  const specs = documentFields[kind]
  if (!specs) throw new Error('無效的證件類別')
  const fields = {}, fieldStatus = {}
  const clean = (Array.isArray(lines) ? lines : []).map(line => ({ text: String(line?.text ?? ''), confidence: Number(line?.confidence) || 0 })).map(line => ({ ...line, compact: compact(line.text) })).filter(line => line.compact)
  for (const spec of specs) {
    const others = specs.filter(item => item !== spec).map(item => item.labels)
    const startsWithOther = line => others.some(other => line.compact.search(other) === 0)
    let found = null
    for (let index = 0; index < clean.length && !found; index++) {
      const rest = afterLabel(clean[index].compact, spec.labels)
      if (rest === null) continue
      // 同一行標籤後的值；沒有就看下一兩行（表格式證件的值常在標籤下方），遇到別的標籤即停
      const candidates = [{ text: spec.spaced ? spacedAfter(clean[index].text, spec.labels, others) : cutAtLabels(rest, others), confidence: clean[index].confidence }]
      for (const step of [1, 2]) {
        const line = clean[index + step]
        if (!line || startsWithOther(line) || line.compact.search(spec.labels) === 0) break
        candidates.push({ text: spec.spaced ? spacedAfter(line.text, /$^/, others) : cutAtLabels(line.compact, others), confidence: line.confidence })
      }
      for (const candidate of candidates) {
        const parsed = spec.parse(candidate.text)
        if (parsed) { found = { value: plain(parsed), confidence: candidate.confidence, labelled: true, doubtful: !!parsed.doubtful }; break }
      }
    }
    if (!found && spec.fallback) {
      // 沒有標籤：整頁只找到一個合格值才採用，並標「請核對」
      const hits = clean.map(line => ({ value: plain(spec.parse(line.text)), confidence: line.confidence })).filter(hit => hit.value)
      const values = [...new Set(hits.map(hit => hit.value))]
      if (values.length === 1) found = { value: values[0], confidence: Math.min(...hits.map(hit => hit.confidence)), labelled: false }
    }
    const value = found?.value || ''
    const status = !value ? 'failed' : found.labelled && !spec.free && !found.doubtful && found.confidence >= OK_CONFIDENCE ? 'ok' : 'uncertain'
    fields[spec.key] = value
    fieldStatus[spec.key] = { value, status, confidence: Math.round(found?.confidence || 0) }
  }
  return { fields, fieldStatus }
}

// ── 圖片辨識 ──
async function prepare(image) {
  const base = sharp(image, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' })
  const { width = 0 } = await base.clone().metadata()
  const target = Math.min(2600, Math.max(1800, width))
  const enhanced = await base.clone().resize({ width: target, withoutEnlargement: false }).grayscale().normalise().sharpen({ sigma: 1 }).png().toBuffer()
  const threshold = await sharp(enhanced).threshold(170).png().toBuffer()
  return [enhanced, threshold]
}
function linesOf(data) {
  const lines = []
  for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) lines.push({ text: line.text, confidence: line.confidence })
  return lines
}
// 合併多次辨識（不同前處理、不同版面模式）：每個欄位取狀態最好、信心最高的一個；
// 各次讀出的值不一致時（例如車架號碼有一個字不同），即使信心高也只標「請核對」。
const rank = { ok: 2, uncertain: 1, failed: 0 }
export function merge(results) {
  const fields = {}, fieldStatus = {}
  for (const key of Object.keys(results[0].fieldStatus)) {
    const reads = results.map(result => result.fieldStatus[key])
    // 先看狀態，再看有幾次讀出同一個值，最後看信心
    const votes = value => reads.filter(item => item.value && item.value === value).length
    const pick = reads.reduce((best, item) => rank[item.status] > rank[best.status] || (rank[item.status] === rank[best.status] && (votes(item.value) > votes(best.value) || (votes(item.value) === votes(best.value) && item.confidence > best.confidence))) ? item : best)
    const values = new Set(reads.map(item => item.value).filter(Boolean))
    const status = pick.status === 'ok' && values.size > 1 ? 'uncertain' : pick.status
    fields[key] = pick.value; fieldStatus[key] = { ...pick, status }
  }
  return { fields, fieldStatus }
}

export async function recognizeVehicleDocument(image, kind, options = {}) {
  if (!documentFields[kind]) throw new Error('此證件不需要辨識')
  const variants = await prepare(image)
  const started = Date.now()
  // tesseract.js 用 'chi_sim+eng' 同時載入兩種語言時，其中一種會載入失敗而不報錯，所以中文、英文分開讀（同批文卡）
  const worker = await createWorker('chi_sim', 1, { langPath: tessdataPath, gzip: false, cachePath: tessdataPath, cacheMethod: 'readOnly' })
  let language = 'chi_sim'
  const results = []
  try {
    // 每個版本用中文、英文各讀兩種版面模式，互相印證；仍有欄位讀不到時再用黑白版本讀
    for (const [index, variant] of variants.entries()) {
      if (index > 0 && Object.values(merge(results).fieldStatus).every(item => item.status !== 'failed')) break
      for (const next of ['chi_sim', 'eng']) {
        if (next !== language) { await worker.reinitialize(next); language = next }
        for (const psm of ['3', '11']) {
          await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' })
          const { data } = await worker.recognize(variant, {}, { text: true, blocks: true })
          const lines = linesOf(data)
          if (options.debug) console.log('VEHICLE OCR', kind, index, language, psm, JSON.stringify(lines.map(line => line.text)))
          results.push(extractVehicleFields(kind, lines))
        }
      }
    }
  } finally {
    await worker.terminate()
  }
  if (options.logger) options.logger({ kind, durationMs: Date.now() - started })
  return merge(results)
}
