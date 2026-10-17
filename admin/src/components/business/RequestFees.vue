<script setup>
import { computed, ref, watch } from 'vue'
import { rentCents } from '../../api'
import Button from '../ui/Button.vue'
import Field from '../ui/Field.vue'

const props = defineProps({ expected: { type: Array, default: () => [] }, basis: { type: String, default: '' } })
const emit = defineEmits(['change'])
const basisText = computed(() => ({ quote: '已帶入報價的預計收費；結案前可調整。', price: '已按這位客戶的價目帶入代辦費；結案前可調整。', annual: '按價目，這項業務含在年費內，不另收；如要收費請取消略過。', free: '按價目，這項業務不收費；如要收費請取消略過。' })[props.basis] || (props.expected.length ? '已帶入報價的預計收費；結案前可調整。' : '填寫這張工單要收的代辦費、規費或代墊；不收費請勾選「略過本單收費」。'))
const entries = ref([]), skip = ref(false)
watch(() => props.expected, value => {
  entries.value = value.length ? value.map(item => ({ kind: item.kind, currency: item.currency, amount: (item.amount / 100).toFixed(2), description: item.description })) : [{ kind: 'service', currency: 'HKD', amount: '', description: '' }]
  // 不預設略過：結案時要麼填收費，要麼主動選「略過」，避免漏收
  // 價目表定為年費內或不收的業務，預設略過；其他情況不預設略過，結案時要麼填收費，要麼主動略過，避免漏收
  skip.value = ['annual', 'free'].includes(props.basis); emit('change', { fees: entries.value, skip: skip.value })
}, { immediate: true })
watch([entries, skip], () => emit('change', { fees: entries.value, skip: skip.value }), { deep: true })
defineExpose({ payload() {
  if (skip.value) return { skipFees: true }
  const fees = entries.value.map(item => ({ ...item, amount: rentCents(item.amount) }))
  if (fees.some(item => !item.amount || !item.description?.trim())) throw new Error('請填妥本單每筆收費的描述及金額，或選擇略過收費。')
  return { fees }
} })
</script>
<template><section class="fee-close"><h3>本單收費</h3><p>{{ basisText }}</p><label class="fee-check"><input v-model="skip" type="checkbox" /> 略過本單收費</label><template v-if="!skip"><div v-for="(item, index) in entries" :key="index" class="fee-part"><div class="panel-head"><div><h3>第 {{ index + 1 }} 筆</h3></div><Button size="sm" @click="entries.splice(index, 1)">移除</Button></div><Field label="類別"><select v-model="item.kind"><option value="service">代辦費</option><option value="gov_fee">政府規費</option><option value="advance">代墊</option></select></Field><Field label="描述"><input v-model="item.description" /></Field><Field label="金額（元）"><input v-model="item.amount" inputmode="decimal" /></Field><Field label="幣種"><select v-model="item.currency"><option>HKD</option><option>RMB</option><option>MOP</option></select></Field></div><Button size="sm" @click="entries.push({ kind: 'service', currency: 'HKD', amount: '', description: '' })">新增一筆</Button></template></section></template>
