<template>
  <view class="login">
    <!-- 上半：深通行綠畫布，口岸節點網絡＋牌照黃脈衝（交互取自管理者腳手架的節點網絡，外觀為本產品證件感） -->
    <view class="hero guilloche">
      <!-- #ifdef MP -->
      <canvas id="ports" type="2d" class="ports" />
      <!-- #endif -->
      <!-- H5、App 的畫布由下方 renderjs 在畫面層建立；burstKey 變動時播放登入成功的擴散 -->
      <!-- #ifndef MP -->
      <view id="ports" class="ports" :prop="burstKey" :change:prop="portsView.burst" />
      <!-- #endif -->
      <view class="hero-text" :style="{ paddingTop: top + 'px' }">
        <view class="brand"><view class="seal"><text>牌</text></view><text class="brand-name">車牌管家</text></view>
        <text class="hero-title">兩地牌、公司與到期事項</text><text class="hero-title second">一處管好。</text>
        <!-- 車牌示例：上行粵港、下行粵澳；三種都用仿真車牌（牌照詳情同一套組件），加上立體壓印效果，同一高度 -->
        <view class="hero-plates"><view class="plate-pair"><MainlandPlate plate="粵Z·A123港" :width="mainlandWidth" :text-scale="0.8" relief /><HongKongPlate plate="HK 1234" :width="localWidth" :text-scale="0.8" relief /></view><view class="plate-pair"><MainlandPlate plate="粵Z·A123澳" :width="mainlandWidth" :text-scale="0.8" relief /><MacauPlate plate="MA-12-34" :width="localWidth" :text-scale="0.7" relief /></view></view>
      </view>
    </view>

    <!-- 下半：證件式登入卡 -->
    <view class="sheet" :class="{ shake }">
      <view class="sheet-head">
        <text class="sheet-title">登入客戶帳戶</text>
        <text class="sheet-sub">查看你的牌照、公司和辦理進度</text>
      </view>
      <view class="ticket-rule" />
      <view class="segmented login-mode"><view class="seg" :class="{ on: mode === 'phone' }" @click="mode = 'phone'">手機號碼</view><view class="seg" :class="{ on: mode === 'email' }" @click="mode = 'email'">電郵</view></view>
      <template v-if="mode === 'phone'">
        <text class="field-label">手機號碼</text>
        <view class="phone-row">
          <picker :range="areaCodes" range-key="label" :value="areaIndex" @change="pickArea"><view class="field picker area"><text>{{ areaCodes[areaIndex].label }}</text><text class="chev">›</text></view></picker>
          <input class="field phone" v-model.trim="phone" type="number" :placeholder="areaCodes[areaIndex].hint" :class="{ invalid: error && !phone }" />
        </view>
      </template>
      <template v-else>
        <text class="field-label">電郵</text>
        <input class="field" v-model.trim="email" type="text" placeholder="name@example.com" :class="{ invalid: error && !email }" />
      </template>
      <text class="field-label">密碼</text>
      <input class="field" v-model="password" password placeholder="輸入密碼" :class="{ invalid: error && !password }" @confirm="login" />
      <text v-if="error" class="error">{{ error }}</text>
      <!-- 自行申請仍在審批或未獲批准：只顯示狀態和聯絡方式，不能進入 app -->
      <view v-if="application" class="application">
        <text class="application-title">{{ application.text }}</text>
        <text v-if="application.pending" class="subtle">我們會先聯絡你核實手機號碼。</text>
        <ContactCard public :messages="false" />
      </view>
      <button class="primary login-button" :class="{ busy: loading }" :disabled="loading" @click="login">{{ loading ? '登入中' : '登入' }}</button>
      <!-- #ifdef MP-WEIXIN -->
      <button v-if="!binding" class="secondary wechat-button" :disabled="loading" @click="wechatLogin">微信快速登入</button>
      <view v-else class="bind">
        <text class="field-label">首次用微信登入，請輸入顧問給你的 6 位綁定碼</text>
        <input class="field num" v-model.trim="bindCode" type="number" maxlength="6" placeholder="6 位數字" />
        <view class="bind-actions"><button class="secondary" @click="binding=false">取消</button><button class="primary" :disabled="loading" @click="bindWechat">綁定並登入</button></view>
      </view>
      <!-- #endif -->
      <button class="btn-line signup-button" @click="goSignup">沒有帳戶？申請使用</button>
      <text class="help">托管客戶的帳戶由顧問開通。忘記密碼請聯絡我們。</text>
      <!-- 忘記密碼：列出已設定的 WhatsApp／微信（docs/tasks/self-managed-fixes-plan.md 第 7 步）；都沒有設定時不顯示 -->
      <ContactCard v-if="!application" public :messages="false" title="忘記密碼？" />
      <view class="terms-links"><text class="link" @click="openTerms('terms')">服務條款</text><text class="terms-dot">·</text><text class="link" @click="openTerms('privacy')">私隱聲明</text></view>
      <view v-if="done" class="done"><StampMark text="已登入" tone="jade" play /></view>
    </view>
  </view>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import { api, saveSession } from '../../lib/api'
function openTerms(tab){uni.navigateTo({url:'/pages/terms/terms?tab='+tab})}
function goSignup(){uni.navigateTo({url:'/pages/signup/signup'})}
import MainlandPlate from '../../components/MainlandPlate.vue'
import HongKongPlate from '../../components/HongKongPlate.vue'
import MacauPlate from '../../components/MacauPlate.vue'
import ContactCard from '../../components/ContactCard.vue'
import StampMark from '../../components/StampMark.vue'
import { startPorts } from '../../lib/ports-canvas'

const email = ref(''), phone = ref(''), mode = ref('phone'), password = ref(''), binding = ref(false), bindCode = ref(''), loading = ref(false), error = ref(''), shake = ref(false), done = ref(false), application = ref(null)
const top = (uni.getSystemInfoSync().statusBarHeight || 20) + 28
// 仿真車牌以 rpx 定寬，寬螢幕會跟着放大；換算成固定像素，任何寬度都一樣大。高度都約 34px：內地 440×140 → 107px 寬，港澳 → 159px 寬
const toRpx = value => value * 10000 / uni.upx2px(10000), mainlandWidth = toRpx(107), localWidth = toRpx(159)
const instance = getCurrentInstance()

// 手機登入要選區號：香港、澳門 8 位，內地 1 字頭 11 位；記住上次選的區號
const areaCodes = [{ code: '+852', label: '香港 +852', hint: '8 位手機號碼', pattern: /^\d{8}$/ }, { code: '+853', label: '澳門 +853', hint: '8 位手機號碼', pattern: /^\d{8}$/ }, { code: '+86', label: '內地 +86', hint: '11 位手機號碼', pattern: /^1\d{10}$/ }]
const areaIndex = ref(Math.max(0, areaCodes.findIndex(item => item.code === uni.getStorageSync('loginArea'))))
function pickArea(event) { areaIndex.value = Number(event.detail.value); uni.setStorageSync('loginArea', areaCodes[areaIndex.value].code) }

async function login() {
  error.value = ''; application.value = null
  const area = areaCodes[areaIndex.value], digits = phone.value.replace(/\D/g, '')
  if (mode.value === 'phone' ? !digits || !password.value : !email.value || !password.value) return fail(mode.value === 'phone' ? '請填寫手機號碼和密碼' : '請填寫電郵和密碼')
  if (mode.value === 'phone' && !area.pattern.test(digits)) return fail(`${area.label.split(' ')[0]}手機號碼應為 ${area.hint.replace('手機號碼', '').trim()}`)
  loading.value = true
  try {
    const result = await api('/login', 'POST', { login: mode.value === 'phone' ? `${area.code}${digits}` : email.value, password: password.value })
    if (result.user.role !== 'customer') throw new Error('此帳號請使用管理端登入')
    enter(result)
  } catch (e) {
    if (['SIGNUP_PENDING', 'SIGNUP_REJECTED'].includes(e.data?.code)) application.value = { pending: e.data.code === 'SIGNUP_PENDING', text: e.message }
    else fail(e.message)
  } finally { loading.value = false }
}
function enter(result) {
  saveSession(result)
  done.value = true
  burst()
  setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), reduced ? 0 : 700)
}
// 微信登入：已綁定直接進入；未綁定則請客戶輸入顧問給的綁定碼（每次都要新的微信登入碼）
const wxCode = () => new Promise((resolve, reject) => uni.login({ provider: 'weixin', success: r => resolve(r.code), fail: () => reject(new Error('未能取得微信授權')) }))
async function wechatLogin() {
  error.value = ''; loading.value = true
  try { enter(await api('/wechat/login', 'POST', { code: await wxCode() })) }
  catch (e) { if (e.data?.needsBinding) binding.value = true; else fail(e.status === 503 ? '微信登入暫未開放，請用電郵或手機號碼登入' : e.message) }
  finally { loading.value = false }
}
async function bindWechat() {
  error.value = ''
  if (!/^\d{6}$/.test(bindCode.value)) return fail('請輸入 6 位綁定碼')
  loading.value = true
  try { enter(await api('/wechat/bind', 'POST', { code: await wxCode(), bindCode: bindCode.value })) } catch (e) { fail(e.message) } finally { loading.value = false }
}
function fail(message) { error.value = message; shake.value = false; setTimeout(() => { shake.value = true }, 10) }

// ── 口岸網絡畫布（繪圖見 lib/ports-canvas.js）：H5、App 由 renderjs 在畫面層畫，小程序在這裏取畫布節點畫
let reduced = false, network = null
const burstKey = ref(0)
function burst() { network?.burst(); burstKey.value++ }
onMounted(() => {
  try { reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { reduced = false }
  // #ifdef MP
  uni.createSelectorQuery().in(instance.proxy).select('#ports').fields({ node: true, size: true, rect: true }).select('.hero-plates').boundingClientRect().select('.sheet').boundingClientRect().exec(([res, plates, sheet]) => {
    if (!res?.node) return
    const canvas = res.node, dpr = Math.min(2, uni.getSystemInfoSync().pixelRatio || 1)
    canvas.width = res.width * dpr; canvas.height = res.height * dpr
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr)
    network = startPorts(ctx, res.width, res.height, { reduced, top: plates ? plates.bottom - res.top : undefined, bottom: sheet ? sheet.top - res.top : undefined, raf: f => canvas.requestAnimationFrame(f), caf: h => canvas.cancelAnimationFrame(h) })
  })
  // #endif
})
onBeforeUnmount(() => network?.stop())
</script>
<!-- #ifndef MP -->
<script module="portsView" lang="renderjs">
import { startPorts } from '../../lib/ports-canvas'
// 畫面層：直接用原生畫布，按像素比放大底層像素、座標仍用 CSS 像素。renderjs 的 this 不能存東西，狀態放模組變量。
// 視窗尺寸改變（桌面拉闊縮窄、手機旋轉）時重新量度再畫，否則畫面會被拉扁
let network = null, canvas = null, size = '', onResize = null
function paint() {
  const box = document.getElementById('ports')
  if (!box) return
  const rect = box.getBoundingClientRect(), width = rect.width, height = rect.height, dpr = Math.min(2, window.devicePixelRatio || 1)
  if (!width || !height || size === `${width}x${height}x${dpr}`) return
  size = `${width}x${height}x${dpr}`
  network?.stop()
  if (!canvas) { canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%'; box.appendChild(canvas) }
  canvas.width = width * dpr; canvas.height = height * dpr
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const plates = box.parentNode.querySelector('.hero-plates'), sheet = box.parentNode.parentNode.querySelector('.sheet')
  let reduced = false
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { reduced = false }
  network = startPorts(ctx, width, height, { reduced, top: plates ? plates.getBoundingClientRect().bottom - rect.top : undefined, bottom: sheet ? sheet.getBoundingClientRect().top - rect.top : undefined, raf: f => requestAnimationFrame(f), caf: h => cancelAnimationFrame(h) })
}
export default {
  mounted() { paint(); onResize = () => paint(); window.addEventListener('resize', onResize) },
  beforeUnmount() { window.removeEventListener('resize', onResize); network?.stop(); network = canvas = null; size = '' },
  methods: {
    burst(value) { if (value) network?.burst() }
  }
}
</script>
<!-- #endif -->
<style scoped>
.login{min-height:100vh;background:var(--paper);display:flex;flex-direction:column}
.hero{position:relative;height:calc(52vh + 30px);min-height:350px;background:var(--jade-deep);color:#E3EFEA}
.ports{position:absolute;left:0;top:0;width:100%;height:100%}
.hero-text{position:relative;padding:0 24px;pointer-events:none}
.brand{display:flex;align-items:center;gap:8px}
.seal{width:36px;height:36px;border-radius:50%;border:2px solid var(--plate-yellow);display:flex;align-items:center;justify-content:center}
.seal text{color:var(--plate-yellow);font-size:var(--fs-h);font-weight:900}
.brand-name{font-size:var(--fs-h);font-weight:800;letter-spacing:2px;color:#fff}
.hero-title{display:block;margin-top:20px;font-size:var(--fs-title);font-weight:800;line-height:1.4;color:#fff}.hero-title.second{margin-top:0}
.hero-plates{display:flex;flex-direction:column;gap:8px;margin-top:16px}.plate-pair{display:flex;align-items:center;gap:8px}.plate-pair .mainland-plate,.plate-pair .hk-plate,.plate-pair .mo-plate{flex:none;margin:0}
.sheet{position:relative;margin:-48px 16px 24px;background:var(--card);border-radius:var(--r-panel);border:1px solid var(--rule);box-shadow:var(--float);padding:20px 16px 24px}
.sheet-title{display:block;font-size:var(--fs-title);font-weight:800;color:var(--jade-deep)}
.sheet-sub{display:block;margin-top:4px;font-size:var(--fs-body);color:var(--ink-2)}
.sheet .ticket-rule{margin:16px -16px 4px}
.invalid{border-color:var(--overdue)}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body);font-weight:700}
.login-button{margin-top:20px;transition:width .25s ease,border-radius .25s ease}
.login-button.busy{opacity:.85}
.login-mode{margin-top:16px}
.phone-row{display:flex;gap:8px}.phone-row picker{flex:none}
.area{width:128px;display:flex;align-items:center;justify-content:space-between;gap:4px}
.phone{flex:1;min-width:0;width:auto}
.signup-button{width:100%;margin-top:12px}
.application{margin-top:16px;padding-top:16px;border-top:1px solid var(--rule)}.application-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep);margin-bottom:4px}
.help{display:block;margin-top:16px;text-align:center;color:var(--ink-3);font-size:var(--fs-meta)}
.terms-links{display:flex;justify-content:center;gap:8px;margin-top:12px;font-size:var(--fs-meta)}.terms-links .link{font-size:var(--fs-meta)}.terms-dot{color:var(--ink-3)}
.done{position:absolute;right:16px;top:16px}
.shake{animation:shake .38s ease}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}
@media (prefers-reduced-motion:reduce){.shake{animation:none}}
@media screen and (min-width:780px){.hero{height:calc(46vh + 30px)}.sheet{width:560px;margin:-80px auto 0}}
.wechat-button{width:100%;margin-top:12px}.bind{margin-top:8px}.bind-actions{display:flex;gap:8px;margin-top:12px}.bind-actions button{flex:1;margin:0}
</style>
