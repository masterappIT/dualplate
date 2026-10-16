<template>
  <view class="page create-page">
    <text class="intro">拍下批文卡正反面，系統會自動辨識，你的顧問會再核對，不用逐欄填寫。</text>
    <view class="segmented route-switch"><text v-for="item in ['粵港','粵澳']" :key="item" class="seg" :class="{on:route===item}" @click="route=item">{{ item }}兩地牌</text></view>
    <view class="card">
      <text class="step-title">第一步：拍下批文卡</text><text class="subtle">正面和背面各一張，光線充足、四角入鏡，辨識最準。</text>
      <view class="upload-actions"><button class="btn-sm" :disabled="busy" @click="pickCard('front')">{{ images.front?'✓ 已拍正面':'拍正面' }}</button><button class="btn-sm" :disabled="busy" @click="pickCard('back')">{{ images.back?'✓ 已拍背面':'拍背面' }}</button></view>
      <text v-if="busy" class="subtle upload-note">正在辨識，請稍候…</text>
      <text v-if="!images.front&&!images.back&&!showFields" class="more" @click="showFields=true">沒有照片？手動輸入 ›</text>
    </view>
    <view v-if="images.front||images.back||showFields" class="card preview"><text class="step-title">第二步：確認辨識結果</text><ApprovalCard :data="draft"/>
      <view><text class="field-label">批文卡編號（必填）<text v-if="fieldStatusText(fieldStatus.cardNumber)" class="field-status" :class="fieldStatusClass(fieldStatus.cardNumber)">{{ fieldStatusText(fieldStatus.cardNumber) }}</text></text><input class="field num" v-model="draft.cardNumber" placeholder="按批文卡正面「編號」填寫"/></view>
      <text class="subtle field-hint">其他內容顧問會對照原件核對；發現辨識錯誤也可以自行修改。</text>
      <text class="more" @click="showFields=!showFields">{{ showFields ? '收起全部欄位' : '查看或修改全部欄位 ›' }}</text>
      <view v-if="showFields"><view v-for="field in fields.filter(f=>f.key!=='cardNumber')" :key="field.key"><text class="field-label">{{ field.label }}<text v-if="fieldStatusText(fieldStatus[field.key])" class="field-status" :class="fieldStatusClass(fieldStatus[field.key])">{{ fieldStatusText(fieldStatus[field.key]) }}</text></text><input class="field" v-model="draft[field.key]" placeholder="按批文卡填寫"/></view></view>
    </view>
    <button class="primary save-file" :disabled="busy" @click="create">{{ busy?'處理中…':'提交給顧問核對' }}</button>
    <text class="link request-link" @click="goRequests">還沒有批文卡、要申請新牌？前往申請辦理 ›</text>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { api,getUser } from '../../lib/api'
import ApprovalCard from '../../components/ApprovalCard.vue'
const route=ref('粵港'),draft=ref({}),images=ref({}),busy=ref(false),showFields=ref(false),fieldStatus=ref({})
const fields=[['cardNumber','批文卡編號'],['company','商號'],['contractor','內承單位'],['crossing','通行口岸'],['serial','卡面流水號'],['mainlandPlate','內地車牌號'],['localPlate','港澳車牌號'],['driver1','駕駛人 1'],['driver2','駕駛人 2'],['driver3','駕駛人 3'],['currentApproval','現批文號'],['previousApproval','原批文號'],['color','顏色'],['seats','座位／噸位'],['purpose','請予辦理'],['validFrom','有效期開始'],['validTo','有效期結束'],['notes','備註']].map(([key,label])=>({key,label,placeholder:key==='cardNumber'?'必填，按批文卡編號填寫':''}))
async function imageData(result){
  // #ifdef H5
  const picked=result.tempFiles?.[0]?.file||result.tempFiles?.[0]
  const blob=picked instanceof Blob?picked:await (await fetch(result.tempFilePaths[0])).blob()
  if(blob.size>3500000)throw new Error('圖片不可超過 3.5 MB')
  return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('讀取圖片失敗'));reader.readAsDataURL(blob)})
  // #endif
  // #ifndef H5
  const file=result.tempFilePaths[0]
  const base64=await new Promise((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:file,encoding:'base64',success:x=>resolve(x.data),fail:reject}))
  return `data:${/\.png$/i.test(file)?'image/png':'image/jpeg'};base64,${base64}`
  // #endif
}
function fieldStatusText(status){return status?.status==='uncertain'?'請核對':status?.status==='failed'?'未能辨識，請手動填寫':''}
function fieldStatusClass(status){return status?.status==='failed'?'failed':'uncertain'}
function pickCard(side){uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{busy.value=true;try{const image=await imageData(result);images.value={...images.value,[side]:image};const recognized=await api('/card-recognize','POST',{side,image});const next={...draft.value};for(const [key,value] of Object.entries(recognized.cardData||{}))if(value&&!next[key])next[key]=value;draft.value=next;fieldStatus.value={...fieldStatus.value,...(recognized.fieldStatus||{})};uni.showToast({title:'已辨識，請確認編號',icon:'none'})}catch(e){uni.showToast({title:e.message||'上傳失敗',icon:'none'})}finally{busy.value=false}}})}
async function create(){if(busy.value)return;const cardNumber=String(draft.value.cardNumber||'').trim();if(!cardNumber)return uni.showToast({title:images.value.front||images.value.back?'未能辨識編號，請手動填寫':'請先拍下批文卡',icon:'none'});const user=getUser();if(!user?.customerId)return uni.navigateTo({url:'/pages/login/login'});busy.value=true;try{const plate=await api('/plate-assets','POST',{customerId:user.customerId,route:route.value,cardData:{...draft.value,cardNumber},cardImages:images.value});uni.redirectTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(plate.id)})}catch(e){uni.showToast({title:e.message||'建檔失敗',icon:'none'})}finally{busy.value=false}}
function goRequests(){uni.navigateTo({url:'/pages/requests/requests?service=new_application'})}
</script>
<style scoped>
.route-switch{margin-bottom:12px}
.step-title{display:block;margin-bottom:4px;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.upload-actions{display:flex;gap:8px;margin-top:12px}.upload-actions .btn-sm{flex:1}
.upload-note{margin-top:8px}
.more{display:block;padding-top:12px;color:var(--jade);font-size:var(--fs-body);font-weight:700}
.preview :deep(.approval-preview){margin-top:12px}
.field-status{margin-left:8px;color:var(--due);font-size:var(--fs-cap);font-weight:700}.field-status.failed{color:var(--overdue)}
.field-hint{margin-top:8px}
.save-file{margin-top:4px}
.request-link{display:block;text-align:center;padding:16px 0}
</style>
