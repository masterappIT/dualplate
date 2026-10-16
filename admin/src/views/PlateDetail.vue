<template>
  <template v-if="selectedPlate">
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'plates'">← 返回牌照</button>
      <h1>
        <PlateChip :plate="selectedPlate.mainland_plate" />
        <PlateChip :plate="selectedPlate.local_plate" :route="selectedPlate.route" />
      </h1>
      <p>
        {{ selectedPlate.route }} ·
        {{ customerName(selectedPlate.customer_id) }}
      </p>
    </div>
    <div class="heading-actions">
      <button v-if="isAdmin" class="button" @click="openRental()">＋ 新增合約</button>
      <button class="button primary" @click="startRequest">＋ 開工單</button>
    </div>
  </div>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>批文卡 · 模擬卡預覽</h2>
        <p>
          客戶端同步顯示以下內容 · {{ selectedPlate.card_status || "待核對" }} ·
          {{ selectedPlate.card_updated_by || "尚未更新" }}
        </p>
      </div>
    </div>
    <div class="approval-admin-grid">
      <div>
        <ApprovalCard :key="selectedPlate.id" :data="cardDraft" />
        <p class="preview-note">
          模板按提供的批文卡原件重繪；文字由欄位資料即時生成。上傳後請逐欄核對。
        </p>
      </div>
      <div>
        <div class="form-grid card-form-grid">
          <div v-for="field in cardFields" :key="field.key">
            <label
              >{{ field.label
              }}<span
                v-if="fieldStatusText(cardFieldStatus[field.key])"
                class="card-field-status"
                :class="fieldStatusClass(cardFieldStatus[field.key])"
                >{{ fieldStatusText(cardFieldStatus[field.key]) }}</span
              ></label
            ><input v-model="cardDraft[field.key]" />
          </div>
        </div>
        <button class="button" @click="saveCard">儲存並核對</button>
      </div>
    </div>
    <details class="scan-details">
      <summary>原件掃描與重新上傳（供核對）</summary>
      <div class="card-upload-grid">
        <div v-for="side in ['front', 'back']" :key="side">
          <strong>{{ side === "front" ? "正面" : "背面" }}</strong
          ><img
            v-if="selectedPlate.cardImages?.[side]"
            :src="selectedPlate.cardImages[side]"
            class="card-image"
          />
          <div v-else class="card-placeholder">尚未上傳</div>
          <input
            type="file"
            accept="image/png,image/jpeg"
            @change="uploadCard(side, $event)"
          />
        </div>
      </div>
    </details>
  </section>
  <PlateDrivers ref="plateDrivers" :plate-id="selectedPlate.id" :customer-id="selectedPlate.customer_id" @saved="showSuccess" />
  <ExpiryPanel
    owner-type="plate"
    :owner-id="selectedPlate.id"
    @saved="showSuccess"
    @error="showError"
  />
  <ServiceScope v-if="isAdmin" owner-type="plate" :owner-id="selectedPlate.id" :is-self="!!customers.find(item => item.id === selectedPlate.customer_id)?.is_self" @saved="showSuccess" @error="showError" />
  <CrossingRecords :plate-id="selectedPlate.id" @saved="crossingSaved" @error="showError" />
  <PlateTransfer v-if="isAdmin" :plate="selectedPlate" :customers="customers" :groups="companyGroups" :vehicles="vehicles" @saved="transferSaved" @error="showError" />
  <div class="grid-two">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>牌照使用狀態</h2>
          <p>上牌與出租分開記錄</p>
        </div>
      </div>
      <div class="form-grid">
        <Field label="內地車牌"><TextInput v-model="plateForm.mainlandPlate" /></Field>
        <Field label="港／澳車牌"><TextInput v-model="plateForm.localPlate" /></Field>
        <Field label="上牌狀態"><Select v-model="plateForm.installationStatus" :options="['待核對', '未上牌', '已上牌']" /></Field>
        <Field label="使用狀態"><Select v-model="plateForm.usageStatus" :options="[{ value: '待核對', label: '待核對' }, { value: '自用', label: '自用' }, { value: '出租中', label: '出租中（由合約推算）', disabled: true }, { value: '暫停使用', label: '暫停使用' }]" /></Field>
        <Field label="綁定車輛"><Select v-model="plateForm.vehicleId" :options="vehicleOptions" /></Field>
        <Field label="批文卡號"><TextInput v-model="plateForm.cardNumber" /></Field>
        <Field label="批文卡有效期"><DateInput v-model="plateForm.cardExpiresOn" label="批文卡有效期" /></Field>
      </div>
      <Field label="備註"><TextInput v-model="plateForm.notes" multiline /></Field><button class="button" @click="savePlate">儲存兩地牌</button>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>出租記錄</h2>
          <p>合約與收款記錄，不代表官方轉讓批准</p>
        </div>
      </div>
      <div v-for="r in selectedPlate.rentalContracts" :key="r.id" class="record-row">
        <div>
          <strong>{{ r.renter_name }}</strong
          ><small
            >{{ r.renter_vehicle_plate || "承租車牌待補充" }} ·
            {{ r.starts_on || "開始待補充" }} 至
            {{ r.ends_on || "未定" }} · {{ rentMoney(r.rent_amount, r.currency) }}／期 · {{ r.collection_mode }}</small
          >
        </div>
        <div class="record-right">
          <strong>{{ r.status }}</strong
          ><button class="text-button" @click="openRental(r.id)">查看合約與收款 →</button>
        </div>
      </div>
      <div v-if="!selectedPlate.rentalContracts?.length" class="empty">
        尚無合約，可在頁首新增合約。
      </div>
    </section>
  </div>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>公司組與指標</h2>
        <p>管理指標所屬公司組、類別與口岸。</p>
      </div>
    </div>
    <div v-if="selectedPlate.warnings?.length" class="status-warnings">
      <span
        v-for="warning in selectedPlate.warnings"
        :key="warning"
        class="warning"
        >{{ warning }}</span
      >
    </div>
    <div
      v-if="selectedPlate.companyStatuses?.length"
      class="company-status-list"
    >
      <span v-for="company in selectedPlate.companyStatuses" :key="company.id"
        >{{ company.jurisdiction }} · {{ company.name }}：{{
          company.status
        }}</span
      >
    </div>
    <div class="form-grid">
      <Field label="公司組"><Select v-model="plateForm.groupId" :options="groupOptions" /></Field>
      <Field label="指標類別"><Select v-model="plateForm.indicatorCategory" :options="['未設定', '投資類', '資格類', '人才類', '投資高新企業類', '捐贈類', '其他'].map(value => ({ value: value === '未設定' ? '' : value, label: value }))" /></Field>
      <Field label="口岸"><Select v-model="plateForm.port" :options="['未設定', '深圳灣', '港珠澳大橋', '蓮塘／香園圍', '落馬洲', '皇崗', '文錦渡', '沙頭角', '拱北', '橫琴', '其他'].map(value => ({ value: value === '未設定' ? '' : value, label: value }))" /></Field>
    </div>
    <button class="button" @click="savePlate">儲存指標資料</button>
  </section>
  </template>
  <div v-else class="panel empty" role="status">正在載入牌照資料…</div>
</template>
<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { rentMoney } from '../api'
import { user } from '../api'
import ServiceScope from '../components/ui/ServiceScope.vue'
import CrossingRecords from '../components/ui/CrossingRecords.vue'
import PlateTransfer from '../components/ui/PlateTransfer.vue'
import { useAdminStore } from "../store";
import ApprovalCard from "../components/ApprovalCard.vue";
import ExpiryPanel from "../components/ExpiryPanel.vue";
import PlateChip from '../components/ui/PlateChip.vue';
import Field from '../components/ui/Field.vue';
import TextInput from '../components/ui/TextInput.vue';
import Select from '../components/ui/Select.vue';
import DateInput from '../components/ui/DateInput.vue';
import PlateDrivers from '../components/business/PlateDrivers.vue'
const {
  selectedPlate,
  view,
  modal,
  customerName,
  plateForm,
  vehicles,
  customers,
  companyGroups,
  refresh,
  savePlate,
  plateGroups,
  cardDraft,
  cardFields,
  saveCard,
  fieldStatusText,
  cardFieldStatus,
  fieldStatusClass,
  uploadCard,
  showSuccess,
  showError,
  newRequest,
} = useAdminStore();
const rentalRouter = useRouter()
function openRental(contractId) { rentalRouter.push({ path: '/rentals', query: contractId ? { contractId } : { plateId: selectedPlate.value.id, new: '1' } }) }
const isAdmin = user()?.role === 'admin'
// 為這個牌照開工單：帶入客戶、牌照與路線
// 改客戶或路線會清空已選牌照，所以等清空跑完再帶入牌照
function startRequest() { const plate = selectedPlate.value; newRequest.value.customerId = plate.customer_id; newRequest.value.route = plate.route || newRequest.value.route; nextTick(() => { newRequest.value.plateAssetId = plate.id; newRequest.value.vehicleId = plate.vehicle_id || '' }); view.value = 'new-request' }
const plateDrivers = ref(null)
watch(() => selectedPlate.value?.cardData, (current, previous) => { if (current && previous && current !== previous) plateDrivers.value?.load() })
async function crossingSaved(message) { showSuccess(message); await refresh() }
async function transferSaved(message) { showSuccess(message); await refresh(); view.value = 'plates' }
const vehicleOptions = computed(() => [{ value: '', label: '未綁定' }, ...vehicles.value.filter(vehicle => vehicle.customer_id === selectedPlate.value?.customer_id && vehicle.route === selectedPlate.value?.route).map(vehicle => ({ value: vehicle.id, label: `${vehicle.plate} · ${vehicle.brand || ''} ${vehicle.model || ''}` }))]);
const groupOptions = computed(() => [{ value: '', label: '未分組' }, ...plateGroups.value.map(group => ({ value: group.id, label: group.name }))]);
</script>
