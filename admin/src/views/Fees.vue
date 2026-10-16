<script setup lang="ts">
import FeeLedger from '../components/business/FeeLedger.vue'
import QuoteLedger from '../components/business/QuoteLedger.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Segmented from '../components/ui/Segmented.vue'
import { user } from '../api'
import { useViewMode } from '../composables/view'
import EmptyState from '../components/ui/EmptyState.vue'
const isAdmin = user()?.role === 'admin'
// 收費與報價分開兩頁籤，免得三個大列表疊在同一頁
const feeTab = useViewMode('fees', 'fees', ['fees', 'quotes'] as const)
</script>
<template><section class="page"><PageHeader title="收費" desc="收費、分期與報價，按幣種分開管理。" /><EmptyState v-if="!isAdmin" title="收費只限管理者" desc="如需查看，請聯絡管理者。" /><template v-else><Segmented v-model="feeTab" :options="[{ value: 'fees', label: '收費與收款' }, { value: 'quotes', label: '報價' }]" label="收費分頁" /><FeeLedger v-if="feeTab === 'fees'" /><QuoteLedger v-else /></template></section></template>
