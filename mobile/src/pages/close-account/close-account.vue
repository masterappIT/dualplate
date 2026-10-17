<template>
  <view class="page close-account">
    <!-- 自管客戶注銷帳號（docs/requirements.md 5.6.2）：不設冷靜期，輸入密碼確認後即時刪除，不能復原 -->
    <text class="intro">注銷後會即時刪除你的帳號和全部資料，不能復原。</text>
    <view v-if="loadError" class="card"><text class="error">{{ loadError }}</text></view>
    <template v-else-if="info">
      <text class="section-title">會刪除的資料</text>
      <view class="card">
        <view class="kv">
          <text class="k">牌照</text><text class="v num">{{ info.counts.plates }} 個</text>
          <text class="k">公司</text><text class="v num">{{ info.counts.companies }} 間</text>
          <text class="k">車輛</text><text class="v num">{{ info.counts.vehicles }} 部</text>
          <text class="k">司機</text><text class="v num">{{ info.counts.drivers }} 位</text>
        </view>
        <text class="line-sub note">連同批文卡和證件相片、到期提醒、訊息和修改記錄。曾經付費的委託，只保留法律要求的收費記錄，不含你的個人資料。</text>
      </view>

      <template v-if="!info.allowed">
        <view class="card blocked">
          <text class="blocked-title">{{ info.error }}</text>
          <view v-for="item in info.openRequests" :key="item.id" class="line" @click="openRequest(item.id)"><text class="line-title">{{ item.title }}</text><text class="chev">›</text></view>
          <button class="btn-line contact" @click="goMessages">聯絡我們</button>
        </view>
      </template>
      <template v-else>
        <text class="section-title">注銷原因（選填）</text>
        <view class="card">
          <wd-radio-group v-model="reason" shape="dot">
            <wd-radio v-for="item in info.reasons" :key="item" :value="item">{{ item }}</wd-radio>
          </wd-radio-group>
          <textarea v-if="reason === '其他'" v-model="reasonText" class="field other" maxlength="200" placeholder="請告訴我們原因（最多 200 字）" />
        </view>
        <text class="section-title">確認身份</text>
        <view class="card">
          <text class="field-label first">登入密碼</text>
          <input class="field" v-model="password" password placeholder="輸入你的登入密碼" />
          <text v-if="error" class="error">{{ error }}</text>
          <button class="primary danger submit" :disabled="busy" @click="submit">{{ busy ? '正在注銷…' : '注銷帳號' }}</button>
        </view>
      </template>
    </template>
    <wd-message-box />
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser, clearSession } from '../../lib/api'
import { useConfirm } from '../../lib/choice'
const confirmBox = useConfirm()
const info = ref(null), loadError = ref(''), reason = ref(''), reasonText = ref(''), password = ref(''), error = ref(''), busy = ref(false)
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { info.value = await api('/my/account/close'); loadError.value = '' } catch (e) { loadError.value = e.message }
}
onShow(load)
function openRequest(id) { uni.navigateTo({ url: '/pages/request-detail/request-detail?id=' + id }) }
function goMessages() { uni.navigateTo({ url: '/pages/messages/messages' }) }
async function submit() {
  error.value = ''
  if (!password.value) return (error.value = '請輸入登入密碼')
  if (await confirmBox.ask({ title: '確定注銷帳號？', msg: '你的帳號和全部資料會即時刪除，不能復原。', ok: '注銷', cancel: '取消', danger: true }) !== 'confirm') return
  busy.value = true
  try {
    await api('/my/account/close', 'POST', { password: password.value, ...(reason.value ? { reason: reason.value } : {}), ...(reason.value === '其他' && reasonText.value.trim() ? { reasonText: reasonText.value.trim() } : {}) })
    clearSession()
    uni.reLaunch({ url: '/pages/login/login' })
    setTimeout(() => uni.showToast({ title: '帳號已注銷，多謝你曾使用', icon: 'none' }), 400)
  } catch (e) {
    error.value = e.message
    if (e.status === 409) load()
  } finally { busy.value = false }
}
</script>
<style scoped>
.field-label.first{margin-top:0}
.line{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-of-type{border-bottom:0}
.line-title{font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.note{display:block;margin-top:12px}
.blocked-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--overdue);margin-bottom:8px}
.blocked .contact{width:100%;margin-top:12px}
:deep(.wd-radio){margin:0!important;padding:10px 0;line-height:24px}
.other{margin-top:12px;height:96px}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body);font-weight:700}
.submit{margin-top:20px}
</style>
