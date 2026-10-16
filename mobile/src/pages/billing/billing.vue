<template>
  <view class="page billing">
    <text class="intro">年費、代辦費、政府規費和代墊款項。不同幣種分開計算。</text>
    <view class="card deep guilloche due-card">
      <text class="kicker">尚未付款</text>
      <view v-if="totals.length" class="due-rows"><text v-for="t in totals" :key="t.currency" class="due-amount num">{{ money(t.currency, t.value) }}</text></view>
      <text v-else class="due-clear">目前沒有未付款項</text>
    </view>
    <view v-if="toConfirm.length">
      <view class="section-head"><text class="section-title">請你確認的分期款項</text></view>
      <view v-for="item in toConfirm" :key="item.id" class="list-card warn-card">
        <view class="row"><text class="list-title grow">{{ item.description }}</text><text class="num amount">{{ money(item.currency, item.amount) }}</text></view>
        <text class="list-sub">到期 <text class="num">{{ friendlyDate(item.dueOn) }}</text>。確認金額無誤後，顧問會按此收款。</text>
        <button class="btn-sm confirm" :disabled="busy === item.id" @click="confirm(item)">{{ busy === item.id ? '確認中' : '確認金額' }}</button>
      </view>
    </view>
    <view class="section-head"><text class="section-title">款項</text><view class="segmented inline"><text v-for="f in filters" :key="f.key" class="seg" :class="{ on: filter === f.key }" @click="filter = f.key">{{ f.label }}</text></view></view>
    <view v-if="shown.length" class="card list">
      <view v-for="item in shown" :key="item.id" class="line">
        <view class="row"><text class="line-title grow">{{ item.description }}</text><text class="num amount">{{ money(item.currency, item.amount) }}</text></view>
        <view class="row meta"><text class="line-sub">{{ item.kindLabel }}{{ item.dueOn ? ' · 到期 ' + friendlyDate(item.dueOn) : '' }}</text><text class="pill" :class="tone(item)">{{ label(item) }}</text></view>
        <text v-if="item.status === '部分收'" class="list-note note-amber">已付 {{ money(item.currency, item.paid) }}，尚欠 {{ money(item.currency, item.outstanding) }}</text>
      </view>
    </view>
    <view v-if="loaded && !shown.length" class="card empty">{{ filter === 'open' ? '沒有其他未付款項' : '還沒有帳單記錄' }}</view>
    <text class="subtle tip">付款方式與收據請向你的顧問查詢。</text>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, friendlyDate, money } from '../../lib/api'
const items = ref([]), outstanding = ref({}), loaded = ref(false), busy = ref(''), filter = ref('open')
const filters = [{ key: 'open', label: '未付' }, { key: 'all', label: '全部' }]
const totals = computed(() => Object.entries(outstanding.value).map(([currency, value]) => ({ currency, value })))
const toConfirm = computed(() => items.value.filter(item => item.needsConfirm).sort((a, b) => String(a.dueOn || '').localeCompare(String(b.dueOn || ''))))
// 「請你確認」的分期已在上方列出，未付清單不再重複
const shown = computed(() => filter.value === 'open' ? items.value.filter(item => ['未收', '部分收'].includes(item.status) && !item.needsConfirm) : items.value)
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
.due-rows{margin-top:4px}.due-amount{display:block;font-size:var(--fs-stat);font-weight:800;line-height:1.3;color:#fff}
.due-clear{display:block;margin-top:4px;font-size:var(--fs-h);font-weight:800;color:#fff}
.amount{flex:none;font-size:var(--fs-h);font-weight:800;color:var(--ink)}
.confirm{margin-top:12px;align-self:flex-start;display:inline-flex}
.list{padding:4px 16px}
.line{padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.line-sub{font-size:var(--fs-meta);color:var(--ink-2)}
.meta{margin-top:4px}
.tip{text-align:center;padding:16px 0}
</style>
