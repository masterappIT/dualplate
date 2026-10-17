<template>
  <view class="page home">
    <view class="hero deep guilloche">
      <view class="hero-top">
        <view class="grow"><text class="kicker">委託人</text><text class="hero-name">{{ data.customerName || user?.name || '歡迎' }}</text><text class="hero-sub">名下 <text class="num">{{ data.plates.length }}</text> 個兩地牌</text></view>
        <view class="bell" @click="goNotices" aria-label="通知"><image class="bell-icon" src="/static/bell.svg" /><text v-if="data.unreadNotifications" class="bell-dot num">{{ data.unreadNotifications > 99 ? '99+' : data.unreadNotifications }}</text></view>
      </view>
      <view class="ticket-rule" />
      <view class="status-grid">
        <view class="status-tile ok" :class="{ zero: !data.counts.ok }" @click="goPlates('ok')"><text class="status-num num">{{ data.counts.ok }}</text><text class="status-label">正常</text></view>
        <view class="status-tile due" :class="{ zero: !data.counts.due }" @click="goPlates('due')"><text class="status-num num">{{ data.counts.due }}</text><text class="status-label">快到期</text></view>
        <view class="status-tile overdue" :class="{ zero: !data.counts.overdue }" @click="goPlates('overdue')"><text class="status-num num">{{ data.counts.overdue }}</text><text class="status-label">已逾期</text></view>
      </view>
    </view>
    <text v-if="data.counts.pending" class="pending-note">另有 {{ data.counts.pending }} 個牌照資料整理中</text>

    <!-- 待辦：要你提供的、你自理而快到期的、未讀通知，合成一個清單；做完自動消失 -->
    <view class="section-head"><text class="section-title">待辦<text v-if="todoList.length" class="num"> · {{ todoList.length }}</text></text></view>
    <view v-if="todoList.length">
      <view v-for="item in todoList" :key="item.key" class="list-card row" :class="{ 'warn-card': item.urgent }" @click="openTodo(item)">
        <view class="grow"><text class="list-title">{{ item.title }}</text><text class="list-sub">{{ item.subtitle }}</text></view>
        <DueDate v-if="item.deadline" :date="item.deadline.dueOn" :days="item.deadline.daysLeft" :level="item.deadline.level" /><text v-else class="chev">›</text>
      </view>
    </view>
    <view v-else class="list-card"><text class="list-title">目前不用你做甚麼</text><text class="list-sub">我們負責的事項會按時跟進；需要你提供資料或確認時，會出現在這裏。</text></view>

    <view class="section-head"><text class="section-title">我的牌照</text><text class="link" @click="goPlates('')">全部 ›</text></view>
    <view v-for="p in data.plates" :key="p.id" class="list-card row" @click="openPlate(p.id)">
      <view class="grow"><text class="list-title num">{{ [p.mainlandPlate, p.localPlate].filter(Boolean).join(' · ') || '車牌待補' }}</text><text class="list-sub">{{ plateSub(p) }}</text></view>
      <text class="pill" :class="healthTone[p.health]">{{ plateTodoCount(p.id) ? plateTodoCount(p.id) + ' 項待辦' : healthLabel[p.health] }}</text>
    </view>
    <view v-if="!data.plates.length" class="list-card"><text class="list-title">還沒有牌照</text><text class="list-sub">拍下批文卡就能建檔。</text><text class="link add-plate" @click="addPlate">登記批文卡 ›</text></view>
    <text v-if="data.plates.length" class="link all-deadlines" @click="goDeadlines">查看全部到期日 ›</text>

    <view v-if="data.activeRequests.length">
      <view class="section-head"><text class="section-title">辦理中</text><text class="link" @click="goMe">全部 ›</text></view>
      <view v-for="item in data.activeRequests.slice(0,3)" :key="item.id" class="list-card" @click="openRequest(item.id)">
        <view class="row"><text class="list-title grow">{{ item.title }}</text><text class="pill" :class="requestTone(item.status)">{{ item.status }}</text></view>
        <view class="req-meta"><PlateChip v-if="item.plate" :plate="item.plate" region="內地" size="sm" /><text class="list-sub">{{ clientStage(item.stage) }}</text></view>
      </view>
    </view>
    <button class="btn-line new-request" @click="newRequest">請顧問幫我辦</button>

    <WelcomeGuide />
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, openPlate, startRequest, requestTone, clientStage, checkTerms } from '../../lib/api'
import DueDate from '../../components/DueDate.vue'
import PlateChip from '../../components/PlateChip.vue'
import WelcomeGuide from '../../components/WelcomeGuide.vue'
const user=ref(getUser())
const data=ref({unreadNotifications:0,advisor:null,customerName:'',counts:{pending:0,ok:0,due:0,overdue:0},plates:[],deadlines:[],todos:[],activeRequests:[]})
const notices=ref([])
async function load(){user.value=getUser();if(!user.value)return uni.navigateTo({url:'/pages/login/login'});checkTerms();try{const [overview,list]=await Promise.all([api('/my/overview'),api('/my/notifications').catch(()=>({items:[]}))]);data.value=overview;notices.value=list.items||[]}catch(e){uni.showToast({title:e.message,icon:'none'})}}
// 待辦只放要客戶動手的：要你提供的資料、你自理（或要你過關）而快到期／已逾期的事項、未讀通知（到期通知已在清單內，不重複）
const clientAction=item=>['due','overdue'].includes(item.level)&&(item.handledBy==='you'||item.code==='crossing_90')
const todoList=computed(()=>[
  ...data.value.todos.map((t,i)=>({key:'t'+i,title:t.title,subtitle:t.subtitle,requestId:t.requestId,urgent:true})),
  ...data.value.deadlines.filter(clientAction).map(d=>({key:'d'+d.code+d.ownerId+(d.period||''),title:d.name,subtitle:[d.ownerLabel,d.code==='crossing_90'?'過關後按「今天已過關」':d.markable?'辦好後按「已辦好」':'請你自行辦理'].filter(Boolean).join(' · '),deadline:d,plateId:d.plateId,urgent:d.level==='overdue'})),
  ...notices.value.filter(n=>!n.read&&n.kind!=='deadline').map(n=>({key:'n'+n.id,title:n.title,subtitle:n.body,notice:n}))
])
const plateTodoCount=id=>todoList.value.filter(t=>t.plateId===id).length
const healthLabel={ok:'正常',due:'快到期',overdue:'已逾期',pending:'資料整理中'},healthTone={ok:'',due:'amber',overdue:'red',pending:'gray'}
// 我們負責的事項不要客戶動手：牌照列只說明下一個到期日
function plateSub(p){const n=p.next;return n&&n.dueOn?n.name+' · '+n.dueOn:p.health==='pending'?'顧問正在整理資料':'半年內沒有到期'}
function openTodo(item){if(item.requestId)return openRequest(item.requestId);if(item.notice){const n=item.notice;n.read=true;api('/my/notifications/read','POST',{id:n.id}).catch(()=>{});if(!n.link)return;const tabs=['/pages/index/index','/pages/vehicles/vehicles','/pages/companies/companies','/pages/me/me'];return tabs.includes(n.link)?uni.switchTab({url:n.link}):uni.navigateTo({url:n.link})}openDeadline(item.deadline)}
function addPlate(){uni.navigateTo({url:'/pages/plate-create/plate-create'})}
function goPlates(filter){uni.setStorageSync('plateFilter',filter||'');uni.switchTab({url:'/pages/vehicles/vehicles'})}
function goCompanies(){uni.switchTab({url:'/pages/companies/companies'})}
function goNotices(){uni.navigateTo({url:'/pages/notifications/notifications'})}
function goMe(){uni.switchTab({url:'/pages/me/me'})}
function goDeadlines(){uni.navigateTo({url:'/pages/deadlines/deadlines'})}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
function newRequest(){startRequest('')}
// Company items open the company list; plate and vehicle items open their plate.
function openDeadline(item){if(item.ownerType==='company')goCompanies();else if(item.plateId)openPlate(item.plateId);else goDeadlines()}
onShow(load)
</script>
<style scoped>
.hero{border-radius:var(--r-panel);padding:16px 16px 12px}
.hero-top{display:flex;align-items:flex-start;gap:12px}
.hero-name{display:block;margin-top:4px;font-size:var(--fs-title);font-weight:800;line-height:1.3;color:#fff}
.hero-sub{display:block;margin-top:2px;font-size:var(--fs-body);color:var(--on-deep-2)}
.status-grid{display:grid;grid-template-columns:repeat(3,1fr)}
.status-tile{display:flex;flex-direction:column;align-items:center;padding:4px 0}.status-tile+.status-tile{border-left:1px solid rgba(227,239,234,.2)}
.status-num{display:block;font-size:var(--fs-stat);font-weight:800;line-height:1.2}
.status-label{display:block;font-size:var(--fs-meta);font-weight:700;margin-top:2px}
.status-tile.ok{color:var(--on-deep-ok)}.status-tile.due{color:var(--on-deep-due)}.status-tile.overdue{color:var(--on-deep-overdue)}
.status-tile.zero{color:var(--on-deep-2)}
.pending-note{display:block;margin-top:8px;color:var(--ink-3);font-size:var(--fs-meta);text-align:center}
.new-request{width:100%;margin-top:16px}.all-deadlines{display:block;text-align:center;padding:8px 0}.add-plate{display:block;margin-top:8px}
.req-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px}.req-meta .list-sub{margin-top:0}
.bell{position:relative;flex:none;width:40px;height:40px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center}.bell-icon{width:20px;height:20px}
.bell-dot{position:absolute;top:-4px;right:-6px;min-width:20px;height:20px;padding:0 4px;border-radius:99px;background:var(--plate-yellow);color:var(--jade-deep);font-size:var(--fs-cap);font-weight:800;line-height:18px;text-align:center;border:1px solid var(--jade-deep)}
</style>
