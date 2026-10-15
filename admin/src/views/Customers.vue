<template>
  <div class="page-heading"><div><div class="eyebrow">CUSTOMERS</div><h1>客戶</h1><p>一張表掌握客戶、牌照、公司組與下一個到期事項。</p></div><button class="button primary" @click="modal = 'customer'">＋ 新增客戶</button></div>
  <section class="panel table-panel"><div class="panel-head"><div><h2>客戶列表</h2><p>狀態燈沿用到期健康判斷。</p></div><input v-model="customerSearch" class="table-search" placeholder="搜尋客戶名稱或類型" /></div>
    <div class="table-wrap"><table><thead><tr><th>客戶</th><th>類型</th><th>牌照數</th><th>公司組數</th><th>狀態</th><th>下一個到期</th><th></th></tr></thead><tbody><tr v-for="customer in customerRows" :key="customer.id" @click="openCustomer(customer)"><td><strong>{{ customer.name }}</strong><small>{{ customer.phone || '未填電話' }}</small></td><td>{{ customer.kind }}</td><td>{{ customer.plateCount }}</td><td>{{ customer.groupCount }}</td><td><span class="health-state"><i class="health-dot" :class="`health-${customer.health}`"></i>{{ healthLabel(customer.health) }}</span></td><td>{{ customer.nextDue }}</td><td>→</td></tr></tbody></table><div v-if="!customerRows.length" class="empty">尚未找到符合條件的客戶</div></div>
  </section>
</template>
<script setup>
import { useAdminStore } from '../store'
const { modal, customerSearch, customerRows, openCustomer } = useAdminStore()
const healthLabel = health => ({ red: '有逾期', amber: '需注意', green: '目前正常' }[health] || health)
</script>
