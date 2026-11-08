// 检查中英对照：列出代码里 t('…') / tr('…') 用到、但 src/i18n/en.ts 里还没有英文的中文；
// 也检查占位 {name} 两边是否一致，和对照表里多余的条目。
// 用法：npm run i18n:check（有问题时退出码为 1）；加 --keys 只打印代码里用到的全部中文。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EN, VALUE_KEYS } from '../src/i18n/en.ts'

const root = new URL('..', import.meta.url).pathname
const SKIP = new Set(['src/i18n', 'src/lib/database.types.ts'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.has(relative(root, p))) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const CALL = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c))
const used = new Map() // 中文 → 第一次出现的位置

for (const file of walk(join(root, 'src'))) {
  // 注释里举的例子不算
  const src = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
    .join('\n')
  for (const m of src.matchAll(CALL)) {
    const key = unescape(m[2])
    if (!/[一-鿿]/.test(key)) continue
    if (!used.has(key)) {
      const line = src.slice(0, m.index).split('\n').length
      used.set(key, `${relative(root, file)}:${line}`)
    }
  }
}

if (process.argv.includes('--keys')) {
  for (const [k, at] of used) console.log(`${at}\t${k}`)
  process.exit(0)
}

const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const missing = [...used].filter(([k]) => EN[k] === undefined)
const badHolders = Object.entries(EN).filter(([k, v]) => holders(k) !== holders(v))
const values = new Set(VALUE_KEYS)
const unused = Object.keys(EN).filter((k) => !used.has(k) && !values.has(k))

for (const [k, at] of missing) console.log(`缺英文  ${at}  ${k}`)
for (const [k, v] of badHolders) console.log(`占位不一致  ${k}  →  ${v}`)
for (const k of unused) console.log(`没用到  ${k}`)
console.log(`\n代码里 ${used.size} 句，对照表 ${Object.keys(EN).length} 条；缺 ${missing.length}，占位不一致 ${badHolders.length}，没用到 ${unused.length}`)
process.exit(missing.length || badHolders.length ? 1 : 0)
