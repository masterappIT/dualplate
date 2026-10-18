import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 服務條款及私隱聲明：後台發佈版本、選「提示」或「強制」；強制時客戶未同意最新版本前只可看條款和同意
const state = {}
before(async () => {
  state.dir = mkdtempSync(join(tmpdir(), 'terms-'))
  Object.assign(process.env, { DB_PATH: join(state.dir, 'api.db'), DEMO_SEED: '0', API_NO_LISTEN: '1', LOG_DIR: join(state.dir, 'logs') })
  const { db, hashPassword, seedRules } = await import('../src/db.js')
  state.db = db
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,created_at) VALUES (?,?,?)').run('other', '其他租戶', new Date().toISOString())
  seedRules('other')
  db.prepare('UPDATE tenants SET name=? WHERE id=?').run('測試代辦有限公司', 'default')
  for (const [key, name, tenant] of [['first', '測試客戶甲', 'default'], ['foreign', '外租戶客戶', 'other']]) {
    state[key] = randomUUID()
    db.prepare('INSERT INTO customers(id,name,kind,phone,tenant_id) VALUES (?,?,?,?,?)').run(state[key], name, '個人', '12345678', tenant)
  }
  for (const [token, role, customer, tenant] of [['admin', 'admin', null, 'default'], ['staff', 'staff', null, 'default'], ['client', 'customer', state.first, 'default'], ['client2', 'customer', state.first, 'default'], ['foreign-admin', 'admin', null, 'other'], ['foreign-client', 'customer', state.foreign, 'other']]) {
    const uid = randomUUID()
    state[`${token}-id`] = uid
    db.prepare('INSERT INTO users(id,role,name,email,password_hash,customer_id,tenant_id,username) VALUES (?,?,?,?,?,?,?,?)').run(uid, role, token, `${token}@test.invalid`, hashPassword('OriginalPass123'), customer, tenant, role === 'customer' ? null : token)
    db.prepare('INSERT INTO sessions(token,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)').run(token, uid, '2099-01-01T00:00:00Z', new Date().toISOString())
  }
  state.server = (await import('../src/server.js')).server
})
after(() => { state.server?.close(); rmSync(state.dir, { recursive: true, force: true }) })
function request(path, method = 'GET', body, token = 'admin') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const incoming = Readable.from(payload ? [payload] : [])
  Object.assign(incoming, { method, url: `/api${path}`, headers: { host: 'localhost', authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': '10.59.0.1' } })
  return new Promise(resolve => state.server.emit('request', incoming, { headers: {}, setHeader() {}, writeHead(status) { this.status = status }, end(data) { resolve({ status: this.status, body: typeof data === 'string' && data ? JSON.parse(data) : null }) } }))
}
const ready = text => text.replace(/【請填寫[^】]*】/g, '電話 2345 6789')
const publish = (terms, privacy, token = 'admin') => request('/terms/publish', 'POST', { terms, privacy }, token)
const setMode = (mode, token = 'admin') => request('/terms/mode', 'PUT', { mode }, token)
let draft
async function publishDraft(suffix = '') { return publish(ready(draft.terms) + suffix, ready(draft.privacy)) }

// ── 後台設定與發佈（依次執行，後面的測試依賴已發佈的版本） ──
test('未發佈時後台提供條款初稿，預設為提示', async () => {
  const r = await request('/terms')
  assert.equal(r.status, 200)
  assert.equal(r.body.current, null); assert.equal(r.body.mode, 'prompt')
  assert.match(r.body.draft.terms, /7 天內/)
  draft = r.body.draft
})
test('未發佈時客戶看到尚未發佈', async () => { const r = await request('/my/terms', 'GET', undefined, 'client'); assert.equal(r.status, 200); assert.equal(r.body.published, false) })
test('未發佈時強制模式不擋客戶', async () => {
  assert.equal((await setMode('force')).status, 200)
  assert.equal((await request('/vehicles', 'GET', undefined, 'client')).status, 200)
  assert.equal((await setMode('prompt')).status, 200)
})
test('未登入看條款：未發佈回 404', async () => { assert.equal((await request('/public/terms', 'GET', undefined, '')).status, 404) })
// 預設條文已沒有【請填寫…】（管理者 2026-10-18 決定聯絡方式暫不寫），所以自行加一處，檢查發佈仍會擋下
test('條文還有待填寫的地方不能發佈', async () => { const r = await publish(draft.terms + '\n【請填寫：聯絡電話及電郵】', draft.privacy); assert.equal(r.status, 400); assert.match(r.body.error, /請填寫/) })
test('條款留空不能發佈', async () => { assert.equal((await publish('  ', ready(draft.privacy))).status, 400) })
test('條款不是文字不能發佈', async () => { assert.equal((await publish(['甲'], ready(draft.privacy))).status, 400) })
test('發佈拒絕 null 內容', async () => { assert.equal((await request('/terms/publish', 'POST', null)).status, 400) })
test('條款過長不能發佈', async () => { assert.equal((await publish('字'.repeat(20001), ready(draft.privacy))).status, 400) })
test('管理者填好初稿後可發佈', async () => { assert.equal((await publishDraft()).status, 201) })
test('發佈後版本號由 1 開始', async () => {
  const r = await request('/terms')
  assert.equal(r.body.current.version, 1)
})
test('內容相同不用再發佈', async () => { const r = await publishDraft(); assert.equal(r.status, 400); assert.match(r.body.error, /相同/) })
test('員工可查看條款設定', async () => { assert.equal((await request('/terms', 'GET', undefined, 'staff')).status, 200) })
test('員工不能發佈新版本', async () => { assert.equal((await publish(ready(draft.terms) + '員工', ready(draft.privacy), 'staff')).status, 403) })
test('員工不能改提示或強制', async () => { assert.equal((await setMode('force', 'staff')).status, 403) })
test('客戶不能用後台條款接口', async () => { assert.equal((await request('/terms', 'GET', undefined, 'client')).status, 403) })
test('提示或強制以外的模式回 400', async () => { assert.equal((await setMode('maybe')).status, 400) })
test('未登入可看已發佈的條款，公司名稱已代入', async () => {
  const r = await request('/public/terms', 'GET', undefined, '')
  assert.equal(r.status, 200); assert.equal(r.body.version, 1)
  assert.match(r.body.terms, /測試代辦有限公司/); assert.doesNotMatch(r.body.terms, /\{公司名稱\}/)
})

// ── 客戶同意 ──
test('客戶看到最新版本，未同意', async () => {
  const r = await request('/my/terms', 'GET', undefined, 'client')
  assert.equal(r.body.version, 1); assert.equal(r.body.accepted, false); assert.equal(r.body.mode, 'prompt')
})
test('從未同意過任何版本的客戶，everAccepted 為 false', async () => { assert.equal((await request('/my/terms', 'GET', undefined, 'client')).body.everAccepted, false) })
test('提示模式下未同意也可照常使用', async () => { assert.equal((await request('/vehicles', 'GET', undefined, 'client')).status, 200) })
test('強制模式下未同意不能使用其他功能', async () => {
  await setMode('force')
  const r = await request('/vehicles', 'GET', undefined, 'client2')
  assert.equal(r.status, 403); assert.equal(r.body.code, 'TERMS_REQUIRED'); assert.equal(r.body.version, 1)
})
test('強制模式下仍可看自己的帳戶和條款', async () => {
  assert.equal((await request('/me', 'GET', undefined, 'client2')).status, 200)
  assert.equal((await request('/my/terms', 'GET', undefined, 'client2')).status, 200)
})
test('強制模式不影響員工', async () => { assert.equal((await request('/vehicles', 'GET', undefined, 'staff')).status, 200) })
test('同意舊版本回 409', async () => { assert.equal((await request('/my/terms/accept', 'POST', { version: 0 }, 'client2')).status, 409) })
test('同意時版本不是整數回 400', async () => { assert.equal((await request('/my/terms/accept', 'POST', { version: '1' }, 'client2')).status, 400) })
test('同意拒絕 null 內容', async () => { assert.equal((await request('/my/terms/accept', 'POST', null, 'client2')).status, 400) })
test('員工不能代客戶同意', async () => { assert.equal((await request('/my/terms/accept', 'POST', { version: 1 }, 'staff')).status, 403) })
test('同意最新版本後可照常使用', async () => {
  const r = await request('/my/terms/accept', 'POST', { version: 1 }, 'client2')
  assert.equal(r.status, 200); assert.ok(r.body.acceptedAt)
  assert.equal((await request('/vehicles', 'GET', undefined, 'client2')).status, 200)
})
test('重複同意不會重複記錄', async () => {
  assert.equal((await request('/my/terms/accept', 'POST', { version: 1 }, 'client2')).status, 200)
  assert.equal(state.db.prepare('SELECT COUNT(*) n FROM terms_acceptances WHERE user_id=?').get(state['client2-id']).n, 1)
})
test('同一客戶的另一個帳戶要各自同意', async () => { assert.equal((await request('/vehicles', 'GET', undefined, 'client')).status, 403) })
test('後台列出每個客戶帳戶是否已同意最新版本', async () => {
  const accounts = (await request('/terms')).body.accounts
  assert.equal(accounts.find(item => item.id === state['client2-id']).current, true)
  assert.equal(accounts.find(item => item.id === state['client-id']).current, false)
  assert.ok(!accounts.some(item => item.id === state['foreign-client-id']))
})
test('發佈新版本後，已同意舊版本的客戶要再同意', async () => {
  assert.equal((await publishDraft('\n補充條文')).status, 201)
  const r = await request('/vehicles', 'GET', undefined, 'client2')
  assert.equal(r.status, 403); assert.equal(r.body.version, 2)
  assert.equal((await request('/terms')).body.accounts.find(item => item.id === state['client2-id']).acceptedVersion, 1)
})
test('新版本發佈後，同意過舊版的客戶 everAccepted 為 true、accepted 為 false', async () => {
  const r = await request('/my/terms', 'GET', undefined, 'client2')
  assert.equal(r.body.accepted, false); assert.equal(r.body.everAccepted, true)
})
test('改回提示後不再擋客戶', async () => {
  await setMode('prompt')
  assert.equal((await request('/vehicles', 'GET', undefined, 'client2')).status, 200)
})

// ── 租戶分開 ──
test('其他租戶看不到本租戶的條款', async () => {
  const r = await request('/terms', 'GET', undefined, 'foreign-admin')
  assert.equal(r.body.current, null)
})
test('其他租戶的客戶不受本租戶強制影響', async () => {
  await setMode('force')
  assert.equal((await request('/my/terms', 'GET', undefined, 'foreign-client')).body.published, false)
  assert.equal((await request('/vehicles', 'GET', undefined, 'foreign-client')).status, 200)
  await setMode('prompt')
})
