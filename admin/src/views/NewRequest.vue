<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'requests'">← 返回案件</button>
      <div class="eyebrow">CREATE CASE</div>
      <h1>建立代辦案件</h1>
      <p>客戶也可在小程序或 App 端自行提交要求。</p>
    </div>
  </div>
  <section class="panel form-panel">
    <div class="form-grid">
      <div>
        <label>客戶</label
        ><select v-model="newRequest.customerId">
          <option value="">請選擇客戶</option>
          <option v-for="c in customers" :value="c.id" :key="c.id">
            {{ c.name }}
          </option>
        </select>
      </div>
      <div>
        <label>服務路線</label
        ><select v-model="newRequest.route">
          <option>粵港</option>
          <option>粵澳</option>
        </select>
      </div>
      <div>
        <label>服務類型</label
        ><select v-model="newRequest.serviceCode">
          <option
            v-for="s in services.filter((s) =>
              s.routes.includes(newRequest.route),
            )"
            :value="s.code"
            :key="s.code"
          >
            {{ s.name }}
          </option>
        </select>
      </div>
      <div>
        <label>相關車輛</label
        ><select v-model="newRequest.vehicleId">
          <option value="">新申請／不指定</option>
          <option
            v-for="v in vehicles.filter(
              (v) =>
                v.customer_id === newRequest.customerId &&
                v.route === newRequest.route,
            )"
            :value="v.id"
            :key="v.id"
          >
            {{ v.plate }}
          </option>
        </select>
      </div>
      <div v-if="newRequest.serviceCode !== 'new_application'">
        <label>相關兩地牌檔案</label
        ><select v-model="newRequest.plateAssetId">
          <option value="">不指定兩地牌</option>
          <option
            v-for="p in plates.filter(
              (p) =>
                p.customer_id === newRequest.customerId &&
                p.route === newRequest.route &&
                p.card_number,
            )"
            :value="p.id"
            :key="p.id"
          >
            {{ p.card_number }} ·
            {{ p.mainland_plate || p.local_plate || p.route }}
          </option>
        </select>
      </div>
    </div>
    <label>案件標題</label
    ><input
      v-model="newRequest.title"
      placeholder="例如：粵港車牌新申請"
    /><label>需求說明</label
    ><textarea
      v-model="newRequest.description"
      placeholder="記錄客戶需求和目前已有的資料"
    ></textarea>
    <div class="form-actions">
      <button class="button outline" @click="view = 'requests'">取消</button
      ><button class="button primary" @click="createRequest">建立案件</button>
    </div>
  </section>
</template>
<script setup>
import { useAdminStore } from "../store";
const {
  view,
  customers,
  services,
  newRequest,
  vehicles,
  plates,
  createRequest,
} = useAdminStore();
</script>
