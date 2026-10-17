<template>
  <template v-if="selectedCustomer">
  <button class="back" @click="view = 'customers'">← 返回客戶</button>
  <section class="holder-card guilloche-panel"><div class="holder-main"><span class="holder-kicker">{{ selectedCustomer.is_self ? '本公司自有' : '委託人' }}</span><h1>{{ selectedCustomer.name }}</h1><p>{{ selectedCustomer.kind }} · <span class="num">{{ phoneText(selectedCustomer.phone) || '未填電話' }}</span></p></div><dl class="holder-counts"><div><dt>牌照</dt><dd class="num">{{ customerPlates.length }}</dd></div><div><dt>公司組</dt><dd class="num">{{ companyGroups.length }}</dd></div><div><dt>車輛</dt><dd class="num">{{ customerVehicles.length }}</dd></div><div><dt>工單</dt><dd class="num">{{ customerRequests.length }}</dd></div></dl><div class="holder-actions"><button v-if="isAdmin" class="button outline on-dark" @click="openEdit">編輯客戶</button><button v-if="!selectedCustomer.is_self && isAdmin && !accountsLoading && !accounts.length" class="button outline on-dark" @click="modal = 'customer-user'">開通登入</button><button v-if="!selectedCustomer.is_self && isAdmin" class="button outline on-dark" @click="templateOpen = true">套用委託範本</button><button v-if="isAdmin" class="button outline on-dark" @click="matrixOpen = true; loadMatrix()">委託範圍</button><select class="button on-dark" aria-label="新增資料" @change="addRecord($event)"><option value="">＋ 新增</option><option v-if="isAdmin" value="plate">牌照</option><option v-if="isAdmin" value="vehicle">車輛</option><option v-if="isAdmin" value="company">公司組</option><option value="request">工單</option></select></div></section>
  <Segmented v-model="customerTab" :options="tabs" label="客戶資料分頁" />
  <FeeLedger v-if="customerTab === 'fees' && isAdmin && !selectedCustomer.is_self" :customer-id="selectedCustomer.id" />
  <section v-if="customerTab === 'overview'" class="panel guilloche-panel"><div class="panel-head"><div><h2>顧問</h2><p>客戶可在客戶端查看聯絡方式。</p></div><Button v-if="isAdmin && !advisorEditing" size="sm" @click="advisorEditing = true">編輯</Button></div><p v-if="advisorLoading" role="status">正在載入顧問資料…</p><p v-else-if="advisorError && !advisorEditing" class="error" role="alert">{{ advisorError }} <Button size="sm" @click="loadAdvisor">重試</Button></p><template v-else-if="advisorEditing"><p v-if="advisorError" class="error" role="alert">{{ advisorError }}</p><div class="form-grid"><Field label="姓名"><TextInput v-model="advisor.name" /></Field><Field label="電話"><TextInput v-model="advisor.phone" type="tel" /></Field><Field label="微信號"><TextInput v-model="advisor.wechat" /></Field></div><div class="heading-actions"><Button :disabled="advisorSaving" @click="advisorEditing = false; advisor = { ...savedAdvisor }; advisorError = ''">取消</Button><Button variant="primary" :loading="advisorSaving" @click="saveAdvisor">儲存顧問</Button></div></template><KeyValue v-else :items="[{ label: '姓名', value: advisor.name || '顧問資料整理中' }, { label: '電話', value: advisor.phone || '未填寫' }, { label: '微信號', value: advisor.wechat || '未填寫' }]" /></section>
  <section v-if="customerTab === 'overview' && !selectedCustomer.is_self" class="panel"><div class="panel-head"><div><h2>客戶帳號</h2><p>查看登入狀態與微信綁定情況。</p></div></div><p v-if="accountsError" role="alert" class="error">{{ accountsError }} <Button size="sm" @click="loadAccounts">重試</Button></p><DataTable v-else :columns="accountColumns" :data="accounts" :loading="accountsLoading" :min-width="760"><template #cell-phone="{ row }">{{ phoneText(row.phone) || '未填寫' }}</template><template #cell-email="{ row }">{{ row.email || '未填寫' }}</template><template #cell-wechatBound="{ row }"><Tag :tone="row.wechatBound ? 'ok' : 'neutral'">{{ row.wechatBound ? '已綁定' : '未綁定' }}</Tag></template><template #cell-active="{ row }"><Tag :tone="row.active ? 'ok' : 'neutral'">{{ row.active ? '啟用' : '已停用' }}</Tag></template><template #cell-lastLoginAt="{ row }"><span class="num">{{ row.lastLoginAt ? dateTime(row.lastLoginAt) : '尚未登入' }}</span></template><template #cell-action="{ row }"><div v-if="isAdmin" class="account-actions"><Button size="sm" :loading="codeLoading === row.id" :disabled="!row.active" @click="makeBindCode(row)">產生微信綁定碼</Button><Button size="sm" variant="text" @click="openLogin(row)">修改</Button><Button size="sm" variant="text" @click="openReset(row)">重設密碼</Button><Button size="sm" variant="text" :loading="accountSaving === row.id" @click="row.active ? disableTarget = row : setAccountActive(row, true)">{{ row.active ? '停用' : '重新啟用' }}</Button><Button size="sm" variant="text" @click="deleteAccountTarget = row; accountActionError = ''">刪除</Button></div><span v-else>僅供查看</span></template><template #empty><EmptyState title="還沒有開通客戶登入"><Button v-if="isAdmin" size="sm" @click="modal = 'customer-user'">開通登入</Button></EmptyState></template></DataTable></section>
  <div v-if="customerTab === 'overview' || customerTab === 'plates'" class="panel-head detail-view-head"><div><h2>{{ customerTab === 'overview' ? '客戶概覽' : '客戶牌照' }}</h2><p>{{ customerTab === 'overview' ? '資料與公司結構' : '牌照表格與到期時間軸' }}</p></div><Segmented v-model="detailView" :options="customerTab === 'overview' ? [{ value: 'table', label: '表格' }, { value: 'structure', label: '結構' }] : [{ value: 'table', label: '表格' }, { value: 'timeline', label: '時間軸' }]" label="客戶資料視圖" /></div>
  <CustomerStructure v-if="customerTab === 'overview' && detailView === 'structure'" :customer="selectedCustomer" :companies="customerCompanies" :groups="companyGroups" :plates="customerPlates" :vehicles="customerVehicles" @plate="openPlateById" @request="requestForPlate" />
  <DueSwimlane v-else-if="customerTab === 'plates' && detailView === 'timeline'" :plates="customerPlates" :deadlines="yearDeadlines.filter(item => item.customerId === selectedCustomer.id)" @plate="openPlateById" />
  <template v-else>
  <template v-if="customerTab === 'overview'"><div class="stat-row"><StatCard label="已逾期" tone="danger" :value="customerDeadlines.filter(item => item.level === 'overdue').length" hint="立即跟進" /><StatCard label="需處理" tone="warning" :value="customerDeadlines.filter(item => item.level === 'due').length" hint="提醒期內" /><StatCard label="待錄入" tone="neutral" :value="customerDeadlines.filter(item => item.level === 'missing').length" hint="補上日期或資料" /><StatCard label="進行中工單" tone="info" :value="activeCustomerRequests.length" hint="未完成" /></div><div class="grid-two"><section class="panel"><div class="panel-head"><div><h2>需要處理的事</h2><p>只顯示此客戶的逾期、需處理與待錄入。</p></div></div><div v-for="item in shownDeadlines" :key="`${item.ruleCode}:${item.ownerId}`" class="record-row"><div><strong>{{ item.name }}</strong><small><PlateChip v-if="['plate', 'vehicle'].includes(item.ownerType)" :plate="item.ownerLabel" /><template v-else>{{ item.ownerLabel }}</template></small><Tag v-if="item.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="item.handler === 'outsourced'" tone="warning">外包：{{ item.providerName }}</Tag></div><DueDate :date="item.dueOn" /></div><button v-if="customerDeadlines.length > 8" class="text-button show-all" @click="allDeadlines = !allDeadlines">{{ allDeadlines ? '收起' : `顯示全部 ${customerDeadlines.length} 項` }}</button><div v-if="!customerDeadlines.length" class="empty">目前沒有待處理項目</div></section><section class="panel"><div class="panel-head"><div><h2>進行中工單</h2><p>此客戶尚未完成的工單。</p></div></div><button v-for="request in activeCustomerRequests" :key="request.id" class="list-row" @click="openRequest(request)"><span class="list-main"><strong>{{ request.title }}</strong><small>{{ request.stage }}</small></span><span :class="['badge', statusBadge[request.status] || 'blue']">{{ request.status }}</span><span>→</span></button><div v-if="!activeCustomerRequests.length" class="empty">目前沒有進行中工單</div></section></div><section id="filing-summary" v-if="filingPeriods.length" class="panel"><div class="panel-head"><div><h2>報帳報稅</h2><p>本月進度，詳細操作在報帳報稅頁。</p></div><Button variant="text" size="sm" @click="router.push({ path: '/filings', query: { customer: selectedCustomer.id } })">查看</Button></div><p>{{ filingSummaryText }}</p><p v-if="filingOverdue">已逾期 {{ filingOverdue }} 期</p></section><p v-if="filingSummaryError" class="error" role="alert">未能載入報帳摘要：{{ filingSummaryError }} <Button size="sm" @click="loadFilingSummary">重試</Button></p></template>
  <template v-else-if="customerTab === 'companies'"><Companies :initial-customer="selectedCustomer.id" :is-self="!!selectedCustomer.is_self" :add-group-request="addGroupRequest" @plate="openPlateById" @saved="companySaved" @error="showError" /></template>
  <template v-else-if="customerTab === 'plates'"><section class="panel table-panel"><div class="panel-head"><div><h2>客戶牌照</h2><p>欄位與牌照總表一致。</p></div></div><DataTable :columns="plateColumns" :data="customerPlates" :min-width="880"><template #cell-mainland_plate="{ row }"><button class="phase-link" @click="openPlate(row)"><PlateChip :plate="row.mainland_plate" /> <PlateChip :plate="row.local_plate" :route="row.route" /></button></template><template #cell-holder_company="{ row }">{{ row.holder_company || row.card_data?.company || '持牌公司待補充' }}</template><template #cell-customer_id>{{ selectedCustomer.name }}</template><template #cell-port="{ row }">{{ row.port || '待設定' }}</template><template #cell-card_expires_on="{ row }"><DueDate :date="row.card_expires_on" /></template><template #cell-permit_expires_on="{ row }"><DueDate :date="row.permit_expires_on" editable label="CRP／通行證到期" :on-save="value => savePermit(row, value)" /></template><template #cell-health_status="{ row }"><span class="badge" :class="tone(row.health_status)">{{ label(row.health_status) }}</span></template></DataTable></section></template>
  <template v-else-if="customerTab === 'vehicles'"><DriverList :customer-id="selectedCustomer.id" @plate="openPlateById" @error="showError" @saved="showSuccess" /><section class="panel"><div class="panel-head"><div><h2>車輛</h2><p>查看客戶名下車輛。</p></div></div><div v-for="vehicle in customerVehicles" :key="vehicle.id" class="record-row"><button class="phase-link" @click="openVehicle(vehicle)"><PlateChip :plate="vehicle.plate" :route="vehicle.route" /></button><span>{{ vehicle.route }} · {{ vehicle.origin }} · {{ vehicle.type }}</span></div><div v-if="!customerVehicles.length" class="empty">尚未登記車輛</div></section></template>
  <template v-else-if="customerTab === 'business'"><section class="panel"><div class="panel-head"><div><h2>客戶業務</h2><p>點選工單查看步驟與進度。</p></div></div><button v-for="request in customerRequests" :key="request.id" class="list-row" @click="openRequest(request)"><span class="list-main"><strong>{{ request.title }}</strong><small>{{ request.stage }}</small></span><span :class="['badge', statusBadge[request.status] || 'blue']">{{ request.status }}</span><span>→</span></button><div v-if="!customerRequests.length" class="empty">尚無工單</div></section></template>
  </template></template>
  <div v-else class="panel empty" role="status">正在載入客戶資料…</div>
  <FormDialog :open="editOpen" title="編輯客戶" layout="stack" :saving="editSaving" submit-text="儲存" @close="editOpen = false" @submit="saveCustomer"><Field label="客戶名稱" required><TextInput v-model="editForm.name" placeholder="姓名或公司名稱" /></Field><Field label="類型"><Select v-model="editForm.kind" :options="['個人', '公司']" :disabled="!!selectedCustomer?.is_self" /></Field><p v-if="selectedCustomer?.is_self" class="dialog-note">本公司（自有）的類型不可更改。</p><Field label="聯絡電話"><TextInput v-model="editForm.phone" type="tel" /></Field><p v-if="editError" class="error" role="alert">{{ editError }}</p><template v-if="!selectedCustomer?.is_self" #extra><div class="danger-zone"><div><strong>刪除客戶</strong><p>只有沒有任何牌照、公司、工單、收費及登入帳號的客戶可以刪除，刪除後無法復原。</p></div><Button size="sm" variant="danger" @click="editOpen = false; customerDeleteOpen = true; customerDeleteError = ''">刪除客戶</Button></div></template></FormDialog>
  <Modal :open="!!resetTarget && !resetWelcome" :title="`重設${resetTarget?.name || ''}的密碼`" @close="closeReset"><Field label="新密碼" required><TextInput v-model="resetPassword" type="password" /></Field><p class="dialog-note">至少 10 個字元，不可與帳號相同。</p><p v-if="resetError" class="error" role="alert">{{ resetError }}</p><template #footer><Button @click="closeReset">取消</Button><Button variant="primary" :loading="resetSaving" :disabled="resetPassword.length < 10" @click="saveReset">重設</Button></template></Modal>
  <Modal :open="!!resetWelcome" title="客戶密碼已重設" sub="原有登入已全部失效。請以安全渠道轉發，關閉後不會再顯示新密碼。" @close="closeReset"><Field label="轉發給客戶的文字"><TextInput :model-value="resetWelcome" multiline readonly :rows="8" /></Field><p v-if="resetCopyError" class="error" role="alert">{{ resetCopyError }}</p><template #footer><Button @click="closeReset">完成</Button><Button variant="primary" @click="copyResetWelcome">複製轉發文字</Button></template></Modal>
  <Modal :open="!!bindCode" title="微信綁定碼" sub="一次性使用，10 分鐘內有效。請以安全渠道交付客戶。" @close="bindCode = ''"><KeyValue :items="[{ label: '客戶帳號', value: bindAccount }, { label: '綁定碼', value: bindCode }]" /><template #footer><Button @click="bindCode = ''">完成</Button><Button variant="primary" @click="copyBindCode">複製綁定碼</Button></template></Modal>
  <Modal :open="!!disableTarget" title="停用客戶帳號" :sub="`停用 ${disableTarget?.name || ''} 後，該帳號會立即登出，直至重新啟用。`" @close="disableTarget = null"><p v-if="accountActionError" role="alert" class="error">{{ accountActionError }}</p><template #footer><Button @click="disableTarget = null">取消</Button><Button variant="danger" :loading="!!accountSaving" @click="setAccountActive(disableTarget, false)">確認停用</Button></template></Modal>
  <FormDialog :open="!!loginTarget" :title="`修改${loginTarget?.name || ''}的登入資料`" layout="stack" :saving="loginSaving" submit-text="儲存" @close="loginTarget = null" @submit="saveLogin"><Field label="顯示名稱" required><TextInput v-model="loginForm.name" /></Field><p class="dialog-note">電郵或手機號碼至少填一項。改了電郵或手機後，客戶原有登入會失效，需用新帳號重新登入。</p><Field label="電郵"><TextInput v-model="loginForm.email" type="email" /></Field><Field label="手機號碼"><PhoneInput v-model="loginForm.phone" /></Field><p v-if="loginError" class="error" role="alert">{{ loginError }}</p></FormDialog>
  <Modal :open="!!deleteAccountTarget" title="刪除客戶帳號" :sub="`刪除 ${deleteAccountTarget?.name || ''} 後無法再登入，也無法復原。有上傳或操作紀錄的帳號不能刪除，請改用停用。`" @close="deleteAccountTarget = null"><p v-if="accountActionError" role="alert" class="error">{{ accountActionError }}</p><template #footer><Button @click="deleteAccountTarget = null">取消</Button><Button variant="danger" :loading="!!accountSaving" @click="deleteAccount">確認刪除</Button></template></Modal>
  <Modal :open="customerDeleteOpen" title="刪除客戶" :sub="`確定刪除「${selectedCustomer?.name || ''}」？刪除後無法復原。`" @close="customerDeleteOpen = false"><p v-if="customerDeleteError" role="alert" class="error">{{ customerDeleteError }}</p><template #footer><Button @click="customerDeleteOpen = false">取消</Button><Button variant="danger" :loading="customerDeleting" @click="deleteCustomer">確認刪除</Button></template></Modal>
  <Modal :open="templateOpen" title="套用委託範本" sub="先預覽變更清單，確認後才更新。" @close="templateOpen = false; preview = null"><Field label="範本"><select v-model="templateKey" @change="preview = null"><option value="full">全權托管</option><option value="plates_only">只管牌照</option><option value="plates_and_mainland">牌照＋內地公司</option></select></Field><p v-if="templateError" role="alert">{{ templateError }}</p><div v-for="change in preview?.changes || []" :key="`${change.ownerType}-${change.ownerId}-${change.item}`" class="record-row">{{ change.ownerLabel }} · {{ change.itemLabel }}：{{ handlerName(change.from) }} → {{ handlerName(change.to) }}</div><p v-if="preview && !preview.changes.length">沒有需要變更的項目。</p><template #footer><Button @click="templateOpen = false">取消</Button><Button v-if="!preview" @click="previewTemplate">預覽變更</Button><Button v-else variant="primary" :disabled="!preview.changes.length || templateBusy" @click="applyTemplate">{{ templateBusy ? '套用中…' : '確認套用' }}</Button></template></Modal>
  <Drawer :open="matrixOpen" title="委託範圍" sub="按公司和牌照逐件設定由誰辦理；改動累計後一次提交。" :width="960" @close="closeMatrix"><p v-if="matrixError" class="error" role="alert">{{ matrixError }}</p><p v-if="matrixLoading">載入委託範圍中…</p><ServiceScopeMatrix v-else-if="matrix" :data="matrix" :pending="pending" :is-self="!!selectedCustomer?.is_self" :saving="matrixSaving" @change="setMatrix" @column="setColumn" @items="openItems" /><section v-if="matrix && !selectedCustomer?.is_self" class="scope-section"><div class="panel-head"><div><h2>收費方式</h2><p>只有管理者看得到，客戶端不顯示價錢。改動只影響這位客戶，其餘沿用價目表。</p></div></div><PriceTable :customer-id="selectedCustomer.id" @saved="showSuccess" @error="showError" /></section><div v-for="item in outsourcedItems" :key="item" class="record-row"><Field :label="`${itemName(item)}外包單位（${Object.values(pending).filter(change => change.item === item && change.handler === 'outsourced').length} 格）`" required :hint="item === 'monthly_filing' ? '與報帳報稅頁共用；名單在報帳報稅頁的會計公司管理。' : ''"><Select v-if="item === 'monthly_filing'" :model-value="Object.values(pending).find(change => change.item === item && change.handler === 'outsourced')?.providerId || null" :options="firms.map(firm => ({ value: firm.id, label: firm.name }))" placeholder="選擇會計公司" empty-text="還沒有會計公司，請先到報帳報稅頁新增" @update:model-value="setFirm($event)" /><TextInput v-else :model-value="providerFor(item)" @update:model-value="setProvider(item, $event)" /></Field></div></Drawer>
  <Teleport to="body"><div v-if="matrixOpen && Object.keys(pending).length && !impact && !itemsSection" class="float-bar in-drawer"><span>{{ Object.keys(pending).length }} 格待提交</span><Button @click="pending = {}">放棄</Button><Button variant="primary" :disabled="matrixSaving" @click="reviewMatrix">{{ matrixSaving ? '處理中…' : '提交變更' }}</Button></div></Teleport>
  <Modal :open="!!impact" title="確認提交委託範圍" sub="以下是這次改動的影響。" @close="impact = null"><p v-if="impact?.toClient">{{ impact.toClient }} 項到期提醒將改為只提醒客戶，不再產生我們的工作。</p><p v-if="impact?.fromClient">{{ impact.fromClient }} 項改由我們跟進，會出現在今日工作。</p><template v-if="impact?.openRequests.length"><p>這些牌照有進行中的工單，工單不會自動取消：</p><div v-for="request in impact.openRequests" :key="request.id" class="record-row">{{ request.title }}</div></template><template #footer><Button @click="impact = null">返回修改</Button><Button variant="primary" :disabled="matrixSaving" @click="saveMatrix">{{ matrixSaving ? '提交中…' : '確認提交' }}</Button></template></Modal>
  <Modal :open="!!itemsSection" :title="`${itemsSection?.label || ''}的事項`" sub="勾選這位客戶要管的事項。不在清單上的事，系統不會提醒任何人；已填的日期會保留。停用的事項（例如審計及利得稅）要先在規則頁啟用。" @close="itemsSection = null"><template v-for="group in itemsGroups" :key="group.label"><h3 v-if="group.label">{{ group.label }}</h3><div v-for="item in group.items" :key="item.code" class="record-row"><Checkbox :model-value="!!itemsChecked[item.code]" :label="item.name" @update:model-value="itemsChecked = { ...itemsChecked, [item.code]: $event }; itemsPreview = null" /></div></template><p v-if="itemsError" class="error" role="alert">{{ itemsError }}</p><template v-if="itemsPreview"><p v-for="item in itemsPreview.removed" :key="`r-${item.code}`">移除「{{ item.name }}」：{{ item.owners }} {{ ownerUnit }}不再提醒任何人{{ item.ours ? `（其中 ${item.ours} ${ownerUnit}原由我們跟進）` : '' }}。</p><p v-for="item in itemsPreview.added" :key="`a-${item.code}`">加入「{{ item.name }}」：{{ item.owners }} {{ ownerUnit }}開始提醒。</p><template v-if="itemsPreview.openRequests.length"><p>這些牌照有進行中的工單，工單不會自動取消：</p><div v-for="request in itemsPreview.openRequests" :key="request.id" class="record-row">{{ request.title }}</div></template></template><template #footer><Button @click="itemsSection = null">取消</Button><Button v-if="!itemsPreview" :disabled="!itemsDiff.add.length && !itemsDiff.remove.length" @click="previewItems">預覽變更</Button><Button v-else variant="primary" :disabled="itemsBusy" @click="applyItems">{{ itemsBusy ? '儲存中…' : '確認' }}</Button></template></Modal>
</template>
<script setup>
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, user, phoneText, dateTime } from '../api'
import Button from '../components/ui/Button.vue'
import Modal from '../components/ui/Modal.vue'
import Drawer from '../components/ui/Drawer.vue'
import Field from '../components/ui/Field.vue'
import TextInput from '../components/ui/TextInput.vue'
import Select from '../components/ui/Select.vue'
import FormDialog from '../components/business/FormDialog.vue'
import PhoneInput from '../components/ui/PhoneInput.vue'
import Segmented from '../components/ui/Segmented.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import DueDate from '../components/ui/DueDate.vue'
import StatCard from '../components/ui/StatCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import KeyValue from '../components/ui/KeyValue.vue'
import ServiceScopeMatrix from '../components/business/ServiceScopeMatrix.vue'
import Checkbox from '../components/ui/Checkbox.vue'
import PriceTable from '../components/business/PriceTable.vue'
import CustomerStructure from '../components/business/CustomerStructure.vue'
import DueSwimlane from '../components/charts/DueSwimlane.vue'
import { useViewMode } from '../composables/view'
import Tag from '../components/ui/Tag.vue'
import Companies from './Companies.vue'
import DriverList from '../components/business/DriverList.vue'
import FeeLedger from '../components/business/FeeLedger.vue'
import { useAdminStore } from '../store'
const { view, selectedCustomer, modal, customerTab, customerPlates, customerVehicles, customerRequests, recentCustomerAccounts, overviewData, companyGroups: allGroups, companyRecords, newRequest, saveTrackedItem, refresh, openPlate, openPlateById, openVehicle, openRequest, iconFor, showSuccess, showError } = useAdminStore()
const isAdmin = user()?.role === 'admin'
const router = useRouter()
const filingPeriods = ref([]), filingSummaryError = ref('')
const filingSummary = computed(() => filingPeriods.value.filter(item => item.period === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()).slice(0, 7) && !item.closedReason))
const filingOverdue = computed(() => filingPeriods.value.filter(item => item.level === 'overdue' && !item.closedReason).length)
const filingSummaryText = computed(() => { if (!filingSummary.value.length) return '本月沒有需申報的公司'; const order = ['未開始', '資料已收', '會計處理中', '已申報', '已完成']; const counts = order.map(status => [status, filingSummary.value.filter(item => item.status === status).length]).filter(([, count]) => count); return `本月 ${filingSummary.value.length} 間：${counts.map(([status, count]) => `${status} ${count}`).join('、')}` })
async function loadFilingSummary() { if (!selectedCustomer.value) return; const id = selectedCustomer.value.id; filingSummaryError.value = ''; try { const result = await api(`/filings?customerId=${encodeURIComponent(id)}`); if (selectedCustomer.value?.id === id) filingPeriods.value = result } catch (error) { if (selectedCustomer.value?.id === id) filingSummaryError.value = error.message } }
watch(() => selectedCustomer.value?.id, () => { filingPeriods.value = []; loadFilingSummary() }, { immediate: true })
const advisor = ref({ name: '', phone: '', wechat: '' }), savedAdvisor = ref({ name: '', phone: '', wechat: '' }), advisorEditing = ref(false), advisorLoading = ref(false), advisorSaving = ref(false), advisorError = ref('')
const accounts = ref([]), accountsLoading = ref(false), accountsError = ref(''), accountSaving = ref(''), accountActionError = ref(''), disableTarget = ref(null)
const editOpen = ref(false), editForm = ref({ name: '', kind: '個人', phone: '' }), editSaving = ref(false), editError = ref('')
function openEdit() { editForm.value = { name: selectedCustomer.value.name, kind: selectedCustomer.value.kind, phone: selectedCustomer.value.phone || '' }; editError.value = ''; editOpen.value = true }
async function saveCustomer() {
  if (editSaving.value) return
  editError.value = ''
  if (!editForm.value.name.trim()) { editError.value = '請填寫客戶名稱'; return }
  editSaving.value = true
  try {
    const updated = await api(`/customers/${selectedCustomer.value.id}`, 'PATCH', editForm.value)
    const store = useAdminStore()
    // 清單行帶有牌照數、狀態等計算欄位，只合併改過的欄位
    const changes = { name: updated.name, kind: updated.kind, phone: updated.phone }
    store.customers.value = store.customers.value.map(item => item.id === updated.id ? { ...item, ...changes } : item)
    selectedCustomer.value = { ...selectedCustomer.value, ...changes }
    editOpen.value = false
    showSuccess('客戶資料已更新')
  } catch (error) { editError.value = error.message } finally { editSaving.value = false }
}
const resetTarget = ref(null), resetPassword = ref(''), resetSaving = ref(false), resetError = ref(''), resetWelcome = ref(''), resetCopyError = ref('')
function openReset(account) { resetTarget.value = account; resetPassword.value = ''; resetError.value = ''; resetWelcome.value = ''; resetCopyError.value = '' }
function closeReset() { resetTarget.value = null; resetPassword.value = ''; resetWelcome.value = ''; resetError.value = ''; resetCopyError.value = '' }
async function saveReset() {
  if (!resetTarget.value || resetSaving.value || resetPassword.value.length < 10) return
  resetSaving.value = true
  resetError.value = ''
  try {
    await api(`/customer-users/${resetTarget.value.id}/reset-password`, 'POST', { password: resetPassword.value })
    const entry = import.meta.env.VITE_CLIENT_LOGIN_URL || '微信小程序「車牌管家」'
    resetWelcome.value = `您好，${resetTarget.value.name}：\n「車牌管家」客戶登入密碼已重設。\n登入入口：${entry}\n帳號：${resetTarget.value.email || resetTarget.value.phone}\n新密碼：${resetPassword.value}\n請妥善保管密碼。`
    resetPassword.value = ''
    showSuccess('密碼已重設；原有登入已全部失效')
  } catch (error) { resetError.value = error.message } finally { resetSaving.value = false }
}
async function copyResetWelcome() { try { await navigator.clipboard.writeText(resetWelcome.value); resetCopyError.value = ''; showSuccess('轉發文字已複製') } catch { resetCopyError.value = '未能複製，請選取文字手動複製。' } }
// 需要處理的事先列 8 項，其餘按需展開
const allDeadlines = ref(false)
const shownDeadlines = computed(() => allDeadlines.value ? customerDeadlines.value : customerDeadlines.value.slice(0, 8))
// 工單狀態色：待開始灰、進行中藍、待客戶提供橙、已完成綠、已取消灰
const statusBadge = { 待開始: 'gray', 新要求: 'gray', 進行中: 'blue', 待客戶提供: 'amber', 已完成: 'success', 已取消: 'gray' }
const accountColumns = [{ key: 'name', title: '姓名' }, { key: 'email', title: '電郵' }, { key: 'phone', title: '手機號碼' }, { key: 'wechatBound', title: '微信' }, { key: 'active', title: '狀態' }, { key: 'lastLoginAt', title: '最近登入' }, { key: 'action', title: '操作' }]
async function loadAccounts() { if (!selectedCustomer.value || selectedCustomer.value.is_self) return; const customerId = selectedCustomer.value.id; accountsLoading.value = true; accountsError.value = ''; try { const result = await api(`/customers/${customerId}/users`); if (selectedCustomer.value?.id === customerId) accounts.value = result } catch (error) { accountsError.value = `未能取得客戶帳號：${error.message}` } finally { accountsLoading.value = false } }
watch(() => selectedCustomer.value?.id, () => { accounts.value = []; loadAccounts() }, { immediate: true })
watch(() => recentCustomerAccounts.value.length, () => loadAccounts())
async function setAccountActive(account, active) { if (!account || !isAdmin || accountSaving.value) return; accountSaving.value = account.id; accountActionError.value = ''; try { const updated = await api(`/customer-users/${account.id}`, 'PATCH', { active }); accounts.value = accounts.value.map(item => item.id === updated.id ? updated : item); disableTarget.value = null; showSuccess(active ? '帳號已重新啟用' : '帳號已停用並登出') } catch (error) { accountActionError.value = error.message; showError(error) } finally { accountSaving.value = '' } }
const loginTarget = ref(null), loginForm = ref({ name: '', email: '', phone: '' }), loginSaving = ref(false), loginError = ref(''), deleteAccountTarget = ref(null)
function openLogin(account) { loginTarget.value = account; loginForm.value = { name: account.name, email: account.email || '', phone: account.phone || '' }; loginError.value = '' }
async function saveLogin() {
  if (!loginTarget.value || loginSaving.value) return
  loginError.value = ''
  if (!loginForm.value.name.trim()) { loginError.value = '請填寫顯示名稱'; return }
  if (!loginForm.value.email.trim() && !loginForm.value.phone) { loginError.value = '電郵和手機號碼至少要保留一項'; return }
  loginSaving.value = true
  try {
    const before = loginTarget.value
    const updated = await api(`/customer-users/${before.id}`, 'PATCH', { name: loginForm.value.name, email: loginForm.value.email, phone: loginForm.value.phone })
    accounts.value = accounts.value.map(item => item.id === updated.id ? updated : item)
    loginTarget.value = null
    showSuccess(updated.email !== before.email || updated.phone !== before.phone ? '登入資料已更新；原有登入已失效' : '登入資料已更新')
  } catch (error) { loginError.value = error.message } finally { loginSaving.value = false }
}
async function deleteAccount() {
  const account = deleteAccountTarget.value
  if (!account || accountSaving.value) return
  accountSaving.value = account.id; accountActionError.value = ''
  try { await api(`/customer-users/${account.id}`, 'DELETE'); accounts.value = accounts.value.filter(item => item.id !== account.id); deleteAccountTarget.value = null; showSuccess('客戶帳號已刪除') }
  catch (error) { accountActionError.value = error.message } finally { accountSaving.value = '' }
}
const customerDeleteOpen = ref(false), customerDeleting = ref(false), customerDeleteError = ref('')
async function deleteCustomer() {
  if (customerDeleting.value) return
  customerDeleting.value = true; customerDeleteError.value = ''
  try {
    const removed = selectedCustomer.value
    await api(`/customers/${removed.id}`, 'DELETE')
    const store = useAdminStore()
    store.customers.value = store.customers.value.filter(item => item.id !== removed.id)
    customerDeleteOpen.value = false; editOpen.value = false
    view.value = 'customers'
    showSuccess(`已刪除客戶「${removed.name}」`)
  } catch (error) { customerDeleteError.value = error.message } finally { customerDeleting.value = false }
}
const bindCode = ref(''), bindAccount = ref(''), codeLoading = ref('')
async function loadAdvisor() { if (!selectedCustomer.value || !isAdmin) return; advisorLoading.value = true; advisorError.value = ''; try { savedAdvisor.value = await api(`/customers/${selectedCustomer.value.id}/advisor`); advisor.value = { ...savedAdvisor.value } } catch (error) { advisorError.value = `未能取得顧問資料：${error.message}` } finally { advisorLoading.value = false } }
watch(() => selectedCustomer.value?.id, () => { advisorEditing.value = false; advisor.value = { name: selectedCustomer.value?.advisor_name || '', phone: selectedCustomer.value?.advisor_phone || '', wechat: selectedCustomer.value?.advisor_wechat || '' }; if (isAdmin) loadAdvisor() }, { immediate: true })
async function saveAdvisor() { advisorSaving.value = true; advisorError.value = ''; try { savedAdvisor.value = await api(`/customers/${selectedCustomer.value.id}/advisor`, 'PUT', advisor.value); advisor.value = { ...savedAdvisor.value }; advisorEditing.value = false; showSuccess('顧問資料已儲存') } catch (error) { showError(error); advisorError.value = error.message } finally { advisorSaving.value = false } }
async function makeBindCode(account) { codeLoading.value = account.id; try { const result = await api(`/customer-users/${account.id}/wechat-bind-code`, 'POST'); bindAccount.value = account.name; bindCode.value = result.code } catch (error) { showError(error) } finally { codeLoading.value = '' } }
async function copyBindCode() { try { await navigator.clipboard.writeText(bindCode.value); showSuccess('綁定碼已複製') } catch { showError(new Error('未能複製，請手動選取綁定碼。')) } }
const tabs = [{ value: 'overview', label: '概覽' }, { value: 'companies', label: '公司組' }, { value: 'plates', label: '牌照' }, { value: 'vehicles', label: '車輛與司機' }, { value: 'business', label: '業務' }, ...(isAdmin ? [{ value: 'fees', label: '收費' }] : [])]
const detailView = useViewMode('customer-detail', 'table', ['table', 'structure', 'timeline'], 'table')
watch(customerTab, tab => { if (tab !== 'overview' && detailView.value === 'structure' || tab !== 'plates' && detailView.value === 'timeline') detailView.value = 'table' })
const yearDeadlines = ref([])
onMounted(async () => { try { yearDeadlines.value = (await api('/overview?days=365')).deadlines } catch (error) { showError(error) } })
// 改客戶或路線會清空已選牌照，所以等清空跑完再帶入牌照
function requestForPlate(id) { const store = useAdminStore(), plate = store.plates.value.find(item => item.id === id); if (plate) { store.newRequest.value.customerId = plate.customer_id; store.newRequest.value.route = plate.route || store.newRequest.value.route } nextTick(() => { store.newRequest.value.plateAssetId = id; store.newRequest.value.vehicleId = plate?.vehicle_id || '' }); store.view.value = 'new-request' }
const route = useRoute()
watch(() => route.query.tab, value => { if (tabs.some(tab => tab.value === value)) customerTab.value = value }, { immediate: true })
const templateOpen = ref(false), templateKey = ref('full'), preview = ref(null), templateError = ref(''), templateBusy = ref(false)
const handlerName = value => ({ us: '我們做', outsourced: '外包', client: '客戶自理' }[value] || value)
async function previewTemplate() { try { preview.value = await api(`/customers/${selectedCustomer.value.id}/apply-template`, 'POST', { template: templateKey.value, dryRun: true }); templateError.value = '' } catch (error) { templateError.value = error.message } }
async function applyTemplate() { templateBusy.value = true; try { await api(`/customers/${selectedCustomer.value.id}/apply-template`, 'POST', { template: templateKey.value, dryRun: false }); templateOpen.value = false; preview.value = null; showSuccess('委託範本已套用'); await refresh() } catch (error) { templateError.value = error.message } finally { templateBusy.value = false } }
const matrixOpen = ref(false), matrix = ref(null), matrixLoading = ref(false), matrixError = ref(''), matrixSaving = ref(false), pending = ref({}), impact = ref(null)
const firms = ref([])
async function loadMatrix() { matrixLoading.value = true; matrixError.value = ''; try { [matrix.value, firms.value] = await Promise.all([api(`/customers/${selectedCustomer.value.id}/scope`), api('/accounting-firms')]) } catch (error) { matrixError.value = error.message } finally { matrixLoading.value = false } }
function closeMatrix() { matrixOpen.value = false; pending.value = {}; impact.value = null }
// 一格可代表多件事（車牌小組），逐件累計；改回原值就從待提交移除
function setMatrix(owner, codes, handler) {
  const next = { ...pending.value }
  for (const item of codes) {
    const key = `${owner.type}:${owner.id}:${item}`, current = owner.cells[item]
    if (!current) continue
    if (handler === current.handler) delete next[key]
    else next[key] = { ownerType: owner.type, ownerId: owner.id, item, handler, providerName: next[key]?.providerName || (current.handler === 'outsourced' ? current.providerName : '') }
  }
  pending.value = next
}
function setColumn(section, codes, handler) { for (const owner of section.owners) setMatrix(owner, codes, handler) }
const itemName = code => matrix.value?.sections.flatMap(section => [...section.items, ...section.available]).find(item => item.code === code)?.name || code
// 外包單位：同一件事填一次，套用到這次提交的全部外包格
const outsourcedItems = computed(() => [...new Set(Object.values(pending.value).filter(change => change.handler === 'outsourced').map(change => change.item))])
const providerFor = item => Object.values(pending.value).find(change => change.item === item && change.handler === 'outsourced')?.providerName || ''
function setFirm(id) { const firm = firms.value.find(item => item.id === id); pending.value = Object.fromEntries(Object.entries(pending.value).map(([key, change]) => [key, change.item === 'monthly_filing' && change.handler === 'outsourced' ? { ...change, providerId: firm?.id, providerName: firm?.name || '' } : change])) }
function setProvider(item, value) { pending.value = Object.fromEntries(Object.entries(pending.value).map(([key, change]) => [key, change.item === item && change.handler === 'outsourced' ? { ...change, providerName: value } : change])) }
async function reviewMatrix() {
  if (Object.values(pending.value).some(change => change.handler === 'outsourced' && !change.providerName?.trim())) { matrixError.value = '外包須填寫單位名稱'; return }
  matrixSaving.value = true; matrixError.value = ''
  try {
    const result = await api('/service-scopes/batch', 'PUT', { changes: Object.values(pending.value), dryRun: true })
    if (result.impact.toClient || result.impact.fromClient || result.impact.openRequests.length) impact.value = result.impact
    else { matrixSaving.value = false; await saveMatrix() }
  } catch (error) { matrixError.value = error.message } finally { matrixSaving.value = false }
}
async function saveMatrix() { matrixSaving.value = true; matrixError.value = ''; try { await api('/service-scopes/batch', 'PUT', { changes: Object.values(pending.value) }); pending.value = {}; impact.value = null; await loadMatrix(); showSuccess('委託範圍已更新'); await refresh() } catch (error) { matrixError.value = error.message; impact.value = null } finally { matrixSaving.value = false } }
// 事項清單：勾選後先預覽影響，確認才寫入
const itemsSection = ref(null), itemsChecked = ref({}), itemsPreview = ref(null), itemsBusy = ref(false), itemsError = ref('')
function openItems(section) { itemsSection.value = section; itemsChecked.value = Object.fromEntries([...section.items.map(item => [item.code, true]), ...section.available.map(item => [item.code, false])]); itemsPreview.value = null; itemsError.value = '' }
const itemsGroups = computed(() => {
  const section = itemsSection.value
  if (!section) return []
  const all = [...section.items, ...section.available]
  if (section.category !== 'plate') return [{ label: '', items: all }]
  return Object.entries(matrix.value.groups).map(([key, label]) => ({ label, items: all.filter(item => item.group === key) })).filter(group => group.items.length)
})
const ownerUnit = computed(() => itemsSection.value?.category === 'plate' ? '個牌照' : '間公司')
const itemsDiff = computed(() => { const section = itemsSection.value; return section ? { add: section.available.filter(item => itemsChecked.value[item.code]).map(item => item.code), remove: section.items.filter(item => !itemsChecked.value[item.code]).map(item => item.code) } : { add: [], remove: [] } })
async function previewItems() { itemsError.value = ''; try { itemsPreview.value = await api(`/customers/${selectedCustomer.value.id}/items`, 'PUT', { ...itemsDiff.value, dryRun: true }) } catch (error) { itemsError.value = error.message } }
async function applyItems() {
  itemsBusy.value = true; itemsError.value = ''
  try {
    const { remove } = itemsDiff.value
    await api(`/customers/${selectedCustomer.value.id}/items`, 'PUT', { ...itemsDiff.value, dryRun: false })
    pending.value = Object.fromEntries(Object.entries(pending.value).filter(([, change]) => !remove.includes(change.item)))
    itemsSection.value = null; await loadMatrix(); showSuccess('事項清單已更新'); await refresh()
  } catch (error) { itemsError.value = error.message } finally { itemsBusy.value = false }
}
const plateColumns = [{ key: 'mainland_plate', title: '車牌' }, { key: 'holder_company', title: '持牌公司' }, { key: 'customer_id', title: '客戶' }, { key: 'port', title: '口岸' }, { key: 'card_expires_on', title: '批文到期' }, { key: 'permit_expires_on', title: 'CRP／通行證到期' }, { key: 'usage_status', title: '使用' }, { key: 'health_status', title: '狀態' }]
const addGroupRequest = ref(0)
const companyGroups = computed(() => allGroups.value.filter(group => group.customer_id === selectedCustomer.value?.id))
const customerCompanies = computed(() => companyRecords.value.filter(company => company.customer_id === selectedCustomer.value?.id))
function addRecord(event) { const choice = event.target.value; event.target.value = ''; if (choice === 'company') { customerTab.value = 'companies'; addGroupRequest.value += 1 } else if (choice === 'request') { newRequest.value.customerId = selectedCustomer.value.id; view.value = 'new-request' } else if (choice) { useAdminStore().form.value = { customerId: selectedCustomer.value.id, route: '粵港', origin: '香港', kind: '個人' }; modal.value = choice } }
async function companySaved(message) { await refresh(); showSuccess(message) }
async function savePermit(plate, expiresOn) { return saveTrackedItem({ ownerType: 'plate', ownerId: plate.id, code: plate.route === '粵港' ? 'hk_crp' : 'mo_permit', expiresOn }) }
const customerDeadlines = computed(() => (overviewData.value.deadlines || []).filter(item => item.customerId === selectedCustomer.value?.id && ['overdue', 'due', 'missing'].includes(item.level)))
const activeCustomerRequests = computed(() => customerRequests.value.filter(item => ['待開始', '進行中', '待客戶提供'].includes(item.status)))
const tone = level => ({ overdue: 'danger', due: 'amber', missing: 'muted' }[level] || '')
const label = level => ({ overdue: '已逾期', due: '需處理', missing: '待錄入', ok: '正常' }[level] || level)
</script>
