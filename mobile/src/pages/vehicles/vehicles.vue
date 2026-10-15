<template>
  <view class="page plate-library">
    <view class="library-head"><view><text class="eyebrow">現有兩地牌 / MY PLATES</text><text class="page-title">我的兩地牌</text><text class="subtle">已持有的批文卡與車牌檔案；新申請請前往申請代辦。</text></view><button class="add-file" @click="addPlate">＋ 登記批文卡</button></view>
    <view class="library-count"><text>名下兩地牌</text><strong>{{ plates.length }} <text>個檔案</text></strong></view>
    <view v-if="!plates.length" class="empty-library"><text class="empty-mark">＋</text><strong>尚未登記現有批文卡</strong><text>已取得批文卡可在此建檔；尚在申請中請到申請代辦查看進度。</text><button @click="addPlate">登記現有批文卡</button></view>
    <view class="card-deck" :style="deckStyle" v-else>
      <view v-for="(p,index) in plates" :key="p.id" class="deck-card" :style="deckCardStyle(index)">
        <ApprovalCard :data="details[p.id]?.cardData || {}" :flip-on-tap="false" :tap-label="'單獨查看此批文卡'" @card-tap="selectPlate(p)"/>
      </view>
    </view>
    <text class="library-note">上牌、出租及批文卡更新均保存在各自的兩地牌檔案中。</text>
    <view v-if="selectedPlate" class="wallet-overlay" @click="closeCard">
      <view class="wallet-focus" @click.stop>
        <view class="focus-head"><view><text class="focus-eyebrow">批文卡預覽</text><text class="focus-heading">{{ selectedPlate.route }}兩地牌</text></view><button class="close-focus" aria-label="關閉批文卡預覽" @click="closeCard">×</button></view>
        <ApprovalCard :key="selectedPlate.id" :data="details[selectedPlate.id]?.cardData || {}" :back="flipped" :flip-on-tap="false" :tap-label="flipped ? '翻到批文卡正面' : '翻到批文卡背面'" @card-tap="flipped=!flipped"/>
        <text class="flip-guidance">點擊卡面翻看{{ flipped ? '正面' : '背面' }}</text>
        <view class="focus-facts">
          <view><text>內地車牌</text><strong>{{ selectedPlate.mainland_plate || '尚未上牌' }}</strong></view>
          <view><text>{{ selectedPlate.route==='粵澳' ? '澳門' : '香港' }}車牌</text><strong>{{ selectedPlate.local_plate || '尚未上牌' }}</strong></view>
          <view><text>上牌狀態</text><strong>{{ selectedPlate.installation_status || '待核對' }}</strong></view>
          <view><text>使用狀態</text><strong>{{ selectedPlate.usage_status || '待核對' }}</strong></view>
        </view>
        <button class="open-file" @click="openPlate(selectedPlate)">查看此兩地牌檔案　›</button>
        <text class="file-guidance">在檔案中可查看上牌、出租資料，並更新批文卡。</text>
      </view>
    </view>
  </view>
</template>
<script setup>
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api,getUser } from '../../lib/api'
import ApprovalCard from '../../components/ApprovalCard.vue'
const plates=ref([]),details=ref({}),selectedPlateId=ref(''),flipped=ref(false)
const selectedPlate=computed(()=>plates.value.find(p=>p.id===selectedPlateId.value))
function addPlate(){uni.navigateTo({url:'/pages/plate-create/plate-create'})}
function openPlate(p){uni.navigateTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(p.id)})}
function selectPlate(p){selectedPlateId.value=p.id;flipped.value=false}
function closeCard(){selectedPlateId.value='';flipped.value=false}
const cardReveal=230
const deckStyle=computed(()=>({minHeight:`${490+Math.max(0,plates.value.length-1)*cardReveal}rpx`}))
function deckCardStyle(index){return {zIndex:index+1,transform:`translateY(${index*cardReveal}rpx)`}}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});closeCard();try{const p=await api('/plate-assets');plates.value=p;const list=await Promise.all(p.map(item=>api('/plate-assets/'+item.id)));details.value=Object.fromEntries(list.map(item=>[item.id,item]))}catch(e){uni.showToast({title:e.message,icon:'none'})}}
onShow(load)
</script>
<style scoped>
.plate-library{padding-top:29rpx}.library-head{display:flex;align-items:flex-end;justify-content:space-between;gap:13rpx}.library-head>view{min-width:0;flex:1}.library-head .page-title{display:block;margin:7rpx 0}.library-head .subtle{font-size:20rpx;line-height:1.4}.add-file{flex:none;margin:0 0 1rpx;padding:0 15rpx;height:47rpx;line-height:47rpx;border-radius:11rpx;background:#1d674d;color:white;font-size:18rpx;font-weight:800}.library-count{display:flex;align-items:center;justify-content:space-between;padding:17rpx 2rpx 14rpx;margin:18rpx 0 6rpx;color:#4c7057;font-size:21rpx;border-bottom:1rpx solid #dce8de}.library-count strong{font-size:26rpx;color:#226c51}.library-count strong text{font-size:19rpx}.card-deck{position:relative;min-height:465rpx;margin:12rpx 0 9rpx}.deck-card{position:absolute;left:0;right:0;top:0;transform-origin:center bottom;transition:transform .35s cubic-bezier(.22,.67,.22,1),filter .35s ease;will-change:transform}.deck-card :deep(.approval-preview){gap:0}.deck-card :deep(.approval-face){border-radius:12rpx;box-shadow:0 4rpx 12rpx #1b4c3828}.deck-card :deep(.flip-controls){display:none}.empty-library{display:flex;flex-direction:column;align-items:center;gap:12rpx;background:white;border:1rpx solid #dfe9e1;border-radius:20rpx;padding:45rpx 20rpx;color:#52735c;text-align:center}.empty-mark{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:50%;background:#e7f2e9;font-size:42rpx}.empty-library strong{font-size:23rpx}.empty-library>text:last-of-type{font-size:19rpx}.empty-library button{margin:8rpx 0 0;background:#1d674d;color:white;font-size:20rpx}.library-note{display:block;text-align:center;color:#899d8d;font-size:18rpx;line-height:1.4;margin:17rpx 14rpx 25rpx}

.wallet-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24rpx;background:#071812b8;box-sizing:border-box;animation:overlay-in .25s ease both}.wallet-focus{width:100%;max-width:750rpx;max-height:calc(100vh - 100rpx);overflow-y:auto;padding:23rpx 21rpx 27rpx;border-radius:25rpx;background:#f5f8f4;box-shadow:0 24rpx 65rpx #0005;box-sizing:border-box;animation:focus-in .35s cubic-bezier(.22,.67,.22,1) both}.focus-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18rpx}.focus-eyebrow{display:block;color:#6e8a75;font-size:18rpx;font-weight:750}.focus-heading{display:block;color:#173e2e;font-size:29rpx;font-weight:850;margin-top:4rpx}.close-focus{width:52rpx;height:52rpx;line-height:46rpx;margin:0;padding:0;border-radius:50%;background:#e2ebe3;color:#315e44;font-size:37rpx;font-weight:400}.wallet-focus :deep(.flip-controls){display:none}.wallet-focus :deep(.approval-face){box-shadow:0 8rpx 24rpx #183d2b35}.flip-guidance{display:block;text-align:center;color:#678374;font-size:19rpx;margin:15rpx 0 21rpx}.focus-facts{display:grid;grid-template-columns:1fr 1fr;gap:15rpx;padding:21rpx;border:1rpx solid #dfebe1;border-radius:17rpx;background:white}.focus-facts view{min-width:0}.focus-facts text{display:block;color:#738b79;font-size:18rpx}.focus-facts strong{display:block;margin-top:5rpx;color:#254c35;font-size:23rpx;overflow-wrap:anywhere}.open-file{width:100%;height:69rpx;line-height:69rpx;margin:18rpx 0 0;border-radius:12rpx;background:#1d674d;color:white;font-size:22rpx;font-weight:800}.file-guidance{display:block;text-align:center;color:#7c9180;font-size:18rpx;line-height:1.45;margin-top:11rpx}@keyframes overlay-in{from{opacity:0}to{opacity:1}}@keyframes focus-in{from{opacity:0;transform:translateY(48rpx) scale(.94)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.wallet-overlay,.wallet-focus{animation:none}}
</style>
