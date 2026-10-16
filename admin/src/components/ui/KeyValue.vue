<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number | null }>
}>()
</script>
<template><dl class="key-value"><div v-for="item in items" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value ?? '—' }}</dd></div></dl></template>
