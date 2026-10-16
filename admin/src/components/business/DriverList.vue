<script setup>
import { ref, watch } from 'vue'
import { api, user } from '../../api'
import DataTable from '../ui/DataTable.vue'
import Button from '../ui/Button.vue'
import EmptyState from '../ui/EmptyState.vue'
import PlateChip from '../ui/PlateChip.vue'
import DueDate from '../ui/DueDate.vue'
import Field from '../ui/Field.vue'
import TextInput from '../ui/TextInput.vue'
import FormDialog from './FormDialog.vue'

const props = defineProps({ customerId: String })
const emit = defineEmits(['plate', 'saved', 'error'])
const canEdit = user()?.role === 'admin' || user()?.role === 'staff'
const drivers = ref([]), loading = ref(false), error = ref(''), saving = ref(false), open = ref(false)
const form = ref({ name: '', phone: '', hkIdNo: '', homeReturnPermitNo: '', notes: '' }), editingId = ref('')
const columns = [{ key: 'name', title: '姓名' }, { key: 'plates', title: '登記牌照', minWidth: 160 }, { key: 'documents', title: '證件到期', minWidth: 220 }, { key: 'action', title: '操作' }]
async function load() { if (!props.customerId) return; const customerId = props.customerId; loading.value = true; error.value = ''; try { const rows = await api(`/drivers?customerId=${encodeURIComponent(customerId)}`); if (customerId === props.customerId) drivers.value = rows } catch (cause) { error.value = `未能取得司機資料：${cause.message}` } finally { loading.value = false } }
watch(() => props.customerId, () => { drivers.value = []; load() }, { immediate: true })
function edit(driver) { editingId.value = driver?.id || ''; form.value = { name: driver?.name || '', phone: driver?.phone || '', hkIdNo: driver?.hkIdNo || '', homeReturnPermitNo: driver?.homeReturnPermitNo || '', notes: driver?.notes || '' }; open.value = true }
async function save() { if (!form.value.name.trim() || saving.value) { error.value = '請填寫司機姓名'; return } saving.value = true; try { await api(editingId.value ? `/drivers/${editingId.value}` : '/drivers', editingId.value ? 'PATCH' : 'POST', { ...form.value, name: form.value.name.trim(), ...(editingId.value ? {} : { customerId: props.customerId }) }); open.value = false; emit('saved', '司機資料已儲存'); await load() } catch (cause) { error.value = cause.message; emit('error', cause) } finally { saving.value = false } }
async function saveDate(driver, document, expiresOn) { try { await api('/tracked-items', 'PUT', { ownerType: 'driver', ownerId: driver.id, code: document.code, expiresOn }); await load(); emit('saved', '證件到期日已儲存'); return true } catch (cause) { emit('error', cause); return false } }
</script>
<template>
  <section class="panel table-panel">
    <div class="panel-head"><div><h2>司機</h2><p>一位司機可登記在多個牌照；證件到期日按司機追蹤。</p></div><Button v-if="canEdit" size="sm" @click="edit(null)">新增司機</Button></div>
    <p v-if="error && !open" class="error" role="alert">{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="drivers" :loading="loading" :min-width="680">
      <template #cell-plates="{ row }"><div v-for="plate in row.plates" :key="plate.plateId" class="driver-plate"><button class="phase-link" @click="emit('plate', plate.plateId)"><PlateChip :plate="plate.mainlandPlate || plate.localPlate" :route="plate.route" /></button><span>{{ plate.role }}司機</span></div><span v-if="!row.plates.length">尚未登記牌照</span></template>
      <template #cell-documents="{ row }"><div v-for="document in row.documents" :key="document.code" class="driver-document"><span>{{ document.name }}</span><DueDate :date="document.expiresOn" :label="document.name" :editable="canEdit" :on-save="value => saveDate(row, document, value)" /></div></template>
      <template #cell-action="{ row }"><Button v-if="canEdit" variant="text" size="sm" @click="edit(row)">編輯</Button></template>
      <template #empty><EmptyState title="尚未登記司機" desc="新增司機後即可登記到牌照並追蹤證件到期。"><Button v-if="canEdit" size="sm" @click="edit(null)">新增司機</Button></EmptyState></template>
    </DataTable>
  </section>
  <FormDialog :open="open" :title="editingId ? '編輯司機' : '新增司機'" :saving="saving" @close="open = false; error = ''" @submit="save">
    <Field label="姓名" required><TextInput v-model="form.name" /></Field><Field label="電話"><TextInput v-model="form.phone" /></Field><Field label="香港身份證號碼"><TextInput v-model="form.hkIdNo" /></Field><Field label="回鄉證號碼"><TextInput v-model="form.homeReturnPermitNo" /></Field><Field label="備註"><TextInput v-model="form.notes" multiline /></Field><p v-if="error" class="error" role="alert">{{ error }}</p>
  </FormDialog>
</template>
