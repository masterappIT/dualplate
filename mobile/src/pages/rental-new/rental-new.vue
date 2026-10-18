<template>
  <view class="page rental-new">
    <!-- 客戶自行新增出租（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項）：填好後產生協議，客戶可修改再發給承租人 -->
    <text class="intro">{{ options ? options.plateLabel : '' }} 出租給別人使用。填好後我們會按香港法律產生出租協議，你可以修改再發給承租人確認。</text>
    <view v-if="loaded && options && !options.allowed" class="list-card warn-card"><text class="list-title">暫時不能新增出租</text><text class="list-sub">{{ options.reason }}</text></view>
    <template v-else-if="loaded && options">
      <view class="card">
        <text class="step-title">承租人</text>
        <text class="field-label">姓名或公司名稱（必填）</text><input class="field" v-model="renter.name" placeholder="例如 陳大文" />
        <text class="field-label">聯絡電話（必填）</text><input class="field num" v-model="renter.phone" placeholder="例如 +852 6123 4567" />
        <text class="subtle field-hint">承租人打開協議時要輸入電話最後 4 位。</text>
        <text class="field-label">證件號碼</text><input class="field num" v-model="renter.idNo" placeholder="香港身份證或回鄉證號碼，可不填" />
      </view>

      <view class="card">
        <text class="step-title">以誰的名義出租</text>
        <text class="subtle">建議以香港身份或香港公司簽署。</text>
        <wd-radio-group v-model="lessorKey" shape="dot" class="choices">
          <wd-radio v-for="l in options.lessors" :key="l.type + l.id" :value="l.type + ':' + l.id">{{ l.label }}（{{ l.hint }}）</wd-radio>
        </wd-radio-group>
      </view>

      <view class="card">
        <text class="step-title">使用的車和司機</text>
        <view class="segmented car-switch"><text class="seg" :class="{ on: useCurrent }" @click="useCurrent = true">{{ options.currentVehicle ? '用現有的車 ' + options.currentVehicle : '用現有的車' }}</text><text class="seg" :class="{ on: !useCurrent }" @click="useCurrent = false">承租人自己的車</text></view>
        <template v-if="!useCurrent"><text class="field-label">承租人的車牌（必填）</text><input class="field num" v-model="vehiclePlate" placeholder="按行車證填寫" /></template>
        <text v-else-if="!options.currentVehicle" class="subtle field-hint">這個牌照還沒有登記車輛，請選「承租人自己的車」。</text>
        <text class="field-label">司機</text>
        <view v-for="d in options.drivers" :key="d.id" class="choice-row"><wd-checkbox v-model="pickedDrivers[d.id]" shape="square">{{ d.name }}（已登記）</wd-checkbox></view>
        <text class="field-label">新司機姓名</text><input class="field" v-model="newDriver" placeholder="承租人自己的司機，可不填" />
      </view>

      <view v-if="needed.length" class="card">
        <text class="step-title">要辦的手續</text>
        <text class="subtle">承租人的車或司機要先登記到批文上，辦妥後才開始出租和收租。</text>
        <view v-for="n in needed" :key="n.kind" class="proc">
          <view class="row"><text class="proc-name grow">{{ n.name }}</text><text class="subtle">{{ procedures[n.kind] === 'us' ? options.prices[n.kind] : '辦好後在「有變動？」更新' }}</text></view>
          <view class="segmented"><text class="seg" :class="{ on: procedures[n.kind] === 'us' }" @click="procedures[n.kind] = 'us'">交給我們辦</text><text class="seg" :class="{ on: procedures[n.kind] === 'client' }" @click="procedures[n.kind] = 'client'">我自行辦理</text></view>
        </view>
      </view>

      <view class="card">
        <text class="step-title">租期和租金</text>
        <text class="field-label">起租日期（必填）</text>
        <picker mode="date" :value="startsOn" @change="startsOn = $event.detail.value"><view class="field picker" :class="{ placeholder: !startsOn }"><text>{{ startsOn || '選擇日期' }}</text><text class="chev">›</text></view></picker>
        <text class="field-label">結束日期</text>
        <picker mode="date" :value="endsOn" :start="startsOn" @change="endsOn = $event.detail.value"><view class="field picker" :class="{ placeholder: !endsOn }"><text>{{ endsOn || '未定，可不填' }}</text><text class="chev">›</text></view></picker>
        <text class="field-label">租金（{{ options.currency }}，必填）</text><input class="field num" type="digit" v-model="rent" placeholder="每期金額，例如 8000" />
        <text class="field-label">收租週期</text>
        <view class="segmented"><text v-for="c in cycleOptions" :key="c.value" class="seg" :class="{ on: cycle === c.value }" @click="cycle = c.value">{{ c.label }}</text></view>
        <text class="field-label">每期收租日（1–28 日）</text><input class="field num" type="number" v-model="dueDay" placeholder="例如 5" />
        <text class="field-label">押金（{{ options.currency }}）</text><input class="field num" type="digit" v-model="deposit" placeholder="沒有可不填" />
      </view>

      <view class="card">
        <text class="step-title">{{ selfManaged ? '協議和收租' : '由誰負責' }}</text>
        <!-- 自管客戶只可自行負責、租客直接付給你；代理和代收是托管服務（docs/tasks/self-managed-fixes-plan.md 第 11 步） -->
        <text v-if="selfManaged" class="subtle field-hint">你自己把協議發給承租人、收租，租金由承租人直接付給你；我們只記錄。想由我們代收，可在牌照的出租區按「交給我們代收」。</text>
        <template v-else>
        <view class="segmented"><text class="seg" :class="{ on: handling === 'self' }" @click="handling = 'self'">自行負責</text><text class="seg" :class="{ on: handling === 'agent' }" @click="handling = 'agent'">交給我們代理</text></view>
        <text class="subtle field-hint">{{ handling === 'self' ? '你自己把協議發給承租人、收租；我們只記錄。' : '協議和後續由顧問接手，可由我們代收租金，按你的委託內容收費。' }}</text>
        </template>
        <template v-if="handling === 'agent'">
          <text class="field-label">租金怎樣付</text>
          <view class="segmented"><text class="seg" :class="{ on: collection === '直付' }" @click="collection = '直付'">直接付給你</text><text class="seg" :class="{ on: collection === '代收' }" @click="collection = '代收'">由我們代收</text></view>
        </template>
      </view>

      <button class="primary submit" :disabled="busy" @click="submit">{{ busy ? '正在新增…' : '新增出租' }}</button>
    </template>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { api, getUser, isSelfManaged } from '../../lib/api'
const selfManaged = isSelfManaged()
let plateId = ''
const options = ref(null), loaded = ref(false), busy = ref(false)
const renter = ref({ name: '', phone: '', idNo: '' }), lessorKey = ref('client:'), useCurrent = ref(true), vehiclePlate = ref(''), pickedDrivers = ref({}), newDriver = ref('')
const startsOn = ref(''), endsOn = ref(''), rent = ref(''), deposit = ref(''), cycle = ref('monthly'), dueDay = ref('5'), handling = ref('self'), collection = ref('直付'), procedures = ref({ vehicle: 'us', driver: 'us' })
const cycleOptions = [{ value: 'monthly', label: '每月' }, { value: 'quarterly', label: '每季' }, { value: 'yearly', label: '每年' }]
const sameCar = (a, b) => String(a || '').replace(/\s/g, '').toUpperCase() === String(b || '').replace(/\s/g, '').toUpperCase()
// 換了車才要換車；有新司機才要換司機（與後台判斷一致）
const needed = computed(() => [...(!useCurrent.value && vehiclePlate.value.trim() && !sameCar(vehiclePlate.value, options.value?.currentVehicle) ? [{ kind: 'vehicle', name: '換車' }] : []), ...(newDriver.value.trim() ? [{ kind: 'driver', name: '換司機' }] : [])])
const cents = text => { const value = Number(String(text || '').replace(/,/g, '')); return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN }
onLoad(query => { plateId = decodeURIComponent(query.plate || ''); load() })
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try {
    options.value = await api('/my/plates/' + plateId + '/rental-options')
    // 預設用第一間香港公司（建議以香港公司簽署），沒有就用本人
    const hkCompany = options.value.lessors.find(l => l.type === 'company' && l.hint === '香港公司')
    lessorKey.value = hkCompany ? 'company:' + hkCompany.id : 'client:'
    useCurrent.value = Boolean(options.value.currentVehicle)
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
async function submit() {
  const [lessorType, lessorCompanyId] = lessorKey.value.split(':')
  const rentAmount = cents(rent.value), depositAmount = deposit.value ? cents(deposit.value) : 0
  if (!renter.value.name.trim()) return uni.showToast({ title: '請填寫承租人姓名', icon: 'none' })
  if (!startsOn.value) return uni.showToast({ title: '請選擇起租日期', icon: 'none' })
  if (!rentAmount) return uni.showToast({ title: '請填寫租金', icon: 'none' })
  if (Number.isNaN(depositAmount)) return uni.showToast({ title: '押金金額無效', icon: 'none' })
  busy.value = true
  try {
    const created = await api('/my/plates/' + plateId + '/rentals', 'POST', {
      renter: { name: renter.value.name, phone: renter.value.phone, idNo: renter.value.idNo }, lessorType, lessorCompanyId: lessorCompanyId || null,
      useCurrentVehicle: useCurrent.value, renterVehiclePlate: vehiclePlate.value, driverIds: Object.keys(pickedDrivers.value).filter(key => pickedDrivers.value[key]), newDriverName: newDriver.value,
      startsOn: startsOn.value, endsOn: endsOn.value || null, rentAmount, depositAmount, cycle: cycle.value, dueDay: Number(dueDay.value), currency: options.value.currency,
      handling: handling.value, collectionMode: handling.value === 'agent' ? collection.value : '直付', procedures: Object.fromEntries(needed.value.map(n => [n.kind, procedures.value[n.kind]]))
    })
    uni.redirectTo({ url: '/pages/rental/rental?id=' + created.id })
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = false }
}
</script>
<style scoped>
.step-title{display:block;margin-bottom:4px;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.field-hint{margin-top:4px}
.picker{display:flex;align-items:center;justify-content:space-between}.picker.placeholder{color:var(--ink-3)}
.choices{margin-top:8px}
.car-switch{margin-top:8px}
.choice-row{padding:8px 0}
.proc{padding:12px 0;border-bottom:1px solid var(--rule)}.proc:last-child{border-bottom:0;padding-bottom:0}
.proc .row{margin-bottom:8px}
.proc-name{font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.submit{margin-top:4px}
</style>
