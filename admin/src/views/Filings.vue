<script setup>
// 報帳報稅（docs/tasks/bookkeeping-brief.md 第 5 節）：上方進度矩陣（公司 × 最近 6 個月），下方需要跟進的期數；點格子打開該期。
import { ref, computed, onMounted } from 'vue'
import { api, user, privateFile } from '../api'
import PageHeader from '../components/ui/PageHeader.vue'
import StatCard from '../components/ui/StatCard.vue'
import Button from '../components/ui/Button.vue'
import Tag from '../components/ui/Tag.vue'
import Select from '../components/ui/Select.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import DateInput from '../components/ui/DateInput.vue'
import Segmented from '../components/ui/Segmented.vue'
import DueDate from '../components/ui/DueDate.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import DataTable from '../components/ui/DataTable.vue'
import Drawer from '../components/ui/Drawer.vue'
import StampMark from '../components/ui/StampMark.vue'
import FormDialog from '../components/business/FormDialog.vue'

const emit = defineEmits(['saved', 'error'])
const isAdmin = user()?.role === 'admin'
const matrix = ref({ months: [], rows: [] }), filings = ref([]), firms = ref([]), loading = ref(true), loadError = ref('')
const firmFilter = ref(''), focus = ref('')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const monthLabel = period => `${Number(period.slice(5))}月`
const yuan = cents => cents == null ? '' : (cents / 100).toFixed(2)
const cents = text => text === '' || text == null ? null : Math.round(Number(text) * 100)
// 格子文字與色調：完成綠、處理中藍、需處理琥珀、逾期紅、缺回執琥珀
function cellTone(cell) { if (!cell?.status) return null; if (cell.status === '公司已註銷') return 'neutral'; if (cell.level === 'overdue') return 'danger'; if (cell.missingReceipt || cell.level === 'due') return 'warning'; if (['已完成', '已申報'].includes(cell.status)) return 'ok'; return cell.status === '未開始' ? 'neutral' : 'info' }
function cellText(cell) { if (cell.status === '公司已註銷') return '已註銷'; if (cell.level === 'overdue') return '已逾期'; if (cell.missingReceipt) return '缺回執'; return cell.status }

async function load() {
  if (!isAdmin) { loading.value = false; return }
  loading.value = true; loadError.value = ''
  try {
    const query = firmFilter.value ? `?firmId=${encodeURIComponent(firmFilter.value)}` : ''
    const [m, list, f] = await Promise.all([api('/filings/matrix?months=6'), api('/filings' + query), api('/accounting-firms')])
    matrix.value = m; filings.value = list; firms.value = f
  } catch (cause) { loadError.value = cause.message } finally { loading.value = false }
}
onMounted(load)
const firmOptions = computed(() => [{ label: '全部會計公司', value: '' }, ...firms.value.map(item => ({ label: item.name, value: item.id }))])
// 窄螢幕只顯示最近 3 個月，避免第一眼只看到最舊的月份
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < 720)
const shownMonths = computed(() => narrow.value ? matrix.value.months.slice(-3) : matrix.value.months)
const firstTracked = computed(() => matrix.value.rows.flatMap(row => row.cells).filter(cell => cell.status).map(cell => cell.period).sort()[0] || '')
const rows = computed(() => matrix.value.rows.filter(row => !firmFilter.value || firms.value.find(item => item.id === firmFilter.value)?.name === row.firmName))
const counts = computed(() => ({ due: filings.value.filter(item => item.level === 'due').length, overdue: filings.value.filter(item => item.level === 'overdue').length, receipt: filings.value.filter(item => item.missingReceipt).length, filed: filings.value.filter(item => item.period === today.slice(0, 7) && ['已申報', '已完成'].includes(item.status)).length }))
const followUp = computed(() => filings.value.filter(item => item.status !== '公司已註銷' && (focus.value === 'due' ? item.level === 'due' : focus.value === 'overdue' ? item.level === 'overdue' : focus.value === 'receipt' ? item.missingReceipt : ['due', 'overdue'].includes(item.level) || item.missingReceipt)).sort((a, b) => a.dueOn.localeCompare(b.dueOn)))
const columns = [{ key: 'company', title: '公司', minWidth: 200 }, { key: 'period', title: '期數' }, { key: 'firmName', title: '會計公司' }, { key: 'status', title: '狀態' }, { key: 'dueOn', title: '截止', minWidth: 140 }, { key: 'action', title: '' }]

// ── 一期詳情 ──
const current = ref(null), form = ref({}), saving = ref(false), dialogError = ref(''), justDone = ref(false)
const steps = [['docsReceivedOn', '客戶票據收齊'], ['sentToFirmOn', '已交會計公司'], ['filedOn', '已申報'], ['paidOn', '已繳款']]
async function openFiling(filingId) {
  if (!filingId) return
  try {
    const item = await api(`/filings/${filingId}`)
    current.value = item; dialogError.value = ''; justDone.value = false
    form.value = { docsReceivedOn: item.docsReceivedOn || '', sentToFirmOn: item.sentToFirmOn || '', filedOn: item.filedOn || '', paidOn: item.paidOn || '', tax: yuan(item.taxAmount), zeroFiling: item.zeroFiling, notes: item.notes, firmId: item.firmId || '', cycle: item.filingCycle }
  } catch (cause) { emit('error', cause) }
}
const stepDisabled = key => current.value?.status === '公司已註銷' || (key === 'paidOn' && form.value.zeroFiling)
function markToday(key) { form.value[key] = form.value[key] ? '' : today }
async function saveFiling() {
  if (saving.value) return
  const tax = cents(form.value.tax)
  if (form.value.tax !== '' && (!Number.isFinite(tax) || tax < 0)) { dialogError.value = '稅額須為非負數字'; return }
  saving.value = true; dialogError.value = ''
  try {
    const wasDone = current.value.status === '已完成'
    if (form.value.firmId !== (current.value.firmId || '') || form.value.cycle !== current.value.filingCycle) await api(`/companies/${current.value.companyId}/filing-setup`, 'PUT', { accountingFirmId: form.value.firmId || null, filingCycle: form.value.cycle })
    const updated = await api(`/filings/${current.value.id}`, 'PATCH', { docsReceivedOn: form.value.docsReceivedOn || null, sentToFirmOn: form.value.sentToFirmOn || null, filedOn: form.value.filedOn || null, paidOn: form.value.zeroFiling ? null : form.value.paidOn || null, taxAmount: form.value.zeroFiling ? 0 : tax, zeroFiling: form.value.zeroFiling, notes: form.value.notes })
    current.value = { ...current.value, ...updated }
    if (updated.status === '已完成' && !wasDone) justDone.value = true
    emit('saved', `${updated.companyName} ${updated.period} 已更新`)
    await load()
    if (!justDone.value) current.value = null
  } catch (cause) { dialogError.value = cause.message } finally { saving.value = false }
}
const fileInput = ref(null)
async function uploadReceipt(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { dialogError.value = '回執不能超過 5 MB'; return }
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
  try { current.value = { ...current.value, ...(await api(`/filings/${current.value.id}/receipt`, 'POST', { data })) }; emit('saved', '回執已上傳'); load() } catch (cause) { dialogError.value = cause.message }
}
async function viewReceipt() {
  try { const blob = await privateFile(`/filings/${current.value.id}/receipt`); window.open(URL.createObjectURL(blob), '_blank', 'noopener') } catch (cause) { dialogError.value = cause.message }
}

// ── 會計公司 ──
const firmsOpen = ref(false), firmForm = ref(null), firmSaving = ref(false), firmError = ref('')
function editFirm(firm) { firmError.value = ''; firmForm.value = { id: firm?.id || '', name: firm?.name || '', contact: firm?.contact || '', phone: firm?.phone || '', email: firm?.email || '', notes: firm?.notes || '' } }
async function saveFirm() {
  if (!firmForm.value.name.trim()) { firmError.value = '請填寫會計公司名稱'; return }
  firmSaving.value = true
  try { const { id, ...body } = firmForm.value; await api(id ? `/accounting-firms/${id}` : '/accounting-firms', id ? 'PATCH' : 'POST', body); firmForm.value = null; emit('saved', '會計公司已儲存'); await load() } catch (cause) { firmError.value = cause.message } finally { firmSaving.value = false }
}

// ── 截止日 ──
const calendarOpen = ref(false), calendar = ref({ period: '', dueOn: '', custom: false }), calendarError = ref(''), calendarSaving = ref(false)
async function openCalendar() { calendarError.value = ''; await pickPeriod(today.slice(0, 7)); calendarOpen.value = true }
async function pickPeriod(period) { try { calendar.value = await api(`/filing-calendar/${period}`) } catch (cause) { calendarError.value = cause.message } }
async function saveCalendar() {
  calendarSaving.value = true
  try { await api(`/filing-calendar/${calendar.value.period}`, 'PUT', { dueOn: calendar.value.dueOn }); calendarOpen.value = false; emit('saved', `${calendar.value.period} 截止日已改為 ${calendar.value.dueOn}`); await load() } catch (cause) { calendarError.value = cause.message } finally { calendarSaving.value = false }
}
const periodOptions = computed(() => { const [y, m] = today.split('-').map(Number); return Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(y, m - 1 + index - 3, 1)).toISOString().slice(0, 7)).map(value => ({ label: `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`, value })) })
</script>

<template>
  <section>
    <PageHeader title="報帳報稅" desc="內地公司每月做帳申報的進度；做帳由會計公司處理，這裡追蹤資料、申報、繳款與回執。">
      <template v-if="isAdmin"><Button @click="openCalendar">截止日</Button><Button @click="firmsOpen = true; firmForm = null">會計公司</Button></template>
    </PageHeader>
    <EmptyState v-if="!isAdmin" title="報帳報稅只限管理者" desc="如需查看，請聯絡管理者。" />
    <template v-else>
      <p v-if="loadError" class="error" role="alert">未能載入報帳資料：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
      <div class="metrics">
        <StatCard label="需處理" :value="counts.due" hint="截止前 5 天內未申報" :tone="counts.due ? 'warning' : 'neutral'" :active="focus === 'due'" @click="focus = focus === 'due' ? '' : 'due'" />
        <StatCard label="已逾期" :value="counts.overdue" hint="過了截止日未申報" :tone="counts.overdue ? 'danger' : 'neutral'" :active="focus === 'overdue'" @click="focus = focus === 'overdue' ? '' : 'overdue'" />
        <StatCard label="缺回執" :value="counts.receipt" hint="已申報但未上傳回執" :tone="counts.receipt ? 'warning' : 'neutral'" :active="focus === 'receipt'" @click="focus = focus === 'receipt' ? '' : 'receipt'" />
        <StatCard label="本月已申報" :value="counts.filed" hint="本月期數已申報或完成" tone="ok" />
      </div>

      <section class="panel">
        <div class="panel-head filing-head"><div><h2>進度矩陣</h2><p>每列一間內地公司，每欄一個月；點格子打開該期。按季申報的公司只在季首月有格子。</p></div><div class="period-pick"><Select v-model="firmFilter" :options="firmOptions" aria-label="按會計公司篩選" @update:model-value="load" /></div></div>
        <div v-if="loading" class="empty">載入中…</div>
        <EmptyState v-else-if="!rows.length" title="還沒有報帳工作" desc="客戶名下有在營的內地公司，且報帳報稅不是客戶自理時，系統會自動生成每月工作。" />
        <div v-else class="scope-matrix-scroll">
          <div class="scope-matrix filing-matrix" role="table" aria-label="報帳進度矩陣" :style="{ '--months': shownMonths.length }">
            <div class="scope-matrix-row scope-matrix-head" role="row"><div role="columnheader">公司</div><div v-for="month in shownMonths" :key="month" role="columnheader">{{ monthLabel(month) }}</div></div>
            <div v-for="row in rows" :key="row.companyId" class="scope-matrix-row" role="row">
              <div class="filing-owner" role="rowheader"><strong>{{ row.companyName }}</strong><span>{{ row.customerName }}{{ row.firmName ? ' · ' + row.firmName : ' · 未指定會計公司' }}{{ row.filingCycle === 'quarterly' ? ' · 按季' : '' }}</span></div>
              <div v-for="cell in row.cells.filter(item => shownMonths.includes(item.period))" :key="cell.period" role="cell">
                <button v-if="cell.status" type="button" class="scope-matrix-cell" :aria-label="`${row.companyName} ${cell.period}：${cellText(cell)}`" @click="openFiling(cell.filingId)"><Tag :tone="cellTone(cell)">{{ cellText(cell) }}</Tag></button>
                <span v-else class="filing-none" :title="row.filingCycle === 'quarterly' ? '按季申報，這個月不需申報' : '這個月未有追蹤記錄'">{{ row.filingCycle === 'quarterly' && cell.period >= firstTracked ? '不需申報' : '—' }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel table-panel">
        <div class="panel-head"><div><h2>{{ focus === 'due' ? '需處理' : focus === 'overdue' ? '已逾期' : focus === 'receipt' ? '缺回執' : '需要跟進' }}</h2><p>按截止日排序；完成申報並上傳回執後會從這裡消失。</p></div><Button v-if="focus" variant="text" size="sm" @click="focus = ''">顯示全部</Button></div>
        <DataTable :columns="columns" :data="followUp" :loading="loading" :min-width="760">
          <template #cell-company="{ row }"><strong>{{ row.companyName }}</strong><div class="cell-sub">{{ row.customerName }}</div></template>
          <template #cell-period="{ row }">{{ row.period }}</template>
          <template #cell-firmName="{ row }">{{ row.firmName || '未指定' }}</template>
          <template #cell-status="{ row }"><Tag :tone="cellTone(row)">{{ cellText(row) }}</Tag></template>
          <template #cell-dueOn="{ row }"><DueDate :date="row.dueOn" /></template>
          <template #cell-action="{ row }"><Button variant="text" size="sm" @click="openFiling(row.id)">處理</Button></template>
          <template #empty><EmptyState title="沒有需要跟進的期數" desc="全部已按時申報並收回回執。" /></template>
        </DataTable>
      </section>
    </template>

    <FormDialog :open="Boolean(current)" :title="current ? `${current.companyName} · ${current.period}` : ''" :sub="current ? `截止 ${current.dueOn} · ${current.customerName}` : ''" :saving="saving" submit-text="儲存" :width="560" layout="stack" @close="current = null" @submit="saveFiling">
      <template v-if="current">
        <div class="filing-status"><Tag :tone="cellTone(current)">{{ cellText(current) }}</Tag><StampMark v-if="justDone" text="已辦好" play /></div>
        <p v-if="current.status === '公司已註銷'" class="hint">公司已註銷，這期不再處理。</p>
        <div class="filing-steps">
          <div v-for="([key, label], index) in steps" :key="key" class="filing-step" :class="{ done: form[key], off: stepDisabled(key) }">
            <span class="filing-step-name"><span class="filing-step-mark" aria-hidden="true">{{ form[key] ? '✓' : index + 1 }}</span>{{ label }}<small v-if="key === 'paidOn' && form.zeroFiling">零申報不需繳款</small></span>
            <DateInput v-model="form[key]" :label="`${label}日期`" :disabled="stepDisabled(key)" />
            <Button variant="text" size="sm" :disabled="stepDisabled(key)" @click="markToday(key)">{{ form[key] ? '清除' : '今天' }}</Button>
          </div>
        </div>
        <div class="form-grid">
          <Field label="申報類型"><Segmented v-model="form.zeroFiling" :options="[{ label: '正常申報', value: false }, { label: '零申報', value: true }]" label="申報類型" /></Field>
          <Field label="稅額（人民幣元）"><TextInput v-model="form.tax" :disabled="form.zeroFiling" placeholder="例如 356.00" /></Field>
          <Field label="會計公司"><Select v-model="form.firmId" :options="[{ label: '未指定', value: '' }, ...firms.map(item => ({ label: item.name, value: item.id }))]" /></Field>
          <Field label="申報週期"><Select v-model="form.cycle" :options="[{ label: '每月', value: 'monthly' }, { label: '每季（小規模納稅人）', value: 'quarterly' }]" :disabled="current.taxpayerType === '一般納稅人'" /></Field>
        </div>
        <Field label="回執">
          <div class="filing-receipt"><span>{{ current.hasReceipt ? '已上傳回執' : current.filedOn ? '已申報，尚未上傳回執' : '申報後上傳回執' }}</span><Button v-if="current.hasReceipt" variant="text" size="sm" @click="viewReceipt">查看</Button><Button size="sm" @click="fileInput.click()">{{ current.hasReceipt ? '重新上傳' : '上傳回執' }}</Button><input ref="fileInput" type="file" accept="image/png,image/jpeg,application/pdf" hidden @change="uploadReceipt" /></div>
        </Field>
        <Field label="備註（只有員工看得到）"><TextInput v-model="form.notes" multiline /></Field>
        <p v-if="dialogError" class="error" role="alert">{{ dialogError }}</p>
      </template>
    </FormDialog>

    <Drawer :open="firmsOpen" title="會計公司" sub="做帳報稅的外包單位；在每期詳情指派給公司。" :width="480" @close="firmsOpen = false">
      <div v-if="!firmForm">
        <div v-for="firm in firms" :key="firm.id" class="firm-row"><div><strong>{{ firm.name }}</strong><div class="cell-sub">{{ [firm.contact, firm.phone, firm.email].filter(Boolean).join(' · ') || '未填聯絡資料' }} · 負責 {{ firm.companies }} 間</div></div><Button variant="text" size="sm" @click="editFirm(firm)">編輯</Button></div>
        <EmptyState v-if="!firms.length" title="還沒有會計公司" desc="新增後可指派給內地公司。" />
        <Button class="firm-add" @click="editFirm(null)">新增會計公司</Button>
      </div>
      <div v-else>
        <Field label="名稱" required><TextInput v-model="firmForm.name" /></Field><Field label="聯絡人"><TextInput v-model="firmForm.contact" /></Field><Field label="電話"><TextInput v-model="firmForm.phone" /></Field><Field label="電郵"><TextInput v-model="firmForm.email" /></Field><Field label="備註"><TextInput v-model="firmForm.notes" multiline /></Field>
        <p v-if="firmError" class="error" role="alert">{{ firmError }}</p>
        <div class="drawer-actions"><Button variant="text" @click="firmForm = null">返回</Button><Button variant="primary" :loading="firmSaving" @click="saveFirm">儲存</Button></div>
      </div>
    </Drawer>

    <FormDialog :open="calendarOpen" title="申報截止日" sub="預設為次月 15 日；遇節假日順延時在這裡修改。已生成但未申報的期數會跟著改。" :saving="calendarSaving" submit-text="儲存截止日" layout="stack" @close="calendarOpen = false" @submit="saveCalendar">
      <Field label="期數"><Select :model-value="calendar.period" :options="periodOptions" @update:model-value="pickPeriod" /></Field>
      <Field label="截止日"><DateInput v-model="calendar.dueOn" label="截止日" /></Field>
      <p class="hint">{{ calendar.custom ? '這個月已自訂截止日。' : '目前使用預設截止日。' }}</p>
      <p v-if="calendarError" class="error" role="alert">{{ calendarError }}</p>
    </FormDialog>
  </section>
</template>
