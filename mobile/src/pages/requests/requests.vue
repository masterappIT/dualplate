<template>
  <view class="page request-page">
    <text class="eyebrow">申請代辦 / REQUESTS</text><text class="page-title">申請代辦</text><text class="subtle">新申請與現有兩地牌的續期、換車等服務在這裡辦理；正式批文卡在「我的兩地牌」管理。</text>
    <view class="route-switch"><view v-for="r in routes" :key="r" class="route-option" :class="{active:route===r}" @click="route=r">{{ r }}服務</view></view>
    <view class="card form-card"><view class="form-heading"><view class="form-step">01</view><view><text class="form-title">告訴我們你的需要</text><text class="form-desc">提交後會成為待受理案件</text></view></view>
      <text class="field-label">服務類型</text><picker :range="availableNames" @change="selectService"><view class="field picker"><text>{{ selectedService?.name || '請選擇服務' }}</text><text class="picker-arrow">⌄</text></view></picker>
      <text class="field-label">相關車輛</text><picker :range="vehicleNames" @change="vehicleIndex=Number($event.detail.value)"><view class="field picker"><text>{{ vehicleNames[vehicleIndex] }}</text><text class="picker-arrow">⌄</text></view></picker>
      <template v-if="serviceCode!=='new_application'"><text class="field-label">相關兩地牌檔案</text><picker :range="plateNames" @change="plateIndex=Number($event.detail.value)"><view class="field picker"><text>{{ plateNames[plateIndex] }}</text><text class="picker-arrow">⌄</text></view></picker><text class="plate-help">已有多張兩地牌時，請選擇本次代辦對應的檔案。</text></template>
      <text class="field-label">要求標題</text><input class="field" v-model="title" placeholder="簡要寫下辦理事項" />
      <text class="field-label">補充情況</text><textarea class="field description" v-model="description" placeholder="例如目前車輛、牌證、司機或預期辦理的事項" />
      <view class="notice"><view class="notice-mark">i</view><text>專員會先核對申請類型、適用條件及材料。提交要求不代表主管部門已受理。</text></view>
      <button class="primary submit" :loading="submitting" :disabled="submitting" @click="submit">提交代辦要求</button>
    </view>
    <view class="row section-head"><text class="section-title">我的要求</text><text class="count">{{ requests.length }} 項</text></view>
    <view v-if="!requests.length" class="card empty">暫無要求，提交後可在這裡查看進度。</view>
    <view v-for="item in requests" :key="item.id" class="card request-card" @click="open(item.id)"><view class="row"><text class="request-title">{{ item.title }}</text><text class="pill" :class="item.status==='已完成'?'gray':''">{{ item.status }}</text></view><text class="request-meta">{{ item.route }} · {{ item.plate_asset_id ? '批文卡 '+(plates.find(p=>p.id===item.plate_asset_id)?.card_number||'已關聯') : item.plate || '新申請／未指定車輛' }}</text><view class="request-foot"><view class="stage-dot"></view><text>{{ item.stage }}</text><text class="request-arrow">›</text></view></view>
  </view>
</template>
<script setup>
import { ref,computed,watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api,getUser } from '../../lib/api'
const routes=['粵港','粵澳'],route=ref('粵港'),services=ref([]),vehicles=ref([]),plates=ref([]),requests=ref([]),serviceCode=ref('new_application'),vehicleIndex=ref(0),plateIndex=ref(0),title=ref('新申請代辦'),description=ref(''),submitting=ref(false)
const available=computed(()=>services.value.filter(s=>s.routes.includes(route.value))),availableNames=computed(()=>available.value.map(s=>s.name)),selectedService=computed(()=>available.value.find(s=>s.code===serviceCode.value)),vehicleOptions=computed(()=>vehicles.value.filter(v=>v.route===route.value)),vehicleNames=computed(()=>['不指定／新申請',...vehicleOptions.value.map(v=>v.plate)]),plateOptions=computed(()=>plates.value.filter(p=>p.route===route.value)),plateNames=computed(()=>['不指定兩地牌',...plateOptions.value.map(p=>[p.card_number,p.mainland_plate,p.local_plate].filter(Boolean).join(' · '))])
watch(route,()=>{if(!available.value.some(s=>s.code===serviceCode.value))serviceCode.value=available.value[0]?.code||'';title.value=selectedService.value?.name||'';vehicleIndex.value=0;plateIndex.value=0})
function selectService(e){serviceCode.value=available.value[Number(e.detail.value)]?.code||'';title.value=selectedService.value?.name||'';plateIndex.value=0}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{const[catalog,v,p,r]=await Promise.all([api('/catalog'),api('/vehicles'),api('/plate-assets'),api('/requests')]);services.value=catalog.services;vehicles.value=v;plates.value=p;requests.value=r}catch(e){uni.showToast({title:e.message,icon:'none'})}}
async function submit(){
  if(!serviceCode.value)return uni.showToast({title:'請選擇服務類型',icon:'none'})
  if(!title.value.trim())return uni.showToast({title:'請填寫要求標題',icon:'none'})
  submitting.value=true
  try{
    const vehicle=vehicleOptions.value[vehicleIndex.value-1]
    const plate=serviceCode.value==='new_application'?null:plateOptions.value[plateIndex.value-1]
    const created=await api('/requests','POST',{route:route.value,serviceCode:serviceCode.value,vehicleId:vehicle?.id||null,plateAssetId:plate?.id||null,title:title.value,description:description.value})
    requests.value=[{...created,plate:vehicle?.plate||null},...requests.value]
    title.value=selectedService.value?.name||''
    description.value=''
    vehicleIndex.value=0
    plateIndex.value=0
    uni.showToast({title:'已提交，等待專員受理',icon:'none'})
  }catch(e){uni.showToast({title:e.message,icon:'none'})}finally{submitting.value=false}
}
function open(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
onShow(load)
</script>
<style scoped>
.request-page{padding-top:29rpx}.route-switch{display:flex;gap:8rpx;background:#eaf0eb;border-radius:17rpx;padding:7rpx;margin:31rpx 0 18rpx}.route-option{flex:1;text-align:center;padding:15rpx 10rpx;color:#698072;font-size:24rpx;font-weight:750;border-radius:12rpx}.route-option.active{background:#fff;color:#1d6f53;box-shadow:0 3rpx 11rpx rgba(32,71,44,.08)}.form-card{padding:28rpx}.form-heading{display:flex;align-items:center;gap:15rpx;margin-bottom:18rpx}.form-step{display:flex;align-items:center;justify-content:center;width:51rpx;height:51rpx;border-radius:14rpx;background:#e8f2e9;color:#287c5d;font-size:21rpx;font-weight:800}.form-title{display:block;font-size:28rpx;font-weight:800}.form-desc{display:block;font-size:20rpx;color:#84978a;margin-top:3rpx}.picker{display:flex;align-items:center;justify-content:space-between}.picker-arrow{color:#78917f;font-size:32rpx;line-height:1}.plate-help{display:block;font-size:18rpx;color:#718878;margin-top:7rpx}.description{height:182rpx;line-height:1.5}.notice{display:flex;align-items:flex-start;gap:12rpx;background:#f1f6f2;border-radius:15rpx;padding:18rpx;margin:27rpx 0 0;color:#607768;font-size:20rpx;line-height:1.6}.notice-mark{flex:none;display:flex;align-items:center;justify-content:center;width:30rpx;height:30rpx;border:1rpx solid #a9c8b2;border-radius:50%;color:#3f8a64;font-size:19rpx;font-weight:800}.submit{margin-top:25rpx}.section-head{margin-top:8rpx}.section-head .section-title{margin-bottom:17rpx}.count{font-size:21rpx;color:#789080}.request-card{padding:23rpx 25rpx}.request-title{flex:1;font-size:25rpx;line-height:1.35;font-weight:800}.request-meta{display:block;margin-top:7rpx;font-size:21rpx;color:#82948a}.request-foot{display:flex;align-items:center;gap:9rpx;border-top:1rpx solid #eaf0eb;margin-top:17rpx;padding-top:14rpx;color:#597260;font-size:21rpx}.stage-dot{width:9rpx;height:9rpx;flex:none;background:#53aa7d;border-radius:50%}.request-arrow{margin-left:auto;color:#76a18a;font-size:30rpx;line-height:1}
</style>
