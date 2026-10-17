<template><view class="page detail-page" v-if="item">
  <text class="page-title">{{ item.title }}</text>
  <view class="head-meta"><PlateChip v-if="item.plateAsset?.mainland_plate" :plate="item.plateAsset.mainland_plate" region="內地" size="sm" /><text class="subtle">{{ item.route }}{{ item.plateAsset ? '' : ' · ' + (item.vehicle?.plate || '新申請') }}</text><text v-if="item.plateAsset" class="link" @click="openPlate">查看牌照 ›</text></view>
  <view class="card progress">
    <view class="psteps"><view v-for="(step,index) in steps" :key="step" class="pstep" :class="{done:index<stepIndex,current:index===stepIndex}"><view class="pdot">{{ index<stepIndex ? '✓' : index+1 }}</view><text>{{ step }}</text></view></view>
    <view class="ticket-rule" />
    <view class="row"><text class="pill" :class="requestTone(item.status)">{{ item.status }}</text><text class="subtle num">最近更新 {{ friendlyDate(item.updated_at) }}</text></view>
    <text class="now-stage">{{ clientStage(item.stage) }}</text>
    <text class="next-line">{{ nextText }}</text>
  </view>
  <view v-if="waiting.length" class="card warn-card">
    <text class="block-title">需要你提供</text>
    <view v-for="t in waiting" :key="t.id" class="waiting-row"><view class="row"><text class="waiting-item grow">{{ todoTitle(t.title) }}</text><button v-if="canUpload" class="btn-sm solid" :disabled="uploading" @click="chooseUpload(t.id)">上傳</button></view><view v-if="t.documents?.length" class="doc-list"><text v-for="d in t.documents" :key="d" class="pill amber">{{ d }}</text></view><text v-if="filesFor(t.id).length" class="sent-line">已交 {{ filesFor(t.id).length }} 份<text v-if="filesFor(t.id).some(f=>f.status==='需重交')" class="note-red"> · 有文件需要重交</text></text></view>
    <text class="subtle waiting-note">{{ adv('可直接拍照或上傳 PDF；不方便的話，也可以交給你的顧問。') }}</text>
  </view>
  <view v-if="files.length || canUpload" class="section-head"><text class="section-title">已交文件<text class="num"> · {{ files.length }}</text></text><text v-if="canUpload && !waiting.length" class="link" @click="chooseUpload(null)">上傳文件 ›</text></view>
  <view v-if="files.length" class="card list"><view v-for="f in files" :key="f.id" class="file-row"><view class="file-mark" :class="f.mime==='application/pdf'?'pdf':''">{{ f.mime==='application/pdf' ? 'PDF' : '相' }}</view><view class="grow"><text class="file-name">{{ f.fileName }}</text><text class="line-sub">{{ taskTitle(f.taskId) }}{{ friendlyDate(f.createdAt) }} · {{ sizeText(f.size) }}</text><text v-if="f.status==='需重交' && f.reviewNote" class="review-note">{{ f.reviewNote }}</text></view><text class="pill" :class="attachmentTone[f.status]">{{ adv(attachmentLabel[f.status]) }}</text></view></view>
  <view v-else-if="canUpload" class="card empty">{{ adv('還沒有上傳文件。顧問收妥後會在這裡標示「已收妥」。') }}</view>
  <text class="section-title">更新紀錄</text><view class="card list"><view v-for="activity in item.activities" :key="activity.id" class="activity"><view class="activity-dot"></view><view class="grow"><text class="activity-text">{{ activity.detail }}</text><text class="line-sub num">{{ friendlyDate(activity.created_at) }}</text></view></view><text v-if="!item.activities?.length" class="line-sub empty-line">暫時沒有更新</text></view>
  <view class="more" @click="showDetail=!showDetail">{{ showDetail ? '收起辦理步驟' : '查看辦理步驟 ›' }}</view>
  <view v-if="showDetail">
    <view class="section-head"><text class="section-title">辦理步驟</text><text class="subtle num">{{ item.tasks.length }} 步</text></view><view class="card list"><view v-for="(task,index) in item.tasks" :key="task.id" class="task"><view class="step" :class="task.status==='已完成'?'done':''">{{ task.status==='已完成'?'✓':index+1 }}</view><view class="grow"><text class="task-title">{{ todoTitle(task.title) }}</text><text class="line-sub">{{ task.jurisdiction }} · {{ task.status }}</text></view></view></view>
    <view v-if="selectedSources.length"><text class="section-title">官方依據</text><view class="card list"><view v-for="source in selectedSources" :key="source.id" class="official-row" @click="openSource(source.url)"><view class="grow"><text class="task-title">{{ source.title }}</text><text class="line-sub">{{ source.agency }} · 點擊複製官方連結</text></view><text class="chev">›</text></view></view></view>
  </view>
  <wd-action-sheet custom-class="choice-sheet" v-model="sheet.show" :title="sheet.title" :actions="sheet.actions" cancel-text="取消" @select="onSelect" @close="onClose" />
  <wd-message-box />
</view></template>
<script setup>
import { useChoice,useConfirm } from '../../lib/choice'
const { sheet,choose,onSelect,onClose }=useChoice(),confirmBox=useConfirm()
import { ref,computed } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { api,friendlyDate,pickPhotos,pickPdf,uploadAttachment,attachmentTone,attachmentLabel,requestTone,clientStage,isSelfManaged } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
const item=ref(null),sources=ref([]),files=ref([]),uploading=ref(false)
// Customer-facing four-step progress derived from the internal case status.
const steps=['已提交','收集資料','辦理中','完成'],showDetail=ref(false)
// 伺服器已把內部狀態換成客戶看得懂的文字：已收到／需要你提供資料／辦理中／已完成／已取消
const stepIndex=computed(()=>{const status=item.value?.status;return status==='已完成'?3:status==='辦理中'?2:status==='需要你提供資料'?1:0})
const waiting=computed(()=>item.value?.clientTodos||(item.value?.tasks||[]).filter(t=>t.status==='待客戶配合'))
// 自管客戶沒有顧問：用語改為「我們」
const selfManaged=isSelfManaged(),adv=text=>selfManaged?text.replace(/你的顧問/g,'我們').replace(/顧問/g,'我們'):text
const nextText=computed(()=>adv(item.value?.status==='已取消'?'這張工單已取消。如有疑問請聯絡你的顧問。':stepIndex.value===0?'顧問會盡快受理，並告訴你需要準備的資料。':stepIndex.value===1?(waiting.value.length?'資料齊全後就會開始辦理。':'顧問正在整理資料。'):stepIndex.value===2?'正在辦理，有結果會通知你。':'已辦理完成。'))
const selectedSources=computed(()=>sources.value.filter(s=>item.value?.plan?.sourceIds?.includes(s.id)))
// 待辦標題去掉「客戶」二字，直接對客戶說要提供甚麼
const todoTitle=title=>String(title||'').replace(/^客戶/,'')
function openSource(url){uni.setClipboardData({data:url,success:()=>uni.showToast({title:'官方連結已複製',icon:'none'})})}
function openPlate(){if(item.value?.plateAsset)uni.navigateTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(item.value.plateAsset.id)})}
const canUpload=computed(()=>item.value&&!['已完成','已取消'].includes(item.value.status))
function filesFor(taskId){return files.value.filter(f=>f.taskId===taskId)}
function taskTitle(taskId){const task=(item.value?.tasks||[]).find(t=>t.id===taskId);return task?task.title+' · ':''}
function sizeText(size){return size>=1048576?(size/1048576).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB'}
// 拍照／相簿或 PDF；逐份上傳，任何一份失敗都告訴客戶是哪一份
async function chooseUpload(taskId){const tapIndex=await choose('上傳甚麼文件？',['拍照或選相片','選擇 PDF 文件']);if(tapIndex<0)return;{
  let picked=[];try{picked=tapIndex===0?await pickPhotos():await pickPdf()}catch(e){return uni.showToast({title:e.message,icon:'none'})}
  if(!picked.length)return
  uploading.value=true;let ok=0;const failed=[]
  for(const [index,file] of picked.entries()){uni.showLoading({title:`上傳中 ${index+1}/${picked.length}`,mask:true});try{await uploadAttachment(requestId,file,taskId);ok++}catch(e){failed.push(`${file.name}：${e.message}`)}}
  uni.hideLoading();uploading.value=false
  if(failed.length)confirmBox.notice({title:ok?`已上傳 ${ok} 份，${failed.length} 份未成功`:'上傳未成功',msg:failed.join('\n')})
  else uni.showToast({title:`已上傳 ${ok} 份`,icon:'success'})
  loadFiles()}}
async function loadFiles(){try{files.value=await api('/my/requests/'+requestId+'/attachments')}catch{files.value=[]}}
let requestId=''
async function load(){if(!requestId)return;try{const [record,catalog]=await Promise.all([api('/requests/'+requestId),api('/catalog')]);item.value=record;sources.value=catalog.sources;loadFiles()}catch(e){uni.showToast({title:e.message,icon:'none'})}}
onLoad(options=>{requestId=options.id||'';load()})
onShow(()=>{if(item.value)load()})
</script>
<style scoped>
.head-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px}.head-meta .link{margin-left:auto}
.progress{padding-bottom:12px}
.psteps{display:flex;justify-content:space-between}
.pstep{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:var(--fs-meta);color:var(--ink-3)}
.pdot{width:28px;height:28px;border-radius:50%;background:var(--muted-bg);display:flex;align-items:center;justify-content:center;font-size:var(--fs-meta);font-weight:800}
.pstep.done{color:var(--jade)}.pstep.done .pdot{background:var(--jade-soft)}
.pstep.current{color:var(--jade);font-weight:800}.pstep.current .pdot{background:var(--jade);color:#fff}
.now-stage{display:block;margin-top:12px;font-size:var(--fs-h);font-weight:800;line-height:1.4;color:var(--ink)}
.next-line{display:block;margin-top:4px;color:var(--ink-2);font-size:var(--fs-body)}
.block-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--due);margin-bottom:4px}
.waiting-row{padding:8px 0}.waiting-item{font-size:var(--fs-h);font-weight:700;color:var(--ink);line-height:1.4}
.doc-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.sent-line{display:block;margin-top:4px;color:var(--ink-2);font-size:var(--fs-meta)}
.waiting-note{margin-top:8px}
.list{padding:4px 16px}
.line-sub{display:block;margin-top:2px;font-size:var(--fs-meta);line-height:1.5;color:var(--ink-2)}
.file-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.file-row:last-child{border:0}
.file-mark{width:36px;height:36px;flex:none;border-radius:var(--r-control);background:var(--jade-soft);color:var(--jade);font-size:var(--fs-cap);font-weight:800;display:flex;align-items:center;justify-content:center}.file-mark.pdf{background:var(--overdue-bg);color:var(--overdue)}
.file-name{display:block;font-size:var(--fs-body);font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.review-note{display:block;margin-top:4px;color:var(--overdue);font-size:var(--fs-meta);font-weight:700}
.activity{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.activity:last-child{border:0}
.activity-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--jade);margin-top:8px}
.activity-text{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink)}
.empty-line{padding:12px 0}
.more{display:block;padding:16px 0 0;color:var(--jade);font-size:var(--fs-body);font-weight:700}
.task{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.task:last-child{border:0}
.step{display:flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:50%;color:var(--jade);background:var(--jade-soft);font-size:var(--fs-cap);font-weight:800}.step.done{color:#fff;background:var(--jade)}
.task-title{display:block;font-size:var(--fs-body);font-weight:700;line-height:1.5;color:var(--ink)}
.official-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.official-row:last-child{border:0}
</style>
