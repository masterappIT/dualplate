/* 移植自 scaffold-vue/src/composables/toast.ts，已改：以現有 API 錯誤訊息顯示繁體中文提示。 */
import { reactive } from 'vue'

export type ToastTone = 'ok' | 'info' | 'danger'
export interface ToastItem { id: number; msg: string; tone: ToastTone; duration: number }
export const toasts = reactive<ToastItem[]>([])
const timers = new Map<number, { handle: number; endsAt: number; remaining: number }>()
let paused = false
let seed = 0
function dismiss(id: number) {
  const index = toasts.findIndex(item => item.id === id)
  if (index !== -1) toasts.splice(index, 1)
  const timer = timers.get(id)
  if (timer) window.clearTimeout(timer.handle)
  timers.delete(id)
}
function schedule(id: number, milliseconds: number) {
  timers.set(id, { handle: paused ? 0 : window.setTimeout(() => dismiss(id), milliseconds), endsAt: Date.now() + milliseconds, remaining: milliseconds })
}
export function pushToast(message: string, tone: ToastTone = 'ok') {
  const id = ++seed
  const duration = tone === 'danger' ? 4200 : 2600
  toasts.push({ id, msg: message, tone, duration })
  if (toasts.length > 4) dismiss(toasts[0].id)
  schedule(id, duration)
}
export function pauseToasts() { if (paused) return; paused = true; timers.forEach(timer => { window.clearTimeout(timer.handle); timer.remaining = Math.max(0, timer.endsAt - Date.now()) }) }
export function resumeToasts() { if (!paused) return; paused = false; timers.forEach((timer, id) => schedule(id, Math.max(600, timer.remaining))) }
export { dismiss as dismissToast }
export function toastError(error: unknown, fallback: string) { pushToast(error instanceof Error ? error.message : fallback, 'danger') }
