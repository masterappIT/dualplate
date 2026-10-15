<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'vehicles'">← 返回車輛</button>
      <div class="eyebrow">VEHICLE PROFILE</div>
      <h1>{{ selectedVehicle.plate }}</h1>
      <p>
        {{ selectedVehicle.route }} · {{ selectedVehicle.origin }} ·
        {{ selectedVehicle.type }} ·
        {{ customerName(selectedVehicle.customer_id) }}
      </p>
    </div>
    <div class="heading-actions">
      <button class="button outline" @click="modal = 'inspection'">
        ＋ 驗車</button
      ><button class="button primary" @click="modal = 'credential'">
        ＋ 新增牌證
      </button>
    </div>
  </div>
  <section class="panel vehicle-data-panel">
    <div class="panel-head">
      <div>
        <h2>車輛資料</h2>
        <p>維護驗車推算所需的港澳首次註冊日期。</p>
      </div>
    </div>
    <div class="form-grid">
      <label
        >港澳首次註冊日期<input
          v-model="vehicleForm.firstRegisteredOn"
          type="date" /></label
      ><label
        >來源地<select v-model="vehicleForm.origin">
          <option v-for="area in ['香港', '澳門', '內地']" :key="area">
            {{ area }}
          </option>
        </select></label
      ><label>車牌<input v-model="vehicleForm.plate" /></label
      ><label>廠牌<input v-model="vehicleForm.brand" /></label
      ><label>型號<input v-model="vehicleForm.model" /></label
      ><label>車架號<input v-model="vehicleForm.vin" /></label
      ><label
        >製造年份<input
          v-model.number="vehicleForm.manufacturedYear"
          type="number" /></label
      ><label>備註<input v-model="vehicleForm.notes" /></label>
    </div>
    <button class="button primary" @click="saveVehicle">儲存車輛</button>
  </section>
  <ExpiryPanel
    owner-type="vehicle"
    :owner-id="selectedVehicle.id"
    @saved="showSuccess"
    @error="showError"
  />
  <div class="grid-two">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>牌證台帳</h2>
          <p>每張證件獨立記錄有效期</p>
        </div>
      </div>
      <div
        v-for="c in selectedVehicle.credentials"
        :key="c.id"
        class="record-row"
      >
        <div>
          <strong>{{ c.name }}</strong
          ><small
            >{{ c.issuer || "待核對簽發機關" }} ·
            {{ c.number || "未填號碼" }}</small
          >
        </div>
        <div class="record-right">
          <strong>{{ c.expires_on || "待核對" }}</strong
          ><select
            :value="c.status"
            @change="updateCredential(c, $event.target.value)"
          >
            <option>待核對</option>
            <option>已核對</option>
            <option>待續期</option>
            <option>已失效</option>
          </select>
        </div>
      </div>
      <div v-if="!selectedVehicle.credentials?.length" class="empty">
        尚無牌證紀錄
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>驗車與官方核對</h2>
          <p>不適用的要求由專員確認</p>
        </div>
      </div>
      <div
        v-for="i in selectedVehicle.inspections"
        :key="i.id"
        class="record-row"
      >
        <div>
          <strong>{{ i.title }}</strong
          ><small
            >預約：{{ i.appointment_on || "待安排" }} · 來源：{{
              i.source_id || "待核對"
            }}</small
          >
        </div>
        <select
          :value="i.status"
          @change="updateInspection(i, $event.target.value)"
        >
          <option>待預約</option>
          <option>已預約</option>
          <option>檢驗中</option>
          <option>合格</option>
          <option>不合格</option>
          <option>不適用</option>
        </select>
      </div>
      <div v-if="!selectedVehicle.inspections?.length" class="empty">
        尚無驗車任務
      </div>
      <div
        v-for="g in selectedVehicle.inspectionGuidance"
        :key="g.label"
        class="guidance"
      >
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
    </section>
  </div>
</template>
<script setup>
import { useAdminStore } from "../store";
import ExpiryPanel from "../components/ExpiryPanel.vue";
const {
  view,
  selectedVehicle,
  customerName,
  modal,
  vehicleForm,
  saveVehicle,
  showSuccess,
  showError,
  updateCredential,
  updateInspection,
  sources,
  openInspectionForm,
} = useAdminStore();
</script>
