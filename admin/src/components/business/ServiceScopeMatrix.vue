<script setup>
import { computed, ref } from 'vue'
import PlateChip from '../ui/PlateChip.vue'
import Tag from '../ui/Tag.vue'
import Button from '../ui/Button.vue'
import Select from '../ui/Select.vue'

// 委託範圍：按香港公司、澳門公司、內地公司、車牌分段（docs/tasks/scope-items-design.md §6）。
// 公司段每欄一件事；車牌段每欄一個小組，按「展開」逐件調整。
const props = defineProps({ data: { type: Object, required: true }, pending: { type: Object, required: true }, isSelf: Boolean, saving: Boolean })
const emit = defineEmits(['change', 'column', 'items'])
const choices = [{ value: 'us', label: '我們做', tone: 'ok' }, { value: 'outsourced', label: '外包', tone: 'info' }, { value: 'client', label: '客戶自理', tone: 'neutral' }]
const available = computed(() => props.isSelf ? choices.slice(0, 2) : choices)
const columnOptions = computed(() => available.value.map(item => ({ value: item.value, label: `全部改為${item.label}` })))
const choice = value => choices.find(item => item.value === value)
const sections = computed(() => props.data.sections.filter(section => section.owners.length))
const expanded = ref({})

function state(owner, code) { return props.pending[`${owner.type}:${owner.id}:${code}`]?.handler || owner.cells[code]?.handler }
function next(value) { const list = available.value; return list[(list.findIndex(item => item.value === value) + 1) % list.length].value }
function cycle(owner, codes) {
  const current = groupState(owner, codes)
  const to = current === 'mixed' ? 'us' : next(current)
  emit('change', owner, applicable(owner, codes), to)
}
// 車牌段的欄：按小組排列，只列有事項的小組
function columns(section) {
  if (section.category !== 'plate') return section.items.map(item => ({ key: item.code, label: item.name, codes: [item.code] }))
  return Object.entries(props.data.groups).map(([key, label]) => ({ key, label, codes: section.items.filter(item => item.group === key).map(item => item.code) })).filter(column => column.codes.length)
}
// 只算適用於這個對象的事項；全部不適用時整格顯示「不適用」
const applicable = (owner, codes) => codes.filter(code => owner.cells[code])
function groupState(owner, codes) { const values = new Set(applicable(owner, codes).map(code => state(owner, code))); return values.size === 1 ? [...values][0] : 'mixed' }
function cellText(owner, codes) {
  const value = groupState(owner, codes)
  if (value === 'mixed') return '混合'
  if (value === 'outsourced' && codes.length === 1) return owner.cells[codes[0]]?.providerName && !props.pending[`${owner.type}:${owner.id}:${codes[0]}`] ? `外包：${owner.cells[codes[0]].providerName}` : '外包'
  return choice(value)?.label
}
const toneOf = (owner, codes) => choice(groupState(owner, codes))?.tone || 'warning'
const ownerKey = owner => `${owner.type}:${owner.id}`
// 公司所屬牌照：多於三個時只列前三個加總數，避免一行過長
const platesText = plates => !plates.length ? '未掛牌照' : plates.length > 3 ? `持有 ${plates.slice(0, 3).join('、')} 等 ${plates.length} 個牌照` : `持有 ${plates.join('、')}`
function setColumn(section, column, handler) { if (handler) emit('column', section, column.codes, handler) }
</script>
<template>
  <section v-for="section in sections" :key="section.category" class="scope-section">
    <div class="panel-head"><div><h2>{{ section.label }}（{{ section.owners.length }}）</h2><p>{{ section.items.length ? `${section.items.length} 件事` : '這位客戶目前沒有這類事項' }}{{ section.available.length ? `；另有 ${section.available.length} 件可加入` : '' }}</p></div><Button size="sm" @click="emit('items', section)">管理事項</Button></div>
    <div v-if="section.items.length" class="scope-matrix-scroll scope-board">
      <div class="scope-matrix" role="grid" :aria-label="section.label" :style="{ '--cols': columns(section).length }">
        <div class="scope-matrix-row scope-matrix-head" role="row">
          <div role="columnheader">{{ section.category === 'plate' ? '車牌' : '公司' }}</div>
          <div v-for="column in columns(section)" :key="column.key" role="columnheader" class="scope-column-head"><span>{{ column.label }}</span><Select :model-value="null" :options="columnOptions" placeholder="整欄設定" :label="`${column.label}整欄設定`" :disabled="saving" @update:model-value="setColumn(section, column, $event)" /></div>
        </div>
        <template v-for="owner in section.owners" :key="ownerKey(owner)">
          <div class="scope-matrix-row" role="row">
            <div class="scope-matrix-owner" role="rowheader">
              <PlateChip v-if="owner.type === 'plate'" :plate="owner.label" :route="owner.route" />
              <strong v-else>{{ owner.label }}</strong>
              <small v-if="owner.nameEn">{{ owner.nameEn }}</small>
              <small v-if="owner.type === 'company'">{{ platesText(owner.plates) }}</small>
              <Tag v-if="owner.status && owner.status !== '存續'" tone="warning">{{ owner.status }}</Tag>
              <button v-if="owner.type === 'plate'" type="button" class="text-button" :aria-expanded="!!expanded[ownerKey(owner)]" @click="expanded = { ...expanded, [ownerKey(owner)]: !expanded[ownerKey(owner)] }">{{ expanded[ownerKey(owner)] ? '收起逐件' : '展開逐件' }}</button>
            </div>
            <div v-for="column in columns(section)" :key="column.key" class="scope-matrix-slot" :class="{ 'is-pending': column.codes.some(code => pending[`${owner.type}:${owner.id}:${code}`]) }" role="gridcell" :data-label="column.label">
              <button v-if="applicable(owner, column.codes).length" type="button" class="scope-matrix-cell" :disabled="saving" :aria-label="`${owner.label} · ${column.label}：${cellText(owner, column.codes)}，按下切換`" @click="cycle(owner, column.codes)"><Tag :tone="toneOf(owner, column.codes)">{{ cellText(owner, column.codes) }}</Tag></button>
              <span v-else class="scope-matrix-empty">不適用</span>
            </div>
          </div>
          <div v-if="owner.type === 'plate' && expanded[ownerKey(owner)]" class="scope-matrix-detail" role="row">
            <div v-for="column in columns(section).filter(entry => applicable(owner, entry.codes).length)" :key="column.key" class="scope-matrix-detail-group" role="gridcell">
              <strong>{{ column.label }}</strong>
              <div v-for="code in applicable(owner, column.codes)" :key="code" class="scope-matrix-detail-item"><span>{{ section.items.find(item => item.code === code)?.name }}</span><button type="button" class="scope-matrix-cell" :disabled="saving" :aria-label="`${owner.label} · ${section.items.find(item => item.code === code)?.name}：${cellText(owner, [code])}，按下切換`" @click="cycle(owner, [code])"><Tag :tone="toneOf(owner, [code])">{{ cellText(owner, [code]) }}</Tag></button></div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
  <p v-if="!sections.length" class="empty">這位客戶還沒有公司或牌照。</p>
</template>
