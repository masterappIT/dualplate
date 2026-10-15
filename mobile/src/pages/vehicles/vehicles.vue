<template>
  <view class="page plate-library">
    <view class="library-head"><view><text class="page-title">我的牌照</text><text class="subtle">名下 {{ plates.length }} 個兩地牌，點擊查看到期、使用情況和辦理。</text></view></view>
    <view v-if="plates.length" class="switch-row"><text class="subtle">{{ mode==='list' ? '列表：搜尋與篩選' : '批文卡：點擊卡片查看' }}</text><view class="view-switch"><text :class="{on:mode==='cards'}" @click="setMode('cards')">卡片</text><text :class="{on:mode==='list'}" @click="setMode('list')">列表</text></view></view>
    <view v-if="mode==='list' && plates.length">
      <input v-model="keyword" class="field search" placeholder="搜尋車牌、公司"/>
      <view class="chips"><text v-for="f in filters" :key="f.id" class="chip" :class="{active:filter===f.id}" @click="filter=f.id">{{ f.name }} {{ f.count }}</text></view>
      <view v-for="p in visible" :key="p.id" class="list-card" @click="openPlate(p)">
        <view class="row"><view class="plates"><PlateChip :plate="p.mainlandPlate" region="內地" /><PlateChip v-if="p.localPlate" :plate="p.localPlate" :region="p.route==='粵澳'?'澳門':'香港'" /></view><text class="pill" :class="healthTone[p.health]">{{ healthLabel[p.health] }}</text></view>
        <text class="list-sub">{{ p.holder || p.route+'兩地牌' }} · {{ usageText(p) }}</text>
        <text v-if="p.warnings.length" class="list-note note-gray">{{ p.warnings.join('、') }}</text>
        <text v-if="p.next" class="list-note" :class="noteTone[p.next.level]">{{ p.next.name }} · {{ daysText(p.next) }}</text>
      </view>
      <view v-if="!visible.length" class="empty">沒有符合條件的牌照</view>
    </view>
    <view v-if="!plates.length" class="empty-library"><text class="empty-mark">＋</text><strong>還沒有牌照記錄</strong><text>拍下批文卡正反面交給我們，我們會替你建立檔案。</text></view>
    <view class="card-deck" :style="deckStyle" v-if="mode==='cards' && plates.length">
      <view v-for="(p,index) in plates" :key="p.id" class="deck-card" :style="deckCardStyle(index)">
        <ApprovalCard :data="details[p.id]?.cardData || {}" :flip-on-tap="false" :tap-label="'單獨查看此批文卡'" @card-tap="selectPlate(p)"/>
      </view>
    </view>
    <button class="secondary add-plate" @click="addPlate">＋ 新增牌照：拍下批文卡交給我們</button>
    <view v-if="selectedPlate" class="wallet-overlay" @click="closeCard">
      <view class="wallet-focus" @click.stop>
        <view class="focus-head"><view><text class="focus-eyebrow">批文卡預覽</text><text class="focus-heading">{{ selectedPlate.route }}兩地牌</text></view><button class="close-focus" aria-label="關閉批文卡預覽" @click="closeCard">×</button></view>
        <ApprovalCard :key="selectedPlate.id" :data="details[selectedPlate.id]?.cardData || {}" :back="flipped" :flip-on-tap="false" :tap-label="flipped ? '翻到批文卡正面' : '翻到批文卡背面'" @card-tap="flipped=!flipped"/>
        <text class="flip-guidance">點擊卡面翻看{{ flipped ? '正面' : '背面' }}</text>
        <view class="focus-facts">
          <view><text>內地車牌</text><strong>{{ selectedPlate.mainland_plate || '尚未上牌' }}</strong></view>
          <view><text>{{ selectedPlate.route==='粵澳' ? '澳門' : '香港' }}車牌</text><strong>{{ selectedPlate.local_plate || '尚未上牌' }}</strong></view>
          <view><text>上牌狀態</text><strong>{{ !selectedPlate.installation_status || selectedPlate.installation_status==='待核對' ? '確認中' : selectedPlate.installation_status }}</strong></view>
          <view><text>使用狀態</text><strong>{{ !selectedPlate.usage_status || selectedPlate.usage_status==='待核對' ? '確認中' : selectedPlate.usage_status }}</strong></view>
        </view>
        <button class="open-file" @click="openPlate(selectedPlate)">查看牌照詳情　›</button>
        <text class="file-guidance">可查看到期項目、使用情況，並一鍵申請辦理。</text>
      </view>
    </view>
  </view>
</template>
<script setup>
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api,getUser,plateName,daysText } from '../../lib/api'
import ApprovalCard from '../../components/ApprovalCard.vue'
const plates=ref([]),summaries=ref([]),details=ref({}),selectedPlateId=ref(''),flipped=ref(false),mode=ref(uni.getStorageSync('plateView')||'cards'),keyword=ref(''),filter=ref('')
const healthLabel={ok:'正常',due:'快到期',overdue:'已逾期',pending:'資料整理中'},healthTone={ok:'',due:'amber',overdue:'red',pending:'gray'},noteTone={overdue:'note-red',due:'note-amber',upcoming:'note-green',ok:'note-gray'}
const idle=p=>p.installationStatus==='未上牌'||p.usageStatus==='暫停使用'
const usageText=p=>p.rental?`出租給 ${p.rental.renter}`:idle(p)?'空置':p.usageStatus==='自用'?'自用':'使用狀況確認中'
const tests={attention:p=>['due','overdue'].includes(p.health),rented:p=>!!p.rental,self:p=>p.usageStatus==='自用'&&!p.rental,idle}
const filters=computed(()=>[{id:'',name:'全部',count:summaries.value.length},{id:'attention',name:'需注意'},{id:'rented',name:'出租中'},{id:'self',name:'自用'},{id:'idle',name:'空置'}].map(f=>f.id?{...f,count:summaries.value.filter(tests[f.id]).length}:f))
const visible=computed(()=>{const word=keyword.value.trim().toLowerCase();return summaries.value.filter(p=>(!filter.value||tests[filter.value](p))&&(!word||[p.mainlandPlate,p.localPlate,p.holder,p.contractor,p.cardNumber].join(' ').toLowerCase().includes(word)))})
const selectedPlate=computed(()=>plates.value.find(p=>p.id===selectedPlateId.value))
function addPlate(){uni.navigateTo({url:'/pages/plate-create/plate-create'})}
function openPlate(p){closeCard();uni.navigateTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(p.id)})}
function selectPlate(p){selectedPlateId.value=p.id;flipped.value=false}
function closeCard(){selectedPlateId.value='';flipped.value=false}
const cardReveal=230
const deckStyle=computed(()=>({minHeight:`${490+Math.max(0,plates.value.length-1)*cardReveal}rpx`}))
function deckCardStyle(index){return {zIndex:index+1,transform:`translateY(${index*cardReveal}rpx)`}}
// Remember the customer's preferred view; the card stack is the default.
function setMode(next){mode.value=next;uni.setStorageSync('plateView',next)}
// The home page can ask for a pre-set filter (e.g. tapping "已逾期").
const presets={ok:'',due:'attention',overdue:'attention'}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});closeCard();const preset=uni.getStorageSync('plateFilter');if(preset!==''&&preset!=null){filter.value=presets[preset]??'';mode.value='list';uni.removeStorageSync('plateFilter')}try{const [p,overview]=await Promise.all([api('/plate-assets'),api('/my/overview')]);plates.value=p;summaries.value=overview.plates;const list=await Promise.all(p.map(item=>api('/plate-assets/'+item.id)));details.value=Object.fromEntries(list.map(item=>[item.id,item]))}catch(e){uni.showToast({title:e.message,icon:'none'})}}
onShow(load)
import PlateChip from '../../components/PlateChip.vue'
</script>
<style scoped>
.plates{display:flex;flex-wrap:wrap;gap:10rpx;min-width:0}
.plate-library{padding-top:29rpx}.switch-row{display:flex;align-items:center;justify-content:space-between;margin-top:22rpx}.view-switch{flex:none;display:flex;background:#e8efe9;border-radius:12rpx;padding:4rpx}.view-switch text{padding:8rpx 18rpx;border-radius:9rpx;font-size:21rpx;font-weight:750;color:#56705f}.view-switch text.on{background:#fff;color:var(--jade)}.search{margin-top:24rpx}.add-plate{margin-top:22rpx;font-size:24rpx}.library-head{display:flex;align-items:flex-end;justify-content:space-between;gap:13rpx}.library-head>view{min-width:0;flex:1}.library-head .page-title{display:block;margin:7rpx 0}.library-head .subtle{font-size:20rpx;line-height:1.4}.add-file{flex:none;margin:0 0 1rpx;padding:0 15rpx;height:47rpx;line-height:47rpx;border-radius:11rpx;background:var(--jade);color:white;font-size:18rpx;font-weight:800}.library-count{display:flex;align-items:center;justify-content:space-between;padding:17rpx 2rpx 14rpx;margin:18rpx 0 6rpx;color:#4c7057;font-size:21rpx;border-bottom:1rpx solid #dce8de}.library-count strong{font-size:26rpx;color:#226c51}.library-count strong text{font-size:19rpx}.card-deck{position:relative;min-height:465rpx;margin:12rpx 0 9rpx}.deck-card{position:absolute;left:0;right:0;top:0;transform-origin:center bottom;transition:transform .35s cubic-bezier(.22,.67,.22,1),filter .35s ease;will-change:transform}.deck-card :deep(.approval-preview){gap:0}.deck-card :deep(.approval-face){border-radius:12rpx;box-shadow:0 4rpx 12rpx #1b4c3828}.deck-card :deep(.flip-controls){display:none}.empty-library{display:flex;flex-direction:column;align-items:center;gap:12rpx;background:white;border:1rpx solid var(--rule);border-radius:20rpx;padding:45rpx 20rpx;color:#52735c;text-align:center}.empty-mark{display:flex;align-items:center;justify-content:center;width:66rpx;height:66rpx;border-radius:50%;background:#e7f2e9;font-size:42rpx}.empty-library strong{font-size:23rpx}.empty-library>text:last-of-type{font-size:19rpx}.empty-library button{margin:8rpx 0 0;background:var(--jade);color:white;font-size:20rpx}.library-note{display:block;text-align:center;color:#899d8d;font-size:18rpx;line-height:1.4;margin:17rpx 14rpx 25rpx}

.wallet-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24rpx;background:#071812b8;box-sizing:border-box;animation:overlay-in .25s ease both}.wallet-focus{width:100%;max-width:750rpx;max-height:calc(100vh - 100rpx);overflow-y:auto;padding:23rpx 21rpx 27rpx;border-radius:25rpx;background:var(--paper);box-shadow:0 24rpx 65rpx #0005;box-sizing:border-box;animation:focus-in .35s cubic-bezier(.22,.67,.22,1) both}.focus-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18rpx}.focus-eyebrow{display:block;color:#6e8a75;font-size:18rpx;font-weight:750}.focus-heading{display:block;color:#173e2e;font-size:29rpx;font-weight:850;margin-top:4rpx}.close-focus{width:52rpx;height:52rpx;line-height:46rpx;margin:0;padding:0;border-radius:50%;background:#e2ebe3;color:#315e44;font-size:37rpx;font-weight:400}.wallet-focus :deep(.flip-controls){display:none}.wallet-focus :deep(.approval-face){box-shadow:0 8rpx 24rpx #183d2b35}.flip-guidance{display:block;text-align:center;color:#678374;font-size:19rpx;margin:15rpx 0 21rpx}.focus-facts{display:grid;grid-template-columns:1fr 1fr;gap:15rpx;padding:21rpx;border:1rpx solid #dfebe1;border-radius:17rpx;background:white}.focus-facts view{min-width:0}.focus-facts text{display:block;color:#738b79;font-size:18rpx}.focus-facts strong{display:block;margin-top:5rpx;color:#254c35;font-size:23rpx;overflow-wrap:anywhere}.open-file{width:100%;height:69rpx;line-height:69rpx;margin:18rpx 0 0;border-radius:12rpx;background:var(--jade);color:white;font-size:22rpx;font-weight:800}.file-guidance{display:block;text-align:center;color:#7c9180;font-size:18rpx;line-height:1.45;margin-top:11rpx}@keyframes overlay-in{from{opacity:0}to{opacity:1}}@keyframes focus-in{from{opacity:0;transform:translateY(48rpx) scale(.94)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.wallet-overlay,.wallet-focus{animation:none}}
</style>
