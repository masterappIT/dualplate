<script setup>
// 操作記錄（docs/tasks/production-brief.md 第 1 節）：上方是當天的人員泳道（每人一行、按時間排點），下方是可篩選的列表。
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import Select from '../components/ui/Select.vue'
import DateInput from '../components/ui/DateInput.vue'
import DataTable from '../components/ui/DataTable.vue'
import Tag from '../components/ui/Tag.vue'
import Button from '../components/ui/Button.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const emit = defineEmits(['error'])
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const day = ref(today), entity = ref(''), person = ref(''), rows = ref([]), loading = ref(false), focus = ref(null)
// 以香港時間的一天為範圍
const range = date => { const start = new Date(`${date}T00:00:00+08:00`); return [start.toISOString(), new Date(start.getTime() + 86400000).toISOString()] }
async function load() {
  loading.value = true
  try { const [from, to] = range(day.value); rows.value = await api(`/audit-logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`) } catch (cause) { emit('error', cause) } finally { loading.value = false }
}
onMounted(load)
const time = value => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const minuteOfDay = value => { const [h, m] = time(value).split(':').map(Number); return h * 60 + m }
const entities = computed(() => [{ label: '全部對象', value: '' }, ...[...new Map(rows.value.map(row => [row.entity, row.entityLabel])).entries()].map(([value, label]) => ({ label, value }))])
const people = computed(() => [{ label: '全部人員', value: '' }, ...[...new Map(rows.value.filter(row => row.userId).map(row => [row.userId, row.userName])).entries()].map(([value, label]) => ({ label, value }))])
const shown = computed(() => rows.value.filter(row => (!entity.value || row.entity === entity.value) && (!person.value || row.userId === person.value)))
// 泳道：每人一行；時間軸 7:00–22:00 以外的點貼在兩端
const lanes = computed(() => [...new Map(shown.value.map(row => [row.userId || 'system', row.userName || '系統'])).entries()].map(([id, name]) => ({ id, name, events: shown.value.filter(row => (row.userId || 'system') === id) })))
const position = value => `${Math.min(100, Math.max(0, (minuteOfDay(value) - 420) / 900 * 100))}%`
const hours = [7, 10, 13, 16, 19, 22]
const tone = action => action === '刪除' ? 'danger' : action === '修改' || action === '設定' ? 'info' : 'ok'
// 常見欄位換成中文；沒有對照的欄位不顯示，避免出現技術字眼
const fieldNames = { name: '名稱', title: '標題', status: '狀態', expiresOn: '到期日', dueOn: '到期日', port: '口岸', usageStatus: '用途', handler: '負責方', service: '服務', amount: '金額', receivedAmount: '收款金額', receivedOn: '收款日期', paidOn: '付款日期', currency: '幣種', description: '說明', kind: '類別', reason: '原因', reviewNote: '原因', notes: '備註', phone: '電話', email: '電郵', role: '身份', active: '啟用', startsOn: '開始日期', endsOn: '結束日期', rentAmount: '每期金額', period: '期數', filedOn: '申報日期', taxAmount: '稅額', zeroFiling: '零申報', expiresInDays: '有效天數', mainlandPlate: '內地車牌', localPlate: '港澳車牌', jurisdiction: '註冊地', crossedOn: '過關日期', enabled: '開啟', validUntil: '有效期', username: '帳號', settledOn: '結算日期' }
const show = item => typeof item === 'boolean' ? (item ? '是' : '否') : typeof item === 'number' && String(item).length > 3 ? (item / 100).toFixed(2) : String(item).slice(0, 40)
const summaryText = value => { if (!value || typeof value !== 'object') return ''; return Object.entries(value).filter(([key, item]) => fieldNames[key] && item !== null && item !== '' && typeof item !== 'object').slice(0, 5).map(([key, item]) => `${fieldNames[key]}：${['amount', 'receivedAmount', 'rentAmount', 'taxAmount'].includes(key) ? show(item) : typeof item === 'boolean' ? show(item) : String(item).slice(0, 40)}`).join('，') }
const columns = [{ key: 'createdAt', title: '時間' }, { key: 'userName', title: '人員' }, { key: 'action', title: '操作' }, { key: 'entityLabel', title: '對象' }, { key: 'summary', title: '內容', minWidth: 280 }, { key: 'ip', title: 'IP' }]
</script>

<template>
  <section class="panel">
    <div class="panel-head filing-head"><div><h2>操作記錄</h2><p>每次成功的新增、修改、刪除都會記下誰、何時、改了甚麼；密碼、身份證、回鄉證號碼與檔案內容會遮蔽。</p></div>
      <div class="report-filters"><div class="period-pick"><DateInput v-model="day" label="日期" @update:model-value="load" /></div><div class="period-pick"><Select v-model="person" :options="people" aria-label="按人員篩選" /></div><div class="period-pick"><Select v-model="entity" :options="entities" aria-label="按對象篩選" /></div></div></div>
    <div v-if="lanes.length" class="audit-lanes" aria-label="當天操作泳道">
      <div class="audit-axis"><span /><div class="audit-track"><span v-for="hour in hours" :key="hour" class="audit-hour" :style="{ left: `${(hour - 7) / 15 * 100}%` }">{{ hour }}:00</span></div></div>
      <div v-for="lane in lanes" :key="lane.id" class="audit-lane"><strong>{{ lane.name }}</strong><div class="audit-track">
        <button v-for="event in lane.events" :key="event.id" type="button" class="audit-dot" :class="[`tone-${tone(event.action)}`, { active: focus?.id === event.id }]" :style="{ left: position(event.createdAt) }" :title="`${time(event.createdAt)} ${event.action} ${event.entityLabel}`" :aria-label="`${time(event.createdAt)} ${event.userName} ${event.action}${event.entityLabel}`" @click="focus = event" />
      </div></div>
      <p v-if="focus" class="audit-focus"><Tag :tone="tone(focus.action)">{{ focus.action }}</Tag> {{ time(focus.createdAt) }} · {{ focus.userName }} · {{ focus.entityLabel }}<span v-if="summaryText(focus.summary)" class="cell-sub"> · {{ summaryText(focus.summary) }}</span></p>
    </div>
  </section>
  <section class="panel table-panel">
    <div class="panel-head"><div><h2>明細 · {{ shown.length }} 筆</h2><p>最近的在最上面；如需查某位客戶或牌照，可按對象篩選。</p></div><Button size="sm" variant="text" @click="load">重新整理</Button></div>
    <DataTable :columns="columns" :data="shown" :loading="loading" :min-width="900">
      <template #cell-createdAt="{ row }"><span class="num">{{ time(row.createdAt) }}</span></template>
      <template #cell-userName="{ row }">{{ row.userName || '系統' }}</template>
      <template #cell-action="{ row }"><Tag :tone="tone(row.action)">{{ row.action }}</Tag></template>
      <template #cell-summary="{ row }"><span class="cell-sub">{{ summaryText(row.summary) || '—' }}</span></template>
      <template #cell-ip="{ row }"><span class="cell-sub num">{{ row.ip }}</span></template>
      <template #empty><EmptyState title="這一天沒有操作記錄" desc="換一個日期看看；只有成功的修改才會記錄。" /></template>
    </DataTable>
  </section>
</template>
