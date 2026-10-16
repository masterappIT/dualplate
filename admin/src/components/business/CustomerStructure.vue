<script setup lang="ts">
import { computed, ref } from 'vue'
import RelationGraph, { type GraphNode, type GraphLink } from '../charts/RelationGraph.vue'
import KeyValue from '../ui/KeyValue.vue'
import Button from '../ui/Button.vue'
import PlateChip from '../ui/PlateChip.vue'
const props = defineProps<{ customer: any; companies: any[]; groups: any[]; plates: any[]; vehicles: any[] }>()
const emit = defineEmits<{ (event: 'plate', id: string): void; (event: 'request', id: string): void }>()
const chosen = ref<string | null>(null)
const size = ref({ w: 0, h: 0 })
const nodes = computed<GraphNode[]>(() => {
  const narrow = size.value.w < 650
  const lane = (column: number) => narrow ? size.value.w * .42 + (column % 2) * 24 : 110 + column * Math.max(175, (size.value.w - 240) / 4)
  const line = (column: number, index: number, step: number) => {
    if (!narrow) return 90 + index * step
    const preceding = column === 1 ? 0 : column === 2 ? props.groups.length : column === 3 ? props.groups.length + props.companies.length : props.groups.length + props.companies.length + props.plates.length
    return 230 + preceding * 60 + (column - 1) * 48 + index * 60
  }
  const result: GraphNode[] = [{ id: 'customer', label: props.customer.name, sub: '客戶', kind: 'core', x: narrow ? size.value.w * .5 : 110, y: narrow ? 120 : 280, size: 96 }]
  const groups = [...props.groups]
  const companies = [...props.companies].sort((first, second) => groups.findIndex(group => group.id === first.group_id) - groups.findIndex(group => group.id === second.group_id))
  const plates = [...props.plates].sort((first, second) => groups.findIndex(group => group.id === first.group_id) - groups.findIndex(group => group.id === second.group_id))
  const vehicles = [...props.vehicles].sort((first, second) => plates.findIndex(plate => plate.vehicle_id === first.id) - plates.findIndex(plate => plate.vehicle_id === second.id))
  const ordered = groups.flatMap(group => [...companies.filter(item => item.group_id === group.id).map(item => `company:${item.id}`), ...plates.filter(item => item.group_id === group.id).map(item => `plate:${item.id}`)])
  const childY = (id: string) => 90 + Math.max(0, ordered.indexOf(id)) * 85
  const groupCenter = (groupId: string, index: number) => { const children = ordered.filter(id => companies.some(item => `company:${item.id}` === id && item.group_id === groupId) || plates.some(item => `plate:${item.id}` === id && item.group_id === groupId)); return narrow ? line(1, index, 130) : children.length ? (childY(children[0]) + childY(children[children.length - 1])) / 2 : 90 + index * 130 }
  groups.forEach((group, index) => result.push({ id: `group:${group.id}`, label: group.name || `公司組 ${index + 1}`, title: group.name, sub: '公司組', kind: 'item', x: lane(1), y: groupCenter(group.id, index), from: 'customer', delay: index * .08 }))
  companies.forEach((company, index) => result.push({ id: `company:${company.id}`, label: company.name, title: company.name, sub: `${company.jurisdiction || '公司'} · ${company.status || '狀態待補'}`, kind: 'item', tone: /註銷|解散/.test(company.status || '') ? 'danger' : undefined, x: lane(2), y: narrow ? line(2, index, 60) : childY(`company:${company.id}`), from: `group:${company.group_id}`, delay: index * .08 }))
  plates.forEach((plate, index) => result.push({ id: `plate:${plate.id}`, label: plate.mainland_plate || plate.local_plate || '車牌待補', title: plate.mainland_plate || plate.local_plate, sub: plate.route, kind: 'item', x: lane(3), y: narrow ? line(3, index, 60) : childY(`plate:${plate.id}`), from: `group:${plate.group_id}`, delay: index * .08 }))
  vehicles.forEach((vehicle, index) => result.push({ id: `vehicle:${vehicle.id}`, label: vehicle.plate || '車輛待補', title: vehicle.plate, sub: '車輛', kind: 'item', x: lane(4), y: narrow ? line(4, index, 60) : result.find(node => node.id === `plate:${plates.find(plate => plate.vehicle_id === vehicle.id)?.id}`)?.y ?? 90 + index * 95, from: `plate:${plates.find(plate => plate.vehicle_id === vehicle.id)?.id}`, delay: index * .08 }))
  return result
})
const links = computed<GraphLink[]>(() => nodes.value.filter(node => node.from && nodes.value.some(other => other.id === node.from)).map(node => ({ a: node.from!, b: node.id, flow: 'forward', tone: node.tone === 'danger' ? 'danger' : undefined })))
const current = computed(() => nodes.value.find(node => node.id === chosen.value))
const currentPlate = computed(() => props.plates.find(plate => chosen.value === `plate:${plate.id}`))
const summary = computed(() => [{ label: '類別', value: current.value?.sub || '' }, { label: '狀態', value: current.value?.tone === 'danger' ? '已註銷' : '可查看' }])
const graphHeight = computed(() => size.value.w < 650 ? Math.max(650, ...nodes.value.map(node => node.y + 80)) : undefined)
</script>
<template><div class="customer-structure"><RelationGraph v-model:size="size" variant="stage" :style="graphHeight ? { height: `${graphHeight}px` } : undefined" :nodes="nodes" :links="links" :active-id="chosen" label="客戶公司與牌照結構" pannable @select="chosen = $event.id" @back="chosen = null"><template #tl><div class="panorama-crumb">拖動平移 · Ctrl／⌘ + 滾輪縮放 · Esc 返回</div></template><template #br><div v-if="current" class="panorama-insight"><h2>{{ current.label }}</h2><KeyValue :items="summary" /><PlateChip v-if="currentPlate" :plate="currentPlate.mainland_plate || currentPlate.local_plate" /><div v-if="currentPlate" class="panorama-actions"><Button @click="emit('request', currentPlate.id)">開工單</Button><Button @click="emit('plate', currentPlate.id)">到牌照詳情</Button></div></div></template></RelationGraph><div v-if="current" class="panorama-insight is-mobile"><h2>{{ current.label }}</h2><KeyValue :items="summary" /><PlateChip v-if="currentPlate" :plate="currentPlate.mainland_plate || currentPlate.local_plate" /><div v-if="currentPlate" class="panorama-actions"><Button @click="emit('request', currentPlate.id)">開工單</Button><Button @click="emit('plate', currentPlate.id)">到牌照詳情</Button></div></div></div></template>
