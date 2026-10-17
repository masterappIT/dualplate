<script setup>
import { computed, ref, watch } from 'vue'
import { api, rentCents } from '../../api'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Select from '../ui/Select.vue'
import TextInput from '../ui/TextInput.vue'

// 價目表（docs/tasks/scope-items-design.md §5）：沒有 customerId 時是公司的預設價目；有 customerId 時是該客戶的收費，
// 與預設不同的標「特別價」，可恢復預設。只限管理者。
// 每段一張表，粵港／粵澳固定成欄；每格就地改收費方式（按次收費時旁邊填幣種與金額），改動累計後在表底一次儲存。
const props = defineProps({ customerId: { type: String, default: '' } })
const emit = defineEmits(['saved', 'error'])
const data = ref(null), loading = ref(false), problem = ref(''), pending = ref({}), saving = ref(false), saveError = ref(''), invalid = ref([])
const path = computed(() => props.customerId ? `/customers/${props.customerId}/prices` : '/price-list')
async function load() { loading.value = true; problem.value = ''; try { data.value = await api(path.value); pending.value = {}; invalid.value = [] } catch (error) { problem.value = error.message } finally { loading.value = false } }
watch(path, load, { immediate: true })

const order = ['hk', 'mo', 'cn', 'company', 'plate', 'job']
const sections = computed(() => !data.value ? [] : order.map(category => {
  const items = data.value.items.filter(item => item.category === category)
  const routes = [...new Set(items.flatMap(item => item.routes))]
  return { category, label: data.value.categories[category], items, routes }
}).filter(section => section.items.length))
const routeTitle = route => route || '收費'
const currencyOptions = [{ value: 'HKD', label: 'HKD' }, { value: 'RMB', label: 'RMB' }, { value: 'MOP', label: 'MOP' }]
const billingOptions = computed(() => Object.entries(data.value?.billings || {}).map(([value, label]) => ({ value, label })))

const keyOf = (item, route) => `${item.code}|${route}`
const yuan = amount => amount ? (amount / 100).toFixed(2).replace(/\.00$/, '') : ''
const saved = (item, route) => { const price = item.prices[route]; return { billing: price.billing, currency: price.currency || (route === '粵澳' ? 'MOP' : 'HKD'), amount: yuan(price.amount) } }
function value(item, route) { const change = pending.value[keyOf(item, route)]; return change && !change.reset ? change : saved(item, route) }
const same = (a, b) => a.billing === b.billing && (a.billing !== 'per_time' || (a.currency === b.currency && String(a.amount) === String(b.amount)))
function change(item, route, patch) {
  const key = keyOf(item, route), next = { ...value(item, route), ...patch }
  const copy = { ...pending.value }
  if (same(next, saved(item, route))) delete copy[key]; else copy[key] = { item, route, ...next }
  pending.value = copy; invalid.value = invalid.value.filter(entry => entry !== key)
  if (!invalid.value.length) saveError.value = ''
}
function reset(item, route) { pending.value = { ...pending.value, [keyOf(item, route)]: { item, route, reset: true } } }
const isSpecial = (item, route) => props.customerId && item.prices[route]?.source === 'customer' && !pending.value[keyOf(item, route)]?.reset
const pendingCount = computed(() => Object.keys(pending.value).length)

async function saveAll() {
  saveError.value = ''
  invalid.value = Object.entries(pending.value).filter(([, entry]) => !entry.reset && entry.billing === 'per_time' && !rentCents(entry.amount)).map(([key]) => key)
  if (invalid.value.length) { saveError.value = `有 ${invalid.value.length} 項按次收費未填金額（最多兩位小數）`; return }
  saving.value = true
  let done = 0
  try {
    for (const entry of Object.values(pending.value)) {
      const body = entry.reset ? { reset: true } : entry.billing === 'per_time' ? { billing: 'per_time', currency: entry.currency, amount: rentCents(entry.amount) } : { billing: entry.billing }
      data.value = await api(path.value, 'PUT', { code: entry.item.code, route: entry.route, ...body })
      done += 1
    }
    pending.value = {}
    emit('saved', props.customerId ? `已更新 ${done} 項客戶收費` : `價目表已更新 ${done} 項`)
  } catch (error) {
    saveError.value = `已儲存 ${done} 項；其餘未儲存：${error.message}`
    await load()
  } finally { saving.value = false }
}
</script>
<template>
  <p v-if="loading && !data">載入收費中…</p>
  <p v-else-if="problem" class="error" role="alert">{{ problem }} <Button size="sm" @click="load">重試</Button></p>
  <section v-for="section in sections" :key="section.category" class="price-section">
    <h3>{{ section.label }}</h3>
    <div class="price-grid" role="table" :aria-label="section.label" :style="{ '--routes': section.routes.length }">
      <div class="price-grid-row price-grid-head" role="row"><div role="columnheader">事項</div><div v-for="route in section.routes" :key="route" role="columnheader">{{ routeTitle(route) }}</div></div>
      <div v-for="item in section.items" :key="item.code" class="price-grid-row" role="row">
        <div class="price-grid-name" role="rowheader">{{ item.name }}</div>
        <div v-for="route in section.routes" :key="route" class="price-edit" :class="{ 'is-pending': pending[keyOf(item, route)], 'is-invalid': invalid.includes(keyOf(item, route)) }" role="cell" :data-label="routeTitle(route)">
          <template v-if="item.routes.includes(route)">
            <div class="price-edit-fields">
              <Select :model-value="value(item, route).billing" :options="billingOptions" :label="`${item.name}${route ? ` · ${route}` : ''}收費方式`" :disabled="saving" @update:model-value="change(item, route, { billing: $event })" />
              <template v-if="value(item, route).billing === 'per_time'">
                <Select class="price-currency" :model-value="value(item, route).currency" :options="currencyOptions" :label="`${item.name}${route ? ` · ${route}` : ''}幣種`" :disabled="saving" @update:model-value="change(item, route, { currency: $event })" />
                <TextInput class="price-amount" :model-value="value(item, route).amount" inputmode="decimal" placeholder="每次金額" :aria-label="`${item.name}${route ? ` · ${route}` : ''}每次金額`" :disabled="saving" @update:model-value="change(item, route, { amount: $event })" />
              </template>
            </div>
            <div v-if="isSpecial(item, route) || pending[keyOf(item, route)]?.reset" class="price-edit-note"><Tag v-if="isSpecial(item, route)" tone="warning">特別價</Tag><button v-if="isSpecial(item, route)" type="button" class="text-button" :disabled="saving" @click="reset(item, route)">恢復預設</button><span v-if="pending[keyOf(item, route)]?.reset">儲存後恢復預設價</span></div>
          </template>
          <span v-else class="price-na">不適用</span>
        </div>
      </div>
    </div>
  </section>
  <div v-if="pendingCount || saveError" class="price-savebar" role="region" aria-label="儲存收費">
    <span v-if="pendingCount">{{ pendingCount }} 項待儲存</span>
    <span v-if="saveError" class="error" role="alert">{{ saveError }}</span>
    <Button v-if="pendingCount" :disabled="saving" @click="pending = {}; invalid = []; saveError = ''">放棄</Button>
    <Button v-if="pendingCount" variant="primary" :loading="saving" @click="saveAll">儲存</Button>
  </div>
</template>
