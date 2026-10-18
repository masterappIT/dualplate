<!-- 批文卡對準框（管理者 2026-10-18）：後台選檔案後先把卡對進框，只上傳框內卡面連框外一圈（每邊 6%，固定 2274×1445 JPEG），
     不保存整張原檔，所以不用再限制原檔大小；伺服器再找出卡的真正邊界（api/src/card-face.js）。與客戶端 CardCapture 相同的裁切方式。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Segmented from '../ui/Segmented.vue'

const props = defineProps<{ open: boolean; side: 'front' | 'back'; mode: 'read' | 'save' }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', value: { side: 'front' | 'back'; image: string }): void }>()

const OUT_W = 2030, OUT_H = 1290, MARGIN = 0.06, FULL_W = Math.round(OUT_W * (1 + 2 * MARGIN)), FULL_H = Math.round(OUT_H * (1 + 2 * MARGIN))
const side = ref<'front' | 'back'>(props.side)
const stage = ref<HTMLElement | null>(null), fileInput = ref<HTMLInputElement | null>(null)
const loaded = ref(false), error = ref(''), zoom = ref(1)
const frame = ref({ left: 24, top: 24, width: 520, height: 330 })
let source: HTMLCanvasElement | null = null, picture: HTMLImageElement | null = null, turns = 0
const view = { x: 0, y: 0, s: 1, min: 1 }
const pointers = new Map<number, [number, number]>()
let pinch: { gap: number; cx: number; cy: number } | null = null

const title = computed(() => `對準批文卡${side.value === 'front' ? '正面' : '背面'}`)
const frameStyle = computed(() => ({ left: `${frame.value.left}px`, top: `${frame.value.top}px`, width: `${frame.value.width}px`, height: `${frame.value.height}px` }))

watch(() => props.open, async open => {
  if (!open) return reset()
  side.value = props.side; await nextTick(); layout(); fileInput.value?.click()
})
function reset() { loaded.value = false; error.value = ''; source = null; picture = null; turns = 0; pointers.clear(); pinch = null; stage.value?.querySelector('canvas')?.remove() }
function layout() {
  const width = stage.value?.clientWidth || 568, frameWidth = Math.min(width - 48, 520)
  frame.value = { left: Math.round((width - frameWidth) / 2), top: 24, width: frameWidth, height: Math.round(frameWidth * 645 / 1015) }
}

function pick(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { error.value = '請選擇 JPG 或 PNG 圖片'; return }
  const url = URL.createObjectURL(file), image = new Image()
  image.onload = () => { URL.revokeObjectURL(url); picture = image; turns = 0; error.value = ''; build() }
  image.onerror = () => { URL.revokeObjectURL(url); error.value = '這張圖片無法讀取，請改選 JPG 或 PNG 圖片' }
  image.src = url
}
// 按旋轉次數把原圖畫到畫布上，之後拖動、縮放都以這張畫布為準
function build() {
  if (!picture || !stage.value) return
  const quarter = turns % 2 === 1, canvas = document.createElement('canvas')
  canvas.width = quarter ? picture.naturalHeight : picture.naturalWidth
  canvas.height = quarter ? picture.naturalWidth : picture.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(turns * Math.PI / 2)
  ctx.drawImage(picture, -picture.naturalWidth / 2, -picture.naturalHeight / 2)
  stage.value.querySelector('canvas')?.remove()
  canvas.className = 'card-cropper-picture'
  stage.value.prepend(canvas)
  source = canvas
  const f = frame.value, s = Math.max(f.width / canvas.width, f.height / canvas.height)
  Object.assign(view, { s, min: s * 0.5, x: f.left + (f.width - canvas.width * s) / 2, y: f.top + (f.height - canvas.height * s) / 2 })
  zoom.value = 1; loaded.value = true; paint()
}
function rotate(step: number) { if (!picture) return; turns = (turns + step + 4) % 4; build() }
function paint() { if (source) source.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})` }
function zoomAt(cx: number, cy: number, next: number) {
  const s = Math.min(Math.max(next, view.min), view.min * 12)
  view.x = cx - (cx - view.x) * s / view.s; view.y = cy - (cy - view.y) * s / view.s; view.s = s
  zoom.value = s / (view.min * 2); paint()
}
const local = (event: { clientX: number; clientY: number }): [number, number] => { const box = stage.value!.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top] }
function down(event: PointerEvent) { if (!loaded.value) return; pointers.set(event.pointerId, local(event)); stage.value?.setPointerCapture(event.pointerId) }
function move(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  const [px, py] = pointers.get(event.pointerId)!, [x, y] = local(event)
  pointers.set(event.pointerId, [x, y])
  if (pointers.size === 1) { view.x += x - px; view.y += y - py; return paint() }
  const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
  if (pinch) { view.x += cx - pinch.cx; view.y += cy - pinch.cy; zoomAt(cx, cy, view.s * gap / pinch.gap) }
  pinch = { gap, cx, cy }
}
function up(event: PointerEvent) { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null }
function wheel(event: WheelEvent) { if (!loaded.value) return; const [x, y] = local(event); zoomAt(x, y, view.s * (event.deltaY < 0 ? 1.08 : 1 / 1.08)) }
function slide(event: Event) { const f = frame.value; zoomAt(f.left + f.width / 2, f.top + f.height / 2, view.min * 2 * Number((event.target as HTMLInputElement).value)) }

function confirm() {
  if (!source) { fileInput.value?.click(); return }
  const f = frame.value, canvas = document.createElement('canvas')
  canvas.width = FULL_W; canvas.height = FULL_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, FULL_W, FULL_H)
  // 框每邊外擴 6%；只畫和原圖重疊的部分，超出的地方留白
  const sw = f.width / view.s * (1 + 2 * MARGIN), sh = f.height / view.s * (1 + 2 * MARGIN)
  const sx = (f.left - view.x) / view.s - f.width / view.s * MARGIN, sy = (f.top - view.y) / view.s - f.height / view.s * MARGIN
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(source.width, sx + sw), y1 = Math.min(source.height, sy + sh), kx = FULL_W / sw, ky = FULL_H / sh
  if (x1 > x0 && y1 > y0) ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * kx, (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky)
  emit('confirm', { side: side.value, image: canvas.toDataURL('image/jpeg', 0.9) })
}
onBeforeUnmount(reset)
</script>

<template>
  <Modal :open="open" :title="title" sub="拖動、縮放相片，讓卡面四角對齊框線；框外的部分不會保存" :width="640" @close="emit('close')">
    <div class="card-cropper">
      <Segmented v-model="side" :options="[{ label: '正面', value: 'front' }, { label: '背面', value: 'back' }]" label="批文卡哪一面" />
      <div ref="stage" class="card-cropper-stage" :style="{ height: `${frame.top * 2 + frame.height}px` }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="wheel">
        <div class="card-cropper-frame" :style="frameStyle" />
        <button v-if="!loaded" type="button" class="button card-cropper-pick" @click="fileInput?.click()">選擇批文卡相片或掃描檔</button>
      </div>
      <p v-if="error" class="card-cropper-error" role="alert">{{ error }}</p>
      <div class="card-cropper-tools">
        <label>縮放<input type="range" min="0.5" max="6" step="0.01" :value="zoom" :disabled="!loaded" @input="slide" /></label>
        <button type="button" class="button" :disabled="!loaded" aria-label="向左轉" @click="rotate(-1)">↺</button>
        <button type="button" class="button" :disabled="!loaded" aria-label="向右轉" @click="rotate(1)">↻</button>
      </div>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="pick" />
    </div>
    <template #footer>
      <button type="button" class="button" @click="fileInput?.click()">重選檔案</button>
      <button type="button" class="button primary" @click="confirm">{{ mode === 'read' ? '確認並讀取' : '確認保存' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.card-cropper { display: grid; gap: 12px; }
.card-cropper-tools { display: flex; align-items: center; gap: 8px; }
.card-cropper-tools label { flex: 1; display: flex; align-items: center; gap: 10px; }
.card-cropper-tools input[type="range"] { flex: 1; }
</style>
