<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RelationGraph, { type GraphLink, type GraphNode } from '../charts/RelationGraph.vue'
import PanoramaInsight from './PanoramaInsight.vue'
import { motionSkipped } from '../../composables/motion'

export interface PanoramaEntry {
  id: string
  label: string
  sub?: string
  danger?: boolean
  details?: Array<{ label: string; value: string | number | null }>
  chain?: Array<{ label: string; value: string }>
  deadlines?: Array<{ name: string; dueOn: string | null }>
  plate?: string
  plateId?: string
  staffId?: string
  canEditStaff?: boolean
}
export interface PanoramaCategory { id: string; label: string; ratio: number; entries: PanoramaEntry[] }
const props = defineProps<{ title: string; categories: PanoramaCategory[]; summary: Array<{ label: string; value: number; danger?: boolean; description?: string }> }>()
const emit = defineEmits<{ (event: 'plate', id: string): void; (event: 'request', id: string): void; (event: 'staff', id: string): void; (event: 'staff-action', id: string, action: string): void }>()
const category = ref<string | null>(null)
const selected = ref<string | null>(null)
const size = ref({ w: 0, h: 0 })
const burst = ref(0)
const activeCategory = computed(() => props.categories.find(item => item.id === category.value))
const activeEntry = computed(() => activeCategory.value?.entries.find(item => item.id === selected.value))
watch(() => props.categories, () => { if (selected.value && !activeEntry.value) selected.value = null })
const width = computed(() => Math.max(320, size.value.w || 900))
const height = computed(() => Math.max(540, size.value.h || 640))
const narrow = computed(() => width.value < 650)
const graphHeight = computed(() => activeEntry.value ? Math.max(650, (activeEntry.value.chain?.length || 1) * (narrow.value ? 60 : 56) + (narrow.value ? 280 : 180)) : narrow.value && activeCategory.value ? Math.max(650, activeCategory.value.entries.length * 68 + 180) : undefined)
const core = computed(() => ({ x: selected.value ? width.value * .18 : category.value ? width.value * .24 : width.value * .5, y: selected.value && narrow.value ? 155 : narrow.value && !category.value ? 315 : height.value * .51 }))
const countLabel = (item: PanoramaCategory) => `${item.entries.length} ${item.id === 'customers' ? '位客戶' : item.id === 'companies' ? '間公司' : item.id === 'plates' ? '個牌照' : item.id === 'staff' ? '位員工' : item.id === 'roles' ? '個級別' : '項功能'}`
const graph = computed(() => {
  const nodes: GraphNode[] = [{ id: 'core', ...core.value, label: props.title, sub: props.title === '牌照全景' ? `${props.categories.find(item => item.id === 'plates')?.entries.length || 0} 個牌照` : `${props.categories.find(item => item.id === 'staff')?.entries.length || 0} 位員工 · ${props.categories.find(item => item.id === 'functions')?.entries.length || 0} 項功能`, kind: 'core', size: narrow.value ? 84 : 104, interactive: false }]
  const links: GraphLink[] = []
  if (selected.value && activeEntry.value) {
    const chain = activeEntry.value.chain?.length ? activeEntry.value.chain : [{ label: activeCategory.value?.label || '資料', value: activeEntry.value.label }]
    chain.forEach((part, index) => {
      const id = `chain:${index}`
      nodes.push({ id, x: narrow.value ? width.value * .36 : width.value * .39 + (index % 2) * width.value * .22, y: narrow.value ? 245 + index * 60 : 100 + Math.floor(index / 2) * 110, label: part.value, sub: part.label, kind: 'item', from: index ? `chain:${index - 1}` : 'core', delay: index * .13, interactive: false, tone: activeEntry.value?.danger && index === chain.length - 1 ? 'danger' : undefined })
      links.push({ a: index ? `chain:${index - 1}` : 'core', b: id, flow: 'forward', tone: activeEntry.value?.danger ? 'danger' : undefined })
    })
    return { nodes, links }
  }
  if (category.value && activeCategory.value) {
    const entries = activeCategory.value.entries
    entries.forEach((entry, index) => {
      const columns = width.value < 650 ? 1 : width.value < 1000 ? 2 : 3
      const x = width.value * (width.value < 650 ? .48 : .43) + (index % columns) * (width.value < 650 ? 0 : width.value * .19)
      const y = 92 + Math.floor(index / columns) * 68
      nodes.push({ id: entry.id, x, y, label: entry.label, sub: entry.sub, kind: 'item', from: 'core', delay: Math.min(index * .055, 1.5), tone: entry.danger ? 'danger' : undefined, align: 'left' })
      links.push({ a: 'core', b: entry.id, flow: 'forward', tone: entry.danger ? 'danger' : undefined })
    })
    return { nodes, links }
  }
  const spread = width.value < 650 ? width.value * .3 : width.value * .24
  props.categories.forEach((item, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(3, props.categories.length)
    const x = narrow.value ? width.value * (index === 0 ? .5 : index === 1 ? .18 : .82) : core.value.x + Math.cos(angle) * spread
    const y = narrow.value ? (index === 0 ? 110 : 485) : core.value.y + Math.sin(angle) * Math.min(height.value * .27, 190)
    nodes.push({ id: item.id, x, y, label: item.label, sub: countLabel(item), count: item.entries.length, ratio: item.ratio, kind: 'hub', size: narrow.value ? 64 : 104, cat: index + 1, from: 'core', delay: .16 + index * .12 })
    links.push({ a: 'core', b: item.id, flow: 'forward', cat: index + 1 })
    item.entries.slice(0, 36).forEach((entry, dotIndex) => {
      const dotAngle = -Math.PI + dotIndex / Math.max(item.entries.length, 1) * Math.PI * 1.4
      const id = `${item.id}:dot:${entry.id}`
      nodes.push({ id, x: x + Math.cos(dotAngle) * (narrow.value ? 42 : 82), y: y + Math.sin(dotAngle) * (narrow.value ? 42 : 82), label: entry.label, kind: 'dot', from: item.id, delay: .45 + dotIndex * .02, tone: entry.danger ? 'danger' : undefined, cat: index + 1 })
      links.push({ a: item.id, b: id, tone: entry.danger ? 'danger' : undefined, cat: index + 1 })
    })
  })
  return { nodes, links }
})
function select(node: GraphNode) {
  const dot = node.id.match(/^(.+):dot:(.+)$/)
  if (dot) { category.value = dot[1]; selected.value = dot[2]; return }
  if (!category.value) category.value = node.id
  else selected.value = node.id
}
function back() { if (selected.value) selected.value = null; else category.value = null }
</script>
<template>
  <div :class="['panorama', { 'is-permission': title === '權限全景', 'is-drilled': category }]">
    <RelationGraph v-model:size="size" variant="stage" :style="graphHeight ? { height: `${graphHeight}px` } : undefined" :nodes="graph.nodes" :links="graph.links" :active-id="selected" :burst-key="burst" :label="title" @select="select" @back="back">
      <template #tl><nav class="panorama-crumb" aria-label="視圖層級"><button @click="category = null; selected = null">{{ title }}</button><template v-if="activeCategory"> / <button @click="selected = null">{{ activeCategory.label }}</button></template><span v-if="activeEntry"> / {{ activeEntry.label }}</span></nav></template>
      <template #tr><div v-if="!selected" class="panorama-summary"><span v-for="item in summary" :key="item.label"><small :title="item.description">{{ item.label }}</small><strong :class="{ 'is-danger': item.danger && item.value > 0 }">{{ item.value }}</strong><small v-if="item.description">{{ item.description }}</small></span></div></template>
      <template #bl><span class="panorama-hint">點擊表盤查看條目 · Esc 逐層返回{{ motionSkipped() ? ' · 已減少動態效果' : '' }}</span></template>
      <template #br><PanoramaInsight v-if="activeEntry" :entry="activeEntry" @plate="emit('plate', $event)" @request="emit('request', $event)" @staff="emit('staff', $event)" @staff-action="(id, action) => emit('staff-action', id, action)" /></template>
    </RelationGraph>
    <div class="panorama-summary is-mobile"><span v-for="item in summary" :key="item.label"><small>{{ item.label }}</small><strong :class="{ 'is-danger': item.danger && item.value > 0 }">{{ item.value }}</strong><small v-if="item.description">{{ item.description }}</small></span></div>
    <PanoramaInsight v-if="activeEntry" class="is-mobile" :entry="activeEntry" @plate="emit('plate', $event)" @request="emit('request', $event)" @staff="emit('staff', $event)" @staff-action="(id, action) => emit('staff-action', id, action)" />
    <div class="panorama-index"><button v-for="item in activeCategory?.entries || []" :key="item.id" @click="selected = item.id">{{ item.label }}</button></div>
  </div>
</template>
