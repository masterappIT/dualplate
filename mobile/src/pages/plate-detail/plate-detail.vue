<template>
  <view class="page plate-page">
    <view v-if="creating" class="card"><text class="list-title">登記現有批文卡</text><text class="list-sub">尚未取得批文卡，請使用申請辦理。</text><button class="primary go-create" @click="uni.redirectTo({url:'/pages/plate-create/plate-create'})">前往批文卡建檔</button></view>
    <view v-if="!creating && loaded && !plates.length" class="card empty">找不到這個兩地牌檔案。</view>
    <view v-for="p in plates" :key="p.id">
      <!-- 頁首：車牌＋整體狀態；批文卡平時收起，點「批文卡」才打開 -->
      <view class="head">
        <view class="head-plates"><PlateChip :plate="p.mainland_plate || summary.mainlandPlate" region="內地" size="lg" /><PlateChip v-if="p.local_plate" :plate="p.local_plate" :region="p.route==='粵澳'?'澳門':'香港'" size="lg" /><text v-if="clientTodoCount" class="pill amber">{{ clientTodoCount }} 項待辦</text><text v-else-if="summary.health" class="pill" :class="healthTone[summary.health]">{{ healthLabel[summary.health] }}</text></view>
        <text class="subtle head-sub">{{ [p.route+'兩地牌', summary.holder].filter(Boolean).join(' · ') }}</text>
      </view>
      <text v-if="summary.id" class="link head-card" @click="openFold('card')">{{ p.card_expires_on ? '批文有效期至 '+p.card_expires_on+' · ' : '' }}批文卡 ›</text>
      <view v-if="summary.warnings?.length" class="list-card warn-card"><text class="list-title">{{ summary.warnings.join('、') }}</text><text class="list-sub">牌照仍照常管理，如需處理我們會聯絡你。</text></view>
      <!-- 建檔時按批文卡名稱建立的公司，資料要客戶補上 -->
      <view v-if="summary.companyGaps?.length" class="list-card warn-card" @click="fillCompany(summary.companyGaps[0].id)"><text class="list-title">請補上公司資料</text><text v-for="c in summary.companyGaps" :key="c.id" class="list-sub">{{ c.name }}：缺{{ c.missing.join('、') }}</text><text class="link fill-link">前往補充 ›</text></view>

      <!-- 客戶自行辦理：不再續期、已提交待核對、被顧問退回 -->
      <view v-if="p.stopped_on" class="list-card warn-card"><text class="list-title">已標記不再續期</text><text class="list-sub">{{ p.stopped_on }} · {{ p.stop_reason }}。這個牌照不再提醒到期；如要恢復，請聯絡你的顧問。</text></view>
      <view v-for="r in selfNotes" :key="r.id" class="list-card" :class="r.status==='已退回'?'warn-card':''"><text class="list-title">{{ r.status==='已退回' ? '顧問未能確認你的「'+r.kindName+'」更新' : '你提交的「'+r.kindName+'」顧問核對中' }}</text><text class="list-sub">{{ r.status==='已退回' ? r.reviewNote : '資料已更新；顧問核對後如有問題會聯絡你。' }}</text></view>

      <!-- 下一件要做的事：只放一件最急、要客戶動手的事 -->
      <view v-if="summary.id" class="card next-card" :class="{ 'warn-card': nextStep?.level==='overdue' }">
        <text class="next-kicker">下一件要做的事</text>
        <template v-if="nextStep"><text class="line-title">{{ nextStep.title }}</text><text class="line-sub">{{ nextStep.sub }}</text><button class="primary next-button" :disabled="nextBusy" @click="runNext">{{ nextStep.label }}</button></template>
        <template v-else><text class="line-title">目前不用你做甚麼</text><text class="line-sub">我們負責的事項會按時跟進；有需要時會出現在這裏。</text></template>
      </view>
      <button v-if="summary.id" class="btn-line change-button" @click="askChanges">有變動？</button>

      <!-- 其他資料：平時收起，標題列顯示摘要 -->
      <text v-if="summary.id" class="section-title other-title">其他資料</text>
      <view v-if="summary.id">
      <view :id="'fold-deadlines'" class="list-card row fold-head" @click="toggle('deadlines')"><text class="fold-title">到期項目</text><text class="fold-sum grow">{{ deadlineSummary }}</text><text class="chev">{{ open.deadlines ? '⌃' : '›' }}</text></view>
      <view v-if="open.deadlines" class="fold-body">
        <view class="card list">
          <view v-for="(item,index) in shownDeadlines" :key="index" class="line">
            <view class="grow"><text class="line-title">{{ item.name }}</text><text v-if="item.handledBy==='you'" class="who">{{ selfHandled }}</text><text v-if="isPending(item.ownerType,item.ownerId,'date:'+item.code)" class="pill amber pending-tag">已修改，待核對</text><text v-if="deadlineSub(item)" class="line-sub">{{ deadlineSub(item) }}</text><text v-if="canEntrust(item)" class="link entrust" @click.stop="startEntrust(item)">委託我們辦 ›</text></view>
            <picker v-if="item.editable" mode="date" :value="item.dueOn" @change="saveDate(item,$event.detail.value)"><view class="date-edit"><DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" /><text class="link">修改</text></view></picker>
            <view v-else-if="item.markable" class="date-edit" @click="markDone(item)"><DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" /><text class="link">已辦好</text></view>
            <view v-else class="date-edit"><DueDate :date="item.dueOn" :days="item.daysLeft" :level="item.level" /><text class="link date-spacer" aria-hidden="true">已辦好</text></view>
          </view>
          <text v-if="!deadlineList.length" class="line-sub">{{ summary.health==='pending' ? '你的顧問正在整理這個牌照的到期資料。' : '半年內沒有到期項目。' }}</text>
          <view v-if="deadlineList.length > 5" class="more" @click="allDeadlines=!allDeadlines">{{ allDeadlines ? '收起' : '顯示全部 '+deadlineList.length+' 項' }}</view>
        </view>
      </view>
      <view :id="'fold-crossing'" class="list-card row fold-head" @click="toggle('crossing')"><text class="fold-title">90 天過關</text><text class="fold-sum grow">{{ crossingSummary }}</text><text class="chev">{{ open.crossing ? '⌃' : '›' }}</text></view>
      <view v-if="open.crossing" class="fold-body">
        <view class="card crossing-card">
          <view class="row"><view class="grow"><text class="line-title">90 天過關提醒</text><text class="line-sub">{{ summary.crossing?.enabled ? '每 '+(summary.crossing?.days||90)+' 天須過關一次，期限前提醒你' : '車輛不常過關時可開啟，我們會在期限前提醒你' }}</text></view><switch :checked="!!summary.crossing?.enabled" color="#0F5C4A" :disabled="crossingBusy" @change="toggleReminder($event.detail.value)" /></view>
          <view v-if="summary.crossing?.enabled"><view class="ticket-rule" /><view class="row"><text class="line-sub">{{ summary.crossing?.lastCrossedOn ? '上次過關 '+summary.crossing.lastCrossedOn : '請記錄最近一次過關日期' }}</text><DueDate v-if="summary.crossing?.nextDueOn" :date="summary.crossing.nextDueOn" /><StampMark v-if="justCrossed" text="已過關" tone="jade" play class="crossing-stamp" /></view><button class="primary crossing-button" :disabled="crossingBusy" @click="markCrossed(todayIso())">{{ crossingBusy ? '記錄中' : '今天已過關' }}</button><picker mode="date" :end="todayIso()" @change="markCrossed($event.detail.value)"><text class="link other-date">其他日期過關 ›</text></picker></view>
        </view>
      </view>
      <view :id="'fold-card'" class="list-card row fold-head" @click="toggle('card')"><text class="fold-title">批文卡</text><text class="fold-sum grow">{{ cardSummary(p) }}</text><text class="chev">{{ open.card ? '⌃' : '›' }}</text></view>
      <view v-if="open.card" class="fold-body">
            <view class="card approval">
        <ApprovalCard :key="p.id" :data="displayCardData(p)" :back="cardBack" :flip-on-tap="false" :tap-label="cardBack ? '翻到批文卡正面' : '翻到批文卡背面'" @card-tap="cardBack=!cardBack"/>
        <view class="segmented flip-switch"><text class="seg" :class="{on:!cardBack}" @click="cardBack=false">正面</text><text class="seg" :class="{on:cardBack}" @click="cardBack=true">背面</text></view>
        <view class="card-actions"><button v-if="originalSides(p).length" class="btn-sm" @click="viewOriginal(p)">查看正本</button><button class="btn-sm" @click="editCard(p)">修改內容</button><button class="btn-sm" @click="uploadCard(p)">上傳新批文卡</button></view>
        <view v-if="editingCardId===p.id" class="card-editor">
          <view v-for="field in cardFields" :key="field.key"><text class="field-label">{{ field.label }}<text v-if="fieldStatusText(fieldStatus[field.key])" class="field-status" :class="fieldStatusClass(fieldStatus[field.key])">{{ fieldStatusText(fieldStatus[field.key]) }}</text></text><input class="field" v-model="cardDraft[field.key]" :placeholder="field.label"/></view>
          <view class="editor-actions"><button class="btn-sm" @click="editingCardId=''">取消</button><button class="btn-sm solid" @click="saveCard(p)">儲存批文卡內容</button></view>
        </view>
      </view>
      </view>
      <view :id="'fold-vehicle'" class="list-card row fold-head" @click="toggle('vehicle')"><text class="fold-title">車輛與證件</text><text class="fold-sum grow">{{ vehicleSummary }}</text><text class="chev">{{ open.vehicle ? '⌃' : '›' }}</text></view>
      <view v-if="open.vehicle" class="fold-body">
    <view v-if="!creating && loaded && plates[0] && !boundVehicles.length && plates[0].installation_status !== '未上牌'">
      <view class="card">
        <text class="line-title">尚未登記車輛</text>
        <text class="line-sub">{{ plates[0].local_plate ? '按港澳車牌 ' + plates[0].local_plate + ' 登記這部車，之後可拍下行駛證、' + (plates[0].route === '粵澳' ? '澳門車輛登記文件' : '香港車輛牌照') + '和保險單，系統會讀出車架號碼和日期。' : '請先在上方填寫港澳車牌，再登記車輛。' }}</text>
        <button v-if="plates[0].local_plate" class="btn-sm solid register-vehicle" :disabled="registeringVehicle" @click="registerVehicle">{{ registeringVehicle ? '正在登記…' : '登記這部車' }}</button>
      </view>
    </view>
    <view v-if="!creating && boundVehicles.length">
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
        <text class="line-title">車輛證件</text>
        <text class="line-sub doc-intro">拍下證件，系統會讀出車架號碼、日期等，只填入空白的資料，不會改動你已填的；顧問會再核對。</text>
        <view v-for="c in docs[v.id]?.checks || []" :key="c.code" class="doc-check"><text class="pill amber">請核對</text><text class="line-sub">{{ c.text }}</text></view>
        <view v-for="d in docs[v.id]?.documents || []" :key="d.kind" class="line doc-line">
          <view class="grow"><text class="line-title">{{ d.label }}</text>
            <text class="line-sub">{{ d.uploaded ? '已上傳 · ' + (d.uploadedAt || '').slice(0, 10) : d.hint }}</text>
            <text v-for="f in d.fields.filter(item => item.value)" :key="f.key" class="line-sub num">{{ f.label }}：{{ f.value }}{{ f.status === 'ok' ? '' : '（請核對）' }}</text>
          </view>
          <view class="doc-actions"><text v-if="d.uploaded" class="link" @click="viewVehicleDocument(v.id, d.kind)">看原件</text><text v-if="!docs[v.id].retired" class="link" @click="uploadDoc(v, d)">{{ uploadingDoc === v.id + ':' + d.kind ? (d.recognizable ? '辨識中…' : '上傳中…') : d.uploaded ? '重新上傳' : '上傳' }}</text></view>
        </view>
        <view class="ticket-rule" />
        <text class="line-title">驗車安排</text>
        <view v-for="i in detail[v.id]?.inspections || []" :key="i.id" class="line"><view class="grow"><text class="line-title">{{ i.title }}</text><text class="line-sub num">{{ i.appointment_on || '日期待安排' }}</text></view><text class="pill blue">{{ i.status }}</text></view>
        <text v-if="!detail[v.id]?.inspections?.length" class="line-sub">暫時沒有驗車安排。</text>
        <view v-if="detail[v.id]?.inspectionGuidance?.length" class="guidance"><text class="line-sub guidance-title">相關官方規定</text><view v-for="g in detail[v.id].inspectionGuidance" :key="g.label" class="guidance-line" @click="openSource(g.sourceId)"><text class="grow">{{ g.label }}</text><text v-if="g.sourceId" class="link">來源 ›</text></view></view>
      </view>
    </view>
      </view>
      <view :id="'fold-drivers'" class="list-card row fold-head" @click="toggle('drivers')"><text class="fold-title">司機</text><text class="fold-sum grow">{{ driverSummary }}</text><text class="chev">{{ open.drivers ? '⌃' : '›' }}</text></view>
      <view v-if="open.drivers" class="fold-body">
        <view v-if="!summary.drivers?.length" class="card"><text class="line-sub">這個牌照還沒有登記司機；換司機請按上方「有變動？」。</text></view>
        <view v-if="summary.drivers?.length"><view class="card list"><view v-for="d in summary.drivers" :key="d.id"><view class="line" @click="editDriver(d)"><view class="grow"><text class="line-title">{{ d.name }}</text><text v-if="isPending('driver',d.id)" class="pill amber pending-tag">已修改，待核對</text></view><text class="pill" :class="d.role==='主'?'':'gray'">{{ d.role==='主' ? '主司機' : '副司機' }}</text><text class="link">{{ editingDriverId===d.id ? '收起' : '修改' }}</text></view>
              <view v-if="editingDriverId===d.id" class="inline-editor">
                <text class="field-label">姓名</text><input class="field" v-model="driverForm.name" placeholder="司機姓名"/>
                <text class="field-label">電話</text><input class="field num" v-model="driverForm.phone" placeholder="例如 +852 9123 4567"/>
                <text class="field-label">香港身份證號碼</text><input class="field num" v-model="driverForm.hkIdNo" placeholder="例如 A123456(7)"/><text class="line-sub">只保存最後 4 位</text>
                <text class="field-label">回鄉證號碼</text><input class="field num" v-model="driverForm.homeReturnPermitNo" placeholder="按回鄉證填寫"/>
                <view class="editor-actions"><button class="btn-sm" @click="editingDriverId=''">取消</button><button class="btn-sm solid" :disabled="savingDriver" @click="saveDriver">{{ savingDriver ? '正在儲存…' : '儲存司機資料' }}</button></view>
              </view></view><text class="line-sub driver-note">司機證件到期會列在到期項目。要更換司機，按上方「有變動？」。</text></view></view>
      </view>
      <view :id="'fold-usage'" class="list-card row fold-head" @click="toggle('usage')"><text class="fold-title">使用安排</text><text class="fold-sum grow">{{ usageSummary }}</text><text class="chev">{{ open.usage ? '⌃' : '›' }}</text></view>
      <view v-if="open.usage" class="fold-body">
        <view v-if="!arrangements.length" class="card"><text class="line-sub">{{ usageSummary }}。使用安排由顧問記錄。</text></view>
        <view v-if="arrangements.length"><view v-for="a in arrangements" :key="a.id" class="card"><view class="row"><view class="grow"><text class="line-title">{{ a.user.name }}</text><text class="line-sub">{{ a.user.vehiclePlate ? '使用車輛 ' + a.user.vehiclePlate + ' · ' : '' }}{{ a.startsOn }} 起{{ a.endsOn ? ' 至 ' + a.endsOn : '' }}</text></view><text class="pill" :class="a.status==='生效'?'':'gray'">{{ a.status==='生效' ? '使用中' : a.status }}</text></view><text class="line-sub">使用費 {{ money(a.currency, a.amount) }} / {{ cycleLabel[a.cycle] }} · {{ a.collectionMode==='代收' ? '由我們代收' : '直接付給你' }}</text><view class="ticket-rule" /><view v-for="i in a.invoices" :key="i.id" class="fee-row"><text class="num">{{ i.period }}</text><text class="pill" :class="feeTone[i.status]">{{ feeLabel(a, i) }}</text></view><text v-if="!a.invoices.length" class="line-sub">暫時沒有使用費記錄</text></view></view>
      </view>
      <view :id="'fold-holder'" class="list-card row fold-head" @click="toggle('holder')"><text class="fold-title">持牌公司</text><text class="fold-sum grow">{{ summary.holder || '待補充' }}</text><text class="chev">{{ open.holder ? '⌃' : '›' }}</text></view>
      <view v-if="open.holder" class="fold-body">
        <view class="card kv">
          <text class="k">用途</text><text class="v">{{ summary.rental ? '使用安排：'+summary.rental.renter : summary.usageStatus==='自用' ? '自用' : summary.installationStatus==='未上牌' ? '空置（未上牌）' : unsetWord() }}</text>
          <template v-if="summary.rental"><text class="k">使用期</text><text class="v num">{{ (summary.rental.startsOn||'—')+' 至 '+(summary.rental.endsOn||'未定') }}</text></template>
          <text v-if="summary.indicatorCategory" class="k">指標類別</text><text v-if="summary.indicatorCategory" class="v">{{ summary.indicatorCategory }}</text>
          <text v-if="summary.port" class="k">口岸</text><text v-if="summary.port" class="v">{{ summary.port }}</text>
          <text class="k">持牌公司</text><text class="v">{{ summary.holder || '待補充' }}</text>
          <text class="k">內承單位</text><text class="v">{{ summary.contractor || '待補充' }}</text>
        </view>
      </view>
      <view :id="'fold-plate'" class="list-card row fold-head" @click="toggle('plate')"><text class="fold-title">牌照資料</text><text class="fold-sum grow">{{ plateSummary }}</text><text class="chev">{{ open.plate ? '⌃' : '›' }}</text></view>
      <view v-if="open.plate" class="fold-body">
            <view class="card">
        <view class="plate-pair">
          <view class="plate-item"><text class="plate-label">內地港澳入出境號牌</text><MainlandPlate v-if="p.mainland_plate" :plate="p.mainland_plate" :width="300"/><view v-else class="plate-missing">未提供號碼</view></view>
          <view class="plate-item"><text class="plate-label">{{ p.route==='粵港'?'香港':'澳門' }}號牌</text><template v-if="p.local_plate"><HongKongPlate v-if="p.route==='粵港'" :plate="p.local_plate" :width="300"/><view v-else class="physical-plate macau"><text>{{ formatMacau(p.local_plate) }}</text></view></template><view v-else class="plate-missing">未提供號碼</view></view>
        </view>
        <view class="kv facts"><text class="k">上牌狀態</text><text class="v">{{ p.installation_status==='待核對' ? unsetWord() : p.installation_status }}</text><text class="k">使用狀態</text><text class="v">{{ usageWord(p.usage_status) }}</text><text class="k">綁定車輛</text><text class="v">{{ boundVehicle(p) }}</text></view>
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
      </view>
      <view :id="'fold-requests'" class="list-card row fold-head" @click="toggle('requests')"><text class="fold-title">辦理記錄</text><text class="fold-sum grow">{{ summary.requests?.length ? summary.requests.length + ' 項' : '沒有' }}</text><text class="chev">{{ open.requests ? '⌃' : '›' }}</text></view>
      <view v-if="open.requests" class="fold-body">
        <view v-if="!summary.requests?.length" class="card"><text class="line-sub">這個牌照還沒有辦理記錄。</text></view>
        <view v-if="summary.requests?.length"><view class="card list"><view v-for="r in summary.requests" :key="r.id" class="line" @click="openRequest(r.id)"><view class="grow"><view class="row"><text class="line-title grow">{{ r.title }}</text><text class="pill" :class="requestTone(r.status)">{{ r.status }}</text></view><text class="line-sub">{{ clientStage(r.stage) }}</text></view><text class="chev">›</text></view></view></view>
      </view>
      </view>
    </view>
    <text v-if="!creating && summary.id && !plates[0]?.stopped_on" class="link stop-link" @click="openSelf('stop_renewal')">不再續期這個牌照 ›</text>
    <wd-action-sheet custom-class="choice-sheet" v-model="sheet.show" :title="sheet.title" :actions="sheet.actions" cancel-text="取消" @select="onSelect" @close="onClose" />
    <wd-message-box />
  </view>
</template>
<script setup>
import { ref,computed,nextTick } from 'vue'
import { onLoad,onShow } from '@dcloudio/uni-app'
import { useChoice,useConfirm } from '../../lib/choice'
import { canEntrust,startEntrust,isSelfManaged,unsetWord,noDatesWord } from '../../lib/api'
// 自管客戶自己建檔，沒有顧問核對批文卡：不顯示「待核對」，只顯示有效期
const cardSelfManaged=isSelfManaged()
import { api,getUser,startRequest,requestTone,clientStage,detailText,selfHandled,money,cardPhoto,viewCardOriginal,forgetCardOriginal,viewVehicleDocument,daysLeft } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
import ApprovalCard from '../../components/ApprovalCard.vue'
import MainlandPlate from '../../components/MainlandPlate.vue'
import HongKongPlate from '../../components/HongKongPlate.vue'
const { sheet,choose,onSelect,onClose }=useChoice(),confirmBox=useConfirm()
const vehicles=ref([]),detail=ref({}),plates=ref([]),plateDetail=ref({}),sources=ref([])
const crossingBusy=ref(false),justCrossed=ref(false),loaded=ref(false),cardBack=ref(false),allDeadlines=ref(false)
const healthLabel={ok:'正常',due:'快到期',overdue:'已逾期',pending:noDatesWord()},healthTone={ok:'',due:'amber',overdue:'red',pending:'gray'}
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
function cardSummary(p){const status=p.card_status||'待核對',expires=p.card_expires_on?'有效期至 '+p.card_expires_on:'';if(cardSelfManaged&&status==='待核對')return expires||'已建檔';return status+(expires?' · '+expires:'')}
const usageWord=status=>!status||status==='待核對'?unsetWord():status==='出租中'?'使用安排中':status
const cycleLabel={monthly:'每月',quarterly:'每季',yearly:'每年'},feeTone={已收:'gray',逾期:'red',部分收:'amber',待收:''}
// 代收的寫「已收到」；直付的由客戶自己收款，寫「已確認收到」
function feeLabel(a,i){return i.status==='已收'?(a.collectionMode==='代收'?'我們已收到':'已確認收到'):i.status==='逾期'?'未收到（已過期）':i.status==='部分收'?'部分收到':'未到期'}
function openRequest(id){uni.navigateTo({url:'/pages/request-detail/request-detail?id='+id})}
const editingCardId=ref(''),cardDraft=ref({}),creating=ref(false),plateForm=ref({}),savingFile=ref(false)
let plateId=''
const cardFields=[['cardNumber','編號'],['company','商號'],['contractor','內承單位'],['crossing','通行口岸'],['serial','卡面流水號'],['mainlandPlate','內地車牌號'],['localPlate','港澳車牌號'],['driver1','駕駛人 1'],['driver2','駕駛人 2'],['driver3','駕駛人 3'],['currentApproval','現批文號'],['previousApproval','原批文號'],['color','顏色'],['seats','座位／噸位'],['purpose','請予辦理'],['validFrom','有效期開始'],['validTo','有效期結束'],['notes','備註']].map(([key,label])=>({key,label}))
function vehicleOptions(p){return [{id:'',label:'未綁定'},...vehicles.value.filter(v=>v.customer_id===p.customer_id&&v.route===p.route&&(!v.retired_on||v.id===p.vehicle_id)).map(v=>({id:v.id,label:[v.plate,v.brand,v.model].filter(Boolean).join(' · ')}))]}
function fillPlateForm(p){plateForm.value={mainlandPlate:p.mainland_plate||'',localPlate:p.local_plate||'',installationStatus:p.installation_status||'待核對',usageStatus:p.usage_status||'待核對',vehicleId:p.vehicle_id||'',cardNumber:p.card_number||'',cardExpiresOn:p.card_expires_on||'',notes:p.notes||''}}
async function savePlate(p){if(savingFile.value)return;const nextVehicle=vehicles.value.find(v=>v.id===plateForm.value.vehicleId);const newPlate=plateForm.value.vehicleId&&plateForm.value.vehicleId!==(p.vehicle_id||'')?nextVehicle?.plate:plateForm.value.localPlate.trim()!==(p.local_plate||'')?plateForm.value.localPlate.trim():'';if(newPlate&&p.local_plate){const did=await askChange('港澳車牌由 '+p.local_plate+' 改為 '+newPlate,'換車');if(did===null)return;if(did)return openSelf('vehicle_change',newPlate)}savingFile.value=true;try{const updated=await api('/plate-assets/'+p.id,'PATCH',plateForm.value);plates.value=[updated];plateDetail.value={...plateDetail.value,[p.id]:updated};fillPlateForm(updated);summary.value=await api('/my/plates/'+p.id);loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{savingFile.value=false}}
function displayCardData(p){return editingCardId.value===p.id?cardDraft.value:plateDetail.value[p.id]?.cardData||{}}
function editCard(p){cardDraft.value={...(plateDetail.value[p.id]?.cardData||{})};editingCardId.value=p.id}
function fieldStatusText(status){return status?.status==='uncertain'?'請核對':status?.status==='failed'?'未能辨識，請手動填寫':''}
function fieldStatusClass(status){return status?.status==='failed'?'failed':'uncertain'}
async function saveCard(p){const before=plateDetail.value[p.id]?.cardData||{},why=await askWhy(before,cardDraft.value);if(why===null)return;try{const updated=await api('/plate-assets/'+p.id,'PUT',{cardData:cardDraft.value});plateDetail.value={...plateDetail.value,[p.id]:updated};plates.value=plates.value.map(item=>item.id===p.id?updated:item);editingCardId.value='';summary.value=await api('/my/plates/'+p.id);loadPending();if(why)return openSelf(why.kind,why.newPlate);uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}}
// 上傳批文卡：先選正面或背面，再選「只保存正本」（資料不變，只留相片）或「上傳並讀取內容」（辨識、填入、標待核對）
async function uploadCard(p){const face=await choose('上傳哪一面？',['正面','背面']);if(face<0)return;const side=face===0?'front':'back';const mode=await choose('怎樣處理這張相片？',[{title:'只保存正本',sub:'資料不變，只留相片記錄'},{title:'上傳並讀取內容',sub:'系統讀出卡上的文字填入，顧問會再核對'}]);if(mode===0)saveCardOriginal(p,side);else if(mode===1)readCard(p,side)}
function saveCardOriginal(p,side){uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{uni.showLoading({title:'正在上傳',mask:true});try{const image=(await cardPhoto(result)).data;await api('/plate-assets/'+p.id+'/card/'+side,'POST',{image,recognize:false});forgetCardOriginal(p.id);const updated=await api('/plate-assets/'+p.id);plateDetail.value={...plateDetail.value,[p.id]:updated};uni.hideLoading();uni.showToast({title:'正本已保存，資料沒有改動',icon:'none'})}catch(e){uni.hideLoading();uni.showToast({title:e.message||'上傳失敗',icon:'none'})}}})}
function readCard(p,side){uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async result=>{uni.showLoading({title:'正在上傳辨識',mask:true});try{const image=(await cardPhoto(result)).data;const before={...(plateDetail.value[p.id]?.cardData||{})};const response=await api('/plate-assets/'+p.id+'/card/'+side,'POST',{image});forgetCardOriginal(p.id);fieldStatus.value=response.fieldStatus||{};const updated=await api('/plate-assets/'+p.id);plateDetail.value={...plateDetail.value,[p.id]:updated};plates.value=plates.value.map(item=>item.id===p.id?updated:item);editCard(p);summary.value=await api('/my/plates/'+p.id);loadPending();uni.hideLoading();const why=await askWhy(before,response.cardData||{},true);if(why){editingCardId.value='';return openSelf(why.kind,why.newPlate)}uni.showToast({title:'已辨識，請核對欄位',icon:'none'})}catch(e){uni.hideLoading();uni.showToast({title:e.message||'上傳失敗',icon:'none'})}}})}
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
// 從批文卡建檔的牌照沒有車輛記錄：按港澳車牌登記並綁定，然後即可上傳證件
const registeringVehicle=ref(false)
async function registerVehicle(){if(registeringVehicle.value)return;registeringVehicle.value=true;try{const r=await api('/plate-assets/'+plateId+'/vehicle','POST');uni.showToast({title:'已登記車輛 '+r.vehicle.plate+'，請上傳證件',icon:'none'});await load()}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{registeringVehicle.value=false}}
// 車輛證件：上傳後系統辨識並填入空白資料，回傳最新的車輛與證件清單
const docs=ref({}),uploadingDoc=ref('')
async function loadDocs(list){const entries=await Promise.all(list.map(v=>api('/vehicles/'+v.id+'/documents').then(r=>[v.id,r]).catch(()=>[v.id,null])));docs.value={...docs.value,...Object.fromEntries(entries.filter(([,r])=>r))}}
function pickOne(){return new Promise((resolve,reject)=>uni.chooseImage({count:1,sizeType:['compressed'],sourceType:['camera','album'],success:resolve,fail:e=>/cancel/.test(e.errMsg||'')?resolve(null):reject(new Error('未能選擇相片'))}))}
async function uploadDoc(v,d){if(uploadingDoc.value)return;try{const picked=await pickOne();if(!picked)return;uploadingDoc.value=v.id+':'+d.kind;const {data}=await cardPhoto(picked);const r=await api('/vehicles/'+v.id+'/documents/'+d.kind,'POST',{image:data});docs.value={...docs.value,[v.id]:{vehicleId:r.vehicleId,retired:r.retired,documents:r.documents,checks:r.checks}};if(r.vehicle)vehicles.value=vehicles.value.map(item=>item.id===v.id?r.vehicle:item);if(r.applied?.length){summary.value=await api('/my/plates/'+plateId);loadPending()}uni.showToast({title:!d.recognizable?'已上傳':r.recognitionFailed?'已上傳，未能辨識，請手動填寫':r.applied?.length?'已讀出並填入'+r.applied.map(a=>a.label).join('、'):'已上傳，請對照核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{uploadingDoc.value=''}}
function editVehicle(v){if(editingVehicleId.value===v.id){editingVehicleId.value='';return}vehicleForm.value={plate:v.plate||'',brand:v.brand||'',model:v.model||'',vin:v.vin||'',manufacturedYear:v.manufactured_year?String(v.manufactured_year):'',firstRegisteredOn:v.first_registered_on||''};editingVehicleId.value=v.id}
async function saveVehicle(v){if(savingVehicle.value)return;const newPlate=vehicleForm.value.plate.trim();if(newPlate&&v.plate&&newPlate.toUpperCase()!==v.plate.toUpperCase()){const did=await askChange('車牌由 '+v.plate+' 改為 '+newPlate,'換車');if(did===null)return;if(did){editingVehicleId.value='';return openSelf('vehicle_change',newPlate)}}savingVehicle.value=true;try{const updated=await api('/my/vehicles/'+v.id,'PATCH',{...vehicleForm.value,manufacturedYear:String(vehicleForm.value.manufacturedYear||'')});vehicles.value=vehicles.value.map(item=>item.id===v.id?updated:item);editingVehicleId.value='';loadPending();uni.showToast({title:'已更新，顧問會再核對',icon:'none'})}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{savingVehicle.value=false}}
// 客戶自行辦理（docs/tasks/self-handled-changes-design.md）：改車牌、駕駛人、有效期時先問是辦了變更還是填錯；
// 辦了變更就轉到「自行辦理更新」，舊車、舊司機保留作記錄並停止提醒，顧問整件核對。
const selfRecords=ref([])
// 退回的說明顯示 30 天；不再續期待核對時，上面的「已標記不再續期」已說明，不重複
const selfNotes=computed(()=>{const seen=new Set();return selfRecords.value.filter(r=>{if(seen.has(r.kind))return false;seen.add(r.kind);return (r.status==='已退回'&&Date.now()-Date.parse(r.reviewedAt)<30*86400000)||(r.status==='待核對'&&!(r.kind==='stop_renewal'&&plates.value[0]?.stopped_on))})})
async function loadSelf(){try{selfRecords.value=await api('/my/plates/'+plateId+'/self-handled')}catch{selfRecords.value=[]}}
function openSelf(kind,newPlate='',extra={}){const query={plate:plateId,kind,...(newPlate?{newPlate}:{}),...extra};uni.navigateTo({url:'/pages/self-change/self-change?'+Object.entries(query).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')})}
// 驗車、新批文備案：客戶自己辦好了，附相片標記，顧問再核對
function markDone(item){openSelf(item.code==='inspection'?'inspection_done':item.code==='mo_vehicle_tax'?'tax_paid':'filing_done','',{period:item.period,name:item.name,label:item.detail||'',dueOn:item.dueOn||''})}
// 「有變動？」（2026-10-18 管理者確認的線框圖）：取代頂部四個辦理按鈕和各處「修改…」，只問一條
const changeOptions=[{title:'我已經自己辦好',sub:'續期、換車、換司機、口岸或商號變更、補領，在這裏更新資料',run:()=>doneSelf()},{title:'請顧問幫我辦',sub:'開一張辦理申請，顧問會跟進',run:()=>askAdvisor()},{title:'資料有錯字',sub:'直接修改，顧問會再核對',run:()=>fixTypo()}]
async function askChanges(){const i=await choose('這個牌照有甚麼變動？',changeOptions);if(i>=0)changeOptions[i].run()}
async function doneSelf(){const own=[['續期','renewal'],['換車','vehicle_change'],['換司機','driver_change'],...(plates.value[0]?.route==='粵港'?[['口岸變更','crossing_change']]:[]),['商號變更','company_change'],['補領批文卡','replacement']];const i=await choose('你自己辦好了甚麼？',own.map(x=>x[0]));if(i>=0)openSelf(own[i][1])}
async function askAdvisor(){const list=[['續期','renewal'],['換車','vehicle_change'],['換司機','driver_change'],['其他','other']];const i=await choose('請顧問幫你辦甚麼？',list.map(x=>x[0]));if(i>=0)startRequest(list[i][1],summary.value.id)}
async function fixTypo(){const p=plates.value[0];const list=[['批文卡內容',()=>{editCard(p);openFold('card')}],['牌照資料',()=>{showEdit.value=true;openFold('plate')}],...(boundVehicles.value.length?[['車輛資料',()=>{editingVehicleId.value='';editVehicle(boundVehicles.value[0]);openFold('vehicle')}]]:[]),...(summary.value.drivers?.length?[['司機資料',()=>openFold('drivers')]]:[])];const i=await choose('要修改哪一項？',list.map(x=>x[0]));if(i>=0)list[i][1]()}
// 其他資料平時收起；從別處（批文卡連結、下一件事、有錯字）打開時捲到該區
const open=ref({})
function toggle(key){open.value={...open.value,[key]:!open.value[key]}}
function openFold(key){open.value={...open.value,[key]:true};nextTick(()=>setTimeout(()=>uni.pageScrollTo({selector:'#fold-'+key,duration:200}),50))}
const clientTodoCount=computed(()=>(summary.value.deadlines||[]).filter(i=>['due','overdue'].includes(i.level)&&(i.handledBy==='you'||i.code==='crossing_90')).length)
const levelWord={overdue:'已逾期',due:'快到期'}
const deadlineSummary=computed(()=>{const list=deadlineList.value;if(!list.length)return summary.value.health==='pending'?(cardSelfManaged?'未填到期日':'整理中'):'半年內沒有';const urgent=list.filter(i=>['overdue','due'].includes(i.level));return list.length+' 項'+(urgent.length?' · '+urgent.length+' 項'+levelWord[urgent.some(i=>i.level==='overdue')?'overdue':'due']:'')})
const crossingSummary=computed(()=>{const c=summary.value.crossing;return !c?.enabled?'未開啟':c.lastCrossedOn?'上次 '+c.lastCrossedOn:'未記錄過關日期'})
const vehicleSummary=computed(()=>{const v=boundVehicles.value[0];if(!v)return '尚未登記車輛';const list=docs.value[v.id]?.documents||[];return v.plate+(list.length?' · 證件 '+list.filter(d=>d.uploaded).length+'/'+list.length+' 已上傳':'')})
const driverSummary=computed(()=>{const list=summary.value.drivers||[];if(!list.length)return '未登記';const main=list.find(d=>d.role==='主')||list[0];return main.name+'（'+(main.role==='主'?'主':'副')+'）'+(list.length>1?' 等 '+list.length+' 人':'')})
// 有使用安排時，摘要加最近一期使用費的收款狀態
const paidWord=a=>{const list=a?.invoices||[];if(list.some(i=>i.status==='逾期'))return '有逾期未收';const last=[...list].sort((x,y)=>String(y.period).localeCompare(String(x.period)))[0];return !last?'未有使用費記錄':last.status==='已收'?'已收':last.status==='部分收'?'部分收到':'未到期'}
const usageSummary=computed(()=>{const s=summary.value,active=arrangements.value.find(a=>a.status==='生效')||arrangements.value[0];if(active)return active.user.name+' · '+paidWord(active);return s.rental?'使用安排：'+s.rental.renter:s.usageStatus==='自用'?'自用':s.installationStatus==='未上牌'?'空置（未上牌）':unsetWord()})
const plateSummary=computed(()=>{const p=plates.value[0];return p?(p.installation_status==='待核對'?unsetWord():p.installation_status)+' · '+boundVehicle(p):''})
// 下一件要做的事：先逾期、再快到期（你自理的事項、90 天過關），然後是車輛登記和必要證件
const nextBusy=ref(false)
const nextStep=computed(()=>{
  const p=plates.value[0];if(!p||!summary.value.id)return null
  const steps=[],rank={overdue:0,due:1}
  const c=summary.value.crossing;if(c?.enabled&&c.nextDueOn){const left=daysLeft(c.nextDueOn);if(left!==null&&left<=15)steps.push({level:left<0?'overdue':'due',dueOn:c.nextDueOn,title:'90 天內要過關一次',sub:(left<0?'已過期限 ':'期限 ')+c.nextDueOn+(c.lastCrossedOn?'，上次 '+c.lastCrossedOn:''),label:'今天已過關',run:()=>markCrossed(todayIso())})}
  for(const item of deadlineList.value)if(item.handledBy==='you'&&rank[item.level]!==undefined)steps.push({level:item.level,dueOn:item.dueOn,title:item.name+(item.level==='overdue'?'已逾期':'快到期'),sub:[item.ownerType==='plate'?'':item.ownerLabel,'到期日 '+item.dueOn,'請你自行辦理'].filter(Boolean).join(' · '),label:item.markable?'已辦好':item.editable?'更新到期日':'查看',run:()=>item.markable?markDone(item):openFold('deadlines')})
  steps.sort((a,b)=>rank[a.level]-rank[b.level]||String(a.dueOn).localeCompare(String(b.dueOn)))
  if(steps.length)return steps[0]
  if(!boundVehicles.value.length&&p.installation_status!=='未上牌'&&p.local_plate)return {title:'登記這部車',sub:'按港澳車牌 '+p.local_plate+' 登記，之後可拍下行駛證和'+(p.route==='粵澳'?'澳門車輛登記文件':'香港車輛牌照')+'。',label:'登記這部車',run:registerVehicle}
  const v=boundVehicles.value[0],missing=v&&!docs.value[v.id]?.retired&&(docs.value[v.id]?.documents||[]).find(d=>d.primary&&!d.uploaded)
  if(missing)return {title:'上傳'+missing.label,sub:'拍下證件，系統會讀出車架號碼和日期。',label:'拍照上傳',run:()=>uploadDoc(v,missing)}
  return null
})
async function runNext(){if(nextBusy.value||!nextStep.value)return;nextBusy.value=true;try{await nextStep.value.run()}finally{nextBusy.value=false}}
// 回傳 true＝辦了變更、false＝之前填錯、null＝取消
async function askChange(what,change){const r=await confirmBox.ask({title:what,msg:'是自己辦了'+change+'，還是之前填錯？',ok:{換車:'辦了換車',換司機:'換了司機',續期:'辦了續期',口岸變更:'辦了變更',商號變更:'辦了變更',補領:'辦了補領'}[change],cancel:'之前填錯'});return r==='confirm'?true:r==='cancel'?false:null}
const driverNames=card=>['driver1','driver2','driver3'].map(k=>String(card[k]||'').trim()).filter(Boolean).sort().join('、')
// 比較批文卡改動：港澳車牌→換車、駕駛人→換司機、有效期延後→續期。uploaded：新卡已存檔，只問不擋
async function askWhy(before,after,uploaded=false){
  const local=String(after.localPlate||'').trim(),oldLocal=String(before.localPlate||'').trim()
  if(local&&oldLocal&&local.toUpperCase()!==oldLocal.toUpperCase()){const did=await askChange('港澳車牌由 '+oldLocal+' 改為 '+local,'換車');return did===null?(uploaded?false:null):did?{kind:'vehicle_change',newPlate:local}:false}
  if(driverNames(before)&&driverNames(after)&&driverNames(before)!==driverNames(after)){const did=await askChange('駕駛人改為 '+driverNames(after),'換司機');return did===null?(uploaded?false:null):did?{kind:'driver_change'}:false}
  if(before.validTo&&after.validTo&&after.validTo>before.validTo){const did=await askChange('有效期延至 '+after.validTo,'續期');return did===null?(uploaded?false:null):did?{kind:'renewal'}:false}
  const text=key=>String(after[key]||'').trim(),old=key=>String(before[key]||'').trim(),moved=key=>text(key)&&old(key)&&text(key)!==old(key)
  if(moved('crossing')&&plates.value[0]?.route==='粵港'){const did=await askChange('通行口岸改為 '+text('crossing'),'口岸變更');return did===null?(uploaded?false:null):did?{kind:'crossing_change'}:false}
  if(moved('company')||moved('contractor')){const did=await askChange((moved('company')?'商號':'內承單位')+'改為 '+text(moved('company')?'company':'contractor'),'商號變更');return did===null?(uploaded?false:null):did?{kind:'company_change'}:false}
  if(moved('serial')){const did=await askChange('卡面流水號改為 '+text('serial'),'補領');return did===null?(uploaded?false:null):did?{kind:'replacement'}:false}
  return false
}
// 到「我的公司」打開那間公司的修改表單
function fillCompany(id){uni.setStorageSync('editCompany',id);uni.switchTab({url:'/pages/companies/companies'})}
function boundVehicle(p){const v=vehicles.value.find(x=>x.id===p.vehicle_id);return v?[v.brand,v.model,v.plate].filter(Boolean).join(' · '):'未綁定'}
function mainlandParts(value){const clean=String(value||'').toUpperCase().replace(/[\s·•.-]/g,'');const match=clean.match(/^([粵粤])([A-Z])(.+?)([港澳])$/);return match?{province:'粵',code:match[2],serial:match[3],suffix:match[4]}:{province:'',code:'',serial:clean,suffix:''}}
function formatHongKong(value){const clean=String(value||'').toUpperCase().replace(/\s+/g,'');return clean.replace(/^([A-Z]{1,2})([0-9]{1,4})$/,'$1 $2')}
function formatMacau(value){const clean=String(value||'').toUpperCase().replace(/[\s-]/g,'');return clean.replace(/^([A-Z]{2})([0-9]{2})([0-9]{2})$/,'$1-$2-$3')}
function openSource(sourceId){const source=sources.value.find(s=>s.id===sourceId);if(source)uni.setClipboardData({data:source.url,success:()=>uni.showToast({title:'官方連結已複製',icon:'none'})})}
async function load(){if(!getUser())return uni.navigateTo({url:'/pages/login/login'});if(creating.value||!plateId)return;try{const [p,v,catalog,mine]=await Promise.all([api('/plate-assets/'+plateId),api('/vehicles'),api('/catalog'),api('/my/plates/'+plateId)]);summary.value=mine;loadPending();loadSelf();api('/my/drivers').then(list=>{drivers.value=list}).catch(()=>{drivers.value=[]});api('/my/rentals').then(list=>{arrangements.value=list.filter(item=>item.plateId===plateId)}).catch(()=>{arrangements.value=[]});plates.value=[p];plateDetail.value={...plateDetail.value,[p.id]:p};vehicles.value=v;sources.value=catalog.sources;fillPlateForm(p);detail.value=Object.fromEntries(await Promise.all(v.map(async item=>[item.id,await api('/vehicles/'+item.id)])));loadDocs(v.filter(item=>item.id===p.vehicle_id))}catch(e){uni.showToast({title:e.message,icon:'none'})}finally{loaded.value=true}}
onLoad(options=>{plateId=options.id||'';creating.value=options.new==='1';if(!creating.value)load()})
onShow(load)
import DueDate from '../../components/DueDate.vue'
import StampMark from '../../components/StampMark.vue'
</script>
<style scoped>
.head-card{display:block;margin:-8px 0 12px}.next-card{margin-top:4px}.next-kicker{display:block;margin-bottom:4px;color:var(--ink-3);font-size:var(--fs-meta);font-weight:700}.next-button{margin-top:12px}.change-button{width:100%;margin-top:12px}.other-title{display:block;margin-top:24px}
.fold-head{align-items:center;gap:12px}.fold-title{flex:none;font-size:var(--fs-h);font-weight:700;color:var(--ink)}.fold-sum{text-align:right;color:var(--ink-2);font-size:var(--fs-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fold-body{margin:-4px 0 12px}
.register-vehicle{margin-top:12px}.doc-intro{margin-bottom:4px}.doc-check{display:flex;align-items:flex-start;gap:8px;padding:8px 0}.doc-line{align-items:flex-start}.doc-actions{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
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
/* 自管客戶的「委託我們辦」 */
.entrust{display:block;margin-top:6px}
/* 「修改」「已辦好」和佔位一樣寬，日期才對齊 */
.date-edit .link{min-width:3em;text-align:right}
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
.stop-link{display:block;text-align:center;padding:16px 0 4px;color:var(--ink-2)}
</style>
