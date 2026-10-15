<template>
  <div v-if="modal" class="overlay" @click.self="modal = null">
    <div class="dialog">
      <div class="dialog-head">
        <div>
          <div class="eyebrow">QUICK ACTION</div>
          <h2>{{ modalTitle }}</h2>
        </div>
        <button class="close" @click="modal = null">×</button>
      </div>
      <template v-if="modal === 'customer'"
        ><label>客戶名稱</label
        ><input v-model="form.name" placeholder="姓名或公司名稱" /><label
          >類型</label
        ><select v-model="form.kind">
          <option>個人</option>
          <option>公司</option></select
        ><label>聯絡電話</label><input v-model="form.phone" /><button
          class="button primary full"
          @click="createCustomer"
        >
          新增客戶
        </button></template
      >
      <template v-if="modal === 'customer-user'"
        ><p class="dialog-note">
          為 {{ selectedCustomer?.name }} 開通客戶端登入。密碼最少 12 字元。
        </p>
        <label>顯示名稱</label><input v-model="form.name" /><label>電郵</label
        ><input v-model="form.email" type="email" /><label>初始密碼</label
        ><input v-model="form.password" type="password" /><button
          class="button primary full"
          @click="createCustomerUser"
        >
          開通登入
        </button></template
      >
      <template v-if="modal === 'vehicle'"
        ><label>客戶</label
        ><select v-model="form.customerId">
          <option value="">請選擇客戶</option>
          <option v-for="c in customers" :value="c.id" :key="c.id">
            {{ c.name }}
          </option>
        </select>
        <div class="form-grid">
          <div>
            <label>路線</label
            ><select v-model="form.route">
              <option>粵港</option>
              <option>粵澳</option>
            </select>
          </div>
          <div>
            <label>車輛來源地</label
            ><select v-model="form.origin">
              <option>香港</option>
              <option>內地</option>
              <option>澳門</option>
            </select>
          </div>
        </div>
        <div class="form-grid">
          <div><label>車牌號碼</label><input v-model="form.plate" /></div>
          <div>
            <label>車輛類型</label
            ><input v-model="form.type" placeholder="私家車" />
          </div>
        </div>
        <div class="form-grid">
          <div><label>品牌</label><input v-model="form.brand" /></div>
          <div><label>型號</label><input v-model="form.model" /></div>
        </div>
        <label>製造年份</label
        ><input v-model="form.manufacturedYear" type="number" /><button
          class="button primary full"
          @click="createVehicle"
        >
          登記車輛
        </button></template
      >
      <template v-if="modal === 'plate'"
        ><p v-if="form.sourceRequestId" class="dialog-note">
          由新申請案件建立；建檔後將自動關聯至案件。
        </p>
        <p v-else class="dialog-note">
          已有正式批文卡才在這裡建檔。新申請請先建立代辦案件。
        </p>
        <label>客戶</label
        ><select v-model="form.customerId">
          <option value="">請選擇客戶</option>
          <option v-for="c in customers" :value="c.id" :key="c.id">
            {{ c.name }}
          </option></select
        ><label>路線</label
        ><select v-model="form.route">
          <option>粵港</option>
          <option>粵澳</option></select
        ><label>批文卡編號 *</label
        ><input
          v-model="form.cardNumber"
          placeholder="按現有批文卡填寫"
        /><label>商號</label><input v-model="form.company" /><label
          >內承單位</label
        ><input v-model="form.contractor" /><label>通行口岸</label
        ><input v-model="form.crossing" />
        <div class="form-grid">
          <div>
            <label>內地號牌</label
            ><input v-model="form.mainlandPlate" placeholder="可稍後補充" />
          </div>
          <div>
            <label>香港／澳門號牌</label
            ><input v-model="form.localPlate" placeholder="可稍後補充" />
          </div>
        </div>
        <label>批文卡有效期</label
        ><input v-model="form.cardExpiresOn" type="date" /><button
          class="button primary full"
          @click="createPlate"
        >
          登記現有批文卡
        </button></template
      >
      <template v-if="modal === 'rental'"
        ><p class="dialog-note">
          {{ selectedPlate?.mainland_plate || selectedPlate?.local_plate }} ·
          新增出租記錄
        </p>
        <label>承租方名稱</label><input v-model="form.renterName" /><label
          >承租方使用車牌</label
        ><input v-model="form.renterVehiclePlate" />
        <div class="form-grid">
          <div>
            <label>開始日期</label><input v-model="form.startsOn" type="date" />
          </div>
          <div>
            <label>結束日期</label><input v-model="form.endsOn" type="date" />
          </div>
        </div>
        <label>備註</label><textarea v-model="form.notes"></textarea
        ><button class="button primary full" @click="createRental">
          儲存出租記錄
        </button></template
      >
      <template v-if="modal === 'inspection'"
        ><p class="dialog-note">
          {{ selectedVehicle?.plate }} · 驗車要求以適用官方來源核對
        </p>
        <label>驗車項目</label
        ><input v-model="form.title" placeholder="例如：新車驗車" /><label
          >預約日期</label
        ><input v-model="form.appointmentOn" type="date" /><label
          >官方來源</label
        ><select v-model="form.sourceId">
          <option value="">待核對</option>
          <option v-for="s in sources" :value="s.id" :key="s.id">
            {{ s.id }} · {{ s.title }}
          </option></select
        ><label>備註</label><textarea v-model="form.notes"></textarea
        ><button class="button primary full" @click="createInspection">
          建立驗車任務
        </button></template
      >
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>
<script setup>
import { useAdminStore } from "../store";
const {
  modal,
  form,
  modalTitle,
  error,
  customers,
  selectedCustomer,
  selectedPlate,
  selectedVehicle,
  sources,
  createCustomer,
  createCustomerUser,
  createVehicle,
  createPlate,
  createRental,
  createInspection,
} = useAdminStore();
</script>
