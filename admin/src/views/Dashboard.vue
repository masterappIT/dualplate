<template>
  <PageHeader title="今日工作" desc="按優先順序處理到期項目、業務與待客戶提供資料。"><Button variant="primary" @click="view = 'new-request'">＋ 開工單</Button></PageHeader>
  <div class="metrics">
    <StatCard label="已逾期" tone="danger" :value="todayCounts.overdue" hint="立即跟進" :active="todayTab === 'due' && todayStatus === 'overdue'" @click="choose('due', 'overdue')" />
    <StatCard label="7 天內要辦" tone="warning" :value="todayCounts.due" hint="到期項目" :active="todayTab === 'due' && todayStatus === 'due'" @click="choose('due', 'due')" />
    <StatCard label="待錄入資料" tone="neutral" :value="todayCounts.missing" hint="補上日期或資料" :active="todayTab === 'missing'" @click="choose('missing')" />
    <StatCard label="進行中業務" tone="info" :value="todayCounts.active" hint="未完成工單" :active="todayTab === 'active'" @click="choose('active')" />
  </div>
  <ContractEndings />
  <SignupApplications />
  <AccountClosures />
  <SupportInbox />
  <SelfHandledChanges />
  <CustomerChanges />
  <section ref="queuePanel" class="panel">
    <div class="panel-head"><div><h2>工作隊列</h2><p>日期可直接錄入；批文卡有效期請回到批文卡修改。</p></div></div>
    <FilterBar><Segmented v-model="todayTab" :options="tabs" label="工作隊列分類" /><label>來源<select v-model="todayOwnership"><option value="all">全部</option><option value="client">客戶的</option><option value="self">自有的</option></select></label><label>客戶<select v-model="todayCustomerId"><option value="">全部客戶</option><option v-for="customer in customers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></label><label>狀態<select v-model="todayStatus"><option value="">全部狀態</option><option value="overdue">已逾期</option><option value="due">需處理</option><option value="missing">待錄入</option><option value="待開始">待開始</option><option value="進行中">進行中</option><option value="待客戶提供">待客戶提供</option></select></label></FilterBar>
    <p v-if="selectedDate || selectedMonth" class="date-filter">到期篩選：{{ selectedDate || selectedMonth }} <button class="text-button" @click="selectedDate = ''; selectedMonth = ''">清除</button></p>
    <DataTable v-model:selected="selected" :columns="columns" :data="visibleRows" row-key="_key" :selectable="batchTab" :min-width="880" empty-text="目前沒有符合條件的工作，請調整篩選或新增工單">
      <template #cell-title="{ row }"><strong>{{ row.ruleCode ? row.name : row.title }}</strong><small v-if="row.request">{{ row.request.title }}</small><small v-else-if="!row.ruleCode">{{ row.stage }}</small></template>
      <template #cell-owner="{ row }"><PlateChip v-if="row.ruleCode && ['plate', 'vehicle'].includes(row.ownerType)" :plate="row.ownerLabel" :route="row.route" /><span v-else>{{ row.ruleCode ? row.ownerLabel : row.request?.title || '工單' }}</span></template>
      <template #cell-customer="{ row }">{{ row.customerName || row.request?.customer_name || row.customer_name || '—' }}</template>
      <template #cell-due="{ row }"><DueDate v-if="row.ruleCode" :date="row.dueOn" :editable="row.method === 'expiry' && row.ruleCode !== 'approval'" label="到期日" :on-save="value => saveDate(row, value)" /><span v-else>—</span></template>
      <template #cell-status="{ row }"><span class="tag-row"><Tag :tone="row.ruleCode ? ({ danger: 'danger', amber: 'warning', muted: 'neutral' }[tone(row.level)] || 'neutral') : 'info'">{{ row.ruleCode ? label(row.level) : row.request ? '待客戶提供' : row.status }}</Tag><Tag v-if="row.handler === 'outsourced'" tone="warning">外包：{{ row.providerName }}</Tag></span></template>
      <template #cell-action="{ row }"><div class="row-actions"><template v-if="row.ruleCode"><button v-if="row.ruleCode === 'rent_overdue'" class="text-button" @click="router.push({ path: '/rentals', query: { contractId: row.contractId, invoiceId: row.invoiceId } })">登記收款</button><button v-else-if="row.ruleCode === 'monthly_filing'" class="text-button" @click="router.push({ path: '/filings', query: { filingId: row.filingId } })">處理報帳</button><template v-else><button v-if="row.ruleCode === 'crossing_90'" class="text-button" @click="crossingPlate = row.ownerId; crossingOpen = true">已過關</button><button v-else-if="row.ruleCode === 'approval'" class="text-button" @click="openPlateById(row.ownerId)">修改批文卡</button><button v-else-if="row.completable" class="text-button" @click="complete(row, $event)">已辦好</button><button v-if="row.ownerType === 'driver'" class="text-button" @click="openDriverCustomer(row)">查看司機</button><button v-else class="text-button" @click="createRequestFromDeadline(row)">開工單</button></template></template><button v-else class="text-button" @click="openRequest(row.request || row)">查看工單 →</button></div></template>
    </DataTable>
    <p v-if="batchTab" class="cell-sub">勾選多項後，可在下方一次標記已辦好或填同一個到期日。</p>
  </section>
  <Teleport to="body"><Transition :css="false" @enter="floatBarEnter" @leave="floatBarLeave"><div v-if="batchTab && selectedRows.length" class="float-bar today-bulk-bar" role="region" aria-label="批量處理"><span class="float-bar-count">已選 <b class="tnum">{{ selectedRows.length }}</b> 項</span><span class="float-bar-sep" aria-hidden="true" /><Button v-if="completableRows.length" variant="primary" :loading="batchBusy" @click="completeSelected">標記已辦好（{{ completableRows.length }}）</Button><template v-if="datableRows.length"><DateInput v-model="batchDate" label="批量到期日" /><Button :loading="batchBusy" :disabled="!batchDate" @click="dateSelected">填到期日（{{ datableRows.length }}）</Button></template><Button v-if="filingRows.length" :variant="completableRows.length || datableRows.length ? 'secondary' : 'primary'" @click="router.push('/filings')">報帳 {{ filingRows.length }} 項：到報帳報稅頁批量處理</Button><span v-if="!completableRows.length && !datableRows.length && !filingRows.length" class="cell-sub">所選事項要逐項處理</span><Button variant="text" size="sm" @click="selected = []">取消選擇</Button></div></Transition></Teleport>
  <section v-if="overviewData.rent" class="panel"><div class="panel-head"><div><h2>本月租金 · {{ overviewData.rent.month }}</h2><p>不同幣種分開顯示；逾期應收請在工作隊列登記收款。</p></div></div><div class="rent-strip"><div v-for="[key, title] in [['due', '應收'], ['received', '已收'], ['overdue', '逾期']]" :key="key" :class="['rent-cell', `is-${key}`]"><span>{{ title }} {{ overviewData.rent[key].count }} 期</span><strong class="num">{{ moneyByCurrency(overviewData.rent[key].amount) }}</strong></div></div></section>
  <div class="section-row"><h2>到期概覽</h2></div>
  <Segmented v-model="dashboardView" :options="[{ value: 'table', label: '進度與趨勢' }, { value: 'calendar', label: '到期日曆' }]" label="今日工作視圖" />
  <div v-if="dashboardView === 'table'" class="today-visuals"><section class="panel"><div class="panel-head"><div><h2>本週進度</h2><p>本週到期事項已辦／總數</p></div></div><TickRing v-if="weekTotal" :value="weekDone / weekTotal * 100" :display="weekDone" :decimals="0" unit="項" label="已辦" :size="140" /><p v-else class="week-empty">本週沒有到期項目。</p><p v-if="weekTotal">{{ weekDone }}／{{ weekTotal }} 項</p></section><section class="panel"><div class="panel-head"><div><h2>到期趨勢</h2><p>未來六個月的到期數量；點月份可篩選。</p></div></div><TrendChart :values="monthlyCounts" :labels="shortMonthLabels" primary-label="到期事項" unit="項" :height="180" @select="selectMonth" /></section></div>
  <p v-if="visualError" role="alert">到期視圖載入失敗：{{ visualError }} <button class="text-button" @click="loadVisuals">重試</button></p>
  <DueHeatGrid v-if="dashboardView === 'calendar'" :deadlines="allDeadlines" @date="selectDate" @overdue="selectOverdue" />
  <StampMark v-if="stamp" :key="stamp.key" class="stamp-float" :style="{ left: stamp.x + 'px', top: stamp.y + 'px' }" text="已辦好" play />
  <Modal :open="crossingOpen" title="記錄已過關" @close="crossingOpen = false"><Field label="過關日期"><DateInput v-model="crossedOn" label="過關日期" /></Field><template #footer><Button @click="crossingOpen = false">取消</Button><Button variant="primary" :disabled="crossingBusy || !crossedOn" @click="recordCrossing">儲存過關記錄</Button></template></Modal>
</template>
<script setup>
import StampMark from '../components/ui/StampMark.vue'
import Modal from '../components/ui/Modal.vue'
import Field from '../components/ui/Field.vue'
import DateInput from '../components/ui/DateInput.vue'
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import DueHeatGrid from '../components/charts/DueHeatGrid.vue'
import TickRing from '../components/charts/TickRing.vue'
import TrendChart from '../components/charts/TrendChart.vue'
import { useViewMode } from '../composables/view'
import StatCard from '../components/ui/StatCard.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Button from '../components/ui/Button.vue'
import Segmented from '../components/ui/Segmented.vue'
import DueDate from '../components/ui/DueDate.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import DataTable from '../components/ui/DataTable.vue'
import Tag from '../components/ui/Tag.vue'
import FilterBar from '../components/business/FilterBar.vue'
import CustomerChanges from '../components/business/CustomerChanges.vue'
import SelfHandledChanges from '../components/business/SelfHandledChanges.vue'
import ContractEndings from '../components/business/ContractEndings.vue'
import SupportInbox from '../components/business/SupportInbox.vue'
import SignupApplications from '../components/business/SignupApplications.vue'
import AccountClosures from '../components/business/AccountClosures.vue'
import { useAdminStore } from '../store'
import { api, rentMoney } from '../api'
import { offerFee, offerFees } from '../composables/fee-suggestion'
import { floatBarEnter, floatBarLeave } from '../composables/motion'
const { view, customers, customerTab, openCustomer, todayTab, todayCustomerId, todayOwnership, todayCounts, todayDeadlines, overviewData, saveTrackedItem, createRequestFromDeadline, openPlateById, openRequest, showSuccess, showError } = useAdminStore()
const router = useRouter()
const moneyByCurrency = amounts => Object.entries(amounts || {}).filter(([, amount]) => amount).map(([currency, amount]) => rentMoney(amount, currency)).join(' · ') || '—'
function openDriverCustomer(item) { const customer = customers.value.find(entry => entry.id === item.customerId); if (!customer) return showError(new Error('找不到司機所屬客戶')); openCustomer(customer); customerTab.value = 'vehicles' }
const dashboardView = useViewMode('dashboard', 'table', ['table', 'calendar'], 'table')
const selectedDate = ref(''), selectedMonth = ref('')
const yearDeadlines = ref([])
const weeklyProgress = ref({ done: 0, total: 0 })
const visualError = ref('')
async function loadVisuals() {
  const [overview, progress] = await Promise.allSettled([api('/overview?days=365'), api('/views/weekly-progress')])
  if (overview.status === 'fulfilled') yearDeadlines.value = overview.value.deadlines
  if (progress.status === 'fulfilled') weeklyProgress.value = progress.value
  visualError.value = [overview, progress].filter(result => result.status === 'rejected').map(result => result.reason.message).join('；')
}
onMounted(loadVisuals)
const allDeadlines = computed(() => yearDeadlines.value)
const weekTotal = computed(() => weeklyProgress.value.total)
const weekDone = computed(() => weeklyProgress.value.done)
const monthLabels = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() + index); return date.toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit' }) })
const shortMonthLabels = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() + index); return `${date.getMonth() + 1}月${date.getMonth() === 0 ? ` ${date.getFullYear()}` : ''}` })
const monthlyCounts = computed(() => monthLabels.map(month => allDeadlines.value.filter(item => item.dueOn && new Date(item.dueOn).toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit' }) === month).length))
// 在日曆或趨勢圖選了日子，篩選後捲回上方的工作隊列
const queuePanel = ref(null)
const showQueue = () => queuePanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
function selectDate(date) { selectedDate.value = date; selectedMonth.value = ''; todayTab.value = 'due'; showQueue() }
function selectOverdue() { selectedDate.value = ''; selectedMonth.value = ''; todayStatus.value = 'overdue'; todayTab.value = 'due'; showQueue() }
function selectMonth(index) { if (typeof index !== 'number') return; selectedMonth.value = monthLabels[index]; selectedDate.value = ''; todayTab.value = 'due'; showQueue() }
const crossingOpen = ref(false), crossingPlate = ref(''), crossedOn = ref(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })), crossingBusy = ref(false)
async function recordCrossing() { crossingBusy.value = true; try { await api(`/plates/${crossingPlate.value}/crossings`, 'POST', { crossedOn: crossedOn.value }); crossingOpen.value = false; await useAdminStore().refresh(); showSuccess('已記錄過關') } catch (error) { showError(error) } finally { crossingBusy.value = false } }
const todayStatus = ref('')
function choose(tab, status = '') { todayTab.value = tab; todayStatus.value = status }
const visibleRows = computed(() => {
  const selectingDate = Boolean(selectedDate.value || selectedMonth.value)
  const source = selectingDate ? allDeadlines.value.filter(item => item.handler !== 'client' && (todayOwnership.value === 'all' || Boolean(customers.value.find(customer => customer.id === item.customerId)?.is_self) === (todayOwnership.value === 'self')) && (!todayCustomerId.value || item.customerId === todayCustomerId.value)) : todayDeadlines.value
  return source.filter(item => (!todayStatus.value || selectingDate || (item.ruleCode ? item.level : item.status) === todayStatus.value) && (!selectedDate.value || item.dueOn?.slice(0, 10) === selectedDate.value) && (!selectedMonth.value || (item.dueOn && new Date(item.dueOn).toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit' }) === selectedMonth.value))).map((item, index) => ({ ...item, _key: `${item.id || item.ruleCode || 'row'}:${item.ownerId || index}:${item.filingId || item.invoiceId || item.period || ''}` }))
})
const columns = [{ key: 'title', title: '事項', minWidth: 160 }, { key: 'owner', title: '對象', minWidth: 130 }, { key: 'customer', title: '客戶', minWidth: 120 }, { key: 'due', title: '到期', minWidth: 140, align: 'right' }, { key: 'status', title: '狀態', minWidth: 80 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 150 }]
const tabs = [{ value: 'due', label: '到期待辦' }, { value: 'active', label: '進行中業務' }, { value: 'missing', label: '待錄入' }, { value: 'customer', label: '待客戶提供' }]
const label = level => ({ overdue: '已逾期', due: '需處理', missing: '待錄入' }[level] || level)
const tone = level => ({ overdue: 'danger', due: 'amber', missing: 'muted' }[level] || '')
async function saveDate(item, expiresOn) { return saveTrackedItem({ ...item, code: item.ruleCode, expiresOn }) }
// 蓋章回饋：在按下的位置蓋「已辦好」章，0.9 秒後消失（列表隨即重新整理，該項會離開清單）。
const stamp = ref(null)
function stampAt(event) { const rect = event?.target?.getBoundingClientRect?.(); stamp.value = rect ? { x: rect.left + rect.width / 2 - 28, y: rect.top - 20, key: Date.now() } : null; setTimeout(() => { stamp.value = null }, 900) }
// 批量處理：只在「到期待辦」「待錄入」分頁勾選；能標記已辦好與能填到期日的事項分開計數，其餘仍逐項處理
const selected = ref([]), batchDate = ref(''), batchBusy = ref(false)
const batchTab = computed(() => ['due', 'missing'].includes(todayTab.value))
watch(todayTab, () => { selected.value = [] })
watch(visibleRows, () => { const keys = new Set(visibleRows.value.map(row => row._key)); selected.value = batchTab.value ? selected.value.filter(key => keys.has(key)) : [] })
const selectedRows = computed(() => visibleRows.value.filter(row => selected.value.includes(row._key)))
const completableRows = computed(() => selectedRows.value.filter(row => row.ruleCode && row.completable && !['rent_overdue', 'monthly_filing', 'crossing_90', 'approval'].includes(row.ruleCode)))
const filingRows = computed(() => selectedRows.value.filter(row => row.ruleCode === 'monthly_filing'))
const datableRows = computed(() => selectedRows.value.filter(row => row.ruleCode && row.method === 'expiry' && row.ruleCode !== 'approval'))
async function completeSelected() {
  batchBusy.value = true
  try {
    const result = await api('/rule-completions/batch', 'POST', { items: completableRows.value.map(row => ({ ruleCode: row.ruleCode, ownerId: row.ownerId, period: row.period })) })
    selected.value = []; await useAdminStore().refresh(); showSuccess(`已標記 ${result.completed} 項已辦好`)
    const fees = await offerFees(result.feeSuggestions)
    if (fees) showSuccess(`已記 ${fees} 筆未收代辦費`)
  } catch (error) { showError(error) } finally { batchBusy.value = false }
}
async function dateSelected() {
  batchBusy.value = true
  try {
    // 牌照、公司同一事項用整批接口；車輛、司機逐項儲存
    const groups = new Map()
    for (const row of datableRows.value) { const key = `${row.ownerType}:${row.ruleCode}`; groups.set(key, [...(groups.get(key) || []), row]) }
    for (const rows of groups.values()) {
      const { ownerType, ruleCode } = rows[0]
      if (ownerType === 'plate') await api('/tracked-items/bulk', 'PUT', { plateIds: rows.map(row => row.ownerId), code: ruleCode, expiresOn: batchDate.value })
      else if (ownerType === 'company') await api('/tracked-items/bulk', 'PUT', { ownerType: 'company', ownerIds: rows.map(row => row.ownerId), code: ruleCode, expiresOn: batchDate.value })
      else for (const row of rows) await api('/tracked-items', 'PUT', { ownerType, ownerId: row.ownerId, code: ruleCode, expiresOn: batchDate.value })
    }
    const count = datableRows.value.length
    selected.value = []; batchDate.value = ''; await useAdminStore().refresh(); showSuccess(`已填 ${count} 項到期日`)
  } catch (error) { showError(error); await useAdminStore().refresh() } finally { batchBusy.value = false }
}
async function complete(item, event) { try { const result = await api('/rule-completions', 'POST', { ruleCode: item.ruleCode, ownerId: item.ownerId, period: item.period }); stampAt(event); await useAdminStore().refresh(); showSuccess('本期已標記完成'); if (await offerFee(result)) showSuccess('已記一筆未收代辦費') } catch (error) { showError(error) } }
</script>
