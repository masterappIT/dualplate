<template>
  <view class="hk-plate" :style="box" :aria-label="'香港車牌 ' + text">
    <view class="edge" :style="{ borderRadius: px(0.013) }"></view>
    <view class="screw" :style="screw('left')"></view><view class="screw" :style="screw('right')"></view>
    <view v-for="(slot, index) in slots" :key="index" class="slot" :style="{ left: slot.left, width: slot.width }"><text :style="glyph">{{ slot.char }}</text></view>
  </view>
</template>
<script setup>
import { computed } from 'vue'
// Rear plate of the Road Traffic (Registration and Licensing of Vehicles) Regulations, Schedule 4:
// 520 × 111 mm yellow reflective ground with black characters about 79 mm high, 50 mm wide,
// 11 mm apart, and a wider gap between the letter group and the number group.
// `width` is the rendered width in rpx; every other size scales from it.
const props = defineProps({ plate: { type: String, default: '' }, width: { type: Number, default: 600 } })
const PLATE = 520, CHAR = 52, GAP = 10, GROUP_GAP = 30
const px = ratio => (props.width * ratio).toFixed(1) + 'rpx'
const text = computed(() => String(props.plate || '').toUpperCase().replace(/\s+/g, ''))
const slots = computed(() => {
  const match = text.value.match(/^([A-Z]{0,2})([0-9]{1,4})$/)
  const groups = match ? [match[1], match[2]].filter(Boolean) : [text.value]
  const chars = groups.flatMap((group, g) => group.split('').map((char, i) => ({ char, gapBefore: i === 0 ? (g === 0 ? 0 : GROUP_GAP) : GAP })))
  const total = chars.reduce((sum, item) => sum + CHAR + item.gapBefore, 0)
  let x = (PLATE - total) / 2
  return chars.map(item => { x += item.gapBefore; const slot = { char: item.char, left: (x / PLATE * 100) + '%', width: (CHAR / PLATE * 100) + '%' }; x += CHAR; return slot })
})
const box = computed(() => ({ width: px(1), height: px(111 / PLATE), borderRadius: px(0.013) }))
const glyph = computed(() => ({ fontSize: px(0.225), WebkitTextStroke: px(0.005) + ' #111' }))
const screw = side => ({ [side]: '5%', top: '9%', width: px(0.018), height: px(0.018) })
</script>
<style scoped>
.hk-plate{position:relative;max-width:100%;margin:0 auto;background:linear-gradient(180deg,#ffd83a 0%,#f6c400 55%,#eab900 100%);box-shadow:0 3rpx 8rpx rgba(0,0,0,.22),inset 0 1rpx 0 rgba(255,255,255,.55);overflow:hidden}
.edge{position:absolute;top:0;right:0;bottom:0;left:0;border:2rpx solid rgba(60,45,0,.55)}
.screw{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f4f4f4,#9a9a9a 70%);box-shadow:0 0 0 1rpx rgba(0,0,0,.35)}
.slot{position:absolute;top:10%;height:80%;display:flex;align-items:center;justify-content:center;overflow:visible}
.slot text{font-family:Arial,'Helvetica Neue',sans-serif;font-weight:700;line-height:1;color:#111;transform:scaleX(.86);white-space:nowrap}
</style>
