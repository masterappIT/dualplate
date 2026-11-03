// App 版載入頁（pages/launch）先取好首頁資料，首頁打開時直接用，數字不會由 0 跳到實數。
// 不經 api()：它遇 401 會自己 navigateTo 登入頁，和載入頁的 reLaunch 撞在一起；這裏失敗就交回首頁照常處理。
import { getToken, getUser, clearSession, rememberMode } from './api'
const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100'
let home = null
function get(path) {
  return new Promise((resolve, reject) => uni.request({ url: base + '/api' + path, timeout: 5000,
    header: { authorization: `Bearer ${getToken()}` },
    success: response => response.statusCode >= 200 && response.statusCode < 300 ? resolve(response.data) : reject({ status: response.statusCode }),
    fail: () => reject({}) }))
}
// 回傳下一頁：未登入或登入已失效 → 登入頁；其餘 → 首頁（取不到資料也去首頁，由首頁提示）
export async function prefetchHome() {
  if (!getUser() || !getToken()) return '/pages/login/login'
  try {
    const [overview, list] = await Promise.all([get('/my/overview'), get('/my/notifications').catch(() => ({ items: [] }))])
    rememberMode(overview.serviceMode)
    home = { overview, notices: list.items || [] }
  } catch (e) {
    if (e.status === 401) { clearSession(); return '/pages/login/login' }
  }
  return '/pages/index/index'
}
// 只用一次：之後回到首頁照常即時載入
export function takeHome() { const value = home; home = null; return value }
