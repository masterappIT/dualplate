<template>
  <view class="page terms-page">
    <!-- 服務條款及私隱聲明：未登入可看（登入頁連結）；登入後未同意最新版本時可在這裏同意。強制模式下同意前不能使用其他功能 -->
    <view v-if="needAccept && forced" class="list-card warn-card"><text class="list-title">請先閱讀並同意</text><text class="list-sub">服務條款及私隱聲明已更新，同意後才可繼續使用。</text></view>
    <view v-else-if="needAccept" class="list-card warn-card"><text class="list-title">{{ doc.everAccepted ? '服務條款已更新' : '請先閱讀服務條款' }}</text><text class="list-sub">{{ doc.everAccepted ? '請閱讀並同意最新版本。' : '開始使用前，請閱讀並同意以下條款及私隱聲明。' }}</text></view>
    <view v-if="loaded && !doc" class="card empty">服務條款尚未發佈。</view>
    <template v-if="doc">
      <view class="segmented doc-switch"><text class="seg" :class="{on:tab==='terms'}" @click="tab='terms'">服務條款</text><text class="seg" :class="{on:tab==='privacy'}" @click="tab='privacy'">私隱聲明</text></view>
      <text class="subtle version">第 {{ doc.version }} 版 · {{ friendlyDate(doc.publishedAt) }} 發佈<text v-if="doc.accepted"> · 你已於 {{ friendlyDate(doc.acceptedAt) }} 同意</text></text>
      <view class="card body"><text class="body-text">{{ tab==='terms' ? doc.terms : doc.privacy }}</text></view>
      <view v-if="needAccept" class="card accept">
        <view class="check" @click="agreed=!agreed"><view class="box" :class="{on:agreed}"><text v-if="agreed">✓</text></view><text class="check-text">我已閱讀並同意服務條款及私隱聲明</text></view>
        <button class="primary agree" :disabled="!agreed||saving" @click="accept">{{ saving ? '正在提交…' : '同意並繼續' }}</button>
        <text v-if="!forced" class="link later" @click="later">稍後再看</text>
        <text v-else class="link later" @click="logout">不同意，退出登入</text>
      </view>
    </template>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { api, getUser, clearSession, publicApi, friendlyDate } from '../../lib/api'
const doc=ref(null),loaded=ref(false),tab=ref('terms'),agreed=ref(false),saving=ref(false)
const needAccept=computed(()=>!!doc.value&&doc.value.mine&&!doc.value.accepted)
const forced=computed(()=>doc.value?.mode==='force')
async function load(){
  try{
    if(getUser()){const mine=await api('/my/terms');doc.value=mine.published?{...mine,mine:true}:null}
    else doc.value=await publicApi('/public/terms')
  }catch{doc.value=null}finally{loaded.value=true}
}
async function accept(){
  if(!agreed.value||saving.value)return
  saving.value=true
  try{await api('/my/terms/accept','POST',{version:doc.value.version});uni.showToast({title:'已同意，多謝',icon:'none'});setTimeout(()=>uni.reLaunch({url:'/pages/index/index'}),600)}
  catch(e){uni.showToast({title:e.message,icon:'none'});if(e.status===409)load()}finally{saving.value=false}
}
function later(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index'})})}
function logout(){clearSession();uni.reLaunch({url:'/pages/login/login'})}
onLoad(options=>{if(options.tab==='privacy')tab.value='privacy';load()})
</script>
<style scoped>
.doc-switch{margin-bottom:8px}
.version{margin-bottom:12px}
.body-text{display:block;white-space:pre-wrap;font-size:var(--fs-body);line-height:1.8;color:var(--ink)}
.check{display:flex;align-items:flex-start;gap:12px}
.box{flex:none;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid var(--rule);border-radius:var(--r-control);background:#fff;color:#fff;font-size:var(--fs-meta);font-weight:800}
.box.on{background:var(--jade);border-color:var(--jade)}
.check-text{font-size:var(--fs-body);line-height:24px;color:var(--ink)}
.agree{margin-top:16px}
.later{display:block;text-align:center;padding-top:16px}
</style>
