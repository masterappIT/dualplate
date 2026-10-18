<template>
  <view class="page company-new">
    <!-- 客戶在「我的公司」新增公司（docs/tasks/self-managed-fixes-plan.md 第 4 步）：只填註冊地和名稱，選填屬於哪個牌照；其他資料之後補上 -->
    <text class="intro">先填公司名稱；英文名稱、登記號碼和成立日期，之後可在「修改公司資料」補上。</text>
    <view class="card">
      <text class="field-label first">公司註冊地</text>
      <wd-radio-group v-model="jurisdiction" shape="dot">
        <wd-radio v-for="item in ['香港','澳門','內地']" :key="item" :value="item">{{ item }}公司</wd-radio>
      </wd-radio-group>
      <text class="field-label">公司名稱</text>
      <input class="field" v-model="name" maxlength="160" :placeholder="jurisdiction==='內地' ? '按營業執照填寫，用簡體字' : '按商業登記證填寫'" />
      <text v-if="error" class="error">{{ error }}</text>
      <text v-if="suggestion" class="link fix" @click="useSuggestion">改用「{{ suggestion }}」 ›</text>
    </view>
    <template v-if="choices.length">
      <text class="section-title">屬於哪個牌照（選填）</text>
      <view class="card">
        <wd-radio-group v-model="plateId" shape="dot">
          <wd-radio value="">不屬於任何牌照</wd-radio>
          <wd-radio v-for="p in choices" :key="p.id" :value="p.id">{{ p.label }}</wd-radio>
        </wd-radio-group>
        <text class="line-sub note">選了牌照，這間公司會和牌照放在同一組，牌照頁也會顯示它。</text>
      </view>
    </template>
    <button class="primary submit" :disabled="busy" @click="submit">{{ busy ? '正在新增…' : '新增公司' }}</button>
  </view>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { api, getUser, isSelfManaged } from '../../lib/api'
const selfManaged = isSelfManaged()
const jurisdiction = ref('香港'), name = ref(''), plateId = ref(''), plates = ref([]), error = ref(''), suggestion = ref(''), busy = ref(false)
onLoad(async () => {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try { plates.value = (await api('/my/overview')).plates.map(p => ({ id: p.id, route: p.route, label: [p.mainlandPlate, p.localPlate].filter(Boolean).join(' · ') || `批文卡 ${p.cardNumber}` })) } catch { plates.value = [] }
})
// 香港公司只可做粵港牌照的持牌公司、澳門公司只可做粵澳的；內地公司（內承單位）兩種都可以
const choices = computed(() => plates.value.filter(p => jurisdiction.value === '內地' || (p.route === '粵澳' ? '澳門' : '香港') === jurisdiction.value))
watch(choices, list => { if (plateId.value && !list.some(p => p.id === plateId.value)) plateId.value = '' })
function useSuggestion() { name.value = suggestion.value; suggestion.value = ''; error.value = '' }
async function submit() {
  error.value = ''; suggestion.value = ''
  if (!name.value.trim()) return (error.value = '請填寫公司名稱')
  busy.value = true
  try {
    await api('/my/companies', 'POST', { jurisdiction: jurisdiction.value, name: name.value.trim(), ...(plateId.value ? { plateId: plateId.value } : {}) })
    // 直接打開這一頁（例如重新整理後）沒有上一頁可返回：改到「我的公司」
    if (getCurrentPages().length > 1) uni.navigateBack(); else uni.switchTab({ url: '/pages/companies/companies' })
    setTimeout(() => uni.showToast({ title: selfManaged ? '公司已新增' : '公司已新增，顧問會再核對', icon: 'none' }), 400)
  } catch (e) {
    error.value = e.message
    suggestion.value = e.data?.suggestion || ''
  } finally { busy.value = false }
}
</script>
<style scoped>
.field-label.first{margin-top:0}
:deep(.wd-radio){margin:0!important;padding:10px 0;line-height:24px}
.error{display:block;margin-top:8px;color:var(--overdue);font-size:var(--fs-body);font-weight:700}
.fix{display:block;margin-top:8px}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.note{margin-top:8px}
.submit{width:100%;margin-top:20px}
</style>
