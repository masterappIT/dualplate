import { onLayersChange, topMask } from './back-close'

// 安卓 App 底部導航列那一條的顏色（android/app 的 LaunchNavBar）。
// iPhone 的網頁延伸到螢幕最底，底部安全區就是頁面底色，彈窗遮罩也蓋到最底；安卓的網頁停在導航列上面（DCloud 固定留了外邊距，改不了），
// 所以由這裏告訴原生層把那一條塗成 iPhone 上同一位置的顏色：
// 有標籤列的頁面跟標籤列（iPhone 上遮罩也蓋不到原生標籤列，所以不變暗），其他頁面用頁面底色，彈窗打開時疊上它的遮罩顏色。
// 只在安卓 App 用（main.js 只在安卓呼叫 setupNavBar），iOS 和網頁版完全不經過。

const PAPER = '#F7F6F1' // pages.json globalStyle.backgroundColor，即 iPhone 的 manifest.json safearea.background
const TAB_BAR = '#FFFFFF' // pages.json tabBar.backgroundColor
const TAB_PAGES = ['pages/index/index', 'pages/vehicles/vehicles', 'pages/companies/companies', 'pages/me/me']
// 底色不是紙色的頁面（與 pages.json 該頁的 backgroundColor 一致）；啟動頁由原生層自己處理深綠，不在這裏改
const PAGE_COLORS = { 'pages/card-capture/card-capture': '#000000' }
const SKIP = ['pages/launch/launch']

let native = null, tried = false, last = ''

function nav() {
  if (!tried) {
    tried = true
    try { native = plus.android.importClass('com.masterappinc.dualplate.LaunchNavBar') } catch (e) { native = null }
  }
  return native
}

// 'rgba(r,g,b,a)' 疊在 '#RRGGBB' 上的顏色
function blend(mask, base) {
  const [r, g, b, a = 1] = mask.match(/[\d.]+/g).map(Number)
  const under = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16))
  return '#' + [r, g, b].map((c, i) => Math.round(c * a + under[i] * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function target() {
  const pages = getCurrentPages()
  const route = pages[pages.length - 1]?.route
  if (!route || SKIP.includes(route)) return ''
  if (TAB_PAGES.includes(route)) return TAB_BAR
  const base = PAGE_COLORS[route] || PAPER
  const mask = topMask()
  return mask ? blend(mask, base) : base
}

// fade：彈窗開關時跟遮罩一起淡入淡出；換頁時立即換
function sync(fade) {
  const color = target(), bar = nav()
  if (!color || !bar || color === last) return
  last = color
  try { fade ? bar.fade(color) : bar.paint(color) } catch (e) { /* 只是外觀，不影響使用 */ }
}

export function setupNavBar(app) {
  onLayersChange(() => sync(true))
  // 每個頁面顯示時（打開、返回、切換標籤）重新決定顏色
  app.mixin({ onShow() { sync(false) } })
}
