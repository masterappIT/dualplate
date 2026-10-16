<!-- 移植自 scaffold-vue/src/components/ui/EmptyState.vue，已改：採用產品樣式令牌。 -->
<script setup lang="ts">
import Icon from '@/components/Icon.vue'

withDefaults(defineProps<{
  title?: string
  desc?: string
  icon?: string
}>(), {
  title: '沒有資料',
  icon: 'search',
})
</script>

<template>
  <div class="empty">
    <span class="empty-ico m-groove"><Icon :name="icon" :size="20" /></span>
    <div class="empty-title">{{ title }}</div>
    <div v-if="desc">{{ desc }}</div>
    <slot />
  </div>
</template>
