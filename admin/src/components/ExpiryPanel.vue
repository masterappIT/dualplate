<template>
  <div v-if="compact" class="expiry-compact">
    <p class="expiry-compact-title">到期事項</p>
    <div v-for="item in visibleItems" :key="item.code" class="expiry-line">
      <div class="expiry-line-main"><span>{{ item.name }}</span><Tag v-if="item.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="item.handler === 'outsourced'" tone="warning">外包：{{ item.providerName }}</Tag><small v-if="item.readOnly">資料來自：{{ item.source }}</small><small v-else-if="item.notes && noteFor !== item.code">備註：{{ item.notes }}</small><button v-if="!item.readOnly && noteFor !== item.code" type="button" class="text-button expiry-note-link" @click="noteFor = item.code; noteDraft = item.notes || ''">{{ item.notes ? '改備註' : '加備註' }}</button></div>
      <DueDate :date="item.expiresOn" :editable="!item.readOnly" :label="item.name" :on-save="value => saveDate(item, value)" />
      <div v-if="noteFor === item.code" class="expiry-note-edit"><input v-model="noteDraft" placeholder="備註" :aria-label="`${item.name}備註`" /><Button size="sm" @click="saveNote(item)">儲存</Button><Button variant="text" size="sm" @click="noteFor = ''">取消</Button></div>
    </div>
    <p v-if="!visibleItems.length" class="cell-sub">目前沒有適用的到期事項</p>
  </div>
  <section v-else class="panel"><div class="panel-head"><div><h2>到期項目</h2><p>適用規則與手動錄入日期</p></div></div>
    <div v-for="item in visibleItems" :key="item.code" class="record-row expiry-edit"><div><strong>{{ item.name }}</strong><small v-if="item.readOnly">資料來自：{{ item.source }}</small><Tag v-if="item.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="item.handler === 'outsourced'" tone="warning">外包：{{ item.providerName }}</Tag></div><template v-if="item.readOnly"><DueDate :date="item.expiresOn" /><span class="expiry-note">在上方批文卡修改</span></template><template v-else><DateInput v-model="item.expiresOn" label="到期日" /><input v-model="item.notes" placeholder="備註" aria-label="備註"/><button class="button" @click="saveItem(item)">儲存</button></template></div>
    <div v-if="!visibleItems.length" class="empty">目前沒有適用的到期項目</div>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import Tag from './ui/Tag.vue'
import Button from './ui/Button.vue'
import DateInput from './ui/DateInput.vue'
import DueDate from './ui/DueDate.vue'
// compact：公司卡內的精簡清單（日期點擊即改、備註另開），所有到期日（含合約）只在這裏填一次。
// deadlines：父頁已載入的 /overview 到期清單，傳入時不再逐個對象重複請求。
const props = defineProps({ ownerType: String, ownerId: String, compact: Boolean, deadlines: Array })
const emit = defineEmits(['saved', 'error'])
const items = ref([]), noteFor = ref(''), noteDraft = ref('')
const visibleItems = computed(() => items.value.filter(item => props.compact || props.ownerType !== 'company' || !['hk_registered_office', 'cn_registered_address'].includes(item.code)))
async function load() { if (!props.ownerId) return; try { items.value = await api(`/tracked-items?ownerType=${props.ownerType}&ownerId=${encodeURIComponent(props.ownerId)}`); const deadlines = props.deadlines || (await api('/overview?days=365')).deadlines; for (const item of items.value) { const match = deadlines?.find(entry => entry.ownerType === props.ownerType && entry.ownerId === props.ownerId && entry.ruleCode === item.code); item.handler = match?.handler || 'us'; item.providerName = match?.providerName || '' } } catch (error) { emit('error', error) } }
async function put(item, expiresOn, notes) { await api('/tracked-items', 'PUT', { ownerType: props.ownerType, ownerId: props.ownerId, code: item.code, expiresOn: expiresOn || '', notes }) }
async function saveItem(item) { try { await put(item, item.expiresOn, item.notes); emit('saved', '到期項目已儲存'); await load() } catch (error) { emit('error', error) } }
async function saveDate(item, value) { try { await put(item, value, item.notes); item.expiresOn = value; emit('saved', '到期日已儲存'); return true } catch (error) { emit('error', error); return false } }
async function saveNote(item) { try { await put(item, item.expiresOn, noteDraft.value); item.notes = noteDraft.value; noteFor.value = ''; emit('saved', '備註已儲存') } catch (error) { emit('error', error) } }
watch(() => [props.ownerType, props.ownerId], load, { immediate: true })
</script>
