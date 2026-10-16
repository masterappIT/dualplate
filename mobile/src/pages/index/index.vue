<template>
  <view class="page home">
    <view class="top"><view class="brand"><view class="seal"><text>牌</text></view><text>車牌管家</text></view><text class="link" @click="goMe">{{ user?.name || '登入' }}</text></view>
    <view class="hero guilloche">
      <text class="hero-kicker">委託人</text>
      <text class="hero-name">{{ data.customerName || user?.name || '歡迎' }}</text>
      <text class="hero-sub">名下 <text class="num">{{ data.plates.length }}</text> 個兩地牌</text>
      <view class="ticket-rule hero-rule" />
    <view class="status-grid">
      <view class="status-tile" @click="goPlates('ok')"><text class="status-num">{{ data.counts.ok }}</text><text class="status-label note-green">正常</text></view>
      <view class="status-tile" @click="goPlates('due')"><text class="status-num">{{ data.counts.due }}</text><text class="status-label note-amber">快到期</text></view>
      <view class="status-tile" @click="goPlates('overdue')"><text class="status-num">{{ data.counts.overdue }}</text><text class="status-label note-red">已逾期</text></view>
    </view>
    </view>
    <text v-if="data.counts.pending" class="pending-note">另有 {{ data.counts.pending }} 個牌照資料整理中</text>

    <view class="section-head"><text class="section-title">需要你處理 · {{ data.todos.length }}</text></view>
    <view v-if="data.todos.length">
      <view v-for="(item,index) in data.todos" :key="index" class="list-card warn-card" @click="openRequest(item.requestId)">
        <view class="row"><text class="list-title">{{ item.title }}</text><text class="pill amber">待你配合</text></view>
        <text class="list-sub">{{ item.subtitle }}</text>
      </view>
    </view>
    <view v-else class="list-card calm"><text class="list-title">目前沒有需要你處理的事</text><text class="list-sub">需要你提供資料或確認時，會在這裡通知你。</text></view>

    <view class="section-head"><text class="section-title">即將到期</text><text class="link" @click="goDeadlines">全部 ›</text></view>
    <view v-if="data.deadlines.length">
      <view v-for="(item,index) in data.deadlines.slice(0,3)" :key="index" class="list-card row" @click="openDeadline(item)">
        <view class="grow"><text class="list-title">{{ item.name }}</text><text v-if="item.handledBy==='you'" class="who you">請你處理</text><text class="list-sub">{{ item.ownerLabel }}{{ item.detail ? ' · '+item.detail : '' }}</text></view>
        <DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" />
      </view>
    </view>
    <view v-else class="list-card calm"><text class="list-title">半年內沒有到期項目</text><text class="list-sub">我們會在到期前提醒你，並安排辦理。</text></view>

    <view v-if="data.activeRequests.length">
      <view class="section-head"><text class="section-title">辦理中</text><text class="link" @click="goMe">全部 ›</text></view>
      <view v-for="item in data.activeRequests.slice(0,3)" :key="item.id" class="list-card" @click="openRequest(item.id)">
        <view class="row"><text class="list-title">{{ item.title }}</text><text class="pill" :class="item.status==='待客戶配合'?'amber':''">{{ item.status }}</text></view>
        <text class="list-sub">{{ item.plate || '未指定牌照' }} · 目前：{{ item.stage==='待內部受理' ? '等待顧問受理' : item.stage }}</text>
      </view>
    </view>

    <view class="quick">
      <view class="quick-item" @click="goPlates('')"><text class="quick-mark">牌</text><text>我的牌照</text></view>
      <view class="quick-item" @click="goCompanies"><text class="quick-mark">司</text><text>我的公司</text></view>
      <view class="quick-item" @click="newRequest"><text class="quick-mark">辦</text><text>申請辦理</text></view>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, openPlate, startRequest } from '../../lib/api'
import DueDate from '../../components/DueDate.vue'
const user=ref(getUser())
const data=ref({customerName:'',counts:{pending:0,ok:0,due:0,overdue:0},plates:[],deadlines:[],todos:[],activeRequests:[]})
async function load(){user.value=getUser();if(!user.value)return uni.navigateTo({url:'/pages/login/login'});try{data.value=await api('/my/overview')}catch(e){uni.showToast({title:e.message,icon:'none'})}}
function goPlates(filter){uni.setStorageSync('plateFilter',filter||'');uni.switchTab({url:'/pages/vehicles/vehicles'})}
function goCompanies(){uni.switchTab({url:'/pages/companies/companies'})}
function goMe(){uni.switchTab({url:'/pages/me/me'})}
function goDeadlines(){uni.navigateTo({url:'/pages/deadlines/deadlines'})}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
function newRequest(){startRequest('')}
// Company items open the company list; plate and vehicle items open their plate.
function openDeadline(item){if(item.ownerType==='company')goCompanies();else if(item.plateId)openPlate(item.plateId);else goDeadlines()}
onShow(load)
</script>
<style scoped>
.home{padding-top:28rpx}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28rpx}.brand{display:flex;align-items:center;gap:13rpx;font-size:27rpx;font-weight:800;color:var(--jade-deep)}
.seal{width:52rpx;height:52rpx;border-radius:50%;border:3rpx solid var(--jade);display:flex;align-items:center;justify-content:center}.seal text{color:var(--jade);font-size:24rpx;font-weight:900}
.hero{background:var(--jade-deep);color:#E3EFEA;border-radius:var(--r-panel);padding:30rpx 30rpx 26rpx}
.hero-kicker{display:block;font-size:20rpx;letter-spacing:4rpx;color:var(--plate-yellow);font-weight:800}
.hero-name{display:block;margin-top:8rpx;font-size:42rpx;font-weight:800;color:#fff}
.hero-sub{display:block;margin-top:6rpx;font-size:23rpx;color:rgba(227,239,234,.75)}
.hero-rule{margin:26rpx -30rpx 20rpx;border-top-color:rgba(227,239,234,.25)}.hero-rule::before,.hero-rule::after{background:var(--paper);border-color:transparent}
.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0}.status-tile{text-align:center;padding:4rpx 0}.status-tile+.status-tile{border-left:1rpx solid rgba(227,239,234,.2)}
.status-num{display:block;font-size:44rpx;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}.status-label{display:block;font-size:22rpx;font-weight:750;margin-top:2rpx}
.hero .note-green{color:#9FD8B5}.hero .note-amber{color:var(--plate-yellow)}.hero .note-red{color:#F4A39A}
.grow{flex:1;min-width:0}.pending-note{display:block;margin-top:12rpx;color:var(--ink-3);font-size:22rpx;text-align:center}.calm .list-title{font-size:25rpx}
.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:14rpx;margin-top:34rpx}.quick-item{display:flex;flex-direction:column;align-items:center;gap:10rpx;background:var(--card);border:1rpx solid var(--rule);border-radius:var(--r-card);padding:24rpx 0;font-size:23rpx;font-weight:750;color:var(--ink)}.quick-mark{width:56rpx;height:56rpx;border-radius:50%;border:2rpx solid var(--jade);color:var(--jade);display:flex;align-items:center;justify-content:center;font-weight:900}
</style>