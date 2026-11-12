import { DeleteOutlined, LinkOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiSession } from '../lib/aiFill'
import type { AiFilled } from '../lib/aiFill'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { parseFlow, receiptStatus, useFlow } from '../lib/flow'
import { dateTime, money, num, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { defaultNature, receiptNatures } from '../lib/natures'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { claimsSummary, notifySubmissionsChanged, parseClaims } from '../lib/submissions'
import type { Submission, SubmissionClaim } from '../lib/submissions'
import { supabase } from '../lib/supabase'
import type { Receipt, Vehicle } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import AiFill from './AiFill'
import CustomerSelect from './CustomerSelect'
import ReportBox from './ReportBox'
import VehicleFormModal from './VehicleFormModal'
import VehicleSelect from './VehicleSelect'
import Vouchers from './Vouchers'
import ApprovalTrail from './ApprovalTrail'

export type ReceiptPrefill = {
  account_id?: number
  receipt_date?: string
  amount_orig?: number
  payer_summary?: string | null
  bank_ref?: string | null
  cheque_no?: string | null
  /** 由哪条银行对账单流水生成 */
  line_id?: number
}

/** 配对的银行流水里，按银行为准的几项 */
type BankFacts = {
  line_date: string | null
  amount_orig: number | null
  currency?: string | null
  payer_summary?: string | null
  bank_ref?: string | null
  cheque_no?: string | null
}
type BankSource = { line_date?: string | null; amount_orig?: number | string | null; currency?: string | null; payer_summary?: string | null; bank_ref?: string | null; cheque_no?: string | null }
const bankFacts = (l: BankSource): BankFacts => ({
  line_date: l.line_date ?? null,
  amount_orig: l.amount_orig != null ? num(l.amount_orig) : null,
  currency: l.currency ?? null,
  payer_summary: l.payer_summary ?? null,
  bank_ref: l.bank_ref ?? null,
  cheque_no: l.cheque_no ?? null,
})

type Props = {
  open: boolean
  receiptId?: number | null
  prefill?: ReceiptPrefill | null
  /** 审核业务员提交的到账：按提交的内容预填，通过后生成正式到账 */
  submission?: Submission | null
  onClose: (changed: boolean) => void
}

type ClaimDraft = {
  key: string
  id?: number
  nature?: string
  vehicle_id?: number | null
  customer_id?: number | null
  amount_orig?: number | null
  report_note?: string
  /** 大架号未锁定（到账款还不知道是哪台车）：数量与设备型号、哪个业务员的 */
  model_desc?: string
  salesperson_id?: number | null
  /** 业务员提交时这一行手填的客户、车型、大架号（车不在系统里时）；智能填表没对上车时也放在这里 */
  sub?: SubmissionClaim
  /** 这一行是智能填表填的 */
  ai?: boolean
}

type FormValues = {
  account_id?: number
  receipt_date?: dayjs.Dayjs
  amount_orig?: number | null
  fx_rate?: number | null
  payer_summary?: string
  cheque_no?: string
  bank_ref?: string
  note?: string
}

let keySeq = 0
const newKey = () => `k${++keySeq}`

export default function ReceiptEditor({ open, receiptId, prefill, submission, onClose }: Props) {
  const t = useT()
  const { isStaff, isAdmin, posts } = useAuth()
  const rflow = useFlow('receipt')
  const { accounts, accountById, natures, natureByName, salespersons, customers } = useRefData()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<FormValues>()

  const [currentId, setCurrentId] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [reportText, setReportText] = useState('')
  const [claims, setClaims] = useState<ClaimDraft[]>([])
  const [vehicles, setVehicles] = useState<Map<number, Vehicle>>(new Map())
  const [attachments, setAttachments] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 正在做的审批动作（approve_<级别> / reject / resubmit） */
  const [acting, setActing] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [newVehicleFor, setNewVehicleFor] = useState<string | null>(null)
  /** 正在审核的业务员提交（通过后清空，变成普通的到账） */
  const [review, setReview] = useState<Submission | null>(null)
  const [dupes, setDupes] = useState<Receipt[]>([])
  /** 退回的是什么：审批中的到账 / 正在审核的业务员提交 / 业务员填好的（财务请他填的） */
  const [rejecting, setRejecting] = useState<'receipt' | 'review' | 'fill' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  /** 财务请业务员填写：这笔到账上最近的一条请填写记录（没有就是 null）。等他填 / 填好了等核对 / 退回了 / 已采用 / 已取消 */
  const [fillReq, setFillReq] = useState<Submission | null>(null)
  /** 业务员填的拆分已经放进下面的表里了 */
  const [fillApplied, setFillApplied] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [reqSp, setReqSp] = useState<number | undefined>()
  const [reqNote, setReqNote] = useState('')
  /** 表里的内容是智能填表认出来的第几笔（保存后记成已录） */
  const [aiIndex, setAiIndex] = useState<number | null>(null)
  /** 配对上的银行流水（由流水生成的新到账按预填算）：账户、日期、金额和银行给的摘要、参考号、支票号按银行为准，锁住不能改 */
  const [bankLine, setBankLine] = useState<BankFacts | null>(null)
  const rateTouched = useRef(false)

  const accountId = Form.useWatch('account_id', form)
  const amount = num(Form.useWatch('amount_orig', form))
  const rate = num(Form.useWatch('fx_rate', form))
  const account = accountId ? accountById.get(accountId) : undefined
  const currency = account?.currency ?? ''
  const isUsd = currency === 'USD'
  const readOnly = !isStaff
  const bankLocked = !!bankLine
  /** 银行流水里有这一项（非空）就不让改；银行没给的可以补 */
  const bankGave = (k: 'payer_summary' | 'bank_ref' | 'cheque_no') => !!bankLine?.[k]?.trim()
  // 到账自己的审批：录入后按录入时的审批流一级一级审，批完才算到账（才进余额、报表，才能报款）
  const rStatus = receiptStatus(receipt?.status)
  const rStep = receipt?.step ?? null
  const rFlowItems = useMemo(() => parseFlow(receipt?.flow), [receipt?.flow])
  /** 这笔到账走审批（录入时有审批级别）；没走的录入就生效 */
  const inFlow = !!currentId && rFlowItems.length > 0
  const holdsStep = !!rStep && posts.includes(rStep)
  const canApprove = !!currentId && rStatus === 'pending' && !!rStep && (holdsStep || isAdmin)
  const canResubmit = !!currentId && rStatus === 'rejected' && isStaff

  const rememberVehicles = useCallback((list: (Vehicle | null | undefined)[]) => {
    setVehicles((m) => {
      const next = new Map(m)
      for (const v of list) if (v?.id != null) next.set(v.id, v)
      return next
    })
  }, [])

  /** 这笔到账上最近的一条“请业务员填写”记录（财务才看） */
  const loadFill = useCallback(async (id: number): Promise<Submission | null> => {
    const { data } = await supabase
      .from('receipt_submissions')
      .select('*')
      .eq('receipt_id', id)
      .not('requested_by', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    setFillReq(data ?? null)
    setFillApplied(false)
    return data ?? null
  }, [])

  const load = useCallback(
    async (id: number): Promise<Receipt | null> => {
      setLoading(true)
      if (isStaff) void loadFill(id)
      const [r, c, tx] = await Promise.all([
        supabase.from('v_bank_receipts').select('*').eq('id', id).single(),
        supabase.from('v_receipt_claims').select('*').eq('receipt_id', id).order('id'),
        supabase.rpc('receipt_report_text', { p_receipt_id: id }),
      ])
      if (r.error) {
        message.error(errorText(r.error))
        setLoading(false)
        return null
      }
      const rec = r.data
      setReceipt(rec)
      setCurrentId(id)
      if (rec.bank_line_id) {
        const l = await supabase.from('v_statement_lines').select('*').eq('id', rec.bank_line_id).maybeSingle()
        setBankLine(l.data ? bankFacts(l.data) : { line_date: null, amount_orig: null })
      } else setBankLine(null)
      setReportText(tx.data ?? '')
      setAttachments(rec.attachments ?? [])
      rateTouched.current = true
      form.setFieldsValue({
        account_id: rec.account_id ?? undefined,
        receipt_date: rec.receipt_date ? dayjs(rec.receipt_date) : undefined,
        amount_orig: num(rec.amount_orig),
        fx_rate: num(rec.fx_rate),
        payer_summary: rec.payer_summary ?? '',
        cheque_no: rec.cheque_no ?? '',
        bank_ref: rec.bank_ref ?? '',
        note: rec.note ?? '',
      })
      const rows = (c.data ?? []).map<ClaimDraft>((x) => ({
        key: newKey(),
        id: x.id ?? undefined,
        nature: x.nature ?? undefined,
        vehicle_id: x.vehicle_id,
        customer_id: x.customer_id,
        amount_orig: x.amount_orig != null ? num(x.amount_orig) : null,
        report_note: x.report_note ?? '',
        model_desc: x.vehicle_id ? '' : (x.model_desc ?? ''),
        salesperson_id: x.vehicle_id ? null : x.salesperson_id,
      }))
      setClaims(rows)
      const vids = rows.map((x) => x.vehicle_id).filter((x): x is number => x != null)
      if (vids.length) {
        const v = await supabase.from('v_vehicle_ledger').select('*').in('id', vids)
        rememberVehicles(v.data ?? [])
      }
      setDirty(false)
      setLoading(false)
      return rec
    },
    [form, message, rememberVehicles, isStaff, loadFill],
  )

  // 打开时：编辑 → 读数据；审核提交 → 按提交预填；新建 → 清空并预填
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setDirty(false)
    setDupes([])
    setReview(null)
    setAiIndex(null)
    setFillReq(null)
    setFillApplied(false)
    setRequesting(false)
    if (receiptId) {
      void load(receiptId)
      return
    }
    setCurrentId(null)
    setReceipt(null)
    setReportText('')
    setVehicles(new Map())
    form.resetFields()
    setBankLine(prefill?.line_id ? bankFacts({ ...prefill, line_date: prefill.receipt_date ?? null }) : null)
    if (submission) {
      setReview(submission)
      rateTouched.current = submission.fx_rate != null
      form.setFieldsValue({
        account_id: submission.account_id,
        receipt_date: dayjs(submission.receipt_date),
        amount_orig: num(submission.amount_orig),
        fx_rate: submission.fx_rate != null ? num(submission.fx_rate) : null,
        payer_summary: submission.payer_summary ?? '',
        bank_ref: submission.bank_ref ?? '',
        cheque_no: submission.cheque_no ?? '',
        note: submission.note ?? '',
      })
      setAttachments(submission.attachments ?? [])
      const lines = parseClaims(submission.claims)
      setClaims(
        lines.length
          ? lines.map((c) => ({
              key: newKey(),
              nature: c.nature ?? undefined,
              vehicle_id: c.vehicle_id ?? null,
              customer_id: c.customer_id ?? null,
              amount_orig: c.amount_orig ?? null,
              report_note: '',
              // 车不在系统里：先按大架号未锁定记到客户名下（车型照业务员填的），录了车再选上
              model_desc: c.vehicle_id ? '' : (c.model ?? ''),
              salesperson_id: c.vehicle_id ? null : submission.salesperson_id,
              sub: c.vehicle_id ? undefined : c,
            }))
          : [{ key: newKey() }],
      )
      const vids = lines.map((c) => c.vehicle_id).filter((x): x is number => !!x)
      if (vids.length) void supabase.from('v_vehicle_ledger').select('*').in('id', vids).then((v) => rememberVehicles(v.data ?? []))
      return
    }
    rateTouched.current = false
    setAttachments([])
    form.setFieldsValue({
      account_id: prefill?.account_id,
      receipt_date: dayjs(prefill?.receipt_date ?? todayAccra()),
      amount_orig: prefill?.amount_orig ?? null,
      payer_summary: prefill?.payer_summary ?? '',
      bank_ref: prefill?.bank_ref ?? '',
      cheque_no: prefill?.cheque_no ?? '',
    })
    setClaims([{ key: newKey() }])
  }, [open, receiptId, prefill, submission, load, form, rememberVehicles])

  // 审核时：看看财务是不是已经录过这笔（同账户、同金额、日期相差 3 天内，还没关联别的提交）
  useEffect(() => {
    if (!open || !review) return
    let alive = true
    void (async () => {
      const d = dayjs(review.receipt_date)
      const { data } = await supabase
        .from('v_bank_receipts')
        .select('*')
        .eq('account_id', review.account_id)
        .eq('amount_orig', review.amount_orig)
        .gte('receipt_date', d.subtract(3, 'day').format('YYYY-MM-DD'))
        .lte('receipt_date', d.add(3, 'day').format('YYYY-MM-DD'))
        .limit(10)
      const list = data ?? []
      const ids = list.map((x) => x.id).filter((x): x is number => x != null)
      let taken = new Set<number>()
      if (ids.length) {
        const s = await supabase.from('receipt_submissions').select('receipt_id').in('receipt_id', ids)
        taken = new Set((s.data ?? []).map((x) => x.receipt_id).filter((x): x is number => x != null))
      }
      if (alive) setDupes(list.filter((x) => x.id != null && !taken.has(x.id)))
    })()
    return () => {
      alive = false
    }
  }, [open, review])

  // 换账户或日期：自动带汇率（手工改过就不再覆盖）
  const receiptDate = Form.useWatch('receipt_date', form)
  useEffect(() => {
    if (!open || !currency) return
    if (isUsd) {
      form.setFieldValue('fx_rate', 1)
      return
    }
    if (rateTouched.current) return
    const d = receiptDate ? receiptDate.format('YYYY-MM-DD') : todayAccra()
    void lookupRate(currency, d).then((r) => {
      if (!rateTouched.current) form.setFieldValue('fx_rate', r)
    })
  }, [open, currency, isUsd, receiptDate, form])

  const claimedTotal = useMemo(() => round2(claims.reduce((s, c) => s + num(c.amount_orig), 0)), [claims])
  const remaining = round2(amount - claimedTotal)

  const setRow = (key: string, patch: Partial<ClaimDraft>) => {
    setDirty(true)
    setClaims((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /** 不选车时选客户：业务员默认用客户资料上的 */
  const pickCustomer = (key: string, id: number | null) => {
    const sp = id ? (customers.find((c) => c.id === id)?.salesperson_id ?? null) : null
    setDirty(true)
    // 业务员提交的：业务员就是提交人；财务自己录的：跟着客户走
    setClaims((rows) =>
      rows.map((r) => (r.key === key ? { ...r, customer_id: id, salesperson_id: r.sub ? (r.salesperson_id ?? sp) : (sp ?? r.salesperson_id ?? null) } : r)),
    )
  }

  const pickVehicle = (key: string, id: number | null, v: Vehicle | null) => {
    if (v) rememberVehicles([v])
    setDirty(true)
    setClaims((rows) => {
      const others = round2(rows.filter((r) => r.key !== key).reduce((s, r) => s + num(r.amount_orig), 0))
      return rows.map((r) => {
        if (r.key !== key) return r
        const next: ClaimDraft = { ...r, vehicle_id: id, customer_id: v?.customer_id ?? r.customer_id }
        if (v && !r.nature) next.nature = defaultNature(v)
        if (v && !r.amount_orig && amount > others) next.amount_orig = round2(amount - others)
        return next
      })
    })
  }

  /** 智能填表：把认出来的一笔填进表里。手工填过内容的先问一句再盖掉 */
  const applyAi = async (f: AiFilled, index: number, files: string[]): Promise<boolean> => {
    // 从银行对账单生成的：账户、日期、金额按银行流水，不改
    const locked = !!prefill?.line_id
    const typed =
      aiIndex === null &&
      (claims.some((c) => c.nature || c.vehicle_id || c.customer_id || num(c.amount_orig) > 0) ||
        (!locked && (form.getFieldValue('account_id') != null || num(form.getFieldValue('amount_orig')) > 0)))
    if (typed) {
      const ok = await new Promise<boolean>((resolve) =>
        modal.confirm({
          title: t('表里已经填的内容会换成识别结果，继续？'),
          okText: t('继续'),
          cancelText: t('取消'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      )
      if (!ok) return false
    }
    const h = f.header
    const keep = (name: 'payer_summary' | 'cheque_no' | 'bank_ref', v?: string) =>
      locked && form.getFieldValue(name) ? form.getFieldValue(name) : (v ?? '')
    const patch: FormValues = {
      payer_summary: keep('payer_summary', h.payer_summary),
      cheque_no: keep('cheque_no', h.cheque_no),
      bank_ref: keep('bank_ref', h.bank_ref),
    }
    if (!locked) {
      patch.account_id = h.account_id
      patch.receipt_date = dayjs(h.receipt_date ?? todayAccra())
      patch.amount_orig = h.amount_orig ?? null
    }
    const acc = accountById.get(locked ? form.getFieldValue('account_id') : h.account_id)
    if (acc?.currency === 'USD') patch.fx_rate = 1
    else if (h.fx_rate) {
      patch.fx_rate = h.fx_rate
      rateTouched.current = true
    } else {
      // 材料里没写汇率：按汇率表带
      rateTouched.current = false
      patch.fx_rate = null
      const d = (locked ? form.getFieldValue('receipt_date') : patch.receipt_date)?.format('YYYY-MM-DD') ?? todayAccra()
      if (acc)
        void lookupRate(acc.currency, d).then((r) => {
          if (!rateTouched.current) form.setFieldValue('fx_rate', r)
        })
    }
    form.setFieldsValue(patch)
    rememberVehicles(f.vehicles)
    setClaims(f.claims.length ? f.claims.map((c) => ({ ...c, key: newKey(), ai: true })) : [{ key: newKey() }])
    if (files.length) setAttachments((a) => (a.length ? a : files))
    setAiIndex(index)
    setDirty(true)
    return true
  }

  const addRow = () => {
    setDirty(true)
    setClaims((rows) => [...rows, { key: newKey(), amount_orig: remaining > 0 ? remaining : null }])
  }

  const refundRemaining = () => {
    const first = claims.find((c) => c.customer_id || c.vehicle_id)
    const customerId = first?.customer_id ?? (first?.vehicle_id ? vehicles.get(first.vehicle_id)?.customer_id : null) ?? null
    setDirty(true)
    setClaims((rows) => [...rows, { key: newKey(), nature: '退款', customer_id: customerId, amount_orig: remaining }])
  }

  const validateClaims = (rows: ClaimDraft[]): string | null => {
    for (const [i, r] of rows.entries()) {
      const n = r.nature ? natureByName.get(r.nature) : undefined
      const row = i + 1
      if (!n) return t('第 {n} 行：请选款项性质', { n: row })
      if (!(num(r.amount_orig) > 0)) return t('第 {n} 行：请填金额', { n: row })
      if (n.kind === 'payment' && !r.vehicle_id && !r.customer_id)
        return t('第 {n} 行：“{nature}”请选车；大架号还没锁定的请选客户', { n: row, nature: t(n.name) })
      if ((n.kind === 'refund' || n.kind === 'parts') && !r.vehicle_id && !r.customer_id) return t('第 {n} 行：请选车或客户', { n: row })
    }
    const total = round2(rows.reduce((s, r) => s + num(r.amount_orig), 0))
    if (total > amount + 0.001) return t('拆分合计 {a} 超过到账金额 {b}', { a: money(total), b: money(amount) })
    return null
  }

  /** 保存。accept：采用业务员填的（财务请他填的那条记录）——拆分按 rows 存，那条记录标为已通过 */
  const save = async (opts?: { rows?: ClaimDraft[]; accept?: Submission }): Promise<boolean> => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return false
    }
    const rows = (opts?.rows ?? claims).filter((c) => c.nature || c.vehicle_id || c.customer_id || num(c.amount_orig) > 0)
    const err = validateClaims(rows)
    if (err) {
      message.error(err)
      return false
    }
    const p_receipt: { [k: string]: Json | undefined } = {
      receipt_date: v.receipt_date!.format('YYYY-MM-DD'),
      account_id: v.account_id ?? null,
      amount_orig: v.amount_orig ?? null,
      fx_rate: isUsd ? null : (v.fx_rate ?? null),
      payer_summary: v.payer_summary ?? '',
      bank_ref: v.bank_ref ?? '',
      cheque_no: v.cheque_no ?? '',
      note: v.note ?? '',
      attachments,
    }
    if (currentId) {
      p_receipt.id = currentId
      if (opts?.accept) {
        p_receipt.submission_id = opts.accept.id
        p_receipt.submission_updated_at = opts.accept.updated_at
      }
    } else if (review) {
      p_receipt.submission_id = review.id
      p_receipt.submission_updated_at = review.updated_at
    } else if (prefill?.line_id) p_receipt.line_id = prefill.line_id
    const p_claims = rows.map((r) => ({
      id: r.id ?? null,
      nature: r.nature ?? null,
      vehicle_id: r.vehicle_id ?? null,
      customer_id: r.vehicle_id ? null : (r.customer_id ?? null),
      amount_orig: round2(num(r.amount_orig)),
      report_note: r.report_note ?? '',
      model_desc: r.vehicle_id ? null : r.model_desc?.trim() || null,
      salesperson_id: r.vehicle_id ? null : (r.salesperson_id ?? null),
    }))
    setSaving(true)
    const { data, error } = await supabase.rpc('save_receipt', { p_receipt, p_claims: p_claims as Json })
    setSaving(false)
    if (error) {
      message.error((review ? t('通过失败：') : opts?.accept ? t('采用失败：') : t('保存失败：')) + errorText(error))
      return false
    }
    const wasReview = !!review
    const wasApproved = !!currentId && rStatus === 'approved'
    if (review) setReview(null)
    if (aiIndex !== null) {
      aiSession.markSaved(aiIndex)
      setAiIndex(null)
    }
    setChanged(true)
    // 到账的状态、进度、待办都可能变了（新录的开始审批、改了关键内容重新审批）
    notifySubmissionsChanged()
    const now = await load(data)
    const pending = receiptStatus(now?.status) === 'pending'
    const name = rflow.name(now?.step)
    if (opts?.accept) message.success(t('已采用并通过，{name} 填的拆分存到了这笔到账', { name: spName(opts.accept.salesperson_id) }))
    else if (wasReview) message.success(pending ? t('已通过，生成了到账，等{name}审批', { name }) : t('已通过，生成了正式到账，报款文字在下面'))
    else if (!currentId) message.success(pending ? t('已保存，等{name}审批，批完才算到账', { name }) : t('已保存，报款文字在下面'))
    else if (pending) message.success(wasApproved ? t('已保存，这笔到账回到审批中，等{name}审批', { name }) : t('已保存，等{name}审批', { name }))
    else message.success(t('已保存'))
    return true
  }

  /** 到账的审批动作：通过这一级 / 退回 / 重新提交（receipt_action） */
  const act = async (action: string, note?: string): Promise<boolean> => {
    if (!currentId) return false
    setActing(action)
    const { error } = await supabase.rpc('receipt_action', { p_id: currentId, p_action: action, p_note: note })
    setActing(null)
    if (error) {
      message.error(errorText(error))
      return false
    }
    setChanged(true)
    notifySubmissionsChanged()
    const now = await load(currentId)
    const pending = receiptStatus(now?.status) === 'pending'
    const name = rflow.name(now?.step)
    if (action.startsWith('approve_')) message.success(pending ? t('已通过，等{name}审批', { name }) : t('已通过，这笔到账生效了'))
    else if (action === 'reject') message.success(t('已退回'))
    else message.success(pending ? t('已重新提交，等{name}审批', { name }) : t('已重新提交，这笔到账生效了'))
    return true
  }

  /** 被退回的到账：有改动先保存，再重新提交（按现在的审批流从第一级开始） */
  const resubmit = async () => {
    if (dirty && !readOnly) {
      const ok = await save()
      if (!ok) return
    }
    await act('resubmit')
  }

  const reject = async () => {
    const reason = rejectReason.trim()
    if (rejecting === 'receipt') {
      // 退回审批中的到账
      if (!canApprove) return
      if (!reason) {
        message.error(t('请写退回原因，录入的人会看到'))
        return
      }
      if (await act('reject', reason)) setRejecting(null)
      return
    }
    // 退回业务员的提交 / 业务员填好的
    const target = rejecting === 'fill' ? fillReq : review
    if (!target) return
    if (!reason) {
      message.error(t('请写退回原因，业务员会看到'))
      return
    }
    setActing('reject')
    const { data, error } = await supabase
      .from('receipt_submissions')
      .update({ status: 'rejected', review_note: reason })
      .eq('id', target.id)
      .eq('status', 'pending')
      .select('id')
    setActing(null)
    if (error || !data?.length) {
      message.error(error ? errorText(error) : t('这条提交已经处理过了，请刷新后再看'))
      return
    }
    setRejecting(null)
    notifySubmissionsChanged()
    if (rejecting === 'fill') {
      message.success(t('已退回给 {name}，等他改好重新提交', { name: spName(target.salesperson_id) }))
      setChanged(true)
      if (currentId) await loadFill(currentId)
      return
    }
    message.success(t('已退回给业务员'))
    onClose(true)
  }

  // ---------------- 财务请业务员填写（这笔钱是哪个客户哪台车的）
  const spName = (id: number | null | undefined) => salespersons.find((s) => s.id === id)?.name ?? t('业务员')
  /** 还在请他填（没填 / 填好了等核对 / 退回了等他改） */
  const openFill = !!fillReq && ['requested', 'pending', 'rejected'].includes(fillReq.status)
  const fillName = spName(fillReq?.salesperson_id)
  /** 业务员自己传的、还没挂到到账上的凭证 */
  const fillNewFiles = fillReq ? fillReq.attachments.filter((a) => !attachments.includes(a)).length : 0

  /** 猜一下该请谁：拆分里的业务员，或车、客户的业务员 */
  const guessSalesperson = (): number | undefined => {
    for (const c of claims) {
      if (c.salesperson_id) return c.salesperson_id
      const v = c.vehicle_id ? vehicles.get(c.vehicle_id) : undefined
      if (v?.salesperson_id) return v.salesperson_id
      const cu = c.customer_id ? customers.find((x) => x.id === c.customer_id) : undefined
      if (cu?.salesperson_id) return cu.salesperson_id
    }
    return undefined
  }

  const sendRequest = async () => {
    if (!currentId) return
    if (!reqSp) {
      message.error(t('请选业务员'))
      return
    }
    setActing('request')
    const { error } = await supabase.rpc('request_receipt_info', { p_receipt_id: currentId, p_salesperson_id: reqSp, p_note: reqNote.trim() || undefined })
    setActing(null)
    if (error) {
      message.error(errorText(error))
      return
    }
    setRequesting(false)
    message.success(t('已发给 {name} 填写，他填好会提醒你', { name: spName(reqSp) }))
    notifySubmissionsChanged()
    setChanged(true)
    await loadFill(currentId)
  }

  const cancelFill = () => {
    if (!fillReq || !currentId) return
    const id = fillReq.id
    modal.confirm({
      title: t('取消请 {name} 填写？', { name: fillName }),
      content: t('他那边这条就没有了；以后还可以再请他或别人填。'),
      okText: t('确定取消'),
      cancelText: t('返回'),
      onOk: async () => {
        const { data, error } = await supabase.from('receipt_submissions').update({ status: 'withdrawn' }).eq('id', id).in('status', ['requested', 'rejected']).select('id')
        if (error || !data?.length) {
          message.error(error ? errorText(error) : t('他已经填好提交了，请关掉后重新打开'))
          return
        }
        message.success(t('已取消'))
        notifySubmissionsChanged()
        setChanged(true)
        await loadFill(currentId)
      },
    })
  }

  /** 把业务员填的拆分放进下面的表里（替换现有的行；同车同款项的行保留原来的 id 和报款备注），返回这些行 */
  const applyFill = (): ClaimDraft[] => {
    if (!fillReq) return claims
    const lines = parseClaims(fillReq.claims)
    const used = new Set<string>()
    const match = (c: SubmissionClaim) =>
      claims.find(
        (r) =>
          !used.has(r.key) &&
          r.id != null &&
          r.nature === (c.nature ?? undefined) &&
          (c.vehicle_id ? r.vehicle_id === c.vehicle_id : !r.vehicle_id && r.customer_id === (c.customer_id ?? null)),
      )
    const rows = lines.length
      ? lines.map<ClaimDraft>((c) => {
          const m = match(c)
          if (m) used.add(m.key)
          return {
            key: newKey(),
            id: m?.id,
            nature: c.nature ?? undefined,
            vehicle_id: c.vehicle_id ?? null,
            customer_id: c.customer_id ?? null,
            amount_orig: c.amount_orig ?? null,
            report_note: m?.report_note ?? '',
            model_desc: c.vehicle_id ? '' : (c.model ?? ''),
            salesperson_id: c.vehicle_id ? null : fillReq.salesperson_id,
            sub: c.vehicle_id ? undefined : c,
          }
        })
      : [{ key: newKey() }]
    const vids = lines.map((c) => c.vehicle_id).filter((x): x is number => !!x)
    if (vids.length) void supabase.from('v_vehicle_ledger').select('*').in('id', vids).then((v) => rememberVehicles(v.data ?? []))
    setClaims(rows)
    setFillApplied(true)
    setDirty(true)
    return rows
  }

  /** 采用业务员填的并通过：拆分照他填的（还没放进表里就先放进去）存到这笔到账，他传的凭证挂上，那条记录标为已通过 */
  const acceptFill = async () => {
    if (!fillReq) return
    const rows = fillApplied ? claims : applyFill()
    setActing('accept')
    await save({ rows, accept: fillReq })
    setActing(null)
  }

  const linkTo = (r: Receipt) => {
    if (!review || r.id == null) return
    modal.confirm({
      title: t('这笔就是 {no}？', { no: r.receipt_no ?? '' }),
      content: t('提交会标为已通过并关联到 {no}，业务员上传的凭证也会挂到这笔到账上。不会新建到账。', { no: r.receipt_no ?? '' }),
      okText: t('关联'),
      cancelText: t('取消'),
      onOk: async () => {
        const { error } = await supabase.rpc('link_submission', { p_submission_id: review.id, p_receipt_id: r.id as number })
        if (error) {
          message.error(errorText(error))
          return
        }
        message.success(t('已关联到 {no}', { no: r.receipt_no ?? '' }))
        setReview(null)
        notifySubmissionsChanged()
        setChanged(true)
        await load(r.id as number)
      },
    })
  }

  const remove = () => {
    if (!currentId) return
    modal.confirm({
      title: t('删除到账 {no}？', { no: receipt?.receipt_no ?? '' }),
      content: t('会连同它的拆分一起删除，不能恢复。'),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const a = await supabase.rpc('save_claims', { p_receipt_id: currentId, p_claims: [] })
        if (a.error) {
          message.error(errorText(a.error))
          return
        }
        const b = await supabase.from('bank_receipts').delete().eq('id', currentId)
        if (b.error) {
          message.error(errorText(b.error))
          return
        }
        message.success(t('已删除'))
        notifySubmissionsChanged()
        onClose(true)
      },
    })
  }

  const close = () => {
    if (dirty && !readOnly) {
      modal.confirm({
        title: t('有改动还没保存，确定关闭？'),
        okText: t('不保存，关闭'),
        cancelText: t('取消'),
        onOk: () => onClose(changed),
      })
    } else onClose(changed)
  }

  const natureOptions = receiptNatures(natures).map((n) => ({ value: n.name, label: t(n.name) }))

  const columns = [
    {
      title: t('款项性质'),
      width: 120,
      render: (_: unknown, r: ClaimDraft) => (
        <Select
          value={r.nature}
          options={natureOptions}
          style={{ width: '100%' }}
          placeholder={t('选择')}
          disabled={readOnly}
          onChange={(x: string) => setRow(r.key, { nature: x })}
        />
      ),
    },
    {
      title: t('车辆（大架号）'),
      render: (_: unknown, r: ClaimDraft) => {
        const v = r.vehicle_id ? vehicles.get(r.vehicle_id) : undefined
        return (
          <div>
            <Space.Compact style={{ width: '100%' }}>
              <VehicleSelect
                value={r.vehicle_id}
                known={[...vehicles.values()]}
                style={{ width: '100%' }}
                disabled={readOnly}
                onChange={(id, veh) => pickVehicle(r.key, id, veh)}
              />
              {!readOnly && (
                <Tooltip title={t('系统里还没有这台车？新增一台')}>
                  <Button icon={<PlusOutlined />} onClick={() => setNewVehicleFor(r.key)} />
                </Tooltip>
              )}
            </Space.Compact>
            {!v && r.sub && (
              <div className="text-warn" style={{ fontSize: 12 }}>
                {(() => {
                  const info = [r.sub.customer_name, r.sub.model, r.sub.vin ? t('大架号 {vin}', { vin: r.sub.vin }) : t('大架号未定')]
                    .filter(Boolean)
                    .join(' · ')
                  return r.ai ? t('识别到的：{info}', { info }) : t('业务员填的：{info}', { info })
                })()}
              </div>
            )}
            {v ? (
              <div className="hint">
                {t('{customer} · {sp} · 合同 {contract} · 已到 {received} · 余额 {balance}', {
                  customer: v.customer_name,
                  sp: v.salesperson_name ?? t('无业务员'),
                  contract: usd(v.contract_usd),
                  received: usd(v.received_usd),
                  balance: usd(v.balance_usd),
                })}
              </div>
            ) : r.nature && natureByName.get(r.nature)?.kind === 'payment' ? (
              <div className="unlocked-box">
                <div className="hint">{t('还不知道是哪台车（大架号未锁定）：先记到客户名下，以后再选车')}</div>
                <CustomerSelect
                  value={r.customer_id}
                  onChange={(id) => pickCustomer(r.key, id)}
                  placeholder={t('选客户')}
                  style={{ width: '100%', marginTop: 4 }}
                />
                {r.customer_id && (
                  <Space.Compact style={{ width: '100%', marginTop: 4 }}>
                    <Input
                      value={r.model_desc}
                      disabled={readOnly}
                      placeholder={t('数量与设备型号，如 1台重汽6X4自卸车')}
                      onChange={(e) => setRow(r.key, { model_desc: e.target.value })}
                    />
                    <Select
                      allowClear
                      disabled={readOnly}
                      style={{ width: 150 }}
                      placeholder={t('业务员')}
                      showSearch={{ optionFilterProp: 'label' }}
                      value={r.salesperson_id ?? undefined}
                      options={salespersons
                        .filter((s) => s.active || s.id === r.salesperson_id)
                        .map((s) => ({ value: s.id, label: s.name }))}
                      onChange={(x: number | undefined) => setRow(r.key, { salesperson_id: x ?? null })}
                    />
                  </Space.Compact>
                )}
              </div>
            ) : (
              r.nature && (
                <CustomerSelect
                  value={r.customer_id}
                  onChange={(id) => setRow(r.key, { customer_id: id })}
                  placeholder={t('不选车时选客户')}
                  style={{ width: '100%', marginTop: 4 }}
                />
              )
            )}
          </div>
        )
      },
    },
    {
      title: t('金额 {cur}', { cur: currency }),
      width: 150,
      render: (_: unknown, r: ClaimDraft) => (
        <InputNumber
          value={r.amount_orig ?? undefined}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          disabled={readOnly}
          onChange={(x) => setRow(r.key, { amount_orig: x == null ? null : Number(x) })}
        />
      ),
    },
    {
      title: 'USD',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, r: ClaimDraft) => (rate > 0 && r.amount_orig ? usd(num(r.amount_orig) / rate) : ''),
    },
    {
      title: t('报款备注（可空）'),
      width: 180,
      render: (_: unknown, r: ClaimDraft) => (
        <Input
          value={r.report_note}
          placeholder={t('如：老板给予$500折扣')}
          disabled={readOnly}
          onChange={(e) => setRow(r.key, { report_note: e.target.value })}
        />
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: '',
            width: 44,
            render: (_: unknown, r: ClaimDraft) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setDirty(true)
                  setClaims((rows) => rows.filter((x) => x.key !== r.key))
                }}
              />
            ),
          },
        ]),
  ]

  const title = currentId
    ? t('到账 {no}', { no: receipt?.receipt_no ?? '' })
    : review
      ? t('审核业务员提交 #{id}', { id: review.id })
      : t('新建到账')
  const reviewer = review ? salespersons.find((s) => s.id === review.salesperson_id)?.name : undefined
  const newVehicleRow = newVehicleFor ? claims.find((c) => c.key === newVehicleFor) : undefined

  // 进度条：录入 → 这笔到账的各级 → 生效
  const stepCurrent =
    rStatus === 'pending'
      ? Math.max(
          rFlowItems.findIndex((f) => f.step === rStep),
          0,
        ) + 1
      : rStatus === 'approved'
        ? rFlowItems.length + 1
        : // 退回在哪一级：第一个还没通过的
          rFlowItems.findIndex((f) => !f.at) + 1 || rFlowItems.length
  const signed = (name: string | null | undefined, at: string | null | undefined) => (name ? `${name} · ${dateTime(at)}` : '')
  const stepTag = inFlow && (
    <Tag color={rflow.stageColor(receipt?.status, receipt?.step)}>{rflow.stageLabel(receipt?.status, receipt?.step)}</Tag>
  )

  return (
    <Drawer
      open={open}
      title={
        stepTag ? (
          <Space wrap>
            <span>{title}</span>
            {stepTag}
          </Space>
        ) : (
          title
        )
      }
      size={Math.min(1080, typeof window !== 'undefined' ? window.innerWidth : 1080)}
      onClose={close}
      destroyOnHidden
      extra={
        <Space>
          {isAdmin && currentId && (
            <Button danger onClick={remove}>
              {t('删除')}
            </Button>
          )}
          {((!readOnly && review) || canApprove) && (
            <Button
              danger
              onClick={() => {
                setRejectReason('')
                setRejecting(review ? 'review' : 'receipt')
              }}
            >
              {t('退回')}
            </Button>
          )}
          {canApprove && rStep && (
            <Button type="primary" loading={acting === `approve_${rStep}`} onClick={() => void act(`approve_${rStep}`)}>
              {holdsStep ? t('{name}审核通过', { name: rflow.name(rStep) }) : t('代{post}通过', { post: rflow.name(rStep) })}
            </Button>
          )}
          {canResubmit && (
            <Button type="primary" loading={acting === 'resubmit' || saving} onClick={() => void resubmit()}>
              {t('重新提交')}
            </Button>
          )}
          {!readOnly && (
            <Button type={canApprove || canResubmit ? 'default' : 'primary'} loading={saving} onClick={() => void save()}>
              {review ? t('通过，生成到账') : t('保存')}
            </Button>
          )}
        </Space>
      }
    >
      <Spin spinning={loading}>
        {review && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('{name} 在 {when} 提交，等你审核', { name: reviewer ?? t('业务员'), when: dateTime(review.submitted_at) })}
            description={
              <div>
                <div>{t('核对凭证和金额，选好车（车不在系统里可以点 + 新增），没问题点“通过，生成到账”；不对就点“退回”写明原因。')}</div>
                {review.note && <div>{t('业务员说明：{note}', { note: review.note })}</div>}
                {review.review_note && <div>{t('上次退回原因：{reason}', { reason: review.review_note })}</div>}
              </div>
            }
          />
        )}
        {review && dupes.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('系统里已经有同账户、同金额、日期相近的到账，可能已经录过了')}
            description={
              <Space orientation="vertical" size={4}>
                {dupes.map((d) => (
                  <Space key={d.id} wrap>
                    <span>
                      {d.receipt_no} · {d.receipt_date} · {d.currency} {money(d.amount_orig)} · {t(d.claim_status ?? '')}
                    </span>
                    <Button size="small" icon={<LinkOutlined />} onClick={() => linkTo(d)}>
                      {t('就是这笔，关联')}
                    </Button>
                  </Space>
                ))}
              </Space>
            }
          />
        )}
        {currentId && receipt && rStatus === 'rejected' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('被退回：{reason}', { reason: receipt.reject_note ?? '' })}
            description={
              isStaff
                ? t('{name} 于 {when} 退回。改好后点“重新提交”。', { name: receipt.rejected_name ?? '', when: dateTime(receipt.rejected_at) })
                : t('{name} 于 {when} 退回，等财务改好后重新提交。', { name: receipt.rejected_name ?? '', when: dateTime(receipt.rejected_at) })
            }
          />
        )}
        {currentId && receipt && rStatus === 'pending' && canApprove && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('轮到你审批了：这一级是{name}', { name: rflow.name(rStep) })}
            description={t('核对凭证、金额和拆分，没问题点“通过”，不对点“退回”写明原因。')}
          />
        )}
        {currentId && receipt && rStatus === 'pending' && !canApprove && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('审批中，等{name}审批', { name: rflow.name(rStep) })}
            description={isStaff ? t('批完才算到账（才进余额和报表、才能报款）。改了日期、账户、金额或汇率会从第一级重新审批。') : undefined}
          />
        )}
        {inFlow && (
          <Card size="small" style={{ marginBottom: 12 }}>
            <Steps
              size="small"
              current={stepCurrent}
              status={rStatus === 'rejected' ? 'error' : rStatus === 'approved' ? 'finish' : 'process'}
              items={[
                { title: t('录入'), content: dateTime(receipt?.created_at) },
                ...rFlowItems.map((f) => ({ title: rflow.name(f.step), content: signed(f.by_name, f.at) })),
                { title: t('生效'), content: rStatus === 'approved' && receipt?.approved_at ? dateTime(receipt.approved_at) : '' },
              ]}
            />
            {rStatus === 'approved' && isStaff && !isAdmin && (
              <div className="hint" style={{ marginTop: 8 }}>
                {t('已生效。改了日期、账户、金额或汇率会回到审批中，重新批完才再算到账。')}
              </div>
            )}
          </Card>
        )}
        {isStaff && currentId && fillReq && fillReq.status === 'requested' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('已请 {name} 填写这笔是哪个客户哪台车的（{when}）', { name: fillName, when: dateTime(fillReq.requested_at) })}
            description={
              <div>
                {fillReq.request_note && <div>{t('留言：{note}', { note: fillReq.request_note })}</div>}
                <div>{t('他填好提交后会提醒你，到时在这里核对、采用。等他填的期间这笔到账照常可以审批、算到账。')}</div>
              </div>
            }
            action={
              <Button size="small" onClick={cancelFill}>
                {t('取消请填写')}
              </Button>
            }
          />
        )}
        {isStaff && currentId && fillReq && fillReq.status === 'pending' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('{name} 填好了（{when}），请核对', { name: fillName, when: dateTime(fillReq.submitted_at) })}
            description={
              <div>
                {claimsSummary(fillReq, t, 99).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {fillReq.note && <div>{t('业务员说明：{note}', { note: fillReq.note })}</div>}
                {fillNewFiles > 0 && <div>{t('他传了 {n} 个凭证，采用后会挂到这笔到账上', { n: fillNewFiles })}</div>}
                <div className="hint">{t('“采用并通过”：拆分照他填的存到这笔到账（替换已有的拆分）。想先看看、改一改，点“先放进拆分”，改好再采用。')}</div>
                <Space wrap style={{ marginTop: 8 }}>
                  <Button type="primary" size="small" loading={acting === 'accept'} onClick={() => void acceptFill()}>
                    {t('采用并通过')}
                  </Button>
                  <Button size="small" disabled={fillApplied} onClick={() => void applyFill()}>
                    {fillApplied ? t('已放进拆分') : t('先放进拆分')}
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      setRejectReason('')
                      setRejecting('fill')
                    }}
                  >
                    {t('退回给业务员')}
                  </Button>
                </Space>
              </div>
            }
          />
        )}
        {isStaff && currentId && fillReq && fillReq.status === 'rejected' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('退回了 {name} 填的（{when}）：{reason}', { name: fillName, when: dateTime(fillReq.reviewed_at), reason: fillReq.review_note ?? '' })}
            description={t('等他改好重新提交。不等了可以取消。')}
            action={
              <Button size="small" onClick={cancelFill}>
                {t('取消请填写')}
              </Button>
            }
          />
        )}
        {bankLine && !review && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={
              currentId
                ? t('这笔到账已和银行流水配对（{date} · {cur} {amt}）：账户、日期、金额和银行给的摘要、参考号、支票号不能改。确实录错的，先到“银行对账 → 全部流水明细”取消配对再改。', {
                    date: bankLine.line_date ?? '',
                    cur: bankLine.currency ?? currency,
                    amt: money(bankLine.amount_orig ?? 0),
                  })
                : t('这笔是从银行流水生成的：账户、日期、金额按银行为准，不能改；保存后会自动和那条流水配对。')
            }
          />
        )}
        {isAdmin && !currentId && !receiptId && !review && !submission && (
          <AiFill
            attachments={attachments}
            lockedAmount={prefill?.line_id ? (prefill.amount_orig ?? null) : null}
            onAttach={(p) => {
              setAttachments((a) => [...a, ...p])
              setDirty(true)
            }}
            onFill={applyAi}
          />
        )}
        <Card size="small" title={t('到账信息')} style={{ marginBottom: 12 }}>
          <Form form={form} layout="vertical" disabled={readOnly} onValuesChange={() => setDirty(true)}>
            <Row gutter={12}>
              <Col xs={24} md={10}>
                <Form.Item name="account_id" label={t('收款账户')} rules={[{ required: true, message: t('请选收款账户') }]}>
                  <Select
                    showSearch={{ optionFilterProp: 'label' }}
                    options={accountOptions(accounts)}
                    placeholder={t('搜索账户，如 ECO 8651')}
                    disabled={bankLocked || readOnly}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="receipt_date" label={t('到账日期')} rules={[{ required: true, message: t('请选日期') }]}>
                  <DatePicker style={{ width: '100%' }} allowClear={false} disabled={bankLocked || readOnly} />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item
                  name="amount_orig"
                  label={currency ? t('到账金额（{cur}）', { cur: currency }) : t('到账金额')}
                  rules={[{ required: true, message: t('请填金额') }]}
                >
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} disabled={bankLocked || readOnly} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item
                  name="fx_rate"
                  label={t('汇率（1 美元 = ? 原币）')}
                  rules={[{ required: !isUsd, message: t('请填汇率') }]}
                  extra={amount > 0 && rate > 0 ? t('折合 {usd}', { usd: usd(amount / rate) }) : undefined}
                >
                  <InputNumber
                    min={0.000001}
                    precision={4}
                    style={{ width: '100%' }}
                    disabled={isUsd || readOnly}
                    onChange={() => {
                      rateTouched.current = true
                    }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="cheque_no" label={t('支票号')}>
                  <Input disabled={bankGave('cheque_no') || readOnly} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="payer_summary" label={t('付款方 / 银行摘要')}>
                  <Input placeholder={t('如 TRF FROM ABC LTD')} disabled={bankGave('payer_summary') || readOnly} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="bank_ref" label={t('银行参考号（有就填）')}>
                  <Input disabled={bankGave('bank_ref') || readOnly} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="note" label={t('内部备注（不进报款）')}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>{t('凭证')}</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Vouchers
                value={attachments}
                readOnly={readOnly}
                onChange={(p) => {
                  setAttachments(p)
                  setDirty(true)
                }}
              />
            </div>
          </div>
          {receipt && (
            <div style={{ marginTop: 8 }}>
              <Space wrap>
                <Tag>{t(receipt.bank_status ?? '')}</Tag>
                {receipt.import_batch_id && <Tag color="purple">{t('银行导入')}</Tag>}
              </Space>
            </div>
          )}
        </Card>

        <Card
          size="small"
          title={t('拆分到车')}
          style={{ marginBottom: 12 }}
          extra={
            <span className={remaining < 0 ? 'text-danger' : remaining > 0 ? 'text-warn' : 'text-ok'}>
              {t('已拆 {cur} {a} / 到账 {b}，剩余 {c}', { cur: currency, a: money(claimedTotal), b: money(amount), c: money(remaining) })}
            </span>
          }
        >
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={claims}
            columns={columns}
            scroll={{ x: 860 }}
            locale={{ emptyText: t('还没有拆分。钱还不知道是哪台车的，也可以先只存到账。') }}
          />
          {!readOnly && (
            <Space style={{ marginTop: 8 }} wrap>
              <Button icon={<PlusOutlined />} onClick={addRow}>
                {t('再加一行')}
              </Button>
              {remaining > 0 && claims.some((c) => c.vehicle_id || c.customer_id) && (
                <Button onClick={refundRemaining}>{t('剩余 {amt} 退还客户', { amt: money(remaining) })}</Button>
              )}
              {currentId && !openFill && (
                <Tooltip title={dirty ? t('先保存，再请业务员填写') : t('不知道这笔钱是哪个客户哪台车的？发给业务员填，他填好你再核对')}>
                  <Button
                    icon={<SendOutlined />}
                    disabled={dirty}
                    onClick={() => {
                      setReqSp(guessSalesperson())
                      setReqNote('')
                      setRequesting(true)
                    }}
                  >
                    {t('请业务员填写')}
                  </Button>
                </Tooltip>
              )}
              <span className="hint">
                {t('一笔钱付多台车时，每台车一行；金额按业务员通知的原币填写。还不知道是哪台车的，不选车、选客户。')}
              </span>
            </Space>
          )}
        </Card>

        {currentId && receipt && rStatus === 'approved' && (
          <Card size="small" title={t('报款文字')}>
            {dirty && !readOnly ? (
              <Alert type="info" showIcon title={t('有改动还没保存，保存后这里会更新。')} />
            ) : (
              <ReportBox receipt={receipt} text={reportText} readOnly={readOnly} onChanged={() => void load(currentId).then(() => setChanged(true))} />
            )}
          </Card>
        )}
        {currentId && receipt && rStatus !== 'approved' && isStaff && (
          <Card size="small" title={t('报款文字')}>
            <span className="hint">{t('审批通过（生效）后才能报款。')}</span>
          </Card>
        )}
        {review && <ApprovalTrail docType="submission" docId={review.id} version={review.updated_at} />}
        {inFlow && <ApprovalTrail docType="receipt" docId={currentId} version={receipt?.updated_at} />}
        {isStaff && fillReq && <ApprovalTrail docType="submission" docId={fillReq.id} version={fillReq.updated_at} />}
      </Spin>

      <VehicleFormModal
        open={newVehicleFor !== null}
        initial={
          newVehicleRow?.sub
            ? {
                vin: newVehicleRow.sub.vin,
                model: newVehicleRow.sub.model,
                customer_id: newVehicleRow.sub.customer_id,
                salesperson_id: review?.salesperson_id ?? newVehicleRow.salesperson_id,
              }
            : review
              ? { salesperson_id: review.salesperson_id }
              : undefined
        }
        onClose={async (savedId) => {
          const key = newVehicleFor
          setNewVehicleFor(null)
          if (savedId && key) {
            const { data } = await supabase.from('v_vehicle_ledger').select('*').eq('id', savedId).single()
            if (data) pickVehicle(key, savedId, data)
          }
        }}
      />

      <Drawer
        open={rejecting !== null}
        title={rejecting === 'receipt' ? t('退回这笔到账') : t('退回给业务员')}
        size={Math.min(480, typeof window !== 'undefined' ? window.innerWidth : 480)}
        onClose={() => setRejecting(null)}
        extra={
          <Button danger type="primary" loading={acting === 'reject'} onClick={() => void reject()}>
            {t('退回')}
          </Button>
        }
      >
        <Typography.Paragraph>
          {rejecting === 'receipt' ? t('写清楚哪里不对、要怎么改，录入的人会看到，改好后重新提交。') : t('写清楚哪里不对、要怎么改，业务员会看到，改好后重新提交。')}
        </Typography.Paragraph>
        <Input.TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder={t('如：凭证看不清，请重新拍；金额和银行对不上')}
          autoFocus
        />
      </Drawer>

      <Modal
        open={requesting}
        title={t('请业务员填写：这笔钱是哪个客户哪台车的')}
        okText={t('发给他')}
        cancelText={t('取消')}
        confirmLoading={acting === 'request'}
        onOk={() => void sendRequest()}
        onCancel={() => setRequesting(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {t('他会在“提交到账”里看到这笔（账户、日期、金额照你录的，改不了），填好是哪台车的再提交回来，你核对后采用。期间这笔到账照常可以审批、算到账。')}
        </Typography.Paragraph>
        <div style={{ marginBottom: 4 }}>{t('业务员')}</div>
        <Select
          style={{ width: '100%', marginBottom: 12 }}
          placeholder={t('选业务员')}
          showSearch={{ optionFilterProp: 'label' }}
          virtual={false}
          value={reqSp}
          options={salespersons.filter((s) => s.active || s.id === reqSp).map((s) => ({ value: s.id, label: s.name }))}
          onChange={(v: number) => setReqSp(v)}
        />
        <div style={{ marginBottom: 4 }}>{t('给他的话（可空）')}</div>
        <Input.TextArea
          value={reqNote}
          onChange={(e) => setReqNote(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder={t('如：11-08 GHS 150,000 TRF FROM KOFI 是谁的？')}
        />
      </Modal>
    </Drawer>
  )
}
