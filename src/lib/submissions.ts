// 业务员提交的到账（到账审批）：状态、拆分行、待办数量
import { useEffect, useState } from 'react'
import type { Json } from './database.types'
import { money } from './format'
import { supabase } from './supabase'
import type { TableRow } from './supabase'

export type Submission = TableRow<'receipt_submissions'>
export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

/** 业务员填的一行“这笔钱是哪台车的”。车在系统里就有 vehicle_id；不在就填客户、车型、大架号（大架号可以不知道） */
export type SubmissionClaim = {
  vehicle_id?: number | null
  customer_id?: number | null
  customer_name?: string | null
  vin?: string | null
  model?: string | null
  nature?: string | null
  amount_orig?: number | null
}

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已退回',
  withdrawn: '已撤回',
}
export const STATUS_COLOR: Record<SubmissionStatus, string> = {
  pending: 'blue',
  approved: 'green',
  rejected: 'red',
  withdrawn: 'default',
}

export function parseClaims(j: Json | null | undefined): SubmissionClaim[] {
  if (!Array.isArray(j)) return []
  return j.filter((x): x is { [k: string]: Json | undefined } => !!x && typeof x === 'object' && !Array.isArray(x)).map((x) => ({
    vehicle_id: typeof x.vehicle_id === 'number' ? x.vehicle_id : null,
    customer_id: typeof x.customer_id === 'number' ? x.customer_id : null,
    customer_name: typeof x.customer_name === 'string' ? x.customer_name : null,
    vin: typeof x.vin === 'string' ? x.vin : null,
    model: typeof x.model === 'string' ? x.model : null,
    nature: typeof x.nature === 'string' ? x.nature : null,
    amount_orig: typeof x.amount_orig === 'number' ? x.amount_orig : x.amount_orig != null ? Number(x.amount_orig) : null,
  }))
}

const EVENT = 'submissions-changed'

/** 提交、审核之后调用，菜单上的数字会马上更新 */
export function notifySubmissionsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

/** 某个状态的提交有几条（业务员只算自己的）。每分钟、切回窗口、有改动时刷新 */
export function useSubmissionCount(status: SubmissionStatus, enabled: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { count } = await supabase.from('receipt_submissions').select('id', { count: 'exact', head: true }).eq('status', status)
      if (alive) setN(count ?? 0)
    }
    void load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener(EVENT, load)
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(EVENT, load)
      window.removeEventListener('focus', load)
    }
  }, [status, enabled])
  return enabled ? n : 0
}

/** 拆分摘要：客户 · 大架号 · 款项，最多两行 */
export function claimsSummary(s: Submission, t: (zh: string, v?: Record<string, string | number>) => string): string[] {
  const list = parseClaims(s.claims)
  const lines = list.slice(0, 2).map((c) =>
    [c.customer_name, c.vin || (c.vehicle_id ? '' : c.model ? t('{model}（大架号未定）', { model: c.model }) : ''), c.nature ? t(c.nature) : '', c.amount_orig ? money(c.amount_orig) : '']
      .filter(Boolean)
      .join(' · '),
  )
  if (list.length > 2) lines.push(t('还有 {n} 笔', { n: list.length - 2 }))
  return lines
}
