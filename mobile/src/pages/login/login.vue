<template>
  <view class="login">
    <!-- 上半：深通行綠畫布，口岸節點網絡＋牌照黃脈衝（交互取自管理者腳手架的節點網絡，外觀為本產品證件感） -->
    <view class="hero guilloche">
      <canvas id="ports" type="2d" class="ports" />
      <view class="hero-text" :style="{ paddingTop: top + 'px' }">
        <view class="brand"><view class="seal"><text>牌</text></view><text class="brand-name">車牌管家</text></view>
        <text class="hero-title">兩地牌、公司與到期事項</text><text class="hero-title second">一處管好。</text>
        <view class="hero-plates"><PlateChip plate="粵Z·A1234港" size="sm" /><PlateChip plate="AB 1234" size="sm" /></view>
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
import PlateChip from '../../components/PlateChip.vue'
import ContactCard from '../../components/ContactCard.vue'
import StampMark from '../../components/StampMark.vue'

const email = ref(''), phone = ref(''), mode = ref('phone'), password = ref(''), binding = ref(false), bindCode = ref(''), loading = ref(false), error = ref(''), shake = ref(false), done = ref(false), application = ref(null)
const top = (uni.getSystemInfoSync().statusBarHeight || 20) + 28
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

// ── 口岸網絡畫布：節點緩慢呼吸，牌照黃脈衝沿連線往返；登入成功時由中心擴散。減少動態效果時只畫靜態一幀。
const PORTS = [['深圳灣', .18, .62], ['蓮塘', .42, .38], ['皇崗', .3, .82], ['沙頭角', .62, .2], ['港珠澳大橋', .72, .7], ['拱北', .88, .48], ['橫琴', .9, .86]]
const LINKS = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [4, 5], [4, 6], [5, 6], [3, 5], [0, 4]]
let reduced = false, ctx = null, width = 0, height = 0, frame = 0, canvas = null, raf = null, burstAt = 0
const pulses = LINKS.map((link, i) => ({ link, t: (i * 0.17) % 1, speed: 0.0025 + (i % 3) * 0.0012, dir: i % 2 ? 1 : -1 }))
function draw() {
  frame++
  ctx.clearRect(0, 0, width, height)
  const pos = PORTS.map(([, x, y], i) => [x * width, (0.44 + y * 0.5) * height + Math.sin(frame / 90 + i) * (reduced ? 0 : 3)])
  ctx.lineWidth = 1
  for (const [a, b] of LINKS) { ctx.strokeStyle = 'rgba(227,239,234,.16)'; ctx.beginPath(); ctx.moveTo(...pos[a]); ctx.lineTo(...pos[b]); ctx.stroke() }
  if (!reduced) for (const p of pulses) {
    p.t += p.speed * p.dir; if (p.t > .85 || p.t < .15) { p.dir *= -1; p.t = Math.min(.85, Math.max(.15, p.t)) }
    const [a, b] = p.link, x = pos[a][0] + (pos[b][0] - pos[a][0]) * p.t, y = pos[a][1] + (pos[b][1] - pos[a][1]) * p.t
    ctx.fillStyle = 'rgba(242,194,48,.22)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#F2C230'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
  }
  PORTS.forEach(([name], i) => {
    const [x, y] = pos[i], breathe = reduced ? 0 : Math.sin(frame / 60 + i * 1.3) * 1.5
    ctx.fillStyle = 'rgba(227,239,234,.12)'; ctx.beginPath(); ctx.arc(x, y, 11 + breathe, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#E3EFEA'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
    // 靠右邊的口岸把名字寫在節點左邊，免得貼邊被切
    const left = x > width * .7
    ctx.fillStyle = 'rgba(227,239,234,.62)'; ctx.font = '12px -apple-system, "PingFang TC", sans-serif'; ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(name, left ? x - 14 : x + 14, y - 10)
  })
  if (burstAt) {
    const k = Math.min(1, (frame - burstAt) / 40), cx = width / 2, cy = height * .7
    ctx.strokeStyle = `rgba(242,194,48,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, k * Math.max(width, height), 0, Math.PI * 2); ctx.stroke()
  }
  if (!reduced) raf = (canvas.requestAnimationFrame || requestAnimationFrame)(draw)
}
function burst() { burstAt = frame || 1 }
onMounted(() => {
  try { reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { reduced = false }
  uni.createSelectorQuery().in(instance.proxy).select('#ports').fields({ node: true, size: true }).exec(([res]) => {
    if (!res?.node) return
    canvas = res.node; width = res.width; height = res.height
    const dpr = Math.min(2, uni.getSystemInfoSync().pixelRatio || 1)
    canvas.width = width * dpr; canvas.height = height * dpr
    ctx = canvas.getContext('2d')
    // H5 的 uni canvas 已自動按像素比縮放繪圖；小程序需要手動縮放
    // #ifndef H5
    ctx.scale(dpr, dpr)
    // #endif
    draw()
  })
})
onBeforeUnmount(() => { if (raf) (canvas?.cancelAnimationFrame || cancelAnimationFrame)(raf) })
</script>
<style scoped>
.login{min-height:100vh;background:var(--paper);display:flex;flex-direction:column}
.hero{position:relative;height:52vh;min-height:320px;background:var(--jade-deep);color:#E3EFEA}
.ports{position:absolute;left:0;top:0;width:100%;height:100%}
.hero-text{position:relative;padding:0 24px;pointer-events:none}
.brand{display:flex;align-items:center;gap:8px}
.seal{width:36px;height:36px;border-radius:50%;border:2px solid var(--plate-yellow);display:flex;align-items:center;justify-content:center}
.seal text{color:var(--plate-yellow);font-size:var(--fs-h);font-weight:900}
.brand-name{font-size:var(--fs-h);font-weight:800;letter-spacing:2px;color:#fff}
.hero-title{display:block;margin-top:20px;font-size:var(--fs-title);font-weight:800;line-height:1.4;color:#fff}.hero-title.second{margin-top:0}
.hero-plates{display:flex;gap:8px;margin-top:16px}
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
@media screen and (min-width:780px){.hero{height:46vh}.sheet{width:560px;margin:-80px auto 0}}
.wechat-button{width:100%;margin-top:12px}.bind{margin-top:8px}.bind-actions{display:flex;gap:8px;margin-top:12px}.bind-actions button{flex:1;margin:0}
</style>
