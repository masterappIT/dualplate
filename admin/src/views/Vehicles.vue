<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">PLATE & VEHICLE RECORDS</div>
      <h1>兩地牌、車輛與牌證</h1>
      <p>每個牌可獨立記錄上牌、出租、批文卡正反面。</p>
    </div>
    <div class="heading-actions">
      <button class="button outline" @click="modal = 'vehicle'">
        ＋ 登記車輛</button
      ><button class="button primary" @click="modal = 'plate'">
        ＋ 登記兩地牌
      </button>
    </div>
  </div>
  <section class="panel table-panel">
    <div class="panel-head plate-panel-head">
      <div>
        <h2>兩地牌台帳</h2>
        <p>未上牌的牌也可獨立保存</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>內地號牌</th>
            <th>港／澳號牌</th>
            <th>客戶</th>
            <th>路線</th>
            <th>上牌</th>
            <th>使用</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in plates" :key="p.id" @click="openPlate(p)">
            <td>
              <strong>{{ p.mainland_plate || "待補充" }}</strong>
            </td>
            <td>{{ p.local_plate || "待補充" }}</td>
            <td>{{ customerName(p.customer_id) }}</td>
            <td>
              <span class="route-tag">{{ p.route }}</span>
            </td>
            <td>{{ p.installation_status }}</td>
            <td>{{ p.usage_status }}</td>
            <td>→</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!plates.length" class="empty">尚未登記兩地牌</div>
    </div>
  </section>
  <section class="panel table-panel">
    <div class="panel-head plate-panel-head">
      <div>
        <h2>車輛檔案</h2>
        <p>可綁定至相關兩地牌</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>車輛</th>
            <th>客戶</th>
            <th>路線</th>
            <th>來源地</th>
            <th>製造年份</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vehicles" :key="v.id" @click="openVehicle(v)">
            <td>
              <strong>{{ v.plate }}</strong
              ><small>{{
                [v.brand, v.model].filter(Boolean).join(" ") || v.type
              }}</small>
            </td>
            <td>{{ customerName(v.customer_id) }}</td>
            <td>
              <span class="route-tag">{{ v.route }}</span>
            </td>
            <td>{{ v.origin }}</td>
            <td>{{ v.manufactured_year || "待核對" }}</td>
            <td>→</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!vehicles.length" class="empty">尚未登記車輛</div>
    </div>
  </section>
</template>
<script setup>
import { useAdminStore } from "../store";
const { modal, plates, vehicles, customerName, openPlate, openVehicle } =
  useAdminStore();
</script>
