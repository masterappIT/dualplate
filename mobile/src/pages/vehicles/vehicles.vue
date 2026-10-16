<template>
  <view class="page plate-library">
    <text class="intro">名下 <text class="num">{{ plates.length }}</text> 個兩地牌。點擊查看到期、使用情況和辦理。</text>
    <view v-if="plates.length" class="segmented view-switch"><text class="seg" :class="{on:mode==='cards'}" @click="setMode('cards')">批文卡</text><text class="seg" :class="{on:mode==='list'}" @click="setMode('list')">列表</text></view>
    <view v-if="mode==='list' && plates.length">
      <input v-model="keyword" class="field search" placeholder="搜尋車牌、公司"/>
      <view class="chips"><text v-for="f in shownFilters" :key="f.id" class="chip" :class="{active:filter===f.id}" @click="filter=f.id">{{ f.name }} <text class="num">{{ f.count }}</text></text></view>
      <view v-for="p in visible" :key="p.id" class="list-card" @click="openPlate(p)">
        <view class="row"><view class="plates"><PlateChip :plate="p.mainlandPlate" region="內地" /><PlateChip v-if="p.localPlate" :plate="p.localPlate" :region="p.route==='粵澳'?'澳門':'香港'" /></view><text class="pill" :class="healthTone[p.health]">{{ healthLabel[p.health] }}</text></view>
        <text class="list-sub">{{ p.holder || p.route+'兩地牌' }} · {{ usageText(p) }}</text>
        <text v-if="p.warnings.length" class="list-note note-gray">{{ p.warnings.join('、') }}</text>
        <text v-if="p.next" class="list-note" :class="noteTone[p.next.level]">{{ p.next.name }} · {{ daysText(p.next) }}</text>
      </view>
      <view v-if="!visible.length" class="empty">沒有符合條件的牌照</view>
    </view>
    <view v-if="loaded && !plates.length" class="card empty-library"><text class="list-title">還沒有牌照記錄</text><text class="list-sub">拍下批文卡正反面交給我們，我們會替你建立檔案。</text></view>
    <view class="card-deck" :style="deckStyle" v-if="mode==='cards' && plates.length">
      <view v-for="(p,index) in plates" :key="p.id" class="deck-card" :style="deckCardStyle(index)">
        <ApprovalCard :data="details[p.id]?.cardData || {}" :flip-on-tap="false" :tap-label="'單獨查看此批文卡'" @card-tap="selectPlate(p)"/>
      </view>
    </view>
    <button class="btn-line add-plate" @click="addPlate">＋ 新增牌照</button>
    <view v-if="selectedPlate" class="wallet-overlay" @click="closeCard">
      <view class="wallet-focus" @click.stop>
        <view class="focus-head"><view class="plates"><PlateChip :plate="selectedPlate.mainland_plate" region="內地" /><PlateChip v-if="selectedPlate.local_plate" :plate="selectedPlate.local_plate" :region="selectedPlate.route==='粵澳'?'澳門':'香港'" /></view><button class="close-focus" aria-label="關閉批文卡預覽" @click="closeCard">×</button></view>
        <ApprovalCard :key="selectedPlate.id" :data="details[selectedPlate.id]?.cardData || {}" :back="flipped" :flip-on-tap="false" :tap-label="flipped ? '翻到批文卡正面' : '翻到批文卡背面'" @card-tap="flipped=!flipped"/>
        <view class="segmented flip-switch"><text class="seg" :class="{on:!flipped}" @click="flipped=false">正面</text><text class="seg" :class="{on:flipped}" @click="flipped=true">背面</text></view>
        <view class="kv focus-facts">
          <text class="k">上牌狀態</text><text class="v">{{ !selectedPlate.installation_status || selectedPlate.installation_status==='待核對' ? '確認中' : selectedPlate.installation_status }}</text>
          <text class="k">使用狀態</text><text class="v">{{ !selectedPlate.usage_status || selectedPlate.usage_status==='待核對' ? '確認中' : selectedPlate.usage_status==='出租中' ? '使用安排中' : selectedPlate.usage_status }}</text>
          <text class="k">批文卡編號</text><text class="v num">{{ selectedPlate.card_number || '待核對' }}</text>
        </view>
        <button class="primary open-file" @click="openPlate(selectedPlate)">查看牌照詳情</button>
      </view>
    </view>
  </view>
</template>
<script setup>
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api,getUser,daysText } from '../../lib/api'
import ApprovalCard from '../../components/ApprovalCard.vue'
const plates=ref([]),summaries=ref([]),details=ref({}),loaded=ref(false),selectedPlateId=ref(''),flipped=ref(false),mode=ref(uni.getStorageSync('plateView')||'cards'),keyword=ref(''),filter=ref('')
const healthLabel={ok:'正常',due:'快到期',overdue:'已逾期',pending:'資料整理中'},healthTone={ok:'',due:'amber',overdue:'red',pending:'gray'},noteTone={overdue:'note-red',due:'note-amber',upcoming:'note-green',ok:'note-gray'}
const idle=p=>p.installationStatus==='未上牌'||p.usageStatus==='暫停使用'
const usageText=p=>p.rental?`使用安排：${p.rental.renter}`:idle(p)?'空置':p.usageStatus==='自用'?'自用':'使用狀況確認中'
const tests={attention:p=>['due','overdue'].includes(p.health),rented:p=>!!p.rental,self:p=>p.usageStatus==='自用'&&!p.rental,idle}
const filters=computed(()=>[{id:'',name:'全部',count:summaries.value.length},{id:'attention',name:'需注意'},{id:'rented',name:'使用安排中'},{id:'self',name:'自用'},{id:'idle',name:'空置'}].map(f=>f.id?{...f,count:summaries.value.filter(tests[f.id]).length}:f))
// 數目為零的篩選不顯示（「全部」除外）
const shownFilters=computed(()=>filters.value.filter(f=>!f.id||f.count||filter.value===f.id))
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
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});closeCard();const preset=uni.getStorageSync('plateFilter');if(preset!==''&&preset!=null){filter.value=presets[preset]??'';mode.value='list';uni.removeStorageSync('plateFilter')}try{const [p,overview]=await Promise.all([api('/plate-assets'),api('/my/overview')]);plates.value=p;summaries.value=overview.plates;const list=await Promise.all(p.map(item=>api('/plate-assets/'+item.id)));details.value=Object.fromEntries(list.map(item=>[item.id,item]))}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
onShow(load)
import PlateChip from '../../components/PlateChip.vue'
</script>
<style scoped>
.plates{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.view-switch{margin-bottom:16px}.search{margin-top:0}
.add-plate{width:100%;margin-top:16px}
.empty-library{text-align:center;padding:24px 16px}
.card-deck{position:relative;min-height:465rpx;margin:12rpx 0 9rpx}
.deck-card{position:absolute;left:0;right:0;top:0;transform-origin:center bottom;transition:transform .35s cubic-bezier(.22,.67,.22,1);will-change:transform}
.deck-card :deep(.approval-preview){gap:0}.deck-card :deep(.approval-face){border-radius:12rpx;box-shadow:0 4rpx 12rpx #1b4c3828}.deck-card :deep(.flip-controls){display:none}
.wallet-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(7,24,18,.72);animation:overlay-in .25s ease both}
.wallet-focus{width:100%;max-width:560px;max-height:calc(100vh - 48px);overflow-y:auto;padding:16px;border-radius:var(--r-panel);background:var(--paper);box-shadow:var(--float);animation:focus-in .35s cubic-bezier(.22,.67,.22,1) both}
.focus-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.close-focus{flex:none;display:flex;align-items:center;justify-content:center;width:40px;height:40px;margin:0;padding:0;border-radius:50%;background:var(--muted-bg);color:var(--ink-2);font-size:var(--fs-title);line-height:1}
.wallet-focus :deep(.flip-controls){display:none}
.flip-switch{margin-top:12px}
.focus-facts{margin-top:16px;padding:12px;border:1px solid var(--rule);border-radius:var(--r-card);background:var(--card)}
.open-file{margin-top:16px}
@keyframes overlay-in{from{opacity:0}to{opacity:1}}@keyframes focus-in{from{opacity:0;transform:translateY(24px) scale(.94)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(prefers-reduced-motion:reduce){.wallet-overlay,.wallet-focus{animation:none}}
</style>
