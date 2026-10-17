import { randomUUID } from 'node:crypto'
import { db, now } from './db.js'
import { notify } from './client-portal.js'
import { loginPhone, PHONE_RULE } from './security.js'

// 自管客戶有問題找誰（docs/requirements.md 5.6.2，2026-10-18）：兩個渠道並用。
// 1. app 內文字訊息：自管客戶發訊息，自動帶出帳號；員工在今日工作的共用收件匣回覆，客戶收到通知。先做文字。
// 2. WhatsApp／微信：公司公共帳號，由管理者在設定頁填寫，客戶端「聯絡我們」顯示。
db.exec(`CREATE TABLE IF NOT EXISTS support_messages(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, from_staff INTEGER NOT NULL, sender_id TEXT, sender_name TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
CREATE INDEX IF NOT EXISTS idx_support_messages_customer ON support_messages(customer_id, created_at);
CREATE TABLE IF NOT EXISTS support_contact(tenant_id TEXT PRIMARY KEY, whatsapp TEXT, wechat_id TEXT, wechat_qr TEXT, wecom_link TEXT, updated_by TEXT, updated_at TEXT NOT NULL);`)

const MAX_BODY = 1000, HOURLY_LIMIT = 30, MAX_QR_BYTES = 400000
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const messageView = row => ({ id: row.id, fromStaff: Boolean(row.from_staff), senderName: row.from_staff ? row.sender_name : '', body: row.body, createdAt: row.created_at, read: Boolean(row.read_at) })
const selfManaged = customer => customer?.service_mode === '自管' && !customer.is_self

// 讀出訊息內容；回傳 { body } 或 { error }
function readBody(body) {
  if (!isObject(body) || Object.keys(body).some(key => key !== 'body')) return { error: '內容無效' }
  if (typeof body.body !== 'string' || !body.body.trim()) return { error: '請輸入訊息' }
  if (body.body.trim().length > MAX_BODY) return { error: `訊息不可超過 ${MAX_BODY} 個字` }
  return { body: body.body.trim() }
}

export function contactView(tenantId) {
  const row = db.prepare('SELECT * FROM support_contact WHERE tenant_id=?').get(tenantId) || {}
  return { whatsapp: row.whatsapp || '', whatsappLink: row.whatsapp ? `https://wa.me/${row.whatsapp.replace(/\D/g, '')}` : '', wechatId: row.wechat_id || '', wechatQr: row.wechat_qr || '', wecomLink: row.wecom_link || '' }
}

// 設定聯絡方式：只改有提供的欄位；空字串或 null 即清除。回傳 { next } 或 { error }
function checkContact(body, current) {
  const keys = ['whatsapp', 'wechatId', 'wechatQr', 'wecomLink']
  if (!isObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !keys.includes(key))) return { error: '內容無效' }
  if (keys.some(key => body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string')) return { error: '內容無效' }
  const next = { whatsapp: current.whatsapp || null, wechat_id: current.wechat_id || null, wechat_qr: current.wechat_qr || null, wecom_link: current.wecom_link || null }
  if (body.whatsapp !== undefined) {
    const text = (body.whatsapp || '').trim()
    if (text && !loginPhone(text)) return { error: `WhatsApp 號碼：${PHONE_RULE}` }
    next.whatsapp = text ? loginPhone(text) : null
  }
  if (body.wechatId !== undefined) {
    const text = (body.wechatId || '').trim()
    if (text && !/^[A-Za-z][-_A-Za-z0-9]{5,19}$/.test(text)) return { error: '微信號格式無效（6 至 20 個字元，以英文字母開頭）' }
    next.wechat_id = text || null
  }
  if (body.wechatQr !== undefined) {
    const text = body.wechatQr || ''
    if (text) {
      const matched = text.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
      if (!matched) return { error: '二維碼只接受 PNG、JPEG 或 WebP 圖片' }
      if (Buffer.from(matched[2], 'base64').length > MAX_QR_BYTES) return { error: '二維碼圖片不可超過 400 KB' }
    }
    next.wechat_qr = text || null
  }
  if (body.wecomLink !== undefined) {
    const text = (body.wecomLink || '').trim()
    if (text && !/^https:\/\/work\.weixin\.qq\.com\/[^\s]{1,300}$/.test(text)) return { error: '企業微信客服連結須以 https://work.weixin.qq.com/ 開頭' }
    next.wecom_link = text || null
  }
  return { next }
}

// 員工收件匣：每位有訊息的客戶一行；有未讀的排最前
function inbox(tenantId) {
  return db.prepare(`SELECT m.customer_id, c.name customer_name, c.service_mode,
      (SELECT body FROM support_messages WHERE customer_id=m.customer_id ORDER BY created_at DESC LIMIT 1) last_body,
      (SELECT from_staff FROM support_messages WHERE customer_id=m.customer_id ORDER BY created_at DESC LIMIT 1) last_from_staff,
      MAX(m.created_at) last_at, SUM(CASE WHEN m.from_staff=0 AND m.read_at IS NULL THEN 1 ELSE 0 END) unread
    FROM support_messages m JOIN customers c ON c.id=m.customer_id WHERE m.tenant_id=? GROUP BY m.customer_id ORDER BY unread>0 DESC, last_at DESC`).all(tenantId)
    .map(row => ({ customerId: row.customer_id, customerName: row.customer_name, serviceMode: row.service_mode || '托管', lastBody: row.last_body, lastFromStaff: Boolean(row.last_from_staff), lastAt: row.last_at, unread: row.unread }))
}

const thread = customerId => db.prepare('SELECT * FROM support_messages WHERE customer_id=? ORDER BY created_at, rowid').all(customerId).map(messageView)
function insertMessage({ tenantId, customerId, fromStaff, user, body }) {
  db.prepare('INSERT INTO support_messages(id,tenant_id,customer_id,from_staff,sender_id,sender_name,body,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), tenantId, customerId, fromStaff ? 1 : 0, user.id, user.name, body, now())
}

export async function supportRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const convoMatch = path.match(/^\/api\/support\/conversations\/([^/]+)$/)
  const known = ['/api/my/messages', '/api/my/contact', '/api/support/inbox', '/api/support/contact'].includes(path) || convoMatch
  if (!known) return false

  if (path.startsWith('/api/my/')) {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(user.customer_id, tenant)
    if (path === '/api/my/contact') {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      return json(res, 200, contactView(tenant)), true
    }
    if (method === 'GET') {
      // 客戶打開對話即視為已讀員工的回覆
      db.prepare('UPDATE support_messages SET read_at=? WHERE customer_id=? AND from_staff=1 AND read_at IS NULL').run(now(), customer.id)
      return json(res, 200, { canSend: selfManaged(customer), messages: thread(customer.id) }), true
    }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    if (!selfManaged(customer)) return fail(res, 403, '請直接聯絡你的顧問'), true
    const { body, error } = readBody(await parseBody(req))
    if (error) return fail(res, 400, error), true
    const since = new Date(Date.now() - 3600000).toISOString()
    if (db.prepare('SELECT COUNT(*) count FROM support_messages WHERE customer_id=? AND from_staff=0 AND created_at>?').get(customer.id, since).count >= HOURLY_LIMIT) return fail(res, 429, '訊息太頻密，請稍後再發'), true
    insertMessage({ tenantId: tenant, customerId: customer.id, fromStaff: false, user, body })
    return json(res, 201, { messages: thread(customer.id) }), true
  }

  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  if (path === '/api/support/contact') {
    if (method === 'GET') return json(res, 200, contactView(tenant)), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    if (user.role !== 'admin') return fail(res, 403, '只限管理者設定聯絡方式'), true
    const current = db.prepare('SELECT * FROM support_contact WHERE tenant_id=?').get(tenant) || {}
    const { next, error } = checkContact(await parseBody(req), current)
    if (error) return fail(res, 400, error), true
    db.prepare('INSERT INTO support_contact(tenant_id,whatsapp,wechat_id,wechat_qr,wecom_link,updated_by,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET whatsapp=excluded.whatsapp,wechat_id=excluded.wechat_id,wechat_qr=excluded.wechat_qr,wecom_link=excluded.wecom_link,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
      .run(tenant, next.whatsapp, next.wechat_id, next.wechat_qr, next.wecom_link, user.id, now())
    return json(res, 200, contactView(tenant)), true
  }
  if (path === '/api/support/inbox') {
    if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
    return json(res, 200, inbox(tenant)), true
  }
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(convoMatch[1], tenant)
  if (!customer || customer.is_self) return fail(res, 404, '客戶不存在'), true
  if (method === 'GET') {
    db.prepare('UPDATE support_messages SET read_at=? WHERE customer_id=? AND from_staff=0 AND read_at IS NULL').run(now(), customer.id)
    return json(res, 200, { customer: { id: customer.id, name: customer.name, serviceMode: customer.service_mode || '托管' }, messages: thread(customer.id) }), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const { body, error } = readBody(await parseBody(req))
  if (error) return fail(res, 400, error), true
  insertMessage({ tenantId: tenant, customerId: customer.id, fromStaff: true, user, body })
  notify({ tenantId: tenant, customerId: customer.id, kind: 'support_reply', title: '我們回覆了你的訊息', body: body.slice(0, 100), link: '/pages/messages/messages' })
  return json(res, 201, { messages: thread(customer.id) }), true
}
