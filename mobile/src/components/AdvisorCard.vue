<template>
  <!-- 你的顧問：一鍵致電或複製微信號；沒有設定時首頁不顯示，「我的」頁顯示整理中 -->
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
      <button v-if="advisor.phone" class="btn-sm act" @click="callAdvisor(advisor.phone)">致電</button>
      <button v-if="advisor.wechat" class="btn-sm act" @click="copyText(advisor.wechat, '微信號已複製')">複製微信號</button>
    </view>
  </view>
  <view v-else-if="placeholder" class="card advisor empty-advisor"><text class="caption">你的顧問</text><text class="meta">顧問資料整理中，稍後會在這裡顯示聯絡方式。</text></view>
</template>
<script setup>
import { callAdvisor, copyText } from '../lib/api'
defineProps({ advisor: { type: Object, default: null }, placeholder: Boolean })
</script>
<style scoped>
.advisor{margin-top:12px}.who-row{display:flex;align-items:center;gap:12px}.grow{flex:1;min-width:0}
.badge{width:44px;height:44px;flex:none;border-radius:50%;background:var(--jade-deep);border:2px solid var(--plate-yellow);display:flex;align-items:center;justify-content:center}
.badge text{color:#fff;font-size:var(--fs-h);font-weight:800}
.caption{display:block;color:var(--ink-3);font-size:var(--fs-cap);font-weight:700}
.name{display:block;font-size:var(--fs-h);font-weight:800;color:var(--ink);line-height:1.4}
.meta{display:block;color:var(--ink-2);font-size:var(--fs-body);line-height:1.5}
.actions{display:flex;gap:8px;margin-top:16px}.act{flex:1;width:auto}
</style>
