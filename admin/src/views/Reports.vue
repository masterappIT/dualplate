<script setup>
// 月報列表（docs/tasks/monthly-report-brief.md 第 2 節）：打開時後端自動補產生上月草稿；管理者確認後客戶才看得到。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, user } from '../api'
import PageHeader from '../components/ui/PageHeader.vue'
import StatCard from '../components/ui/StatCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import Tag from '../components/ui/Tag.vue'
import Button from '../components/ui/Button.vue'
import Select from '../components/ui/Select.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const router = useRouter()
const rows = ref([]), loading = ref(true), error = ref(''), period = ref(''), status = ref('')
const isAdmin = user()?.role === 'admin'
async function load() {
  loading.value = true; error.value = ''
  try { rows.value = await api('/reports') } catch (cause) { error.value = cause.message } finally { loading.value = false }
}
onMounted(load)
const periods = computed(() => [...new Set(rows.value.map(row => row.period))])
const periodOptions = computed(() => [{ label: '全部月份', value: '' }, ...periods.value.map(value => ({ label: `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`, value }))])
const statusOptions = [{ label: '全部狀態', value: '' }, { label: '草稿', value: '草稿' }, { label: '已確認', value: '已確認' }, { label: '已更正', value: '已更正' }]
const shown = computed(() => rows.value.filter(row => (!period.value || row.period === period.value) && (!status.value || row.status === status.value)))
const counts = computed(() => ({ draft: rows.value.filter(row => row.status === '草稿').length, confirmed: rows.value.filter(row => row.status === '已確認').length }))
const money = value => (Math.abs(value) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const netRows = net => Object.entries(net || {}).filter(([, value]) => value).map(([currency, value]) => ({ currency, value }))
const tone = value => value === '已確認' ? 'ok' : value === '草稿' ? 'warning' : 'neutral'
const columns = [{ key: 'customerName', title: '客戶', minWidth: 180 }, { key: 'period', title: '月份' }, { key: 'status', title: '狀態' }, { key: 'net', title: '本月結算', minWidth: 220 }, { key: 'action', title: '' }]
</script>

<template>
  <section>
    <PageHeader title="月報" desc="每月 1 日為每位客戶產生上月報告草稿；核對無誤後確認，客戶才在客戶端看到。確認後數字鎖定，需要更正時產生更正版。" />
    <p v-if="error" class="error" role="alert">未能載入月報：{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <div class="metrics report-metrics">
      <StatCard label="待確認草稿" :value="counts.draft" :hint="isAdmin ? '核對後確認發出' : '由管理者確認'" :tone="counts.draft ? 'warning' : 'neutral'" :active="status === '草稿'" @click="status = status === '草稿' ? '' : '草稿'" />
      <StatCard label="已發給客戶" :value="counts.confirmed" hint="客戶端可查看" tone="ok" :active="status === '已確認'" @click="status = status === '已確認' ? '' : '已確認'" />
    </div>
    <section class="panel table-panel">
      <div class="panel-head filing-head"><div><h2>報告</h2><p>點「打開」查看完整報告並確認。</p></div><div class="report-filters"><Select v-model="period" label="按月份篩選" :options="periodOptions" aria-label="按月份篩選" /><Select v-model="status" label="按狀態篩選" :options="statusOptions" aria-label="按狀態篩選" /></div></div>
      <DataTable :columns="columns" :data="shown" :loading="loading" :min-width="720">
        <template #cell-customerName="{ row }"><strong>{{ row.customerName }}</strong></template>
        <template #cell-period="{ row }">{{ row.period }}<span v-if="row.version > 1" class="cell-sub"> · 第 {{ row.version }} 版</span></template>
        <template #cell-status="{ row }"><Tag :tone="tone(row.status)">{{ row.status }}</Tag></template>
        <template #cell-net="{ row }"><div v-for="n in netRows(row.net)" :key="n.currency" class="report-net" :class="n.value < 0 ? 'is-due' : 'is-pay'">{{ n.value < 0 ? '客戶應付' : '應付客戶' }} {{ n.currency }} {{ money(n.value) }}</div><span v-if="!netRows(row.net).length" class="cell-sub">沒有需要結算的款項</span></template>
        <template #cell-action="{ row }"><Button variant="text" size="sm" @click="router.push(`/reports/${row.id}`)">打開</Button></template>
        <template #empty><EmptyState title="沒有月報" desc="有客戶後，每月初會自動產生上月報告草稿。" /></template>
      </DataTable>
    </section>
  </section>
</template>
