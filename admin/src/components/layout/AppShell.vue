<!-- 移植自 scaffold-vue/src/components/layout/AppShell.vue，已改：保留現有 store，頁面出入場與 820px 側欄抽屜。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAdminStore } from '../../store'
import { pageEnter, pageLeave, playShellEntrance } from '../../composables/motion'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'
import CommandPalette from './CommandPalette.vue'
import RecordModal from '../RecordModal.vue'
import ConfirmHost from '../ui/ConfirmHost.vue'
import ToastHost from '../ui/ToastHost.vue'
import WelcomeGuide from './WelcomeGuide.vue'

const { selected, selectedCustomer, selectedVehicle, selectedPlate, error, showSuccess, showError } = useAdminStore()
const route = useRoute()
const frame = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const commandOpen = ref(false)
const requiresDetail = computed(() => ['customer-detail', 'plate-detail', 'vehicle-detail', 'request-detail'].includes(String(route.name)))
const hasDetail = computed(() => !requiresDetail.value || String(({ 'customer-detail': selectedCustomer.value, 'plate-detail': selectedPlate.value, 'vehicle-detail': selectedVehicle.value, 'request-detail': selected.value })[String(route.name)]?.id) === String(route.params.id))
function onShortcut(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandOpen.value = !commandOpen.value } else if (event.key === 'Escape' && menuOpen.value) menuOpen.value = false }
onMounted(() => { window.addEventListener('keydown', onShortcut); if (frame.value) playShellEntrance(frame.value) })
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut))
</script>
<template><div ref="frame" class="app-shell"><Sidebar :open="menuOpen" @navigate="menuOpen = false" /><div v-if="menuOpen" class="sidebar-scrim" @click="menuOpen = false" /><main class="content"><Topbar @menu="menuOpen = true" @command="commandOpen = true" /><div class="workspace"><div v-if="error" class="error workspace-message" role="alert">{{ error }}<button type="button" aria-label="關閉錯誤提示" @click="error = ''">×</button></div><router-view v-slot="{ Component }"><Transition mode="out-in" :css="false" @enter="pageEnter" @leave="pageLeave"><div v-if="!requiresDetail || hasDetail" :key="route.fullPath" class="page-transition"><component :is="Component" @saved="showSuccess" @error="showError" /></div></Transition></router-view></div></main><RecordModal /><CommandPalette :open="commandOpen" @close="commandOpen = false" /><ConfirmHost /><ToastHost /><WelcomeGuide /></div></template>
