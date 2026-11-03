<template>
  <!-- 車牌徽章：縮小版仿真車牌，凡顯示車牌處都用它（docs/design-system.md 第二節）。 -->
  <view class="plate-chip" :class="[kind, size]" :aria-label="label + ' ' + shown"><text class="num">{{ shown }}</text></view>
</template>
<script setup>
import { computed } from 'vue'
// kind 自動判斷：內地（省份簡稱開頭，如「粵Z」）黑底白字、白色內框；香港（1–2 個英文字母＋數字，或自訂字串）黃底黑字；
// 澳門（M 開頭加數字分段，或「AA-12-34」這種連字號分段）黑底白字、無內框；判斷不了用中性框。
// 顏色和質感取自 MainlandPlate.vue、HongKongPlate.vue 的實物車牌，澳門牌照實物同樣是黑底白字。
const props = defineProps({ plate: { type: String, default: '' }, region: { type: String, default: '' }, size: { type: String, default: 'md' } })
const raw = computed(() => String(props.plate || '').trim() || '待補充')
const kind = computed(() => {
  if (props.region) return { 內地: 'mainland', 香港: 'hk', 澳門: 'mo' }[props.region] || 'unknown'
  const text = raw.value.toUpperCase()
  if (/^[一-龥]/.test(text)) return 'mainland'
  if (/^M[A-Z]?[-\s]?\d{2}[-\s]?\d{2}$/.test(text) || /^[A-Z]{2}\s*-\s*\d{2}\s*-\s*\d{2}$/.test(text)) return 'mo'
  if (/^[A-Z0-9 ]{1,8}$/.test(text) && text !== '待補充') return 'hk'
  return 'unknown'
})
// 澳門車牌統一寫成實物的「MA-12-34」；其他照原樣
const shown = computed(() => kind.value === 'mo' ? raw.value.toUpperCase().replace(/[\s-]/g, '').replace(/^([A-Z]{1,2})(\d{2})(\d{2})$/, '$1-$2-$3') : raw.value)
const label = computed(() => ({ mainland: '內地車牌', hk: '香港車牌', mo: '澳門車牌', unknown: '車牌' })[kind.value])
</script>
<style scoped>
.plate-chip{display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:3px;padding:2px 9px;font-family:Arial,'Helvetica Neue','PingFang TC',sans-serif;font-weight:700;line-height:1.3;white-space:nowrap}
.plate-chip text{letter-spacing:.04em;line-height:1.4;font-variant-numeric:tabular-nums}
.md{font-size:var(--fs-body)}.sm{font-size:var(--fs-cap);padding:2px 7px}.lg{font-size:var(--fs-h);padding:4px 12px}
/* 內地：黑色烤漆、離邊一點的白色內框 */
.mainland{background:linear-gradient(180deg,#2a2a2a 0%,#0b0b0b 50%,#161616 100%);color:#f5f5f5;box-shadow:inset 0 0 0 1px #0b0b0b,inset 0 0 0 2px #f2f2f2}
/* 香港：反光黃底、深色細邊 */
.hk{background:linear-gradient(180deg,#ffd83a 0%,#f6c400 55%,#eab900 100%);color:#111;box-shadow:inset 0 0 0 1px rgba(60,45,0,.55)}
/* 澳門：黑底白字、沒有內框；淡淡的邊讓它在深色背景上仍看得出輪廓 */
.mo{background:linear-gradient(180deg,#2a2a2a 0%,#0b0b0b 50%,#161616 100%);color:#f5f5f5;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.unknown{background:var(--muted-bg);color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--rule)}
</style>
