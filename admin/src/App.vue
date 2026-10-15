<template>
  <div v-if="!account" class="login-screen">
    <div class="login-card">
      <div class="brand-icon">牌</div>
      <div class="eyebrow">PLATE CARE · ADMIN</div>
      <h1>車牌管家</h1>
      <p>管理客戶的兩地牌、公司與到期事項。</p>
      <label for="admin-username">管理員帳號</label>
      <input
        id="admin-username"
        v-model.trim="loginForm.username"
        name="username"
        autocomplete="username"
        placeholder="輸入管理員帳號"
        @keyup.enter="login"
      />
      <label for="admin-password">密碼</label>
      <input
        id="admin-password"
        v-model="loginForm.password"
        name="password"
        type="password"
        autocomplete="current-password"
        placeholder="輸入密碼"
        @keyup.enter="login"
      />
      <button class="button primary full" :disabled="loggingIn" @click="login">
        {{ loggingIn ? "登入中…" : "登入管理端" }}
      </button>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
    </div>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">牌</div>
        <div><strong>車牌管家</strong><small>PLATE CARE</small></div>
      </div>
      <div class="nav-group-title">工作空間</div>
      <button
        v-for="nav in navigation"
        :key="nav.id"
        class="nav-item"
        :class="{ active: view === nav.id }"
        :title="nav.name"
        @click="navigate(nav.id)"
      >
        <component
          :is="nav.icon"
          class="nav-symbol"
          :size="19"
          :stroke-width="1.8"
        /><span>{{ nav.name }}</span
        ><span v-if="nav.id === 'business' && newCount" class="nav-count">{{
          newCount
        }}</span>
      </button>
      <div class="sidebar-bottom">
        <div class="source-mini">
          <ShieldCheck :size="17" /> 業務資訊依官方來源核對
        </div>
        <button class="profile" @click="logout">
          <span class="avatar">{{ account.name.slice(0, 1) }}</span
          ><span>{{ account.name }}<small>管理員 · 退出登入</small></span
          ><LogOut :size="16" class="logout-icon" />
        </button>
      </div>
    </aside>
    <main class="content">
      <header class="topbar">
        <div class="breadcrumbs">
          工作空間 <span>/</span>
          {{ navigation.find((n) => n.id === view)?.name || "詳細資料" }}
        </div>
        <div class="top-actions">
          <span class="today">{{ todayLabel }}</span
          ><span class="topbar-divider"></span
          ><span class="avatar small">{{ account.name.slice(0, 1) }}</span
          ><button
            class="mobile-logout"
            type="button"
            aria-label="退出管理端登入"
            @click="logout"
          >
            <LogOut :size="17" />
          </button>
        </div>
      </header>
      <div class="workspace">
        <div v-if="error" class="error workspace-message" role="alert">
          {{ error }}
          <button type="button" @click="error = ''" aria-label="關閉錯誤提示">
            ×
          </button>
        </div>
        <div v-if="notice" class="success workspace-message" role="status">
          {{ notice }}
          <button type="button" @click="notice = ''" aria-label="關閉成功提示">
            ×
          </button>
        </div>
        <Dashboard v-if="view === 'dashboard'" />
        <Customers v-else-if="view === 'customers'" />
        <Vehicles v-else-if="view === 'plates'" />
        <Requests v-else-if="view === 'business'" />
        <Settings v-else-if="view === 'settings'" @saved="showSuccess" @error="showError" />
        <RequestDetail v-else-if="view === 'request-detail' && selected" />
        <CustomerDetail
          v-else-if="view === 'customer-detail' && selectedCustomer"
        />
        <PlateDetail v-else-if="view === 'plate-detail' && selectedPlate" />
        <VehicleDetail
          v-else-if="view === 'vehicle-detail' && selectedVehicle"
        />
        <NewRequest v-else-if="view === 'new-request'" />
      </div>
    </main>
    <RecordModal />
  </div>
</template>
<script setup>
import { onMounted } from "vue";
import { ShieldCheck, LogOut } from "@lucide/vue";
import { useAdminStore } from "./store";
import Settings from "./views/Settings.vue";
import Dashboard from "./views/Dashboard.vue";
import Requests from "./views/Requests.vue";
import RequestDetail from "./views/RequestDetail.vue";
import Customers from "./views/Customers.vue";
import CustomerDetail from "./views/CustomerDetail.vue";
import Vehicles from "./views/Vehicles.vue";
import VehicleDetail from "./views/VehicleDetail.vue";
import PlateDetail from "./views/PlateDetail.vue";
import NewRequest from "./views/NewRequest.vue";
import RecordModal from "./components/RecordModal.vue";
const {
  account,
  view,
  navigation,
  error,
  notice,
  loginForm,
  loggingIn,
  login,
  logout,
  navigate,
  newCount,
  customers,
  showError,
  openPlateById,
  showSuccess,
  selected,
  selectedCustomer,
  selectedVehicle,
  selectedPlate,
  todayLabel,
  refresh,
} = useAdminStore();
onMounted(refresh);
</script>
