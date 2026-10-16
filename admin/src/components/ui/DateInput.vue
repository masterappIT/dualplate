<script setup lang="ts">
import { ref, watch } from 'vue'
// 日期一律顯示 YYYY-MM-DD：可直接鍵入，也可按日曆圖示用系統日期選擇器。
const props = defineProps<{ modelValue?: string | null; disabled?: boolean; label?: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()
const text = ref(props.modelValue || '')
const picker = ref<HTMLInputElement | null>(null)
watch(() => props.modelValue, value => { text.value = value || '' })
function typed(value: string) {
  const clean = value.replace(/[^\d-]/g, '').slice(0, 10)
  text.value = clean
  if (!clean) emit('update:modelValue', '')
  else if (/^\d{4}-\d{2}-\d{2}$/.test(clean) && !Number.isNaN(new Date(`${clean}T00:00:00`).getTime())) emit('update:modelValue', clean)
}
function restore() { if (text.value && text.value !== (props.modelValue || '')) text.value = props.modelValue || '' }
function openPicker() { const input = picker.value; if (!input || props.disabled) return; try { input.showPicker() } catch { input.focus(); input.click() } }
</script>
<template><span class="date-input" :class="{ 'is-disabled': disabled }"><input class="date-text num" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" maxlength="10" :value="text" :disabled="disabled" :aria-label="label || '日期（YYYY-MM-DD）'" @input="typed(($event.target as HTMLInputElement).value)" @blur="restore" /><button type="button" class="date-pick" :disabled="disabled" :aria-label="`選擇${label || '日期'}`" @click="openPicker"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.4" fill="none" /></svg></button><input ref="picker" class="date-native" type="date" tabindex="-1" aria-hidden="true" :value="modelValue || ''" @change="typed(($event.target as HTMLInputElement).value)" /></span></template>
