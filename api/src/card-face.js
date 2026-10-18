import sharp from 'sharp'

// 批文卡對準框找卡邊（管理者 2026-10-18）：客戶端 CardCapture、後台 CardCropper 截圖時框外每邊多截 6%，
// 輸出固定 2274×1445（框內 2030×1290 加外圈）。用手拿手機拍，卡很難剛好填滿框；辨識程式按固定位置讀字，
// 卡比框小、大或歪一點就讀錯。所以先在這張截圖裏找出卡的真正邊界、轉正，切成 2030×1290 卡面，
// 辨識和保存正本都用這張。找不到卡邊（例如桌面和卡同色）就用畫面上框內的部分，和以前一樣。
// 其他尺寸的圖片（掃描檔、舊版客戶端）原樣處理，不找邊。
export const FACE_W = 2030, FACE_H = 1290, MARGIN = 0.06
export const MARGIN_W = Math.round(FACE_W * (1 + 2 * MARGIN)), MARGIN_H = Math.round(FACE_H * (1 + 2 * MARGIN))
const SCALE = 2, RATIO = 1015 / 645, MAX_ANGLE = 8

async function analyse(buffer) {
  const { data, info } = await sharp(buffer).resize(Math.round(MARGIN_W / SCALE), Math.round(MARGIN_H / SCALE), { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height, ring = Math.max(2, Math.round(w * 0.02)), samples = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) samples.push((y * w + x) * 3)
  const median = channel => { const values = samples.map(i => data[i + channel]).sort((a, b) => a - b); return values[values.length >> 1] }
  const background = [median(0), median(1), median(2)]
  const distance = i => Math.hypot(data[i] - background[0], data[i + 1] - background[1], data[i + 2] - background[2])
  const noise = samples.map(distance).sort((a, b) => a - b)[Math.floor(samples.length * 0.9)]
  const threshold = Math.max(40, noise * 1.5), mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = distance(i * 3) > threshold ? 1 : 0
  return { w, h, mask, background }
}
// 某一段行（或列）裏，每一列（或行）屬於卡的比例
function profile({ w, h, mask }, vertical, from, to) {
  const length = vertical ? w : h, out = new Float32Array(length), a = Math.round(from), b = Math.round(to)
  for (let i = 0; i < length; i++) { let count = 0; for (let j = a; j < b; j++) count += vertical ? mask[j * w + i] : mask[i * w + j]; out[i] = count / Math.max(1, b - a) }
  return out
}
// 從外往內找第一個連續 3 格都過半的位置；找不到或貼着圖邊（卡超出外圈）回傳 null
function edge(values, fromEnd) {
  const n = values.length
  for (let k = 0; k < n / 2; k++) {
    const i = fromEnd ? n - 1 - k : k, step = fromEnd ? -1 : 1
    if ([0, 1, 2].every(d => values[i + d * step] >= 0.5)) return k === 0 ? null : i
  }
  return null
}
function edges(map, band = [0.3, 0.7]) {
  const rows = profile(map, true, map.h * band[0], map.h * band[1]), cols = profile(map, false, map.w * band[0], map.w * band[1])
  return { left: edge(rows, false), right: edge(rows, true), top: edge(cols, false), bottom: edge(cols, true) }
}
// 卡的傾斜角度（順時針為正）：左右邊上下兩段、上下邊左右兩段的位置差
function tilt(map) {
  const a = edges(map, [0.3, 0.45]), b = edges(map, [0.55, 0.7]), gapY = map.h * 0.25, gapX = map.w * 0.25, angles = []
  for (const side of ['left', 'right']) if (a[side] !== null && b[side] !== null) angles.push(Math.atan((a[side] - b[side]) / gapY))
  for (const side of ['top', 'bottom']) if (a[side] !== null && b[side] !== null) angles.push(Math.atan((b[side] - a[side]) / gapX))
  if (angles.length < 2) return 0
  const degrees = angles.map(angle => angle * 180 / Math.PI).sort((x, y) => x - y)
  return degrees[degrees.length >> 1]
}
function frameFace(buffer) {
  return sharp(buffer).extract({ left: Math.round(FACE_W * MARGIN), top: Math.round(FACE_H * MARGIN), width: FACE_W, height: FACE_H }).jpeg({ quality: 90 }).toBuffer()
}

export function isMarginCrop(meta) { return meta?.width === MARGIN_W && meta?.height === MARGIN_H }

// 回傳 { image, found }；image 是 2030×1290 JPEG 卡面。不是對準框截圖就回傳 null，由呼叫方原樣使用
export async function cardFace(bytes) {
  let meta
  try { meta = await sharp(bytes).metadata() } catch { return null }
  if (!isMarginCrop(meta)) return null
  const original = await sharp(bytes).removeAlpha().png().toBuffer(), fallback = async () => ({ image: await frameFace(original), found: false })
  let source = original, map = await analyse(source)
  // 桌面和卡紙一樣淺色（白桌、掃描檔外的白底）時，卡的淺色外框會和桌面混在一起，找到的邊會偏進卡內，改用框內
  const [red, green, blue] = map.background
  if (0.299 * red + 0.587 * green + 0.114 * blue > 200) return fallback()
  const angle = tilt(map)
  if (Math.abs(angle) > 0.3 && Math.abs(angle) <= MAX_ANGLE) {
    const [r, g, b] = map.background, turned = await sharp(source).rotate(-angle, { background: { r, g, b } }).toBuffer({ resolveWithObject: true })
    source = await sharp(turned.data).extract({ left: Math.round((turned.info.width - MARGIN_W) / 2), top: Math.round((turned.info.height - MARGIN_H) / 2), width: MARGIN_W, height: MARGIN_H }).png().toBuffer()
    map = await analyse(source)
  }
  const found = edges(map), frameWidth = FACE_W / SCALE
  if (Object.values(found).some(value => value === null)) return fallback()
  const width = found.right - found.left + 1, height = found.bottom - found.top + 1
  if (width < frameWidth * 0.6 || Math.abs(width / height / RATIO - 1) > 0.1) return fallback()
  // 卡面要和桌面分得清（框內幾乎全部都不是桌面色）；白卡放白桌時只有文字分得出，邊界不可靠，改用框內
  let inside = 0
  for (let y = found.top; y <= found.bottom; y++) for (let x = found.left; x <= found.right; x++) inside += map.mask[y * map.w + x]
  if (inside / (width * height) < 0.9) return fallback()
  const image = await sharp(source).extract({ left: found.left * SCALE, top: found.top * SCALE, width: Math.min(width * SCALE, MARGIN_W - found.left * SCALE), height: Math.min(height * SCALE, MARGIN_H - found.top * SCALE) })
    .resize(FACE_W, FACE_H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer()
  return { image, found: true }
}
