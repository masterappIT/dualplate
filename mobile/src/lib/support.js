// 線上客服：MasterBox 網站小視窗（docs/tasks/support-masterbox-plan.md 第 1 部分）
// 只在 H5 網頁版運作；微信小程序打不開 MasterBox 的網域（未備案），supportAvailable 為 false，畫面不放客服卡
// 不用小視窗的角落按鈕（data-button="none"），由本產品自己的「聯絡客服」按鈕打開；紅點用 unread 事件
// 已登入時用 setData 帶入客戶資料給客服參考（訪客改得到，不算已驗證；第二步改用伺服器簽的憑證）
import { api, getUser } from './api'

const WIDGET = 'https://masterboxapp.masterappinc.com/c/widget.js'
const LINK = 'DaZ-K0ltDZ--4uZd9hNXXYI_'
const ADMIN_CUSTOMER = 'https://dualplateadmin.masterappinc.com/#/customers/'

let supportAvailable = false
// #ifdef H5
supportAvailable = true
// #endif
export { supportAvailable }

let loaded = false
const unreadListeners = new Set()
let unreadCount = 0

function queue(...command) {
  // #ifdef H5
  window.MasterBoxChat = window.MasterBoxChat || []
  window.MasterBoxChat.push(command)
  // #endif
}

// 第一次用到才插入腳本；一頁只放一次
export function loadSupport() {
  if (!supportAvailable || loaded) return
  loaded = true
  // #ifdef H5
  window.MasterBoxChat = window.MasterBoxChat || []
  queue('on', 'unread', count => { unreadCount = Number(count) || 0; unreadListeners.forEach(fn => fn(unreadCount)) })
  const script = document.createElement('script')
  script.src = WIDGET
  script.async = true
  script.setAttribute('data-link', LINK)
  script.setAttribute('data-button', 'none')
  script.setAttribute('data-src', 'h5')
  document.body.appendChild(script)
  // #endif
}

// 「聯絡客服」「問客服」：text 是預先填進輸入框的第一句，客戶自己按送出
export function openSupport(text) {
  if (!supportAvailable) return
  loadSupport()
  queue('open', ...(text ? [{ text }] : []))
}

// 紅點：回傳取消聽的函式（組件卸載時呼叫）
export function onSupportUnread(fn) {
  unreadListeners.add(fn)
  fn(unreadCount)
  return () => unreadListeners.delete(fn)
}

// 只收文字、每項最多 200 字（MasterBox 的限制）
const text200 = value => String(value ?? '').trim().slice(0, 200)

// 已登入：照計劃的欄位表寫 setData；任何一個接口失敗就少寫那幾項，不擋客服
export async function syncSupportData() {
  if (!supportAvailable) return
  const user = getUser()
  if (!user) return
  loadSupport()
  const [profile, overview, plates] = await Promise.all([
    api('/my/profile').catch(() => null),
    api('/my/overview').catch(() => null),
    api('/plate-assets').catch(() => null)
  ])
  const email = user.email && !String(user.email).endsWith('@phone.invalid') ? user.email : ''
  const mode = overview?.serviceMode || user.serviceMode || ''
  const plateList = Array.isArray(plates) ? plates.map(item => item.mainland_plate).filter(Boolean).join('、') : ''
  const fields = {
    name: profile?.me?.name || user.name,
    email,
    phone: profile?.me?.phone || profile?.customer?.phone,
    '客戶編號': user.customerId,
    '後台連結': user.customerId ? ADMIN_CUSTOMER + user.customerId : '',
    '管理方式': mode,
    '顧問': mode === '自管' ? '' : overview?.advisor?.name,
    '牌照': plateList,
    '來自': 'H5 網頁'
  }
  // 沒有值的寫 null（MasterBox 會拿掉那一項），免得留著舊的顧問、牌照；和 App 的客服頁一樣
  const data = {}
  for (const [key, value] of Object.entries(fields)) data[key] = text200(value) || null
  queue('setData', data)
}

// 退出登入：清掉帶入的資料，換人用不會混（clearSession 呼叫）
export function clearSupportData() {
  if (!supportAvailable || !loaded) return
  queue('clearData')
}
