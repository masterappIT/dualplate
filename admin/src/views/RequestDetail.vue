<template>
  <template v-if="selected">
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'business'">← 返回業務</button>
      <h1>{{ selected.title }}</h1>
      <p>
        {{ selected.route }} · {{ customerName(selected.customer_id) }} ·
        <PlateChip v-if="headerPlate" :plate="headerPlate" :route="selected.route" /><span v-else>未指定牌照</span>
      </p>
    </div>
    <span
      class="badge large"
      :class="statusBadge[selected.status] || 'blue'"
      >{{ selected.status }}</span
    >
  </div>
  <div class="detail-grid">
    <div>
      <section class="panel guilloche-panel"><div class="panel-head"><div><h2>工單摘要</h2><p>核對客戶、牌照、負責人與截止日。</p></div></div><KeyValue :items="[{ label: '客戶', value: customerName(selected.customer_id) }, { label: '路線', value: selected.route }, { label: '牌照', value: headerPlate || '未指定' }, { label: '業務', value: selected.title }, { label: '負責人', value: staff.find(item => item.id === selected.assignee_id)?.name || '未指派' }, { label: '截止日', value: selected.due_on || '未設定' }]" /></section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>受理與進度</h2>
            <p>官方結果須按實際回執或證件更新</p>
          </div>
        </div>
        <div class="form-grid">
          <Field label="工單狀態"><Select v-model="editRequest.status" :options="statusOptions" /></Field>
          <Field label="目前階段"><Select v-model="editRequest.stage" :options="stageOptions" /></Field>
          <Field label="負責人"><Select v-model="editRequest.assigneeId" :options="staff.filter(item => item.active).map(item => ({ value: item.id, label: item.name }))" /></Field>
          <Field label="截止日"><DateInput v-model="editRequest.dueOn" label="截止日" /></Field>
        </div>
        <Field label="更新說明"><TextInput v-model="editRequest.note" multiline placeholder="記錄客戶配合、官方回覆或下一步安排" /></Field>
        <Button :disabled="['已完成', '已取消'].includes(selected.status)" @click="saveProgress">儲存進度</Button>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>辦理步驟</h2>
            <p>分別核對內地、香港／澳門的步驟</p>
          </div>
        </div>
        <div v-if="allStepsDone" class="ready-to-close"><span>全部步驟已完成，可以結案並更新到期日、記錄收費。</span><Button variant="primary" size="sm" @click="editRequest.status = '已完成'; saveProgress()">結案</Button></div>
        <div v-for="task in selected.tasks" :key="task.id" class="task-row step-spine" :class="{ 'step-finished': ['已完成', '不適用'].includes(task.status), 'step-current': task.id === selected.tasks.find(item => !['已完成', '不適用'].includes(item.status))?.id }">
          <span
            class="task-number"
            :class="task.status === '已完成' ? 'done' : ''"
            >{{ task.status === "已完成" ? "✓" : "○" }}</span
          >
          <div class="task-main">
            <strong>{{ task.title }}</strong><Tag v-if="task.owner === 'client'" tone="info">客戶提供</Tag><small v-if="task.documents?.length">所需文件：{{ task.documents.join('、') }}</small
            ><small>{{ task.jurisdiction }}</small>
          </div>
          <select
            :aria-label="task.title + '：狀態'"
            :value="task.status"
            @change="updateTask(task, $event.target.value)"
          >
            <option>待辦</option>
            <option>辦理中</option>
            <option>已完成</option>
            <option>不適用</option>
          </select>
          <Button v-if="!['已完成', '不適用'].includes(task.status) && selected.status !== '已完成'" variant="text" size="sm" @click="task.owner === 'client' ? setOwner(task, 'us', []) : askClient(task)">{{ task.owner === 'client' ? '改由我們處理' : '請客戶提供' }}</Button>
        </div>
      </section>
      <section class="panel table-panel">
        <div class="panel-head"><div><h2>客戶上傳的文件</h2><p>逐份確認；全部已確認後由員工決定是否完成步驟。</p></div></div>
        <p v-if="attachmentError" class="error" role="alert">{{ attachmentError }} <Button size="sm" @click="loadAttachments">重試</Button></p>
        <template v-else><p v-if="allConfirmed" class="attachment-confirmed"><StampMark text="已收妥" :play="stampPlay" /> 客戶文件已齊</p><DataTable :columns="attachmentColumns" :data="attachments" :loading="attachmentLoading" :min-width="760" empty-text="尚未收到文件，請提醒客戶在客戶端上傳。"><template #cell-fileName="{ row }"><Button variant="text" size="sm" :loading="openingFile === row.id" @click="openAttachment(row)">{{ row.fileName }}</Button></template><template #cell-taskId="{ row }">{{ selected.tasks?.find(task => task.id === row.taskId)?.title || '未指定步驟' }}</template><template #cell-size="{ row }"><span class="num file-size">{{ formatSize(row.size) }}</span></template><template #cell-createdAt="{ row }"><span class="num">{{ formatTime(row.createdAt) }}</span></template><template #cell-status="{ row }"><Tag :tone="attachmentTone(row.status)">{{ row.status }}</Tag><small v-if="row.reviewNote" class="attachment-note">{{ row.reviewNote }}</small></template><template #cell-actions="{ row }"><div class="attachment-actions"><Button v-if="row.status !== '已確認'" size="sm" :loading="reviewing === row.id" @click="reviewAttachment(row, '已確認')">確認收妥</Button><Button v-if="row.status !== '需重交'" size="sm" variant="text" :disabled="!!reviewing" @click="reuploadTarget = row; reviewNote = ''; reviewError = ''">要求重交</Button></div></template></DataTable></template>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>更新紀錄</h2>
            <p>客戶可看到與其工單相關的進度</p>
          </div>
        </div>
        <div v-for="a in selected.activities" :key="a.id" class="activity-row">
          <span class="activity-dot"></span>
          <div>
            <strong>{{ a.detail }}</strong
            ><small
              >{{ a.actor_name || "系統" }} · {{ date(a.created_at) }}</small
            >
          </div>
        </div>
      </section>
    </div>
    <div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>關聯兩地牌</h2>
            <p>工單與現有兩地牌分開管理</p>
          </div>
        </div>
        <button
          v-if="selected.plateAsset"
          class="button outline full"
          @click="openPlate(selected.plateAsset)"
        >
          查看批文卡 {{ selected.plateAsset.card_number }} →</button
        ><template v-else-if="selected.service_code === 'new_application'"
          ><p class="description">取得正式批文卡後，從此工單建立兩地牌檔案。</p>
          <button class="button primary full" @click="openPlateFromRequest">
            批文卡已取得 · 建立檔案
          </button></template
        >
        <p v-else class="description">此工單尚未關聯兩地牌檔案。</p>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>客戶需求</h2>
            <p>提交內容</p>
          </div>
        </div>
        <p class="description">{{ selected.description || "未填寫說明" }}</p>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>官方依據</h2>
            <p>僅列此服務線適用的官方來源</p>
          </div>
        </div>
        <a
          v-for="source in selectedSources"
          :key="source.id"
          class="source-link"
          :href="source.url"
          target="_blank"
          rel="noopener"
          ><strong>{{ source.title }}</strong
          ><small>{{ source.agency }} · 核對 {{ source.checkedAt }}</small
          ><span>↗</span></a
        >
        <div v-if="!selectedSources.length" class="empty">
          此類要求需先人工確認官方指引
        </div>
      </section>
      <section v-if="selected.vehicle" class="panel">
        <div class="panel-head">
          <div>
            <h2>驗車提示</h2>
            <p>須按車輛類型和業務核對</p>
          </div>
        </div>
        <div v-for="g in selectedGuidance" :key="g.label" class="guidance">
          <span class="badge" :class="g.state === 'required' ? 'amber' : ''">{{
            g.state === "required"
              ? "須辦"
              : g.state === "review"
                ? "待核實"
                : "條件式"
          }}</span
          ><span
            >{{ g.label }}
            <a
              v-if="g.sourceId"
              :href="sources.find((s) => s.id === g.sourceId)?.url"
              target="_blank"
              rel="noopener"
              >官方依據 ↗</a
            ></span
          >
        </div>
        <button class="button outline full" @click="openInspectionForm">
          ＋ 建立驗車任務
        </button>
      </section>
    </div>
  </div>
  </template>
  <div v-else class="panel empty" role="status">正在載入工單資料…</div>
  <Modal :open="Boolean(clientTask)" title="請客戶提供資料" :sub="clientTask ? `${clientTask.title} · 客戶會在手機收到通知並可直接上傳` : ''" @close="clientTask = null">
    <Field label="需要客戶提供的文件（每行一項）"><TextInput v-model="clientDocs" multiline :rows="4" placeholder="例如：香港身份證副本&#10;車輛登記文件" /></Field>
    <p v-if="clientError" class="error" role="alert">{{ clientError }}</p>
    <template #footer><Button variant="ghost" @click="clientTask = null">取消</Button><Button variant="primary" :loading="clientSaving" @click="setOwner(clientTask, 'client', clientDocs.split(/\n|、|,|，/).map(item => item.trim()).filter(Boolean))">交給客戶</Button></template>
  </Modal>
  <Modal :open="completionOpen" title="更新到期日" sub="結案前核對證件到期日與司機登記；也可略過。" @close="completionOpen = false"><p v-if="selected?.service_code === 'vehicle_change'">換車後請到牌照詳情核對並更新批文卡。</p><div v-for="entry in deadlineEntries" :key="entry.code" class="record-row"><Field :label="entry.label"><DateInput v-model="entry.expiresOn" :label="entry.label" /></Field></div><template v-if="selected?.service_code === 'driver_change'"><p v-if="!selected.plate_asset_id">工單尚未關聯牌照，請先關聯牌照才可更新司機登記。</p><template v-else><Field label="主司機"><Select v-model="completionDrivers.main" :options="completionDriverOptions" /></Field><Field label="副司機一"><Select v-model="completionDrivers.deputies[0]" :options="completionDriverOptions" /></Field><Field label="副司機二"><Select v-model="completionDrivers.deputies[1]" :options="completionDriverOptions" /></Field><div v-for="driver in selectedCompletionDrivers" :key="driver.id"><strong>{{ driver.name }} · 證件到期</strong><div v-for="document in driver.documents" :key="document.code" class="record-row"><Field :label="document.name"><DateInput v-model="completionDriverDates[`${driver.id}:${document.code}`]" :label="document.name" /></Field></div></div><p>更新司機登記會先儲存到牌照；結案若失敗，登記仍會保留。</p></template></template><RequestFees v-if="completionOpen && user()?.role === 'admin' && !isSelfCustomer" ref="requestFees" :expected="selected?.expectedFees || []" :basis="selected?.feeBasis || ''" /><p v-if="completionError" role="alert" class="error">{{ completionError }}</p><template #footer><Button @click="completionOpen = false">返回</Button><Button :disabled="completionSaving" @click="finish(true)">略過更新並結案</Button><Button variant="primary" :loading="completionSaving" :disabled="!deadlineEntries.some(item => item.expiresOn) && selected?.service_code !== 'driver_change' || selected?.service_code === 'driver_change' && !selected.plate_asset_id" @click="finish(false)">更新並結案</Button></template></Modal>
  <Modal :open="cancelOpen" title="取消工單" @close="cancelOpen = false"><Field label="取消原因" required><TextInput v-model="cancelReason" multiline /></Field><template #footer><Button @click="cancelOpen = false">返回</Button><Button variant="primary" :disabled="!cancelReason.trim()" @click="cancelRequest">確認取消</Button></template></Modal>
  <Modal :open="!!reuploadTarget" title="要求重交文件" :sub="reuploadTarget?.fileName" @close="reuploadTarget = null"><Field label="重交原因" required><TextInput v-model="reviewNote" multiline placeholder="告訴客戶需要修正甚麼" /></Field><p v-if="reviewError" class="error" role="alert">{{ reviewError }}</p><template #footer><Button @click="reuploadTarget = null">取消</Button><Button variant="primary" :loading="!!reviewing" :disabled="!reviewNote.trim()" @click="reviewAttachment(reuploadTarget, '需重交')">送出要求</Button></template></Modal>
  <Modal :open="!!previewUrl" :title="previewName" @close="closePreview"><img v-if="previewUrl" :src="previewUrl" :alt="previewName" class="attachment-preview" /></Modal>
</template>
<script setup>
import { computed, ref, onMounted, watch, onBeforeUnmount } from 'vue'
import { api, user, privateFile, dateTime } from '../api'
import Tag from '../components/ui/Tag.vue'
import Modal from '../components/ui/Modal.vue'
import DateInput from '../components/ui/DateInput.vue'
import { useAdminStore } from "../store";
import Field from '../components/ui/Field.vue'
import Select from '../components/ui/Select.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import KeyValue from '../components/ui/KeyValue.vue'
import DataTable from '../components/ui/DataTable.vue'
import StampMark from '../components/ui/StampMark.vue'
import RequestFees from '../components/business/RequestFees.vue'
// 把某一步交給客戶提供資料（或改回我們處理）：客戶端會收到通知，並在辦理進度直接上傳
const clientTask = ref(null), clientDocs = ref(''), clientSaving = ref(false), clientError = ref('')
function askClient(task) { clientTask.value = task; clientDocs.value = (task.documents || []).join('\n'); clientError.value = '' }
async function setOwner(task, owner, documents) {
  if (owner === 'client' && !documents.length) { clientError.value = '請至少寫一項需要客戶提供的文件'; return }
  clientSaving.value = true
  try {
    await api(`/tasks/${task.id}`, 'PATCH', { owner, documents })
    clientTask.value = null
    await openRequest(selected.value)
    showSuccess(owner === 'client' ? '已通知客戶提供資料' : '已改由我們處理')
  } catch (cause) { clientError.value = cause.message; showError(cause) } finally { clientSaving.value = false }
}
const {
  view,
  selected,
  customers,
  customerName,
  editRequest,
  saveRequest,
  date,
  updateTask,
  openPlate,
  openPlateFromRequest,
  selectedSources,
  selectedGuidance,
  sources,
  openInspectionForm,
  showError,
  showSuccess,
  refresh,
  openRequest,
} = useAdminStore();
const staff = ref([]), completionOpen = ref(false), completionSaving = ref(false), cancelOpen = ref(false), cancelReason = ref(''), completionError = ref(''), deadlineEntries = ref([])
const requestFees = ref(null)
const allStepsDone = computed(() => Boolean(selected.value?.tasks?.length) && !['已完成', '已取消'].includes(selected.value.status) && selected.value.tasks.every(task => ['已完成', '不適用'].includes(task.status)))
const isSelfCustomer = computed(() => customers.value.find(customer => customer.id === selected.value?.customer_id)?.is_self)
const completionDrivers = ref({ main: '', deputies: ['', ''] }), completionDriverOptions = ref([]), completionDriverRecords = ref([]), completionDriverDates = ref({})
const selectedCompletionDrivers = computed(() => completionDriverRecords.value.filter(driver => [completionDrivers.value.main, ...completionDrivers.value.deputies].includes(driver.id)))
const attachments = ref([]), attachmentLoading = ref(false), attachmentError = ref(''), reviewing = ref(''), openingFile = ref(''), reuploadTarget = ref(null), reviewNote = ref(''), reviewError = ref(''), previewUrl = ref(''), previewName = ref(''), stampPlay = ref(false)
const attachmentColumns = [{ key: 'fileName', title: '檔名' }, { key: 'taskId', title: '步驟', minWidth: 144 }, { key: 'size', title: '大小', align: 'right', minWidth: 80 }, { key: 'createdAt', title: '上傳時間', align: 'right' }, { key: 'status', title: '狀態' }, { key: 'actions', title: '操作' }]
const allConfirmed = computed(() => attachments.value.length > 0 && attachments.value.every(item => item.status === '已確認'))
const attachmentTone = status => ({ '待確認': 'warning', '已確認': 'ok', '需重交': 'danger' })[status] || 'neutral'
const formatSize = size => size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`
const formatTime = value => value ? dateTime(value) : '—'
async function loadAttachments() { if (!selected.value?.id) return; attachmentLoading.value = true; attachmentError.value = ''; try { attachments.value = await api(`/requests/${selected.value.id}/attachments`) } catch (error) { attachments.value = []; attachmentError.value = `未能取得客戶文件：${error.message}` } finally { attachmentLoading.value = false } }
watch(() => selected.value?.id, () => { attachments.value = []; loadAttachments() }, { immediate: true })
async function reviewAttachment(item, status) { if (!item || reviewing.value) return; reviewing.value = item.id; reviewError.value = ''; try { const updated = await api(`/requests/${selected.value.id}/attachments/${item.id}`, 'PATCH', { status, reviewNote: status === '需重交' ? reviewNote.value.trim() : '' }); attachments.value = attachments.value.map(row => row.id === item.id ? updated : row); reuploadTarget.value = null; if (updated.allConfirmed) { stampPlay.value = true; showSuccess('客戶文件已齊') } else showSuccess(status === '已確認' ? '文件已確認收妥' : '已通知客戶重交') } catch (error) { reviewError.value = error.message; showError(error) } finally { reviewing.value = '' } }
async function openAttachment(item) { const tab = item.mime === 'application/pdf' ? window.open('', '_blank') : null; openingFile.value = item.id; try { if (item.mime === 'application/pdf' && !tab) throw new Error('瀏覽器阻擋新分頁，請允許彈出視窗後重試。'); const blob = await privateFile(`/requests/${selected.value.id}/attachments/${item.id}/file`); const fileUrl = URL.createObjectURL(blob); if (tab) { tab.opener = null; tab.location.href = fileUrl; setTimeout(() => URL.revokeObjectURL(fileUrl), 60000) } else if (item.mime.startsWith('image/')) { closePreview(); previewUrl.value = fileUrl; previewName.value = item.fileName } else { URL.revokeObjectURL(fileUrl); throw new Error('此文件格式無法預覽。') } } catch (error) { tab?.close(); showError(error) } finally { openingFile.value = '' } }
function closePreview() { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value); previewUrl.value = ''; previewName.value = '' }
onBeforeUnmount(closePreview)
onMounted(async () => { try { staff.value = user()?.role === 'admin' ? await api('/staff') : [{ id: user()?.id, name: user()?.name, active: true }] } catch (error) { showError(error) } })
const statusOptions = ['待開始', '進行中', '待客戶提供', '已完成', '已取消']
// 標題下和摘要都顯示同一個牌照：內地＋香港／澳門車牌；沒有關聯牌照時用車輛車牌
const headerPlate = computed(() => selected.value?.plateAsset ? [selected.value.plateAsset.mainland_plate, selected.value.plateAsset.local_plate].filter(Boolean).join(' · ') : selected.value?.vehicle?.plate || '')
// 狀態色：待開始灰、進行中藍、待客戶提供橙、已完成綠、已取消灰
const statusBadge = { 新要求: 'gray', 待開始: 'gray', 進行中: 'blue', 待收件: 'blue', 待客戶提供: 'amber', 待客戶配合: 'amber', 已完成: 'success', 已取消: 'gray' }
const stageOptions = computed(() => ['待內部受理', ...(selected.value?.plan?.stages || [])])
const deadlineChoices = computed(() => ({ renewal: [{ code: 'approval', label: '批文卡有效期', ownerType: 'plate' }, { code: selected.value?.route === '粵澳' ? 'mo_permit' : 'hk_crp', label: 'CRP／澳門通行證', ownerType: 'plate' }], inspection: [{ code: 'inspection', label: '驗車到期日', ownerType: 'vehicle' }], filing: [{ code: 'customs_filing', label: '海關及邊檢備案到期日', ownerType: 'plate' }] }))
async function saveProgress() { if (editRequest.value.status === '已完成') { deadlineEntries.value = (deadlineChoices.value[selected.value.service_code] || []).filter(item => item.ownerType === 'vehicle' ? selected.value.vehicle_id : selected.value.plate_asset_id).map(item => ({ ...item, expiresOn: '' })); completionError.value = ''; completionDriverOptions.value = []; completionDriverRecords.value = []; completionDriverDates.value = {}; completionOpen.value = true; if (selected.value.service_code === 'driver_change' && selected.value.plate_asset_id) { try { const [plate, drivers] = await Promise.all([api(`/plates/${selected.value.plate_asset_id}/drivers`), api(`/drivers?customerId=${encodeURIComponent(selected.value.customer_id)}`)]); completionDriverRecords.value = drivers; completionDriverDates.value = Object.fromEntries(drivers.flatMap(driver => driver.documents.map(document => [`${driver.id}:${document.code}`, document.expiresOn || '']))); completionDriverOptions.value = [{ value: '', label: '不登記' }, ...drivers.map(driver => ({ value: driver.id, label: driver.name }))]; completionDrivers.value = { main: plate.drivers.find(driver => driver.role === '主')?.driverId || '', deputies: [...plate.drivers.filter(driver => driver.role === '副').map(driver => driver.driverId), '', ''].slice(0, 2) } } catch (error) { completionError.value = `未能取得司機名單：${error.message}` } } return } if (editRequest.value.status === '已取消') { cancelOpen.value = true; return } await saveRequest() }
async function finish(skipDeadlineUpdate) {
  if (completionSaving.value) return
  completionError.value = ''; completionSaving.value = true
  try {
    const updates = deadlineEntries.value.filter(item => item.expiresOn).map(item => ({ ownerType: item.ownerType, ownerId: item.ownerType === 'vehicle' ? selected.value.vehicle_id : selected.value.plate_asset_id, code: item.code, expiresOn: item.expiresOn }))
    if (!skipDeadlineUpdate) for (const driver of selectedCompletionDrivers.value) for (const document of driver.documents) { const expiresOn = completionDriverDates.value[`${driver.id}:${document.code}`]; if (expiresOn && expiresOn !== (document.expiresOn || '')) updates.push({ ownerType: 'driver', ownerId: driver.id, code: document.code, expiresOn }) }
    if (selected.value.tasks?.some(task => !['已完成', '不適用'].includes(task.status))) throw new Error('仍有辦理步驟未完成或未標記不適用')
    if (!skipDeadlineUpdate && selected.value.service_code === 'driver_change') { const chosen = [completionDrivers.value.main, ...completionDrivers.value.deputies].filter(Boolean); if (new Set(chosen).size !== chosen.length) throw new Error('同一位司機不能重複登記'); if (!completionDriverOptions.value.length) throw new Error('請先載入司機名單'); await api(`/plates/${selected.value.plate_asset_id}/drivers`, 'PUT', { drivers: chosen.map(driverId => ({ driverId, role: driverId === completionDrivers.value.main ? '主' : '副' })) }) }
    const feePayload = requestFees.value?.payload() || {}
    await api(`/requests/${selected.value.id}`, 'PATCH', { status: '已完成', skipDeadlineUpdate, ...(skipDeadlineUpdate ? {} : { deadlineUpdates: updates }), ...feePayload })
    completionOpen.value = false; await refresh(); await openRequest(selected.value); showSuccess('工單已結案')
  } catch (error) { completionError.value = error.message; showError(error) }
  finally { completionSaving.value = false }
}
async function cancelRequest() { try { await api(`/requests/${selected.value.id}`, 'PATCH', { status: '已取消', cancelledReason: cancelReason.value }); cancelOpen.value = false; await refresh(); await openRequest(selected.value); showSuccess('工單已取消') } catch (error) { showError(error) } }
</script>
