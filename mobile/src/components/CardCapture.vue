<template>
  <!-- 批文卡對準框（管理者 2026-10-18）：拍照、從相冊選都先把卡對進框，只上傳框內卡面連框外一圈（每邊 6%，固定 2274×1445 JPEG），
       不保存整張原圖，所以不用再壓縮。伺服器在這張圖裏找出卡的真正邊界再辨識和保存（api/src/card-face.js），卡沒有剛好填滿框也讀得到。
       網頁版用鏡頭（getUserMedia）＋原生 canvas；開不了鏡頭（拒絕權限、內置瀏覽器不支援）就留在框內，讓客戶自己按「從相冊選」
       （瀏覽器只准用戶親手按才打開選檔），選好後拖動縮放對框。畫面部分在 lib/card-stage.js。
       小程序（2026-11-23 起）流程相同，用 camera 組件拍照、image 組件拖動縮放、canvas 2d 截圖，截取範圍和網頁版共用 cropPlan。
       App 版在 Flutter（app/lib/business/card_capture*.dart）。 -->
  <view v-if="show" class="capture">
    <!-- #ifdef H5 -->
    <view ref="stage" class="stage" />
    <!-- #endif -->
    <!-- #ifdef MP -->
    <view class="stage" @touchstart="touchStart" @touchmove.stop.prevent="touchMove" @touchend="touchEnd" @touchcancel="touchEnd">
      <camera v-if="mode === 'camera'" class="camera" device-position="back" flash="off" resolution="high" @error="noCamera" />
      <image v-else-if="photo" class="photo" :src="photo.src" :style="photoStyle" />
    </view>
    <canvas id="card-crop" type="2d" class="crop" />
    <!-- #endif -->
    <view class="frame" :style="frameStyle"><view class="corner tl" /><view class="corner tr" /><view class="corner bl" /><view class="corner br" /></view>
    <view class="top"><text class="close" @click="cancel">✕</text><text class="title">{{ mode === 'camera' ? '拍批文卡' : '對準批文卡' }}</text></view>
    <view class="sides" :style="{ top: (frame.top - 48) + 'px' }"><text class="side" :class="{ on: side === 'front' }">① 正面</text><text class="side" :class="{ on: side === 'back' }">② 背面</text></view>
    <text class="hint" :style="{ top: (frame.top + frame.height + 18) + 'px' }">{{ hint }}</text>
    <view v-if="mode === 'camera'" class="bottom">
      <view class="album" @click="pickAlbum"><view class="album-icon" /><text>從相冊選</text></view>
      <view class="shutter" @click="shoot" />
      <view class="album" />
    </view>
    <view v-else-if="picked" class="buttons"><button class="btn ghost" @click="repick">重選</button><button class="btn confirm" @click="confirmAlbum">確認</button></view>
    <view v-else class="buttons"><button class="btn confirm" @click="pickAlbum">從相冊選</button></view>
  </view>
</template>
<script setup>
import { ref, computed, nextTick, onBeforeUnmount, getCurrentInstance } from 'vue'
import { pickImage } from '../lib/pick-image'
import { createCardStage, cropPlan, FULL_W, FULL_H } from '../lib/card-stage'
const show = ref(false), mode = ref('camera'), side = ref('front'), stage = ref(null), picked = ref(false)
const frame = ref({ left: 20, top: 300, width: 350, height: 222 })
const sideName = computed(() => side.value === 'front' ? '正面' : '背面')
const frameStyle = computed(() => ({ left: frame.value.left + 'px', top: frame.value.top + 'px', width: frame.value.width + 'px', height: frame.value.height + 'px' }))
const noCameraHint = () => `無法開啟鏡頭\n請按下面「從相冊選」，選一張批文卡${sideName.value}相片`
const hint = computed(() => mode.value === 'camera' ? `把批文卡${sideName.value}對準框內，四角對齊框線\n光線充足、避免反光` : picked.value ? '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存' : noCameraHint())
const unreadable = () => uni.showToast({ title: '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片', icon: 'none' })
let finish = null, screen = { width: 390, height: 844 }

function layout() {
  // #ifdef H5
  const w = window.innerWidth, h = window.innerHeight, safeTop = 0
  // #endif
  // #ifdef MP
  // 小程序的導航列不在頁面內，可用高度已扣除
  const info = uni.getWindowInfo(), w = info.windowWidth, h = info.windowHeight, safeTop = 0
  // #endif
  screen = { width: w, height: h }
  const width = Math.min(w - 40, 560), height = Math.round(width * 645 / 1015)
  frame.value = { left: Math.round((w - width) / 2), top: Math.max(120 + safeTop, Math.round((h - height) / 2) - 40), width, height }
}
function settle(result) { stopStage(); show.value = false; const done = finish; finish = null; done?.(result) }
function cancel() { settle(null) }
// 打開對準框，回傳 { data, path }（框內卡面的 JPEG data URL），取消回傳 null
async function open(options = {}) {
  side.value = options.side === 'back' ? 'back' : 'front'
  layout(); mode.value = 'camera'; show.value = true
  const promise = new Promise(resolve => { finish = resolve })
  await nextTick()
  // #ifdef H5
  // 開不了鏡頭：不自動彈出相冊（這時已不是用戶親手按，瀏覽器會擋下），留在框內等客戶按「從相冊選」
  try { await startStage() } catch { mode.value = 'album' }
  // #endif
  return promise
}
// #ifdef H5
let view = null
const host = () => stage.value?.$el || stage.value
async function startStage() { view = createCardStage(host(), () => frame.value); await view.startCamera() }
function stopStage() { view?.stopCamera(); view?.clear(); view = null; picked.value = false }
function shoot() { const result = view?.shoot(); if (result) settle(result) }
function pickAlbum() {
  pickImage({ count: 1, sizeType: ['original'], sourceType: ['album'], success: result => {
    if (!view) view = createCardStage(host(), () => frame.value)
    view.showImage(result.tempFilePaths[0]).then(() => { mode.value = 'album'; picked.value = true }, unreadable)
  } })
}
const repick = pickAlbum
function confirmAlbum() {
  const result = view?.confirm()
  if (!result) return pickAlbum()
  settle(result)
}
onBeforeUnmount(() => { view?.stopCamera() })
// #endif
// #ifdef MP
// camera 組件鋪滿畫面，預覽按「蓋滿」顯示；拍出的相片按同一比例換算回框的位置（相片和預覽同比例時換算結果一樣）。
// 相冊相片：先放大到剛好蓋滿框（base），之後可拖動、雙指縮放，place.s 是相對原圖的倍數。
const instance = getCurrentInstance()
const photo = ref(null), place = ref({ x: 0, y: 0, s: 1, base: 1, min: 0.1 })
const photoStyle = computed(() => photo.value ? { width: photo.value.width * place.value.base + 'px', height: photo.value.height * place.value.base + 'px', transform: `translate(${place.value.x}px, ${place.value.y}px) scale(${place.value.s / place.value.base})` } : {})
let shooting = false, points = {}, pinch = null
const imageInfo = src => new Promise((resolve, reject) => uni.getImageInfo({ src, success: resolve, fail: reject }))
function noCamera() { if (show.value) mode.value = 'album' }
function stopStage() { photo.value = null; picked.value = false; points = {}; pinch = null }
function shoot() {
  if (shooting) return
  shooting = true
  uni.createCameraContext().takePhoto({ quality: 'high',
    success: async result => {
      try {
        const info = await imageInfo(result.tempImagePath), f = frame.value
        const scale = Math.max(screen.width / info.width, screen.height / info.height), ox = (screen.width - info.width * scale) / 2, oy = (screen.height - info.height * scale) / 2
        settle(await crop(result.tempImagePath, info, (f.left - ox) / scale, (f.top - oy) / scale, f.width / scale, f.height / scale))
      } catch { uni.showToast({ title: '拍攝失敗，請再拍一次', icon: 'none' }) } finally { shooting = false }
    },
    fail: () => { shooting = false; uni.showToast({ title: '拍攝失敗，請再拍一次', icon: 'none' }) } })
}
function pickAlbum() {
  pickImage({ count: 1, sizeType: ['original'], sourceType: ['album'], success: async result => {
    try {
      const src = result.tempFilePaths[0], info = await imageInfo(src), f = frame.value
      const s = Math.max(f.width / info.width, f.height / info.height)
      place.value = { s, base: s, min: s * 0.5, x: f.left + (f.width - info.width * s) / 2, y: f.top + (f.height - info.height * s) / 2 }
      photo.value = { src, width: info.width, height: info.height }
      mode.value = 'album'; picked.value = true
    } catch { unreadable() }
  } })
}
const repick = pickAlbum
async function confirmAlbum() {
  if (!photo.value) return pickAlbum()
  const f = frame.value, { x, y, s } = place.value
  try { settle(await crop(photo.value.src, photo.value, (f.left - x) / s, (f.top - y) / s, f.width / s, f.height / s)) } catch { unreadable() }
}
function zoomAt(cx, cy, s) {
  const p = place.value
  s = Math.min(Math.max(s, p.min), p.min * 12)
  place.value = { ...p, s, x: cx - (cx - p.x) * s / p.s, y: cy - (cy - p.y) * s / p.s }
}
function touchStart(event) { for (const t of event.changedTouches) points[t.identifier] = [t.clientX, t.clientY] }
function touchMove(event) {
  if (!photo.value) return
  const list = [...event.touches]
  if (list.length === 1) {
    const t = list[0], last = points[t.identifier]
    if (last) place.value = { ...place.value, x: place.value.x + t.clientX - last[0], y: place.value.y + t.clientY - last[1] }
    points[t.identifier] = [t.clientX, t.clientY]; pinch = null
    return
  }
  const [a, b] = list, gap = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2
  if (pinch) { place.value = { ...place.value, x: place.value.x + cx - pinch.cx, y: place.value.y + cy - pinch.cy }; zoomAt(cx, cy, place.value.s * gap / pinch.gap) }
  pinch = { gap, cx, cy }
  for (const t of list) points[t.identifier] = [t.clientX, t.clientY]
}
function touchEnd(event) { for (const t of event.changedTouches) delete points[t.identifier]; if (event.touches.length < 2) pinch = null }
function canvasNode() {
  return new Promise((resolve, reject) => uni.createSelectorQuery().in(instance.proxy).select('#card-crop').fields({ node: true }).exec(r => r?.[0]?.node ? resolve(r[0].node) : reject(new Error('no canvas'))))
}
// size：getImageInfo 得到的尺寸（框的換算用它）；載入 canvas 的尺寸不同時（相片帶轉向資料）按比例換算
async function crop(src, size, sx, sy, sw, sh) {
  const canvas = await canvasNode()
  canvas.width = FULL_W; canvas.height = FULL_H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, FULL_W, FULL_H)
  const image = canvas.createImage()
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = src })
  const width = image.width || size.width, height = image.height || size.height, kx = width / size.width, ky = height / size.height
  const plan = cropPlan(width, height, sx * kx, sy * ky, sw * kx, sh * ky)
  if (plan) ctx.drawImage(image, ...plan)
  const data = canvas.toDataURL('image/jpeg', 0.9)
  return { data, path: data }
}
// #endif
defineExpose({ open, cancel, isOpen: () => show.value })
</script>
<style scoped>
.capture{position:fixed;left:0;top:0;right:0;bottom:0;z-index:999;background:#000;color:#fff;overflow:hidden}
.stage{position:absolute;left:0;top:0;right:0;bottom:0}
.camera{position:absolute;left:0;top:0;width:100%;height:100%}
.photo{position:absolute;left:0;top:0;transform-origin:0 0}
.crop{position:fixed;left:-9999px;top:0;width:227px;height:144px}
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
.buttons{position:absolute;left:50%;transform:translateX(-50%);width:calc(100% - 40px);max-width:560px;bottom:48px;display:flex;gap:12px}
.buttons .btn{flex:1;height:48px;line-height:48px;border-radius:var(--r-control);font-size:16px;font-weight:600;margin:0}
.buttons .ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}
.buttons .confirm{background:var(--jade);color:#fff;border:0}
.buttons .btn::after{border:0}
</style>
