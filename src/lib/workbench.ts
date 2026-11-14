// 工作台：到账提交、提成单、到账（录入后的审批）三种审批并在一起，按登录的人分成待办 / 已办 / 已发起 / 已结束 / 抄送
// （数据库视图 v_workbench 算好）。每一步谁做的、什么时候、退回原因记在 approval_logs（触发器写）；
// 到账生效时抄送给了谁记在 approval_cc（30，触发器写，名单在“用户与权限 → 到账审批流”）。
import { useMemo } from 'react'
import { useBadges } from './badges'
import { useFlow } from './flow'
import { useT } from './i18n'
import { STATUS_COLOR, STATUS_LABEL } from './submissions'
import type { SubmissionStatus } from './submissions'
import { supabase } from './supabase'
import type { TableRow, ViewRow } from './supabase'

export type WorkItem = ViewRow<'v_workbench'>
export type ApprovalLog = TableRow<'approval_logs'>
export type DocType = 'submission' | 'voucher' | 'receipt'
export type Box = 'todo' | 'done' | 'mine' | 'ended' | 'cc'

export const BOXES: Box[] = ['todo', 'done', 'mine', 'ended', 'cc']

export const BOX_LABEL: Record<Box, string> = {
  todo: '待办',
  done: '已办',
  mine: '已发起',
  ended: '已结束',
  cc: '抄送',
}

/** 每一栏在视图里对应的列 */
export const BOX_COLUMN = {
  todo: 'in_todo',
  done: 'in_done',
  mine: 'in_mine',
  ended: 'in_ended',
  cc: 'in_cc',
} as const satisfies Record<Box, keyof WorkItem>

/** 排序：待办先到先办（等得最久的在前）；已办按我处理的时间；已发起按提交时间；已结束按结束时间；抄送按生效时间，都是新的在前 */
export const BOX_ORDER = {
  todo: { column: 'activity_at', ascending: true },
  done: { column: 'my_at', ascending: false },
  mine: { column: 'initiated_at', ascending: false },
  ended: { column: 'activity_at', ascending: false },
  cc: { column: 'activity_at', ascending: false },
} as const satisfies Record<Box, { column: keyof WorkItem; ascending: boolean }>

export const DOC_LABEL: Record<DocType, string> = {
  submission: '到账提交',
  voucher: '提成单',
  receipt: '到账',
}
export const DOC_COLOR: Record<DocType, string> = {
  submission: 'geekblue',
  voucher: 'purple',
  receipt: 'cyan',
}

/** 审批记录里的动作（approval_logs.action） */
export const ACTION_LABEL: Record<string, string> = {
  submit: '已提交',
  resubmit: '已重新提交',
  withdraw: '已撤回',
  approve: '审核通过',
  reject: '已退回',
  pay: '已发放',
  unpay: '已取消发放',
  reopen: '到账被删除，回到待审核',
  request: '已请业务员填写',
  cancel: '取消了请业务员填写',
}
export const ACTION_COLOR: Record<string, string> = {
  submit: 'blue',
  resubmit: 'blue',
  withdraw: 'gray',
  approve: 'green',
  reject: 'red',
  pay: 'green',
  unpay: 'gray',
  reopen: 'gray',
  request: 'orange',
  cancel: 'gray',
}

export function docType(x: string | null | undefined): DocType {
  return x === 'voucher' ? 'voucher' : x === 'receipt' ? 'receipt' : 'submission'
}

/**
 * 单据状态、审批记录里一步的说法（已翻译）和颜色，三种单据各用各的。
 * 提成单、到账审批中的写明等哪一级、某一级通过写“{级别}已通过”，级别的名字看审批流（管理员可以改）
 */
export function useDocLabels() {
  const t = useT()
  const vflow = useFlow('voucher')
  const rflow = useFlow('receipt')
  return useMemo(
    () => ({
      status: (type: DocType, status: string | null | undefined, step?: string | null): string =>
        type === 'voucher'
          ? vflow.stageLabel(status, step)
          : type === 'receipt'
            ? rflow.stageLabel(status, step)
            : t(STATUS_LABEL[(status ?? 'pending') as SubmissionStatus] ?? status ?? ''),
      color: (type: DocType, status: string | null | undefined, step?: string | null): string =>
        type === 'voucher'
          ? vflow.stageColor(status, step)
          : type === 'receipt'
            ? rflow.stageColor(status, step)
            : (STATUS_COLOR[(status ?? 'pending') as SubmissionStatus] ?? 'default'),
      action: (action: string | null | undefined, step?: string | null, type?: DocType): string => {
        if (!action) return ''
        // 到账“业务员本人确认”的一级（25）写“已确认”
        if (action === 'approve' && step && rflow.byKey.get(step)?.by_salesperson) return t('{name}已确认', { name: rflow.name(step) })
        if (action === 'approve' && step) return t('{name}已通过', { name: vflow.name(step) })
        // 到账：录入就是开始审批；改了钱的事重审也记成“重新提交”
        if (type === 'receipt' && action === 'submit') return t('已录入，开始审批')
        if (type === 'receipt' && action === 'resubmit') return t('已重新提交审批')
        return t(ACTION_LABEL[action] ?? action)
      },
    }),
    [t, vflow, rflow],
  )
}

/** 某一栏的查询（不含分页） */
export function boxQuery(box: Box, type: DocType | 'all', count: 'exact' | undefined = undefined, head = false) {
  let q = supabase.from('v_workbench').select('*', { count, head }).eq(BOX_COLUMN[box], true)
  if (type !== 'all') q = q.eq('doc_type', type)
  return q
}

/** 五栏各有几件：一个查询取回标记列，在浏览器里数。
 *  原来每栏各发一个计数查询，打开一次工作台就有 6 个重查询同时压上去（2026-11-13 卡死的原因之一） */
export async function boxCounts(type: DocType | 'all'): Promise<Record<Box, number>> {
  let q = supabase
    .from('v_workbench')
    .select('in_todo,in_done,in_mine,in_ended,in_cc')
    .or(BOXES.map((b) => `${BOX_COLUMN[b]}.eq.true`).join(','))
    .limit(5000)
  if (type !== 'all') q = q.eq('doc_type', type)
  const { data } = await q
  const rows = data ?? []
  const n = (b: Box) => rows.filter((r) => r[BOX_COLUMN[b]]).length
  return { todo: n('todo'), done: n('done'), mine: n('mine'), ended: n('ended'), cc: n('cc') }
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

export type CcRow = TableRow<'approval_cc'>
/** 一张单据生效时抄送给了谁（30），按名字 */
export async function fetchCc(type: DocType, id: number): Promise<CcRow[]> {
  const { data } = await supabase.from('approval_cc').select('*').eq('doc_type', type).eq('doc_id', id).order('user_name').order('id')
  return data ?? []
}

/** 待办有几件（菜单上的数字）。数字由 badges.ts 的共用轮询取（每分钟一次，大家合用一个查询） */
export function useTodoCount(enabled: boolean): number {
  return useBadges(enabled).todo
}
