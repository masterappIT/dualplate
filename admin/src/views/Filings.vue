<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, user, privateFile, rentCents } from '../api'
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
import { floatBarEnter, floatBarLeave } from '../composables/motion'

const emit = defineEmits(['saved', 'error'])
const route = useRoute()
const isAdmin = user()?.role === 'admin'
const matrix = ref({ months: [], rows: [] }), filings = ref([]), firms = ref([]), loading = ref(true), loadError = ref('')
const firmFilter = ref(''), focus = ref(''), tab = ref('work'), selected = ref([]), bulkAction = ref('docs_received'), bulkSaving = ref(false)
const setupOpen = ref(false), setupSelected = ref([]), setupFirm = ref(''), setupCycle = ref('monthly'), setupSaving = ref(false), setupError = ref(''), setupRows = ref([]), setupRowSaving = ref('')
const claimOpen = ref(null), claimZero = ref(false), claimTax = ref(''), claimSaving = ref(false), claimError = ref('')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const monthLabel = period => `${Number(period.slice(5))}月`
const yuan = cents => cents == null ? '' : (cents / 100).toFixed(2)
const steps = [['docsReceivedOn', '客戶票據收齊'], ['sentToFirmOn', '已交會計公司'], ['filedOn', '已申報'], ['paidOn', '已繳款']]
function cellTone(cell) { if (!cell?.status) return null; if (['公司已註銷', '啟用前已處理'].includes(cell.status)) return 'neutral'; if (cell.level === 'overdue') return 'danger'; if (cell.missingReceipt || cell.level === 'due') return 'warning'; if (['已完成', '已申報'].includes(cell.status)) return 'ok'; return cell.status === '未開始' ? 'neutral' : 'info' }
function cellText(cell) { if (cell.status === '公司已註銷') return '已註銷'; if (cell.status === '啟用前已處理') return cell.status; if (cell.level === 'overdue') return '已逾期'; if (cell.missingReceipt) return '缺回執'; return cell.status }
function nextStep(row) { if (row.filedOn) return row.zeroFiling || row.paidOn ? null : steps[3]; if (row.sentToFirmOn) return steps[2]; if (row.docsReceivedOn) return steps[1]; return steps[0] }
const firmOptions = computed(() => [{ label: '全部會計公司', value: '' }, ...firms.value.map(item => ({ label: item.name, value: item.id }))])
const setupFirmOptions = computed(() => [{ label: '未指定', value: '' }, ...firms.value.map(item => ({ label: item.name, value: item.id }))])
const cycleOptions = [{ label: '每月', value: 'monthly' }, { label: '每季（小規模納稅人）', value: 'quarterly' }]
const bulkCycleOptions = computed(() => setupSelected.value.some(id => setupRows.value.find(row => row.id === id)?.taxpayerType === '一般納稅人') ? [cycleOptions[0], { ...cycleOptions[1], disabled: true }] : cycleOptions)
const filteredFilings = computed(() => filings.value.filter(item => !firmFilter.value || item.firmId === firmFilter.value))
const counts = computed(() => ({ due: filteredFilings.value.filter(item => item.level === 'due').length, overdue: filteredFilings.value.filter(item => item.level === 'overdue').length, receipt: filteredFilings.value.filter(item => item.missingReceipt).length, filed: filteredFilings.value.filter(item => item.period === today.slice(0, 7) && ['已申報', '已完成'].includes(item.status)).length }))
const work = computed(() => filteredFilings.value.filter(item => !item.closedReason && item.status !== '已完成' && nextStep(item)).filter(item => focus.value === 'due' ? item.level === 'due' : focus.value === 'overdue' ? item.level === 'overdue' : focus.value === 'receipt' ? item.missingReceipt : true).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || ({ overdue: 0, due: 1, upcoming: 2, ok: 3 })[a.level] - ({ overdue: 0, due: 1, upcoming: 2, ok: 3 })[b.level]))
function stepTone(row) { return row.status === '未開始' ? 'neutral' : row.status === '已完成' ? 'ok' : 'info' }
const unassigned = computed(() => matrix.value.rows.filter(row => !row.firmName).length)
const rows = computed(() => matrix.value.rows.filter(row => (!firmFilter.value || firms.value.find(item => item.id === firmFilter.value)?.name === row.firmName) && (focus.value !== 'filed' || row.cells.some(cell => cell.period === today.slice(0, 7) && ['已申報', '已完成'].includes(cell.status)))))
watch(tab, value => { if (value === 'work' && focus.value === 'filed') focus.value = '' })
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < 720)
const trackedMonths = computed(() => { const months = matrix.value.months; const first = months.findIndex(month => matrix.value.rows.some(row => row.cells.some(cell => cell.period === month && cell.status))); return first < 0 ? months.slice(-1) : months.slice(first) })
const shownMonths = computed(() => narrow.value ? trackedMonths.value.slice(-3) : trackedMonths.value)
const firstTracked = computed(() => matrix.value.rows.flatMap(row => row.cells).filter(cell => cell.status).map(cell => cell.period).sort()[0] || '')
const columns = [{ key: 'company', title: '公司', minWidth: 200 }, { key: 'period', title: '期數' }, { key: 'status', title: '目前步驟' }, { key: 'dueOn', title: '截止', minWidth: 140 }, { key: 'action', title: '操作', minWidth: 210 }]
const setupColumns = [{ key: 'company', title: '公司', minWidth: 160 }, { key: 'customer', title: '客戶' }, { key: 'firm', title: '會計公司', minWidth: 150 }, { key: 'cycle', title: '申報週期', minWidth: 140 }, { key: 'action', title: '操作' }]
async function load() {
  if (!isAdmin) { loading.value = false; return }
  loading.value = true; loadError.value = ''
  try {
    const [m, list, f] = await Promise.all([api('/filings/matrix?months=6'), api('/filings'), api('/accounting-firms')])
    matrix.value = m; filings.value = list; firms.value = f
    selected.value = selected.value.filter(id => list.some(row => row.id === id))
  } catch (cause) { loadError.value = cause.message } finally { loading.value = false }
}
onMounted(async () => { await load(); if (route.query.filingId) openFiling(String(route.query.filingId)) })
function reportBulk(result) { const counts = Object.groupBy ? Object.groupBy(result.skipped, item => item.reason) : result.skipped.reduce((groups, item) => { (groups[item.reason] ||= []).push(item); return groups }, {}); const reasons = Object.entries(counts).map(([reason, items]) => `${reason} ${items.length} 期`).join('、'); emit('saved', `已更新 ${result.updated.length} 期，略過 ${result.skipped.length} 期${reasons ? `（${reasons}）` : ''}`) }
async function bulk() {
  if (bulkSaving.value || !selected.value.length) return
  bulkSaving.value = true
  try { const result = await api('/filings/bulk', 'POST', { ids: selected.value, action: bulkAction.value }); reportBulk(result); selected.value = []; await load() } catch (cause) { emit('error', cause) } finally { bulkSaving.value = false }
}
async function advance(row) {
  const step = nextStep(row)
  if (!step) return
  if (step[0] === 'filedOn') { claimOpen.value = row; claimZero.value = false; claimTax.value = ''; claimError.value = ''; return }
  try { await api(`/filings/${row.id}`, 'PATCH', { [step[0]]: today }); emit('saved', `${row.companyName} ${row.period}：${step[1]}`); await load() } catch (cause) { emit('error', cause) }
}
async function saveClaim() {
  const tax = claimZero.value ? 0 : rentCents(claimTax.value)
  if (tax === null) { claimError.value = '請填寫有效稅額（人民幣元）'; return }
  claimSaving.value = true; claimError.value = ''
  try { await api(`/filings/${claimOpen.value.id}`, 'PATCH', { filedOn: today, zeroFiling: claimZero.value, taxAmount: tax }); emit('saved', `${claimOpen.value.companyName} ${claimOpen.value.period} 已申報`); claimOpen.value = null; await load() } catch (cause) { claimError.value = cause.message } finally { claimSaving.value = false }
}
function openSetup() { setupRows.value = matrix.value.rows.map(row => { const period = filings.value.find(item => item.companyId === row.companyId); return { id: row.companyId, company: row.companyName, customer: row.customerName, firmId: period?.firmId || '', cycle: row.filingCycle || 'monthly', taxpayerType: period?.taxpayerType || '' } }); setupSelected.value = []; setupError.value = ''; setupOpen.value = true }
async function saveSetup() {
  if (!setupSelected.value.length) return
  setupSaving.value = true; setupError.value = ''
  try { await api('/companies/filing-setup', 'PUT', { companyIds: setupSelected.value, accountingFirmId: setupFirm.value || null, filingCycle: setupCycle.value }); emit('saved', `已設定 ${setupSelected.value.length} 間公司`); setupSelected.value = []; await load(); openSetup() } catch (cause) { setupError.value = cause.message } finally { setupSaving.value = false }
}
async function saveSetupRow(row) {
  setupRowSaving.value = row.id; setupError.value = ''
  try { await api(`/companies/${row.id}/filing-setup`, 'PUT', { accountingFirmId: row.firmId || null, filingCycle: row.cycle }); emit('saved', `${row.company} 設定已儲存`); await load() } catch (cause) { const previous = filings.value.find(item => item.companyId === row.id); row.firmId = previous?.firmId || ''; row.cycle = previous?.filingCycle || 'monthly'; setupError.value = cause.message } finally { setupRowSaving.value = '' }
}
// 一期詳情
const current = ref(null), form = ref({}), saving = ref(false), dialogError = ref(''), justDone = ref(false), editDates = ref(false)
const currentStep = computed(() => current.value ? nextStep(current.value) : null)
async function openFiling(filingId) {
  if (!filingId) return
  try { const item = await api(`/filings/${filingId}`); current.value = item; dialogError.value = ''; justDone.value = false; editDates.value = false; form.value = { docsReceivedOn: item.docsReceivedOn || '', sentToFirmOn: item.sentToFirmOn || '', filedOn: item.filedOn || '', paidOn: item.paidOn || '', tax: yuan(item.taxAmount), zeroFiling: item.zeroFiling, notes: item.notes }; const step = nextStep(item); if (step && !item.closedReason) form.value[step[0]] = today } catch (cause) { emit('error', cause) }
}
async function saveFiling() {
  if (saving.value || !current.value) return
  if (current.value.closedReason === 'pre_system') { current.value = null; return }
  if (current.value.closedReason) { current.value = null; return }
  const tax = form.value.zeroFiling ? 0 : form.value.tax === '' ? null : rentCents(form.value.tax)
  if (!form.value.zeroFiling && form.value.filedOn && tax === null) { dialogError.value = '請填寫有效稅額（人民幣元）'; return }
  saving.value = true; dialogError.value = ''
  try {
    const wasDone = current.value.status === '已完成'
    const updated = await api(`/filings/${current.value.id}`, 'PATCH', { docsReceivedOn: form.value.docsReceivedOn || null, sentToFirmOn: form.value.sentToFirmOn || null, filedOn: form.value.filedOn || null, paidOn: form.value.zeroFiling ? null : form.value.paidOn || null, taxAmount: tax, zeroFiling: form.value.zeroFiling, notes: form.value.notes })
    current.value = { ...current.value, ...updated }
    if (updated.status === '已完成' && !wasDone) justDone.value = true
    emit('saved', `${updated.companyName} ${updated.period} 已更新`)
    await load(); if (!justDone.value) current.value = null
  } catch (cause) { dialogError.value = cause.message } finally { saving.value = false }
}
async function cancelPreSystem() {
  saving.value = true; dialogError.value = ''
  try { await api(`/filings/${current.value.id}/pre-system`, 'DELETE'); emit('saved', `${current.value.companyName} ${current.value.period} 已取消啟用前標記`); current.value = null; await load() } catch (cause) { dialogError.value = cause.message } finally { saving.value = false }
}
const fileInput = ref(null)
async function uploadReceipt(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { dialogError.value = '回執不能超過 5 MB'; return }
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
  try { current.value = { ...current.value, ...(await api(`/filings/${current.value.id}/receipt`, 'POST', { data })) }; emit('saved', '回執已上傳'); await load() } catch (cause) { dialogError.value = cause.message }
}
async function viewReceipt() { try { const blob = await privateFile(`/filings/${current.value.id}/receipt`); window.open(URL.createObjectURL(blob), '_blank', 'noopener') } catch (cause) { dialogError.value = cause.message } }
// 會計公司與截止日沿用現有操作
const firmsOpen = ref(false), firmForm = ref(null), firmSaving = ref(false), firmError = ref('')
function editFirm(firm) { firmError.value = ''; firmForm.value = { id: firm?.id || '', name: firm?.name || '', contact: firm?.contact || '', phone: firm?.phone || '', email: firm?.email || '', notes: firm?.notes || '' } }
async function saveFirm() { if (!firmForm.value.name.trim()) { firmError.value = '請填寫會計公司名稱'; return } firmSaving.value = true; try { const { id, ...body } = firmForm.value; await api(id ? `/accounting-firms/${id}` : '/accounting-firms', id ? 'PATCH' : 'POST', body); firmForm.value = null; emit('saved', '會計公司已儲存'); await load() } catch (cause) { firmError.value = cause.message } finally { firmSaving.value = false } }
const calendarOpen = ref(false), calendar = ref({ period: '', dueOn: '', custom: false }), calendarError = ref(''), calendarSaving = ref(false)
async function openCalendar() { calendarError.value = ''; await pickPeriod(today.slice(0, 7)); calendarOpen.value = true }
async function pickPeriod(period) { try { calendar.value = await api(`/filing-calendar/${period}`) } catch (cause) { calendarError.value = cause.message } }
async function saveCalendar() { calendarSaving.value = true; try { await api(`/filing-calendar/${calendar.value.period}`, 'PUT', { dueOn: calendar.value.dueOn }); calendarOpen.value = false; emit('saved', `${calendar.value.period} 截止日已改為 ${calendar.value.dueOn}`); await load() } catch (cause) { calendarError.value = cause.message } finally { calendarSaving.value = false } }
const periodOptions = computed(() => { const [y, m] = today.split('-').map(Number); return Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(y, m - 1 + index - 3, 1)).toISOString().slice(0, 7)).map(value => ({ label: `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`, value })) })
</script>

<template>
  <section>
    <PageHeader title="報帳報稅" desc="內地公司每月做帳申報的進度；做帳由會計公司處理，這裡追蹤資料、申報、繳款與回執。">
      <template v-if="isAdmin"><Button @click="openCalendar">截止日</Button><Button @click="firmsOpen = true; firmForm = null">會計公司</Button><Button @click="openSetup">公司設定</Button></template>
    </PageHeader>
    <EmptyState v-if="!isAdmin" title="報帳報稅只限管理者" desc="如需查看，請聯絡管理者。" />
    <template v-else>
      <p v-if="loadError" class="error" role="alert">未能載入報帳資料：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
      <div class="metrics">
        <StatCard label="需處理" :value="counts.due" hint="截止前 5 天內未申報" :tone="counts.due ? 'warning' : 'neutral'" :active="focus === 'due'" @click="tab = 'work'; focus = focus === 'due' ? '' : 'due'" />
        <StatCard label="已逾期" :value="counts.overdue" hint="過了截止日未申報" :tone="counts.overdue ? 'danger' : 'neutral'" :active="focus === 'overdue'" @click="tab = 'work'; focus = focus === 'overdue' ? '' : 'overdue'" />
        <StatCard label="缺回執" :value="counts.receipt" hint="已申報但未上傳回執" :tone="counts.receipt ? 'warning' : 'neutral'" :active="focus === 'receipt'" @click="tab = 'work'; focus = focus === 'receipt' ? '' : 'receipt'" />
        <StatCard label="本月已申報" :value="counts.filed" hint="本月期數已申報或完成" :tone="counts.filed ? 'ok' : 'neutral'" :active="focus === 'filed'" @click="tab = 'history'; focus = focus === 'filed' ? '' : 'filed'" />
      </div>
      <div class="filing-tabs"><Segmented v-model="tab" :options="[{ label: '本月工作', value: 'work' }, { label: '歷史', value: 'history' }]" label="報帳分頁" /></div>
      <section v-if="tab === 'work'" class="panel table-panel">
        <div class="panel-head filing-head"><div><h2>{{ focus === 'due' ? '需處理' : focus === 'overdue' ? '已逾期' : focus === 'receipt' ? '缺回執' : '本月工作' }}</h2><p>未完成期數按截止日排序；按「下一步」記錄今天的進度。</p></div><div class="period-pick"><Select v-model="firmFilter" :options="firmOptions" aria-label="按會計公司篩選" /></div></div>
        <div v-if="unassigned" class="filing-notice"><span>{{ unassigned }} 間內地公司未指定會計公司</span><Button variant="text" size="sm" @click="openSetup">設定</Button></div>
        <div v-if="focus" class="filing-filter-reset"><Button variant="text" size="sm" @click="focus = ''">顯示全部</Button></div>
        <DataTable v-model:selected="selected" :columns="columns" :data="work" :loading="loading" :selectable="true" :min-width="840">
          <template #cell-company="{ row }"><strong>{{ row.companyName }}</strong><div class="cell-sub">{{ row.customerName }} · {{ row.firmName || '未指定會計公司' }}</div></template>
          <template #cell-period="{ row }">{{ row.period }}</template>
          <template #cell-status="{ row }"><Tag :tone="stepTone(row)">{{ row.status }}</Tag></template>
          <template #cell-dueOn="{ row }"><DueDate :date="row.dueOn" /></template>
          <template #cell-action="{ row }"><div class="filing-actions"><Button size="sm" @click="advance(row)">下一步：{{ nextStep(row)?.[1] }}</Button><Button variant="text" size="sm" @click="openFiling(row.id)">詳情</Button></div></template>
          <template #empty><EmptyState title="本月沒有待處理的報帳" desc="新的報帳期數會自動出現在這裡；舊期數可到「歷史」查看。" /></template>
        </DataTable>
      </section>
      <section v-else class="panel">
        <div class="panel-head filing-head"><div><h2>進度矩陣</h2><p>每列一間內地公司，每欄一個月；點格子打開該期。按季申報的公司只在季首月有格子。</p></div><div class="period-pick"><Select v-model="firmFilter" :options="firmOptions" aria-label="按會計公司篩選" /></div></div>
        <div v-if="focus === 'filed'" class="filing-filter-reset"><Button variant="text" size="sm" @click="focus = ''">顯示全部</Button></div>
        <div v-if="loading" class="empty">載入中…</div>
        <EmptyState v-else-if="!rows.length" :title="focus === 'filed' ? '本月沒有已申報的報帳' : '還沒有報帳工作'" :desc="focus === 'filed' ? '可按「顯示全部」查看其他期數。' : '客戶名下有在營的內地公司，且報帳報稅不是客戶自理時，系統會自動生成每月工作。'" />
        <div v-else class="scope-matrix-scroll"><div class="scope-matrix filing-matrix" role="table" aria-label="報帳進度矩陣" :style="{ '--months': shownMonths.length }">
          <div class="scope-matrix-row scope-matrix-head" role="row"><div role="columnheader">公司</div><div v-for="month in shownMonths" :key="month" role="columnheader">{{ monthLabel(month) }}</div></div>
          <div v-for="row in rows" :key="row.companyId" class="scope-matrix-row" role="row"><div class="filing-owner" role="rowheader"><strong>{{ row.companyName }}</strong><span>{{ row.customerName }}{{ row.firmName ? ' · ' + row.firmName : ' · 未指定會計公司' }}{{ row.filingCycle === 'quarterly' ? ' · 按季' : '' }}</span></div><div v-for="cell in row.cells.filter(item => shownMonths.includes(item.period))" :key="cell.period" role="cell"><button v-if="cell.status" type="button" class="scope-matrix-cell" :aria-label="`${row.companyName} ${cell.period}：${cellText(cell)}`" @click="openFiling(cell.filingId)"><Tag :tone="cellTone(cell)">{{ cellText(cell) }}</Tag></button><span v-else class="filing-none" :title="row.filingCycle === 'quarterly' ? '按季申報，這個月不需申報' : '這個月未有追蹤記錄'">{{ row.filingCycle === 'quarterly' && cell.period >= firstTracked ? '不需申報' : '—' }}</span></div></div>
        </div></div>
      </section>
    </template>

    <Teleport to="body"><Transition :css="false" @enter="floatBarEnter" @leave="floatBarLeave"><div v-if="tab === 'work' && selected.length" class="float-bar filing-bulk-bar" role="region" aria-label="批量操作"><span class="float-bar-count">已選 <b class="tnum">{{ selected.length }}</b> 期</span><span class="float-bar-sep" aria-hidden="true" /><Select v-model="bulkAction" :options="[{ label: '標記為：客戶票據收齊', value: 'docs_received' }, { label: '標記為：已交會計公司', value: 'sent_to_firm' }, { label: '標記為系統啟用前已處理', value: 'pre_system' }]" aria-label="批量操作" /><Button variant="primary" :loading="bulkSaving" @click="bulk">套用</Button><Button variant="text" size="sm" @click="selected = []">取消選擇</Button></div></Transition></Teleport>

    <FormDialog :open="Boolean(claimOpen)" title="記錄已申報" :sub="claimOpen ? `${claimOpen.companyName} · ${claimOpen.period}` : ''" :saving="claimSaving" submit-text="確認申報" layout="stack" @close="claimOpen = null" @submit="saveClaim"><Field label="申報類型"><Segmented v-model="claimZero" :options="[{ label: '正常申報', value: false }, { label: '零申報', value: true }]" label="申報類型" /></Field><Field v-if="!claimZero" label="稅額（人民幣元）" required><TextInput v-model="claimTax" placeholder="例如 356.00" /></Field><p v-if="claimError" class="error" role="alert">{{ claimError }}</p></FormDialog>
    <FormDialog :open="Boolean(current)" :title="current ? `${current.companyName} · ${current.period}` : ''" :sub="current ? `截止 ${current.dueOn} · ${current.customerName}` : ''" :saving="saving" :submit-text="current?.closedReason ? '關閉' : '儲存'" :width="560" layout="stack" @close="current = null" @submit="saveFiling">
      <template v-if="current"><div class="filing-status"><Tag :tone="cellTone(current)">{{ cellText(current) }}</Tag><StampMark v-if="justDone" text="已辦好" play /></div>
        <p v-if="current.status === '公司已註銷'" class="hint">公司已註銷，這期不再處理。</p>
        <div v-if="current.closedReason === 'pre_system'" class="filing-notice"><span>系統啟用前已處理</span><Button variant="text" size="sm" :loading="saving" @click="cancelPreSystem">取消標記</Button></div>
        <div class="filing-steps"><div v-for="([key, label], index) in steps.filter(([key]) => key !== 'paidOn' || !form.zeroFiling)" :key="key" class="filing-step" :class="{ done: current[key], current: currentStep?.[0] === key }"><span class="filing-step-name"><span class="filing-step-mark" aria-hidden="true">{{ current[key] ? '✓' : index + 1 }}</span>{{ label }}</span><span class="cell-sub">{{ current[key] || (currentStep?.[0] === key ? '目前步驟' : '尚未記錄') }}</span></div></div>
        <template v-if="!current.closedReason && currentStep"><Field :label="`${currentStep[1]}日期`"><DateInput v-model="form[currentStep[0]]" :label="`${currentStep[1]}日期`" /><Button variant="text" size="sm" @click="form[currentStep[0]] = today">今天</Button></Field><template v-if="currentStep[0] === 'filedOn'"><Field label="申報類型"><Segmented v-model="form.zeroFiling" :options="[{ label: '正常申報', value: false }, { label: '零申報', value: true }]" label="申報類型" /></Field><Field v-if="!form.zeroFiling" label="稅額（人民幣元）"><TextInput v-model="form.tax" placeholder="例如 356.00" /></Field></template></template>
        <Button v-if="!current.closedReason" variant="text" size="sm" @click="editDates = !editDates">{{ editDates ? '收起日期' : '修改已記錄的日期' }}</Button>
        <div v-if="editDates" class="form-grid"><Field v-for="([key, label]) in steps" :key="key" :label="`${label}日期`"><DateInput v-model="form[key]" :label="`${label}日期`" :disabled="key === 'paidOn' && form.zeroFiling" /></Field></div>
        <Field v-if="current.filedOn || form.filedOn" label="回執"><div class="filing-receipt"><span>{{ current.hasReceipt ? '已上傳回執' : '已申報，尚未上傳回執' }}</span><Button v-if="current.hasReceipt" variant="text" size="sm" @click="viewReceipt">查看</Button><Button size="sm" @click="fileInput.click()">{{ current.hasReceipt ? '重新上傳' : '上傳回執' }}</Button><input ref="fileInput" type="file" accept="image/png,image/jpeg,application/pdf" hidden @change="uploadReceipt" /></div></Field>
        <Field v-if="!current.closedReason" label="備註（只有員工看得到）"><TextInput v-model="form.notes" multiline /></Field><p v-if="dialogError" class="error" role="alert">{{ dialogError }}</p>
      </template>
    </FormDialog>
    <Drawer :open="setupOpen" title="公司報帳設定" sub="為需報帳的內地公司指定會計公司與申報週期。" :width="900" @close="setupOpen = false">
      <DataTable v-model:selected="setupSelected" :columns="setupColumns" :data="setupRows" :selectable="true" :min-width="700"><template #cell-company="{ row }"><strong>{{ row.company }}</strong></template><template #cell-customer="{ row }">{{ row.customer }}</template><template #cell-firm="{ row }"><Select v-model="row.firmId" :options="setupFirmOptions" :aria-label="`${row.company}會計公司`" /></template><template #cell-cycle="{ row }"><Select v-model="row.cycle" :options="row.taxpayerType === '一般納稅人' ? [cycleOptions[0], { ...cycleOptions[1], disabled: true }] : cycleOptions" :aria-label="`${row.company}申報週期`" /></template><template #cell-action="{ row }"><Button variant="text" size="sm" :loading="setupRowSaving === row.id" @click="saveSetupRow(row)">儲存</Button></template><template #empty><EmptyState title="沒有需要報帳的內地公司" /></template></DataTable>
      <p v-if="setupError" class="error" role="alert">{{ setupError }}</p>
      <Teleport to="body"><Transition :css="false" @enter="floatBarEnter" @leave="floatBarLeave"><div v-if="setupOpen && setupSelected.length" class="float-bar in-drawer filing-setup-batch" role="region" aria-label="批量公司設定"><span>已選 {{ setupSelected.length }} 間</span><label>會計公司 <Select v-model="setupFirm" :options="setupFirmOptions" /></label><label>申報週期 <Select v-model="setupCycle" :options="bulkCycleOptions" /></label><Button variant="primary" :loading="setupSaving" @click="saveSetup">批量設定</Button></div></Transition></Teleport>
    </Drawer>
    <Drawer :open="firmsOpen" title="會計公司" sub="做帳報稅的外包單位；可在公司設定中批量指派。" :width="480" @close="firmsOpen = false"><div v-if="!firmForm"><div v-for="firm in firms" :key="firm.id" class="firm-row"><div><strong>{{ firm.name }}</strong><div class="cell-sub">{{ [firm.contact, firm.phone, firm.email].filter(Boolean).join(' · ') || '未填聯絡資料' }} · 負責 {{ firm.companies }} 間</div></div><Button variant="text" size="sm" @click="editFirm(firm)">編輯</Button></div><EmptyState v-if="!firms.length" title="還沒有會計公司" desc="新增後可指派給內地公司。" /><Button class="firm-add" @click="editFirm(null)">新增會計公司</Button></div><div v-else><Field label="名稱" required><TextInput v-model="firmForm.name" /></Field><Field label="聯絡人"><TextInput v-model="firmForm.contact" /></Field><Field label="電話"><TextInput v-model="firmForm.phone" /></Field><Field label="電郵"><TextInput v-model="firmForm.email" /></Field><Field label="備註"><TextInput v-model="firmForm.notes" multiline /></Field><p v-if="firmError" class="error" role="alert">{{ firmError }}</p><div class="drawer-actions"><Button variant="text" @click="firmForm = null">返回</Button><Button variant="primary" :loading="firmSaving" @click="saveFirm">儲存</Button></div></div></Drawer>
    <FormDialog :open="calendarOpen" title="申報截止日" sub="預設為次月 15 日；遇節假日順延時在這裡修改。已生成但未申報的期數會跟著改。" :saving="calendarSaving" submit-text="儲存截止日" layout="stack" @close="calendarOpen = false" @submit="saveCalendar"><Field label="期數"><Select :model-value="calendar.period" :options="periodOptions" @update:model-value="pickPeriod" /></Field><Field label="截止日"><DateInput v-model="calendar.dueOn" label="截止日" /></Field><p class="hint">{{ calendar.custom ? '這個月已自訂截止日。' : '目前使用預設截止日。' }}</p><p v-if="calendarError" class="error" role="alert">{{ calendarError }}</p></FormDialog>
  </section>
</template>
