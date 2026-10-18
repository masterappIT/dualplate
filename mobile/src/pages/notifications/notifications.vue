<template>
  <view class="page notices">
    <view class="row head"><text class="subtle grow">到期提醒、辦理進度和文件核對結果都會在這裏。</text><text v-if="unread" class="link" @click="readAll">全部已讀</text></view>
    <view v-for="g in groups" :key="g.label">
      <text class="day">{{ g.label }}</text>
      <view class="card list">
        <view v-for="item in g.items" :key="item.id" class="notice" :class="{ unread: !item.read }" @click="open(item)">
          <view class="dot" />
          <view class="grow"><text class="notice-title">{{ item.title }}</text><text v-if="item.body" class="notice-body">{{ item.body }}</text><text class="kind">{{ kindLabel[item.kind] || '通知' }}</text></view>
          <text v-if="item.link" class="chev">›</text>
        </view>
      </view>
    </view>
    <view v-if="loaded && !items.length" class="card empty">暫時沒有通知</view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
const items = ref([]), unread = ref(0), loaded = ref(false)
// 按日子分組：今天、昨天、其後按日期
const groups = computed(() => { const out = []; for (const item of items.value) { const label = when(item.createdAt); const last = out[out.length - 1]; if (last && last.label === label) last.items.push(item); else out.push({ label, items: [item] }) } return out })
const kindLabel = { deadline: '到期提醒', request: '辦理進度', attachment: '文件核對', change_accepted: '資料核對', change_reverted: '資料核對', self_handled_accepted: '自行辦理', self_handled_returned: '自行辦理', support_reply: '客服訊息', scope_changed: '委託內容', rental: '出租' }
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { const result = await api('/my/notifications'); items.value = result.items; unread.value = result.unread } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
function when(value) {
  const date = new Date(value), days = Math.floor((Date.now() - date.getTime()) / 86400000)
  return days < 1 ? '今天' : days < 2 ? '昨天' : String(value).slice(0, 10)
}
async function open(item) {
  if (!item.read) { item.read = true; unread.value = Math.max(0, unread.value - 1); api('/my/notifications/read', 'POST', { id: item.id }).catch(() => {}) }
  if (!item.link) return
  const tabs = ['/pages/index/index', '/pages/vehicles/vehicles', '/pages/companies/companies', '/pages/me/me']
  if (tabs.includes(item.link)) uni.switchTab({ url: item.link }); else uni.navigateTo({ url: item.link })
}
async function readAll() {
  try { await api('/my/notifications/read', 'POST', { all: true }); items.value.forEach(item => { item.read = true }); unread.value = 0 } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
}
onShow(load)
</script>
<style scoped>
.head{align-items:flex-start;margin-bottom:4px}
.day{display:block;margin:16px 0 8px;color:var(--ink-3);font-size:var(--fs-meta);font-weight:700}
.list{padding:0 16px}
.notice{display:flex;align-items:flex-start;gap:8px;padding:12px 0;border-bottom:1px solid var(--rule)}.notice:last-child{border-bottom:0}
.dot{flex:none;width:8px;height:8px;margin-top:8px;border-radius:50%;background:transparent}
.notice.unread .dot{background:var(--plate-yellow);box-shadow:0 0 0 2px #FFF4D0}
.notice-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.notice:not(.unread) .notice-title{color:var(--ink-2)}
.notice-body{display:block;margin-top:2px;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.kind{display:block;margin-top:4px;color:var(--ink-3);font-size:var(--fs-cap);font-weight:700}
.chev{margin-top:4px}
</style>
