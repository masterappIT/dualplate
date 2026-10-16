<!-- 移植自 scaffold-vue/src/components/ui/Switch.vue，已改：採用產品樣式令牌。 -->
<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  disabled?: boolean
  label?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()
function change(event: Event) {
  const input = event.target as HTMLInputElement
  emit('update:modelValue', input.checked)
  input.checked = props.modelValue
}
</script>

<template>
  <label :class="['switch', modelValue && 'is-on', disabled && 'is-disabled']">
    <input
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled"
      :aria-checked="modelValue"
      :aria-label="label || '開關'"
      @change="change"
    />
    <span class="switch-track"><span class="switch-knob" /></span>
    <slot />
  </label>
</template>
