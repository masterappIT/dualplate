<template>
  <!-- 第一次登入的 3 步導覽：每部手機自動出現一次，可略過；「我的」頁可重看 -->
  <view v-if="open" class="guide-mask" @click.self="close">
    <view class="guide-card">
      <text class="guide-step">第 {{ step + 1 }} / {{ steps.length }} 步</text>
      <text class="guide-title">{{ steps[step].title }}</text>
      <text class="guide-body">{{ steps[step].body }}</text>
      <view class="guide-dots"><view v-for="(item, index) in steps" :key="index" class="guide-dot" :class="{ active: index === step }" /></view>
      <view class="guide-actions"><button class="secondary act" @click="close">略過</button><button class="primary act" @click="next">{{ step < steps.length - 1 ? '下一步' : '開始使用' }}</button></view>
    </view>
  </view>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { getUser, isSelfManaged } from '../lib/api'
const props = defineProps({ force: Boolean })
const emit = defineEmits(['closed'])
// 自管客戶（自己管理）看另一套導覽：沒有顧問、全部事項自己辦
const steps = isSelfManaged() ? [
  { title: '首頁一眼看清楚', body: '上方是你名下牌照的狀態：正常、快到期、已逾期。「待辦」列出快到期、要你辦的事，辦好按「已辦好」就會消失。' },
  { title: '拍卡建檔，自動提醒', body: '拍下批文卡就能建立牌照，到期日自動讀出；之後每項到期前都會提醒你。要看全部到期日，按「查看全部到期日」。' },
  { title: '牌照有變動，自己更新', body: '換車、續期、換司機等，在牌照頁按「有變動？」更新，資料即時生效。' }
] : [
  { title: '首頁一眼看清楚', body: '上方是你名下牌照的狀態：正常、快到期、已逾期。「待辦」只列要你動手的事，做完自動消失；沒有就代表不用操心。' },
  { title: '我們負責的不用你管', body: '我們負責的事項會按時跟進，不會出現在待辦；要看全部到期日，按「查看全部到期日」。每個牌照有變動，在牌照頁按「有變動？」。' },
  { title: '要交文件，直接拍照', body: '顧問需要文件時會出現在待辦，按進去拍照或選 PDF 上傳。要聯絡顧問，在「我的」可以直接致電或複製微信號。' }
]
const open = ref(false), step = ref(0)
const key = () => `welcomeGuide:${getUser()?.id || 'anon'}`
onMounted(() => {
  if (props.force) { open.value = true; return }
  try { if (!uni.getStorageSync(key())) { uni.setStorageSync(key(), Date.now()); open.value = true } } catch { open.value = false }
})
function close() { open.value = false; step.value = 0; emit('closed') }
function next() { if (step.value < steps.length - 1) step.value++; else close() }
</script>
<style scoped>
.guide-mask{position:fixed;inset:0;z-index:999;background:rgba(11,59,48,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}
.guide-card{width:100%;max-width:640px;background:var(--card);border-radius:var(--r-panel);padding:20px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:var(--float)}
.guide-step{display:block;color:var(--ink-3);font-size:var(--fs-cap);font-weight:700}
.guide-title{display:block;margin:4px 0 8px;font-size:var(--fs-title);font-weight:800;color:var(--jade-deep)}
.guide-body{display:block;color:var(--ink-2);font-size:var(--fs-body);line-height:1.7}
.guide-dots{display:flex;gap:4px;margin:16px 0}.guide-dot{width:8px;height:8px;border-radius:99px;background:var(--rule)}.guide-dot.active{width:20px;background:var(--jade)}
.guide-actions{display:flex;gap:8px}.act{flex:1;width:auto}
</style>
