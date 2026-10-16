<template>
  <!-- 印章：雙線圓章，完成類狀態用。play 為 true 時播「蓋章」動效：放大 → 壓下 → 墨色落定。 -->
  <view class="stamp" :class="[tone, { play }]" :aria-label="text"><view class="ring"><text>{{ text }}</text></view></view>
</template>
<script setup>
defineProps({ text: { type: String, default: '已辦好' }, tone: { type: String, default: 'ok' }, play: { type: Boolean, default: false } })
</script>
<style scoped>
.stamp{display:inline-flex;width:56px;height:56px;border-radius:50%;padding:3px;border:2px solid currentColor;transform:rotate(-12deg);opacity:.88}
.ring{flex:1;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid currentColor}
.ring text{font-size:var(--fs-cap);font-weight:900;letter-spacing:1px}
.ok{color:var(--ok)}.jade{color:var(--jade)}.overdue{color:var(--overdue)}
.play{animation:stamp .52s cubic-bezier(.2,.9,.25,1.2) both}
@keyframes stamp{0%{transform:rotate(-12deg) scale(1.9);opacity:0}55%{transform:rotate(-12deg) scale(.92);opacity:1}75%{transform:rotate(-12deg) scale(1.04)}100%{transform:rotate(-12deg) scale(1);opacity:.88}}
@media (prefers-reduced-motion:reduce){.play{animation:none}}
</style>
