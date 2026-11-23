<template>
  <!-- 批文卡對準框（管理者 2026-10-18）：拍照、從相冊選都先把卡對進框，只上傳框內卡面連框外一圈（每邊 6%，固定 2274×1445 JPEG），
       不保存整張原圖，所以不用再壓縮。伺服器在這張圖裏找出卡的真正邊界再辨識和保存（api/src/card-face.js），卡沒有剛好填滿框也讀得到。
       網頁版用鏡頭（getUserMedia）＋原生 canvas；開不了鏡頭（拒絕權限、內置瀏覽器不支援）就留在框內，讓客戶自己按「從相冊選」
       （瀏覽器只准用戶親手按才打開選檔），選好後拖動縮放對框。畫面部分在 lib/card-stage.js。
       小程序暫時沿用系統選相片。App 版在 Flutter（app/lib/business/card_capture*.dart）。 -->
  <view v-if="show" class="capture">
    <!-- #ifdef H5 -->
    <view ref="stage" class="stage" />
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
    <view v-else-if="picked" class="buttons"><button class="ghost" @click="repick">重選</button><button class="confirm" @click="confirmAlbum">確認</button></view>
    <!-- #ifdef H5 -->
    <view v-else class="buttons"><button class="confirm" @click="pickAlbum">從相冊選</button></view>
    <!-- #endif -->
  </view>
</template>
<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { pickImage } from '../lib/pick-image'
// #ifdef H5
import { createCardStage } from '../lib/card-stage'
// #endif
// #ifdef MP
import { cardPhoto } from '../lib/api'
// #endif
const show = ref(false), mode = ref('camera'), side = ref('front'), stage = ref(null), picked = ref(false)
const frame = ref({ left: 20, top: 300, width: 350, height: 222 })
const sideName = computed(() => side.value === 'front' ? '正面' : '背面')
const frameStyle = computed(() => ({ left: frame.value.left + 'px', top: frame.value.top + 'px', width: frame.value.width + 'px', height: frame.value.height + 'px' }))
const noCameraHint = () => `無法開啟鏡頭\n請按下面「從相冊選」，選一張批文卡${sideName.value}相片`
const hint = computed(() => mode.value === 'camera' ? `把批文卡${sideName.value}對準框內，四角對齊框線\n光線充足、避免反光` : picked.value ? '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存' : noCameraHint())
let finish = null

function layout() {
  // #ifdef H5
  const w = window.innerWidth, h = window.innerHeight, safeTop = 0
  // #endif
  const width = Math.min(w - 40, 560), height = Math.round(width * 645 / 1015)
  frame.value = { left: Math.round((w - width) / 2), top: Math.max(120 + safeTop, Math.round((h - height) / 2) - 40), width, height }
}
function settle(result) { stopStage(); show.value = false; const done = finish; finish = null; done?.(result) }
function cancel() { settle(null) }
// 打開對準框，回傳 { data, path }（框內卡面的 JPEG data URL），取消回傳 null
async function open(options = {}) {
  side.value = options.side === 'back' ? 'back' : 'front'
  // #ifdef MP
  // 小程序暫時沿用系統選相片
  return new Promise(resolve => pickImage({ count: 1, sizeType: ['original'], sourceType: ['album', 'camera'], success: async result => { try { resolve(await cardPhoto(result)) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }); resolve(null) } }, fail: () => resolve(null) }))
  // #endif
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
    view.showImage(result.tempFilePaths[0]).then(() => { mode.value = 'album'; picked.value = true }, () => uni.showToast({ title: '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片', icon: 'none' }))
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
.buttons{position:absolute;left:50%;transform:translateX(-50%);width:calc(100% - 40px);max-width:560px;bottom:48px;display:flex;gap:12px}
.buttons button{flex:1;height:48px;line-height:48px;border-radius:var(--r-control);font-size:16px;font-weight:600;margin:0}
.buttons .ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}
.buttons .confirm{background:var(--jade);color:#fff;border:0}
.buttons button::after{border:0}
</style>
