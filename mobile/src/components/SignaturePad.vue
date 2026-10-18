<template>
  <!-- 手寫簽名框（管理者 2026-10-18）：網頁版用原生 canvas＋指標事件，手指和滑鼠都可以簽（Wot 的 wd-signature 只聽觸控，
       電腦上用滑鼠簽不到）；微信小程序只有觸控，照用 wd-signature。輸出 PNG data URL -->
  <view class="signature-pad">
    <!-- #ifdef H5 -->
    <view ref="host" class="pad-host" />
    <!-- #endif -->
    <!-- #ifndef H5 -->
    <wd-signature ref="wot" :height="160" pen-color="#14201B" :line-width="2.5" background-color="#ffffff" @end="drawn = true" @confirm="onWotConfirm"><template #footer><view /></template></wd-signature>
    <!-- #endif -->
    <view class="pad-row"><text class="subtle">{{ drawn ? '已簽名' : '請在框內簽名' }}</text><button class="btn-sm pad-clear" @click="clear">重簽</button></view>
  </view>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { readBase64 } from '../lib/api'
const host = ref(null), wot = ref(null), drawn = ref(false)
let canvas = null, ctx = null, drawing = false, pending = null
// #ifdef H5
const point = event => { const box = canvas.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top] }
function fit() {
  const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
  canvas.width = box.width * ratio; canvas.height = box.height * ratio
  ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio)
  Object.assign(ctx, { lineWidth: 2.5, lineCap: 'round', lineJoin: 'round', strokeStyle: '#14201B' })
  drawn.value = false
}
const down = event => { drawing = true; canvas.setPointerCapture?.(event.pointerId); const [x, y] = point(event); ctx.beginPath(); ctx.moveTo(x, y); event.preventDefault() }
const move = event => { if (!drawing) return; const [x, y] = point(event); ctx.lineTo(x, y); ctx.stroke(); event.preventDefault() }
const up = () => { if (drawing) drawn.value = true; drawing = false }
onMounted(() => {
  const el = host.value?.$el || host.value
  canvas = document.createElement('canvas')
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '160px', touchAction: 'none' })
  el.appendChild(canvas)
  fit()
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
})
onBeforeUnmount(() => { canvas?.remove() })
// #endif
function onWotConfirm(result) {
  if (!pending) return
  const { resolve, reject } = pending; pending = null
  if (!result?.success || !result.tempFilePath) return reject(new Error('簽名未能儲存，請重簽'))
  readBase64(result.tempFilePath).then(data => resolve('data:image/png;base64,' + data), reject)
}
function clear() {
  // #ifdef H5
  ctx?.clearRect(0, 0, canvas.width, canvas.height)
  // #endif
  // #ifndef H5
  wot.value?.clear()
  // #endif
  drawn.value = false
}
// 簽名相片（PNG data URL）
function toDataURL() {
  // #ifdef H5
  return Promise.resolve(canvas.toDataURL('image/png'))
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => { pending = { resolve, reject }; wot.value.confirm() })
  // #endif
}
defineExpose({ clear, toDataURL, isEmpty: () => !drawn.value })
</script>
<style scoped>
.pad-host{border:1px solid var(--rule);border-radius:var(--r-control);background:#fff;overflow:hidden}
.pad-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}
.pad-clear{flex:none}
</style>
