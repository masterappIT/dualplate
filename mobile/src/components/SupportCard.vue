<template>
  <!-- 線上客服（docs/tasks/support-masterbox-plan.md）：MasterBox 小視窗，取代原來的「聯絡我們」卡（WhatsApp、微信、app 內訊息）
       已登入：帶入客戶資料、有紅點；public：未登入的畫面（登入頁、申請使用、審批中），不帶資料
       微信小程序打不開 MasterBox，整張不顯示 -->
  <view v-if="supportAvailable" class="card support">
    <view v-if="!public" class="support-head">
      <view class="support-icon"><image class="icon" src="/static/chat.svg" /></view>
      <text class="support-title">線上客服</text>
    </view>
    <text v-else class="support-title">{{ title || '線上客服' }}</text>
    <text class="subtle intro">{{ intro || (public ? '發訊息給客服，我們會盡快回覆。' : '有問題直接發訊息，可以傳相片和文件。下班後也可以留言，我們上班後回覆。') }}</text>
    <button :class="public ? 'btn-line' : 'primary'" class="open-btn" @click="open">聯絡客服<text v-if="unread" class="dot num">{{ unread > 99 ? '99+' : unread }}</text></button>
  </view>
</template>
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { supportAvailable, loadSupport, openSupport, onSupportUnread, syncSupportData } from '../lib/support'
// title：另給標題（例如登入頁的「忘記密碼？」）；intro：另給說明
const props = defineProps({ public: { type: Boolean, default: false }, title: { type: String, default: '' }, intro: { type: String, default: '' } })
const unread = ref(0)
let stop = null
onMounted(() => {
  if (!supportAvailable) return
  loadSupport()
  stop = onSupportUnread(count => { unread.value = count })
  if (!props.public) syncSupportData()
})
onUnmounted(() => stop?.())
function open() { openSupport() }
</script>
<style scoped>
.support{margin-top:16px;padding:16px}
.support-head{display:flex;align-items:center;gap:12px}
.support-icon{width:40px;height:40px;flex:none;border-radius:50%;background:var(--jade-soft);display:flex;align-items:center;justify-content:center}
.icon{width:22px;height:22px}
.support-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.intro{margin-top:8px}
.open-btn{width:100%;margin-top:12px;gap:8px}
.dot{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--overdue);color:var(--card);font-size:var(--fs-cap);line-height:20px;text-align:center}
</style>
