<template>
  <section class="panel"><div class="panel-head"><div><h2>到期項目</h2><p>適用規則與手動錄入日期</p></div></div>
    <div v-for="item in visibleItems" :key="item.code" class="record-row expiry-edit"><div><strong>{{ item.name }}</strong><small v-if="item.readOnly">資料來自：{{ item.source }}</small><Tag v-if="item.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="item.handler === 'outsourced'" tone="warning">外包：{{ item.providerName }}</Tag></div><template v-if="item.readOnly"><DueDate :date="item.expiresOn" /><span class="expiry-note">在上方批文卡修改</span></template><template v-else><DateInput v-model="item.expiresOn" label="到期日" /><input v-model="item.notes" placeholder="備註" aria-label="備註"/><button class="button" @click="saveItem(item)">儲存</button></template></div>
    <div v-if="!visibleItems.length" class="empty">目前沒有適用的到期項目</div>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import Tag from './ui/Tag.vue'
import DateInput from './ui/DateInput.vue'
import DueDate from './ui/DueDate.vue'
const props = defineProps({ ownerType: String, ownerId: String })
const emit = defineEmits(['saved', 'error'])
const items = ref([])
const visibleItems = computed(() => items.value.filter(item => props.ownerType !== 'company' || !['hk_registered_office', 'cn_registered_address'].includes(item.code)))
async function load() { if (!props.ownerId) return; try { items.value = await api(`/tracked-items?ownerType=${props.ownerType}&ownerId=${encodeURIComponent(props.ownerId)}`); const deadlines = await api('/overview?days=365'); for (const item of items.value) { const match = deadlines.deadlines?.find(entry => entry.ownerType === props.ownerType && entry.ownerId === props.ownerId && entry.ruleCode === item.code); item.handler = match?.handler || 'us'; item.providerName = match?.providerName || '' } } catch (error) { emit('error', error) } }
async function saveItem(item) { try { await api('/tracked-items', 'PUT', { ownerType: props.ownerType, ownerId: props.ownerId, code: item.code, expiresOn: item.expiresOn || '', notes: item.notes }); emit('saved', '到期項目已儲存'); await load() } catch (error) { emit('error', error) } }
watch(() => [props.ownerType, props.ownerId], load, { immediate: true })
</script>
