<template>
  <PageHeader title="設定" desc="到期事項與官方來源集中管理。" />
  <Segmented :model-value="tab" :options="options" label="設定分頁" @update:model-value="changeTab" />
  <Rules v-if="tab === 'rules'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <Sources v-else />
</template>
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import Segmented from '../components/ui/Segmented.vue'
import Rules from './Rules.vue'
import Sources from './Sources.vue'
defineEmits(['saved', 'error'])
const route = useRoute()
const router = useRouter()
const tab = computed(() => route.params.tab === 'sources' ? 'sources' : 'rules')
const options = [{ value: 'rules', label: '到期事項' }, { value: 'sources', label: '官方來源' }]
function changeTab(value) { router.push(`/settings/${value}`) }
</script>
