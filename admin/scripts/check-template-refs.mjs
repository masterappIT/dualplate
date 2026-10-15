// Lists template identifiers that a component neither defines nor imports (they render as _ctx.x and crash).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
const dir = new URL('../src/', import.meta.url).pathname
let failed = false
const files = [join(dir, 'App.vue'), ...readdirSync(join(dir, 'views')).map(f => join(dir, 'views', f)), ...readdirSync(join(dir, 'components')).map(f => join(dir, 'components', f))]
for (const file of files.filter(f => f.endsWith('.vue'))) {
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  if (!descriptor.template) continue
  let bindings = {}
  if (descriptor.scriptSetup || descriptor.script) bindings = compileScript(descriptor, { id: 'x', inlineTemplate: false }).bindings || {}
  const out = compileTemplate({ source: descriptor.template.content, filename: file, id: 'x', compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true } })
  const refs = [...new Set([...out.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].filter(n => !['$emit', '$event', '$slots', '$attrs', '$props'].includes(n))
  if (refs.length) { failed = true; console.log(file.split('/src/')[1], '→', refs.join(', ')) }
}
if (failed) process.exit(1)
console.log('template references OK')
