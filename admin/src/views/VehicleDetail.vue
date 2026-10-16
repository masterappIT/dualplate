<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'plates'">← 返回牌照</button>
      <h1><PlateChip :plate="selectedVehicle.plate" :route="selectedVehicle.route" /></h1>
      <p>
        {{ selectedVehicle.route }} · {{ selectedVehicle.origin }} ·
        {{ selectedVehicle.type }} ·
        {{ customerName(selectedVehicle.customer_id) }}
      </p>
    </div>
    <div class="heading-actions">
      <button class="button outline" @click="modal = 'inspection'">
        ＋ 驗車</button
      >
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
      <Field label="港澳首次註冊日期"><DateInput v-model="vehicleForm.firstRegisteredOn" label="港澳首次註冊日期" /></Field>
      <Field label="來源地"><Select v-model="vehicleForm.origin" :options="['香港', '澳門', '內地']" /></Field>
      <Field label="車牌" required><TextInput v-model="vehicleForm.plate" /></Field>
      <Field label="廠牌"><TextInput v-model="vehicleForm.brand" /></Field>
      <Field label="型號"><TextInput v-model="vehicleForm.model" /></Field>
      <Field label="車架號"><TextInput v-model="vehicleForm.vin" /></Field>
      <Field label="製造年份"><TextInput v-model="vehicleForm.manufacturedYear" type="number" /></Field>
      <Field label="備註"><TextInput v-model="vehicleForm.notes" /></Field>
    </div>
    <button class="button primary" @click="saveVehicle">儲存車輛</button>
  </section>
  <ExpiryPanel
    owner-type="vehicle"
    :owner-id="selectedVehicle.id"
    @saved="showSuccess"
    @error="showError"
  />
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
</template>
<script setup>
import { useAdminStore } from "../store";
import ExpiryPanel from "../components/ExpiryPanel.vue";
import PlateChip from '../components/ui/PlateChip.vue';
import Field from '../components/ui/Field.vue';
import DateInput from '../components/ui/DateInput.vue';
import Select from '../components/ui/Select.vue';
import TextInput from '../components/ui/TextInput.vue';
const {
  view,
  selectedVehicle,
  customerName,
  modal,
  vehicleForm,
  saveVehicle,
  showSuccess,
  showError,
  updateInspection,
  sources,
  openInspectionForm,
} = useAdminStore();
</script>
