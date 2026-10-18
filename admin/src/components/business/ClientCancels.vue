<script setup>
// 今日工作的「客戶取消的委託」（docs/tasks/self-managed-fixes-plan.md 第 12 步）：客戶在員工還沒開始、還沒報價時自行取消，
// 工單已轉為已取消，員工不用處理，只要知道。按「知道了」後不再列出；沒有時不顯示。
import { ref } from 'vue'
import { useLiveRefresh, todayChanged } from '../../composables/live-refresh'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import { api } from '../../api'
import { useAdminStore } from '../../store'

const { customers, openCustomer, openRequest, showError } = useAdminStore()
const rows = ref([]), loadError = ref(''), busyId = ref('')
const columns = [{ key: 'customer', title: '客戶', minWidth: 110 }, { key: 'request', title: '委託', minWidth: 220 }, { key: 'reason', title: '原因', minWidth: 140 }, { key: 'at', title: '取消時間', width: 140 }, { key: 'action', title: '操作', width: 100 }]
const when = value => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
async function fetchRows() { try { rows.value = await api('/client-cancels'); loadError.value = '' } catch (error) { loadError.value = error.message } }
// 打開時讀取，之後每分鐘、切回分頁時、按「重新整理」時自動更新；讀完通知導航的待處理數目
const { reload: load } = useLiveRefresh(fetchRows)
function openCustomerRow(row) { const customer = customers.value.find(item => item.id === row.customerId); if (customer) openCustomer(customer) }
async function seen(row) {
  busyId.value = row.id
  try { await api(`/client-cancels/${row.id}/seen`, 'POST', {}); rows.value = rows.value.filter(item => item.id !== row.id); todayChanged() } catch (error) { showError(error) } finally { busyId.value = '' }
}
</script>

<template>
  <section v-if="rows.length || loadError" class="panel client-cancels">
    <div class="panel-head"><div><h2>客戶取消的委託 · {{ rows.length }} 件</h2><p>客戶在我們還沒開始、還沒報價時自行取消；工單已轉為已取消，不用另外處理。</p></div></div>
    <p v-if="loadError" role="alert">客戶取消的委託載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="rows" row-key="id" :min-width="720">
      <template #cell-customer="{ row }"><button class="text-button" @click="openCustomerRow(row)">{{ row.customerName }}</button></template>
      <template #cell-request="{ row }"><button class="text-button" @click="openRequest({ id: row.id })">{{ row.title }}</button><small class="cell-sub">{{ row.route }}{{ row.plateLabel ? ` · ${row.plateLabel}` : '' }}</small></template>
      <template #cell-reason="{ row }"><span :class="row.reason ? '' : 'cell-sub'">{{ row.reason || '沒有說明' }}</span></template>
      <template #cell-at="{ row }"><span class="num">{{ when(row.cancelledAt) }}</span></template>
      <template #cell-action="{ row }"><Button size="sm" :loading="busyId === row.id" @click="seen(row)">知道了</Button></template>
    </DataTable>
  </section>
</template>
