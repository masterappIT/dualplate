<template>
  <view class="page companies">
    <text class="intro">每組公司持有的牌照，以及公司每年要辦的事。</text>
    <!-- 客戶自己新增公司（docs/tasks/self-managed-fixes-plan.md 第 4 步）：放最上方，與牌照列表的「新增牌照」一致 -->
    <button class="btn-line add-company" @click="addCompany">＋ 新增公司</button>
    <view v-for="group in data.groups" :key="group.id" class="card group">
      <text v-if="!group.offshore.length && !group.mainland.length" class="list-title">{{ group.name }}</text>
      <view v-for="c in [...group.offshore, ...group.mainland]" :id="'company-'+c.id" :key="c.id" class="company">
        <view class="row"><text class="side-label">{{ c.jurisdiction }}公司</text><text v-if="c.status!=='存續'" class="pill" :class="c.status==='已註銷'?'gray':'amber'">{{ c.status }}</text></view>
        <text class="company-name">{{ c.name }}</text><text v-if="c.jurisdiction==='香港'" class="company-sub"><text :class="!c.nameEn?'note-amber':''">{{ c.nameEn || '未填英文名稱' }}</text></text>
        <text v-if="c.registrationNo" class="company-sub">{{ regLabel(c) }} <text class="num">{{ c.registrationNo }}</text></text>
        <text v-if="c.incorporatedOn" class="company-sub">成立日期 <text class="num">{{ c.incorporatedOn }}</text></text>
        <text v-if="isPending('company',c.id)" class="pill amber pending-tag">已修改，待核對</text>
        <view class="company-links"><text class="link edit-link" @click="toggle(c.id)">{{ editingId===c.id ? '收起' : '修改公司資料 ›' }}</text><text v-if="!selfManagedMode" class="link edit-link" @click="openScope(c.id)">委託內容 ›</text></view>
        <CompanyEditor v-if="editingId===c.id" :company="c" @close="editingId=''" @saved="saved" />
        <view v-if="filings[c.id]?.length" class="filings"><text class="filing-title">每月報帳</text><view class="filing-cells"><view v-for="f in filings[c.id].slice(0,3)" :key="f.period" class="filing-cell"><text class="filing-month num">{{ Number(f.period.slice(5)) }}月</text><text class="pill" :class="filingTone(f)">{{ filingWord(f) }}</text></view></view></view>
      </view>
      <text v-if="!group.offshore.length" class="company-sub missing">香港／澳門公司資料待補充</text>
      <text v-if="!group.mainland.length" class="company-sub missing">內地公司資料待補充</text>
      <view v-if="group.plates.length" class="block"><text class="side-label">持有的牌照</text>
        <view v-for="p in group.plates" :key="p.id" class="plate-line" @click="openPlate(p.id)"><view class="plates"><PlateChip v-for="(part,i) in plateParts(p.label)" :key="i" :plate="part" /><text v-if="!plateParts(p.label).length" class="company-sub">車牌待補充</text></view><text class="chev">›</text></view>
      </view>
      <view v-if="group.deadlines.length" class="block"><text class="side-label">公司事項</text>
        <view v-for="(d,index) in group.deadlines" :key="index" class="row deadline"><view class="grow"><text class="item-name">{{ d.name }}</text><text v-if="d.handledBy==='you'" class="who">{{ selfHandled }}</text><text class="company-sub">{{ d.ownerLabel }}</text><text v-if="isPending(d.ownerType,d.ownerId,'date:'+d.code)" class="pill amber pending-tag">已修改，待核對</text></view><picker v-if="d.editable" mode="date" :value="d.dueOn" @change="saveDate(d,$event.detail.value)"><view class="date-edit"><DueDate :date="d.dueOn" :days="d.daysLeft" :level="d.level" /><text class="link">修改</text></view></picker><view v-else class="date-edit"><DueDate :date="d.dueOn" :days="d.daysLeft" :level="d.level" /><text class="link date-spacer" aria-hidden="true">修改</text></view></view>
      </view>
      <!-- 還沒有填日期（docs/tasks/self-managed-fixes-plan.md 第 2 步）：只列你自行辦理的事項；填了到期日就移到上面 -->
      <view v-if="group.undated?.length" class="block"><text class="side-label">還沒有填日期</text>
        <view v-for="(d,index) in group.undated" :key="'u'+index" class="row deadline"><view class="grow"><text class="item-name">{{ d.name }}</text><text class="company-sub">{{ d.ownerLabel }}</text><text v-if="d.hint" class="company-sub">{{ companyHint(d.hint) }}</text></view><picker v-if="d.fill==='date'" mode="date" @change="fillDate(d,$event.detail.value)"><view class="date-edit"><text class="link">填日期</text></view></picker></view>
        <text class="company-sub undated-note">填上到期日後，到期前會提醒你。</text>
      </view>
    </view>
    <view v-for="c in data.ungrouped" :id="'company-'+c.id" :key="c.id" class="card"><text class="side-label">{{ c.jurisdiction }}公司</text><text class="company-name">{{ c.name }}</text><text v-if="c.jurisdiction==='香港'" class="company-sub"><text :class="!c.nameEn?'note-amber':''">{{ c.nameEn || '未填英文名稱' }}</text></text><text v-if="c.registrationNo" class="company-sub">{{ regLabel(c) }} <text class="num">{{ c.registrationNo }}</text></text><text v-if="c.status!=='存續'" class="pill gray">{{ c.status }}</text>
      <text v-if="isPending('company',c.id)" class="pill amber pending-tag">已修改，待核對</text>
      <view class="company-links"><text class="link edit-link" @click="toggle(c.id)">{{ editingId===c.id ? '收起' : '修改公司資料 ›' }}</text><text v-if="!selfManagedMode" class="link edit-link" @click="openScope(c.id)">委託內容 ›</text></view>
      <CompanyEditor v-if="editingId===c.id" :company="c" @close="editingId=''" @saved="saved" />
      <view v-if="c.deadlines?.length" class="block"><text class="side-label">公司事項</text>
        <view v-for="(d,index) in c.deadlines" :key="index" class="row deadline"><view class="grow"><text class="item-name">{{ d.name }}</text><text v-if="d.handledBy==='you'" class="who">{{ selfHandled }}</text><text v-if="isPending(d.ownerType,d.ownerId,'date:'+d.code)" class="pill amber pending-tag">已修改，待核對</text></view><picker v-if="d.editable" mode="date" :value="d.dueOn" @change="saveDate(d,$event.detail.value)"><view class="date-edit"><DueDate :date="d.dueOn" :days="d.daysLeft" :level="d.level" /><text class="link">修改</text></view></picker><view v-else class="date-edit"><DueDate :date="d.dueOn" :days="d.daysLeft" :level="d.level" /><text class="link date-spacer" aria-hidden="true">修改</text></view></view>
      </view>
      <view v-if="c.undated?.length" class="block"><text class="side-label">還沒有填日期</text>
        <view v-for="(d,index) in c.undated" :key="'u'+index" class="row deadline"><view class="grow"><text class="item-name">{{ d.name }}</text><text v-if="d.hint" class="company-sub">{{ companyHint(d.hint) }}</text></view><picker v-if="d.fill==='date'" mode="date" @change="fillDate(d,$event.detail.value)"><view class="date-edit"><text class="link">填日期</text></view></picker></view>
        <text class="company-sub undated-note">填上到期日後，到期前會提醒你。</text>
      </view></view>
    <!-- 自管客戶沒有顧問：說明公司從哪裏來，並可直接拍批文卡建立牌照 -->
    <view v-if="loaded && !data.groups.length && !data.ungrouped.length && selfManagedMode" class="card empty-library"><text class="list-title">還沒有公司</text><text class="list-sub">登記牌照時，批文卡上的公司會自動加到這裏。</text><button class="primary empty-btn" @click="addPlate">拍批文卡</button></view>
    <view v-else-if="loaded && !data.groups.length && !data.ungrouped.length" class="card empty">公司資料由你的顧問整理後會顯示在這裡。</view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, openPlate, selfHandled, isSelfManaged } from '../../lib/api'
const selfManagedMode = isSelfManaged()
function openScope(id){uni.navigateTo({url:'/pages/scope/scope?id='+id})}
function addCompany(){uni.navigateTo({url:'/pages/company-new/company-new'})}
function addPlate(){uni.navigateTo({url:'/pages/plate-create/plate-create'})}
import PlateChip from '../../components/PlateChip.vue'
import CompanyEditor from '../../components/CompanyEditor.vue'
const data=ref({groups:[],ungrouped:[]}),loaded=ref(false),filings=ref({})
// 客戶自行修改公司資料和到期日：立即生效，顧問再核對
const pending=ref([]),editingId=ref('')
const isPending=(type,id,field)=>pending.value.some(x=>x.entityType===type&&x.entityId===id&&(!field||x.field===field))
const toggle=id=>{editingId.value=editingId.value===id?'':id}
// 從牌照頁「請補上公司資料」過來：直接打開那間公司的修改表單
function openRequested(){const id=uni.getStorageSync('editCompany');if(!id)return;uni.removeStorageSync('editCompany');editingId.value=id;setTimeout(()=>uni.pageScrollTo({selector:'#company-'+id,duration:0}),300)}
async function saved(){editingId.value='';await load()}
// 這一頁就是「我的公司」：提示改為按「修改公司資料」
const companyHint=hint=>hint.replace('在「我的公司」','按「修改公司資料」')
async function fillDate(d,date){if(!date)return;try{await api('/my/dates','PUT',{ownerType:d.ownerType,ownerId:d.ownerId,code:d.code,expiresOn:date});await load();uni.showToast({title:selfManagedMode?'已記錄，到期前會提醒你':'已記錄，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}}
async function saveDate(d,date){if(!date||date===d.dueOn)return;try{await api('/my/dates','PUT',{ownerType:d.ownerType,ownerId:d.ownerId,code:d.code,expiresOn:date});await load();uni.showToast({title:'到期日已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}}
// 客戶看的報帳狀態：只分辦好、辦理中、未開始
const filingWord=f=>f.status==='已完成'?(f.zeroFiling?'零申報':'已完成'):f.status==='已申報'?'已申報':f.status==='公司已註銷'?'不需申報':['資料已收','會計處理中'].includes(f.status)?'辦理中':'待交資料'
const filingTone=f=>['已完成','已申報'].includes(f.status)?'':f.status==='公司已註銷'?'gray':f.status==='未開始'?'amber':'blue'
// 登記號碼按註冊地寫明是甚麼號碼
const regLabel=c=>c.jurisdiction==='內地'?'統一社會信用代碼':c.jurisdiction==='澳門'?'商業登記編號':'商業登記號碼'
// 伺服器給的牌照標籤是「內地車牌 · 香港車牌」
const plateParts=label=>String(label||'').split(' · ').filter(part=>part&&!part.includes('待補'))
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});try{data.value=await api('/my/companies');openRequested();api('/my/pending').then(list=>{pending.value=list}).catch(()=>{pending.value=[]});api('/my/filings').then(list=>{filings.value=Object.fromEntries(list.map(item=>[item.companyId,item.periods]))}).catch(()=>{})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
onShow(load)
import DueDate from '../../components/DueDate.vue'
</script>
<style scoped>
.add-company{width:100%;margin-bottom:16px}
.empty-library{text-align:center;padding:24px 16px}.empty-btn{width:100%;margin-top:12px}
.group{padding:4px 16px}
.company{padding:12px 0;border-bottom:1px solid var(--rule)}
.side-label{display:block;color:var(--ink-3);font-size:var(--fs-meta);font-weight:700}
.company-name{display:block;margin-top:2px;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.company-sub{display:block;margin-top:2px;color:var(--ink-2);font-size:var(--fs-body);line-height:1.5}
.missing{padding:12px 0;color:var(--ink-3);border-bottom:1px solid var(--rule)}
.filings{margin-top:8px;padding:8px 12px;border-radius:var(--r-card);background:var(--paper)}
.filing-title{display:block;font-size:var(--fs-meta);color:var(--ink-3);font-weight:700}
.filing-cells{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:4px}.filing-cell{display:flex;align-items:center;gap:4px}
.filing-month{font-size:var(--fs-body);color:var(--ink);font-weight:700}
.block{padding:12px 0;border-bottom:1px solid var(--rule)}.block:last-child{border-bottom:0}
.plate-line{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.plates{display:flex;flex-wrap:wrap;gap:8px}
.edit-link{display:block;padding-top:8px}.company-links{display:flex;gap:20px}.date-edit{display:flex;align-items:center;gap:8px}.date-spacer{visibility:hidden}
.deadline{padding:8px 0}.undated-note{margin-top:4px}.item-name{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
</style>
