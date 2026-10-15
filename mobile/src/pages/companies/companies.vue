<template>
  <view class="page companies">
    
    <text class="page-title">我的公司</text>
    <text class="subtle">每組公司持有的牌照，以及公司要辦的年度事項。</text>
    <view v-for="group in data.groups" :key="group.id" class="card group">
      <text class="group-name">{{ group.name }}</text>
      <view class="pair">
        <view class="side"><text class="side-label">{{ offshoreLabel(group) }}</text>
          <view v-for="c in group.offshore" :key="c.id" class="company"><text class="company-name">{{ c.name }}</text><text v-if="c.registrationNo" class="company-sub">{{ c.registrationNo }}</text><text v-if="c.status!=='存續'" class="pill" :class="c.status==='已註銷'?'gray':'amber'">{{ c.status }}</text></view>
          <text v-if="!group.offshore.length" class="company-sub">資料待補充</text>
        </view>
        <view class="side"><text class="side-label">內地公司</text>
          <view v-for="c in group.mainland" :key="c.id" class="company"><text class="company-name">{{ c.name }}</text><text v-if="c.registrationNo" class="company-sub">{{ c.registrationNo }}</text><text v-if="c.status!=='存續'" class="pill" :class="c.status==='已註銷'?'gray':'amber'">{{ c.status }}</text></view>
          <text v-if="!group.mainland.length" class="company-sub">資料待補充</text>
        </view>
      </view>
      <view v-if="group.plates.length" class="block"><text class="side-label">持有的牌照</text>
        <view v-for="p in group.plates" :key="p.id" class="plate-line" @click="openPlate(p.id)"><text>{{ p.label }}</text><text class="link">查看 ›</text></view>
      </view>
      <view v-if="group.deadlines.length" class="block"><text class="side-label">公司事項</text>
        <view v-for="(d,index) in group.deadlines" :key="index" class="row deadline"><view class="grow"><text class="company-name">{{ d.name }}</text><text class="company-sub">{{ d.ownerLabel }}</text></view><DueDate :date="d.dueOn" :days="d.daysLeft" :level="d.level" /></view>
      </view>
    </view>
    <view v-for="c in data.ungrouped" :key="c.id" class="card"><text class="company-name">{{ c.name }}</text><text class="company-sub">{{ c.jurisdiction }}{{ c.status!=='存續' ? ' · '+c.status : '' }}</text></view>
    <view v-if="loaded && !data.groups.length && !data.ungrouped.length" class="card empty">公司資料由你的顧問整理後會顯示在這裡。</view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, levelTone, daysText, openPlate } from '../../lib/api'
const data=ref({groups:[],ungrouped:[]}),loaded=ref(false)
// Name the offshore side after where the company is registered.
function offshoreLabel(group){const places=[...new Set(group.offshore.map(c=>c.jurisdiction))];return places.length===1?places[0]+'公司':'香港／澳門公司'}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{data.value=await api('/my/companies')}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
onShow(load)
import DueDate from '../../components/DueDate.vue'
</script>
<style scoped>
.companies{padding-top:28rpx}.group{margin-top:26rpx}.group-name{display:block;font-size:28rpx;font-weight:800;margin-bottom:16rpx}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16rpx}.side{background:var(--paper);border-radius:16rpx;padding:16rpx}.side-label{display:block;color:var(--ink-2);font-size:20rpx;font-weight:800;margin-bottom:8rpx}
.company{margin-bottom:8rpx}.company-name{display:block;font-size:24rpx;font-weight:750;color:var(--ink);overflow-wrap:anywhere}.company-sub{display:block;color:var(--ink-3);font-size:21rpx;margin:3rpx 0 6rpx}
.block{margin-top:20rpx;border-top:1rpx solid #edf2ee;padding-top:16rpx}.plate-line{display:flex;justify-content:space-between;padding:10rpx 0;font-size:24rpx;font-weight:750}.deadline{padding:10rpx 0}.grow{flex:1;min-width:0}
</style>
