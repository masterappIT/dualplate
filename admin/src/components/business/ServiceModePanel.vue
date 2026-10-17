<script setup>
// 委託方式：托管或自管（docs/requirements.md 5.6.2，2026-10-18）。管理者人手切換並記生效日；托管可填合約結束日（到期前 30 天提醒）；
// 標記和代理範圍、年費對不上時列出提示。員工只可查看。
import { ref, computed, watch } from 'vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import FormDialog from './FormDialog.vue'
import Field from '../ui/Field.vue'
import DateInput from '../ui/DateInput.vue'
import KeyValue from '../ui/KeyValue.vue'
import { api, user } from '../../api'

const props = defineProps({ customerId: { type: String, required: true } })
const emit = defineEmits(['changed'])
const isAdmin = user()?.role === 'admin'
const info = ref(null), loading = ref(false), loadError = ref('')
const dialog = ref(''), form = ref({ effectiveOn: '', contractEndsOn: '' }), saving = ref(false), formError = ref('')
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())
const other = computed(() => info.value?.mode === '自管' ? '托管' : '自管')
const items = computed(() => info.value ? [
  { label: '切換日期', value: info.value.since || '未有記錄' },
  { label: '切換人', value: info.value.by || '未有記錄' },
  ...(info.value.source ? [{ label: '來源', value: info.value.source === '邀請' ? '管理員邀請' : '客戶自行申請' }] : []),
  ...(info.value.mode === '托管' ? [{ label: '合約結束日', value: info.value.contractEndsOn || '未填寫' }] : [])
] : [])

async function load() {
  loading.value = true; loadError.value = ''
  try { info.value = await api(`/customers/${props.customerId}/service-mode`) } catch (error) { loadError.value = error.message } finally { loading.value = false }
}
watch(() => props.customerId, load, { immediate: true })

function openSwitch() { form.value = { effectiveOn: today(), contractEndsOn: '' }; formError.value = ''; dialog.value = 'switch' }
function openEnds() { form.value = { effectiveOn: '', contractEndsOn: info.value.contractEndsOn || '' }; formError.value = ''; dialog.value = 'ends' }
async function save() {
  if (dialog.value === 'switch' && !form.value.effectiveOn) { formError.value = '請填寫生效日'; return }
  const body = dialog.value === 'switch'
    ? { mode: other.value, effectiveOn: form.value.effectiveOn, ...(other.value === '托管' && form.value.contractEndsOn ? { contractEndsOn: form.value.contractEndsOn } : {}) }
    : { contractEndsOn: form.value.contractEndsOn || null }
  saving.value = true; formError.value = ''
  try { info.value = await api(`/customers/${props.customerId}/service-mode`, 'PUT', body); dialog.value = ''; emit('changed', info.value) } catch (error) { formError.value = error.message } finally { saving.value = false }
}
</script>

<template>
  <section class="panel service-mode">
    <div class="panel-head">
      <div><h2>委託方式</h2><p>托管：按合約由我們負責代理範圍內的事項。自管：客戶自己用系統管理，全部事項由客戶自理，不產生年費。</p></div>
      <Tag v-if="info" :tone="info.mode === '托管' ? 'ok' : 'neutral'">{{ info.mode }}</Tag>
    </div>
    <p v-if="loading && !info" role="status">正在載入委託方式…</p>
    <p v-else-if="loadError" class="error" role="alert">{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <template v-else-if="info">
      <KeyValue :items="items" />
      <ul v-if="info.warnings.length" class="mode-warnings">
        <li v-for="item in info.warnings" :key="item.kind"><Tag tone="warning">要處理</Tag><span>{{ item.text }}</span></li>
      </ul>
      <div v-if="isAdmin" class="heading-actions">
        <Button v-if="info.mode === '托管'" size="sm" @click="openEnds">{{ info.contractEndsOn ? '修改合約結束日' : '填寫合約結束日' }}</Button>
        <Button size="sm" @click="openSwitch">切換為{{ other }}</Button>
      </div>
      <details v-if="info.history.length" class="mode-history">
        <summary>切換記錄（{{ info.history.length }}）</summary>
        <p v-for="row in info.history" :key="row.changedAt" class="cell-sub">{{ row.effectiveOn }}：{{ !row.fromMode ? `新增為${row.toMode}` : row.fromMode === row.toMode ? `合約結束日改為 ${row.contractEndsOn || '未填寫'}` : `${row.fromMode} → ${row.toMode}` }} · {{ row.changedByName }}</p>
      </details>
    </template>
  </section>

  <FormDialog :open="dialog === 'switch'" :title="`切換為${other}`" :sub="other === '自管' ? '切換後，這位客戶的全部事項改由客戶自理：只提醒客戶，不再產生我們的工作，也不產生年費。' : '切換後，按委託範本和代理範圍由我們負責；請按合約核對代理範圍和收費。'" layout="stack" :width="560" :saving="saving" submit-text="確認切換" @close="dialog = ''" @submit="save">
    <Field label="生效日" required hint="合約生效或結束的日子；不可遲於今天。"><DateInput v-model="form.effectiveOn" label="生效日" /></Field>
    <Field v-if="other === '托管'" label="合約結束日" hint="選填；到期前 30 天在今日工作提醒你。"><DateInput v-model="form.contractEndsOn" label="合約結束日" /></Field>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
  <FormDialog :open="dialog === 'ends'" title="合約結束日" sub="選填；到期前 30 天在今日工作提醒你。留空即清除。" layout="stack" :width="560" :saving="saving" @close="dialog = ''" @submit="save">
    <Field label="合約結束日"><DateInput v-model="form.contractEndsOn" label="合約結束日" /></Field>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>
</template>

<style scoped>
.mode-warnings { display: grid; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
.mode-warnings li { display: flex; align-items: flex-start; gap: 8px; }
.mode-history, .service-mode .heading-actions { margin-top: 12px; }
</style>
