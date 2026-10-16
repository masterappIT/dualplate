// 檢查每個 .vue 模板用到的 PascalCase 組件都有 import（漏 import 時編譯不報錯，畫面卻整塊不顯示）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
const builtin = new Set(['Transition', 'TransitionGroup', 'KeepAlive', 'Teleport', 'Suspense', 'RouterView', 'RouterLink', 'Component'])
const files = []
const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.vue')) files.push(path) } }
walk(new URL('../src', import.meta.url).pathname)
const problems = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const template = source.slice(source.indexOf('<template'))
  const used = new Set([...template.matchAll(/<([A-Z][A-Za-z0-9]+)/g)].map(match => match[1]))
  const imported = new Set([...source.matchAll(/import\s+([A-Z][A-Za-z0-9]+)/g)].map(match => match[1]))
  for (const match of source.matchAll(/import\s*(?:[A-Za-z0-9_]+\s*,\s*)?\{([^}]+)\}/g)) for (const part of match[1].split(',')) imported.add(part.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop().trim())
  for (const name of used) if (!imported.has(name) && !builtin.has(name) && name !== basename(file, '.vue')) problems.push(`${file.split('/src/')[1]}: <${name}> 沒有 import`)
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
console.log('component imports OK')
