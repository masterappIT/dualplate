<template>
  <ListPage title="客戶" desc="一張表掌握客戶、牌照、公司組與下一個到期事項。" table-title="客戶列表" :list="list" :columns="columns" :min-width="760">
    <template #actions><Button v-if="user()?.role === 'admin'" variant="primary" @click="modal = 'customer'">＋ 新增客戶</Button></template>
    <template #search><Field label="搜尋客戶"><TextInput v-model="customerSearch" placeholder="搜尋客戶名稱或類型" /></Field><Field label="委託方式"><Segmented v-model="modeFilter" :options="modeOptions" label="委託方式" /></Field></template>
    <template #cell-name="{ row }"><HoverCard><button class="text-button" @click="openCustomer(row)"><strong>{{ row.name }}</strong></button><template #card><strong>{{ row.name }}</strong><p>{{ row.kind }} · {{ row.plateCount }} 個牌照 · {{ row.groupCount }} 個公司組</p><p>電話：{{ phoneText(row.phone) || '未填' }}</p></template></HoverCard><Tag v-if="row.is_self" tone="ok">自有</Tag><Tag v-else-if="row.service_mode === '自管'" tone="neutral">自管</Tag><small>{{ phoneText(row.phone) || '未填電話' }}</small></template>
    <template #cell-health="{ row }"><span class="health-state"><i class="health-dot" :class="`health-${row.health}`" />{{ healthLabel(row.health) }}</span></template>
    <template #cell-nextDue="{ row }"><DueDate :date="row.nextDue === '—' ? null : row.nextDue" /></template>
    <template #cell-action="{ row }"><button class="text-button" @click="openCustomer(row)">查看 →</button></template>
  </ListPage>
</template>
<script setup>
import ListPage from '../components/business/ListPage.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import DueDate from '../components/ui/DueDate.vue'
import HoverCard from '../components/ui/HoverCard.vue'
import Tag from '../components/ui/Tag.vue'
import Segmented from '../components/ui/Segmented.vue'
import { ref, computed } from 'vue'
import { user, phoneText } from '../api'
import { useListPage } from '../composables/list'
import { useAdminStore } from '../store'
const { modal, customerSearch, customerRows, openCustomer, refresh } = useAdminStore()
// 托管／自管篩選（docs/requirements.md 5.6.2）；本公司自有歸在「全部」
const modeFilter = ref('all')
const modeOptions = [{ value: 'all', label: '全部' }, { value: '托管', label: '托管' }, { value: '自管', label: '自管' }]
const shownRows = computed(() => modeFilter.value === 'all' ? customerRows.value : customerRows.value.filter(row => !row.is_self && (row.service_mode || '托管') === modeFilter.value))
const list = useListPage(shownRows, refresh)
const columns = [{ key: 'name', title: '客戶' }, { key: 'kind', title: '類型' }, { key: 'plateCount', title: '牌照數' }, { key: 'groupCount', title: '公司組數' }, { key: 'health', title: '狀態' }, { key: 'nextDue', title: '下一個到期' }, { key: 'action', title: '操作', className: 'col-actions' }]
const healthLabel = health => ({ red: '有逾期', amber: '需注意', green: '目前正常' }[health] || health)
</script>
