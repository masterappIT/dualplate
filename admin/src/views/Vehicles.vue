<script setup>
import { computed, ref, watch } from 'vue'
import { api, user } from '../api'
import ListPage from '../components/business/ListPage.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Segmented from '../components/ui/Segmented.vue'
import Drawer from '../components/ui/Drawer.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import DueDate from '../components/ui/DueDate.vue'
import DateInput from '../components/ui/DateInput.vue'
import Tag from '../components/ui/Tag.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import HoverCard from '../components/ui/HoverCard.vue'
import { useListPage } from '../composables/list'
import { useAdminStore } from '../store'

const { modal, plateSearch, plateFilter, filteredPlateRows, selectedPlateIds, bulkRule, allowedBulkRules, bulkDate, saveBulkDates, customerName, openPlate, previewPlateImport, confirmPlateImport, importPreview, saveTrackedItem, showError, refresh } = useAdminStore()
const filters = [{ value: 'all', label: '全部' }, { value: 'attention', label: '需注意' }, { value: 'rental', label: '出租中' }, { value: 'own', label: '自用' }, { value: 'empty', label: '空置' }, { value: 'missing', label: '資料不全' }]
const ownership = ref('all'), crossingFilter = ref(false), crossingSummaries = ref({}), scopeSummaries = ref({}), crossingError = ref('')
const visiblePlates = computed(() => filteredPlateRows.value.filter(plate => (ownership.value === 'all' || Boolean(useAdminStore().customers.value.find(item => item.id === plate.customer_id)?.is_self) === (ownership.value === 'self')) && (!crossingFilter.value || crossingSummaries.value[plate.id] && (!crossingSummaries.value[plate.id].lastCrossedOn || Date.now() - Date.parse(crossingSummaries.value[plate.id].lastCrossedOn) >= 90 * 86400000))))
const visibleList = useListPage(visiblePlates, refresh, selectedPlateIds)
watch(filteredPlateRows, async rows => { try { const [crossings, scopes] = await Promise.all([Promise.all(rows.map(async plate => [plate.id, await api(`/plates/${plate.id}/crossings`)])), user()?.role === 'admin' ? Promise.all(rows.map(async plate => [plate.id, await api(`/service-scopes?ownerType=plate&ownerId=${plate.id}`)])) : []]); crossingSummaries.value = Object.fromEntries(crossings); scopeSummaries.value = Object.fromEntries(scopes); crossingError.value = '' } catch (error) { crossingError.value = error.message } }, { immediate: true })
const plateHandler = plate => scopeSummaries.value[plate.id]?.services.find(item => item.service === 'plate_service')
// 使用狀態併入狀態欄的第二行；「待核對」對用戶顯示為「使用待確認」。
const usageText = status => ({ '待核對': '使用待確認' }[status] || status || '使用待確認')
const columns = [{ key: 'mainland_plate', title: '車牌', width: 190 }, { key: 'holder_company', title: '持牌公司', width: 150 }, { key: 'customer_id', title: '客戶', width: 120 }, { key: 'port', title: '口岸', width: 72 }, { key: 'card_expires_on', title: '批文到期', width: 128 }, { key: 'permit_expires_on', title: 'CRP／通行證到期', width: 138 }, { key: 'lastCrossing', title: '上次過關', width: 150 }, { key: 'health_status', title: '狀態／使用', width: 96 }, { key: 'action', title: '操作', className: 'col-actions', width: 72 }]
const importOpen = ref(false)
const importStage = computed(() => importPreview.value ? '預覽' : '選檔')
const statusLabel = status => ({ overdue: '已逾期', due: '需注意', missing: '資料不全', ok: '正常' }[status] || status)
async function savePermit(plate, expiresOn) { return saveTrackedItem({ ownerType: 'plate', ownerId: plate.id, code: plate.route === '粵港' ? 'hk_crp' : 'mo_permit', expiresOn }) }
function readCsv(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { const text = String(reader.result); if (text.includes('\uFFFD')) showError(new Error('檔案不是 UTF-8，請在 Excel 選「CSV UTF-8（逗號分隔）」另存')); else previewPlateImport(text) }
  reader.onerror = () => showError(new Error('CSV 讀取失敗'))
  reader.readAsText(file, 'UTF-8')
  event.target.value = ''
}
async function confirmImport() { await confirmPlateImport(); if (importPreview.value && !importPreview.value.dryRun) importOpen.value = false }
function downloadTemplate() {
  const csv = '\uFEFF客戶,路線,內地車牌,港澳車牌,批文卡號,批文到期,CRP／通行證到期,香港／澳門公司,內地公司\n'
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = '牌照匯入範本.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>
<template>
  <ListPage title="牌照" desc="全部牌照集中在一張表，日期可直接填寫或批量更新。" table-title="牌照總表" :list="visibleList" :columns="columns" :min-width="1100" selectable>
    <template #actions><Button v-if="user()?.role === 'admin'" @click="importOpen = true">匯入 CSV</Button><Button v-if="user()?.role === 'admin'" @click="modal = 'vehicle'">＋ 登記車輛</Button><Button v-if="user()?.role === 'admin'" variant="primary" @click="modal = 'plate'">＋ 登記牌照</Button></template>
    <template #before><Segmented v-model="plateFilter" :options="filters" label="牌照分類" /></template>
    <template #search><Field label="搜尋牌照"><TextInput v-model="plateSearch" placeholder="搜尋車牌、客戶或公司" /></Field><Field label="來源"><select v-model="ownership"><option value="all">全部</option><option value="client">客戶的</option><option value="self">自有的</option></select></Field><Field label="過關"><label><input v-model="crossingFilter" type="checkbox" /> 90 天內未過關</label></Field><p v-if="crossingError" role="alert">{{ crossingError }}</p></template>
    <template #cell-mainland_plate="{ row }"><HoverCard><button class="text-button" @click="openPlate(row)"><PlateChip :plate="row.mainland_plate" /> <PlateChip :plate="row.local_plate" :route="row.route" /></button><template #card><strong>{{ customerName(row.customer_id) }}</strong><p>{{ row.route }} · {{ row.port || '口岸待設定' }}</p><p>批文：{{ row.card_number || '待補' }} · {{ row.card_expires_on || '到期待錄入' }}</p></template></HoverCard><small>{{ row.route }} · {{ row.card_number || '批文卡號待補' }}</small></template>
    <template #cell-holder_company="{ row }"><span :class="{ 'missing-note': !row.holder_company && !row.card_data?.company }">{{ row.holder_company || row.card_data?.company || '持牌公司待補充' }}</span></template>
    <template #cell-customer_id="{ row }">{{ customerName(row.customer_id) }}</template>
    <template #cell-port="{ row }">{{ row.port || '待設定' }}</template>
    <template #cell-card_expires_on="{ row }"><DueDate :date="row.card_expires_on" /><Tag v-if="plateHandler(row)?.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="plateHandler(row)?.handler === 'outsourced'" tone="warning">外包：{{ plateHandler(row).providerName }}</Tag></template>
    <template #cell-permit_expires_on="{ row }"><DueDate :date="row.permit_expires_on" editable label="CRP／通行證到期" :on-save="value => savePermit(row, value)" /><Tag v-if="plateHandler(row)?.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="plateHandler(row)?.handler === 'outsourced'" tone="warning">外包：{{ plateHandler(row).providerName }}</Tag></template>
    <template #cell-lastCrossing="{ row }"><template v-if="crossingSummaries[row.id]?.lastCrossedOn"><span>{{ crossingSummaries[row.id].lastCrossedOn }}（{{ Math.floor((Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn)) / 86400000) }} 天）</span><Tag v-if="!crossingSummaries[row.id].enabled" tone="neutral">未開啟提醒</Tag><Tag v-else :tone="Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 90 * 86400000 ? 'danger' : Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 75 * 86400000 ? 'warning' : 'ok'">{{ Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 90 * 86400000 ? '已逾 90 天' : '提醒中' }}</Tag></template><Tag v-else-if="!crossingSummaries[row.id]?.enabled" tone="neutral">未開啟提醒</Tag><span v-else>尚無過關記錄</span></template>
    <template #cell-health_status="{ row }"><Tag :tone="row.health_status === 'overdue' ? 'danger' : row.health_status === 'due' ? 'warning' : row.health_status === 'ok' ? 'ok' : 'neutral'">{{ statusLabel(row.health_status) }}</Tag><small class="cell-sub">{{ usageText(row.usage_status) }}</small></template>
    <template #cell-action="{ row }"><button class="text-button" @click="openPlate(row)">查看 →</button></template>
    <template #batch><label>到期種類 <select v-model="bulkRule" :disabled="!allowedBulkRules.length"><option v-if="allowedBulkRules.includes('hk_crp')" value="hk_crp">CRP 到期</option><option v-if="allowedBulkRules.includes('mo_permit')" value="mo_permit">澳門通行證到期</option></select></label><DateInput v-model="bulkDate" label="批量到期日" /><Button :disabled="!allowedBulkRules.length" @click="saveBulkDates">批量填日期</Button><span v-if="!allowedBulkRules.length">請按路線分開批量填寫</span></template>
  </ListPage>
  <Drawer :open="importOpen" :title="`匯入 CSV · ${importStage}`" sub="確認前不會寫入資料；相同客戶、路線與批文卡號會更新，空白欄位不清除原資料。" @close="importOpen = false; importPreview = null">
    <div class="import-steps"><Button @click="downloadTemplate">下載範本</Button><label class="file-button button">選擇 CSV<input type="file" accept=".csv,text/csv" @change="readCsv" /></label></div>
    <template v-if="importPreview"><div class="import-summary"><span>新增 {{ importPreview.summary.create }}</span><span>更新 {{ importPreview.summary.update }}</span><span>錯誤 {{ importPreview.summary.error }}</span></div><div class="table-wrap"><table><thead><tr><th>列</th><th>結果</th><th v-for="header in importPreview.headers" :key="header">{{ header }}</th><th>原因</th></tr></thead><tbody><tr v-for="row in importPreview.rows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td><StatusTag :status="!row.errors.length" :tone="row.errors.length ? 'danger' : row.action === '更新' ? 'info' : 'ok'" :on="row.action" off="錯誤" /></td><td v-for="header in importPreview.headers" :key="header">{{ row.values[header] || '—' }}</td><td>{{ row.errors.join('；') || '可寫入' }}</td></tr></tbody></table></div></template>
    <template #footer><Button @click="importOpen = false; importPreview = null">取消</Button><Button v-if="importPreview?.dryRun && !importPreview.summary.error" variant="primary" @click="confirmImport">確認寫入</Button></template>
  </Drawer>
</template>
