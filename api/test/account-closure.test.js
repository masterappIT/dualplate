import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 自管客戶自行注銷帳號：即時刪除全部資料，按次收費的帳單和相關工單只保留最少記錄；托管不能自助注銷；通知管理者
const state = {}
let seq = 0
const stamp = () => new Date().toISOString()
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'closure-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword } = await import('../src/db.js')
  Object.assign(state, { db, hashPassword })
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', stamp())
  for (const [token, role, tenant] of [['admin', 'admin', 'default'], ['staff', 'staff', 'default'], ['other-admin', 'admin', 'other']]) {
    const uid = randomUUID()
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,tenant_id,username) VALUES (?,?,?,?,?,?,?)').run(uid, role, `${token}名`, `${token}@test.invalid`, hashPassword('ClosurePass123'), tenant, token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', stamp())
  }
  state.server = (await import('../src/server.js')).server
  await import('../src/terms.js')
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: `Bearer ${token}`, 'x-forwarded-for': `10.70.0.${++seq % 250}` } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const close = (token, body = { password: 'ClientPass123' }) => request('/my/account/close', 'POST', body, token)
const count = (sql, ...params) => state.db.prepare(sql).get(...params).count

// 建立一位客戶和他的全部資料：牌照（批文卡相片、出租合約、過關、司機登記、自行辦理）、公司、車輛（證件）、司機、到期事項、通知、訊息、修改記錄、工單
function seed({ mode = '自管', tenant = 'default', name = `客戶${++seq}`, paidJob = false, openJob = false } = {}) {
  const { db, hashPassword } = state
  const ids = { customer: randomUUID(), user: randomUUID(), plate: randomUUID(), vehicle: randomUUID(), company: randomUUID(), group: randomUUID(), driver: randomUUID(), contract: randomUUID(), selfHandled: randomUUID(), doneJob: randomUUID(), paidJob: randomUUID(), openJob: randomUUID(), fee: randomUUID(), token: `client-${randomUUID()}`, phone: `+8529${String(1000000 + ++seq).slice(-7)}` }
  const t = stamp()
  db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id,service_mode,notes) VALUES (?,?,?,?,?,?,?)').run(ids.customer, name, '個人', ids.phone, tenant, mode, '私人備註')
  db.prepare('INSERT INTO users(id,role,name,email,password_hash,password_enc,customer_id,tenant_id,phone) VALUES (?,?,?,?,?,?,?,?,?)').run(ids.user, 'customer', name, `${ids.phone}@phone.invalid`, hashPassword('ClientPass123'), 'sealed', ids.customer, tenant, ids.phone)
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(ids.token, ids.user, '2099-01-01T00:00:00Z', t)
  db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(ids.vehicle, ids.customer, '粵港', '香港', '私家車', 'AB1234')
  db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(ids.group, tenant, ids.customer, '組一', t)
  db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.company, tenant, ids.customer, ids.group, '香港', '測試有限公司', t, t)
  db.prepare('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,group_id,mainland_plate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.plate, ids.customer, '粵港', ids.vehicle, ids.group, '粵ZA123港', t, t)
  db.prepare('INSERT INTO approval_card_images(plate_asset_id,side,mime,data) VALUES (?,?,?,?)').run(ids.plate, 'front', 'image/png', Buffer.from('card'))
  db.prepare('INSERT INTO plate_crossings(id,tenant_id,plate_asset_id,crossed_on,source,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.plate, '2026-10-01', 'client', t)
  db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,hk_id_no,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ids.driver, tenant, ids.customer, '司機甲', '123A', t, t)
  db.prepare('INSERT INTO plate_drivers(plate_asset_id,driver_id,role) VALUES (?,?,?)').run(ids.plate, ids.driver, '主司機')
  db.prepare('INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,starts_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ids.contract, tenant, ids.plate, '租客乙', '2026-01-01', t, t)
  db.prepare('INSERT INTO rent_invoices(id,contract_id,period,due_on,amount,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), ids.contract, '2026-10', '2026-10-05', 1000, t)
  db.prepare('INSERT INTO self_handled(id,tenant_id,customer_id,plate_asset_id,kind,handled_on,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(ids.selfHandled, tenant, ids.customer, ids.plate, 'renewal', '2026-10-01', '{}', t)
  db.prepare('INSERT INTO self_handled_files(id,record_id,mime,data,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), ids.selfHandled, 'image/png', Buffer.from('photo'), t)
  db.prepare('INSERT INTO vehicle_documents(vehicle_id,kind,mime,data,uploaded_at) VALUES (?,?,?,?,?)').run(ids.vehicle, 'hk_licence', 'image/png', Buffer.from('doc'), t)
  db.prepare('INSERT INTO credentials(id,vehicle_id,name) VALUES (?,?,?)').run(randomUUID(), ids.vehicle, '保險')
  for (const [type, owner] of [['plate', ids.plate], ['company', ids.company], ['vehicle', ids.vehicle], ['driver', ids.driver], ['customer', ids.customer]]) db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_at) VALUES (?,?,?,?,?,?)').run(tenant, type, owner, 'approval', '2027-01-01', t)
  db.prepare('INSERT INTO service_scopes(id,tenant_id,owner_type,owner_id,service,handler,started_on,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, 'plate', ids.plate, 'renewal', 'client', '2026-01-01', t)
  db.prepare('INSERT INTO notifications(id,tenant_id,customer_id,kind,title,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 'deadline', '到期提醒', t)
  db.prepare('INSERT INTO support_messages(id,tenant_id,customer_id,from_staff,body,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 0, '你好', t)
  db.prepare('INSERT INTO customer_changes(id,tenant_id,customer_id,entity_type,entity_id,entity_label,field,field_label,changed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, ids.customer, 'plate', ids.plate, '粵ZA123港', 'card_number', '批文卡號', t)
  db.prepare('INSERT INTO terms_acceptances(id,tenant_id,user_id,customer_id,version,accepted_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), tenant, ids.user, ids.customer, 1, t)
  db.prepare('INSERT INTO audit_logs(id,tenant_id,user_id,user_name,method,path,summary_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, ids.user, name, 'PATCH', '/api/my/profile', '{"name":"真名"}', t)
  const job = (id, status) => {
    db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,plate_asset_id,service_code,route,title,description,status,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, ids.customer, ids.vehicle, ids.plate, 'renewal', '粵港', '續期 · 粵ZA123港', '客戶電話 9123 4567', status, '完成', t, t)
    db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,notes) VALUES (?,?,?,?,?)').run(randomUUID(), id, '交文件', '香港', '司機甲的證件')
    db.prepare('INSERT INTO activities(id,request_id,kind,detail,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'note', '致電司機甲', t)
    db.prepare('INSERT INTO request_attachments(id,tenant_id,request_id,file_name,mime,size,data,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenant, id, '身份證.png', 'image/png', 4, Buffer.from('idcd'), t)
  }
  job(ids.doneJob, '已完成')
  if (paidJob) {
    job(ids.paidJob, '已完成')
    db.prepare('INSERT INTO fee_items(id,tenant_id,customer_id,kind,request_id,plate_asset_id,description,currency,amount,incurred_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(ids.fee, tenant, ids.customer, 'job', ids.paidJob, ids.plate, '續期代辦費', 'HKD', 1800, '2026-10-01', t, t)
    db.prepare('INSERT INTO fee_payments(id,fee_item_id,paid_on,amount,method,proof_mime,proof,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), ids.fee, '2026-10-02', 1800, '轉數快', 'image/png', Buffer.from('proof'), t)
  }
  if (openJob) job(ids.openJob, '進行中')
  return ids
}

test('注銷前可看會刪除的資料數量和原因選項', async () => {
  const ids = seed()
  const result = await request('/my/account/close', 'GET', undefined, ids.token)
  assert.equal(result.status, 200)
  assert.equal(result.body.allowed, true)
  assert.deepEqual(result.body.counts, { plates: 1, companies: 1, vehicles: 1, drivers: 1 })
  assert.deepEqual(result.body.reasons, ['不再需要', '改由別人代辦', '太複雜', '其他'])
})

test('密碼正確即時刪除帳戶和全部資料', async () => {
  const ids = seed()
  const result = await close(ids.token, { password: 'ClientPass123', reason: '不再需要' })
  assert.equal(result.status, 200)
  assert.equal(result.body.closed, true)
  const { db } = state
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 0)
  assert.equal(count('SELECT COUNT(*) count FROM users WHERE id=?', ids.user), 0)
  for (const [table, key, value] of [['plate_assets', 'id', ids.plate], ['vehicles', 'id', ids.vehicle], ['companies', 'id', ids.company], ['company_groups', 'id', ids.group], ['drivers', 'id', ids.driver], ['approval_card_images', 'plate_asset_id', ids.plate], ['plate_crossings', 'plate_asset_id', ids.plate], ['plate_drivers', 'plate_asset_id', ids.plate], ['rental_contracts', 'id', ids.contract], ['rent_invoices', 'contract_id', ids.contract], ['self_handled', 'id', ids.selfHandled], ['self_handled_files', 'record_id', ids.selfHandled], ['vehicle_documents', 'vehicle_id', ids.vehicle], ['credentials', 'vehicle_id', ids.vehicle], ['notifications', 'customer_id', ids.customer], ['support_messages', 'customer_id', ids.customer], ['customer_changes', 'customer_id', ids.customer], ['terms_acceptances', 'user_id', ids.user], ['service_scopes', 'owner_id', ids.plate]]) {
    assert.equal(count(`SELECT COUNT(*) count FROM ${table} WHERE ${key}=?`, value), 0, table)
  }
  assert.equal(count('SELECT COUNT(*) count FROM tracked_items WHERE owner_id IN (?,?,?,?,?)', ids.plate, ids.company, ids.vehicle, ids.driver, ids.customer), 0)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=?').get(ids.user).count, 0)
})

test('沒有收費記錄時工單和附件全部刪除', async () => {
  const ids = seed()
  await close(ids.token)
  assert.equal(count('SELECT COUNT(*) count FROM requests WHERE id=?', ids.doneJob), 0)
  for (const table of ['tasks', 'activities', 'request_attachments']) assert.equal(count(`SELECT COUNT(*) count FROM ${table} WHERE request_id=?`, ids.doneJob), 0, table)
})

test('注銷後不能再用舊登入，也不能用原密碼登入', async () => {
  const ids = seed()
  await close(ids.token)
  assert.equal((await request('/me', 'GET', undefined, ids.token)).status, 401)
  assert.equal((await request('/login', 'POST', { login: ids.phone, password: 'ClientPass123' }, null)).status, 401)
})

test('有按次收費時保留收費和相關工單，去除個人資料', async () => {
  const ids = seed({ paidJob: true })
  assert.equal((await close(ids.token)).status, 200)
  const customer = state.db.prepare('SELECT * FROM customers WHERE id=?').get(ids.customer)
  assert.match(customer.name, /^已注銷客戶（/)
  assert.equal(customer.phone, null)
  assert.equal(customer.notes, null)
  assert.ok(customer.closed_on)
  const job = state.db.prepare('SELECT * FROM requests WHERE id=?').get(ids.paidJob)
  const { services } = await import('../src/catalog.js')
  assert.equal(job.title, services.find(item => item.code === 'renewal').name)
  assert.doesNotMatch(job.title, /粵ZA123港/)
  assert.equal(job.description, null)
  assert.equal(job.plate_asset_id, null)
  assert.equal(job.vehicle_id, null)
  assert.equal(count('SELECT COUNT(*) count FROM activities WHERE request_id=?', ids.paidJob), 0)
  assert.equal(count('SELECT COUNT(*) count FROM request_attachments WHERE request_id=?', ids.paidJob), 0)
  assert.equal(state.db.prepare('SELECT notes FROM tasks WHERE request_id=?').get(ids.paidJob).notes, null)
  const fee = state.db.prepare('SELECT * FROM fee_items WHERE id=?').get(ids.fee)
  assert.equal(fee.amount, 1800)
  assert.equal(fee.plate_asset_id, null)
  assert.equal(state.db.prepare('SELECT proof FROM fee_payments WHERE fee_item_id=?').get(ids.fee).proof, null)
  assert.equal(count('SELECT COUNT(*) count FROM requests WHERE id=?', ids.doneJob), 0)
  assert.equal(count('SELECT COUNT(*) count FROM plate_assets WHERE id=?', ids.plate), 0)
})

test('操作記錄保留，但去除客戶姓名和內容', async () => {
  const ids = seed()
  await close(ids.token)
  const log = state.db.prepare('SELECT * FROM audit_logs WHERE user_id=? AND path=?').get(ids.user, '/api/my/profile')
  assert.equal(log.user_name, '已注銷客戶')
  assert.equal(log.summary_json, null)
})

test('密碼錯誤時不刪除任何資料', async () => {
  const ids = seed()
  const result = await close(ids.token, { password: 'WrongPass999' })
  assert.equal(result.status, 403)
  assert.match(result.body.error, /密碼不正確/)
  assert.equal(count('SELECT COUNT(*) count FROM plate_assets WHERE id=?', ids.plate), 1)
})

test('密碼錯誤太多次暫時鎖定', async () => {
  const ids = seed()
  let last
  for (let index = 0; index < 6; index++) last = await close(ids.token, { password: 'WrongPass999' })
  assert.equal(last.status, 429)
  assert.equal((await close(ids.token)).status, 429)
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 1)
})

test('托管客戶不能自行注銷', async () => {
  const ids = seed({ mode: '托管' })
  const result = await close(ids.token)
  assert.equal(result.status, 403)
  assert.match(result.body.error, /聯絡你的顧問/)
  assert.equal((await request('/my/account/close', 'GET', undefined, ids.token)).status, 403)
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 1)
})

test('有未完成的委託時不能注銷，並列出這些委託', async () => {
  const ids = seed({ openJob: true })
  const preview = await request('/my/account/close', 'GET', undefined, ids.token)
  assert.equal(preview.body.allowed, false)
  assert.equal(preview.body.openRequests.length, 1)
  const result = await close(ids.token)
  assert.equal(result.status, 409)
  assert.match(result.body.error, /仍在辦理/)
  assert.equal(result.body.openRequests[0].id, ids.openJob)
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 1)
})

test('缺密碼、錯誤類型、null、陣列或多餘欄位時拒絕', async () => {
  const ids = seed()
  for (const body of [{}, { password: '' }, { password: 123 }, 'null', '[]', '{bad', { password: 'ClientPass123', role: 'admin' }]) assert.equal((await close(ids.token, body)).status, 400, JSON.stringify(body))
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 1)
})

test('原因只接受選項，「其他」才可填文字，文字不可過長', async () => {
  const ids = seed()
  assert.match((await close(ids.token, { password: 'ClientPass123', reason: '亂寫' })).body.error, /原因無效/)
  assert.match((await close(ids.token, { password: 'ClientPass123', reason: '太複雜', reasonText: '補充' })).body.error, /只有選「其他」/)
  assert.equal((await close(ids.token, { password: 'ClientPass123', reason: '其他', reasonText: '長'.repeat(201) })).status, 400)
  assert.equal((await close(ids.token, { password: 'ClientPass123', reason: '其他', reasonText: 5 })).status, 400)
  assert.equal(count('SELECT COUNT(*) count FROM customers WHERE id=?', ids.customer), 1)
})

test('員工和管理者不能用客戶的注銷接口', async () => {
  assert.equal((await close('admin')).status, 403)
  assert.equal((await close('staff')).status, 403)
})

test('只接受 GET 和 POST', async () => {
  const ids = seed()
  assert.equal((await request('/my/account/close', 'DELETE', undefined, ids.token)).status, 405)
})

test('管理者在今日工作看到注銷通知和原因', async () => {
  const ids = seed({ name: '通知測試客戶' })
  await close(ids.token, { password: 'ClientPass123', reason: '其他', reasonText: '搬到外地' })
  const row = (await request('/account-closures')).body.find(item => item.customerName === '通知測試客戶')
  assert.equal(row.reason, '其他')
  assert.equal(row.reasonText, '搬到外地')
  assert.equal(row.plateCount, 1)
  assert.equal(row.keptRecords, false)
})

test('管理者按「知道了」後通知不再顯示，重複按回覆 409', async () => {
  const ids = seed({ name: '知道了客戶' })
  await close(ids.token)
  const row = (await request('/account-closures')).body.find(item => item.customerName === '知道了客戶')
  assert.equal((await request(`/account-closures/${row.id}/acknowledge`, 'POST')).status, 200)
  assert.ok(!(await request('/account-closures')).body.some(item => item.id === row.id))
  assert.equal((await request(`/account-closures/${row.id}/acknowledge`, 'POST')).status, 409)
})

test('員工、客戶和別的租戶的管理者看不到注銷通知', async () => {
  const ids = seed({ name: '租戶測試客戶' })
  const other = seed()
  await close(ids.token)
  const row = (await request('/account-closures')).body.find(item => item.customerName === '租戶測試客戶')
  assert.equal((await request('/account-closures', 'GET', undefined, 'staff')).status, 403)
  assert.equal((await request('/account-closures', 'GET', undefined, other.token)).status, 403)
  assert.ok(!(await request('/account-closures', 'GET', undefined, 'other-admin')).body.some(item => item.id === row.id))
  assert.equal((await request(`/account-closures/${row.id}/acknowledge`, 'POST', undefined, 'other-admin')).status, 404)
})

test('不存在的注銷通知回覆 404', async () => {
  assert.equal((await request(`/account-closures/${randomUUID()}/acknowledge`, 'POST')).status, 404)
})

test('注銷通知 30 天後刪除', async () => {
  const ids = seed({ name: '過期通知客戶' })
  await close(ids.token)
  state.db.prepare('UPDATE account_closures SET closed_at=? WHERE customer_name=?').run(new Date(Date.now() - 31 * 86400000).toISOString(), '過期通知客戶')
  await request('/account-closures')
  assert.equal(count('SELECT COUNT(*) count FROM account_closures WHERE customer_name=?', '過期通知客戶'), 0)
})

test('不影響其他客戶的資料', async () => {
  const ids = seed(), other = seed()
  await close(ids.token)
  assert.equal(count('SELECT COUNT(*) count FROM plate_assets WHERE id=?', other.plate), 1)
  assert.equal(count('SELECT COUNT(*) count FROM tracked_items WHERE owner_id=?', other.plate), 1)
  assert.equal(count('SELECT COUNT(*) count FROM users WHERE id=?', other.user), 1)
})

test('強制同意新條款期間，客戶仍可注銷', async () => {
  const ids = seed()
  state.db.prepare('INSERT OR REPLACE INTO terms_versions(tenant_id,version,terms,privacy,published_at) VALUES (?,?,?,?,?)').run('default', 9, '新條款', '新私隱', stamp())
  state.db.prepare("INSERT OR REPLACE INTO terms_settings(tenant_id,mode,updated_at) VALUES ('default','force',?)").run(stamp())
  try {
    assert.equal((await request('/my/companies', 'GET', undefined, ids.token)).status, 403)
    assert.equal((await close(ids.token)).status, 200)
  } finally { state.db.prepare("UPDATE terms_settings SET mode='prompt' WHERE tenant_id='default'").run() }
})

test('已注銷客戶不能再開通登入', async () => {
  const ids = seed({ paidJob: true })
  await close(ids.token)
  const result = await request('/customer-users', 'POST', { customerId: ids.customer, name: '再開', phone: '+85291112222', password: 'ReopenPass123' })
  assert.equal(result.status, 409)
  assert.match(result.body.error, /已自行注銷/)
})
