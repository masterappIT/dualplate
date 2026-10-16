<script setup>
import { ref } from 'vue'
import PlateChip from '../ui/PlateChip.vue'
import Tag from '../ui/Tag.vue'

const props = defineProps({ rows: { type: Array, required: true }, services: { type: Array, required: true }, pending: { type: Object, required: true }, isSelf: Boolean, saving: Boolean })
const emit = defineEmits(['change'])
const hoverRow = ref(''), hoverColumn = ref('')
const choices = [{ value: 'us', label: '我們做', tone: 'ok' }, { value: 'outsourced', label: '外包', tone: 'warning' }, { value: 'client', label: '客戶自理', tone: 'neutral' }]
function state(row, service) { return props.pending[`${row.type}:${row.id}:${service}`]?.handler || row.services.find(item => item.service === service)?.handler }
function cycle(row, service) {
  const available = props.isSelf ? choices.slice(0, 2) : choices
  const next = available[(available.findIndex(item => item.value === state(row, service)) + 1) % available.length]
  emit('change', row, service, next.value)
}
</script>
<template>
  <div class="scope-matrix-scroll">
    <div class="scope-matrix" role="grid" :aria-rowcount="rows.length + 1" :aria-colcount="services.length + 1" @pointerleave="hoverRow = hoverColumn = ''">
      <div class="scope-matrix-row scope-matrix-head" role="row"><div role="columnheader">公司／牌照</div><div v-for="service in services" :key="service.code" role="columnheader" :class="{ 'is-col-hover': hoverColumn === service.code }">{{ service.label }}</div></div>
      <div v-for="row in rows" :key="`${row.type}:${row.id}`" class="scope-matrix-row" :class="{ 'is-row-hover': hoverRow === row.id }" role="row">
        <div class="scope-matrix-owner" role="rowheader"><PlateChip v-if="row.type === 'plate'" :plate="row.label" /><strong v-else>{{ row.label }}</strong></div>
        <div v-for="service in services" :key="service.code" class="scope-matrix-slot" role="gridcell" :class="{ 'is-col-hover': hoverColumn === service.code }">
          <button v-if="row.services.some(item => item.service === service.code)" type="button" class="scope-matrix-cell" :disabled="saving" :aria-label="`${row.label} · ${service.label}：${choices.find(item => item.value === state(row, service.code))?.label}，按下切換`" @pointerenter="hoverRow = row.id; hoverColumn = service.code" @focus="hoverRow = row.id; hoverColumn = service.code" @click="cycle(row, service.code)"><Tag :tone="choices.find(item => item.value === state(row, service.code))?.tone">{{ choices.find(item => item.value === state(row, service.code))?.label }}</Tag></button>
          <span v-else class="scope-matrix-empty">不適用</span>
        </div>
      </div>
    </div>
  </div>
</template>
