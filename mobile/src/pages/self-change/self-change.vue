<template>
  <view class="page self-page">
    <!-- 客戶自行辦理後更新資料（docs/tasks/self-handled-changes-design.md）：資料立即生效，顧問整件核對 -->
    <text class="intro">{{ intro }}</text>
    <view v-if="loaded && pendingHere" class="list-card warn-card"><text class="list-title">已提交「{{ kindName }}」，顧問核對中</text><text class="list-sub">核對完成前不能再提交同一類更新；如需修改請聯絡你的顧問。</text></view>
    <view v-else-if="loaded && form.stoppedOn && kind!=='stop_renewal'" class="list-card warn-card"><text class="list-title">這個牌照已標記為不再續期</text><text class="list-sub">如要恢復，{{ forMode('請聯絡你的顧問','請在「我的 › 聯絡我們」發訊息給我們') }}。</text></view>
    <template v-else-if="loaded">
      <!-- 新批文卡：換車、續期、換司機都會換一張新卡 -->
      <view v-if="kind!=='stop_renewal'&&!marking" class="card">
        <text class="step-title">新批文卡</text>
        <text class="subtle">{{ cardHint }}</text>
        <view class="upload-actions"><button class="btn-sm" :disabled="busy" @click="uploadCard('front')">{{ uploaded.front?'✓ 已拍正面':'拍正面' }}</button><button class="btn-sm" :disabled="busy" @click="uploadCard('back')">{{ uploaded.back?'✓ 已拍背面':'拍背面' }}</button></view>
        <text v-if="busy" class="subtle upload-note">正在上傳辨識，請稍候…</text>
      </view>

      <!-- 換車 -->
      <template v-if="kind==='vehicle_change'">
        <view class="card">
          <text class="step-title">新車資料</text>
          <text v-if="form.vehicle" class="subtle">現在的車：{{ [form.vehicle.plate, form.vehicle.brand, form.vehicle.model].filter(Boolean).join(' · ') }}。提交後舊車資料保留作記錄，不再提醒。</text>
          <text class="field-label">新車{{ localName }}車牌（必填）</text><input class="field num" v-model="vehicle.plate" placeholder="按新車行車證填寫"/>
          <text class="field-label">品牌</text><input class="field" v-model="vehicle.brand" placeholder="例如 Toyota"/>
          <text class="field-label">型號</text><input class="field" v-model="vehicle.model" placeholder="例如 Alphard"/>
          <text class="field-label">首次登記日期</text>
          <picker mode="date" :value="vehicle.firstRegisteredOn" :end="today" @change="vehicle.firstRegisteredOn=$event.detail.value"><view class="field picker" :class="{placeholder:!vehicle.firstRegisteredOn}"><text>{{ vehicle.firstRegisteredOn || '選擇日期' }}</text><text class="chev">›</text></view></picker>
          <text class="subtle field-hint">用來推算內地驗車年份。</text>
          <text class="field-label">車架號碼</text><input class="field num" v-model="vehicle.vin" placeholder="按行車證填寫"/>
        </view>
        <view class="card">
          <text class="step-title">新車證件到期日</text><text class="subtle">{{ forMode('未有可先留空，你的顧問會跟進。','未有可先留空，之後在牌照頁補上。') }}</text>
          <view v-for="d in form.vehicleDates" :key="d.code" class="date-row">
            <text class="field-label">{{ d.name }}</text>
            <view class="row"><picker class="grow" mode="date" :value="dates[d.code]||''" @change="dates[d.code]=$event.detail.value"><view class="field picker" :class="{placeholder:!dates[d.code]}"><text>{{ dates[d.code] || '選擇到期日' }}</text><text class="chev">›</text></view></picker><text v-if="dates[d.code]" class="link" @click="dates[d.code]=''">清除</text></view>
          </view>
        </view>
      </template>

      <!-- 續期：逐份文件已辦好／未辦 -->
      <view v-if="kind==='renewal'" class="card">
        <text class="step-title">哪些已續期？</text><text class="subtle">只辦好一部分也可以先更新，未辦的會照舊提醒。</text>
        <view v-for="doc in form.renewalDocuments" :key="doc.code" class="doc">
          <text class="field-label">{{ doc.name }}</text>
          <text class="subtle">現在到期日：<text class="num">{{ doc.expiresOn || '未有記錄' }}</text></text>
          <view class="segmented doc-switch"><text class="seg" :class="{on:renewal[doc.code]?.done}" @click="setDone(doc,true)">已辦好</text><text class="seg" :class="{on:!renewal[doc.code]?.done}" @click="setDone(doc,false)">未辦</text></view>
          <picker v-if="renewal[doc.code]?.done" mode="date" :value="renewal[doc.code].expiresOn" :start="today" @change="renewal[doc.code].expiresOn=$event.detail.value"><view class="field picker new-date" :class="{placeholder:!renewal[doc.code].expiresOn}"><text>{{ renewal[doc.code].expiresOn ? '新到期日 '+renewal[doc.code].expiresOn : '選擇新到期日' }}</text><text class="chev">›</text></view></picker>
        </view>
        <view v-if="renewal.approval?.done" class="doc">
          <text class="field-label">新批文的海關及邊檢備案</text><text class="subtle">新批文生效後須在 183 天內備案。</text>
          <view class="segmented doc-switch"><text class="seg" :class="{on:filingDone}" @click="filingDone=true">已辦好</text><text class="seg" :class="{on:!filingDone}" @click="filingDone=false">未辦</text></view>
        </view>
      </view>

      <!-- 換司機 -->
      <view v-if="kind==='driver_change'" class="card">
        <text class="step-title">換司機後的司機名單</text><text class="subtle">按新批文卡上的駕駛人填寫，最多 3 位；不在名單的司機不再提醒證件到期。</text>
        <view v-for="(d,index) in drivers" :key="index" class="driver">
          <view class="row"><text class="line-title">司機 {{ index+1 }}</text><text v-if="drivers.length>1" class="link" @click="drivers.splice(index,1)">移除</text></view>
          <text class="field-label">姓名</text><input class="field" v-model="d.name" placeholder="按批文卡填寫"/>
          <view class="segmented doc-switch"><text class="seg" :class="{on:d.role==='主'}" @click="setMain(index)">主司機</text><text class="seg" :class="{on:d.role==='副'}" @click="d.role='副'">副司機</text></view>
          <text class="field-label">電話（可不填）</text><input class="field num" v-model="d.phone" placeholder="例如 +852 9123 4567"/>
          <view v-for="doc in form.driverDates" :key="doc.code">
            <text class="field-label">{{ doc.name }}到期日（可不填）</text>
            <view class="row"><picker class="grow" mode="date" :value="d.dates[doc.code]||''" @change="d.dates[doc.code]=$event.detail.value"><view class="field picker" :class="{placeholder:!d.dates[doc.code]}"><text>{{ d.dates[doc.code] || '選擇到期日' }}</text><text class="chev">›</text></view></picker><text v-if="d.dates[doc.code]" class="link" @click="d.dates[doc.code]=''">清除</text></view>
          </view>
        </view>
        <button v-if="drivers.length<3" class="btn-line add-driver" @click="addDriver">＋ 加一位司機</button>
      </view>

      <!-- 口岸變更（粵港）：新通行口岸、新 CRP 到期日 -->
      <view v-if="kind==='crossing_change'" class="card">
        <text class="step-title">新的通行口岸</text><text class="subtle">原來：{{ before.crossing || '未有記錄' }}</text>
        <text class="field-label">新批文卡上的通行口岸（必填）</text><input class="field" v-model="cardText.crossing" placeholder="例如 港珠澳大橋"/>
        <text class="field-label">新香港 CRP 到期日（可不填）</text>
        <view class="row"><picker class="grow" mode="date" :value="cardText.crpExpiresOn" @change="cardText.crpExpiresOn=$event.detail.value"><view class="field picker" :class="{placeholder:!cardText.crpExpiresOn}"><text>{{ cardText.crpExpiresOn || '選擇到期日' }}</text><text class="chev">›</text></view></picker><text v-if="cardText.crpExpiresOn" class="link" @click="cardText.crpExpiresOn=''">清除</text></view>
        <text class="subtle mark-hint">{{ forMode('口岸改變後，海關及邊檢備案可能要重辦，你的顧問會跟進。','口岸改變後，海關及邊檢備案可能要重辦，請留意；需要幫忙可交給我們辦。') }}</text>
      </view>
      <!-- 商號／內承單位變更 -->
      <view v-if="kind==='company_change'" class="card">
        <text class="step-title">新批文卡上的名稱</text><text class="subtle">{{ forMode('按新卡填寫；公司的登記資料請到「我的公司」更新，牌照所屬公司由顧問核對後調整。','按新卡填寫；公司的登記資料和牌照所屬公司，請到「我的公司」核對。') }}</text>
        <text class="field-label">商號</text><input class="field" v-model="cardText.company" :placeholder="before.company || '按批文卡填寫'"/>
        <text class="field-label">內承單位</text><input class="field" v-model="cardText.contractor" :placeholder="before.contractor || '按批文卡填寫'"/>
      </view>
      <!-- 補領：新卡流水號（編號如有改變） -->
      <view v-if="kind==='replacement'" class="card">
        <text class="step-title">補領的新卡</text><text class="subtle">補領的批文卡有效期不變，只有流水號（有時連編號）不同。</text>
        <text class="field-label">卡面流水號（必填）</text><input class="field num" v-model="cardText.serial" :placeholder="before.serial ? '原來 '+before.serial : '按新卡填寫'"/>
        <text class="field-label">批文卡編號</text><input class="field num" v-model="cardText.cardNumber" placeholder="按新卡填寫"/>
      </view>

      <!-- 驗車、新批文備案：標記這一期已辦好 -->
      <view v-if="marking" class="card">
        <text class="step-title">{{ mark.name }}</text>
        <view class="kv mark-facts"><template v-if="mark.label"><text class="k">項目</text><text class="v">{{ mark.label }}</text></template><text class="k">到期日</text><text class="v num">{{ mark.dueOn || '—' }}</text></view>
        <text class="subtle mark-hint">標記後這一期不再提醒；請附上{{ markProof[kind] }}相片{{ forMode('，顧問會再核對','作記錄') }}。</text>
      </view>

      <!-- 不再續期 -->
      <view v-if="kind==='stop_renewal'" class="card">
        <text class="step-title">為甚麼不再續期？</text>
        <view class="chips"><text v-for="r in form.stopReasons" :key="r" class="chip" :class="{active:stop.reason===r}" @click="stop.reason=r">{{ r }}</text></view>
        <text class="field-label">補充說明（可不填）</text><textarea class="field note" v-model="stop.note" placeholder="例如車已於 10 月賣出"/>
        <text class="subtle">{{ forMode('提交後這個牌照不再提醒到期；你的顧問會聯絡你確認。','提交後這個牌照不再提醒到期。') }}</text>
      </view>

      <!-- 共用：辦好日期、相片 -->
      <view class="card">
        <text class="field-label first">{{ kind==='stop_renewal' ? '決定日期' : '辦好日期' }}</text>
        <picker mode="date" :value="handledOn" :end="today" @change="handledOn=$event.detail.value"><view class="field picker"><text class="num">{{ handledOn }}</text><text class="chev">›</text></view></picker>
        <template v-if="kind!=='stop_renewal'">
          <text class="field-label">{{ photoLabel }}（{{ marking ? '必須' : '可選' }}，最多 6 張）</text>
          <view class="photos"><image v-for="(p,index) in photos" :key="index" class="thumb" :src="p.path" mode="aspectFill" @click="viewPhoto(index)"/><view v-if="photos.length<6" class="thumb add" @click="addPhoto"><text>＋</text></view></view>
          <text v-if="photos.length" class="subtle">點相片可放大或移除。</text>
        </template>
      </view>
      <button class="primary submit" :disabled="submitting||busy" @click="submit">{{ submitting ? '正在提交…' : submitText }}</button>
    </template>
    <wd-action-sheet custom-class="choice-sheet" v-model="sheet.show" :title="sheet.title" :actions="sheet.actions" cancel-text="取消" @select="onSelect" @close="onClose" />
    <wd-message-box />
    <CardCapture ref="capture"/>
  </view>
</template>
<script setup>
import { useChoice,useConfirm } from '../../lib/choice'
const { sheet,choose,onSelect,onClose }=useChoice(),confirmBox=useConfirm()
import { ref,computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { api,cardPhoto,forgetCardOriginal,forMode } from '../../lib/api'
import CardCapture from '../../components/CardCapture.vue'
const names={vehicle_change:'自行換車',renewal:'自行續期',driver_change:'自行換司機',stop_renewal:'不再續期',inspection_done:'自行驗車',filing_done:'自行備案',tax_paid:'自行繳交行車稅',crossing_change:'自行口岸變更',company_change:'自行商號變更',replacement:'自行補領'}
// 驗車、新批文備案只是標記一期辦好，不用拍新批文卡
const cardText=ref({crossing:'',crpExpiresOn:'',company:'',contractor:'',serial:'',cardNumber:''}),before=ref({})
const markProof={inspection_done:'檢驗標誌或檢驗結果',filing_done:'備案回執',tax_paid:'行車稅繳費收據'},markDoing={inspection_done:'驗車',filing_done:'新批文備案',tax_paid:'繳交澳門行車稅'}
const marking=computed(()=>!!markProof[kind.value]),mark=ref({period:'',name:'',label:'',dueOn:''})
const capture=ref(null),plateId=ref(''),kind=ref('vehicle_change'),form=ref({}),loaded=ref(false),busy=ref(false),submitting=ref(false),uploaded=ref({})
const todayIso=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
const today=todayIso(),handledOn=ref(today)
const vehicle=ref({plate:'',brand:'',model:'',firstRegisteredOn:'',vin:''}),dates=ref({}),renewal=ref({}),filingDone=ref(false),drivers=ref([]),stop=ref({reason:'',note:''}),photos=ref([])
let wantedPlate=''
const kindName=computed(()=>names[kind.value])
const pendingHere=computed(()=>(form.value.pending||[]).includes(kind.value))
const localName=computed(()=>form.value.route==='粵澳'?'澳門':'香港')
const doing={vehicle_change:'換車',renewal:'續期',driver_change:'換司機',crossing_change:'口岸變更',company_change:'商號變更',replacement:'補領'}
const intro=computed(()=>marking.value?`你自己辦好了${markDoing[kind.value]}？在這裏標記，資料立即生效${forMode('，你的顧問會再核對','')}。`:kind.value==='stop_renewal'?'決定不再續期這個兩地牌（例如已賣車、放棄指標）？告訴我們，停止到期提醒。':`你自己辦好了${doing[kind.value]}？在這裏一次更新，資料立即生效${forMode('，你的顧問會再核對','')}。自行辦理的變更，請在辦好後 7 天內更新。`)
const cardHint=computed(()=>({crossing_change:'拍下新卡正面，系統會讀出新的通行口岸。',company_change:'拍下新卡正面，系統會讀出新的商號和內承單位。',replacement:forMode('拍下補領的新卡，顧問會對照核對。','拍下補領的新卡。'),vehicle_change:forMode('換車後批文卡上的港澳車牌會改變，請拍下新卡正反面，顧問會對照核對。','換車後批文卡上的港澳車牌會改變，請拍下新卡正反面。'),renewal:'拍下新卡，系統會讀出新的有效期，填在下面。',driver_change:forMode('新卡背面列出駕駛人，請拍下正反面，顧問會對照核對。','新卡背面列出駕駛人，請拍下正反面。')}[kind.value]))
const photoLabel=computed(()=>({crossing_change:'新香港 CRP 相片',company_change:'公司變更證明相片',replacement:'補領證明相片',vehicle_change:'新車行車證、保險單相片',renewal:'新證件相片（例如香港許可證）',driver_change:'新司機證件相片',inspection_done:'檢驗標誌或檢驗結果相片',filing_done:'備案回執相片',tax_paid:'行車稅繳費收據相片'}[kind.value]))
const submitText=computed(()=>kind.value==='stop_renewal'?'確認不再續期':marking.value?'標記已辦好':'提交更新')
function fillDefaults(){
  const f=form.value
  // cardBefore：顧問核對前的原來卡面；新卡（剛改或剛上傳）讀出不同的值才預先填入
  before.value=f.cardBefore||{}
  const changed=key=>f.card?.[key]&&f.card[key]!==before.value[key]?f.card[key]:''
  if(kind.value==='crossing_change')cardText.value.crossing=cardText.value.crossing||changed('crossing')
  if(kind.value==='company_change'){cardText.value.company=cardText.value.company||f.card?.company||'';cardText.value.contractor=cardText.value.contractor||f.card?.contractor||''}
  if(kind.value==='replacement'){cardText.value.serial=cardText.value.serial||changed('serial');cardText.value.cardNumber=cardText.value.cardNumber||f.card?.cardNumber||''}
  if(kind.value==='vehicle_change'){const fromCard=f.card?.localPlate&&f.card.localPlate!==f.vehicle?.plate?f.card.localPlate:'';vehicle.value.plate=vehicle.value.plate||wantedPlate||fromCard;dates.value=Object.fromEntries((f.vehicleDates||[]).map(d=>[d.code,dates.value[d.code]||'']))}
  if(kind.value==='renewal'){const next={};for(const doc of f.renewalDocuments||[]){const old=renewal.value[doc.code];next[doc.code]=old||{done:false,expiresOn:''}}
    // 新卡讀出的有效期比原來晚時，預先填在批文那一行（不可把舊日期當成新日期）
    const read=f.card?.validTo||'',original=f.cardBefore?.validTo||'';if(next.approval&&!next.approval.expiresOn&&read&&original&&read>original&&read>today)next.approval={done:true,expiresOn:read};renewal.value=next}
  if(kind.value==='driver_change'&&!drivers.value.length){const current=(f.drivers||[]).map(d=>d.name),card=f.card?.drivers||[];const list=card.length&&card.join()!==current.join()?card.map((name,i)=>({name,role:i===0?'主':'副'})):(f.drivers||[]).map(d=>({name:d.name,role:d.role}));drivers.value=(list.length?list:[{name:'',role:'主'}]).map(d=>({...d,phone:'',dates:{}}))}
}
async function load(){try{form.value=await api('/my/plates/'+encodeURIComponent(plateId.value)+'/self-handled/form');fillDefaults()}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
function setDone(doc,done){renewal.value={...renewal.value,[doc.code]:{done,expiresOn:done?(renewal.value[doc.code]?.expiresOn||''):''}}}
function setMain(index){drivers.value=drivers.value.map((d,i)=>({...d,role:i===index?'主':'副'}))}
function addDriver(){drivers.value.push({name:'',role:drivers.value.some(d=>d.role==='主')?'副':'主',phone:'',dates:{}})}
async function uploadCard(side){const photo=await capture.value.open({side});if(!photo)return;busy.value=true;try{const image=photo.data;await api('/plate-assets/'+plateId.value+'/card/'+side,'POST',{image});forgetCardOriginal(plateId.value);uploaded.value={...uploaded.value,[side]:true};form.value=await api('/my/plates/'+encodeURIComponent(plateId.value)+'/self-handled/form');fillDefaults();uni.showToast({title:'已上傳，請核對下面的資料',icon:'none'})}catch(e){uni.showToast({title:e.message||'上傳失敗',icon:'none'})}finally{busy.value=false}}
function addPhoto(){uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{busy.value=true;try{photos.value.push(await cardPhoto(result))}catch(e){uni.showToast({title:e.message||'相片讀取失敗',icon:'none'})}finally{busy.value=false}}})}
async function viewPhoto(index){const i=await choose('這張相片',['放大查看','移除這張']);if(i===0)uni.previewImage({urls:photos.value.map(p=>p.path),current:photos.value[index].path});else if(i===1)photos.value.splice(index,1)}
function body(){
  const base={kind:kind.value,handledOn:handledOn.value}
  if(kind.value==='stop_renewal')return{...base,reason:stop.value.reason,note:stop.value.note}
  const shared={...base,photos:photos.value.map(p=>p.data)}
  if(kind.value==='vehicle_change')return{...shared,vehicle:vehicle.value,dates:Object.fromEntries(Object.entries(dates.value).filter(([,v])=>v))}
  if(marking.value)return{...shared,period:mark.value.period}
  if(kind.value==='crossing_change')return{...shared,crossing:cardText.value.crossing,...(cardText.value.crpExpiresOn?{crpExpiresOn:cardText.value.crpExpiresOn}:{})}
  // 只送出有填的一項；原本卡上沒有的那項可以留空
  if(kind.value==='company_change')return{...shared,...(cardText.value.company.trim()?{company:cardText.value.company}:{}),...(cardText.value.contractor.trim()?{contractor:cardText.value.contractor}:{})}
  if(kind.value==='replacement')return{...shared,serial:cardText.value.serial,...(cardText.value.cardNumber?{cardNumber:cardText.value.cardNumber}:{})}
  if(kind.value==='renewal')return{...shared,documents:Object.fromEntries(Object.entries(renewal.value).map(([code,v])=>[code,v.done?{done:true,expiresOn:v.expiresOn}:{done:false}])),...(renewal.value.approval?.done?{newCardFiling:filingDone.value}:{})}
  return{...shared,drivers:drivers.value.map(d=>({name:d.name,role:d.role,phone:d.phone,dates:Object.fromEntries(Object.entries(d.dates).filter(([,v])=>v))}))}
}
// 先在手機上擋下明顯漏填，伺服器仍會再檢查
function problem(){
  if(kind.value==='vehicle_change'&&!vehicle.value.plate.trim())return'請填寫新車車牌'
  if(kind.value==='renewal'){const done=Object.entries(renewal.value).filter(([,v])=>v.done);if(!done.length)return'請選出已續期的文件';if(done.some(([,v])=>!v.expiresOn))return'請填寫已續期文件的新到期日'}
  if(kind.value==='driver_change'&&drivers.value.some(d=>!d.name.trim()))return'請填寫司機姓名'
  if(kind.value==='stop_renewal'&&!stop.value.reason)return'請選擇不再續期的原因'
  if(kind.value==='crossing_change'&&!cardText.value.crossing.trim())return'請填寫新的通行口岸'
  if(kind.value==='company_change'&&!cardText.value.company.trim()&&!cardText.value.contractor.trim())return'請填寫新的商號或內承單位'
  if(kind.value==='replacement'&&!cardText.value.serial.trim())return'請填寫新卡的卡面流水號'
  if(marking.value&&!photos.value.length)return '請附上'+markProof[kind.value]+'相片'
  return''
}
async function submit(){
  const message=problem();if(message)return uni.showToast({title:message,icon:'none'})
  if(kind.value==='stop_renewal'){const ok=await confirmBox.ask({title:'確認不再續期？',msg:forMode('這個牌照會停止到期提醒，你的顧問會聯絡你確認。','這個牌照會停止到期提醒。'),ok:'確認',cancel:'返回'});if(ok!=='confirm')return}
  submitting.value=true
  try{await api('/my/plates/'+encodeURIComponent(plateId.value)+'/self-handled','POST',body());uni.showToast({title:kind.value==='stop_renewal'?forMode('已記錄，顧問會聯絡你','已記錄'):marking.value?forMode('已標記辦好，顧問會再核對','已標記辦好'):forMode('已更新，顧問會再核對','已更新'),icon:'none'});setTimeout(()=>uni.navigateBack({fail:()=>uni.redirectTo({url:'/pages/plate-detail/plate-detail?id='+encodeURIComponent(plateId.value)})}),700)}
  catch(e){uni.showToast({title:e.message,icon:'none'})}finally{submitting.value=false}
}
onLoad(options=>{plateId.value=decodeURIComponent(options.plate||'');kind.value=names[options.kind]?options.kind:'vehicle_change';wantedPlate=decodeURIComponent(options.newPlate||'');mark.value={period:decodeURIComponent(options.period||''),name:decodeURIComponent(options.name||''),label:decodeURIComponent(options.label||''),dueOn:decodeURIComponent(options.dueOn||'')};uni.setNavigationBarTitle({title:names[kind.value]});load()})
</script>
<style scoped>
.step-title{display:block;margin-bottom:4px;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.upload-actions{display:flex;gap:8px;margin-top:12px}.upload-actions .btn-sm{flex:1}
.upload-note{margin-top:8px}
.picker{display:flex;align-items:center;justify-content:space-between}.picker.placeholder{color:var(--ink-3)}
.field-hint{margin-top:4px}
.field-label.first{margin-top:0}
.date-row .row{gap:12px}
.doc{padding-bottom:4px}.doc+.doc{margin-top:8px;padding-top:4px;border-top:1px solid var(--rule)}
.doc-switch{margin-top:8px}
.new-date{margin-top:8px}
.driver{padding:12px 0;border-bottom:1px solid var(--rule)}.driver:last-of-type{border-bottom:0}
.line-title{font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.add-driver{width:100%;margin-top:12px}
.note{height:96px;line-height:1.5}
.photos{display:flex;flex-wrap:wrap;gap:8px}
.thumb{width:72px;height:72px;border-radius:var(--r-control);border:1px solid var(--rule);background:var(--paper)}
.thumb.add{display:flex;align-items:center;justify-content:center;color:var(--jade);font-size:var(--fs-title);font-weight:700}
.photos+.subtle{margin-top:8px}
.submit{margin-top:4px}
.mark-facts{margin-top:8px}.mark-hint{margin-top:12px}
</style>
