<script setup>
import { computed, ref } from 'vue'
import { useAdminStore } from '../store'
import FormDialog from './business/FormDialog.vue'
import Field from './ui/Field.vue'
import TextInput from './ui/TextInput.vue'
import Select from './ui/Select.vue'
import DateInput from './ui/DateInput.vue'
import Modal from './ui/Modal.vue'
import Button from './ui/Button.vue'

const { modal, form, modalTitle, error, customers, selectedCustomer, selectedPlate, selectedVehicle, sources, createCustomer, createCustomerUser, createVehicle, createPlate, createRental, createInspection } = useAdminStore()
const customerOptions = computed(() => [{ value: '', label: '請選擇客戶' }, ...customers.value.map(customer => ({ value: customer.id, label: customer.name }))])
const sourceOptions = computed(() => [{ value: '', label: '待核對' }, ...sources.value.map(source => ({ value: source.id, label: `${source.id} · ${source.title}` }))])
const routeOptions = [{ value: '粵港', label: '粵港' }, { value: '粵澳', label: '粵澳' }]
const originOptions = ['香港', '內地', '澳門']
const submitText = computed(() => ({ customer: '新增客戶', 'customer-user': '開通登入', vehicle: '登記車輛', plate: '登記現有批文卡', rental: '儲存出租記錄', inspection: '建立驗車任務' })[modal.value] || '儲存')
const welcome = ref('')
const copyError = ref('')
const formError = ref('')
const creating = ref(false)
async function submit() {
  const actions = { customer: createCustomer, 'customer-user': createCustomerUser, vehicle: createVehicle, plate: createPlate, rental: createRental, inspection: createInspection }
  if (modal.value === 'customer-user') {
    if (creating.value) return
    const name = String(form.value.name || '').trim(), email = String(form.value.email || '').trim(), phone = String(form.value.phone || '').trim(), password = String(form.value.password || '')
    formError.value = !name ? '請填寫顯示名稱。' : !email && !phone ? '請填寫電郵或手機號碼。' : email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '請填寫有效的電郵地址。' : phone && !/^\+?\d{8,15}$/.test(phone.replace(/[\s-]/g, '')) ? '請填寫 8 至 15 位的手機號碼。' : password.length < 12 ? '初始密碼至少 12 字元。' : ''
    if (formError.value) return
    creating.value = true
    try {
      const created = await createCustomerUser()
      if (created) {
        const entry = import.meta.env.VITE_CLIENT_LOGIN_URL || '微信小程序「跨境車牌管家」'
        welcome.value = `您好，${created.name}：\n已為您開通「跨境車牌管家」客戶登入。\n登入入口：${entry}\n帳號：${created.email || created.phone}\n初始密碼：${created.password}\n首次登入請開啟入口，輸入帳號及初始密碼，即可查看工單進度和待辦事項。請妥善保管密碼。`
      }
    } finally {
      creating.value = false
    }
  } else actions[modal.value]?.()
}
async function copyWelcome() { try { await navigator.clipboard.writeText(welcome.value); copyError.value = '' } catch { copyError.value = '未能複製，請選取文字手動複製。' } }
</script>
<template>
  <FormDialog :open="!!modal" :title="modalTitle" layout="stack" :saving="creating" :submit-text="submitText" @close="modal = null" @submit="submit">
    <template v-if="modal === 'customer'">
      <Field label="客戶名稱" required><TextInput v-model="form.name" placeholder="姓名或公司名稱" /></Field>
      <Field label="類型"><Select v-model="form.kind" :options="['個人', '公司']" /></Field>
      <Field label="聯絡電話"><TextInput v-model="form.phone" type="tel" /></Field>
    </template>
    <template v-else-if="modal === 'customer-user'">
      <p class="dialog-note">為 {{ selectedCustomer?.name }} 開通客戶端登入。密碼最少 12 字元。</p>
      <Field label="顯示名稱" required><TextInput v-model="form.name" /></Field>
      <p class="dialog-note">電郵或手機號碼至少填一項。</p>
      <Field label="電郵"><TextInput v-model="form.email" type="email" /></Field>
      <Field label="手機號碼"><TextInput v-model="form.phone" type="tel" placeholder="例如 +85291234567" /></Field>
      <Field label="初始密碼" required><TextInput v-model="form.password" type="password" /></Field>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    </template>
    <template v-else-if="modal === 'vehicle'">
      <Field label="客戶" required><Select v-model="form.customerId" :options="customerOptions" /></Field>
      <div class="form-grid"><Field label="路線" required><Select v-model="form.route" :options="routeOptions" /></Field><Field label="車輛來源地"><Select v-model="form.origin" :options="originOptions" /></Field></div>
      <div class="form-grid"><Field label="車牌號碼" required><TextInput v-model="form.plate" /></Field><Field label="車輛類型"><TextInput v-model="form.type" placeholder="私家車" /></Field></div>
      <div class="form-grid"><Field label="品牌"><TextInput v-model="form.brand" /></Field><Field label="型號"><TextInput v-model="form.model" /></Field></div>
      <Field label="製造年份"><TextInput v-model="form.manufacturedYear" type="number" /></Field>
    </template>
    <template v-else-if="modal === 'plate'">
      <p class="dialog-note">{{ form.sourceRequestId ? '由新申請工單建立；建檔後將自動關聯至工單。' : '已有正式批文卡才在這裡建檔。新申請請先建立代辦工單。' }}</p>
      <Field label="客戶" required><Select v-model="form.customerId" :options="customerOptions" /></Field>
      <Field label="路線" required><Select v-model="form.route" :options="routeOptions" /></Field>
      <Field label="批文卡編號" required><TextInput v-model="form.cardNumber" placeholder="按現有批文卡填寫" /></Field>
      <Field label="商號"><TextInput v-model="form.company" /></Field>
      <Field label="內承單位"><TextInput v-model="form.contractor" /></Field>
      <Field label="通行口岸"><TextInput v-model="form.crossing" /></Field>
      <div class="form-grid"><Field label="內地號牌"><TextInput v-model="form.mainlandPlate" placeholder="可稍後補充" /></Field><Field label="香港／澳門號牌"><TextInput v-model="form.localPlate" placeholder="可稍後補充" /></Field></div>
      <Field label="批文卡有效期"><DateInput v-model="form.cardExpiresOn" label="批文卡有效期" /></Field>
    </template>
    <template v-else-if="modal === 'rental'">
      <p class="dialog-note">{{ selectedPlate?.mainland_plate || selectedPlate?.local_plate }} · 新增出租記錄</p>
      <Field label="承租方名稱" required><TextInput v-model="form.renterName" /></Field>
      <Field label="承租方使用車牌"><TextInput v-model="form.renterVehiclePlate" /></Field>
      <div class="form-grid"><Field label="開始日期"><DateInput v-model="form.startsOn" label="開始日期" /></Field><Field label="結束日期"><DateInput v-model="form.endsOn" label="結束日期" /></Field></div>
      <Field label="備註"><TextInput v-model="form.notes" multiline /></Field>
    </template>
    <template v-else-if="modal === 'inspection'">
      <p class="dialog-note">{{ selectedVehicle?.plate }} · 驗車要求以適用官方來源核對</p>
      <Field label="驗車項目" required><TextInput v-model="form.title" placeholder="例如：新車驗車" /></Field>
      <Field label="預約日期"><DateInput v-model="form.appointmentOn" label="預約日期" /></Field>
      <Field label="官方來源"><Select v-model="form.sourceId" :options="sourceOptions" /></Field>
      <Field label="備註"><TextInput v-model="form.notes" multiline /></Field>
    </template>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
  </FormDialog>
  <Modal :open="!!welcome" title="客戶登入已開通" sub="請以安全渠道轉發，關閉後不會再顯示初始密碼。" @close="welcome = ''"><Field label="轉發給客戶的文字"><TextInput :model-value="welcome" multiline readonly :rows="8" /></Field><p v-if="copyError" class="error" role="alert">{{ copyError }}</p><template #footer><Button @click="welcome = ''">完成</Button><Button variant="primary" @click="copyWelcome">複製轉發文字</Button></template></Modal>
</template>
