import { randomUUID } from 'node:crypto'
import { db } from './db.js'

// Border crossings recorded by staff or by the client. Same-day repeats return the existing record.
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const today = () => new Date().toISOString().slice(0, 10)
const rule = tenantId => db.prepare("SELECT params_json FROM rules WHERE tenant_id=? AND code='crossing_90'").get(tenantId)

export function crossingSummary(tenantId, plateId) {
  const list = db.prepare('SELECT id,crossed_on crossedOn,source,created_at createdAt FROM plate_crossings WHERE tenant_id=? AND plate_asset_id=? ORDER BY crossed_on DESC LIMIT 10').all(tenantId, plateId)
  const days = Number(JSON.parse(rule(tenantId)?.params_json || '{}').days) || 90
  const last = list[0]?.crossedOn || null
  const next = last ? new Date(Date.parse(last + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) : null
  return { lastCrossedOn: last, nextDueOn: next, days, crossings: list }
}

export function addCrossing({ tenantId, plateId, crossedOn, source, userId }) {
  if (!validDate(crossedOn)) return { status: 400, error: '過關日期無效，請用 YYYY-MM-DD' }
  if (crossedOn > today()) return { status: 400, error: '過關日期不可晚於今天' }
  if (crossedOn < '2000-01-01') return { status: 400, error: '過關日期太早' }
  const existing = db.prepare('SELECT id FROM plate_crossings WHERE plate_asset_id=? AND crossed_on=?').get(plateId, crossedOn)
  if (!existing) db.prepare('INSERT INTO plate_crossings(id,tenant_id,plate_asset_id,crossed_on,source,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), tenantId, plateId, crossedOn, source, userId, new Date().toISOString())
  return { status: existing ? 200 : 201, body: crossingSummary(tenantId, plateId) }
}

// Staff may remove their own entries at any time, and client entries only within 7 days of being recorded.
export function deleteCrossing({ tenantId, plateId, crossingId }) {
  const item = db.prepare('SELECT * FROM plate_crossings WHERE id=? AND tenant_id=? AND plate_asset_id=?').get(crossingId, tenantId, plateId)
  if (!item) return { status: 404, error: '過關記錄不存在' }
  if (item.source !== 'admin' && Date.now() - Date.parse(item.created_at) > 7 * 86400000) return { status: 409, error: '客戶錄入超過 7 天的記錄不可刪除' }
  db.prepare('DELETE FROM plate_crossings WHERE id=?').run(item.id)
  return { status: 200, body: crossingSummary(tenantId, plateId) }
}
