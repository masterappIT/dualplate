<template>
  <view class="page me">
    
    <text class="page-title">{{ user?.name || '我的' }}</text>
    <text class="subtle">{{ account }}</text>
    <AdvisorCard v-if="loaded" :advisor="advisor" placeholder />
    <view class="section-head"><text class="section-title">辦理記錄</text><text class="link" @click="newRequest">申請辦理 ›</text></view>
    <view v-for="item in requests" :key="item.id" class="list-card" @click="openRequest(item.id)">
      <view class="row"><text class="list-title">{{ item.title }}</text><text class="pill" :class="item.status==='需要你提供資料'?'amber':['已完成','已取消'].includes(item.status)?'gray':''">{{ item.status }}</text></view>
      <text class="list-sub">{{ item.plate || item.route }} · 目前：{{ item.stage==='待內部受理' ? '等待顧問受理' : item.stage }}</text>
    </view>
    <view v-if="loaded && !requests.length" class="card empty">還沒有辦理記錄</view>
    <text class="section-title">其他</text>
    <view class="list-card row" @click="goNotices"><text class="list-title">通知</text><view class="row"><text v-if="unread" class="pill amber num">{{ unread }} 則未讀</text><text class="link">›</text></view></view>
    <view class="list-card row" @click="goDeadlines"><text class="list-title">到期提醒</text><text class="link">›</text></view>
    <view class="list-card row" @click="logout"><text class="list-title">退出登入</text><text class="link">›</text></view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, clearSession, startRequest } from '../../lib/api'
import AdvisorCard from '../../components/AdvisorCard.vue'
const user=ref(getUser()),requests=ref([]),loaded=ref(false),advisor=ref(null),unread=ref(0)
// 只用手機號碼開通的帳戶，電郵是系統佔位，不顯示
const account=computed(()=>{const email=user.value?.email||'';return email.endsWith('@phone.invalid')?'以手機號碼登入':email})
async function load(){user.value=getUser();if(!user.value)return uni.navigateTo({url:'/pages/login/login'});try{const [list,overview]=await Promise.all([api('/requests'),api('/my/overview')]);requests.value=list;advisor.value=overview.advisor;unread.value=overview.unreadNotifications||0}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
function newRequest(){startRequest('')}
function goNotices(){uni.navigateTo({url:'/pages/notifications/notifications'})}
function goDeadlines(){uni.navigateTo({url:'/pages/deadlines/deadlines'})}
function logout(){uni.showModal({title:'退出登入',content:'確定要退出嗎？',success:result=>{if(result.confirm){clearSession();uni.navigateTo({url:'/pages/login/login'})}}})}
onShow(load)
</script>
<style scoped>.me{padding-top:28rpx}</style>
