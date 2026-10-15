<template>
  <!-- 車牌徽章：縮小版仿真車牌，凡顯示車牌處都用它（docs/design-system.md 第二節）。 -->
  <view class="plate-chip" :class="[kind, size]" :aria-label="label + ' ' + shown"><text class="num">{{ shown }}</text></view>
</template>
<script setup>
import { computed } from 'vue'
// kind 自動判斷：內地（省份簡稱開頭，如「粵Z」）黑底白字；香港（1–2 個英文字母＋數字，或自訂字串）黃底黑字；
// 澳門（M 開頭加數字分段，如「MM-12-34」）白底黑字；判斷不了用中性框。
const props = defineProps({ plate: { type: String, default: '' }, region: { type: String, default: '' }, size: { type: String, default: 'md' } })
const shown = computed(() => String(props.plate || '').trim() || '待補充')
const kind = computed(() => {
  if (props.region) return { 內地: 'mainland', 香港: 'hk', 澳門: 'mo' }[props.region] || 'unknown'
  const text = shown.value.toUpperCase()
  if (/^[一-龥]/.test(text)) return 'mainland'
  if (/^M[A-Z]?[-\s]?\d{2}[-\s]?\d{2}$/.test(text)) return 'mo'
  if (/^[A-Z0-9 ]{1,8}$/.test(text) && text !== '待補充') return 'hk'
  return 'unknown'
})
const label = computed(() => ({ mainland: '內地車牌', hk: '香港車牌', mo: '澳門車牌', unknown: '車牌' })[kind.value])
</script>
<style scoped>
.plate-chip{display:inline-flex;align-items:center;justify-content:center;border-radius:6rpx;padding:4rpx 14rpx;font-weight:800;line-height:1.3;white-space:nowrap;box-shadow:inset 0 0 0 2rpx rgba(0,0,0,.18)}
.plate-chip text{letter-spacing:.06em}
.md{font-size:24rpx}.sm{font-size:20rpx;padding:2rpx 10rpx}.lg{font-size:30rpx;padding:6rpx 18rpx}
.mainland{background:#141414;color:#fff;box-shadow:inset 0 0 0 2rpx #141414,inset 0 0 0 4rpx #fff}
.hk{background:#F2C230;color:#111}
.mo{background:#fff;color:#111;box-shadow:inset 0 0 0 2rpx #111}
.unknown{background:var(--muted-bg);color:var(--ink-3);box-shadow:inset 0 0 0 1rpx var(--rule);font-weight:700}
</style>
