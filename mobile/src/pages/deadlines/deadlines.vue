<template>
  <view class="page">
    <text class="intro">未來半年要辦的事。標了「自行辦理」的由你自己辦，其他由我們在到期前安排。</text>
    <view class="chips"><text v-for="f in filters" :key="f.id" class="chip" :class="{active:filter===f.id}" @click="filter=f.id">{{ f.name }}</text></view>
    <view v-for="(item,index) in visible" :key="index" class="list-card row" @click="open(item)">
      <view class="grow"><text class="list-title">{{ item.name }}</text><text v-if="item.handledBy==='you'" class="who">{{ selfHandled }}</text><text class="list-sub">{{ item.ownerLabel }}{{ item.detail ? ' · '+detailText(item.detail) : '' }}</text></view>
      <DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" />
    </view>
    <view v-if="loaded && !visible.length" class="card empty">沒有需要留意的到期項目</view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, openPlate, detailText, selfHandled } from '../../lib/api'
const items=ref([]),filter=ref(''),loaded=ref(false)
const filters=[{id:'',name:'全部'},{id:'plate',name:'牌照'},{id:'vehicle',name:'車輛'},{id:'company',name:'公司'}]
const visible=computed(()=>items.value.filter(item=>!filter.value||item.ownerType===filter.value))
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{items.value=(await api('/my/overview')).deadlines}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
function open(item){if(item.ownerType==='company')uni.switchTab({url:'/pages/companies/companies'});else if(item.plateId)openPlate(item.plateId)}
onShow(load)
import DueDate from '../../components/DueDate.vue'
</script>

