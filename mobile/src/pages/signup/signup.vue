<template>
  <view class="page signup">
    <!-- 自行申請（docs/requirements.md 5.6.2）：管理員聯絡申請人核實號碼後批准，批准後用這個號碼和密碼登入 -->
    <template v-if="!sent">
      <text class="intro">免費使用，自己管理牌照、公司和到期日。提交後我們會先聯絡你核實手機號碼，批准後即可登入。</text>
      <view v-if="loaded && !terms" class="card notice">
        <text class="notice-title">暫時不能在網上申請</text>
        <text class="subtle">請用 WhatsApp 或微信聯絡我們，我們會為你開通帳戶。</text>
      </view>
      <!-- 條款載入完才決定顯示表格或提示，避免表格先閃出再換成提示 -->
      <view v-else-if="terms" class="card">
        <text class="field-label first">手機號碼</text>
        <view class="phone-row">
          <picker :range="areaCodes" range-key="label" :value="areaIndex" @change="pickArea"><view class="field picker area"><text>{{ areaCodes[areaIndex].label }}</text><text class="chev">›</text></view></picker>
          <input class="field phone" v-model.trim="phone" type="number" :placeholder="areaCodes[areaIndex].hint" />
        </view>
        <text class="field-label">稱呼</text>
        <input class="field" v-model="name" maxlength="40" placeholder="例如 陳先生" />
        <text class="field-label">設定密碼</text>
        <input class="field" v-model="password" password placeholder="至少 10 個字元" />
        <text class="field-label">再輸入一次密碼</text>
        <input class="field" v-model="again" password placeholder="再輸入一次" />
        <text class="line-sub note">請不要使用你在其他網站或服務用的密碼。</text>
        <view class="agree-row">
          <wd-checkbox v-model="agree" shape="square">我已閱讀並同意</wd-checkbox>
          <text class="link" @click="openTerms('terms')">服務條款</text><text class="subtle">及</text><text class="link" @click="openTerms('privacy')">私隱聲明</text>
        </view>
        <text v-if="error" class="error">{{ error }}</text>
        <button class="primary submit" :disabled="busy || !loaded" @click="submit">{{ busy ? '正在提交…' : '提交申請' }}</button>
      </view>
    </template>
    <view v-else class="card sent">
      <StampMark text="已收到" tone="jade" play />
      <text class="notice-title">申請已收到</text>
      <text class="subtle">我們會先聯絡你核實手機號碼，管理員批准後，即可用這個號碼和密碼登入。</text>
      <button class="btn-line back" @click="goLogin">返回登入</button>
    </view>
    <ContactCard v-if="sent || (loaded && !terms)" public :messages="false" />
    <text v-if="!sent && loaded" class="help">已有帳戶？<text class="link" @click="goLogin">返回登入</text></text>
  </view>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import { api, publicApi } from '../../lib/api'
import ContactCard from '../../components/ContactCard.vue'
import StampMark from '../../components/StampMark.vue'

// 區號與登入頁相同：香港、澳門 8 位，內地 1 字頭 11 位
const areaCodes = [{ code: '+852', label: '香港 +852', hint: '8 位手機號碼', pattern: /^\d{8}$/ }, { code: '+853', label: '澳門 +853', hint: '8 位手機號碼', pattern: /^\d{8}$/ }, { code: '+86', label: '內地 +86', hint: '11 位手機號碼', pattern: /^1\d{10}$/ }]
const areaIndex = ref(Math.max(0, areaCodes.findIndex(item => item.code === uni.getStorageSync('loginArea'))))
const phone = ref(''), name = ref(''), password = ref(''), again = ref(''), agree = ref(false), error = ref(''), busy = ref(false), sent = ref(false), terms = ref(null), loaded = ref(false)
function pickArea(event) { areaIndex.value = Number(event.detail.value); uni.setStorageSync('loginArea', areaCodes[areaIndex.value].code) }
function openTerms(tab) { uni.navigateTo({ url: '/pages/terms/terms?tab=' + tab }) }
function goLogin() { uni.reLaunch({ url: '/pages/login/login' }) }
onMounted(async () => { try { terms.value = await publicApi('/public/terms') } catch {} finally { loaded.value = true } })

async function submit() {
  error.value = ''
  const area = areaCodes[areaIndex.value], digits = phone.value.replace(/\D/g, '')
  if (!digits) return (error.value = '請填寫手機號碼')
  if (!area.pattern.test(digits)) return (error.value = `${area.label.split(' ')[0]}手機號碼應為 ${area.hint.replace('手機號碼', '').trim()}`)
  if (!name.value.trim()) return (error.value = '請填寫稱呼')
  if (password.value.length < 10) return (error.value = '密碼至少 10 個字元')
  if (password.value !== again.value) return (error.value = '兩次輸入的密碼不一樣')
  if (!agree.value) return (error.value = '請先閱讀並同意服務條款及私隱聲明')
  busy.value = true
  try {
    await api('/public/signup', 'POST', { phone: `${area.code}${digits}`, name: name.value.trim(), password: password.value, acceptTerms: true, termsVersion: terms.value.version })
    sent.value = true
    uni.pageScrollTo({ scrollTop: 0, duration: 0 })
  } catch (e) {
    // 條款剛更新：重新載入最新版本，請客戶再看一次
    if (e.status === 409 && /條款已更新/.test(e.message)) { agree.value = false; try { terms.value = await publicApi('/public/terms') } catch {} }
    error.value = e.message
  } finally { busy.value = false }
}
</script>
<style scoped>
.field-label.first{margin-top:0}
.phone-row{display:flex;gap:8px}.phone-row picker{flex:none}
.area{width:128px;display:flex;align-items:center;justify-content:space-between;gap:4px}
.phone{flex:1;min-width:0;width:auto}
.note{display:block;margin-top:8px}
.agree-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:16px}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body);font-weight:700}
.submit{margin-top:20px}
.help{display:block;margin-top:16px;text-align:center;color:var(--ink-3);font-size:var(--fs-meta)}.help .link{font-size:var(--fs-meta)}
.notice-title{display:block;font-size:var(--fs-h);font-weight:800;color:var(--jade-deep);margin-bottom:4px}
.sent{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.sent .back{width:100%;margin-top:8px}
</style>
