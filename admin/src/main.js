import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/tokens.css'
import './styles/base.css'
import './styles/materials.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/dynamic.css'
import { installPressFeedback, installRipple } from './composables/motion'
// 部署後，部署前打開的分頁去點未打開過的頁面時，舊版頁面檔已不存在：自動重新整理並前往該頁。
// 10 秒內只重新整理一次，避免網站真的出錯時不停刷新。
const staleChunk = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i
router.onError((error, to) => {
  if (!staleChunk.test(String(error?.message || error))) return
  let last = 0
  try { last = Number(sessionStorage.getItem('reloadedForUpdate')) || 0 } catch {}
  if (Date.now() - last < 10000) return
  try { sessionStorage.setItem('reloadedForUpdate', String(Date.now())) } catch {}
  window.location.hash = to.fullPath
  window.location.reload()
})
createApp(App).use(router).mount('#app')
installPressFeedback()
installRipple()
