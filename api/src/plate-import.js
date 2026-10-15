const headers = [
  '客戶',
  '路線',
  '內地車牌',
  '港澳車牌',
  '批文卡號',
  '批文到期',
  'CRP／通行證到期',
  '香港／澳門公司',
  '內地公司',
]

const normalizeHeader = value => String(value || '').replace(/^\ufeff/, '').replace(/[\s]/g, '').replace(/\//g, '／')

export const requiredHeaders = headers

export function parseCsv(text) {
  const input = String(text || '').replace(/^\ufeff/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let closed = false
  let lineNumber = 1
  let rowStart = 1
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]
    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"' && (quoted || cell === '' && !closed)) {
      quoted = !quoted
      closed = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
      closed = false
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell.trim())
      if (row.some(value => value !== '')) rows.push({ values: row, rowNumber: rowStart })
      row = []
      cell = ''
      closed = false
      lineNumber += 1
      rowStart = lineNumber
    } else {
      if (character === '\n') lineNumber += 1
      if (closed && quoted === false && character !== ' ' && character !== '\t' || character === '"') throw new Error('CSV 引號格式錯誤')
      cell += character
    }
  }
  if (quoted) throw new Error('CSV 內容有未關閉的引號')
  if (cell !== '' || row.length) {
    row.push(cell.trim())
    if (row.some(value => value !== '')) rows.push({ values: row, rowNumber: rowStart })
  }
  if (!rows.length) return { rows: [], errors: ['CSV 沒有資料'] }
  const actualHeaders = rows.shift().values.map(normalizeHeader)
  const missing = headers.filter(header => !actualHeaders.includes(normalizeHeader(header)))
  if (missing.length) return { rows: [], errors: [`缺少欄位：${missing.join('、')}`] }
  if (new Set(actualHeaders).size !== actualHeaders.length) return { rows: [], errors: ['CSV 表頭有重複欄位'] }
  const positions = Object.fromEntries(headers.map(header => [header, actualHeaders.indexOf(normalizeHeader(header))]))
  return {
    rows: rows.map(({ values, rowNumber }) => ({
      rowNumber,
      values: Object.fromEntries(headers.map(header => [header, String(values[positions[header]] || '').trim()])),
      columnError: values.length !== actualHeaders.length ? '欄位數與表頭不符' : null,
    })),
    errors: [],
  }
}
