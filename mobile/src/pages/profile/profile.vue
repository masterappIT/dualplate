<template>
  <view class="page profile">
    <text class="subtle intro">{{ selfManaged ? '你的登入帳號和帳單名義，修改後立即生效。' : '你的登入帳號和委託人資料。委託人資料修改後立即生效，顧問會再核對。' }}</text>

    <!-- 登入帳號：這個登入的人 -->
    <text class="section-title">登入帳號</text>
    <view class="card">
      <text class="field-label first">顯示名稱</text>
      <input class="field" v-model="nameDraft" placeholder="例如 陳大文" />
      <button class="btn-sm solid save" :disabled="savingName || !nameChanged" @click="saveName">{{ savingName ? '正在儲存…' : '儲存顯示名稱' }}</button>
      <view class="ticket-rule" />
      <view class="kv">
        <text class="k">登入電郵</text><text class="v">{{ profile.me.email || '未設定' }}</text>
        <text class="k">登入手機</text><text class="v num">{{ profile.me.phone || '未設定' }}</text>
        <text class="k">微信</text><text class="v">{{ profile.me.wechatBound ? '已綁定' : '未綁定' }}</text>
      </view>
      <text class="line-sub note">{{ selfManaged ? '要更改登入電郵或手機，請聯絡我們核實身份後代為更改。' : '要更改登入電郵或手機，請聯絡你的顧問核實身份後代為更改。' }}</text>
    </view>

    <!-- 修改密碼 -->
    <text class="section-title">修改密碼</text>
    <view class="card">
      <text class="field-label first">目前密碼</text>
      <input class="field" v-model="pw.current" password placeholder="輸入目前的密碼" />
      <text class="field-label">新密碼</text>
      <input class="field" v-model="pw.next" password placeholder="至少 10 個字元" />
      <text class="field-label">再輸入一次新密碼</text>
      <input class="field" v-model="pw.again" password placeholder="再輸入一次" />
      <text v-if="pwError" class="error">{{ pwError }}</text>
      <button class="btn-sm solid save" :disabled="savingPw" @click="savePassword">{{ savingPw ? '正在更改…' : '更改密碼' }}</button>
      <text class="line-sub note">更改後，其他手機或電腦上的登入會自動登出。請不要使用你在其他網站或服務用的密碼。</text>
    </view>

    <!-- 委託人：合約和帳單上的名義（個人或公司），改動由管理者核對。選公司不加公司資料欄位（管理者 2026-10-18） -->
    <view class="section-head"><!-- 自管客戶沒有合約，只有按次委託才有帳單（管理者 2026-10-19）：寫「帳單名義」 -->
    <text class="section-title">{{ selfManaged ? '帳單名義' : '委託人（合約及帳單上的名義）' }}</text><text v-if="customerPending" class="pill amber">已修改，待核對</text></view>
    <view class="card">
      <text class="field-label first">類型</text>
      <view class="segmented kind"><text class="seg" :class="{ on: customerDraft.kind==='個人' }" @click="customerDraft.kind='個人'">個人</text><text class="seg" :class="{ on: customerDraft.kind==='公司' }" @click="customerDraft.kind='公司'">公司</text></view>
      <text class="subtle field-hint">{{ selfManaged ? '以個人還是公司名義收帳單' : '以個人還是公司名義委託我們' }}</text>
      <text class="field-label">{{ customerDraft.kind === '公司' ? '公司名稱' : '姓名' }}</text>
      <input class="field" v-model="customerDraft.name" :placeholder="customerDraft.kind === '公司' ? '例如 李氏貿易（香港）有限公司' : '例如 李大文'" />
      <text class="field-label">聯絡電話</text>
      <input class="field num" v-model="customerDraft.phone" placeholder="例如 +852 9123 4567" />
      <button class="btn-sm solid save" :disabled="savingCustomer || !customerChanged" @click="saveCustomer">{{ savingCustomer ? '正在儲存…' : selfManaged ? '儲存帳單名義' : '儲存委託人資料' }}</button>
      <text v-if="!selfManaged" class="line-sub note">委託人名稱會用在合約和帳單，修改後由顧問核對。</text>
    </view>

    <!-- 同一委託人的其他登入：只列名字，新增或停用請聯絡顧問 -->
    <view v-if="profile.otherLogins.length">
      <text class="section-title">其他可登入的人</text>
      <view class="card list"><view v-for="name in profile.otherLogins" :key="name" class="line"><text class="line-title">{{ name }}</text></view></view>
      <text class="subtle note">要新增或停用登入，請聯絡你的顧問。</text>
    </view>

    <!-- 多人登入：自管客戶暫時只有一個登入，之後作為收費功能推出；現在只告知，沒有操作 -->
    <view v-if="selfManaged">
      <text class="section-title">多人登入</text>
      <view class="card"><text class="line-sub">讓助手或同事用自己的帳號一起管理。之後推出，屬收費功能。</text></view>
    </view>

    <!-- 註銷帳號：只限自管客戶；托管客戶要經顧問終止合約 -->
    <text class="section-title">註銷帳號</text>
    <view class="card">
      <text class="line-sub">{{ selfManaged ? '不再使用的話，可以註銷帳號。帳號和全部資料會即時刪除，不能復原。' : '托管客戶要終止服務和註銷帳號，請聯絡你的顧問。' }}</text>
      <button v-if="selfManaged" class="btn-line close-btn" @click="goClose">註銷帳號</button>
    </view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
const profile = ref({ me: { name: '', email: '', phone: '', wechatBound: false }, customer: { name: '', kind: '個人', phone: '' }, otherLogins: [] })
const nameDraft = ref(''), customerDraft = ref({ name: '', kind: '個人', phone: '' }), pw = ref({ current: '', next: '', again: '' })
const selfManaged = ref(false), savingName = ref(false), savingPw = ref(false), savingCustomer = ref(false), pwError = ref(''), customerPending = ref(false)
const nameChanged = computed(() => nameDraft.value.trim() && nameDraft.value.trim() !== profile.value.me.name)
const customerChanged = computed(() => ['name', 'kind', 'phone'].some(key => (customerDraft.value[key] || '').trim() !== (profile.value.customer[key] || '')))
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try {
    const [data, pending] = await Promise.all([api('/my/profile'), api('/my/pending').catch(() => [])])
    profile.value = data; nameDraft.value = data.me.name; customerDraft.value = { ...data.customer }; selfManaged.value = data.serviceMode === '自管'
    customerPending.value = pending.some(item => item.entityType === 'customer')
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) }
}
function goClose() { uni.navigateTo({ url: '/pages/close-account/close-account' }) }
async function saveName() {
  if (savingName.value) return
  savingName.value = true
  try {
    const r = await api('/my/profile/name', 'PATCH', { name: nameDraft.value })
    profile.value.me.name = r.name; nameDraft.value = r.name
    uni.setStorageSync('user', { ...getUser(), name: r.name })
    uni.showToast({ title: '顯示名稱已更新', icon: 'none' })
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { savingName.value = false }
}
async function savePassword() {
  if (savingPw.value) return
  pwError.value = !pw.value.current ? '請輸入目前密碼' : pw.value.next.length < 10 ? '新密碼至少 10 個字元' : pw.value.next !== pw.value.again ? '兩次輸入的新密碼不一樣' : ''
  if (pwError.value) return
  savingPw.value = true
  try {
    await api('/me/password', 'POST', { currentPassword: pw.value.current, newPassword: pw.value.next })
    pw.value = { current: '', next: '', again: '' }
    uni.showToast({ title: '密碼已更改', icon: 'none' })
  } catch (e) { pwError.value = e.message } finally { savingPw.value = false }
}
async function saveCustomer() {
  if (savingCustomer.value) return
  savingCustomer.value = true
  try {
    const changes = Object.fromEntries(['name', 'kind', 'phone'].filter(key => (customerDraft.value[key] || '').trim() !== (profile.value.customer[key] || '')).map(key => [key, customerDraft.value[key] || '']))
    const r = await api('/my/customer', 'PATCH', changes)
    profile.value.customer = r; customerDraft.value = { ...r }
    const pending = await api('/my/pending').catch(() => [])
    customerPending.value = pending.some(item => item.entityType === 'customer')
    uni.showToast({ title: selfManaged.value ? '已更新' : '已更新，顧問會再核對', icon: 'none' })
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { savingCustomer.value = false }
}
onShow(load)
</script>
<style scoped>
.intro{display:block;margin-bottom:8px}
.field-label.first{margin-top:0}
.save{width:100%;margin-top:16px}
.note{display:block;margin-top:12px}
.kind{margin-top:0}
.field-hint{margin-top:4px}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body)}
.list{padding:4px 16px}
.close-btn{width:100%;margin-top:12px}
.line{padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{display:block;font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
</style>
