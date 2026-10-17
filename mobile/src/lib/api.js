const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100'
export function getToken() { return uni.getStorageSync('token') }
export function saveSession(result) { uni.setStorageSync('token', result.token); uni.setStorageSync('user', result.user); try { uni.removeStorageSync('serviceMode') } catch {} }
export function clearSession() { uni.removeStorageSync('token'); uni.removeStorageSync('user'); uni.removeStorageSync('serviceMode') }
// 自管客戶（docs/requirements.md 5.6.2）：首頁、我的資料載入時記下，其他頁面據此改寫用語、隱藏用不到的區塊
export function rememberMode(mode) { try { uni.setStorageSync('serviceMode', mode || '托管') } catch {} }
export function isSelfManaged() { try { return (uni.getStorageSync('serviceMode') || uni.getStorageSync('user')?.serviceMode) === '自管' } catch { return false } }
// 自管客戶按次委託：到期項目對應的代辦服務；沒有對應的用「其他代辦要求」
const entrustServices = { approval: 'renewal', hk_crp: 'renewal', mo_permit: 'renewal', inspection: 'inspection', mo_inspection: 'inspection', customs_filing: 'filing', new_card_filing: 'filing' }
export const canEntrust = item => isSelfManaged() && item.handledBy === 'you' && item.code !== 'crossing_90'
export function startEntrust(item) { uni.navigateTo({ url: '/pages/requests/requests?entrust=item&service=' + (entrustServices[item.code] || 'other') + '&item=' + encodeURIComponent(item.name) + (item.plateId ? '&plate=' + encodeURIComponent(item.plateId) : '') }) }
export function startLongTerm() { uni.navigateTo({ url: '/pages/requests/requests?entrust=long' }) }
export function getUser() { return uni.getStorageSync('user') || null }
export function api(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    uni.request({ url: base + '/api' + path, method, data,
      header: { authorization: getToken() ? `Bearer ${getToken()}` : '', 'content-type': 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
        if (response.statusCode === 401 && path !== '/login' && !path.startsWith('/wechat/')) { clearSession(); uni.navigateTo({ url: '/pages/login/login' }) }
        // 管理者設定「強制同意」而未同意最新條款：先到條款頁（同一時間只轉一次）
        if (response.statusCode === 403 && response.data?.code === 'TERMS_REQUIRED') openTerms(true)
        reject(Object.assign(new Error(response.data?.error || '操作失敗'), { status: response.statusCode, data: response.data }))
      }, fail(error) { reject(new Error('連不上伺服器，請檢查網絡後再試')) }
    })
  })
}
// 不用登入的請求（登入頁的服務條款連結；日後自助註冊）
export function publicApi(path) {
  return new Promise((resolve, reject) => uni.request({ url: base + '/api' + path, method: 'GET',
    success: response => response.statusCode >= 200 && response.statusCode < 300 ? resolve(response.data) : reject(Object.assign(new Error(response.data?.error || '載入失敗'), { status: response.statusCode })),
    fail: () => reject(new Error('連不上伺服器，請檢查網絡後再試')) }))
}
// 服務條款：強制時 reLaunch（不能返回）；提示時每次開啟 App 只彈一次，可稍後再看
let termsOpening = false, termsPrompted = false
function openTerms(force) {
  const pages = getCurrentPages(), here = pages[pages.length - 1]?.route || ''
  if (termsOpening || here === 'pages/terms/terms') return
  termsOpening = true
  setTimeout(() => { termsOpening = false }, 1500)
  force ? uni.reLaunch({ url: '/pages/terms/terms' }) : uni.navigateTo({ url: '/pages/terms/terms' })
}
// ask：頁面的 Wot 確認框（lib/choice.js useConfirm().ask），不用系統原生對話框
export async function checkTerms(ask) {
  if (!getUser() || termsPrompted) return
  try {
    const terms = await api('/my/terms')
    if (!terms.published || terms.accepted) return
    termsPrompted = true
    if (terms.mode === 'force') return openTerms(true)
    if (ask && await ask({ title: '服務條款已更新', msg: '請查看並同意最新的服務條款及私隱聲明。', ok: '查看', cancel: '稍後' }) === 'confirm') openTerms(false)
  } catch { /* 網絡問題時下次再提示 */ }
}
// Shared wording and colours for deadline states on the client screens.
export const levelLabel = { overdue: '已逾期', due: '快到期', upcoming: '即將到期', ok: '正常' }
export const levelTone = { overdue: 'red', due: 'amber', upcoming: '', ok: '' }
export function daysText(item) { return item.daysLeft == null ? '' : item.daysLeft < 0 ? `逾期 ${-item.daysLeft} 天` : item.daysLeft === 0 ? '今天到期' : `還有 ${item.daysLeft} 天` }
// 客戶自己辦、我們只提醒的事項，全站同一個說法
export const selfHandled = '自行辦理'
// 辦理狀態：全站同一套顏色（進行中藍、要你做的橙、結束灰）
export const requestTone = status => ({ 需要你提供資料: 'amber', 辦理中: 'blue', 已收到: 'blue', 已完成: 'gray', 已取消: 'gray' }[status] || 'blue')
// 工單步驟名是寫給員工看的（「客戶提供……」），客戶端改成對客戶說話
export function clientStage(stage) {
  const text = String(stage || '')
  if (!text || text === '待內部受理') return isSelfManaged() ? '等待我們受理' : '等待顧問受理'
  return text.replace(/^客戶/, '等你')
}
// 到期項目的補充說明：把規則用語改成白話
export function detailText(detail) { return String(detail || '').replace(/^批文有效期開始\s*(\d{4}-\d{2}-\d{2})$/, '由批文生效日 $1 起計') }
// 金額：HK$ 1,200／¥ 1,200／MOP 1,200；有角分才顯示小數
const currencySign = { HKD: 'HK$', RMB: '¥', CNY: '¥', MOP: 'MOP' }
export function money(currency, cents) {
  const value = Number(cents || 0) / 100
  const digits = Number.isInteger(value) ? 0 : 2
  return `${currencySign[currency] || currency || ''} ${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`.trim()
}
export function plateName(p) { return [p.mainlandPlate || p.mainland_plate, p.localPlate || p.local_plate].filter(Boolean).join(' · ') || '車牌待補充' }
export function openPlate(id) { uni.navigateTo({ url: '/pages/plate-detail/plate-detail?id=' + encodeURIComponent(id) }) }
export function startRequest(serviceCode, plateId) { uni.navigateTo({ url: '/pages/requests/requests?service=' + encodeURIComponent(serviceCode || '') + (plateId ? '&plate=' + encodeURIComponent(plateId) : '') }) }
export function friendlyDate(value) { return value ? String(value).slice(0, 10) : '待核對' }
export function daysLeft(value) { return value ? Math.ceil((new Date(value + 'T23:59:59').getTime() - Date.now()) / 86400000) : null }
export function privateImage(path) {
  return new Promise((resolve, reject) => {
    uni.request({ url: base + '/api' + path, method: 'GET', responseType: 'arraybuffer',
      header: { authorization: getToken() ? `Bearer ${getToken()}` : '' },
      success(response) {
        if (response.statusCode !== 200) return reject(new Error('圖片載入失敗'))
        const contentType = response.header?.['content-type'] || response.header?.['Content-Type'] || 'image/png'
        const encoded = uni.arrayBufferToBase64(response.data)
        resolve(`data:${contentType};base64,${encoded}`)
      }, fail(error) { reject(new Error('圖片載入失敗，請檢查網絡後再試')) }
    })
  })
}

// 批文卡照片：原圖多大都可以，上傳前在手機上壓縮成 JPEG（長邊最多 2000 像素、約 800 KB 內；伺服器上限 3.5 MB）。
// 2000 像素下卡面小字仍清楚；檔案小，「查看正本」在手機網絡下也快。
// 回傳 { data: 上傳用的 data URL, path: 可直接預覽的地址 }
const CARD_EDGE = 2000, CARD_TARGET = 800000
const dataBytes = dataUrl => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)
export async function cardPhoto(result) {
  // #ifdef H5
  const picked = result.tempFiles?.[0]?.file || result.tempFiles?.[0]
  const blob = picked instanceof Blob ? picked : await (await fetch(result.tempFilePaths[0])).blob()
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片')); image.src = url })
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    let edge = Math.min(CARD_EDGE, longest), quality = 0.88, data = ''
    for (let attempt = 0; attempt < 10; attempt++) {
      const scale = edge / longest, canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height)
      data = canvas.toDataURL('image/jpeg', quality)
      if (dataBytes(data) <= CARD_TARGET) break
      if (quality > 0.7) quality -= 0.06; else edge = Math.round(edge * 0.8)
    }
    return { data, path: data }
  } finally { URL.revokeObjectURL(url) }
  // #endif
  // #ifndef H5
  const source = result.tempFilePaths[0]
  const info = await new Promise((resolve, reject) => uni.getImageInfo({ src: source, success: resolve, fail: () => reject(new Error('這張照片無法讀取，請重新拍攝')) }))
  const wide = info.width >= info.height, longest = Math.max(info.width, info.height)
  let path = source, data = ''
  for (const quality of [80, 60, 40]) {
    path = await new Promise((resolve, reject) => uni.compressImage({ src: source, quality, ...(longest > CARD_EDGE ? (wide ? { compressedWidth: CARD_EDGE } : { compressedHeight: CARD_EDGE }) : {}), success: r => resolve(r.tempFilePath), fail: () => reject(new Error('照片壓縮失敗，請重新拍攝')) }))
    data = 'data:image/jpeg;base64,' + await readBase64(path)
    if (dataBytes(data) <= CARD_TARGET) break
  }
  return { data, path }
  // #endif
}
// 看上傳的批文卡正本：兩面同時下載，直接用下載得到的地址給系統圖片檢視器（可放大、左右滑看正反面），
// 不再轉成 base64；同一次使用中看過的不重新下載，上傳新卡後用 forgetCardOriginal 清掉。
const originals = new Map()
export function forgetCardOriginal(plateId) { for (const key of [...originals.keys()]) if (key.startsWith(plateId + ':')) originals.delete(key) }
function downloadPrivate(path) {
  return new Promise((resolve, reject) => uni.downloadFile({ url: base + '/api' + path, header: { authorization: getToken() ? `Bearer ${getToken()}` : '' },
    success: r => r.statusCode === 200 ? resolve(r.tempFilePath) : reject(new Error('圖片載入失敗')),
    fail: () => reject(new Error('圖片載入失敗，請檢查網絡後再試')) }))
}
export async function viewCardOriginal(plateId, sides, current) {
  uni.showLoading({ title: '正在載入', mask: true })
  try {
    const urls = await Promise.all(sides.map(async side => {
      const key = plateId + ':' + side
      if (!originals.has(key)) originals.set(key, downloadPrivate(`/plate-assets/${encodeURIComponent(plateId)}/image/card-${side}`).catch(error => { originals.delete(key); throw error }))
      return originals.get(key)
    }))
    uni.hideLoading()
    uni.previewImage({ urls, current: urls[Math.max(0, sides.indexOf(current))] })
  } catch (e) { uni.hideLoading(); uni.showToast({ title: e.message || '圖片載入失敗', icon: 'none' }) }
}

// 看車輛證件原件（行駛證、香港車輛牌照、澳門登記文件、保險單）：同批文卡，下載後用系統圖片檢視器
export async function viewVehicleDocument(vehicleId, kind) {
  uni.showLoading({ title: '正在載入', mask: true })
  try {
    const url = await downloadPrivate(`/vehicles/${encodeURIComponent(vehicleId)}/documents/${encodeURIComponent(kind)}/image`)
    uni.hideLoading()
    uni.previewImage({ urls: [url] })
  } catch (e) { uni.hideLoading(); uni.showToast({ title: e.message || '圖片載入失敗', icon: 'none' }) }
}

// ── 第 15 輪：上傳文件、顧問、通知 ──
export const MAX_UPLOAD = 5 * 1024 * 1024
// 選相片（相機或相簿）；回傳 [{ name, path, size }]
export function pickPhotos() {
  return new Promise((resolve, reject) => uni.chooseImage({ count: 6, sizeType: ['compressed'], sourceType: ['camera', 'album'],
    success: r => resolve((r.tempFiles || []).map((f, i) => ({ name: f.name || `相片${i + 1}.jpg`, path: f.path || r.tempFilePaths[i], size: f.size }))),
    fail: e => /cancel/.test(e.errMsg || '') ? resolve([]) : reject(new Error('未能選擇相片')) }))
}
// 選 PDF：小程序從聊天記錄選，H5 從檔案選
export function pickPdf() {
  return new Promise((resolve, reject) => {
    const done = files => resolve(files.map(f => ({ name: f.name || '文件.pdf', path: f.path, size: f.size })))
    const failed = e => /cancel/.test(e.errMsg || '') ? resolve([]) : reject(new Error('未能選擇文件'))
    // #ifdef MP-WEIXIN
    uni.chooseMessageFile({ count: 3, type: 'file', extension: ['pdf'], success: r => done(r.tempFiles), fail: failed })
    // #endif
    // #ifndef MP-WEIXIN
    uni.chooseFile({ count: 3, extension: ['.pdf'], success: r => done(r.tempFiles), fail: failed })
    // #endif
  })
}
function readBase64(path) {
  // #ifdef H5
  return fetch(path).then(r => r.arrayBuffer()).then(buffer => uni.arrayBufferToBase64(buffer))
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => uni.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: r => resolve(r.data), fail: () => reject(new Error('讀取檔案失敗')) }))
  // #endif
}
export async function uploadAttachment(requestId, file, taskId) {
  if (file.size && file.size > MAX_UPLOAD) throw new Error(`${file.name} 超過 5 MB`)
  const data = await readBase64(file.path)
  return api(`/my/requests/${encodeURIComponent(requestId)}/attachments`, 'POST', { fileName: file.name, data, taskId: taskId || null })
}
export const attachmentTone = { 待確認: 'blue', 已確認: '', 需重交: 'red' }
export const attachmentLabel = { 待確認: '顧問核對中', 已確認: '已收妥', 需重交: '需要重交' }
export function callAdvisor(phone) { if (phone) uni.makePhoneCall({ phoneNumber: phone.replace(/[\s-]/g, '') }) }
export function copyText(value, title = '已複製') { if (value) uni.setClipboardData({ data: value, success: () => uni.showToast({ title, icon: 'none' }) }) }
