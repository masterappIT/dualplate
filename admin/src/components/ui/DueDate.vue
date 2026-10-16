<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DateInput from './DateInput.vue'
const props = defineProps<{ date?: string | null; editable?: boolean; saving?: boolean; label?: string; onSave?: (value: string) => Promise<boolean> }>()
const emit = defineEmits<{ (event: 'save', value: string): void }>()
const editing = ref(false)
const draft = ref(props.date || '')
const busy = ref(false)
watch(() => props.date, value => { draft.value = value || '' })
const days = computed(() => props.date ? Math.ceil((new Date(`${props.date.slice(0, 10)}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000) : null)
const status = computed(() => days.value === null ? 'muted' : days.value < 0 ? 'overdue' : days.value <= 30 ? 'due' : 'ok')
const remaining = computed(() => days.value === null ? '待錄入' : days.value < 0 ? `逾期 ${-days.value} 天` : days.value === 0 ? '今天到期' : `還有 ${days.value} 天`)
async function save() {
  if (busy.value) return
  if (draft.value === (props.date || '')) { editing.value = false; return }
  if (!props.onSave) { emit('save', draft.value); editing.value = false; return }
  busy.value = true
  try {
    if (await props.onSave(draft.value)) editing.value = false
    else draft.value = props.date || ''
  } catch { draft.value = props.date || '' }
  finally { busy.value = false }
}
</script>
<template><span :class="['due-date', `due-${status}`]" :aria-label="label"><template v-if="editable && editing"><DateInput v-model="draft" :disabled="busy" :label="label" /><button type="button" class="due-action" :disabled="busy" @click="save">{{ busy || saving ? '儲存中…' : '儲存' }}</button><button type="button" class="due-action" :disabled="busy" @click="editing = false; draft = date || ''">取消</button></template><button v-else-if="editable" type="button" class="due-body" :disabled="saving" :title="'點擊修改' + (label ? '：' + label : '')" @click="editing = true"><span class="due-day">{{ date?.slice(0, 10) || '待錄入' }}</span><span v-if="date" class="due-left">{{ remaining }}</span></button><span v-else class="due-body"><span class="due-day">{{ date?.slice(0, 10) || '待錄入' }}</span><span v-if="date" class="due-left">{{ remaining }}</span></span></span></template>
