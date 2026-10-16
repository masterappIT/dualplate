import { db } from './db.js'
import { computeDeadlines, businessToday } from './rules.js'
import { deadlineOwners } from './deadline-owners.js'
import { scopeMap } from './entrustment.js'

export function viewRoutes(req, res, url, user, { json, fail }) {
  if (url.pathname !== '/api/views/weekly-progress') return false
  if (req.method !== 'GET') { fail(res, 405, '不支援此操作'); return true }
  if (!['admin', 'staff'].includes(user.role)) { fail(res, 403, '無權限'); return true }
  const tenant = user.tenant_id
  const query = (sql, ...params) => db.prepare(sql).all(...params)
  const { owners } = deadlineOwners(tenant)
  const rules = query('SELECT * FROM rules WHERE tenant_id=?', tenant).map(row => ({ ...row, match: JSON.parse(row.match_json), params: JSON.parse(row.params_json), remindDays: row.remind_days }))
  const tracked = new Map(query('SELECT * FROM tracked_items WHERE tenant_id=?', tenant).map(item => [`${item.owner_type}:${item.owner_id}:${item.code}`, item]))
  const completions = new Set(query('SELECT code,owner_id,period FROM rule_completions WHERE tenant_id=?', tenant).map(item => `${item.code}:${item.owner_id}:${item.period}`))
  const today = businessToday()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  const rows = computeDeadlines({ rules, owners, tracked, completions: new Set(), scopes: scopeMap(tenant), windowDays: 365 })
    .filter(item => item.handler !== 'client' && item.dueOn && item.dueOn >= start.toISOString().slice(0, 10) && item.dueOn < end.toISOString().slice(0, 10))
  json(res, 200, { done: rows.filter(item => item.period && completions.has(`${item.ruleCode}:${item.ownerId}:${item.period}`)).length, total: rows.length })
  return true
}
