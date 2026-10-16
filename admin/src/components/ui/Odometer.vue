<!-- 移植自 scaffold-vue/src/components/ui/Odometer.vue，已改：採用產品等寬讀數與減少動態效果。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ value: number | null | undefined; decimals?: number; group?: boolean }>(), { decimals: 0, group: true })
const mounted = ref(false)
onMounted(() => {
  const settle = () => { mounted.value = true }
  if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return settle()
  requestAnimationFrame(settle)
  window.setTimeout(settle, 120)
})
const text = computed(() => props.value == null || Number.isNaN(props.value) ? '—' : Number(props.value).toLocaleString('en-US', { minimumFractionDigits: props.decimals, maximumFractionDigits: props.decimals, useGrouping: props.group }))
const chars = computed(() => [...text.value].map((char, index, list) => ({ char, key: list.length - index, digit: /\d/.test(char) ? Number(char) : null })))
</script>
<template><span class="odometer" :aria-label="text" role="img"><span v-for="char in chars" :key="char.key" :class="['odo-cell', { 'is-sep': char.digit === null }]" aria-hidden="true"><span v-if="char.digit !== null" class="odo-strip" :style="{ transform: `translateY(${-(mounted ? char.digit : 0) * 10}%)`, transitionDelay: `${(char.key % 6) * 40}ms` }"><span v-for="digit in 10" :key="digit">{{ digit - 1 }}</span></span><template v-else>{{ char.char }}</template></span></span></template>
