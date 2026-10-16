<template>
  <template v-if="selected">
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'business'">← 返回業務</button>
      <h1>{{ selected.title }}</h1>
      <p>
        {{ selected.route }} · {{ customerName(selected.customer_id) }} ·
        <PlateChip v-if="selected.vehicle?.plate" :plate="selected.vehicle.plate" :route="selected.route" /><span v-else>未指定車輛</span>
      </p>
    </div>
    <span
      class="badge large"
      :class="selected.status === '新要求' ? 'amber' : ''"
      >{{ selected.status }}</span
    >
  </div>
  <div class="detail-grid">
    <div>
      <section class="panel guilloche-panel"><div class="panel-head"><div><h2>工單摘要</h2><p>核對客戶、牌照、負責人與截止日。</p></div></div><KeyValue :items="[{ label: '客戶', value: customerName(selected.customer_id) }, { label: '路線', value: selected.route }, { label: '車牌', value: selected.plateAsset?.mainland_plate || selected.vehicle?.plate || '未指定' }, { label: '業務', value: selected.title }, { label: '負責人', value: staff.find(item => item.id === selected.assignee_id)?.name || '未指派' }, { label: '截止日', value: selected.due_on || '未設定' }, { label: '狀態', value: selected.status }]" /></section>
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
        <div v-for="task in selected.tasks" :key="task.id" class="task-row step-spine" :class="{ 'step-finished': ['已完成', '不適用'].includes(task.status), 'step-current': task.id === selected.tasks.find(item => !['已完成', '不適用'].includes(item.status))?.id }">
          <span
            class="task-number"
            :class="task.status === '已完成' ? 'done' : ''"
            >{{ task.status === "已完成" ? "✓" : "○" }}</span
          >
          <div class="task-main">
            <strong>{{ task.title }}</strong><Tag v-if="task.owner === 'client'" tone="info">客戶提供</Tag><small v-if="task.documents?.length">所需文件：{{ task.documents.join('、') }}</small
            ><small
              >{{ task.jurisdiction }} ·
              {{ task.source_id || "待確認官方來源" }}</small
            >
          </div>
          <select
            :value="task.status"
            @change="updateTask(task, $event.target.value)"
          >
            <option>待辦</option>
            <option>辦理中</option>
            <option>已完成</option>
            <option>不適用</option>
          </select>
        </div>
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
  <Modal :open="completionOpen" title="更新到期日" sub="結案前可更新相關證件或備案到期日；也可略過。" @close="completionOpen = false"><p v-if="selected?.service_code === 'vehicle_change'">換車後請到牌照詳情核對並更新批文卡。</p><div v-for="entry in deadlineEntries" :key="entry.code" class="record-row"><Field :label="entry.label"><DateInput v-model="entry.expiresOn" :label="entry.label" /></Field></div><p v-if="completionError" role="alert">{{ completionError }}</p><template #footer><Button @click="completionOpen = false">返回</Button><Button @click="finish(true)">略過更新並結案</Button><Button variant="primary" :disabled="!deadlineEntries.some(item => item.expiresOn)" @click="finish(false)">更新並結案</Button></template></Modal>
  <Modal :open="cancelOpen" title="取消工單" @close="cancelOpen = false"><Field label="取消原因" required><TextInput v-model="cancelReason" multiline /></Field><template #footer><Button @click="cancelOpen = false">返回</Button><Button variant="primary" :disabled="!cancelReason.trim()" @click="cancelRequest">確認取消</Button></template></Modal>
</template>
<script setup>
import { computed, ref, onMounted } from 'vue'
import { api, user } from '../api'
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
const {
  view,
  selected,
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
const staff = ref([]), completionOpen = ref(false), cancelOpen = ref(false), cancelReason = ref(''), completionError = ref(''), deadlineEntries = ref([])
onMounted(async () => { try { staff.value = user()?.role === 'admin' ? await api('/staff') : [{ id: user()?.id, name: user()?.name, active: true }] } catch (error) { showError(error) } })
const statusOptions = ['待開始', '進行中', '待客戶提供', '已完成', '已取消']
const stageOptions = computed(() => ['待內部受理', ...(selected.value?.plan?.stages || [])])
const deadlineChoices = computed(() => ({ renewal: [{ code: 'approval', label: '批文卡有效期', ownerType: 'plate' }, { code: selected.value?.route === '粵澳' ? 'mo_permit' : 'hk_crp', label: 'CRP／澳門通行證', ownerType: 'plate' }], inspection: [{ code: 'inspection', label: '驗車到期日', ownerType: 'vehicle' }], filing: [{ code: 'customs_filing', label: '海關及邊檢備案到期日', ownerType: 'plate' }] }))
async function saveProgress() { if (editRequest.value.status === '已完成') { deadlineEntries.value = (deadlineChoices.value[selected.value.service_code] || []).filter(item => item.ownerType === 'vehicle' ? selected.value.vehicle_id : selected.value.plate_asset_id).map(item => ({ ...item, expiresOn: '' })); completionOpen.value = true; return } if (editRequest.value.status === '已取消') { cancelOpen.value = true; return } await saveRequest() }
async function finish(skipDeadlineUpdate) { completionError.value = ''; const updates = deadlineEntries.value.filter(item => item.expiresOn).map(item => ({ ownerType: item.ownerType, ownerId: item.ownerType === 'vehicle' ? selected.value.vehicle_id : selected.value.plate_asset_id, code: item.code, expiresOn: item.expiresOn })); try { await api(`/requests/${selected.value.id}`, 'PATCH', { status: '已完成', skipDeadlineUpdate, ...(skipDeadlineUpdate ? {} : { deadlineUpdates: updates }) }); completionOpen.value = false; await refresh(); await openRequest(selected.value); showSuccess('工單已結案') } catch (error) { completionError.value = error.message; showError(error) } }
async function cancelRequest() { try { await api(`/requests/${selected.value.id}`, 'PATCH', { status: '已取消', cancelledReason: cancelReason.value }); cancelOpen.value = false; await refresh(); await openRequest(selected.value); showSuccess('工單已取消') } catch (error) { showError(error) } }
</script>
