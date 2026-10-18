<script setup>
// 今日工作的「客戶新增出租」（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項）：客戶在客戶端自行新增出租，員工不用批准，
// 只要知道；相關的換車、換司機、出租代理工單已在業務隊列。按「知道了」後不再列出；客戶取消會重新列出。沒有時不顯示。
import { ref } from 'vue'
import { useLiveRefresh, todayChanged } from '../../composables/live-refresh'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import { api } from '../../api'
import { useAdminStore } from '../../store'

const { customers, openCustomer, openPlateById, showError } = useAdminStore()
const rows = ref([]), loadError = ref(''), busyId = ref('')
const columns = [{ key: 'customer', title: '客戶', minWidth: 110 }, { key: 'plate', title: '牌照', minWidth: 130 }, { key: 'rental', title: '出租', minWidth: 220 }, { key: 'procedures', title: '換車、換司機', minWidth: 180 }, { key: 'status', title: '狀態', minWidth: 100 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 100 }]
const statusTone = { 出租中: 'success', 待換車: 'warning', 待承租人確認: 'warning', 未發出協議: 'neutral', 交給我們代理: 'info', 已取消: 'neutral' }
const procedureWord = item => `${item.name}：${item.handler === 'us' ? '交給我們辦' : '客戶自行辦理'}${item.state === 'done' ? '（已辦妥）' : item.state === 'cancelled' ? '（工單已取消）' : ''}`
async function fetchRows() { try { rows.value = await api('/client-rentals'); loadError.value = '' } catch (error) { loadError.value = error.message } }
// 打開時讀取，之後每分鐘、切回分頁時、按「重新整理」時自動更新；讀完通知導航的待處理數目
const { reload: load } = useLiveRefresh(fetchRows)
function open(row) { const customer = customers.value.find(item => item.id === row.customerId); if (customer) openCustomer(customer) }
async function seen(row) {
  busyId.value = row.id
  try { await api(`/client-rentals/${row.id}/seen`, 'POST', {}); rows.value = rows.value.filter(item => item.id !== row.id); todayChanged() } catch (error) { showError(error) } finally { busyId.value = '' }
}
</script>

<template>
  <section v-if="rows.length || loadError" class="panel client-rentals">
    <div class="panel-head"><div><h2>客戶新增出租 · {{ rows.length }} 件</h2><p>客戶在客戶端自行新增的出租，不用批准。交給我們辦的換車、換司機和出租代理已開工單，在進行中業務跟進。</p></div></div>
    <p v-if="loadError" role="alert">客戶新增出租載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="rows" row-key="id" :min-width="880">
      <template #cell-customer="{ row }"><button class="text-button" @click="open(row)">{{ row.customerName }}</button></template>
      <template #cell-plate="{ row }"><button class="text-button" @click="openPlateById(row.plateId)">{{ row.plateLabel }}</button></template>
      <template #cell-rental="{ row }"><strong>{{ row.renterName }}</strong><small class="cell-sub">{{ row.startsOn }} 起{{ row.endsOn ? ` 至 ${row.endsOn}` : '' }} · {{ row.handling === 'agent' ? `交給我們代理${row.collectionMode === '代收' ? '，代收租金' : ''}` : '客戶自行負責' }}</small></template>
      <template #cell-procedures="{ row }"><small v-for="item in row.procedures" :key="item.id" class="cell-sub">{{ procedureWord(item) }}</small><small v-if="!row.procedures.length" class="cell-sub">不用換車、換司機</small></template>
      <template #cell-status="{ row }"><Tag :tone="statusTone[row.statusWord] || 'neutral'">{{ row.statusWord }}</Tag></template>
      <template #cell-action="{ row }"><Button size="sm" :loading="busyId === row.id" @click="seen(row)">知道了</Button></template>
    </DataTable>
  </section>
</template>
