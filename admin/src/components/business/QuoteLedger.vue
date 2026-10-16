<script setup>
import { onMounted, ref } from 'vue'
import { api, token, rentCents, rentMoney } from '../../api'
import { useAdminStore } from '../../store'
import Button from '../ui/Button.vue'
import DateInput from '../ui/DateInput.vue'
import DataTable from '../ui/DataTable.vue'
import Drawer from '../ui/Drawer.vue'
import EmptyState from '../ui/EmptyState.vue'
import Field from '../ui/Field.vue'
import Tag from '../ui/Tag.vue'

const { customers, services, showSuccess, refresh, openRequest } = useAdminStore()
const rows = ref([]), loading = ref(false), error = ref(''), formError = ref(''), saving = ref(false)
const open = ref(false), active = ref(null), form = ref({})
const kinds = { service: '代辦費', gov_fee: '政府規費', advance: '代墊預估' }
const currencies = ['HKD', 'RMB', 'MOP']
async function load() { loading.value = true; error.value = ''; try { rows.value = await api('/quotes') } catch (caught) { error.value = `未能載入報價：${caught.message}` } finally { loading.value = false } }
onMounted(load)
function edit(row = null) {
  active.value = row; formError.value = ''
  form.value = row ? { customerId: row.customerId, title: row.title, currency: row.currency, validUntil: row.validUntil, serviceCode: row.serviceCode || '', route: row.route || '粵港', notes: row.notes || '', items: row.items.map(item => ({ ...item, amount: (item.amount / 100).toFixed(2) })) }
    : { customerId: customers.value.find(item => !item.is_self)?.id || '', title: '', currency: 'HKD', validUntil: '', serviceCode: '', route: '粵港', notes: '', items: [{ kind: 'service', description: '', amount: '' }] }
  open.value = true
}
async function save() {
  formError.value = ''
  if (!form.value.title?.trim() || !form.value.validUntil || !form.value.customerId) { formError.value = '請填寫客戶、標題及有效期。'; return }
  const items = form.value.items.map(item => ({ ...item, amount: rentCents(item.amount) }))
  if (!items.length || items.some(item => !item.amount || item.amount > 1e12 || !item.description?.trim())) { formError.value = '請填寫每項的描述及大於零的金額（最多兩位小數）。'; return }
  saving.value = true
  try {
    await api(active.value ? `/quotes/${active.value.id}` : '/quotes', active.value ? 'PATCH' : 'POST', { ...form.value, items })
    open.value = false; await load(); showSuccess('報價已儲存')
  } catch (caught) { formError.value = caught.message }
  finally { saving.value = false }
}
async function transition(row, action) {
  saving.value = true; formError.value = ''
  try {
    await api(`/quotes/${row.id}/${action}`, 'POST')
    await load(); active.value = rows.value.find(item => item.id === row.id)
    showSuccess(action === 'send' ? '報價已發出' : '報價已接受')
  } catch (caught) { formError.value = caught.message }
  finally { saving.value = false }
}
async function makeRequest(row) {
  if (!row.serviceCode || !row.route) { formError.value = '報價未設定業務及路線，無法開工單。'; return }
  saving.value = true; formError.value = ''
  try {
    const request = await api('/work-orders', 'POST', { customerId: row.customerId, serviceCode: row.serviceCode, route: row.route, title: row.title, quoteId: row.id })
    await load(); await refresh(); active.value = rows.value.find(item => item.id === row.id); open.value = false; await openRequest(request); showSuccess('工單已建立')
  } catch (caught) { formError.value = caught.message }
  finally { saving.value = false }
}
async function printQuote(row) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) { formError.value = '請允許開啟列印視窗後重試。'; return }
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4100'}/api/quotes/${encodeURIComponent(row.id)}/print`, { headers: { authorization: `Bearer ${token()}` } })
    if (!response.ok) throw new Error('未能取得報價列印內容。')
    const html = await response.text()
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close()
    printWindow.onload = () => { printWindow.focus(); printWindow.print() }
  } catch (caught) { printWindow.close(); formError.value = caught.message }
}
</script>
<template>
  <section class="panel table-panel"><div class="panel-head"><div><h2>報價列表</h2><p>逐項列明代辦費、規費與代墊預估。</p></div><Button size="sm" @click="edit()">新增報價</Button></div>
    <p v-if="error" class="error" role="alert">{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="[{ key: 'customerName', title: '客戶' }, { key: 'title', title: '報價' }, { key: 'total', title: '合計', align: 'right' }, { key: 'validUntil', title: '有效期', align: 'right' }, { key: 'status', title: '狀態' }, { key: 'actions', title: '操作' }]" :data="rows" :loading="loading">
      <template #cell-total="{ row }"><span class="num">{{ rentMoney(row.total, row.currency) }}</span></template>
      <template #cell-status="{ row }"><Tag :tone="row.status === '已接受' ? 'ok' : row.status === '已發出' ? 'info' : 'neutral'">{{ row.status }}</Tag></template>
      <template #cell-actions="{ row }"><Button size="sm" variant="text" @click="edit(row)">{{ row.status === '草擬' ? '編輯' : '查看' }}</Button></template>
      <template #empty><EmptyState title="還沒有報價" desc="先新增報價，再發給客戶確認。"><Button size="sm" @click="edit()">新增報價</Button></EmptyState></template>
    </DataTable>
  </section>
  <Drawer :open="open" :title="active ? '報價詳情' : '新增報價'" sub="金額輸入元；儲存後可發出或列印。" @close="open = false">
    <template v-if="form.items"><Field label="客戶" required><select v-model="form.customerId" :disabled="!!active"><option v-for="customer in customers.filter(item => !item.is_self)" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></Field>
      <Field label="報價標題" required><input v-model="form.title" :disabled="active && active.status !== '草擬'" /></Field>
      <Field label="業務"><select v-model="form.serviceCode" :disabled="active && active.status !== '草擬'"><option value="">請選擇</option><option v-for="service in services" :key="service.code" :value="service.code">{{ service.name }}</option></select></Field>
      <Field label="路線"><select v-model="form.route" :disabled="active && active.status !== '草擬'"><option>粵港</option><option>粵澳</option></select></Field>
      <Field label="幣種"><select v-model="form.currency" :disabled="active && active.status !== '草擬'"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></Field>
      <Field label="有效期" required><DateInput v-model="form.validUntil" :disabled="active && active.status !== '草擬'" /></Field>
      <div v-for="(item, index) in form.items" :key="index" class="fee-part"><div class="panel-head"><div><h2>項目 {{ index + 1 }}</h2></div><Button v-if="(!active || active.status === '草擬') && form.items.length > 1" size="sm" @click="form.items.splice(index, 1)">移除</Button></div><Field label="類別"><select v-model="item.kind" :disabled="active && active.status !== '草擬'"><option v-for="(label, kind) in kinds" :key="kind" :value="kind">{{ label }}</option></select></Field><Field label="描述"><input v-model="item.description" :disabled="active && active.status !== '草擬'" /></Field><Field label="金額（元）"><input v-model="item.amount" inputmode="decimal" :disabled="active && active.status !== '草擬'" /></Field></div>
      <Button v-if="(!active || active.status === '草擬') && form.items.length < 30" size="sm" @click="form.items.push({ kind: 'gov_fee', description: '', amount: '' })">新增項目</Button>
      <Field label="備註"><input v-model="form.notes" :disabled="active && active.status !== '草擬'" /></Field>
      <p v-if="active" class="fee-summary">狀態：{{ active.status }} · 合計 {{ rentMoney(active.total, active.currency) }}</p>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    </template>
    <template #footer><Button @click="open = false">關閉</Button><Button v-if="active" :disabled="saving" @click="printQuote(active)">列印</Button><Button v-if="active?.status === '草擬'" :loading="saving" @click="transition(active, 'send')">發出</Button><Button v-if="active?.status === '已發出'" :loading="saving" @click="transition(active, 'accept')">標記已接受</Button><Button v-if="active?.status === '已接受' && !active.requestId" :loading="saving" @click="makeRequest(active)">開工單</Button><Button v-if="!active || active.status === '草擬'" variant="primary" :loading="saving" @click="save">儲存報價</Button></template>
  </Drawer>
</template>
