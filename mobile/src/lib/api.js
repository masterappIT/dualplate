const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4100'
export function getToken() { return uni.getStorageSync('token') }
export function saveSession(result) { uni.setStorageSync('token', result.token); uni.setStorageSync('user', result.user) }
export function clearSession() { uni.removeStorageSync('token'); uni.removeStorageSync('user') }
export function getUser() { return uni.getStorageSync('user') || null }
export function api(path, method = 'GET', data) {
  return new Promise((resolve, reject) => {
    uni.request({ url: base + '/api' + path, method, data,
      header: { authorization: getToken() ? `Bearer ${getToken()}` : '', 'content-type': 'application/json' },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
        if (response.statusCode === 401 && path !== '/login' && !path.startsWith('/wechat/')) { clearSession(); uni.navigateTo({ url: '/pages/login/login' }) }
        reject(Object.assign(new Error(response.data?.error || '操作失敗'), { status: response.statusCode, data: response.data }))
      }, fail(error) { reject(new Error('連不上伺服器，請檢查網絡後再試')) }
    })
  })
}
// Shared wording and colours for deadline states on the client screens.
export const levelLabel = { overdue: '已逾期', due: '快到期', upcoming: '即將到期', ok: '正常' }
export const levelTone = { overdue: 'red', due: 'amber', upcoming: '', ok: '' }
export function daysText(item) { return item.daysLeft == null ? '' : item.daysLeft < 0 ? `逾期 ${-item.daysLeft} 天` : item.daysLeft === 0 ? '今天到期' : `${item.daysLeft} 天` }
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
