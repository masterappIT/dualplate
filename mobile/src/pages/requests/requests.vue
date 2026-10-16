<template>
  <view class="page request-page">
    <text class="intro">選擇要辦的事，提交後你的顧問會聯絡你，並列出需要準備的資料。</text>
    <view v-if="lockedPlate" class="card locked"><text class="side-label">為這個牌照辦理</text><view class="plates"><PlateChip :plate="lockedPlate.mainland_plate" region="內地" /><PlateChip v-if="lockedPlate.local_plate" :plate="lockedPlate.local_plate" :region="lockedPlate.route==='粵澳'?'澳門':'香港'" /></view></view>
    <view v-if="!lockedPlate" class="segmented route-switch"><text v-for="r in routes" :key="r" class="seg" :class="{on:route===r}" @click="route=r">{{ r }}服務</text></view>
    <view class="card form-card">
      <text class="form-title">要辦甚麼？</text><text class="subtle">不確定就選「其他代辦要求」，寫下情況即可。</text>
      <view class="chips"><text v-for="s in shownServices" :key="s.code" class="chip" :class="{active:serviceCode===s.code}" @click="pickService(s.code)">{{ s.name }}</text></view>
      <template v-if="needsPlate && !lockedPlate"><text class="field-label">哪個牌照？</text><picker :range="plateNames" @change="plateIndex=Number($event.detail.value)"><view class="field picker" :class="{placeholder:!plateIndex}"><text>{{ plateNames[plateIndex] }}</text><text class="chev">›</text></view></picker></template>
      <text class="field-label">補充說明（可不填）</text><textarea class="field description" v-model="description" placeholder="例如新車資料、希望完成的日期" />
      <button class="primary submit" :loading="submitting" :disabled="submitting" @click="submit">提交</button>
    </view>
    <view class="section-head"><text class="section-title">我的辦理記錄</text><text class="subtle num">{{ requests.length }} 項</text></view>
    <view v-if="!requests.length" class="card empty">還沒有辦理記錄，提交後可在這裡看進度。</view>
    <view v-else class="card list"><view v-for="item in requests" :key="item.id" class="line" @click="open(item.id)"><view class="row"><text class="line-title grow">{{ item.title }}</text><text class="pill" :class="requestTone(customerStatus(item.status))">{{ customerStatus(item.status) }}</text></view><view class="req-meta"><PlateChip v-if="plateOf(item)" :plate="plateOf(item)" region="內地" size="sm" /><text class="line-sub">{{ clientStage(item.stage) }}</text></view></view></view>
  </view>
</template>
<script setup>
import { ref,computed,watch,nextTick } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { api,getUser,requestTone,clientStage } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
const routes=['粵港','粵澳'],route=ref('粵港'),services=ref([]),vehicles=ref([]),plates=ref([]),requests=ref([]),serviceCode=ref(''),vehicleIndex=ref(0),plateIndex=ref(0),title=ref(''),description=ref(''),submitting=ref(false)
const available=computed(()=>services.value.filter(s=>s.routes.includes(route.value))),availableNames=computed(()=>available.value.map(s=>s.name)),selectedService=computed(()=>available.value.find(s=>s.code===serviceCode.value)),vehicleOptions=computed(()=>vehicles.value.filter(v=>v.route===route.value)),vehicleNames=computed(()=>['不指定／新申請',...vehicleOptions.value.map(v=>v.plate)]),plateOptions=computed(()=>plates.value.filter(p=>p.route===route.value)),plateNames=computed(()=>[serviceCode.value==='other'?'不指定牌照':'請選擇牌照',...plateOptions.value.map(p=>[p.mainland_plate,p.local_plate].filter(Boolean).join(' · ')||p.card_number)])
// 新申請不用選牌照；其他業務要選，「其他代辦要求」可不指定
const needsPlate=computed(()=>!!serviceCode.value&&serviceCode.value!=='new_application')
watch(route,()=>{if(!available.value.some(s=>s.code===serviceCode.value))serviceCode.value='';title.value=selectedService.value?.name||'';vehicleIndex.value=0;plateIndex.value=0})
function selectService(e){serviceCode.value=available.value[Number(e.detail.value)]?.code||'';title.value=selectedService.value?.name||'';plateIndex.value=0}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{const[catalog,v,p,r]=await Promise.all([api('/catalog'),api('/vehicles'),api('/plate-assets'),api('/requests')]);services.value=catalog.services;vehicles.value=v;plates.value=p;requests.value=r;await applyWanted()}catch(e){uni.showToast({title:e.message,icon:'none'})}}
async function submit(){
  if(!serviceCode.value)return uni.showToast({title:'請先選擇要辦的事',icon:'none'})
  if(needsPlate.value&&serviceCode.value!=='other'&&plateOptions.value.length&&!plateIndex.value)return uni.showToast({title:'請選擇哪個牌照',icon:'none'})
  if(!title.value.trim())return uni.showToast({title:'請先選擇要辦的事',icon:'none'})
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
// 列表回傳內部狀態，換成客戶看得懂的說法（與辦理進度頁一致）
const customerStatus=status=>({待開始:'已收到',新要求:'已收到',進行中:'辦理中',待收件:'辦理中',待客戶提供:'需要你提供資料',待客戶配合:'需要你提供資料'}[status]||status)
function plateOf(item){return plates.value.find(p=>p.id===item.plate_asset_id)?.mainland_plate||''}
function open(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
onShow(load)
</script>
<style scoped>
.route-switch{margin-bottom:12px}
.locked{display:flex;flex-direction:column;gap:8px}.side-label{color:var(--ink-3);font-size:var(--fs-meta);font-weight:700}.plates{display:flex;flex-wrap:wrap;gap:8px}
.form-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.picker{display:flex;align-items:center;justify-content:space-between}.picker.placeholder{color:var(--ink-3)}
.description{height:96px;line-height:1.5}
.submit{margin-top:16px}
.list{padding:4px 16px}
.line{padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.line-sub{font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.req-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px}
</style>
