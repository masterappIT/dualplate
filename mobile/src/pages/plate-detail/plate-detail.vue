<template>
  <view class="page plate-page">
    <view v-if="creating" class="card"><text class="list-title">登記現有批文卡</text><text class="list-sub">尚未取得批文卡，請使用申請辦理。</text><button class="primary go-create" @click="uni.redirectTo({url:'/pages/plate-create/plate-create'})">前往批文卡建檔</button></view>
    <view v-if="!creating && loaded && !plates.length" class="card empty">找不到這個兩地牌檔案。</view>
    <view v-for="p in plates" :key="p.id">
      <!-- 頁首：車牌＋整體狀態 -->
      <view class="head">
        <view class="head-plates"><PlateChip :plate="p.mainland_plate || summary.mainlandPlate" region="內地" size="lg" /><PlateChip v-if="p.local_plate" :plate="p.local_plate" :region="p.route==='粵澳'?'澳門':'香港'" size="lg" /><text v-if="summary.health" class="pill" :class="healthTone[summary.health]">{{ healthLabel[summary.health] }}</text></view>
        <text class="subtle head-sub">{{ [p.route+'兩地牌', summary.holder].filter(Boolean).join(' · ') }}</text>
      </view>
      <view v-if="summary.warnings?.length" class="list-card warn-card"><text class="list-title">{{ summary.warnings.join('、') }}</text><text class="list-sub">牌照仍照常管理，如需處理我們會聯絡你。</text></view>
      <!-- 建檔時按批文卡名稱建立的公司，資料要客戶補上 -->
      <view v-if="summary.companyGaps?.length" class="list-card warn-card" @click="fillCompany(summary.companyGaps[0].id)"><text class="list-title">請補上公司資料</text><text v-for="c in summary.companyGaps" :key="c.id" class="list-sub">{{ c.name }}：缺{{ c.missing.join('、') }}</text><text class="link fill-link">前往補充 ›</text></view>

      <!-- 最常用的辦理入口放在最上面 -->
      <view v-if="summary.id" class="actions"><button v-for="a in quickActions" :key="a.code" class="btn-line action" @click="startRequest(a.code, summary.id)">{{ a.name }}</button></view>

      <view v-if="summary.id">
        <view class="section-head"><text class="section-title">到期項目</text><text v-if="deadlineList.length" class="subtle num">{{ deadlineList.length }} 項</text></view>
        <view class="card list">
          <view v-for="(item,index) in shownDeadlines" :key="index" class="line">
            <view class="grow"><text class="line-title">{{ item.name }}</text><text v-if="item.handledBy==='you'" class="who">{{ selfHandled }}</text><text v-if="isPending(item.ownerType,item.ownerId,'date:'+item.code)" class="pill amber pending-tag">已修改，待核對</text><text v-if="deadlineSub(item)" class="line-sub">{{ deadlineSub(item) }}</text></view>
            <picker v-if="item.editable" mode="date" :value="item.dueOn" @change="saveDate(item,$event.detail.value)"><view class="date-edit"><DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" /><text class="link">修改</text></view></picker>
            <view v-else class="date-edit"><DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" /><text class="link date-spacer" aria-hidden="true">修改</text></view>
          </view>
          <text v-if="!deadlineList.length" class="line-sub">{{ summary.health==='pending' ? '你的顧問正在整理這個牌照的到期資料。' : '半年內沒有到期項目。' }}</text>
          <view v-if="deadlineList.length > 5" class="more" @click="allDeadlines=!allDeadlines">{{ allDeadlines ? '收起' : '顯示全部 '+deadlineList.length+' 項' }}</view>
        </view>

        <view class="card crossing-card">
          <view class="row"><view class="grow"><text class="line-title">90 天過關提醒</text><text class="line-sub">{{ summary.crossing?.enabled ? '每 '+(summary.crossing?.days||90)+' 天須過關一次，期限前提醒你' : '車輛不常過關時可開啟，我們會在期限前提醒你' }}</text></view><switch :checked="!!summary.crossing?.enabled" color="#0F5C4A" :disabled="crossingBusy" @change="toggleReminder($event.detail.value)" /></view>
          <view v-if="summary.crossing?.enabled"><view class="ticket-rule" /><view class="row"><text class="line-sub">{{ summary.crossing?.lastCrossedOn ? '上次過關 '+summary.crossing.lastCrossedOn : '請記錄最近一次過關日期' }}</text><DueDate v-if="summary.crossing?.nextDueOn" :date="summary.crossing.nextDueOn" /><StampMark v-if="justCrossed" text="已過關" tone="jade" play class="crossing-stamp" /></view><button class="primary crossing-button" :disabled="crossingBusy" @click="markCrossed(todayIso())">{{ crossingBusy ? '記錄中' : '今天已過關' }}</button><picker mode="date" :end="todayIso()" @change="markCrossed($event.detail.value)"><text class="link other-date">其他日期過關 ›</text></picker></view>
        </view>
      </view>

      <!-- 批文卡：保留預覽、翻面、上傳辨識、手動修改 -->
      <view class="section-head"><text class="section-title">批文卡</text><text class="pill" :class="p.card_status==='已核對'?'':'gray'">{{ p.card_status || '待核對' }}</text></view>
      <view class="card approval">
        <ApprovalCard :key="p.id" :data="displayCardData(p)" :back="cardBack" :flip-on-tap="false" :tap-label="cardBack ? '翻到批文卡正面' : '翻到批文卡背面'" @card-tap="cardBack=!cardBack"/>
        <view class="segmented flip-switch"><text class="seg" :class="{on:!cardBack}" @click="cardBack=false">正面</text><text class="seg" :class="{on:cardBack}" @click="cardBack=true">背面</text></view>
        <view class="card-actions"><button v-if="originalSides(p).length" class="btn-sm" @click="viewOriginal(p)">查看正本</button><button class="btn-sm" @click="editCard(p)">修改內容</button><button class="btn-sm" @click="uploadCard(p)">上傳新批文卡</button></view>
        <view v-if="editingCardId===p.id" class="card-editor">
          <view v-for="field in cardFields" :key="field.key"><text class="field-label">{{ field.label }}<text v-if="fieldStatusText(fieldStatus[field.key])" class="field-status" :class="fieldStatusClass(fieldStatus[field.key])">{{ fieldStatusText(fieldStatus[field.key]) }}</text></text><input class="field" v-model="cardDraft[field.key]" :placeholder="field.label"/></view>
          <view class="editor-actions"><button class="btn-sm" @click="editingCardId=''">取消</button><button class="btn-sm solid" @click="saveCard(p)">儲存批文卡內容</button></view>
        </view>
      </view>

      <!-- 車牌實物樣式與牌照資料 -->
      <view class="section-head"><text class="section-title">車牌</text><text v-if="isPending('plate',p.id)" class="pill amber">已修改，待核對</text></view>
      <view class="card">
        <view class="plate-pair">
          <view class="plate-item"><text class="plate-label">內地港澳入出境號牌</text><MainlandPlate v-if="p.mainland_plate" :plate="p.mainland_plate" :width="300"/><view v-else class="plate-missing">未提供號碼</view></view>
          <view class="plate-item"><text class="plate-label">{{ p.route==='粵港'?'香港':'澳門' }}號牌</text><template v-if="p.local_plate"><HongKongPlate v-if="p.route==='粵港'" :plate="p.local_plate" :width="300"/><view v-else class="physical-plate macau"><text>{{ formatMacau(p.local_plate) }}</text></view></template><view v-else class="plate-missing">未提供號碼</view></view>
        </view>
        <view class="kv facts"><text class="k">上牌狀態</text><text class="v">{{ p.installation_status==='待核對' ? '確認中' : p.installation_status }}</text><text class="k">使用狀態</text><text class="v">{{ usageWord(p.usage_status) }}</text><text class="k">綁定車輛</text><text class="v">{{ boundVehicle(p) }}</text></view>
        <view class="more" @click="showEdit=!showEdit">{{ showEdit ? '收起資料修改' : '修改牌照資料 ›' }}</view>
        <view v-if="showEdit" class="edit-file">
          <text class="field-label">內地車牌號</text><input class="field" v-model="plateForm.mainlandPlate" placeholder="尚未上牌可留空"/>
          <text class="field-label">香港／澳門車牌號</text><input class="field" v-model="plateForm.localPlate" placeholder="尚未上牌可留空"/>
          <text class="field-label">上牌狀態</text><picker :range="['待核對','未上牌','已上牌']" @change="plateForm.installationStatus=['待核對','未上牌','已上牌'][Number($event.detail.value)]"><view class="field picker"><text>{{ plateForm.installationStatus }}</text><text class="chev">›</text></view></picker>
          <text class="field-label">綁定車輛</text><picker :range="vehicleOptions(p)" range-key="label" @change="plateForm.vehicleId=vehicleOptions(p)[Number($event.detail.value)]?.id||''"><view class="field picker"><text>{{ vehicleOptions(p).find(v=>v.id===plateForm.vehicleId)?.label || '未綁定' }}</text><text class="chev">›</text></view></picker>
          <text class="field-label">批文卡有效期至</text><input class="field num" v-model="plateForm.cardExpiresOn" placeholder="YYYY-MM-DD"/>
          <text class="field-label">備註</text><textarea class="field notes" v-model="plateForm.notes" placeholder="補充這個兩地牌的資料"/>
          <text class="line-sub">使用狀態由顧問記錄；批文卡編號請在上方「修改內容」更新。修改後立即生效，顧問會再核對。</text>
          <button class="primary save-file" :disabled="savingFile" @click="savePlate(p)">{{ savingFile ? '正在儲存…' : '儲存牌照資料' }}</button>
        </view>
      </view>

      <view v-if="summary.id">
        <text class="section-title">使用情況</text>
        <view class="card kv">
          <text class="k">用途</text><text class="v">{{ summary.rental ? '使用安排：'+summary.rental.renter : summary.usageStatus==='自用' ? '自用' : summary.installationStatus==='未上牌' ? '空置（未上牌）' : '確認中' }}</text>
          <template v-if="summary.rental"><text class="k">使用期</text><text class="v num">{{ (summary.rental.startsOn||'—')+' 至 '+(summary.rental.endsOn||'未定') }}</text></template>
          <text v-if="summary.indicatorCategory" class="k">指標類別</text><text v-if="summary.indicatorCategory" class="v">{{ summary.indicatorCategory }}</text>
          <text v-if="summary.port" class="k">口岸</text><text v-if="summary.port" class="v">{{ summary.port }}</text>
          <text class="k">持牌公司</text><text class="v">{{ summary.holder || '待補充' }}</text>
          <text class="k">內承單位</text><text class="v">{{ summary.contractor || '待補充' }}</text>
        </view>

        <view v-if="arrangements.length"><text class="section-title">車輛使用安排</text><view v-for="a in arrangements" :key="a.id" class="card"><view class="row"><view class="grow"><text class="line-title">{{ a.user.name }}</text><text class="line-sub">{{ a.user.vehiclePlate ? '使用車輛 ' + a.user.vehiclePlate + ' · ' : '' }}{{ a.startsOn }} 起{{ a.endsOn ? ' 至 ' + a.endsOn : '' }}</text></view><text class="pill" :class="a.status==='生效'?'':'gray'">{{ a.status==='生效' ? '使用中' : a.status }}</text></view><text class="line-sub">使用費 {{ money(a.currency, a.amount) }} / {{ cycleLabel[a.cycle] }} · {{ a.collectionMode==='代收' ? '由我們代收' : '直接付給你' }}</text><view class="ticket-rule" /><view v-for="i in a.invoices" :key="i.id" class="fee-row"><text class="num">{{ i.period }}</text><text class="pill" :class="feeTone[i.status]">{{ feeLabel(a, i) }}</text></view><text v-if="!a.invoices.length" class="line-sub">暫時沒有使用費記錄</text></view></view>

        <view v-if="summary.drivers?.length"><text class="section-title">登記司機</text><view class="card list"><view v-for="d in summary.drivers" :key="d.id"><view class="line" @click="editDriver(d)"><view class="grow"><text class="line-title">{{ d.name }}</text><text v-if="isPending('driver',d.id)" class="pill amber pending-tag">已修改，待核對</text></view><text class="pill" :class="d.role==='主'?'':'gray'">{{ d.role==='主' ? '主司機' : '副司機' }}</text><text class="link">{{ editingDriverId===d.id ? '收起' : '修改' }}</text></view>
              <view v-if="editingDriverId===d.id" class="inline-editor">
                <text class="field-label">姓名</text><input class="field" v-model="driverForm.name" placeholder="司機姓名"/>
                <text class="field-label">電話</text><input class="field num" v-model="driverForm.phone" placeholder="例如 +852 9123 4567"/>
                <text class="field-label">香港身份證號碼</text><input class="field num" v-model="driverForm.hkIdNo" placeholder="例如 A123456(7)"/><text class="line-sub">只保存最後 4 位</text>
                <text class="field-label">回鄉證號碼</text><input class="field num" v-model="driverForm.homeReturnPermitNo" placeholder="按回鄉證填寫"/>
                <view class="editor-actions"><button class="btn-sm" @click="editingDriverId=''">取消</button><button class="btn-sm solid" :disabled="savingDriver" @click="saveDriver">{{ savingDriver ? '正在儲存…' : '儲存司機資料' }}</button></view>
              </view></view><text class="line-sub driver-note">司機證件到期會列在到期項目。要更換司機，按頁面上方「換司機」。</text></view></view>

        <view v-if="summary.requests?.length"><text class="section-title">辦理記錄</text><view class="card list"><view v-for="r in summary.requests" :key="r.id" class="line" @click="openRequest(r.id)"><view class="grow"><view class="row"><text class="line-title grow">{{ r.title }}</text><text class="pill" :class="requestTone(r.status)">{{ r.status }}</text></view><text class="line-sub">{{ clientStage(r.stage) }}</text></view><text class="chev">›</text></view></view></view>
      </view>
    </view>

    <view v-if="!creating && boundVehicles.length"><text class="section-title">綁定車輛與驗車</text>
      <view v-for="v in boundVehicles" :key="v.id" class="card">
        <view class="row"><PlateChip :plate="v.plate" :region="v.origin==='內地'?'內地':v.origin==='澳門'?'澳門':'香港'" /><text class="pill gray">{{ v.type }}</text></view>
        <view class="kv facts"><text class="k">車型</text><text class="v">{{ [v.brand,v.model].filter(Boolean).join(' ') || '待補充' }}</text><text class="k">類別</text><text class="v">{{ v.route }} · {{ v.origin }}車</text><template v-if="v.manufactured_year"><text class="k">製造年份</text><text class="v num">{{ v.manufactured_year }}</text></template></view>
        <text v-if="isPending('vehicle',v.id)" class="pill amber pending-tag">已修改，待核對</text>
        <view class="more" @click="editVehicle(v)">{{ editingVehicleId===v.id ? '收起車輛修改' : '修改車輛資料 ›' }}</view>
        <view v-if="editingVehicleId===v.id" class="inline-editor">
          <text class="field-label">車牌</text><input class="field num" v-model="vehicleForm.plate" placeholder="車牌號碼"/>
          <text class="field-label">品牌</text><input class="field" v-model="vehicleForm.brand" placeholder="例如 Toyota"/>
          <text class="field-label">型號</text><input class="field" v-model="vehicleForm.model" placeholder="例如 Alphard"/>
          <text class="field-label">車架號碼</text><input class="field num" v-model="vehicleForm.vin" placeholder="按行車證填寫"/>
          <text class="field-label">製造年份</text><input class="field num" type="number" v-model="vehicleForm.manufacturedYear" placeholder="例如 2021"/>
          <text class="field-label">首次登記日期</text><picker mode="date" :value="vehicleForm.firstRegisteredOn" @change="vehicleForm.firstRegisteredOn=$event.detail.value"><view class="field picker"><text>{{ vehicleForm.firstRegisteredOn || '選擇日期' }}</text><text class="chev">›</text></view></picker>
          <view class="editor-actions"><button class="btn-sm" @click="editingVehicleId=''">取消</button><button class="btn-sm solid" :disabled="savingVehicle" @click="saveVehicle(v)">{{ savingVehicle ? '正在儲存…' : '儲存車輛資料' }}</button></view>
        </view>
        <view class="ticket-rule" />
        <text class="line-title">驗車安排</text>
        <view v-for="i in detail[v.id]?.inspections || []" :key="i.id" class="line"><view class="grow"><text class="line-title">{{ i.title }}</text><text class="line-sub num">{{ i.appointment_on || '日期待安排' }}</text></view><text class="pill blue">{{ i.status }}</text></view>
        <text v-if="!detail[v.id]?.inspections?.length" class="line-sub">暫時沒有驗車安排。</text>
        <view v-if="detail[v.id]?.inspectionGuidance?.length" class="guidance"><text class="line-sub guidance-title">相關官方規定</text><view v-for="g in detail[v.id].inspectionGuidance" :key="g.label" class="guidance-line" @click="openSource(g.sourceId)"><text class="grow">{{ g.label }}</text><text v-if="g.sourceId" class="link">來源 ›</text></view></view>
      </view>
    </view>
  </view>
</template>
<script setup>
import { ref,computed } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { api,getUser,startRequest,requestTone,clientStage,detailText,selfHandled,money,cardPhoto,viewCardOriginal } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
import ApprovalCard from '../../components/ApprovalCard.vue'
import MainlandPlate from '../../components/MainlandPlate.vue'
import HongKongPlate from '../../components/HongKongPlate.vue'
const vehicles=ref([]),detail=ref({}),plates=ref([]),plateDetail=ref({}),sources=ref([])
const crossingBusy=ref(false),justCrossed=ref(false),loaded=ref(false),cardBack=ref(false),allDeadlines=ref(false)
const healthLabel={ok:'正常',due:'快到期',overdue:'已逾期',pending:'資料整理中'},healthTone={ok:'',due:'amber',overdue:'red',pending:'gray'}
// 90 天過關有自己的卡片，不在到期清單重複
const deadlineList=computed(()=>(summary.value.deadlines||[]).filter(item=>!(summary.value.crossing?.enabled&&item.name==='90 天過關')))
const shownDeadlines=computed(()=>allDeadlines.value?deadlineList.value:deadlineList.value.slice(0,5))
function deadlineSub(item){return [item.ownerType==='plate'?'':item.ownerLabel,detailText(item.detail)].filter(Boolean).join(' · ')}
const boundVehicles=computed(()=>vehicles.value.filter(v=>v.id===plates.value[0]?.vehicle_id))
const todayIso=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
// 客戶按「今天已過關」或選其他日期；成功後蓋章並重新整理到期項目
async function toggleReminder(on){if(crossingBusy.value)return;crossingBusy.value=true;try{await api('/my/plates/'+plateId+'/crossing-reminder','PUT',{enabled:!!on});summary.value=await api('/my/plates/'+plateId);uni.showToast({title:on?'已開啟 90 天過關提醒':'已關閉提醒',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{crossingBusy.value=false}}
async function markCrossed(date){if(crossingBusy.value||!date)return;crossingBusy.value=true;try{const result=await api('/my/plates/'+plateId+'/crossings','POST',{crossedOn:date});justCrossed.value=false;setTimeout(()=>{justCrossed.value=true},10);uni.showToast({title:'已記錄，下次請在 '+result.nextDueOn+' 前過關',icon:'none',duration:2600});summary.value=await api('/my/plates/'+plateId)}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{crossingBusy.value=false}}
const summary=ref({}),showEdit=ref(false),fieldStatus=ref({}),arrangements=ref([])
// 客戶端不寫「出租」：牌照用途顯示為使用安排
const usageWord=status=>!status||status==='待核對'?'確認中':status==='出租中'?'使用安排中':status
const cycleLabel={monthly:'每月',quarterly:'每季',yearly:'每年'},feeTone={已收:'gray',逾期:'red',部分收:'amber',待收:''}
// 代收的寫「已收到」；直付的由客戶自己收款，寫「已確認收到」
function feeLabel(a,i){return i.status==='已收'?(a.collectionMode==='代收'?'我們已收到':'已確認收到'):i.status==='逾期'?'未收到（已過期）':i.status==='部分收'?'部分收到':'未到期'}
const quickActions=[{code:'renewal',name:'續期'},{code:'vehicle_change',name:'換車'},{code:'driver_change',name:'換司機'},{code:'other',name:'其他'}]
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
const editingCardId=ref(''),cardDraft=ref({}),creating=ref(false),plateForm=ref({}),savingFile=ref(false)
let plateId=''
const cardFields=[['cardNumber','編號'],['company','商號'],['contractor','內承單位'],['crossing','通行口岸'],['serial','卡面流水號'],['mainlandPlate','內地車牌號'],['localPlate','港澳車牌號'],['driver1','駕駛人 1'],['driver2','駕駛人 2'],['driver3','駕駛人 3'],['currentApproval','現批文號'],['previousApproval','原批文號'],['color','顏色'],['seats','座位／噸位'],['purpose','請予辦理'],['validFrom','有效期開始'],['validTo','有效期結束'],['notes','備註']].map(([key,label])=>({key,label}))
function vehicleOptions(p){return [{id:'',label:'未綁定'},...vehicles.value.filter(v=>v.customer_id===p.customer_id&&v.route===p.route).map(v=>({id:v.id,label:[v.plate,v.brand,v.model].filter(Boolean).join(' · ')}))]}
function fillPlateForm(p){plateForm.value={mainlandPlate:p.mainland_plate||'',localPlate:p.local_plate||'',installationStatus:p.installation_status||'待核對',usageStatus:p.usage_status||'待核對',vehicleId:p.vehicle_id||'',cardNumber:p.card_number||'',cardExpiresOn:p.card_expires_on||'',notes:p.notes||''}}
async function savePlate(p){if(savingFile.value)return;savingFile.value=true;try{const updated=await api('/plate-assets/'+p.id,'PATCH',plateForm.value);plates.value=[updated];plateDetail.value={...plateDetail.value,[p.id]:updated};fillPlateForm(updated);summary.value=await api('/my/plates/'+p.id);loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{savingFile.value=false}}
function displayCardData(p){return editingCardId.value===p.id?cardDraft.value:plateDetail.value[p.id]?.cardData||{}}
function editCard(p){cardDraft.value={...(plateDetail.value[p.id]?.cardData||{})};editingCardId.value=p.id}
function fieldStatusText(status){return status?.status==='uncertain'?'請核對':status?.status==='failed'?'未能辨識，請手動填寫':''}
function fieldStatusClass(status){return status?.status==='failed'?'failed':'uncertain'}
async function saveCard(p){try{const updated=await api('/plate-assets/'+p.id,'PUT',{cardData:cardDraft.value});plateDetail.value={...plateDetail.value,[p.id]:updated};plates.value=plates.value.map(item=>item.id===p.id?updated:item);editingCardId.value='';summary.value=await api('/my/plates/'+p.id);loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}}
function uploadCard(p){uni.showActionSheet({itemList:['正面','背面'],success:choice=>{const side=choice.tapIndex===0?'front':'back';uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{uni.showLoading({title:'正在上傳辨識',mask:true});try{const image=(await cardPhoto(result)).data;const response=await api('/plate-assets/'+p.id+'/card/'+side,'POST',{image});fieldStatus.value=response.fieldStatus||{};const updated=await api('/plate-assets/'+p.id);plateDetail.value={...plateDetail.value,[p.id]:updated};plates.value=plates.value.map(item=>item.id===p.id?updated:item);editCard(p);summary.value=await api('/my/plates/'+p.id);loadPending();uni.hideLoading();uni.showToast({title:'已辨識，請核對欄位',icon:'none'})}catch(e){uni.hideLoading();uni.showToast({title:e.message||'上傳失敗',icon:'none'})}}})}})}
// 上傳過的批文卡照片（正本）：有哪一面就看哪一面，預設打開目前翻到的那面
const originalSides=p=>['front','back'].filter(side=>plateDetail.value[p.id]?.cardImages?.[side])
function viewOriginal(p){const sides=originalSides(p);viewCardOriginal(p.id,sides,cardBack.value?'back':'front')}
// 客戶自行修改：立即生效，顧問再核對（docs/v1-plan.md §三）
const pending=ref([]),drivers=ref([]),driverForm=ref({}),editingDriverId=ref(''),savingDriver=ref(false),vehicleForm=ref({}),editingVehicleId=ref(''),savingVehicle=ref(false)
const isPending=(type,id,field)=>pending.value.some(x=>x.entityType===type&&x.entityId===id&&(!field||x.field===field))
async function loadPending(){try{pending.value=await api('/my/pending')}catch{pending.value=[]}}
async function saveDate(item,date){if(!date||date===item.dueOn)return;try{await api('/my/dates','PUT',{ownerType:item.ownerType,ownerId:item.ownerId,code:item.code,expiresOn:date});summary.value=await api('/my/plates/'+plateId);loadPending();uni.showToast({title:'到期日已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}}
function editDriver(d){if(editingDriverId.value===d.id){editingDriverId.value='';return}const full=drivers.value.find(x=>x.id===d.id)||{};driverForm.value={name:full.name||d.name,phone:full.phone||'',hkIdNo:full.hkIdNo||'',homeReturnPermitNo:full.homeReturnPermitNo||''};editingDriverId.value=d.id}
async function saveDriver(){if(savingDriver.value)return;savingDriver.value=true;try{await api('/my/drivers/'+editingDriverId.value,'PATCH',driverForm.value);editingDriverId.value='';const [mine,list]=await Promise.all([api('/my/plates/'+plateId),api('/my/drivers')]);summary.value=mine;drivers.value=list;loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{savingDriver.value=false}}
function editVehicle(v){if(editingVehicleId.value===v.id){editingVehicleId.value='';return}vehicleForm.value={plate:v.plate||'',brand:v.brand||'',model:v.model||'',vin:v.vin||'',manufacturedYear:v.manufactured_year?String(v.manufactured_year):'',firstRegisteredOn:v.first_registered_on||''};editingVehicleId.value=v.id}
async function saveVehicle(v){if(savingVehicle.value)return;savingVehicle.value=true;try{const updated=await api('/my/vehicles/'+v.id,'PATCH',{...vehicleForm.value,manufacturedYear:String(vehicleForm.value.manufacturedYear||'')});vehicles.value=vehicles.value.map(item=>item.id===v.id?updated:item);editingVehicleId.value='';loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{savingVehicle.value=false}}
// 到「我的公司」打開那間公司的修改表單
function fillCompany(id){uni.setStorageSync('editCompany',id);uni.switchTab({url:'/pages/companies/companies'})}
function boundVehicle(p){const v=vehicles.value.find(x=>x.id===p.vehicle_id);return v?[v.brand,v.model,v.plate].filter(Boolean).join(' · '):'未綁定'}
function mainlandParts(value){const clean=String(value||'').toUpperCase().replace(/[\s·•.-]/g,'');const match=clean.match(/^([粵粤])([A-Z])(.+?)([港澳])$/);return match?{province:'粵',code:match[2],serial:match[3],suffix:match[4]}:{province:'',code:'',serial:clean,suffix:''}}
function formatHongKong(value){const clean=String(value||'').toUpperCase().replace(/\s+/g,'');return clean.replace(/^([A-Z]{1,2})([0-9]{1,4})$/,'$1 $2')}
function formatMacau(value){const clean=String(value||'').toUpperCase().replace(/[\s-]/g,'');return clean.replace(/^([A-Z]{2})([0-9]{2})([0-9]{2})$/,'$1-$2-$3')}
function openSource(sourceId){const source=sources.value.find(s=>s.id===sourceId);if(source)uni.setClipboardData({data:source.url,success:()=>uni.showToast({title:'官方連結已複製',icon:'none'})})}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});if(creating.value||!plateId)return;try{const [p,v,catalog,mine]=await Promise.all([api('/plate-assets/'+plateId),api('/vehicles'),api('/catalog'),api('/my/plates/'+plateId)]);summary.value=mine;loadPending();api('/my/drivers').then(list=>{drivers.value=list}).catch(()=>{drivers.value=[]});api('/my/rentals').then(list=>{arrangements.value=list.filter(item=>item.plateId===plateId)}).catch(()=>{arrangements.value=[]});plates.value=[p];plateDetail.value={...plateDetail.value,[p.id]:p};vehicles.value=v;sources.value=catalog.sources;fillPlateForm(p);detail.value=Object.fromEntries(await Promise.all(v.map(async item=>[item.id,await api('/vehicles/'+item.id)])))}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
onLoad(options=>{plateId=options.id||'';creating.value=options.new==='1';if(!creating.value)load()})
onShow(load)
import DueDate from '../../components/DueDate.vue'
import StampMark from '../../components/StampMark.vue'
</script>
<style scoped>
.head{margin-bottom:16px}.head-plates{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.head-sub{margin-top:8px}
.actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:4px}.action{width:auto;padding:0 4px}
.list{padding:4px 16px}
.line{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.line-sub{display:block;margin-top:2px;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.list>.line-sub{padding:12px 0}
.more{display:block;padding:12px 0;color:var(--jade);font-size:var(--fs-body);font-weight:700;text-align:center}
.crossing-card{position:relative;margin-top:12px}.crossing-button{margin-top:16px}.other-date{display:block;text-align:center;padding-top:12px}.crossing-stamp{position:absolute;right:16px;top:-12px;pointer-events:none}
.approval :deep(.flip-controls){display:none}.flip-switch{margin-top:12px}
.card-actions{display:flex;gap:8px;margin-top:12px}.card-actions .btn-sm{flex:1}
.card-editor{margin-top:16px;padding:0 12px 12px;border-radius:var(--r-card);background:var(--paper)}
.editor-actions{display:flex;gap:8px;margin-top:16px}.editor-actions .btn-sm{flex:1}
.date-edit{display:flex;align-items:center;gap:8px}.date-spacer{visibility:hidden}
.fill-link{display:block;margin-top:8px}
.field-status{margin-left:8px;color:var(--due);font-size:var(--fs-cap);font-weight:700}.field-status.failed{color:var(--overdue)}
.plate-pair{display:flex;gap:12px}.plate-item{flex:1;min-width:0}
.plate-label{display:block;font-size:var(--fs-cap);color:var(--ink-3);margin-bottom:8px}
.plate-missing{display:flex;align-items:center;justify-content:center;aspect-ratio:440/140;background:var(--paper);border:1px dashed var(--rule);color:var(--ink-3);border-radius:4px;font-size:var(--fs-cap)}
.physical-plate.macau{display:flex;align-items:center;justify-content:center;aspect-ratio:460/100;background:#050505;color:#fff;border-radius:2px;font-family:Arial,'Helvetica Neue',sans-serif;font-size:var(--fs-title);font-weight:800;white-space:nowrap}
.facts{margin-top:16px}
.edit-file{padding-top:4px}.picker{display:flex;align-items:center;justify-content:space-between}.notes{height:96px}.save-file{margin-top:16px}
.edit-file>.line-sub{margin-top:12px}
.fee-row{display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:var(--fs-body);color:var(--ink-2)}
.guidance{margin-top:16px;padding:12px;border-radius:var(--r-card);background:var(--paper)}
.guidance-title{margin:0 0 4px;color:var(--ink-3);font-size:var(--fs-meta)}
.guidance-line{display:flex;align-items:flex-start;gap:12px;padding:4px 0;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.go-create{margin-top:16px}
</style>
