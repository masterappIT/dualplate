<template>
  <template v-if="selectedCustomer">
  <button class="back" @click="view = 'customers'">← 返回客戶</button>
  <section class="holder-card guilloche-panel"><div class="holder-main"><span class="holder-kicker">{{ selectedCustomer.is_self ? '本公司自有' : '委託人' }}</span><h1>{{ selectedCustomer.name }}</h1><p>{{ selectedCustomer.kind }} · <span class="num">{{ phoneText(selectedCustomer.phone) || '未填電話' }}</span></p></div><dl class="holder-counts"><div><dt>牌照</dt><dd class="num">{{ customerPlates.length }}</dd></div><div><dt>公司組</dt><dd class="num">{{ companyGroups.length }}</dd></div><div><dt>車輛</dt><dd class="num">{{ customerVehicles.length }}</dd></div><div><dt>工單</dt><dd class="num">{{ customerRequests.length }}</dd></div></dl><div class="holder-actions"><button v-if="isAdmin" class="button outline on-dark" @click="openEdit">編輯客戶</button><button v-if="canAddLogin && !accounts.length" class="button outline on-dark" @click="modal = 'customer-user'">開通登入</button><button v-if="!selectedCustomer.is_self && isAdmin && selectedCustomer.service_mode !== '自管'" class="button outline on-dark" @click="templateOpen = true">套用委託範本</button><button v-if="isAdmin" class="button outline on-dark" @click="matrixOpen = true; loadMatrix()">委託範圍</button><button v-if="deletion?.canDelete" class="button outline on-dark" @click="openCustomerDelete">刪除客戶</button><select class="button on-dark" aria-label="新增資料" @change="addRecord($event)"><option value="">＋ 新增</option><option v-if="isAdmin" value="plate">牌照</option><option v-if="isAdmin" value="vehicle">車輛</option><option v-if="isAdmin" value="company">公司組</option><option value="request">工單</option></select></div></section>
  <Segmented v-model="customerTab" :options="tabs" label="客戶資料分頁" />
  <FeeLedger v-if="customerTab === 'fees' && isAdmin && !selectedCustomer.is_self" :customer-id="selectedCustomer.id" />
  <ServiceModePanel v-if="customerTab === 'overview' && !selectedCustomer.is_self" :customer-id="selectedCustomer.id" @changed="modeChanged" />
  <section v-if="customerTab === 'overview'" class="panel guilloche-panel"><div class="panel-head"><div><h2>顧問</h2><p>客戶可在客戶端查看聯絡方式。</p></div><Button v-if="isAdmin && !advisorEditing" size="sm" @click="advisorEditing = true">編輯</Button></div><p v-if="advisorLoading" role="status">正在載入顧問資料…</p><p v-else-if="advisorError && !advisorEditing" class="error" role="alert">{{ advisorError }} <Button size="sm" @click="loadAdvisor">重試</Button></p><template v-else-if="advisorEditing"><p v-if="advisorError" class="error" role="alert">{{ advisorError }}</p><div class="form-grid"><Field label="姓名"><TextInput v-model="advisor.name" /></Field><Field label="電話"><TextInput v-model="advisor.phone" type="tel" /></Field><Field label="微信號"><TextInput v-model="advisor.wechat" /></Field></div><div class="heading-actions"><Button :disabled="advisorSaving" @click="advisorEditing = false; advisor = { ...savedAdvisor }; advisorError = ''">取消</Button><Button variant="primary" :loading="advisorSaving" @click="saveAdvisor">儲存顧問</Button></div></template><KeyValue v-else :items="[{ label: '姓名', value: advisor.name || '顧問資料整理中' }, { label: '電話', value: advisor.phone || '未填寫' }, { label: '微信號', value: advisor.wechat || '未填寫' }]" /></section>
  <section v-if="customerTab === 'overview' && !selectedCustomer.is_self" class="panel"><div class="panel-head"><div><h2>客戶帳號</h2><p>{{ selectedCustomer.service_mode === '自管' ? '查看登入狀態與微信綁定情況。自管客戶目前只可開一個登入。' : '查看登入狀態與微信綁定情況。可再開登入給助手或同事，權限相同。' }}</p></div><Button v-if="canAddLogin && accounts.length" size="sm" @click="modal = 'customer-user'">新增登入</Button></div><p v-if="accountsError" role="alert" class="error">{{ accountsError }} <Button size="sm" @click="loadAccounts">重試</Button></p><DataTable v-else :columns="accountColumns" :data="accounts" :loading="accountsLoading" :min-width="760"><template #cell-phone="{ row }">{{ phoneText(row.phone) || '未填寫' }}</template><template #cell-email="{ row }">{{ row.email || '未填寫' }}</template><template #cell-wechatBound="{ row }"><Tag :tone="row.wechatBound ? 'ok' : 'neutral'">{{ row.wechatBound ? '已綁定' : '未綁定' }}</Tag></template><template #cell-active="{ row }"><Tag :tone="row.active ? 'ok' : 'neutral'">{{ row.active ? '啟用' : '已停用' }}</Tag></template><template #cell-lastLoginAt="{ row }"><span class="num">{{ row.lastLoginAt ? dateTime(row.lastLoginAt) : '尚未登入' }}</span></template><template #cell-action="{ row }"><div v-if="isAdmin" class="account-actions"><Button size="sm" :loading="codeLoading === row.id" :disabled="!row.active" @click="makeBindCode(row)">產生微信綁定碼</Button><Button size="sm" variant="text" @click="openLogin(row)">修改</Button><Button size="sm" variant="text" :loading="passwordLoading === row.id" @click="showPassword(row)">查看密碼</Button><Button size="sm" variant="text" @click="openReset(row)">重設密碼</Button><Button size="sm" variant="text" :loading="accountSaving === row.id" @click="row.active ? disableTarget = row : setAccountActive(row, true)">{{ row.active ? '停用' : '重新啟用' }}</Button><Button size="sm" variant="text" @click="deleteAccountTarget = row; accountActionError = ''">刪除</Button></div><span v-else>僅供查看</span></template><template #empty><EmptyState title="還沒有開通客戶登入"><Button v-if="isAdmin" size="sm" @click="modal = 'customer-user'">開通登入</Button></EmptyState></template></DataTable></section>
  <div v-if="customerTab === 'overview' || customerTab === 'plates'" class="panel-head detail-view-head"><div><h2>{{ customerTab === 'overview' ? '客戶概覽' : '客戶牌照' }}</h2><p>{{ customerTab === 'overview' ? '資料與公司結構' : '牌照表格與到期時間軸' }}</p></div><Segmented v-model="detailView" :options="customerTab === 'overview' ? [{ value: 'table', label: '表格' }, { value: 'structure', label: '結構' }] : [{ value: 'table', label: '表格' }, { value: 'timeline', label: '時間軸' }]" label="客戶資料視圖" /></div>
  <CustomerStructure v-if="customerTab === 'overview' && detailView === 'structure'" :customer="selectedCustomer" :companies="customerCompanies" :groups="companyGroups" :plates="customerPlates" :vehicles="customerVehicles" @plate="openPlateById" @request="requestForPlate" />
  <DueSwimlane v-else-if="customerTab === 'plates' && detailView === 'timeline'" :plates="customerPlates" :deadlines="yearDeadlines.filter(item => item.customerId === selectedCustomer.id)" @plate="openPlateById" />
  <template v-else>
  <template v-if="customerTab === 'overview'"><div class="stat-row"><StatCard label="已逾期" tone="danger" :value="customerDeadlines.filter(item => item.level === 'overdue').length" hint="立即跟進" /><StatCard label="需處理" tone="warning" :value="customerDeadlines.filter(item => item.level === 'due').length" hint="提醒期內" /><StatCard label="待錄入" tone="neutral" :value="customerDeadlines.filter(item => item.level === 'missing').length" hint="補上日期或資料" /><StatCard label="進行中工單" tone="info" :value="activeCustomerRequests.length" hint="未完成" /></div><div class="grid-two"><section class="panel"><div class="panel-head"><div><h2>需要處理的事</h2><p>只顯示此客戶的逾期、需處理與待錄入。</p></div></div><div v-for="item in shownDeadlines" :key="`${item.ruleCode}:${item.ownerId}`" class="record-row"><div><strong>{{ item.name }}</strong><small><PlateChip v-if="['plate', 'vehicle'].includes(item.ownerType)" :plate="item.ownerLabel" /><template v-else>{{ item.ownerLabel }}</template></small><Tag v-if="item.handler === 'client'" tone="neutral">客戶自理</Tag><Tag v-else-if="item.handler === 'outsourced'" tone="warning">外包：{{ item.providerName }}</Tag></div><DueDate :date="item.dueOn" /></div><button v-if="customerDeadlines.length > 8" class="text-button show-all" @click="allDeadlines = !allDeadlines">{{ allDeadlines ? '收起' : `顯示全部 ${customerDeadlines.length} 項` }}</button><div v-if="!customerDeadlines.length" class="empty">目前沒有待處理項目</div></section><section class="panel"><div class="panel-head"><div><h2>進行中工單</h2><p>此客戶尚未完成的工單。</p></div></div><button v-for="request in activeCustomerRequests" :key="request.id" class="list-row" @click="openRequest(request)"><span class="list-main"><strong>{{ request.title }}</strong><small>{{ request.stage }}</small></span><span :class="['badge', statusBadge[request.status] || 'blue']">{{ request.status }}</span><span>→</span></button><div v-if="!activeCustomerRequests.length" class="empty">目前沒有進行中工單</div></section></div><section id="filing-summary" v-if="filingPeriods.length" class="panel"><div class="panel-head"><div><h2>報帳報稅</h2><p>本月進度，詳細操作在報帳報稅頁。</p></div><Button variant="text" size="sm" @click="router.push({ path: '/filings', query: { customer: selectedCustomer.id } })">查看</Button></div><p>{{ filingSummaryText }}</p><p v-if="filingOverdue">已逾期 {{ filingOverdue }} 期</p></section><p v-if="filingSummaryError" class="error" role="alert">未能載入報帳摘要：{{ filingSummaryError }} <Button size="sm" @click="loadFilingSummary">重試</Button></p></template>
  <template v-else-if="customerTab === 'companies'"><Companies :initial-customer="selectedCustomer.id" :is-self="!!selectedCustomer.is_self" :add-group-request="addGroupRequest" @plate="openPlateById" @saved="companySaved" @error="showError" /></template>
  <template v-else-if="customerTab === 'plates'"><section class="panel table-panel"><div class="panel-head"><div><h2>客戶牌照</h2><p>欄位與牌照總表一致。</p></div></div><DataTable :columns="plateColumns" :data="customerPlates" :min-width="880"><template #cell-mainland_plate="{ row }"><button class="phase-link" @click="openPlate(row)"><PlateChip :plate="row.mainland_plate" /> <PlateChip :plate="row.local_plate" :route="row.route" /></button></template><template #cell-holder_company="{ row }"><CompanyName v-if="row.holder_company" :company="{ name: row.holder_company, nameEn: row.holder_company_en, jurisdiction: row.route === '粵港' ? '香港' : '澳門' }" /><span v-else>{{ row.card_data?.company || '持牌公司待補充' }}</span></template><template #cell-customer_id>{{ selectedCustomer.name }}</template><template #cell-port="{ row }">{{ row.port || '待設定' }}</template><template #cell-card_expires_on="{ row }"><DueDate :date="row.card_expires_on" /></template><template #cell-permit_expires_on="{ row }"><DueDate :date="row.permit_expires_on" editable label="CRP／通行證到期" :on-save="value => savePermit(row, value)" /></template><template #cell-health_status="{ row }"><span class="badge" :class="tone(row.health_status)">{{ label(row.health_status) }}</span></template></DataTable></section></template>
  <template v-else-if="customerTab === 'vehicles'"><DriverList :customer-id="selectedCustomer.id" @plate="openPlateById" @error="showError" @saved="showSuccess" /><section class="panel"><div class="panel-head"><div><h2>車輛</h2><p>查看客戶名下車輛。</p></div></div><div v-for="vehicle in customerVehicles" :key="vehicle.id" class="record-row"><button class="phase-link" @click="openVehicle(vehicle)"><PlateChip :plate="vehicle.plate" :route="vehicle.route" /></button><span>{{ vehicle.route }} · {{ vehicle.origin }} · {{ vehicle.type }}</span></div><div v-if="!customerVehicles.length" class="empty">尚未登記車輛</div></section></template>
  <template v-else-if="customerTab === 'business'"><section class="panel"><div class="panel-head"><div><h2>客戶業務</h2><p>點選工單查看步驟與進度。</p></div></div><button v-for="request in customerRequests" :key="request.id" class="list-row" @click="openRequest(request)"><span class="list-main"><strong>{{ request.title }}</strong><small>{{ request.stage }}</small></span><span :class="['badge', statusBadge[request.status] || 'blue']">{{ request.status }}</span><span>→</span></button><div v-if="!customerRequests.length" class="empty">尚無工單</div></section></template>
  </template></template>
  <div v-else class="panel empty" role="status">正在載入客戶資料…</div>
  <FormDialog :open="editOpen" title="編輯客戶" layout="stack" :saving="editSaving" submit-text="儲存" @close="editOpen = false" @submit="saveCustomer"><Field label="客戶名稱" required><TextInput v-model="editForm.name" placeholder="姓名或公司名稱" /></Field><Field label="類型"><Select v-model="editForm.kind" :options="['個人', '公司']" :disabled="!!selectedCustomer?.is_self" /></Field><p v-if="selectedCustomer?.is_self" class="dialog-note">本公司（自有）的類型不可更改。</p><Field label="聯絡電話"><TextInput v-model="editForm.phone" type="tel" /></Field><p v-if="editError" class="error" role="alert">{{ editError }}</p><template v-if="deletion && !deletion.canDelete && deletion.blockers.length" #extra><div class="danger-zone"><div><strong>刪除客戶</strong><p>名下仍有{{ deletion.blockers.join('、') }}，不能刪除；這些是帳目和辦理記錄，需要保留。只有沒有業務資料的客戶可以刪除。</p></div></div></template></FormDialog>
  <Modal :open="!!resetTarget && !resetWelcome" :title="`重設${resetTarget?.name || ''}的密碼`" @close="closeReset"><Field label="新密碼" required><TextInput v-model="resetPassword" type="password" /></Field><p class="dialog-note">至少 10 個字元，不可與帳號相同。</p><p v-if="resetError" class="error" role="alert">{{ resetError }}</p><template #footer><Button @click="closeReset">取消</Button><Button variant="primary" :loading="resetSaving" :disabled="resetPassword.length < 10" @click="saveReset">重設</Button></template></Modal>
  <Modal :open="!!resetWelcome" title="客戶密碼已重設" sub="原有登入已全部失效。請以安全渠道轉發；之後可在客戶帳號按「查看密碼」再看。" @close="closeReset"><Field label="轉發給客戶的文字"><TextInput :model-value="resetWelcome" multiline readonly :rows="8" /></Field><p v-if="resetCopyError" class="error" role="alert">{{ resetCopyError }}</p><template #footer><Button @click="closeReset">完成</Button><Button variant="primary" @click="copyResetWelcome">複製轉發文字</Button></template></Modal>
  <Modal :open="!!passwordShown" :title="`${passwordShown?.name || ''}的登入密碼`" sub="只限管理者查看，每次查看都記在操作記錄。請只在協助客戶登入時使用。" @close="passwordShown = null"><p v-if="passwordShown?.password === null" class="dialog-note">{{ passwordShown.reason }}</p><KeyValue v-else :items="[{ label: '登入帳號', value: passwordShown?.account }, { label: '密碼', value: passwordShown?.password }]" /><template #footer><Button @click="passwordShown = null">完成</Button><Button v-if="passwordShown?.password" variant="primary" @click="copyPassword">複製密碼</Button></template></Modal>
  <Modal :open="!!bindCode" title="微信綁定碼" sub="一次性使用，10 分鐘內有效。請以安全渠道交付客戶。" @close="bindCode = ''"><KeyValue :items="[{ label: '客戶帳號', value: bindAccount }, { label: '綁定碼', value: bindCode }]" /><template #footer><Button @click="bindCode = ''">完成</Button><Button variant="primary" @click="copyBindCode">複製綁定碼</Button></template></Modal>
  <Modal :open="!!disableTarget" title="停用客戶帳號" :sub="`停用 ${disableTarget?.name || ''} 後，該帳號會立即登出，直至重新啟用。`" @close="disableTarget = null"><p v-if="accountActionError" role="alert" class="error">{{ accountActionError }}</p><template #footer><Button @click="disableTarget = null">取消</Button><Button variant="danger" :loading="!!accountSaving" @click="setAccountActive(disableTarget, false)">確認停用</Button></template></Modal>
  <FormDialog :open="!!loginTarget" :title="`修改${loginTarget?.name || ''}的登入資料`" layout="stack" :saving="loginSaving" submit-text="儲存" @close="loginTarget = null" @submit="saveLogin"><Field label="顯示名稱" required><TextInput v-model="loginForm.name" /></Field><p class="dialog-note">電郵或手機號碼至少填一項。改了電郵或手機後，客戶原有登入會失效，需用新帳號重新登入。</p><Field label="電郵"><TextInput v-model="loginForm.email" type="email" /></Field><Field label="手機號碼"><PhoneInput v-model="loginForm.phone" /></Field><p v-if="loginError" class="error" role="alert">{{ loginError }}</p></FormDialog>
  <Modal :open="!!deleteAccountTarget" title="刪除客戶帳號" :sub="`刪除 ${deleteAccountTarget?.name || ''} 後無法再登入，也無法復原。有上傳或操作紀錄的帳號不能刪除，請改用停用。`" @close="deleteAccountTarget = null"><p v-if="accountActionError" role="alert" class="error">{{ accountActionError }}</p><template #footer><Button @click="deleteAccountTarget = null">取消</Button><Button variant="danger" :loading="!!accountSaving" @click="deleteAccount">確認刪除</Button></template></Modal>
  <Modal :open="customerDeleteOpen" title="刪除客戶" :sub="`確定刪除「${selectedCustomer?.name || ''}」？刪除後無法復原。`" @close="customerDeleteOpen = false"><template v-if="deletion?.logins.length"><p class="dialog-note">以下 {{ deletion.logins.length }} 個登入帳號會一併刪除，之後不能再登入：</p><ul class="delete-logins"><li v-for="login in deletion.logins" :key="login.id"><strong>{{ login.name }}</strong><span>{{ phoneText(login.phone) || login.email }}</span><Tag v-if="!login.active" tone="neutral">已停用</Tag></li></ul></template><p v-else class="dialog-note">這位客戶沒有登入帳號。</p><p v-if="customerDeleteError" role="alert" class="error">{{ customerDeleteError }}</p><template #footer><Button @click="customerDeleteOpen = false">取消</Button><Button variant="danger" :loading="customerDeleting" @click="deleteCustomer">確認刪除</Button></template></Modal>
  <Modal :open="templateOpen" title="套用委託範本" sub="選範本後即時列出會改動的地方，確認才更新；之後仍可在委託範圍逐格調整。" :width="640" @close="templateOpen = false; preview = null">
    <div class="template-pick"><Segmented v-model="templateKey" :options="templateOptions" label="委託範本" /><p class="cell-sub">{{ templateDesc[templateKey] }}</p></div>
    <p v-if="templateError" class="error" role="alert">{{ templateError }}</p>
    <p v-else-if="!preview" class="cell-sub">計算改動中…</p>
    <p v-else-if="!preview.changes.length" class="template-none">目前的設定已和這個範本一致，不用改動。</p>
    <template v-else>
      <p class="template-total">會改動 <b class="tnum">{{ preview.changes.length }}</b> 項：</p>
      <ul class="template-summary"><li v-for="row in templateSummary" :key="row.key"><span>{{ row.itemLabel }}</span><span class="tnum">{{ row.count }} {{ row.unit }}</span><span>{{ handlerName(row.from) }} → <b>{{ handlerName(row.to) }}</b></span></li></ul>
      <details class="template-details"><summary>看逐間明細</summary><div v-for="owner in templateOwners" :key="owner.key" class="template-owner"><strong>{{ owner.label }}</strong><span v-for="change in owner.changes" :key="change.item">{{ change.itemLabel }}：{{ handlerName(change.from) }} → {{ handlerName(change.to) }}</span></div></details>
    </template>
    <template #footer><Button @click="templateOpen = false">取消</Button><Button variant="primary" :loading="templateBusy" :disabled="!preview?.changes.length" @click="applyTemplate">套用{{ preview?.changes.length ? `（${preview.changes.length} 項）` : '' }}</Button></template>
  </Modal>
  <Drawer :open="matrixOpen" title="委託範圍" sub="每格選由誰辦理；改動先累計，按底部「提交變更」才儲存。" :width="960" @close="closeMatrix">
    <p v-if="matrixError" class="error" role="alert">{{ matrixError }}</p>
    <p v-if="!matrixLoading && matrix?.customer.serviceMode === '自管'" class="dialog-note">自管客戶：全部事項由客戶自理，不能改為我們負責。要由我們負責，請先在客戶概覽的「委託方式」切換為托管。</p>
    <p v-if="matrixLoading">載入委託範圍中…</p>
    <template v-else-if="matrix">
      <Segmented v-model="matrixTab" :options="matrixTabs" label="委託範圍分類" class="matrix-tabs" />
      <ServiceScopeMatrix v-if="matrixTab !== 'prices'" :data="matrix" :pending="pending" :is-self="!!selectedCustomer?.is_self" :saving="matrixSaving" :category="matrixTab" @change="setMatrix" @column="setColumn" @items="openItems" />
      <section v-else class="scope-section"><div class="panel-head"><div><h2>收費方式</h2><p>只有管理者看得到，客戶端不顯示價錢。改動在表底按「儲存」一次儲存，只影響這位客戶，其餘沿用價目表。</p></div></div><PriceTable :customer-id="selectedCustomer.id" @saved="showSuccess" @error="showError" /></section>
    </template>
  </Drawer>
  <Teleport to="body"><div v-if="matrixOpen && Object.keys(pending).length && !impact && !itemsSection" class="float-bar in-drawer"><span>{{ Object.keys(pending).length }} 格待提交</span><Button @click="pending = {}">放棄</Button><Button variant="primary" :disabled="matrixSaving" @click="reviewMatrix">{{ matrixSaving ? '處理中…' : '提交變更' }}</Button></div></Teleport>
  <Modal :open="!!impact" title="確認提交委託範圍" :sub="`共 ${Object.keys(pending).length} 格改動。`" @close="impact = null">
    <div v-if="outsourcedItems.length" class="scope-providers"><p>改為外包的事項，請填外包單位：</p><Field v-for="item in outsourcedItems" :key="item" :label="`${itemName(item)}（${Object.values(pending).filter(change => change.item === item && change.handler === 'outsourced').length} 格）`" required :hint="item === 'monthly_filing' ? '與報帳報稅頁共用；名單在報帳報稅頁的「會計公司」管理。' : ''"><Select v-if="item === 'monthly_filing'" :model-value="Object.values(pending).find(change => change.item === item && change.handler === 'outsourced')?.providerId || null" :options="firms.map(firm => ({ value: firm.id, label: firm.name }))" placeholder="選擇會計公司" empty-text="還沒有會計公司，請先到報帳報稅頁新增" @update:model-value="setFirm($event)" /><TextInput v-else :model-value="providerFor(item)" placeholder="例如：信達會計（廣州）" @update:model-value="setProvider(item, $event)" /></Field></div>
    <p v-if="impact?.toClient">{{ impact.toClient }} 項到期提醒將改為只提醒客戶，不再產生我們的工作。</p>
    <p v-if="impact?.fromClient">{{ impact.fromClient }} 項改由我們跟進，會出現在今日工作。</p>
    <template v-if="impact?.openRequests.length"><p>這些牌照有進行中的工單，工單不會自動取消：</p><div v-for="request in impact.openRequests" :key="request.id" class="record-row">{{ request.title }}</div></template>
    <p v-if="impactError" class="error" role="alert">{{ impactError }}</p>
    <template #footer><Button @click="impact = null">返回修改</Button><Button variant="primary" :loading="matrixSaving" :disabled="missingProvider" @click="saveMatrix">確認提交</Button></template>
  </Modal>
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
import CompanyName from '../components/business/CompanyName.vue'
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
import ServiceModePanel from '../components/business/ServiceModePanel.vue'
import { useAdminStore } from '../store'
import { confirm } from '../composables/confirm'
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
// 托管客戶可開多個登入；自管客戶暫時只可一個（停用的也算，後端 service-mode.js loginLimit 同一規則），已注銷的不能再開
const canAddLogin = computed(() => { const customer = selectedCustomer.value; return Boolean(isAdmin && customer && !customer.is_self && !customer.closed_on && !accountsLoading.value && !(customer.service_mode === '自管' && accounts.value.length)) })
const editOpen = ref(false), editForm = ref({ name: '', kind: '個人', phone: '' }), editSaving = ref(false), editError = ref('')
// 切換自管／托管後即時更新頂部按鈕（自管不顯示「套用委託範本」），再刷新列表
function modeChanged(info) { selectedCustomer.value = { ...selectedCustomer.value, service_mode: info.mode, mode_since: info.since, contract_ends_on: info.contractEndsOn }; refresh() }
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
// 查看客戶密碼（2026-10-18 管理者決定）：每次按都向伺服器取一次，伺服器寫入操作記錄
const passwordShown = ref(null), passwordLoading = ref('')
async function showPassword(account) {
  passwordLoading.value = account.id
  try { const result = await api(`/customer-users/${account.id}/password-view`, 'POST', {}); passwordShown.value = { name: account.name, account: account.email || phoneText(account.phone), ...result } } catch (error) { showError(error) } finally { passwordLoading.value = '' }
}
async function copyPassword() { try { await navigator.clipboard.writeText(passwordShown.value.password); showSuccess('密碼已複製') } catch { showError(new Error('未能複製，請手動抄寫')) } }
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
// 能否刪除、會一併刪除的登入：只有管理者可以刪除，自有客戶不刪；登入有增減時重新讀取
const deletion = ref(null)
async function loadDeletion() {
  const customer = selectedCustomer.value
  if (!isAdmin || !customer || customer.is_self) { deletion.value = null; return }
  try { const result = await api(`/customers/${customer.id}/deletion`); if (selectedCustomer.value?.id === customer.id) deletion.value = result } catch { deletion.value = null }
}
function openCustomerDelete() { customerDeleteError.value = ''; customerDeleteOpen.value = true; loadDeletion() }
async function deleteCustomer() {
  if (customerDeleting.value || !deletion.value?.canDelete) return
  customerDeleting.value = true; customerDeleteError.value = ''
  try {
    const removed = selectedCustomer.value
    await api(`/customers/${removed.id}`, 'DELETE', { logins: deletion.value.logins.length })
    const store = useAdminStore()
    store.customers.value = store.customers.value.filter(item => item.id !== removed.id)
    customerDeleteOpen.value = false; editOpen.value = false
    view.value = 'customers'
    showSuccess(`已刪除客戶「${removed.name}」`)
  } catch (error) { customerDeleteError.value = error.message; loadDeletion() } finally { customerDeleting.value = false }
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
// 範本：選了即計算改動（不用另按預覽），按事項彙總，逐間明細收起
const templateOptions = [{ value: 'full', label: '全權托管' }, { value: 'plates_only', label: '只管牌照' }, { value: 'plates_and_mainland', label: '牌照＋內地公司' }]
const templateDesc = { full: '牌照和全部公司的事項都由我們做。', plates_only: '牌照的事項由我們做；香港、澳門、內地公司的事項改為客戶自理。', plates_and_mainland: '牌照和內地公司的事項由我們做；香港、澳門公司的事項改為客戶自理。' }
async function previewTemplate() { preview.value = null; templateError.value = ''; const key = templateKey.value; try { const result = await api(`/customers/${selectedCustomer.value.id}/apply-template`, 'POST', { template: key, dryRun: true }); if (key === templateKey.value) preview.value = result } catch (error) { templateError.value = error.message } }
watch([templateOpen, templateKey], () => { if (templateOpen.value) previewTemplate() })
const templateSummary = computed(() => { const rows = new Map(); for (const change of preview.value?.changes || []) { const key = `${change.itemLabel}:${change.from}:${change.to}`; const row = rows.get(key) || { key, itemLabel: change.itemLabel, from: change.from, to: change.to, count: 0, unit: change.ownerType === 'plate' ? '個牌照' : '間公司' }; row.count += 1; rows.set(key, row) } return [...rows.values()] })
const templateOwners = computed(() => { const owners = new Map(); for (const change of preview.value?.changes || []) { const key = `${change.ownerType}:${change.ownerId}`; owners.set(key, { key, label: change.ownerLabel, changes: [...(owners.get(key)?.changes || []), change] }) } return [...owners.values()] })
async function applyTemplate() { templateBusy.value = true; try { await api(`/customers/${selectedCustomer.value.id}/apply-template`, 'POST', { template: templateKey.value, dryRun: false }); templateOpen.value = false; preview.value = null; showSuccess('委託範本已套用'); await refresh() } catch (error) { templateError.value = error.message } finally { templateBusy.value = false } }
const matrixOpen = ref(false), matrix = ref(null), matrixLoading = ref(false), matrixError = ref(''), matrixSaving = ref(false), pending = ref({}), impact = ref(null)
const firms = ref([])
async function loadMatrix() { matrixLoading.value = true; matrixError.value = ''; try { [matrix.value, firms.value] = await Promise.all([api(`/customers/${selectedCustomer.value.id}/scope`), api('/accounting-firms')]) } catch (error) { matrixError.value = error.message } finally { matrixLoading.value = false } }
// 抽屜按段分頁（香港公司、澳門公司、內地公司、車牌、收費方式），不用一直往下捲
const matrixTab = ref('')
const matrixTabs = computed(() => [...(matrix.value?.sections || []).filter(section => section.owners.length).map(section => ({ value: section.category, label: `${section.label}（${section.owners.length}）` })), ...(selectedCustomer.value?.is_self ? [] : [{ value: 'prices', label: '收費方式' }])])
watch(matrixTabs, tabs => { if (!tabs.some(tab => tab.value === matrixTab.value)) matrixTab.value = tabs[0]?.value || '' })
// 有未提交的改動時，關閉前先問
async function closeMatrix() {
  const count = Object.keys(pending.value).length
  if (count && !await confirm({ title: '放棄未提交的改動？', message: `還有 ${count} 格改動沒有提交，關閉後會放棄。`, confirmText: '放棄並關閉', danger: true })) return
  matrixOpen.value = false; pending.value = {}; impact.value = null
}
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
// 提交：先試算影響；有外包要填單位或有影響時打開確認框（外包單位在確認框內填），否則直接儲存
const impactError = ref('')
const missingProvider = computed(() => Object.values(pending.value).some(change => change.handler === 'outsourced' && !change.providerName?.trim()))
async function reviewMatrix() {
  matrixSaving.value = true; matrixError.value = ''; impactError.value = ''
  try {
    // 試算時外包單位可能未填：影響只看是否「客戶自理」，外包與我們做相同，所以未填的先當我們做試算
    const result = await api('/service-scopes/batch', 'PUT', { changes: Object.values(pending.value).map(change => change.handler === 'outsourced' && !change.providerName?.trim() ? { ...change, handler: 'us', providerName: '' } : change), dryRun: true })
    if (outsourcedItems.value.length || result.impact.toClient || result.impact.fromClient || result.impact.openRequests.length) impact.value = result.impact
    else { matrixSaving.value = false; await saveMatrix() }
  } catch (error) { matrixError.value = error.message } finally { matrixSaving.value = false }
}
async function saveMatrix() {
  if (missingProvider.value) { impactError.value = '請填寫外包單位'; return }
  matrixSaving.value = true; impactError.value = ''
  try { await api('/service-scopes/batch', 'PUT', { changes: Object.values(pending.value) }); pending.value = {}; impact.value = null; await loadMatrix(); showSuccess('委託範圍已更新'); await refresh() }
  catch (error) { if (impact.value) impactError.value = error.message; else matrixError.value = error.message }
  finally { matrixSaving.value = false }
}
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
// 名下資料或登入有增減時，重新讀取能否刪除（loadDeletion 在上面）
watch(() => [selectedCustomer.value?.id, accounts.value.length, customerPlates.value.length, companyGroups.value.length, customerVehicles.value.length, customerRequests.value.length].join(), loadDeletion, { immediate: true })
const customerCompanies = computed(() => companyRecords.value.filter(company => company.customer_id === selectedCustomer.value?.id))
function addRecord(event) { const choice = event.target.value; event.target.value = ''; if (choice === 'company') { customerTab.value = 'companies'; addGroupRequest.value += 1 } else if (choice === 'request') { newRequest.value.customerId = selectedCustomer.value.id; view.value = 'new-request' } else if (choice) { useAdminStore().form.value = { customerId: selectedCustomer.value.id, route: '粵港', origin: '香港', kind: '個人' }; modal.value = choice } }
async function companySaved(message) { await refresh(); showSuccess(message) }
async function savePermit(plate, expiresOn) { return saveTrackedItem({ ownerType: 'plate', ownerId: plate.id, code: plate.route === '粵港' ? 'hk_crp' : 'mo_permit', expiresOn }) }
const customerDeadlines = computed(() => (overviewData.value.deadlines || []).filter(item => item.customerId === selectedCustomer.value?.id && ['overdue', 'due', 'missing'].includes(item.level)))
const activeCustomerRequests = computed(() => customerRequests.value.filter(item => ['待開始', '進行中', '待客戶提供'].includes(item.status)))
const tone = level => ({ overdue: 'danger', due: 'amber', missing: 'muted' }[level] || '')
const label = level => ({ overdue: '已逾期', due: '需處理', missing: '待錄入', ok: '正常' }[level] || level)
</script>
