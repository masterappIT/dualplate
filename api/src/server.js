import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { db, id, now, hashPassword, verifyPassword } from './db.js'
import { services, sources, inspectionGuidance, planFor } from './catalog.js'
import { cardData, cleanCard, recognizeCard } from './card.js'
import { phase1Routes } from './phase1-routes.js'
import { customerRoutes } from './customer-routes.js'

const port = Number(process.env.PORT || 4100)
const allowedOrigins = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(','))
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
const fail = (res, status, message) => json(res, status, { error: message })
const parseBody = async req => { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000000) throw new Error('請求內容過大') } if (!raw) return {}; const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('請求內容格式錯誤'); return body }
const required = (body, keys) => keys.every(key => typeof body[key] === 'string' && body[key].trim())
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max)
const query = (sql, ...params) => db.prepare(sql).all(...params)
const validDate = value => { const text = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text + 'T00:00:00Z')) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text ? text : null }
const one = (sql, ...params) => db.prepare(sql).get(...params)

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (!token) return null
  return one('SELECT u.id,u.role,u.name,u.email,u.customer_id,u.tenant_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?', token, now())
}
// Every customer belongs to one tenant; admins see their tenant only, customers see themselves only.
function canAccessCustomer(user, customerId) {
  const customer = customerId && one('SELECT tenant_id FROM customers WHERE id=?', customerId)
  return !!customer && customer.tenant_id === user.tenant_id && (user.role === 'admin' || user.customer_id === customerId)
}
function requestFor(user, requestId) {
  const item = one('SELECT * FROM requests WHERE id=?', requestId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function vehicleFor(user, vehicleId) {
  const item = one('SELECT * FROM vehicles WHERE id=?', vehicleId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function plateFor(user, plateId) {
  const item = one('SELECT * FROM plate_assets WHERE id=?', plateId)
  return item && canAccessCustomer(user, item.customer_id) ? item : null
}
function plateDetail(user, plateId) {
  const item = plateFor(user, plateId)
  if (!item) return null
  const images = query('SELECT side,mime,data FROM approval_card_images WHERE plate_asset_id=?', item.id)
  const photos = query('SELECT kind,mime,data FROM plate_photos WHERE plate_asset_id=?', item.id)
  const imageValue = x => user.role === 'admin' ? `data:${x.mime};base64,${x.data.toString('base64')}` : true
  const companyStatuses = user.role === 'admin' && item.group_id ? query('SELECT c.id,c.jurisdiction,c.name,c.status,c.status_changed_on FROM companies c JOIN company_groups g ON g.id=c.group_id AND g.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.group_id=? AND g.customer_id=? ORDER BY c.jurisdiction,c.name', user.tenant_id, item.group_id, item.customer_id) : []
  const warnings = companyStatuses.filter(company => company.jurisdiction === '內地' && ['已註銷', '註銷中'].includes(company.status)).map(company => company.status === '已註銷' ? '內承單位已註銷' : '內承單位註銷中')
  return { ...item, cardData: cardData(item.card_data), rentals: query('SELECT * FROM plate_rentals WHERE plate_asset_id=? ORDER BY created_at DESC', item.id), cardImages: Object.fromEntries(images.map(x => [x.side, imageValue(x)])), platePhotos: Object.fromEntries(photos.map(x => [x.kind, imageValue(x)])), companyStatuses, warnings: [...new Set(warnings)] }
}
function pushActivity(requestId, actorId, kind, detail) { db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(id(), requestId, actorId, kind, detail, now()) }
function addTasks(requestId, service, route) {
  const plan = planFor(service, route)
  for (const stage of plan.stages) {
    const jurisdiction = /廣東|內地/.test(stage) ? '內地' : /香港/.test(stage) ? '香港' : /澳門/.test(stage) ? '澳門' : '通用'
    const sourceId = /香港/.test(stage) ? plan.sourceIds.find(x => x.startsWith('HK-')) : /澳門/.test(stage) ? plan.sourceIds.find(x => x.startsWith('MO-')) : /廣東|內地/.test(stage) ? plan.sourceIds.find(x => x.startsWith('GD-')) : null
    db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run(id(), requestId, stage, jurisdiction, '待辦', sourceId || null, null, null)
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.has(origin)) res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-allow-headers', 'authorization,content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  try {
    if (path === '/api/health') return json(res, 200, { ok: true })
    if (path === '/api/admin/login' && req.method === 'POST') {
      const body = await parseBody(req)
      const username = clean(body.username, 64).toLowerCase()
      const password = String(body.password || '')
      if (!username || !password) return fail(res, 400, '請輸入管理員帳號和密碼')
      const account = one("SELECT * FROM users WHERE role='admin' AND username=? COLLATE NOCASE", username)
      if (!account || !verifyPassword(password, account.password_hash)) return fail(res, 401, '帳號或密碼不正確')
      const token = randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 7 * 86400000).toISOString()
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, account.id, expires)
      return json(res, 200, { token, user: { id: account.id, name: account.name, username: account.username, role: account.role } })
    }
    if (path === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req)
      const account = one("SELECT * FROM users WHERE role='customer' AND email=?", clean(body.email, 160).toLowerCase())
      if (!account || !verifyPassword(String(body.password || ''), account.password_hash)) return fail(res, 401, '帳號或密碼不正確')
      const token = randomBytes(32).toString('hex')
      const expires = new Date(Date.now() + 7 * 86400000).toISOString()
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, account.id, expires)
      return json(res, 200, { token, user: { id: account.id, name: account.name, email: account.email, role: account.role, customerId: account.customer_id } })
    }
    const user = auth(req)
    if (!user) return fail(res, 401, '請先登入')
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customer_id })
    if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, { services, sources, routePlans: Object.fromEntries(services.map(s => [s.code, Object.fromEntries(s.routes.map(route => [route, planFor(s, route)]))])) })
    if (await phase1Routes(req, res, url, user, { json, fail, parseBody, canAccessCustomer, vehicleFor, plateFor, query, one, clean })) return
    if (await customerRoutes(req, res, url, user, { json, fail, query, one, plateFor })) return
    if (path === '/api/card-recognize' && req.method === 'POST') {
      const body = await parseBody(req)
      if (!['front','back'].includes(body.side)) return fail(res,400,'請選擇批文卡正面或背面')
      const matched=String(body.image||'').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
      if (!matched) return fail(res,400,'只接受 PNG、JPEG 或 WebP 圖片')
      const bytes=Buffer.from(matched[2],'base64')
      if (bytes.length>3500000) return fail(res,400,'圖片不可超過 3.5 MB')
      return json(res,200,{cardData:await recognizeCard(bytes,body.side)})
    }
    if (path === '/api/customers' && req.method === 'GET') {
      return json(res, 200, user.role === 'admin' ? query('SELECT * FROM customers WHERE tenant_id=? ORDER BY name', user.tenant_id) : query('SELECT * FROM customers WHERE id=?', user.customer_id))
    }
    if (path === '/api/plate-assets' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      const condition = "card_number IS NOT NULL AND TRIM(card_number)<>''"
      if (user.role === 'admin') return json(res, 200, customerId ? (canAccessCustomer(user, customerId) ? query('SELECT * FROM plate_assets WHERE customer_id=? ORDER BY created_at DESC', customerId) : []) : query('SELECT p.* FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE c.tenant_id=? ORDER BY p.created_at DESC', user.tenant_id))
      return json(res, 200, query(`SELECT * FROM plate_assets WHERE customer_id=? AND ${condition} ORDER BY created_at DESC`, user.customer_id))
    }
    if (path === '/api/plate-assets' && req.method === 'POST') {
      const b = await parseBody(req)
      if (!required(b, ['customerId', 'route'])) return fail(res, 400, '請選擇客戶和路線')
      if (user.role !== 'admin' && b.customerId !== user.customer_id) return fail(res, 403, '只能建立自己的兩地牌')
      if (!canAccessCustomer(user, b.customerId)) return fail(res, 404, '客戶不存在')
      if (!['粵港','粵澳'].includes(b.route)) return fail(res, 400, '路線無效')
      if (b.vehicleId) { const v = one('SELECT * FROM vehicles WHERE id=?', b.vehicleId); if (!v || v.customer_id !== b.customerId || v.route !== b.route) return fail(res, 400, '車輛與客戶或路線不符') }
      if (b.sourceRequestId) {
        if (user.role !== 'admin') return fail(res, 403, '只有專員可從案件建立兩地牌檔案')
        const source = one('SELECT * FROM requests WHERE id=?', b.sourceRequestId)
        if (!source || source.service_code !== 'new_application' || source.customer_id !== b.customerId || source.route !== b.route || source.plate_asset_id) return fail(res, 400, '申請案件與客戶或路線不相符，或已完成建檔')
      }
      const proposedCard = cleanCard(b.cardData)
      const cardNumber = clean(proposedCard.cardNumber || b.cardNumber,80)
      if (!cardNumber) return fail(res, 400, '請先填寫批文卡編號；尚未取得批文卡請使用申請代辦')
      if (one("SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=?",b.customerId,b.route,cardNumber)) return fail(res,409,'這張批文卡已在名下建檔')
      const cardImages=[]
      for (const side of ['front','back']) if (b.cardImages?.[side]) {
        const matched=String(b.cardImages[side]).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
        if (!matched) return fail(res,400,'只接受 PNG、JPEG 或 WebP 圖片')
        const bytes=Buffer.from(matched[2],'base64')
        if (bytes.length>3500000) return fail(res,400,'圖片不可超過 3.5 MB')
        cardImages.push([side,`image/${matched[1]}`,bytes])
      }
      const assetId = id()
      const mainlandPlate=clean(proposedCard.mainlandPlate || b.mainlandPlate,30)||null
      const localPlate=clean(proposedCard.localPlate || b.localPlate,30)||null
      const cardExpiresOn=clean(proposedCard.validTo || b.cardExpiresOn,20)||null
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO plate_assets(id,customer_id,route,mainland_plate,local_plate,vehicle_id,installation_status,usage_status,card_number,card_expires_on,notes,created_at,updated_at,card_data,card_status,card_updated_by,card_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(assetId,b.customerId,b.route,mainlandPlate,localPlate,b.vehicleId||null,'待核對','待核對',cardNumber,cardExpiresOn,clean(b.notes,1000),now(),now(),JSON.stringify({...proposedCard,cardNumber}),'待核對',user.name,now())
        for(const [side,mime,bytes] of cardImages) db.prepare('INSERT INTO approval_card_images VALUES (?,?,?,?)').run(assetId,side,mime,bytes)
        if (b.sourceRequestId) {
          db.prepare('UPDATE requests SET plate_asset_id=?,updated_at=? WHERE id=? AND plate_asset_id IS NULL').run(assetId,now(),b.sourceRequestId)
          pushActivity(b.sourceRequestId,user.id,'plate_created',`已取得批文卡 ${cardNumber}，建立兩地牌檔案`)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 201, plateDetail(user, assetId))
    }
    const plateMatch = path.match(/^\/api\/plate-assets\/([^/]+)$/)
    if (plateMatch && req.method === 'GET') {
      const item = plateDetail(user, plateMatch[1]); return item ? json(res, 200, item) : fail(res, 404, '兩地牌不存在')
    }
    if (plateMatch && req.method === 'PATCH') {
      const old = plateFor(user, plateMatch[1]); if (!old) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      if (user.role !== 'admin' && b.usageStatus !== undefined && b.usageStatus !== old.usage_status) return fail(res, 403, '使用狀態須由專員核對')
      const installation = b.installationStatus ?? old.installation_status
      const usage = b.usageStatus ?? old.usage_status
      if (!['待核對','未上牌','已上牌'].includes(installation) || !['待核對','自用','出租中','暫停使用'].includes(usage)) return fail(res, 400, '牌照狀態無效')
      const vehicleId = b.vehicleId === undefined ? old.vehicle_id : b.vehicleId || null
      if (vehicleId) { const v = one('SELECT * FROM vehicles WHERE id=?', vehicleId); if (!v || v.customer_id !== old.customer_id || v.route !== old.route) return fail(res, 400, '車輛與客戶或路線不符') }
      if (installation === '已上牌' && !vehicleId && usage !== '出租中') return fail(res, 400, '自用已上牌須指定車輛')
      if (installation === '未上牌' && vehicleId) return fail(res, 400, '未上牌不能綁定車輛')
      const groupId = b.groupId === undefined ? old.group_id : b.groupId || null
      if (groupId) { const parent = one('SELECT * FROM company_groups WHERE id=? AND tenant_id=?', groupId, user.tenant_id); if (!parent) return fail(res, 404, '公司組不存在'); if (parent.customer_id !== old.customer_id) return fail(res, 400, '公司組與客戶不符') }
      if (user.role !== 'admin' && (b.groupId !== undefined || b.indicatorCategory !== undefined || b.port !== undefined)) return fail(res, 403, '指標類別、口岸和公司組須由專員維護')
      if (usage === '出租中' && !one("SELECT id FROM plate_rentals WHERE plate_asset_id=? AND status='出租中'", old.id)) return fail(res, 400, '出租中須先建立出租記錄')
      if (usage !== '出租中' && one("SELECT id FROM plate_rentals WHERE plate_asset_id=? AND status='出租中'", old.id)) return fail(res, 400, '請先結束出租記錄')
      const nextCardNumber = clean(b.cardNumber ?? old.card_number,80)
      if (!nextCardNumber) return fail(res,400,'批文卡編號不能留空')
      if (one('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?',old.customer_id,old.route,nextCardNumber,old.id)) return fail(res,409,'這張批文卡已在名下建檔')
      const cardNumberChanged = nextCardNumber !== clean(old.card_number,80)
      const nextCard = cardNumberChanged ? cleanCard({...cardData(old.card_data),cardNumber:nextCardNumber}) : null
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE plate_assets SET mainland_plate=?,local_plate=?,vehicle_id=?,installation_status=?,usage_status=?,card_number=?,card_expires_on=?,notes=?,group_id=?,indicator_category=?,port=?,updated_at=? WHERE id=?').run(clean(b.mainlandPlate ?? old.mainland_plate,30)||null,clean(b.localPlate ?? old.local_plate,30)||null,vehicleId,installation,usage,nextCardNumber,clean(b.cardExpiresOn ?? old.card_expires_on,20)||null,clean(b.notes ?? old.notes,1000),groupId,clean(b.indicatorCategory ?? old.indicator_category,40)||null,clean(b.port ?? old.port,40)||null,now(),old.id)
        if (cardNumberChanged) {
          db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_updated_by=?,card_updated_at=? WHERE id=?').run(JSON.stringify(nextCard),'待核對',user.name,now(),old.id)
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, plateDetail(user, old.id))
    }
    if (plateMatch && req.method === 'PUT') {
      const old = plateFor(user, plateMatch[1]); if (!old) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      const proposed = cleanCard(b.cardData)
      if (!proposed.cardNumber) return fail(res, 400, '批文卡編號不能留空')
      if (one('SELECT id FROM plate_assets WHERE customer_id=? AND route=? AND card_number=? AND id<>?',old.customer_id,old.route,proposed.cardNumber,old.id)) return fail(res,409,'這張批文卡已在名下建檔')
      const nextStatus = user.role === 'admin' ? '已核對' : '待核對'
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_number=?,card_expires_on=?,mainland_plate=?,local_plate=?,card_updated_by=?,card_updated_at=?,updated_at=? WHERE id=?').run(JSON.stringify(proposed),nextStatus,proposed.cardNumber||null,proposed.validTo||null,proposed.mainlandPlate||null,proposed.localPlate||null,user.name,now(),now(),old.id)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, plateDetail(user, old.id))
    }
    const cardMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/card\/(front|back)$/)
    const privateImageMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/image\/(card-front|card-back|plate-mainland|plate-local)$/)
    if (privateImageMatch && req.method === 'GET') {
      const item = plateFor(user, privateImageMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      const kind = privateImageMatch[2]
      const row = kind.startsWith('card-') ? one('SELECT mime,data FROM approval_card_images WHERE plate_asset_id=? AND side=?',item.id,kind.slice(5)) : one('SELECT mime,data FROM plate_photos WHERE plate_asset_id=? AND kind=?',item.id,kind.slice(6))
      if (!row) return fail(res, 404, '圖片不存在')
      res.writeHead(200, {'content-type':row.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'})
      return res.end(row.data)
    }
    if (cardMatch && req.method === 'POST') {
      const item = plateFor(user, cardMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      if (user.role !== 'admin' && !one('SELECT id FROM users WHERE id=? AND customer_id=?',user.id,item.customer_id)) return fail(res, 403, '無權限')
      const b = await parseBody(req)
      const matched = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(b.image || '')
      if (!matched) return fail(res, 400, '請上傳 JPG 或 PNG 圖片')
      const bytes = Buffer.from(matched[2], 'base64')
      if (!bytes.length || bytes.length > 3500000) return fail(res, 400, '圖片不可超過 3.5 MB')
      const side=cardMatch[2]
      let recognized={}
      try { recognized=await recognizeCard(bytes,side) } catch (error) { console.error('Card OCR failed:',error) }
      const existing=cardData(item.card_data)
      const proposed=cleanCard({...existing,...Object.fromEntries(Object.entries(recognized).filter(([,v])=>v))})
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO approval_card_images VALUES (?,?,?,?) ON CONFLICT(plate_asset_id,side) DO UPDATE SET mime=excluded.mime,data=excluded.data').run(item.id,side,matched[1],bytes)
        db.prepare('UPDATE plate_assets SET card_data=?,card_status=?,card_number=?,card_expires_on=?,mainland_plate=?,local_plate=?,card_updated_by=?,card_updated_at=?,updated_at=? WHERE id=?').run(JSON.stringify(proposed),'待核對',proposed.cardNumber||null,proposed.validTo||null,proposed.mainlandPlate||null,proposed.localPlate||null,user.name,now(),now(),item.id)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return json(res, 200, { side, uploaded: true, recognized, cardData: proposed, needsReview: true })
    }
    const photoMatch = path.match(/^\/api\/plate-assets\/([^/]+)\/photo\/(mainland|local)$/)
    if (photoMatch && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const item = plateFor(user, photoMatch[1]); if (!item) return fail(res, 404, '兩地牌不存在')
      const b = await parseBody(req)
      const matched = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(b.image || '')
      if (!matched) return fail(res, 400, '請上傳 JPG 或 PNG 圖片')
      const bytes = Buffer.from(matched[2], 'base64')
      if (!bytes.length || bytes.length > 3500000) return fail(res, 400, '圖片不可超過 3.5 MB')
      db.prepare('INSERT INTO plate_photos VALUES (?,?,?,?) ON CONFLICT(plate_asset_id,kind) DO UPDATE SET mime=excluded.mime,data=excluded.data').run(item.id,photoMatch[2],matched[1],bytes)
      return json(res, 200, { kind: photoMatch[2], uploaded: true })
    }
    if (path === '/api/plate-rentals' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['plateAssetId','renterName'])) return fail(res, 400, '請填寫兩地牌與承租方')
      const item = plateFor(user, b.plateAssetId); if (!item) return fail(res, 404, '兩地牌不存在')
      if (one("SELECT id FROM plate_rentals WHERE plate_asset_id=? AND status='出租中'", item.id)) return fail(res, 409, '已有進行中的出租記錄')
      if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) return fail(res, 400, '結束日期早於開始日期')
      const rentalId=id()
      db.prepare('INSERT INTO plate_rentals(id,plate_asset_id,renter_name,renter_vehicle_plate,starts_on,ends_on,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(rentalId,item.id,clean(b.renterName,120),clean(b.renterVehiclePlate,50)||null,clean(b.startsOn,20)||null,clean(b.endsOn,20)||null,'出租中',clean(b.notes,1000),now())
      db.prepare("UPDATE plate_assets SET usage_status='出租中',updated_at=? WHERE id=?").run(now(),item.id)
      return json(res,201,one('SELECT * FROM plate_rentals WHERE id=?',rentalId))
    }
    const rentalMatch = path.match(/^\/api\/plate-rentals\/([^/]+)$/)
    if (rentalMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const old=one('SELECT * FROM plate_rentals WHERE id=?',rentalMatch[1]); if (!old || !plateFor(user,old.plate_asset_id)) return fail(res,404,'出租記錄不存在')
      const b=await parseBody(req); if (!['出租中','已結束'].includes(b.status)) return fail(res,400,'出租狀態無效')
      db.prepare('UPDATE plate_rentals SET status=?,ends_on=?,notes=? WHERE id=?').run(b.status,clean(b.endsOn ?? old.ends_on,20)||null,clean(b.notes ?? old.notes,1000),old.id)
      if (b.status==='已結束') db.prepare("UPDATE plate_assets SET usage_status='待核對',updated_at=? WHERE id=?").run(now(),old.plate_asset_id)
      return json(res,200,one('SELECT * FROM plate_rentals WHERE id=?',old.id))
    }
    if (path === '/api/customers' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const body = await parseBody(req)
      if (!required(body, ['name', 'kind'])) return fail(res, 400, '請填寫客戶名稱和類型')
      const customerId = id()
      db.prepare('INSERT INTO customers(id,name,kind,phone,owner_id,notes,tenant_id) VALUES (?,?,?,?,?,?,?)').run(customerId, clean(body.name, 120), clean(body.kind, 20), clean(body.phone, 40), user.id, clean(body.notes, 2000), user.tenant_id)
      return json(res, 201, one('SELECT * FROM customers WHERE id=?', customerId))
    }
    if (path === '/api/customer-users' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const body = await parseBody(req)
      if (!required(body, ['customerId', 'name', 'email', 'password'])) return fail(res, 400, '資料不完整')
      if (!canAccessCustomer(user, body.customerId)) return fail(res, 404, '客戶不存在')
      if (body.password.length < 12) return fail(res, 400, '密碼至少 12 字元')
      const userId = id()
      db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id) VALUES (?,?,?,?,?,?,?)').run(userId, 'customer', clean(body.name, 100), clean(body.email, 160).toLowerCase(), hashPassword(body.password), body.customerId, user.tenant_id)
      return json(res, 201, { id: userId })
    }
    if (path === '/api/vehicles' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      if (user.role === 'admin') return json(res, 200, customerId ? (canAccessCustomer(user, customerId) ? query('SELECT * FROM vehicles WHERE customer_id=? ORDER BY plate', customerId) : []) : query('SELECT v.* FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE c.tenant_id=? ORDER BY v.plate', user.tenant_id))
      return json(res, 200, query('SELECT * FROM vehicles WHERE customer_id=? ORDER BY plate', user.customer_id))
    }
    if (path === '/api/vehicles' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['customerId', 'route', 'origin', 'type', 'plate'])) return fail(res, 400, '車輛資料不完整')
      if (!['粵港', '粵澳'].includes(b.route) || !['香港', '內地', '澳門'].includes(b.origin)) return fail(res, 400, '路線或來源地無效')
      if (b.firstRegisteredOn && !validDate(b.firstRegisteredOn)) return fail(res, 400, '首次註冊日期無效')
      if (!canAccessCustomer(user, b.customerId)) return fail(res, 404, '客戶不存在')
      const vehicleId = id()
      db.prepare('INSERT INTO vehicles(id,customer_id,route,origin,type,plate,brand,model,vin,manufactured_year,notes,first_registered_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(vehicleId, b.customerId, clean(b.route, 20), clean(b.origin, 20), clean(b.type, 40), clean(b.plate, 50), clean(b.brand, 60), clean(b.model, 60), clean(b.vin, 100), Number(b.manufacturedYear) || null, clean(b.notes, 1000), validDate(b.firstRegisteredOn))
      return json(res, 201, one('SELECT * FROM vehicles WHERE id=?', vehicleId))
    }
    const vehicleMatch = path.match(/^\/api\/vehicles\/([^/]+)$/)
    if (vehicleMatch && req.method === 'GET') {
      const vehicle = vehicleFor(user, vehicleMatch[1])
      if (!vehicle) return fail(res, 404, '車輛不存在')
      return json(res, 200, { ...vehicle, credentials: query('SELECT * FROM credentials WHERE vehicle_id=? ORDER BY expires_on', vehicle.id), inspections: query('SELECT * FROM inspections WHERE vehicle_id=? ORDER BY appointment_on DESC', vehicle.id), inspectionGuidance: inspectionGuidance(vehicle, 'renewal') })
    }
    if (vehicleMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const old = vehicleFor(user, vehicleMatch[1]); if (!old) return fail(res, 404, '車輛不存在')
      const b = await parseBody(req)
      const next = { plate: b.plate === undefined ? old.plate : clean(b.plate, 50), brand: b.brand === undefined ? old.brand : clean(b.brand, 60), model: b.model === undefined ? old.model : clean(b.model, 60), vin: b.vin === undefined ? old.vin : clean(b.vin, 100), notes: b.notes === undefined ? old.notes : clean(b.notes, 1000), firstRegisteredOn: b.firstRegisteredOn === undefined ? old.first_registered_on : b.firstRegisteredOn === '' ? null : validDate(b.firstRegisteredOn), origin: b.origin ?? old.origin, manufacturedYear: b.manufacturedYear === undefined ? old.manufactured_year : b.manufacturedYear === '' ? null : b.manufacturedYear }
      if (!next.plate) return fail(res, 400, '車牌不可為空')
      if (b.firstRegisteredOn != null && b.firstRegisteredOn !== '' && !next.firstRegisteredOn) return fail(res, 400, '首次註冊日期無效')
      if (!['香港', '澳門', '內地'].includes(next.origin)) return fail(res, 400, '來源地無效')
      if (next.manufacturedYear !== null && next.manufacturedYear !== '' && (!Number.isInteger(next.manufacturedYear) || next.manufacturedYear < 1886 || next.manufacturedYear > 9999)) return fail(res, 400, '製造年份無效')
      db.prepare('UPDATE vehicles SET plate=?,brand=?,model=?,vin=?,notes=?,first_registered_on=?,origin=?,manufactured_year=? WHERE id=?').run(next.plate, next.brand, next.model, next.vin, next.notes, next.firstRegisteredOn, next.origin, next.manufacturedYear, old.id)
      return json(res, 200, one('SELECT * FROM vehicles WHERE id=?', old.id))
    }
    if (path === '/api/credentials' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['vehicleId', 'name'])) return fail(res, 400, '證件資料不完整')
      if (!vehicleFor(user, b.vehicleId)) return fail(res, 404, '車輛不存在')
      if (b.sourceId && !sources.some(s => s.id === b.sourceId)) return fail(res, 400, '官方來源不存在')
      const credentialId = id()
      db.prepare('INSERT INTO credentials VALUES (?,?,?,?,?,?,?,?)').run(credentialId, b.vehicleId, clean(b.name, 100), clean(b.issuer, 100), clean(b.number, 100), clean(b.expiresOn, 20) || null, '待核對', clean(b.sourceId, 60) || null)
      return json(res, 201, one('SELECT * FROM credentials WHERE id=?', credentialId))
    }
    const credentialMatch = path.match(/^\/api\/credentials\/([^/]+)$/)
    if (credentialMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const existing = one('SELECT * FROM credentials WHERE id=?', credentialMatch[1]); if (!existing || !vehicleFor(user, existing.vehicle_id)) return fail(res, 404, '牌證不存在')
      const b = await parseBody(req)
      const allowed = ['待核對', '已核對', '待續期', '已失效']
      if (b.status && !allowed.includes(b.status)) return fail(res, 400, '牌證狀態無效')
      db.prepare('UPDATE credentials SET status=?,expires_on=?,number=? WHERE id=?').run(b.status || existing.status, clean(b.expiresOn, 20) || existing.expires_on, clean(b.number, 100) || existing.number, existing.id)
      return json(res, 200, one('SELECT * FROM credentials WHERE id=?', existing.id))
    }
    if (path === '/api/requests' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId')
      if (user.role === 'admin') return json(res, 200, customerId ? query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.customer_id=? AND c.tenant_id=? ORDER BY r.created_at DESC', customerId, user.tenant_id) : query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE c.tenant_id=? ORDER BY r.created_at DESC', user.tenant_id))
      return json(res, 200, query('SELECT r.*,c.name customer_name,v.plate FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.customer_id=? ORDER BY r.created_at DESC', user.customer_id))
    }
    if (path === '/api/requests' && req.method === 'POST') {
      const b = await parseBody(req)
      if (!required(b, ['serviceCode', 'route', 'title'])) return fail(res, 400, '請選擇服務並填寫要求')
      const service = services.find(s => s.code === b.serviceCode && s.routes.includes(b.route))
      if (!service) return fail(res, 400, '服務類型與路線不相符')
      const customerId = user.role === 'admin' ? b.customerId : user.customer_id
      if (!customerId || !canAccessCustomer(user, customerId)) return fail(res, 400, '客戶不存在')
      if (b.vehicleId) { const vehicle = one('SELECT * FROM vehicles WHERE id=?', b.vehicleId); if (!vehicle || vehicle.customer_id !== customerId || vehicle.route !== b.route) return fail(res, 400, '車輛與客戶或路線不相符') }
      if (b.plateAssetId) { const plate = one('SELECT * FROM plate_assets WHERE id=?', b.plateAssetId); if (!plate || plate.customer_id !== customerId || plate.route !== b.route || !clean(plate.card_number)) return fail(res, 400, '兩地牌檔案與客戶或路線不相符') }
      if (service.code === 'new_application' && b.plateAssetId) return fail(res, 400, '新申請不應關聯既有兩地牌')
      const requestId = id()
      const firstStage = user.role === 'admin' ? planFor(service, b.route).stages[0] : '待內部受理'
      db.prepare('INSERT INTO requests(id,customer_id,vehicle_id,service_code,route,title,description,status,stage,assignee_id,created_at,updated_at,plate_asset_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId, customerId, b.vehicleId || null, service.code, b.route, clean(b.title, 160), clean(b.description, 4000), '新要求', firstStage, user.role === 'admin' ? user.id : null, now(), now(),b.plateAssetId||null)
      pushActivity(requestId, user.id, 'created', user.role === 'admin' ? '管理員建立案件' : '客戶提交代辦要求')
      addTasks(requestId, service, b.route)
      return json(res, 201, one('SELECT * FROM requests WHERE id=?', requestId))
    }
    const requestMatch = path.match(/^\/api\/requests\/([^/]+)$/)
    if (requestMatch && req.method === 'GET') {
      const item = requestFor(user, requestMatch[1]); if (!item) return fail(res, 404, '案件不存在')
      const service = services.find(s => s.code === item.service_code)
      const vehicle = item.vehicle_id ? one('SELECT * FROM vehicles WHERE id=?', item.vehicle_id) : null
      const plateAsset = item.plate_asset_id ? plateFor(user,item.plate_asset_id) : null
      return json(res, 200, { ...item, activities: query('SELECT a.*,u.name actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.request_id=? ORDER BY a.created_at DESC', item.id), tasks: query('SELECT * FROM tasks WHERE request_id=? ORDER BY rowid', item.id), vehicle, plateAsset, plan: service ? planFor(service, item.route) : null, inspectionGuidance: vehicle ? inspectionGuidance(vehicle, item.service_code) : [] })
    }
    if (requestMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const item = requestFor(user, requestMatch[1]); if (!item) return fail(res, 404, '案件不存在')
      const b = await parseBody(req)
      const status = clean(b.status || item.status, 60), stage = clean(b.stage || item.stage, 100)
      const service = services.find(s => s.code === item.service_code)
      if (!['新要求', '待資格核實', '待報價／授權', '待收件', '辦理中', '待客戶配合', '待交付', '已完成', '暫停'].includes(status)) return fail(res, 400, '案件狀態無效')
      if (service && !['待內部受理', ...planFor(service, item.route).stages].includes(stage)) return fail(res, 400, '案件階段與服務路線不相符')
      if (status === '已完成') {
        const unfinished = one("SELECT COUNT(*) count FROM tasks WHERE request_id=? AND status NOT IN ('已完成','不適用')", item.id).count
        if (unfinished) return fail(res, 409, `仍有 ${unfinished} 個辦理節點未完成或未標記不適用`)
      }
      db.prepare('UPDATE requests SET status=?,stage=?,assignee_id=?,updated_at=? WHERE id=?').run(status, stage, b.assigneeId || item.assignee_id || user.id, now(), item.id)
      pushActivity(item.id, user.id, 'status', `${status} · ${stage}${b.note ? ` · ${clean(b.note, 1000)}` : ''}`)
      return json(res, 200, one('SELECT * FROM requests WHERE id=?', item.id))
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const task = one('SELECT * FROM tasks WHERE id=?', taskMatch[1]); if (!task || !requestFor(user, task.request_id)) return fail(res, 404, '任務不存在')
      const b = await parseBody(req)
      const status = clean(b.status || task.status, 40)
      if (!['待辦', '待官方核實', '辦理中', '待客戶配合', '已完成', '不適用'].includes(status)) return fail(res, 400, '任務狀態無效')
      const parent = one('SELECT * FROM requests WHERE id=?', task.request_id)
      if (parent.status === '已完成') return fail(res, 409, '已完成案件須先重新開啟，才可變更辦理節點')
      if (parent.service_code === 'new_application' && /香港 TD547D|澳門邊境通行證申請/.test(task.title) && ['辦理中', '已完成'].includes(status)) {
        const approval = one("SELECT status FROM tasks WHERE request_id=? AND title='廣東批文申請與回執'", parent.id)
        if (approval?.status !== '已完成') return fail(res, 409, '須先記錄廣東批文完成，再開始香港／澳門牌證申請')
      }
      db.prepare('UPDATE tasks SET status=?,due_on=?,notes=? WHERE id=?').run(status, clean(b.dueOn, 20) || task.due_on, clean(b.notes, 1000) || task.notes, task.id)
      pushActivity(task.request_id, user.id, 'task', `${task.title}：${status}`)
      return json(res, 200, one('SELECT * FROM tasks WHERE id=?', task.id))
    }
    if (path === '/api/inspections' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const b = await parseBody(req)
      if (!required(b, ['vehicleId', 'title'])) return fail(res, 400, '請填寫車輛與驗車項目')
      if (!vehicleFor(user, b.vehicleId)) return fail(res, 404, '車輛不存在')
      if (b.requestId) { const parent = one('SELECT vehicle_id FROM requests WHERE id=?', b.requestId); if (!parent || parent.vehicle_id !== b.vehicleId) return fail(res, 400, '案件與車輛不相符') }
      if (b.sourceId && !sources.some(s => s.id === b.sourceId)) return fail(res, 400, '官方來源不存在')
      const inspectionId = id()
      db.prepare('INSERT INTO inspections VALUES (?,?,?,?,?,?,?,?,?)').run(inspectionId, b.vehicleId, b.requestId || null, clean(b.title, 160), '待預約', clean(b.appointmentOn, 20) || null, null, clean(b.sourceId, 60) || null, clean(b.notes, 1000))
      return json(res, 201, one('SELECT * FROM inspections WHERE id=?', inspectionId))
    }
    const inspectionMatch = path.match(/^\/api\/inspections\/([^/]+)$/)
    if (inspectionMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return fail(res, 403, '無權限')
      const existing = one('SELECT * FROM inspections WHERE id=?', inspectionMatch[1]); if (!existing || !vehicleFor(user, existing.vehicle_id)) return fail(res, 404, '驗車項目不存在')
      const b = await parseBody(req)
      if (b.status && !['待預約', '已預約', '檢驗中', '合格', '不合格', '不適用'].includes(b.status)) return fail(res, 400, '驗車狀態無效')
      db.prepare('UPDATE inspections SET status=?,appointment_on=?,result_on=?,notes=? WHERE id=?').run(clean(b.status, 40) || existing.status, clean(b.appointmentOn, 20) || existing.appointment_on, clean(b.resultOn, 20) || existing.result_on, clean(b.notes, 1000) || existing.notes, existing.id)
      return json(res, 200, one('SELECT * FROM inspections WHERE id=?', existing.id))
    }
    return fail(res, 404, '找不到此頁')
  } catch (error) {
    if (error instanceof SyntaxError) return fail(res, 400, 'JSON 格式錯誤')
    if (error.message === '請求內容格式錯誤') return fail(res, 400, error.message)
    if (String(error.message).includes('UNIQUE constraint')) return fail(res, 409, '資料已存在')
    console.error(error)
    return fail(res, 500, '伺服器處理失敗')
  }
})
server.listen(port, () => console.log(`API listening on http://localhost:${port}`))
