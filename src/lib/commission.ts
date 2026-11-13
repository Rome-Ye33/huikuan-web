// 提成申请单：状态、车和付款明细、合计。合计、已还期数、分期情况和 Excel 模板（提成单模板 Commission Voucher Template）的公式一致。
import { useEffect, useState } from 'react'
import type { Json } from './database.types'
import { money, num, round2 } from './format'
import { supabase } from './supabase'
import type { ViewRow } from './supabase'

export type CommissionVoucher = ViewRow<'v_commission_vouchers'>
export type VoucherStatus = 'draft' | 'submitted' | 'approved' | 'paid' | 'rejected'

export const VOUCHER_STATUSES: VoucherStatus[] = ['draft', 'submitted', 'approved', 'paid', 'rejected']

/** 提成单状态的说法（界面上再翻译）。审批中（submitted）走到哪一级、叫什么，看审批流（lib/flow.ts） */
export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: '草稿',
  submitted: '审批中',
  approved: '已批准待发放',
  paid: '已发放',
  rejected: '已退回',
}

/** 打印的提成单上用（中英都印） */
export const VOUCHER_STATUS_EN: Record<VoucherStatus, string> = {
  draft: 'DRAFT',
  submitted: 'PENDING',
  approved: 'APPROVED',
  paid: 'PAID',
  rejected: 'RETURNED',
}

export const VOUCHER_STATUS_COLOR: Record<VoucherStatus, string> = {
  draft: 'default',
  submitted: 'blue',
  approved: 'cyan',
  paid: 'green',
  rejected: 'red',
}

export function voucherStatus(s: string | null | undefined): VoucherStatus {
  return (VOUCHER_STATUSES as string[]).includes(s ?? '') ? (s as VoucherStatus) : 'draft'
}

/** 草稿、被退回的可以改 */
export function isEditableStatus(s: VoucherStatus): boolean {
  return s === 'draft' || s === 'rejected'
}

/** 提成单上的一台车（保存时从系统带出） */
export type VoucherVehicle = {
  vehicle_id: number
  vin: string
  model: string
  payment_method: string | null
  unit_price_usd: number
  note: string | null
}

/** 提成单上的一笔付款（保存时从到账拆分带出；share_usd 是算进这张单的美元金额） */
export type VoucherPayment = {
  claim_id: number
  claim_no: string | null
  receipt_no: string | null
  pay_date: string | null
  nature: string | null
  amount_orig: number
  currency: string
  fx_rate: number
  amount_usd: number
  share_usd: number
  vin: string | null
  note: string | null
}

type Obj = { [k: string]: Json | undefined }

function objs(j: Json | null | undefined): Obj[] {
  return Array.isArray(j) ? j.filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []
}

function str(x: Json | undefined): string | null {
  if (x === null || x === undefined) return null
  return typeof x === 'string' ? x : String(x)
}

export function parseVehicles(j: Json | null | undefined): VoucherVehicle[] {
  return objs(j).map((x) => ({
    vehicle_id: num(x.vehicle_id),
    vin: str(x.vin) ?? '',
    model: str(x.model) ?? '',
    payment_method: str(x.payment_method),
    unit_price_usd: num(x.unit_price_usd),
    note: str(x.note),
  }))
}

export function parsePayments(j: Json | null | undefined): VoucherPayment[] {
  return objs(j).map((x) => ({
    claim_id: num(x.claim_id),
    claim_no: str(x.claim_no),
    receipt_no: str(x.receipt_no),
    pay_date: str(x.pay_date),
    nature: str(x.nature),
    amount_orig: num(x.amount_orig),
    currency: str(x.currency) ?? 'USD',
    fx_rate: num(x.fx_rate) || 1,
    amount_usd: num(x.amount_usd),
    share_usd: num(x.share_usd),
    vin: str(x.vin),
    note: str(x.note),
  }))
}

/** 这笔付款只有一部分算进本单（一笔钱付几张单） */
export function isShared(p: Pick<VoucherPayment, 'share_usd' | 'amount_usd'>): boolean {
  return Math.abs(p.share_usd - p.amount_usd) > 0.005
}

/**
 * 付款明细一行怎么显示：整笔算进本单就照原币、汇率显示；只算一部分时按模板说明，
 * 币种写 USD、金额写本单分摊的美元，合付总额写进备注。
 */
export function paymentDisplay(p: VoucherPayment): { amount: number; currency: string; rate: number | null; usd: number; sharedFrom: string | null } {
  if (isShared(p)) {
    const whole = p.currency === 'USD' ? `USD ${money(p.amount_usd)}` : `${p.currency} ${money(p.amount_orig)} @ ${p.fx_rate}`
    return { amount: p.share_usd, currency: 'USD', rate: null, usd: p.share_usd, sharedFrom: whole }
  }
  return {
    amount: p.currency === 'USD' ? p.amount_usd : p.amount_orig,
    currency: p.currency,
    rate: p.currency === 'USD' ? null : p.fx_rate,
    usd: p.share_usd,
    sharedFrom: null,
  }
}

export type PayState =
  | { kind: 'overpaid' }
  | { kind: 'paid_off' }
  | { kind: 'full_unpaid' }
  | { kind: 'installment' }
  | { kind: 'terms'; paid: number; total: number }

export type VoucherTotals = {
  units: number
  vehiclesUsd: number
  totalSales: number
  paid: number
  balance: number
  /** 0–1；销售总金额为 0 时为 null */
  progress: number | null
  /** 已还期数（全款或没填期数、每期金额时为 null） */
  termsPaid: number | null
  termsLeft: number | null
  state: PayState
  payout: number | null
}

type TotalsInput = {
  vehiclePrices: number[]
  otherCharges: number | null | undefined
  discount: number | null | undefined
  fullPayment: boolean
  downPayment: number | null | undefined
  termsCount: number | null | undefined
  perTerm: number | null | undefined
  payments: { share_usd: number; nature: string | null }[]
  commission: number | null | undefined
  /** 0–1 */
  payoutRatio: number | null | undefined
}

/** 余额差 1 美元以内算付清（系统里美元保留两位小数，模板是四舍五入到整数） */
const SETTLE_TOLERANCE = 1

export function voucherTotals(i: TotalsInput): VoucherTotals {
  const vehiclesUsd = round2(i.vehiclePrices.reduce((s, x) => s + num(x), 0))
  const totalSales = round2(vehiclesUsd + num(i.otherCharges) - num(i.discount))
  const paid = round2(i.payments.reduce((s, p) => s + num(p.share_usd), 0))
  const balance = round2(totalSales - paid)
  const hasSales = Math.abs(totalSales) > 0.005
  const settled = hasSales && balance < SETTLE_TOLERANCE

  // 已还期数：全款或没填期数/每期金额 → 空；付清 → 全部；否则 = min(期数, max(分期款笔数, 取整((已付 − 首付) / 每期)))
  let termsPaid: number | null = null
  const terms = Math.trunc(num(i.termsCount))
  const per = num(i.perTerm)
  if (!i.fullPayment && terms > 0 && per > 0) {
    if (settled) termsPaid = terms
    else {
      const count = i.payments.filter((p) => (p.nature ?? '').includes('分期')).length
      termsPaid = Math.min(terms, Math.max(count, Math.floor((paid - num(i.downPayment)) / per + 0.0001)))
    }
  }

  let state: PayState
  if (hasSales && balance <= -SETTLE_TOLERANCE) state = { kind: 'overpaid' }
  else if (settled) state = { kind: 'paid_off' }
  else if (i.fullPayment) state = { kind: 'full_unpaid' }
  else if (termsPaid === null) state = { kind: 'installment' }
  else state = { kind: 'terms', paid: termsPaid, total: terms }

  const ratio = i.payoutRatio
  return {
    units: i.vehiclePrices.length,
    vehiclesUsd,
    totalSales,
    paid,
    balance,
    progress: totalSales > 0 ? paid / totalSales : null,
    termsPaid,
    termsLeft: termsPaid === null ? null : terms - termsPaid,
    state,
    payout: i.commission != null && ratio != null ? round2(num(i.commission) * num(ratio)) : null,
  }
}

/** 存好的提成单的合计 */
export function savedTotals(v: CommissionVoucher): VoucherTotals {
  return voucherTotals({
    vehiclePrices: parseVehicles(v.vehicles).map((x) => x.unit_price_usd),
    otherCharges: v.other_charges_usd,
    discount: v.discount_usd,
    fullPayment: v.full_payment ?? true,
    downPayment: v.down_payment_usd,
    termsCount: v.terms_count,
    perTerm: v.per_term_usd,
    payments: parsePayments(v.payments),
    commission: v.commission_usd,
    payoutRatio: v.payout_ratio,
  })
}

/** 分期情况的中文（界面上再翻译），{paid} {total} 是占位 */
export const PAY_STATE_ZH: Record<PayState['kind'], string> = {
  overpaid: '⚠ 已付超过销售额',
  paid_off: '已付清',
  full_unpaid: '全款 未付清',
  installment: '分期',
  terms: '已还 {paid} 期 / 共 {total} 期',
}

/** 打印用的英文（照模板） */
export function payStateEn(s: PayState): string {
  switch (s.kind) {
    case 'overpaid':
      return 'OVERPAID'
    case 'paid_off':
      return 'PAID OFF'
    case 'full_unpaid':
      return 'FULL - UNPAID'
    case 'installment':
      return 'INSTALLMENT'
    case 'terms':
      return `PAID ${s.paid}/${s.total}`
  }
}

export function payStateVars(s: PayState): Record<string, number> | undefined {
  return s.kind === 'terms' ? { paid: s.paid, total: s.total } : undefined
}

/** 数量与设备型号：按车型数台数，如“2台 重汽6X4自卸车、1台 江铃大道” */
export function qtyModelText(models: string[], fmt: (n: number, model: string) => string, sep: string): string {
  const counts = new Map<string, number>()
  for (const m of models) {
    const k = m.trim()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].map(([m, n]) => fmt(n, m)).join(sep)
}

const EVENT = 'vouchers-changed'

/** 提交、审批之后调用，菜单上的数字会马上更新 */
export function notifyVouchersChanged() {
  window.dispatchEvent(new Event(EVENT))
}

/** 等我处理的提成单有几张（数据库视图 v_workbench 按岗位算好）。每分钟、切回窗口、提交或审批之后刷新 */
export function useVoucherTodo(enabled: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { count } = await supabase
        .from('v_workbench')
        .select('doc_id', { count: 'exact', head: true })
        .eq('doc_type', 'voucher')
        .eq('in_todo', true)
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
  }, [enabled])
  return enabled ? n : 0
}

/** 等我处理的提成单的 id（列表里“待我处理”用） */
export async function voucherTodoIds(): Promise<number[]> {
  const { data } = await supabase.from('v_workbench').select('doc_id').eq('doc_type', 'voucher').eq('in_todo', true).limit(2000)
  return (data ?? []).map((r) => r.doc_id).filter((x): x is number => x != null)
}

/** 打印的提成单上“审批过程”里每一步的说法（中英都印）。通过、退回前面带哪一级 */
export const TRAIL_PRINT: Record<string, { zh: string; en: string }> = {
  submit: { zh: '提交', en: 'SUBMITTED' },
  resubmit: { zh: '重新提交', en: 'RESUBMITTED' },
  withdraw: { zh: '撤回', en: 'WITHDRAWN' },
  approve: { zh: '通过', en: 'APPROVED' },
  finance_approve: { zh: '财务审核通过', en: 'FINANCE APPROVED' },
  gm_approve: { zh: '总经理批准', en: 'GM APPROVED' },
  reject: { zh: '退回', en: 'RETURNED' },
  pay: { zh: '发放', en: 'PAID OUT' },
  unpay: { zh: '取消发放', en: 'PAYOUT CANCELLED' },
}

/** 把提成单打开成可以打印的页面（新窗口） */
export function printVoucher(id: number) {
  const base = window.location.href.split('#')[0]
  window.open(`${base}#/print/commission/${id}`, '_blank', 'noopener')
}
