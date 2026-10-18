/* 今日工作自動更新（2026-10-18 管理者要求：客戶提交申請後後台要有反應）。
   今日工作各區塊（註冊申請、客戶訊息、客戶更新待核對等）和導航的待處理數目用同一套：打開時讀一次，之後每分鐘讀一次；
   切回這個分頁或視窗時立即讀；按「重新整理」時全部一起讀。分頁在背景時不讀，免得白白請求。 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'

const REFRESH_EVENT = 'today:refresh'
const LOADED_EVENT = 'today:loaded'
const INTERVAL = 60_000
const MIN_GAP = 10_000

/** 通知今日工作各區塊和導航數目立即重新讀取（「重新整理」按鈕用）。 */
export function refreshToday() { window.dispatchEvent(new Event(REFRESH_EVENT)) }

/** 有區塊讀完（例如批准了申請、看了訊息），通知導航數目跟着更新。 */
let loadedTimer = 0
export function todayChanged() { window.clearTimeout(loadedTimer); loadedTimer = window.setTimeout(() => window.dispatchEvent(new Event(LOADED_EVENT)), 300) }

/** 打開時讀取，之後自動更新。`notify` 為 true 時每次讀完都通知導航數目更新。 */
export function useLiveRefresh(load: () => Promise<unknown> | unknown, { notify = true, onChanged = false } = {}) {
  let last = 0, timer = 0
  const run = async (force = false) => {
    if (!force && Date.now() - last < MIN_GAP) return
    last = Date.now()
    await load()
    if (notify) todayChanged()
  }
  const tick = () => { if (document.visibilityState === 'visible') run() }
  const visible = () => { if (document.visibilityState === 'visible') run() }
  const forced = () => run(true)
  onMounted(() => {
    run(true)
    timer = window.setInterval(tick, INTERVAL)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    window.addEventListener(REFRESH_EVENT, forced)
    if (onChanged) window.addEventListener(LOADED_EVENT, forced)
  })
  onBeforeUnmount(() => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('focus', visible)
    window.removeEventListener(REFRESH_EVENT, forced)
    if (onChanged) window.removeEventListener(LOADED_EVENT, forced)
  })
  return { reload: () => run(true) }
}

/** 今日工作待處理數目（客戶送來、要員工處理的事），導航和手機選單按鈕顯示；由 AppShell 讀取一次，各處共用。 */
export interface TodayPending { signups: number; messages: number; changes: number; selfHandled: number; clientRentals: number; closures: number; total: number }
export const todayPending = ref<TodayPending | null>(null)
export function useTodayPending() {
  return useLiveRefresh(async () => { try { todayPending.value = await api('/today-counts') } catch { /* 讀不到時不顯示數字，下次再讀 */ } }, { notify: false, onChanged: true })
}
const pendingLabels: Array<[keyof TodayPending, string]> = [['signups', '註冊申請'], ['messages', '客戶訊息'], ['changes', '客戶更新待核對'], ['selfHandled', '客戶自行辦理待核對'], ['clientRentals', '客戶新增出租'], ['closures', '帳戶已注銷']]
/** 例如「註冊申請 1 · 客戶訊息 2」，用作提示文字。 */
export const pendingSummary = (value: TodayPending | null) => value ? pendingLabels.filter(([key]) => value[key]).map(([key, label]) => `${label} ${value[key]}`).join(' · ') : ''
