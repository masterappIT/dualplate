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
        if (response.statusCode === 401 && path !== '/login') { clearSession(); uni.navigateTo({ url: '/pages/login/login' }) }
        reject(new Error(response.data?.error || '操作失敗'))
      }, fail(error) { reject(new Error(error.errMsg || '網絡連接失敗')) }
    })
  })
}
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
      }, fail(error) { reject(new Error(error.errMsg || '圖片載入失敗')) }
    })
  })
}
