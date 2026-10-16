<script setup>
import ListPage from '../components/business/ListPage.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import { useListPage } from '../composables/list'
import { useAdminStore } from '../store'

const { view, filteredRequests, search, statusFilter, openRequest, serviceName, date, refresh } = useAdminStore()
const list = useListPage(filteredRequests, refresh)
const columns = [{ key: 'title', title: '工單' }, { key: 'customer_name', title: '客戶／車輛' }, { key: 'route', title: '路線' }, { key: 'stage', title: '目前階段' }, { key: 'status', title: '狀態' }, { key: 'updated_at', title: '更新' }, { key: 'action', title: '操作', className: 'col-actions' }]
</script>
<template>
  <ListPage title="業務工單" desc="管理新申請、續期、換車、驗車與兩地備案。" table-title="工單列表" :list="list" :columns="columns" :min-width="800">
    <template #actions><Button variant="primary" @click="view = 'new-request'">＋ 建立工單</Button></template>
    <template #search><Field label="搜尋工單"><TextInput v-model="search" placeholder="搜尋客戶、車牌或工單" /></Field><Field label="狀態"><select v-model="statusFilter"><option value="">全部狀態</option><option>新要求</option><option value="active">辦理中工單</option><option>待資格核實</option><option>待報價／授權</option><option>待收件</option><option>辦理中</option><option>待客戶配合</option><option>待交付</option><option>已完成</option><option>暫停</option></select></Field></template>
    <template #cell-title="{ row }"><strong>{{ row.title }}</strong><small>{{ serviceName(row.service_code) }}</small></template>
    <template #cell-customer_name="{ row }">{{ row.customer_name }}<small>{{ row.plate || '未指定車輛' }}</small></template>
    <template #cell-status="{ row }"><span class="badge" :class="row.status === '新要求' ? 'amber' : ''">{{ row.status }}</span></template>
    <template #cell-updated_at="{ row }">{{ date(row.updated_at) }}</template>
    <template #cell-action="{ row }"><button class="text-button" @click="openRequest(row)">查看 →</button></template>
  </ListPage>
</template>
