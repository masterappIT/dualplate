// Default expiry rules per tenant, based on the official review of 2026-10-16 (docs/requirements.md §1.2).
// Tenants can edit names, conditions, parameters and reminder days afterwards.
export const ruleScopes = ['plate', 'company', 'vehicle', 'driver']
// Which entrusted service each rule belongs to (docs/tasks/entrustment-brief.md §2). Custom rules default by scope.
export const defaultService = scope => scope === 'company' ? 'company_upkeep' : 'plate_service'
export const ruleMethods = ['expiry', 'anniversary', 'yearly', 'inspection', 'periodic', 'since_last', 'after_field']
// Date facts that since_last / after_field rules may count from.
export const dateFields = { since_last: ['lastCrossedOn'], after_field: ['cardValidFrom'] }
export const matchKeys = ['route', 'jurisdiction', 'indicatorCategory', 'port', 'origin', 'companyStatus', 'crossingReminder']

export const defaultRules = [
  { code: 'approval', name: '批文／指標有效期', scope: 'plate', method: 'expiry', match: {}, params: { field: 'cardExpiresOn' }, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'hk_crp', name: '香港封閉道路通行許可證（CRP）', scope: 'plate', method: 'expiry', match: { route: '粵港' }, params: {}, remindDays: 120, service: 'plate_service', customerVisible: true },
  { code: 'mo_permit', name: '澳門車輛邊境通行證', scope: 'plate', method: 'expiry', match: { route: '粵澳' }, params: {}, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'hk_licence', name: '香港車輛牌照', scope: 'vehicle', method: 'expiry', match: { origin: '香港' }, params: {}, remindDays: 30, service: 'plate_service', customerVisible: true },
  { code: 'local_insurance', name: '港澳車輛保險', scope: 'vehicle', method: 'expiry', match: {}, params: {}, remindDays: 30, service: 'plate_service', customerVisible: true },
  { code: 'cn_ctpl', name: '內地交強險', scope: 'vehicle', method: 'expiry', match: {}, params: {}, remindDays: 30, service: 'plate_service', customerVisible: true },
  { code: 'inspection', name: '內地驗車／檢驗標誌', scope: 'vehicle', method: 'inspection', match: {}, params: { markYears: [2, 4, 8], inspectYears: [6], yearlyFrom: 10 }, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'hk_nar1', name: '香港周年申報表 NAR1', scope: 'company', method: 'anniversary', match: { jurisdiction: '香港' }, params: { offsetDays: 42 }, remindDays: 30, service: 'company_upkeep', customerVisible: true },
  { code: 'hk_br', name: '香港商業登記證', scope: 'company', method: 'expiry', match: { jurisdiction: '香港' }, params: {}, remindDays: 30, service: 'company_upkeep', customerVisible: true },
  { code: 'mo_tax', name: '澳門營業稅／所得補充稅申報', scope: 'company', method: 'expiry', match: { jurisdiction: '澳門' }, params: {}, remindDays: 30, service: 'bookkeeping', customerVisible: true },
  { code: 'cn_annual_report', name: '內地工商年報', scope: 'company', method: 'yearly', match: { jurisdiction: '內地' }, params: { month: 6, day: 30 }, remindDays: 60, service: 'company_upkeep', customerVisible: true },
  { code: 'cn_cit_annual', name: '內地企業所得稅匯算清繳', scope: 'company', method: 'yearly', match: { jurisdiction: '內地' }, params: { month: 5, day: 31 }, remindDays: 45, service: 'bookkeeping', customerVisible: true },
  { code: 'customs_filing', name: '海關及邊檢備案', scope: 'plate', method: 'expiry', match: {}, params: {}, remindDays: 30, service: 'plate_service', customerVisible: true },
  { code: 'new_card_filing', name: '新批文備案期限', scope: 'plate', method: 'after_field', match: {}, params: { field: 'cardValidFrom', days: 183 }, remindDays: 30, service: 'plate_service', customerVisible: true },
  { code: 'crossing_90', name: '90 天過關', scope: 'plate', method: 'since_last', match: { crossingReminder: 1 }, params: { field: 'lastCrossedOn', days: 90 }, remindDays: 15, service: 'plate_service', customerVisible: true },
  { code: 'hk_registered_office', name: '香港公司註冊地址／秘書服務合約', scope: 'company', method: 'expiry', match: { jurisdiction: '香港' }, params: {}, remindDays: 30, service: 'secretary', customerVisible: true },
  { code: 'cn_registered_address', name: '內地公司註冊地址（掛靠）合約', scope: 'company', method: 'expiry', match: { jurisdiction: '內地' }, params: {}, remindDays: 30, service: 'company_upkeep', customerVisible: true },
  { code: 'hk_audit_tax', name: '香港公司審計及利得稅報稅', scope: 'company', method: 'expiry', match: { jurisdiction: '香港' }, params: {}, remindDays: 60, service: 'audit_tax', customerVisible: true },
  // 司機證件（docs/tasks/drivers-brief.md）：手動填寫到期日，委託範圍跟隨主司機所在牌照
  { code: 'home_return_permit', name: '回鄉證', scope: 'driver', method: 'expiry', match: {}, params: {}, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'hk_driving_licence', name: '香港駕駛執照', scope: 'driver', method: 'expiry', match: {}, params: {}, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'cn_driving_licence', name: '內地駕駛證', scope: 'driver', method: 'expiry', match: {}, params: {}, remindDays: 60, service: 'plate_service', customerVisible: true },
  { code: 'cn_status_check', name: '核對內地公司登記狀態', scope: 'company', method: 'periodic', match: { jurisdiction: '內地', companyStatus: ['存續', '經營異常', '註銷中'] }, params: { months: [1, 4, 7, 10], officialUrl: 'https://www.gsxt.gov.cn/' }, remindDays: 30, service: 'company_upkeep', customerVisible: false }
]

const DAY = 86400000
// "Today" in the business time zone (Hong Kong by default), as a UTC-midnight date. Using the server's UTC date
// made a client's 「今天已過關」 fail before 8 a.m. and shifted every days-left count by one.
export function businessToday(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TZ || 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return new Date(day + 'T00:00:00Z')
}
const iso = date => date.toISOString().slice(0, 10)
const parse = value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null; const date = new Date(value + 'T00:00:00Z'); return Number.isFinite(date.getTime()) && iso(date) === value ? date : null }
const addDays = (date, days) => new Date(date.getTime() + days * DAY)
// Feb 29 anniversaries fall back to Feb 28 in non-leap years.
const onYear = (date, year) => { const d = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate())); return d.getUTCMonth() === date.getUTCMonth() ? d : new Date(Date.UTC(year, date.getUTCMonth() + 1, 0)) }

export function ruleMatches(rule, facts) {
  return Object.entries(rule.match || {}).every(([key, expected]) => {
    if (expected === '' || expected == null) return true
    const allowed = Array.isArray(expected) ? expected : [expected]
    return allowed.includes(facts[key])
  })
}

// Occurrences of a computed rule as [{ period, dueOn, label }], covering last year to two years ahead.
function occurrences(rule, facts, today) {
  const year = today.getUTCFullYear()
  const years = [year - 1, year, year + 1, year + 2]
  if (rule.method === 'yearly') {
    const { month, day } = rule.params || {}
    if (!month || !day) return null
    return years.map(y => ({ period: String(y), dueOn: onYear(new Date(Date.UTC(2024, month - 1, day)), y) }))
  }
  if (rule.method === 'anniversary') {
    const base = parse(facts.incorporatedOn)
    if (!base) return null
    const offset = Number(rule.params?.offsetDays) || 0
    return years.filter(y => y > base.getUTCFullYear()).map(y => ({ period: String(y), dueOn: addDays(onYear(base, y), offset) }))
  }
  if (rule.method === 'inspection') {
    const base = parse(facts.firstRegisteredOn)
    if (!base) return null
    const { markYears = [], inspectYears = [], yearlyFrom = 10 } = rule.params || {}
    return years.flatMap(y => {
      const age = y - base.getUTCFullYear()
      if (age <= 0) return []
      const label = age >= yearlyFrom || inspectYears.includes(age) ? '上線檢驗' : markYears.includes(age) ? '免檢領取檢驗標誌' : null
      return label ? [{ period: String(y), dueOn: onYear(base, y), label: `第 ${age} 年${label}` }] : []
    })
  }
  if (rule.method === 'periodic') {
    const months = rule.params?.months
    if (!Array.isArray(months) || !months.length || months.some(month => !Number.isInteger(month) || month < 1 || month > 12)) return null
    return years.flatMap(y => months.map(month => ({
      period: `${y}-${String(month).padStart(2, '0')}`,
      dueOn: new Date(Date.UTC(y, month - 1, 1))
    })))
  }
  return null
}

function level(daysLeft, remindDays, windowDays) {
  if (daysLeft < 0) return 'overdue'
  if (daysLeft <= remindDays) return 'due'
  if (daysLeft <= windowDays) return 'upcoming'
  return 'ok'
}

// owners: [{ ownerType, ownerId, label, customerId, customerName, facts }]
// tracked: Map key `${ownerType}:${ownerId}:${code}` → { expires_on, notes }
// completions: Set of `${code}:${ownerId}:${period}`
// scopes (optional): Map `${type}:${id}:${service}` → current service_scopes row; missing means 'us'.
export function computeDeadlines({ rules, owners, tracked, completions, scopes = null, today = businessToday(), windowDays = 90 }) {
  const day = parse(iso(today))
  const result = []
  for (const owner of owners) {
    if (owner.ownerType === 'company' && owner.facts.status === '已註銷') continue
    for (const rule of rules) {
      if (!rule.active || rule.scope !== owner.ownerType || !ruleMatches(rule, owner.facts)) continue
      const service = rule.service || defaultService(rule.scope)
      const scopeOwner = owner.scopeOwner || { type: owner.ownerType, id: owner.ownerId }
      const scope = scopes?.get(`${scopeOwner.type}:${scopeOwner.id}:${service}`)
      const handling = { service, handler: scope?.handler || 'us', providerName: scope?.provider_name || '' }
      const base = { ...handling, ruleId: rule.id, ruleCode: rule.code, name: rule.name, method: rule.method, ownerType: owner.ownerType, ownerId: owner.ownerId, ownerLabel: owner.label, customerId: owner.customerId, customerName: owner.customerName, remindDays: rule.remindDays, ...(rule.params?.officialUrl ? { officialUrl: rule.params.officialUrl } : {}) }
      if (rule.method === 'expiry') {
        const item = tracked.get(`${owner.ownerType}:${owner.ownerId}:${rule.code}`)
        const due = parse(rule.params?.field ? owner.facts[rule.params.field] : item?.expires_on)
        if (!due) { result.push({ ...base, level: 'missing', dueOn: null, daysLeft: null, detail: '未錄入到期日' }); continue }
        const daysLeft = Math.round((due - day) / DAY)
        result.push({ ...base, dueOn: iso(due), daysLeft, level: level(daysLeft, rule.remindDays, windowDays), detail: item?.notes || '' })
        continue
      }
      if (rule.method === 'since_last') {
        // Counts from the latest event (e.g. last border crossing); recording a new event resets it.
        const last = parse(owner.facts[rule.params?.field])
        if (!last) { result.push({ ...base, level: 'missing', dueOn: null, daysLeft: null, detail: rule.params?.field === 'lastCrossedOn' ? '待錄入最近過關日期' : '待錄入日期' }); continue }
        const due = addDays(last, Number(rule.params?.days) || 0), daysLeft = Math.round((due - day) / DAY)
        result.push({ ...base, dueOn: iso(due), daysLeft, level: level(daysLeft, rule.remindDays, windowDays), detail: `上次 ${iso(last)}` })
        continue
      }
      if (rule.method === 'after_field') {
        // A one-off deadline after a date (e.g. filing within 183 days of a new approval). No date, or long past and never
        // marked, means it does not apply, so old cards do not flood the queue as overdue.
        const base0 = parse(owner.facts[rule.params?.field])
        if (!base0) continue
        const period = iso(base0)
        if (completions.has(`${rule.code}:${owner.ownerId}:${period}`)) continue
        const due = addDays(base0, Number(rule.params?.days) || 0)
        if (due < addDays(day, -Math.max(rule.remindDays, 30))) continue
        const daysLeft = Math.round((due - day) / DAY)
        result.push({ ...base, dueOn: iso(due), daysLeft, period, completable: true, level: level(daysLeft, rule.remindDays, windowDays), detail: `批文有效期開始 ${period}` })
        continue
      }
      const list = occurrences(rule, owner.facts, day)
      if (!list) { result.push({ ...base, level: 'missing', dueOn: null, daysLeft: null, detail: rule.method === 'inspection' ? '未錄入港澳首次註冊日期' : rule.method === 'anniversary' ? '未錄入公司成立日期' : '規則參數不完整' }); continue }
      // Last year's occurrence counts only while it is within its reminder window of today, so new records do not start overdue.
      const open = list.filter(o => !completions.has(`${rule.code}:${owner.ownerId}:${o.period}`))
        .filter(o => o.dueOn >= addDays(day, -Math.max(rule.remindDays, 30)))
        .sort((a, b) => a.dueOn - b.dueOn)[0]
      if (!open) continue
      const daysLeft = Math.round((open.dueOn - day) / DAY)
      result.push({ ...base, dueOn: iso(open.dueOn), daysLeft, period: open.period, completable: true, level: level(daysLeft, rule.remindDays, windowDays), detail: open.label || `${open.period} 年度` })
    }
  }
  const order = { overdue: 0, due: 1, missing: 2, upcoming: 3, ok: 4 }
  return result.sort((a, b) => order[a.level] - order[b.level] || String(a.dueOn || '9999').localeCompare(String(b.dueOn || '9999')))
}
