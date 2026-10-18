<template>
  <view class="page create-page">
    <text class="intro">{{ selfManaged ? '拍下批文卡正反面，系統會自動辨識，不用逐欄填寫；請核對一次辨識結果。' : '拍下批文卡正反面，系統會自動辨識，你的顧問會再核對，不用逐欄填寫。' }}</text>
    <view class="segmented route-switch"><text v-for="item in ['粵港','粵澳']" :key="item" class="seg" :class="{on:route===item}" @click="route=item">{{ item }}兩地牌</text></view>
    <!-- 一打開就顯示空白模擬批文卡，拍照辨識後即時填入（管理者 2026-10-18） -->
    <view class="card preview">
      <text class="step-title">第一步：拍下批文卡</text><text class="subtle">正面和背面各一張，光線充足、四角入鏡，辨識最準。</text>
      <ApprovalCard :data="draft"/>
      <view class="upload-actions"><button class="btn-sm" :disabled="busy" @click="pickCard('front')">{{ images.front?'✓ 已拍正面':'拍正面' }}</button><button class="btn-sm" :disabled="busy" @click="pickCard('back')">{{ images.back?'✓ 已拍背面':'拍背面' }}</button></view>
      <text v-if="busy" class="subtle upload-note">正在壓縮和辨識照片，請稍候…</text>
      <text v-else-if="images.front||images.back" class="more" @click="viewPhotos(images.front?'front':'back')">查看已拍的照片 ›</text>
      <text v-if="!images.front&&!images.back&&!showFields" class="more" @click="showFields=true">沒有照片？手動輸入 ›</text>
    </view>
    <view v-if="images.front||images.back||showFields" class="card"><text class="step-title">第二步：確認辨識結果</text>
      <view><text class="field-label">批文卡編號（必填）<text v-if="fieldStatusText(fieldStatus.cardNumber)" class="field-status" :class="fieldStatusClass(fieldStatus.cardNumber)">{{ fieldStatusText(fieldStatus.cardNumber) }}</text></text><input class="field num" v-model="draft.cardNumber" placeholder="按批文卡正面「編號」填寫"/></view>
      <text class="subtle field-hint">{{ selfManaged ? '請對照批文卡核對；發現辨識錯誤可以直接修改。' : '其他內容顧問會對照原件核對；發現辨識錯誤也可以自行修改。' }}</text>
      <view class="holder"><text class="field-label">持牌公司</text><text class="holder-text">{{ holderText }}</text>
        <picker v-if="link.groups.length" :range="groupOptions" range-key="label" @change="groupId=groupOptions[Number($event.detail.value)].id"><text class="more">{{ groupId ? '改選或改回自動判斷 ›' : '不對？改選名下其他公司組 ›' }}</text></picker></view>
      <text class="more" @click="showFields=!showFields">{{ showFields ? '收起全部欄位' : '查看或修改全部欄位 ›' }}</text>
      <view v-if="showFields"><view v-for="field in fields.filter(f=>f.key!=='cardNumber')" :key="field.key"><text class="field-label">{{ field.label }}<text v-if="fieldStatusText(fieldStatus[field.key])" class="field-status" :class="fieldStatusClass(fieldStatus[field.key])">{{ fieldStatusText(fieldStatus[field.key]) }}</text></text><input class="field" v-model="draft[field.key]" placeholder="按批文卡填寫"/></view></view>
    </view>
    <button class="primary save-file" :disabled="busy" @click="create">{{ busy?'處理中…':selfManaged?'建立牌照':'提交給顧問核對' }}</button>
    <text class="link request-link" @click="goRequests">還沒有批文卡、要申請新牌？前往申請辦理 ›</text>
    <CardCapture ref="capture"/>
    <wd-message-box />
  </view>
</template>
<script setup>
import { ref,computed,watch,onBeforeUnmount } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'
import { api,getUser,isSelfManaged } from '../../lib/api'
import { useConfirm } from '../../lib/choice'
import ApprovalCard from '../../components/ApprovalCard.vue'
import CardCapture from '../../components/CardCapture.vue'
// 自管客戶自己建檔，不經顧問核對
const selfManaged=isSelfManaged()
const capture=ref(null),confirmBox=useConfirm()
const route=ref('粵港'),draft=ref({}),images=ref({}),previews=ref({}),busy=ref(false),showFields=ref(false),fieldStatus=ref({})
// 持牌公司：按批文卡的商號、內承單位找名下公司；找不到就只用名稱新建，之後在「我的公司」補資料
const link=ref({groupId:null,groupName:'',companies:[],groups:[]}),groupId=ref('')
const groupOptions=computed(()=>[{id:'',label:'按批文卡自動判斷'},...link.value.groups.map(g=>({id:g.id,label:g.name}))])
const holderText=computed(()=>{
  if(groupId.value)return '將連到：'+(link.value.groups.find(g=>g.id===groupId.value)?.name||'')
  const fresh=link.value.companies.filter(c=>!c.existing).map(c=>c.name)
  if(link.value.groupId)return '將連到你已有的公司：'+link.value.groupName+(fresh.length?'；'+fresh.join('、')+' 會加到這組':'')
  if(fresh.length)return '會新建公司：'+fresh.join('、')+'。建檔後在「我的公司」補上登記號碼等資料即可。'
  return selfManaged?'未辨識到商號；建立後可在「我的公司」補上。':'未辨識到商號，你的顧問核對時會連到你的公司。'
})
let linkTimer=0
watch(()=>[route.value,draft.value.company,draft.value.contractor],()=>{clearTimeout(linkTimer);linkTimer=setTimeout(async()=>{try{link.value=await api('/my/plate-companies?route='+encodeURIComponent(route.value)+'&company='+encodeURIComponent(draft.value.company||'')+'&contractor='+encodeURIComponent(draft.value.contractor||''))}catch{}},400)},{immediate:true})
const fields=[['cardNumber','批文卡編號'],['company','商號'],['contractor','內承單位'],['crossing','通行口岸'],['serial','卡面流水號'],['mainlandPlate','內地車牌號'],['localPlate','港澳車牌號'],['driver1','駕駛人 1'],['driver2','駕駛人 2'],['driver3','駕駛人 3'],['currentApproval','現批文號'],['previousApproval','原批文號'],['color','顏色'],['seats','座位／噸位'],['purpose','請予辦理'],['validFrom','有效期開始'],['validTo','有效期結束'],['notes','備註']].map(([key,label])=>({key,label,placeholder:key==='cardNumber'?'必填，按批文卡編號填寫':''}))
// 錄入到一半離開：已拍相片或填過資料時先問是否放棄（返回鍵、導航返回）；網頁版關閉或重新整理分頁時由瀏覽器提示
const dirty=computed(()=>Boolean(images.value.front||images.value.back||Object.values(draft.value).some(value=>String(value||'').trim())))
let leaving=false
onBackPress(()=>{if(capture.value?.isOpen()){capture.value.cancel();return true}if(leaving||!dirty.value)return false;confirmBox.ask({title:'放棄這次錄入？',msg:'已拍的相片和填寫的資料不會保存。',ok:'放棄',cancel:'繼續錄入'}).then(r=>{if(r==='confirm'){leaving=true;uni.navigateBack()}});return true})
// #ifdef H5
const warnUnload=event=>{if(!leaving&&dirty.value){event.preventDefault();event.returnValue=''}}
window.addEventListener('beforeunload',warnUnload)
onBeforeUnmount(()=>window.removeEventListener('beforeunload',warnUnload))
// #endif
function fieldStatusText(status){return status?.status==='uncertain'?'請核對':status?.status==='failed'?'未能辨識，請手動填寫':''}
function fieldStatusClass(status){return status?.status==='failed'?'failed':'uncertain'}
// 先開對準框，只取框內卡面辨識和保存（管理者 2026-10-18）
async function pickCard(side){if(busy.value)return;const photo=await capture.value.open({side});if(!photo)return;busy.value=true;uni.showLoading({title:'正在辨識批文卡…',mask:true});try{const image=photo.data;images.value={...images.value,[side]:image};previews.value={...previews.value,[side]:photo.path};const recognized=await api('/card-recognize','POST',{side,image});const next={...draft.value};for(const [key,value] of Object.entries(recognized.cardData||{}))if(value&&!next[key])next[key]=value;draft.value=next;fieldStatus.value={...fieldStatus.value,...(recognized.fieldStatus||{})};uni.hideLoading();uni.showToast({title:'已辨識，請確認編號',icon:'none'})}catch(e){uni.hideLoading();uni.showToast({title:e.message||'上傳失敗',icon:'none'})}finally{busy.value=false}}
async function create(){if(busy.value)return;const cardNumber=String(draft.value.cardNumber||'').trim();if(!cardNumber)return uni.showToast({title:images.value.front||images.value.back?'未能辨識編號，請手動填寫':'請先拍下批文卡',icon:'none'});const user=getUser();if(!user?.customerId)return uni.navigateTo({url:'/pages/login/login'});busy.value=true;try{const plate=await api('/plate-assets','POST',{customerId:user.customerId,route:route.value,cardData:{...draft.value,cardNumber},cardImages:images.value,groupId:groupId.value});leaving=true;uni.redirectTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(plate.id)})}catch(e){uni.showToast({title:e.message||'建檔失敗',icon:'none'})}finally{busy.value=false}}
// 預覽剛拍的照片，方便對照辨識結果
function viewPhotos(side){const sides=['front','back'].filter(s=>previews.value[s]);uni.previewImage({urls:sides.map(s=>previews.value[s]),current:previews.value[side]||previews.value[sides[0]]})}
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
.holder{margin-top:4px}.holder-text{display:block;color:var(--ink-2);font-size:var(--fs-body);line-height:1.6}
.save-file{margin-top:4px}
.request-link{display:block;text-align:center;padding:16px 0}
</style>
