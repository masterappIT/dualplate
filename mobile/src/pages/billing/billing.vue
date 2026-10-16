<template>
  <view class="page billing">
    <text class="page-title">帳單</text>
    <text class="subtle">年費、代辦費、政府規費和代墊款項。不同幣種分開計算。</text>
    <view class="card due-card guilloche">
      <text class="due-caption">尚未付款</text>
      <view v-if="totals.length" class="due-rows"><view v-for="t in totals" :key="t.currency" class="due-row"><text class="due-currency">{{ t.currency }}</text><text class="due-amount num">{{ money(t.value) }}</text></view></view>
      <text v-else class="due-clear">目前沒有未付款項</text>
    </view>
    <view v-if="toConfirm.length">
      <text class="section-title">請你確認的分期款項</text>
      <view v-for="item in toConfirm" :key="item.id" class="list-card warn-card">
        <view class="row"><text class="list-title">{{ item.description }}</text><text class="num amount">{{ item.currency }} {{ money(item.amount) }}</text></view>
        <text class="list-sub">到期 {{ friendlyDate(item.dueOn) }}。確認金額無誤後，顧問會按此收款。</text>
        <button class="primary confirm" :disabled="busy === item.id" @click="confirm(item)">{{ busy === item.id ? '確認中' : '確認這期金額' }}</button>
      </view>
    </view>
    <view class="chips"><text v-for="f in filters" :key="f.key" class="chip" :class="{ active: filter === f.key }" @click="filter = f.key">{{ f.label }}</text></view>
    <view v-for="item in shown" :key="item.id" class="list-card">
      <view class="row"><text class="list-title">{{ item.description }}</text><text class="num amount">{{ item.currency }} {{ money(item.amount) }}</text></view>
      <view class="row meta"><text class="list-sub">{{ item.kindLabel }}{{ item.dueOn ? ' · 到期 ' + friendlyDate(item.dueOn) : '' }}</text><text class="pill" :class="tone(item)">{{ label(item) }}</text></view>
      <text v-if="item.status === '部分收'" class="list-note note-amber">已付 {{ item.currency }} {{ money(item.paid) }}，尚欠 {{ money(item.outstanding) }}</text>
    </view>
    <view v-if="loaded && !shown.length" class="card empty">{{ filter === 'open' ? '沒有未付款項' : '還沒有帳單記錄' }}</view>
    <text class="tip">付款方式與收據請向你的顧問查詢。</text>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, friendlyDate } from '../../lib/api'
const items = ref([]), outstanding = ref({}), loaded = ref(false), busy = ref(''), filter = ref('open')
const filters = [{ key: 'open', label: '未付' }, { key: 'all', label: '全部' }]
const totals = computed(() => Object.entries(outstanding.value).map(([currency, value]) => ({ currency, value })))
const toConfirm = computed(() => items.value.filter(item => item.needsConfirm))
const shown = computed(() => filter.value === 'open' ? items.value.filter(item => ['未收', '部分收'].includes(item.status)) : items.value)
const money = value => (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const label = item => item.status === '已收' ? '已付款' : item.overdue ? '已逾期' : item.status === '部分收' ? '部分付款' : '待付款'
const tone = item => item.status === '已收' ? 'gray' : item.overdue ? 'red' : 'amber'
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { const result = await api('/my/fees'); items.value = result.items; outstanding.value = result.outstanding } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
async function confirm(item) {
  busy.value = item.id
  try { await api(`/my/fees/${item.id}/confirm`, 'POST'); uni.showToast({ title: '已確認', icon: 'success' }); await load() } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { busy.value = '' }
}
onShow(load)
</script>
<style scoped>
.billing{padding-top:28rpx}.due-card{margin-top:24rpx;background:var(--jade-deep);border-color:var(--jade-deep);color:#E3EFEA}
.due-caption{display:block;font-size:20rpx;letter-spacing:4rpx;color:var(--plate-yellow);font-weight:800}
.due-rows{margin-top:12rpx}.due-row{display:flex;align-items:baseline;gap:16rpx;padding:6rpx 0}.due-currency{font-size:22rpx;font-weight:800;color:rgba(227,239,234,.75);width:70rpx}.due-amount{font-size:44rpx;font-weight:800;color:#fff}
.due-clear{display:block;margin-top:12rpx;font-size:28rpx;font-weight:800;color:#fff}
.amount{flex:none;font-size:25rpx;font-weight:800;color:var(--ink)}.meta{margin-top:4rpx}.confirm{margin-top:18rpx}
.tip{display:block;text-align:center;color:var(--ink-3);font-size:20rpx;padding:24rpx}
</style>
