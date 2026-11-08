// 中英双语：界面文字用中文原文做键，英文在 src/i18n/en.ts 里对照；没有对照的照原样显示中文。
// 报款文字是发到中文群的，不翻译。
// 语言记在浏览器里：登录前用这台设备上次的选择；登录后用这个人自己上次的选择（同一台电脑多人用也不互相影响）。
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { EN } from '../i18n/en'

export type Lang = 'zh' | 'en'
type Vars = Record<string, string | number | null | undefined>

const DEVICE_KEY = 'lang'
const userKey = (uid: string) => `lang:${uid}`

function readSaved(key: string): Lang | null {
  try {
    const v = localStorage.getItem(key)
    return v === 'zh' || v === 'en' ? v : null
  } catch {
    return null
  }
}

function save(key: string, lang: Lang) {
  try {
    localStorage.setItem(key, lang)
  } catch {
    // 无痕模式等存不了就算了
  }
}

function browserLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : []
  return langs.some((l) => l?.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

let current: Lang = readSaved(DEVICE_KEY) ?? browserLang()
let currentUser: string | null = null
applyLocale(current)

function applyLocale(lang: Lang) {
  dayjs.locale(lang === 'en' ? 'en' : 'zh-cn')
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
}

const missing = new Set<string>()

/** 翻译。中文原文做键，{name} 是占位：tr('共 {n} 笔', { n: 3 }) */
export function tr(zh: string, vars?: Vars): string {
  let s = zh
  if (current === 'en') {
    const en = EN[zh]
    if (en !== undefined) s = en
    else if (import.meta.env.DEV && !missing.has(zh)) {
      missing.add(zh)
      ;(window as unknown as { __i18nMissing?: string[] }).__i18nMissing = [...missing]
    }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m))
  return s
}

// 服务器（数据库触发器、账号服务）发回来的中文报错：先整句查对照表；
// 带金额、编号的，用对照表里带 {占位} 的句子反过来匹配，占位里的值（比如款项性质）也再翻一次。
type ServerPattern = { re: RegExp; names: string[]; zh: string }
let serverPatterns: ServerPattern[] | null = null

function patterns(): ServerPattern[] {
  if (serverPatterns) return serverPatterns
  serverPatterns = []
  for (const zh of Object.keys(EN)) {
    // 只用带占位、而且占位以外有中文的句子
    if (!/\{\w+\}/.test(zh) || !/[\u4e00-\u9fff]/.test(zh.replace(/\{\w+\}/g, ''))) continue
    const names: string[] = []
    const src = zh
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part)
        if (m) {
          names.push(m[1])
          return '(.+?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    serverPatterns.push({ re: new RegExp(`^${src}$`, 's'), names, zh })
  }
  // 固定文字多的先试，免得被短句抢先匹配
  const fixed = (zh: string) => zh.replace(/\{\w+\}/g, '').length
  serverPatterns.sort((a, b) => fixed(b.zh) - fixed(a.zh))
  return serverPatterns
}

/** 翻译服务器发回来的报错；对不上就原样返回 */
export function trServer(msg: string): string {
  if (current !== 'en' || !msg) return msg
  const exact = EN[msg]
  if (exact !== undefined) return exact
  for (const p of patterns()) {
    const m = p.re.exec(msg)
    if (!m) continue
    const vars: Vars = {}
    p.names.forEach((n, i) => (vars[n] = EN[m[i + 1]] ?? m[i + 1]))
    return tr(p.zh, vars)
  }
  return msg
}

/** 现在的语言（给不在组件里的代码用） */
export function currentLang(): Lang {
  return current
}

type I18n = {
  lang: Lang
  setLang: (lang: Lang) => void
  /** 登录后调用：换成这个人上次选的语言 */
  bindUser: (uid: string | null) => void
  t: (zh: string, vars?: Vars) => string
}

const Ctx = createContext<I18n | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current)

  const apply = useCallback((l: Lang) => {
    current = l
    applyLocale(l)
    setLangState(l)
  }, [])

  const setLang = useCallback(
    (l: Lang) => {
      save(DEVICE_KEY, l)
      if (currentUser) save(userKey(currentUser), l)
      apply(l)
    },
    [apply],
  )

  const bindUser = useCallback(
    (uid: string | null) => {
      currentUser = uid
      if (!uid) return
      const mine = readSaved(userKey(uid))
      if (mine) {
        if (mine !== current) apply(mine)
      } else save(userKey(uid), current)
    },
    [apply],
  )

  // lang 变了 t 也换一个，用到 t 的 useMemo / useCallback 会跟着重算
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useCallback((zh: string, vars?: Vars) => tr(zh, vars), [lang])
  const value = useMemo<I18n>(() => ({ lang, setLang, bindUser, t }), [lang, setLang, bindUser, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside LangProvider')
  return ctx
}

/** 组件里用：const t = useT() */
export function useT() {
  return useI18n().t
}
