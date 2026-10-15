<template>
  <view class="page home">
    <view class="top"><view class="brand"><view class="brand-mark">跨</view><text>車牌管家</text></view><text class="link" @click="goMe">{{ user?.name || '登入' }}</text></view>
    <text class="eyebrow">我的跨境車務</text>
    <text class="page-title">{{ data.customerName || user?.name || '歡迎' }}</text>
    <text class="subtle">名下 {{ data.plates.length }} 個牌照的狀況，以及需要你處理的事。</text>

    <view class="status-grid">
      <view class="status-tile" @click="goPlates('ok')"><text class="status-num">{{ data.counts.ok }}</text><text class="status-label note-green">正常</text></view>
      <view class="status-tile" @click="goPlates('due')"><text class="status-num">{{ data.counts.due }}</text><text class="status-label note-amber">快到期</text></view>
      <view class="status-tile" @click="goPlates('overdue')"><text class="status-num">{{ data.counts.overdue }}</text><text class="status-label note-red">已逾期</text></view>
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
        <view class="grow"><text class="list-title">{{ item.name }}</text><text class="list-sub">{{ item.ownerLabel }}{{ item.detail ? ' · '+item.detail : '' }}</text></view>
        <text class="pill" :class="levelTone[item.level]">{{ daysText(item) }}</text>
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
import { api, getUser, levelTone, daysText, openPlate, startRequest } from '../../lib/api'
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
.home{padding-top:28rpx}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:38rpx}.brand{display:flex;align-items:center;gap:13rpx;font-size:27rpx;font-weight:800}.brand-mark{width:52rpx;height:52rpx;border-radius:14rpx;background:#1b4d3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26rpx}
.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14rpx;margin-top:30rpx}.status-tile{background:#fff;border:1rpx solid #e5ece6;border-radius:20rpx;padding:22rpx 0;text-align:center}.status-num{display:block;font-size:44rpx;font-weight:800}.status-label{display:block;font-size:22rpx;font-weight:750;margin-top:2rpx}
.grow{flex:1;min-width:0}.pending-note{display:block;margin-top:12rpx;color:#71857a;font-size:22rpx;text-align:center}.calm .list-title{font-size:25rpx}
.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:14rpx;margin-top:34rpx}.quick-item{display:flex;flex-direction:column;align-items:center;gap:10rpx;background:#fff;border:1rpx solid #e5ece6;border-radius:20rpx;padding:24rpx 0;font-size:23rpx;font-weight:750;color:#2c4a3c}.quick-mark{width:56rpx;height:56rpx;border-radius:16rpx;background:#e8f2eb;color:#176f59;display:flex;align-items:center;justify-content:center;font-weight:800}
</style>
