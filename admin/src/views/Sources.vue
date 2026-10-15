<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">OFFICIAL REFERENCES</div>
      <h1>官方來源索引</h1>
      <p>業務規則只以主管部門原始資料為依據。</p>
    </div>
  </div>
  <div class="source-grid">
    <a
      v-for="s in sources"
      :key="s.id"
      class="panel source-card"
      :href="s.url"
      target="_blank"
      rel="noopener"
      ><span class="source-code">{{ s.id }}</span>
      <h2>{{ s.title }}</h2>
      <p>{{ s.appliesTo }}</p>
      <div class="source-foot">
        <span>{{ s.agency }}</span
        ><span>核對 {{ s.checkedAt }} ↗</span>
      </div></a
    >
  </div>
</template>
<script setup>
import { useAdminStore } from "../store";
const { sources } = useAdminStore();
</script>
