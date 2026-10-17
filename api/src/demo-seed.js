import { db, id, now, hashPassword, DEFAULT_TENANT } from './db.js'
import { businessToday } from './rules.js'
import { writeScope } from './entrustment.js'
import { refreshContract, receiveInvoice } from './rentals.js'
import { ensureFilings } from './bookkeeping.js'

// 完整閉環示範資料（docs/tasks/production-brief.md 第 3 節）：只在 DEMO_SEED=1 時、每個資料庫建立一次，供管理者本機測試。
// 3 位客戶（含本公司自有）、12 個牌照、公司組、司機、到期日、委託範圍、工單、出租合約、收費、報帳。日期都以今天為準。
const MIGRATION = 'demo-full-v1'
const day = offset => new Date(businessToday().getTime() + offset * 86400000).toISOString().slice(0, 10)
const month = offset => { const d = businessToday(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 7) }

export function seedDemo() {
  if (process.env.DEMO_SEED !== '1' || db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(MIGRATION)) return false
  const tenant = DEFAULT_TENANT, at = now()
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND tenant_id=? ORDER BY rowid LIMIT 1").get(tenant)
  if (!admin) return false
  db.exec('BEGIN')
  try {
    // ── 員工與客戶 ──
    if (!db.prepare("SELECT 1 FROM users WHERE username='staff'").get()) db.prepare("INSERT INTO users(id,role,name,email,password_hash,username,tenant_id) VALUES (?,?,?,?,?,?,?)").run(id(), 'staff', '專員小黃', 'staff@demo.local', hashPassword('StaffDemo12345'), 'staff', tenant)
    const chen = db.prepare("SELECT id FROM customers WHERE tenant_id=? AND name LIKE '%陳先生%'").get(tenant)?.id
    const self = db.prepare('SELECT id FROM customers WHERE tenant_id=? AND is_self=1').get(tenant).id
    const li = id()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id,advisor_name,advisor_phone,advisor_wechat,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(li, '李先生（示範）', '個人', '+85291110000', tenant, '陳嘉欣', '+852 9123 4567', 'chen_plate', '示範：香港公司客戶自理，內地公司委託我們')
    if (chen) db.prepare('UPDATE customers SET advisor_name=COALESCE(advisor_name,?), advisor_phone=COALESCE(advisor_phone,?), advisor_wechat=COALESCE(advisor_wechat,?) WHERE id=?').run('陳嘉欣', '+852 9123 4567', 'chen_plate', chen)
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,phone) VALUES (?,?,?,?,?,?,?,?)').run(id(), 'customer', '李先生', 'li@demo.local', hashPassword('CustomerDemo123!'), li, tenant, '+85291110000')

    // ── 會計公司、公司組與公司 ──
    const firm = id()
    db.prepare('INSERT INTO accounting_firms(id,tenant_id,name,contact,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(firm, tenant, '信達會計（廣州）', '何小姐', '+86 20 1234 5678', at, at)
    const groups = []
    for (const [customer, index] of [[li, 1], [li, 2], [li, 3], [self, 1]]) {
      const group = id(), hk = id(), cn = id(), label = customer === self ? '本公司' : `李氏${index}`, labelEn = customer === self ? 'Own Company' : `Lee ${index}`
      db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,created_at) VALUES (?,?,?,?,?)').run(group, tenant, customer, `${label}組`, at)
      db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,name_en,registration_no,incorporated_on,status,created_at,updated_at,company_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(hk, tenant, customer, group, '香港', `${label}貿易（香港）有限公司`, `${labelEn} Trading (Hong Kong) Limited`, `7${index}12345`, `20${18 + index}-0${index + 2}-1${index}`, '存續', at, at, `31${index}0000`)
      db.prepare('INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,registration_no,incorporated_on,taxpayer_type,status,created_at,updated_at,accounting_firm_id,filing_cycle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(cn, tenant, customer, group, '內地', `广州${label}商贸有限公司`, `91440101MA5D${index}XXXX`, `20${18 + index}-05-20`, index === 2 ? '一般納稅人' : '小規模納稅人', '存續', at, at, firm, 'monthly')
      groups.push({ group, hk, cn, customer })
    }
    // 香港公司的商業登記與周年申報到期
    groups.forEach(({ hk }, index) => db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)').run(tenant, 'company', hk, 'hk_br', day([25, 140, -5, 200][index]), admin.id, at))

    // ── 12 個牌照（李先生 8、陳先生 2、本公司 2） ──
    const ports = ['港珠澳大橋', '深圳灣', '蓮塘／香園圍', '皇崗']
    const drivers = [['黃文軒', '林海濤'], ['王振華', '何思時', '鍾家德'], ['陳志明'], ['李家輝', '張偉'], ['周子健'], ['吳嘉豪', '鄭浩然'], ['馮國強'], ['梁俊傑', '蔡德明'], ['陳先生'], ['黃師傅'], ['本公司司機甲'], ['本公司司機乙']]
    const expiries = [-12, 9, 25, 48, 75, 120, 160, 210, 46, 300, 33, 400]
    const plates = []
    for (let index = 0; index < 12; index++) {
      const owner = index < 8 ? li : index < 10 ? chen || li : self
      const group = owner === li ? groups[index % 3].group : owner === self ? groups[3].group : null
      const plate = id(), vehicle = id(), mainland = `粵Z${String.fromCharCode(65 + index)}${100 + index * 7}港`, local = `${['AB', 'CD', 'EF', 'GH', 'JK', 'LM', 'NP', 'QR', 'ST', 'UV', 'WX', 'YZ'][index]}${1000 + index * 37}`
      const card = { cardNumber: `GD${2025000 + index}`, crossing: ports[index % 4], mainlandPlate: mainland, localPlate: local, driver1: drivers[index][0] || '', driver2: drivers[index][1] || '', driver3: drivers[index][2] || '', validFrom: day(expiries[index] - 365), validTo: day(expiries[index]) }
      db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,brand,model,first_registered_on) VALUES (?,?,?,?,?,?,?,?,?)').run(vehicle, owner, '粵港', '香港', '私家車', local, ['Toyota', 'Lexus', 'Mercedes-Benz', 'BMW'][index % 4], ['Alphard', 'LM', 'V-Class', 'X5'][index % 4], `20${16 + (index % 6)}-0${1 + (index % 8)}-15`)
      db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,usage_status,card_number,card_expires_on,created_at,updated_at,card_data,card_status,group_id,indicator_category,port,crossing_reminder) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(plate, owner, '粵港', mainland, local, vehicle, '已上牌', owner === self ? '閒置' : '自用', card.cardNumber, day(expiries[index]), at, at, JSON.stringify(card), '已核對', group, index % 3 ? '商務' : '投資', ports[index % 4], index % 4 === 0 ? 1 : 0)
      db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)').run(tenant, 'plate', plate, 'hk_crp', day(expiries[index] + 20), admin.id, at)
      db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)').run(tenant, 'vehicle', vehicle, 'local_insurance', day([5, 60, 18, 90, 140, 30, 200, 75, 22, 180, 45, 250][index]), admin.id, at)
      if (index % 4 === 0) db.prepare('INSERT INTO plate_crossings(id,tenant_id,plate_asset_id,crossed_on,source,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(id(), tenant, plate, day(-70 - index), 'admin', admin.id, at)
      // 司機：按批文卡駕駛人登記，駕駛人 1 為主司機
      drivers[index].forEach((name, order) => {
        let driver = db.prepare('SELECT id FROM drivers WHERE customer_id=? AND name=?').get(owner, name)?.id
        if (!driver) { driver = id(); db.prepare('INSERT INTO drivers(id,tenant_id,customer_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(driver, tenant, owner, name, at, at) }
        db.prepare('INSERT OR IGNORE INTO plate_drivers(plate_asset_id,driver_id,role,sort,registered_on) VALUES (?,?,?,?,?)').run(plate, driver, order ? '副' : '主', order, day(-200))
        if (order === 0) db.prepare('INSERT INTO tracked_items(tenant_id,owner_type,owner_id,code,expires_on,updated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(tenant, 'driver', driver, 'home_return_permit', day(30 + index * 40), admin.id, at)
      })
      plates.push({ plate, vehicle, owner, mainland })
    }

    // ── 委託範圍：李先生香港公司客戶自理、內地公司我們做（報帳外包給會計公司） ──
    for (const { hk, cn } of groups.filter(item => item.customer === li)) {
      for (const item of ['hk_nar1', 'hk_br', 'hk_registered_office']) writeScope({ tenantId: tenant, ownerType: 'company', ownerId: hk, item, handler: 'client', userId: admin.id })
      for (const item of ['monthly_filing', 'cn_cit_annual']) writeScope({ tenantId: tenant, ownerType: 'company', ownerId: cn, item, handler: 'outsourced', providerName: '信達會計（廣州）', userId: admin.id })
    }

    // ── 工單：一張等客戶交文件、一張辦理中、一張上月已完成 ──
    const staff = db.prepare("SELECT id FROM users WHERE username='staff'").get().id
    const work = (plate, status, title, steps, extra = {}) => {
      const request = id()
      db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,plate_asset_id,service_code,route,title,status,stage,assignee_id,created_at,updated_at,due_on,priority,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(request, plate.owner, plate.vehicle, plate.plate, extra.service || 'renewal', '粵港', title, status, steps.find(step => step[1] !== '已完成')?.[0] || '交付', extra.assignee || staff, extra.createdAt || at, at, day(extra.due ?? 20), extra.priority || 'normal', extra.completedAt || null)
      steps.forEach(([name, state, owner, docs], index) => db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,owner,documents_json,sort,completed_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), request, name, '通用', state, owner || 'us', JSON.stringify(docs || []), index, state === '已完成' ? at : null))
      db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), request, admin.id, 'created', '示範工單已建立', at)
      return request
    }
    work(plates[0], '待客戶提供', '批文及 CRP 續期', [['各證件有效期核對', '已完成'], ['客戶提供身份證及車輛登記文件', '待辦', 'client', ['香港身份證副本', '車輛登記文件']], ['內地批文延期辦理', '待辦'], ['香港 CRP 續期', '待辦']], { due: 10, priority: 'urgent' })
    work(plates[1], '進行中', '更換司機', [['司機資格核對', '已完成'], ['內地批文變更', '進行中'], ['港／澳資料更新', '待辦'], ['邊檢備案核對', '待辦']], { service: 'driver_change', due: 25 })
    const done = work(plates[2], '已完成', '香港車輛牌照續期', [['資料核對', '已完成'], ['運輸署續牌', '已完成'], ['交付', '已完成']], { createdAt: `${month(-1)}-08T02:00:00.000Z`, completedAt: `${month(-1)}-18T08:00:00.000Z` })

    // ── 收費：年費、上月代辦費與規費、代墊、分期 ──
    const billingMonth = Number(day(0).slice(5, 7))
    db.prepare('INSERT INTO customer_billing(customer_id,tenant_id,annual_amount,currency,bill_month,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(li, tenant, 2400000, 'HKD', billingMonth, 1, admin.id, at)
    const fee = (customer, kind, currency, amount, description, incurred, due, extra = {}) => { const feeId = id(); db.prepare('INSERT INTO fee_items(id,tenant_id,customer_id,kind,request_id,description,currency,amount,incurred_on,due_on,installment_plan_id,installment_seq,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(feeId, tenant, customer, kind, extra.request || null, description, currency, amount, incurred, due, extra.plan || null, extra.seq || null, admin.id, at, at); return feeId }
    const service = fee(li, 'service', 'HKD', 300000, '香港車輛牌照續期代辦費', `${month(-1)}-18`, `${month(-1)}-30`, { request: done })
    fee(li, 'gov_fee', 'HKD', 54000, '運輸署牌費', `${month(-1)}-18`, `${month(-1)}-30`, { request: done })
    fee(li, 'advance', 'HKD', 38000, '代墊第三者保險', `${month(-1)}-12`, day(5))
    fee(li, 'gov_fee', 'RMB', 12000, '內地批文延期規費', day(-3), day(12))
    db.prepare("INSERT INTO fee_payments(id,fee_item_id,paid_on,amount,method,recorded_by,created_at) VALUES (?,?,?,?,'轉數快',?,?)").run(id(), service, `${month(-1)}-22`, 300000, admin.id, at)
    const plan = id()
    db.prepare('INSERT INTO installment_plans(id,tenant_id,customer_id,name,currency,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(plan, tenant, li, '新辦粵港兩地牌', 'HKD', admin.id, at)
    for (const [seq, name, amount, due] of [[1, '定金', 2000000, day(3)], [2, '稅款', 4500000, day(40)], [3, '尾數', 1500000, day(90)]]) fee(li, 'service', 'HKD', amount, `新辦粵港兩地牌：${name}`, day(0), due, { plan, seq })

    // ── 出租：本公司自有牌照直付、陳先生牌照由我們代收 ──
    const contract = (plate, renter, phone, amount, mode, fee) => {
      const contractId = id()
      db.prepare("INSERT INTO rental_contracts(id,tenant_id,plate_asset_id,renter_name,renter_phone,renter_vehicle_plate,starts_on,rent_amount,currency,cycle,due_day,collection_mode,fee_type,fee_value,status,prev_usage_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'HKD','monthly',5,?,?,?,'生效','閒置',?,?)")
        .run(contractId, tenant, plate.plate, renter, phone, `XY ${8000 + amount / 10000}`, `${month(-3)}-01`, amount, mode, fee ? 'percent' : 'none', fee || 0, at, at)
      db.prepare("UPDATE plate_assets SET usage_status='出租中' WHERE id=?").run(plate.plate)
      refreshContract(db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contractId))
      for (const invoice of db.prepare('SELECT i.*, c.collection_mode FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id WHERE i.contract_id=? AND i.period<? ORDER BY i.period').all(contractId, month(0)))
        receiveInvoice(tenant, invoice, { receivedOn: `${invoice.period}-06`, receivedAmount: invoice.amount }, admin.id)
    }
    contract(plates[10], '林先生', '+852 6111 2222', 850000, '直付', 0)
    if (chen) contract(plates[8], '承租人甲（示範）', '+852 6333 4444', 900000, '代收', 10)

    // ── 報帳：前兩個月已申報（一間零申報），上月有一間還在會計處理中 ──
    ensureFilings(tenant)
    const filings = db.prepare('SELECT * FROM filing_periods WHERE tenant_id=? ORDER BY period, company_id').all(tenant)
    filings.filter(row => row.period === month(-2)).forEach((row, index) => db.prepare('UPDATE filing_periods SET docs_received_on=?, sent_to_firm_on=?, filed_on=?, paid_on=?, tax_amount=?, zero_filing=?, updated_at=? WHERE id=?').run(`${month(-1)}-03`, `${month(-1)}-05`, `${month(-1)}-12`, index === 0 ? null : `${month(-1)}-13`, index === 0 ? 0 : 35600 + index * 1000, index === 0 ? 1 : 0, at, row.id))
    filings.filter(row => row.period === month(-1)).forEach((row, index) => db.prepare('UPDATE filing_periods SET docs_received_on=?, sent_to_firm_on=?, filed_on=?, updated_at=? WHERE id=?').run(`${month(0)}-03`, `${month(0)}-05`, index < 2 ? `${month(0)}-12` : null, at, row.id))
    db.prepare('INSERT INTO schema_migrations(name,applied_at) VALUES (?,?)').run(MIGRATION, at)
    db.exec('COMMIT')
    return true
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
