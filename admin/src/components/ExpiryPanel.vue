<template>
  <section class="panel"><div class="panel-head"><div><h2>到期項目</h2><p>適用規則與手動錄入日期</p></div></div>
    <div v-for="item in items" :key="item.code" class="record-row expiry-edit"><div><strong>{{ item.name }}</strong><small v-if="item.readOnly">資料來自：{{ item.source }}</small></div><input v-model="item.expiresOn" type="date" :disabled="item.readOnly" aria-label="到期日"/><input v-model="item.notes" :disabled="item.readOnly" placeholder="備註" aria-label="備註"/><button v-if="!item.readOnly" class="button primary" @click="saveItem(item)">儲存</button></div>
    <div v-if="!items.length" class="empty">目前沒有適用的到期項目</div>
  </section>
</template>
<script setup>
import { ref, watch } from 'vue'
import { api } from '../api'
const props = defineProps({ ownerType: String, ownerId: String })
const emit = defineEmits(['saved', 'error'])
const items = ref([])
async function load() { if (!props.ownerId) return; try { items.value = await api(`/tracked-items?ownerType=${props.ownerType}&ownerId=${encodeURIComponent(props.ownerId)}`) } catch (error) { emit('error', error) } }
async function saveItem(item) { try { await api('/tracked-items', 'PUT', { ownerType: props.ownerType, ownerId: props.ownerId, code: item.code, expiresOn: item.expiresOn || '', notes: item.notes }); emit('saved', '到期項目已儲存'); await load() } catch (error) { emit('error', error) } }
watch(() => [props.ownerType, props.ownerId], load, { immediate: true })
</script>
