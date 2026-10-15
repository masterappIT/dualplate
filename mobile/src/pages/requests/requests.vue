<template>
  <view class="page request-page">
    <text class="eyebrow">申請辦理 / REQUEST</text><text class="page-title">{{ lockedPlate ? '為這個牌照辦理' : '申請辦理' }}</text><text class="subtle">選擇要辦的事，提交後你的顧問會聯絡你並列出需要的資料。</text>
    <view v-if="lockedPlate" class="card locked"><text class="locked-title">{{ [lockedPlate.mainland_plate, lockedPlate.local_plate].filter(Boolean).join(' · ') }}</text><text class="locked-sub">{{ lockedPlate.route }}兩地牌 · 批文卡 {{ lockedPlate.card_number }}</text></view>
    <view v-if="!lockedPlate" class="route-switch"><view v-for="r in routes" :key="r" class="route-option" :class="{active:route===r}" @click="route=r">{{ r }}服務</view></view>
    <view class="card form-card"><view class="form-heading"><view class="form-step">01</view><view><text class="form-title">要辦甚麼？</text><text class="form-desc">不確定就選「其他」，寫下情況即可</text></view></view>
      <view class="chips"><text v-for="(s,i) in shownServices" :key="s.code" class="chip" :class="{active:serviceCode===s.code}" @click="pickService(s.code)">{{ s.name }}</text></view>
      <template v-if="serviceCode!=='new_application' && !lockedPlate"><text class="field-label">哪個牌照？</text><picker :range="plateNames" @change="plateIndex=Number($event.detail.value)"><view class="field picker"><text>{{ plateNames[plateIndex] }}</text><text class="picker-arrow">⌄</text></view></picker></template>
      
      <text class="field-label">補充說明（可不填）</text><textarea class="field description" v-model="description" placeholder="例如新車資料、希望完成的日期" />
      <view class="notice"><view class="notice-mark">i</view><text>提交後顧問會核對並告訴你需要準備的資料，進度可在「辦理進度」查看。</text></view>
      <button class="primary submit" :loading="submitting" :disabled="submitting" @click="submit">提交</button>
    </view>
    <view class="row section-head"><text class="section-title">我的辦理記錄</text><text class="count">{{ requests.length }} 項</text></view>
    <view v-if="!requests.length" class="card empty">暫無要求，提交後可在這裡查看進度。</view>
    <view v-for="item in requests" :key="item.id" class="card request-card" @click="open(item.id)"><view class="row"><text class="request-title">{{ item.title }}</text><text class="pill" :class="item.status==='已完成'?'gray':''">{{ item.status }}</text></view><text class="request-meta">{{ item.route }} · {{ item.plate_asset_id ? '批文卡 '+(plates.find(p=>p.id===item.plate_asset_id)?.card_number||'已關聯') : item.plate || '新申請／未指定車輛' }}</text><view class="request-foot"><view class="stage-dot"></view><text>{{ item.stage }}</text><text class="request-arrow">›</text></view></view>
  </view>
</template>
<script setup>
import { ref,computed,watch,nextTick } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { api,getUser } from '../../lib/api'
const routes=['粵港','粵澳'],route=ref('粵港'),services=ref([]),vehicles=ref([]),plates=ref([]),requests=ref([]),serviceCode=ref('new_application'),vehicleIndex=ref(0),plateIndex=ref(0),title=ref('新申請代辦'),description=ref(''),submitting=ref(false)
const available=computed(()=>services.value.filter(s=>s.routes.includes(route.value))),availableNames=computed(()=>available.value.map(s=>s.name)),selectedService=computed(()=>available.value.find(s=>s.code===serviceCode.value)),vehicleOptions=computed(()=>vehicles.value.filter(v=>v.route===route.value)),vehicleNames=computed(()=>['不指定／新申請',...vehicleOptions.value.map(v=>v.plate)]),plateOptions=computed(()=>plates.value.filter(p=>p.route===route.value)),plateNames=computed(()=>['不指定兩地牌',...plateOptions.value.map(p=>[p.card_number,p.mainland_plate,p.local_plate].filter(Boolean).join(' · '))])
watch(route,()=>{if(!available.value.some(s=>s.code===serviceCode.value))serviceCode.value=available.value[0]?.code||'';title.value=selectedService.value?.name||'';vehicleIndex.value=0;plateIndex.value=0})
function selectService(e){serviceCode.value=available.value[Number(e.detail.value)]?.code||'';title.value=selectedService.value?.name||'';plateIndex.value=0}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{const[catalog,v,p,r]=await Promise.all([api('/catalog'),api('/vehicles'),api('/plate-assets'),api('/requests')]);services.value=catalog.services;vehicles.value=v;plates.value=p;requests.value=r;await applyWanted()}catch(e){uni.showToast({title:e.message,icon:'none'})}}
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
    uni.showToast({title:'已提交，顧問會盡快聯絡你',icon:'none'});if(lockedPlate.value)setTimeout(()=>uni.redirectTo({url:'/pages/request-detail/request-detail?id='+created.id}),600)
  }catch(e){uni.showToast({title:e.message,icon:'none'})}finally{submitting.value=false}
}
// Opened from a plate's quick actions: the plate and service arrive pre-selected.
let wanted={service:'',plate:''}
const lockedPlate=computed(()=>plates.value.find(p=>p.id===wanted.plate)||null)
const shownServices=computed(()=>lockedPlate.value?available.value.filter(s=>s.code!=='new_application'):available.value)
function pickService(code){serviceCode.value=code;title.value=selectedService.value?.name||''}
onLoad(options=>{wanted={service:decodeURIComponent(options.service||''),plate:decodeURIComponent(options.plate||'')}})
// The route watcher resets the selections, so wait for it before applying the plate.
async function applyWanted(){const plate=lockedPlate.value;if(plate){route.value=plate.route;await nextTick();const index=plateOptions.value.findIndex(p=>p.id===plate.id);plateIndex.value=index+1;const vIndex=vehicleOptions.value.findIndex(v=>v.id===plate.vehicle_id);vehicleIndex.value=vIndex+1}if(wanted.service&&available.value.some(s=>s.code===wanted.service))pickService(wanted.service)}
function open(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
onShow(load)
</script>
<style scoped>
.request-page{padding-top:29rpx}.route-switch{display:flex;gap:8rpx;background:#eaf0eb;border-radius:17rpx;padding:7rpx;margin:31rpx 0 18rpx}.route-option{flex:1;text-align:center;padding:15rpx 10rpx;color:#698072;font-size:24rpx;font-weight:750;border-radius:12rpx}.route-option.active{background:#fff;color:#1d6f53;box-shadow:0 3rpx 11rpx rgba(32,71,44,.08)}.form-card{padding:28rpx}.form-heading{display:flex;align-items:center;gap:15rpx;margin-bottom:18rpx}.form-step{display:flex;align-items:center;justify-content:center;width:51rpx;height:51rpx;border-radius:14rpx;background:#e8f2e9;color:#287c5d;font-size:21rpx;font-weight:800}.form-title{display:block;font-size:28rpx;font-weight:800}.form-desc{display:block;font-size:20rpx;color:#84978a;margin-top:3rpx}.picker{display:flex;align-items:center;justify-content:space-between}.picker-arrow{color:#78917f;font-size:32rpx;line-height:1}.plate-help{display:block;font-size:18rpx;color:#718878;margin-top:7rpx}.description{height:182rpx;line-height:1.5}.notice{display:flex;align-items:flex-start;gap:12rpx;background:#f1f6f2;border-radius:15rpx;padding:18rpx;margin:27rpx 0 0;color:#607768;font-size:20rpx;line-height:1.6}.notice-mark{flex:none;display:flex;align-items:center;justify-content:center;width:30rpx;height:30rpx;border:1rpx solid #a9c8b2;border-radius:50%;color:#3f8a64;font-size:19rpx;font-weight:800}.submit{margin-top:25rpx}.section-head{margin-top:8rpx}.section-head .section-title{margin-bottom:17rpx}.count{font-size:21rpx;color:#789080}.request-card{padding:23rpx 25rpx}.request-title{flex:1;font-size:25rpx;line-height:1.35;font-weight:800}.request-meta{display:block;margin-top:7rpx;font-size:21rpx;color:#82948a}.request-foot{display:flex;align-items:center;gap:9rpx;border-top:1rpx solid #eaf0eb;margin-top:17rpx;padding-top:14rpx;color:#597260;font-size:21rpx}.stage-dot{width:9rpx;height:9rpx;flex:none;background:#53aa7d;border-radius:50%}.request-arrow{margin-left:auto;color:#76a18a;font-size:30rpx;line-height:1}
.locked{margin-top:22rpx}.locked-title{display:block;font-size:30rpx;font-weight:800}.locked-sub{display:block;margin-top:6rpx;color:#71857a;font-size:22rpx}
</style>
