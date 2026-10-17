<script setup>
import { ref, watch } from 'vue'
import { api, user } from '../../api'
import Button from './Button.vue'
import Tag from './Tag.vue'
import Modal from './Modal.vue'
import Field from './Field.vue'
import TextInput from './TextInput.vue'

const props = defineProps({ ownerType: { type: String, required: true }, ownerId: { type: String, required: true }, isSelf: Boolean })
const emit = defineEmits(['saved', 'error'])
const data = ref(null), active = ref(null), handler = ref('us'), providerName = ref(''), notes = ref(''), loading = ref(false), saving = ref(false), problem = ref('')
const handlerText = item => item.handler === 'client' ? '客戶自理' : item.handler === 'outsourced' ? `外包：${item.providerName}` : '我們做'
const previousHandler = entry => {
  const history = data.value?.history.filter(item => item.item === entry.item) || []
  return history[history.findIndex(item => item.id === entry.id) + 1] || { handler: 'us' }
}
async function load() {
  if (!props.ownerId || user()?.role !== 'admin') return
  loading.value = true
  try { data.value = await api(`/service-scopes?ownerType=${props.ownerType}&ownerId=${encodeURIComponent(props.ownerId)}`); problem.value = '' }
  catch (error) { problem.value = error.message }
  finally { loading.value = false }
}
watch(() => [props.ownerType, props.ownerId], load, { immediate: true })
function edit(item) { active.value = item; handler.value = item.handler; providerName.value = item.providerName; notes.value = item.notes; problem.value = '' }
async function save() {
  if (saving.value || !active.value) return
  saving.value = true
  try {
    data.value = await api('/service-scopes', 'PUT', { ownerType: props.ownerType, ownerId: props.ownerId, item: active.value.item, handler: handler.value, providerName: providerName.value, notes: notes.value })
    active.value = null; emit('saved', '委託範圍已更新')
  } catch (error) { problem.value = error.message; emit('error', error) }
  finally { saving.value = false }
}
</script>
<template>
  <section v-if="user()?.role === 'admin'" class="panel">
    <div class="panel-head"><div><h2>委託範圍</h2><p>逐件確認由誰辦理；要加或移除事項，到客戶詳情的「委託範圍」。更改會保留歷史。</p></div></div>
    <p v-if="loading">載入委託範圍中…</p>
    <div v-else-if="problem && !data" class="record-row">{{ problem }} <Button @click="load">重試</Button></div>
    <div v-for="item in data?.items || []" :key="item.item" class="record-row"><strong>{{ item.label }}<small v-if="item.groupLabel">{{ item.groupLabel }}</small></strong><Tag :tone="item.handler === 'client' ? 'neutral' : item.handler === 'outsourced' ? 'warning' : 'ok'">{{ handlerText(item) }}</Tag><button class="text-button" @click="edit(item)">修改</button></div>
    <details v-if="data?.history?.length"><summary>修改歷史（{{ data.history.length }}）</summary><div v-for="entry in data.history" :key="entry.id" class="record-row"><span>{{ entry.label }}：{{ handlerText(previousHandler(entry)) }} → {{ handlerText(entry) }}</span><small>{{ entry.updatedAt }} · 操作人 {{ entry.updatedBy || '系統' }} · {{ entry.endedOn ? '已結束' : '現行' }}</small></div></details>
  </section>
  <Modal :open="!!active" :title="`修改${active?.label || ''}委託範圍`" @close="active = null">
    <Field label="負責方"><select v-model="handler"><option value="us">我們做</option><option value="outsourced">外包</option><option v-if="!isSelf" value="client">客戶自理</option></select></Field>
    <Field v-if="handler === 'outsourced'" label="外包單位" required><TextInput v-model="providerName" /></Field>
    <Field label="備註"><TextInput v-model="notes" multiline /></Field>
    <p v-if="problem" role="alert">{{ problem }}</p>
    <template #footer><Button @click="active = null">取消</Button><Button variant="primary" :disabled="saving || handler === 'outsourced' && !providerName.trim()" @click="save">{{ saving ? '儲存中…' : '儲存' }}</Button></template>
  </Modal>
</template>
