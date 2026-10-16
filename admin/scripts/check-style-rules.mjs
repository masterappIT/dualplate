import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@vue/compiler-sfc'

const root = new URL('../src/', import.meta.url).pathname
const directories = ['views', 'components/business', 'components/ui', 'components/layout']
const forbidden = /#[\da-fA-F]{3,8}\b|\brgba?\s*\(|\bfont-size\s*:|\bborder-radius\s*:|\bbox-shadow\s*:/i
let violations = 0
for (const directory of directories) {
  for (const filename of readdirSync(join(root, directory)).filter(name => name.endsWith('.vue') && name !== 'ApprovalCard.vue')) {
    const source = readFileSync(join(root, directory, filename), 'utf8')
    const { descriptor } = parse(source, { filename })
    const locations = [...descriptor.styles.map(block => block.content), ...[...descriptor.template?.content.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/g) || []].map(match => match[2])]
    for (const location of locations) {
      const match = forbidden.exec(location)
      if (match) { console.error(`${directory}/${filename}: 禁止在頁面樣式使用 ${match[0]}`); violations += 1 }
    }
  }
}
if (violations) process.exitCode = 1
else console.log('style rules OK')
