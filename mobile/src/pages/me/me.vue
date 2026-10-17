<template>
  <view class="page me">
    <view class="profile-head" @click="goProfile"><view class="grow"><text class="page-title">{{ user?.name || '我的' }}</text><text class="subtle">{{ account }}</text></view><text class="link">我的資料 ›</text></view>
    <view class="card menu">
      <view class="menu-row" @click="goDeadlines"><text class="menu-name">到期提醒</text><text class="chev">›</text></view>
      <view class="menu-row" @click="goNotices"><text class="menu-name">通知</text><text v-if="unread" class="pill amber num">{{ unread }} 則未讀</text><text class="chev">›</text></view>
      <view class="menu-row" @click="goBilling"><text class="menu-name">帳單</text><text v-if="unpaid" class="pill amber">有未付款項</text><text class="chev">›</text></view>
      <view class="menu-row" @click="goReports"><text class="menu-name">月報</text><text class="chev">›</text></view>
    </view>
    <view class="section-head"><text class="section-title">辦理記錄</text><text class="link" @click="newRequest">申請辦理 ›</text></view>
    <view v-if="requests.length" class="card list">
      <view v-for="item in requests" :key="item.id" class="line" @click="openRequest(item.id)">
        <view class="grow"><view class="row"><text class="line-title grow">{{ item.title }}</text><text class="pill" :class="requestTone(item.status)">{{ item.status }}</text></view>
          <view class="req-meta"><PlateChip v-if="plateOf(item)" :plate="plateOf(item)" region="內地" size="sm" /><text class="line-sub">{{ clientStage(item.stage) }}</text></view></view>
      </view>
    </view>
    <view v-if="loaded && !requests.length" class="card empty">還沒有辦理記錄</view>
    <AdvisorCard v-if="loaded" :advisor="advisor" placeholder />
    <view class="card menu">
      <view class="menu-row" @click="guide=true"><text class="menu-name">使用導覽</text><text class="chev">›</text></view>
      <view class="menu-row" @click="goTerms"><text class="menu-name">服務條款及私隱聲明</text><text class="chev">›</text></view>
      <view class="menu-row" @click="logout"><text class="menu-name">退出登入</text><text class="chev">›</text></view>
    </view>
    <WelcomeGuide v-if="guide" force @closed="guide=false" />
    <wd-message-box />
  </view>
</template>
<script setup>
import { useConfirm } from '../../lib/choice'
const confirmBox=useConfirm()
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, clearSession, startRequest, requestTone, clientStage } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
import AdvisorCard from '../../components/AdvisorCard.vue'
import WelcomeGuide from '../../components/WelcomeGuide.vue'
const user=ref(getUser()),requests=ref([]),plates=ref([]),loaded=ref(false),advisor=ref(null),unread=ref(0),unpaid=ref(false),guide=ref(false)
// 只用手機號碼開通的帳戶，電郵是系統佔位，不顯示
const account=computed(()=>{const email=user.value?.email||'';return email.endsWith('@phone.invalid')?'以手機號碼登入':email})
async function load(){user.value=getUser();if(!user.value)return uni.navigateTo({url:'/pages/login/login'});try{const [list,overview,plateList]=await Promise.all([api('/requests'),api('/my/overview'),api('/plate-assets')]);requests.value=list;plates.value=plateList;advisor.value=overview.advisor;unread.value=overview.unreadNotifications||0;api('/my/fees').then(r=>{unpaid.value=Object.keys(r.outstanding||{}).length>0}).catch(()=>{})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
// 辦理記錄一律用內地車牌標識，與首頁一致
function plateOf(item){return plates.value.find(p=>p.id===item.plate_asset_id)?.mainland_plate||''}
function goProfile(){uni.navigateTo({url:'/pages/profile/profile'})}
function goTerms(){uni.navigateTo({url:'/pages/terms/terms'})}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
function newRequest(){startRequest('')}
function goNotices(){uni.navigateTo({url:'/pages/notifications/notifications'})}
function goReports(){uni.navigateTo({url:'/pages/reports/reports'})}
function goBilling(){uni.navigateTo({url:'/pages/billing/billing'})}
function goDeadlines(){uni.navigateTo({url:'/pages/deadlines/deadlines'})}
async function logout(){if(await confirmBox.ask({title:'退出登入',msg:'確定要退出嗎？',ok:'退出',cancel:'取消'})!=='confirm')return;clearSession();uni.navigateTo({url:'/pages/login/login'})}
onShow(load)
</script>
<style scoped>
.profile-head{display:flex;align-items:center;gap:12px}
.menu{margin-top:16px;padding:0 16px}
.menu-row{display:flex;align-items:center;gap:8px;min-height:52px;border-bottom:1px solid var(--rule)}.menu-row:last-child{border-bottom:0}
.menu-name{flex:1;font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.list{padding:4px 16px}
.line{padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.req-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
</style>
