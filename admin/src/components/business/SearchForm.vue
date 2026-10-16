<!-- 移植自 scaffold-vue/src/components/business/SearchForm.vue，已改：採用產品樣式令牌。 -->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'

/* 查询区：字段放默认插槽，回车即查询。查询 / 重置按钮统一在右侧。 */
defineProps<{ loading?: boolean }>()
const emit = defineEmits<{ (e: 'search'): void; (e: 'reset'): void }>()
</script>

<template>
  <form class="search-form m-surface reveal" role="search" @submit.prevent="emit('search')">
    <slot />
    <div class="search-actions">
      <Button variant="ghost" icon="refresh" @click="emit('reset')">重設</Button>
      <Button icon="search" type="submit" :loading="loading">查詢</Button>
    </div>
  </form>
</template>
