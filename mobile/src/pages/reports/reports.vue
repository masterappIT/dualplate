<template>
  <view class="page reports">
    <view v-if="!current">
      <text class="intro">每月一份：辦好的事、快到期的事、使用費、收費和報帳，由顧問核對後發出。</text>
      <view v-for="r in list" :key="r.id" class="list-card row" @click="open(r)">
        <view class="grow"><text class="list-title">{{ monthTitle(r.period) }}</text><text class="list-sub">{{ r.version > 1 ? '更正版 · ' : '' }}發出 {{ friendlyDate(r.confirmedAt) }}</text></view>
        <view class="net"><text v-for="n in netRows(r.net)" :key="n.currency" class="net-line num" :class="n.value < 0 ? 'note-amber' : 'note-green'">{{ n.value < 0 ? '你應付' : '應付給你' }} {{ money(n.currency, Math.abs(n.value)) }}</text></view>
      </view>
      <view v-if="loaded && !list.length" class="card empty">還沒有月報。每月初顧問核對後會發給你。</view>
    </view>
    <view v-else class="sheet">
      <text class="link back" @click="current = null">‹ 返回月報列表</text>
      <view class="card cover deep guilloche"><text class="kicker">{{ current.version > 1 ? '月報 · 更正版' : '月報' }}</text><text class="cover-title">{{ monthTitle(current.period) }}</text><text class="cover-sub">{{ current.report.customerName }}</text>
        <view class="ticket-rule" /><text class="cover-caption">本月結算</text>
        <text v-for="n in netRows(current.report.net.net)" :key="n.currency" class="cover-net num">{{ n.value < 0 ? '你應付' : '應付給你' }} {{ money(n.currency, Math.abs(n.value)) }}</text>
        <text v-if="!netRows(current.report.net.net).length" class="cover-net">本月沒有需要結算的款項</text>
      </view>
      <text class="section-title">本月辦好的事 · {{ current.report.completed.length }}</text>
      <view class="card list"><view v-for="(c, i) in current.report.completed" :key="i" class="line"><view class="grow"><text class="line-title">{{ c.service }}</text><text class="line-sub">{{ c.plate || c.title }}</text></view><text class="line-sub num">{{ c.completedOn }}</text></view><text v-if="!current.report.completed.length" class="subtle">本月沒有辦好的事</text></view>
      <text class="section-title">已逾期及 60 天內到期 · {{ current.report.upcoming.length }}</text>
      <view class="card list"><view v-for="(u, i) in current.report.upcoming" :key="i" class="line"><view class="grow"><text class="line-title">{{ u.name }}</text><text v-if="u.handledBy === 'you'" class="who">{{ selfHandled }}</text><text class="line-sub">{{ u.owner }}</text></view><DueDate :date="u.dueOn" :days="u.daysLeft" :level="u.level" /></view><text v-if="!current.report.upcoming.length" class="subtle">沒有已逾期或 60 天內到期的事項</text></view>
      <view v-if="current.report.usage.items.length"><text class="section-title">車輛使用與使用費</text>
        <view class="card list"><view v-for="(u, i) in current.report.usage.items" :key="i" class="line"><view class="grow"><text class="line-title">{{ u.plate }}</text><text class="line-sub">使用人 {{ u.user }} · {{ u.collectedByUs ? '由我們代收' : '直接付給你' }}</text></view><view class="right"><text class="num line-title">{{ money(u.currency, u.amount) }}</text><text class="line-sub">{{ u.status === '已收' ? '已收到' : u.status === '部分收' ? '部分收到' : '未收到' }}</text></view></view></view>
      </view>
      <view v-if="current.report.charges.items.length"><text class="section-title">本月收費</text>
        <view class="card list"><view v-for="(c, i) in current.report.charges.items" :key="i" class="line"><view class="grow"><text class="line-title">{{ c.description }}</text><text class="line-sub">{{ c.kindLabel }}</text></view><view class="right"><text class="num line-title">{{ money(c.currency, c.amount) }}</text><text class="line-sub">{{ c.status === '已收' ? '已付款' : c.status === '部分收' ? '部分付款' : '待付款' }}</text></view></view></view>
      </view>
      <view v-if="current.report.filings.length"><text class="section-title">內地公司報帳</text>
        <view class="card list"><view v-for="(f, i) in current.report.filings" :key="i" class="line"><view class="grow"><text class="line-title">{{ f.company }}</text><text class="line-sub">{{ f.zeroFiling ? '零申報' : f.taxAmount ? '稅額 ' + money('RMB', f.taxAmount) : '截止 ' + f.dueOn }}</text></view><text class="pill" :class="['已完成','已申報'].includes(f.status) ? '' : 'blue'">{{ ['已完成','已申報'].includes(f.status) ? '已申報' : '辦理中' }}</text></view></view>
      </view>
      <view class="card settle"><text class="section-title settle-title">結算說明</text><text class="subtle">應付給你 ＝ 本月代收的使用費 − 代收服務費 − 未付的收費。不同幣種分開計算，不換算。如有疑問請聯絡你的顧問。</text></view>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, friendlyDate, money, selfHandled } from '../../lib/api'
import DueDate from '../../components/DueDate.vue'
const list = ref([]), current = ref(null), loaded = ref(false)
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
.net{display:flex;flex-direction:column;align-items:flex-end;gap:2px}.net-line{font-size:var(--fs-body);font-weight:700}
.back{display:block;margin-bottom:12px}
.cover-title{display:block;margin-top:4px;font-size:var(--fs-title);font-weight:800;color:#fff}
.cover-sub{display:block;font-size:var(--fs-body);color:var(--on-deep-2)}
.cover-caption{display:block;font-size:var(--fs-meta);color:var(--on-deep-2);font-weight:700}
.cover-net{display:block;margin-top:4px;font-size:var(--fs-title);font-weight:800;color:#fff}
.line{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-meta);color:var(--ink-2);margin-top:2px}
.right{text-align:right}
.list{padding:4px 16px}.list>.subtle{padding:12px 0}
.settle{margin-top:24px}.settle-title{margin-top:0}
</style>
