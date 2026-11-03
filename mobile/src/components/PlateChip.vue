<template>
  <!-- 車牌徽章：縮小版仿真車牌，凡顯示車牌處都用它（docs/design-system.md 第二節）。 -->
  <view class="plate-chip" :class="[kind, size]" :aria-label="label + ' ' + shown"><text class="num"><text v-for="(part, index) in parts" :key="index" :class="part.han ? 'han' : 'latin'">{{ part.text }}</text></text></view>
</template>
<script setup>
import { computed } from 'vue'
// kind 自動判斷：內地（省份簡稱開頭，如「粵Z」）黑底白字、白色內框；香港（1–2 個英文字母＋數字，或自訂字串）黃底黑字；
// 澳門（M 開頭加數字分段，或「AA-12-34」這種連字號分段）黑底白字、無內框；判斷不了用中性框。
// 同一尺寸下香港、澳門車牌一樣寬高；內地車牌照實物比例（440 × 140 mm）高一點、短一點。號碼特別長時才撐寬。顏色和質感取自 MainlandPlate.vue、HongKongPlate.vue 的實物車牌。
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
// 內地牌的漢字（粵、港、澳）比字母數字大一圈，單獨縮小，免得擠滿白框；最小仍是 12px（設計系統不准更小的字）
const parts = computed(() => kind.value === 'mainland' ? (shown.value.match(/[一-龥]+|[^一-龥]+/g) || []).map(text => ({ text, han: /[一-龥]/.test(text) })) : [{ text: shown.value, han: false }])
const label = computed(() => ({ mainland: '內地車牌', hk: '香港車牌', mo: '澳門車牌', unknown: '車牌' })[kind.value])
</script>
<style scoped>
.plate-chip{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;height:26px;min-width:116px;padding:0 10px;border-radius:3px;font-family:Arial,'Helvetica Neue','PingFang TC',sans-serif;font-size:var(--fs-body);font-weight:700;white-space:nowrap;vertical-align:middle}
/* 字距：香港、澳門像實物一樣舒展，內地收緊；右邊抵消最後一個字的字距，保持置中 */
.plate-chip .num{--ls:.04em;letter-spacing:var(--ls);margin-right:calc(var(--ls) * -1);line-height:1;font-variant-numeric:tabular-nums}
/* 內地：字母數字用窄長的車牌字（同 MainlandPlate.vue 的 DIN），放大填滿白框高度；漢字略小、半粗 */
/* 實測：DIN 字母和蘋方漢字字高相同，但漢字低約 .1em、整行偏上約 .17em；用相對位移對齊並置中於白框 */
.mainland .num{--ls:.04em;position:relative;top:.17em}.mainland .han{position:relative;top:-.1em}
.mainland .latin{font-family:'DIN Condensed','Arial Narrow','Roboto Condensed','sans-serif-condensed',Arial,sans-serif;font-size:1.3em;font-weight:700}
.mainland .han{font-family:'PingFang TC','PingFang SC','Heiti TC','Microsoft JhengHei',sans-serif;font-size:.92em;font-weight:600}.sm.mainland .han{font-size:12px}
.hk .num,.mo .num{--ls:.16em}
.sm{height:22px;min-width:104px;padding:0 8px;font-size:var(--fs-cap)}
.lg{height:34px;min-width:140px;padding:0 12px;font-size:var(--fs-h)}
/* 內地牌較高較短，接近實物約 3.1 : 1 */
.mainland{height:30px;min-width:100px;padding:0 8px}.mainland.sm{height:26px;min-width:88px;padding:0 6px}.mainland.lg{height:38px;min-width:124px;padding:0 10px}
/* 內地：黑色烤漆，白色內框離邊 2px，不貼字也不貼邊 */
.mainland{background:linear-gradient(180deg,#2a2a2a 0%,#0b0b0b 50%,#161616 100%);color:#f5f5f5;box-shadow:inset 0 0 0 2px #0b0b0b,inset 0 0 0 3px rgba(255,255,255,.78),0 1px 2px rgba(0,0,0,.25)}
/* 香港：反光黃底、深色細邊 */
.hk{background:linear-gradient(180deg,#ffd83a 0%,#f6c400 55%,#eab900 100%);color:#111;box-shadow:inset 0 0 0 1px rgba(60,45,0,.55),0 1px 2px rgba(0,0,0,.2)}
/* 澳門：黑底白字、沒有內框；銀灰細邊讓它在深色背景上看得出是一塊牌，也和內地牌分開 */
.mo{background:linear-gradient(180deg,#2a2a2a 0%,#0b0b0b 50%,#161616 100%);color:#f5f5f5;box-shadow:inset 0 0 0 1px #9a9a9a,0 1px 2px rgba(0,0,0,.25)}
.unknown{background:var(--muted-bg);color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--rule)}
</style>
