<script setup>
// 客戶更新待核對（管理者 2026-10-17）：客戶在客戶端改的資料已生效，這裏核對。
// 按「客戶 × 對象」合成一件（客戶上傳一張新卡就是一件，不是十幾行），展開看逐欄改前→改後；
// 整件「核對無誤」，錯的那一欄可單獨「改回」（改回會通知客戶）。有改日期（影響到期提醒）的件排在最前。
// 同一牌照已有客戶自辦待核對時，批文卡修改已包在那一件（今日工作「客戶自行辦理待核對」），這裏不重複列。
// 改前的值永久保留：「最近已處理」列出 7 天內核對或改回的記錄。員工只可查看。
import { ref, computed, onMounted } from 'vue'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Drawer from '../ui/Drawer.vue'
import Segmented from '../ui/Segmented.vue'
import ServiceScope from '../ui/ServiceScope.vue'
import { api } from '../../api'
import { confirm } from '../../composables/confirm'
import { useAdminStore } from '../../store'

const { account, customers, openCustomer, openPlateById, showSuccess, showError } = useAdminStore()
const rows = ref([]), history = ref([]), loaded = ref(false), loadError = ref(''), busyKey = ref(''), batchBusy = ref(false)
const mode = ref('pending'), opened = ref(new Set())
// 客戶建檔時按名稱新建的公司，委託項目先是客戶自理；在這裏確認由誰辦理
const scopeRow = ref(null)
const needsScope = row => row.created && row.entityType === 'company'
const canReview = computed(() => account.value?.role === 'admin')
const columns = [{ key: 'customer', title: '客戶', minWidth: 110 }, { key: 'entity', title: '對象', minWidth: 140 }, { key: 'change', title: '修改內容', minWidth: 300 }, { key: 'changedAt', title: '修改時間', minWidth: 120, align: 'right' }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 140 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const WEEK = 7 * 86400000

async function load() {
  try {
    const [pending, accepted, reverted] = await Promise.all([api('/customer-changes'), api('/customer-changes?status=已核對'), api('/customer-changes?status=已改回')])
    rows.value = pending.filter(row => !row.inSelfHandled)
    history.value = [...accepted, ...reverted].filter(row => Date.now() - Date.parse(row.reviewedAt) < WEEK)
    loadError.value = ''
  } catch (error) { loadError.value = error.message } finally { loaded.value = true }
}
onMounted(load)

// 同一客戶、同一對象的修改合成一件；日期類排在件內最前
function groupRows(list) {
  const groups = new Map()
  for (const row of list) {
    const key = `${row.customerId}:${row.entityType}:${row.entityId}`
    if (!groups.has(key)) groups.set(key, { key, customerId: row.customerId, customerName: row.customerName, entityType: row.entityType, entityId: row.entityId, entityName: row.entityName, entityLabel: row.entityLabel, plateId: row.plateId, items: [] })
    groups.get(key).items.push(row)
  }
  return [...groups.values()].map(group => {
    const items = group.items.sort((a, b) => Number(b.isDate) - Number(a.isDate) || String(b.changedAt).localeCompare(String(a.changedAt)))
    const latest = items.reduce((last, item) => String(item.changedAt) > String(last.changedAt) ? item : last, items[0])
    return { ...group, items, entityLabel: latest.entityLabel, changedAt: latest.changedAt, changedByName: latest.changedByName, reviewedAt: items.reduce((last, item) => String(item.reviewedAt || '') > last ? String(item.reviewedAt) : last, ''), hasDate: items.some(item => item.isDate), created: items.find(item => item.created) || null, scope: items.find(needsScope) || null }
  }).sort((a, b) => mode.value === 'pending' ? Number(b.hasDate) - Number(a.hasDate) || String(b.changedAt).localeCompare(String(a.changedAt)) : String(b.reviewedAt).localeCompare(String(a.reviewedAt)))
}
const groups = computed(() => groupRows(mode.value === 'pending' ? rows.value : history.value))
const pendingCount = computed(() => groupRows(rows.value).length)
const modes = computed(() => [{ label: `待核對 ${pendingCount.value}`, value: 'pending' }, { label: '最近已處理', value: 'history' }])
const fieldNames = group => { const names = [...new Set(group.items.filter(item => !item.created).map(item => item.fieldLabel))]; return names.length > 4 ? `${names.slice(0, 4).join('、')} 等 ${names.length} 項` : names.join('、') }
const summary = group => group.created ? `客戶自行建檔：${group.created.afterText}` : `改了 ${group.items.length} 項`
// 短的值（日期、號碼）不從中間斷行；長的（備註、司機名單）改前改後各佔一行、可換行
const isLong = item => [item.beforeText, item.afterText].some(value => String(value || '').length > 12)
function toggle(key) { const next = new Set(opened.value); next.has(key) ? next.delete(key) : next.add(key); opened.value = next }

function open(group) {
  if (group.plateId) return openPlateById(group.plateId)
  const customer = customers.value.find(item => item.id === group.customerId)
  if (customer) openCustomer(customer)
}
async function acceptGroup(group) {
  busyKey.value = group.key
  try {
    if (group.items.length === 1) await api(`/customer-changes/${group.items[0].id}/accept`, 'POST', {})
    else await api('/customer-changes/accept-batch', 'POST', { ids: group.items.map(item => item.id) })
    await load()
    showSuccess(group.items.length === 1 ? '已核對' : `已核對 ${group.items.length} 項`)
  } catch (error) { showError(error); await load() } finally { busyKey.value = '' }
}
async function revert(group, item) {
  if (!(await confirm({ title: `把「${item.fieldLabel}」改回？`, message: `${item.entityLabel}：${item.afterText || '（空白）'} → ${item.beforeText || '（空白）'}。改回後會通知客戶。`, confirmText: '改回原值', danger: true }))) return
  busyKey.value = group.key
  try { await api(`/customer-changes/${item.id}/revert`, 'POST', {}); await load(); showSuccess('已改回並通知客戶'); useAdminStore().refresh() } catch (error) { showError(error); await load() } finally { busyKey.value = '' }
}
async function acceptAll() {
  const ids = rows.value.map(row => row.id)
  if (!(await confirm({ title: '全部核對無誤？', message: `${pendingCount.value} 件、共 ${ids.length} 項客戶修改會標記為已核對。影響到期的請先展開看過。`, confirmText: `核對 ${pendingCount.value} 件` }))) return
  batchBusy.value = true
  try { const result = await api('/customer-changes/accept-batch', 'POST', { ids }); await load(); showSuccess(`已核對 ${result.accepted} 項`) } catch (error) { showError(error); await load() } finally { batchBusy.value = false }
}
</script>

<template>
  <section v-if="rows.length || history.length || loadError" class="panel customer-changes">
    <div class="panel-head">
      <div><h2>{{ pendingCount ? `客戶更新待核對 · ${pendingCount} 件` : '客戶更新 · 已全部核對' }}</h2><p>客戶在客戶端修改的資料已生效；按對象合成一件，展開對照原件核對。改日期的排在最前。</p></div>
      <Button v-if="canReview && mode === 'pending' && pendingCount > 1" :loading="batchBusy" @click="acceptAll">全部核對無誤</Button>
    </div>
    <p v-if="loadError" role="alert">客戶更新載入失敗：{{ loadError }} <button class="text-button" @click="load">重試</button></p>
    <template v-else>
      <Segmented v-model="mode" :options="modes" label="客戶更新" class="changes-mode" />
      <DataTable :columns="columns" :data="groups" row-key="key" :min-width="820" :empty-text="mode === 'pending' ? '沒有待核對的客戶修改' : '7 天內沒有已處理的客戶修改'">
        <template #cell-customer="{ row }">{{ row.customerName }}</template>
        <template #cell-entity="{ row }"><button class="text-button entity-link" @click="open(row)">{{ row.entityLabel }}</button><small class="cell-sub">{{ row.entityName }}</small></template>
        <template #cell-change="{ row }">
          <strong>{{ summary(row) }}</strong><Tag v-if="row.hasDate" tone="warning" class="change-tag">影響到期</Tag>
          <small v-if="row.scope" class="cell-sub">委託項目暫設客戶自理</small>
          <small v-if="fieldNames(row)" class="cell-sub">{{ fieldNames(row) }}</small>
          <button class="text-button toggle" :aria-expanded="opened.has(row.key)" @click="toggle(row.key)">{{ opened.has(row.key) ? '收起' : `展開 ${row.items.length} 項` }}</button>
          <ul v-if="opened.has(row.key)" class="change-list">
            <li v-for="item in row.items" :key="item.id">
              <div class="change-line"><span class="change-label">{{ item.fieldLabel }}</span><Tag v-if="item.isDate" tone="warning">影響到期</Tag><Tag v-if="mode === 'history'" :tone="item.status === '已改回' ? 'danger' : 'ok'">{{ item.status }}</Tag>
                <button v-if="mode === 'pending' && canReview && !item.created" class="text-button revert" :disabled="busyKey === row.key" @click="revert(row, item)">改回</button></div>
              <div v-if="item.created" class="cell-sub">{{ item.afterText }}</div>
              <div v-else :class="['change-values', isLong(item) ? 'is-long' : 'is-short']"><s>{{ item.beforeText || '（空白）' }}</s><span class="arrow">→</span><b>{{ item.afterText || '（空白）' }}</b></div>
              <small v-if="mode === 'history'" class="cell-sub">{{ item.reviewedByName }} · {{ time(item.reviewedAt) }}</small>
            </li>
          </ul>
        </template>
        <template #cell-changedAt="{ row }"><span class="num">{{ time(row.changedAt) }}</span><small class="cell-sub">{{ row.changedByName }}</small></template>
        <template #cell-action="{ row }">
          <div v-if="mode === 'pending' && canReview" class="row-actions"><button v-if="row.scope" class="text-button" @click="scopeRow = row.scope">設定委託範圍</button><button class="text-button" :disabled="busyKey === row.key" @click="acceptGroup(row)">{{ row.items.length > 1 ? '整件核對無誤' : '核對無誤' }}</button></div>
          <span v-else-if="mode === 'pending'" class="cell-sub">由管理者核對</span>
          <span v-else class="cell-sub">已處理</span>
        </template>
      </DataTable>
    </template>
    <Drawer :open="!!scopeRow" :title="scopeRow?.entityLabel || ''" sub="客戶建檔時新建的公司，委託項目暫設為客戶自理。改為我們做或外包後才產生工作；每月報帳只生成今天之後才截止的期數。" @close="scopeRow = null">
      <ServiceScope v-if="scopeRow" owner-type="company" :owner-id="scopeRow.entityId" @saved="showSuccess" @error="showError" />
    </Drawer>
  </section>
</template>

<style scoped>
.changes-mode { margin-bottom: 12px; }
.change-tag { margin-left: 8px; }
.toggle { display: block; margin-top: 4px; }
.change-list { margin: 8px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
.change-list li { padding: 8px 0; border-bottom: 1px solid var(--rule); }
.change-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.change-label { font-weight: 600; }
.revert { margin-left: auto; }
.change-values { margin-top: 2px; color: var(--ink-2); overflow-wrap: anywhere; }
.change-values s { color: var(--ink-3); }
.change-values b { color: var(--ink); font-weight: 600; }
.change-values .arrow { margin: 0 6px; color: var(--ink-3); }
/* 短的值（日期、號碼）不從中間斷行；長的（備註、司機名單）改前、改後各佔一行並可換行 */
.change-values.is-short s, .change-values.is-short b { white-space: nowrap; }
.change-values.is-long s, .change-values.is-long b { display: block; }
.change-values.is-long .arrow { display: block; margin: 2px 0; }
.entity-link { text-align: left; }
</style>
