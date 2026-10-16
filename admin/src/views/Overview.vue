<template>
  <div class="page-heading"><div><h1>管理總覽</h1><p>到期提醒、客戶健康與兩地牌使用狀況。</p></div></div>
  <div class="metrics overview-metrics"><button v-for="[key,label] in statuses" :key="key" class="metric metric-action" @click="filter=filter===key?'':key"><span class="metric-label">{{ key === 'upcoming' ? `${days} 天內到期` : label }}</span><strong>{{ data.counts[key] }}</strong></button></div>
  <section v-if="data.rent" class="panel"><div class="panel-head"><div><h2>本月租金 · {{ data.rent.month }}</h2><p>不同幣種分開計算，不作換算。</p></div></div><div class="record-row" v-for="[key,label] in [['due','應收'],['received','已收'],['overdue','逾期']]" :key="key"><strong>{{ label }} {{ data.rent[key].count }} 期</strong><span>{{ currencyAmounts(data.rent[key].amount) }}</span></div></section>
  <section class="panel"><div class="panel-head"><div><h2>到期列表</h2><p>點擊對象可開啟相關檔案。</p></div></div><div class="phase-filters"><select v-model="filter"><option value="">全部狀態</option><option v-for="[key,label] in statuses" :key="key" :value="key">{{ label }}</option></select><select v-model="customer"><option value="">全部客戶</option><option v-for="item in data.customers" :key="item.id" :value="item.id">{{ item.name }}</option></select></div><div class="deadline-table"><div class="deadline-head"><span>項目</span><span>對象</span><span>客戶</span><span>到期日</span><span>剩餘天數</span><span>狀態</span><span>操作</span></div><div v-for="item in visible" :key="`${item.ruleCode}:${item.ownerId}`" class="deadline-row"><strong data-label="項目">{{ item.name }}</strong><button class="phase-link" data-label="對象" @click="$emit('open',item)">{{ item.ownerLabel }}</button><div class="deadline-field" data-label="客戶"><span class="deadline-label">客戶</span><span>{{ item.customerName }}</span></div><div class="deadline-field" data-label="到期日"><span class="deadline-label">到期日</span><span>{{ item.dueOn || '—' }}</span></div><div class="deadline-field" data-label="剩餘天數"><span class="deadline-label">剩餘天數</span><span>{{ item.daysLeft == null ? '—' : `${item.daysLeft} 天` }}</span></div><div class="deadline-field" data-label="狀態"><span class="deadline-label">狀態</span><span class="badge" :class="statusTone(item.level)">{{ statusLabel(item.level) }}</span></div><div v-if="item.ruleCode === 'rent_overdue' || item.completable || item.officialUrl" class="deadline-operation" data-label="操作"><span class="deadline-label">操作</span><a v-if="item.officialUrl" class="text-button" :href="item.officialUrl" target="_blank" rel="noopener">官方核對 ↗</a><button v-if="item.ruleCode === 'rent_overdue'" class="text-button" @click="router.push({ path: '/rentals', query: { contractId: item.contractId, invoiceId: item.invoiceId } })">登記收款</button><button v-else-if="item.completable" class="button" @click="complete(item)">本期已完成</button></div></div><div v-if="!visible.length" class="empty">沒有符合篩選條件的項目</div></div></section>
  <section class="panel"><div class="panel-head"><div><h2>客戶健康</h2><p>點擊客戶名稱可篩選上方到期列表。</p></div></div><div v-for="item in data.customers" :key="item.id" class="record-row health-row" @click="customer=item.id"><button class="health-button"><span class="health-dot" :class="`health-${item.health}`"></span>{{ healthLabel(item.health) }}</button><strong>{{ item.name }}</strong><span>兩地牌 {{ item.plates }} · 公司 {{ item.companies }}</span><span v-if="item.dissolvedCompanies">已註銷 {{ item.dissolvedCompanies }} 間</span><span>逾期 {{ item.overdue }} · 需處理 {{ item.due }} · 待錄入 {{ item.missing }}</span></div></section>
  <section class="panel"><div class="panel-head"><div><h2>兩地牌使用狀況</h2><p>目前共 {{ data.plates.total }} 個兩地牌指標。</p></div></div><div v-for="[status,count] in Object.entries(data.plates.byUsage)" :key="status" class="record-row"><strong>{{ status }}</strong><span>{{ count }} 個</span></div></section>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue'
import { api, rentMoney } from '../api'
import { useRouter } from 'vue-router'
const router = useRouter()
const currencyAmounts = amounts => Object.entries(amounts || {}).filter(([, value]) => value).map(([currency, value]) => rentMoney(value, currency)).join(' · ') || '—'
const emit = defineEmits(['open','error'])
const statuses = [['overdue','已逾期'],['due','需處理'],['missing','待錄入'],['upcoming','即將到期']]
const data = ref({ counts:{overdue:0,due:0,missing:0,upcoming:0}, deadlines:[], customers:[], plates:{total:0,byUsage:{}} }), filter = ref(''), customer = ref(''), days = ref(90)
const visible = computed(() => data.value.deadlines.filter(item => (!filter.value || item.level === filter.value) && (!customer.value || item.customerId === customer.value)))
const statusLabel = level => statuses.find(item => item[0] === level)?.[1] || level
const statusTone = level => ({ overdue:'danger', due:'amber', missing:'muted', upcoming:'success' }[level] || '')
const healthLabel = health => ({red:'紅色：有逾期',amber:'黃色：有需處理或待錄入',green:'綠色：目前正常'}[health])
async function load() { try { data.value = await api(`/overview?days=${days.value}`) } catch (error) { emit('error', error) } }
async function complete(item) { try { await api('/rule-completions','POST',{ruleCode:item.ruleCode,ownerId:item.ownerId,period:item.period}); await load() } catch (error) { emit('error', error) } }
onMounted(load)
</script>
<style scoped>
@media (max-width: 800px) {
  .deadline-row strong,
  .deadline-row > .phase-link {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 0;
    margin: 0;
  }

  .deadline-row strong::before,
  .deadline-row > .phase-link::before {
    display: block;
    flex: 0 0 62px;
    min-width: 62px;
    margin-right: 0;
  }
}
</style>
