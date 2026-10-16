<!-- 移植自 scaffold-vue/src/views/Login.vue，已改：產品文案、實心深綠材質、管理端登入及健康檢查。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminStore } from '../store'
import NeuralNet from '../components/NeuralNet.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Checkbox from '../components/ui/Checkbox.vue'
import { EASE, afterTwoFrames, gsap, motionSkipped, prefersReducedMotion } from '../composables/motion'

const { loginForm, login, loggingIn, error } = useAdminStore()
const route = useRoute()
const router = useRouter()
const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const remember = ref(true)
const succeeded = ref(false)
const netBurst = ref(0)
const errors = ref({ username: '', password: '' })
const now = ref(new Date())
const health = ref<{ ok: boolean; latency: number | null; checked?: boolean }>({ ok: false, latency: null })
const capabilities = [
  { title: '到期提醒', description: '按狀態處理待辦日期' },
  { title: '工單辦理', description: '跟進每一步的進度' },
  { title: '出租收租', description: '統一管理出租記錄' },
  { title: '客戶端同步', description: '客戶資訊一處更新' },
]
let timer = 0
let tiltX: ((value: number) => void) | null = null
let tiltY: ((value: number) => void) | null = null
let intro: gsap.core.Timeline | null = null
const fastForward = () => intro?.timeScale(6)

async function probeHealth() {
  const start = performance.now()
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100'}/api/health`)
    const result = await response.json()
    health.value = { ok: response.ok && result.ok === true, latency: Math.round(performance.now() - start), checked: true }
  } catch { health.value = { ok: false, latency: null, checked: true } }
}

function onTilt(event: PointerEvent) {
  if (!card.value || !tiltX || !tiltY || motionSkipped()) return
  const bounds = card.value.getBoundingClientRect()
  tiltY(Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1)) * 4)
  tiltX(Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1)) * -3)
}
function resetTilt() { tiltX?.(0); tiltY?.(0) }

async function playSuccess() {
  succeeded.value = true
  netBurst.value += 1
  await nextTick()
  const orb = card.value?.querySelector<HTMLElement>('.success-orb')
  if (!orb || motionSkipped()) return
  await new Promise<void>(resolve => {
    const timeline = gsap.timeline({ onComplete: resolve })
    timeline.fromTo(orb, { width: orb.parentElement!.clientWidth }, { width: 46, duration: 0.42, ease: EASE.swap })
    timeline.fromTo(orb.querySelector('circle'), { strokeDashoffset: 126 }, { strokeDashoffset: 0, duration: 0.5, ease: EASE.reveal }, '-=0.08')
    timeline.fromTo(orb.querySelector('path'), { strokeDashoffset: 24 }, { strokeDashoffset: 0, duration: 0.32, ease: EASE.settle }, '-=0.22')
    timeline.to(orb, { scale: 1.06, duration: 0.16 }).to(orb, { scale: 1, duration: 0.3, ease: EASE.settle })
  })
}

async function submit() {
  error.value = ''
  errors.value = { username: loginForm.value.username.trim() ? '' : '請輸入管理員帳號', password: loginForm.value.password ? '' : '請輸入密碼' }
  if (errors.value.username || errors.value.password) return
  const success = await login({ remember: remember.value, onAuthenticated: playSuccess })
  if (success) await router.replace(String(route.query.redirect || '/today'))
  if (!success) {
    succeeded.value = false
    if (!motionSkipped() && card.value) gsap.fromTo(card.value, { x: -7 }, { x: 0, duration: 0.42, ease: 'elastic.out(1, 0.2)' })
  }
}

function playIntro() {
  const element = root.value
  if (!element) return
  if (prefersReducedMotion() || document.hidden) { element.classList.add('is-entrance-ready'); return }
  const query = (selector: string) => element.querySelectorAll(selector)
  intro = gsap.timeline({ paused: true, onComplete: () => { intro = null } })
  intro.set(['.login-brand', '.hero-line', '.cap-item', '.login-card', '.login-plate'].flatMap(selector => [...query(selector)]), { opacity: 0, y: 16 })
  intro.add(() => element.classList.add('is-entrance-ready'))
  intro.to(query('.login-brand'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal }, 0)
  intro.to(query('.hero-line'), { opacity: 1, y: 0, duration: 0.9, ease: EASE.reveal, stagger: 0.08 }, 0.12)
  intro.to(query('.cap-item'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal, stagger: { each: 0.06, from: 'start' } }, 0.36)
  intro.to(query('.login-plate'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal, stagger: 0.08 }, 0.5)
  intro.to(query('.login-card'), { opacity: 1, y: 0, duration: 0.8, ease: EASE.glide }, 0.22)
  afterTwoFrames(() => intro?.play(0))
}
function onVisibility() { if (document.hidden && intro) intro.progress(1, false) }
onMounted(() => {
  probeHealth()
  timer = window.setInterval(() => { if (!document.hidden) now.value = new Date() }, 1000)
  if (card.value && window.matchMedia('(hover: hover)').matches) {
    tiltX = gsap.quickTo(card.value, 'rotationX', { duration: 0.6, ease: 'power3.out' })
    tiltY = gsap.quickTo(card.value, 'rotationY', { duration: 0.6, ease: 'power3.out' })
  }
  playIntro()
  window.addEventListener('pointerdown', fastForward, { once: true })
  window.addEventListener('keydown', fastForward, { once: true })
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.removeEventListener('pointerdown', fastForward)
  window.removeEventListener('keydown', fastForward)
  document.removeEventListener('visibilitychange', onVisibility)
  intro?.kill()
})
</script>

<template>
  <div ref="root" class="login">
    <section class="login-canvas" aria-label="車牌管家介紹">
      <div class="canvas-grid" aria-hidden="true" />
      <NeuralNet :burst-key="netBurst" />
      <div class="login-brand"><span class="brand-mark">牌</span><div><strong>車牌管家</strong><small>管理端</small></div></div>
      <div class="canvas-main">
        <div class="canvas-copy">
          <h1 class="login-title hero-line">車牌管家</h1>
          <p class="login-lead hero-line">兩地牌、公司與到期事項，一處管好。</p>
        </div>
      </div>
      <div class="canvas-plates">
        <!-- 伺服器連不上時才提示，正常時不顯示技術資訊 --><div v-if="health.checked && !health.ok" class="login-plate is-health"><span :class="['health-dot', { 'is-ok': health.ok }]" /><b>暫時連不上伺服器，請稍後再試</b></div>
        <ul class="login-plate cap-list"><li v-for="capability in capabilities" :key="capability.title" class="cap-item"><strong>{{ capability.title }}</strong><small>{{ capability.description }}</small></li></ul>
      </div>
    </section>
    <section class="login-side" @pointermove="onTilt" @pointerleave="resetTilt">
      <div ref="card" class="login-card" role="region" aria-labelledby="login-heading">
        <div class="login-card-inner"><h2 id="login-heading">管理員登入</h2><p>使用管理員帳號登入車牌管家</p>
          <form class="login-form" novalidate @submit.prevent="submit">
            <Field label="管理員帳號" :error="errors.username"><TextInput v-model="loginForm.username" autocomplete="username" placeholder="輸入管理員帳號" :invalid="!!errors.username" /></Field>
            <Field label="密碼" :error="errors.password || error"><TextInput v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="輸入密碼" :invalid="!!errors.password || !!error" /></Field>
            <Checkbox v-model="remember" label="記住登入狀態" />
            <div class="login-submit-slot"><Button v-if="!succeeded" type="submit" variant="primary" block :loading="loggingIn">登入管理端</Button><div v-else class="success-orb" role="status" aria-label="登入成功，正在進入"><svg width="30" height="30" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="20" stroke-dasharray="126" /><path d="m15 23.5 5.5 5.5L31.5 18" stroke-dasharray="24" /></svg></div></div>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
