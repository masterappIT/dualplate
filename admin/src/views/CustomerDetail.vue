<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'customers'">← 返回客戶</button>
      <div class="eyebrow">CUSTOMER PROFILE</div>
      <h1>{{ selectedCustomer.name }}</h1>
      <p>
        {{ selectedCustomer.kind }} · {{ selectedCustomer.phone || "未填電話" }}
      </p>
    </div>
    <div class="heading-actions">
      <button class="button outline" @click="modal = 'customer-user'">
        開通客戶登入</button
      ><button class="button outline" @click="modal = 'vehicle'">
        ＋ 登記車輛</button
      ><button class="button primary" @click="modal = 'plate'">
        ＋ 登記兩地牌
      </button>
    </div>
  </div>
  <div class="grid-two">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>名下兩地牌</h2>
          <p>每個牌的上牌與使用狀態獨立管理</p>
        </div>
      </div>
      <button
        v-for="p in customerPlates"
        :key="p.id"
        class="list-row"
        @click="openPlate(p)"
      >
        <span class="list-icon">▰</span
        ><span class="list-main"
          ><strong
            >{{ p.mainland_plate || "內地號牌待補充" }} ·
            {{ p.local_plate || "港／澳號牌待補充" }}</strong
          ><small
            >{{ p.route }} · {{ p.installation_status }} ·
            {{ p.usage_status }}</small
          ></span
        ><span>→</span>
      </button>
      <div v-if="!customerPlates.length" class="empty">尚未登記兩地牌</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>名下車輛</h2>
          <p>牌證和驗車由車輛檔案管理</p>
        </div>
      </div>
      <button
        v-for="v in customerVehicles"
        :key="v.id"
        class="list-row"
        @click="openVehicle(v)"
      >
        <span class="list-icon">▰</span
        ><span class="list-main"
          ><strong>{{ v.plate }}</strong
          ><small>{{ v.route }} · {{ v.origin }} · {{ v.type }}</small></span
        ><span>→</span>
      </button>
      <div v-if="!customerVehicles.length" class="empty">尚未登記車輛</div>
    </section>
  </div>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>代辦案件</h2>
        <p>包含客戶端提交的要求</p>
      </div>
    </div>
    <button
      v-for="r in customerRequests"
      :key="r.id"
      class="list-row"
      @click="openRequest(r)"
    >
      <span class="list-icon">{{ iconFor(r.service_code) }}</span
      ><span class="list-main"
        ><strong>{{ r.title }}</strong
        ><small>{{ r.stage }}</small></span
      ><span class="badge">{{ r.status }}</span>
    </button>
    <div v-if="!customerRequests.length" class="empty">尚無案件</div>
  </section>
</template>
<script setup>
import { useAdminStore } from "../store";
const {
  view,
  selectedCustomer,
  modal,
  customerVehicles,
  customerPlates,
  customerRequests,
  openPlate,
  openVehicle,
  openRequest,
  iconFor,
} = useAdminStore();
</script>
