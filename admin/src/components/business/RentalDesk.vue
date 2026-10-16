<script setup>
// 出租第 B 輪管理端：承租方上傳的憑證待確認、代收結算、合約範本。
import { ref, computed, watch } from 'vue'
import { api, privateFile, rentMoney } from '../../api'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Select from '../ui/Select.vue'
import DateInput from '../ui/DateInput.vue'
import TextInput from '../ui/TextInput.vue'
import Field from '../ui/Field.vue'
import DataTable from '../ui/DataTable.vue'
import EmptyState from '../ui/EmptyState.vue'
import StampMark from '../ui/StampMark.vue'
import FormDialog from './FormDialog.vue'

const props = defineProps({ tab: String })
const emit = defineEmits(['saved', 'error', 'changed'])
const money = (value, currency) => rentMoney(Math.abs(value || 0), currency)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())

// ── 待確認憑證 ──
const uploads = ref([]), loading = ref(false), rejecting = ref(null), reason = ref(''), saving = ref(false)
async function loadUploads() { loading.value = true; try { uploads.value = await api('/renter-uploads') } catch (cause) { emit('error', cause) } finally { loading.value = false } }
const pending = computed(() => uploads.value.filter(item => item.status === '待確認'))
async function preview(item) { try { window.open(URL.createObjectURL(await privateFile(`/renter-uploads/${item.id}/file`)), '_blank', 'noopener') } catch (cause) { emit('error', cause) } }
async function confirmUpload(item) {
  saving.value = true
  try { await api(`/renter-uploads/${item.id}/confirm`, 'POST', {}); emit('saved', `${item.period} 已登記收款 ${money(item.amount, item.currency)}`); emit('changed'); await loadUploads() } catch (cause) { emit('error', cause) } finally { saving.value = false }
}
async function reject() {
  if (!reason.value.trim()) return emit('error', new Error('請寫明需要重交的原因'))
  saving.value = true
  try { await api(`/renter-uploads/${rejecting.value.id}/reject`, 'POST', { reason: reason.value }); rejecting.value = null; emit('saved', '已要求承租方重交'); await loadUploads() } catch (cause) { emit('error', cause) } finally { saving.value = false }
}
const uploadColumns = [{ key: 'plate', title: '牌照' }, { key: 'renterName', title: '承租方' }, { key: 'period', title: '期數' }, { key: 'amount', title: '承租方填寫', minWidth: 160 }, { key: 'status', title: '狀態' }, { key: 'action', title: '', minWidth: 220 }]

// ── 代收結算 ──
const periods = Array.from({ length: 6 }, (_, index) => { const [y, m] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - index, 1)).toISOString().slice(0, 7) })
const period = ref(periods[1]), settlement = ref({ rows: [] }), settleBusy = ref(''), justSettled = ref('')
async function loadSettlement() { loading.value = true; try { settlement.value = await api(`/rent-settlements?period=${period.value}`) } catch (cause) { emit('error', cause) } finally { loading.value = false } }
async function settle(row) {
  settleBusy.value = row.customerId + row.currency
  try { await api('/rent-settlements', 'POST', { customerId: row.customerId, period: period.value, currency: row.currency, settledOn: today }); justSettled.value = row.customerId + row.currency; emit('saved', `${row.customerName} ${period.value} 已標記結算`); await loadSettlement() } catch (cause) { emit('error', cause) } finally { settleBusy.value = '' }
}
const settleColumns = [{ key: 'customerName', title: '客戶', minWidth: 160 }, { key: 'collected', title: '代收使用費' }, { key: 'fees', title: '代收服務費' }, { key: 'net', title: '應付客戶' }, { key: 'action', title: '', minWidth: 160 }]

// ── 合約範本 ──
const template = ref({ body: '', placeholders: [], isDefault: true }), templateSaving = ref(false)
async function loadTemplate() { try { template.value = await api('/rental-template') } catch (cause) { emit('error', cause) } }
async function saveTemplate() { templateSaving.value = true; try { await api('/rental-template', 'PUT', { body: template.value.body }); emit('saved', '合約範本已儲存，承租方頁面立即使用新範本'); await loadTemplate() } catch (cause) { emit('error', cause) } finally { templateSaving.value = false } }
function insert(name) { template.value.body += `{{${name}}}` }

watch(() => props.tab, tab => { if (tab === 'uploads') loadUploads(); if (tab === 'settlement') loadSettlement(); if (tab === 'template') loadTemplate() }, { immediate: true })
watch(period, loadSettlement)
</script>

<template>
  <section v-if="tab === 'uploads'" class="panel table-panel">
    <div class="panel-head"><div><h2>承租方上傳的轉帳憑證</h2><p>核對憑證後按「確認收款」，該期會登記收款並附上憑證；金額不符時要求重交並寫明原因。</p></div><Tag :tone="pending.length ? 'warning' : 'ok'">待確認 {{ pending.length }}</Tag></div>
    <DataTable :columns="uploadColumns" :data="uploads" :loading="loading" :min-width="820">
      <template #cell-amount="{ row }"><span class="num">{{ money(row.amount, row.currency) }}</span><div class="cell-sub">付款日 {{ row.paidOn }}{{ row.amount !== row.invoiceAmount ? ` · 應收 ${money(row.invoiceAmount, row.currency)}` : '' }}</div></template>
      <template #cell-status="{ row }"><Tag :tone="row.status === '待確認' ? 'warning' : row.status === '已確認' ? 'ok' : 'danger'">{{ row.status }}</Tag><div v-if="row.reviewNote" class="cell-sub">{{ row.reviewNote }}</div></template>
      <template #cell-action="{ row }"><div class="row-actions"><Button variant="text" size="sm" @click="preview(row)">查看憑證</Button><template v-if="row.status === '待確認'"><Button size="sm" variant="primary" :loading="saving" @click="confirmUpload(row)">確認收款</Button><Button variant="text" size="sm" @click="rejecting = row; reason = ''">要求重交</Button></template></div></template>
      <template #empty><EmptyState title="沒有承租方上傳的憑證" desc="在合約詳情產生「承租方連結」轉發給承租方，對方上傳後會出現在這裡。" /></template>
    </DataTable>
    <FormDialog :open="Boolean(rejecting)" title="要求承租方重交" :sub="rejecting ? `${rejecting.renterName} · ${rejecting.period}` : ''" :saving="saving" submit-text="送出要求" layout="stack" @close="rejecting = null" @submit="reject">
      <Field label="原因（承租方會在頁面看到）" required><TextInput v-model="reason" multiline placeholder="例如：金額與本期使用費不符" /></Field>
    </FormDialog>
  </section>

  <section v-else-if="tab === 'settlement'" class="panel table-panel">
    <div class="panel-head filing-head"><div><h2>代收結算</h2><p>按客戶彙總當月代收的使用費，扣除代收服務費，得出應付客戶金額。不同幣種分開計算。轉帳給客戶後按「標記已結算」。</p></div><div class="period-pick"><Select v-model="period" :options="periods.map(value => ({ label: `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`, value }))" aria-label="結算月份" /></div></div>
    <DataTable :columns="settleColumns" :data="settlement.rows" :loading="loading" :min-width="720">
      <template #cell-collected="{ row }"><span class="num">{{ money(row.collected, row.currency) }}</span></template>
      <template #cell-fees="{ row }"><span class="num">{{ money(row.fees, row.currency) }}</span></template>
      <template #cell-net="{ row }"><strong class="num">{{ money(row.net, row.currency) }}</strong></template>
      <template #cell-action="{ row }"><div class="row-actions"><StampMark v-if="row.settled" text="已結算" :play="justSettled === row.customerId + row.currency" /><span v-if="row.settled" class="cell-sub">{{ row.settledOn }}</span><Button v-else size="sm" :loading="settleBusy === row.customerId + row.currency" @click="settle(row)">標記已結算</Button></div></template>
      <template #empty><EmptyState title="這個月沒有代收的使用費" desc="只有收款方式為「代收」、由我們收到的使用費會在這裡結算。" /></template>
    </DataTable>
  </section>

  <section v-else-if="tab === 'template'" class="panel">
    <div class="panel-head"><div><h2>合約範本</h2><p>承租方頁面顯示的安排內容。對外請寫「車輛使用安排」「使用費」，不要寫「出租」「租金」。點下方欄位名稱可插入佔位符。</p></div><Tag :tone="template.isDefault ? 'neutral' : 'ok'">{{ template.isDefault ? '使用預設範本' : '已自訂' }}</Tag></div>
    <div class="template-tokens"><button v-for="name in template.placeholders" :key="name" type="button" class="template-token" @click="insert(name)">{{ name }}</button></div>
    <TextInput v-model="template.body" multiline :rows="14" />
    <div class="drawer-actions"><Button variant="primary" :loading="templateSaving" @click="saveTemplate">儲存範本</Button></div>
  </section>
</template>
