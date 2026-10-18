<template>
  <view class="page rental-page">
    <!-- 客戶新增的出租（docs/tasks/custody-feedback-2026-10-18.md 第 5A 項）：協議、發給承租人、換車換司機進度、簽署本 -->
    <template v-if="r">
      <view class="head">
        <view class="row"><text class="page-title grow">{{ r.renter.name }}</text><text class="pill" :class="tone">{{ r.statusWord }}</text></view>
        <text class="subtle">{{ r.plateLabel }} · {{ r.startsOn }} 起{{ r.endsOn ? ' 至 ' + r.endsOn : '' }}</text>
      </view>

      <!-- 下一步：只寫一件事 -->
      <view class="card next-card" :class="{ 'warn-card': waitingOnYou }">
        <text class="next-kicker">現在</text>
        <text class="line-title">{{ next.title }}</text>
        <text class="line-sub">{{ next.sub }}</text>
      </view>

      <view v-if="r.procedures.length" class="card">
        <text class="step-title">換車、換司機</text>
        <view v-for="p in r.procedures" :key="p.id" class="proc row">
          <view class="grow"><text class="line-title">{{ p.name }}</text><text class="line-sub">{{ p.handler === 'us' ? '交給我們辦 · ' + p.price : '我自行辦理' }}</text></view>
          <text v-if="p.state === 'done'" class="pill">已辦妥</text>
          <text v-else-if="p.handler === 'us'" class="pill" :class="p.state === 'cancelled' ? 'gray' : 'blue'">{{ p.requestStatus || '辦理中' }}</text>
          <button v-else class="btn-sm" @click="reportDone(p)">已辦好？更新</button>
        </view>
      </view>

      <view class="card kv">
        <text class="k">出租人</text><text class="v">{{ r.lessor }}</text>
        <text class="k">承租人電話</text><text class="v num">{{ r.renter.phone }}</text>
        <text class="k">使用車輛</text><text class="v">{{ r.renter.vehiclePlate }}</text>
        <text class="k">司機</text><text class="v">{{ r.renter.driver }}</text>
        <text class="k">租金</text><text class="v num">{{ money(r.currency, r.rentAmount) }} / {{ cycleLabel[r.cycle] }}，每期 {{ r.dueDay }} 日前</text>
        <text class="k">押金</text><text class="v num">{{ r.depositAmount ? money(r.currency, r.depositAmount) : '沒有' }}</text>
        <text class="k">租金怎樣付</text><text class="v">{{ r.collectionMode === '代收' ? '由我們代收' : '直接付給你' }}</text>
      </view>

      <view class="section-head"><text class="section-title">出租協議</text><text v-if="r.agreement.version" class="subtle">已發出第 {{ r.agreement.version }} 版</text></view>
      <view class="card">
        <text v-if="r.agreement.confirmed" class="pill confirmed">{{ r.agreement.confirmedBy }} 已於 {{ when(r.agreement.confirmedAt) }} 確認</text>
        <text v-else-if="r.agreement.version" class="pill amber confirmed">等承租人確認</text>
        <text v-if="r.handling !== 'self'" class="line-sub">這次出租已交給我們代理，協議由{{ forMode('顧問', '我們') }}處理。</text>
        <template v-else>
          <text class="subtle">已按你填的資料寫好，可以按實際情況修改。{{ r.agreement.version ? '發出後再改，要重新發出，承租人要重新確認。' : '' }}</text>
          <textarea v-model="draft" class="field agreement" :maxlength="20000" :disabled="!r.canSend" auto-height />
          <!-- 手寫簽名（管理者 2026-10-18）：每一版協議出租人先簽，才發給承租人；沒有改動只是重發連結，不用再簽 -->
          <view v-if="r.canSend && needSign" class="sign-box">
            <text class="field-label">出租人簽名</text>
            <text class="subtle">出租人：{{ r.lessor }}。請用手指或滑鼠在框內簽名，簽好後按「發給承租人」。</text>
            <SignaturePad ref="pad" />
          </view>
          <view v-if="r.canSend" class="actions">
            <button class="btn-sm" :disabled="busy || draft === r.agreement.body" @click="save">儲存修改</button>
            <button class="btn-sm solid" :disabled="busy" @click="send">{{ needSign ? '發給承租人' : '重新發送連結' }}</button>
          </view>
          <view v-if="link" class="link-box">
            <text class="line-sub">連結只顯示這一次，請現在傳給承租人。承租人打開時要輸入電話最後 4 位。</text>
            <text class="link-text num">{{ link.url }}</text>
            <view class="actions"><button class="btn-sm" @click="copyText(link.url, '連結已複製')">複製連結</button><button class="btn-sm" @click="whatsapp">用 WhatsApp 傳送</button></view>
          </view>
        </template>
      </view>

      <view v-if="r.agreement.version" class="card">
        <text class="step-title">第 {{ r.agreement.version }} 版的簽名</text>
        <view class="signs">
          <view v-for="p in signParties" :key="p.key" class="sign">
            <text class="subtle">{{ p.label }}</text>
            <image v-if="signImages[p.key]" class="sign-image" :src="signImages[p.key]" mode="widthFix" />
            <view v-else class="sign-blank" />
            <text class="subtle">{{ r.agreement[p.key + 'Signed'] ? r.agreement[p.key + 'Signed'].name + ' · ' + when(r.agreement[p.key + 'Signed'].at) : '未簽' }}</text>
          </view>
        </view>
      </view>

      <view class="card">
        <text class="step-title">另外簽了紙本？</text>
        <text class="subtle">雙方已在網上簽名，不用紙本。另外簽了紙本的，可以拍照或上傳 PDF 保存。</text>
        <view class="actions"><button class="btn-sm" :disabled="busy" @click="uploadSigned('photo')">{{ r.signed ? '重新拍照' : '拍照上傳' }}</button><button class="btn-sm" :disabled="busy" @click="uploadSigned('pdf')">上傳 PDF</button></view>
        <text v-if="r.signed" class="link view-signed" @click="viewSigned">已上傳，查看 ›</text>
      </view>

      <view v-if="r.invoices.length" class="card">
        <text class="step-title">各期租金</text>
        <view v-for="i in r.invoices" :key="i.id" class="fee-row row"><text class="num">{{ i.period }}</text><text class="pill" :class="feeTone[i.status]">{{ feeLabel(i) }}</text></view>
      </view>

      <button v-if="r.canCancel" class="btn-line cancel" @click="cancel">取消這次出租</button>
    </template>
    <wd-message-box />
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { api, getUser, money, copyText, openLink, pickPhotos, pickPdf, readBase64, privateImage, forMode } from '../../lib/api'
import { useConfirm } from '../../lib/choice'
import SignaturePad from '../../components/SignaturePad.vue'
const confirmBox = useConfirm()
let rentalId = ''
const r = ref(null), draft = ref(''), busy = ref(false), link = ref(null), pad = ref(null), signImages = ref({ lessor: '', renter: '' })
const signParties = [{ key: 'lessor', label: '出租人' }, { key: 'renter', label: '承租人' }]
const cycleLabel = { monthly: '每月', quarterly: '每季', yearly: '每年' }, feeTone = { 已收: 'gray', 逾期: 'red', 部分收: 'amber', 待收: '' }
const feeLabel = i => i.status === '已收' ? (r.value.collectionMode === '代收' ? '我們已收到' : '已確認收到') : i.status === '逾期' ? '未收到（已過期）' : i.status === '部分收' ? '部分收到' : '未到期'
const tone = computed(() => r.value.status === '生效' ? '' : ['草擬', '待換車'].includes(r.value.status) ? 'amber' : 'gray')
const changed = computed(() => draft.value.trim() !== (r.value?.agreement.body || '').trim() || r.value?.agreement.changed)
// 第一次發、協議改了、或這一版還沒有出租人簽名：要先簽名
const needSign = computed(() => !r.value?.agreement.version || changed.value || !r.value?.agreement.lessorSigned)
// 「10月18日 08:41」（香港時間）
const when = value => { if (!value) return ''; const t = new Date(Date.parse(value) + 8 * 3600000).toISOString(); return `${Number(t.slice(5, 7))}月${Number(t.slice(8, 10))}日 ${t.slice(11, 16)}` }
// 現在要做的事
const waitingOnYou = computed(() => r.value && (r.value.statusWord === '未發出協議' || r.value.procedures.some(p => p.handler === 'client' && p.state !== 'done' && r.value.status !== '已終止')))
const next = computed(() => {
  const x = r.value, mine = x.procedures.filter(p => p.handler === 'client' && p.state !== 'done').map(p => p.name)
  if (x.status === '已終止') return { title: x.statusWord === '已取消' ? '這次出租已取消' : '這次出租已終止', sub: '如要重新出租，可在牌照頁新增。' }
  if (x.status === '已結束') return { title: '這次出租已結束', sub: '' }
  if (x.status === '生效') return { title: '出租中', sub: `由 ${x.startsOn} 起計租金。` }
  if (x.handling !== 'self' && !x.agreement.version) return { title: '已交給我們代理', sub: forMode('顧問會聯絡你和承租人處理協議和手續。', '我們會聯絡你和承租人處理協議和手續。') }
  if (x.statusWord === '未發出協議') return { title: '把協議發給承租人', sub: '看過協議後按「發給承租人」，把連結傳給承租人確認。' }
  if (x.statusWord === '待承租人確認') return { title: '等承租人確認協議', sub: '承租人打開連結後按「我同意這份協議」。連結不見了可以重新發送。' }
  if (mine.length) return { title: `請辦理${mine.join('、')}`, sub: '辦好後按「已辦好？更新」，在「有變動？」填上新資料。辦妥後就開始出租。' }
  return { title: '等候換車、換司機辦妥', sub: '我們辦妥後就會開始出租，並通知你。' }
})
onLoad(query => { rentalId = decodeURIComponent(query.id || '') })
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { const fresh = await api('/my/rentals/' + rentalId); const keepDraft = r.value && draft.value !== r.value.agreement.body; r.value = fresh; if (!keepDraft) draft.value = fresh.agreement.body; loadSigns() } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
}
async function save() {
  busy.value = true
  try { r.value = await api('/my/rentals/' + rentalId + '/agreement', 'PUT', { body: draft.value }); draft.value = r.value.agreement.body; uni.showToast({ title: '已儲存', icon: 'none' }) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = false }
}
// 這一版的雙方簽名相片
async function loadSigns() {
  for (const p of signParties) { signImages.value[p.key] = ''; if (r.value.agreement[p.key + 'Signed']) privateImage('/my/rentals/' + rentalId + '/signature-' + p.key).then(src => { signImages.value[p.key] = src }).catch(() => {}) }
}
// 要簽名時連同簽名相片發出；不用簽名（協議沒改、這一版已簽）就直接重發連結
async function send() {
  if (!needSign.value) return deliver(null)
  if (pad.value?.isEmpty()) return uni.showToast({ title: '請先在框內簽名', icon: 'none' })
  try { deliver(await pad.value.toDataURL()) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
}
async function deliver(signature) {
  busy.value = true
  try {
    if (draft.value !== r.value.agreement.body) await api('/my/rentals/' + rentalId + '/agreement', 'PUT', { body: draft.value })
    const result = await api('/my/rentals/' + rentalId + '/send', 'POST', signature ? { signature } : {})
    link.value = result.link; r.value = result; draft.value = result.agreement.body; loadSigns()
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = false }
}
function whatsapp() { openLink('https://wa.me/?text=' + encodeURIComponent(`${r.value.renter.name} 你好，這是 ${r.value.plateLabel} 的出租協議，請打開連結核對並確認（要輸入你電話最後 4 位）：${link.value.url}`)) }
function reportDone(p) { uni.navigateTo({ url: '/pages/self-change/self-change?plate=' + r.value.plateId + '&kind=' + (p.kind === 'vehicle' ? 'vehicle_change' : 'driver_change') + (p.kind === 'vehicle' ? '&newPlate=' + encodeURIComponent(r.value.renter.vehiclePlate) : '') }) }
async function uploadSigned(kind) {
  try {
    const files = kind === 'pdf' ? await pickPdf() : await pickPhotos()
    if (!files.length) return
    if (files[0].size > 8 * 1024 * 1024) return uni.showToast({ title: '檔案須小於 8 MB', icon: 'none' })
    busy.value = true
    r.value = await api('/my/rentals/' + rentalId + '/signed', 'POST', { data: await readBase64(files[0].path) })
    uni.showToast({ title: '已上傳', icon: 'none' })
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = false }
}
async function viewSigned() {
  try { const src = await privateImage('/my/rentals/' + rentalId + '/signed'); if (src.startsWith('data:application/pdf')) openLink(src); else uni.previewImage({ urls: [src] }) } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
}
async function cancel() {
  if (await confirmBox.ask({ title: '取消這次出租？', msg: forMode('已發出的連結會作廢；已開的換車、換司機工單，顧問會聯絡你。', '已發出的連結會作廢；已開的換車、換司機工單，我們會聯絡你。'), ok: '取消出租', cancel: '不取消', danger: true }) !== 'confirm') return
  busy.value = true
  try { r.value = await api('/my/rentals/' + rentalId + '/cancel', 'POST', {}); link.value = null } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = false }
}
onShow(load)
</script>
<style scoped>
.head{margin-bottom:16px}.head .row{gap:12px}
.step-title{display:block;margin-bottom:4px;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep)}
.next-kicker{display:block;margin-bottom:4px;color:var(--ink-3);font-size:var(--fs-meta);font-weight:700}
.line-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.proc{padding:12px 0;border-bottom:1px solid var(--rule);gap:12px}.proc:last-child{border-bottom:0;padding-bottom:0}
.agreement{width:100%;min-height:240px;margin-top:12px;line-height:1.6;box-sizing:border-box}
.actions{display:flex;gap:8px;margin-top:12px}.actions .btn-sm{flex:1}
.confirmed{margin-bottom:8px}
.link-box{margin-top:16px;padding:12px;border-radius:var(--r-card);background:var(--paper)}
.link-text{display:block;margin-top:8px;font-size:var(--fs-meta);word-break:break-all;color:var(--ink)}
.view-signed{display:block;margin-top:12px}
.fee-row{padding:4px 0;font-size:var(--fs-body);color:var(--ink-2)}
.cancel{width:100%;margin-top:8px}
.sign-box{margin-top:16px}.sign-box .field-label{margin-top:0}
.signs{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px}.sign{flex:1;min-width:140px}
.sign-image{display:block;width:100%;max-width:280px;margin:4px 0;border-bottom:1px solid var(--ink-3)}.sign-blank{height:64px;margin:4px 0;border-bottom:1px solid var(--ink-3)}
</style>
