<script setup>
// 今日工作的「托管合約到期」（docs/requirements.md 5.6.2）：合約 30 天內結束或已結束、仍標為托管的客戶。只給管理者，沒有時不顯示。
import { ref } from 'vue'
import { useLiveRefresh } from '../../composables/live-refresh'
import DataTable from '../ui/DataTable.vue'
import DueDate from '../ui/DueDate.vue'
import Button from '../ui/Button.vue'
import { api, user } from '../../api'
import { useAdminStore } from '../../store'

const { customers, openCustomer } = useAdminStore()
const isAdmin = user()?.role === 'admin'
const rows = ref([]), loadError = ref('')
const columns = [{ key: 'name', title: '客戶', minWidth: 140 }, { key: 'endsOn', title: '合約結束日', minWidth: 160 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 120 }]
async function fetchRows() { if (!isAdmin) return; try { rows.value = await api('/service-mode/contract-endings'); loadError.value = '' } catch (error) { loadError.value = error.message } }
// 打開時讀取，之後每分鐘、切回分頁時、按「重新整理」時自動更新；讀完通知導航的待處理數目
const { reload: load } = useLiveRefresh(fetchRows)
function open(row) { const customer = customers.value.find(item => item.id === row.customerId); if (customer) openCustomer(customer) }
</script>

<template>
  <section v-if="isAdmin && (rows.length || loadError)" class="panel contract-endings">
    <div class="panel-head"><div><h2>托管合約到期 · {{ rows.length }} 位</h2><p>合約 30 天內結束或已結束。續約就改合約結束日；不續約就到客戶頁切換為自管。</p></div></div>
    <p v-if="loadError" role="alert">合約到期載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="rows" row-key="customerId" :min-width="520">
      <template #cell-name="{ row }"><button class="text-button" @click="open(row)">{{ row.name }}</button></template>
      <template #cell-endsOn="{ row }"><DueDate :date="row.contractEndsOn" /></template>
      <template #cell-action="{ row }"><button class="text-button" @click="open(row)">查看客戶 →</button></template>
    </DataTable>
  </section>
</template>
