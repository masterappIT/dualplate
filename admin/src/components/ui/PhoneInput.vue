<!-- 本產品新增：客戶登入手機，區號（香港／澳門／內地）＋號碼；v-model 是「+區號號碼」，未填號碼時為空字串。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Select from './Select.vue'
import TextInput from './TextInput.vue'

const props = defineProps<{ modelValue?: string | null; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const areaCodes = [
  { value: '+852', label: '香港 +852' },
  { value: '+853', label: '澳門 +853' },
  { value: '+86', label: '內地 +86' },
]

// 區號放在本地：號碼還沒填時，選了的區號也要保留
const code = ref('+852'), number = ref('')
watch(() => props.modelValue, value => {
  const raw = String(value || '').replace(/[\s-]/g, '')
  if (raw === `${code.value}${number.value}`) return
  const found = areaCodes.find(item => raw.startsWith(item.value))
  if (found) code.value = found.value
  number.value = found ? raw.slice(found.value.length) : raw.replace(/[^\d]/g, '')
}, { immediate: true })
const placeholder = computed(() => code.value === '+86' ? '11 位手機號碼' : '8 位手機號碼')

function emitValue() { emit('update:modelValue', number.value ? `${code.value}${number.value}` : '') }
function setCode(value: unknown) { code.value = String(value); emitValue() }
function setNumber(value: unknown) { number.value = String(value ?? '').replace(/[^\d]/g, ''); emitValue() }
</script>

<template>
  <div class="phone-input">
    <Select class="phone-code" label="區號" :model-value="code" :options="areaCodes" :disabled="disabled" @update:model-value="setCode" />
    <TextInput type="tel" :model-value="number" :placeholder="placeholder" :disabled="disabled" autocomplete="tel-national" @update:model-value="setNumber" />
  </div>
</template>
