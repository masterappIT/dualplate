<script setup>
// 服務條款及私隱聲明（管理者 2026-10-17）：選「提示」或「強制」、編輯並發佈新版本、看每個客戶帳戶同意了哪一版。
// 提示：客戶登入後彈出通知，可稍後再看；強制：未同意最新版本前，客戶帳戶只能看條款、同意、改密碼或登出。
import { ref, computed, onMounted } from 'vue'
import { api, user } from '../api'
import { confirm } from '../composables/confirm'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'
import Segmented from '../components/ui/Segmented.vue'
import KeyValue from '../components/ui/KeyValue.vue'
import DataTable from '../components/ui/DataTable.vue'
import Tag from '../components/ui/Tag.vue'

const emit = defineEmits(['saved', 'error'])
const isAdmin = user()?.role === 'admin'
const data = ref(null), terms = ref(''), privacy = ref(''), modeSaving = ref(false), publishing = ref(false), loadError = ref('')
const modes = [{ value: 'prompt', label: '提示' }, { value: 'force', label: '強制' }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const placeholders = computed(() => (terms.value + privacy.value).match(/【請填寫[^】]*】/g) || [])
const changed = computed(() => !data.value?.current || terms.value.trim() !== data.value.current.terms || privacy.value.trim() !== data.value.current.privacy)
const accepted = computed(() => (data.value?.accounts || []).filter(item => item.current).length)
const columns = [{ key: 'customerName', title: '客戶', minWidth: 120 }, { key: 'name', title: '帳戶', minWidth: 140 }, { key: 'status', title: '同意狀態', minWidth: 140 }, { key: 'acceptedAt', title: '同意時間', minWidth: 140, align: 'right' }]

async function load() {
  try {
    data.value = await api('/terms')
    terms.value = data.value.draft.terms; privacy.value = data.value.draft.privacy; loadError.value = ''
  } catch (cause) { loadError.value = cause.message }
}
onMounted(load)
async function setMode(mode) {
  if (mode === data.value.mode || modeSaving.value) return
  if (mode === 'force' && !(await confirm({ title: '改為強制同意？', message: data.value.current ? `未同意第 ${data.value.current.version} 版的客戶，下次使用時要先同意才可繼續。` : '目前未有已發佈的版本；發佈後客戶須先同意才可繼續使用。', confirmText: '改為強制' }))) return
  modeSaving.value = true
  try { data.value.mode = (await api('/terms/mode', 'PUT', { mode })).mode; emit('saved', mode === 'force' ? '已改為強制同意' : '已改為提示') } catch (cause) { emit('error', cause) } finally { modeSaving.value = false }
}
async function publish() {
  const next = (data.value.current?.version || 0) + 1
  const message = data.value.mode === 'force' ? '發佈後所有客戶帳戶都要先同意新版本，才可繼續使用。' : '發佈後客戶登入時會看到更新通知，可稍後再看。'
  if (!(await confirm({ title: `發佈第 ${next} 版？`, message: `${message}已發佈的版本不能修改，只能再發佈新版本。`, confirmText: `發佈第 ${next} 版` }))) return
  publishing.value = true
  try { await api('/terms/publish', 'POST', { terms: terms.value, privacy: privacy.value }); await load(); emit('saved', `已發佈第 ${next} 版`) } catch (cause) { emit('error', cause) } finally { publishing.value = false }
}
</script>

<template>
  <p v-if="loadError" class="panel" role="alert">服務條款載入失敗：{{ loadError }} <button class="text-button" @click="load">重試</button></p>
  <template v-else-if="data">
    <section class="panel">
      <div class="panel-head"><div><h2>同意方式</h2><p>提示：客戶登入後彈出通知，可稍後再看。強制：未同意最新版本前，客戶只能看條款、同意、改密碼或登出。</p></div></div>
      <Segmented v-if="isAdmin" :model-value="data.mode" :options="modes" label="同意方式" @update:model-value="setMode" />
      <KeyValue v-else :items="[{ label: '同意方式', value: data.mode === 'force' ? '強制' : '提示' }]" />
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>目前版本</h2><p>客戶在登入頁和「我的」頁可隨時查看；每個帳戶同意哪一版、何時同意都有記錄。</p></div></div>
      <KeyValue v-if="data.current" :items="[{ label: '版本', value: `第 ${data.current.version} 版` }, { label: '發佈時間', value: time(data.current.publishedAt) }, { label: '發佈人', value: data.current.publishedBy || '—' }, { label: '已同意', value: `${accepted} / ${data.accounts.length} 個客戶帳戶` }]" />
      <p v-else class="cell-sub">尚未發佈。下面是按系統實際做法起草的初稿，正式生效前請交律師審閱。</p>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>{{ data.current ? '編輯新版本' : '初稿' }}</h2><p>「{公司名稱}」會自動換成「我的帳號」裏的公司名稱（{{ data.tenantName }}）；「【請填寫…】」要改好才可發佈。已發佈的版本不能修改，只能發佈新版本。</p></div></div>
      <form class="record-form" novalidate @submit.prevent="publish">
        <Field label="服務條款" required wide><TextInput v-model="terms" multiline :rows="16" :readonly="!isAdmin" /></Field>
        <Field label="私隱聲明" required wide><TextInput v-model="privacy" multiline :rows="16" :readonly="!isAdmin" /></Field>
        <p v-if="placeholders.length" class="cell-sub warn-line" role="status">還有 {{ placeholders.length }} 處待填寫：{{ [...new Set(placeholders)].join('、') }}</p>
        <div v-if="isAdmin"><Button variant="primary" type="submit" :loading="publishing" :disabled="!changed || !!placeholders.length || !terms.trim() || !privacy.trim()">發佈第 {{ (data.current?.version || 0) + 1 }} 版</Button></div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>客戶同意記錄</h2><p>{{ data.current ? `第 ${data.current.version} 版：${accepted} 個帳戶已同意，${data.accounts.length - accepted} 個未同意。` : '發佈後在這裏看每個客戶帳戶的同意狀態。' }}</p></div></div>
      <DataTable :columns="columns" :data="data.accounts" :min-width="620" empty-text="還沒有客戶帳戶">
        <template #cell-name="{ row }">{{ row.name }}<small class="cell-sub">{{ row.login }}{{ row.active ? '' : ' · 已停用' }}</small></template>
        <template #cell-status="{ row }"><Tag v-if="row.current" tone="ok">已同意最新版</Tag><Tag v-else-if="row.acceptedVersion" tone="warning">只同意第 {{ row.acceptedVersion }} 版</Tag><Tag v-else tone="neutral">未同意</Tag></template>
        <template #cell-acceptedAt="{ row }"><span class="num">{{ time(row.acceptedAt) || '—' }}</span></template>
      </DataTable>
    </section>
  </template>
</template>

<style scoped>
.warn-line { color: var(--status-due); }
</style>
