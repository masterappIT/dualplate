<!-- 移植自 scaffold-vue/src/components/ui/Avatar.vue，已改：單色通行綠印章，不使用腳手架的彩色頭像。 -->
<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ name?: string; size?: number }>(), { name: '', size: 32 })
const text = computed(() => { const name = (props.name || '?').trim(); return /^[\x00-\x7f]+$/.test(name) ? name.charAt(0).toUpperCase() : name.slice(-2) })
</script>
<template><span class="avatar" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">{{ text }}</span></template>
