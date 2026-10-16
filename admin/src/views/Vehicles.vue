<script setup>
import { computed, ref, watch, nextTick } from 'vue'
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
import PanoramaGraph from '../components/business/PanoramaGraph.vue'
import PortStarMap from '../components/business/PortStarMap.vue'
import GeneratorPipeline from '../components/business/GeneratorPipeline.vue'
import { usePlatePanorama } from '../composables/plate-panorama'
import { useViewMode } from '../composables/view'

const { modal, plateSearch, plateFilter, filteredPlateRows, selectedPlateIds, bulkRule, allowedBulkRules, bulkDate, saveBulkDates, customerName, openPlate, previewPlateImport, confirmPlateImport, importPreview, saveTrackedItem, showError, refresh } = useAdminStore()
const plateView = useViewMode('plates', 'table', ['table', 'panorama', 'ports'], 'table')
const { categories: panoramaCategories, summary: panoramaSummary, plateDanger } = usePlatePanorama()
// 改客戶或路線會清空已選牌照，所以等清空跑完再帶入牌照
function requestForPlate(id) { const store = useAdminStore(), plate = store.plates.value.find(item => item.id === id); if (plate) { store.newRequest.value.customerId = plate.customer_id; store.newRequest.value.route = plate.route || store.newRequest.value.route } nextTick(() => { store.newRequest.value.plateAssetId = id; store.newRequest.value.vehicleId = plate?.vehicle_id || '' }); store.view.value = 'new-request' }
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
const importHeaders = ref([])
const csvFields = ['客戶', '路線', '內地車牌', '港澳車牌', '批文卡號', '批文到期', 'CRP／通行證到期', '香港／澳門公司', '內地公司', '口岸', '指標類別']
const requiredCsvFields = csvFields.slice(0, 9)
const csvMapping = ref({})
const csvOriginal = ref('')
const mappingError = ref('')
function csvHeader(text) {
  let quoted = false, header = '', index = 0
  for (; index < text.length; index++) {
    if (text[index] === '"') { if (quoted && text[index + 1] === '"') { header += '""'; index++ } else { quoted = !quoted; header += '"' } }
    else if (!quoted && /[\r\n]/.test(text[index])) break
    else header += text[index]
  }
  return { header, body: text.slice(index).replace(/^\r?\n/, '') }
}
function headerCells(header) { const cells = []; let value = '', quoted = false; for (let index = 0; index < header.length; index++) { if (header[index] === '"') { if (quoted && header[index + 1] === '"') { value += '"'; index++ } else quoted = !quoted } else if (header[index] === ',' && !quoted) { cells.push(value.trim()); value = '' } else value += header[index] } cells.push(value.trim()); return cells }
function previewMapped() {
  const selected = Object.values(csvMapping.value).filter(Boolean)
  const missing = requiredCsvFields.filter(field => !selected.includes(field))
  if (missing.length || new Set(selected).size !== selected.length) { mappingError.value = missing.length ? `尚未對應：${missing.join('、')}` : '多個來源欄位不可對應同一系統欄位'; importPreview.value = null; return }
  mappingError.value = ''
  const { body } = csvHeader(csvOriginal.value)
  const mapped = importHeaders.value.map(header => csvMapping.value[header] || header)
  const firstLine = mapped.map(header => `"${header.replace(/"/g, '""')}"`).join(',')
  previewPlateImport(`${firstLine}\n${body}`)
}
const importStage = computed(() => importPreview.value ? '預覽' : '選檔')
const statusLabel = status => ({ overdue: '已逾期', due: '需注意', missing: '資料不全', ok: '正常' }[status] || status)
const ports = ['深圳灣', '港珠澳大橋', '蓮塘／香園圍', '落馬洲', '皇崗', '文錦渡', '沙頭角', '拱北', '橫琴', '其他']
const portSaving = ref('')
async function savePort(plate, port) { if (port === plate.port) return; portSaving.value = plate.id; try { await api(`/plate-assets/${plate.id}`, 'PATCH', { port }); await refresh() } catch (error) { showError(error) } finally { portSaving.value = '' } }
async function savePermit(plate, expiresOn) { return saveTrackedItem({ ownerType: 'plate', ownerId: plate.id, code: plate.route === '粵港' ? 'hk_crp' : 'mo_permit', expiresOn }) }
function readCsv(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { const text = String(reader.result); if (text.includes('\uFFFD')) showError(new Error('檔案不是 UTF-8，請在 Excel 選「CSV UTF-8（逗號分隔）」另存')); else { csvOriginal.value = text.replace(/^\uFEFF/, ''); importHeaders.value = headerCells(csvHeader(csvOriginal.value).header); csvMapping.value = Object.fromEntries(importHeaders.value.map(header => [header, csvFields.includes(header) ? header : ''])); previewMapped() } }
  reader.onerror = () => showError(new Error('CSV 讀取失敗'))
  reader.readAsText(file, 'UTF-8')
  event.target.value = ''
}
async function confirmImport() { await confirmPlateImport(); if (importPreview.value && !importPreview.value.dryRun) importOpen.value = false }
function downloadTemplate() {
  const csv = '\uFEFF客戶,路線,內地車牌,港澳車牌,批文卡號,批文到期,CRP／通行證到期,香港／澳門公司,內地公司,口岸,指標類別\n'
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = '牌照匯入範本.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>
<template>
  <ListPage title="牌照" desc="全部牌照集中在一張表，日期可直接填寫或批量更新。" table-title="牌照總表" :list="visibleList" :columns="columns" :min-width="1100" :alt-view="plateView !== 'table'" selectable>
    <template #actions><Button v-if="user()?.role === 'admin'" @click="importOpen = true">匯入 CSV</Button><Button v-if="user()?.role === 'admin'" @click="modal = 'vehicle'">＋ 登記車輛</Button><Button v-if="user()?.role === 'admin'" variant="primary" @click="modal = 'plate'">＋ 登記牌照</Button></template>
    <template #before><Segmented v-model="plateView" :options="[{ value: 'table', label: '表格' }, { value: 'panorama', label: '全景' }, { value: 'ports', label: '口岸' }]" label="牌照視圖" /><Segmented v-if="plateView === 'table'" v-model="plateFilter" :options="filters" label="牌照分類" /></template>
    <template #alt><PanoramaGraph v-if="plateView === 'panorama'" title="牌照全景" :categories="panoramaCategories" :summary="panoramaSummary" @summary="filter => { plateFilter = filter; plateView = 'table' }" @plate="id => openPlate(useAdminStore().plates.value.find(item => item.id === id))" @request="requestForPlate" /><PortStarMap v-else :plates="useAdminStore().plates.value" :customers="useAdminStore().customers.value" :is-overdue="plateDanger" @plate="id => openPlate(useAdminStore().plates.value.find(item => item.id === id))" /></template>
    <template #search><Field label="搜尋牌照"><TextInput v-model="plateSearch" placeholder="搜尋車牌、客戶或公司" /></Field><Field label="來源"><select v-model="ownership"><option value="all">全部</option><option value="client">客戶的</option><option value="self">自有的</option></select></Field><Field label="過關"><label><input v-model="crossingFilter" type="checkbox" /> 90 天內未過關</label></Field><p v-if="crossingError" role="alert">{{ crossingError }}</p></template>
    <template #cell-mainland_plate="{ row }"><HoverCard><button class="text-button" @click="openPlate(row)"><PlateChip :plate="row.mainland_plate" /> <PlateChip :plate="row.local_plate" :route="row.route" /></button><template #card><strong>{{ customerName(row.customer_id) }}</strong><p>{{ row.route }} · {{ row.port || '口岸待設定' }}</p><p>批文：{{ row.card_number || '待補' }} · {{ row.card_expires_on || '到期待錄入' }}</p></template></HoverCard><small>{{ row.route }} · {{ row.card_number || '批文卡號待補' }}</small></template>
    <template #cell-holder_company="{ row }"><span :class="{ 'missing-note': !row.holder_company && !row.card_data?.company }">{{ row.holder_company || row.card_data?.company || '持牌公司待補充' }}</span></template>
    <template #cell-customer_id="{ row }">{{ customerName(row.customer_id) }}</template>
    <template #cell-port="{ row }"><select v-if="user()?.role === 'admin'" :value="row.port || ''" :disabled="portSaving === row.id" :aria-label="`${row.mainland_plate || row.local_plate}口岸`" @change="savePort(row, $event.target.value)"><option value="">待設定</option><option v-for="port in ports" :key="port" :value="port">{{ port }}</option></select><span v-else>{{ row.port || '待設定' }}</span></template>
    <template #cell-card_expires_on="{ row }"><DueDate :date="row.card_expires_on" /><Tag v-if="plateHandler(row)?.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="plateHandler(row)?.handler === 'outsourced'" tone="warning">外包：{{ plateHandler(row).providerName }}</Tag></template>
    <template #cell-permit_expires_on="{ row }"><DueDate :date="row.permit_expires_on" editable label="CRP／通行證到期" :on-save="value => savePermit(row, value)" /><Tag v-if="plateHandler(row)?.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="plateHandler(row)?.handler === 'outsourced'" tone="warning">外包：{{ plateHandler(row).providerName }}</Tag></template>
    <template #cell-lastCrossing="{ row }"><template v-if="crossingSummaries[row.id]?.lastCrossedOn"><span>{{ crossingSummaries[row.id].lastCrossedOn }}（{{ Math.floor((Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn)) / 86400000) }} 天）</span><Tag v-if="!crossingSummaries[row.id].enabled" tone="neutral">未開啟提醒</Tag><Tag v-else :tone="Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 90 * 86400000 ? 'danger' : Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 75 * 86400000 ? 'warning' : 'ok'">{{ Date.now() - Date.parse(crossingSummaries[row.id].lastCrossedOn) > 90 * 86400000 ? '已逾 90 天' : '提醒中' }}</Tag></template><Tag v-else-if="!crossingSummaries[row.id]?.enabled" tone="neutral">未開啟提醒</Tag><span v-else>尚無過關記錄</span></template>
    <template #cell-health_status="{ row }"><Tag :tone="row.health_status === 'overdue' ? 'danger' : row.health_status === 'due' ? 'warning' : row.health_status === 'ok' ? 'ok' : 'neutral'">{{ statusLabel(row.health_status) }}</Tag><small class="cell-sub">{{ usageText(row.usage_status) }}</small></template>
    <template #cell-action="{ row }"><button class="text-button" @click="openPlate(row)">查看 →</button></template>
    <template #batch><label>到期種類 <select v-model="bulkRule" :disabled="!allowedBulkRules.length"><option v-if="allowedBulkRules.includes('hk_crp')" value="hk_crp">CRP 到期</option><option v-if="allowedBulkRules.includes('mo_permit')" value="mo_permit">澳門通行證到期</option></select></label><DateInput v-model="bulkDate" label="批量到期日" /><Button :disabled="!allowedBulkRules.length" @click="saveBulkDates">批量填日期</Button><span v-if="!allowedBulkRules.length">請按路線分開批量填寫</span></template>
  </ListPage>
  <Drawer :open="importOpen" :title="`匯入 CSV · ${importStage}`" sub="確認前不會寫入資料；相同客戶、路線與批文卡號會更新，空白欄位不清除原資料。" @close="importOpen = false; importPreview = null">
    <div class="import-steps"><Button @click="downloadTemplate">下載範本</Button><label class="file-button button">選擇 CSV<input type="file" accept=".csv,text/csv" @change="readCsv" /></label></div>
    <GeneratorPipeline v-if="importHeaders.length" :headers="importHeaders" :fields="csvFields" @change="csvMapping = $event; previewMapped()" />
    <p v-if="mappingError" role="alert">{{ mappingError }}</p>
    <template v-if="importPreview"><div class="import-summary"><span>新增 {{ importPreview.summary.create }}</span><span>更新 {{ importPreview.summary.update }}</span><span>錯誤 {{ importPreview.summary.error }}</span></div><div class="table-wrap"><table><thead><tr><th>列</th><th>結果</th><th v-for="header in importPreview.headers" :key="header">{{ header }}</th><th>原因</th></tr></thead><tbody><tr v-for="row in importPreview.rows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td><StatusTag :status="!row.errors.length" :tone="row.errors.length ? 'danger' : row.action === '更新' ? 'info' : 'ok'" :on="row.action" off="錯誤" /></td><td v-for="header in importPreview.headers" :key="header">{{ row.values[header] || '—' }}</td><td>{{ row.errors.join('；') || '可寫入' }}</td></tr></tbody></table></div></template>
    <template #footer><Button @click="importOpen = false; importPreview = null">取消</Button><Button v-if="importPreview?.dryRun && !importPreview.summary.error" variant="primary" @click="confirmImport">確認寫入</Button></template>
  </Drawer>
</template>
