import { createHash, randomBytes } from 'node:crypto'
import { db, id, now } from './db.js'
import { businessToday } from './rules.js'
import { sniff } from './client-portal.js'
import { contractFor, contractView, receiveInvoice, refreshContract, currencies } from './rentals.js'

// 出租第 B 輪（docs/tasks/rentals-brief.md）：承租方專屬連結、合約範本、承租方上傳憑證待確認、代收結算。
// 對外一律稱「車輛使用安排／使用費」。承租方不登入，用連結＋電話末 4 碼。
db.exec(`CREATE TABLE IF NOT EXISTS rental_links(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, failures INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rental_link_visits(key_hash TEXT PRIMARY KEY, link_id TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rental_acknowledgements(contract_id TEXT NOT NULL, name TEXT NOT NULL, acknowledged_at TEXT NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS renter_uploads(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contract_id TEXT NOT NULL, invoice_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, amount INTEGER, paid_on TEXT, note TEXT, status TEXT NOT NULL DEFAULT '待確認', review_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS rental_templates(tenant_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rent_settlements(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, period TEXT NOT NULL, currency TEXT NOT NULL, collected INTEGER NOT NULL, fees INTEGER NOT NULL, net INTEGER NOT NULL, settled_on TEXT NOT NULL, settled_by TEXT, notes TEXT, created_at TEXT NOT NULL, UNIQUE(customer_id, period, currency));`)

const hash = value => createHash('sha256').update(String(value)).digest('hex')
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const money = (currency, value) => `${currency} ${((value || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const today = () => businessToday().toISOString().slice(0, 10)
const validDate = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value }
const MAX_FAILURES = 5, LOCK_MINUTES = 30
export const defaultTemplate = `車輛使用安排確認書

使用人：{{使用人}}
使用車輛：{{使用車牌}}
兩地牌：{{牌照}}
使用期間：{{開始日期}} 至 {{結束日期}}
使用費：{{使用費}}，{{週期}}，每期 {{收款日}} 日前支付
押金：{{押金}}
付款方式：{{收款方式}}

雙方確認上述安排。使用人須遵守兩地車輛管理的相關規定，並按時支付使用費。`
const cycleWord = { monthly: '每月', quarterly: '每季', yearly: '每年' }

function fillTemplate(body, view) {
  const values = { 使用人: view.renter.name, 使用車牌: view.renter.vehiclePlate || '待補充', 牌照: view.plateLabel, 開始日期: view.startsOn, 結束日期: view.endsOn || '未定', 使用費: money(view.currency, view.rentAmount), 週期: cycleWord[view.cycle] || view.cycle, 收款日: String(view.dueDay), 押金: money(view.currency, view.depositAmount), 收款方式: view.collectionMode === '代收' ? '付給代辦公司' : '直接付給牌照持有人' }
  return body.replace(/\{\{(.+?)\}\}/g, (_, key) => values[key.trim()] ?? `{{${key}}}`)
}
const templateFor = tenantId => db.prepare('SELECT body FROM rental_templates WHERE tenant_id=?').get(tenantId)?.body || defaultTemplate

function linkFromToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null
  const link = db.prepare('SELECT * FROM rental_links WHERE token_hash=?').get(hash(token))
  if (!link || link.revoked_at || link.expires_at < now()) return null
  return link
}
const contractOfLink = link => { const contract = db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(link.contract_id); return contract ? refreshContract(contract) : null }
const phoneTail = contract => String(contract.renter_phone || '').replace(/\D/g, '').slice(-4)

// ── 承租方頁面（伺服器直接輸出精簡 HTML，不需登入） ──
const page = (title, body) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${html(title)}</title><style>
:root{--jade:#0F5C4A;--jade-deep:#0B3B30;--paper:#F7F6F1;--ink:#14201B;--ink2:#4E5D55;--rule:#E2E1D8;--yellow:#F2C230;--red:#C2362A;--ok:#2E7D52;--amber:#C47A00}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,'PingFang TC','Microsoft JhengHei','Noto Sans TC',sans-serif;line-height:1.55}
.wrap{max-width:640px;margin:0 auto;padding:20px 16px 48px}.head{background:var(--jade-deep);color:#E3EFEA;border-radius:16px;padding:20px}.kicker{color:var(--yellow);font-size:12px;font-weight:800;letter-spacing:3px}
h1{margin:6px 0 2px;font-size:22px;color:#fff}h2{font-size:16px;color:var(--jade-deep);margin:24px 0 8px}.card{background:#fff;border:1px solid var(--rule);border-radius:12px;padding:16px;margin-top:12px}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--rule)}.row:last-child{border:0}.muted{color:var(--ink2);font-size:13px}.num{font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#E5F2EA;color:var(--ok);white-space:nowrap}.period{font-size:16px}.due{display:block;color:var(--ink2);font-size:12px}.status{text-align:right;flex:none;max-width:55%}.status a{display:inline-block;margin-top:4px;color:var(--jade);font-size:13px;white-space:nowrap}.pill.red{background:#FBE9E7;color:var(--red)}.pill.amber{background:#FDF1DC;color:var(--amber)}.pill.gray{background:#EEEEE9;color:var(--ink2)}
input,button{font:inherit}input[type=text],input[type=tel],input[type=date],input[type=number]{width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:#fff}label{display:block;margin:12px 0 4px;font-size:13px;font-weight:700;color:var(--ink2)}
button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:8px;background:var(--jade);color:#fff;font-weight:700;cursor:pointer}button.secondary{background:#E3EFEA;color:var(--jade)}.error{color:var(--red);font-weight:700}.ok{color:var(--ok);font-weight:700}
pre{white-space:pre-wrap;font-family:inherit;margin:0}@media print{.noprint{display:none}body{background:#fff}.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">${body}</div></body></html>`
const send = (res, status, title, body) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }); res.end(page(title, body)) }
const gone = res => send(res, 404, '連結無效', '<div class="card"><h1 style="color:var(--jade-deep)">連結無效或已過期</h1><p class="muted">請聯絡為你安排車輛使用的顧問，索取新的連結。</p></div>')

function verifyForm(token, message = '') {
  return `<div class="head"><div class="kicker">車輛使用安排</div><h1>請先核對身份</h1><div>輸入你登記的電話號碼最後 4 位數字</div></div>
<form class="card" method="post" action="/r/${token}/verify"><label for="tail">電話最後 4 位</label><input id="tail" name="tail" type="tel" inputmode="numeric" maxlength="4" pattern="\\d{4}" required autofocus>${message ? `<p class="error">${html(message)}</p>` : ''}<button type="submit">繼續</button></form>`
}
function contractPage(token, key, contract, notice = '') {
  const view = contractView(contract)
  const ack = db.prepare('SELECT * FROM rental_acknowledgements WHERE contract_id=? ORDER BY acknowledged_at DESC').get(contract.id)
  const uploads = db.prepare('SELECT invoice_id, status, review_note FROM renter_uploads WHERE contract_id=? ORDER BY created_at DESC').all(contract.id)
  const invoices = view.invoices.filter(item => item.status !== '作廢')
  const rows = invoices.map(item => {
    const upload = uploads.find(row => row.invoice_id === item.id)
    const state = item.status === '已收' ? ['', '已確認收到'] : upload?.status === '待確認' ? ['amber', '憑證已上傳，待確認'] : upload?.status === '需重交' ? ['red', `憑證需重交：${upload.review_note || ''}`] : item.status === '逾期' ? ['red', '未付（已過期）'] : item.status === '部分收' ? ['amber', '部分已付'] : ['gray', '未到期']
    const canUpload = item.status !== '已收' && upload?.status !== '待確認'
    return `<div class="row"><div><b class="period num">${html(item.period)}</b><span class="due num">付款期限 ${html(item.dueOn)} · ${money(view.currency, item.amount)}</span></div><div class="status"><span class="pill ${state[0]}">${html(state[1])}</span>${canUpload ? `<div class="noprint"><a href="#upload" onclick="document.getElementById('invoice').value='${item.id}'">上傳轉帳憑證</a></div>` : ''}</div></div>`
  }).join('')
  const firstOpen = invoices.find(item => item.status !== '已收')
  return `<div class="head"><div class="kicker">車輛使用安排</div><h1>${html(view.plateLabel)}</h1><div>${html(view.renter.name)} · ${html(view.startsOn)} 起${view.endsOn ? ` 至 ${html(view.endsOn)}` : ''}</div></div>
${notice ? `<div class="card ${notice.startsWith('!') ? 'error' : 'ok'}">${html(notice.replace(/^!/, ''))}</div>` : ''}
<div class="card"><div class="row"><span class="muted">使用費</span><b class="num">${money(view.currency, view.rentAmount)} · ${cycleWord[view.cycle]}</b></div><div class="row"><span class="muted">每期付款期限</span><b>${view.dueDay} 日</b></div><div class="row"><span class="muted">付款方式</span><b>${view.collectionMode === '代收' ? '付給代辦公司' : '直接付給牌照持有人'}</b></div></div>
<h2>各期使用費</h2><div class="card">${rows || '<p class="muted">暫時沒有使用費記錄</p>'}</div>
<h2 id="upload" class="noprint">上傳轉帳憑證</h2>
<form class="card noprint" onsubmit="return upload(event)"><label for="invoice">付款期數</label><select id="invoice" style="width:100%;padding:10px;border:1px solid var(--rule);border-radius:8px">${invoices.filter(item => item.status !== '已收').map(item => `<option value="${item.id}"${item.id === firstOpen?.id ? ' selected' : ''}>${html(item.period)}（${money(view.currency, item.amount)}）</option>`).join('')}</select>
<label for="paid">付款日期</label><input id="paid" type="date" value="${today()}" required><label for="amount">付款金額（${view.currency}）</label><input id="amount" type="number" step="0.01" min="0.01" value="${firstOpen ? (firstOpen.amount / 100).toFixed(2) : ''}" required>
<label for="file">轉帳憑證（相片或 PDF，5 MB 以內）</label><input id="file" type="file" accept="image/png,image/jpeg,application/pdf" required><p id="msg" class="muted">上傳後由代辦公司核對，確認後狀態會改為「已確認收到」。</p><button type="submit">上傳</button></form>
<h2>安排內容</h2><div class="card"><pre>${html(fillTemplate(templateFor(contract.tenant_id), view))}</pre><p class="muted noprint">這份頁面可以列印保存。</p><button class="secondary noprint" type="button" onclick="print()">列印</button></div>
<h2 class="noprint">確認內容</h2>${ack ? `<div class="card ok">已由 ${html(ack.name)} 於 ${html(ack.acknowledged_at.slice(0, 16).replace('T', ' '))} 確認已閱讀。</div>` : `<form class="card noprint" method="post" action="/r/${token}/acknowledge"><input type="hidden" name="key" value="${key}"><label for="name">你的姓名</label><input id="name" name="name" type="text" maxlength="60" required><p class="muted">按下按鈕代表你已閱讀並確認上述安排內容。這不是電子簽署。</p><button type="submit">我已閱讀並確認</button></form>`}
<p class="muted" style="margin-top:24px">如有疑問，請聯絡為你安排的顧問。這個連結只供你本人使用，請勿轉發。</p>
<script>
async function upload(event){event.preventDefault();const msg=document.getElementById('msg');const file=document.getElementById('file').files[0];if(!file){return false}
if(file.size>5*1024*1024){msg.textContent='檔案超過 5 MB';msg.className='error';return false}
msg.textContent='上傳中…';msg.className='muted';const data=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(file)});
const response=await fetch('/r/${token}/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'${key}',invoiceId:document.getElementById('invoice').value,paidOn:document.getElementById('paid').value,amount:Math.round(Number(document.getElementById('amount').value)*100),data})});
const result=await response.json().catch(()=>({}));if(response.ok){location.href='/r/${token}?k=${key}&done=1'}else{msg.textContent=result.error||'上傳失敗，請稍後再試';msg.className='error'}return false}
</script>`
}
async function readForm(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8 * 1024 * 1024) throw new Error('請求內容過大') } return raw }
function visitKey(link) { const key = randomBytes(24).toString('hex'); db.prepare('INSERT INTO rental_link_visits(key_hash,link_id,expires_at) VALUES (?,?,?)').run(hash(key), link.id, new Date(Date.now() + 2 * 3600000).toISOString()); return key }
const validVisit = (link, key) => typeof key === 'string' && Boolean(db.prepare('SELECT 1 FROM rental_link_visits WHERE key_hash=? AND link_id=? AND expires_at>?').get(hash(key), link.id, now()))

export async function renterPublicRoutes(req, res, url) {
  const match = url.pathname.match(/^\/r\/([^/]+)(?:\/(verify|upload|acknowledge))?$/)
  if (!match) return false
  const link = linkFromToken(match[1])
  if (!link) return gone(res), true
  const contract = contractOfLink(link)
  if (!contract) return gone(res), true
  const token = match[1]
  if (!match[2]) {
    if (req.method !== 'GET') return gone(res), true
    const key = url.searchParams.get('k')
    if (validVisit(link, key)) return send(res, 200, '車輛使用安排', contractPage(token, key, contract, url.searchParams.get('done') ? '憑證已上傳，代辦公司核對後會更新狀態。' : url.searchParams.get('ack') ? '已記錄你的確認。' : '')), true
    return send(res, 200, '核對身份', verifyForm(token)), true
  }
  if (req.method !== 'POST') return gone(res), true
  if (match[2] === 'verify') {
    if (link.locked_until && link.locked_until > now()) return send(res, 429, '請稍後再試', verifyForm(token, `嘗試次數過多，請 ${Math.ceil((Date.parse(link.locked_until) - Date.now()) / 60000)} 分鐘後再試`)), true
    const tail = new URLSearchParams(await readForm(req)).get('tail') || ''
    if (!phoneTail(contract) || tail !== phoneTail(contract)) {
      const failures = link.failures + 1
      db.prepare('UPDATE rental_links SET failures=?, locked_until=? WHERE id=?').run(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null, link.id)
      return send(res, 401, '核對身份', verifyForm(token, phoneTail(contract) ? '號碼不正確，請再試一次' : '這份安排未登記電話，請聯絡顧問')), true
    }
    db.prepare('UPDATE rental_links SET failures=0, locked_until=NULL WHERE id=?').run(link.id)
    res.writeHead(303, { location: `/r/${token}?k=${visitKey(link)}`, 'cache-control': 'no-store' }); res.end(); return true
  }
  if (match[2] === 'acknowledge') {
    const form = new URLSearchParams(await readForm(req)), key = form.get('key'), name = String(form.get('name') || '').trim().slice(0, 60)
    if (!validVisit(link, key)) return send(res, 401, '核對身份', verifyForm(token, '頁面已逾時，請重新核對')), true
    if (!name) return send(res, 400, '車輛使用安排', contractPage(token, key, contract, '!請填寫你的姓名')), true
    if (!db.prepare('SELECT 1 FROM rental_acknowledgements WHERE contract_id=?').get(contract.id)) db.prepare('INSERT INTO rental_acknowledgements(contract_id,name,acknowledged_at,ip) VALUES (?,?,?,?)').run(contract.id, name, now(), String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0])
    res.writeHead(303, { location: `/r/${token}?k=${key}&ack=1`, 'cache-control': 'no-store' }); res.end(); return true
  }
  // upload（JSON）
  let body
  try { body = JSON.parse(await readForm(req) || '{}') } catch { body = null }
  const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
  if (!body || !validVisit(link, body.key)) return reply(401, { error: '頁面已逾時，請重新打開連結並核對電話' }), true
  const invoice = db.prepare('SELECT * FROM rent_invoices WHERE id=? AND contract_id=? AND voided=0').get(String(body.invoiceId || ''), contract.id)
  if (!invoice) return reply(400, { error: '請選擇要付款的期數' }), true
  if (invoice.received_on && invoice.received_amount >= invoice.amount) return reply(409, { error: '這期已確認收到' }), true
  if (db.prepare("SELECT 1 FROM renter_uploads WHERE invoice_id=? AND status='待確認'").get(invoice.id)) return reply(409, { error: '這期已有憑證待確認' }), true
  if (!validDate(body.paidOn) || !Number.isInteger(body.amount) || body.amount <= 0) return reply(400, { error: '請填寫付款日期和金額' }), true
  const data = typeof body.data === 'string' ? Buffer.from(body.data.replace(/^data:[^,]+,/, ''), 'base64') : null
  if (!data?.length || data.length > 5 * 1024 * 1024) return reply(400, { error: '請選擇 5 MB 以內的相片或 PDF' }), true
  const mime = sniff(data); if (!mime) return reply(400, { error: '只接受 JPG、PNG 或 PDF' }), true
  db.prepare('INSERT INTO renter_uploads(id,tenant_id,contract_id,invoice_id,mime,data,amount,paid_on,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(), contract.tenant_id, contract.id, invoice.id, mime, data, body.amount, body.paidOn, '待確認', now())
  return reply(201, { ok: true }), true
}

// ── 管理端 ──
function settlementRows(tenantId, period) {
  const rows = db.prepare("SELECT i.received_amount, i.contract_id, c.currency, p.customer_id, cu.name customer_name, cu.is_self FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id JOIN plate_assets p ON p.id=c.plate_asset_id JOIN customers cu ON cu.id=p.customer_id WHERE c.tenant_id=? AND c.collection_mode='代收' AND i.received_by='代辦公司' AND i.voided=0 AND substr(i.received_on,1,7)=?").all(tenantId, period)
  const fees = db.prepare("SELECT customer_id, currency, amount FROM fee_items WHERE tenant_id=? AND kind='rent_commission' AND voided=0 AND substr(incurred_on,1,7)=?").all(tenantId, period)
  const groups = new Map()
  for (const row of rows) { if (row.is_self) continue; const key = `${row.customer_id}:${row.currency}`; const group = groups.get(key) || { customerId: row.customer_id, customerName: row.customer_name, currency: row.currency, collected: 0, fees: 0 }; group.collected += row.received_amount; groups.set(key, group) }
  for (const fee of fees) { const group = groups.get(`${fee.customer_id}:${fee.currency}`); if (group) group.fees += fee.amount }
  return [...groups.values()].map(group => {
    const settled = db.prepare('SELECT * FROM rent_settlements WHERE customer_id=? AND period=? AND currency=?').get(group.customerId, period, group.currency)
    return { ...group, period, net: group.collected - group.fees, settled: Boolean(settled), settledOn: settled?.settled_on || null, settledNet: settled?.net ?? null }
  }).sort((a, b) => a.customerName.localeCompare(b.customerName))
}

export async function renterAdminRoutes(req, res, url, user, { json, fail, parseBody }) {
  const path = url.pathname, method = req.method, tenant = user.tenant_id
  const linkMatch = path.match(/^\/api\/rental-contracts\/([^/]+)\/link$/)
  const uploadMatch = path.match(/^\/api\/renter-uploads(?:\/([^/]+)(?:\/(confirm|reject|file))?)?$/)
  if (!linkMatch && !uploadMatch && path !== '/api/rental-template' && path !== '/api/rent-settlements') return false
  if (user.role !== 'admin') return fail(res, 403, '出租與租金只限管理者'), true

  if (linkMatch) {
    const contract = contractFor(tenant, linkMatch[1])
    if (!contract) return fail(res, 404, '合約不存在'), true
    const active = db.prepare('SELECT * FROM rental_links WHERE contract_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC').get(contract.id, now())
    const ack = db.prepare('SELECT name, acknowledged_at FROM rental_acknowledgements WHERE contract_id=? ORDER BY acknowledged_at DESC').get(contract.id)
    if (method === 'GET') return json(res, 200, { active: Boolean(active), expiresAt: active?.expires_at || null, locked: Boolean(active?.locked_until && active.locked_until > now()), hasPhone: Boolean(phoneTail(contract)), acknowledgement: ack ? { name: ack.name, at: ack.acknowledged_at } : null }), true
    if (method === 'DELETE') { db.prepare('UPDATE rental_links SET revoked_at=? WHERE contract_id=? AND revoked_at IS NULL').run(now(), contract.id); return json(res, 200, { active: false }), true }
    if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
    if (!['生效', '草擬'].includes(contract.status)) return fail(res, 409, '已結束的合約不能產生連結'), true
    if (!phoneTail(contract)) return fail(res, 400, '請先在合約填寫承租方電話，連結要用電話末 4 碼核對身份'), true
    const body = await parseBody(req)
    const days = body.expiresInDays ?? 90
    if (!Number.isInteger(days) || days < 1 || days > 400) return fail(res, 400, '有效期須為 1–400 天'), true
    // 重發：舊連結全部作廢，只有最新的一條有效
    db.prepare('UPDATE rental_links SET revoked_at=? WHERE contract_id=? AND revoked_at IS NULL').run(now(), contract.id)
    const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + days * 86400000).toISOString()
    db.prepare('INSERT INTO rental_links(id,contract_id,token_hash,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?)').run(id(), contract.id, hash(token), expiresAt, user.id, now())
    const base = (process.env.PUBLIC_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`).replace(/\/$/, '')
    return json(res, 201, { url: `${base}/r/${token}`, expiresAt, note: '連結只顯示這一次；承租方打開時要輸入電話最後 4 位。' }), true
  }
  if (path === '/api/rental-template') {
    if (method === 'GET') return json(res, 200, { body: templateFor(tenant), placeholders: ['使用人', '使用車牌', '牌照', '開始日期', '結束日期', '使用費', '週期', '收款日', '押金', '收款方式'], isDefault: !db.prepare('SELECT 1 FROM rental_templates WHERE tenant_id=?').get(tenant) }), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 20000) return fail(res, 400, '範本內容不可為空，且須少於 20000 字'), true
    if (/出租|租金|租用/.test(body.body)) return fail(res, 400, '範本對外使用，請寫「車輛使用安排」「使用費」，不要寫「出租」「租金」'), true
    db.prepare('INSERT INTO rental_templates(tenant_id,body,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at').run(tenant, body.body.trim(), now())
    return json(res, 200, { body: body.body.trim() }), true
  }
  if (uploadMatch) {
    const view = row => ({ id: row.id, contractId: row.contract_id, invoiceId: row.invoice_id, period: row.period, renterName: row.renter_name, plate: row.mainland_plate || '車牌待補', currency: row.currency, invoiceAmount: row.invoice_amount, amount: row.amount, paidOn: row.paid_on, mime: row.mime, status: row.status, reviewNote: row.review_note || '', createdAt: row.created_at })
    const select = "SELECT u.*, i.period, i.amount invoice_amount, c.renter_name, c.currency, c.collection_mode, p.mainland_plate FROM renter_uploads u JOIN rent_invoices i ON i.id=u.invoice_id JOIN rental_contracts c ON c.id=u.contract_id JOIN plate_assets p ON p.id=c.plate_asset_id WHERE u.tenant_id=?"
    if (!uploadMatch[1]) {
      if (method !== 'GET') return fail(res, 405, '不支援此操作'), true
      const status = url.searchParams.get('status')
      return json(res, 200, db.prepare(`${select} ${status ? 'AND u.status=?' : ''} ORDER BY u.created_at DESC`).all(tenant, ...(status ? [status] : [])).map(view)), true
    }
    const row = db.prepare(`${select} AND u.id=?`).get(tenant, uploadMatch[1])
    if (!row) return fail(res, 404, '憑證不存在'), true
    if (uploadMatch[2] === 'file') { if (method !== 'GET') return fail(res, 405, '不支援此操作'), true; res.writeHead(200, { 'content-type': row.mime }); res.end(row.data); return true }
    if (method !== 'POST' || !uploadMatch[2]) return fail(res, 405, '不支援此操作'), true
    if (row.status !== '待確認') return fail(res, 409, '這份憑證已處理'), true
    const body = await parseBody(req)
    if (uploadMatch[2] === 'reject') {
      if (typeof body.reason !== 'string' || !body.reason.trim()) return fail(res, 400, '請寫明需要重交的原因'), true
      db.prepare("UPDATE renter_uploads SET status='需重交', review_note=?, reviewed_at=? WHERE id=?").run(body.reason.trim().slice(0, 200), now(), row.id)
      return json(res, 200, view(db.prepare(`${select} AND u.id=?`).get(tenant, row.id))), true
    }
    const invoice = db.prepare('SELECT i.*, c.collection_mode FROM rent_invoices i JOIN rental_contracts c ON c.id=i.contract_id WHERE i.id=?').get(row.invoice_id)
    if (invoice.voided) return fail(res, 409, '這期已作廢'), true
    const result = receiveInvoice(tenant, invoice, { receivedOn: body.receivedOn ?? row.paid_on, receivedAmount: body.receivedAmount ?? row.amount, proofFile: { data: row.data, mime: row.mime }, notes: '承租方上傳憑證，已核對' }, user.id)
    if (result.error) return fail(res, 400, result.error), true
    db.prepare("UPDATE renter_uploads SET status='已確認', reviewed_at=? WHERE id=?").run(now(), row.id)
    return json(res, 200, view(db.prepare(`${select} AND u.id=?`).get(tenant, row.id))), true
  }
  // 代收結算：按客戶、按月、按幣種彙總代收使用費，扣除代收服務費，得出應付客戶淨額
  if (method === 'GET') {
    const period = url.searchParams.get('period') || new Date(Date.parse(today()) - 15 * 86400000).toISOString().slice(0, 7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail(res, 400, '月份格式須為 YYYY-MM'), true
    return json(res, 200, { period, rows: settlementRows(tenant, period) }), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.period || '')) || !currencies.includes(body.currency) || !validDate(body.settledOn)) return fail(res, 400, '請填寫月份、幣種和結算日期'), true
  const row = settlementRows(tenant, body.period).find(item => item.customerId === body.customerId && item.currency === body.currency)
  if (!row) return fail(res, 404, '這位客戶這個月沒有代收使用費'), true
  if (row.settled) return fail(res, 409, '這個月已標記結算'), true
  db.prepare('INSERT INTO rent_settlements(id,tenant_id,customer_id,period,currency,collected,fees,net,settled_on,settled_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(), tenant, row.customerId, body.period, row.currency, row.collected, row.fees, row.net, body.settledOn, user.id, String(body.notes || '').slice(0, 300) || null, now())
  return json(res, 201, settlementRows(tenant, body.period).find(item => item.customerId === body.customerId && item.currency === body.currency)), true
}
