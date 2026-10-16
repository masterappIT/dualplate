<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, privateFile, rentCents, rentMoney, user } from '../api'
import { useAdminStore } from '../store'
import { confirm } from '../composables/confirm'
import PageHeader from '../components/ui/PageHeader.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Select from '../components/ui/Select.vue'
import DateInput from '../components/ui/DateInput.vue'
import DueDate from '../components/ui/DueDate.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import Tag from '../components/ui/Tag.vue'
import DataTable from '../components/ui/DataTable.vue'
import FormDialog from '../components/business/FormDialog.vue'
import Segmented from '../components/ui/Segmented.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import RenterLink from '../components/business/RenterLink.vue'
import RentalDesk from '../components/business/RentalDesk.vue'

const route = useRoute(), router = useRouter()
const isAdmin = user()?.role === 'admin'
const { customers, plates, companyRecords, refresh, showSuccess, showError } = useAdminStore()
// 合約／承租方憑證／代收結算／合約範本
const deskTab = ref(route.query.tab && ['uploads', 'settlement', 'template'].includes(route.query.tab) ? route.query.tab : 'contracts')
const contracts = ref([]), loading = ref(true), listError = ref(''), selected = ref(null), detailError = ref(''), busy = ref(false)
const status = ref(''), customerId = ref(''), dialog = ref(''), formError = ref(''), receiptFile = ref(null), proofBusy = ref(false)
const invoice = ref(null), receipt = ref({ receivedOn: today(), amount: '', receivedBy: '', notes: '' })
const termination = ref({ endedOn: today(), reason: '' })
const form = ref({})
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) }
const filtered = computed(() => contracts.value.filter(item => (!status.value || item.status === status.value) && (!customerId.value || item.customerId === customerId.value) && (!route.query.plateId || item.plateId === route.query.plateId)))
const plateOptions = computed(() => plates.value.filter(item => !customerId.value || item.customer_id === customerId.value).map(item => ({ value: item.id, label: [item.mainland_plate, item.local_plate].filter(Boolean).join(' · ') || '車牌待補' })))
const chosenPlate = computed(() => plates.value.find(item => item.id === form.value.plateId))
const isSelf = computed(() => Boolean(customers.value.find(item => item.id === chosenPlate.value?.customer_id)?.is_self))
const companies = computed(() => companyRecords.value.filter(item => item.customer_id === chosenPlate.value?.customer_id && ['香港', '澳門'].includes(item.jurisdiction)))
const columns = [{ key: 'plateLabel', title: '牌照', minWidth: 175 }, { key: 'renter', title: '承租方', minWidth: 140 }, { key: 'rentAmount', title: '每期租金', minWidth: 150, align: 'right' }, { key: 'collectionMode', title: '收款方式', minWidth: 100 }, { key: 'currentInvoice', title: '本期狀態', minWidth: 110 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 90 }]
const invoiceColumns = [{ key: 'period', title: '期數', minWidth: 110 }, { key: 'dueOn', title: '應收日', minWidth: 130 }, { key: 'amount', title: '應收金額', minWidth: 150, align: 'right' }, { key: 'receivedAmount', title: '已收金額', minWidth: 150, align: 'right' }, { key: 'status', title: '狀態', minWidth: 85 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 170 }]
function tone(value) { return ({ 逾期: 'danger', '部分收': 'warning', 待收: 'warning', 已收: 'ok', 生效: 'ok', 草擬: 'info' })[value] || 'neutral' }
async function load() {
  loading.value = true; listError.value = ''
  try { contracts.value = await api('/rental-contracts'); await selectFromQuery() }
  catch (error) { listError.value = error.message || '合約載入失敗' }
  finally { loading.value = false }
}
async function selectFromQuery() {
  const contractId = String(route.query.contractId || contracts.value.find(item => item.invoices?.some(entry => entry.id === route.query.invoiceId))?.id || '')
  if (contractId) await openContract(contractId)
  if (route.query.new === '1' && !dialog.value) newContract()
  if (route.query.invoiceId && selected.value) {
    const entry = selected.value.invoices.find(item => item.id === route.query.invoiceId)
    if (entry && entry.status !== '作廢' && entry.status !== '已收') openReceipt(entry)
  }
}
async function openContract(id) {
  detailError.value = ''
  try { selected.value = await api(`/rental-contracts/${id}`) }
  catch (error) { detailError.value = error.message || '應收款載入失敗'; selected.value = null }
}
function newContract() {
  formError.value = ''
  form.value = { plateId: String(route.query.plateId || ''), renter: { name: '', type: '個人', phone: '', vehiclePlate: '', driver: '' }, startsOn: today(), endsOn: '', rentAmount: '', currency: 'HKD', cycle: 'monthly', dueDay: 1, depositAmount: '0.00', collectionMode: '直付', feeType: 'none', feeValue: '0.00', lessorType: 'client', lessorCompanyId: '', status: '草擬', notes: '' }
  dialog.value = 'contract'
}
function editContract(item) {
  formError.value = ''
  form.value = { ...item, renter: { ...item.renter }, rentAmount: (item.rentAmount / 100).toFixed(2), depositAmount: (item.depositAmount / 100).toFixed(2), feeValue: item.feeType === 'fixed' ? (item.feeValue / 100).toFixed(2) : String(item.feeValue), endsOn: item.endsOn || '', lessorCompanyId: item.lessorCompanyId || '' }
  dialog.value = 'contract'
}
async function saveContract() {
  const amount = rentCents(form.value.rentAmount), deposit = rentCents(form.value.depositAmount)
  const fee = form.value.feeType === 'fixed' ? rentCents(form.value.feeValue) : Number(form.value.feeValue)
  formError.value = !form.value.plateId ? '請選擇牌照' : !form.value.renter?.name?.trim() ? '請填寫承租方名稱' : !form.value.startsOn ? '請填寫起租日期' : amount === null ? '租金請填寫元，最多兩位小數' : deposit === null ? '押金請填寫元，最多兩位小數' : form.value.collectionMode === '代收' && form.value.feeType !== 'none' && (fee === null || !Number.isFinite(fee)) ? '管理費金額無效' : form.value.lessorType === 'company' && !form.value.lessorCompanyId ? '請選擇出租方公司' : ''
  if (formError.value) return
  busy.value = true
  try {
    const payload = { ...form.value, rentAmount: amount, depositAmount: deposit, feeType: form.value.collectionMode === '代收' ? form.value.feeType : 'none', feeValue: form.value.collectionMode === '代收' && form.value.feeType !== 'none' ? fee : 0, dueDay: Number(form.value.dueDay), lessorType: isSelf.value ? 'client' : form.value.lessorType, lessorCompanyId: isSelf.value ? null : form.value.lessorCompanyId || null, endsOn: form.value.endsOn || null }
    const saved = await api(form.value.id ? `/rental-contracts/${form.value.id}` : '/rental-contracts', form.value.id ? 'PATCH' : 'POST', payload)
    dialog.value = ''; await router.replace({ path: '/rentals', query: { contractId: saved.id } }); await refresh(); await load(); await openContract(saved.id); showSuccess('合約已儲存')
  } catch (error) { formError.value = error.message || '合約儲存失敗' }
  finally { busy.value = false }
}
function openReceipt(item) {
  invoice.value = item; receiptFile.value = null; formError.value = ''
  receipt.value = { receivedOn: today(), amount: (item.amount / 100).toFixed(2), receivedBy: selected.value.collectionMode === '代收' ? '代辦公司' : '客戶', notes: '' }
  dialog.value = 'receipt'
}
async function readProof(event) {
  const file = event.target.files?.[0]; receiptFile.value = null
  if (!file) return
  if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { formError.value = '憑證只接受 JPG、PNG 或 PDF，最多 5 MB'; return }
  receiptFile.value = file; formError.value = ''
}
async function saveReceipt() {
  const amount = rentCents(receipt.value.amount)
  formError.value = amount === null || amount <= 0 ? '收款金額請填寫元，最多兩位小數' : !receipt.value.receivedOn ? '請填寫收款日期' : ''
  if (formError.value) return
  busy.value = true
  try {
    let proof
    if (receiptFile.value) proof = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('讀取憑證失敗')); reader.readAsDataURL(receiptFile.value) })
    await api(`/rent-invoices/${invoice.value.id}/receive`, 'POST', { ...receipt.value, receivedAmount: amount, proof })
    dialog.value = ''; await router.replace({ path: '/rentals', query: { contractId: selected.value.id } }); await openContract(selected.value.id); await load(); await refresh(); showSuccess('收款已登記')
  } catch (error) { formError.value = error.message || '登記收款失敗' }
  finally { busy.value = false }
}
async function unreceive(item) {
  if (!await confirm({ title: '撤銷收款', message: '確定撤銷這期收款？憑證也會移除。', confirmText: '確認撤銷', danger: true })) return
  busy.value = true
  try { await api(`/rent-invoices/${item.id}/unreceive`, 'POST', {}); await router.replace({ path: '/rentals', query: { contractId: selected.value.id } }); await openContract(selected.value.id); await load(); await refresh(); showSuccess('收款已撤銷') }
  catch (error) { showError(error) }
  finally { busy.value = false }
}
async function proof(item) {
  proofBusy.value = true
  try { const blob = await privateFile(`/rent-invoices/${item.id}/proof`); const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000) }
  catch (error) { showError(error) }
  finally { proofBusy.value = false }
}
async function terminate() {
  formError.value = !termination.value.reason.trim() ? '請填寫終止原因' : !termination.value.endedOn ? '請填寫終止日期' : ''
  if (formError.value) return
  busy.value = true
  try { await api(`/rental-contracts/${selected.value.id}/terminate`, 'POST', termination.value); dialog.value = ''; await router.replace({ path: '/rentals', query: { contractId: selected.value.id } }); await openContract(selected.value.id); await load(); await refresh(); showSuccess('合約已終止') }
  catch (error) { formError.value = error.message || '終止失敗' }
  finally { busy.value = false }
}
watch(() => [route.query.contractId, route.query.invoiceId, route.query.new], () => { if (!loading.value) selectFromQuery() })
onMounted(load)
</script>

<template>
  <PageHeader title="出租與租金" desc="合約、每期應收款與收款記錄。"><Button v-if="isAdmin" variant="primary" @click="newContract">＋ 新增合約</Button></PageHeader>
  <EmptyState v-if="!isAdmin" title="出租與租金只限管理者" desc="如需查看，請聯絡管理者。" />
  <template v-else>
  <Segmented v-model="deskTab" class="rental-tabs" :options="[{ label: '合約', value: 'contracts' }, { label: '承租方憑證', value: 'uploads' }, { label: '代收結算', value: 'settlement' }, { label: '合約範本', value: 'template' }]" label="出租功能" />
  <RentalDesk v-if="deskTab !== 'contracts'" :tab="deskTab" @saved="showSuccess" @error="showError" @changed="load" />
  <template v-else>
  <section class="panel">
    <div class="panel-head"><div><h2>合約列表</h2><p>按客戶及狀態查看；金額按原幣顯示。</p></div></div>
    <div class="rental-filters"><Field label="客戶"><Select v-model="customerId" :options="[{ value: '', label: '全部客戶' }, ...customers.map(item => ({ value: item.id, label: item.name }))]" /></Field><Field label="合約狀態"><Select v-model="status" :options="['全部狀態', '草擬', '生效', '已結束', '已終止'].map(item => ({ value: item === '全部狀態' ? '' : item, label: item }))" /></Field></div>
    <p v-if="loading">合約載入中…</p><p v-else-if="listError" role="alert">合約載入失敗：{{ listError }} <button class="text-button" @click="load">重試</button></p>
    <template v-else><DataTable v-if="filtered.length" :columns="columns" :data="filtered" :min-width="850">
      <template #cell-plateLabel="{ row }"><span v-for="plate in row.plateLabel.split(' · ')" :key="plate"><PlateChip :plate="plate" /> </span><small>{{ row.customerName }}</small></template>
      <template #cell-renter="{ row }">{{ row.renter.name }}<small v-if="row.renter.vehiclePlate">使用車牌：<PlateChip :plate="row.renter.vehiclePlate" /></small></template>
      <template #cell-rentAmount="{ row }">{{ rentMoney(row.rentAmount, row.currency) }}<small>{{ { monthly: '月繳', quarterly: '季繳', yearly: '年繳' }[row.cycle] }}</small></template>
      <template #cell-currentInvoice="{ row }"><Tag :tone="tone(row.currentInvoice?.status || row.status)">{{ row.currentInvoice?.status || row.status }}</Tag></template>
      <template #cell-action="{ row }"><button class="text-button" @click="openContract(row.id)">查看合約 →</button></template>
    </DataTable><p v-else class="empty">尚無符合條件的合約。可調整篩選，或新增合約開始記錄。</p></template>
  </section>
  <section v-if="selected || detailError" class="panel">
    <div class="panel-head"><div><h2>合約詳情與應收款</h2><p v-if="selected"><span v-for="plate in selected.plateLabel.split(' · ')" :key="plate"><PlateChip :plate="plate" /> </span> · {{ selected.renter.name }} · {{ selected.startsOn }} 至 {{ selected.endsOn || '未定' }} · {{ selected.collectionMode }}</p></div><div v-if="selected" class="rental-actions"><button v-if="!['已結束', '已終止'].includes(selected.status)" class="text-button" @click="editContract(selected)">編輯</button><button v-if="selected.status === '生效'" class="text-button" @click="formError = ''; termination = { endedOn: today(), reason: '' }; dialog = 'terminate'">終止合約</button></div></div>
    <p v-if="detailError" role="alert">{{ detailError }} <button class="text-button" @click="openContract(String(route.query.contractId))">重試</button></p>
    <template v-if="selected"><p>租金 {{ rentMoney(selected.rentAmount, selected.currency) }} · 押金 {{ rentMoney(selected.depositAmount, selected.currency) }} · 每期 {{ selected.dueDay }} 日收款 · <Tag :tone="tone(selected.status)">{{ selected.status }}</Tag></p>
      <p v-if="!selected.invoices?.length" class="empty">尚未產生應收款。草擬合約生效後會自動產生期數。</p>
      <DataTable v-else :columns="invoiceColumns" :data="selected.invoices" :min-width="840">
        <template #cell-dueOn="{ row }"><DueDate v-if="!['已收', '作廢'].includes(row.status)" :date="row.dueOn" /><span v-else class="num">{{ row.dueOn }}</span></template>
        <template #cell-amount="{ row }">{{ rentMoney(row.amount, selected.currency) }}</template>
        <template #cell-receivedAmount="{ row }">{{ row.receivedOn ? rentMoney(row.receivedAmount, selected.currency) : '—' }}<small v-if="row.receivedBy">{{ row.receivedBy }} · {{ row.receivedOn }}</small></template>
        <template #cell-status="{ row }"><Tag :tone="tone(row.status)">{{ row.status }}</Tag></template>
        <template #cell-action="{ row }"><div class="rental-actions"><button v-if="!['作廢', '已收'].includes(row.status)" class="text-button" @click="openReceipt(row)">登記收款</button><button v-if="row.receivedOn" class="text-button" :disabled="busy" @click="unreceive(row)">撤銷</button><button v-if="row.hasProof" class="text-button" :disabled="proofBusy" @click="proof(row)">查看憑證</button></div></template>
      </DataTable>
      <RenterLink :contract-id="selected.id" :renter-name="selected.renter.name" @saved="showSuccess" @error="showError" />
    </template>
  </section>
  </template>
  <FormDialog :open="dialog === 'contract'" :title="form.id ? '編輯合約' : '新增合約'" layout="stack" :saving="busy" submit-text="儲存合約" @close="dialog = ''" @submit="saveContract">
    <Field label="牌照" required><Select v-model="form.plateId" :disabled="!!form.id" :options="[{ value: '', label: '請選擇牌照' }, ...plateOptions]" /></Field>
    <div class="form-grid"><Field label="承租方名稱" required><TextInput v-model="form.renter.name" /></Field><Field label="承租方類型"><Select v-model="form.renter.type" :options="['個人', '公司']" /></Field><Field label="聯絡電話"><TextInput v-model="form.renter.phone" type="tel" /></Field><Field label="使用車牌"><TextInput v-model="form.renter.vehiclePlate" /></Field><Field label="司機"><TextInput v-model="form.renter.driver" /></Field><Field label="合約狀態"><Select v-model="form.status" :options="['草擬', '生效']" /></Field><Field label="起租日期" required><DateInput v-model="form.startsOn" label="起租日期" /></Field><Field label="結束日期"><DateInput v-model="form.endsOn" label="結束日期" /></Field></div>
    <div class="form-grid"><Field label="幣種"><Select v-model="form.currency" :options="[{ value: 'HKD', label: '港元 HK$' }, { value: 'RMB', label: '人民幣 ¥' }, { value: 'MOP', label: '澳門元 MOP' }]" /></Field><Field :label="`每期租金（${form.currency} 元）`" required><TextInput v-model="form.rentAmount" type="number" /></Field><Field :label="`押金（${form.currency} 元）`"><TextInput v-model="form.depositAmount" type="number" /></Field><Field label="收款週期"><Select v-model="form.cycle" :options="[{ value: 'monthly', label: '月繳' }, { value: 'quarterly', label: '季繳' }, { value: 'yearly', label: '年繳' }]" /></Field><Field label="每期收款日（1–28）"><TextInput v-model="form.dueDay" type="number" /></Field><Field label="收款方式"><Select v-model="form.collectionMode" :options="['代收', '直付']" /></Field></div>
    <div v-if="!isSelf" class="form-grid"><Field label="出租方"><Select v-model="form.lessorType" :options="[{ value: 'client', label: '客戶個人' }, { value: 'company', label: '香港／澳門公司' }, { value: 'agent', label: '代辦公司（代理）' }]" /></Field><Field v-if="form.lessorType === 'company'" label="出租方公司" required><Select v-model="form.lessorCompanyId" :options="[{ value: '', label: '請選擇公司' }, ...companies.map(item => ({ value: item.id, label: item.name }))]" /></Field></div><p v-else>出租方：本公司（自有）</p>
    <div v-if="form.collectionMode === '代收'" class="form-grid"><Field label="管理費類型"><Select v-model="form.feeType" :options="[{ value: 'none', label: '無管理費' }, { value: 'fixed', label: '固定金額' }, { value: 'percent', label: '百分比' }]" /></Field><Field v-if="form.feeType !== 'none'" :label="form.feeType === 'fixed' ? `管理費（${form.currency} 元）` : '管理費（%）'"><TextInput v-model="form.feeValue" type="number" /></Field></div>
    <Field label="備註"><TextInput v-model="form.notes" multiline /></Field><p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
  <FormDialog :open="dialog === 'receipt'" title="登記收款" :sub="invoice ? `${invoice.period} · 應收 ${rentMoney(invoice.amount, selected?.currency)}` : ''" layout="stack" :saving="busy" submit-text="確認收款" @close="dialog = ''" @submit="saveReceipt">
    <p v-if="invoice?.receivedOn">本期已登記 {{ rentMoney(invoice.receivedAmount, selected?.currency) }}；再次提交會更新累計已收金額，並非新增一筆。</p>
    <Field label="收款日期" required><DateInput v-model="receipt.receivedOn" label="收款日期" /></Field><Field :label="`收款金額（${selected?.currency} 元）`" required><TextInput v-model="receipt.amount" type="number" /></Field><Field label="收款方"><Select v-model="receipt.receivedBy" :options="['代辦公司', '客戶']" /></Field><Field label="轉帳憑證（JPG／PNG／PDF，最多 5 MB）"><input type="file" accept="image/jpeg,image/png,application/pdf" @change="readProof" /></Field><Field label="備註"><TextInput v-model="receipt.notes" multiline /></Field><p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
  <FormDialog :open="dialog === 'terminate'" title="終止合約" layout="stack" :saving="busy" submit-text="確認終止" @close="dialog = ''" @submit="terminate"><Field label="終止日期" required><DateInput v-model="termination.endedOn" label="終止日期" /></Field><Field label="終止原因" required><TextInput v-model="termination.reason" multiline /></Field><p v-if="formError" class="error" role="alert">{{ formError }}</p></FormDialog>
  </template>
</template>
<style scoped>
.rental-filters,.rental-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.rental-filters{padding:16px 0}.rental-filters :deep(.field){width:min(220px,100%)}.rental-actions{justify-content:flex-end}.panel :deep(.plate-chip){max-width:100%;white-space:normal;overflow-wrap:anywhere}
@media(max-width:600px){.rental-filters :deep(.field){width:100%}}
</style>
