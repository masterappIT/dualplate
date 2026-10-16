<script setup>
import { computed } from 'vue'
import { useAdminStore } from '../store'
import PageHeader from '../components/ui/PageHeader.vue'
import Panel from '../components/ui/Panel.vue'
import Field from '../components/ui/Field.vue'
import Select from '../components/ui/Select.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'

const { view, customers, services, newRequest, vehicles, plates, createRequest } = useAdminStore()
const customerOptions = computed(() => customers.value.map(customer => ({ value: customer.id, label: customer.name })))
const serviceOptions = computed(() => services.value.filter(service => service.routes.includes(newRequest.value.route)).map(service => ({ value: service.code, label: service.name })))
const vehicleOptions = computed(() => [
  { value: '', label: '新申請／不指定' },
  ...vehicles.value.filter(vehicle => vehicle.customer_id === newRequest.value.customerId && vehicle.route === newRequest.value.route).map(vehicle => ({ value: vehicle.id, label: vehicle.plate })),
])
const plateOptions = computed(() => [
  { value: '', label: '不指定兩地牌' },
  ...plates.value.filter(plate => plate.customer_id === newRequest.value.customerId && plate.route === newRequest.value.route && plate.card_number).map(plate => ({ value: plate.id, label: `${plate.card_number} · ${plate.mainland_plate || plate.local_plate || plate.route}` })),
])
</script>
<template>
  <div class="page">
    <button class="back" @click="view = 'business'">← 返回業務</button>
    <PageHeader title="建立代辦工單" desc="客戶也可在小程序或 App 端自行提交要求。" />
    <Panel title="工單資料" meta="請先選擇客戶與服務，再填寫需求。">
      <form class="request-form" @submit.prevent="createRequest">
        <div class="form-grid">
          <Field label="客戶" required><Select v-model="newRequest.customerId" :options="customerOptions" placeholder="請選擇客戶" /></Field>
          <Field label="服務路線" required><Select v-model="newRequest.route" :options="[{ value: '粵港', label: '粵港' }, { value: '粵澳', label: '粵澳' }]" /></Field>
          <Field label="服務類型" required><Select v-model="newRequest.serviceCode" :options="serviceOptions" /></Field>
          <Field label="相關車輛"><Select v-model="newRequest.vehicleId" :options="vehicleOptions" /></Field>
          <Field v-if="newRequest.serviceCode !== 'new_application'" label="相關兩地牌檔案"><Select v-model="newRequest.plateAssetId" :options="plateOptions" /></Field>
          <Field label="工單標題" required><TextInput v-model="newRequest.title" placeholder="例如：粵港車牌新申請" /></Field>
        </div>
        <Field label="需求說明"><TextInput v-model="newRequest.description" multiline placeholder="記錄客戶需求和目前已有的資料" /></Field>
        <div class="form-actions"><Button @click="view = 'business'">取消</Button><Button variant="primary" type="submit">建立工單</Button></div>
      </form>
    </Panel>
  </div>
</template>
