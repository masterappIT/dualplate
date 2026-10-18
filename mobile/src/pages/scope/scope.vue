<template>
  <view class="page">
    <!-- 委託內容（docs/tasks/client-scope-view-design.md）：只能看；外包也寫「我們負責」 -->
    <text class="page-title">委託內容</text>
    <text v-if="loaded && summary" class="subtle intro">{{ summary }}</text>
    <AdvisorCard v-if="loaded && !only" :advisor="advisor" />
    <!-- 全部：每個牌照／公司一行，按進去看細項；從牌照頁或公司卡片進來：直接看那一個的細項 -->
    <template v-if="!only">
      <template v-for="section in sections" :key="section.category">
        <text class="section-title">{{ section.label }}</text>
        <view class="card list">
          <view v-for="owner in section.owners" :key="owner.id" class="line row" @click="openOwner(owner.id)">
            <view class="grow"><text class="line-title">{{ owner.label }}</text>
              <text class="line-sub">{{ owner.stopped ? '已標記不再續期' : ownerCounts(owner) }}</text></view>
            <text class="chev">›</text>
          </view>
        </view>
      </template>
    </template>
    <template v-else>
      <view v-for="owner in shown.flatMap(section => section.owners)" :key="owner.id" class="card owner">
        <view class="row"><text class="owner-name grow">{{ owner.label }}</text><text v-if="owner.stopped" class="pill gray">不再續期</text></view>
        <text v-if="owner.nameEn" class="subtle">{{ owner.nameEn }}</text>
        <text v-if="owner.stopped" class="line-sub stopped">已標記不再續期，我們不再為這個牌照辦理續期。</text>
        <template v-else>
          <view v-if="owner.us.length" class="group">
            <text class="group-title">我們負責</text>
            <view v-for="item in owner.us" :key="item.code" class="item"><text class="item-name grow">{{ item.name }}</text></view>
          </view>
          <view v-if="owner.you.length" class="group">
            <text class="who">你自行辦理</text>
            <text class="subtle you-note">到期前我們會提醒你。</text>
            <view v-for="item in owner.you" :key="item.code" class="item"><text class="item-name grow muted">{{ item.name }}</text></view>
          </view>
          <text v-if="!owner.us.length && !owner.you.length" class="line-sub">這裏暫時沒有委託事項。</text>
        </template>
      </view>
    </template>
    <view v-if="loaded && !shown.length" class="card empty">{{ only ? '找不到這個牌照或公司，可能已轉出或註銷。' : '還沒有委託內容' }}</view>
    <button v-if="loaded && shown.length" class="btn-line adjust" @click="adjust">申請調整委託</button>
    <text v-if="loaded && shown.length" class="subtle adjust-note">告訴顧問想加入或取消哪一項，顧問確認後會在這裏更新。</text>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { api, getUser } from '../../lib/api'
import AdvisorCard from '../../components/AdvisorCard.vue'
const sections = ref([]), advisor = ref(null), loaded = ref(false), only = ref('')
// 從牌照頁或公司卡片進來時只看那一個
const shown = computed(() => only.value ? sections.value.map(section => ({ ...section, owners: section.owners.filter(owner => owner.id === only.value) })).filter(section => section.owners.length) : sections.value)
onLoad(options => { only.value = decodeURIComponent(options.id || '') })
async function load() {
  if (!getUser()) return uni.navigateTo({ url: '/pages/login/login' })
  try {
    const [scope, overview] = await Promise.all([api('/my/scope'), api('/my/overview')])
    sections.value = scope.sections; advisor.value = overview.advisor
    const owner = only.value && scope.sections.flatMap(section => section.owners).find(item => item.id === only.value)
    if (owner) uni.setNavigationBarTitle({ title: owner.label })
  } catch (e) { uni.showToast({ title: e.message, icon: 'none' }) } finally { loaded.value = true }
}
// 數目為 0 的那半句不寫
const ownerCounts = owner => [owner.us.length ? `我們負責 ${owner.us.length} 項` : '', owner.you.length ? `你自行辦理 ${owner.you.length} 項` : ''].filter(Boolean).join(' · ') || '暫時沒有委託事項'
// 頂部摘要：整頁按牌照和公司數（逐項加總太大，看不出意思）；單一對象寫它的項數
const summary = computed(() => {
  const owners = shown.value.flatMap(section => section.owners)
  if (only.value) return owners[0] && !owners[0].stopped ? ownerCounts(owners[0]) : ''
  const plates = owners.filter(owner => owner.type === 'plate').length, companies = owners.length - plates
  return owners.length ? [plates ? `${plates} 個牌照` : '', companies ? `${companies} 間公司` : ''].filter(Boolean).join(' · ') + '。按進去看哪些事由我們負責、哪些由你自行辦理。' : ''
})
function openOwner(id) { uni.navigateTo({ url: '/pages/scope/scope?id=' + id }) }
// 申請調整委託：開「其他代辦要求」，標題自動帶牌照或公司；牌照的會鎖定那個牌照
function adjust() {
  const owner = only.value && shown.value.flatMap(section => section.owners)[0]
  uni.navigateTo({ url: '/pages/requests/requests?entrust=scope' + (owner ? '&item=' + encodeURIComponent(owner.label) + (owner.type === 'plate' ? '&plate=' + owner.id : '') : '') })
}
onShow(load)
</script>
<style scoped>
.intro{margin-bottom:16px}
.list{padding:4px 16px}
.line{padding:12px 0;border-bottom:1px solid var(--rule)}.line:last-child{border-bottom:0}
.line-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.owner-name{font-size:var(--fs-h);font-weight:800;line-height:1.4;color:var(--ink)}
.group{margin-top:16px;padding-top:12px;border-top:1px solid var(--rule)}
.group-title{display:block;font-size:var(--fs-body);font-weight:800;color:var(--jade)}
.you-note{margin-top:4px}
.item{display:flex;align-items:baseline;gap:12px;padding:8px 0}
.item-name{font-size:var(--fs-body);line-height:1.5;color:var(--ink)}
.item-name.muted{color:var(--ink-2)}
.line-sub{display:block;font-size:var(--fs-body);line-height:1.5;color:var(--ink-2)}
.stopped{margin-top:8px}
.adjust{width:100%;margin-top:20px}
.adjust-note{margin-top:8px;text-align:center}
</style>
