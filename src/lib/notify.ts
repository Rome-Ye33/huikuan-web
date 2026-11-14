// 待办提醒：有新的待办时，系统在工作日上午 10 点、下午 4 点（加纳时间）把每个人的新待办合成一封邮件发给他（数据库 17、18、20 + Edge Function notify）。
// 这里是网页这边用的：开关自己的邮件提醒、把网站的语言记成提醒邮件的语言、给自己发测试邮件、邮件里的按钮打开哪张单。
import { FunctionsHttpError } from '@supabase/supabase-js'
import { tr } from './i18n'
import type { Lang } from './i18n'
import { supabase } from './supabase'

/** 开关自己的邮件提醒，同时把提醒邮件的语言记成 lang。on 给 null = 开关不变，只记语言 */
export async function saveMyNotify(on: boolean | null, lang: Lang): Promise<void> {
  // 数据库那边 p_on 可以是空的（= 不变），生成的类型里没写
  const { error } = await supabase.rpc('set_my_email_notify', { p_on: on as boolean, p_lang: lang })
  if (error) throw error
}

/** 给自己发一封测试邮件；返回发到的邮箱 */
export async function sendTestEmail(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('notify', { body: { action: 'test' } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(j?.error ?? tr('操作失败，请稍后再试'))
    }
    throw new Error(tr('网络连接失败，请检查网络后重试'))
  }
  const r = data as { ok?: boolean; to?: string } | null
  if (!r?.ok) throw new Error(tr('操作失败，请稍后再试'))
  return r.to ?? ''
}

// ---------------------------------------------------------------- 邮件里的按钮
// 按钮打开 https://…/fetpower/?go=v12（提成单 12）、?go=s34（到账提交 34）、?go=r56（到账 56）、?go=wb（工作台）。
// 页面一打开就记下来、把地址栏里的 ?go= 去掉；没登录的登录以后再打开。
const GO_KEY = 'go'
const GO_RE = /^(?:[vsr]\d{1,12}|wb)$/

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
export function parseOpen(v: string | null): { type: 'voucher' | 'submission' | 'receipt'; id: number } | null {
  const m = v ? /^([vsr])(\d{1,12})$/.exec(v) : null
  return m ? { type: m[1] === 'v' ? 'voucher' : m[1] === 'r' ? 'receipt' : 'submission', id: Number(m[2]) } : null
}
