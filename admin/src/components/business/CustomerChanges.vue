<script setup>
// 客戶更新待核對（管理者 2026-10-17）：客戶在客戶端改的資料已生效，這裏逐欄核對；
// 日期欄（影響到期提醒）排在最前。管理者可「核對無誤」或「改回」（改回會通知客戶）；員工只可查看。
import { ref, computed, onMounted } from 'vue'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Drawer from '../ui/Drawer.vue'
import ServiceScope from '../ui/ServiceScope.vue'
import { api } from '../../api'
import { confirm } from '../../composables/confirm'
import { useAdminStore } from '../../store'

const { account, customers, openCustomer, openPlateById, showSuccess, showError } = useAdminStore()
const rows = ref([]), loaded = ref(false), loadError = ref(''), busyId = ref(''), batchBusy = ref(false)
// 客戶建檔時按名稱新建的公司，委託項目先是客戶自理；在這裏確認由誰辦理
const scopeRow = ref(null)
const needsScope = row => row.created && row.entityType === 'company'
const canReview = computed(() => account.value?.role === 'admin')
const columns = [{ key: 'customer', title: '客戶', minWidth: 110 }, { key: 'entity', title: '對象', minWidth: 140 }, { key: 'change', title: '修改內容', minWidth: 240 }, { key: 'changedAt', title: '修改時間', minWidth: 120, align: 'right' }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 140 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function load() {
  try { rows.value = await api('/customer-changes'); loadError.value = '' } catch (error) { loadError.value = error.message } finally { loaded.value = true }
}
onMounted(load)
function open(row) {
  if (row.plateId) return openPlateById(row.plateId)
  const customer = customers.value.find(item => item.id === row.customerId)
  if (customer) openCustomer(customer)
}
async function act(row, action) {
  if (action === 'revert' && !(await confirm({ title: `把「${row.fieldLabel}」改回？`, message: `${row.entityLabel}：${row.afterText || '（空白）'} → ${row.beforeText || '（空白）'}。改回後會通知客戶。`, confirmText: '改回原值', danger: true }))) return
  busyId.value = row.id
  try {
    await api(`/customer-changes/${row.id}/${action}`, 'POST', {})
    rows.value = rows.value.filter(item => item.id !== row.id)
    showSuccess(action === 'accept' ? '已核對' : '已改回並通知客戶')
    if (action === 'revert') useAdminStore().refresh()
  } catch (error) { showError(error); await load() } finally { busyId.value = '' }
}
async function acceptAll() {
  if (!(await confirm({ title: '全部核對無誤？', message: `${rows.value.length} 項客戶修改會標記為已核對。日期類修改請先逐項看過。`, confirmText: `核對 ${rows.value.length} 項` }))) return
  batchBusy.value = true
  try { const result = await api('/customer-changes/accept-batch', 'POST', { ids: rows.value.map(row => row.id) }); rows.value = []; showSuccess(`已核對 ${result.accepted} 項`) } catch (error) { showError(error); await load() } finally { batchBusy.value = false }
}
</script>

<template>
  <section v-if="rows.length || loadError" class="panel customer-changes">
    <div class="panel-head">
      <div><h2>客戶更新待核對 · {{ rows.length }} 項</h2><p>客戶在客戶端修改的資料已生效；請對照原件核對。改日期的排在最前。</p></div>
      <Button v-if="canReview && rows.length > 1" :loading="batchBusy" @click="acceptAll">全部核對無誤</Button>
    </div>
    <p v-if="loadError" role="alert">客戶更新載入失敗：{{ loadError }} <button class="text-button" @click="load">重試</button></p>
    <DataTable v-else :columns="columns" :data="rows" :min-width="760" empty-text="沒有待核對的客戶修改">
      <template #cell-customer="{ row }">{{ row.customerName }}</template>
      <template #cell-entity="{ row }"><button class="text-button entity-link" @click="open(row)">{{ row.entityLabel }}</button><small class="cell-sub">{{ row.entityName }}</small></template>
      <template #cell-change="{ row }">
        <strong>{{ row.fieldLabel }}</strong><Tag v-if="row.isDate" tone="warning" class="change-tag">影響到期</Tag>
        <small v-if="row.created" class="cell-sub">客戶自行建檔：{{ row.afterText }}<template v-if="needsScope(row)">；委託項目暫設客戶自理</template></small>
        <small v-else class="cell-sub change-values"><s>{{ row.beforeText || '（空白）' }}</s> → <b>{{ row.afterText || '（空白）' }}</b></small>
      </template>
      <template #cell-changedAt="{ row }"><span class="num">{{ time(row.changedAt) }}</span><small class="cell-sub">{{ row.changedByName }}</small></template>
      <template #cell-action="{ row }">
        <div v-if="canReview" class="row-actions"><button v-if="needsScope(row)" class="text-button" @click="scopeRow = row">設定委託範圍</button><button class="text-button" :disabled="busyId === row.id" @click="act(row, 'accept')">核對無誤</button><button v-if="!row.created" class="text-button" :disabled="busyId === row.id" @click="act(row, 'revert')">改回</button></div>
        <span v-else class="cell-sub">由管理者核對</span>
      </template>
    </DataTable>
    <Drawer :open="!!scopeRow" :title="scopeRow?.entityLabel || ''" sub="客戶建檔時新建的公司，委託項目暫設為客戶自理。改為我們做或外包後才產生工作；每月報帳只生成今天之後才截止的期數。" @close="scopeRow = null">
      <ServiceScope v-if="scopeRow" owner-type="company" :owner-id="scopeRow.entityId" @saved="showSuccess" @error="showError" />
    </Drawer>
  </section>
</template>

<style scoped>
.change-tag { margin-left: 8px; }
.change-values s { color: var(--ink-3); }
.change-values b { color: var(--ink); font-weight: 600; }
/* 改前改後的值（日期、號碼）不從中間斷行；對象名稱靠左 */
.change-values s, .change-values b { white-space: nowrap; }
.entity-link { text-align: left; }
</style>
