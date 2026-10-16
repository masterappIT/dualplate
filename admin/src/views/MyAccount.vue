<script setup>
// 我的帳號：修改密碼。成功後其他裝置的登入會失效，這部電腦保持登入。
import { ref, onMounted } from 'vue'
import { api, user } from '../api'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'
import KeyValue from '../components/ui/KeyValue.vue'

const emit = defineEmits(['saved', 'error'])
const me = user()
const replayGuide = () => window.dispatchEvent(new Event('welcome-guide'))
const tenantName = ref(''), tenantSaving = ref(false)
onMounted(async () => { try { tenantName.value = (await api('/tenant')).name } catch { tenantName.value = '' } })
async function saveTenant() { tenantSaving.value = true; try { tenantName.value = (await api('/tenant', 'PUT', { name: tenantName.value })).name; emit('saved', '公司名稱已儲存') } catch (cause) { emit('error', cause) } finally { tenantSaving.value = false } }
const form = ref({ currentPassword: '', newPassword: '', confirm: '' }), saving = ref(false), error = ref('')
async function save() {
  error.value = ''
  if (form.value.newPassword !== form.value.confirm) { error.value = '兩次輸入的新密碼不一樣'; return }
  saving.value = true
  try { await api('/me/password', 'POST', { currentPassword: form.value.currentPassword, newPassword: form.value.newPassword }); form.value = { currentPassword: '', newPassword: '', confirm: '' }; emit('saved', '密碼已更新；其他裝置需要重新登入') } catch (cause) { error.value = cause.message } finally { saving.value = false }
}
</script>

<template>
  <section class="panel account-panel">
    <div class="panel-head"><div><h2>我的帳號</h2><p>登入 30 天後需要重新登入；超過 7 天沒有使用也會自動登出。</p></div></div>
    <KeyValue :items="[{ label: '姓名', value: me?.name }, { label: '帳號', value: me?.username }, { label: '身份', value: me?.role === 'admin' ? '管理者' : '員工' }]" />
    <Button variant="text" size="sm" @click="replayGuide">重看使用導覽</Button>
  </section>
  <section v-if="me?.role === 'admin'" class="panel account-panel">
    <div class="panel-head"><div><h2>公司資料</h2><p>公司名稱會印在報價單等對外文件上。</p></div></div>
    <form class="record-form" novalidate @submit.prevent="saveTenant">
      <Field label="公司名稱" required><TextInput v-model="tenantName" /></Field>
      <div><Button type="submit" :loading="tenantSaving" :disabled="!tenantName.trim()">儲存</Button></div>
    </form>
  </section>
  <section class="panel account-panel">
    <div class="panel-head"><div><h2>修改密碼</h2><p>至少 10 個字元，不可與帳號相同。修改後其他裝置上的登入會失效。</p></div></div>
    <form class="record-form" novalidate @submit.prevent="save">
      <Field label="目前密碼" required><TextInput v-model="form.currentPassword" type="password" autocomplete="current-password" /></Field>
      <Field label="新密碼" required><TextInput v-model="form.newPassword" type="password" autocomplete="new-password" /></Field>
      <Field label="再次輸入新密碼" required><TextInput v-model="form.confirm" type="password" autocomplete="new-password" /></Field>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div><Button variant="primary" type="submit" :loading="saving" :disabled="!form.currentPassword || !form.newPassword">更新密碼</Button></div>
    </form>
  </section>
</template>
