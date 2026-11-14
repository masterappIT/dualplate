import { useConfirm } from './choice'

// 安卓 App 檢查新版本（App Store 版由商店更新，網頁版不需要）：
// 讀網站上的 /download/version.json（deploy/web/download/version.json），比對已安裝 APK 的版本編號。
// 有新版本：問「稍後／立即更新」，每次打開 App 只問一次；低於 minVersionCode：必須更新，提示不能關閉。
// 立即更新：在 App 內下載新 APK（顯示進度），核對下載到的確實是本 App 的新版本，才交給系統安裝。
// check() 一定會完成、不會出錯，而且要等更新提示關掉才完成：頁面自己的提示（例如服務條款）放在它之後，兩個提示框不會疊在一起。
// 在有 <wd-message-box /> 的頁面的 setup 裏呼叫。
const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4100'
// App 長時間留在背景，回到前台時隔這麼久才再讀一次版本
const recheckAfter = 6 * 3600 * 1000
let latest = null, fetchedAt = 0, asked = false, running = null

export function useAppUpdate() {
  const confirmBox = useConfirm()
  function check() {
    // #ifdef APP-PLUS
    if (plus.os.name !== 'Android') return Promise.resolve()
    // 正在檢查或下載時再呼叫，等同一次完成，不會另開提示
    if (!running) running = run(confirmBox).catch(() => {}).finally(() => { running = null })
    return running
    // #endif
    return Promise.resolve()
  }
  return { check }
}

// #ifdef APP-PLUS
async function run(confirmBox) {
  const current = installedVersion()
  if (!current) return
  const page = currentPage()
  if (!latest || Date.now() - fetchedAt > recheckAfter) {
    const found = await fetchLatest()
    if (found) { latest = found; fetchedAt = Date.now() }
  }
  if (!latest || latest.versionCode <= current) return removeDownloads()
  const force = current < latest.minVersionCode
  // 讀版本期間用戶已轉到別頁：不在看不見的頁面彈提示，下次回來再問
  if ((asked && !force) || currentPage() !== page) return
  asked = true
  const title = `有新版本 ${latest.versionName}`
  if (force) {
    await confirmBox.notice({ title, msg: (latest.notes ? latest.notes + '\n' : '') + '這個版本已停止使用，請先更新。', ok: '立即更新', locked: true })
  } else if (await confirmBox.ask({ title, msg: latest.notes, ok: '立即更新', cancel: '稍後' }) !== 'confirm') {
    return
  }
  // 必須更新時失敗了只能再試；一般更新失敗就提示，下次打開 App 再問
  for (;;) {
    try {
      const path = await download(latest)
      checkApk(path, latest.versionCode)
      return await install(path)
    } catch (e) {
      const msg = e.message || '更新失敗，請到下載頁下載新版本'
      if (!force) return uni.showToast({ title: msg, icon: 'none', duration: 3000 })
      await confirmBox.notice({ title: '更新失敗', msg, ok: '再試一次', locked: true })
    }
  }
}

function currentPage() {
  const pages = getCurrentPages()
  return pages[pages.length - 1]
}

function packageManager() {
  const main = plus.android.runtimeMainActivity()
  return { main, manager: plus.android.invoke(main, 'getPackageManager') }
}

// 已安裝 APK 的 versionCode（android/app/gradle.properties 的 appVersionCode）
function installedVersion() {
  try {
    const { main, manager } = packageManager()
    const info = plus.android.invoke(manager, 'getPackageInfo', plus.android.invoke(main, 'getPackageName'), 0)
    return Number(plus.android.getAttribute(info, 'versionCode')) || 0
  } catch { return 0 }
}

// 讀不到或格式不對就當沒有新版本，不打擾用戶
function fetchLatest() {
  return new Promise(resolve => uni.request({
    url: base + '/download/version.json?t=' + Date.now(), timeout: 8000,
    success: ({ statusCode, data }) => {
      const ok = statusCode === 200 && data && Number.isInteger(data.versionCode) && typeof data.url === 'string' && /^https?:\/\//.test(data.url)
      resolve(ok ? { versionCode: data.versionCode, versionName: String(data.versionName || data.versionCode), minVersionCode: Number.isInteger(data.minVersionCode) ? data.minVersionCode : 0, notes: typeof data.notes === 'string' ? data.notes : '', url: data.url } : null)
    },
    fail: () => resolve(null)
  }))
}

// 新 APK 存在 _downloads/dualplate-<versionCode>.apk；同名檔存在時 plus.downloader 會另取名字，所以下載前先刪掉
const downloadName = versionCode => `_downloads/dualplate-${versionCode}.apk`

function removeFile(name) {
  return new Promise(resolve => plus.io.resolveLocalFileSystemURL(name, entry => entry.remove(resolve, resolve), resolve))
}

// 已是最新版：刪掉以前下載的更新檔（每個約 30MB）
function removeDownloads() {
  plus.io.resolveLocalFileSystemURL('_downloads/', dir => dir.createReader().readEntries(entries => {
    for (const entry of entries) if (entry.isFile && /^dualplate-\d+\.apk$/.test(entry.name)) entry.remove()
  }), () => {})
}

async function download({ url, versionCode }) {
  const name = downloadName(versionCode)
  await removeFile(name)
  return new Promise((resolve, reject) => {
    let shown = -1
    const progress = percent => { if (percent === shown) return; shown = percent; uni.showLoading({ title: `正在下載新版本 ${percent}%`, mask: true }) }
    progress(0)
    // 網址帶上版本編號，每個版本都不同，不會拿到伺服器或網絡快取的舊 APK
    const link = url + (url.includes('?') ? '&' : '?') + 'v=' + versionCode
    const task = plus.downloader.createDownload(link, { filename: name, timeout: 30, retry: 2 }, (done, status) => {
      uni.hideLoading()
      if (status === 200) resolve(plus.io.convertLocalFileSystemURL(done.filename))
      else reject(new Error('下載失敗，請檢查網絡後再試'))
    })
    task.addEventListener('statechanged', t => { if (t.state === 3 && t.totalSize > 0) progress(Math.floor(t.downloadedSize / t.totalSize * 100)) })
    task.start()
  })
}

// 下載到的必須是本 App、而且不舊於 version.json 寫的版本；否則（檔案不完整、拿到舊檔）不交給系統安裝
function checkApk(path, versionCode) {
  let info = null
  try {
    const { main, manager } = packageManager()
    const archive = plus.android.invoke(manager, 'getPackageArchiveInfo', path, 0)
    if (archive) info = { name: plus.android.getAttribute(archive, 'packageName'), code: Number(plus.android.getAttribute(archive, 'versionCode')), own: plus.android.invoke(main, 'getPackageName') }
  } catch {}
  if (!info || info.name !== info.own || !(info.code >= versionCode)) {
    removeFile(downloadName(versionCode))
    throw new Error('下載的檔案不完整，請再試一次')
  }
}

// 交給系統安裝；第一次會要求允許本 App「安裝未知應用」
// 安裝模組缺失時 plus.runtime.install 不會回應（android/app/client/build.gradle 的 install-apk-release.aar），10 秒沒回應當失敗，免得 check() 一直不完成、條款提示永遠不出
function install(path) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('未能安裝，請到下載頁下載新版本'))
    const timer = setTimeout(fail, 10000)
    plus.runtime.install(path, { force: false }, () => { clearTimeout(timer); resolve() }, () => { clearTimeout(timer); fail() })
  })
}
// #endif
