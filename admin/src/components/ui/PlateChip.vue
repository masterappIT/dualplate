<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ plate?: string | null; route?: string }>()
const category = computed(() => {
  const value = props.plate?.trim() || ''
  if (/^[京津滬渝冀豫雲遼黑湘皖魯新蘇浙贛鄂桂甘晉蒙陝吉閩貴粵青藏川寧瓊]/u.test(value)) return 'mainland'
  if (/^M[A-Z0-9\s-]+$/i.test(value)) return 'macau'
  if (/^[A-Z]{1,2}\s?\d{1,4}$/i.test(value)) return 'hongkong'
  return 'unknown'
})
</script>
<template><span :class="['plate-chip', `plate-chip-${category}`]">{{ plate || '待補充' }}</span></template>
