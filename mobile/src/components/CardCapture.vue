<template>
  <!-- 批文卡對準框（管理者 2026-10-18）：拍照、從相冊選都先把卡對進框，只上傳框內卡面連框外一圈（每邊 6%，固定 2274×1445 JPEG），
       不保存整張原圖，所以不用再壓縮。伺服器在這張圖裏找出卡的真正邊界再辨識和保存（api/src/card-face.js），卡沒有剛好填滿框也讀得到。
       網頁版用鏡頭（getUserMedia）＋原生 canvas；開不了鏡頭就改從相冊選、拖動縮放對框。其他平台暫時沿用系統選相片。 -->
  <view v-if="show" class="capture">
    <!-- #ifdef H5 -->
    <view ref="stage" class="stage" />
    <!-- #endif -->
    <view class="frame" :style="frameStyle"><view class="corner tl" /><view class="corner tr" /><view class="corner bl" /><view class="corner br" /></view>
    <view class="top"><text class="close" @click="cancel">✕</text><text class="title">{{ mode === 'camera' ? '拍批文卡' : '對準批文卡' }}</text></view>
    <view class="sides" :style="{ top: (frame.top - 48) + 'px' }"><text class="side" :class="{ on: side === 'front' }">① 正面</text><text class="side" :class="{ on: side === 'back' }">② 背面</text></view>
    <text class="hint" :style="{ top: (frame.top + frame.height + 18) + 'px' }">{{ mode === 'camera' ? `把批文卡${sideName}對準框內，四角對齊框線\n光線充足、避免反光` : '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存' }}</text>
    <view v-if="mode === 'camera'" class="bottom">
      <view class="album" @click="pickAlbum"><view class="album-icon" /><text>從相冊選</text></view>
      <view class="shutter" @click="shoot" />
      <view class="album" />
    </view>
    <view v-else class="buttons"><button class="ghost" @click="pickAlbum">重選</button><button class="confirm" @click="confirmAlbum">確認</button></view>
  </view>
</template>
<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { cardPhoto } from '../lib/api'
const OUT_W = 2030, OUT_H = 1290, MARGIN = 0.06, FULL_W = Math.round(OUT_W * (1 + 2 * MARGIN)), FULL_H = Math.round(OUT_H * (1 + 2 * MARGIN))
const show = ref(false), mode = ref('camera'), side = ref('front'), stage = ref(null)
const frame = ref({ left: 20, top: 300, width: 350, height: 222 })
const sideName = computed(() => side.value === 'front' ? '正面' : '背面')
const frameStyle = computed(() => ({ left: frame.value.left + 'px', top: frame.value.top + 'px', width: frame.value.width + 'px', height: frame.value.height + 'px' }))
let finish = null, stream = null, video = null, img = null, view = { x: 0, y: 0, s: 1, min: 0.1 }, pointers = new Map(), pinch = null

function layout() {
  const w = window.innerWidth, h = window.innerHeight, width = Math.min(w - 40, 560), height = Math.round(width * 645 / 1015)
  frame.value = { left: Math.round((w - width) / 2), top: Math.max(120, Math.round((h - height) / 2) - 40), width, height }
}
function settle(result) { stopCamera(); clearStage(); show.value = false; const done = finish; finish = null; done?.(result) }
function cancel() { settle(null) }
// 打開對準框，回傳 { data, path }（框內卡面的 JPEG data URL），取消回傳 null
async function open(options = {}) {
  side.value = options.side === 'back' ? 'back' : 'front'
  // #ifndef H5
  return new Promise(resolve => uni.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album', 'camera'], success: async result => { try { resolve(await cardPhoto(result)) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }); resolve(null) } }, fail: () => resolve(null) }))
  // #endif
  // #ifdef H5
  layout(); mode.value = 'camera'; show.value = true
  const promise = new Promise(resolve => { finish = resolve })
  await nextTick()
  try { await startCamera() } catch { uni.showToast({ title: '無法開啟鏡頭，請從相冊選擇', icon: 'none' }); mode.value = 'album'; pickAlbum() }
  return promise
  // #endif
}
// #ifdef H5
const host = () => stage.value?.$el || stage.value
function clearStage() { const el = host(); if (el) el.innerHTML = ''; video = null; img = null; pointers.clear(); pinch = null }
function stopCamera() { stream?.getTracks().forEach(track => track.stop()); stream = null }
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera')
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
  clearStage()
  video = Object.assign(document.createElement('video'), { autoplay: true, muted: true, playsInline: true, srcObject: stream })
  video.setAttribute('playsinline', '')
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' })
  host().appendChild(video)
  await video.play()
}
// 畫面座標的框（每邊外擴 6%）→ 原圖座標，畫到固定尺寸的截圖上（超出原圖的部分填白色）
function crop(source, sx, sy, sw, sh) {
  const mx = sw * MARGIN, my = sh * MARGIN
  sx -= mx; sy -= my; sw += mx * 2; sh += my * 2
  const canvas = Object.assign(document.createElement('canvas'), { width: FULL_W, height: FULL_H }), ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, FULL_W, FULL_H)
  // 只畫和原圖重疊的部分（部分瀏覽器遇到超出原圖的來源範圍會整張不畫）
  const width = source.videoWidth || source.naturalWidth, height = source.videoHeight || source.naturalHeight
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(width, sx + sw), y1 = Math.min(height, sy + sh), kx = FULL_W / sw, ky = FULL_H / sh
  if (x1 > x0 && y1 > y0) ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * kx, (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky)
  const data = canvas.toDataURL('image/jpeg', 0.9)
  return { data, path: data }
}
function shoot() {
  if (!video?.videoWidth) return
  const box = host().getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight
  const scale = Math.max(box.width / vw, box.height / vh), ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2
  const f = frame.value
  settle(crop(video, (f.left - ox) / scale, (f.top - oy) / scale, f.width / scale, f.height / scale))
}
function pickAlbum() {
  uni.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album'], success: result => {
    const image = new Image()
    image.onload = () => { stopCamera(); clearStage(); mode.value = 'album'; img = image; placeImage() }
    image.onerror = () => uni.showToast({ title: '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片', icon: 'none' })
    image.src = result.tempFilePaths[0]
  }, fail: () => { if (mode.value === 'album' && !img) cancel() } })
}
// 相片先放大到剛好蓋滿框，之後可拖動、雙指縮放（電腦用滾輪）
function placeImage() {
  const f = frame.value, s = Math.max(f.width / img.naturalWidth, f.height / img.naturalHeight)
  view = { s, min: s * 0.5, x: f.left + (f.width - img.naturalWidth * s) / 2, y: f.top + (f.height - img.naturalHeight * s) / 2 }
  Object.assign(img.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' })
  const el = host(); el.appendChild(img); el.style.touchAction = 'none'
  el.onpointerdown = down; el.onpointermove = move; el.onpointerup = el.onpointercancel = up; el.onwheel = wheel
  paint()
}
function paint() { if (img) img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})` }
function zoomAt(cx, cy, s) { s = Math.min(Math.max(s, view.min), view.min * 12); view.x = cx - (cx - view.x) * s / view.s; view.y = cy - (cy - view.y) * s / view.s; view.s = s; paint() }
function down(event) { pointers.set(event.pointerId, [event.clientX, event.clientY]); host().setPointerCapture?.(event.pointerId) }
function move(event) {
  if (!pointers.has(event.pointerId)) return
  const [px, py] = pointers.get(event.pointerId); pointers.set(event.pointerId, [event.clientX, event.clientY])
  if (pointers.size === 1) { view.x += event.clientX - px; view.y += event.clientY - py; return paint() }
  const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
  if (pinch) { view.x += cx - pinch.cx; view.y += cy - pinch.cy; zoomAt(cx, cy, view.s * gap / pinch.gap) }
  pinch = { gap, cx, cy }
}
function up(event) { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null }
function wheel(event) { event.preventDefault(); zoomAt(event.clientX, event.clientY, view.s * (event.deltaY < 0 ? 1.08 : 1 / 1.08)) }
function confirmAlbum() {
  if (!img) return pickAlbum()
  const f = frame.value
  settle(crop(img, (f.left - view.x) / view.s, (f.top - view.y) / view.s, f.width / view.s, f.height / view.s))
}
onBeforeUnmount(() => { stopCamera() })
// #endif
defineExpose({ open, cancel, isOpen: () => show.value })
</script>
<style scoped>
.capture{position:fixed;inset:0;z-index:999;background:#000;color:#fff;overflow:hidden}
.stage{position:absolute;inset:0}
.frame{position:absolute;border-radius:12px;box-shadow:0 0 0 2000px rgba(0,0,0,.58);pointer-events:none}
.corner{position:absolute;width:30px;height:30px;border:4px solid #fff}
.tl{left:-2px;top:-2px;border-right:0;border-bottom:0;border-radius:12px 0 0 0}
.tr{right:-2px;top:-2px;border-left:0;border-bottom:0;border-radius:0 12px 0 0}
.bl{left:-2px;bottom:-2px;border-right:0;border-top:0;border-radius:0 0 0 12px}
.br{right:-2px;bottom:-2px;border-left:0;border-top:0;border-radius:0 0 12px 0}
.top{position:absolute;left:0;right:0;top:0;height:64px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600}
.close{position:absolute;left:8px;width:48px;height:48px;line-height:48px;text-align:center;font-size:24px;font-weight:300}
.sides{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:8px;pointer-events:none}
.side{padding:4px 12px;border-radius:var(--r-control);background:rgba(255,255,255,.16);font-size:var(--fs-body);font-weight:500}
.side.on{background:var(--jade-soft);color:var(--jade)}
.hint{position:absolute;left:24px;right:24px;text-align:center;font-size:var(--fs-body);line-height:1.6;color:rgba(255,255,255,.88);white-space:pre-line;pointer-events:none}
.bottom{position:absolute;left:0;right:0;bottom:0;height:170px;display:flex;align-items:center;justify-content:space-between;padding:0 32px 32px}
.album{width:72px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:var(--fs-meta)}
.album-icon{width:36px;height:36px;border:2px solid #fff;border-radius:var(--r-card)}
.shutter{width:76px;height:76px;border-radius:50%;border:4px solid #fff;box-sizing:border-box;padding:5px;background:#fff;background-clip:content-box}
.buttons{position:absolute;left:20px;right:20px;bottom:48px;display:flex;gap:12px}
.buttons button{flex:1;height:48px;line-height:48px;border-radius:var(--r-control);font-size:16px;font-weight:600;margin:0}
.buttons .ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}
.buttons .confirm{background:var(--jade);color:#fff;border:0}
.buttons button::after{border:0}
</style>
