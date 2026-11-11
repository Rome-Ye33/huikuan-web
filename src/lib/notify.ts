// 待办提醒：有新的待办时，系统发一条 WhatsApp 消息给该处理的人（数据库 17_todo_notify.sql + Edge Function notify）。
// 这里是网页这边用的：号码怎么填、存自己的号码、给自己发测试消息、消息里的按钮打开哪张单。
import { FunctionsHttpError } from '@supabase/supabase-js'
import { tr } from './i18n'
import type { Lang } from './i18n'
import { supabase } from './supabase'

/**
 * 把填的号码整理成 +国家区号号码（和数据库里存的一样）：
 * 空格、横线、括号、点去掉；00 开头换成 +；加纳本地写法 024 123 4567（0 开头 10 位）补上 +233；
 * 233 开头没写 + 的补上 +；写成 +233 0XX… 的去掉多余的 0。
 * 返回 null = 没填（不发提醒）；undefined = 格式不对。
 */
export function normalizePhone(input: string | null | undefined): string | null | undefined {
  let v = (input ?? '').replace(/[\s().-]/g, '')
  if (!v) return null
  if (v.startsWith('00')) v = '+' + v.slice(2)
  else if (/^0\d{9}$/.test(v)) v = '+233' + v.slice(1)
  else if (/^233\d{9}$/.test(v)) v = '+' + v
  if (/^\+2330\d{9}$/.test(v)) v = '+233' + v.slice(5)
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : undefined
}

/** 显示用：加纳号码 +233 24 123 4567，中国手机 +86 138 0013 8000，其他照原样 */
export function formatPhone(v: string | null | undefined): string {
  if (!v) return ''
  let m = /^\+233(\d{2})(\d{3})(\d{4})$/.exec(v)
  if (m) return `+233 ${m[1]} ${m[2]} ${m[3]}`
  m = /^\+86(1\d{2})(\d{4})(\d{4})$/.exec(v)
  if (m) return `+86 ${m[1]} ${m[2]} ${m[3]}`
  return v
}

/** 存自己的号码和提醒语言 */
export async function saveMyNotify(whatsapp: string | null, lang: Lang): Promise<void> {
  const { error } = await supabase.rpc('set_my_notify', { p_whatsapp: whatsapp ?? '', p_lang: lang })
  if (error) throw error
}

/** 给自己发一条测试消息 */
export async function sendTestMessage(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('notify', { body: { action: 'test' } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(j?.error ?? tr('操作失败，请稍后再试'))
    }
    throw new Error(tr('网络连接失败，请检查网络后重试'))
  }
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error(tr('操作失败，请稍后再试'))
}

// ---------------------------------------------------------------- 消息里的按钮
// 按钮打开 https://…/huikuan-web/?go=v12（提成单 12）、?go=s34（到账提交 34）、?go=wb（工作台）。
// 页面一打开就记下来、把地址栏里的 ?go= 去掉；没登录的登录以后再打开。
const GO_KEY = 'go'
const GO_RE = /^(?:[vs]\d{1,12}|wb)$/

export function captureGo(): void {
  try {
    const url = new URL(window.location.href)
    const go = url.searchParams.get(GO_KEY)
    if (go === null) return
    if (GO_RE.test(go)) sessionStorage.setItem(GO_KEY, go)
    url.searchParams.delete(GO_KEY)
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // 地址不对、存不了就算了
  }
}

/** 取出记下的（取一次就清掉）：工作台上要打开的单据，没有返回 null */
export function takeGo(): string | null {
  try {
    const go = sessionStorage.getItem(GO_KEY)
    if (go) sessionStorage.removeItem(GO_KEY)
    return go && GO_RE.test(go) ? go : null
  } catch {
    return null
  }
}

/** 工作台地址：?open=v12 打开那张单 */
export function goPath(go: string): string {
  return go === 'wb' ? '/workbench' : `/workbench?open=${go}`
}

/** ?open= 的值 → 哪种单据、第几号 */
export function parseOpen(v: string | null): { type: 'voucher' | 'submission'; id: number } | null {
  const m = v ? /^([vs])(\d{1,12})$/.exec(v) : null
  return m ? { type: m[1] === 'v' ? 'voucher' : 'submission', id: Number(m[2]) } : null
}
