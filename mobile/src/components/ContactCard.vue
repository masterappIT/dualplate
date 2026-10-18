<template>
  <!-- 聯絡我們（docs/requirements.md 5.6.2）：app 內訊息＋公司 WhatsApp／微信；沒有設定的渠道不顯示 -->
  <view v-if="messages || hasChannel" class="card contact">
    <text class="contact-title">{{ title || (messages ? '聯絡我們' : '其他聯絡方式') }}</text>
    <text class="subtle">{{ intro }}</text>
    <button v-if="messages" class="btn-line contact-btn" @click="goMessages">在 app 內發訊息</button>
    <view v-if="contact.whatsappLink || contact.wechatId || contact.wecomLink" class="channels">
      <button v-if="contact.whatsappLink" class="btn-sm channel" @click="openLink(contact.whatsappLink)"><image class="channel-logo" src="/static/whatsapp.svg" />WhatsApp {{ phoneText(contact.whatsapp) }}</button>
      <button v-if="contact.wecomLink" class="btn-sm channel" @click="openLink(contact.wecomLink)"><image class="channel-logo" src="/static/wechat.svg" />打開微信客服</button>
      <button v-if="contact.wechatId" class="btn-sm channel" @click="copyText(contact.wechatId, '微信號已複製，請到微信搜尋添加')"><image class="channel-logo" src="/static/wechat.svg" />複製微信號 {{ contact.wechatId }}</button>
    </view>
    <view v-if="contact.wechatQr" class="qr-row" @click="previewQr"><image class="qr" :src="contact.wechatQr" mode="aspectFit" /><text class="subtle">掃描或長按二維碼添加微信客服</text></view>
  </view>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, publicApi, copyText, openLink } from '../lib/api'
// public：未登入的畫面（申請使用、審批中、未獲批准）用公開接口
// title：另給標題（例如登入頁的「忘記密碼？」），這時說明不寫「也」
const props = defineProps({ messages: { type: Boolean, default: true }, public: { type: Boolean, default: false }, title: { type: String, default: '' } })
const contact = ref({ whatsapp: '', whatsappLink: '', wechatId: '', wechatQr: '', wecomLink: '' })
const hasChannel = computed(() => Boolean(contact.value.whatsappLink || contact.value.wechatId || contact.value.wecomLink || contact.value.wechatQr))
// 說明只提已設定的渠道（docs/tasks/self-managed-fixes-plan.md 第 7 步）：都沒有設定時只寫 app 內訊息
const channelNames = computed(() => [contact.value.whatsappLink && 'WhatsApp', (contact.value.wechatId || contact.value.wecomLink || contact.value.wechatQr) && '微信'].filter(Boolean).join('、'))
// 中英之間才留空格：「用 WhatsApp 找我們」「用 WhatsApp、微信找我們」
const spaced = text => (/^[A-Za-z]/.test(text) ? ' ' : '') + text + (/[A-Za-z]$/.test(text) ? ' ' : '')
const intro = computed(() => props.messages
  ? (channelNames.value ? `有問題可以在 app 內發訊息，或用${spaced(channelNames.value)}找我們。` : '有問題可以在 app 內發訊息給我們。')
  : `${props.title ? '' : '也'}可以用${spaced(channelNames.value)}找我們。`)
const phoneText = value => String(value || '').replace(/^\+(852|853)(\d{4})(\d{4})$/, '+$1 $2 $3').replace(/^\+86(\d{3})(\d{4})(\d{4})$/, '+86 $1 $2 $3')
onMounted(async () => { try { contact.value = props.public ? await publicApi('/public/contact') : await api('/my/contact') } catch {} })
function goMessages() { uni.navigateTo({ url: '/pages/messages/messages' }) }
function previewQr() { uni.previewImage({ urls: [contact.value.wechatQr] }) }
</script>
<style scoped>
.contact{margin-top:16px;padding:16px}
.contact-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.contact-btn{width:100%;margin-top:12px}
/* 官方標誌（Simple Icons，CC0）用品牌顏色：WhatsApp #25D366、微信 #07C160 */
.channels{display:flex;flex-direction:column;gap:8px;margin-top:12px}.channel{width:100%}.channel-logo{width:20px;height:20px;margin-right:8px;flex:none}
.qr-row{display:flex;align-items:center;gap:12px;margin-top:12px}.qr{width:96px;height:96px;flex:none}
</style>
