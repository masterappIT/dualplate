<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'plates'">← 返回牌照</button>
      <h1>
        <PlateChip :plate="selectedPlate.mainland_plate" /> ·
        <PlateChip :plate="selectedPlate.local_plate" :route="selectedPlate.route" />
      </h1>
      <p>
        {{ selectedPlate.route }} ·
        {{ customerName(selectedPlate.customer_id) }}
      </p>
    </div>
    <button class="button primary" @click="modal = 'rental'">
      ＋ 登記出租
    </button>
  </div>
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
        <Field label="使用狀態"><Select v-model="plateForm.usageStatus" :options="[{ value: '待核對', label: '待核對' }, { value: '自用', label: '自用' }, { value: '出租中', label: '出租中（由出租記錄更新）', disabled: true }, { value: '暫停使用', label: '暫停使用' }]" /></Field>
        <Field label="綁定車輛"><Select v-model="plateForm.vehicleId" :options="vehicleOptions" /></Field>
        <Field label="批文卡號"><TextInput v-model="plateForm.cardNumber" /></Field>
        <Field label="批文卡有效期"><DateInput v-model="plateForm.cardExpiresOn" label="批文卡有效期" /></Field>
      </div>
      <Field label="備註"><TextInput v-model="plateForm.notes" multiline /></Field><button class="button primary" @click="savePlate">儲存兩地牌</button>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>出租記錄</h2>
          <p>內部業務記錄，不代表官方轉讓批准</p>
        </div>
      </div>
      <div v-for="r in selectedPlate.rentals" :key="r.id" class="record-row">
        <div>
          <strong>{{ r.renter_name }}</strong
          ><small
            >{{ r.renter_vehicle_plate || "承租車牌待補充" }} ·
            {{ r.starts_on || "開始待補充" }} 至
            {{ r.ends_on || "未定" }}</small
          >
        </div>
        <div class="record-right">
          <strong>{{ r.status }}</strong
          ><button
            v-if="r.status === '出租中'"
            class="text-button"
            @click="endRental(r)"
          >
            結束出租
          </button>
        </div>
      </div>
      <div v-if="!selectedPlate.rentals?.length" class="empty">
        尚無出租記錄
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
    <button class="button primary" @click="savePlate">儲存指標資料</button>
  </section>
  <ExpiryPanel
    owner-type="plate"
    :owner-id="selectedPlate.id"
    @saved="showSuccess"
    @error="showError"
  />
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>實體車牌照片</h2>
        <p>上傳實拍原圖後，客戶端可一比一查看；未上傳時只顯示號碼示意</p>
      </div>
    </div>
    <div class="card-upload-grid">
      <div v-for="kind in ['mainland', 'local']" :key="kind">
        <strong>{{
          kind === "mainland" ? "內地號牌" : "香港／澳門號牌"
        }}</strong
        ><img
          v-if="selectedPlate.platePhotos?.[kind]"
          :src="selectedPlate.platePhotos[kind]"
          class="card-image"
        />
        <div v-else class="card-placeholder">尚未上傳</div>
        <input
          type="file"
          accept="image/png,image/jpeg"
          @change="uploadPlatePhoto(kind, $event)"
        />
      </div>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>批文卡 · 模擬卡預覽</h2>
        <p>
          客戶端同步顯示以下內容 · {{ selectedPlate.card_status || "待核對" }} ·
          {{ selectedPlate.card_updated_by || "尚未更新" }}
        </p>
      </div>
      <button class="button primary" @click="saveCard">儲存並核對</button>
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
        <button class="button primary" @click="saveCard">儲存並核對</button>
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
</template>
<script setup>
import { computed } from 'vue'
import { useAdminStore } from "../store";
import ApprovalCard from "../components/ApprovalCard.vue";
import ExpiryPanel from "../components/ExpiryPanel.vue";
import PlateChip from '../components/ui/PlateChip.vue';
import Field from '../components/ui/Field.vue';
import TextInput from '../components/ui/TextInput.vue';
import Select from '../components/ui/Select.vue';
import DateInput from '../components/ui/DateInput.vue';
const {
  selectedPlate,
  view,
  modal,
  customerName,
  plateForm,
  vehicles,
  savePlate,
  plateGroups,
  uploadPlatePhoto,
  cardDraft,
  cardFields,
  saveCard,
  fieldStatusText,
  cardFieldStatus,
  fieldStatusClass,
  uploadCard,
  endRental,
  showSuccess,
  showError,
} = useAdminStore();
const vehicleOptions = computed(() => [{ value: '', label: '未綁定' }, ...vehicles.value.filter(vehicle => vehicle.customer_id === selectedPlate.value?.customer_id && vehicle.route === selectedPlate.value?.route).map(vehicle => ({ value: vehicle.id, label: `${vehicle.plate} · ${vehicle.brand || ''} ${vehicle.model || ''}` }))]);
const groupOptions = computed(() => [{ value: '', label: '未分組' }, ...plateGroups.value.map(group => ({ value: group.id, label: group.name }))]);
</script>
