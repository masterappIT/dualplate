<script setup lang="ts">
import { computed, ref } from 'vue'
import RelationGraph, { type GraphNode, type GraphLink } from '../charts/RelationGraph.vue'
const props = defineProps<{ headers: string[]; fields: string[] }>()
const emit = defineEmits<{ (event: 'change', mapping: Record<string, string>): void }>()
const size = ref({ w: 0, h: 0 })
const overrides = ref<Record<string, string>>({})
const normalize = (value: string) => value.replace(/[\s/／_\-]/g, '').toLowerCase()
const map = computed(() => Object.fromEntries(props.headers.map(header => [header, overrides.value[header] ?? props.fields.find(field => normalize(field) === normalize(header)) ?? ''])))
const active = ref<string | null>(null)
const graph = computed(() => {
  const width = Math.max(320, size.value.w || 700)
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  props.headers.forEach((header, index) => nodes.push({ id: `source:${header}`, x: width * .25, y: 70 + index * 48, label: header, sub: '客戶欄位', kind: 'item', align: 'right', delay: index * .05, tone: map.value[header] ? undefined : 'danger' }))
  props.fields.forEach((field, index) => nodes.push({ id: `target:${field}`, x: width * .72, y: 70 + index * 48, label: field, sub: '系統欄位', kind: 'item', align: 'left', delay: .2 + index * .05 }))
  props.headers.forEach(header => { if (map.value[header]) links.push({ a: `source:${header}`, b: `target:${map.value[header]}`, shape: 'h', flow: 'forward' }) })
  return { nodes, links }
})
function choose(node: GraphNode) {
  if (node.id.startsWith('source:')) active.value = node.id.slice(7)
  else if (active.value && node.id.startsWith('target:')) { overrides.value = { ...overrides.value, [active.value]: node.id.slice(7) }; emit('change', map.value); active.value = null }
}
function selectField(event: Event, header: string) { overrides.value = { ...overrides.value, [header]: (event.target as HTMLSelectElement).value }; emit('change', map.value) }
</script>
<template><div class="csv-pipeline"><p>選取左欄後點右欄即可修改對應；未對應的紅線條目須先處理。</p><RelationGraph v-model:size="size" :nodes="graph.nodes" :links="graph.links" :active-id="active ? `source:${active}` : null" label="CSV 欄位對應" @select="choose" @back="active = null" /><div class="pipeline-fields"><label v-for="header in headers" :key="header">{{ header }} → <select :value="map[header]" :aria-label="`${header}對應欄位`" @change="selectField($event, header)"><option value="">未對應</option><option v-for="field in fields" :key="field" :value="field">{{ field }}</option></select></label></div></div></template>
