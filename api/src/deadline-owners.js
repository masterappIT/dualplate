import { db } from './db.js'
import { plateFacts, vehicleFacts } from './plate-facts.js'
import { driverOwners } from './drivers.js'
import { endedCustomerIds } from './customer-lifecycle.js'

export function deadlineOwners(tenantId) {
  const query = (sql, ...params) => db.prepare(sql).all(...params)
  const customers = query('SELECT id,name FROM customers WHERE tenant_id=? ORDER BY name', tenantId)
  const plates = query('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE c.tenant_id=?', tenantId)
  const companies = query('SELECT * FROM companies WHERE tenant_id=?', tenantId)
  const vehicles = query('SELECT v.* FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE c.tenant_id=?', tenantId)
  const names = new Map(customers.map(item => [item.id, item.name]))
  const owners = [
    ...plates.map(item => ({ ownerType: 'plate', ownerId: item.id, label: `${item.mainland_plate || '內地車牌待補'} · ${item.local_plate || '港澳車牌待補'}`, customerId: item.customer_id, customerName: names.get(item.customer_id), facts: plateFacts(item) })),
    ...companies.map(item => ({ ownerType: 'company', ownerId: item.id, label: item.name, customerId: item.customer_id, customerName: names.get(item.customer_id), facts: { jurisdiction: item.jurisdiction, status: item.status || '存續', companyStatus: item.status || '存續', incorporatedOn: item.incorporated_on } })),
    ...vehicles.map(item => ({ ownerType: 'vehicle', ownerId: item.id, label: item.plate, customerId: item.customer_id, customerName: names.get(item.customer_id), facts: vehicleFacts(item), scopeOwner: plates.find(plate => plate.vehicle_id === item.id) ? { type: 'plate', id: plates.find(plate => plate.vehicle_id === item.id).id } : null })),
    ...driverOwners(tenantId),
  ]
  // 已結束服務的客戶不再有到期提醒（docs/tasks/customer-lifecycle-plan.md 第 3 步）
  const ended = endedCustomerIds(tenantId)
  return { customers, plates, companies, vehicles, owners: ended.size ? owners.filter(owner => !ended.has(owner.customerId)) : owners }
}
