<template>
  <view class="page notices">
    <view class="row head"><text class="page-title">通知</text><text v-if="unread" class="link" @click="readAll">全部已讀</text></view>
    <text class="subtle">到期提醒、辦理進度和文件核對結果都會在這裡。</text>
    <view class="list">
      <view v-for="item in items" :key="item.id" class="list-card notice" :class="{ unread: !item.read }" @click="open(item)">
        <view class="row"><text class="list-title">{{ item.title }}</text><text class="when num">{{ when(item.createdAt) }}</text></view>
        <text v-if="item.body" class="list-sub">{{ item.body }}</text>
        <text class="kind">{{ kindLabel[item.kind] || '通知' }}</text>
      </view>
    </view>
    <view v-if="loaded && !items.length" class="card empty">暫時沒有通知</view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
const items = ref([]), unread = ref(0), loaded = ref(false)
const kindLabel = { deadline: '到期提醒', request: '辦理進度', attachment: '文件核對' }
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { const result = await api('/my/notifications'); items.value = result.items; unread.value = result.unread } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
function when(value) {
  const date = new Date(value), days = Math.floor((Date.now() - date.getTime()) / 86400000)
  return days < 1 ? '今天' : days < 2 ? '昨天' : days < 7 ? `${days} 天前` : String(value).slice(0, 10)
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
.notices{padding-top:28rpx}.head{align-items:flex-end}.list{margin-top:24rpx}
.notice{position:relative;padding-left:40rpx}.notice::before{content:'';position:absolute;left:18rpx;top:34rpx;width:10rpx;height:10rpx;border-radius:50%;background:transparent}
.notice.unread::before{background:var(--plate-yellow);box-shadow:0 0 0 4rpx #FFF4D0}.notice.unread .list-title{color:var(--jade-deep)}
.notice:not(.unread) .list-title{font-weight:700;color:var(--ink-2)}
.when{flex:none;color:var(--ink-3);font-size:20rpx}.kind{display:inline-block;margin-top:10rpx;color:var(--jade);font-size:20rpx;font-weight:750}
</style>
