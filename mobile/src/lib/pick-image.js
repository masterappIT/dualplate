// 選相片（相機或相簿），參數和回呼與 uni.chooseImage 相同。
// 安卓 App：要求相機或讀相片權限時，同時在畫面頂部說明用途（內地要求申請權限時同步告知目的）；
// 已有權限就不顯示。iOS（用 Info.plist 的用途說明）和網頁版照舊直接呼叫 uni.chooseImage，行為不變。
// 只有安卓走這裏的流程；選單、相機、相簿仍是 DCloud 原有的（與 iOS 一致），本檔只加說明卡和權限申請。
// 說明卡出現時系統權限框會把整個畫面調暗，這是系統畫的，App 不能蓋過。
export function pickImage(options) {
  // #ifdef APP-PLUS
  if (plus.os.name === 'Android') return androidPick(options)
  // #endif
  return uni.chooseImage(options)
}

// #ifdef APP-PLUS
const tips = {
  camera: { title: '相機權限使用說明', text: '用來拍攝批文卡、證件或車輛相片，用於你正在填寫的資料。' },
  album: { title: '相片權限使用說明', text: '用來選擇批文卡、證件或車輛相片，只會讀取你選的相片。' },
}
// 拒絕後的提示：與說明卡同一位置、同一樣式（原生圖層），長句會換行完整顯示
const denied = {
  camera: { title: '未取得相機權限', text: '如要拍照，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相機。' },
  album: { title: '未取得相片權限', text: '如要選相片，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相片。' }
}
// 取消和沒有權限都當「取消」回報，頁面不會再多彈一個「未能選擇相片」
const cancel = options => options.fail?.({ errMsg: 'chooseImage:fail cancel' })

function androidPick(options) {
  const sources = options.sourceType?.length ? options.sourceType : ['album', 'camera']
  if (sources.length === 1) return withPermission(sources[0], options)
  // 兩個來源都可以：選單照搬 uni.chooseImage 自己的（同一個 plus.nativeUI.actionSheet、同樣的字和次序，與 iOS 一樣），
  // 只是改由這裏打開，選了來源才申請該項權限和顯示說明卡：說明卡不會被選單的遮罩蓋住，拒絕後也會提示到設定開啟
  const [cancelText, cameraText, albumText] = sheetTexts()
  plus.nativeUI.actionSheet({ cancel: cancelText, buttons: [{ title: cameraText }, { title: albumText }] }, e => {
    if (e.index === 1) return withPermission('camera', options)
    if (e.index === 2) return withPermission('album', options)
    cancel(options)
  })
}

// 與 uni-app 執行庫 initI18nChooseImageMsgsOnce 的字相同（取消、相簿、相機），按 App 語言
function sheetTexts() {
  const locale = String(uni.getLocale?.() || '').toLowerCase()
  if (locale.startsWith('zh')) return /hant|hk|tw|mo/.test(locale) ? ['取消', '拍攝', '從相冊選擇'] : ['取消', '拍摄', '从相册选择']
  if (locale.startsWith('es')) return ['Cancelar', 'Cámara', 'Álbum']
  if (locale.startsWith('fr')) return ['Annuler', 'Caméra', 'Album']
  return ['Cancel', 'Camera', 'Album']
}

function sdkInt() {
  return Number(plus.android.importClass('android.os.Build$VERSION').SDK_INT) || 0
}

// Android 13 起讀相片要 READ_MEDIA_IMAGES（14 起用戶可只允許部分相片：READ_MEDIA_VISUAL_USER_SELECTED）；12 或以下讀儲存空間
function permissionsFor(source, sdk) {
  if (source === 'camera') return ['android.permission.CAMERA']
  if (sdk >= 34) return ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED']
  if (sdk >= 33) return ['android.permission.READ_MEDIA_IMAGES']
  return ['android.permission.READ_EXTERNAL_STORAGE']
}

function hasAny(perms) {
  const main = plus.android.runtimeMainActivity()
  return perms.some(p => plus.android.invoke(main, 'checkSelfPermission', p) === 0)
}

function withPermission(source, options) {
  askPermission(source).then(granted => {
    permLog(`withPermission ${source} granted=${granted}`)
    if (granted) return uni.chooseImage({ ...options, sourceType: [source] })
    notifyDenied(source)
    cancel(options)
  })
}
// #endif

// 安卓 App：申請相機（'camera'）或讀相片（'album'）權限，申請時在頂部顯示用途說明；回傳是否取得。
// 已有權限、Android 6 以前、讀不到版本或申請出錯都當取得（之後交給 DCloud 自己處理）。其他平台直接回傳 true。
// 等系統真正回覆才回傳；等不到時只收起說明卡，不當作拒絕。被拒時本函數不提示，由呼叫的地方用 notifyDenied 提示（批文卡相機頁 CardCapture.vue 開鏡頭前也用這兩個）。
export function askPermission(source) {
  // #ifdef APP-PLUS
  if (plus.os.name !== 'Android') return Promise.resolve(true)
  let sdk = 0, perms = []
  try { sdk = sdkInt(); perms = permissionsFor(source, sdk); if (sdk < 23 || hasAny(perms)) return Promise.resolve(true) } catch { return Promise.resolve(true) }
  permLog(`ask ${source} sdk=${sdk} perms=${perms.join(',')}`)
  const hide = showCard('permission-tip', tips[source])
  return requestWithStall(perms, hide).then(granted => { permLog(`ask ${source} result granted=${granted}`); hide(); return granted })
  // #endif
  return Promise.resolve(true)
}

// 安卓 App：權限被拒時在頂部提示到設定開啟（約 5 秒後自動收起，按一下也會收起）。其他平台不做事。
export function notifyDenied(source) {
  // #ifdef APP-PLUS
  if (plus.os.name !== 'Android') return
  permLog(`notifyDenied ${source}`)
  const hide = showCard('permission-denied', denied[source], true)
  setTimeout(hide, 5000)
  // #endif
}

// #ifdef APP-PLUS

// 申請權限，回傳系統的結果（拒絕或允許都等系統真正回覆才回傳；慢的手機系統框可能 20 秒以上才出現，2026-11-14 Android 17 模擬器實測）。
// 等不到回應時只收起說明卡（onStall），不當作拒絕，仍等系統的結果，結果到了照常處理：
// 30 秒內系統框都沒出現（看 App 視窗有沒有失去焦點，系統權限框出現時會失去），或系統框關上後 5 秒仍未回呼。
// 輪詢每次重新排程，不用 setInterval（2026-11-14 實測 clearInterval 後仍繼續執行，原因未查明）。
function requestWithStall(perms, onStall) {
  return new Promise(resolve => {
    let settled = false, sawDialog = false, idle = 0
    const main = plus.android.runtimeMainActivity()
    const finish = granted => { if (settled) return; settled = true; resolve(granted) }
    const tick = () => {
      if (settled) return
      let focused = true
      try { focused = !!plus.android.invoke(main, 'hasWindowFocus') } catch {}
      if (!focused) {
        if (!sawDialog) permLog('window lost focus (system dialog shown)')
        sawDialog = true; idle = 0
      } else {
        if (idle === 0 && sawDialog) permLog('window focus back')
        idle += 500
        if (idle >= (sawDialog ? 5000 : 30000)) { permLog(`stalled sawDialog=${sawDialog}, hide tip and keep waiting`); onStall(); return }
      }
      setTimeout(tick, 500)
    }
    setTimeout(tick, 500)
    try {
      permLog('requestPermissions sent')
      plus.android.requestPermissions(perms, result => { permLog(`callback ${JSON.stringify(result)} settled=${settled}`); finish(!!result.granted?.length) }, e => { permLog(`error callback ${JSON.stringify(e)} settled=${settled}`); finish(true) })
    } catch (e) { permLog(`requestPermissions threw ${e?.message || e}`); finish(true) }
  })
}

// 畫面頂部的卡片（原生圖層，蓋在網頁上；系統權限框出現時仍看得到）：用途說明和拒絕提示共用；回傳收起函數。
// 高度按字數估算（每字當 14px 寬），長句換行完整顯示；tapToClose 時按一下收起。
function showCard(id, { title, text }, tapToClose = false) {
  let view = null
  try {
    plus.nativeObj.View.getViewById(id)?.close()
    const { statusBarHeight = 24, windowWidth = 360 } = uni.getSystemInfoSync()
    const width = windowWidth - 24, textWidth = width - 32
    const lines = Math.max(1, Math.ceil(text.length / Math.max(1, Math.floor(textWidth / 14))))
    const textHeight = lines * 21
    view = new plus.nativeObj.View(id, { top: statusBarHeight + 8 + 'px', left: '12px', width: width + 'px', height: (54 + textHeight) + 'px' })
    view.drawRect({ color: '#FFFFFF', radius: '12px', borderColor: '#D9E0DC', borderWidth: '1px' }, { top: '0px', left: '0px', width: '100%', height: '100%' })
    view.drawText(title, { top: '14px', left: '16px', width: textWidth + 'px', height: '22px' }, { size: '16px', weight: 'bold', color: '#14201B', align: 'left' })
    view.drawText(text, { top: '40px', left: '16px', width: textWidth + 'px', height: textHeight + 'px' }, { size: '14px', color: '#4A5852', align: 'left', verticalAlign: 'top', whiteSpace: 'normal', lineSpacing: '20%' })
    if (tapToClose) view.addEventListener('click', () => { try { view?.close() } catch {}; view = null })
    view.show()
    permLog(`card shown ${id} lines=${lines}`)
  } catch (e) { permLog(`card failed ${id} ${e?.message || e}`); view = null }
  return () => {
    if (!view) return
    permLog(`card close ${id}`)
    try { view.close() } catch (e) { permLog(`card close failed ${id} ${e?.message || e}`) }
    view = null
  }
}

// 權限流程記錄：寫入安卓系統記錄（logcat，tag DualplatePerm），App 的 console 不會出現在系統記錄裏
let logClass = null
function permLog(msg) {
  try { logClass = logClass || plus.android.importClass('android.util.Log'); logClass.i('DualplatePerm', msg) } catch {}
}
// #endif
