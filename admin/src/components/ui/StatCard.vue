<script setup lang="ts">
import Odometer from './Odometer.vue'
defineProps<{
  label: string
  value: number | string
  hint?: string
  active?: boolean
  tone?: 'danger' | 'warning' | 'ok' | 'info' | 'neutral'
}>()
</script>
<template><button type="button" :class="['stat-card', `tone-${tone || 'neutral'}`, { 'is-active': active }]"><span>{{ label }}</span><strong><Odometer v-if="typeof value === 'number'" :value="value" /><template v-else>{{ value }}</template></strong><small v-if="hint">{{ hint }}</small></button></template>
