<template>
  <view class="page messages">
    <text class="subtle intro">{{ canSend ? '在這裏留言，我們會在辦公時間內回覆；回覆時會通知你。' : '這裏是我們發給你的訊息。有問題請直接聯絡你的顧問。' }}</text>
    <view v-if="loaded && !messages.length" class="card empty">還沒有訊息。寫下你的問題，我們會盡快回覆。</view>
    <view v-for="item in messages" :key="item.id" class="bubble" :class="item.fromStaff ? 'from-us' : 'from-you'">
      <text class="sender">{{ item.fromStaff ? (item.senderName || '我們') : '你' }} · {{ time(item.createdAt) }}</text>
      <text class="body">{{ item.body }}</text>
    </view>
    <view v-if="canSend" class="card composer">
      <textarea class="field draft" v-model="draft" maxlength="1000" placeholder="輸入訊息，最多 1000 字" />
      <text v-if="error" class="error">{{ error }}</text>
      <button class="primary send" :disabled="sending" @click="send">{{ sending ? '正在發送…' : '發送' }}</button>
    </view>
    <ContactCard v-if="canSend" :messages="false" />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
import ContactCard from '../../components/ContactCard.vue'
// 自管客戶的 app 內文字訊息（docs/requirements.md 5.6.2）：打開即視為已讀我們的回覆
const messages = ref([]), canSend = ref(false), loaded = ref(false), draft = ref(''), sending = ref(false), error = ref('')
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { const data = await api('/my/messages'); messages.value = data.messages; canSend.value = data.canSend } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
async function send() {
  if (sending.value) return
  if (!draft.value.trim()) { error.value = '請輸入訊息'; return }
  sending.value = true; error.value = ''
  try { messages.value = (await api('/my/messages', 'POST', { body: draft.value })).messages; draft.value = ''; uni.showToast({ title: '已發送', icon: 'none' }) } catch (e) { error.value = e.message } finally { sending.value = false }
}
onShow(load)
</script>
<style scoped>
.intro{display:block;margin-bottom:12px}
.bubble{display:flex;flex-direction:column;max-width:85%;margin-top:12px;padding:10px 12px;border-radius:var(--r-panel);background:var(--card);border:1px solid var(--rule)}
.from-us{margin-right:auto}.from-you{margin-left:auto;background:var(--jade-soft)}
.sender{font-size:var(--fs-cap);color:var(--ink-3);font-weight:700}
.body{margin-top:4px;font-size:var(--fs-body);line-height:1.6;color:var(--ink);white-space:pre-wrap}
.composer{margin-top:16px;padding:16px}
.draft{height:96px;line-height:1.5;width:100%}
.send{width:100%;margin-top:12px}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body)}
</style>
