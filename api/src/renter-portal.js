import { createHash, randomBytes } from 'node:crypto'
import { db, id, now } from './db.js'
import { businessToday } from './rules.js'
import { sniff } from './client-portal.js'
import { contractFor, contractView, receiveInvoice, refreshContract, currencies, advanceClientRental, saveSignature, signatureImage, signatureOf, signatureParties } from './rentals.js'

// 出租第 B 輪（docs/tasks/rentals-brief.md）：承租方專屬連結、合約範本、承租方上傳憑證待確認、代收結算。
// 用語（管理者 2026-10-18）：對外寫「出租、租金、承租人」。承租人不登入，用連結＋電話末 4 碼。
db.exec(`CREATE TABLE IF NOT EXISTS rental_links(id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, failures INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rental_link_visits(key_hash TEXT PRIMARY KEY, link_id TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rental_acknowledgements(contract_id TEXT NOT NULL, name TEXT NOT NULL, acknowledged_at TEXT NOT NULL, ip TEXT);
CREATE TABLE IF NOT EXISTS renter_uploads(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contract_id TEXT NOT NULL, invoice_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, amount INTEGER, paid_on TEXT, note TEXT, status TEXT NOT NULL DEFAULT '待確認', review_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS rental_templates(tenant_id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rent_settlements(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, period TEXT NOT NULL, currency TEXT NOT NULL, collected INTEGER NOT NULL, fees INTEGER NOT NULL, net INTEGER NOT NULL, settled_on TEXT NOT NULL, settled_by TEXT, notes TEXT, created_at TEXT NOT NULL, UNIQUE(customer_id, period, currency));`)

// 承租人按的是哪一版協議（客戶每次「發給承租人」版本加一，要重新確認）；員工舊合約沒有版本，記 0
if (!db.prepare('PRAGMA table_info(rental_acknowledgements)').all().some(column => column.name === 'version')) db.exec('ALTER TABLE rental_acknowledgements ADD COLUMN version INTEGER NOT NULL DEFAULT 0')

const hash = value => createHash('sha256').update(String(value)).digest('hex')
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const money = (currency, value) => `${currency} ${((value || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const today = () => businessToday().toISOString().slice(0, 10)
const validDate = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value }
const MAX_FAILURES = 5, LOCK_MINUTES = 30
// 舊範本：2026-10-18 前員工發出、承租人已確認的確認書照舊顯示，不換成新協議
const legacyTemplate = `車輛使用安排確認書

使用人：{{使用人}}
使用車輛：{{使用車牌}}
兩地牌：{{牌照}}
使用期間：{{開始日期}} 至 {{結束日期}}
使用費：{{使用費}}，{{週期}}，每期 {{收款日}} 日前支付
押金：{{押金}}
付款方式：{{收款方式}}

雙方確認上述安排。使用人須遵守兩地車輛管理的相關規定，並按時支付使用費。`
// 員工發出的出租確認書（後台「合約範本」可改）：不寫牌主名稱，只把用字改為出租、租金、承租人（管理者 2026-10-18）
export const defaultTemplate = `出租確認書

承租人：{{承租人}}
使用車輛：{{使用車輛}}
兩地牌：{{牌照}}
租期：{{開始日期}} 至 {{結束日期}}
租金：{{租金}}，{{週期}}，每期 {{收款日}} 日前支付
押金：{{押金}}
付款方式：{{收款方式}}

雙方確認上述出租安排。承租人須遵守兩地車輛管理的相關規定，並按時支付租金。`
// 客戶自行新增出租用的協議（docs/tasks/rental-agreement-draft.md，負責人初稿；管理者提供參考範本後再改）。
// 協議雙方是客戶與承租人，所以寫明出租人；客戶可逐份修改，發出時鎖定版本
export const agreementTemplate = `兩地牌照出租協議

協議編號：{{協議編號}}　簽署日期：{{簽署日期}}

出租人：{{出租人}}（{{出租人身份}}）
承租人：{{承租人}}　證件號碼：{{承租人證件}}　聯絡電話：{{承租人電話}}

一、出租內容
1. 出租人同意把以下兩地牌照的使用權出租給承租人：兩地牌照 {{牌照}}（批文卡編號 {{批文卡編號}}），持牌公司 {{持牌公司}}。
2. 承租人使用的車輛：{{使用車輛}}；指定司機：{{司機}}。
3. 批文、批文卡及持牌公司始終屬於出租人。承租人只取得本協議期內的使用權，不得轉租、轉借或以任何方式讓第三者使用。

二、租期
1. 由 {{開始日期}} 至 {{結束日期}}。
2. 如須把承租人的車輛或司機登記到批文上，租期由手續辦妥、承租人可以使用之日起計；辦妥前不收租金。

三、租金及付款
1. 租金為 {{租金}}，{{週期}}繳付，每期於 {{收款日}} 日或之前付清。
2. 付款方式：{{收款方式}}。
3. 租金逾期 7 日仍未付清，出租人可以書面通知終止本協議，並按第八條處理。

四、押金
1. 承租人簽署本協議時支付押金 {{押金}}。
2. 協議終止、承租人履行第九條後 14 日內，出租人退回押金；可先扣除承租人未付的租金、罰款及按本協議應由承租人承擔的費用，並列明扣除項目。

五、換車、換司機手續
1. 把承租人的車輛或司機登記到批文上、以及協議終止後換回的手續，由 {{手續辦理方}} 辦理。
2. 官方收費及代辦費用由 {{手續費用承擔方}} 承擔。
3. 承租人須按要求提供辦手續所需的證件及資料，並配合驗車、拍照、簽署等安排。

六、承租人責任
1. 遵守內地、香港及澳門的交通、海關、邊檢及出入境法規，只作合法用途。
2. 使用期內的交通違例罰款、扣分、海關或邊檢處罰，以及因承租人或其司機的行為引起的一切後果，由承租人承擔；出租人因此受到的損失，承租人須全數賠償。
3. 不得利用車輛運載違禁品、走私或從事任何違法活動。如發生，出租人可即時終止本協議，押金不退，並保留追究的權利。
4. 承租人須自費為使用的車輛購買並維持有效的港澳車輛保險及內地交強險，保單須涵蓋整個租期。
5. 出租人或其代辦人通知要辦理年審、續期、備案等手續時，承租人須在通知的期限內配合。

七、出租人責任
1. 在租期內保持批文有效、持牌公司正常存續，並按時辦理續期、年審等手續（可委託代辦公司辦理）。
2. 如批文被取消、不能續期，或持牌公司不能維持，出租人須盡快通知承租人。這種情況下本協議自動終止，出租人按日退回已付但未使用的租金及押金，不另作賠償。

八、提前終止
1. 任何一方可以提前 {{通知期}} 日以書面（包括 WhatsApp、微信或電郵）通知對方終止本協議。
2. 承租人違反第三條第 3 款或第六條，出租人可以即時書面通知終止。
3. 提前終止時，已付租金按日計算多退少補。

九、協議終止後
1. 承租人須在終止後 7 日內配合辦理換回車輛及司機的手續，並交還出租人提供的證件、批文卡或其他物品。
2. 換回手續辦妥前，承租人仍須遵守第六條。

十、代辦公司
出租人可以委託 {{代辦公司}} 代辦本協議涉及的手續或代收租金。代辦公司只按出租人的委託行事，不是本協議的一方，不承擔本協議下出租人或承租人的責任。

十一、個人資料
承租人同意出租人及其代辦公司為履行本協議（包括辦理換車、換司機及收租）使用承租人提供的個人資料。

十二、其他
1. 本協議受香港特別行政區法律管轄。因本協議引起的爭議，雙方先友好協商；協商不成的，交由香港法院處理。
2. 本協議的修改須經雙方書面同意。
3. 承租人在網上確認本協議，與簽署具同等效力。雙方亦可另行簽署紙本，紙本與網上確認的版本內容須一致。`
export const agreementPlaceholders = ['協議編號', '簽署日期', '出租人', '出租人身份', '承租人', '承租人證件', '承租人電話', '牌照', '批文卡編號', '持牌公司', '使用車輛', '司機', '開始日期', '結束日期', '租金', '週期', '收款日', '押金', '收款方式', '手續辦理方', '手續費用承擔方', '通知期', '代辦公司']
// 時間以香港時間顯示（伺服器存 UTC；香港沒有夏令時間）
const hkTime = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
const cycleWord = { monthly: '每月', quarterly: '每季', yearly: '每年' }

// 協議裏的資料：出租人（客戶本人或其香港／澳門公司）、持牌公司（公司組裏的香港／澳門公司，沒有就用批文卡上的商號）
function agreementValues(contract, view) {
  const plate = db.prepare('SELECT p.*, c.name customer_name, c.kind customer_kind FROM plate_assets p JOIN customers c ON c.id=p.customer_id WHERE p.id=?').get(contract.plate_asset_id) || {}
  const card = (() => { try { return JSON.parse(plate.card_data || '{}') } catch { return {} } })()
  const holder = plate.group_id ? db.prepare("SELECT name FROM companies WHERE group_id=? AND jurisdiction IN ('香港','澳門') AND COALESCE(status,'存續')<>'已註銷' ORDER BY jurisdiction").get(plate.group_id)?.name : ''
  const lessorCompany = contract.lessor_type === 'company' ? db.prepare('SELECT name, jurisdiction FROM companies WHERE id=?').get(contract.lessor_company_id) : null
  const procedures = db.prepare('SELECT handler FROM rental_procedures WHERE contract_id=?').all(contract.id)
  const company = db.prepare('SELECT name FROM tenants WHERE id=?').get(contract.tenant_id)?.name || '代辦公司'
  const money_ = amount => money(view.currency, amount)
  return {
    協議編號: contract.id.slice(0, 8).toUpperCase(), 簽署日期: today(),
    出租人: lessorCompany?.name || plate.customer_name || '', 出租人身份: lessorCompany ? `${lessorCompany.jurisdiction}公司` : plate.customer_kind === '公司' ? '公司' : '個人',
    承租人: view.renter.name, 承租人證件: contract.renter_id_no || '＿＿＿＿', 承租人電話: view.renter.phone || '＿＿＿＿',
    牌照: view.plateLabel, 批文卡編號: plate.card_number || '＿＿＿＿', 持牌公司: holder || card.company || '＿＿＿＿',
    使用車輛: view.renter.vehiclePlate || '＿＿＿＿', 司機: view.renter.driver || '＿＿＿＿',
    開始日期: view.startsOn, 結束日期: view.endsOn || '雙方另行約定', 租金: money_(view.rentAmount), 週期: cycleWord[view.cycle] || view.cycle, 收款日: String(view.dueDay), 押金: money_(view.depositAmount),
    收款方式: view.collectionMode === '代收' ? `付給代辦公司 ${company}` : '直接付給出租人',
    手續辦理方: procedures.some(item => item.handler === 'us') || contract.handling === 'agent' ? `出租人委託的代辦公司 ${company}` : '出租人', 手續費用承擔方: '承租人', 通知期: '30', 代辦公司: company,
    // 舊範本的佔位
    使用人: view.renter.name, 使用車牌: view.renter.vehiclePlate || '待補充', 使用費: money_(view.rentAmount)
  }
}
export function fillTemplate(body, contract, view = contractView(contract)) {
  const values = agreementValues(contract, view)
  return body.replace(/\{\{(.+?)\}\}/g, (_, key) => values[key.trim()] ?? `{{${key}}}`)
}
export const templateFor = tenantId => db.prepare('SELECT body FROM rental_templates WHERE tenant_id=?').get(tenantId)?.body || defaultTemplate
// 承租人看到的內容：客戶發出的協議（鎖定版本）；員工合約已確認的照舊顯示當時的確認書；其餘用後台的確認書範本
function agreementText(contract, view) {
  if (contract.agreement_version > 0) return contract.agreement_sent_body
  const custom = db.prepare('SELECT 1 FROM rental_templates WHERE tenant_id=?').get(contract.tenant_id)
  const acknowledged = db.prepare('SELECT 1 FROM rental_acknowledgements WHERE contract_id=?').get(contract.id)
  return fillTemplate(!custom && acknowledged ? legacyTemplate : templateFor(contract.tenant_id), contract, view)
}

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
pre{white-space:pre-wrap;font-family:inherit;margin:0}.signs{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;padding-top:12px;border-top:1px solid var(--rule)}.sign{flex:1;min-width:200px}.sign img{display:block;width:100%;max-width:280px;height:auto;margin:4px 0;border-bottom:1px solid var(--ink2)}.sign-blank{height:72px;margin:4px 0;border-bottom:1px solid var(--ink2)}.pad{margin-top:4px;border:1px solid var(--rule);border-radius:8px;background:#fff;touch-action:none}.pad canvas{display:block;width:100%;height:160px}.pad-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px}.pad-row button{width:auto;margin:0;padding:6px 14px}@media print{.noprint{display:none}body{background:#fff}.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">${body}</div></body></html>`
const send = (res, status, title, body) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }); res.end(page(title, body)) }
const gone = res => send(res, 404, '連結無效', '<div class="card"><h1 style="color:var(--jade-deep)">連結無效或已過期</h1><p class="muted">請聯絡出租人，索取新的連結。</p></div>')

function verifyForm(token, message = '') {
  return `<div class="head"><div class="kicker">出租</div><h1>請先核對身份</h1><div>輸入你登記的電話號碼最後 4 位數字</div></div>
<form class="card" method="post" action="/r/${token}/verify"><label for="tail">電話最後 4 位</label><input id="tail" name="tail" type="tel" inputmode="numeric" maxlength="4" pattern="\\d{4}" required autofocus>${message ? `<p class="error">${html(message)}</p>` : ''}<button type="submit">繼續</button></form>`
}
// 協議下方的簽署欄：出租人、承租人各一；未簽留空線，列印後也可以手簽
function signatureBlock(contract) {
  return `<div class="signs">${Object.entries(signatureParties).map(([party, label]) => { const sign = signatureOf(contract, party); return `<div class="sign"><span class="muted">${label}簽署</span>${sign ? `<img alt="${label}簽名" src="data:image/png;base64,${Buffer.from(sign.data).toString('base64')}"><span class="muted">${html(sign.signer_name)} · ${html(hkTime(sign.signed_at))}</span>` : '<div class="sign-blank"></div><span class="muted">未簽</span>'}</div>` }).join('')}</div>`
}
// 承租人手寫簽名框（手指或滑鼠）；提交時轉成 PNG 放進表單
const signaturePad = () => `<label>你的簽名</label><div class="pad"><canvas id="pad"></canvas></div><div class="pad-row"><span class="muted">請用手指或滑鼠在框內簽名</span><button type="button" class="secondary" onclick="clearPad()">重簽</button></div><input type="hidden" name="signature" id="signature">
<script>
const pad=document.getElementById('pad'),ctx=pad.getContext('2d');let drawing=false,strokes=0
function fit(){const r=pad.getBoundingClientRect(),d=window.devicePixelRatio||1;pad.width=r.width*d;pad.height=r.height*d;ctx.scale(d,d);ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#14201B';strokes=0}
fit()
const at=e=>{const r=pad.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]}
pad.addEventListener('pointerdown',e=>{drawing=true;pad.setPointerCapture(e.pointerId);const[x,y]=at(e);ctx.beginPath();ctx.moveTo(x,y);e.preventDefault()})
pad.addEventListener('pointermove',e=>{if(!drawing)return;const[x,y]=at(e);ctx.lineTo(x,y);ctx.stroke();e.preventDefault()})
pad.addEventListener('pointerup',()=>{if(drawing)strokes++;drawing=false})
function clearPad(){ctx.clearRect(0,0,pad.width,pad.height);strokes=0}
function signed(e){if(!strokes){alert('請先在框內簽名');e.preventDefault();return false}document.getElementById('signature').value=pad.toDataURL('image/png');return true}
</script>`
function contractPage(token, key, contract, notice = '') {
  const view = contractView(contract)
  // 客戶發出的協議要按最新版本確認；員工舊合約沒有版本
  const ack = db.prepare('SELECT * FROM rental_acknowledgements WHERE contract_id=? AND version=? ORDER BY acknowledged_at DESC').get(contract.id, contract.agreement_version || 0)
  const uploads = db.prepare('SELECT invoice_id, status, review_note FROM renter_uploads WHERE contract_id=? ORDER BY created_at DESC').all(contract.id)
  const invoices = view.invoices.filter(item => item.status !== '作廢')
  const rows = invoices.map(item => {
    const upload = uploads.find(row => row.invoice_id === item.id)
    const state = item.status === '已收' ? ['', '已確認收到'] : upload?.status === '待確認' ? ['amber', '憑證已上傳，待確認'] : upload?.status === '需重交' ? ['red', `憑證需重交：${upload.review_note || ''}`] : item.status === '逾期' ? ['red', '未付（已過期）'] : item.status === '部分收' ? ['amber', '部分已付'] : ['gray', '未到期']
    const canUpload = item.status !== '已收' && upload?.status !== '待確認'
    return `<div class="row"><div><b class="period num">${html(item.period)}</b><span class="due num">付款期限 ${html(item.dueOn)} · ${money(view.currency, item.amount)}</span></div><div class="status"><span class="pill ${state[0]}">${html(state[1])}</span>${canUpload ? `<div class="noprint"><a href="#upload" onclick="document.getElementById('invoice').value='${item.id}'">上傳轉帳憑證</a></div>` : ''}</div></div>`
  }).join('')
  const firstOpen = invoices.find(item => item.status !== '已收')
  return `<div class="head"><div class="kicker">出租</div><h1>${html(view.plateLabel)}</h1><div>${html(view.renter.name)} · ${html(view.startsOn)} 起${view.endsOn ? ` 至 ${html(view.endsOn)}` : ''}</div></div>
${notice ? `<div class="card ${notice.startsWith('!') ? 'error' : 'ok'}">${html(notice.replace(/^!/, ''))}</div>` : ''}
<div class="card"><div class="row"><span class="muted">租金</span><b class="num">${money(view.currency, view.rentAmount)} · ${cycleWord[view.cycle]}</b></div><div class="row"><span class="muted">每期付款期限</span><b>${view.dueDay} 日</b></div><div class="row"><span class="muted">付款方式</span><b>${view.collectionMode === '代收' ? '付給代辦公司' : '直接付給出租人'}</b></div></div>
<h2>各期租金</h2><div class="card">${rows || `<p class="muted">${contract.status === '生效' ? '暫時沒有租金記錄' : '開始出租後會在這裏列出各期租金。'}</p>`}</div>
${invoices.some(item => item.status !== '已收') ? `<h2 id="upload" class="noprint">上傳轉帳憑證</h2>
<form class="card noprint" onsubmit="return upload(event)"><label for="invoice">付款期數</label><select id="invoice" style="width:100%;padding:10px;border:1px solid var(--rule);border-radius:8px">${invoices.filter(item => item.status !== '已收').map(item => `<option value="${item.id}"${item.id === firstOpen?.id ? ' selected' : ''}>${html(item.period)}（${money(view.currency, item.amount)}）</option>`).join('')}</select>
<label for="paid">付款日期</label><input id="paid" type="date" value="${today()}" required><label for="amount">付款金額（${view.currency}）</label><input id="amount" type="number" step="0.01" min="0.01" value="${firstOpen ? (firstOpen.amount / 100).toFixed(2) : ''}" required>
<label for="file">轉帳憑證（相片或 PDF，5 MB 以內）</label><input id="file" type="file" accept="image/png,image/jpeg,application/pdf" required><p id="msg" class="muted">上傳後由代辦公司核對，確認後狀態會改為「已確認收到」。</p><button type="submit">上傳</button></form>` : ''}
<h2>出租協議${contract.agreement_version > 0 ? `（第 ${contract.agreement_version} 版）` : ''}</h2><div class="card"><pre>${html(agreementText(contract, view))}</pre>${contract.agreement_version > 0 ? signatureBlock(contract) : ''}<p class="muted noprint">這份頁面可以列印保存。</p><button class="secondary noprint" type="button" onclick="print()">列印</button></div>
<h2 class="noprint">確認內容</h2>${ack ? `<div class="card ok">已由 ${html(ack.name)} 於 ${html(hkTime(ack.acknowledged_at))} ${contract.agreement_version > 0 ? `同意這份協議（第 ${contract.agreement_version} 版）` : '確認已閱讀'}。</div>` : `<form class="card noprint" method="post" action="/r/${token}/acknowledge"${contract.agreement_version > 0 ? ' onsubmit="return signed(event)"' : ''}><input type="hidden" name="key" value="${key}"><label for="name">你的姓名</label><input id="name" name="name" type="text" maxlength="60" required>${contract.agreement_version > 0 ? signaturePad() : ''}<p class="muted">${contract.agreement_version > 0 ? '按下按鈕代表你已閱讀並同意上述協議；按協議第十二條，網上確認與簽署具同等效力。' : '按下按鈕代表你已閱讀並確認上述內容。這不是電子簽署。'}</p><button type="submit">${contract.agreement_version > 0 ? '我同意這份協議' : '我已閱讀並確認'}</button></form>`}
<p class="muted" style="margin-top:24px">如有疑問，請聯絡出租人。這個連結只供你本人使用，請勿轉發。</p>
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
    if (validVisit(link, key)) return send(res, 200, '出租', contractPage(token, key, contract, url.searchParams.get('done') ? '憑證已上傳，核對後會更新狀態。' : url.searchParams.get('ack') ? '已記錄你的確認。' : '')), true
    return send(res, 200, '核對身份', verifyForm(token)), true
  }
  if (req.method !== 'POST') return gone(res), true
  if (match[2] === 'verify') {
    if (link.locked_until && link.locked_until > now()) return send(res, 429, '請稍後再試', verifyForm(token, `嘗試次數過多，請 ${Math.ceil((Date.parse(link.locked_until) - Date.now()) / 60000)} 分鐘後再試`)), true
    const tail = new URLSearchParams(await readForm(req)).get('tail') || ''
    if (!phoneTail(contract) || tail !== phoneTail(contract)) {
      const failures = link.failures + 1
      db.prepare('UPDATE rental_links SET failures=?, locked_until=? WHERE id=?').run(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null, link.id)
      return send(res, 401, '核對身份', verifyForm(token, phoneTail(contract) ? '號碼不正確，請再試一次' : '這份出租未登記電話，請聯絡出租人')), true
    }
    db.prepare('UPDATE rental_links SET failures=0, locked_until=NULL WHERE id=?').run(link.id)
    res.writeHead(303, { location: `/r/${token}?k=${visitKey(link)}`, 'cache-control': 'no-store' }); res.end(); return true
  }
  if (match[2] === 'acknowledge') {
    const form = new URLSearchParams(await readForm(req)), key = form.get('key'), name = String(form.get('name') || '').trim().slice(0, 60)
    if (!validVisit(link, key)) return send(res, 401, '核對身份', verifyForm(token, '頁面已逾時，請重新核對')), true
    if (!name) return send(res, 400, '出租', contractPage(token, key, contract, '!請填寫你的姓名')), true
    const version = contract.agreement_version || 0
    // 客戶發出的協議要手寫簽名（管理者 2026-10-18）
    const image = version > 0 ? signatureImage(form.get('signature')) : null
    if (version > 0 && !image) return send(res, 400, '出租', contractPage(token, key, contract, '!請在簽名框內簽名')), true
    if (image && !signatureOf(contract, 'renter')) saveSignature(contract, 'renter', name, image, String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0])
    if (!db.prepare('SELECT 1 FROM rental_acknowledgements WHERE contract_id=? AND version=?').get(contract.id, version)) db.prepare('INSERT INTO rental_acknowledgements(contract_id,name,acknowledged_at,ip,version) VALUES (?,?,?,?,?)').run(contract.id, name, now(), String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0], version)
    // 客戶新增的出租：確認後轉為待換車或出租中
    advanceClientRental(db.prepare('SELECT * FROM rental_contracts WHERE id=?').get(contract.id))
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

// 產生承租人連結（管理端、客戶發出協議共用）：舊連結全部作廢，只有最新的一條有效；連結只顯示這一次
export function issueRenterLink(contract, userId, req, days = 90) {
  db.prepare('UPDATE rental_links SET revoked_at=? WHERE contract_id=? AND revoked_at IS NULL').run(now(), contract.id)
  const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + days * 86400000).toISOString()
  db.prepare('INSERT INTO rental_links(id,contract_id,token_hash,expires_at,created_by,created_at) VALUES (?,?,?,?,?,?)').run(id(), contract.id, hash(token), expiresAt, userId, now())
  const base = (process.env.PUBLIC_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`).replace(/\/$/, '')
  return { url: `${base}/r/${token}`, expiresAt }
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
    const { url: linkUrl, expiresAt } = issueRenterLink(contract, user.id, req, days)
    return json(res, 201, { url: linkUrl, expiresAt, note: '連結只顯示這一次；承租方打開時要輸入電話最後 4 位。' }), true
  }
  if (path === '/api/rental-template') {
    if (method === 'GET') return json(res, 200, { body: templateFor(tenant), placeholders: ['承租人', '使用車輛', '牌照', '開始日期', '結束日期', '租金', '週期', '收款日', '押金', '收款方式'], isDefault: !db.prepare('SELECT 1 FROM rental_templates WHERE tenant_id=?').get(tenant) }), true
    if (method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 20000) return fail(res, 400, '範本內容不可為空，且須少於 20000 字'), true
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
  // 代收結算：按客戶、按月、按幣種彙總代收租金，扣除代收服務費，得出應付客戶淨額
  if (method === 'GET') {
    const period = url.searchParams.get('period') || new Date(Date.parse(today()) - 15 * 86400000).toISOString().slice(0, 7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail(res, 400, '月份格式須為 YYYY-MM'), true
    return json(res, 200, { period, rows: settlementRows(tenant, period) }), true
  }
  if (method !== 'POST') return fail(res, 405, '不支援此操作'), true
  const body = await parseBody(req)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.period || '')) || !currencies.includes(body.currency) || !validDate(body.settledOn)) return fail(res, 400, '請填寫月份、幣種和結算日期'), true
  const row = settlementRows(tenant, body.period).find(item => item.customerId === body.customerId && item.currency === body.currency)
  if (!row) return fail(res, 404, '這位客戶這個月沒有代收租金'), true
  if (row.settled) return fail(res, 409, '這個月已標記結算'), true
  db.prepare('INSERT INTO rent_settlements(id,tenant_id,customer_id,period,currency,collected,fees,net,settled_on,settled_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(), tenant, row.customerId, body.period, row.currency, row.collected, row.fees, row.net, body.settledOn, user.id, String(body.notes || '').slice(0, 300) || null, now())
  return json(res, 201, settlementRows(tenant, body.period).find(item => item.customerId === body.customerId && item.currency === body.currency)), true
}
