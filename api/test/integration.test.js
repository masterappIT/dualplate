import test, { before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID, scryptSync } from 'node:crypto'
import { defaultRules } from '../src/rules.js'

const hash = password => { const salt = randomUUID(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }
const lookupResponse = { data: [{ Brn:'68249242', Chinese_Company_Name:'曲坤有限公司', English_Company_Name:'Kukwan Limited', Address_of_Registered_Office:'香港測試地址', Company_Type:'私人股份有限公司', Date_of_Incorporation:'26-09-2017', 'Re-domiciliation_Date':'' }] }
const nativeFetch = globalThis.fetch
globalThis.fetch = async (input, init) => String(input).startsWith('http://mock-company-lookup.invalid/') ? new Response(JSON.stringify(lookupResponse), { status: 200, headers: { 'content-type': 'application/json' } }) : nativeFetch(input, init)
const invoke = (server, path, method = 'GET', body, token = '') => {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' } })
  return new Promise(resolve => {
    const outgoing = { setHeader() {}, writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    server.emit('request', incoming, outgoing)
  })
}

const state = {}
describe('第一階段 API 整合測試', { concurrency:false }, () => {
  before(async () => {
    state.directory = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)),'.phase1-api-'))
    state.databasePath = join(state.directory,'test.db')
    process.env.DB_PATH = state.databasePath
    process.env.DEMO_SEED = '0'
    process.env.API_NO_LISTEN = '1'
    process.env.HK_COMPANY_LOOKUP_URL = 'http://mock-company-lookup.invalid/lookup'
    const imported = await import(`../src/server.js?integration-test=${randomUUID()}`)
    state.server = imported.server
    state.stderr = () => ''
    state.db = new DatabaseSync(state.databasePath)
    state.tenantA = randomUUID(); state.tenantB = randomUUID(); state.customerA = randomUUID(); state.customerB = randomUUID(); state.plateA = randomUUID(); state.plateB = randomUUID(); state.vehicleA = randomUUID(); state.companyA = randomUUID(); state.mainlandCompany = randomUUID()
    for (const [tenant,customer] of [[state.tenantA,state.customerA],[state.tenantB,state.customerB]]) {
      state.db.prepare('INSERT INTO tenants VALUES (?,?,?)').run(tenant,'租戶',new Date().toISOString())
      state.db.prepare('INSERT INTO customers(id,name,kind,tenant_id) VALUES (?,?,?,?)').run(customer,`客戶${customer}`,'公司',tenant)
      state.db.prepare('INSERT INTO users(id,role,name,email,password_hash,username,tenant_id) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),'admin','專員',`${tenant}@test.invalid`,hash('password123'),`user${tenant}`,tenant)
      defaultRules.forEach((rule,index) => state.db.prepare('INSERT INTO rules(id,tenant_id,code,name,scope,method,match_json,params_json,remind_days,active,customer_visible,sort) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)').run(randomUUID(),tenant,rule.code,rule.name,rule.scope,rule.method,JSON.stringify(rule.match),JSON.stringify(rule.params),rule.remindDays,Number(rule.customerVisible),index))
    }
    state.db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),'customer','客戶','client@test.invalid',hash('password123'),state.customerA,state.tenantA)
    const expires = new Date(Date.now()+30*86400000).toISOString().slice(0,10)
    state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,card_expires_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state.plateA,state.customerA,'粵港',state.plateA,expires,new Date().toISOString(),new Date().toISOString())
    state.db.prepare('INSERT INTO plate_assets(id,customer_id,route,card_number,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(state.plateB,state.customerB,'粵港',state.plateB,new Date().toISOString(),new Date().toISOString())
    state.db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate) VALUES (?,?,?,?,?,?)').run(state.vehicleA,state.customerA,'粵港','香港','私家車','粵Z·TEST')
    state.db.prepare('INSERT INTO companies(id,tenant_id,customer_id,jurisdiction,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(state.mainlandCompany,state.tenantA,state.customerA,'內地','内地公司',new Date().toISOString(),new Date().toISOString())
    state.adminA = (await state.request('/admin/login','POST',{username:`user${state.tenantA}`,password:'password123'})).body.token
    state.adminB = (await state.request('/admin/login','POST',{username:`user${state.tenantB}`,password:'password123'})).body.token
    state.client = (await state.request('/login','POST',{email:'client@test.invalid',password:'password123'})).body.token
    const group = await state.request('/company-groups','POST',{customerId:state.customerA,name:'第一組'},state.adminA); assert.equal(group.status,201); state.group = group.body
    assert.equal((await state.request(`/companies/${state.mainlandCompany}`,'PATCH',{groupId:state.group.id},state.adminA)).status,200)
    const company = await state.request('/companies','POST',{customerId:state.customerA,groupId:state.group.id,jurisdiction:'香港',name:'香港甲',nameEn:'HONG KONG A LIMITED',incorporatedOn:'2020-02-29'},state.adminA); assert.equal(company.status,201); state.company = company.body
  })
  after(() => { state.db?.close(); state.server?.close(); if (state.directory) rmSync(state.directory,{recursive:true,force:true}) })

  test('租戶隔離及客戶帳號權限', async () => {
    for (const route of ['/customers','/plate-assets','/companies','/company-groups','/rules','/overview']) {
      const result = await state.request(route,'GET',undefined,state.adminA)
      assert.equal(result.status,200,`${route}: ${JSON.stringify(result.body)} ${state.stderr()}`); assert.ok(!JSON.stringify(result.body).includes(state.customerB),route); assert.ok(!JSON.stringify(result.body).includes(state.plateB),route)
    }
    assert.equal((await state.request(`/plate-assets/${state.plateB}`,'GET',undefined,state.adminA)).status,404)
    assert.equal((await state.request(`/vehicles/${state.vehicleA}`,'GET',undefined,state.adminB)).status,404)
    assert.equal((await state.request(`/company-groups?customerId=${state.customerB}`,'GET',undefined,state.adminA)).status,404)
    for (const route of ['/company-groups','/companies',`/tracked-items?ownerType=plate&ownerId=${state.plateA}`,'/rules','/overview']) assert.equal((await state.request(route,'GET',undefined,state.client)).status,403,route)
  })

  test('新建、手動修改及上傳批文卡不建立版本記錄', async () => {
    const cardNumber = `NEW-${randomUUID().slice(0,8)}`
    const created = await state.request('/plate-assets','POST',{customerId:state.customerA,route:'粵港',cardData:{cardNumber,company:'最新版公司'}},state.adminA)
    assert.equal(created.status,201)
    assert.equal(created.body.cardVersions,undefined)
    const patched = await state.request(`/plate-assets/${created.body.id}`,'PATCH',{cardNumber:`${cardNumber}-PATCH`},state.adminA)
    assert.equal(patched.status,200)
    assert.equal(patched.body.cardVersions,undefined)
    const edited = await state.request(`/plate-assets/${created.body.id}`,'PUT',{cardData:{cardNumber,company:'手動修改公司'}},state.adminA)
    assert.equal(edited.status,200)
    assert.equal(edited.body.cardVersions,undefined)
    const uploaded = await state.request(`/plate-assets/${created.body.id}/card/front`,'POST',{image:'data:image/png;base64,aGVsbG8='},state.adminA)
    assert.equal(uploaded.status,200)
    assert.equal((await state.request(`/plate-assets/${created.body.id}`,'GET',undefined,state.adminA)).body.cardVersions,undefined)
    assert.equal(state.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approval_card_versions'").get(),undefined)
    assert.equal(state.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approval_card_version_images'").get(),undefined)
    assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM approval_card_images WHERE plate_asset_id=?').get(created.body.id).count,1)
    assert.equal(state.db.prepare('SELECT card_data FROM plate_assets WHERE id=?').get(created.body.id).card_data.includes('手動修改公司'),true)
  })

  test('公司組及公司新增、修改與驗證', async () => {
    for (const invalidBody of [null, [], 1, '錯誤']) assert.equal((await state.request('/company-groups','POST',invalidBody,state.adminA)).status,400)
    assert.equal((await state.request(`/company-groups/${state.group.id}`,'PATCH',{name:'更新組'},state.adminB)).status,404)
    assert.equal((await state.request(`/company-groups/${state.group.id}`,'PATCH',{name:'更新組'},state.adminA)).body.name,'更新組')
    assert.equal((await state.request('/companies','POST',{customerId:state.customerA,groupId:state.group.id,jurisdiction:'錯誤',name:'X'},state.adminA)).status,400)
    assert.equal((await state.request('/companies','POST',{customerId:state.customerA,groupId:state.group.id,jurisdiction:'香港',name:'X',incorporatedOn:'2026-02-30'},state.adminA)).status,400)
    assert.equal((await state.request('/companies','POST',{customerId:state.customerB,jurisdiction:'香港',name:'X'},state.adminA)).status,404)
    assert.equal((await state.request(`/companies/${state.company.id}`,'PATCH',{customerId:state.customerB},state.adminA)).status,400)
    assert.equal((await state.request(`/companies/${state.company.id}`,'PATCH',{name:'香港乙'},state.adminA)).body.name,'香港乙')
  })

  test('公司狀態與狀態變更日期驗證', async () => {
    assert.equal((await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'狀態驗證公司',status:'不存在'},state.adminA)).status,400)
    assert.equal((await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'狀態驗證公司',status:null},state.adminA)).status,400)
    assert.equal((await state.request(`/companies/${state.company.id}`,'PATCH',{status:'註銷中',statusChangedOn:'2026-02-30'},state.adminA)).status,400)
    const updated = await state.request(`/companies/${state.company.id}`,'PATCH',{status:'註銷中',statusChangedOn:'2026-02-28'},state.adminA)
    assert.equal(updated.status,200); assert.equal(updated.body.status,'註銷中'); assert.equal(updated.body.status_changed_on,'2026-02-28')
  })

  test('批文卡有效期為唯讀來源，不重複錄入', async () => {
    const tracked = await state.request(`/tracked-items?ownerType=plate&ownerId=${state.plateA}`,'GET',undefined,state.adminA)
    const approval = tracked.body.find(item => item.code === 'approval')
    assert.equal(approval.readOnly,true); assert.equal(approval.source,'批文卡有效期'); assert.equal(approval.expiresOn,state.db.prepare('SELECT card_expires_on FROM plate_assets WHERE id=?').get(state.plateA).card_expires_on)
    const put = await state.request('/tracked-items','PUT',{ownerType:'plate',ownerId:state.plateA,code:'approval',expiresOn:'2030-01-01'},state.adminA)
    assert.equal(put.status,400); assert.equal(put.body.error,'此日期來自批文卡，請在批文卡修改')
    const overview = (await state.request('/overview','GET',undefined,state.adminA)).body
    assert.notEqual(overview.deadlines.find(item => item.ruleCode === 'approval' && item.ownerId === state.plateA)?.level,'missing')
  })

  test('公司組與兩地牌回傳內承單位狀態警示', async () => {
    assert.equal((await state.request(`/companies/${state.mainlandCompany}`,'PATCH',{status:'註銷中'},state.adminA)).status,200)
    assert.equal((await state.request(`/plate-assets/${state.plateA}`,'PATCH',{groupId:state.group.id},state.adminA)).status,200)
    const groups = await state.request(`/company-groups?customerId=${state.customerA}`,'GET',undefined,state.adminA)
    const group = groups.body.find(item => item.id === state.group.id)
    assert.deepEqual(group.warnings,['內承單位註銷中']); assert.deepEqual(group.plates[0].warnings,['內承單位註銷中'])
    const plate = await state.request(`/plate-assets/${state.plateA}`,'GET',undefined,state.adminA)
    assert.deepEqual(plate.body.warnings,['內承單位註銷中']); assert.equal(plate.body.companyStatuses.find(item => item.id === state.mainlandCompany).status,'註銷中')
  })

  test('已註銷公司不出現在總覽，註銷中公司仍有提醒', async () => {
    const dissolved = await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'已註銷香港公司',nameEn:'DISSOLVED HK LIMITED',incorporatedOn:'2020-01-01',status:'已註銷'},state.adminA); assert.equal(dissolved.status,201)
    const activeClosing = await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'註銷中香港公司',nameEn:'CLOSING HK LIMITED',incorporatedOn:'2020-01-01',status:'註銷中'},state.adminA); assert.equal(activeClosing.status,201)
    assert.equal((await state.request('/tracked-items','PUT',{ownerType:'company',ownerId:dissolved.body.id,code:'hk_br',expiresOn:'2026-01-01'},state.adminA)).status,200)
    assert.equal((await state.request('/tracked-items','PUT',{ownerType:'company',ownerId:activeClosing.body.id,code:'hk_br',expiresOn:'2026-01-01'},state.adminA)).status,200)
    const overview = (await state.request('/overview','GET',undefined,state.adminA)).body
    assert.ok(!overview.deadlines.some(item => item.ownerId === dissolved.body.id)); assert.ok(overview.deadlines.some(item => item.ownerId === activeClosing.body.id && item.ruleCode === 'hk_br'))
    const customer = overview.customers.find(item => item.id === state.customerA)
    assert.equal(customer.companies,3); assert.equal(customer.dissolvedCompanies,1)
  })

  test('香港公司註冊處查無結果時不自動改狀態', async () => {
    const created = await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'查無香港公司',nameEn:'NO RESULT HK LIMITED',registrationNo:'12345678'},state.adminA); assert.equal(created.status,201)
    const lookup = await state.request(`/companies/${created.body.id}/hk-lookup`,'POST',{},state.adminA)
    assert.equal(lookup.status,404); assert.equal(lookup.body.error,'公司註冊處查無此存續公司，請人工核實')
    const stored = (await state.request('/companies','GET',undefined,state.adminA)).body.find(item => item.id === created.body.id)
    assert.equal(stored.status,'存續'); assert.equal(stored.name,'查無香港公司')
  })

  test('香港公司註冊處查詢只回傳結果，確認後才寫入', async () => {
    const created = await state.request('/companies','POST',{customerId:state.customerA,jurisdiction:'香港',name:'待查香港公司',nameEn:'PENDING LOOKUP HK LIMITED',registrationNo:'68249242'},state.adminA); assert.equal(created.status,201)
    const lookup = await state.request(`/companies/${created.body.id}/hk-lookup`,'POST',{},state.adminA)
    assert.equal(lookup.status,200); assert.equal(lookup.body.name,'曲坤有限公司'); assert.equal(lookup.body.incorporatedOn,'2017-09-26')
    assert.equal((await state.request('/companies','GET',undefined,state.adminA)).body.find(item => item.id === created.body.id).name,'待查香港公司')
    const saved = await state.request(`/companies/${created.body.id}`,'PATCH',{name:lookup.body.name,incorporatedOn:lookup.body.incorporatedOn},state.adminA)
    assert.equal(saved.status,200); assert.equal(saved.body.name,'曲坤有限公司'); assert.equal(saved.body.incorporated_on,'2017-09-26')
  })

  test('批文規則參數遷移只執行一次', () => {
    state.db.prepare("UPDATE rules SET params_json='{}' WHERE tenant_id=? AND code='approval'").run('default')
    const reloaded = spawnSync(process.execPath,['--input-type=module','-e',"import './src/db.js'"],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:state.databasePath,DEMO_SEED:'0'},encoding:'utf8'})
    assert.equal(reloaded.status,0,reloaded.stderr)
    assert.equal(state.db.prepare("SELECT params_json FROM rules WHERE tenant_id=? AND code='approval'").get('default').params_json,'{}')
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('approval-rule-card-expires-on').count,1)
  })

  test('公司狀態欄位遷移只執行一次', () => {
    state.db.prepare("UPDATE companies SET status='經營異常' WHERE id=?").run(state.mainlandCompany)
    const statusReloaded = spawnSync(process.execPath,['--input-type=module','-e',"import './src/db.js'"],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:state.databasePath,DEMO_SEED:'0'},encoding:'utf8'})
    assert.equal(statusReloaded.status,0,statusReloaded.stderr)
    assert.equal(state.db.prepare('SELECT status FROM companies WHERE id=?').get(state.mainlandCompany).status,'經營異常')
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('company-status-fields').count,1)
  })

  test('客戶可見欄位遷移只執行一次', () => {
    state.db.prepare("UPDATE rules SET customer_visible=1 WHERE tenant_id=? AND code='cn_status_check'").run('default')
    state.db.prepare("DELETE FROM schema_migrations WHERE name='rules-customer-visible'").run()
    const reloaded = spawnSync(process.execPath,['--input-type=module','-e',"import './src/db.js'"],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:state.databasePath,DEMO_SEED:'0'},encoding:'utf8'})
    assert.equal(reloaded.status,0,reloaded.stderr)
    assert.equal(state.db.prepare("SELECT customer_visible FROM rules WHERE tenant_id=? AND code='cn_status_check'").get('default').customer_visible,0)
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('rules-customer-visible').count,1)
    state.db.prepare("UPDATE rules SET customer_visible=1 WHERE tenant_id=? AND code='cn_status_check'").run('default')
    const rerun = spawnSync(process.execPath,['--input-type=module','-e',"import './src/db.js'"],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:state.databasePath,DEMO_SEED:'0'},encoding:'utf8'})
    assert.equal(rerun.status,0,rerun.stderr)
    assert.equal(state.db.prepare("SELECT customer_visible FROM rules WHERE tenant_id=? AND code='cn_status_check'").get('default').customer_visible,1)
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE name=?').get('rules-customer-visible').count,1)
  })

  test('規則驗證、適用性及完成記錄', async () => {
    const allRules = (await state.request('/rules','GET',undefined,state.adminA)).body
    assert.ok(allRules.every(item => typeof item.customerVisible === 'boolean'))
    const seeded = allRules.find(item => item.code === 'cn_status_check')
    assert.equal(seeded.customerVisible,false)
    assert.ok(allRules.filter(item => item.code !== 'cn_status_check').every(item => item.customerVisible === true))
    for (const invalidBody of [null, [], 1, '錯誤']) assert.equal((await state.request('/rules','POST',invalidBody,state.adminA)).status,400)
    assert.equal((await state.request('/rules','POST',{code:'invalid_visibility',name:'錯誤可見性',scope:'company',method:'expiry',match:{},params:{},customerVisible:'false'},state.adminA)).status,400)
    const custom = await state.request('/rules','POST',{code:'special_expiry',name:'特別到期',scope:'company',method:'expiry',match:{jurisdiction:'香港'},params:{},remindDays:30,customerVisible:false},state.adminA)
    assert.equal(custom.status,201); assert.equal(custom.body.customerVisible,false); assert.ok(!(await state.request('/rules','GET',undefined,state.adminB)).body.some(item => item.code === 'special_expiry'))
    assert.equal((await state.request(`/rules/${custom.body.id}`,'PATCH',{customerVisible:'false'},state.adminA)).status,400)
    const hidden = await state.request(`/rules/${custom.body.id}`,'PATCH',{customerVisible:false},state.adminA)
    assert.equal(hidden.status,200); assert.equal(hidden.body.customerVisible,false)
    const visibleAgain = await state.request(`/rules/${custom.body.id}`,'PATCH',{customerVisible:true},state.adminA)
    assert.equal(visibleAgain.status,200); assert.equal(visibleAgain.body.customerVisible,true)
    assert.equal((await state.request('/rules','POST',{code:'bad!',name:'錯誤',scope:'company',method:'expiry',match:{},params:{}},state.adminA)).status,400)
    assert.equal((await state.request('/rules','POST',{code:'bad_match',name:'錯誤',scope:'company',method:'expiry',match:{wrong:'x'},params:{}},state.adminA)).status,400)
    assert.equal((await state.request('/rule-completions','POST',{ruleCode:'hk_nar1',ownerId:state.mainlandCompany,period:'2026'},state.adminA)).status,400)
    const computed = await state.request('/rules','POST',{code:'special_yearly',name:'停用測試',scope:'company',method:'yearly',match:{jurisdiction:'香港'},params:{month:12,day:31},remindDays:30},state.adminA); assert.equal(computed.status,201)
    assert.equal((await state.request(`/rules/${computed.body.id}`,'PATCH',{active:false},state.adminA)).status,200)
    assert.equal((await state.request('/rule-completions','POST',{ruleCode:'special_yearly',ownerId:state.company.id,period:'2026'},state.adminA)).status,400)
  })

  test('季度核對規則使用 YYYY-MM 期數並附官方網址', async () => {
    const overview = (await state.request('/overview','GET',undefined,state.adminA)).body
    const item = overview.deadlines.find(entry => entry.ruleCode === 'cn_status_check' && entry.ownerId === state.mainlandCompany)
    assert.ok(item); assert.match(item.period,/^\d{4}-(01|04|07|10)$/); assert.equal(item.officialUrl,'https://www.gsxt.gov.cn/')
    assert.equal((await state.request('/rule-completions','POST',{ruleCode:'cn_status_check',ownerId:state.mainlandCompany,period:'2026-13'},state.adminA)).status,400)
    assert.equal((await state.request('/rule-completions','POST',{ruleCode:'cn_status_check',ownerId:state.mainlandCompany,period:item.period},state.adminA)).status,200)
  })

  test('到期項目、總覽、提醒天數與停用規則', async () => {
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10), tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10)
    assert.equal((await state.request('/tracked-items','PUT',{ownerType:'company',ownerId:state.company.id,code:'hk_br',expiresOn:yesterday,notes:'已核對'},state.adminA)).status,200)
    assert.equal((await state.request('/tracked-items','PUT',{ownerType:'company',ownerId:state.company.id,code:'hk_br',expiresOn:'2026-02-30'},state.adminA)).status,400)
    let overview = (await state.request('/overview','GET',undefined,state.adminA)).body
    assert.ok(overview.counts.overdue >= 1); assert.ok(overview.counts.missing >= 1); assert.ok(overview.counts.due >= 1)
    const rule = await state.request('/rules','POST',{code:'annual_test',name:'年度測試',scope:'company',method:'yearly',match:{jurisdiction:'香港'},params:{month:new Date(Date.now()+30*86400000).getUTCMonth()+1,day:new Date(Date.now()+30*86400000).getUTCDate()},remindDays:60},state.adminA); assert.equal(rule.status,201)
    const before = (await state.request('/overview','GET',undefined,state.adminA)).body.deadlines.find(item => item.ruleCode === 'annual_test'); assert.ok(before)
    assert.equal((await state.request('/rule-completions','POST',{ruleCode:'annual_test',ownerId:state.company.id,period:before.period},state.adminA)).status,200)
    assert.ok(!(await state.request('/overview','GET',undefined,state.adminA)).body.deadlines.some(item => item.ruleCode === 'annual_test' && item.ownerId === state.company.id && item.period === before.period))
    assert.equal((await state.request('/rule-completions','DELETE',{ruleCode:'annual_test',ownerId:state.company.id,period:before.period},state.adminA)).status,200)
    assert.equal((await state.request(`/rules/${rule.body.id}`,'PATCH',{remindDays:0},state.adminA)).status,200)
    overview = (await state.request('/overview','GET',undefined,state.adminA)).body; assert.equal(overview.deadlines.find(item => item.ruleCode === 'annual_test')?.level,'upcoming')
    assert.equal((await state.request(`/rules/${rule.body.id}`,'PATCH',{active:false},state.adminA)).status,200)
    assert.ok(!(await state.request('/overview','GET',undefined,state.adminA)).body.deadlines.some(item => item.ruleCode === 'annual_test'))
  })

  test('車輛修改完整驗證且不可清空車牌', async () => {
    assert.equal((await state.request(`/vehicles/${state.vehicleA}`,'PATCH',{plate:'  '},state.adminA)).status,400)
    assert.equal((await state.request(`/vehicles/${state.vehicleA}`,'PATCH',{plate:'新車牌',origin:'不存在'},state.adminA)).status,400)
    assert.equal(state.db.prepare('SELECT plate FROM vehicles WHERE id=?').get(state.vehicleA).plate,'粵Z·TEST')
    assert.equal((await state.request(`/vehicles/${state.vehicleA}`,'PATCH',{plate:'新車牌',firstRegisteredOn:'2020-02-30'},state.adminA)).status,400)
    assert.equal(state.db.prepare('SELECT plate FROM vehicles WHERE id=?').get(state.vehicleA).plate,'粵Z·TEST')
    assert.equal((await state.request(`/vehicles/${state.vehicleA}`,'PATCH',{plate:'新車牌',firstRegisteredOn:'2020-02-29'},state.adminA)).body.first_registered_on,'2020-02-29')
  })

  test('建立新租戶會播種規則及管理員', async () => {
    const created = spawnSync(process.execPath,['src/create-tenant.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:state.databasePath,TENANT_NAME:'新代辦',ADMIN_USERNAME:'newtenantadmin',ADMIN_NAME:'新管理員',ADMIN_PASSWORD:'password123'},encoding:'utf8'})
    assert.equal(created.status,0,created.stderr)
    const token = (await state.request('/admin/login','POST',{username:'newtenantadmin',password:'password123'})).body.token
    assert.equal((await state.request('/rules','GET',undefined,token)).body.length,defaultRules.length)
    // 新租戶只有內置的「本公司（自有）」客戶（委託範圍與自有指標，管理者 2026-10-16 確認）
    assert.deepEqual((await state.request('/customers','GET',undefined,token)).body.map(item => [item.name, item.is_self]),[['本公司（自有）',1]])
  })

  const importHeaders = '客戶,路線,內地車牌,港澳車牌,批文卡號,批文到期,CRP／通行證到期,香港／澳門公司,內地公司'
  const importRow = (customer, card, route = '粵港') => `${customer},${route},粵Z1111港,AB111,${card},2027-01-01,2027-02-01,,`
  const preview = csv => state.request('/import/plates?dryRun=1', 'POST', { csv }, state.adminA)
  const confirm = (csv, previewKey) => state.request('/import/plates', 'POST', { csv, previewKey, confirm: true }, state.adminA)

  test('CSV 預覽不寫入且顯示新增內容', async () => {
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerA}`, 'CSV-NEW')}`
    const result = await preview(csv)
    assert.equal(result.status, 200)
    assert.equal(result.body.summary.create, 1)
    assert.equal(result.body.rows[0].values['批文卡號'], 'CSV-NEW')
    assert.equal(state.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CSV-NEW'), undefined)
  })

  test('CSV 確認新增牌照及到期項目', async () => {
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerA}`, 'CSV-NEW')}`
    const result = await confirm(csv, (await preview(csv)).body.previewKey)
    assert.equal(result.status, 200)
    const plate = state.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CSV-NEW')
    assert.ok(plate)
    assert.equal(state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(plate.id, 'hk_crp').expires_on, '2027-02-01')
  })

  test('CSV 再匯入同一身份更新而不重建，並保留卡面欄位', async () => {
    const plate = state.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CSV-NEW')
    state.db.prepare('UPDATE plate_assets SET card_data=? WHERE id=?').run(JSON.stringify({ cardNumber: 'CSV-NEW', driver1: '司機甲', company: '原商號' }), plate.id)
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerA}`, 'CSV-NEW').replace('2027-01-01', '2028-01-01')}`
    assert.equal((await preview(csv)).body.summary.update, 1)
    assert.equal((await confirm(csv, (await preview(csv)).body.previewKey)).status, 200)
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM plate_assets WHERE card_number=?').get('CSV-NEW').count, 1)
    assert.equal(JSON.parse(state.db.prepare('SELECT card_data FROM plate_assets WHERE id=?').get(plate.id).card_data).driver1, '司機甲')
  })

  test('CSV 錯誤列阻止整批寫入', async () => {
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerA}`, 'CSV-ERROR')}\n${importRow(`客戶${state.customerA}`, 'CSV-INVALID').replace('2027-01-01', '2027-02-30')}`
    const result = await preview(csv)
    assert.equal(result.body.summary.error, 1)
    assert.equal((await confirm(csv, result.body.previewKey)).status, 400)
    assert.equal(state.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CSV-ERROR'), undefined)
  })

  test('CSV 跨租戶同名客戶不匹配', async () => {
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerB}`, 'CSV-OTHER')}`
    assert.equal((await preview(csv)).body.summary.error, 1)
    assert.equal(state.db.prepare('SELECT id FROM plate_assets WHERE card_number=?').get('CSV-OTHER'), undefined)
  })

  test('CSV 同一檔案重複牌照列顯示錯誤', async () => {
    const row = importRow(`客戶${state.customerA}`, 'CSV-DUP')
    assert.equal((await preview(`${importHeaders}\n${row}\n${row}`)).body.rows[1].errors[0], '同一檔案重複的牌照')
  })

  test('CSV 未預覽或預覽內容不同不能確認', async () => {
    const csv = `${importHeaders}\n${importRow(`客戶${state.customerA}`, 'CSV-NOT-PREVIEWED')}`
    assert.equal((await confirm(csv, null)).status, 400)
    assert.equal((await confirm(csv + '\n', (await preview(csv)).body.previewKey)).status, 400)
  })

  test('CSV 空值、陣列、錯誤類型及客戶帳號均遭拒', async () => {
    for (const csv of [null, [], {}, 1, '']) assert.equal((await state.request('/import/plates?dryRun=1', 'POST', { csv }, state.adminA)).status, 400)
    for (const body of [null, []]) assert.equal((await state.request('/import/plates?dryRun=1', 'POST', body, state.adminA)).status, 400)
    assert.equal((await state.request('/import/plates?dryRun=1', 'POST', { csv: importHeaders }, state.client)).status, 403)
  })

  test('批量填日期一次更新適用的牌照', async () => {
    const result = await state.request('/tracked-items/bulk', 'PUT', { plateIds: [state.plateA], code: 'hk_crp', expiresOn: '2028-01-01' }, state.adminA)
    assert.equal(result.status, 200)
    assert.equal(result.body.updated, 1)
    assert.equal(state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(state.plateA, 'hk_crp').expires_on, '2028-01-01')
  })

  test('批量日期重複提交覆寫而非新增', async () => {
    assert.equal((await state.request('/tracked-items/bulk', 'PUT', { plateIds: [state.plateA], code: 'hk_crp', expiresOn: '2028-01-01' }, state.adminA)).status, 200)
    assert.equal(state.db.prepare('SELECT COUNT(*) count FROM tracked_items WHERE owner_id=? AND code=?').get(state.plateA, 'hk_crp').count, 1)
  })

  test('批量日期有跨租戶或不存在牌照時全批不寫入', async () => {
    for (const plateId of [state.plateB, randomUUID()]) assert.equal((await state.request('/tracked-items/bulk', 'PUT', { plateIds: [state.plateA, plateId], code: 'hk_crp', expiresOn: '2029-01-01' }, state.adminA)).status, 400)
    assert.equal(state.db.prepare('SELECT expires_on FROM tracked_items WHERE owner_id=? AND code=?').get(state.plateA, 'hk_crp').expires_on, '2028-01-01')
  })

  test('批量日期空值、錯誤類型、重複 ID 及不適用規則遭拒', async () => {
    for (const body of [null, [], {}, { plateIds: [], code: 'hk_crp', expiresOn: '2028-01-01' }, { plateIds: [state.plateA, state.plateA], code: 'hk_crp', expiresOn: '2028-01-01' }, { plateIds: [state.plateA], code: 'mo_permit', expiresOn: '2028-01-01' }, { plateIds: [state.plateA], code: 'approval', expiresOn: '2028-01-01' }, { plateIds: [state.plateA], code: 'hk_crp', expiresOn: null }, { plateIds: [state.plateA], code: 'hk_crp', expiresOn: '2028-02-30' }]) assert.equal((await state.request('/tracked-items/bulk', 'PUT', body, state.adminA)).status, 400)
    assert.equal((await state.request('/tracked-items/bulk', 'PUT', { plateIds: [state.plateA], code: 'hk_crp', expiresOn: '2028-01-01' }, state.client)).status, 403)
  })

  test('香港及澳門公司忽略納稅人類型，香港保存 CR 編號', async () => {
    const result = await state.request('/companies', 'POST', { customerId: state.customerA, jurisdiction: '香港', name: '新香港公司', nameEn: 'NEW HK LIMITED', taxpayerType: '一般納稅人', companyNumber: 'CR123' }, state.adminA)
    assert.equal(result.status, 201)
    assert.equal(result.body.taxpayer_type, '')
    assert.equal(result.body.company_number, 'CR123')
    const changed = await state.request(`/companies/${result.body.id}`, 'PATCH', { jurisdiction: '澳門', taxpayerType: '小規模納稅人' }, state.adminA)
    assert.equal(changed.body.taxpayer_type, '')
    assert.equal(changed.body.company_number, '')
  })

  test('內地公司納稅人類型僅接受兩個選項', async () => {
    assert.equal((await state.request(`/companies/${state.mainlandCompany}`, 'PATCH', { taxpayerType: '錯誤' }, state.adminA)).status, 400)
    assert.equal((await state.request(`/companies/${state.mainlandCompany}`, 'PATCH', { taxpayerType: '小規模納稅人' }, state.adminA)).body.taxpayer_type, '小規模納稅人')
  })

  test('新建工單保留對象並帶入續期、驗車和其他業務類型', async () => {
    for (const serviceCode of ['renewal', 'inspection', 'other']) {
      const result = await state.request('/requests', 'POST', { customerId: state.customerA, route: '粵港', plateAssetId: state.plateA, vehicleId: state.vehicleA, serviceCode, title: `${serviceCode}代辦` }, state.adminA)
      assert.equal(result.status, 201)
      assert.equal(result.body.service_code, serviceCode)
      assert.equal(result.body.plate_asset_id, state.plateA)
    }
  })

  test('舊牌證 API 不可新增或更新', async () => {
    assert.equal((await state.request('/credentials', 'POST', { vehicleId: state.vehicleA, name: '舊證' }, state.adminA)).status, 405)
    assert.equal((await state.request(`/credentials/${randomUUID()}`, 'PATCH', { status: '已核對' }, state.adminA)).status, 404)
  })
})

state.request = (path, method='GET', body, token='') => invoke(state.server, path, method, body, token)
