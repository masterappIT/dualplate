// 關係圖點進分類後的條目排列：條目（膠囊，最寬 220px；窄螢幕 200px，見 dynamic.css）從中心盤右邊起排，欄數按畫布寬度決定，最右一欄不超出畫布
const ITEM = 220, NARROW_ITEM = 200, GAP = 230, EDGE = 16

// 窄螢幕中心盤放左邊，與右邊的膠囊欄不重疊
export const narrowCoreX = (width: number) => Math.max(width * .14, 50)

export function itemGrid(width: number, coreX: number) {
  if (width < 650) return { columns: 1, x: () => Math.max(EDGE, Math.min(width * .48, width - EDGE - NARROW_ITEM)) }
  const start = Math.max(coreX + 120, width * .34)
  const columns = Math.max(1, Math.min(3, Math.floor((width - EDGE - ITEM - start) / GAP) + 1))
  const step = columns > 1 ? Math.min(260, (width - EDGE - ITEM - start) / (columns - 1)) : 0
  return { columns, x: (index: number) => start + (index % columns) * step }
}
