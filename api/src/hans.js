import { TRADITIONAL_TO_SIMPLIFIED_PAIRS } from './hans-chars.js'

const allowed = new Set(['乾', '於', '著', '瞭', '藉', '俱'])
const pairs = [...TRADITIONAL_TO_SIMPLIFIED_PAIRS]
const mapping = new Map()
for (let index = 0; index < pairs.length; index += 2) mapping.set(pairs[index], pairs[index + 1])

export const mainlandName = text => String(text).replace(/\(/g, '（').replace(/\)/g, '）')
export const toSimplified = text => [...mainlandName(text)].map(char => allowed.has(char) ? char : mapping.get(char) || char).join('')
export const traditionalChars = text => [...new Set([...String(text)].filter(char => !allowed.has(char) && mapping.has(char)))].map(char => ({ from: char, to: mapping.get(char) }))
