import { reactive } from 'vue'
import { useMessage } from 'wot-design-uni'

// 選單與確認框一律用 Wot Design Uni（docs/design-system.md 第 159 行：用它的操作，外觀跟本產品），不用系統原生的 showActionSheet／showModal。
// 每頁放一個 <wd-action-sheet> 和一個 <wd-message-box />，由這裏的函數驅動。

// 底部選單：choose(標題, 選項) 回傳選中的序號，取消回傳 -1。選項可以是文字，或 { title, sub }（sub 是說明）。
export function useChoice() {
  const sheet = reactive({ show: false, title: '', actions: [] })
  let pending = null, closedAt = 0
  async function choose(title, items) {
    // 上一個選單剛收起（例如連續兩層選單），等動畫完成再打開，避免畫面閃動
    const wait = 300 - (Date.now() - closedAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    return new Promise(resolve => {
      pending = resolve
      Object.assign(sheet, { title: title || '', actions: items.map(item => typeof item === 'string' ? { name: item } : { name: item.title, subname: item.sub || '' }), show: true })
    })
  }
  const settle = index => { const resolve = pending; pending = null; if (resolve) resolve(index) }
  function onSelect({ index }) { settle(index) }
  function onClose() { closedAt = Date.now(); settle(-1) }
  return { sheet, choose, onSelect, onClose }
}

// 確認框：ask() 回傳 'confirm'、'cancel'（按了取消鍵）或 'modal'（點了框外關閉）；notice() 只有一個按鍵。
// 按鈕用本產品的小圓角，不用 Wot 預設的膠囊形
const square = { round: false }

export function useConfirm() {
  const message = useMessage()
  const ask = ({ title, msg = '', ok = '確認', cancel = '取消' }) => message.confirm({ title, msg, confirmButtonText: ok, cancelButtonText: cancel, closeOnClickModal: true, confirmButtonProps: square, cancelButtonProps: square })
    .then(() => 'confirm').catch(result => result?.action || 'modal')
  const notice = ({ title, msg = '', ok = '知道了' }) => message.alert({ title, msg, confirmButtonText: ok, confirmButtonProps: square }).catch(() => {})
  return { ask, notice }
}
