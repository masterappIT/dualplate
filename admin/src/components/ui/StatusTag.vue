<!-- 移植自 scaffold-vue/src/components/ui/StatusTag.vue，已改：採用產品樣式令牌。 -->
<script setup lang="ts">
import Tag from './Tag.vue'

withDefaults(defineProps<{
  status: number | boolean
  on?: string
  off?: string
  tone?: string
}>(), {
  on: '正常',
  off: '停用',
})
</script>

<template>
  <Tag :tone="tone || (status === 1 || status === true ? 'ok' : 'neutral')" dot>{{ status === 1 || status === true ? on : off }}</Tag>
</template>
