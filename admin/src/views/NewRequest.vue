<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { api, user } from '../api'
import { useAdminStore } from '../store'
import PageHeader from '../components/ui/PageHeader.vue'
import Panel from '../components/ui/Panel.vue'
import Field from '../components/ui/Field.vue'
import Select from '../components/ui/Select.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'
import DateInput from '../components/ui/DateInput.vue'

const { view, customers, services, newRequest, vehicles, plates, createRequest } = useAdminStore()
const customerOptions = computed(() => customers.value.map(customer => ({ value: customer.id, label: customer.name })))
const serviceOptions = computed(() => [...services.value.filter(service => service.routes.includes(newRequest.value.route)).map(service => ({ value: service.code, label: service.name })), ...(templates.value.some(item => item.active && item.route === newRequest.value.route && item.service_code === 'custom') ? [{ value: 'custom', label: '自訂業務' }] : [])])
const vehicleOptions = computed(() => [
  { value: '', label: '新申請／不指定' },
  ...vehicles.value.filter(vehicle => vehicle.customer_id === newRequest.value.customerId && vehicle.route === newRequest.value.route).map(vehicle => ({ value: vehicle.id, label: vehicle.plate })),
])
const plateOptions = computed(() => [
  { value: '', label: '不指定兩地牌' },
  ...plates.value.filter(plate => plate.customer_id === newRequest.value.customerId && plate.route === newRequest.value.route && plate.card_number).map(plate => ({ value: plate.id, label: `${plate.card_number} · ${plate.mainland_plate || plate.local_plate || plate.route}` })),
])
const templates = ref([]), staff = ref([]), problem = ref('')
// 工單標題按所選服務自動帶出；員工改過標題就不再覆蓋
let autoTitle = ''
watch(() => newRequest.value.serviceCode, code => { const name = services.value.find(service => service.code === code)?.name || ''; if (!newRequest.value.title || newRequest.value.title === autoTitle) { newRequest.value.title = name; autoTitle = name } }, { immediate: true })
const templateOptions = computed(() => templates.value.filter(item => item.active && item.route === newRequest.value.route && item.service_code === newRequest.value.serviceCode).map(item => ({ value: item.id, label: item.name })))
const staffOptions = computed(() => staff.value.filter(item => item.active).map(item => ({ value: item.id, label: item.name })))
async function loadOptions() { try { templates.value = await api('/work-templates'); if (user()?.role === 'admin') staff.value = await api('/staff'); else staff.value = [{ id: user()?.id, name: user()?.name, active: true }]; newRequest.value.assigneeId ||= user()?.id } catch (error) { problem.value = error.message } }
onMounted(loadOptions)
watch(() => [newRequest.value.serviceCode, newRequest.value.route], () => { const match = templates.value.find(item => item.active && item.service_code === newRequest.value.serviceCode && item.route === newRequest.value.route); newRequest.value.templateId = match?.id || ''; const days = match?.steps.reduce((total, step) => total + (Number(step.days) || 0), 0) || 0; const date = new Date(); date.setDate(date.getDate() + days); newRequest.value.dueOn = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) }, { immediate: true })
watch(templates, () => { if (!newRequest.value.templateId) { const match = templates.value.find(item => item.active && item.service_code === newRequest.value.serviceCode && item.route === newRequest.value.route); newRequest.value.templateId = match?.id || '' } })
watch(() => newRequest.value.templateId, id => { const match = templates.value.find(item => item.id === id); if (!match) return; const days = match.steps.reduce((total, step) => total + (Number(step.days) || 0), 0); const date = new Date(); date.setDate(date.getDate() + days); newRequest.value.dueOn = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) })
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
          <Field label="業務範本" required><Select v-model="newRequest.templateId" :options="templateOptions" /></Field>
          <Field label="負責人"><Select v-model="newRequest.assigneeId" :options="staffOptions" /></Field>
          <Field label="截止日"><DateInput v-model="newRequest.dueOn" label="工單截止日" /></Field>
          <Field label="相關車輛"><Select v-model="newRequest.vehicleId" :options="vehicleOptions" /></Field>
          <Field v-if="newRequest.serviceCode !== 'new_application'" label="相關兩地牌檔案"><Select v-model="newRequest.plateAssetId" :options="plateOptions" /></Field>
          <Field label="工單標題" required><TextInput v-model="newRequest.title" placeholder="例如：粵港車牌新申請" /></Field>
        </div>
        <Field label="需求說明"><TextInput v-model="newRequest.description" multiline placeholder="記錄客戶需求和目前已有的資料" /></Field>
        <p v-if="problem" role="alert">{{ problem }}</p>
        <div class="form-actions"><Button @click="view = 'business'">取消</Button><Button variant="primary" type="submit">建立工單</Button></div>
      </form>
    </Panel>
  </div>
</template>
