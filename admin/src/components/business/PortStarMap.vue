<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RelationGraph, { type GraphNode, type GraphLink } from '../charts/RelationGraph.vue'
import PlateChip from '../ui/PlateChip.vue'
import DueDate from '../ui/DueDate.vue'
import Segmented from '../ui/Segmented.vue'
import { useViewMode } from '../../composables/view'
import { useAdminStore } from '../../store'
import { itemGrid, narrowCoreX } from '../../composables/graph-grid'

const props = defineProps<{ plates: any[]; customers: any[]; isOverdue: (id: string) => boolean }>()
const emit = defineEmits<{ (event: 'plate', id: string): void }>()
const ownership = useViewMode('ports-ownership', 'all', ['all', 'self', 'client'], 'all')
const selectedPort = ref<string | null>(null)
const hoveredId = ref<string | null>(null)
const size = ref({ w: 0, h: 0 })
const { overviewData } = useAdminStore()
const visible = computed(() => props.plates.filter(plate => ownership.value === 'all' || Boolean(props.customers.find(item => item.id === plate.customer_id)?.is_self) === (ownership.value === 'self')))
// 批文卡辨識出的口岸可能是簡體或簡稱，歸併到系統口岸名稱，避免同一口岸出現兩個表盤
const cardPortNames: Record<string, string> = { 大橋: '港珠澳大橋', 大桥: '港珠澳大橋', 港珠澳大桥: '港珠澳大橋', 深圳湾: '深圳灣', 蓮塘: '蓮塘／香園圍', 莲塘: '蓮塘／香園圍', 皇岗: '皇崗', 落马洲: '落馬洲', 文锦渡: '文錦渡', 沙头角: '沙頭角', 横琴: '橫琴' }
const portOf = (plate: any) => { const raw = plate.port?.trim() || plate.card_data?.crossing?.trim(); return raw ? cardPortNames[raw] || raw : '口岸待補' }
const groups = computed<[string, any[]][]>(() => Object.entries(visible.value.reduce((result: Record<string, any[]>, plate) => { (result[portOf(plate)] ||= []).push(plate); return result }, {})))
watch(groups, value => { if (selectedPort.value && !value.some(group => group[0] === selectedPort.value)) selectedPort.value = null })
const nearest = (plate: any) => (overviewData.value.deadlines || []).filter((item: any) => item.ownerId === plate.id && item.dueOn).map((item: any) => item.dueOn).sort()[0] || [plate.card_expires_on, plate.permit_expires_on].filter(Boolean).sort()[0] || null
const hoveredPlate = computed(() => visible.value.find(plate => `plate:${plate.id}` === hoveredId.value))
const selectedPlates = computed(() => groups.value.find(group => group[0] === selectedPort.value)?.[1] || [])
const grid = computed(() => { const w = Math.max(320, size.value.w || 900); return itemGrid(w, w * .24) })
const columns = computed(() => grid.value.columns)
const drilledHeight = computed(() => Math.max(560, 92 + Math.ceil(selectedPlates.value.length / columns.value) * 68 + 60))
const customerOf = (plate: any) => props.customers.find(item => item.id === plate.customer_id)?.name || '客戶待補'
const graph = computed(() => {
  const w = Math.max(320, size.value.w || 900), h = Math.max(560, size.value.h || 640)
  const narrow = w < 650
  // 點了口岸：在圖上展開該口岸的牌照（與牌照全景點進分類一致），點牌照打開詳情
  if (selectedPort.value && selectedPlates.value.length) {
    const manyOwners = new Set(selectedPlates.value.map(plate => plate.customer_id)).size > 1
    const nodes: GraphNode[] = [{ id: 'core', x: narrow ? narrowCoreX(w) : w * .24, y: narrow ? 155 : Math.min(h, drilledHeight.value) * .5, kind: 'core', size: narrow ? 74 : 100, label: selectedPort.value, sub: `${selectedPlates.value.length} 個牌照`, interactive: false }]
    const links: GraphLink[] = []
    selectedPlates.value.forEach((plate, index) => {
      const due = nearest(plate)
      const id = `plate:${plate.id}`
      nodes.push({ id, x: grid.value.x(index), y: 92 + Math.floor(index / columns.value) * 68, kind: 'item', align: 'left', label: plate.mainland_plate || plate.local_plate || '車牌待補', sub: `${due ? `最近到期 ${due.slice(0, 10)}` : '到期日待錄入'}${manyOwners ? ` · ${customerOf(plate)}` : ''}`, tone: props.isOverdue(plate.id) ? 'danger' : undefined, from: 'core', delay: Math.min(index * .055, 1.5) })
      links.push({ a: 'core', b: id, flow: 'forward', tone: props.isOverdue(plate.id) ? 'danger' : undefined })
    })
    return { nodes, links }
  }
  const nodes: GraphNode[] = [{ id: 'core', x: w * .5, y: narrow ? 100 : h * .48, kind: 'core', size: narrow ? 74 : 100, label: '口岸牌照', sub: `${visible.value.length} 個牌照`, interactive: false }]
  const links: GraphLink[] = []
  groups.value.forEach(([port, plates], index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / Math.max(groups.value.length, 1)
    const x = narrow ? w * (index % 2 ? .76 : .24) : w * .5 + Math.cos(angle) * w * .31
    const y = narrow ? 255 + Math.floor(index / 2) * 160 : h * .48 + Math.sin(angle) * Math.min(h * .29, 190)
    const group = plates || []
    nodes.push({ id: port, x, y, kind: 'hub', cat: index % 3 + 1, size: narrow ? 62 : 94, label: port, count: group.length, ratio: group.length ? group.filter(plate => !props.isOverdue(plate.id)).length / group.length : 0, from: 'core', delay: index * .09 })
    links.push({ a: 'core', b: port, cat: index % 3 + 1, flow: 'forward' })
    group.slice(0, 18).forEach((plate, itemIndex) => {
      const rotation = -Math.PI + itemIndex / group.length * Math.PI * 1.4
      nodes.push({ id: `plate:${plate.id}`, x: x + Math.cos(rotation) * (narrow ? 43 : 74), y: y + Math.sin(rotation) * (narrow ? 43 : 74), kind: 'dot', label: plate.mainland_plate || plate.local_plate || '車牌待補', title: `${plate.mainland_plate || plate.local_plate || '車牌待補'} · ${props.customers.find(item => item.id === plate.customer_id)?.name || '客戶待補'} · 最近到期 ${nearest(plate) || '待錄入'}`, tone: props.isOverdue(plate.id) ? 'danger' : undefined, from: port, delay: .3 + itemIndex * .035 })
      links.push({ a: port, b: `plate:${plate.id}`, tone: props.isOverdue(plate.id) ? 'danger' : undefined })
    })
  })
  return { nodes, links }
})
function select(node: GraphNode) { if (node.id.startsWith('plate:')) emit('plate', node.id.slice(6)); else selectedPort.value = selectedPort.value === node.id ? null : node.id }
const graphStyle = computed(() => selectedPort.value && selectedPlates.value.length ? { height: `${drilledHeight.value}px` } : size.value.w && size.value.w < 650 ? { height: `${Math.max(560, 330 + Math.ceil(groups.value.length / 2) * 160)}px` } : undefined)
</script>
<template>
  <div class="port-star"><Segmented v-model="ownership" :options="[{ value: 'all', label: '全部' }, { value: 'self', label: '本公司自有' }, { value: 'client', label: '客戶的' }]" label="牌照來源" /><RelationGraph v-model:size="size" variant="stage" :style="graphStyle" :nodes="graph.nodes" :links="graph.links" :active-id="selectedPort" label="口岸牌照星圖" @select="select" @back="selectedPort = null" @hover="hoveredId = $event"><template #tl><nav class="panorama-crumb" aria-label="視圖層級"><button type="button" @click="selectedPort = null">口岸牌照 · {{ visible.length }} 個</button><span v-if="selectedPort"> / {{ selectedPort }}</span></nav></template><template #tr><aside v-if="hoveredPlate && !selectedPort" class="port-hover" role="tooltip"><PlateChip :plate="hoveredPlate.mainland_plate || hoveredPlate.local_plate" /><span>{{ customers.find(item => item.id === hoveredPlate.customer_id)?.name || '客戶待補' }}</span><span>最近到期 <DueDate :date="nearest(hoveredPlate)" /></span></aside></template><template #bl><span class="panorama-hint">{{ selectedPort ? '點擊牌照打開詳情 · Esc 返回' : '點擊口岸展開牌照 · Esc 返回' }}</span></template></RelationGraph><div v-if="selectedPort" class="panel port-results"><div class="panel-head"><div><h2>{{ selectedPort }}</h2><p>{{ (groups.find(group => group[0] === selectedPort)?.[1] || []).length }} 個牌照</p></div></div><button v-for="plate in groups.find(group => group[0] === selectedPort)?.[1] || []" :key="plate.id" class="list-row" @click="emit('plate', plate.id)"><PlateChip :plate="plate.mainland_plate || plate.local_plate" /><span>{{ customers.find(item => item.id === plate.customer_id)?.name || '客戶待補' }}</span><DueDate :date="nearest(plate)" /></button><p v-if="selectedPort === '口岸待補'" class="cell-sub">請到牌照詳情補錄口岸。</p></div></div>
</template>
