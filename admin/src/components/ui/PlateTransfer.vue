<script setup>
import { ref, watch, computed } from 'vue'
import { api } from '../../api'
import Button from './Button.vue'
import Modal from './Modal.vue'
import Field from './Field.vue'
import TextInput from './TextInput.vue'
import DateInput from './DateInput.vue'
import Checkbox from './Checkbox.vue'
import PlateChip from './PlateChip.vue'
const props = defineProps({ plate: { type: Object, required: true }, customers: { type: Array, required: true }, groups: { type: Array, required: true }, vehicles: { type: Array, required: true } })
const emit = defineEmits(['saved', 'error'])
const open = ref(false), history = ref([]), toCustomerId = ref(''), transferredOn = ref(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })), notes = ref(''), otherPlates = ref([]), included = ref([]), busy = ref(false), problem = ref('')
const group = computed(() => props.groups.find(item => item.id === props.plate.group_id))
const attachedVehicles = computed(() => props.vehicles.filter(item => [props.plate, ...(group.value?.plates || [])].some(plate => plate.vehicle_id === item.id)))
async function load() { try { history.value = await api(`/plates/${props.plate.id}/transfers`) } catch (error) { problem.value = error.message } }
watch(() => props.plate.id, load, { immediate: true })
async function transfer() { busy.value = true; problem.value = ''; try { await api(`/plates/${props.plate.id}/transfer`, 'POST', { toCustomerId: toCustomerId.value, transferredOn: transferredOn.value, notes: notes.value, includePlateIds: included.value }); open.value = false; otherPlates.value = []; included.value = []; await load(); emit('saved', '牌照已轉讓') } catch (error) { if (error.status === 409 && error.details?.otherPlates) otherPlates.value = error.details.otherPlates; problem.value = error.message; emit('error', error) } finally { busy.value = false } }
</script>
<template>
  <section class="panel"><div class="panel-head"><div><h2>轉讓歷史</h2><p>牌照與所屬公司組一併轉讓，舊工單留在原客戶。</p></div><Button @click="open = true">轉讓給其他客戶</Button></div><div v-for="entry in history" :key="entry.id" class="record-row">{{ entry.transferred_on }} · {{ entry.from_name }} → {{ entry.to_name }} · {{ entry.notes || '無備註' }}</div><p v-if="!history.length">尚未轉讓過。</p><p v-if="problem" role="alert">{{ problem }}</p></section>
  <Modal :open="open" title="轉讓牌照" sub="請核對一併搬移的資料，確認後舊工單仍在原客戶。" @close="open = false"><Field label="接收客戶" required><select v-model="toCustomerId"><option value="">請選擇</option><option v-for="customer in customers.filter(item => item.id !== plate.customer_id)" :key="customer.id" :value="customer.id">{{ customer.name }}</option></select></Field><Field label="轉讓日期" required><DateInput v-model="transferredOn" label="轉讓日期" /></Field><Field label="備註"><TextInput v-model="notes" multiline /></Field><div class="record-row">轉讓牌照：<PlateChip :plate="plate.mainland_plate || plate.local_plate" :route="plate.route" /></div><div class="record-row">公司組：{{ group?.name || '未分組' }}；公司：{{ group?.companies?.map(item => item.name).join('、') || '沒有' }}</div><div class="record-row">關聯車輛：{{ attachedVehicles.map(item => item.plate).join('、') || '沒有' }}</div><div v-if="otherPlates.length"><p>同組另有牌照，請勾選一併轉讓：</p><label v-for="item in otherPlates" :key="item.id" class="record-row"><Checkbox :model-value="included.includes(item.id)" @update:model-value="included = $event ? [...included, item.id] : included.filter(id => id !== item.id)" />{{ item.label }}</label></div><p v-if="problem" role="alert">{{ problem }}</p><template #footer><Button @click="open = false">取消</Button><Button variant="primary" :disabled="busy || !toCustomerId || !transferredOn || otherPlates.some(item => !included.includes(item.id))" @click="transfer">{{ busy ? '轉讓中…' : '確認轉讓' }}</Button></template></Modal>
</template>
