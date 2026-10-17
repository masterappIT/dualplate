<template>
  <view class="page home">
    <view class="hero deep guilloche">
      <view class="hero-top">
        <view class="grow"><text class="kicker">委託人</text><text class="hero-name">{{ data.customerName || user?.name || '歡迎' }}</text><text class="hero-sub">名下 <text class="num">{{ data.plates.length }}</text> 個兩地牌</text></view>
        <view class="bell" @click="goNotices" aria-label="通知"><image class="bell-icon" src="/static/bell.svg" /><text v-if="data.unreadNotifications" class="bell-dot num">{{ data.unreadNotifications > 99 ? '99+' : data.unreadNotifications }}</text></view>
      </view>
      <view class="ticket-rule" />
      <view class="status-grid">
        <view class="status-tile ok" :class="{ zero: !data.counts.ok }" @click="goPlates('ok')"><text class="status-num num">{{ data.counts.ok }}</text><text class="status-label">正常</text></view>
        <view class="status-tile due" :class="{ zero: !data.counts.due }" @click="goPlates('due')"><text class="status-num num">{{ data.counts.due }}</text><text class="status-label">快到期</text></view>
        <view class="status-tile overdue" :class="{ zero: !data.counts.overdue }" @click="goPlates('overdue')"><text class="status-num num">{{ data.counts.overdue }}</text><text class="status-label">已逾期</text></view>
      </view>
    </view>
    <text v-if="data.counts.pending" class="pending-note">另有 {{ data.counts.pending }} 個牌照資料整理中</text>

    <view class="section-head"><text class="section-title">需要你處理<text v-if="data.todos.length" class="num"> · {{ data.todos.length }}</text></text></view>
    <view v-if="data.todos.length">
      <view v-for="(item,index) in data.todos" :key="index" class="list-card warn-card row" @click="openRequest(item.requestId)">
        <view class="grow"><text class="list-title">{{ item.title }}</text><text class="list-sub">{{ item.subtitle }}</text></view><text class="chev">›</text>
      </view>
    </view>
    <view v-else class="list-card"><text class="list-title">目前沒有需要你處理的事</text><text class="list-sub">需要你提供資料或確認時，會在這裡通知你。</text></view>

    <view class="section-head"><text class="section-title">到期提醒</text><text class="link" @click="goDeadlines">全部 ›</text></view>
    <view v-if="data.deadlines.length">
      <view v-for="(item,index) in data.deadlines.slice(0,3)" :key="index" class="list-card row" @click="openDeadline(item)">
        <view class="grow"><text class="list-title">{{ item.name }}</text><text v-if="item.handledBy==='you'" class="who">{{ selfHandled }}</text><text class="list-sub">{{ item.ownerLabel }}{{ item.detail ? ' · '+detailText(item.detail) : '' }}</text></view>
        <DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" />
      </view>
    </view>
    <view v-else class="list-card"><text class="list-title">半年內沒有到期項目</text><text class="list-sub">我們會在到期前提醒你，並安排辦理。</text></view>

    <view v-if="data.activeRequests.length">
      <view class="section-head"><text class="section-title">辦理中</text><text class="link" @click="goMe">全部 ›</text></view>
      <view v-for="item in data.activeRequests.slice(0,3)" :key="item.id" class="list-card" @click="openRequest(item.id)">
        <view class="row"><text class="list-title grow">{{ item.title }}</text><text class="pill" :class="requestTone(item.status)">{{ item.status }}</text></view>
        <view class="req-meta"><PlateChip v-if="item.plate" :plate="item.plate" region="內地" size="sm" /><text class="list-sub">{{ clientStage(item.stage) }}</text></view>
      </view>
    </view>
    <button class="btn-line new-request" @click="newRequest">＋ 申請辦理</button>

    <AdvisorCard :advisor="data.advisor" />
    <WelcomeGuide />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, openPlate, startRequest, requestTone, clientStage, detailText, selfHandled,checkTerms } from '../../lib/api'
import DueDate from '../../components/DueDate.vue'
import PlateChip from '../../components/PlateChip.vue'
import AdvisorCard from '../../components/AdvisorCard.vue'
import WelcomeGuide from '../../components/WelcomeGuide.vue'
const user=ref(getUser())
const data=ref({unreadNotifications:0,advisor:null,customerName:'',counts:{pending:0,ok:0,due:0,overdue:0},plates:[],deadlines:[],todos:[],activeRequests:[]})
async function load(){user.value=getUser();if(!user.value)return uni.navigateTo({url:'/pages/login/login'});checkTerms();try{data.value=await api('/my/overview')}catch(e){uni.showToast({title:e.message,icon:'none'})}}
function goPlates(filter){uni.setStorageSync('plateFilter',filter||'');uni.switchTab({url:'/pages/vehicles/vehicles'})}
function goCompanies(){uni.switchTab({url:'/pages/companies/companies'})}
function goNotices(){uni.navigateTo({url:'/pages/notifications/notifications'})}
function goMe(){uni.switchTab({url:'/pages/me/me'})}
function goDeadlines(){uni.navigateTo({url:'/pages/deadlines/deadlines'})}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
function newRequest(){startRequest('')}
// Company items open the company list; plate and vehicle items open their plate.
function openDeadline(item){if(item.ownerType==='company')goCompanies();else if(item.plateId)openPlate(item.plateId);else goDeadlines()}
onShow(load)
</script>
<style scoped>
.hero{border-radius:var(--r-panel);padding:16px 16px 12px}
.hero-top{display:flex;align-items:flex-start;gap:12px}
.hero-name{display:block;margin-top:4px;font-size:var(--fs-title);font-weight:800;line-height:1.3;color:#fff}
.hero-sub{display:block;margin-top:2px;font-size:var(--fs-body);color:var(--on-deep-2)}
.status-grid{display:grid;grid-template-columns:repeat(3,1fr)}
.status-tile{display:flex;flex-direction:column;align-items:center;padding:4px 0}.status-tile+.status-tile{border-left:1px solid rgba(227,239,234,.2)}
.status-num{display:block;font-size:var(--fs-stat);font-weight:800;line-height:1.2}
.status-label{display:block;font-size:var(--fs-meta);font-weight:700;margin-top:2px}
.status-tile.ok{color:var(--on-deep-ok)}.status-tile.due{color:var(--on-deep-due)}.status-tile.overdue{color:var(--on-deep-overdue)}
.status-tile.zero{color:var(--on-deep-2)}
.pending-note{display:block;margin-top:8px;color:var(--ink-3);font-size:var(--fs-meta);text-align:center}
.new-request{width:100%;margin-top:4px}
.req-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px}.req-meta .list-sub{margin-top:0}
.bell{position:relative;flex:none;width:40px;height:40px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center}.bell-icon{width:20px;height:20px}
.bell-dot{position:absolute;top:-4px;right:-6px;min-width:20px;height:20px;padding:0 4px;border-radius:99px;background:var(--plate-yellow);color:var(--jade-deep);font-size:var(--fs-cap);font-weight:800;line-height:18px;text-align:center;border:1px solid var(--jade-deep)}
</style>
