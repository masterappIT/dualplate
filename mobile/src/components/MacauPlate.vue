<template>
  <view class="mo-plate" :style="box" :aria-label="'澳門車牌 ' + shown">
    <view class="edge" :style="edge"></view>
    <view v-if="relief" class="sheen"></view>
    <view class="screw" :style="screw('left')"></view><view class="screw" :style="screw('right')"></view>
    <view v-for="(slot, index) in slots" :key="index" class="slot" :style="{ left: slot.left, width: slot.width }"><view v-if="slot.dash" class="dash" :style="dash"></view><text v-else :style="glyph">{{ slot.char }}</text></view>
  </view>
</template>
<script setup>
import { computed } from 'vue'
// Macau plate drawn like HongKongPlate.vue: black ground, white characters in three groups split by dashes
// (MA-12-34), a thin silver frame. Plate size, character size, gaps and stroke match HongKongPlate.vue (520 × 111)
// so the two read as a pair; the dashes stay short so the number spans about as wide as a Hong Kong one.
// `width` is the rendered width in rpx; every other size scales from it. `textScale` shrinks the characters only
// and `relief` adds the stamped-metal depth (raised characters and frame, bevelled edge, light sheen); the login
// samples use both, the defaults keep it flat.
const props = defineProps({ plate: { type: String, default: '' }, width: { type: Number, default: 600 }, textScale: { type: Number, default: 1 }, relief: { type: Boolean, default: false } })
const PLATE = 520, CHAR = 52, GAP = 10, DASH = 18
const px = ratio => (props.width * ratio).toFixed(1) + 'rpx'
const text = computed(() => String(props.plate || '').toUpperCase().replace(/[\s-]/g, ''))
const groups = computed(() => { const m = text.value.match(/^([A-Z]{1,2})(\d{2})(\d{2})$/); return m ? m.slice(1) : [text.value] })
const shown = computed(() => groups.value.join('-'))
const slots = computed(() => {
  const items = groups.value.flatMap((group, g) => [...(g ? [{ dash: true, size: DASH }] : []), ...group.split('').map(char => ({ char, size: CHAR }))])
  const total = items.reduce((sum, item, i) => sum + item.size + (i ? GAP : 0), 0)
  let x = (PLATE - total) / 2
  return items.map((item, i) => { if (i) x += GAP; const slot = { ...item, left: (x / PLATE * 100) + '%', width: (item.size / PLATE * 100) + '%' }; x += item.size; return slot })
})
const box = computed(() => ({ width: px(1), height: px(111 / PLATE), borderRadius: px(0.013), ...(props.relief ? { boxShadow: `0 ${px(0.01)} ${px(0.016)} rgba(0,0,0,.55),0 ${px(0.003)} 0 #000,inset 0 ${px(0.004)} 0 rgba(255,255,255,.3),inset 0 -${px(0.005)} 0 rgba(0,0,0,.7)` } : {}) }))
const edge = computed(() => ({ top: px(0.012), right: px(0.012), bottom: px(0.012), left: px(0.012), borderWidth: px(0.004), borderRadius: px(0.009), ...(props.relief ? { boxShadow: `0 ${px(0.004)} ${px(0.005)} rgba(0,0,0,.9),inset 0 ${px(0.004)} ${px(0.005)} rgba(0,0,0,.9)` } : {}) }))
const raised = computed(() => props.relief ? { textShadow: `0 -${px(0.003)} 0 rgba(255,255,255,.45),0 ${px(0.005)} ${px(0.005)} rgba(0,0,0,.95)` } : {})
const glyph = computed(() => ({ fontSize: px(0.225 * props.textScale), WebkitTextStroke: px(0.005 * props.textScale) + ' #f5f5f5', ...raised.value }))
const dash = computed(() => ({ height: px(0.016), ...(props.relief ? { boxShadow: `0 ${px(0.005)} ${px(0.005)} rgba(0,0,0,.95)` } : {}) }))
const screw = side => ({ [side]: '4%', top: '12%', width: px(0.016), height: px(0.016) })
</script>
<style scoped>
.mo-plate{position:relative;max-width:100%;margin:0 auto;background:linear-gradient(180deg,#262626 0%,#0b0b0b 45%,#141414 100%);box-shadow:0 3rpx 8rpx rgba(0,0,0,.28),inset 0 1rpx 0 rgba(255,255,255,.18);overflow:hidden}
.edge{position:absolute;border-style:solid;border-color:#c9c9c9}
.sheen{position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(160deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,.06) 34%,rgba(255,255,255,0) 36%);pointer-events:none}
.screw{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d9d9d9,#7a7a7a 70%);box-shadow:0 0 0 1rpx #3a3a3a}
.slot{position:absolute;top:10%;height:80%;display:flex;align-items:center;justify-content:center;overflow:visible}
.slot text{font-family:Arial,'Helvetica Neue',sans-serif;font-weight:700;line-height:1;color:#f5f5f5;transform:scaleX(.86);white-space:nowrap}
.dash{width:100%;border-radius:1rpx;background:#f5f5f5}
</style>
