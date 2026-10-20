import { db, id, now } from './db.js'

// 服務條款及私隱聲明（管理者 2026-10-17）：管理者在後台編輯並「發佈新版本」，選擇「提示」或「強制」：
// 提示＝客戶登入後彈出通知，可稍後再看；強制＝未同意最新版本前，客戶帳戶只能看條款、同意、改密碼或登出。
// 每個帳戶同意哪一版、甚麼時候同意都記下來。條文由負責人按系統實際做法起草，正式生效前須由律師審閱。
db.exec(`CREATE TABLE IF NOT EXISTS terms_versions(tenant_id TEXT NOT NULL, version INTEGER NOT NULL, terms TEXT NOT NULL, privacy TEXT NOT NULL, published_at TEXT NOT NULL, published_by TEXT, PRIMARY KEY(tenant_id, version));
CREATE TABLE IF NOT EXISTS terms_acceptances(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, customer_id TEXT, version INTEGER NOT NULL, accepted_at TEXT NOT NULL, ip TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptance ON terms_acceptances(user_id, version);
CREATE TABLE IF NOT EXISTS terms_settings(tenant_id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'prompt', updated_at TEXT);`)
// 同意方式另存一表，不在 tenants 加欄（有程式以固定欄數新增租戶）

export const termsModes = { prompt: '提示', force: '強制' }
const PLACEHOLDER = '【請填寫'
const MAX_TEXT = 20000

// 初稿：按系統實際做法寫；【請填寫…】的地方發佈前必須改好。{公司名稱} 顯示時換成「設定 › 我的帳號」裏的公司名稱。
export const defaultTerms = `一、適用範圍
「車牌管家」客戶端由{公司名稱}（一間於香港註冊成立的有限公司，下稱「我們」）提供，讓你查看及更新名下兩地牌、公司、車輛、司機的資料、到期提醒和辦理進度。使用客戶端即表示你同意本條款。

二、帳戶
1. 帳戶由你的顧問開通，或由你在客戶端申請、經我們聯絡你核實手機號碼後批准開通。請妥善保管密碼，不要交給他人使用；以你的帳戶作出的操作，視為你本人作出。
2. 發現帳戶被他人使用，請立即通知我們。
3. 沒有委託我們長期代辦的客戶，可以在客戶端「我的資料」自行注銷帳戶；注銷後帳戶和資料即時刪除，不能復原（詳見私隱聲明第五條）。已委託我們長期代辦的客戶，要終止服務及注銷帳戶，請聯絡你的顧問。

三、你提供的資料
1. 你在客戶端修改的資料會立即生效。由我們代辦事項的客戶，我們的顧問其後會對照原件核對；核對發現不符時，我們可以改回並通知你。
2. 你須確保提供的資料和上傳的文件真實、準確、完整，並有權提供。

四、自行辦理的變更
1. 你自行辦理（不經我們代辦）的換車、續期、換司機、口岸變更、商號變更、批文卡補領、驗車、備案等，須在辦好後 7 天內在客戶端更新，並上傳新批文卡或相關證明。
2. 未有及時或準確更新而引致的提醒錯誤、延誤或其他後果，由你自行負責。

五、到期提醒
1. 到期日按你和我們記錄的資料推算，提醒只作協助，不代替有關政府部門的通知或規定；官方規定以有關部門公布為準。
2. 標示「自行辦理」的事項由你負責辦理，我們只作提醒。

六、委託服務及收費
1. 我們只負責你委託我們辦理的事項；委託內容、收費及付款安排，以雙方另行確認的報價或協議為準。客戶端顯示的「由 HK$… 起」只供參考，實價由我們確認。
2. 年費包含的事項由你自行辦理時，我們只作記錄，不會因此扣減費用。
3. 你在客戶端標記某牌照「不再續期」後，該牌照停止到期提醒；我們確認後再作處理。
4. 沒有委託我們代辦的客戶，現時可免費使用客戶端管理自己的資料；日後如要收費，我們會預先通知。

七、服務變更及終止
我們可以更新或調整客戶端的功能；如你違反本條款或不當使用客戶端，我們可以暫停或停用你的帳戶。

八、條款修訂
我們修訂本條款後，會在客戶端通知你；按我們的設定，你可能須同意最新版本才可繼續使用。

九、適用法律
本條款受香港特別行政區法律管轄。因本條款引起的爭議，雙方先友好協商；協商不成的，交由香港法院處理。

十、聯絡我們
如有任何查詢：已委託我們代辦的客戶，請聯絡你的顧問；其他客戶，請在客戶端「我的 › 聯絡我們」發訊息給我們。`

export const defaultPrivacy = `本聲明說明{公司名稱}（一間於香港註冊成立的有限公司，下稱「我們」）如何收集、使用及保護你的個人資料。就《個人資料（私隱）條例》而言，我們是你的個人資料的資料使用者。

一、我們收集的資料
1. 帳戶資料：姓名或稱呼、手機號碼、電郵；在客戶端申請使用時提供的資料。
2. 牌照及公司資料：批文卡內容及相片、兩地牌號碼、公司名稱及登記資料。
3. 車輛資料：車牌、品牌型號、車架號碼、首次登記日期、保險及證件到期日。
4. 司機資料：姓名、電話、香港身份證號碼（只保存最後 4 個字元）、回鄉證號碼、證件到期日。
5. 你上傳的證明相片（例如行車證、保險單、檢驗標誌、備案回執）。
6. 使用記錄：登入時間、你在客戶端作出的修改及其改前改後內容。
7. 你在客戶端發給我們的訊息；注銷帳戶時你選填的原因。

二、使用目的
提供到期提醒、代辦你委託的事項、核對資料、發送通知和月報，以及處理收費。我們不會把你的資料用於與上述無關的目的，也不會出售你的資料。

三、誰可以看到你的資料
只有你本人及{公司名稱}負責你事務的員工。為辦理你委託的事項，我們可能須向有關政府部門，或經你同意的合作機構（例如會計公司）提供所需資料。

四、資料存放及保安
資料存放在位於香港的雲端伺服器（Google Cloud 香港區），並定期備份。我們採用加密連線、密碼保護、登入失敗次數限制及按職責分配的存取權限保護你的資料。
你的登入密碼另以加密方式保存一份，只有{公司名稱}的管理者在協助你登入時可以查看，每次查看都有記錄。請不要使用你在其他網站或服務用的密碼。

五、保存期限及刪除
1. 在你使用服務期間保存；你的修改記錄會保留作核對依據。
2. 沒有委託我們長期代辦的客戶，可以在「我的資料」自行注銷帳戶。注銷後，帳戶、牌照、公司、車輛、司機、批文卡及證件相片、訊息和修改記錄即時刪除，不能復原；曾經付費的按次委託，只保留法律要求的收費記錄（服務名稱、金額、日期），不含你的個人資料。
3. 未獲批准的使用申請，在 30 天後刪除。
4. 已刪除的資料仍會留在備份中，直至備份按週期（35 天）自然清除；備份只用作災難復原。
5. 已委託我們長期代辦的客戶，服務結束後按法律要求及處理爭議所需的期限保存，期滿後刪除或匿名化。

六、你的權利
你可以查閱及更正你的個人資料；大部分資料可在客戶端自行修改。如需查閱、更正或查詢，已委託我們代辦的客戶請聯絡你的顧問，其他客戶請在客戶端「我的 › 聯絡我們」發訊息給我們，並註明「私隱查詢」。
本聲明按香港《個人資料（私隱）條例》制定；涉及內地個人信息時，亦按《中華人民共和國個人信息保護法》處理。

七、聲明修訂
我們修訂本聲明後，會在客戶端通知你。`

const one = (sql, ...params) => db.prepare(sql).get(...params)
const all = (sql, ...params) => db.prepare(sql).all(...params)
const tenantName = tenantId => one('SELECT name FROM tenants WHERE id=?', tenantId)?.name || '本公司'
const fill = (text, tenantId) => String(text).replaceAll('{公司名稱}', tenantName(tenantId))
const current = tenantId => one('SELECT * FROM terms_versions WHERE tenant_id=? ORDER BY version DESC LIMIT 1', tenantId) || null
const modeOf = tenantId => one('SELECT mode FROM terms_settings WHERE tenant_id=?', tenantId)?.mode === 'force' ? 'force' : 'prompt'
const versionView = (row, tenantId) => row ? { version: row.version, terms: fill(row.terms, tenantId), privacy: fill(row.privacy, tenantId), publishedAt: row.published_at } : null
const accepted = (userId, version) => one('SELECT accepted_at FROM terms_acceptances WHERE user_id=? AND version=?', userId, version)?.accepted_at || null

// 強制模式下，未同意最新版本的客戶帳戶只能用這些接口
// 不同意新條款的客戶也可以注銷帳號
const openPaths = new Set(['/api/me', '/api/me/password', '/api/my/terms', '/api/my/terms/accept', '/api/my/account/close'])
export function termsGate(user, path) {
  if (user.role !== 'customer' || openPaths.has(path) || modeOf(user.tenant_id) !== 'force') return null
  const latest = current(user.tenant_id)
  if (!latest || accepted(user.id, latest.version)) return null
  return { error: '請先閱讀並同意最新的服務條款及私隱聲明', code: 'TERMS_REQUIRED', version: latest.version }
}

// 未登入也可看（登入頁連結；日後自助註冊用）：只有一個租戶時看本公司的條款
export async function publicTermsRoutes(req, res, url, { json, fail }) {
  if (url.pathname !== '/api/public/terms') return false
  if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
  const tenantId = process.env.DEFAULT_TENANT_ID || 'default'
  const latest = current(tenantId)
  return latest ? json(res, 200, versionView(latest, tenantId)) : fail(res, 404, '服務條款尚未發佈'), true
}

export async function termsRoutes(req, res, url, user, { json, fail, parseBody, clientIp }) {
  const path = url.pathname, tenantId = user.tenant_id
  // 客戶：看最新版本、同意
  if (path === '/api/my/terms' || path === '/api/my/terms/accept') {
    if (user.role !== 'customer') return fail(res, 403, '此功能只供客戶使用'), true
    const latest = current(tenantId)
    if (path === '/api/my/terms') {
      if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
      if (!latest) return json(res, 200, { mode: modeOf(tenantId), published: false }), true
      const acceptedAt = accepted(user.id, latest.version)
      // everAccepted：曾同意過任何一版；沒有的是新客戶，提示寫「請先閱讀」而不是「已更新」
      const everAccepted = !!one('SELECT 1 FROM terms_acceptances WHERE user_id=? LIMIT 1', user.id)
      return json(res, 200, { mode: modeOf(tenantId), published: true, ...versionView(latest, tenantId), accepted: !!acceptedAt, acceptedAt, everAccepted }), true
    }
    if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
    const body = await parseBody(req)
    if (!latest) return fail(res, 404, '服務條款尚未發佈'), true
    if (!Number.isInteger(body.version)) return fail(res, 400, '請指明同意的版本'), true
    if (body.version !== latest.version) return fail(res, 409, '條款已更新，請重新閱讀最新版本'), true
    db.prepare('INSERT OR IGNORE INTO terms_acceptances(id,tenant_id,user_id,customer_id,version,accepted_at,ip) VALUES (?,?,?,?,?,?,?)').run(id(), tenantId, user.id, user.customer_id, latest.version, now(), clientIp(req))
    return json(res, 200, { version: latest.version, acceptedAt: accepted(user.id, latest.version) }), true
  }
  // 後台：設定、發佈、同意記錄
  if (path !== '/api/terms' && path !== '/api/terms/mode' && path !== '/api/terms/publish') return false
  if (!['admin', 'staff'].includes(user.role)) return fail(res, 403, '無權限'), true
  if (path === '/api/terms') {
    if (req.method !== 'GET') return fail(res, 405, '不支援此操作'), true
    const latest = current(tenantId)
    const accounts = all("SELECT u.id, u.name, u.phone, u.email, u.active, c.name customer_name FROM users u JOIN customers c ON c.id=u.customer_id WHERE u.role='customer' AND u.tenant_id=? ORDER BY c.name, u.name", tenantId)
    const records = new Map(all('SELECT user_id, version, accepted_at FROM terms_acceptances WHERE tenant_id=? ORDER BY version', tenantId).map(row => [row.user_id, row]))
    return json(res, 200, {
      mode: modeOf(tenantId), tenantName: tenantName(tenantId),
      current: latest ? { version: latest.version, terms: latest.terms, privacy: latest.privacy, publishedAt: latest.published_at, publishedBy: latest.published_by } : null,
      draft: latest ? { terms: latest.terms, privacy: latest.privacy } : { terms: defaultTerms, privacy: defaultPrivacy },
      accounts: accounts.map(account => { const record = records.get(account.id); return { id: account.id, name: account.name, customerName: account.customer_name, login: account.phone || account.email || '', active: !!account.active, acceptedVersion: record?.version || null, acceptedAt: record?.accepted_at || null, current: !!latest && record?.version === latest.version } })
    }), true
  }
  if (req.method !== 'PUT' && req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (user.role !== 'admin') return fail(res, 403, '只有管理者可修改服務條款設定'), true
  const body = await parseBody(req)
  if (path === '/api/terms/mode') {
    if (req.method !== 'PUT') return fail(res, 405, '不支援此操作'), true
    if (!termsModes[body.mode]) return fail(res, 400, '請選擇「提示」或「強制」'), true
    db.prepare('INSERT INTO terms_settings(tenant_id,mode,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at').run(tenantId, body.mode, now())
    return json(res, 200, { mode: body.mode }), true
  }
  if (req.method !== 'POST') return fail(res, 405, '不支援此操作'), true
  if (typeof body.terms !== 'string' || typeof body.privacy !== 'string') return fail(res, 400, '條款內容格式無效'), true
  const terms = body.terms.trim(), privacy = body.privacy.trim()
  if (!terms || !privacy) return fail(res, 400, '服務條款和私隱聲明都不可留空'), true
  if (terms.length > MAX_TEXT || privacy.length > MAX_TEXT) return fail(res, 400, `每份不可超過 ${MAX_TEXT} 字`), true
  if (terms.includes(PLACEHOLDER) || privacy.includes(PLACEHOLDER)) return fail(res, 400, '還有「【請填寫…】」未改好，請先填上'), true
  const latest = current(tenantId)
  if (latest && latest.terms === terms && latest.privacy === privacy) return fail(res, 400, '內容與目前版本相同，不用發佈'), true
  const version = (latest?.version || 0) + 1
  db.prepare('INSERT INTO terms_versions(tenant_id,version,terms,privacy,published_at,published_by) VALUES (?,?,?,?,?,?)').run(tenantId, version, terms, privacy, now(), user.name)
  return json(res, 201, { version, publishedAt: now() }), true
}
