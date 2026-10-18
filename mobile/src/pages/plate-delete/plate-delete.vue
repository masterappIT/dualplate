<template>
  <view class="page plate-delete">
    <!-- 自管客戶刪除建錯的牌照（docs/tasks/self-managed-fixes-plan.md 第 13 步）：沿用「注銷帳號」頁的結構；即時刪除，不能復原 -->
    <text class="intro">批文卡輸入有錯、建錯了牌照，可以在這裏刪除。刪除後不能復原。</text>
    <view v-if="loadError" class="card"><text class="error">{{ loadError }}</text></view>
    <template v-else-if="info">
      <text class="section-title">會刪除的資料</text>
      <view class="card">
        <view class="kv">
          <text class="k">牌照</text><text class="v">{{ info.label }}</text>
          <text v-if="info.cardNumber" class="k">批文卡編號</text><text v-if="info.cardNumber" class="v num">{{ info.cardNumber }}</text>
          <text v-if="info.drivers" class="k">司機登記</text><text v-if="info.drivers" class="v num">{{ info.drivers }} 位</text>
          <text v-if="info.rentals" class="k">出租記錄</text><text v-if="info.rentals" class="v num">{{ info.rentals }} 份</text>
        </view>
        <text class="line-sub note">連同批文卡正本、口岸記錄、到期提醒和已辦記錄。{{ info.vehicleKept ? '車輛資料會保留，只解除和這個牌照的連結。' : '' }}已完成的委託和收費記錄會保留。</text>
      </view>

      <template v-if="!info.allowed">
        <view class="card blocked">
          <text class="blocked-title">{{ info.error }}</text>
          <view v-for="item in info.openRequests" :key="item.id" class="line" @click="openRequest(item.id)"><text class="line-title">{{ item.title }}</text><text class="chev">›</text></view>
          <button class="btn-line contact" @click="goMessages">聯絡我們</button>
        </view>
      </template>
      <template v-else>
        <template v-if="info.companies.length">
          <text class="section-title">一併刪除的公司</text>
          <view class="card">
            <view v-for="company in info.companies" :key="company.id" class="choice-row"><wd-checkbox v-model="picked[company.id]" shape="square">{{ company.jurisdiction }}公司 · {{ company.name }}</wd-checkbox></view>
            <text class="line-sub note">這些公司是跟這個牌照一起建立的，沒有其他牌照。輸入錯誤時通常也要一併刪除；取消勾選就會保留。</text>
          </view>
        </template>
        <view class="card">
          <text class="line-sub">只是不再續期？請回到牌照頁按「不再續期這個牌照」，記錄會保留，只停止提醒。</text>
          <text v-if="error" class="error">{{ error }}</text>
          <button class="primary danger submit" :disabled="busy" @click="submit">{{ busy ? '正在刪除…' : '刪除這個牌照' }}</button>
        </view>
      </template>
    </template>
    <wd-message-box />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
import { useConfirm } from '../../lib/choice'
const confirmBox = useConfirm()
const info = ref(null), loadError = ref(''), picked = ref({}), error = ref(''), busy = ref(false)
let plateId = ''
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try {
    info.value = await api('/my/plates/' + encodeURIComponent(plateId) + '/delete')
    picked.value = Object.fromEntries(info.value.companies.map(company => [company.id, true]))
    loadError.value = ''
  } catch (e) { loadError.value = e.message }
}
onLoad(options => { plateId = options.id || ''; load() })
function openRequest(id) { uni.navigateTo({ url: '/pages/request-detail/request-detail?id=' + id }) }
function goMessages() { uni.navigateTo({ url: '/pages/messages/messages' }) }
async function submit() {
  error.value = ''
  const companyIds = info.value.companies.filter(company => picked.value[company.id]).map(company => company.id)
  const msg = `牌照 ${info.value.label}${companyIds.length ? ` 和 ${companyIds.length} 間公司` : ''} 會即時刪除，不能復原。`
  if (await confirmBox.ask({ title: '確定刪除這個牌照？', msg, ok: '刪除', cancel: '取消', danger: true }) !== 'confirm') return
  busy.value = true
  try {
    await api('/my/plates/' + encodeURIComponent(plateId) + '/delete', 'POST', { companyIds })
    uni.reLaunch({ url: '/pages/vehicles/vehicles' })
    setTimeout(() => uni.showToast({ title: '牌照已刪除', icon: 'none' }), 400)
  } catch (e) {
    error.value = e.message
    if (e.status === 409) load()
  } finally { busy.value = false }
}
</script>
<style scoped>
.line{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-of-type{border-bottom:0}
.line-title{font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.note{display:block;margin-top:12px}
.blocked-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--overdue);margin-bottom:8px}
.blocked .contact{width:100%;margin-top:12px}
.choice-row{padding:10px 0;border-bottom:1px solid var(--rule)}.choice-row:last-of-type{border-bottom:0}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body);font-weight:700}
.submit{margin-top:20px}
</style>
