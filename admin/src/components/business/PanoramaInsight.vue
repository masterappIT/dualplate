<script setup lang="ts">
import KeyValue from '../ui/KeyValue.vue'
import PlateChip from '../ui/PlateChip.vue'
import DueDate from '../ui/DueDate.vue'
import Button from '../ui/Button.vue'
import type { PanoramaEntry } from './PanoramaGraph.vue'

defineProps<{ entry: PanoramaEntry }>()
const emit = defineEmits<{ (event: 'plate', id: string): void; (event: 'request', id: string): void; (event: 'staff', id: string): void; (event: 'staff-action', id: string, action: string): void }>()
</script>
<template>
  <aside class="panorama-insight"><h2>{{ entry.label }}</h2><p>{{ entry.sub }}</p><PlateChip v-if="entry.plate" :plate="entry.plate" /><KeyValue :items="entry.details || []" /><div v-for="date in entry.deadlines" :key="date.name" class="panorama-due"><span>{{ date.name }}</span><DueDate :date="date.dueOn" /></div><div class="panorama-actions"><Button v-if="entry.plateId" @click="emit('request', entry.plateId)">開工單</Button><Button v-if="entry.plateId" @click="emit('plate', entry.plateId)">到牌照詳情</Button><template v-if="entry.staffId"><Button v-if="entry.canEditStaff" @click="emit('staff-action', entry.staffId, 'active')">停用／啟用</Button><Button v-if="entry.canEditStaff" @click="emit('staff-action', entry.staffId, 'role')">改角色</Button><Button @click="emit('staff', entry.staffId)">重設密碼</Button></template></div></aside>
</template>
