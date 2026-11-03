<template>
  <!-- 只在 App 使用：全螢幕的批文卡對準框（見 components/CardCapture.vue），結果經 eventChannel 交回打開它的頁面 -->
  <view class="page"><CardCapture ref="capture" /></view>
</template>
<script setup>
import { ref, getCurrentInstance } from 'vue'
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app'
import CardCapture from '../../components/CardCapture.vue'
const capture = ref(null), page = getCurrentInstance().proxy
let side = 'front', replied = false, channel = null
// 只回覆一次；用手勢或返回鍵離開也回覆 null（等於取消）
function reply(result) { if (replied) return; replied = true; channel?.emit('done', result) }
onLoad(query => { channel = page.getOpenerEventChannel?.(); side = query.side === 'back' ? 'back' : 'front' })
onReady(async () => { const result = await capture.value.open({ side, here: true }); reply(result); uni.navigateBack() })
onUnload(() => reply(null))
</script>
<style scoped>
.page{position:fixed;inset:0;background:#000}
</style>
