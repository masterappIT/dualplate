<template>
  <!-- 你的顧問：一鍵致電或複製微信號；沒有設定時不顯示，避免空殼卡片 -->
  <view v-if="advisor && (advisor.name || advisor.phone || advisor.wechat)" class="card advisor">
    <view class="who-row">
      <view class="badge"><text>{{ (advisor.name || '顧').slice(0, 1) }}</text></view>
      <view class="grow">
        <text class="caption">你的顧問</text>
        <text class="name">{{ advisor.name || '顧問' }}</text>
        <text v-if="advisor.phone" class="meta num">{{ advisor.phone }}</text>
        <text v-if="advisor.wechat" class="meta">微信 {{ advisor.wechat }}</text>
      </view>
    </view>
    <view class="actions">
      <button v-if="advisor.phone" class="secondary act" @click="callAdvisor(advisor.phone)">致電</button>
      <button v-if="advisor.wechat" class="secondary act" @click="copyText(advisor.wechat, '微信號已複製')">複製微信號</button>
    </view>
  </view>
</template>
<script setup>
import { callAdvisor, copyText } from '../lib/api'
defineProps({ advisor: { type: Object, default: null } })
</script>
<style scoped>
.advisor{margin-top:18rpx}.who-row{display:flex;align-items:center;gap:20rpx}.grow{flex:1;min-width:0}
.badge{width:76rpx;height:76rpx;flex:none;border-radius:50%;background:var(--jade-deep);border:3rpx solid var(--plate-yellow);display:flex;align-items:center;justify-content:center}
.badge text{color:#fff;font-size:30rpx;font-weight:800}
.caption{display:block;color:var(--jade);font-size:20rpx;font-weight:800;letter-spacing:2rpx}
.name{display:block;font-size:30rpx;font-weight:800;color:var(--ink);margin-top:2rpx}
.meta{display:block;color:var(--ink-2);font-size:22rpx;margin-top:2rpx}
.actions{display:flex;gap:14rpx;margin-top:20rpx}.act{flex:1;margin:0;height:72rpx;line-height:72rpx;font-size:24rpx}
</style>
