<template>
  <view class="page reports">
    <text class="page-title">月報</text>
    <text class="subtle">每月一份：辦好的事、快到期的事、使用費、收費和報帳。由顧問核對後發出。</text>
    <view v-if="!current">
      <view v-for="r in list" :key="r.id" class="list-card row" @click="open(r)">
        <view class="grow"><text class="list-title">{{ monthTitle(r.period) }}</text><text class="list-sub">{{ r.version > 1 ? '更正版 · ' : '' }}發出 {{ friendlyDate(r.confirmedAt) }}</text></view>
        <view class="net"><text v-for="n in netRows(r.net)" :key="n.currency" class="net-line num" :class="n.value < 0 ? 'note-amber' : 'note-green'">{{ n.value < 0 ? '你應付' : '應付給你' }} {{ n.currency }} {{ money(Math.abs(n.value)) }}</text></view>
      </view>
      <view v-if="loaded && !list.length" class="card empty">還沒有月報。每月初顧問核對後會發給你。</view>
    </view>
    <view v-else class="sheet">
      <text class="link back" @click="current = null">‹ 全部月報</text>
      <view class="card cover guilloche"><text class="cover-kicker">月報 · {{ current.version > 1 ? '更正版' : '正式版' }}</text><text class="cover-title">{{ monthTitle(current.period) }}</text><text class="cover-sub">{{ current.report.customerName }}</text>
        <view class="ticket-rule cover-rule" /><text class="cover-caption">本月結算</text>
        <text v-for="n in netRows(current.report.net.net)" :key="n.currency" class="cover-net num">{{ n.value < 0 ? '你應付' : '應付給你' }} {{ n.currency }} {{ money(Math.abs(n.value)) }}</text>
        <text v-if="!netRows(current.report.net.net).length" class="cover-net">本月沒有需要結算的款項</text>
      </view>
      <text class="section-title">本月辦好的事 · {{ current.report.completed.length }}</text>
      <view class="card"><view v-for="(c, i) in current.report.completed" :key="i" class="line"><view class="grow"><text class="line-title">{{ c.service }}</text><text class="line-sub">{{ c.plate || c.title }}</text></view><text class="line-sub num">{{ c.completedOn }}</text></view><text v-if="!current.report.completed.length" class="subtle">本月沒有結案的工單</text></view>
      <text class="section-title">已逾期及 60 天內到期 · {{ current.report.upcoming.length }}</text>
      <view class="card"><view v-for="(u, i) in current.report.upcoming" :key="i" class="line"><view class="grow"><text class="line-title">{{ u.name }}</text><text v-if="u.handledBy === 'you'" class="who you">請你處理</text><text class="line-sub">{{ u.owner }}</text></view><DueDate :date="u.dueOn" :days="u.daysLeft" :level="u.level" /></view><text v-if="!current.report.upcoming.length" class="subtle">沒有已逾期或 60 天內到期的事項</text></view>
      <view v-if="current.report.usage.items.length"><text class="section-title">車輛使用與使用費</text>
        <view class="card"><view v-for="(u, i) in current.report.usage.items" :key="i" class="line"><view class="grow"><text class="line-title">{{ u.plate }}</text><text class="line-sub">使用人 {{ u.user }} · {{ u.collectedByUs ? '由我們代收' : '直接付給你' }}</text></view><view class="right"><text class="num line-title">{{ u.currency }} {{ money(u.amount) }}</text><text class="line-sub">{{ u.status === '已收' ? '已收到' : u.status === '部分收' ? '部分收到' : '未收到' }}</text></view></view></view>
      </view>
      <view v-if="current.report.charges.items.length"><text class="section-title">本月收費</text>
        <view class="card"><view v-for="(c, i) in current.report.charges.items" :key="i" class="line"><view class="grow"><text class="line-title">{{ c.description }}</text><text class="line-sub">{{ c.kindLabel }}</text></view><view class="right"><text class="num line-title">{{ c.currency }} {{ money(c.amount) }}</text><text class="line-sub">{{ c.status === '已收' ? '已付款' : c.status === '部分收' ? '部分付款' : '待付款' }}</text></view></view></view>
      </view>
      <view v-if="current.report.filings.length"><text class="section-title">內地公司報帳</text>
        <view class="card"><view v-for="(f, i) in current.report.filings" :key="i" class="line"><view class="grow"><text class="line-title">{{ f.company }}</text><text class="line-sub">{{ f.zeroFiling ? '零申報' : f.taxAmount ? '稅額 RMB ' + money(f.taxAmount) : '截止 ' + f.dueOn }}</text></view><text class="pill" :class="['已完成','已申報'].includes(f.status) ? '' : 'amber'">{{ ['已完成','已申報'].includes(f.status) ? '已申報' : '辦理中' }}</text></view></view>
      </view>
      <view class="card settle"><text class="section-title settle-title">結算說明</text><text class="subtle">應付給你 ＝ 本月代收的使用費 − 代收服務費 − 未付的收費。不同幣種分開計算，不換算。如有疑問請聯絡你的顧問。</text></view>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, friendlyDate } from '../../lib/api'
import DueDate from '../../components/DueDate.vue'
const list = ref([]), current = ref(null), loaded = ref(false)
const money = value => (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monthTitle = period => `${period.slice(0, 4)} 年 ${Number(period.slice(5))} 月`
const netRows = net => Object.entries(net || {}).filter(([, value]) => value).map(([currency, value]) => ({ currency, value }))
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { list.value = await api('/my/reports') } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
async function open(row) { try { current.value = await api('/my/reports/' + row.id) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } }
onShow(load)
</script>
<style scoped>
.reports{padding-top:28rpx}.grow{flex:1;min-width:0}.net{display:flex;flex-direction:column;align-items:flex-end;gap:4rpx}.net-line{font-size:21rpx;font-weight:750}
.back{display:block;margin:20rpx 0 14rpx}.cover{background:var(--jade-deep);border-color:var(--jade-deep);color:#E3EFEA}
.cover-kicker{display:block;font-size:20rpx;letter-spacing:4rpx;color:var(--plate-yellow);font-weight:800}.cover-title{display:block;margin-top:8rpx;font-size:40rpx;font-weight:800;color:#fff}.cover-sub{display:block;font-size:23rpx;color:rgba(227,239,234,.75)}
.cover-rule{border-top-color:rgba(227,239,234,.25)}.cover-rule::before,.cover-rule::after{background:var(--paper);border-color:transparent}.cover-caption{display:block;font-size:20rpx;color:rgba(227,239,234,.75);font-weight:750}.cover-net{display:block;margin-top:6rpx;font-size:30rpx;font-weight:800;color:#fff}
.line{display:flex;align-items:center;gap:16rpx;padding:16rpx 0;border-bottom:1rpx solid var(--rule)}.line:last-child{border-bottom:0}.line-title{display:block;font-size:24rpx;font-weight:750;color:var(--ink)}.line-sub{display:block;font-size:21rpx;color:var(--ink-2);margin-top:2rpx}.right{text-align:right}
.settle{margin-top:24rpx}.settle-title{margin-top:0}
</style>
