<script setup>
// 結束服務、恢復服務（docs/tasks/customer-lifecycle-plan.md 第 3 步）：托管客戶不再合作時不刪除，改為結束服務。
// 已結束時在客戶概覽顯示結束日期、原因和操作人，管理者可恢復；結束彈窗列出未完成工單、未收費用和會停用的登入，提醒但不阻止。
import { ref, computed, watch } from 'vue'
import Button from '../ui/Button.vue'
import Tag from '../ui/Tag.vue'
import Modal from '../ui/Modal.vue'
import Field from '../ui/Field.vue'
import DateInput from '../ui/DateInput.vue'
import TextInput from '../ui/TextInput.vue'
import KeyValue from '../ui/KeyValue.vue'
import FormDialog from './FormDialog.vue'
import { api, user, rentMoney } from '../../api'

const props = defineProps({ customer: { type: Object, required: true }, open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'changed'])
const isAdmin = user()?.role === 'admin'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date())

const preview = ref(null), previewError = ref(''), form = ref({ endedOn: '', reason: '' }), saving = ref(false), formError = ref('')
watch(() => props.open, async open => {
  if (!open) return
  form.value = { endedOn: today(), reason: '' }; formError.value = ''; preview.value = null; previewError.value = ''
  try { preview.value = await api(`/customers/${props.customer.id}/end-service`) } catch (error) { previewError.value = error.message }
})
async function submit() {
  if (saving.value) return
  if (!form.value.endedOn) { formError.value = '請填寫結束日期'; return }
  if (!form.value.reason.trim()) { formError.value = '請填寫結束原因'; return }
  saving.value = true; formError.value = ''
  try { const result = await api(`/customers/${props.customer.id}/end-service`, 'POST', { endedOn: form.value.endedOn, reason: form.value.reason.trim() }); emit('changed', result, '已結束服務，客戶的登入已停用'); emit('close') }
  catch (error) { formError.value = error.message } finally { saving.value = false }
}

const restoreOpen = ref(false), restoring = ref(false), restoreError = ref('')
async function restore() {
  if (restoring.value) return
  restoring.value = true; restoreError.value = ''
  try { const result = await api(`/customers/${props.customer.id}/restore-service`, 'POST', {}); restoreOpen.value = false; emit('changed', result, result.restoredLogins ? `已恢復服務，重新啟用了 ${result.restoredLogins} 個登入` : '已恢復服務') }
  catch (error) { restoreError.value = error.message } finally { restoring.value = false }
}
const endedItems = computed(() => [
  { label: '結束日期', value: props.customer.ended_on },
  { label: '原因', value: props.customer.end_reason },
  { label: '操作人', value: props.customer.ended_by_name || '—' }
])
</script>

<template>
  <section v-if="customer.ended_on" class="panel service-end">
    <div class="panel-head">
      <div><h2>服務已結束</h2><p>客戶不能登入；資料保留，只可查看。不再有到期提醒、年費、報帳和月報，也不列入今日工作。收費和已開的工單仍可處理。</p></div>
      <Tag tone="neutral">已結束</Tag>
    </div>
    <KeyValue :items="endedItems" />
    <div v-if="isAdmin" class="heading-actions"><Button size="sm" @click="restoreOpen = true; restoreError = ''">恢復服務</Button></div>
  </section>

  <FormDialog :open="open" title="結束服務" sub="資料會保留，可以隨時恢復。結束後客戶的登入全部停用，不再有到期提醒、年費、報帳和月報。" layout="stack" :width="560" :saving="saving" submit-text="結束服務" @close="emit('close')" @submit="submit">
    <Field label="結束日期" required hint="合約結束或停止合作的日子；不可遲於今天。"><DateInput v-model="form.endedOn" label="結束日期" /></Field>
    <Field label="原因" required><TextInput v-model="form.reason" placeholder="例如 合約期滿不續約" /></Field>
    <p v-if="previewError" class="error" role="alert">{{ previewError }}</p>
    <template v-else-if="preview">
      <div v-if="preview.openRequests.length || preview.unpaidFees.length" class="end-check">
        <p class="dialog-note">以下事項還未完成，建議先處理；結束後仍可在工單和收費頁處理。</p>
        <ul class="end-list">
          <li v-for="item in preview.openRequests" :key="item.id"><Tag tone="warning">工單</Tag><span>{{ item.title }}</span><small>{{ item.status }}</small></li>
          <li v-for="item in preview.unpaidFees" :key="item.id"><Tag tone="warning">未收</Tag><span>{{ item.description }}</span><small class="num">{{ rentMoney(item.outstanding, item.currency) }}</small></li>
        </ul>
      </div>
      <p class="dialog-note">{{ preview.activeLogins.length ? `會停用 ${preview.activeLogins.length} 個登入：${preview.activeLogins.join('、')}。恢復服務時會重新啟用。` : '這位客戶沒有啟用中的登入。' }}</p>
    </template>
    <p v-if="formError" class="error" role="alert">{{ formError }}</p>
  </FormDialog>

  <Modal :open="restoreOpen" title="恢復服務" :sub="`恢復「${customer.name}」的服務：重新啟用結束時停用的登入，並恢復到期提醒、年費和報帳。`" @close="restoreOpen = false">
    <p v-if="restoreError" role="alert" class="error">{{ restoreError }}</p>
    <template #footer><Button @click="restoreOpen = false">取消</Button><Button variant="primary" :loading="restoring" @click="restore">恢復服務</Button></template>
  </Modal>
</template>

<style scoped>
.service-end .heading-actions { margin-top: 12px; }
.end-check { margin-top: 4px; }
.end-list { display: grid; margin: 0 0 12px; padding: 0; list-style: none; border-top: 1px solid var(--border); }
.end-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.end-list small { margin-left: auto; color: var(--ink-2); }
</style>
