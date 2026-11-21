// 階段 3 本機測試帳號（local_api.sh 第一次開伺服器時執行一次）。只經管理端接口改資料，和員工在管理端操作一樣。
// 示範資料（api/src/demo-seed.js）本身有兩位托管客戶：陳先生、李先生。這裏：
// 1. 陳先生轉為自管 → 有資料的自管客戶；
// 2. 新增空白的自管客戶和它的登入；
// 3. 李先生保持托管 → 托管客戶。
const base = process.argv[2]
const password = 'CustomerDemo123!'

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

const { token } = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'AdminDemo123!' } })
const customers = await call('/api/customers', { token })
const chen = customers.find(c => c.name.includes('陳先生'))
if (!chen) throw new Error('示範資料沒有陳先生')
await call(`/api/customers/${chen.id}/service-mode`, { method: 'PUT', body: { mode: '自管' }, token })
const empty = await call('/api/customers', { method: 'POST', body: { name: '空白自管（測試）', kind: '個人', serviceMode: '自管' }, token })
await call('/api/customer-users', { method: 'POST', body: { customerId: empty.id, name: '空白自管', email: 'empty-self@demo.local', password }, token })

for (const email of ['empty-self@demo.local', 'customer@demo.local', 'li@demo.local']) {
  const { user } = await call('/api/login', { method: 'POST', body: { email, password } })
  console.log(`已建立：${email}（${user.serviceMode}）`)
}
