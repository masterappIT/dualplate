<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api, user } from '../api'
import BoardView from '../components/business/BoardView.vue'
import Segmented from '../components/ui/Segmented.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import DueDate from '../components/ui/DueDate.vue'
import Avatar from '../components/ui/Avatar.vue'
import Tag from '../components/ui/Tag.vue'
import ListPage from '../components/business/ListPage.vue'
import Button from '../components/ui/Button.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import { useListPage } from '../composables/list'
import { useAdminStore } from '../store'

const { view, requests, customers, search, statusFilter, openRequest, serviceName, refresh, showError } = useAdminStore()
const mode = ref(localStorage.getItem('business-view') || (window.innerWidth < 820 ? 'list' : 'board')), ownership = ref('all'), assignee = ref(''), service = ref(''), customerId = ref(''), mine = ref(false), overdue = ref(false), staff = ref([]), narrow = ref(window.innerWidth < 820)
watch(mode, value => localStorage.setItem('business-view', value))
const syncWidth = () => { narrow.value = window.innerWidth < 820 }
const statuses = ['待開始', '進行中', '待客戶提供', '已完成', '已取消']
onMounted(async () => { window.addEventListener('resize', syncWidth); if (user()?.role === 'admin') try { staff.value = await api('/staff') } catch (error) { showError(error) } })
onBeforeUnmount(() => window.removeEventListener('resize', syncWidth))
const assigneeOptions = computed(() => staff.value.length ? staff.value : [...new Map(requests.value.filter(item => item.assignee_id).map(item => [item.assignee_id, { id: item.assignee_id, name: item.assignee_name || '未命名員工' }])).values()])
const rows = computed(() => requests.value.filter(item => (!search.value || `${item.title} ${item.customer_name} ${item.plate || ''}`.toLowerCase().includes(search.value.toLowerCase())) && (!statusFilter.value || statusFilter.value === 'active' ? !statusFilter.value || !['已完成', '已取消'].includes(item.status) : item.status === statusFilter.value) && (ownership.value === 'all' || Boolean(customers.value.find(customer => customer.id === item.customer_id)?.is_self) === (ownership.value === 'self')) && (!assignee.value || item.assignee_id === assignee.value) && (!mine.value || item.assignee_id === user()?.id) && (!service.value || item.service_code === service.value) && (!customerId.value || item.customer_id === customerId.value) && (!overdue.value || item.due_on && item.due_on < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) && !['已完成', '已取消'].includes(item.status))))
const list = useListPage(rows, refresh)
// 狀態色全站一致：待開始灰、進行中藍、待客戶提供橙、已完成綠、已取消灰
const statusTone = { 待開始: 'muted', 進行中: 'progress', 待客戶提供: 'due', 已完成: 'ok', 已取消: 'muted' }
const tagTone = { 待開始: 'neutral', 進行中: 'info', 待客戶提供: 'warning', 已完成: 'ok', 已取消: 'neutral' }
const boardColumns = computed(() => statuses.map(status => ({ key: status, title: status, tone: statusTone[status], items: rows.value.filter(item => item.status === status) })))
// 工單關聯的兩地牌：內地＋香港／澳門車牌；沒有關聯牌照時用車輛車牌
const plateLabel = item => { const plate = useAdminStore().plates.value.find(entry => entry.id === item.plate_asset_id); return plate ? [plate.mainland_plate, plate.local_plate].filter(Boolean).join(' · ') : item.plate || '' }
const closed = item => ['已完成', '已取消'].includes(item.status)
const columns = [{ key: 'title', title: '工單' }, { key: 'customer_name', title: '客戶／車輛' }, { key: 'route', title: '路線' }, { key: 'assignee', title: '負責人' }, { key: 'due_on', title: '截止日' }, { key: 'status', title: '狀態' }, { key: 'action', title: '操作', className: 'col-actions' }]
async function move({ item, to }) { if (to.key === '已完成') { showError(new Error('請在工單詳情核對全部步驟並更新到期日後結案')); return false } if (to.key === '已取消') { showError(new Error('請到工單詳情填寫取消原因')); return false } try { await api(`/requests/${item.id}`, 'PATCH', { status: to.key }); await refresh(); return true } catch (error) { showError(error); return false } }
</script>
<template>
  <ListPage title="業務工單" desc="按狀態查看待辦與進度，切換看板或列表。" table-title="工單列表" :list="list" :columns="columns" :min-width="900" :alt-view="mode === 'board'">
    <template #actions><Button variant="primary" @click="view = 'new-request'">＋ 建立工單</Button></template>
    <template #before><Segmented v-model="mode" :options="[{ value: 'board', label: '看板' }, { value: 'list', label: '列表' }]" label="業務視圖" /><div class="filter-bar"><Field label="搜尋工單"><TextInput v-model="search" placeholder="搜尋客戶、車牌或工單" /></Field><Field label="狀態"><select v-model="statusFilter"><option value="">全部狀態</option><option value="active">進行中業務</option><option v-for="status in statuses" :key="status">{{ status }}</option></select></Field><Field label="負責人"><select v-model="assignee"><option value="">全部</option><option v-for="person in assigneeOptions" :key="person.id" :value="person.id">{{ person.name }}</option></select></Field><Field label="業務"><select v-model="service"><option value="">全部</option><option v-for="code in [...new Set(requests.map(item => item.service_code))]" :key="code" :value="code">{{ serviceName(code) }}</option></select></Field><Field label="客戶"><select v-model="customerId"><option value="">全部</option><option v-for="customer in customers" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></Field><Field label="來源"><select v-model="ownership"><option value="all">全部</option><option value="client">客戶的</option><option value="self">自有的</option></select></Field><label><input v-model="mine" type="checkbox" /> 我的工單</label><label><input v-model="overdue" type="checkbox" /> 已逾期</label></div></template>
    <template #alt><BoardView :columns="boardColumns" item-key="id" :draggable="!narrow" :on-move="move" empty-text="沒有此狀態的工單"><template #card="{ item }"><button class="text-button" @click="openRequest(item)"><strong>{{ item.title }}</strong></button><p>{{ item.customer_name }} · {{ serviceName(item.service_code) }}</p><PlateChip v-if="plateLabel(item)" :plate="plateLabel(item)" :route="item.route" /><div class="record-row"><Avatar :name="item.assignee_name" />{{ item.assignee_name || '未指派' }}<DueDate :date="item.due_on" :done="closed(item)" /></div><select v-if="narrow" :value="item.status" :aria-label="`${item.title}狀態`" @change="move({ item, to: { key: $event.target.value } }); $event.target.value = item.status"><option v-for="status in statuses" :key="status" :value="status">{{ status }}</option></select></template></BoardView></template>
    <template #cell-title="{ row }"><strong>{{ row.title }}</strong><small>{{ serviceName(row.service_code) }}</small></template>
    <template #cell-customer_name="{ row }">{{ row.customer_name }}<small><PlateChip v-if="plateLabel(row)" :plate="plateLabel(row)" /><template v-else>未指定牌照</template></small></template>
    <template #cell-assignee="{ row }">{{ row.assignee_name || '未指派' }}</template>
    <template #cell-due_on="{ row }"><DueDate :date="row.due_on" :done="closed(row)" /></template>
    <template #cell-status="{ row }"><Tag :tone="tagTone[row.status] || 'info'">{{ row.status }}</Tag></template>
    <template #cell-action="{ row }"><button class="text-button" @click="openRequest(row)">查看 →</button></template>
  </ListPage>
</template>
