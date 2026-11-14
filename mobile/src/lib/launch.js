// App 版載入頁（pages/launch）先取好首頁資料，首頁打開時直接用，數字不會由 0 跳到實數。
// 不經 api()：它遇 401 會自己 navigateTo 登入頁，和載入頁的 reLaunch 撞在一起；這裏失敗就交回首頁照常處理。
import { getToken, getUser, clearSession, rememberMode } from './api'
const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100'
const CACHE = 'homeCache'
let home = null
function get(path) {
  return new Promise((resolve, reject) => uni.request({ url: base + '/api' + path, timeout: 5000,
    header: { authorization: `Bearer ${getToken()}` },
    success: response => response.statusCode >= 200 && response.statusCode < 300 ? resolve(response.data) : reject({ status: response.statusCode }),
    fail: () => reject({}) }))
}
// 只有安卓 App 存上次的首頁資料（iOS、網頁照舊）
function android() {
  try { return typeof plus !== 'undefined' && plus.os.name === 'Android' } catch (e) { return false }
}
// 回傳下一頁：未登入或登入已失效 → 登入頁；其餘 → 首頁（取不到資料也去首頁，由首頁提示）
export async function prefetchHome() {
  if (!getUser() || !getToken()) return '/pages/login/login'
  try {
    const [overview, list] = await Promise.all([get('/my/overview'), get('/my/notifications').catch(() => ({ items: [] }))])
    rememberMode(overview.serviceMode)
    home = { overview, notices: list.items || [] }
    saveHome(home.overview, home.notices)
  } catch (e) {
    if (e.status === 401) { clearSession(); return '/pages/login/login' }
  }
  return '/pages/index/index'
}
// 安卓：先用手機裏上次的首頁資料打開首頁，不等網絡（安卓官方：啟動畫面只等本機的少量資料）。
// 首頁顯示時照常向伺服器取最新資料更新畫面；登入失效時由 api() 轉去登入頁。沒有存過資料才等網絡。
export function quickHome() {
  const user = getUser()
  if (!user || !getToken()) return Promise.resolve('/pages/login/login')
  try {
    const saved = uni.getStorageSync(CACHE)
    if (saved && saved.userId && saved.userId === user.id && saved.overview) {
      home = { overview: saved.overview, notices: saved.notices || [] }
      return Promise.resolve('/pages/index/index')
    }
  } catch (e) { /* 讀不到就等網絡 */ }
  return prefetchHome()
}
// 首頁取到最新資料後存下，下次打開直接用；按帳戶分開，換了帳戶不會顯示別人的資料
export function saveHome(overview, notices) {
  if (!android()) return
  const user = getUser()
  if (!user || !user.id) return
  try { uni.setStorageSync(CACHE, { userId: user.id, overview, notices }) } catch (e) { /* 存不到下次就等網絡 */ }
}
// 只用一次：之後回到首頁照常即時載入
export function takeHome() { const value = home; home = null; return value }
