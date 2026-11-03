<template>
  <!-- App 版第一頁。第一幀與 ios/app/HBuilder-Hello/LaunchScreen.storyboard 同一張圖、同一位置，原生啟動畫面關掉時看不出切換；
       之後換上 Figma 1616:666 的分層（static/launch/，原圖匯出，M 只等比縮放；只要兩塊車牌，不要圖示的方塊外框）播「雙牌合位」：
       黃色香港牌與黑色內地牌分開再彈回合上，螺絲一閃；等候時反光掃過兩塊玻璃牌。 -->
  <view class="launch">
    <view class="mark" :class="{ leave }" :style="{ top: top + 'px' }">
      <image class="logo" :class="{ off: ready }" src="/static/launch-logo.png" @load="shown" @error="shown" />
      <view class="stage" :class="{ on: ready, play: ready }">
        <view class="art">
          <view class="plate yellow">
            <image class="layer yellow-plate" src="/static/launch/yellow.svg" @load="loaded" @error="failed" />
            <image class="layer frame" src="/static/launch/frame.svg" @load="loaded" @error="failed" />
            <image class="layer screw left" src="/static/launch/screw.svg" @load="loaded" @error="failed" />
            <image class="layer screw right" src="/static/launch/screw.svg" @load="loaded" @error="failed" />
            <view class="shine yellow-shine"><view class="band" /></view>
          </view>
          <view class="plate black">
            <view class="glass" />
            <image class="layer black-plate" src="/static/launch/black.svg" @load="loaded" @error="failed" />
            <view class="shine black-shine"><view class="band" /></view>
            <image class="layer m" src="/static/launch/m.svg" @load="loaded" @error="failed" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { prefetchHome } from '../../lib/launch'
// 圖示畫布 180px，置於整個螢幕正中（與 storyboard 的 centerY 一致，不按安全區）
const top = ref(uni.getWindowInfo().screenHeight / 2 - 90)
const ready = ref(false), leave = ref(false)
// 至少停留 2 秒（管理者要求加長），合位動畫和第一道反光播完才離開；資料慢就繼續反光等資料
const MIN_SHOW = 2000, FADE = 220, LAYERS = 6
let closed = false, next = null, start = 0, count = 0, broken = false
function closeSplash() {
  if (closed) return
  closed = true
  // #ifdef APP-PLUS
  plus.navigator.closeSplashscreen()
  // #endif
  play()
  go()
}
function shown() { setTimeout(closeSplash, 16) }
// 分層全部載入才換上；有一層載入失敗就保留靜態圖示，不播動畫
function loaded() { count++; play() }
function failed() { broken = true }
function play() { if (closed && !broken && count >= LAYERS) ready.value = true }
function go() {
  if (!closed || !next) return
  setTimeout(() => {
    leave.value = true
    setTimeout(() => uni.reLaunch({ url: next }), FADE)
  }, Math.max(0, start + MIN_SHOW - FADE - Date.now()))
}
onLoad(() => {
  start = Date.now()
  setTimeout(closeSplash, 800) // 圖片事件萬一沒有觸發，也不讓啟動畫面卡住
  prefetchHome().then(url => { next = url; go() })
})
</script>
<style scoped>
.launch{position:fixed;left:0;right:0;top:0;bottom:0;background:var(--jade-deep)}
.mark{position:absolute;left:50%;width:180px;height:180px;margin-left:-90px;transition:opacity .22s ease-in,transform .22s ease-in}
.mark.leave{opacity:0;transform:scale(.94)}
.logo{display:block;width:180px;height:180px}
.logo.off{opacity:0}
.stage{position:absolute;left:0;top:0;width:180px;height:180px;opacity:0}
.stage.on{opacity:1}
/* 以 Figma 的 1024 座標排版，再整體縮到 180px */
.art{position:absolute;left:0;top:0;width:1024px;height:1024px;transform:scale(.17578125);transform-origin:0 0}
.layer{position:absolute;display:block}
.plate{position:absolute;left:0;top:0;width:1024px;height:1024px}
.yellow-plate{left:194px;top:88px;width:796px;height:456px}
.frame{left:272px;top:136px;width:640px;height:302px}
.screw{top:225px;width:48px;height:48px}
.screw.left{left:316px}
.screw.right{left:820px}
/* 煙灰玻璃：Figma 的背景模糊（64）在這裏做，牌移動時透出的黃牌也跟着模糊 */
.glass{position:absolute;left:112px;top:372px;width:800px;height:520px;border-radius:128px;-webkit-backdrop-filter:blur(32px);backdrop-filter:blur(32px)}
.black-plate{left:54px;top:344px;width:916px;height:636px}
.m{left:252px;top:434.4px;width:520px;height:396px}
/* 反光：裁在牌面之內，兩塊牌用同一條斜帶（以整個圖示的座標移動），看來是一道光掃過 */
.shine{position:absolute;overflow:hidden}
.yellow-shine{left:252px;top:116px;width:680px;height:340px;border-radius:88px}
.black-shine{left:112px;top:372px;width:800px;height:520px;border-radius:128px}
.band{position:absolute;top:-200px;width:180px;height:1400px;left:-480px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.34) 50%,rgba(255,255,255,0));opacity:0}
.yellow-shine .band{margin-left:-252px;margin-top:-116px}
.black-shine .band{margin-left:-112px;margin-top:-372px}

/* 時間（毫秒）：0–120 靜止；120–440 兩牌分開；440–1000 彈回合上；約 880 合上一刻螺絲一閃、圖示輕壓；1100 起反光，之後每 1.6 秒一次 */
.play .yellow{animation:yellow-move 1s both}
.play .black{animation:black-move 1s both}
.stage.play{animation:settle .26s ease-out .84s both}
.play .screw{animation:glint .36s ease-out .88s both}
.play .band{animation:sweep 1.6s ease-in-out 1.1s infinite}
@keyframes yellow-move{
  0%,12%{transform:translate(0,0);animation-timing-function:cubic-bezier(.2,.8,.3,1)}
  44%{transform:translate(64px,-48px);animation-timing-function:cubic-bezier(.34,1.56,.64,1)}
  100%{transform:translate(0,0)}
}
@keyframes black-move{
  0%,12%{transform:translate(0,0);animation-timing-function:cubic-bezier(.2,.8,.3,1)}
  44%{transform:translate(-64px,48px);animation-timing-function:cubic-bezier(.34,1.56,.64,1)}
  100%{transform:translate(0,0)}
}
@keyframes settle{0%,100%{transform:scale(1)}40%{transform:scale(.975)}}
@keyframes glint{0%,100%{filter:brightness(1)}35%{filter:brightness(1.9)}}
@keyframes sweep{
  0%{opacity:1;transform:translateX(0) rotate(20deg)}
  44%{opacity:1;transform:translateX(1500px) rotate(20deg)}
  45%,100%{opacity:0;transform:translateX(1500px) rotate(20deg)}
}
@media (prefers-reduced-motion:reduce){
  .play .yellow,.play .black,.stage.play,.play .screw,.play .band{animation:none}
  .mark{transition:none}
}
</style>
