<template>
  <view class="page">
    <text class="eyebrow">到期提醒 / DEADLINES</text>
    <text class="page-title">到期提醒</text>
    <text class="subtle">未來半年要辦的事。到期前我們會主動安排，你也可以先申請辦理。</text>
    <view class="chips"><text v-for="f in filters" :key="f.id" class="chip" :class="{active:filter===f.id}" @click="filter=f.id">{{ f.name }}</text></view>
    <view v-for="(item,index) in visible" :key="index" class="list-card row" @click="open(item)">
      <view class="grow"><text class="list-title">{{ item.name }}</text><text class="list-sub">{{ item.ownerLabel }} · {{ item.dueOn }}{{ item.detail ? ' · '+item.detail : '' }}</text></view>
      <text class="pill" :class="levelTone[item.level]">{{ daysText(item) }}</text>
    </view>
    <view v-if="loaded && !visible.length" class="card empty">沒有需要留意的到期項目</view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, levelTone, daysText, openPlate } from '../../lib/api'
const items=ref([]),filter=ref(''),loaded=ref(false)
const filters=[{id:'',name:'全部'},{id:'plate',name:'牌照'},{id:'vehicle',name:'車輛'},{id:'company',name:'公司'}]
const visible=computed(()=>items.value.filter(item=>!filter.value||item.ownerType===filter.value))
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{items.value=(await api('/my/overview')).deadlines}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
function open(item){if(item.ownerType==='company')uni.switchTab({url:'/pages/companies/companies'});else if(item.plateId)openPlate(item.plateId)}
onShow(load)
</script>
<style scoped>.grow{flex:1;min-width:0}</style>
