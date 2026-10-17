<script setup>
import { computed } from 'vue'
import CompanyName from './CompanyName.vue'
import KeyValue from '../ui/KeyValue.vue'
import Button from '../ui/Button.vue'
import ExpiryPanel from '../ExpiryPanel.vue'
// 公司卡：名稱（香港公司下附英文名稱）、狀態、編輯；登記資料用 KeyValue；所有到期日只在下方「到期事項」填。
const props = defineProps({ company: { type: Object, required: true }, deadlines: Array, editable: Boolean, showJurisdiction: Boolean })
const emit = defineEmits(['edit', 'saved', 'error'])
const facts = computed(() => {
  const company = props.company
  const items = props.showJurisdiction ? [{ label: '司法區', value: `${company.jurisdiction}公司` }] : []
  if (company.jurisdiction === '香港') items.push({ label: '商業登記號碼（BR）', value: company.registration_no || '—' }, { label: '公司編號（CR）', value: company.company_number || '—' }, { label: '成立日期', value: company.incorporated_on || '—' }, { label: '下次周年申報（NAR1）', value: company.nar1DueOn || '成立日期待錄入' })
  else if (company.jurisdiction === '澳門') items.push({ label: '商業登記編號', value: company.registration_no || '—' }, { label: '成立日期', value: company.incorporated_on || '—' })
  else items.push({ label: '統一社會信用代碼', value: company.registration_no || '—' }, { label: '成立日期', value: company.incorporated_on || '—' }, { label: '納稅人類型', value: company.taxpayer_type || '—' })
  return items
})
const statusClass = computed(() => ({ '經營異常': 'warning', '註銷中': 'warning', '已註銷': 'dissolved' }[props.company.status] || ''))
</script>

<template>
  <article class="company-card" :class="{ 'company-dissolved': company.status === '已註銷' }">
    <header class="company-card-title"><CompanyName :company="company" /><div class="company-card-actions"><span class="company-status" :class="statusClass">{{ company.status || '存續' }}</span><Button v-if="editable" variant="text" size="sm" @click="emit('edit', company)">編輯</Button></div></header>
    <KeyValue :items="facts" />
    <ExpiryPanel compact owner-type="company" :owner-id="company.id" :deadlines="deadlines" @saved="emit('saved', $event)" @error="emit('error', $event)" />
  </article>
</template>
