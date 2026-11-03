<template>
  <view class="approval-preview">
    <view class="approval-flip-stage" role="button" tabindex="0" :aria-label="tapLabel || (isFlipped ? '批文卡背面，點擊翻到正面' : '批文卡正面，點擊翻到背面')" @click="toggleSide" @keydown.enter.prevent="toggleSide" @keydown.space.prevent="toggleSide">
      <view class="approval-flip-inner" :class="{ 'is-flipped': isFlipped }">
        <view class="approval-face approval-face--front" :aria-hidden="isFlipped">
      <image class="approval-svg" src="/static/approval-card/front.svg" mode="scaleToFill" role="img" aria-label="批文卡正面" />
      <view class="card-layer front-layer">
        <text class="card-title">粤港澳机动车辆往来及驾驶人驾车批准通知书</text>
        <view class="card-row front-row front-number"><text class="card-label">编　　号:</text><text class="card-value number-value">{{ data.cardNumber }}</text></view>
        <view class="card-row front-row front-company"><text class="card-label">商　　号:</text><text class="card-value">{{ data.company }}</text></view>
        <view class="card-row front-row front-contractor"><text class="card-label">内承单位:</text><text class="card-value">{{ data.contractor }}</text></view>
        <view class="card-row front-row front-crossing"><text class="card-label">通行口岸:</text><text class="card-value">{{ data.crossing }}</text></view>
        <view class="card-row front-row front-issuer"><text class="card-label">签发机关:</text><text class="card-label issuer-value">广东省公安厅交通管理局</text><text class="card-value serial-value">{{ data.serial }}</text></view>
      </view>
        </view>
        <view class="approval-face approval-face--back" :aria-hidden="!isFlipped">
      <image class="approval-svg" src="/static/approval-card/back.svg" mode="scaleToFill" role="img" aria-label="批文卡背面" />
      <view class="card-layer back-layer">
        <view class="card-row back-row back-left back-mainland"><text class="card-label">内地车牌号:</text><text class="card-value">{{ data.mainlandPlate }}</text></view>
        <view class="card-row back-row back-left back-local"><text class="card-label">港澳车牌号:</text><text class="card-value">{{ data.localPlate }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-one"><text class="card-label">驾　驶　人:</text><text class="card-label driver-index">1.</text><text class="card-value">{{ data.driver1 }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-two"><text class="driver-spacer"></text><text class="card-label driver-index">2.</text><text class="card-value">{{ data.driver2 }}</text></view>
        <view class="card-row back-row back-left driver-row back-driver-three"><text class="driver-spacer"></text><text class="card-label driver-index">3.</text><text class="card-value">{{ data.driver3 }}</text></view>
        <view class="card-row back-row back-right back-current"><text class="card-label">现批文号:</text><text class="card-value">{{ data.currentApproval }}</text></view>
        <view class="card-row back-row back-right back-previous"><text class="card-label">原批文号:</text><text class="card-value">{{ data.previousApproval }}</text></view>
        <view class="card-row back-row back-right back-color"><text class="card-label">颜　　色:</text><text class="card-value">{{ data.color }}</text></view>
        <view class="card-row back-row back-right back-seats"><text class="card-label">座位/吨位:</text><text class="card-value">{{ data.seats }}</text></view>
        <view class="card-row back-row back-wide back-purpose"><text class="card-label">请予办理:</text><text class="card-value">{{ data.purpose }}</text></view>
        <view class="card-row back-row back-wide back-validity"><text class="card-label">有　效　期:</text><text class="card-value">{{ validity(data.validFrom,data.validTo) }}</text></view>
        <view class="card-row back-row back-wide back-notes"><text class="card-label">备　　注:</text><text class="card-value note-value">{{ data.notes }}</text></view>
        <text class="card-warning">驾驶人仅允许驾驶与本人驾驶证准驾车型相符车辆</text>
      </view>
        </view>
      </view>
    </view>
    <view class="flip-controls" role="group" aria-label="批文卡正反面切換">
      <button class="flip-control" :class="{ active: !isFlipped }" :aria-pressed="!isFlipped" @click="showSide(false)">正面</button>
      <button class="flip-control" :class="{ active: isFlipped }" :aria-pressed="isFlipped" @click="showSide(true)">背面</button>
      <view class="flip-hint">點擊卡面翻轉</view>
    </view>
  </view>
</template>
<script setup>
import { ref,watch } from 'vue'
const props=defineProps({data:{type:Object,required:true},back:{type:Boolean,default:false},flipOnTap:{type:Boolean,default:true},tapLabel:{type:String,default:''}})
const emit=defineEmits(['card-tap','flip'])
const isFlipped=ref(props.back)
watch(()=>props.back,value=>{isFlipped.value=value})
const toggleSide=()=>{if(props.flipOnTap){isFlipped.value=!isFlipped.value;emit('flip',isFlipped.value)}emit('card-tap')}
const showSide=back=>{isFlipped.value=back;emit('flip',back)}
const date=value=>String(value||'').replace(/-/g,'.')
const validity=(a,b)=>a&&b?`${date(a)}–${date(b)}`:date(a||b)
</script>
<style scoped>
.approval-preview{display:grid;gap:12rpx}
.approval-flip-stage{position:relative;width:100%;aspect-ratio:1013/643;perspective:1200px;cursor:pointer;outline-offset:4rpx}
.approval-flip-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .65s cubic-bezier(.22,.67,.22,1)}
.approval-flip-inner.is-flipped{transform:rotateY(180deg)}
.approval-face{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;border-radius:13rpx;box-shadow:0 3rpx 10rpx #1b304030;background:#edf2f1;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.approval-face--back{transform:rotateY(180deg)}
.approval-svg{display:block;width:100%;height:100%}
.flip-controls{display:flex;align-items:center;gap:8rpx}
.flip-control{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:68rpx;height:34rpx;margin:0;padding:0 14rpx;border:1px solid #c4d5cd;border-radius:999rpx;background:#f5f8f6;color:#345146;font-size:13rpx;font-weight:650;cursor:pointer;line-height:1}
.flip-control.active{background:#295a48;border-color:#295a48;color:#fff}
.flip-hint{margin-left:auto;color:#668076;font-size:12rpx}
@media (prefers-reduced-motion: reduce){.approval-flip-inner{transition:none}}
</style>

<style scoped>

.approval-face{container-type:inline-size}
.card-layer{position:absolute;inset:0;font-family:'Songti SC','STSong','Noto Serif CJK SC',serif}
.card-layer text{display:block;line-height:1.12;white-space:nowrap}
.card-title{position:absolute;left:16.4%;top:8.8%;width:79%;overflow:hidden;color:#15191b;font-size:3.65cqw;font-weight:750;letter-spacing:.03cqw;text-align:center}
.card-row{position:absolute;display:flex;align-items:baseline;overflow:hidden;white-space:nowrap;line-height:1.12}
.card-row text{position:static;min-width:0;overflow:hidden;text-overflow:clip}
.card-label{color:#062f69;font-size:2.85cqw;font-weight:650;flex:none;transform:translateY(.2cqw)}
.card-value{color:#252525;font-size:3.3cqw;flex:1}
.front-row{left:4.9%;width:91%;align-items:flex-start}
.front-row .card-label:first-child{flex:0 0 16.9%}
.front-number{top:23.4%;min-height:5cqw}
.front-company{top:34.4%}
.front-contractor{top:59.3%}
.front-crossing{top:76.9%}
.front-issuer{top:87.3%;align-items:baseline}
.front-number .card-label,.front-company .card-label{letter-spacing:.5cqw}
.front-number .card-label{transform:translateY(1.25cqw)}
.front-number .number-value{font-family:Arial,sans-serif;font-size:4.45cqw;font-weight:700;letter-spacing:.5cqw}
.front-company .card-value{font-size:3.15cqw}
.front-contractor .card-value{font-size:3.5cqw}
.front-issuer .card-label{font-size:2.45cqw}
.front-issuer .issuer-value{flex:1;transform:translateY(.2cqw)}
.front-issuer .serial-value{flex:0 0 19%;transform:translateY(.3cqw);font-family:Arial,sans-serif;font-size:3.15cqw;font-weight:700;text-align:right;letter-spacing:.2cqw}
.back-row{font-size:3.2cqw}
.back-left{left:4.2%;width:47%}
.back-left .card-label:first-child,.back-left .driver-spacer{flex:0 0 35.6%}
.back-right{left:54.4%;width:43.5%}
.back-right .card-label:first-child{flex:0 0 30.7%}
.back-color .card-label:first-child,.back-seats .card-label:first-child{flex-basis:34.8%}
.back-wide{left:4.2%;width:93.5%}
.back-wide .card-label:first-child{flex:0 0 18%}
.back-right .card-value{font-size:3.05cqw}
.back-mainland,.back-current{top:7.6%}
.back-local,.back-previous{top:17.2%}
.back-driver-one,.back-color{top:26.8%}
.back-driver-two,.back-seats{top:36.4%}
.back-driver-three{top:46%}
.driver-row .driver-index{flex:0 0 8.6%;font-size:2.85cqw}
.back-purpose{top:53.8%}
.back-validity{top:67.1%}
.back-notes{top:77.1%}
.back-notes .note-value{font-size:3.05cqw;white-space:normal;overflow:hidden;line-height:1.1;max-height:2.2em}
.card-warning{position:absolute;left:18%;top:93.1%;width:74%;font-size:2.05cqw;font-weight:650;color:#07386b;text-align:center;overflow:hidden}
</style>
