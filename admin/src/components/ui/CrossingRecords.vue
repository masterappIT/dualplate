<script setup>
import { ref, watch } from 'vue'
import { api } from '../../api'
import Button from './Button.vue'
import Switch from './Switch.vue'
import DateInput from './DateInput.vue'
import DueDate from './DueDate.vue'
const props = defineProps({ plateId: { type: String, required: true } })
const emit = defineEmits(['saved', 'error'])
const summary = ref(null), date = ref(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })), loading = ref(false), busy = ref(false), problem = ref('')
async function load() { loading.value = true; try { summary.value = await api(`/plates/${props.plateId}/crossings`); problem.value = '' } catch (error) { problem.value = error.message } finally { loading.value = false } }
watch(() => props.plateId, load, { immediate: true })
async function update(path, method, body) { busy.value = true; try { summary.value = await api(`/plates/${props.plateId}/${path}`, method, body); problem.value = ''; emit('saved', '過關記錄已更新') } catch (error) { problem.value = error.message; emit('error', error) } finally { busy.value = false } }
</script>
<template>
  <section class="panel"><div class="panel-head"><div><h2>過關記錄</h2><p>90 天提醒預設關閉，逐個牌照開啟。</p></div></div>
    <p v-if="loading">載入過關記錄中…</p><div v-else-if="problem && !summary" class="record-row">{{ problem }} <Button @click="load">重試</Button></div>
    <template v-else-if="summary"><Switch :model-value="summary.enabled" :disabled="busy" label="90 天過關提醒" @update:model-value="update('crossing-reminder', 'PUT', { enabled: $event })">{{ summary.enabled ? '提醒已開啟' : '提醒未開啟' }}</Switch><div class="record-row"><span>上次過關：{{ summary.lastCrossedOn || '尚無記錄' }}</span><span class="label-due">下次應過關<DueDate v-if="summary.enabled && summary.nextDueOn" :date="summary.nextDueOn" /><span v-else>—</span></span></div><div class="record-row"><DateInput v-model="date" label="過關日期" /><Button :disabled="busy || !date" @click="update('crossings', 'POST', { crossedOn: date })">新增過關記錄</Button></div><div v-for="entry in summary.crossings" :key="entry.id" class="record-row"><span>{{ entry.crossedOn }} · {{ entry.source === 'admin' ? '員工錄入' : '客戶錄入' }}</span><button class="text-button" :disabled="busy" @click="update(`crossings/${entry.id}`, 'DELETE')">刪除</button></div><p v-if="!summary.crossings.length">尚無記錄，可先錄入最近一次過關日期。</p></template><p v-if="problem" role="alert">{{ problem }}</p>
  </section>
</template>
