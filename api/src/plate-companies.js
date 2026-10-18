import { db, id, now } from './db.js'
import { mainlandName, toSimplified, traditionalChars } from './hans.js'
import { loadOwner, ownerItems, writeScope } from './entrustment.js'
import { logCompanyCreated } from './client-edits.js'

// 客戶建檔批文卡時自動連到公司（管理者 2026-10-17）：批文卡「商號」是香港／澳門持牌公司，「內承單位」是內地公司。
// 客戶名下已有同名公司就連到那間公司的公司組（一間公司持有兩個指標時不會重複建立）；沒有才只用名稱建立，
// 其餘公司資料之後在客戶端「我的公司」補上。建檔時不要求客戶填寫公司資料。

const clean = (value, max = 160) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
// 比對用：繁簡、全形半形、括號、空格、大小寫都不影響
export const nameKey = text => toSimplified(clean(text)).normalize('NFKC').replace(/[\s·・.,，。]/g, '').toLowerCase()
const foreignOf = route => route === '粵澳' ? '澳門' : '香港'

function customerCompanies(tenantId, customerId) {
  return db.prepare('SELECT * FROM companies WHERE tenant_id=? AND customer_id=?').all(tenantId, customerId)
}
const groupName = (tenantId, groupId) => db.prepare('SELECT name FROM company_groups WHERE id=? AND tenant_id=?').get(groupId, tenantId)?.name || ''
const groupsOf = (tenantId, customerId) => db.prepare('SELECT id,name FROM company_groups WHERE tenant_id=? AND customer_id=? ORDER BY created_at').all(tenantId, customerId)

// 按批文卡的名稱找出會連到哪個公司組、哪些公司要新建
export function matchCompanies({ tenantId, customerId, route, company, contractor }) {
  const all = customerCompanies(tenantId, customerId)
  const wanted = [[clean(company), foreignOf(route)], [toSimplified(clean(contractor)), '內地']].filter(([name]) => name)
  const found = wanted.map(([name, jurisdiction]) => ({ name, jurisdiction, existing: all.find(item => item.jurisdiction === jurisdiction && nameKey(item.name) === nameKey(name)) || null }))
  const groupId = found.find(item => item.existing?.group_id)?.existing.group_id || null
  return { groupId, groupName: groupId ? groupName(tenantId, groupId) : '', companies: found }
}

// 客戶加的公司未必已委託我們（管理者 2026-10-17）：所有委託項目先設為客戶自理——到期照樣提醒客戶、不產生員工工作，
// 等員工在「客戶更新待核對」設定委託範圍後才開始（報帳只從接手日起生成，見 bookkeeping.js）。
// 不寫備註：員工改負責方時表單會帶出舊備註，來源已記錄在客戶更新待核對
function startAsClientHandled(tenantId, companyId, userId) {
  const owner = loadOwner(tenantId, 'company', companyId)
  if (!owner || owner.is_self) return
  for (const item of ownerItems(tenantId, 'company', owner)) writeScope({ tenantId, ownerType: 'company', ownerId: companyId, item: item.code, handler: 'client', notes: '', userId })
}

// 建檔後把牌照連到公司組。explicitGroupId：客戶在建檔頁自己選的公司組，只連過去、不按名稱新建公司
export function linkPlateCompanies({ tenantId, plate, card, explicitGroupId, userId }) {
  if (explicitGroupId) {
    db.prepare('UPDATE plate_assets SET group_id=?,updated_at=? WHERE id=?').run(explicitGroupId, now(), plate.id)
    return { groupId: explicitGroupId, created: [] }
  }
  const match = matchCompanies({ tenantId, customerId: plate.customer_id, route: plate.route, company: card.company, contractor: card.contractor })
  if (!match.companies.length) return { groupId: null, created: [] }
  let groupId = match.groupId
  if (!groupId) {
    groupId = id()
    db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,notes,created_at) VALUES (?,?,?,?,?,?)').run(groupId, tenantId, plate.customer_id, match.companies.map(item => item.existing?.name || item.name).join(' · '), '客戶建檔批文卡時建立', now())
  }
  const created = []
  for (const item of match.companies) {
    if (!item.existing) {
      const companyId = id()
      db.prepare("INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,name_en,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,'',?,?,?)").run(companyId, tenantId, plate.customer_id, groupId, item.jurisdiction, item.name, '由批文卡建立，其他資料待補', now(), now())
      startAsClientHandled(tenantId, companyId, userId)
      created.push({ id: companyId, name: item.name, jurisdiction: item.jurisdiction })
    } else if (!item.existing.group_id) {
      // 未分組的同名公司直接放進這個公司組；已屬其他公司組的不搬動
      db.prepare('UPDATE companies SET group_id=?,updated_at=? WHERE id=? AND group_id IS NULL').run(groupId, now(), item.existing.id)
    }
  }
  db.prepare('UPDATE plate_assets SET group_id=?,updated_at=? WHERE id=?').run(groupId, now(), plate.id)
  return { groupId, created }
}

const insertCompany = (tenantId, customerId, groupId, jurisdiction, name, notes) => {
  const companyId = id()
  db.prepare("INSERT INTO companies(id,tenant_id,customer_id,group_id,jurisdiction,name,name_en,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,'',?,?,?)").run(companyId, tenantId, customerId, groupId, jurisdiction, name, notes, now(), now())
  return companyId
}

// 客戶修改批文卡的商號或內承單位（docs/tasks/self-managed-fixes-plan.md 第 4 步）：像建檔一樣連上公司。
// 牌照還沒有公司組（例如托管轉自管、建檔時沒填商號）：照建檔做法。已有公司組：只補上組內還沒有的香港／澳門或內地公司，
// 不搬動牌照、不改已有公司——改名屬「商號變更」或在「我的公司」修改公司名稱。在呼叫者的交易內
export function linkEditedCard({ tenantId, plate, before, card, userId }) {
  if (clean(before.company) === clean(card.company) && clean(before.contractor) === clean(card.contractor)) return { groupId: plate.group_id, created: [] }
  if (!plate.group_id) return linkPlateCompanies({ tenantId, plate, card, userId })
  const members = db.prepare('SELECT * FROM companies WHERE tenant_id=? AND group_id=?').all(tenantId, plate.group_id)
  const all = customerCompanies(tenantId, plate.customer_id), created = []
  for (const [name, jurisdiction] of [[clean(card.company), foreignOf(plate.route)], [toSimplified(clean(card.contractor)), '內地']]) {
    if (!name || members.some(item => item.jurisdiction === jurisdiction)) continue
    const existing = all.find(item => item.jurisdiction === jurisdiction && nameKey(item.name) === nameKey(name))
    if (existing) {
      if (!existing.group_id) db.prepare('UPDATE companies SET group_id=?,updated_at=? WHERE id=?').run(plate.group_id, now(), existing.id)
      continue
    }
    const companyId = insertCompany(tenantId, plate.customer_id, plate.group_id, jurisdiction, name, '由批文卡建立，其他資料待補')
    startAsClientHandled(tenantId, companyId, userId)
    created.push({ id: companyId, name, jurisdiction })
  }
  return { groupId: plate.group_id, created }
}

// 公司資料缺了哪些欄（客戶端牌照頁的「請補公司資料」提示）
export function companyGaps(tenantId, groupId) {
  if (!groupId) return []
  return db.prepare("SELECT * FROM companies WHERE tenant_id=? AND group_id=? AND COALESCE(status,'存續')<>'已註銷' ORDER BY jurisdiction").all(tenantId, groupId).map(company => {
    const missing = []
    if (company.jurisdiction === '香港' && !company.name_en) missing.push('英文名稱')
    if (!company.registration_no) missing.push(company.jurisdiction === '內地' ? '統一社會信用代碼' : company.jurisdiction === '澳門' ? '商業登記編號' : '商業登記號碼')
    if (!company.incorporated_on) missing.push('成立日期')
    return { id: company.id, name: company.name, jurisdiction: company.jurisdiction, missing }
  }).filter(company => company.missing.length)
}

// 客戶端建檔頁：預先告訴客戶這張批文卡會連到哪裏，並列出可改選的公司組
export async function plateCompanyRoutes(req, res, url, user, { json, fail, parseBody }) {
  if (url.pathname === '/api/my/companies' && req.method === 'POST') { await addCompany(req, res, user, { json, fail, parseBody }); return true }
  if (url.pathname !== '/api/my/plate-companies') return false
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
  const route = url.searchParams.get('route') || '粵港'
  if (!['粵港', '粵澳'].includes(route)) return fail(res, 400, '路線無效'), true
  const match = matchCompanies({ tenantId: user.tenant_id, customerId: user.customer_id, route, company: url.searchParams.get('company'), contractor: url.searchParams.get('contractor') })
  return json(res, 200, { ...match, companies: match.companies.map(item => ({ name: item.existing?.name || item.name, jurisdiction: item.jurisdiction, existing: !!item.existing })), groups: groupsOf(user.tenant_id, user.customer_id) }), true
}

// 客戶在「我的公司」新增公司（docs/tasks/self-managed-fixes-plan.md 第 4 步）：選香港／澳門／內地、填名稱，選填屬於哪個牌照；
// 其他資料之後在「修改公司資料」補上。和批文卡建立的公司一樣先設為客戶自理；托管客戶新增的列入「客戶更新待核對」
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
async function addCompany(req, res, user, { json, fail, parseBody }) {
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用')
  const tenantId = user.tenant_id, customerId = user.customer_id
  if (!db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(customerId, tenantId)) return fail(res, 404, '客戶不存在')
  const body = await parseBody(req)
  if (!isObject(body) || Object.keys(body).some(key => !['jurisdiction', 'name', 'plateId'].includes(key))) return fail(res, 400, '內容無效')
  if (!['香港', '澳門', '內地'].includes(body.jurisdiction)) return fail(res, 400, '請選擇香港、澳門或內地公司')
  if (typeof body.name !== 'string') return fail(res, 400, '請填寫公司名稱')
  const mainland = body.jurisdiction === '內地', name = mainland ? clean(mainlandName(body.name)) : clean(body.name)
  if (!name) return fail(res, 400, '請填寫公司名稱')
  if (mainland) { const traditional = traditionalChars(name); if (traditional.length) return json(res, 400, { error: `內地公司名稱須用簡體字（${traditional.map(item => `${item.from}→${item.to}`).join('、')}），建議：${toSimplified(name)}`, suggestion: toSimplified(name) }) }
  if (body.plateId !== undefined && body.plateId !== null && typeof body.plateId !== 'string') return fail(res, 400, '牌照無效')
  const plate = body.plateId ? db.prepare('SELECT * FROM plate_assets WHERE id=? AND customer_id=?').get(body.plateId, customerId) : null
  if (body.plateId && !plate) return fail(res, 404, '牌照不存在')
  if (customerCompanies(tenantId, customerId).some(item => item.jurisdiction === body.jurisdiction && nameKey(item.name) === nameKey(name))) return fail(res, 409, '名下已有這間公司')
  if (plate && body.jurisdiction !== '內地' && body.jurisdiction !== foreignOf(plate.route)) return fail(res, 400, `${plate.route}牌照的持牌公司是${foreignOf(plate.route)}公司`)
  if (plate?.group_id && db.prepare('SELECT 1 FROM companies WHERE group_id=? AND jurisdiction=? LIMIT 1').get(plate.group_id, body.jurisdiction)) return fail(res, 409, `這個牌照已有${body.jurisdiction}公司；要改名請在「修改公司資料」修改`)
  db.exec('BEGIN IMMEDIATE')
  try {
    let groupId = plate?.group_id || null
    if (plate && !groupId) {
      groupId = id()
      db.prepare('INSERT INTO company_groups(id,tenant_id,customer_id,name,notes,created_at) VALUES (?,?,?,?,?,?)').run(groupId, tenantId, customerId, name, '客戶在我的公司新增', now())
      db.prepare('UPDATE plate_assets SET group_id=?,updated_at=? WHERE id=?').run(groupId, now(), plate.id)
    }
    const companyId = insertCompany(tenantId, customerId, groupId, body.jurisdiction, name, '客戶在我的公司新增，其他資料待補')
    startAsClientHandled(tenantId, companyId, user.id)
    logCompanyCreated({ tenantId, user, customerId, company: { id: companyId, name, jurisdiction: body.jurisdiction } })
    db.exec('COMMIT')
    return json(res, 201, { id: companyId, name, jurisdiction: body.jurisdiction, groupId })
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
