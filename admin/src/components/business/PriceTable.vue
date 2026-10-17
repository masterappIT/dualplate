<script setup>
import { computed, ref, watch } from 'vue'
import { api, rentMoney, rentCents } from '../../api'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Modal from '../ui/Modal.vue'
import Field from '../ui/Field.vue'
import Select from '../ui/Select.vue'
import TextInput from '../ui/TextInput.vue'

// 價目表（docs/tasks/scope-items-design.md §5）：沒有 customerId 時是公司的預設價目；有 customerId 時是該客戶的收費，
// 與預設不同的標「特別價」，可恢復預設。只限管理者。
const props = defineProps({ customerId: { type: String, default: '' } })
const emit = defineEmits(['saved', 'error'])
const data = ref(null), loading = ref(false), problem = ref(''), editing = ref(null), form = ref({}), saving = ref(false), formError = ref('')
const path = computed(() => props.customerId ? `/customers/${props.customerId}/prices` : '/price-list')
async function load() { loading.value = true; problem.value = ''; try { data.value = await api(path.value) } catch (error) { problem.value = error.message } finally { loading.value = false } }
watch(path, load, { immediate: true })

const order = ['hk', 'mo', 'cn', 'company', 'plate', 'job']
const sections = computed(() => !data.value ? [] : order.map(category => ({ category, label: data.value.categories[category], items: data.value.items.filter(item => item.category === category) })).filter(section => section.items.length))
function priceText(price) {
  if (price.billing === 'per_time') return price.amount ? `${rentMoney(price.amount, price.currency)}／次` : '按次收費（未定價）'
  return data.value.billings[price.billing]
}
const toneOf = price => price.billing === 'per_time' ? price.amount ? 'info' : 'warning' : price.billing === 'free' ? 'neutral' : 'ok'
const currencyOptions = [{ value: 'HKD', label: '港幣 HKD' }, { value: 'RMB', label: '人民幣 RMB' }, { value: 'MOP', label: '澳門幣 MOP' }]
const billingOptions = computed(() => Object.entries(data.value?.billings || {}).map(([value, label]) => ({ value, label })))

function edit(item, route) {
  const price = item.prices[route]
  editing.value = { item, route, price }
  form.value = { billing: price.billing, currency: price.currency || (route === '粵澳' ? 'MOP' : 'HKD'), amount: price.amount ? (price.amount / 100).toFixed(2) : '' }
  formError.value = ''
}
async function submit(body) {
  saving.value = true; formError.value = ''
  try { data.value = await api(path.value, 'PUT', { code: editing.value.item.code, route: editing.value.route, ...body }); editing.value = null; emit('saved', props.customerId ? '客戶收費已更新' : '價目表已更新') }
  catch (error) { formError.value = error.message }
  finally { saving.value = false }
}
function save() {
  if (form.value.billing !== 'per_time') return submit({ billing: form.value.billing })
  const amount = rentCents(form.value.amount)
  if (!amount) { formError.value = '請填寫金額（最多兩位小數）'; return }
  return submit({ billing: 'per_time', currency: form.value.currency, amount })
}
</script>
<template>
  <p v-if="loading && !data">載入收費中…</p>
  <p v-else-if="problem" class="error" role="alert">{{ problem }} <Button size="sm" @click="load">重試</Button></p>
  <section v-for="section in sections" :key="section.category" class="price-section">
    <h3>{{ section.label }}</h3>
    <div v-for="item in section.items" :key="item.code" class="record-row price-row">
      <strong>{{ item.name }}</strong>
      <div class="price-cells">
        <button v-for="route in item.routes" :key="route" type="button" class="price-cell" :aria-label="`${item.name}${route ? ` · ${route}` : ''}：${priceText(item.prices[route])}，按下修改`" @click="edit(item, route)">
          <small v-if="route">{{ route }}</small>
          <Tag :tone="toneOf(item.prices[route])">{{ priceText(item.prices[route]) }}</Tag>
          <Tag v-if="customerId && item.prices[route].source === 'customer'" tone="warning">特別價</Tag>
        </button>
      </div>
    </div>
  </section>
  <Modal :open="!!editing" :title="`${editing?.item.name || ''}${editing?.route ? ` · ${editing.route}` : ''}`" :sub="customerId ? '只改這位客戶；其他客戶沿用價目表。' : '所有客戶的預設；客戶的特別價不受影響。'" @close="editing = null">
    <Field label="收費方式"><Select v-model="form.billing" :options="billingOptions" /></Field>
    <template v-if="form.billing === 'per_time'">
      <Field label="幣種"><Select v-model="form.currency" :options="currencyOptions" /></Field>
      <Field label="每次金額" required><TextInput v-model="form.amount" inputmode="decimal" placeholder="例如 3000" /></Field>
    </template>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
    <template #footer><Button @click="editing = null">取消</Button><Button v-if="customerId && editing?.price.source === 'customer'" :disabled="saving" @click="submit({ reset: true })">恢復預設</Button><Button variant="primary" :disabled="saving" @click="save">{{ saving ? '儲存中…' : '儲存' }}</Button></template>
  </Modal>
</template>
