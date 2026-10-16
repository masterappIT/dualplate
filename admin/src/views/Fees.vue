<script setup lang="ts">
import FeeLedger from '../components/business/FeeLedger.vue'
import QuoteLedger from '../components/business/QuoteLedger.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { user } from '../api'
import EmptyState from '../components/ui/EmptyState.vue'
const isAdmin = user()?.role === 'admin'
</script>
<template><section><PageHeader title="收費" desc="收費、分期與報價，按幣種分開管理。" /><EmptyState v-if="!isAdmin" title="收費只限管理者" desc="如需查看，請聯絡管理者。" /><template v-else><FeeLedger /><QuoteLedger /></template></section></template>
