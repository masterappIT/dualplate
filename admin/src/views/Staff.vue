<script setup>
import { ref, onMounted } from 'vue'
import { api, user } from '../api'
import Button from '../components/ui/Button.vue'
import DataTable from '../components/ui/DataTable.vue'
import Modal from '../components/ui/Modal.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Tag from '../components/ui/Tag.vue'
const emit = defineEmits(['saved', 'error'])
const rows = ref([]), loading = ref(false), error = ref(''), open = ref(false), target = ref(null), passwordOpen = ref(false), form = ref({ name: '', username: '', password: '', role: 'staff' }), password = ref(''), busy = ref(false)
const columns = [{ key: 'name', title: '姓名' }, { key: 'username', title: '帳號' }, { key: 'role', title: '權限' }, { key: 'active', title: '狀態' }, { key: 'last_login_at', title: '上次登入' }, { key: 'action', title: '操作' }]
async function load() { loading.value = true; try { rows.value = await api('/staff'); error.value = '' } catch (cause) { error.value = cause.message; emit('error', cause) } finally { loading.value = false } }
onMounted(load)
async function create() { busy.value = true; try { await api('/staff', 'POST', form.value); open.value = false; form.value = { name: '', username: '', password: '', role: 'staff' }; await load(); emit('saved', '員工已新增') } catch (cause) { error.value = cause.message; emit('error', cause) } finally { busy.value = false } }
async function update(row, change) { busy.value = true; try { await api(`/staff/${row.id}`, 'PATCH', change); await load(); emit('saved', '員工資料已更新') } catch (cause) { error.value = cause.message; emit('error', cause) } finally { busy.value = false } }
async function reset() { busy.value = true; try { await api(`/staff/${target.value.id}/reset-password`, 'POST', { password: password.value }); passwordOpen.value = false; password.value = ''; emit('saved', '密碼已重設；原有登入已失效') } catch (cause) { error.value = cause.message; emit('error', cause) } finally { busy.value = false } }
</script>
<template>
  <section class="panel"><div class="panel-head"><div><h2>員工</h2><p>管理者可新增帳號、設定權限及停用離職員工。</p></div><Button variant="primary" @click="open = true">＋ 新增員工</Button></div><p v-if="error" role="alert">{{ error }} <Button @click="load">重試</Button></p><DataTable :columns="columns" :data="rows" :loading="loading" :min-width="760" empty-text="尚無員工，請新增員工帳號"><template #cell-role="{ row }"><select :value="row.role" :disabled="busy || row.id === user()?.id" :aria-label="`${row.name}權限`" @change="update(row, { role: $event.target.value })"><option value="admin">管理者</option><option value="staff">員工</option></select></template><template #cell-active="{ row }"><Tag :tone="row.active ? 'ok' : 'neutral'">{{ row.active ? '啟用' : '停用' }}</Tag></template><template #cell-last_login_at="{ row }">{{ row.last_login_at ? row.last_login_at.slice(0, 16).replace('T', ' ') : '尚未登入' }}</template><template #cell-action="{ row }"><div class="row-actions"><span v-if="row.id === user()?.id" class="cell-sub">（你自己）</span><button v-else class="text-button" :disabled="busy" @click="update(row, { active: !row.active })">{{ row.active ? '停用' : '啟用' }}</button><button class="text-button" @click="target = row; passwordOpen = true">重設密碼</button></div></template></DataTable></section>
  <Modal :open="open" title="新增員工" @close="open = false"><Field label="姓名" required><TextInput v-model="form.name" /></Field><Field label="登入帳號" required><TextInput v-model="form.username" /></Field><Field label="初始密碼（至少 8 字元）" required><TextInput v-model="form.password" type="password" /></Field><Field label="權限"><select v-model="form.role"><option value="staff">員工</option><option value="admin">管理者</option></select></Field><p v-if="error" role="alert">{{ error }}</p><template #footer><Button @click="open = false">取消</Button><Button variant="primary" :disabled="busy || !form.name.trim() || !form.username.trim() || form.password.length < 8" @click="create">新增</Button></template></Modal>
  <Modal :open="passwordOpen" :title="`重設${target?.name || ''}的密碼`" @close="passwordOpen = false"><Field label="新密碼（至少 8 字元）" required><TextInput v-model="password" type="password" /></Field><p v-if="error" role="alert">{{ error }}</p><template #footer><Button @click="passwordOpen = false">取消</Button><Button variant="primary" :disabled="busy || password.length < 8" @click="reset">重設</Button></template></Modal>
</template>
