<!-- 移植自 scaffold-vue/src/components/layout/Topbar.vue，已改：固定工作空間麵包屑、客戶與車牌搜尋。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useAdminStore } from '../../store'
import { LogOut } from '@lucide/vue'
import Avatar from '../ui/Avatar.vue'
import { todayPending } from '../../composables/live-refresh'
const emit = defineEmits<{ (event: 'menu'): void; (event: 'command'): void }>()
const { account, navigation, view, todayLabel, logout, selectedCustomer, selectedPlate, selectedVehicle, selected } = useAdminStore()
// 詳情頁顯示所屬欄目與對象名稱，例如「客戶 / 李先生」，不再只寫「詳細資料」。
const plateName = (plate: any) => [plate?.mainland_plate, plate?.local_plate].filter(Boolean).join(' · ') || plate?.card_number || '牌照'
const current = computed(() => {
  const top = navigation.find(item => item.id === view.value)?.name
  if (top) return top
  if (view.value === 'customer-detail') return `客戶 / ${selectedCustomer.value?.name || ''}`
  if (view.value === 'plate-detail') return `牌照 / ${plateName(selectedPlate.value)}`
  if (view.value === 'vehicle-detail') return `牌照 / ${selectedVehicle.value?.plate || '車輛'}`
  if (view.value === 'request-detail') return `業務 / ${selected.value?.title || '工單'}`
  if (view.value === 'new-request') return '業務 / 新增工單'
  return '詳細資料'
})
</script>
<template><header class="topbar"><button class="mobile-menu" type="button" :aria-label="todayPending?.total ? `打開選單，今日工作有 ${todayPending.total} 項待處理` : '打開選單'" @click="emit('menu')">☰<span v-if="todayPending?.total" class="menu-count" aria-hidden="true">{{ todayPending.total }}</span></button><div class="breadcrumbs">工作空間 <span>/</span> {{ current }}</div><div class="top-actions"><span class="today">{{ todayLabel }}</span><span class="topbar-divider" /><button type="button" class="cmd-trigger" aria-label="快速搜尋客戶與車牌" @click="emit('command')">⌘K 搜尋</button><Avatar class="topbar-avatar" :name="account?.name" :size="28" /><button class="mobile-logout" type="button" aria-label="退出管理端登入" @click="logout"><LogOut :size="17" /></button></div></header></template>
