<script setup>
// 今日工作的「客戶訊息」（docs/requirements.md 5.6.2，2026-10-18）：自管客戶在 app 內發的文字訊息，員工和管理者共用一個收件匣。
// 按一行打開對話抽屜，看來往記錄並回覆；回覆會通知客戶。沒有任何對話時不顯示。
import { ref, computed } from 'vue'
import { useLiveRefresh } from '../../composables/live-refresh'
import DataTable from '../ui/DataTable.vue'
import Tag from '../ui/Tag.vue'
import Button from '../ui/Button.vue'
import Drawer from '../ui/Drawer.vue'
import Field from '../ui/Field.vue'
import TextInput from '../ui/TextInput.vue'
import { api } from '../../api'
import { useAdminStore } from '../../store'

const { showError } = useAdminStore()
const rows = ref([]), loadError = ref(''), threadLoading = ref(false), open = ref(null), messages = ref([]), draft = ref(''), sending = ref(false), threadError = ref('')
const unread = computed(() => rows.value.reduce((total, row) => total + row.unread, 0))
const columns = [{ key: 'customer', title: '客戶', minWidth: 140 }, { key: 'last', title: '最新訊息', minWidth: 260 }, { key: 'lastAt', title: '時間', minWidth: 110, align: 'right' }, { key: 'action', title: '操作', className: 'col-actions', minWidth: 90 }]
const time = value => value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function fetchRows() { try { rows.value = await api('/support/inbox'); loadError.value = '' } catch (error) { loadError.value = error.message } }
// 打開時讀取，之後每分鐘、切回分頁時、按「重新整理」時自動更新；讀完通知導航的待處理數目
const { reload: load } = useLiveRefresh(fetchRows)
async function openThread(row) {
  open.value = row; messages.value = []; draft.value = ''; threadError.value = ''; threadLoading.value = true
  try { messages.value = (await api(`/support/conversations/${row.customerId}`)).messages; await load() } catch (error) { threadError.value = error.message } finally { threadLoading.value = false }
}
async function send() {
  if (!draft.value.trim()) { threadError.value = '請輸入回覆'; return }
  sending.value = true; threadError.value = ''
  try { messages.value = (await api(`/support/conversations/${open.value.customerId}`, 'POST', { body: draft.value })).messages; draft.value = ''; await load() } catch (error) { threadError.value = error.message; showError(error) } finally { sending.value = false }
}
</script>

<template>
  <section v-if="rows.length || loadError" class="panel support-inbox">
    <div class="panel-head"><div><h2>{{ unread ? `客戶訊息 · ${unread} 則未讀` : '客戶訊息' }}</h2><p>自管客戶在客戶端發的訊息，員工和管理者共用；回覆會通知客戶。</p></div></div>
    <p v-if="loadError" role="alert">客戶訊息載入失敗：{{ loadError }} <Button size="sm" @click="load">重試</Button></p>
    <DataTable v-else :columns="columns" :data="rows" row-key="customerId" :min-width="640">
      <template #cell-customer="{ row }"><strong>{{ row.customerName }}</strong><Tag v-if="row.serviceMode === '自管'" tone="neutral">自管</Tag></template>
      <template #cell-last="{ row }"><span class="last-line">{{ row.lastFromStaff ? '我們：' : '' }}{{ row.lastBody }}</span><Tag v-if="row.unread" tone="warning">{{ row.unread }} 則未讀</Tag></template>
      <template #cell-lastAt="{ row }"><span class="num">{{ time(row.lastAt) }}</span></template>
      <template #cell-action="{ row }"><button class="text-button" @click="openThread(row)">{{ row.unread ? '回覆' : '查看' }}</button></template>
    </DataTable>
  </section>

  <Drawer :open="!!open" :title="open ? `與${open.customerName}的訊息` : ''" sub="客戶在客戶端看到的就是這些內容；回覆會通知客戶。" :width="560" @close="open = null">
    <p v-if="threadError" class="error" role="alert">{{ threadError }}</p>
    <p v-else-if="threadLoading" role="status">正在載入訊息…</p>
    <ul class="thread">
      <li v-for="item in messages" :key="item.id" :class="['bubble', item.fromStaff ? 'from-staff' : 'from-client']">
        <small class="cell-sub">{{ item.fromStaff ? item.senderName : open?.customerName }} · {{ time(item.createdAt) }}</small>
        <p>{{ item.body }}</p>
      </li>
    </ul>
    <Field label="回覆"><TextInput v-model="draft" multiline :rows="3" placeholder="輸入回覆，最多 1000 字" /></Field>
    <div class="heading-actions"><Button variant="primary" :loading="sending" @click="send">送出回覆</Button></div>
  </Drawer>
</template>

<style scoped>
.last-line { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
.thread { display: grid; gap: 12px; margin: 0 0 16px; padding: 0; list-style: none; }
.bubble { display: grid; gap: 4px; max-width: 85%; }
.bubble p { margin: 0; white-space: pre-wrap; }
.from-staff { justify-self: end; text-align: right; }
.from-client { justify-self: start; }
</style>
