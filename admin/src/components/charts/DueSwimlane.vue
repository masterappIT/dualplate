<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PlateChip from '../ui/PlateChip.vue'
import DueDate from '../ui/DueDate.vue'
const props = defineProps<{ plates: any[]; deadlines: any[] }>()
const emit = defineEmits<{ (event: 'plate', id: string): void }>()
const fullYear = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval>
onMounted(() => { timer = setInterval(() => { if (!document.hidden) now.value = Date.now() }, 60000) })
onUnmounted(() => clearInterval(timer))
const start = computed(() => { const date = new Date(now.value); date.setMonth(date.getMonth() - 1); return date.getTime() })
const end = computed(() => { const date = new Date(now.value); date.setMonth(date.getMonth() + (fullYear.value ? 11 : 6)); return date.getTime() })
const position = (date: string) => Math.max(0, Math.min(100, (Date.parse(date) - start.value) / (end.value - start.value) * 100))
function events(plateId: string) {
  const occupied: number[] = []
  return props.deadlines.filter(item => item.ownerId === plateId && item.dueOn && Date.parse(item.dueOn) >= start.value && Date.parse(item.dueOn) <= end.value)
    .sort((first, second) => first.dueOn.localeCompare(second.dueOn))
    .map(item => {
      const offset = position(item.dueOn)
      const lane = occupied.findIndex(until => until < offset)
      const index = lane === -1 ? occupied.length : lane
      occupied[index] = offset + 19
      return { ...item, offset, lane: index }
    })
}
</script>
<template><section class="panel due-swimlane"><div class="panel-head"><div><h2>牌照到期時間軸</h2><p>每條泳道一個牌照；今天的線每分鐘更新。</p></div><button class="button" @click="fullYear = !fullYear">{{ fullYear ? '未來半年' : '全年' }}</button></div><div class="swim-head"><span>牌照</span><span>−1 月</span><span>今天</span><span>{{ fullYear ? '+11 月' : '+6 月' }}</span></div><div v-for="plate in plates" :key="plate.id" class="swim-row"><button @click="emit('plate', plate.id)"><PlateChip :plate="plate.mainland_plate || plate.local_plate" /></button><div class="swim-track" :style="{ minHeight: `${Math.max(50, 42 + events(plate.id).reduce((highest, item) => Math.max(highest, item.lane), 0) * 40)}px` }"><div class="swim-today" :style="{ left: `${position(new Date(now).toISOString())}%` }" /><button v-if="!deadlines.some(item => item.ownerId === plate.id && item.dueOn)" class="swim-empty" @click="emit('plate', plate.id)">未錄入到期日 →</button><div v-for="item in events(plate.id)" :key="`${item.ruleCode}:${item.dueOn}`" class="swim-block" :class="{ 'is-overdue': item.level === 'overdue' }" :style="{ left: `min(${item.offset}%, calc(100% - 165px))`, top: `${4 + item.lane * 40}px` }" :title="`${item.name} · ${item.dueOn}`"><span>{{ item.name }}</span><DueDate :date="item.dueOn" /></div></div></div><p v-if="!plates.length" class="empty">尚無牌照，請先登記牌照。</p></section></template>
