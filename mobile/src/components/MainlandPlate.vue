<template>
  <view class="mainland-plate" :style="box" :aria-label="'內地車牌 ' + text">
    <view class="rim" :style="rim"></view>
    <view v-for="(hole, index) in holes" :key="index" class="rivet" :style="hole"></view>
    <template v-if="chars.length === 7">
      <view v-for="(char, index) in chars" :key="index" class="slot" :style="slotStyle(index)"><text :style="isHan(char) ? han : latin">{{ char }}</text></view>
      <view class="dot" :style="dot"></view>
    </template>
    <text v-else class="fallback" :style="{ fontSize: px(0.1) }">{{ text }}</text>
  </view>
</template>
<script setup>
import { computed } from 'vue'
// Layout follows GA 36—2018 for the 440 × 140 mm Hong Kong/Macau entry plate: seven 45 × 90 mm
// characters, 12 mm gaps, a 34 mm gap holding the separator dot after the second character.
// `width` is the rendered width in rpx; every other size scales from it.
const props = defineProps({ plate: { type: String, default: '' }, width: { type: Number, default: 600 } })
const MM = 440
const lefts = [15.5, 72.5, 151.5, 208.5, 265.5, 322.5, 379.5]
const px = ratio => (props.width * ratio).toFixed(1) + 'rpx'
const text = computed(() => String(props.plate || '').toUpperCase().replace(/[\s·•.-]/g, '').replace(/^粤/, '粵'))
const chars = computed(() => { const m = text.value.match(/^([粵])([A-Z])([A-Z0-9]{4})([港澳])$/); return m ? [m[1], m[2], ...m[3].split(''), m[4]] : [] })
const isHan = char => /[一-鿿]/.test(char)
const slotStyle = index => ({ left: (lefts[index] / MM * 100) + '%', width: (45 / MM * 100) + '%' })
const box = computed(() => ({ width: px(1), height: px(140 / MM), borderRadius: px(0.015) }))
const rim = computed(() => ({ top: px(0.008), right: px(0.008), bottom: px(0.008), left: px(0.008), borderWidth: px(0.005), borderRadius: px(0.01) }))
const latin = computed(() => ({ fontFamily: "'DIN Alternate','DIN Condensed','Arial Narrow',Arial,sans-serif", transform: 'scaleX(.66)', fontSize: px(0.277), WebkitTextStroke: px(0.0034) + ' #f5f5f5' }))
const han = computed(() => ({ fontFamily: "'PingFang SC','Heiti SC','Microsoft YaHei',sans-serif", transform: 'scaleX(.56)', fontSize: px(0.197), WebkitTextStroke: px(0.0025) + ' #f5f5f5' }))
const dot = computed(() => ({ width: px(0.023), height: px(0.023), marginLeft: px(-0.0115), marginTop: px(-0.0115) }))
const holes = computed(() => [['18.2%', 'top'], ['79.6%', 'top'], ['18.2%', 'bottom'], ['79.6%', 'bottom']].map(([left, edge]) => ({ left, [edge]: '6.5%', width: px(0.018), height: px(0.018), marginLeft: px(-0.009) })))
</script>
<style scoped>
.mainland-plate{position:relative;max-width:100%;margin:0 auto;background:linear-gradient(180deg,#262626 0%,#0b0b0b 45%,#141414 100%);box-shadow:0 3rpx 8rpx rgba(0,0,0,.28),inset 0 1rpx 0 rgba(255,255,255,.18);overflow:hidden}
.rim{position:absolute;border-style:solid;border-color:#f2f2f2}
.rivet{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 35%,#d9d9d9,#7a7a7a 70%);box-shadow:0 0 0 1rpx #3a3a3a}
.slot{position:absolute;top:17.9%;height:64.3%;display:flex;align-items:center;justify-content:center;overflow:visible}
.slot text{color:#f5f5f5;line-height:1;white-space:nowrap;font-weight:700;text-shadow:0 1rpx 0 rgba(255,255,255,.2)}
.dot{position:absolute;left:30.57%;top:50%;border-radius:50%;background:#f5f5f5}
.fallback{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;color:#f5f5f5;font-weight:700}
</style>
