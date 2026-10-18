<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ plate?: string | null; route?: string }>()
// 車牌徽章：內地黑底、香港黃底、澳門白底。傳入「內地 · 香港」合併字串（點號前後有空格）時拆成兩個徽章；內地車牌本身的「粵Z·A123港」不拆，免得香港牌被畫成黑牌。
const kind = (value: string) => {
  if (/^[京津滬渝冀豫雲遼黑湘皖魯新蘇浙贛鄂桂甘晉蒙陝吉閩貴粵青藏川寧瓊]/u.test(value)) return 'mainland'
  // 澳門車牌固定「M＋字母＋兩組兩位數字」；粵澳路線的非內地車牌也是澳門牌
  if (/^M[A-Z]?[-\s]?\d{2}[-\s]?\d{2}$/i.test(value) || (props.route === '粵澳' && value)) return 'macau'
  // 香港車牌含自訂車牌（如 LUCKY8、ME1KA、0NL1NG）：最多 8 個英文字母、數字或空格
  if (/^[A-Z0-9][A-Z0-9 ]{0,7}$/i.test(value)) return 'hongkong'
  return 'unknown'
}
const parts = computed(() => {
  const list = String(props.plate || '').split(/\s+[·・]\s+/).map(item => item.trim()).filter(item => item && !/待補/.test(item))
  return list.length ? list : ['']
})
</script>
<template><span v-if="parts.length > 1" class="plate-chip-pair"><span v-for="(part, index) in parts" :key="index" :class="['plate-chip', `plate-chip-${kind(part)}`]">{{ part }}</span></span><span v-else :class="['plate-chip', `plate-chip-${kind(parts[0])}`]">{{ parts[0] || '待補充' }}</span></template>
