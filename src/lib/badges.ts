// 菜单上的几个角标（待办、提成单、到账提交、支票）共用这一个轮询：
// 原来每个角标自己发一个计数查询、每个用到它的页面再发一遍，开两三个标签页就是几十个重查询同时压上去，
// 免费版的数据库会被挤到 8 秒超时、整站转圈（2026-11-13 下午就是这样卡的）。
// 现在：一轮两个查询（支票、银行流水待填的数字 5 分钟才取一次），所有页面共用；窗口在后台时不查，
// 切回窗口最多 30 秒查一次；自己提交、审批、改支票之后马上重查。
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Badges = {
  /** 工作台待办 */
  todo: number
  /** 提成单等我处理 */
  voucher: number
  /** 待审核的到账提交 */
  subPending: number
  /** 被退回的到账提交 */
  subRejected: number
  /** 支票：到期还没存的 + 存了 3 天还没到账的 */
  cheque: number
  /** 银行流水还没填的：收进来的（银行有、没人报）、付出去的（付款待填）各几条 */
  lineIn: number
  lineOut: number
}

const ZERO: Badges = { todo: 0, voucher: 0, subPending: 0, subRejected: 0, cheque: 0, lineIn: 0, lineOut: 0 }
const POLL_MS = 60_000
/** 切回窗口时，离上次查不到这个时间就不重查 */
const FOCUS_GAP_MS = 30_000
const CHEQUE_MS = 300_000
const LINES_MS = 300_000
const CHANGED = ['submissions-changed', 'vouchers-changed', 'cheques-changed']

let value: Badges = ZERO
let doneAt = 0
let chequeAt = 0
let linesAt = 0
let running: Promise<void> | null = null
let timer = 0
/** 有几个地方要支票的数字（看不到支票管理的人不查） */
let wantCheque = 0
/** 有几个地方要银行流水待填的数字（不管填流水的人不查） */
let wantLines = 0
const subs = new Set<(b: Badges) => void>()

async function pull() {
  // 同一次渲染里几个角标先后加入（菜单上的几个是一起的）：等它们都登记好要不要支票、流水的数字，再决定这一轮查哪些
  await Promise.resolve()
  const withCheque = wantCheque > 0 && Date.now() - chequeAt >= CHEQUE_MS
  const withLines = wantLines > 0 && Date.now() - linesAt >= LINES_MS
  const [work, sub, alert, lines] = await Promise.all([
    supabase.from('v_workbench').select('doc_type').eq('in_todo', true).limit(2000),
    supabase.from('receipt_submissions').select('status').in('status', ['pending', 'rejected']).limit(2000),
    withCheque ? supabase.rpc('cheque_alert_count') : Promise.resolve(null),
    withLines ? supabase.rpc('journal_todo_count') : Promise.resolve(null),
  ])
  // 查失败（比如数据库忙）就留着上一次的数字，不要一闪变成 0，也不重试
  const next = { ...value }
  if (!work.error && work.data) {
    next.todo = work.data.length
    next.voucher = work.data.filter((r) => r.doc_type === 'voucher').length
  }
  if (!sub.error && sub.data) {
    next.subPending = sub.data.filter((r) => r.status === 'pending').length
    next.subRejected = sub.data.filter((r) => r.status === 'rejected').length
  }
  if (alert && !alert.error) {
    next.cheque = Number(alert.data ?? 0)
    chequeAt = Date.now()
  }
  if (lines && !lines.error && lines.data && typeof lines.data === 'object' && !Array.isArray(lines.data)) {
    next.lineIn = Number(lines.data.in ?? 0)
    next.lineOut = Number(lines.data.out ?? 0)
    linesAt = Date.now()
  }
  doneAt = Date.now()
  value = next
  for (const f of subs) f(value)
}

/** minGapMs：离上次查不到这个时间就跳过（0 = 一定查）。窗口在后台时不查 */
function refresh(minGapMs = 0) {
  if (typeof document !== 'undefined' && document.hidden) return
  if (minGapMs && Date.now() - doneAt < minGapMs) return
  if (running) return
  running = pull().finally(() => {
    running = null
  })
}

const onChanged = () => refresh(0)
const onFocus = () => refresh(FOCUS_GAP_MS)
/** 填了流水、导了流水：下一轮重取待填的数字（不用等 5 分钟），其余的照常 */
const onJournal = () => {
  linesAt = 0
  refresh(0)
}

function join(fn: (b: Badges) => void) {
  subs.add(fn)
  if (subs.size === 1) {
    for (const e of CHANGED) window.addEventListener(e, onChanged)
    window.addEventListener('journal-changed', onJournal)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    timer = window.setInterval(() => refresh(0), POLL_MS)
  }
  refresh(subs.size === 1 ? 0 : FOCUS_GAP_MS)
  return () => {
    subs.delete(fn)
    if (subs.size === 0) {
      for (const e of CHANGED) window.removeEventListener(e, onChanged)
      window.removeEventListener('journal-changed', onJournal)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(timer)
    }
  }
}

/** 菜单角标的全部数字。enabled 为假（没登录、还没查到角色）时不查；cheques / lines：要不要支票、银行流水待填的数字 */
export function useBadges(enabled: boolean, cheques = false, lines = false): Badges {
  const [n, setN] = useState<Badges>(value)
  useEffect(() => {
    if (!enabled) return
    // 支票、流水的数字 5 分钟取一次；第一个要它的人进来时马上取一次，不用等
    const first = (cheques && !chequeAt) || (lines && !linesAt)
    if (cheques) wantCheque += 1
    if (lines) wantLines += 1
    const leave = join(setN)
    // 正在查的这一轮没带上支票、流水的数字（后打开的页面才要）：等它查完再取一次
    if (first) {
      if (running)
        void running.then(() => {
          if ((cheques && !chequeAt) || (lines && !linesAt)) refresh(0)
        })
      else refresh(0)
    }
    return () => {
      leave()
      if (cheques) wantCheque -= 1
      if (lines) wantLines -= 1
    }
  }, [enabled, cheques, lines])
  return enabled ? n : ZERO
}
