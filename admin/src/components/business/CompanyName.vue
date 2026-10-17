<script setup>
defineProps({ company: { type: Object, required: true } })
</script>

<template>
  <span class="company-name-pair"><strong>{{ company.name }}</strong><small v-if="company.jurisdiction === '香港'" :class="company.nameEn || company.name_en ? 'cell-sub' : 'company-name-missing'">{{ company.nameEn || company.name_en || '未填英文名稱' }}</small></span>
</template>
