import { db } from './db.js'

// Facts a plate exposes to the expiry rules. Built in one place so the admin overview, plate table
// and client app always agree (e.g. on the last border crossing or the approval card's start date).
export function plateFacts(item) {
  let card = {}
  try { card = typeof item.card_data === 'string' ? JSON.parse(item.card_data || '{}') : item.card_data || {} } catch { card = {} }
  const last = db.prepare('SELECT MAX(crossed_on) last FROM plate_crossings WHERE plate_asset_id=?').get(item.id)?.last || null
  return { route: item.route, indicatorCategory: item.indicator_category, port: item.port, cardExpiresOn: item.card_expires_on, cardValidFrom: card.validFrom || null, lastCrossedOn: last, crossingReminder: item.crossing_reminder ? 1 : 0, stopped: item.stopped_on ? 1 : 0 }
}
// Facts a vehicle exposes to the rules. `retired`: replaced by a new car (客戶自行換車) — keeps its history, no more reminders.
export const vehicleFacts = item => ({ route: item.route, origin: item.origin, firstRegisteredOn: item.first_registered_on, retired: item.retired_on ? 1 : 0 })
