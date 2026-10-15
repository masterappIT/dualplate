<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">CUSTOMER RELATIONSHIP</div>
      <h1>客戶管理</h1>
      <p>個人和公司客戶、聯絡資料及名下車輛。</p>
    </div>
    <button class="button primary" @click="modal = 'customer'">
      ＋ 新增客戶
    </button>
  </div>
  <div class="customer-grid">
    <button
      v-for="c in customers"
      :key="c.id"
      class="panel customer-card"
      @click="openCustomer(c)"
    >
      <div class="row">
        <span class="customer-avatar">{{ c.name.slice(0, 1) }}</span
        ><span class="badge">{{ c.kind }}</span>
      </div>
      <h2>{{ c.name }}</h2>
      <p>{{ c.phone || "未填聯絡電話" }}</p>
      <div class="customer-foot">
        {{ vehicles.filter((v) => v.customer_id === c.id).length }} 輛車 ·
        {{ requests.filter((r) => r.customer_id === c.id).length }} 個案件
        <span>查看 →</span>
      </div>
    </button>
  </div>
</template>
<script setup>
import { useAdminStore } from "../store";
const { customers, vehicles, requests, modal, openCustomer } = useAdminStore();
</script>
