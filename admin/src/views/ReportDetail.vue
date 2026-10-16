<script setup>
// 月報詳情：A4 證件感版面（封面防偽底紋、客戶印章、票根分隔各節），可列印或存 PDF（瀏覽器列印）。
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, user } from '../api'
import Button from '../components/ui/Button.vue'
import Tag from '../components/ui/Tag.vue'
import DueDate from '../components/ui/DueDate.vue'
import StampMark from '../components/ui/StampMark.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const emit = defineEmits(['saved', 'error'])
const route = useRoute(), router = useRouter()
const data = ref(null), error = ref(''), busy = ref(''), justConfirmed = ref(false)
const isAdmin = user()?.role === 'admin'
async function load() {
  error.value = ''
  try { data.value = await api(`/reports/${route.params.id}`) } catch (cause) { error.value = cause.message }
}
watch(() => route.params.id, value => { if (value) { justConfirmed.value = false; load() } }, { immediate: true })
const report = computed(() => data.value?.report)
const money = value => (Math.abs(value || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const entries = map => Object.entries(map || {}).filter(([, value]) => value).map(([currency, value]) => ({ currency, value }))
const monthTitle = period => period ? `${period.slice(0, 4)} 年 ${Number(period.slice(5))} 月` : ''
const statusWord = value => ({ 已收: '已收', 部分收: '部分收', 未收: '未收', 逾期: '未收（已過期）', 待收: '未到期' }[value] || value)
const feeWord = value => ({ 已收: '已付款', 部分收: '部分付款', 未收: '待付款' }[value] || value)
async function act(action) {
  if (busy.value) return
  busy.value = action
  try {
    const result = await api(`/reports/${data.value.id}/${action}`, 'POST')
    if (action === 'correct') { emit('saved', `已產生第 ${result.version} 版草稿`); await router.push(`/reports/${result.id}`); return }
    if (action === 'confirm') { justConfirmed.value = true; emit('saved', '月報已確認，客戶端可以查看') } else emit('saved', '已按最新資料重新計算')
    await load()
  } catch (cause) { emit('error', cause) } finally { busy.value = '' }
}
function print() { window.print() }
</script>

<template>
  <section class="report-page">
    <div class="report-toolbar no-print">
      <button class="back" type="button" @click="router.push('/reports')">← 返回月報</button>
      <div v-if="data" class="report-actions">
        <Tag :tone="data.status === '已確認' ? 'ok' : data.status === '草稿' ? 'warning' : 'neutral'">{{ data.status }}{{ data.version > 1 ? ` · 第 ${data.version} 版` : '' }}</Tag>
        <template v-if="isAdmin && data.status === '草稿'"><Button :loading="busy === 'recalculate'" @click="act('recalculate')">按最新資料重算</Button><Button variant="primary" :loading="busy === 'confirm'" @click="act('confirm')">確認並發給客戶</Button></template>
        <Button v-if="isAdmin && data.status === '已確認'" :loading="busy === 'correct'" @click="act('correct')">產生更正版</Button>
        <Button @click="print">列印／存 PDF</Button>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">未能載入月報：{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <p v-if="data && data.status === '草稿'" class="hint no-print">這是草稿，客戶還看不到。{{ isAdmin ? '核對數字後按「確認並發給客戶」；確認後數字鎖定。' : '由管理者確認後發出。' }}</p>
    <p v-if="data && data.status === '已更正'" class="hint no-print">這一版已被更正版取代，客戶看到的是最新確認的版本。</p>
    <div v-if="data?.versions?.length > 1" class="report-versions no-print"><span>版本：</span><button v-for="v in data.versions" :key="v.id" type="button" :class="{ active: v.id === data.id }" @click="router.push(`/reports/${v.id}`)">第 {{ v.version }} 版 · {{ v.status }}</button></div>

    <article v-if="report" class="report-sheet">
      <header class="report-cover guilloche-panel">
        <div><div class="report-kicker">月報 · {{ data.version > 1 ? '更正版' : '正式版' }}</div><h1>{{ monthTitle(report.period) }}</h1><p>{{ report.customerName }}</p></div>
        <div class="report-seal"><span>{{ (report.customerName || '客').slice(0, 1) }}</span></div>
        <StampMark v-if="data.status === '已確認'" class="report-stamp" text="已確認" tone="jade" :play="justConfirmed" />
      </header>
      <div class="report-rule" />
      <section class="report-net-box">
        <div class="report-label">本月結算</div>
        <div v-for="n in entries(report.net.net)" :key="n.currency" class="report-net-line" :class="n.value < 0 ? 'is-due' : 'is-pay'"><span>{{ n.value < 0 ? '客戶應付' : '應付客戶' }}</span><strong class="num">{{ n.currency }} {{ money(n.value) }}</strong></div>
        <p v-if="!entries(report.net.net).length" class="report-muted">本月沒有需要結算的款項</p>
        <p class="report-muted">應付客戶 ＝ 本月代收的使用費 − 代收服務費 − 未付的收費（含代墊）。不同幣種分開計算，不換算。</p>
        <div class="report-breakdown">
          <div><span>代收使用費</span><b v-for="n in entries(report.net.collected)" :key="n.currency" class="num">{{ n.currency }} {{ money(n.value) }}</b><b v-if="!entries(report.net.collected).length">—</b></div>
          <div><span>代收服務費</span><b v-for="n in entries(report.net.commission)" :key="n.currency" class="num">{{ n.currency }} {{ money(n.value) }}</b><b v-if="!entries(report.net.commission).length">—</b></div>
          <div><span>未付收費</span><b v-for="n in entries(report.net.unpaid)" :key="n.currency" class="num">{{ n.currency }} {{ money(n.value) }}</b><b v-if="!entries(report.net.unpaid).length">—</b></div>
        </div>
      </section>
      <div class="report-rule" />
      <section class="report-section"><h2>一、本月完成的工作 <small>{{ report.completed.length }} 項</small></h2>
        <table v-if="report.completed.length" class="report-table"><thead><tr><th>業務</th><th>牌照</th><th>結案日</th></tr></thead><tbody><tr v-for="(item, index) in report.completed" :key="index"><td>{{ item.service }}</td><td>{{ item.plate || '—' }}</td><td class="num">{{ item.completedOn }}</td></tr></tbody></table>
        <p v-else class="report-muted">本月沒有結案的工單。</p></section>
      <section class="report-section"><h2>二、已逾期及 60 天內到期 <small>{{ report.upcoming.length }} 項</small></h2>
        <table v-if="report.upcoming.length" class="report-table"><thead><tr><th>事項</th><th>對象</th><th>辦理</th><th>到期</th></tr></thead><tbody><tr v-for="(item, index) in report.upcoming" :key="index"><td>{{ item.name }}</td><td>{{ item.owner }}</td><td><Tag :tone="item.handledBy === 'you' ? 'warning' : 'ok'">{{ item.handledBy === 'you' ? '請你處理' : '我們辦理' }}</Tag></td><td><DueDate :date="item.dueOn" /></td></tr></tbody></table>
        <p v-else class="report-muted">沒有已逾期或 60 天內到期的事項。</p></section>
      <section class="report-section"><h2>三、車輛使用與使用費</h2>
        <table v-if="report.usage.items.length" class="report-table"><thead><tr><th>牌照</th><th>使用人</th><th>收款</th><th class="n">金額</th><th>狀態</th></tr></thead><tbody><tr v-for="(item, index) in report.usage.items" :key="index"><td>{{ item.plate }}</td><td>{{ item.user }}</td><td>{{ item.collectedByUs ? '我們代收' : '直接付給客戶' }}</td><td class="n num">{{ item.currency }} {{ money(item.amount) }}</td><td>{{ statusWord(item.status) }}</td></tr></tbody></table>
        <p v-else class="report-muted">本月沒有車輛使用安排。</p></section>
      <section class="report-section"><h2>四、本月收費</h2>
        <table v-if="report.charges.items.length" class="report-table"><thead><tr><th>類別</th><th>說明</th><th class="n">金額</th><th>狀態</th></tr></thead><tbody><tr v-for="(item, index) in report.charges.items" :key="index"><td>{{ item.kindLabel }}</td><td>{{ item.description }}</td><td class="n num">{{ item.currency }} {{ money(item.amount) }}</td><td>{{ feeWord(item.status) }}</td></tr></tbody></table>
        <p v-else class="report-muted">本月沒有新的收費。</p></section>
      <section class="report-section"><h2>五、內地公司報帳</h2>
        <table v-if="report.filings.length" class="report-table"><thead><tr><th>公司</th><th>狀態</th><th>稅額</th><th>回執</th></tr></thead><tbody><tr v-for="(item, index) in report.filings" :key="index"><td>{{ item.company }}</td><td>{{ item.status }}</td><td class="num">{{ item.zeroFiling ? '零申報' : item.taxAmount != null ? `RMB ${money(item.taxAmount)}` : '—' }}</td><td>{{ item.hasReceipt ? '已收回' : '—' }}</td></tr></tbody></table>
        <p v-else class="report-muted">這位客戶沒有需要報帳的內地公司。</p></section>
      <footer class="report-foot">產生日期 {{ report.generatedOn }}{{ data.confirmedAt ? ` · 確認於 ${data.confirmedAt.slice(0, 10)}` : '' }} · 官方審批結果以實際回執及發出的牌證為準。</footer>
    </article>
    <EmptyState v-else-if="!error" title="載入中" desc="正在讀取報告。" />
  </section>
</template>
