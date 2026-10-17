/* 按次收費的事項標記辦好後，API 回傳 feeSuggestion：問管理者要不要記一筆收費（docs/tasks/scope-items-design.md §5）。 */
import { api, rentMoney } from '@/api'
import { confirm } from './confirm'

interface FeeSuggestion { customerId: string; kind: string; description: string; currency: string; amount: number; plateId?: string | null }

export async function offerFee(result: { feeSuggestion?: FeeSuggestion } | null | undefined): Promise<boolean> {
  const fee = result?.feeSuggestion
  if (!fee) return false
  const ok = await confirm({ title: '記一筆收費？', message: `按價目，「${fee.description}」按次收費 ${rentMoney(fee.amount, fee.currency)}。要記為這位客戶的未收代辦費嗎？`, confirmText: '記收費' })
  if (!ok) return false
  await api('/fees', 'POST', { customerId: fee.customerId, kind: fee.kind, currency: fee.currency, amount: fee.amount, description: fee.description, ...(fee.plateId ? { plateId: fee.plateId } : {}) })
  return true
}
