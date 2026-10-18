<script setup>
// 承租方專屬連結（出租第 B 輪）：產生／重發／作廢；連結只在產生時顯示一次。
import { ref, watch } from 'vue'
import { api } from '../../api'
import { confirm } from '../../composables/confirm'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'

const props = defineProps({ contractId: String, renterName: String })
const emit = defineEmits(['saved', 'error'])
const status = ref(null), fresh = ref(null), busy = ref(false)
async function load() { if (!props.contractId) return; try { status.value = await api(`/rental-contracts/${props.contractId}/link`) } catch (cause) { emit('error', cause) } }
watch(() => props.contractId, () => { fresh.value = null; load() }, { immediate: true })
async function issue() {
  if (status.value?.active && !await confirm({ title: '重發連結', message: '舊連結會立即失效，承租方要用新連結打開。確定重發？', confirmText: '重發' })) return
  busy.value = true
  try { fresh.value = await api(`/rental-contracts/${props.contractId}/link`, 'POST', { expiresInDays: 90 }); await load() } catch (cause) { emit('error', cause) } finally { busy.value = false }
}
async function revoke() {
  if (!await confirm({ title: '作廢連結', message: '作廢後承租方無法再打開，需要時可重發。', confirmText: '作廢', danger: true })) return
  try { await api(`/rental-contracts/${props.contractId}/link`, 'DELETE'); fresh.value = null; await load(); emit('saved', '連結已作廢') } catch (cause) { emit('error', cause) }
}
const shareText = () => `${props.renterName || '你好'}，這是你的出租頁面，可查看出租協議、各期租金並上傳轉帳憑證：\n${fresh.value.url}\n打開時請輸入你登記的電話號碼最後 4 位。連結有效至 ${fresh.value.expiresAt.slice(0, 10)}，請勿轉發。`
async function copy() { try { await navigator.clipboard.writeText(shareText()); emit('saved', '已複製，可直接貼到訊息轉發給承租方') } catch { emit('error', new Error('未能自動複製，請手動選取文字')) } }
</script>

<template>
  <div class="renter-link">
    <div class="renter-link-head"><div><strong>承租方連結</strong><p>承租方不用登入：打開連結、輸入電話最後 4 位，就能看出租協議、租金和上傳轉帳憑證。</p></div>
      <div class="renter-link-actions"><Tag v-if="status" :tone="status.active ? (status.locked ? 'warning' : 'ok') : 'neutral'">{{ status.active ? (status.locked ? '嘗試過多，暫時鎖定' : `有效至 ${status.expiresAt.slice(0, 10)}`) : '未產生' }}</Tag><Button size="sm" :loading="busy" :disabled="status && !status.hasPhone" @click="issue">{{ status?.active ? '重發連結' : '產生連結' }}</Button><Button v-if="status?.active" variant="text" size="sm" @click="revoke">作廢</Button></div></div>
    <p v-if="status && !status.hasPhone" class="hint">請先編輯合約，填寫承租方電話；連結要用電話最後 4 位核對身份。</p>
    <p v-if="status?.acknowledgement" class="hint">承租方已確認閱讀：{{ status.acknowledgement.name }}，{{ status.acknowledgement.at.slice(0, 16).replace('T', ' ') }}</p>
    <div v-if="fresh" class="renter-link-share"><p class="hint">連結只顯示這一次，請現在複製轉發。</p><pre>{{ shareText() }}</pre><Button size="sm" variant="primary" @click="copy">複製轉發文字</Button></div>
  </div>
</template>
