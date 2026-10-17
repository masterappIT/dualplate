<script setup>
// 客戶自行辦理待核對（docs/tasks/self-handled-changes-design.md）：客戶自己辦了換車、續期、換司機、口岸、商號、補領、驗車、備案，或決定不再續期，
// 在客戶端整件更新（資料已生效）；這裏按「整件」對照正本核對。管理者「核對無誤」或寫明原因「退回」（通知客戶）；員工只可查看。
import { ref, computed, onMounted } from 'vue'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Modal from '../ui/Modal.vue'
import Field from '../ui/Field.vue'
import TextInput from '../ui/TextInput.vue'
import { api, privateImage } from '../../api'
import { useAdminStore } from '../../store'

const { account, openPlateById, showSuccess, showError, refresh } = useAdminStore()
const rows = ref([]), loaded = ref(false), loadError = ref(''), busyId = ref('')
const canReview = computed(() => account.value?.role === 'admin')
const columns = [{ key: 'customer', title: '客戶', minWidth: 110 }, { key: 'plate', title: '牌照', minWidth: 130 }, { key: 'change', title: '客戶自行辦理', minWidth: 280 }, { key: 'createdAt', title: '提交時間', minWidth: 120, align: 'right' }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 170 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function load() {
  try { rows.value = await api('/self-handled'); loadError.value = '' } catch (error) { loadError.value = error.message } finally { loaded.value = true }
}
onMounted(load)

// 每件自辦寫成幾行白話，員工一眼看到改了甚麼、還缺甚麼
function lines(row) {
  const d = row.details
  if (row.kind === 'vehicle_change') return [
    `${d.oldVehicle ? d.oldVehicle.plate : '未綁定車輛'} → ${d.newVehicle.plate}${[d.newVehicle.brand, d.newVehicle.model].filter(Boolean).length ? `（${[d.newVehicle.brand, d.newVehicle.model].filter(Boolean).join(' ')}）` : ''}${d.newVehicle.reused ? '，沿用名下已有車輛' : ''}`,
    d.oldVehicle && !d.oldVehicle.retired ? `舊車 ${d.oldVehicle.plate} 仍掛在另一個牌照，繼續提醒` : d.oldVehicle ? `舊車 ${d.oldVehicle.plate} 保留作記錄，不再提醒` : '',
    d.dates.length ? `新車到期日：${d.dates.map(item => `${item.name} ${item.expiresOn}`).join('、')}` : '',
    d.missing.length ? `未填：${d.missing.join('、')}` : ''
  ].filter(Boolean)
  if (row.kind === 'renewal') return [
    ...d.done.map(item => `${item.name}：${item.before || '未有記錄'} → ${item.expiresOn}`),
    d.notDone.length ? `未辦（照舊提醒）：${d.notDone.join('、')}` : '',
    d.newCardFiling === true ? '新批文備案：客戶表示已辦好' : d.newCardFiling === false ? '新批文備案：未辦' : ''
  ].filter(Boolean)
  if (row.kind === 'driver_change') return [
    `司機：${d.after.map(item => `${item.name}（${item.role === '主' ? '主' : '副'}${item.isNew ? '，新' : ''}）`).join('、')}`,
    d.removed.length ? `換走：${d.removed.map(item => `${item.name}${item.stillDrivesOther ? '（仍開其他牌照）' : '（不再提醒）'}`).join('、')}` : '',
    ...d.after.filter(item => item.missing.length).map(item => `${item.name} 未填：${item.missing.join('、')}`)
  ].filter(Boolean)
  if (row.kind === 'crossing_change') return [
    `通行口岸：${d.before || '未有記錄'} → ${d.after}`,
    d.crp ? `香港 CRP：${d.crp.before || '未有記錄'} → ${d.crp.after}` : '香港 CRP 到期日未更新',
    `牌照口岸欄現為 ${d.port || '未設定'}，請按新卡設定；海關及邊檢備案可能要重辦`
  ]
  if (row.kind === 'company_change') return [
    ...d.changes.map(item => `${item.label}：${item.before || '未有記錄'} → ${item.after}`),
    '牌照所屬公司組沒有自動搬移，請核對後到牌照頁處理'
  ]
  if (row.kind === 'replacement') return [
    `卡面流水號：${d.serial.before || '未有記錄'} → ${d.serial.after}`,
    d.cardNumber ? `批文卡編號：${d.cardNumber.before || '未有記錄'} → ${d.cardNumber.after}` : '',
    d.validityChanged ? `新卡有效期與原來不同（${d.validityChanged.before} → ${d.validityChanged.after}），補領有效期應不變，請核對` : ''
  ].filter(Boolean)
  if (row.kind === 'inspection_done' || row.kind === 'filing_done' || row.kind === 'tax_paid') return [
    `${d.name}${d.label ? `：${d.label}` : ''}${d.ownerLabel ? `（${d.ownerLabel}）` : ''}，到期日 ${d.dueOn}`,
    '客戶表示已辦好，這一期已停止提醒；退回會恢復提醒'
  ]
  return [`原因：${d.reason}${d.note ? `；${d.note}` : ''}`, '這個牌照已停止到期提醒；退回會恢復提醒']
}
const mismatch = row => row.details.cardMismatch ? (row.kind === 'driver_change' ? `批文卡駕駛人為 ${row.details.cardMismatch}` : `批文卡上車牌為 ${row.details.cardMismatch}`) : ''

// 對照正本：批文卡正本照片＋客戶附上的相片
const photosRow = ref(null), photos = ref([]), photosLoading = ref(false)
async function openPhotos(row) {
  photosRow.value = row; photos.value = []; photosLoading.value = true
  const sideName = { front: '批文卡正面', back: '批文卡背面' }
  const wanted = [...(row.cardSides || []).map(side => [sideName[side], `/plate-assets/${row.plateId}/image/card-${side}`]), ...row.files.map((file, index) => [`客戶附上的相片 ${index + 1}`, `/self-handled/${row.id}/files/${file}`])]
  const loaded = await Promise.all(wanted.map(async ([label, path]) => { try { return { label, src: await privateImage(path) } } catch { return null } }))
  photos.value = loaded.filter(Boolean); photosLoading.value = false
}

async function accept(row) {
  busyId.value = row.id
  try { await api(`/self-handled/${row.id}/accept`, 'POST', {}); rows.value = rows.value.filter(item => item.id !== row.id); showSuccess(row.cardChanges ? `已核對（連同批文卡 ${row.cardChanges} 項修改）` : '已核對'); refresh() } catch (error) { showError(error); await load() } finally { busyId.value = '' }
}
const returning = ref(null), returnNote = ref(''), returnBusy = ref(false)
function startReturn(row) { returning.value = row; returnNote.value = '' }
async function confirmReturn() {
  const row = returning.value
  returnBusy.value = true
  try { await api(`/self-handled/${row.id}/return`, 'POST', { note: returnNote.value }); rows.value = rows.value.filter(item => item.id !== row.id); returning.value = null; showSuccess('已退回並通知客戶'); refresh() } catch (error) { showError(error) } finally { returnBusy.value = false }
}
</script>

<template>
  <section v-if="rows.length || loadError" class="panel self-handled">
    <div class="panel-head">
      <div><h2>客戶自行辦理待核對 · {{ rows.length }} 件</h2><p>客戶自己辦好了變更（換車、續期、換司機、口岸、商號、補領、驗車、備案）或決定不再續期，資料已更新；請對照正本整件核對。</p></div>
    </div>
    <p v-if="loadError" role="alert">客戶自辦載入失敗：{{ loadError }} <button class="text-button" @click="load">重試</button></p>
    <DataTable v-else :columns="columns" :data="rows" :min-width="820" empty-text="沒有待核對的客戶自辦">
      <template #cell-customer="{ row }">{{ row.customerName }}</template>
      <template #cell-plate="{ row }"><button class="text-button" @click="openPlateById(row.plateId)">{{ row.details.plateLabel }}</button><small class="cell-sub">辦好日期 {{ row.handledOn }}</small></template>
      <template #cell-change="{ row }">
        <strong>{{ row.kindName }}</strong>
        <span class="tag-row">
          <Tag v-if="row.details.ours" tone="warning">原屬我們代辦</Tag>
          <Tag v-if="row.details.openRequests?.length" tone="danger">有未結案工單</Tag>
          <Tag v-if="mismatch(row)" tone="warning">與批文卡不符</Tag>
          <Tag v-if="row.cardChanges" tone="info">連同批文卡 {{ row.cardChanges }} 項修改</Tag>
        </span>
        <small v-for="line in lines(row)" :key="line" class="cell-sub">{{ line }}</small>
        <small v-if="mismatch(row)" class="cell-sub warn-line">{{ mismatch(row) }}，請對照正本</small>
        <small v-for="item in row.details.openRequests" :key="item.id" class="cell-sub warn-line">請確認後取消工單：{{ item.title }}（{{ item.status }}）</small>
      </template>
      <template #cell-createdAt="{ row }"><span class="num">{{ time(row.createdAt) }}</span><small class="cell-sub">{{ row.createdByName }}</small></template>
      <template #cell-action="{ row }">
        <div class="row-actions">
          <button v-if="row.kind !== 'stop_renewal' && (row.cardSides?.length || row.files.length)" class="text-button" @click="openPhotos(row)">對照正本</button>
          <template v-if="canReview"><button class="text-button" :disabled="busyId === row.id" @click="accept(row)">核對無誤</button><button class="text-button" :disabled="busyId === row.id" @click="startReturn(row)">退回</button></template>
          <span v-else class="cell-sub">由管理者核對</span>
        </div>
      </template>
    </DataTable>

    <Modal :open="!!photosRow" :title="photosRow ? `${photosRow.details.plateLabel} · ${photosRow.kindName}` : ''" sub="批文卡正本與客戶附上的相片" :width="720" close-on-overlay @close="photosRow = null">
      <p v-if="photosLoading">正在載入相片…</p>
      <p v-else-if="!photos.length">沒有正本或相片。</p>
      <div v-else class="photo-grid"><figure v-for="photo in photos" :key="photo.label"><img :src="photo.src" :alt="photo.label" /><figcaption class="cell-sub">{{ photo.label }}</figcaption></figure></div>
    </Modal>
    <Modal :open="!!returning" :title="returning ? `退回「${returning.kindName}」` : ''" sub="退回後會通知客戶；客戶已改的資料不會自動改回，請到牌照頁修正。不再續期退回會恢復提醒。" :width="480" @close="returning = null">
      <Field label="退回原因（會發給客戶）" required><TextInput v-model="returnNote" multiline :maxlength="300" placeholder="例如：新車保單相片看不清楚，請重拍" /></Field>
      <template #footer><Button @click="returning = null">取消</Button><Button variant="primary" :disabled="returnBusy || !returnNote.trim()" @click="confirmReturn">{{ returnBusy ? '處理中…' : '退回並通知客戶' }}</Button></template>
    </Modal>
  </section>
</template>

<style scoped>
.tag-row { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 8px; vertical-align: middle; }
.warn-line { color: var(--status-due); }
.photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.photo-grid figure { margin: 0; }
.photo-grid img { display: block; width: 100%; border: 1px solid var(--rule); background: var(--paper); }
.photo-grid figcaption { margin-top: 4px; color: var(--ink-3); }
</style>
