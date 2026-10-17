<script setup>
import { ref, watch } from 'vue'
import { api, dateTime, photoData, privateImage } from '../../api'
import Tag from '../ui/Tag.vue'
import Modal from '../ui/Modal.vue'

// 車輛證件：內地行駛證、香港車輛牌照與牌簿／澳門車輛登記文件、保險單。上傳原件 → 系統讀出欄位，
// 只填入車輛資料中仍空白的欄（不覆蓋），香港車輛牌照的有效期寫入到期日；證件之間車架號碼、車牌不一致時提示。
const props = defineProps({ vehicleId: String })
const emit = defineEmits(['saved', 'error', 'updated'])
const data = ref(null), busy = ref(''), preview = ref(null)
const statusText = { uncertain: '請核對', failed: '未能辨識' }

async function load() {
  if (!props.vehicleId) return
  try { data.value = await api(`/vehicles/${encodeURIComponent(props.vehicleId)}/documents`) } catch (error) { emit('error', error) }
}
function summary(result, doc) {
  if (!doc.recognizable) return `${doc.label}原件已上傳`
  if (result.recognitionFailed) return `${doc.label}原件已上傳，但未能辨識，請按原件手動填寫`
  if (result.applied.length) return `${doc.label}已辨識，已填入：${result.applied.map(item => `${item.label} ${item.value}`).join('、')}；請對照原件核對`
  return `${doc.label}已辨識；沒有空白欄位需要填入，請對照原件核對`
}
async function upload(doc, event) {
  const file = event.target.files?.[0]
  if (!file || busy.value) return
  busy.value = doc.kind
  try {
    const image = await photoData(file)
    const result = await api(`/vehicles/${encodeURIComponent(props.vehicleId)}/documents/${doc.kind}`, 'POST', { image })
    data.value = { vehicleId: result.vehicleId, retired: result.retired, documents: result.documents, checks: result.checks }
    emit('updated', result.vehicle)
    emit('saved', summary(result, doc))
  } catch (error) { emit('error', error) } finally { busy.value = ''; event.target.value = '' }
}
async function open(doc) {
  preview.value = { label: doc.label, src: '', loading: true }
  try { const src = await privateImage(`/vehicles/${encodeURIComponent(props.vehicleId)}/documents/${doc.kind}/image`); if (preview.value?.label === doc.label) preview.value = { label: doc.label, src, loading: false } } catch (error) { preview.value = null; emit('error', error) }
}
watch(() => props.vehicleId, load, { immediate: true })
defineExpose({ load })
</script>

<template>
  <section class="panel vehicle-documents">
    <div class="panel-head">
      <div>
        <h2>車輛證件</h2>
        <p>上傳原件相片，系統讀出車架號碼、日期等，只填入仍空白的欄位，不會覆蓋已有資料；請對照原件核對。</p>
      </div>
    </div>
    <div v-if="data?.checks?.length" class="document-checks" role="alert">
      <p v-for="check in data.checks" :key="check.code"><Tag tone="warning">請核對</Tag> {{ check.text }}</p>
    </div>
    <p v-if="data?.retired" class="cell-sub">這部車已換走，證件保留作記錄，不可再上傳。</p>
    <div v-if="data" class="document-grid">
      <article v-for="doc in data.documents" :key="doc.kind" class="document-item">
        <div class="document-head">
          <strong>{{ doc.label }}</strong>
          <Tag :tone="doc.uploaded ? 'ok' : doc.primary ? 'warning' : 'neutral'">{{ doc.uploaded ? '已上傳' : doc.primary ? '未上傳' : '可選' }}</Tag>
        </div>
        <small class="cell-sub">{{ doc.hint }}</small>
        <small v-if="doc.uploaded" class="cell-sub">{{ doc.uploadedByName || '—' }} 上傳於 {{ dateTime(doc.uploadedAt) }}</small>
        <dl v-if="doc.fields.length" class="key-value document-fields">
          <div v-for="field in doc.fields" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value || '—' }} <Tag v-if="field.status !== 'ok'" tone="warning">{{ statusText[field.status] }}</Tag></dd>
          </div>
        </dl>
        <div class="document-actions">
          <button v-if="doc.uploaded" type="button" class="button" @click="open(doc)">看原件</button>
          <label v-if="!data.retired" class="button file-button" :class="{ disabled: !!busy }">
            {{ busy === doc.kind ? (doc.recognizable ? '正在辨識…' : '正在上傳…') : doc.uploaded ? '重新上傳' : '上傳相片' }}
            <input type="file" accept="image/png,image/jpeg" :disabled="!!busy" :aria-label="`上傳${doc.label}相片`" @change="upload(doc, $event)" />
          </label>
        </div>
      </article>
    </div>
    <p v-else class="cell-sub">正在載入證件…</p>
    <Modal :open="!!preview" :title="preview ? `${preview.label} · 原件` : ''" sub="上傳的原件相片；請逐欄對照車輛資料。" :width="760" close-on-overlay @close="preview = null">
      <p v-if="preview?.loading">正在載入原件…</p>
      <img v-else-if="preview" class="document-image" :src="preview.src" :alt="`${preview.label}原件`" />
    </Modal>
  </section>
</template>

<style scoped>
.document-checks { display: grid; gap: 6px; margin-bottom: 12px; }
.document-checks p { margin: 0; }
.document-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.document-item { display: grid; align-content: start; gap: 6px; min-width: 0; padding: 12px; border: 1px solid var(--border); }
.document-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.document-fields { padding-top: 8px; border-top: 1px solid var(--border); }
.document-fields dd { overflow-wrap: anywhere; }
.document-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.file-button { position: relative; }
.file-button.disabled { pointer-events: none; opacity: .6; }
.document-image { display: block; max-width: 100%; margin: 0 auto; }
</style>
