<template>
  <div class="page-heading">
    <div><div class="eyebrow">TODAY / WORK QUEUE</div><h1>今日工作</h1><p>按優先順序處理到期項目、業務與待客戶提供資料。</p></div>
    <button class="button primary" @click="view = 'new-request'">＋ 開工單</button>
  </div>
  <div class="metrics">
    <button class="metric metric-action" @click="todayTab = 'due'"><span class="metric-label">已逾期</span><strong>{{ todayCounts.overdue }}</strong><small>立即跟進</small></button>
    <button class="metric metric-action" @click="todayTab = 'due'"><span class="metric-label">7 天內要辦</span><strong>{{ todayCounts.due }}</strong><small>到期項目</small></button>
    <button class="metric metric-action" @click="todayTab = 'missing'"><span class="metric-label">待錄入資料</span><strong>{{ todayCounts.missing }}</strong><small>補上日期或資料</small></button>
    <button class="metric metric-action" @click="todayTab = 'active'"><span class="metric-label">進行中業務</span><strong>{{ todayCounts.active }}</strong><small>未完成案件</small></button>
  </div>
  <section class="panel">
    <div class="panel-head"><div><h2>工作隊列</h2><p>日期可直接錄入；批文卡有效期請回到批文卡修改。</p></div><select v-model="todayCustomerId"><option value="">全部客戶</option><option v-for="customer in customers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></div>
    <div class="tabs"><button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: todayTab === tab.id }" @click="todayTab = tab.id">{{ tab.name }}</button></div>
    <label class="queue-filter">狀態篩選<select v-model="todayStatus"><option value="">全部狀態</option><option value="overdue">已逾期</option><option value="due">需處理</option><option value="missing">待錄入</option><option value="新要求">新要求</option><option value="辦理中">辦理中</option><option value="待客戶配合">待客戶配合</option></select></label>
    <div v-if="!visibleRows.length" class="empty">目前沒有符合條件的工作</div>
    <div v-for="item in visibleRows" :key="item.id || `${item.ruleCode}:${item.ownerId}`" class="today-row">
      <template v-if="item.ruleCode">
        <div><strong>{{ item.name }}</strong><small>{{ item.ownerLabel }} · {{ item.customerName }}</small></div>
        <span class="badge" :class="tone(item.level)">{{ label(item.level) }}</span>
        <label v-if="item.method === 'expiry' && item.ruleCode !== 'approval'" class="inline-date"><span>到期日</span><input :value="item.dueOn || ''" type="date" @change="saveDate(item, $event.target.value)" /></label>
        <button v-else-if="item.ruleCode === 'approval'" class="text-button" @click="openPlateById(item.ownerId)">到批文卡修改 ↗</button>
        <button v-else-if="item.completable" class="button" @click="complete(item)">已辦好</button>
        <button class="button" @click="createRequestFromDeadline(item)">開工單</button>
      </template>
      <template v-else-if="item.request">
        <div><strong>{{ item.title }}</strong><small>{{ item.request?.customer_name || '客戶' }} · {{ item.request?.title }}</small></div><span class="badge amber">待客戶提供</span><span>請補交所需資料</span><button class="text-button" @click="openRequest(item.request)">查看案件 →</button>
      </template>
      <template v-else><div><strong>{{ item.title }}</strong><small>{{ item.customer_name }} · {{ item.stage }}</small></div><span class="badge amber">{{ item.status }}</span><span>進行中業務</span><button class="text-button" @click="openRequest(item)">查看案件 →</button></template>
    </div>
  </section>
</template>
<script setup>
import { ref, computed } from 'vue'
import { useAdminStore } from '../store'
import { api } from '../api'
const { view, customers, todayTab, todayCustomerId, todayCounts, todayDeadlines, saveTrackedItem, createRequestFromDeadline, openPlateById, openRequest, showSuccess, showError } = useAdminStore()
const todayStatus = ref('')
const visibleRows = computed(() => todayDeadlines.value.filter(item => !todayStatus.value || (item.ruleCode ? item.level : item.status) === todayStatus.value))
const tabs = [{ id: 'due', name: '到期待辦' }, { id: 'active', name: '進行中業務' }, { id: 'missing', name: '待錄入' }, { id: 'customer', name: '待客戶提供' }]
const label = level => ({ overdue: '已逾期', due: '需處理', missing: '待錄入' }[level] || level)
const tone = level => ({ overdue: 'danger', due: 'amber', missing: 'muted' }[level] || '')
async function saveDate(item, expiresOn) { await saveTrackedItem({ ...item, code: item.ruleCode, expiresOn }) }
async function complete(item) { try { await api('/rule-completions', 'POST', { ruleCode: item.ruleCode, ownerId: item.ownerId, period: item.period }); await useAdminStore().refresh(); showSuccess('本期已標記完成') } catch (error) { showError(error) } }
</script>
