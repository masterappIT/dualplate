<template>
  <PageHeader title="設定" desc="到期事項、官方來源、業務範本、價目表、員工、服務條款與帳號安全。" />
  <Segmented :model-value="tab" :options="options" label="設定分頁" @update:model-value="changeTab" />
  <Rules v-if="tab === 'rules'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <Sources v-else-if="tab === 'sources'" />
  <Staff v-else-if="tab === 'staff'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <AuditLog v-else-if="tab === 'audit'" @error="$emit('error', $event)" />
  <section v-else-if="tab === 'prices'" class="panel"><div class="panel-head"><div><h2>價目表</h2><p>每件事和每種按次業務的預設收費；粵港、粵澳分開。直接在表內修改，改完在表底按「儲存」。客戶的特別價在客戶詳情「委託範圍」的「收費方式」頁設定。</p></div></div><PriceTable @saved="$emit('saved', $event)" @error="$emit('error', $event)" /></section>
  <TermsSettings v-else-if="tab === 'terms'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <MyAccount v-else-if="tab === 'account'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <WorkTemplates v-else @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
</template>
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import Segmented from '../components/ui/Segmented.vue'
import Rules from './Rules.vue'
import Sources from './Sources.vue'
import Staff from './Staff.vue'
import WorkTemplates from './WorkTemplates.vue'
import AuditLog from './AuditLog.vue'
import MyAccount from './MyAccount.vue'
import TermsSettings from './TermsSettings.vue'
import PriceTable from '../components/business/PriceTable.vue'
import { user } from '../api'
defineEmits(['saved', 'error'])
const route = useRoute()
const router = useRouter()
const tab = computed(() => ['staff', 'audit', 'prices'].includes(route.params.tab) && user()?.role !== 'admin' ? 'rules' : ['sources', 'staff', 'templates', 'audit', 'account', 'prices', 'terms'].includes(route.params.tab) ? route.params.tab : 'rules')
const options = computed(() => [{ value: 'rules', label: '到期事項' }, { value: 'sources', label: '官方來源' }, { value: 'templates', label: '業務範本' }, ...(user()?.role === 'admin' ? [{ value: 'prices', label: '價目表' }, { value: 'staff', label: '員工' }, { value: 'audit', label: '操作記錄' }] : []), { value: 'terms', label: '服務條款' }, { value: 'account', label: '我的帳號' }])
function changeTab(value) { router.push(`/settings/${value}`) }
</script>
