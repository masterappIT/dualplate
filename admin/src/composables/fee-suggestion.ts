/* 按次收費的事項標記辦好後，API 回傳 feeSuggestion：問管理者要不要記一筆收費（docs/tasks/scope-items-design.md §5）。 */
import { api, rentMoney } from '@/api'
import { confirm } from './confirm'

interface FeeSuggestion { customerId: string; kind: string; description: string; currency: string; amount: number; plateId?: string | null }

// 批量標記辦好：多筆按次收費只問一次，確認後逐筆記為未收（periodKey 防止重複記）。
export async function offerFees(list: (FeeSuggestion & { periodKey?: string })[] | null | undefined): Promise<number> {
  if (!list?.length) return 0
  const totals = Object.entries(list.reduce<Record<string, number>>((sum, fee) => ({ ...sum, [fee.currency]: (sum[fee.currency] || 0) + fee.amount }), {})).map(([currency, amount]) => rentMoney(amount, currency)).join('、')
  const ok = await confirm({ title: '記收費？', message: `剛辦好的事項中有 ${list.length} 項按次收費，合共 ${totals}。要記為客戶的未收代辦費嗎？`, confirmText: `記 ${list.length} 筆收費` })
  if (!ok) return 0
  for (const fee of list) await api('/fees', 'POST', { customerId: fee.customerId, kind: fee.kind, currency: fee.currency, amount: fee.amount, description: fee.description, ...(fee.plateId ? { plateId: fee.plateId } : {}), ...(fee.periodKey ? { periodKey: fee.periodKey } : {}) })
  return list.length
}

export async function offerFee(result: { feeSuggestion?: FeeSuggestion } | null | undefined): Promise<boolean> {
  const fee = result?.feeSuggestion
  if (!fee) return false
  const ok = await confirm({ title: '記一筆收費？', message: `按價目，「${fee.description}」按次收費 ${rentMoney(fee.amount, fee.currency)}。要記為這位客戶的未收代辦費嗎？`, confirmText: '記收費' })
  if (!ok) return false
  await api('/fees', 'POST', { customerId: fee.customerId, kind: fee.kind, currency: fee.currency, amount: fee.amount, description: fee.description, ...(fee.plateId ? { plateId: fee.plateId } : {}) })
  return true
}
