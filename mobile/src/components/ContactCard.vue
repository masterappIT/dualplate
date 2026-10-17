<template>
  <!-- 聯絡我們（docs/requirements.md 5.6.2）：app 內訊息＋公司 WhatsApp／微信；沒有設定的渠道不顯示 -->
  <view v-if="messages || hasChannel" class="card contact">
    <text class="contact-title">{{ messages ? '聯絡我們' : '其他聯絡方式' }}</text>
    <text class="subtle">{{ messages ? '有問題可以在 app 內發訊息，或用 WhatsApp、微信找我們。' : '也可以用 WhatsApp 或微信找我們。' }}</text>
    <button v-if="messages" class="btn-line contact-btn" @click="goMessages">在 app 內發訊息</button>
    <view v-if="contact.whatsappLink || contact.wechatId || contact.wecomLink" class="channels">
      <button v-if="contact.whatsappLink" class="btn-sm channel" @click="openLink(contact.whatsappLink)">WhatsApp {{ phoneText(contact.whatsapp) }}</button>
      <button v-if="contact.wecomLink" class="btn-sm channel" @click="openLink(contact.wecomLink)">打開微信客服</button>
      <button v-if="contact.wechatId" class="btn-sm channel" @click="copyText(contact.wechatId, '微信號已複製，請到微信搜尋添加')">複製微信號 {{ contact.wechatId }}</button>
    </view>
    <view v-if="contact.wechatQr" class="qr-row" @click="previewQr"><image class="qr" :src="contact.wechatQr" mode="aspectFit" /><text class="subtle">掃描或長按二維碼添加微信客服</text></view>
  </view>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, copyText, openLink } from '../lib/api'
const props = defineProps({ messages: { type: Boolean, default: true } })
const contact = ref({ whatsapp: '', whatsappLink: '', wechatId: '', wechatQr: '', wecomLink: '' })
const hasChannel = computed(() => Boolean(contact.value.whatsappLink || contact.value.wechatId || contact.value.wecomLink || contact.value.wechatQr))
const phoneText = value => String(value || '').replace(/^\+(852|853)(\d{4})(\d{4})$/, '+$1 $2 $3').replace(/^\+86(\d{3})(\d{4})(\d{4})$/, '+86 $1 $2 $3')
onMounted(async () => { try { contact.value = await api('/my/contact') } catch {} })
function goMessages() { uni.navigateTo({ url: '/pages/messages/messages' }) }
function previewQr() { uni.previewImage({ urls: [contact.value.wechatQr] }) }
</script>
<style scoped>
.contact{margin-top:16px;padding:16px}
.contact-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.contact-btn{width:100%;margin-top:12px}
.channels{display:flex;flex-direction:column;gap:8px;margin-top:12px}.channel{width:100%}
.qr-row{display:flex;align-items:center;gap:12px;margin-top:12px}.qr{width:96px;height:96px;flex:none}
</style>
