<template>
  <view class="page create-page">
    <text class="eyebrow">現有兩地牌 / APPROVAL CARD</text><text class="page-title">登記現有批文卡</text>
    <text class="subtle">一張批文卡建立一個兩地牌檔案；申請新牌請前往「申請代辦」。</text>
    <view class="route-switch"><button v-for="item in ['粵港','粵澳']" :key="item" :class="{active:route===item}" @click="route=item">{{ item }}兩地牌</button></view>
    <view class="section"><text class="section-title">1　批文卡來源</text><text class="section-note">可上傳正反面辨識，再核對內容；也可以直接手動填寫。</text>
      <view class="upload-actions"><button :disabled="busy" @click="pickCard('front')">{{ images.front?'更換正面':'上傳正面' }}</button><button :disabled="busy" @click="pickCard('back')">{{ images.back?'更換背面':'上傳背面' }}</button></view>
      <text v-if="images.front||images.back" class="upload-note">已暫存：{{ images.front?'正面 ':'' }}{{ images.back?'背面':'' }}。建立檔案後原件會保存在該檔案中。</text>
    </view>
    <view class="section"><text class="section-title">2　核對批文卡內容</text><text class="section-note">批文卡編號是建檔識別資料。尚未取得批文卡，請在申請代辦建立案件。</text>
      <view class="field" v-for="field in fields" :key="field.key"><text>{{ field.label }}{{ field.key==='cardNumber'?' *':'' }}</text><input v-model="draft[field.key]" :placeholder="field.placeholder||'按批文卡填寫'"/></view>
    </view>
    <view class="section preview"><text class="section-title">3　確認模擬卡</text><ApprovalCard :data="draft"/><text class="section-note">請對照原件核對正反面；建立後仍可在檔案中修改並保留版本紀錄。</text></view>
    <button class="save-file" :disabled="busy" @click="create">{{ busy?'處理中…':'確認並建立兩地牌檔案' }}</button>
    <button class="request-link" @click="goRequests">還沒有批文卡？前往申請代辦 ›</button>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { api,getUser } from '../../lib/api'
import ApprovalCard from '../../components/ApprovalCard.vue'
const route=ref('粵港'),draft=ref({}),images=ref({}),busy=ref(false)
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
function pickCard(side){uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{busy.value=true;try{const image=await imageData(result);images.value={...images.value,[side]:image};const recognized=await api('/card-recognize','POST',{side,image});const next={...draft.value};for(const [key,value] of Object.entries(recognized.cardData||{}))if(value&&!next[key])next[key]=value;draft.value=next;uni.showToast({title:'已辨識，請核對欄位',icon:'none'})}catch(e){uni.showToast({title:e.message||'上傳失敗',icon:'none'})}finally{busy.value=false}}})}
async function create(){if(busy.value)return;const cardNumber=String(draft.value.cardNumber||'').trim();if(!cardNumber)return uni.showToast({title:'請填寫批文卡編號',icon:'none'});const user=getUser();if(!user?.customerId)return uni.navigateTo({url:'/pages/login/login'});busy.value=true;try{const plate=await api('/plate-assets','POST',{customerId:user.customerId,route:route.value,cardData:{...draft.value,cardNumber},cardImages:images.value});uni.redirectTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(plate.id)})}catch(e){uni.showToast({title:e.message||'建檔失敗',icon:'none'})}finally{busy.value=false}}
function goRequests(){uni.switchTab({url:'/pages/requests/requests'})}
</script>
<style scoped>
.create-page{padding-top:29rpx;padding-bottom:50rpx}.route-switch{display:flex;gap:10rpx;margin:24rpx 0}.route-switch button{flex:1;margin:0;background:#e7eee8;color:#496b56;font-size:21rpx}.route-switch button.active{background:#1d674d;color:white}.section{background:white;border:1rpx solid #dfe9e1;border-radius:17rpx;padding:22rpx;margin:20rpx 0}.section-title{display:block;color:#214b37;font-size:25rpx;font-weight:800}.section-note{display:block;color:#718878;font-size:19rpx;line-height:1.5;margin:8rpx 0 12rpx}.upload-actions{display:flex;gap:12rpx}.upload-actions button{flex:1;margin:0;background:#e7f1e9;color:#235b42;font-size:20rpx}.upload-note{display:block;color:#37694f;font-size:18rpx;margin-top:13rpx}.field{margin:17rpx 0}.field text{display:block;color:#496853;font-size:19rpx;font-weight:700;margin-bottom:7rpx}.field input{height:57rpx;border:1rpx solid #cbdacf;border-radius:9rpx;padding:0 12rpx;background:#fbfcfb;font-size:21rpx}.preview :deep(.flip-controls){margin-top:9rpx}.save-file{background:#1d674d;color:white;font-size:22rpx;font-weight:800;margin:22rpx 0 0}.request-link{background:transparent;color:#347052;font-size:20rpx;margin:13rpx 0 0}
</style>
