<template>
  <!-- 到期徽章：左側狀態色條＋等寬日期＋「還有／逾期 N 天」（docs/design-system.md 第二節）。 -->
  <view class="due-badge" :class="tone">
    <text class="date num">{{ date || '待錄入' }}</text>
    <text v-if="date" class="left">{{ phrase }}</text>
  </view>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ date: { type: String, default: '' }, days: { type: Number, default: null }, level: { type: String, default: '' } })
const daysLeft = computed(() => {
  if (props.days !== null && props.days !== undefined) return props.days
  if (!props.date) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(props.date + 'T00:00:00') - today) / 86400000)
})
const phrase = computed(() => daysLeft.value === null ? '' : daysLeft.value < 0 ? `逾期 ${-daysLeft.value} 天` : daysLeft.value === 0 ? '今天到期' : `還有 ${daysLeft.value} 天`)
const tone = computed(() => props.level || (!props.date ? 'muted' : daysLeft.value < 0 ? 'overdue' : daysLeft.value <= 30 ? 'due' : 'ok'))
</script>
<style scoped>
.due-badge{display:inline-flex;flex-direction:column;align-items:flex-end;gap:2rpx;padding-right:14rpx;border-right:6rpx solid currentColor}
.date{font-size:24rpx;font-weight:800;color:var(--ink)}
.left{font-size:20rpx;font-weight:750}
.overdue{color:var(--overdue)}.due{color:var(--due)}.ok{color:var(--ok)}.upcoming{color:var(--ok)}.muted{color:var(--muted)}
.muted .date{color:var(--ink-3)}
</style>
