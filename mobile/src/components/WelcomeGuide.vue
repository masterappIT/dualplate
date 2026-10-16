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
import { getUser } from '../lib/api'
const props = defineProps({ force: Boolean })
const emit = defineEmits(['closed'])
const steps = [
  { title: '首頁一眼看清楚', body: '上方是你名下牌照的狀態：正常、快到期、已逾期。「需要你處理」列出要你提供資料的事；沒有就代表不用操心。' },
  { title: '快到期會提醒你', body: '「到期提醒」按日期排列。標了「自行辦理」的要你自己辦；其他由我們為你辦理，辦好會通知你（右上角鈴鐺）。' },
  { title: '要交文件，直接拍照', body: '顧問需要文件時，在「辦理進度」按「上傳」拍照或選 PDF。遇到問題，首頁下方可以直接致電或複製顧問的微信號。' }
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
