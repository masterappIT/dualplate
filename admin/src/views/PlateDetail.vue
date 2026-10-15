<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'plates'">← 返回牌照</button>
      <div class="eyebrow">PLATE RECORD</div>
      <h1>
        {{ selectedPlate.mainland_plate || "內地號牌待補充" }} ·
        {{ selectedPlate.local_plate || "港／澳號牌待補充" }}
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
        <div>
          <label>內地車牌</label><input v-model="plateForm.mainlandPlate" />
        </div>
        <div>
          <label>港／澳車牌</label><input v-model="plateForm.localPlate" />
        </div>
        <div>
          <label>上牌狀態</label
          ><select v-model="plateForm.installationStatus">
            <option>待核對</option>
            <option>未上牌</option>
            <option>已上牌</option>
          </select>
        </div>
        <div>
          <label>使用狀態</label
          ><select v-model="plateForm.usageStatus">
            <option>待核對</option>
            <option>自用</option>
            <option disabled>出租中（由出租記錄更新）</option>
            <option>暫停使用</option>
          </select>
        </div>
        <div>
          <label>綁定車輛</label
          ><select v-model="plateForm.vehicleId">
            <option value="">未綁定</option>
            <option
              v-for="v in vehicles.filter(
                (v) =>
                  v.customer_id === selectedPlate.customer_id &&
                  v.route === selectedPlate.route,
              )"
              :key="v.id"
              :value="v.id"
            >
              {{ v.plate }} · {{ v.brand }} {{ v.model }}
            </option>
          </select>
        </div>
        <div>
          <label>批文卡號</label><input v-model="plateForm.cardNumber" />
        </div>
        <div>
          <label>批文卡有效期</label
          ><input v-model="plateForm.cardExpiresOn" type="date" />
        </div>
      </div>
      <label>備註</label><textarea v-model="plateForm.notes"></textarea
      ><button class="button primary" @click="savePlate">儲存兩地牌</button>
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
      <label
        >公司組<select v-model="plateForm.groupId">
          <option value="">未分組</option>
          <option
            v-for="group in plateGroups"
            :key="group.id"
            :value="group.id"
          >
            {{ group.name }}
          </option>
        </select></label
      ><label
        >指標類別<select v-model="plateForm.indicatorCategory">
          <option value="">未設定</option>
          <option
            v-for="category in [
              '投資類',
              '資格類',
              '人才類',
              '投資高新企業類',
              '捐贈類',
              '其他',
            ]"
            :key="category"
          >
            {{ category }}
          </option>
        </select></label
      ><label
        >口岸<select v-model="plateForm.port">
          <option value="">未設定</option>
          <option
            v-for="port in [
              '深圳灣',
              '港珠澳大橋',
              '蓮塘／香園圍',
              '落馬洲',
              '皇崗',
              '文錦渡',
              '沙頭角',
              '拱北',
              '橫琴',
              '其他',
            ]"
            :key="port"
          >
            {{ port }}
          </option>
        </select></label
      >
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
import { useAdminStore } from "../store";
import ApprovalCard from "../components/ApprovalCard.vue";
import ExpiryPanel from "../components/ExpiryPanel.vue";
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
</script>
<style scoped>
.approval-admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr);
  gap: 28px;
  align-items: start;
}
.card-form-grid {
  max-height: 800px;
  overflow: auto;
  margin-bottom: 18px;
}
.card-field-status {
  display: inline-block;
  margin-left: 8px;
  color: #9a6500;
  font-size: 12px;
  font-weight: 650;
}
.card-field-status.failed {
  color: #9a3f00;
}
.preview-note {
  font-size: 12px;
  color: #66778a;
  margin: 12px 0;
}
.scan-details {
  border-top: 1px solid #dce3ea;
  margin-top: 26px;
  padding-top: 18px;
}
.scan-details summary {
  cursor: pointer;
  font-weight: 650;
  margin-bottom: 16px;
}
@media (max-width: 1100px) {
  .approval-admin-grid {
    grid-template-columns: 1fr;
  }
}
</style>
