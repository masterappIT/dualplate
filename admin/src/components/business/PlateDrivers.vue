<script setup>
import { computed, ref, watch } from 'vue'
import { api, user } from '../../api'
import Button from '../ui/Button.vue'
import Modal from '../ui/Modal.vue'
import FormDialog from './FormDialog.vue'
import Field from '../ui/Field.vue'
import TextInput from '../ui/TextInput.vue'
import Select from '../ui/Select.vue'
import Tag from '../ui/Tag.vue'

const props = defineProps({ plateId: String, customerId: String })
const emit = defineEmits(['saved'])
const canEdit = user()?.role === 'admin' || user()?.role === 'staff'
const registration = ref(null), available = ref([]), loading = ref(false), error = ref(''), saving = ref(false), open = ref(false), creating = ref(false)
const selection = ref({ main: '', deputies: ['', ''] }), newDriver = ref({ name: '', phone: '' })
const options = computed(() => [{ value: '', label: '不登記' }, ...available.value.map(driver => ({ value: driver.id, label: driver.name }))])
async function load() { if (!props.plateId || !props.customerId) return; loading.value = true; error.value = ''; try { const [plate, drivers] = await Promise.all([api(`/plates/${props.plateId}/drivers`), api(`/drivers?customerId=${encodeURIComponent(props.customerId)}`)]); registration.value = plate; available.value = drivers } catch (cause) { error.value = `未能取得司機登記：${cause.message}` } finally { loading.value = false } }
watch(() => [props.plateId, props.customerId], load, { immediate: true })
function start() { const rows = registration.value?.drivers || []; selection.value = { main: rows.find(driver => driver.role === '主')?.driverId || '', deputies: [...rows.filter(driver => driver.role === '副').map(driver => driver.driverId), '', ''].slice(0, 2) }; error.value = ''; open.value = true }
async function save() { const chosen = [selection.value.main, ...selection.value.deputies].filter(Boolean); if (new Set(chosen).size !== chosen.length) { error.value = '同一位司機不能重複登記'; return } saving.value = true; error.value = ''; try { registration.value = await api(`/plates/${props.plateId}/drivers`, 'PUT', { drivers: chosen.map(driverId => ({ driverId, role: driverId === selection.value.main ? '主' : '副' })) }); open.value = false; emit('saved', '司機登記已更新') } catch (cause) { error.value = cause.message } finally { saving.value = false } }
async function create() { if (!newDriver.value.name.trim()) { error.value = '請填寫司機姓名'; return } saving.value = true; error.value = ''; try { const result = await api('/drivers', 'POST', { customerId: props.customerId, name: newDriver.value.name.trim(), phone: newDriver.value.phone }); available.value.push(result); const vacant = selection.value.deputies.findIndex(id => !id); if (!selection.value.main) selection.value.main = result.id; else if (vacant !== -1) selection.value.deputies[vacant] = result.id; creating.value = false; newDriver.value = { name: '', phone: '' }; emit('saved', '司機已新增，請儲存牌照登記') } catch (cause) { error.value = cause.message } finally { saving.value = false } }
async function sync() { saving.value = true; error.value = ''; try { registration.value = await api(`/plates/${props.plateId}/drivers/sync-from-card`, 'POST'); await load(); emit('saved', '司機登記已按批文卡同步') } catch (cause) { error.value = cause.message } finally { saving.value = false } }
defineExpose({ load })
</script>
<template>
  <section class="panel"><div class="panel-head"><div><h2>司機</h2><p>主司機最多一位，副司機最多兩位。</p></div><Button v-if="canEdit" size="sm" @click="start">更換司機</Button></div>
    <p v-if="loading" role="status">正在載入司機登記…</p><p v-if="error && !open && !creating" class="error" role="alert">{{ error }} <Button size="sm" @click="load">重試</Button></p>
    <p v-if="registration?.mismatch" class="warning">批文卡駕駛人與司機登記不一致 <Button v-if="canEdit" size="sm" :loading="saving" @click="sync">同步</Button></p>
    <div v-for="driver in registration?.drivers || []" :key="driver.driverId" class="record-row"><span><Tag :tone="driver.role === '主' ? 'info' : 'neutral'">{{ driver.role }}司機</Tag> {{ driver.name }}</span><span class="num">{{ driver.phone || '未填電話' }} · 登記日期 {{ driver.registeredOn || '未記錄' }}</span></div>
    <p v-if="registration && !registration.drivers.length" class="empty">尚未登記司機 <Button v-if="canEdit" size="sm" @click="start">更換司機</Button></p>
  </section>
  <FormDialog :open="open" title="更換司機" sub="從客戶司機名單選擇；新增司機後仍需儲存登記。" :saving="saving" @close="open = false" @submit="save">
    <Field label="主司機"><Select v-model="selection.main" :options="options" filterable /></Field><Field label="副司機一"><Select v-model="selection.deputies[0]" :options="options" filterable /></Field><Field label="副司機二"><Select v-model="selection.deputies[1]" :options="options" filterable /></Field><Button size="sm" @click="creating = true">新增司機</Button><p v-if="error" class="error" role="alert">{{ error }}</p>
  </FormDialog>
  <Modal :open="creating" title="新增司機" @close="creating = false"><div class="form-grid"><Field label="姓名" required><TextInput v-model="newDriver.name" /></Field><Field label="電話"><TextInput v-model="newDriver.phone" /></Field></div><p v-if="error" class="error" role="alert">{{ error }}</p><template #footer><Button @click="creating = false">取消</Button><Button variant="primary" :loading="saving" @click="create">新增司機</Button></template></Modal>
</template>
