<script setup>
// 今日工作的「註冊申請」（docs/requirements.md 5.6.2，2026-10-18）：客戶在客戶端自行申請使用，只給管理者審批。
// 號碼未經短信驗證，批准前必須先聯絡申請人確認號碼屬於本人；批准即開自管客戶和登入帳戶。沒有待審批的申請時不顯示。
import { ref, computed, onMounted, watch } from 'vue'
import DataTable from '../ui/DataTable.vue'
import Tag from '../ui/Tag.vue'
import Button from '../ui/Button.vue'
import Field from '../ui/Field.vue'
import TextInput from '../ui/TextInput.vue'
import Checkbox from '../ui/Checkbox.vue'
import KeyValue from '../ui/KeyValue.vue'
import FormDialog from './FormDialog.vue'
import { api, user } from '../../api'
import { useAdminStore } from '../../store'
import { pushToast } from '../../composables/toast'

const { refresh } = useAdminStore()
const isAdmin = user()?.role === 'admin'
const rows = ref([]), loadError = ref(''), dialog = ref(''), current = ref(null), confirmed = ref(false), note = ref(''), saving = ref(false), formError = ref('')
const pending = computed(() => rows.value.filter(row => row.status === '審批中'))
const decided = computed(() => rows.value.filter(row => row.status !== '審批中'))
const columns = [{ key: 'name', title: '申請人', minWidth: 160 }, { key: 'phone', title: '手機號碼', minWidth: 150 }, { key: 'createdAt', title: '申請時間', minWidth: 120 }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 120 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const phoneText = value => String(value || '').replace(/^\+(852|853)(\d{4})(\d{4})$/, '+$1 $2 $3').replace(/^\+86(\d{3})(\d{4})(\d{4})$/, '+86 $1 $2 $3')
const whatsapp = value => `https://wa.me/${String(value || '').replace(/\D/g, '')}`
const details = computed(() => current.value ? [{ label: '稱呼', value: current.value.name }, { label: '手機號碼', value: phoneText(current.value.phone) }, { label: '申請時間', value: time(current.value.createdAt) }] : [])

async function load() { if (!isAdmin) return; try { rows.value = await api('/signup-applications'); loadError.value = '' } catch (error) { loadError.value = error.message } }
onMounted(load)
watch(confirmed, value => { if (value) formError.value = '' })
function open(kind, row) { current.value = row; dialog.value = kind; confirmed.value = false; note.value = ''; formError.value = '' }
async function submit() {
  if (dialog.value === 'approve' && !confirmed.value) { formError.value = '請先聯絡申請人，確認手機號碼屬於本人'; return }
  saving.value = true; formError.value = ''
  try {
    const path = `/signup-applications/${current.value.id}/${dialog.value}`
    await api(path, 'POST', dialog.value === 'approve' ? { confirmed: true } : { note: note.value })
    pushToast(dialog.value === 'approve' ? `已批准，${current.value.name}可以登入；請通知申請人` : '已拒絕申請')
    dialog.value = ''
    await load()
    if (path.endsWith('approve')) await refresh()
  } catch (error) { formError.value = error.message; await load() } finally { saving.value = false }
}
</script>

<template>
  <section v-if="isAdmin && (pending.length || loadError)" class="panel signup-applications">
    <div class="panel-head"><div><h2>註冊申請 · {{ pending.length }} 份待審批</h2><p>客戶在客戶端自行申請使用。號碼未經短信驗證，批准前請先聯絡申請人，確認號碼屬於本人。</p></div></div>
    <p v-if="loadError" role="alert">註冊申請載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <template v-else>
      <DataTable :columns="columns" :data="pending" row-key="id" :min-width="600">
        <template #cell-name="{ row }"><strong>{{ row.name }}</strong></template>
        <template #cell-phone="{ row }"><a class="num" :href="whatsapp(row.phone)" target="_blank" rel="noopener">{{ phoneText(row.phone) }}</a></template>
        <template #cell-createdAt="{ row }"><span class="num">{{ time(row.createdAt) }}</span></template>
        <template #cell-action="{ row }"><div class="row-actions"><button class="text-button" @click="open('approve', row)">批准</button><button class="text-button" @click="open('reject', row)">拒絕</button></div></template>
      </DataTable>
      <details v-if="decided.length" class="signup-history">
        <summary>最近已處理（{{ decided.length }}）</summary>
        <p v-for="row in decided" :key="row.id" class="cell-sub"><Tag :tone="row.status === '已批准' ? 'ok' : 'neutral'">{{ row.status }}</Tag> {{ row.name }} · <span class="num">{{ phoneText(row.phone) }}</span> · {{ time(row.decidedAt) }} · {{ row.decidedByName }}<template v-if="row.rejectNote">：{{ row.rejectNote }}</template></p>
      </details>
    </template>
  </section>

  <FormDialog :open="dialog === 'approve'" title="批准申請" sub="批准後開立自管客戶和登入帳戶；申請人用自己設定的密碼登入。" layout="stack" :width="560" :saving="saving" submit-text="批准" @close="dialog = ''" @submit="submit">
    <KeyValue :items="details" />
    <p class="cell-sub">可以先 <a :href="whatsapp(current?.phone)" target="_blank" rel="noopener">用 WhatsApp 聯絡申請人</a>，或直接致電。批准後請通知申請人可以登入。</p>
    <Field label="核實號碼" required><Checkbox v-model="confirmed" label="已聯絡申請人，確認這個手機號碼屬於本人" /></Field>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
  <FormDialog :open="dialog === 'reject'" title="拒絕申請" sub="申請人登入時會看到「申請未獲批准，如有疑問請聯絡我們」；申請資料保留 30 天後刪除。" layout="stack" :width="560" :saving="saving" submit-text="拒絕" @close="dialog = ''" @submit="submit">
    <KeyValue :items="details" />
    <Field label="原因" hint="選填，只作內部記錄，申請人看不到。"><TextInput v-model="note" multiline :rows="2" placeholder="例如：號碼不屬於本人" /></Field>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
</template>

<style scoped>
.signup-history { margin-top: 12px; }
</style>
