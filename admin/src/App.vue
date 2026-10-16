<script setup lang="ts">
import { useAdminStore } from './store'
import AppShell from './components/layout/AppShell.vue'
const { account } = useAdminStore()
</script>
<template><router-view v-if="!account" /><AppShell v-else /></template>
