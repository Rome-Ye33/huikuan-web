// 工作台：到账提交、提成单两种审批并在一起，按登录的人分成待办 / 已办 / 已发起 / 已结束（数据库视图 v_workbench 算好）。
// 每一步谁做的、什么时候、退回原因记在 approval_logs（触发器写）。
import { useEffect, useState } from 'react'
import { VOUCHER_STATUS_COLOR, VOUCHER_STATUS_LABEL, voucherStatus } from './commission'
import { STATUS_COLOR, STATUS_LABEL } from './submissions'
import type { SubmissionStatus } from './submissions'
import { supabase } from './supabase'
import type { TableRow, ViewRow } from './supabase'

export type WorkItem = ViewRow<'v_workbench'>
export type ApprovalLog = TableRow<'approval_logs'>
export type DocType = 'submission' | 'voucher'
export type Box = 'todo' | 'done' | 'mine' | 'ended'

export const BOXES: Box[] = ['todo', 'done', 'mine', 'ended']

export const BOX_LABEL: Record<Box, string> = {
  todo: '待办',
  done: '已办',
  mine: '已发起',
  ended: '已结束',
}

/** 每一栏在视图里对应的列 */
export const BOX_COLUMN = {
  todo: 'in_todo',
  done: 'in_done',
  mine: 'in_mine',
  ended: 'in_ended',
} as const satisfies Record<Box, keyof WorkItem>

/** 排序：待办先到先办（等得最久的在前）；已办按我处理的时间；已发起按提交时间；已结束按结束时间，都是新的在前 */
export const BOX_ORDER = {
  todo: { column: 'activity_at', ascending: true },
  done: { column: 'my_at', ascending: false },
  mine: { column: 'initiated_at', ascending: false },
  ended: { column: 'activity_at', ascending: false },
} as const satisfies Record<Box, { column: keyof WorkItem; ascending: boolean }>

export const DOC_LABEL: Record<DocType, string> = {
  submission: '到账提交',
  voucher: '提成单',
}
export const DOC_COLOR: Record<DocType, string> = {
  submission: 'geekblue',
  voucher: 'purple',
}

/** 审批记录里的动作（approval_logs.action） */
export const ACTION_LABEL: Record<string, string> = {
  submit: '已提交',
  resubmit: '已重新提交',
  withdraw: '已撤回',
  approve: '审核通过',
  reject: '已退回',
  finance_approve: '财务审核已通过',
  gm_approve: '总经理已批准',
  pay: '已发放',
  unpay: '已取消发放',
  reopen: '到账被删除，回到待审核',
}
export const ACTION_COLOR: Record<string, string> = {
  submit: 'blue',
  resubmit: 'blue',
  withdraw: 'gray',
  approve: 'green',
  reject: 'red',
  finance_approve: 'green',
  gm_approve: 'green',
  pay: 'green',
  unpay: 'gray',
  reopen: 'gray',
}

export function docType(x: string | null | undefined): DocType {
  return x === 'voucher' ? 'voucher' : 'submission'
}

/** 状态的中文（界面上再翻译）和颜色，两种单据各用各的 */
export function statusLabel(type: DocType, status: string | null | undefined): string {
  if (type === 'voucher') return VOUCHER_STATUS_LABEL[voucherStatus(status)]
  return STATUS_LABEL[(status ?? 'pending') as SubmissionStatus] ?? status ?? ''
}
export function statusColor(type: DocType, status: string | null | undefined): string {
  if (type === 'voucher') return VOUCHER_STATUS_COLOR[voucherStatus(status)]
  return STATUS_COLOR[(status ?? 'pending') as SubmissionStatus] ?? 'default'
}

/** 某一栏的查询（不含分页） */
export function boxQuery(box: Box, type: DocType | 'all', count: 'exact' | undefined = undefined, head = false) {
  let q = supabase.from('v_workbench').select('*', { count, head }).eq(BOX_COLUMN[box], true)
  if (type !== 'all') q = q.eq('doc_type', type)
  return q
}

/** 一张单据的审批记录，从早到晚 */
export async function fetchTrail(type: DocType, id: number): Promise<ApprovalLog[]> {
  const { data } = await supabase
    .from('approval_logs')
    .select('*')
    .eq('doc_type', type)
    .eq('doc_id', id)
    .order('at', { ascending: true })
    .order('id', { ascending: true })
  return data ?? []
}

/** 待办有几件（菜单上的数字）。每分钟、切回窗口、提交或审批之后刷新 */
export function useTodoCount(enabled: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { count } = await boxQuery('todo', 'all', 'exact', true)
      if (alive) setN(count ?? 0)
    }
    void load()
    const timer = window.setInterval(load, 60_000)
    const events = ['submissions-changed', 'vouchers-changed', 'focus']
    for (const e of events) window.addEventListener(e, load)
    return () => {
      alive = false
      window.clearInterval(timer)
      for (const e of events) window.removeEventListener(e, load)
    }
  }, [enabled])
  return enabled ? n : 0
}
