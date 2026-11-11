// 提成单审批流：开头“业务员开单提交”、最后“财务发放”不变，中间这几级由管理员在“用户与权限”里定（approval_steps）。
// 每一级由谁审看审批岗位（profiles.approval_posts 存级别的 key）。提成单提交时把当时的审批流记在 flow 里，按它一级一级走，
// 之后再改审批流只影响新提交的。删掉的级别不真删（active = false），名字留给旧单据、审批记录显示。
import { useMemo } from 'react'
import type { Json } from './database.types'
import { useI18n } from './i18n'
import type { Lang } from './i18n'
import { useRefData } from './refdata'
import type { TableRow } from './supabase'
import { VOUCHER_STATUS_COLOR, VOUCHER_STATUS_LABEL, voucherStatus } from './commission'

export type ApprovalStep = TableRow<'approval_steps'>

/** 提成单 flow 里的一级：哪一级，谁、什么时候通过的（还没通过为空） */
export type FlowItem = { step: string; by: string | null; by_name: string | null; at: string | null }

export function parseFlow(j: Json | null | undefined): FlowItem[] {
  if (!Array.isArray(j)) return []
  const str = (v: Json | undefined) => (typeof v === 'string' && v ? v : null)
  return j.flatMap((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return []
    const o = x as Record<string, Json | undefined>
    const step = str(o.step)
    return step ? [{ step, by: str(o.by), by_name: str(o.by_name), at: str(o.at) }] : []
  })
}

/** 审批流里现在的级别，按顺序 */
export function activeSteps(steps: ApprovalStep[]): ApprovalStep[] {
  return steps.filter((s) => s.active).sort(byPosition)
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
  /** 全部级别（含删掉的），按顺序 */
  steps: ApprovalStep[]
  /** 现在的审批流 */
  active: ApprovalStep[]
  byKey: Map<string, ApprovalStep>
  /** 级别的名字（跟着界面语言）；不认识的 key 原样显示 */
  name: (key: string | null | undefined) => string
  /** 提成单状态（已翻译）：审批中的写明等哪一级 */
  stageLabel: (status: string | null | undefined, step: string | null | undefined) => string
  stageColor: (status: string | null | undefined, step: string | null | undefined) => string
  /** 一个人的岗位，按审批流的顺序（删掉的、不认识的不要） */
  sortKeys: (keys: string[] | null | undefined) => string[]
}

export function useFlow(): FlowApi {
  const { steps } = useRefData()
  const { t, lang } = useI18n()
  return useMemo<FlowApi>(() => {
    const all = [...steps].sort(byPosition)
    const active = activeSteps(all)
    const byKey = new Map(all.map((s) => [s.key, s]))
    const name = (key: string | null | undefined) => (key ? stepName(byKey.get(key), lang, key) : '')
    return {
      steps: all,
      active,
      byKey,
      name,
      stageLabel: (status, step) => {
        const s = voucherStatus(status)
        if (s === 'submitted' && step) return t('待{name}审批', { name: name(step) })
        return t(VOUCHER_STATUS_LABEL[s])
      },
      stageColor: (status) => VOUCHER_STATUS_COLOR[voucherStatus(status)],
      sortKeys: (keys) => active.filter((s) => (keys ?? []).includes(s.key)).map((s) => s.key),
    }
  }, [steps, t, lang])
}
