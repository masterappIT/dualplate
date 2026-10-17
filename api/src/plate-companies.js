import { db, id, now } from './db.js'
import { toSimplified } from './hans.js'

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

// 建檔後把牌照連到公司組。explicitGroupId：客戶在建檔頁自己選的公司組，只連過去、不按名稱新建公司
export function linkPlateCompanies({ tenantId, plate, card, explicitGroupId }) {
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
      created.push({ id: companyId, name: item.name, jurisdiction: item.jurisdiction })
    } else if (!item.existing.group_id) {
      // 未分組的同名公司直接放進這個公司組；已屬其他公司組的不搬動
      db.prepare('UPDATE companies SET group_id=?,updated_at=? WHERE id=? AND group_id IS NULL').run(groupId, now(), item.existing.id)
    }
  }
  db.prepare('UPDATE plate_assets SET group_id=?,updated_at=? WHERE id=?').run(groupId, now(), plate.id)
  return { groupId, created }
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
export async function plateCompanyRoutes(req, res, url, user, { json, fail }) {
  if (url.pathname !== '/api/my/plate-companies') return false
  if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
  if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
  const route = url.searchParams.get('route') || '粵港'
  if (!['粵港', '粵澳'].includes(route)) return fail(res, 400, '路線無效'), true
  const match = matchCompanies({ tenantId: user.tenant_id, customerId: user.customer_id, route, company: url.searchParams.get('company'), contractor: url.searchParams.get('contractor') })
  return json(res, 200, { ...match, companies: match.companies.map(item => ({ name: item.existing?.name || item.name, jurisdiction: item.jurisdiction, existing: !!item.existing })), groups: groupsOf(user.tenant_id, user.customer_id) }), true
}
