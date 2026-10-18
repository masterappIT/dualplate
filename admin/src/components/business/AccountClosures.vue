<script setup>
// 今日工作的「帳戶已注銷」（docs/requirements.md 5.6.2，2026-10-18）：自管客戶自行注銷帳號後通知管理者，附注銷原因。
// 資料已即時刪除，這裏只留注銷時的名稱和原因；按「知道了」收起，30 天後刪除。沒有時不顯示。
import { ref } from 'vue'
import { useLiveRefresh } from '../../composables/live-refresh'
import DataTable from '../ui/DataTable.vue'
import Tag from '../ui/Tag.vue'
import Button from '../ui/Button.vue'
import { api, user } from '../../api'
import { useAdminStore } from '../../store'

const { showError } = useAdminStore()
const isAdmin = user()?.role === 'admin'
const rows = ref([]), loadError = ref(''), busy = ref('')
const columns = [{ key: 'customerName', title: '客戶', minWidth: 140 }, { key: 'reason', title: '注銷原因', minWidth: 200 }, { key: 'records', title: '保留記錄', minWidth: 140 }, { key: 'closedAt', title: '注銷時間', minWidth: 110 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 90 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function fetchRows() { if (!isAdmin) return; try { rows.value = await api('/account-closures'); loadError.value = '' } catch (error) { loadError.value = error.message } }
// 打開時讀取，之後每分鐘、切回分頁時、按「重新整理」時自動更新；讀完通知導航的待處理數目
const { reload: load } = useLiveRefresh(fetchRows)
async function acknowledge(row) {
  busy.value = row.id
  try { await api(`/account-closures/${row.id}/acknowledge`, 'POST'); await load() } catch (error) { showError(error); await load() } finally { busy.value = '' }
}
</script>

<template>
  <section v-if="isAdmin && (rows.length || loadError)" class="panel account-closures">
    <div class="panel-head"><div><h2>帳戶已注銷 · {{ rows.length }} 位</h2><p>自管客戶自行注銷，帳號和資料已即時刪除；這裏只留注銷時的名稱和原因，30 天後刪除。</p></div></div>
    <p v-if="loadError" role="alert">注銷通知載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="rows" row-key="id" :min-width="640">
      <template #cell-customerName="{ row }"><strong>{{ row.customerName }}</strong><small class="cell-sub">{{ row.plateCount }} 個牌照</small></template>
      <template #cell-reason="{ row }">{{ row.reason || '未填寫' }}<template v-if="row.reasonText">：{{ row.reasonText }}</template></template>
      <template #cell-records="{ row }"><Tag :tone="row.keptRecords ? 'info' : 'neutral'">{{ row.keptRecords ? '保留收費記錄' : '全部刪除' }}</Tag></template>
      <template #cell-closedAt="{ row }"><span class="num">{{ time(row.closedAt) }}</span></template>
      <template #cell-action="{ row }"><button class="text-button" :disabled="busy === row.id" @click="acknowledge(row)">知道了</button></template>
    </DataTable>
  </section>
</template>
