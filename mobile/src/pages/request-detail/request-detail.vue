<template><view class="page detail-page" v-if="item"><text class="page-title">{{ item.title }}</text><text class="subtle">{{ item.route }} · {{ item.plateAsset ? '批文卡 '+item.plateAsset.card_number : item.vehicle?.plate || '新申請／未指定車輛' }}</text>
  <view class="progress card"><view class="psteps"><view v-for="(step,index) in steps" :key="step" class="pstep" :class="{done:index<stepIndex,current:index===stepIndex}"><view class="pdot">{{ index<stepIndex ? '✓' : index+1 }}</view><text>{{ step }}</text></view></view><text class="next-line">{{ nextText }}</text></view>
  <view v-if="waiting.length" class="card waiting"><text class="waiting-title">需要你配合</text><view v-for="t in waiting" :key="t.id" class="waiting-row"><view class="row"><text class="waiting-item">{{ t.title }}</text><button v-if="canUpload" class="upload-btn" :disabled="uploading" @click="chooseUpload(t.id)">上傳</button></view><view v-if="t.documents?.length" class="doc-list"><text v-for="d in t.documents" :key="d" class="doc">{{ d }}</text></view><text v-if="filesFor(t.id).length" class="sent-line">已交 {{ filesFor(t.id).length }} 份<text v-if="filesFor(t.id).some(f=>f.status==='需重交')" class="note-red"> · 有文件需要重交</text></text></view><text class="waiting-note">可直接拍照或上傳 PDF；不方便的話，也可以交給你的顧問。</text></view>
  <view v-if="files.length || canUpload" class="section-head"><text class="section-title">已交文件 · {{ files.length }}</text><text v-if="canUpload" class="link" @click="chooseUpload(null)">上傳文件 ›</text></view>
  <view v-if="files.length" class="card files-card"><view v-for="f in files" :key="f.id" class="file-row"><view class="file-mark" :class="f.mime==='application/pdf'?'pdf':''">{{ f.mime==='application/pdf' ? 'PDF' : '相' }}</view><view class="grow"><text class="file-name">{{ f.fileName }}</text><text class="task-meta">{{ taskTitle(f.taskId) }}{{ friendlyDate(f.createdAt) }} · {{ sizeText(f.size) }}</text><text v-if="f.status==='需重交' && f.reviewNote" class="review-note">{{ f.reviewNote }}</text></view><text class="pill" :class="attachmentTone[f.status]">{{ attachmentLabel[f.status] }}</text></view></view>
  <view v-else-if="canUpload" class="card empty files-empty">還沒有上傳文件。顧問收妥後會在這裡標示「已收妥」。</view>
  <view class="status-card"><view class="row"><text class="status-caption">目前進度</text><text class="pill" :class="{'已完成':'gray','已取消':'gray','需要你提供資料':'amber'}[item.status]||''">{{ item.status }}</text></view><text class="current-stage">{{ item.stage==='待內部受理' ? '等待顧問受理' : item.stage }}</text><text class="update-date">最近更新 {{ friendlyDate(item.updated_at) }}</text></view><button v-if="item.plateAsset" class="plate-file-link" @click="openPlate">查看這個牌照 ›</button>
  <view class="toggle-detail" @click="showDetail=!showDetail">{{ showDetail ? '收起辦理細節' : '查看辦理細節 ›' }}</view><view v-if="showDetail">
  <view class="row section-head"><text class="section-title">辦理項目</text><text class="count">{{ item.tasks.length }} 個節點</text></view><view class="card task-card"><view v-for="(task,index) in item.tasks" :key="task.id" class="task"><view class="step" :class="task.status==='已完成'?'done':''">{{ task.status==='已完成'?'✓':index+1 }}</view><view class="task-body"><text class="task-title">{{ task.title }}</text><text class="task-meta">{{ task.jurisdiction }} · {{ task.status }}</text></view></view></view>
  <text class="section-title">官方依據</text><view class="card source-card"><view v-for="source in selectedSources" :key="source.id" class="official-row" @click="openSource(source.url)"><view><text class="task-title">{{ source.title }}</text><text class="task-meta">{{ source.agency }} · 點擊複製官方連結</text></view><text class="official-arrow">↗</text></view><text v-if="!selectedSources.length" class="subtle">此要求須由專員先核對適用的官方指引。</text></view></view>
  <text class="section-title">更新紀錄</text><view class="card activity-card"><view v-for="activity in item.activities" :key="activity.id" class="activity"><view class="activity-dot"></view><view><text class="activity-text">{{ activity.detail }}</text><text class="task-meta">{{ friendlyDate(activity.created_at) }}</text></view></view></view><view class="tip">官方審批結果以實際回執及發出的牌證為準。若需補充文件，專員會與你聯絡。</view>
</view></template>
<script setup>
import { ref,computed } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { api,friendlyDate,pickPhotos,pickPdf,uploadAttachment,attachmentTone,attachmentLabel } from '../../lib/api'
const item=ref(null),sources=ref([]),files=ref([]),uploading=ref(false)
// Customer-facing four-step progress derived from the internal case status.
const steps=['已提交','收集資料','辦理中','完成'],showDetail=ref(false)
// 伺服器已把內部狀態換成客戶看得懂的文字：已收到／需要你提供資料／辦理中／已完成／已取消
const stepIndex=computed(()=>{const status=item.value?.status;return status==='已完成'?3:status==='辦理中'?2:status==='需要你提供資料'?1:0})
const waiting=computed(()=>item.value?.clientTodos||(item.value?.tasks||[]).filter(t=>t.status==='待客戶配合'))
const nextText=computed(()=>item.value?.status==='已取消'?'這張工單已取消。如有疑問請聯絡你的顧問。':stepIndex.value===0?'顧問會盡快受理，並告訴你需要準備的資料。':stepIndex.value===1?(waiting.value.length?'資料齊全後就會開始辦理。':'顧問正在整理資料。'):stepIndex.value===2?'正在辦理，有結果會通知你。':'已辦理完成。')
const selectedSources=computed(()=>sources.value.filter(s=>item.value?.plan?.sourceIds?.includes(s.id)))
function openSource(url){uni.setClipboardData({data:url,success:()=>uni.showToast({title:'官方連結已複製',icon:'none'})})}
function openPlate(){if(item.value?.plateAsset)uni.navigateTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(item.value.plateAsset.id)})}
const canUpload=computed(()=>item.value&&!['已完成','已取消'].includes(item.value.status))
function filesFor(taskId){return files.value.filter(f=>f.taskId===taskId)}
function taskTitle(taskId){const task=(item.value?.tasks||[]).find(t=>t.id===taskId);return task?task.title+' · ':''}
function sizeText(size){return size>=1048576?(size/1048576).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB'}
// 拍照／相簿或 PDF；逐份上傳，任何一份失敗都告訴客戶是哪一份
function chooseUpload(taskId){uni.showActionSheet({itemList:['拍照或選相片','選擇 PDF 文件'],success:async({tapIndex})=>{
  let picked=[];try{picked=tapIndex===0?await pickPhotos():await pickPdf()}catch(e){return uni.showToast({title:e.message,icon:'none'})}
  if(!picked.length)return
  uploading.value=true;let ok=0;const failed=[]
  for(const [index,file] of picked.entries()){uni.showLoading({title:`上傳中 ${index+1}/${picked.length}`,mask:true});try{await uploadAttachment(requestId,file,taskId);ok++}catch(e){failed.push(`${file.name}：${e.message}`)}}
  uni.hideLoading();uploading.value=false
  if(failed.length)uni.showModal({title:ok?`已上傳 ${ok} 份，${failed.length} 份未成功`:'上傳未成功',content:failed.join('\n'),showCancel:false})
  else uni.showToast({title:`已上傳 ${ok} 份`,icon:'success'})
  loadFiles()}})}
async function loadFiles(){try{files.value=await api('/my/requests/'+requestId+'/attachments')}catch{files.value=[]}}
let requestId=''
async function load(){if(!requestId)return;try{const [record,catalog]=await Promise.all([api('/requests/'+requestId),api('/catalog')]);item.value=record;sources.value=catalog.sources;loadFiles()}catch(e){uni.showToast({title:e.message,icon:'none'})}}
onLoad(options=>{requestId=options.id||'';load()})
onShow(()=>{if(item.value)load()})
</script>
<style scoped>
.waiting-item{display:block;font-size:25rpx;font-weight:750;color:var(--ink)}.doc-list{display:flex;flex-wrap:wrap;gap:10rpx;margin:10rpx 0 6rpx}.doc{padding:6rpx 14rpx;border-radius:99rpx;background:var(--due-bg);color:var(--due);font-size:21rpx;font-weight:700}
.detail-page{padding-top:29rpx}.status-card{margin-top:29rpx;background:var(--jade-deep);border-radius:22rpx;color:#fff;padding:25rpx 29rpx}.status-caption{color:#c4e0cd;font-size:21rpx;font-weight:750}.current-stage{display:block;font-size:32rpx;line-height:1.35;font-weight:800;margin:18rpx 0 9rpx}.update-date{color:#b9d6c5;font-size:20rpx}.plate-file-link{margin:13rpx 0 0;background:#e5f0e7;color:#236a4d;font-size:20rpx;font-weight:800}.section-head .section-title{margin-bottom:17rpx}.count{color:#809286;font-size:20rpx}.task-card{padding:9rpx 25rpx}.task{display:flex;align-items:flex-start;gap:17rpx;padding:20rpx 0;border-bottom:1rpx solid var(--rule)}.task:last-child{border:0}.step{display:flex;align-items:center;justify-content:center;flex:none;width:43rpx;height:43rpx;border-radius:50%;color:#5f8b70;background:#e8f3eb;font-size:21rpx;font-weight:800}.step.done{color:#fff;background:#23805d}.task-body{flex:1}.task-title{display:block;font-size:23rpx;font-weight:800;line-height:1.45}.task-meta{display:block;color:#809387;font-size:20rpx;line-height:1.5;margin-top:4rpx}.source-card{padding:9rpx 25rpx}.official-row{display:flex;align-items:center;justify-content:space-between;gap:17rpx;padding:19rpx 0;border-bottom:1rpx solid var(--rule)}.official-row:last-child{border:0}.official-arrow{color:#348361;font-size:27rpx}.activity-card{padding:10rpx 25rpx}.activity{display:flex;gap:18rpx;padding:16rpx 0}.activity-dot{width:10rpx;height:10rpx;flex:none;border-radius:50%;background:#46a778;margin-top:12rpx}.activity-text{display:block;font-size:22rpx;line-height:1.5}.tip{color:var(--ink-3);font-size:20rpx;text-align:center;line-height:1.6;padding:18rpx 28rpx}
.toggle-detail{margin:26rpx 0 4rpx;color:var(--jade);font-size:23rpx;font-weight:750}.progress{margin-top:24rpx}.psteps{display:flex;justify-content:space-between}.pstep{flex:1;display:flex;flex-direction:column;align-items:center;gap:8rpx;font-size:21rpx;color:#8a9c90}.pdot{width:44rpx;height:44rpx;border-radius:50%;background:var(--muted-bg);display:flex;align-items:center;justify-content:center;font-weight:800}.pstep.done{color:var(--jade)}.pstep.done .pdot{background:#dcefe2}.pstep.current{color:var(--jade);font-weight:800}.pstep.current .pdot{background:var(--jade);color:#fff}.next-line{display:block;margin-top:18rpx;color:var(--ink-2);font-size:23rpx;text-align:center}.waiting{border-color:#f1d29c;background:#fffaf1}.waiting-title{display:block;font-size:26rpx;font-weight:800;color:#9e6414;margin-bottom:8rpx}.waiting-row{font-size:24rpx;padding:5rpx 0}.waiting-note{display:block;margin-top:8rpx;color:#8a7a5c;font-size:21rpx}
.upload-btn{flex:none;margin:0;padding:0 26rpx;height:56rpx;line-height:56rpx;border-radius:var(--r-control);background:var(--jade);color:#fff;font-size:22rpx;font-weight:750}.upload-btn[disabled]{opacity:.5}
.sent-line{display:block;color:var(--ink-2);font-size:21rpx;margin-top:4rpx}.files-card{padding:6rpx 25rpx}.files-empty{padding:30rpx 23rpx}
.file-row{display:flex;align-items:center;gap:18rpx;padding:18rpx 0;border-bottom:1rpx solid var(--rule)}.file-row:last-child{border:0}.grow{flex:1;min-width:0}
.file-mark{width:56rpx;height:56rpx;flex:none;border-radius:var(--r-control);background:var(--jade-soft);color:var(--jade);font-size:20rpx;font-weight:900;display:flex;align-items:center;justify-content:center}.file-mark.pdf{background:var(--overdue-bg);color:var(--overdue);font-size:17rpx}
.file-name{display:block;font-size:24rpx;font-weight:750;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.review-note{display:block;margin-top:6rpx;color:var(--overdue);font-size:21rpx;font-weight:700}
</style>
