<!-- 移植自 scaffold-vue/src/components/layout/Topbar.vue，已改：固定工作空間麵包屑、客戶與車牌搜尋。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useAdminStore } from '../../store'
import { LogOut } from '@lucide/vue'
import Avatar from '../ui/Avatar.vue'
const emit = defineEmits<{ (event: 'menu'): void; (event: 'command'): void }>()
const { account, navigation, view, todayLabel, logout } = useAdminStore()
const current = computed(() => navigation.find(item => item.id === view.value)?.name || '詳細資料')
</script>
<template><header class="topbar"><button class="mobile-menu" type="button" aria-label="打開選單" @click="emit('menu')">☰</button><div class="breadcrumbs">工作空間 <span>/</span> {{ current }}</div><div class="top-actions"><span class="today">{{ todayLabel }}</span><span class="topbar-divider" /><button type="button" class="cmd-trigger" aria-label="快速搜尋客戶與車牌" @click="emit('command')">⌘K 搜尋</button><Avatar class="topbar-avatar" :name="account?.name" :size="28" /><button class="mobile-logout" type="button" aria-label="退出管理端登入" @click="logout"><LogOut :size="17" /></button></div></header></template>
