import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { randomUUID, scryptSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const state = {}
const hash = password => { const salt = randomUUID(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
const request = (path, method = 'GET', body, token = 'admin') => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    state.server.emit('request', incoming, outgoing)
  })
}
const add = (sql, ...values) => state.db.prepare(sql).run(...values)
const now = () => new Date().toISOString()

before(async () => {
  state.directory = mkdtempSync(join(tmpdir(), 'work-orders-'))
  process.env.DB_PATH = join(state.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const imported = await import(`../src/server.js?work-orders=${randomUUID()}`)
  state.server = imported.server
  state.db = new DatabaseSync(process.env.DB_PATH)
  state.customer = randomUUID(); state.otherCustomer = randomUUID(); state.foreignCustomer = randomUUID(); state.vehicle = randomUUID(); state.plate = randomUUID(); state.foreignRequest = randomUUID()
  add('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)', 'other', '其他租戶', now())
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.customer, '客戶甲', '公司', 'default')
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.otherCustomer, '客戶乙', '公司', 'default')
  add('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)', state.foreignCustomer, '外租戶客戶', '公司', 'other')
  const adminId = randomUUID(); const staffId = randomUUID(); const inactiveId = randomUUID(); const foreignAdminId = randomUUID(); const customerUserId = randomUUID()
  for (const [id, role, name, username, tenant, active] of [[adminId, 'admin', '管理者', 'adminwo', 'default', 1], [staffId, 'staff', '員工甲', 'staffwo', 'default', 1], [inactiveId, 'staff', '停用員工', 'inactivewo', 'default', 0], [foreignAdminId, 'admin', '外租戶管理者', 'foreignwo', 'other', 1]]) add('INSERT INTO users(id,role,name,email,password_hash,username,tenant_id,active) VALUES (?,?,?,?,?,?,?,?)', id, role, name, `${username}@invalid`, hash('password123'), username, tenant, active)
  for (const [token, id] of [['admin', adminId], ['staff', staffId], ['inactive', inactiveId], ['foreign-admin', foreignAdminId]]) add('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)', token, id, '2099-01-01T00:00:00Z')
  add('INSERT INTO users(id,role,name,email,password_hash,tenant_id,customer_id,active) VALUES (?,?,?,?,?,?,?,1)', customerUserId, 'customer', '客戶甲', 'customerwo@test.invalid', hash('password123'), 'default', state.customer)
  add('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)', 'client', customerUserId, '2099-01-01T00:00:00Z')
  state.adminId = adminId; state.staffId = staffId; state.inactiveId = inactiveId
  add('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)', state.vehicle, state.customer, '粵港', '香港', '私家車', '粵Z·工單')
  add('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', state.plate, state.customer, '粵港', state.vehicle, 'WO-PLATE', now(), now())
  add('INSERT INTO requests(id,customer_id,service_code,route,title,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', state.foreignRequest, state.foreignCustomer, 'renewal', '粵港', '外租戶工單', '新要求', '起始', now(), now())
})
after(() => { state.db?.close(); state.server?.close(); if (state.directory) rmSync(state.directory, { recursive: true, force: true }) })

test('員工登入並記錄最近登入時間', async () => {
  const result = await request('/admin/login', 'POST', { username: 'staffwo', password: 'password123' }, '')
  assert.equal(result.status, 200)
  assert.equal(result.body.user.role, 'staff')
  assert.ok(state.db.prepare('SELECT last_login_at FROM users WHERE id=?').get(state.staffId).last_login_at)
})
test('停用員工不能登入且現有會話立即失效', async () => {
  const result = await request(`/staff/${state.inactiveId}`, 'PATCH', { active: false })
  assert.equal(result.status, 200)
  assert.equal((await request('/me', 'GET', undefined, 'inactive')).status, 401)
  assert.equal((await request('/admin/login', 'POST', { username: 'inactivewo', password: 'password123' }, '')).status, 401)
})
test('員工不能進行帳號管理或委託範圍修改', async () => {
  assert.equal((await request('/staff', 'GET', undefined, 'staff')).status, 403)
  assert.equal((await request('/service-scopes', 'PUT', { ownerType: 'plate', ownerId: state.plate, service: 'plate_service', handler: 'client' }, 'staff')).status, 403)
})
test('員工不能修改規則設定', async () => {
  assert.equal((await request('/rules/approval', 'PATCH', { active: false }, 'staff')).status, 403)
})
test('員工不能轉讓牌照', async () => {
  assert.equal((await request(`/plates/${state.plate}/transfer`, 'POST', { toCustomerId: state.otherCustomer, transferredOn: '2026-10-16' }, 'staff')).status, 403)
})
test('員工不能建立牌照或車輛', async () => {
  assert.equal((await request('/plate-assets', 'POST', { customerId: state.customer, route: '粵港', cardNumber: 'STAFF-PLATE' }, 'staff')).status, 403)
  assert.equal((await request('/vehicles', 'POST', { customerId: state.customer, route: '粵港', origin: '香港', type: '私家車', plate: 'STAFF-VEHICLE' }, 'staff')).status, 403)
})
test('不可停用自己', async () => {
  assert.equal((await request(`/staff/${state.adminId}`, 'PATCH', { active: false })).status, 400)
})
test('最後一位管理者不可降級', async () => {
  assert.equal((await request(`/staff/${state.adminId}`, 'PATCH', { role: 'staff' })).status, 409)
})
test('管理者可新增員工、改角色並重設密碼', async () => {
  const created = await request('/staff', 'POST', { name: '新員工', username: 'newstaffwo', password: 'password123', role: 'staff' })
  assert.equal(created.status, 201)
  assert.equal((await request(`/staff/${created.body.id}`, 'PATCH', { role: 'admin' })).status, 200)
  assert.equal((await request(`/staff/${created.body.id}/reset-password`, 'POST', { password: 'newpassword123' })).status, 200)
})
test('權限全景唯讀 API 回傳角色和功能矩陣', async () => {
  const result = await request('/permission-matrix')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.roles.staff.includes('requests.manage'), true)
  assert.ok(result.body.users.some(item => item.id === state.adminId))
  assert.equal(result.body.summary.employeeCount, result.body.users.length)
  assert.equal(result.body.summary.risk, result.body.summary.adminCount === 1 ? '只有一位管理者' : null)
  assert.ok(result.body.functions.includes('documents.write'))
})
test('業務範本預設只產生一次', async () => {
  const first = await request('/work-templates')
  assert.equal(first.status, 200)
  assert.ok(first.body.length >= 1)
  const count = state.db.prepare("SELECT COUNT(*) count FROM work_templates WHERE tenant_id='default'").get().count
  assert.equal((await request('/work-templates')).body.length, count)
})
test('業務範本修改後新工單用新步驟', async () => {
  const createdTemplate = await request('/work-templates', 'POST', { serviceCode: 'renewal', route: '粵港', name: '測試續期範本', steps: [{ title: '新步驟', owner: 'client', documents: ['新文件'], days: 2 }] })
  assert.equal(createdTemplate.status, 201)
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', plateAssetId: state.plate, vehicleId: state.vehicle, assigneeId: state.staffId })
  assert.equal(created.status, 201)
  const withTemplate = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', templateId: createdTemplate.body.id, plateAssetId: state.plate, vehicleId: state.vehicle, assigneeId: state.staffId })
  assert.equal(withTemplate.status, 201)
  assert.equal(withTemplate.body.plate_asset_id, state.plate)
  const detail = await request(`/requests/${withTemplate.body.id}`)
  assert.equal(detail.body.tasks[0].title, '新步驟')
  assert.equal(detail.body.tasks[0].owner, 'client')
  assert.deepEqual(JSON.parse(detail.body.tasks[0].documents_json), ['新文件'])
  assert.equal(detail.body.status, '待客戶提供')
})
test('舊工單不受範本修改影響', async () => {
  const old = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', assigneeId: state.staffId })
  assert.equal(old.status, 201)
  const template = await request('/work-templates', 'POST', { serviceCode: 'renewal', route: '粵港', name: '第二測試續期範本', steps: [{ title: '另一新步驟', owner: 'us', documents: [], days: 1 }] })
  await request(`/work-templates/${template.body.id}`, 'PATCH', { steps: [{ title: '修改後步驟', owner: 'us', documents: [], days: 1 }] })
  const detail = await request(`/requests/${old.body.id}`)
  assert.notEqual(detail.body.tasks[0].title, '另一新步驟')
})
test('停用範本不可再選', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'other', route: '粵港', name: '停用測試範本', steps: [{ title: '測試步驟', owner: 'us', documents: [], days: 1 }] })
  assert.equal((await request(`/work-templates/${template.body.id}`, 'PATCH', { active: false })).status, 200)
  assert.equal((await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'other', route: '粵港', templateId: template.body.id })).status, 400)
})
test('自訂業務範本可建立工單', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'custom', route: '自訂路線', name: '公司年審範本', steps: [{ title: '準備年審文件', owner: 'us', documents: ['公司資料'], days: 2 }] })
  assert.equal(template.status, 201)
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'custom', route: '自訂路線', templateId: template.body.id, assigneeId: state.staffId })
  assert.equal(created.status, 201)
  assert.equal(created.body.template_id, template.body.id)
})
test('建立工單帶範本、預設截止日及步驟排序', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'inspection', route: '粵港', name: '截止日測試範本', steps: [{ title: '第一步', owner: 'us', documents: [], days: 3 }, { title: '第二步', owner: 'us', documents: [], days: 4 }] })
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', templateId: template.body.id, assigneeId: state.staffId })
  assert.equal(created.status, 201)
  assert.equal(created.body.template_id, template.body.id)
  assert.equal(created.body.due_on, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const tasks = (await request(`/requests/${created.body.id}`)).body.tasks
  assert.deepEqual(tasks.map(task => task.sort), [0, 1])
})
test('自動顯示待客戶提供並回傳 clientTodos', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'driver_change', route: '粵港', name: '客戶待辦測試範本', steps: [{ title: '客戶提供資料', owner: 'client', documents: ['身份證明'], days: 1 }] })
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'driver_change', route: '粵港', templateId: template.body.id, assigneeId: state.staffId })
  const detail = await request(`/requests/${created.body.id}`)
  assert.equal(detail.body.status, '待客戶提供')
  assert.equal(detail.body.clientTodos[0].owner, 'client')
})
test('工單步驟開始後狀態由待開始轉為進行中', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'inspection', route: '粵港', name: '狀態推進測試範本', steps: [{ title: '內部處理', owner: 'us', documents: [], days: 1 }, { title: '客戶補件', owner: 'client', documents: ['文件'], days: 1 }] })
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', templateId: template.body.id, assigneeId: state.staffId })
  assert.equal((await request(`/requests/${created.body.id}`)).body.status, '待開始')
  const task = (await request(`/requests/${created.body.id}`)).body.tasks[0]
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { status: '進行中' })).status, 200)
  assert.equal((await request(`/requests/${created.body.id}`)).body.status, '進行中')
})
test('客戶工單詳情回傳易懂狀態和 clientTodos', async () => {
  const template = await request('/work-templates', 'POST', { serviceCode: 'driver_change', route: '粵港', name: '客戶詳情待辦範本', steps: [{ title: '客戶提供文件', owner: 'client', documents: ['身份證明'], days: 1 }] })
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'driver_change', route: '粵港', templateId: template.body.id, assigneeId: state.staffId })
  const detail = await request(`/requests/${created.body.id}`, 'GET', undefined, 'client')
  assert.equal(detail.status, 200)
  assert.equal(detail.body.status, '需要你提供資料')
  assert.equal(detail.body.clientTodos[0].owner, 'client')
  assert.deepEqual(detail.body.clientTodos[0].documents, ['身份證明'])
})
test('未完成步驟不可結案', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', assigneeId: state.staffId })
  assert.equal(created.status, 201)
  const result = await request(`/requests/${created.body.id}`, 'PATCH', { status: '已完成' })
  assert.equal(result.status, 409)
})
test('步驟全部完成或不適用才可結案', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', assigneeId: state.staffId })
  assert.equal(created.status, 201)
  const detail = await request(`/requests/${created.body.id}`)
  for (const task of detail.body.tasks) assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { status: '不適用' })).status, 200)
  assert.equal((await request(`/requests/${created.body.id}`, 'PATCH', { status: '已完成', skipDeadlineUpdate: true })).status, 200)
})
test('取消工單必須填寫原因', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', assigneeId: state.staffId })
  assert.equal(created.status, 201)
  assert.equal((await request(`/requests/${created.body.id}`, 'PATCH', { status: '已取消' })).status, 400)
  const result = await request(`/requests/${created.body.id}`, 'PATCH', { status: '已取消', cancelledReason: '客戶取消辦理' })
  assert.equal(result.status, 200)
  assert.equal(result.body.cancelled_reason, '客戶取消辦理')
})
test('結案更新到期日寫入 tracked_items', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', plateAssetId: state.plate, assigneeId: state.staffId })
  assert.equal(created.status, 201)
  const detail = await request(`/requests/${created.body.id}`)
  for (const task of detail.body.tasks) await request(`/tasks/${task.id}`, 'PATCH', { status: '不適用' })
  assert.equal((await request(`/requests/${created.body.id}`, 'PATCH', { status: '已完成', deadlineUpdates: [{ ownerType: 'plate', ownerId: state.plate, code: 'inspection', expiresOn: '2027-01-01', notes: '驗車後新日期' }] })).status, 200)
  assert.equal(state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(state.plate, 'inspection').expires_on, '2027-01-01')
})
test('結案略過更新不寫入 tracked_items', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', plateAssetId: state.plate, assigneeId: state.staffId })
  assert.equal(created.status, 201)
  const detail = await request(`/requests/${created.body.id}`)
  for (const task of detail.body.tasks) await request(`/tasks/${task.id}`, 'PATCH', { status: '不適用' })
  assert.equal((await request(`/requests/${created.body.id}`, 'PATCH', { status: '已完成', skipDeadlineUpdate: true, deadlineUpdates: [{ ownerType: 'plate', ownerId: state.plate, code: 'inspection', expiresOn: '2028-01-01' }] })).status, 200)
  assert.equal(state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(state.plate, 'inspection')?.expires_on, '2027-01-01')
})
test('舊資料遷移狀態正確', async () => {
  assert.equal(state.db.prepare("SELECT name FROM schema_migrations WHERE name='work-orders-v1'").get()?.name, 'work-orders-v1')
})
test('廣東批文前置規則仍生效', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'new_application', route: '粵港', assigneeId: state.staffId })
  const task = (await request(`/requests/${created.body.id}`)).body.tasks.find(item => item.title.includes('香港 TD547D'))
  assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { status: '進行中' })).status, 409)
})
test('別的租戶工單員工範本一律 404', async () => {
  assert.equal((await request(`/requests/${state.foreignRequest}`, 'GET', undefined, 'admin')).status, 404)
  assert.equal((await request(`/staff/${state.staffId}`, 'PATCH', { active: true }, 'foreign-admin')).status, 404)
  assert.equal((await request('/work-templates', 'GET', undefined, 'foreign-admin')).body.every(item => item.tenant_id !== 'default'), true)
})
test('客戶不能存取管理 API', async () => {
  assert.equal((await request('/work-orders', 'GET', undefined, 'client')).status, 403)
})
test('工單 null 請求內容回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', null)).status, 400)
})
test('工單陣列請求內容回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', [])).status, 400)
})
test('工單缺少必填欄位回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', {})).status, 400)
})
test('工單客戶 ID 為 null 回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', { customerId: null, serviceCode: 'inspection', route: '粵港' })).status, 400)
})
test('工單服務代碼錯誤類型回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: [], route: '粵港' })).status, 400)
})
test('工單不存在負責人回 400', async () => {
  assert.equal((await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', assigneeId: randomUUID() })).status, 400)
})
test('工單不可指派給停用員工', async () => {
  assert.equal((await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'inspection', route: '粵港', assigneeId: state.inactiveId })).status, 400)
})
test('員工可查看客戶牌照但不可變更委託或客戶帳號', async () => {
  assert.equal((await request('/customers', 'GET', undefined, 'staff')).status, 200)
  assert.equal((await request('/plate-assets', 'GET', undefined, 'staff')).status, 200)
  assert.equal((await request('/customer-users', 'POST', { customerId: state.customer, name: '客戶', email: 'client-new@test.invalid', password: 'password123456' }, 'staff')).status, 403)
})

test('員工不可讀取權限全景（含全部員工與登入時間）', async () => {
  assert.equal((await request('/permission-matrix', 'GET', undefined, 'staff')).status, 403)
})

test('管理端工單詳情帶官方依據（plan）', async () => {
  const created = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', title: '續期' })
  const detail = await request(`/requests/${created.body.id}`)
  assert.ok(Array.isArray(detail.body.plan?.sourceIds) && detail.body.plan.sourceIds.length > 0)
})

test('建立工單時車輛、牌照、負責人留空（不指定）照樣可建立', async () => {
  const result = await request('/work-orders', 'POST', { customerId: state.customer, serviceCode: 'renewal', route: '粵港', vehicleId: '', plateAssetId: '', assigneeId: '', templateId: '', quoteId: '', dueOn: '' })
  assert.equal(result.status, 201, JSON.stringify(result.body))
})
