<script setup>
// 第一次登入的 4 步導覽（docs/v1-plan.md 第八節「讓人會用」）：可略過；在「設定 → 我的帳號」可重看。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { user } from '../../api'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'

const router = useRouter()
const me = user()
const key = `welcomeGuide:${me?.id || 'anon'}`
const open = ref(false), step = ref(0)
const steps = computed(() => [
  { title: '每天先看「今日工作」', body: '逾期、7 天內要辦、待錄入的到期項目都排在這裡，按緊急程度排序。點「標記完成」或直接填新的到期日，就會從清單消失。', path: '/today', go: '打開今日工作' },
  { title: '客戶與牌照', body: '「客戶」頁看每位委託人的公司組、牌照和委託範圍；「牌照」頁是全部牌照的總表，可以批量填日期、匯入 CSV，或切換全景、口岸星圖。', path: '/customers', go: '打開客戶' },
  { title: '業務工單', body: '客戶要辦續期、換車、換司機時開一張工單。每一步做完就打勾；需要客戶交文件時，客戶會在手機收到通知並直接上傳。', path: '/business', go: '打開業務' },
  ...(me?.role === 'admin'
    ? [{ title: '收費、出租、報帳與月報', body: '代辦費、政府規費和代墊在「收費」；代收租金在「出租與租金」；內地公司每月報帳在「報帳報稅」。每月初在「月報」確認後，客戶就能在手機看到。', path: '/fees', go: '打開收費' }]
    : [{ title: '遇到問題', body: '收費、出租和報帳由管理者處理。忘記密碼或要開新帳號，請聯絡管理者；修改自己的密碼在「設定 → 我的帳號」。', path: '/settings/account', go: '打開我的帳號' }])
])
function finish() { open.value = false }
function go() { const target = steps.value[step.value].path; finish(); router.push(target) }
function replay() { step.value = 0; open.value = true }
// 第一次顯示就記為已看過：每部電腦只自動出現一次，之後可在「我的帳號」重看
onMounted(() => { let seen = null; try { seen = localStorage.getItem(key); if (!seen) localStorage.setItem(key, new Date().toISOString()) } catch { seen = 'unavailable' } if (!seen) open.value = true; window.addEventListener('welcome-guide', replay) })
onBeforeUnmount(() => window.removeEventListener('welcome-guide', replay))
</script>

<template>
  <Modal :open="open" :title="steps[step].title" :sub="`第 ${step + 1} / ${steps.length} 步 · 歡迎使用車牌管家`" :width="520" @close="finish">
    <p class="guide-body">{{ steps[step].body }}</p>
    <div class="guide-dots" aria-hidden="true"><span v-for="(item, index) in steps" :key="index" :class="{ active: index === step }" /></div>
    <template #footer>
      <Button variant="text" @click="finish">略過</Button>
      <Button @click="go">{{ steps[step].go }}</Button>
      <Button v-if="step < steps.length - 1" variant="primary" @click="step++">下一步</Button>
      <Button v-else variant="primary" @click="finish">開始使用</Button>
    </template>
  </Modal>
</template>
