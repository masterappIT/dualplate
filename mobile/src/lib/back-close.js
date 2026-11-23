import { watch, onScopeDispose } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'

// 安卓返回鍵：有彈窗（底部選單、確認框、批文卡預覽、導覽）時先關最上層的彈窗，沒有才照常返回或退出。
// 每個彈窗打開時登記、關閉時移除；記下所屬頁面，別的頁面（例如切走的標籤頁）留下的彈窗不會攔截返回鍵。
const layers = []

function currentPage() {
  const pages = getCurrentPages()
  return pages[pages.length - 1]
}

// 登記一層彈窗，close 是按返回鍵時要做的關閉動作；回傳移除函數
export function pushLayer(close) {
  const layer = { close, page: currentPage() }
  layers.push(layer)
  return () => {
    const index = layers.indexOf(layer)
    if (index >= 0) layers.splice(index, 1)
  }
}

// isOpen() 為真時登記，變回假或組件卸載時移除
export function closeOnBack(isOpen, close) {
  let remove = null
  const drop = () => { if (remove) { remove(); remove = null } }
  watch(() => !!isOpen(), open => {
    if (open && !remove) remove = pushLayer(close)
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
    layer.close()
    return true
  }
  return false
}

// 在有彈窗的頁面呼叫一次（要在頁面本身的 setup 裏，不能在子組件）
export function useBackClose() {
  onBackPress(() => closeTopLayer())
}
