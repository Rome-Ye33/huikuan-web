// 审批流：提成单的（开头“业务员开单提交”、最后“财务发放”不变）和到账的（开头“财务录入”、最后“生效”不变），
// 中间这几级由管理员在“用户与权限”里定（approval_steps，doc_type 分 voucher / receipt）。
// 每一级由谁审看审批岗位（profiles.approval_posts 存级别的 key，两种单据的级别都放在一起）。
// 提成单提交、到账录入时把当时的审批流记在 flow 里，按它一级一级走，之后再改审批流只影响新提交（新录入）的。
// 删掉的级别不真删（active = false），名字留给旧单据、审批记录显示。
import { useMemo } from 'react'
import type { Json } from './database.types'
import { useI18n } from './i18n'
import type { Lang } from './i18n'
import { useRefData } from './refdata'
import type { TableRow } from './supabase'
import { VOUCHER_STATUS_COLOR, VOUCHER_STATUS_LABEL, voucherStatus } from './commission'

export type ApprovalStep = TableRow<'approval_steps'>
/** 哪一种单据的审批流：提成单 / 到账 */
export type FlowDocType = 'voucher' | 'receipt'

export function flowDocType(x: string | null | undefined): FlowDocType {
  return x === 'receipt' ? 'receipt' : 'voucher'
}

export type ReceiptStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  pending: '审批中',
  approved: '已生效',
  rejected: '已退回',
  withdrawn: '已撤回',
}
export const RECEIPT_STATUS_COLOR: Record<ReceiptStatus, string> = {
  pending: 'processing',
  approved: 'success',
  rejected: 'error',
  withdrawn: 'default',
}
/** 到账的状态：审批中 / 已生效（算到账）/ 已退回 / 已撤回（录入人在第一级批之前收回去了，24）。没有这一列的旧数据算已生效 */
export function receiptStatus(s: string | null | undefined): ReceiptStatus {
  return s === 'pending' || s === 'rejected' || s === 'withdrawn' ? s : 'approved'
}

/** flow 里的一级：哪一级，谁、什么时候通过的（还没通过为空）；sp = 到账的“业务员本人确认”那一级（25，录入时记下的） */
export type FlowItem = { step: string; by: string | null; by_name: string | null; at: string | null; sp?: boolean }

export function parseFlow(j: Json | null | undefined): FlowItem[] {
  if (!Array.isArray(j)) return []
  const str = (v: Json | undefined) => (typeof v === 'string' && v ? v : null)
  return j.flatMap((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return []
    const o = x as Record<string, Json | undefined>
    const step = str(o.step)
    return step ? [{ step, by: str(o.by), by_name: str(o.by_name), at: str(o.at), ...(o.sp === true ? { sp: true } : {}) }] : []
  })
}

/** 某一种单据的审批流里现在的级别，按顺序 */
export function activeSteps(steps: ApprovalStep[], docType: FlowDocType = 'voucher'): ApprovalStep[] {
  return steps.filter((s) => s.active && flowDocType(s.doc_type) === docType).sort(byPosition)
}

export function byPosition(a: Pick<ApprovalStep, 'position' | 'key'>, b: Pick<ApprovalStep, 'position' | 'key'>): number {
  return a.position - b.position || a.key.localeCompare(b.key)
}

/** 级别的名字：英文界面用英文名，没填英文名用中文名 */
export function stepName(s: Pick<ApprovalStep, 'name' | 'name_en'> | undefined, lang: Lang, fallback = ''): string {
  if (!s) return fallback
  return lang === 'en' ? s.name_en?.trim() || s.name : s.name
}

/** 打印用（中英都印）：中文名，英文名大写（没填英文名就空着） */
export function stepPrintNames(s: Pick<ApprovalStep, 'name' | 'name_en'> | undefined, fallback = ''): { zh: string; en: string } {
  return { zh: s?.name ?? fallback, en: (s?.name_en ?? '').trim().toUpperCase() }
}

/** 这张提成单要走（或走过）的级别：提交过的看它自己的 flow；草稿看现在的审批流 */
export function voucherFlow(flow: Json | null | undefined, steps: ApprovalStep[]): FlowItem[] {
  const own = parseFlow(flow)
  if (own.length) return own
  return activeSteps(steps).map((s) => ({ step: s.key, by: null, by_name: null, at: null }))
}

export type FlowApi = {
  docType: FlowDocType
  /** 这一种单据的全部级别（含删掉的），按顺序 */
  steps: ApprovalStep[]
  /** 这一种单据现在的审批流 */
  active: ApprovalStep[]
  /** 两种单据的全部级别，按 key 找（名字用） */
  byKey: Map<string, ApprovalStep>
  /** 级别的名字（跟着界面语言）；不认识的 key 原样显示 */
  name: (key: string | null | undefined) => string
  /** 单据状态（已翻译）：审批中的写明等哪一级 */
  stageLabel: (status: string | null | undefined, step: string | null | undefined) => string
  stageColor: (status: string | null | undefined, step: string | null | undefined) => string
  /** 一个人的岗位：先提成单的级别、再到账的级别，各按审批流的顺序（删掉的、不认识的不要） */
  sortKeys: (keys: string[] | null | undefined) => string[]
}

export function useFlow(docType: FlowDocType = 'voucher'): FlowApi {
  const { steps } = useRefData()
  const { t, lang } = useI18n()
  return useMemo<FlowApi>(() => {
    const everything = [...steps].sort(byPosition)
    const all = everything.filter((s) => flowDocType(s.doc_type) === docType)
    const active = activeSteps(everything, docType)
    const byKey = new Map(everything.map((s) => [s.key, s]))
    const name = (key: string | null | undefined) => (key ? stepName(byKey.get(key), lang, key) : '')
    const ordered = [...activeSteps(everything, 'voucher'), ...activeSteps(everything, 'receipt')]
    return {
      docType,
      steps: all,
      active,
      byKey,
      name,
      stageLabel: (status, step) => {
        if (docType === 'receipt') {
          const s = receiptStatus(status)
          // “业务员本人确认”的一级（25）：写“待…确认”
          if (s === 'pending' && step)
            return byKey.get(step)?.by_salesperson ? t('待{name}确认', { name: name(step) }) : t('待{name}审批', { name: name(step) })
          return t(RECEIPT_STATUS_LABEL[s])
        }
        const s = voucherStatus(status)
        if (s === 'submitted' && step) return t('待{name}审批', { name: name(step) })
        return t(VOUCHER_STATUS_LABEL[s])
      },
      stageColor: (status) => (docType === 'receipt' ? RECEIPT_STATUS_COLOR[receiptStatus(status)] : VOUCHER_STATUS_COLOR[voucherStatus(status)]),
      sortKeys: (keys) => ordered.filter((s) => (keys ?? []).includes(s.key)).map((s) => s.key),
    }
  }, [steps, t, lang, docType])
}
