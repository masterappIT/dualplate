<script setup>
// 客服聯絡方式（docs/requirements.md 5.6.2，2026-10-18）：公司 WhatsApp Business 號碼、企業微信的微信號和二維碼、企業微信客服連結。
// 客戶端「聯絡我們」及審批中、被拒絕的畫面顯示，讓客戶自己添加客服。只限管理者修改，員工可以看。
import { ref, onMounted } from 'vue'
import { api, user } from '../api'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import PhoneInput from '../components/ui/PhoneInput.vue'
import Button from '../components/ui/Button.vue'
import KeyValue from '../components/ui/KeyValue.vue'

const emit = defineEmits(['saved', 'error'])
const isAdmin = user()?.role === 'admin'
const form = ref({ whatsapp: '', wechatId: '', wechatQr: '', wecomLink: '' }), loaded = ref(false), loadError = ref(''), saving = ref(false), formError = ref('')
async function load() {
  try { const data = await api('/support/contact'); form.value = { whatsapp: data.whatsapp, wechatId: data.wechatId, wechatQr: data.wechatQr, wecomLink: data.wecomLink }; loadError.value = '' } catch (error) { loadError.value = error.message } finally { loaded.value = true }
}
onMounted(load)
function pickQr(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { formError.value = '二維碼只接受 PNG、JPEG 或 WebP 圖片'; return }
  if (file.size > 400000) { formError.value = '二維碼圖片不可超過 400 KB'; return }
  const reader = new FileReader()
  reader.onload = () => { form.value.wechatQr = String(reader.result); formError.value = '' }
  reader.readAsDataURL(file)
}
async function save() {
  saving.value = true; formError.value = ''
  try { const data = await api('/support/contact', 'PUT', { ...form.value }); form.value = { whatsapp: data.whatsapp, wechatId: data.wechatId, wechatQr: data.wechatQr, wecomLink: data.wecomLink }; emit('saved', '客服聯絡方式已儲存') } catch (error) { formError.value = error.message } finally { saving.value = false }
}
</script>

<template>
  <section class="panel">
    <div class="panel-head"><div><h2>客服聯絡方式</h2><p>自管客戶在客戶端「聯絡我們」看到這些；請用公司帳號（WhatsApp Business、企業微信），不要用員工私人帳號。托管客戶照舊聯絡自己的顧問。</p></div></div>
    <p v-if="!loaded" role="status">正在載入…</p>
    <p v-else-if="loadError" class="error" role="alert">{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <template v-else-if="isAdmin">
      <div class="record-form contact-form">
        <Field label="WhatsApp 號碼" hint="香港、澳門 8 位，內地 11 位；客戶按一下就開出對話。留空即不顯示。"><PhoneInput v-model="form.whatsapp" /></Field>
        <Field label="微信號" hint="企業微信對外的微信號；客戶可一按複製。"><TextInput v-model="form.wechatId" placeholder="例如 plate_service" /></Field>
        <Field label="微信二維碼" group hint="PNG、JPEG 或 WebP，不超過 400 KB。">
          <div class="qr-row">
            <img v-if="form.wechatQr" :src="form.wechatQr" alt="微信二維碼預覽" class="qr-preview" />
            <label class="file-button button">{{ form.wechatQr ? '更換圖片' : '上傳圖片' }}<input type="file" accept="image/png,image/jpeg,image/webp" @change="pickQr" /></label>
            <Button v-if="form.wechatQr" size="sm" variant="text" @click="form.wechatQr = ''">移除</Button>
          </div>
        </Field>
        <Field label="企業微信客服連結" hint="選填；以 https://work.weixin.qq.com/ 開頭，客戶按下可直接打開微信對話。"><TextInput v-model="form.wecomLink" placeholder="https://work.weixin.qq.com/kfid/…" /></Field>
      </div>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div class="heading-actions"><Button variant="primary" :loading="saving" @click="save">儲存</Button></div>
    </template>
    <KeyValue v-else :items="[{ label: 'WhatsApp 號碼', value: form.whatsapp || '未設定' }, { label: '微信號', value: form.wechatId || '未設定' }, { label: '微信二維碼', value: form.wechatQr ? '已上傳' : '未上傳' }, { label: '企業微信客服連結', value: form.wecomLink || '未設定' }]" />
  </section>
</template>

<style scoped>
.contact-form { max-width: 560px; }
.qr-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.qr-preview { width: 96px; height: 96px; object-fit: contain; }
.heading-actions { margin-top: 16px; }
</style>
