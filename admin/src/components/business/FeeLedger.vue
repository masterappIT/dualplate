<script setup>
import { computed, ref, watch } from 'vue'
import { api, rentCents, rentMoney } from '../../api'
import { useAdminStore } from '../../store'
import Button from '../ui/Button.vue'
import DataTable from '../ui/DataTable.vue'
import DueDate from '../ui/DueDate.vue'
import EmptyState from '../ui/EmptyState.vue'
import Field from '../ui/Field.vue'
import Modal from '../ui/Modal.vue'
import StampMark from '../ui/StampMark.vue'
import Tag from '../ui/Tag.vue'

const props = defineProps({ customerId: { type: String, default: '' } })
const { customers, showSuccess } = useAdminStore()
const kinds = { annual: '年費', service: '代辦費', gov_fee: '政府規費', advance: '代墊', rent_commission: '租金管理費' }
// 手動新增不可選租金管理費（由系統在代收使用費入帳時自動產生）
const manualKinds = Object.fromEntries(Object.entries(kinds).filter(([kind]) => kind !== 'rent_commission'))
const currencies = ['HKD', 'RMB', 'MOP']
const filters = ref({ customerId: '', kind: '', status: '', overdue: false })
const data = ref({ items: [], totals: { amount: {}, paid: {}, outstanding: {} } })
const loading = ref(false), error = ref(''), busy = ref(false), formError = ref(''), stamp = ref(false)
const dialog = ref(''), target = ref(null), form = ref({}), billing = ref(null), billingCustomerId = ref('')
const proofFile = ref(null), paymentTarget = ref(null)
const eligibleCustomers = computed(() => customers.value.filter(item => !item.is_self))
const selectedCustomerId = computed(() => props.customerId || filters.value.customerId)
const columns = computed(() => [
  ...(!props.customerId ? [{ key: 'customerName', title: '客戶' }] : []),
  { key: 'kindLabel', title: '類別' }, { key: 'description', title: '描述' },
  { key: 'amount', title: '金額', align: 'right' }, { key: 'dueOn', title: '到期', align: 'right' },
  { key: 'status', title: '狀態' }, { key: 'actions', title: '操作' },
])
const paymentRows = computed(() => data.value.items.flatMap(item => item.payments.map(payment => ({ ...payment, fee: item }))))
const visibleItems = computed(() => filters.value.status === '待收' ? data.value.items.filter(item => item.outstanding > 0 && item.status !== '作廢') : data.value.items)
const visibleTotals = computed(() => filters.value.status !== '待收' ? data.value.totals : Object.fromEntries(['amount', 'paid', 'outstanding'].map(key => [key, Object.fromEntries(currencies.map(currency => [currency, visibleItems.value.filter(item => item.currency === currency).reduce((sum, item) => sum + item[key], 0)]))])))
function amounts(values) { return currencies.filter(currency => values?.[currency]).map(currency => rentMoney(values[currency], currency)).join(' · ') || '—' }
async function load() {
  loading.value = true; error.value = ''
  try {
    const params = new URLSearchParams()
    if (selectedCustomerId.value) params.set('customerId', selectedCustomerId.value)
    if (filters.value.kind) params.set('kind', filters.value.kind)
    if (filters.value.status && filters.value.status !== '待收') params.set('status', filters.value.status)
    if (filters.value.overdue) params.set('overdue', '1')
    data.value = await api(`/fees?${params}`)
  } catch (caught) { error.value = `未能載入收費：${caught.message}` }
  finally { loading.value = false }
}
watch([() => props.customerId, filters], load, { immediate: true, deep: true })
function open(type, item = null) {
  dialog.value = type; target.value = item; formError.value = ''; stamp.value = false
  proofFile.value = null
  form.value = type === 'payment' ? { paidOn: new Date().toISOString().slice(0, 10), amount: (item.outstanding / 100).toFixed(2), method: '' }
    : type === 'edit' ? { description: item.description, amount: (item.amount / 100).toFixed(2), currency: item.currency, dueOn: item.dueOn || '', notes: item.notes || '' }
      : type === 'fee' ? { customerId: selectedCustomerId.value || eligibleCustomers.value[0]?.id || '', kind: 'service', currency: 'HKD', amount: '', description: '', dueOn: '', notes: '' }
        : type === 'plan' ? { customerId: selectedCustomerId.value || eligibleCustomers.value[0]?.id || '', name: '', currency: 'HKD', installments: [{ name: '定金', amount: '', dueOn: '' }, { name: '尾數', amount: '', dueOn: '' }] }
          : { reason: '' }
}
async function action(path, method, payload, message) {
  busy.value = true; formError.value = ''
  try { await api(path, method, payload); dialog.value = ''; await load(); showSuccess(message); return true }
  catch (caught) { formError.value = caught.message; return false }
  finally { busy.value = false }
}
function positive(value) { const amount = rentCents(value); if (!amount || amount > 1e12) throw new Error('請填寫大於零的金額，最多兩位小數。'); return amount }
async function save() {
  try {
    if (dialog.value === 'fee' || dialog.value === 'edit') {
      const payload = { ...form.value, amount: positive(form.value.amount), dueOn: form.value.dueOn || null }
      if (!payload.description?.trim()) throw new Error('請填寫收費描述。')
      await action(dialog.value === 'fee' ? '/fees' : `/fees/${target.value.id}`, dialog.value === 'fee' ? 'POST' : 'PATCH', payload, '收費已儲存')
    } else if (dialog.value === 'payment') {
      if (!form.value.paidOn || !form.value.method?.trim()) throw new Error('請填寫收款日期及方式。')
      validateProof()
      const proof = proofFile.value ? await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('未能讀取收款憑證。')); reader.readAsDataURL(proofFile.value) }) : undefined
      // 收足才蓋「已收款」印章；部分收款只顯示提示
      const paysOff = positive(form.value.amount) >= (target.value?.outstanding || 0)
      if (await action(`/fees/${target.value.id}/payments`, 'POST', { ...form.value, amount: positive(form.value.amount), proof }, paysOff ? '收款已記錄，已全數收妥' : '已記錄部分收款')) stamp.value = paysOff
    } else if (dialog.value === 'void') {
      if (!form.value.reason?.trim()) throw new Error('請填寫作廢原因。')
      await action(`/fees/${target.value.id}/void`, 'POST', { reason: form.value.reason }, '收費已作廢')
    } else if (dialog.value === 'plan') {
      if (!form.value.name?.trim()) throw new Error('請填寫分期名稱。')
      if (form.value.installments.some(item => !item.name?.trim() || !item.dueOn)) throw new Error('請填寫每期名稱及到期日。')
      await action('/installment-plans', 'POST', { ...form.value, installments: form.value.installments.map(item => ({ ...item, amount: positive(item.amount) })) }, '分期已建立')
    }
  } catch (caught) { formError.value = caught.message }
}
function validateProof() {
  if (!proofFile.value) return
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(proofFile.value.type) || proofFile.value.size > 5 * 1024 * 1024) throw new Error('憑證只接受 5 MB 以內的 JPG、PNG 或 PDF。')
}
function removePayment(item, payment) { paymentTarget.value = { item, payment }; formError.value = ''; dialog.value = 'revoke' }
async function confirmRevoke() {
  const { item, payment } = paymentTarget.value
  await action(`/fees/${item.id}/payments/${payment.id}`, 'DELETE', null, '收款已撤銷')
}
async function openBilling() {
  billingCustomerId.value = selectedCustomerId.value || eligibleCustomers.value[0]?.id || ''
  dialog.value = 'billing'; formError.value = ''; billing.value = null
  await loadBilling()
}
async function loadBilling() {
  const customerId = billingCustomerId.value
  if (!customerId) { formError.value = '請先建立客戶。'; return }
  formError.value = ''
  try {
    billing.value = await api(`/customers/${customerId}/billing`)
    form.value = { annualAmount: billing.value ? (billing.value.annualAmount / 100).toFixed(2) : '', currency: billing.value?.currency || 'HKD', billMonth: billing.value?.billMonth || 1, active: billing.value?.active ?? true }
  } catch (caught) { formError.value = caught.message }
}
async function saveBilling() {
  try { await action(`/customers/${billingCustomerId.value}/billing`, 'PUT', { ...form.value, annualAmount: positive(form.value.annualAmount), billMonth: Number(form.value.billMonth) }, '年費設定已儲存') }
  catch (caught) { formError.value = caught.message }
}
</script>

<template>
  <section class="panel table-panel">
    <div class="panel-head"><div><h2>{{ customerId ? '收費明細' : '收費列表' }}</h2><p>按幣種分開計算，不作匯率換算。</p></div><div class="fee-actions"><Button size="sm" @click="openBilling">年費設定</Button><Button size="sm" @click="open('plan')">新增分期</Button><Button size="sm" :variant="customerId ? 'secondary' : 'primary'" @click="open('fee')">新增收費</Button></div></div>
    <div v-if="!customerId" class="fee-filters">
      <label>客戶<select v-model="filters.customerId"><option value="">全部客戶</option><option v-for="customer in eligibleCustomers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></label>
      <label>類別<select v-model="filters.kind"><option value="">全部類別</option><option v-for="(name, kind) in kinds" :key="kind" :value="kind">{{ name }}</option></select></label>
      <label>狀態<select v-model="filters.status"><option value="">全部狀態</option><option value="待收">未收（含部分收）</option><option value="未收">完全未收</option><option value="部分收">部分收</option><option value="已收">已收</option><option value="作廢">作廢</option></select></label>
      <label class="fee-check"><input v-model="filters.overdue" type="checkbox" /> 只看逾期</label>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <template v-else>
      <div class="fee-totals"><div v-for="key in ['amount', 'paid', 'outstanding']" :key="key"><span>{{ { amount: '應收總額', paid: '已收', outstanding: '尚未收' }[key] }}</span><strong class="num">{{ amounts(visibleTotals[key]) }}</strong></div></div>
      <DataTable :columns="columns" :data="visibleItems" :loading="loading">
        <template #cell-amount="{ row }"><span class="num">{{ rentMoney(row.amount, row.currency) }}</span></template>
        <template #cell-dueOn="{ row }"><DueDate v-if="row.dueOn && ['未收', '部分收'].includes(row.status)" :date="row.dueOn" /><span v-else class="num">{{ row.dueOn || '—' }}</span></template>
        <template #cell-status="{ row }"><Tag :tone="row.overdue ? 'danger' : row.status === '已收' ? 'ok' : row.status === '部分收' ? 'info' : 'neutral'">{{ row.overdue ? '已逾期 · ' : '' }}{{ row.status }}</Tag></template>
        <template #cell-actions="{ row }"><div class="fee-actions"><Button v-if="row.outstanding && row.status !== '作廢'" size="sm" variant="text" @click="open('payment', row)">記收款</Button><Button v-if="row.kind !== 'rent_commission' && row.status !== '作廢'" size="sm" variant="text" @click="open('edit', row)">編輯</Button><Button v-if="!row.paid && row.kind !== 'rent_commission' && row.status !== '作廢'" size="sm" variant="text" @click="open('void', row)">作廢</Button></div></template>
        <template #empty><EmptyState title="目前沒有收費項目" desc="可以新增收費，或調整篩選條件。"><Button size="sm" @click="open('fee')">新增收費</Button></EmptyState></template>
      </DataTable>
    </template>
  </section>
  <section v-if="paymentRows.length" class="panel table-panel"><div class="panel-head"><div><h2>收款記錄</h2><p>每筆收款均可追溯，錯誤記錄可撤銷。</p></div></div><DataTable :columns="[{ key: 'description', title: '項目' }, { key: 'paidOn', title: '日期' }, { key: 'amount', title: '收款金額', align: 'right' }, { key: 'method', title: '方式' }, { key: 'actions', title: '操作' }]" :data="paymentRows"><template #cell-description="{ row }">{{ row.fee.description }}</template><template #cell-amount="{ row }"><span class="num">{{ rentMoney(row.amount, row.fee.currency) }}</span></template><template #cell-actions="{ row }"><Button v-if="row.fee.kind !== 'rent_commission'" size="sm" variant="text" @click="removePayment(row.fee, row)">撤銷收款</Button><span v-else>從代收租金扣除</span></template></DataTable></section>
  <div v-if="stamp" class="fee-stamp"><StampMark text="已收款" :play="stamp" /><Button size="sm" variant="text" @click="stamp = false">關閉</Button></div>
  <Modal :open="!!dialog" :title="{ fee: '新增收費', edit: '編輯收費', payment: '記收款', void: '作廢收費', billing: '年費設定', plan: '新增分期', revoke: '撤銷收款' }[dialog]" @close="dialog = ''">
    <template v-if="dialog === 'fee' || dialog === 'plan'"><Field v-if="!customerId" label="客戶" required><select v-model="form.customerId"><option v-for="customer in eligibleCustomers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></Field></template>
    <template v-if="dialog === 'fee' || dialog === 'edit'"><Field v-if="dialog === 'fee'" label="類別"><select v-model="form.kind"><option v-for="(name, kind) in manualKinds" :key="kind" :value="kind">{{ name }}</option></select></Field><Field label="描述" required><input v-model="form.description" /></Field><Field label="金額（元）" required><input v-model="form.amount" inputmode="decimal" /></Field><Field label="幣種"><select v-model="form.currency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></Field><Field label="到期日"><input v-model="form.dueOn" type="date" /></Field><Field label="備註"><input v-model="form.notes" /></Field></template>
    <template v-else-if="dialog === 'payment'"><p>{{ target.description }} · 尚未收 {{ rentMoney(target.outstanding, target.currency) }}</p><Field label="收款日期" required><input v-model="form.paidOn" type="date" /></Field><Field label="金額（元）" required><input v-model="form.amount" inputmode="decimal" /></Field><Field label="收款方式" required><input v-model="form.method" placeholder="轉帳、現金等" /></Field><Field label="收款憑證（可選，JPG、PNG 或 PDF，最多 5 MB）"><input type="file" accept="image/jpeg,image/png,application/pdf" @change="proofFile = $event.target.files[0]" /></Field></template>
    <p v-else-if="dialog === 'revoke'">確認撤銷 {{ paymentTarget && rentMoney(paymentTarget.payment.amount, paymentTarget.item.currency) }} 的收款記錄？</p>
    <Field v-else-if="dialog === 'void'" label="作廢原因" required><input v-model="form.reason" /></Field>
    <template v-else-if="dialog === 'billing'"><Field v-if="!customerId" label="客戶"><select v-model="billingCustomerId" @change="loadBilling"><option v-for="customer in eligibleCustomers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></Field><Field label="每年金額（元）" required><input v-model="form.annualAmount" inputmode="decimal" /></Field><Field label="幣種"><select v-model="form.currency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></Field><Field label="計費月份"><select v-model="form.billMonth"><option v-for="month in 12" :key="month" :value="month">{{ month }} 月</option></select></Field><Field label="啟用"><input v-model="form.active" type="checkbox" /></Field></template>
    <template v-else-if="dialog === 'plan'"><Field label="分期名稱" required><input v-model="form.name" /></Field><Field label="幣種"><select v-model="form.currency"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></Field><div v-for="(part, index) in form.installments" :key="index" class="fee-part"><h3>第 {{ index + 1 }} 期</h3><Field label="名稱"><input v-model="part.name" /></Field><Field label="金額（元）"><input v-model="part.amount" inputmode="decimal" /></Field><Field label="到期日"><input v-model="part.dueOn" type="date" /></Field><Button v-if="form.installments.length > 2" size="sm" @click="form.installments.splice(index, 1)">移除此期</Button></div><Button size="sm" :disabled="form.installments.length >= 12" @click="form.installments.push({ name: '', amount: '', dueOn: '' })">新增一期</Button></template>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <template #footer><Button @click="dialog = ''">取消</Button><Button variant="primary" :loading="busy" :disabled="dialog === 'billing' && !form.annualAmount" @click="dialog === 'revoke' ? confirmRevoke() : dialog === 'billing' ? saveBilling() : save()">{{ dialog === 'revoke' ? '確認撤銷' : '確認儲存' }}</Button></template>
  </Modal>
</template>
