<template>
  <section class="panel">
    <div class="panel-head"><div><h2>公司組</h2><p>香港／澳門公司、內地公司與所屬牌照。</p></div><div class="heading-actions"><button v-if="companies.length > 1" class="button" @click="openBatch">批量填到期日</button><template v-if="isAdmin"><button class="button" @click="dialog = 'new-group'; dialogForm = { name: '', notes: '' }">＋ 新增公司組</button><button class="button primary" @click="newCompany">＋ 新增公司</button></template></div></div>
    <div v-if="!groups.length" class="empty">尚未建立公司組</div>
    <div v-for="group in groups" :key="group.id" class="company-group-block">
      <div class="company-group-head"><div><h3>{{ group.name }}</h3><p v-if="groupNote(group)" class="cell-sub">{{ groupNote(group) }}</p></div><Button v-if="isAdmin" variant="text" size="sm" @click="dialog = 'group'; dialogForm = { ...group }">編輯公司組</Button></div>
      <div v-if="group.warnings?.length" class="status-warnings"><span v-for="warning in group.warnings" :key="warning" class="warning">{{ warning }}</span></div>
      <div class="group-plates"><span class="cell-sub">持有牌照</span><button v-for="plate in group.plates" :key="plate.id" type="button" class="group-plate" @click="emit('plate', plate.id)"><span class="group-plate-chips"><PlateChip :plate="plate.mainland_plate" /><PlateChip :plate="plate.local_plate" :route="plate.route" /></span><small>{{ plate.route }} · 口岸：{{ plate.port || '待設定' }} · {{ !plate.usage_status || plate.usage_status === '待核對' ? '使用待確認' : plate.usage_status }}</small></button><span v-if="!group.plates.length" class="cell-sub">尚未掛接兩地牌</span></div>
      <div class="company-columns">
        <section class="company-column"><p class="company-column-title">香港／澳門公司</p><CompanyCard v-for="company in foreignCompanies(group)" :key="`${company.id}:${cardsVersion}`" :company="company" :deadlines="deadlines" :editable="isAdmin" @edit="editCompany" @saved="saved" @error="emit('error', $event)" /><p v-if="!foreignCompanies(group).length" class="cell-sub">未登記</p></section>
        <section class="company-column"><p class="company-column-title">內地公司</p><CompanyCard v-for="company in mainlandCompanies(group)" :key="`${company.id}:${cardsVersion}`" :company="company" :deadlines="deadlines" :editable="isAdmin" @edit="editCompany" @saved="saved" @error="emit('error', $event)" /><p v-if="!mainlandCompanies(group).length" class="cell-sub">未登記</p></section>
      </div>
    </div>
    <div v-if="ungrouped.length" class="company-group-block">
      <div class="company-group-head"><div><h3>未分組公司</h3><p class="cell-sub">還沒放進公司組的公司；編輯公司可選擇公司組。</p></div></div>
      <div class="company-columns">
        <section class="company-column"><p class="company-column-title">香港／澳門公司</p><CompanyCard v-for="company in ungrouped.filter(item => item.jurisdiction !== '內地')" :key="`${company.id}:${cardsVersion}`" :company="company" :deadlines="deadlines" :editable="isAdmin" @edit="editCompany" @saved="saved" @error="emit('error', $event)" /><p v-if="!ungrouped.some(item => item.jurisdiction !== '內地')" class="cell-sub">沒有</p></section>
        <section class="company-column"><p class="company-column-title">內地公司</p><CompanyCard v-for="company in ungrouped.filter(item => item.jurisdiction === '內地')" :key="`${company.id}:${cardsVersion}`" :company="company" :deadlines="deadlines" :editable="isAdmin" @edit="editCompany" @saved="saved" @error="emit('error', $event)" /><p v-if="!ungrouped.some(item => item.jurisdiction === '內地')" class="cell-sub">沒有</p></section>
      </div>
    </div>
  </section>
  <FormDialog :open="!!dialog" :title="dialog === 'new-group' ? '新增公司組' : dialog === 'group' ? '編輯公司組' : dialog === 'new-company' ? '新增公司' : '編輯公司'" :submit-text="dialog === 'group' || dialog === 'new-group' ? '儲存公司組' : '儲存公司'" @close="dialog = null" @submit="submit">
    <template v-if="dialog === 'group' || dialog === 'new-group'"><Field label="公司組名稱" required><TextInput v-model="dialogForm.name" /></Field><Field label="備註"><TextInput v-model="dialogForm.notes" /></Field></template>
    <template v-else><div class="form-grid">
      <Field label="公司組"><Select v-model="dialogForm.groupId" :options="groupOptions" /></Field>
      <Field label="司法區"><Select v-model="dialogForm.jurisdiction" :options="['香港', '澳門', '內地']" /></Field>
      <div class="company-name-fields"><Field label="公司名稱" required><TextInput v-model="dialogForm.name" /></Field><div v-if="nameSuggestion && dialogForm.jurisdiction === '內地'" class="company-suggestion"><p class="error">{{ nameProblem }}</p><Button variant="text" size="sm" @click="dialogForm.name = nameSuggestion; nameSuggestion = ''; nameProblem = ''">改用建議名稱</Button></div><Field v-if="dialogForm.jurisdiction === '香港'" label="英文名稱" required><TextInput v-model="dialogForm.nameEn" /></Field></div>
      <Field :label="registrationLabel(dialogForm.jurisdiction)"><TextInput v-model="dialogForm.registrationNo" /></Field>
      <Field v-if="dialogForm.jurisdiction === '香港'" label="公司編號（CR）"><TextInput v-model="dialogForm.companyNumber" /></Field>
      <Field label="成立日期"><DateInput v-model="dialogForm.incorporatedOn" label="成立日期" /></Field>
      <Field v-if="dialogForm.jurisdiction === '內地'" label="納稅人類型"><Select v-model="dialogForm.taxpayerType" :options="[{ value: '', label: '待選擇' }, { value: '小規模納稅人', label: '小規模納稅人' }, { value: '一般納稅人', label: '一般納稅人' }]" /></Field>
      <Field label="狀態"><Select v-model="dialogForm.status" :options="statuses" /></Field>
      <Field label="狀態變更日期"><DateInput v-model="dialogForm.statusChangedOn" label="狀態變更日期" /></Field>
      <Field label="備註"><TextInput v-model="dialogForm.notes" /></Field>
    </div><div v-if="dialogForm.jurisdiction === '香港' && dialog === 'company'" class="lookup-box"><button type="button" class="button" :disabled="lookingUp" @click="lookupCompany">{{ lookingUp ? '查詢中…' : '向公司註冊處查詢' }}</button><p v-if="lookupError" class="error">{{ lookupError }}</p><div v-if="lookupResult" class="lookup-result"><strong>{{ lookupResult.name }}</strong><span>BRN：{{ lookupResult.registrationNo }}</span><span>英文名稱：{{ lookupResult.englishName || '—' }}</span><span>成立日期：{{ lookupResult.incorporatedOn || '—' }}</span><span>公司類型：{{ lookupResult.companyType || '—' }}</span><span>註冊地址：{{ lookupResult.address || '—' }}</span><button type="button" class="button primary" @click="applyLookup">套用查詢結果</button></div></div></template>
  </FormDialog>
  <Modal :open="batchOpen" title="批量填到期日" sub="同一事項、同一日期，一次填多間公司；原有備註保留。" @close="batchOpen = false">
    <div class="batch-dates">
      <Field label="事項"><Select v-model="batchCode" :options="batchRuleOptions" label="事項" /></Field>
      <div v-if="batchCode" class="batch-company-list">
        <Checkbox :model-value="batchAll" :indeterminate="batchPicked.length > 0 && !batchAll" label="全選" @update:model-value="value => batchPicked = value ? batchCompanies.map(item => item.id) : []" />
        <div v-for="company in batchCompanies" :key="company.id" class="batch-company-row"><Checkbox :model-value="batchPicked.includes(company.id)" :label="company.name" @update:model-value="value => batchPicked = value ? [...batchPicked, company.id] : batchPicked.filter(id => id !== company.id)" /><DueDate :date="currentDue(company.id)" /></div>
      </div>
      <Field label="到期日" required><DateInput v-model="batchDate" label="到期日" /></Field>
      <p v-if="batchError" class="error" role="alert">{{ batchError }}</p>
    </div>
    <template #footer><Button @click="batchOpen = false">取消</Button><Button variant="primary" :loading="batchSaving" :disabled="!batchCode || !batchPicked.length || !batchDate" @click="saveBatch">儲存（{{ batchPicked.length }} 間）</Button></template>
  </Modal>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { api, user } from '../api'
import FormDialog from '../components/business/FormDialog.vue'
import CompanyCard from '../components/business/CompanyCard.vue'
import Button from '../components/ui/Button.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Select from '../components/ui/Select.vue'
import DateInput from '../components/ui/DateInput.vue'
import DueDate from '../components/ui/DueDate.vue'
import Modal from '../components/ui/Modal.vue'
import Checkbox from '../components/ui/Checkbox.vue'
const props = defineProps({ initialCustomer: String, addGroupRequest: Number, isSelf: Boolean })
const emit = defineEmits(['error', 'saved', 'plate'])
const isAdmin = user()?.role === 'admin'
const statuses = ['存續', '經營異常', '註銷中', '已註銷']
const groups = ref([]), companies = ref([]), deadlines = ref([]), dialog = ref(null), dialogForm = ref({}), lookingUp = ref(false), lookupResult = ref(null), lookupError = ref(''), nameSuggestion = ref(''), nameProblem = ref('')
const ungrouped = computed(() => companies.value.filter(item => !item.group_id))
const groupOptions = computed(() => [{ value: '', label: '未分組' }, ...groups.value.map(group => ({ value: group.id, label: group.name }))])
const foreignCompanies = group => group.companies.filter(item => item.jurisdiction !== '內地')
const mainlandCompanies = group => group.companies.filter(item => item.jurisdiction === '內地')
// 「CSV 匯入」是系統記下的來源，不當作公司組備註顯示
const groupNote = group => group.notes && group.notes !== 'CSV 匯入' ? group.notes : ''
const registrationLabel = jurisdiction => ({ 香港: '商業登記號碼（BR）', 澳門: '商業登記編號', 內地: '統一社會信用代碼' }[jurisdiction] || '登記號碼')
async function load() { if (!props.initialCustomer) return; try { const [groupList, companyList, overview] = await Promise.all([api(`/company-groups?customerId=${encodeURIComponent(props.initialCustomer)}`), api(`/companies?customerId=${encodeURIComponent(props.initialCustomer)}`), api('/overview?days=365')]); groups.value = groupList; companies.value = companyList; deadlines.value = overview.deadlines || [] } catch (error) { emit('error', error) } }
function saved(message) { load(); emit('saved', message) }
function newCompany() { dialog.value = 'new-company'; dialogForm.value = { groupId: '', jurisdiction: '香港', name: '', registrationNo: '', companyNumber: '', incorporatedOn: '', taxpayerType: '', status: '存續', statusChangedOn: '', nameEn: '', notes: '' }; nameSuggestion.value = ''; nameProblem.value = '' }
function editCompany(company) { dialog.value = 'company'; dialogForm.value = { ...company, nameEn: company.nameEn || company.name_en || '', groupId: company.group_id || '', registrationNo: company.registration_no || '', companyNumber: company.company_number || '', incorporatedOn: company.incorporated_on || '', taxpayerType: company.taxpayer_type || '', statusChangedOn: company.status_changed_on || '' }; lookupResult.value = null; lookupError.value = ''; nameSuggestion.value = ''; nameProblem.value = '' }
async function saveGroup() { try { const isNew = dialog.value === 'new-group'; await api(isNew ? '/company-groups' : `/company-groups/${dialogForm.value.id}`, isNew ? 'POST' : 'PATCH', { ...dialogForm.value, customerId: props.initialCustomer }); dialog.value = null; saved('公司組已儲存') } catch (error) { emit('error', error) } }
async function saveCompany() { nameSuggestion.value = ''; nameProblem.value = ''; try { const isNew = dialog.value === 'new-company'; await api(isNew ? '/companies' : `/companies/${dialogForm.value.id}`, isNew ? 'POST' : 'PATCH', { ...dialogForm.value, customerId: props.initialCustomer }); dialog.value = null; saved('公司已儲存') } catch (error) { if (error.details?.suggestion) { nameSuggestion.value = error.details.suggestion; nameProblem.value = error.message } else emit('error', error) } }
async function lookupCompany() { lookupResult.value = null; lookupError.value = ''; if (!/^\d{8}$/.test(String(dialogForm.value.registrationNo || ''))) { lookupError.value = '請先填寫 8 位商業登記號碼'; return } lookingUp.value = true; try { lookupResult.value = await api(`/companies/${dialogForm.value.id}/hk-lookup`, 'POST') } catch (error) { lookupError.value = error.message } finally { lookingUp.value = false } }
function applyLookup() { if (!lookupResult.value) return; dialogForm.value.name = lookupResult.value.name || dialogForm.value.name; dialogForm.value.nameEn = lookupResult.value.englishName || dialogForm.value.nameEn; dialogForm.value.incorporatedOn = lookupResult.value.incorporatedOn || dialogForm.value.incorporatedOn }
// 批量填到期日：只列適用於這位客戶某些公司的到期類事項；切換事項時預設全選適用的公司
const cardsVersion = ref(0)
const batchOpen = ref(false), batchRules = ref([]), batchCode = ref(''), batchPicked = ref([]), batchDate = ref(''), batchSaving = ref(false), batchError = ref('')
const applies = (rule, company) => (!rule.match?.jurisdiction || rule.match.jurisdiction === company.jurisdiction) && (!rule.match?.companyStatus || rule.match.companyStatus.includes(company.status || '存續'))
const batchRuleOptions = computed(() => batchRules.value.filter(rule => companies.value.some(company => applies(rule, company))).map(rule => ({ value: rule.code, label: rule.name })))
const batchCompanies = computed(() => { const rule = batchRules.value.find(item => item.code === batchCode.value); return rule ? companies.value.filter(company => applies(rule, company)) : [] })
const batchAll = computed(() => batchCompanies.value.length > 0 && batchCompanies.value.every(company => batchPicked.value.includes(company.id)))
const currentDue = companyId => deadlines.value.find(item => item.ownerType === 'company' && item.ownerId === companyId && item.ruleCode === batchCode.value)?.dueOn || null
watch(batchCode, () => { batchPicked.value = batchCompanies.value.map(company => company.id); batchError.value = '' })
async function openBatch() { batchError.value = ''; batchDate.value = ''; batchOpen.value = true; try { batchRules.value = (await api('/rules')).filter(rule => rule.scope === 'company' && rule.method === 'expiry' && rule.active); if (!batchRuleOptions.value.some(option => option.value === batchCode.value)) batchCode.value = batchRuleOptions.value[0]?.value || ''; batchPicked.value = batchCompanies.value.map(company => company.id) } catch (error) { batchError.value = error.message } }
async function saveBatch() { batchSaving.value = true; batchError.value = ''; try { const result = await api('/tracked-items/bulk', 'PUT', { ownerType: 'company', ownerIds: batchPicked.value, code: batchCode.value, expiresOn: batchDate.value }); batchOpen.value = false; cardsVersion.value += 1; saved(`已為 ${result.updated} 間公司填上到期日`) } catch (error) { batchError.value = error.message } finally { batchSaving.value = false } }
function submit() { if (dialog.value === 'group' || dialog.value === 'new-group') saveGroup(); else saveCompany() }
watch(() => props.initialCustomer, load, { immediate: true })
watch(() => props.addGroupRequest, () => { dialog.value = 'new-group'; dialogForm.value = { name: '', notes: '' } }, { immediate: props.addGroupRequest > 0 })
</script>
