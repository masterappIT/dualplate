import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { parseCsv, requiredHeaders } from '../src/plate-import.js'

const launch = databasePath => spawnSync(process.execPath, ['--input-type=module', '-e', "import './src/db.js'"], { cwd: new URL('../', import.meta.url), env: { ...process.env, DB_PATH: databasePath, DEMO_SEED: '0' }, encoding: 'utf8' })
const csv = values => `${requiredHeaders.join(',')}\n${values.join(',')}`
const fixture = {}
before(async () => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'restructure-api-'))
  process.env.DB_PATH = join(fixture.directory, 'api.db')
  process.env.DEMO_SEED = '0'
  process.env.API_NO_LISTEN = '1'
  const { server } = await import('../src/server.js')
  fixture.server = server
  fixture.db = new DatabaseSync(process.env.DB_PATH)
  fixture.customer = randomUUID()
  fixture.otherCustomer = randomUUID()
  fixture.plate = randomUUID()
  fixture.otherPlate = randomUUID()
  fixture.vehicle = randomUUID()
  fixture.db.prepare('INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  for (const [customerId, tenant] of [[fixture.customer, 'default'], [fixture.otherCustomer, 'other']]) fixture.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customerId, `客戶${customerId}`, '公司', tenant)
  for (const [token, role, customerId, tenant] of [['admin-token', 'admin', null, 'default'], ['other-token', 'admin', null, 'other'], ['client-token', 'customer', fixture.customer, 'default']]) {
    const userId = randomUUID()
    fixture.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, role, role, `${token}@test.invalid`, 'unused', customerId, tenant)
    fixture.db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, '2099-01-01T00:00:00Z')
  }
  const timestamp = new Date().toISOString()
  fixture.db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(fixture.vehicle, fixture.customer, '粵港', '香港', '私家車', 'AB123')
  for (const [plateId, customerId] of [[fixture.plate, fixture.customer], [fixture.otherPlate, fixture.otherCustomer]]) fixture.db.prepare('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?,?)').run(plateId, customerId, '粵港', customerId === fixture.customer ? fixture.vehicle : null, plateId, timestamp, timestamp, JSON.stringify({ cardNumber: plateId, driver1: '原司機' }))
})
after(() => { fixture.db?.close(); fixture.server?.close(); if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true }) })

async function request(path, method = 'GET', body, token = 'admin-token') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  incoming.method = method
  incoming.url = `/api${path}`
  incoming.headers = { host: 'localhost', authorization: `Bearer ${token}` }
  return new Promise(resolve => {
    const outgoing = {
      setHeader() {},
      writeHead(status) { this.status = status },
      end(text) { resolve({ status: this.status, body: JSON.parse(text) }) }
    }
    fixture.server.emit('request', incoming, outgoing)
  })
}
const importRow = (customer, cardNumber, route = '粵港') => [customer, route, '粵Z1111港', 'AB111', cardNumber, '2028-01-01', '2028-02-01', '', '']
const preview = content => request('/import/plates?dryRun=1', 'POST', { csv: content })
const confirm = (content, previewKey) => request('/import/plates', 'POST', { csv: content, previewKey, confirm: true })

test('CSV 示例含口岸欄可預覽並匯入', async () => {
  const content = readFileSync(new URL('./fixtures/plates-with-port.csv', import.meta.url), 'utf8').replace('{{CUSTOMER}}', `客戶${fixture.customer}`)
  const result = await preview(content)
  assert.equal(result.status, 200)
  assert.equal(result.body.summary.error, 0)
  assert.ok(result.body.headers.includes('口岸'))
  assert.ok(result.body.headers.includes('指標類別'))
  assert.equal((await confirm(content, result.body.previewKey)).status, 200)
  const plate = fixture.db.prepare('SELECT port,indicator_category FROM plate_assets WHERE card_number=?').get('CARD-PORT-SAMPLE')
  assert.equal(plate.port, '深圳灣')
  assert.equal(plate.indicator_category, '商務')
})

test('CSV 舊格式沒有口岸欄仍可匯入', async () => {
  const content = csv(importRow(`客戶${fixture.customer}`, 'CARD-NO-PORT'))
  const result = await preview(content)
  assert.equal(result.status, 200)
  assert.equal((await confirm(content, result.body.previewKey)).status, 200)
  assert.equal(fixture.db.prepare('SELECT port FROM plate_assets WHERE card_number=?').get('CARD-NO-PORT').port, null)
})

test('CSV 空白口岸不清除原有口岸', async () => {
  const content = `${requiredHeaders.join(',')},口岸\n${importRow(`客戶${fixture.customer}`, 'CARD-PORT-SAMPLE').join(',')},   `
  const result = await preview(content)
  assert.equal(result.body.summary.error, 0)
  assert.equal((await confirm(content, result.body.previewKey)).status, 200)
  assert.equal(fixture.db.prepare('SELECT port FROM plate_assets WHERE card_number=?').get('CARD-PORT-SAMPLE').port, '深圳灣')
})

test('CSV 未知口岸名稱逐列拒絕', async () => {
  const content = `${requiredHeaders.join(',')},口岸\n${importRow(`客戶${fixture.customer}`, 'CARD-UNKNOWN-PORT').join(',')},未知口岸`
  const result = await preview(content)
  assert.equal(result.body.summary.error, 1)
  assert.match(result.body.rows[0].errors.join(''), /未知口岸名稱/)
  assert.equal(fixture.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CARD-UNKNOWN-PORT'), undefined)
})

test('牌照列表保留批文卡通行口岸供星圖補位', async () => {
  const plateId = randomUUID()
  const timestamp = new Date().toISOString()
  fixture.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at,card_data) VALUES (?,?,?,?,?,?,?)').run(plateId, fixture.customer, '粵港', 'CARD-CROSSING-FALLBACK', timestamp, timestamp, JSON.stringify({ crossing: '港珠澳大橋' }))
  const result = await request('/plate-assets')
  assert.equal(result.status, 200)
  const plate = result.body.find(item => item.id === plateId)
  assert.equal(plate.port, null)
  assert.equal(plate.card_data.crossing, '港珠澳大橋')
})

test('CSV 引號欄位支援逗號與雙引號', () => {
  const result = parseCsv(csv(['客戶甲', '粵港', '粵Z001', 'AB1', 'CARD1', '2027-01-01', '', '"甲,""乙"""', '內地甲']))
  assert.equal(result.rows[0].values['香港／澳門公司'], '甲,"乙"')
})

test('CSV 錯誤引號拒絕解析', () => assert.throws(() => parseCsv(csv(['客戶甲', '粵港', '粵Z001', 'AB1', '"CARD1"wrong', '', '', '', ''])), /CSV/))

test('CSV 多欄或少欄逐列標示錯誤', () => {
  assert.equal(parseCsv(csv(['客戶甲', '粵港'])).rows[0].columnError, '欄位數與表頭不符')
  assert.equal(parseCsv(csv(['客戶甲', '粵港', '', '', '', '', '', '', '', 'extra'])).rows[0].columnError, '欄位數與表頭不符')
})

test('CSV 預覽新增不寫入', async () => {
  const content = csv(importRow(`客戶${fixture.customer}`, 'CARD-NEW'))
  const result = await preview(content)
  assert.equal(result.status, 200)
  assert.equal(result.body.summary.create, 1)
  assert.equal(fixture.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CARD-NEW'), undefined)
})

test('CSV 確認新增與到期日', async () => {
  const content = csv(importRow(`客戶${fixture.customer}`, 'CARD-NEW'))
  const result = await confirm(content, (await preview(content)).body.previewKey)
  assert.equal(result.status, 200)
  const plate = fixture.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CARD-NEW')
  assert.ok(plate)
  assert.equal(fixture.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(plate.id, 'hk_crp').expires_on, '2028-02-01')
})

test('CSV 更新同一牌照不重複且保留卡面', async () => {
  fixture.db.prepare('UPDATE plate_assets SET card_data=? WHERE card_number=?').run(JSON.stringify({ cardNumber: 'CARD-NEW', driver1: '原司機' }), 'CARD-NEW')
  const content = csv(importRow(`客戶${fixture.customer}`, 'CARD-NEW').map(value => value === '2028-01-01' ? '2029-01-01' : value))
  assert.equal((await preview(content)).body.summary.update, 1)
  assert.equal((await confirm(content, (await preview(content)).body.previewKey)).status, 200)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM plate_assets WHERE card_number=?').get('CARD-NEW').count, 1)
  assert.equal(JSON.parse(fixture.db.prepare('SELECT card_data FROM plate_assets WHERE card_number=?').get('CARD-NEW').card_data).driver1, '原司機')
  const plate = fixture.db.prepare('SELECT card_data FROM plate_assets WHERE id=?').get(fixture.plate)
  assert.equal(JSON.parse(plate.card_data).driver1, '原司機')
})

test('CSV 錯誤列阻止全批寫入', async () => {
  const content = `${csv(importRow(`客戶${fixture.customer}`, 'CARD-VALID'))}\n${importRow(`客戶${fixture.customer}`, 'CARD-INVALID').map(value => value === '2028-01-01' ? '2028-02-30' : value).join(',')}`
  const result = await preview(content)
  assert.equal(result.body.summary.error, 1)
  assert.equal((await confirm(content, result.body.previewKey)).status, 400)
  assert.equal(fixture.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CARD-VALID'), undefined)
})

test('CSV 不匹配另一租戶客戶', async () => {
  assert.equal((await preview(csv(importRow(`客戶${fixture.otherCustomer}`, 'CARD-OTHER')))).body.summary.error, 1)
})

test('CSV 同一檔案重複列報錯', async () => {
  const row = importRow(`客戶${fixture.customer}`, 'CARD-DUP').join(',')
  assert.match((await preview(`${requiredHeaders.join(',')}\n${row}\n${row}`)).body.rows[1].errors.join(''), /重複/)
})

test('CSV 現有牌照公司名稱不符時拒絕搬移公司組', async () => {
  const groupId = randomUUID()
  const timestamp = new Date().toISOString()
  fixture.db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(groupId, 'default', fixture.customer, '既有香港公司 · 既有內地公司', timestamp)
  fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', fixture.customer, groupId, '香港', '既有香港公司', timestamp, timestamp)
  fixture.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), 'default', fixture.customer, groupId, '內地', '既有內地公司', timestamp, timestamp)
  fixture.db.prepare('UPDATE plate_assets SET group_id=? WHERE id=?').run(groupId, fixture.plate)
  const values = importRow(`客戶${fixture.customer}`, fixture.plate)
  values[7] = '打錯的香港公司'
  values[8] = '既有內地公司'
  const result = await preview(csv(values))
  assert.equal(result.body.summary.error, 1)
  assert.match(result.body.rows[0].errors.join(''), /公司名稱與現有公司組（既有香港公司 · 既有內地公司）不符/)
  assert.equal(fixture.db.prepare('SELECT group_id FROM plate_assets WHERE id=?').get(fixture.plate).group_id, groupId)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM company_groups WHERE customer_id=?').get(fixture.customer).count, 1)
})

test('CSV 匯入接受斜線及非補零日期並正規化', async () => {
  const rows = [
    importRow(`客戶${fixture.customer}`, 'CARD-DATE-SLASH').map((value, index) => index === 5 ? '2026/11/20' : index === 6 ? '2026/1/5' : value),
    importRow(`客戶${fixture.customer}`, 'CARD-DATE-HYPHEN').map((value, index) => index === 5 ? '2026-1-5' : index === 6 ? '2026/01/05' : value),
  ]
  const content = `${requiredHeaders.join(',')}\n${rows.map(row => row.join(',')).join('\n')}`
  const previewResult = await preview(content)
  assert.equal(previewResult.status, 200)
  assert.equal(previewResult.body.summary.error, 0)
  assert.equal(previewResult.body.rows[0].values['批文到期'], '2026-11-20')
  assert.equal(previewResult.body.rows[0].values['CRP／通行證到期'], '2026-01-05')
  assert.equal(previewResult.body.rows[1].values['批文到期'], '2026-01-05')
  assert.equal((await confirm(content, previewResult.body.previewKey)).status, 200)
  for (const [cardNumber, approval, permit] of [['CARD-DATE-SLASH', '2026-11-20', '2026-01-05'], ['CARD-DATE-HYPHEN', '2026-01-05', '2026-01-05']]) {
    const plate = fixture.db.prepare('SELECT id,card_expires_on FROM plate_assets WHERE card_number=?').get(cardNumber)
    assert.equal(plate.card_expires_on, approval)
    assert.equal(fixture.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(plate.id, 'hk_crp').expires_on, permit)
  }
})

test('CSV 非法日期顯示正確格式提示', async () => {
  const values = importRow(`客戶${fixture.customer}`, 'CARD-DATE-INVALID')
  values[5] = '2026.11.20'
  const result = await preview(csv(values))
  assert.equal(result.body.summary.error, 1)
  assert.match(result.body.rows[0].errors.join(''), /請使用 YYYY-MM-DD，例如 2026-11-20/)
})

test('CSV 預覽憑證不可用於不同內容或重用', async () => {
  const content = csv(importRow(`客戶${fixture.customer}`, 'CARD-KEY'))
  const key = (await preview(content)).body.previewKey
  assert.equal((await confirm(content + '\n', key)).status, 400)
  assert.equal((await confirm(content, key)).status, 200)
  assert.equal((await confirm(content, key)).status, 400)
})

test('CSV 空值、錯誤類型及客戶權限拒絕', async () => {
  for (const value of [null, [], {}, 5, '']) assert.equal((await request('/import/plates?dryRun=1', 'POST', { csv: value })).status, 400)
  for (const value of [null, []]) assert.equal((await request('/import/plates?dryRun=1', 'POST', value)).status, 400)
  assert.equal((await request('/import/plates?dryRun=1', 'POST', { csv: csv(importRow(`客戶${fixture.customer}`, 'CLIENT')) }, 'client-token')).status, 403)
})

test('CSV 只有表頭、重複表頭或多欄拒絕寫入', async () => {
  assert.equal((await preview(requiredHeaders.join(','))).status, 400)
  assert.equal((await preview(`客戶,${requiredHeaders.join(',')}\n${importRow(`客戶${fixture.customer}`, 'CARD-HEADER').join(',')}`)).status, 400)
  assert.equal((await preview(`${requiredHeaders.join(',')}\n${importRow(`客戶${fixture.customer}`, 'CARD-EXTRA').join(',')},多欄`)).body.summary.error, 1)
})

test('CSV 匯入新公司組與公司並顯示預覽動作', async () => {
  const values = importRow(`客戶${fixture.customer}`, 'CARD-GROUP')
  values[7] = '香港持牌公司'
  values[8] = '內地承辦公司'
  const content = `${requiredHeaders.join(',')},香港公司英文名\n${values.join(',')},HK HOLDER LIMITED`
  const previewResult = await preview(content)
  assert.equal(previewResult.body.rows[0].groupAction, '新增公司組')
  assert.equal((await confirm(content, previewResult.body.previewKey)).status, 200)
  const plate = fixture.db.prepare('SELECT group_id FROM plate_assets WHERE card_number=?').get('CARD-GROUP')
  assert.ok(plate.group_id)
  assert.deepEqual(fixture.db.prepare('SELECT name FROM companies WHERE group_id=? ORDER BY name').all(plate.group_id).map(item => item.name), ['内地承办公司', '香港持牌公司'])
})

test('批量填日期保留既有備註並防止重複', async () => {
  fixture.db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,notes,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,code) DO UPDATE SET expires_on=excluded.expires_on,notes=excluded.notes').run('default', 'plate', fixture.plate, 'hk_crp', '2028-09-01', '人工備註', new Date().toISOString())
  const body = { plateIds: [fixture.plate], code: 'hk_crp', expiresOn: '2028-10-01' }
  assert.equal((await request('/tracked-items/bulk', 'PUT', body)).body.updated, 1)
  assert.equal((await request('/tracked-items/bulk', 'PUT', body)).status, 200)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM tracked_items WHERE owner_id=? AND code=?').get(fixture.plate, 'hk_crp').count, 1)
  assert.equal(fixture.db.prepare('SELECT notes FROM tracked_items WHERE owner_id=? AND code=?').get(fixture.plate, 'hk_crp').notes, '人工備註')
})

test('批量日期跨租戶或不存在 ID 整批拒絕', async () => {
  for (const invalid of [fixture.otherPlate, randomUUID()]) assert.equal((await request('/tracked-items/bulk', 'PUT', { plateIds: [fixture.plate, invalid], code: 'hk_crp', expiresOn: '2029-10-01' })).status, 400)
  assert.equal(fixture.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(fixture.plate, 'hk_crp').expires_on, '2028-10-01')
})

test('批量日期空值、錯誤類型與不適用規則拒絕', async () => {
  for (const body of [null, [], {}, { plateIds: [], code: 'hk_crp', expiresOn: '2028-01-01' }, { plateIds: [fixture.plate, fixture.plate], code: 'hk_crp', expiresOn: '2028-01-01' }, { plateIds: [fixture.plate], code: [], expiresOn: '2028-01-01' }, { plateIds: [fixture.plate], code: 'mo_permit', expiresOn: '2028-01-01' }, { plateIds: [fixture.plate], code: 'approval', expiresOn: '2028-01-01' }, { plateIds: [fixture.plate], code: 'hk_crp', expiresOn: null }, { plateIds: [fixture.plate], code: 'hk_crp', expiresOn: '2028-02-30' }]) assert.equal((await request('/tracked-items/bulk', 'PUT', body)).status, 400)
  assert.equal((await request('/tracked-items/bulk', 'PUT', { plateIds: [fixture.plate], code: 'hk_crp', expiresOn: '2028-01-01' }, 'client-token')).status, 403)
})

test('香港及澳門公司不儲存納稅人類型並保留香港 CR', async () => {
  const created = await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '香港', name: '香港公司', nameEn: 'HONG KONG COMPANY LIMITED', taxpayerType: ['忽略'], companyNumber: 'CR123' })
  assert.equal(created.status, 201)
  assert.equal(created.body.taxpayer_type, '')
  assert.equal(created.body.company_number, 'CR123')
  const changed = await request(`/companies/${created.body.id}`, 'PATCH', { jurisdiction: '澳門', taxpayerType: '小規模納稅人' })
  assert.equal(changed.body.taxpayer_type, '')
  assert.equal(changed.body.company_number, '')
})

test('內地公司納稅人類型拒絕其他選項', async () => {
  const company = await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '內地', name: '内地公司', taxpayerType: '錯誤' })
  assert.equal(company.status, 400)
  assert.equal((await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '內地', name: '内地公司', taxpayerType: '小規模納稅人' })).body.taxpayer_type, '小規模納稅人')
})

test('公司欄位錯誤類型、空白名稱及跨租戶客戶拒絕', async () => {
  for (const body of [null, [], { customerId: [], jurisdiction: '香港', name: '公司' }, { customerId: fixture.customer, jurisdiction: '香港', name: '   ' }, { customerId: fixture.customer, jurisdiction: '香港', name: null }, { customerId: fixture.customer, jurisdiction: '香港', name: [] }, { customerId: fixture.customer, jurisdiction: '香港', name: '公司', companyNumber: [] }, { customerId: fixture.otherCustomer, jurisdiction: '香港', name: '公司' }]) assert.ok([400, 404].includes((await request('/companies', 'POST', body)).status))
})

test('香港公司卡片資料回傳 BR 日期與 NAR1', async () => {
  const company = await request('/companies', 'POST', { customerId: fixture.customer, jurisdiction: '香港', name: '周年公司', nameEn: 'ANNIVERSARY COMPANY LIMITED', incorporatedOn: '2020-01-01' })
  assert.equal((await request('/tracked-items', 'PUT', { ownerType: 'company', ownerId: company.body.id, code: 'hk_br', expiresOn: '2028-01-01' })).status, 200)
  const item = (await request(`/companies?customerId=${fixture.customer}`)).body.find(entry => entry.id === company.body.id)
  assert.equal(item.brExpiresOn, '2028-01-01')
  assert.ok(item.nar1DueOn)
})

test('工單續期、驗車及其他類型保留牌照和車輛關聯', async () => {
  for (const serviceCode of ['renewal', 'inspection', 'other']) {
    const result = await request('/requests', 'POST', { customerId: fixture.customer, plateAssetId: fixture.plate, vehicleId: fixture.vehicle, route: '粵港', serviceCode, title: `${serviceCode}代辦` })
    assert.equal(result.status, 201)
    assert.equal(result.body.service_code, serviceCode)
    assert.equal(result.body.plate_asset_id, fixture.plate)
  }
})

test('舊牌證 API 可查詢但不能寫入', async () => {
  const credentialId = randomUUID()
  fixture.db.prepare('INSERT INTO credentials(id,vehicle_id,name) VALUES (?,?,?)').run(credentialId, fixture.vehicle, '舊證')
  assert.equal((await request(`/credentials/${credentialId}`)).status, 200)
  assert.equal((await request('/credentials', 'POST', { vehicleId: fixture.vehicle, name: '新證' })).status, 405)
  assert.equal((await request(`/credentials/${credentialId}`, 'PATCH', { status: '已核對' })).status, 405)
  assert.equal((await request(`/credentials/${credentialId}`, 'PATCH', { status: '已核對' }, 'client-token')).status, 403)
})

test('舊牌證查詢不洩露其他租戶或不存在的記錄', async () => {
  const credentialId = randomUUID()
  assert.equal((await request(`/credentials/${credentialId}`)).status, 404)
  assert.equal((await request(`/credentials?vehicleId=${randomUUID()}`)).status, 404)
  assert.equal((await request(`/credentials?vehicleId=${fixture.vehicle}`, 'GET', undefined, 'other-token')).status, 404)
  assert.equal((await request('/credentials', 'GET', undefined, 'client-token')).status, 403)
  assert.equal((await request(`/credentials/${credentialId}`, 'PATCH', { status: '已核對' })).status, 404)
})

test('管理員牌照總表顯示摘要且跨租戶隔離', async () => {
  const result = await request('/plate-assets?summary=1')
  assert.equal(result.status, 200)
  assert.ok(result.body.some(plate => plate.id === fixture.plate && plate.card_data.driver1 === '原司機'))
  assert.ok(result.body.every(plate => plate.id !== fixture.otherPlate))
})

test('規則開關更新及重複操作不改其他欄位', async () => {
  const rule = (await request('/rules')).body.find(item => item.code === 'hk_crp')
  const changed = await request(`/rules/${rule.id}`, 'PATCH', { customerVisible: false, active: false })
  assert.equal(changed.status, 200)
  assert.equal(changed.body.customerVisible, false)
  assert.equal((await request(`/rules/${rule.id}`, 'PATCH', { customerVisible: false, active: false })).status, 200)
  assert.equal((await request(`/rules/${rule.id}`, 'PATCH', { customerVisible: true, active: true })).body.name, rule.name)
})

test('舊牌證遷移按路線匹配並跳過批文', () => {
  const directory = mkdtempSync(join(tmpdir(), 'restructure-migration-'))
  const path = join(directory, 'test.db')
  try {
    assert.equal(launch(path).status, 0)
    const database = new DatabaseSync(path)
    const timestamp = new Date().toISOString()
    database.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run('customer', '客戶', '公司', 'default')
    database.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,notes) VALUES (?,?,?,?,?,?,?)').run('vehicle', 'customer', '粵港', '香港', '私家車', 'AB123', '原備註')
    for (const [plateId, route] of [['hk', '粵港'], ['mo', '粵澳']]) database.prepare('INSERT INTO plate_assets(id,customer_id,route,vehicle_id,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(plateId, 'customer', route, 'vehicle', plateId, timestamp, timestamp)
    for (const [credentialId, name, expiresOn] of [['crp', '香港封閉道路通行許可證', '2028-01-01'], ['permit', '澳門通行證', '2028-02-01'], ['card', '廣東批文', '2028-03-01'], ['other', '保險副本', '2028-04-01'], ['other2', '行駛證', '2028-05-01']]) database.prepare('INSERT INTO credentials(id,vehicle_id,name,expires_on) VALUES (?,?,?,?)').run(credentialId, 'vehicle', name, expiresOn)
    database.prepare('DELETE FROM schema_migrations WHERE name=?').run('credentials-to-expiry-v1')
    database.close()
    assert.equal(launch(path).status, 0)
    const verified = new DatabaseSync(path)
    assert.equal(verified.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get('hk', 'hk_crp').expires_on, '2028-01-01')
    assert.equal(verified.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get('mo', 'mo_permit').expires_on, '2028-02-01')
    assert.equal(verified.prepare('SELECT COUNT(*) count FROM tracked_items').get().count, 2)
    const notes = verified.prepare('SELECT notes FROM vehicles WHERE id=?').get('vehicle').notes
    assert.match(notes, /原備註/)
    assert.match(notes, /保險副本/)
    assert.match(notes, /行駛證/)
    assert.doesNotMatch(notes, /廣東批文/)
    verified.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('舊牌證遷移只執行一次', () => {
  const directory = mkdtempSync(join(tmpdir(), 'restructure-once-'))
  const path = join(directory, 'test.db')
  try {
    assert.equal(launch(path).status, 0)
    const database = new DatabaseSync(path)
    assert.equal(database.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('credentials-to-expiry-v1').count, 1)
    database.close()
    assert.equal(launch(path).status, 0)
    const verified = new DatabaseSync(path)
    assert.equal(verified.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('credentials-to-expiry-v1').count, 1)
    verified.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('非內地公司納稅人類型遷移清空且只執行一次', () => {
  const directory = mkdtempSync(join(tmpdir(), 'restructure-jurisdiction-'))
  const path = join(directory, 'test.db')
  try {
    assert.equal(launch(path).status, 0)
    const database = new DatabaseSync(path)
    const timestamp = new Date().toISOString()
    database.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run('customer', '客戶', '公司', 'default')
    for (const jurisdiction of ['香港', '澳門', '內地']) database.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,taxpayer_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(jurisdiction, 'default', 'customer', jurisdiction, jurisdiction, '一般納稅人', timestamp, timestamp)
    database.prepare('DELETE FROM schema_migrations WHERE name=?').run('company-jurisdiction-fields-v1')
    database.close()
    assert.equal(launch(path).status, 0)
    const verified = new DatabaseSync(path)
    assert.equal(verified.prepare('SELECT taxpayer_type FROM companies WHERE id=?').get('香港').taxpayer_type, '')
    assert.equal(verified.prepare('SELECT taxpayer_type FROM companies WHERE id=?').get('澳門').taxpayer_type, '')
    assert.equal(verified.prepare('SELECT taxpayer_type FROM companies WHERE id=?').get('內地').taxpayer_type, '一般納稅人')
    verified.close()
    assert.equal(launch(path).status, 0)
    const second = new DatabaseSync(path)
    assert.equal(second.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('company-jurisdiction-fields-v1').count, 1)
    second.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('表內修改口岸只接受系統口岸名稱', async () => {
  assert.equal((await request(`/plate-assets/${fixture.plate}`, 'PATCH', { port: '火星口岸' })).status, 400)
  assert.equal((await request(`/plate-assets/${fixture.plate}`, 'PATCH', { port: 123 })).status, 400)
  assert.equal((await request(`/plate-assets/${fixture.plate}`, 'PATCH', { port: '深圳灣' })).status, 200)
  assert.equal(fixture.db.prepare('SELECT port FROM plate_assets WHERE id=?').get(fixture.plate).port, '深圳灣')
})
test('表內修改口岸可清空', async () => {
  assert.equal((await request(`/plate-assets/${fixture.plate}`, 'PATCH', { port: '' })).status, 200)
  assert.equal(fixture.db.prepare('SELECT port FROM plate_assets WHERE id=?').get(fixture.plate).port, null)
})
