import { watch, onScopeDispose } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'

// 安卓返回鍵：有彈窗（底部選單、確認框、批文卡預覽、導覽）時先關最上層的彈窗，沒有才照常返回或退出。
// 每個彈窗打開時登記、關閉時移除；記下所屬頁面，別的頁面（例如切走的標籤頁）留下的彈窗不會攔截返回鍵。
// 安卓 App 也用這份登記把底部導航列那一條跟着彈窗遮罩變暗（lib/nav-bar.js），所以同時記下遮罩顏色。
const layers = []
// Wot Design Uni 的遮罩顏色（wot-design-uni/components/common/abstracts/variable.scss 的 $-overlay-bg；App.vue 沒有改 --wot-overlay-bg）
export const WOT_OVERLAY = 'rgba(0,0,0,.65)'
let listener = null

function currentPage() {
  const pages = getCurrentPages()
  return pages[pages.length - 1]
}

function changed() { if (listener) listener() }

// 彈窗增減時呼叫 fn（只有安卓 App 的 lib/nav-bar.js 登記）
export function onLayersChange(fn) { listener = fn }

// 目前頁面最上層彈窗的遮罩顏色；沒有彈窗回傳 null
export function topMask() {
  const page = currentPage()
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].page === page) return layers[i].mask
  return null
}

// 登記一層彈窗，close 是按返回鍵時要做的關閉動作，mask 是它的遮罩顏色；回傳移除函數
export function pushLayer(close, mask = WOT_OVERLAY) {
  const layer = { close, page: currentPage(), mask }
  layers.push(layer)
  changed()
  return () => {
    const index = layers.indexOf(layer)
    if (index >= 0) { layers.splice(index, 1); changed() }
  }
}

// isOpen() 為真時登記，變回假或組件卸載時移除
export function closeOnBack(isOpen, close, mask) {
  let remove = null
  const drop = () => { if (remove) { remove(); remove = null } }
  watch(() => !!isOpen(), open => {
    if (open && !remove) remove = pushLayer(close, mask)
    else if (!open) drop()
  }, { immediate: true })
  onScopeDispose(drop)
}

// 關掉目前頁面最上層的彈窗；有關到回傳 true
export function closeTopLayer() {
  const page = currentPage()
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i].page !== page) continue
    const [layer] = layers.splice(i, 1)
    changed()
    layer.close()
    return true
  }
  return false
}

// 在有彈窗的頁面呼叫一次（要在頁面本身的 setup 裏，不能在子組件）
export function useBackClose() {
  onBackPress(() => closeTopLayer())
}
