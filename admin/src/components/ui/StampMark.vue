<!-- 本產品新增：印章。完成類操作（已辦好、已收款、已核對）蓋章；play 時播放「放大 → 壓下 → 墨色落定」，減少動態效果時直接終態。 -->
<script setup lang="ts">
withDefaults(defineProps<{ text?: string; tone?: 'ok' | 'jade' | 'danger'; play?: boolean }>(), { text: '已辦好', tone: 'ok', play: false })
</script>
<template><span :class="['stamp-mark', `stamp-${tone}`, { 'is-playing': play }]" role="img" :aria-label="text"><span class="stamp-ring">{{ text }}</span></span></template>
