<!-- 移植自 scaffold-vue/src/components/layout/CommandPalette.vue，已改：只搜尋本產品客戶與車牌。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAdminStore } from '../../store'
import { overlayEnter, overlayLeave, revealCascade, slideThumb } from '../../composables/motion'
import { createFocusTrap } from '../../composables/focus'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { customers, plates, openCustomer, openPlate } = useAdminStore()
const panel = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const keyword = ref('')
const active = ref(0)
const trap = createFocusTrap()
const entries = computed(() => {
  const term = keyword.value.trim().toLowerCase()
  const names = customers.value.filter(item => !term || `${item.name} ${item.phone || ''}`.toLowerCase().includes(term)).slice(0, 8).map(item => ({ key: `customer-${item.id}`, label: item.name, sub: '客戶', run: () => openCustomer(item) }))
  const numbers = plates.value.filter(item => !term || `${item.mainland_plate || ''} ${item.local_plate || ''}`.toLowerCase().includes(term)).slice(0, 8).map(item => ({ key: `plate-${item.id}`, label: `${item.mainland_plate || '待補充'} · ${item.local_plate || '待補充'}`, sub: '牌照', run: () => openPlate(item) }))
  return [...names, ...numbers]
})
function syncThumb() { nextTick(() => slideThumb(thumb.value, list.value?.querySelectorAll<HTMLElement>('button')[active.value] || null, 'y')) }
function choose(index: number) { const entry = entries.value[index]; if (!entry) return; entry.run(); emit('close') }
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && trap.isTop()) { event.stopImmediatePropagation(); emit('close') }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + entries.value.length) % (entries.value.length || 1); syncThumb() }
  else if (event.key === 'Enter') { event.preventDefault(); choose(active.value) }
}
watch(() => props.open, async open => {
  if (open) {
    keyword.value = ''; active.value = 0
    document.addEventListener('keydown', onKey)
    await nextTick(); if (!props.open) return
    trap.activate(panel.value); input.value?.focus()
    revealCascade(list.value, 'button')
    syncThumb()
  } else { document.removeEventListener('keydown', onKey); trap.deactivate() }
}, { immediate: true })
watch(entries, () => { active.value = 0; syncThumb() })
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); trap.deactivate() })
</script>
<template>
  <Teleport to="body"><Transition :css="false" @enter="(element, done) => overlayEnter(element, done, 'modal')" @leave="(element, done) => overlayLeave(element, done, 'modal')">
    <div v-if="open" class="overlay" @click.self="emit('close')"><section ref="panel" class="command-panel" role="dialog" aria-modal="true" aria-label="快速搜尋客戶與車牌"><input ref="input" v-model="keyword" class="command-input" placeholder="搜尋客戶或車牌…" aria-label="搜尋客戶或車牌" /><div ref="list" class="command-results"><span ref="thumb" class="command-thumb" aria-hidden="true" /><button v-for="(entry, index) in entries" :key="entry.key" type="button" :class="{ 'is-active': active === index }" @mouseenter="active = index; syncThumb()" @click="choose(index)"><span>{{ entry.label }}</span><small>{{ entry.sub }}</small></button><p v-if="!entries.length">沒有符合條件的客戶或牌照</p></div><footer>↑ ↓ 選擇 · Enter 開啟 · Esc 關閉</footer></section></div>
  </Transition></Teleport>
</template>
