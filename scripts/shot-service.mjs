// 截圖服務（負責人在沙盒外運行；Codex 不得修改本檔）。
// Codex 的沙盒不能開伺服器、不能啟動瀏覽器，所以由本服務代為截圖，讓 Codex「看得見」畫面。
//
// 用法（負責人）：node scripts/shot-service.mjs
// Codex 要截圖時：在 .review/shot-requests.txt 每行寫一個請求，格式
//   名稱|網址路徑|寬|高|端|點擊（可選）
//   例：today-1366|/#/today|1366|860|admin
//       plates-390|/#/plates|390|844|admin
//       home-390|/#/pages/index/index|390|844|mobile
//       matrix-1366|/#/customers/<id>|1366|860|admin|委託範圍矩陣   ← 先點擊文字為「委託範圍矩陣」的按鈕（或 CSS 選擇器）再截圖，用來檢查彈窗、抽屜、浮條
//   點擊欄可用 > 串接多步，例如：委託範圍矩陣>.matrix-cell
// 服務會輸出 .review/shots/<名稱>.png 和 <名稱>.txt（主控台錯誤、頁面是否橫向溢出），
// 處理完的請求移到 .review/shot-done.txt。Codex 之後用看圖工具打開 png 檢查。
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const root = new URL('../', import.meta.url).pathname
const dir = join(root, '.review'), shots = join(dir, 'shots'), queue = join(dir, 'shot-requests.txt'), done = join(dir, 'shot-done.txt')
const api = process.env.SHOT_API || 'http://localhost:4102/api'
const origins = { admin: process.env.SHOT_ADMIN || 'http://localhost:5176', mobile: process.env.SHOT_MOBILE || 'http://127.0.0.1:5177' }
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(shots, { recursive: true })

async function login(kind) {
  const body = kind === 'admin' ? { username: 'admin', password: process.env.SHOT_ADMIN_PASSWORD || 'AdminDemo123!' } : { email: 'customer@demo.local', password: process.env.SHOT_CLIENT_PASSWORD || 'CustomerDemo123!' }
  const res = await fetch(`${api}/${kind === 'admin' ? 'admin/login' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`登入失敗 ${res.status}`)
  return res.json()
}

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9333', `--user-data-dir=${join(dir, 'chrome-profile')}`, 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
process.on('SIGINT', () => process.exit(0))
await sleep(2500)

async function shoot({ name, path, width, height, kind, clicks = [] }) {
  const target = await (await fetch(`http://127.0.0.1:9333/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let seq = 0; const pending = new Map(); const errors = []
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map(a => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  const origin = origins[kind]
  await send('Page.navigate', { url: origin + '/' }); await sleep(1500)
  const session = await login(kind)
  const store = kind === 'admin'
    ? `localStorage.setItem('adminToken', ${JSON.stringify(session.token)}); localStorage.setItem('adminUser', ${JSON.stringify(JSON.stringify(session.user))})`
    : `uni.setStorageSync('token', ${JSON.stringify(session.token)}); uni.setStorageSync('user', ${JSON.stringify(session.user)})`
  await send('Runtime.evaluate', { expression: store })
  await send('Page.navigate', { url: origin + path }); await sleep(3500)
  for (const step of clicks) {
    // 先試 CSS 選擇器，找不到再按可見文字找按鈕或連結
    const expression = `(() => { const q = ${JSON.stringify(step)}; let el = null; try { el = document.querySelector(q) } catch {} if (!el) el = [...document.querySelectorAll('button, a, [role=button], .text-button')].find(n => n.textContent.trim() === q || n.getAttribute('aria-label') === q); if (!el) return 'not-found'; el.scrollIntoView({ block: 'center' }); el.click(); return 'ok' })()`
    const result = (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value
    if (result !== 'ok') errors.push(`找不到要點擊的元素：${step}`)
    await sleep(1800)
  }
  const overflow = (await send('Runtime.evaluate', { expression: 'JSON.stringify([document.documentElement.scrollWidth, innerWidth])', returnByValue: true })).result?.result?.value
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(shots, `${name}.png`), Buffer.from(shot.result.data, 'base64'))
  const [scrollWidth, innerWidth] = JSON.parse(overflow || '[0,0]')
  writeFileSync(join(shots, `${name}.txt`), [`網址：${origin}${path}`, `尺寸：${width}×${height}`, `頁面寬 ${scrollWidth} / 視窗寬 ${innerWidth}${scrollWidth > innerWidth ? '（⚠️ 橫向溢出）' : ''}`, `主控台錯誤：${errors.length ? '\n' + errors.join('\n') : '無'}`].join('\n'))
  ws.close(); await fetch(`http://127.0.0.1:9333/json/close/${target.id}`)
}

console.log('截圖服務運行中，監看', queue)
while (true) {
  if (existsSync(queue)) {
    const lines = readFileSync(queue, 'utf8').split('\n').map(line => line.trim()).filter(Boolean)
    writeFileSync(queue, '')
    for (const line of lines) {
      const [name, path, width, height, kind = 'admin', click = ''] = line.split('|')
      if (!/^[\w.-]{1,60}$/.test(name || '') || !String(path).startsWith('/') || !origins[kind]) { appendFileSync(done, `略過（格式錯誤）：${line}\n`); continue }
      try { await shoot({ name, path, width: Number(width) || 1366, height: Number(height) || 860, kind, clicks: click ? click.split('>').map(item => item.trim()).filter(Boolean) : [] }); appendFileSync(done, `完成：${line}\n`) }
      catch (error) { appendFileSync(done, `失敗：${line}：${error.message}\n`) }
    }
  }
  await sleep(2000)
}
