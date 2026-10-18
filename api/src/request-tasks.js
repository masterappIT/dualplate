import { db, id, now } from './db.js'
import { planFor } from './catalog.js'

// 開工單共用（原在 server.js）：記錄動態、按服務路線加辦理節點
export function pushActivity(requestId, actorId, kind, detail) { db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), requestId, actorId, kind, detail, now()) }
export function addTasks(requestId, service, route) {
  const plan = planFor(service, route)
  for (const stage of plan.stages) {
    const jurisdiction = /廣東|內地/.test(stage) ? '內地' : /香港/.test(stage) ? '香港' : /澳門/.test(stage) ? '澳門' : '通用'
    const sourceId = /香港/.test(stage) ? plan.sourceIds.find(x => x.startsWith('HK-')) : /澳門/.test(stage) ? plan.sourceIds.find(x => x.startsWith('MO-')) : /廣東|內地/.test(stage) ? plan.sourceIds.find(x => x.startsWith('GD-')) : null
    db.prepare('INSERT INTO tasks(id,request_id,title,jurisdiction,status,source_id,due_on,notes,sort) VALUES (?,?,?,?,?,?,?,?,?)').run(id(), requestId, stage, jurisdiction, '待辦', sourceId || null, null, null, db.prepare('SELECT COUNT(*) count FROM tasks WHERE request_id=?').get(requestId).count)
  }
}

// 客戶提交的代辦要求（與 POST /api/requests 客戶開單一致：新要求、待內部受理）
export function createClientRequest({ customerId, service, route, title, description = '', plateAssetId = null, vehicleId = null, actorId, activity = '客戶提交代辦要求' }) {
  const requestId = id()
  db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,service_code,route,title,description,status,stage,assignee_id,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, customerId, vehicleId, service.code, route, String(title).slice(0, 160), String(description).slice(0, 4000), '新要求', '待內部受理', null, now(), now(), plateAssetId)
  pushActivity(requestId, actorId, 'created', activity)
  addTasks(requestId, service, route)
  return requestId
}
