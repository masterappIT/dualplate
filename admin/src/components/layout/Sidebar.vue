<!-- 移植自 scaffold-vue/src/components/layout/Sidebar.vue，已改：固定五項導航、實心深綠側欄。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAdminStore } from '../../store'
import { slideThumb } from '../../composables/motion'
import { ShieldCheck, LogOut } from '@lucide/vue'
import Avatar from '../ui/Avatar.vue'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'navigate'): void }>()
const { navigation, view, newCount, account, navigate, logout } = useAdminStore()
const root = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)
const active = computed(() => ['customer-detail', 'plate-detail', 'vehicle-detail', 'request-detail', 'new-request'].includes(view.value) ? ({ 'customer-detail': 'customers', 'plate-detail': 'plates', 'vehicle-detail': 'plates', 'request-detail': 'business', 'new-request': 'business' })[view.value] : view.value)
function sync() { nextTick(() => slideThumb(thumb.value, root.value?.querySelector<HTMLElement>('.nav-item.active') || null, 'y')) }
watch(active, sync)
onMounted(sync)
function select(id: string) { navigate(id); emit('navigate') }
</script>
<template>
  <aside ref="root" class="sidebar" :class="{ 'is-open': open }">
    <div class="brand"><div class="brand-icon">牌</div><div><strong>車牌管家</strong><small>管理端</small></div></div>
    <div class="nav-group-title">工作空間</div>
    <span ref="thumb" class="nav-thumb" aria-hidden="true" />
    <button v-for="nav in navigation" :key="nav.id" type="button" class="nav-item" :class="{ active: active === nav.id }" :title="nav.name" @click="select(nav.id)"><component :is="nav.icon" class="nav-symbol" :size="19" :stroke-width="1.8" /><span>{{ nav.name }}</span><span v-if="nav.id === 'business' && newCount" class="nav-count">{{ newCount }}</span></button>
    <div class="sidebar-bottom"><div class="source-mini"><ShieldCheck :size="17" /> 業務資訊依官方來源核對</div><button class="profile" @click="logout"><Avatar :name="account?.name" /><span>{{ account?.name }}<small>管理員 · 退出登入</small></span><LogOut :size="16" class="logout-icon" /></button></div>
  </aside>
</template>
