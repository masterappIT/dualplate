<template>
  <view class="login">
    <!-- 上半：深通行綠畫布，口岸節點網絡＋牌照黃脈衝（交互取自管理者腳手架的節點網絡，外觀為本產品證件感） -->
    <view class="hero guilloche">
      <canvas id="ports" type="2d" class="ports" />
      <view class="hero-text" :style="{ paddingTop: top + 'px' }">
        <view class="brand"><view class="seal"><text>牌</text></view><text class="brand-name">車牌管家</text></view>
        <text class="hero-title">兩地牌、公司與到期事項，一處管好。</text>
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
      <text class="field-label">電郵或手機號碼</text>
      <input class="field" v-model.trim="email" type="text" placeholder="name@example.com 或 +852 9123 4567" :class="{ invalid: error && !email }" />
      <text class="field-label">密碼</text>
      <input class="field" v-model="password" password placeholder="輸入密碼" :class="{ invalid: error && !password }" @confirm="login" />
      <text v-if="error" class="error">{{ error }}</text>
      <button class="primary login-button" :class="{ busy: loading }" :disabled="loading" @click="login">{{ loading ? '登入中' : '登入' }}</button>
      <!-- #ifdef MP-WEIXIN -->
      <button v-if="!binding" class="secondary wechat-button" :disabled="loading" @click="wechatLogin">微信快速登入</button>
      <view v-else class="bind">
        <text class="field-label">首次用微信登入，請輸入顧問給你的 6 位綁定碼</text>
        <input class="field num" v-model.trim="bindCode" type="number" maxlength="6" placeholder="6 位數字" />
        <view class="bind-actions"><button class="secondary" @click="binding=false">取消</button><button class="primary" :disabled="loading" @click="bindWechat">綁定並登入</button></view>
      </view>
      <!-- #endif -->
      <text class="help">帳戶由你的顧問開通。忘記密碼請聯絡顧問。</text>
      <view v-if="done" class="done"><StampMark text="已登入" tone="jade" play /></view>
    </view>
  </view>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import { api, saveSession } from '../../lib/api'
import PlateChip from '../../components/PlateChip.vue'
import StampMark from '../../components/StampMark.vue'

const email = ref(''), password = ref(''), binding = ref(false), bindCode = ref(''), loading = ref(false), error = ref(''), shake = ref(false), done = ref(false)
const top = (uni.getSystemInfoSync().statusBarHeight || 20) + 28
const instance = getCurrentInstance()

async function login() {
  error.value = ''
  if (!email.value || !password.value) return fail('請填寫電郵或手機號碼，以及密碼')
  loading.value = true
  try {
    const result = await api('/login', 'POST', { login: email.value, password: password.value })
    if (result.user.role !== 'customer') throw new Error('此帳號請使用管理端登入')
    enter(result)
  } catch (e) { fail(e.message) } finally { loading.value = false }
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
    p.t += p.speed * p.dir; if (p.t > 1 || p.t < 0) { p.dir *= -1; p.t = Math.min(1, Math.max(0, p.t)) }
    const [a, b] = p.link, x = pos[a][0] + (pos[b][0] - pos[a][0]) * p.t, y = pos[a][1] + (pos[b][1] - pos[a][1]) * p.t
    ctx.fillStyle = 'rgba(242,194,48,.22)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#F2C230'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
  }
  PORTS.forEach(([name], i) => {
    const [x, y] = pos[i], breathe = reduced ? 0 : Math.sin(frame / 60 + i * 1.3) * 1.5
    ctx.fillStyle = 'rgba(227,239,234,.12)'; ctx.beginPath(); ctx.arc(x, y, 11 + breathe, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#E3EFEA'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(227,239,234,.62)'; ctx.font = '11px -apple-system, "PingFang TC", sans-serif'; ctx.fillText(name, x + 8, y - 8)
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
.hero{position:relative;height:56vh;min-height:420rpx;background:var(--jade-deep);color:#E3EFEA}
.ports{position:absolute;left:0;top:0;width:100%;height:100%}
.hero-text{position:relative;padding:0 44rpx;pointer-events:none}
.brand{display:flex;align-items:center;gap:18rpx}
.seal{width:68rpx;height:68rpx;border-radius:50%;border:3rpx solid var(--plate-yellow);display:flex;align-items:center;justify-content:center}
.seal text{color:var(--plate-yellow);font-size:32rpx;font-weight:900}
.brand-name{font-size:34rpx;font-weight:800;letter-spacing:4rpx;color:#fff}
.hero-title{display:block;margin-top:34rpx;font-size:40rpx;font-weight:800;line-height:1.35;color:#fff;max-width:560rpx}
.hero-plates{display:flex;gap:14rpx;margin-top:26rpx}
.sheet{position:relative;margin:-90rpx 28rpx 0;background:var(--card);border-radius:var(--r-panel);border:1rpx solid var(--rule);box-shadow:var(--float);padding:36rpx 32rpx 40rpx}
.sheet-title{display:block;font-size:34rpx;font-weight:800;color:var(--jade-deep)}
.sheet-sub{display:block;margin-top:8rpx;font-size:23rpx;color:var(--ink-2)}
.sheet .ticket-rule{margin:30rpx -32rpx 8rpx}
.sheet .ticket-rule::before{left:-15rpx}.sheet .ticket-rule::after{right:-15rpx}
.invalid{border-color:var(--overdue)}
.error{display:block;margin-top:14rpx;color:var(--overdue);font-size:23rpx;font-weight:700}
.login-button{margin-top:36rpx;transition:width .25s ease,border-radius .25s ease}
.login-button.busy{opacity:.85}
.help{display:block;margin-top:24rpx;text-align:center;color:var(--ink-3);font-size:21rpx}
.done{position:absolute;right:30rpx;top:26rpx}
.shake{animation:shake .38s ease}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-14rpx)}40%{transform:translateX(12rpx)}60%{transform:translateX(-8rpx)}80%{transform:translateX(5rpx)}}
@media (prefers-reduced-motion:reduce){.shake{animation:none}}
@media screen and (min-width:780px){.hero{height:46vh}.sheet{width:560px;margin:-80px auto 0}}
.wechat-button{margin-top:18rpx}.bind{margin-top:10rpx}.bind-actions{display:flex;gap:14rpx;margin-top:18rpx}.bind-actions button{flex:1;margin:0}
</style>
