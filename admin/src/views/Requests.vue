<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">CASE MANAGEMENT</div>
      <h1>代辦案件</h1>
      <p>管理新申請、續期、換車、驗車與兩地備案。</p>
    </div>
    <button class="button primary" @click="view = 'new-request'">
      ＋ 建立案件
    </button>
  </div>
  <section class="panel table-panel">
    <div class="table-toolbar">
      <input v-model="search" placeholder="搜尋客戶、車牌或案件" /><select
        v-model="statusFilter"
      >
        <option value="">全部狀態</option>
        <option>新要求</option>
        <option value="active">辦理中案件</option>
        <option>待資格核實</option>
        <option>待報價／授權</option>
        <option>待收件</option>
        <option>辦理中</option>
        <option>待客戶配合</option>
        <option>待交付</option>
        <option>已完成</option>
        <option>暫停</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>案件</th>
            <th>客戶／車輛</th>
            <th>路線</th>
            <th>目前階段</th>
            <th>狀態</th>
            <th>更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRequests" :key="r.id" @click="openRequest(r)">
            <td>
              <strong>{{ r.title }}</strong
              ><small>{{ serviceName(r.service_code) }}</small>
            </td>
            <td>
              {{ r.customer_name }}<small>{{ r.plate || "未指定車輛" }}</small>
            </td>
            <td>
              <span class="route-tag">{{ r.route }}</span>
            </td>
            <td>{{ r.stage }}</td>
            <td>
              <span
                class="badge"
                :class="r.status === '新要求' ? 'amber' : ''"
                >{{ r.status }}</span
              >
            </td>
            <td>{{ date(r.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!filteredRequests.length" class="empty">
        沒有符合條件的案件
      </div>
    </div>
  </section>
</template>
<script setup>
import { useAdminStore } from "../store";
const {
  view,
  filteredRequests,
  search,
  statusFilter,
  openRequest,
  serviceName,
  date,
} = useAdminStore();
</script>
