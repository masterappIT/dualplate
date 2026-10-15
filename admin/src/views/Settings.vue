<template>
  <div class="page-heading"><div><div class="eyebrow">SETTINGS</div><h1>設定</h1><p>規則設定與官方來源集中管理。</p></div></div>
  <div class="tabs"><button class="tab" :class="{ active: tab === 'rules' }" @click="tab = 'rules'">規則設定</button><button class="tab" :class="{ active: tab === 'sources' }" @click="tab = 'sources'">官方來源</button></div>
  <Rules v-if="tab === 'rules'" @saved="$emit('saved', $event)" @error="$emit('error', $event)" />
  <Sources v-else />
</template>
<script setup>
import { ref, watch } from 'vue'
import Rules from './Rules.vue'
import Sources from './Sources.vue'
defineEmits(['saved', 'error'])
const tab = ref('rules')
watch(tab, value => { window.location.hash = value === 'sources' ? '#sources' : '#settings' })
if (window.location.hash === '#sources') tab.value = 'sources'
</script>
