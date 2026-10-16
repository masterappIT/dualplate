<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import DataTable from '../components/ui/DataTable.vue'
import Switch from '../components/ui/Switch.vue'
import Button from '../components/ui/Button.vue'
import FormDialog from '../components/business/FormDialog.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Select from '../components/ui/Select.vue'

const emit = defineEmits(['error', 'saved'])
const scopes = [['plate', '兩地牌'], ['vehicle', '車輛'], ['company', '公司']]
const methods = [['expiry', '手動到期日'], ['yearly', '每年固定日期'], ['anniversary', '成立周年'], ['inspection', '驗車週期'], ['periodic', '定期核對']]
const matchFields = [['route', '路線'], ['jurisdiction', '司法區'], ['companyStatus', '公司狀態'], ['indicatorCategory', '指標類別'], ['port', '口岸'], ['origin', '車輛來源地']]
const columns = [{ key: 'name', title: '事項', minWidth: 170 }, { key: 'scope', title: '適用於', minWidth: 240 }, { key: 'method', title: '怎樣計算', minWidth: 220 }, { key: 'remind_days', title: '提前提醒' }, { key: 'customerVisible', title: '客戶看得到' }, { key: 'active', title: '啟用' }, { key: 'action', title: '操作', className: 'col-actions' }]
const rules = ref([]), editing = ref(''), dialog = ref(false), saving = ref(''), form = ref({}), conditions = ref({}), params = ref({}), markYears = ref(''), inspectYears = ref(''), periodicMonths = ref(''), suggestedCode = ref('')
const codeFromName = name => String(name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').replace(/[\u4e00-\u9fff]/g, 'rule').replace(/^_+|_+$/g, '').slice(0, 40).replace(/^[^a-z]+/, 'rule_') || 'custom_rule'
function suggestCode() { if (!editing.value) suggestedCode.value = codeFromName(form.value.name) }
function resetParams() { params.value = form.value.method === 'yearly' ? { month: 1, day: 1 } : form.value.method === 'anniversary' ? { offsetDays: 0 } : form.value.method === 'inspection' ? { yearlyFrom: 10 } : form.value.method === 'periodic' ? { months: [1, 4, 7, 10], officialUrl: 'https://www.gsxt.gov.cn/' } : {} }
function openNew() { editing.value = ''; suggestedCode.value = ''; form.value = { code: '', name: '', scope: 'plate', method: 'expiry', remindDays: 30, active: true, customerVisible: true }; conditions.value = {}; resetParams(); markYears.value = '2,4,8'; inspectYears.value = '6'; periodicMonths.value = '1、4、7、10'; dialog.value = true }
async function load() { try { rules.value = await api('/rules') } catch (error) { emit('error', error) } }
function edit(rule) { editing.value = rule.id; form.value = { name: rule.name, scope: rule.scope, method: rule.method, remindDays: rule.remind_days, active: !!rule.active, customerVisible: !!rule.customerVisible, paramsField: rule.params.field }; conditions.value = Object.fromEntries(Object.entries(rule.match).map(([key, value]) => [key, Array.isArray(value) ? value.join('、') : value])); params.value = { ...rule.params }; markYears.value = rule.params.markYears?.join('、') || ''; inspectYears.value = rule.params.inspectYears?.join('、') || ''; periodicMonths.value = rule.params.months?.join('、') || ''; dialog.value = true }
const text = value => Array.isArray(value) ? value.join('、') : value
function appliesTo(rule) { const match = rule.match || {}; const base = rule.scope === 'plate' ? match.route?.includes?.('粵港') || match.route === '粵港' ? '粵港兩地牌' : match.route?.includes?.('粵澳') || match.route === '粵澳' ? '粵澳兩地牌' : '全部兩地牌' : rule.scope === 'vehicle' ? match.origin ? `${text(match.origin)}車輛` : '全部車輛' : match.jurisdiction ? `${text(match.jurisdiction)}公司` : '全部公司'; const details = Object.entries(match).filter(([key]) => !['route', 'origin', 'jurisdiction'].includes(key)).map(([key, value]) => key === 'companyStatus' ? `不含${['已註銷', '註銷中', '經營異常', '存續'].filter(status => !String(text(value)).includes(status)).join('、') || '其他狀態'}` : key === 'crossingReminder' ? '已開啟過關提醒的牌照' : `${matchFields.find(entry => entry[0] === key)?.[1] || '適用條件'}：${text(value)}`); return details.length ? `${base}（${details.join('；')}）` : base }
function calculation(rule) { const value = rule.params || {}; if (value.field === 'cardExpiresOn') return '按批文卡有效期'; if (rule.method === 'since_last') return `上次過關後 ${value.days ?? value.offsetDays ?? 0} 天`; if (rule.method === 'after_field') return `批文有效期開始後 ${value.days ?? value.offsetDays ?? 0} 天`; if (rule.method === 'expiry') return '手動填寫到期日'; if (rule.method === 'anniversary') return `成立周年日後 ${value.offsetDays || 0} 天`; if (rule.method === 'yearly') return `每年 ${value.month} 月 ${value.day} 日`; if (rule.method === 'periodic') return `每季（${(value.months || []).join('、')} 月）`; if (rule.method === 'inspection') return `按車齡：第 ${(value.markYears || []).join('、')} 年領檢驗標誌，第 ${(value.inspectYears || []).join('、')} 年上線驗車，第 ${value.yearlyFrom} 年起每年驗車`; return '請核對計算方式' }
async function toggle(rule, field, enabled) { saving.value = rule.id; try { await api(`/rules/${rule.id}`, 'PATCH', { [field]: enabled }); rule[field] = enabled; emit('saved', '規則已更新') } catch (error) { emit('error', error) } finally { saving.value = '' } }
async function save() { try { const match = Object.fromEntries(Object.entries(conditions.value).filter(([key, value]) => key !== 'crossingReminder' && String(value || '').trim()).map(([key, value]) => [key, String(value).split(/[、,]/).map(part => part.trim()).filter(Boolean)])); if (conditions.value.crossingReminder === 1 || conditions.value.crossingReminder === '1') match.crossingReminder = 1; const values = { ...params.value }; if (form.value.method === 'inspection') { values.markYears = markYears.value.split(/[、,]/).filter(Boolean).map(Number); values.inspectYears = inspectYears.value.split(/[、,]/).filter(Boolean).map(Number) } if (form.value.method === 'periodic') values.months = periodicMonths.value.split(/[、,]/).filter(Boolean).map(Number); const body = { ...form.value, code: form.value.code || suggestedCode.value, match, params: values }; delete body.paramsField; if (editing.value) { delete body.scope; delete body.method; delete body.code; delete body.active; delete body.customerVisible } await api(editing.value ? `/rules/${editing.value}` : '/rules', editing.value ? 'PATCH' : 'POST', body); dialog.value = false; await load(); emit('saved', '規則已儲存') } catch (error) { emit('error', error) } }
onMounted(load)
</script>
<template>
  <section class="panel"><div class="panel-head"><div><h2>到期事項</h2><p>按對象查看適用範圍、計算方式和提醒設定。</p></div><Button variant="primary" @click="openNew">＋ 新增自訂規則</Button></div>
    <div v-for="[scope, title] in scopes" :key="scope" class="rule-group"><h3>{{ title }}</h3><DataTable :columns="columns" :data="rules.filter(item => item.scope === scope)" :min-width="900">
      <template #cell-name="{ row }"><strong>{{ row.name }}</strong></template>
      <template #cell-scope="{ row }">{{ appliesTo(row) }}</template>
      <template #cell-method="{ row }">{{ calculation(row) }}</template>
      <template #cell-remind_days="{ row }">{{ row.remind_days }} 天</template>
      <template #cell-customerVisible="{ row }"><Switch :model-value="!!row.customerVisible" :disabled="saving === row.id" :label="`${row.name}客戶看得到`" @update:model-value="toggle(row, 'customerVisible', $event)" /><span>{{ row.customerVisible ? '是' : '否' }}</span></template>
      <template #cell-active="{ row }"><Switch :model-value="!!row.active" :disabled="saving === row.id" :label="`${row.name}啟用`" @update:model-value="toggle(row, 'active', $event)" /><span>{{ row.active ? '啟用' : '停用' }}</span></template>
      <template #cell-action="{ row }"><Button @click="edit(row)">編輯</Button></template>
    </DataTable></div>
  </section>
  <FormDialog :open="dialog" :title="editing ? '編輯到期事項' : '新增到期事項'" submit-text="儲存規則" @close="dialog = false" @submit="save">
    <Field v-if="!editing" label="規則代碼" :hint="suggestedCode ? `建議代碼：${suggestedCode}` : ''"><TextInput v-model="form.code" :placeholder="suggestedCode || '例如 annual_check'" /></Field>
    <Field label="規則名稱" required><TextInput v-model="form.name" @update:model-value="suggestCode" /></Field>
    <Field v-if="!editing" label="對象"><Select v-model="form.scope" :options="scopes.map(([value, label]) => ({ value, label }))" /></Field>
    <Field v-if="!editing" label="計算方式"><Select v-model="form.method" :options="methods.map(([value, label]) => ({ value, label }))" @update:model-value="resetParams" /></Field>
    <Field label="提醒天數"><TextInput v-model="form.remindDays" type="number" /></Field>
    <Field v-for="[key, title] in matchFields" :key="key" :label="`適用條件：${title}`"><TextInput v-model="conditions[key]" placeholder="全部；多個可用、分隔" /></Field>
    <div v-if="editing && form.paramsField === 'cardExpiresOn'" class="rule-source-note">資料來源：批文卡有效期（不可在此修改）</div>
    <template v-else-if="form.method === 'yearly'"><Field label="月份"><TextInput v-model="params.month" type="number" /></Field><Field label="日期"><TextInput v-model="params.day" type="number" /></Field></template>
    <Field v-else-if="form.method === 'anniversary'" label="周年偏移天數"><TextInput v-model="params.offsetDays" type="number" /></Field>
    <template v-else-if="form.method === 'inspection'"><Field label="領標誌年份"><TextInput v-model="markYears" /></Field><Field label="上線檢驗年份"><TextInput v-model="inspectYears" /></Field><Field label="每年檢驗起始年"><TextInput v-model="params.yearlyFrom" type="number" /></Field></template>
    <template v-else-if="form.method === 'periodic'"><Field label="週期月份"><TextInput v-model="periodicMonths" /></Field><Field label="官方網址"><TextInput v-model="params.officialUrl" /></Field></template>
  </FormDialog>
</template>
