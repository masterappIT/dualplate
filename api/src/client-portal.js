import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { db } from './db.js'

// 客戶端補強（docs/tasks/client-enhance-brief.md）：上傳文件、顧問聯絡、微信登入框架、站內通知。
const now = () => new Date().toISOString()
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const MAX_FILE = 5 * 1024 * 1024
// Real file type from the first bytes, not the name the client claims.
export const sniff = buffer => buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png'
  : buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
  : buffer.subarray(0, 4).toString('latin1') === '%PDF' ? 'application/pdf' : null
const attachmentRow = row => ({ id: row.id, requestId: row.request_id, taskId: row.task_id, fileName: row.file_name, mime: row.mime, size: row.size, status: row.status, reviewNote: row.review_note || '', createdAt: row.created_at, reviewedAt: row.reviewed_at })

// One notice per customer and dedupe key; repeats are ignored so the same event never notifies twice.
export function notify({ tenantId, customerId, kind, title, body = '', link = '', dedupeKey = null }) {
  if (!tenantId || !customerId) return false
  return db.prepare('INSERT OR IGNORE INTO notifications(id,tenant_id,customer_id,kind,title,body,link,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), tenantId, customerId, kind, title.slice(0, 120), String(body).slice(0, 400), link, dedupeKey, now()).changes > 0
}

// Called when the client reads the overview: a deadline entering 快到期 or 已逾期 notifies once per due date and level.
export function deadlineNotices(customer, deadlines) {
  for (const item of deadlines) {
    if (!['due', 'overdue'].includes(item.level) || !item.dueOn) continue
    const who = item.handledBy === 'you' ? '請你處理' : '我們會為你辦理'
    notify({
      tenantId: customer.tenant_id, customerId: customer.id, kind: 'deadline',
      title: `${item.name}${item.level === 'overdue' ? '已逾期' : '快到期'}`,
      body: `${item.ownerLabel} · ${item.dueOn}。${who}。`,
      link: item.plateId ? `/pages/plate-detail/plate-detail?id=${item.plateId}` : '/pages/deadlines/deadlines',
      dedupeKey: `deadline:${item.ownerType}:${item.ownerId}:${item.name}:${item.dueOn}:${item.level}`
    })
  }
}

// Before sign-in: WeChat mini program login and first-time binding. Without WECHAT_APPID/SECRET the feature is off (503).
export async function publicPortalRoutes(req, res, url, h) {
  const { json, fail, parseBody } = h
  if (!['/api/wechat/login', '/api/wechat/bind'].includes(url.pathname)) return false
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (!process.env.WECHAT_APPID || !process.env.WECHAT_SECRET) return fail(res, 503, '尚未設定微信登入'), true
  const body = await parseBody(req)
  if (typeof body.code !== 'string' || !body.code.trim()) return fail(res, 400, '缺少微信登入碼'), true
  let openid = ''
  try {
    const base = process.env.WECHAT_API_BASE || 'https://api.weixin.qq.com'
    const params = new URLSearchParams({ appid: process.env.WECHAT_APPID, secret: process.env.WECHAT_SECRET, js_code: body.code, grant_type: 'authorization_code' })
    const result = await (await fetch(`${base}/sns/jscode2session?${params}`)).json()
    openid = typeof result.openid === 'string' ? result.openid : ''
  } catch { return fail(res, 502, '微信服務暫時無法連線，請稍後再試'), true }
  if (!openid) return fail(res, 400, '微信登入碼無效或已過期'), true
  const session = account => {
    const token = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, account.id, new Date(Date.now() + 7 * 86400000).toISOString())
    return { token, user: { id: account.id, name: account.name, email: account.email, role: account.role, customerId: account.customer_id } }
  }
  if (url.pathname === '/api/wechat/login') {
    const account = db.prepare("SELECT * FROM users WHERE wechat_openid=? AND role='customer' AND active=1").get(openid)
    return (account ? json(res, 200, session(account)) : json(res, 409, { error: '這個微信尚未綁定帳戶，請輸入顧問提供的 6 位綁定碼', needsBinding: true })), true
  }
  if (typeof body.bindCode !== 'string' || !/^\d{6}$/.test(body.bindCode)) return fail(res, 400, '請輸入 6 位綁定碼'), true
  const bind = db.prepare('SELECT * FROM wechat_bind_codes WHERE code=? AND used_at IS NULL AND expires_at>?').get(body.bindCode, now())
  if (!bind) return fail(res, 400, '綁定碼不正確或已過期，請向顧問重新索取'), true
  if (db.prepare('SELECT id FROM users WHERE wechat_openid=?').get(openid)) return fail(res, 409, '這個微信已綁定其他帳戶'), true
  const account = db.prepare("SELECT * FROM users WHERE id=? AND role='customer' AND active=1").get(bind.user_id)
  if (!account) return fail(res, 404, '帳戶不存在或已停用'), true
  db.exec('BEGIN IMMEDIATE')
  try { db.prepare('UPDATE users SET wechat_openid=? WHERE id=?').run(openid, account.id); db.prepare('UPDATE wechat_bind_codes SET used_at=? WHERE code=?').run(now(), bind.code); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
  return json(res, 200, session(account)), true
}

export async function portalRoutes(req, res, url, user, h) {
  const { json, fail, parseBody } = h
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const isStaff = ['admin', 'staff'].includes(user.role)
  const myAttach = path.match(/^\/api\/my\/requests\/([^/]+)\/attachments(?:\/([^/]+)\/file)?$/)
  const adminAttach = path.match(/^\/api\/requests\/([^/]+)\/attachments(?:\/([^/]+)(\/file)?)?$/)
  const advisor = path.match(/^\/api\/customers\/([^/]+)\/advisor$/)
  const bindCode = path.match(/^\/api\/customer-users\/([^/]+)\/wechat-bind-code$/)
  const notices = path === '/api/my/notifications' || path === '/api/my/notifications/read'
  if (!myAttach && !adminAttach && !advisor && !bindCode && !notices && path !== '/api/my/advisor') return false

  // ── 客戶 ──
  if (myAttach || notices || path === '/api/my/advisor') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(user.customer_id, tenant)
    if (!customer) return fail(res, 404, '客戶不存在'), true
    if (path === '/api/my/advisor' && method === 'GET') return json(res, 200, { name: customer.advisor_name || '', phone: customer.advisor_phone || '', wechat: customer.advisor_wechat || '' }), true
    if (path === '/api/my/notifications' && method === 'GET') {
      const items = db.prepare('SELECT id,kind,title,body,link,read_at,created_at FROM notifications WHERE customer_id=? AND tenant_id=? ORDER BY created_at DESC LIMIT 100').all(customer.id, tenant)
      return json(res, 200, { unread: items.filter(item => !item.read_at).length, items: items.map(item => ({ id: item.id, kind: item.kind, title: item.title, body: item.body, link: item.link, read: Boolean(item.read_at), createdAt: item.created_at })) }), true
    }
    if (path === '/api/my/notifications/read' && method === 'POST') {
      const body = await parseBody(req)
      if (body.all === true) db.prepare('UPDATE notifications SET read_at=? WHERE customer_id=? AND tenant_id=? AND read_at IS NULL').run(now(), customer.id, tenant)
      else if (typeof body.id === 'string' && body.id) { if (!db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND customer_id=? AND tenant_id=?').run(now(), body.id, customer.id, tenant).changes) return fail(res, 404, '通知不存在'), true }
      else return fail(res, 400, '請指定通知或全部'), true
      return json(res, 200, { ok: true }), true
    }
    if (myAttach) {
      const request = db.prepare('SELECT * FROM requests WHERE id=? AND customer_id=?').get(myAttach[1], customer.id)
      if (!request) return fail(res, 404, '工單不存在'), true
      if (myAttach[2] && method === 'GET') {
        const row = db.prepare('SELECT * FROM request_attachments WHERE id=? AND request_id=? AND tenant_id=?').get(myAttach[2], request.id, tenant)
        if (!row) return fail(res, 404, '文件不存在'), true
        res.writeHead(200, { 'content-type': row.mime, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}` }); res.end(row.data); return true
      }
      if (method === 'GET') return json(res, 200, db.prepare('SELECT * FROM request_attachments WHERE request_id=? AND tenant_id=? ORDER BY created_at DESC').all(request.id, tenant).map(attachmentRow)), true
      if (method === 'POST') {
        if (['已完成', '已取消'].includes(request.status)) return fail(res, 409, '工單已結束，不能再上傳'), true
        const body = await parseBody(req)
        const fileName = text(body.fileName, 120), data = typeof body.data === 'string' ? Buffer.from(body.data.replace(/^data:[^,]+,/, ''), 'base64') : null
        if (!fileName || !data || !data.length) return fail(res, 400, '請選擇要上傳的檔案'), true
        if (data.length > MAX_FILE) return fail(res, 400, '檔案不能超過 5 MB'), true
        const mime = sniff(data)
        if (!mime) return fail(res, 400, '只接受相片（JPG、PNG）或 PDF'), true
        if (body.taskId !== undefined && body.taskId !== null && !db.prepare('SELECT id FROM tasks WHERE id=? AND request_id=?').get(body.taskId, request.id)) return fail(res, 400, '步驟不屬於這張工單'), true
        const id = randomUUID()
        db.prepare('INSERT INTO request_attachments(id,tenant_id,request_id,task_id,uploaded_by,file_name,mime,size,data,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, tenant, request.id, body.taskId || null, user.id, fileName, mime, data.length, data, '待確認', now())
        db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?)').run(randomUUID(), request.id, user.id, 'attachment', `客戶上傳文件：${fileName}`, now())
        return json(res, 201, attachmentRow(db.prepare('SELECT * FROM request_attachments WHERE id=?').get(id))), true
      }
      return fail(res, 405, '不支援此操作'), true
    }
  }

  // ── 管理端 ──
  if (!isStaff) return fail(res, 403, '無權限'), true
  if (advisor) {
    if (user.role !== 'admin') return fail(res, 403, '無權限'), true
    const customer = db.prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?').get(advisor[1], tenant)
    if (!customer) return fail(res, 404, '客戶不存在'), true
    if (method === 'GET') return json(res, 200, { name: customer.advisor_name || '', phone: customer.advisor_phone || '', wechat: customer.advisor_wechat || '' }), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    for (const key of ['name', 'phone', 'wechat']) if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') return fail(res, 400, '顧問資料格式無效'), true
    if (body.phone && !/^[+\d][\d\s-]{6,19}$/.test(body.phone.trim())) return fail(res, 400, '電話號碼格式無效'), true
    db.prepare('UPDATE customers SET advisor_name=?,advisor_phone=?,advisor_wechat=? WHERE id=?').run(text(body.name, 60) || null, text(body.phone, 30) || null, text(body.wechat, 60) || null, customer.id)
    return json(res, 200, { name: text(body.name, 60), phone: text(body.phone, 30), wechat: text(body.wechat, 60) }), true
  }
  if (bindCode) {
    if (user.role !== 'admin' || method !== 'POST') return fail(res, user.role !== 'admin' ? 403 : 405, user.role !== 'admin' ? '無權限' : '不支援此操作'), true
    const account = db.prepare("SELECT u.* FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.id=? AND u.role='customer' AND c.tenant_id=?").get(bindCode[1], tenant)
    if (!account) return fail(res, 404, '客戶帳號不存在'), true
    let code = ''
    do { code = String(randomInt(0, 1000000)).padStart(6, '0') } while (db.prepare('SELECT code FROM wechat_bind_codes WHERE code=? AND used_at IS NULL AND expires_at>?').get(code, now()))
    db.prepare('INSERT OR REPLACE INTO wechat_bind_codes(code,user_id,expires_at) VALUES (?,?,?)').run(code, account.id, new Date(Date.now() + 10 * 60000).toISOString())
    return json(res, 201, { code, expiresInMinutes: 10 }), true
  }
  if (adminAttach) {
    const request = db.prepare('SELECT r.* FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=? AND c.tenant_id=?').get(adminAttach[1], tenant)
    if (!request) return fail(res, 404, '工單不存在'), true
    if (!adminAttach[2] && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM request_attachments WHERE request_id=? AND tenant_id=? ORDER BY created_at DESC').all(request.id, tenant).map(attachmentRow)), true
    const row = adminAttach[2] && db.prepare('SELECT * FROM request_attachments WHERE id=? AND request_id=? AND tenant_id=?').get(adminAttach[2], request.id, tenant)
    if (!row) return fail(res, 404, '文件不存在'), true
    if (adminAttach[3] && method === 'GET') { res.writeHead(200, { 'content-type': row.mime, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}` }); res.end(row.data); return true }
    if (!adminAttach[3] && method === 'PATCH') {
      const body = await parseBody(req)
      if (!['已確認', '需重交'].includes(body.status)) return fail(res, 400, '請選擇確認或要求重交'), true
      if (body.status === '需重交' && !text(body.reviewNote, 300)) return fail(res, 400, '要求重交時請寫明原因'), true
      db.prepare('UPDATE request_attachments SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?').run(body.status, text(body.reviewNote, 300) || null, user.id, now(), row.id)
      if (body.status === '需重交') notify({ tenantId: tenant, customerId: request.customer_id, kind: 'attachment', title: '文件需要重新提交', body: `${row.file_name}：${text(body.reviewNote, 300)}`, link: `/pages/request-detail/request-detail?id=${request.id}`, dedupeKey: `attachment:${row.id}:${now()}` })
      const all = db.prepare('SELECT status FROM request_attachments WHERE request_id=? AND tenant_id=?').all(request.id, tenant)
      return json(res, 200, { ...attachmentRow(db.prepare('SELECT * FROM request_attachments WHERE id=?').get(row.id)), allConfirmed: all.length > 0 && all.every(item => item.status === '已確認') }), true
    }
    return fail(res, 405, '不支援此操作'), true
  }
  return fail(res, 404, '找不到此頁'), true
}
