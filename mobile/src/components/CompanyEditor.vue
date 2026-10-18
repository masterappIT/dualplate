<template>
  <view class="inline-editor">
    <text class="field-label">公司名稱</text><input class="field" v-model="form.name" :placeholder="company.jurisdiction==='內地' ? '按營業執照填寫（簡體字）' : '按商業登記證填寫'"/>
    <template v-if="company.jurisdiction==='香港'"><text class="field-label">英文名稱</text><input class="field" v-model="form.nameEn" placeholder="按公司註冊證書填寫"/></template>
    <text class="field-label">{{ regLabel }}</text><input class="field num" v-model="form.registrationNo" :placeholder="'按證件填寫'+regLabel"/>
    <template v-if="company.jurisdiction==='香港'"><text class="field-label">公司編號</text><input class="field num" v-model="form.companyNumber" placeholder="公司註冊證書上的編號"/></template>
    <text class="field-label">成立日期</text>
    <picker mode="date" :value="form.incorporatedOn" @change="form.incorporatedOn=$event.detail.value"><view class="field picker"><text>{{ form.incorporatedOn || '選擇日期' }}</text><text class="chev">›</text></view></picker>
    <template v-if="company.jurisdiction==='內地'"><text class="field-label">納稅人類型</text>
      <picker :range="taxpayerTypes" @change="form.taxpayerType=taxpayerTypes[Number($event.detail.value)]"><view class="field picker"><text>{{ form.taxpayerType || '選擇類型' }}</text><text class="chev">›</text></view></picker></template>
    <text class="subtle editor-note">{{ forMode('修改後立即生效，你的顧問會再核對。','修改後立即生效。') }}</text>
    <view class="editor-actions"><button class="btn-sm" @click="emit('close')">取消</button><button class="btn-sm solid" :disabled="saving" @click="save">{{ saving ? '正在儲存…' : '儲存公司資料' }}</button></view>
    <wd-message-box />
  </view>
</template>
<script setup>
import { useConfirm } from '../lib/choice'
const confirmBox=useConfirm()
import { ref,computed } from 'vue'
import { api,forMode } from '../lib/api'
// 客戶自行修改公司資料：只送出該司法區有的欄位（納稅人類型只屬內地公司）
const props=defineProps({company:{type:Object,required:true}})
const emit=defineEmits(['close','saved'])
const taxpayerTypes=['小規模納稅人','一般納稅人']
const c=props.company
const form=ref({name:c.name||'',nameEn:c.nameEn||'',registrationNo:c.registrationNo||'',companyNumber:c.companyNumber||'',incorporatedOn:c.incorporatedOn||'',taxpayerType:c.taxpayerType||''})
const saving=ref(false)
const regLabel=computed(()=>c.jurisdiction==='內地'?'統一社會信用代碼':c.jurisdiction==='澳門'?'商業登記編號':'商業登記號碼')
function payload(){const f=form.value,body={name:f.name,registrationNo:f.registrationNo,incorporatedOn:f.incorporatedOn};if(c.jurisdiction==='香港')Object.assign(body,{nameEn:f.nameEn,companyNumber:f.companyNumber});if(c.jurisdiction==='內地'&&f.taxpayerType)body.taxpayerType=f.taxpayerType;return body}
async function save(){if(saving.value)return;saving.value=true;try{await api('/my/companies/'+c.id,'PATCH',payload());uni.showToast({title:forMode('已更新，顧問會再核對','已更新'),icon:'none'});emit('saved')}catch(e){
  // 內地公司名稱有繁體字時，伺服器給出簡體建議，讓客戶一鍵套用
  if(e.data?.suggestion)confirmBox.ask({title:'公司名稱要用簡體字',msg:'建議改為：'+e.data.suggestion,ok:'套用',cancel:'不用'}).then(r=>{if(r==='confirm')form.value.name=e.data.suggestion})
  else uni.showToast({title:e.message,icon:'none'})
}finally{saving.value=false}}
</script>
<style scoped>
.editor-note{margin-top:12px}
</style>
