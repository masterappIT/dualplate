<script setup lang="ts">
defineProps<{ modelValue?: string | null; disabled?: boolean; label?: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()
</script>
<template><input type="date" class="date-input" :value="modelValue || ''" :disabled="disabled" :aria-label="label || '選擇日期'" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" /></template>
