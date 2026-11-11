import { DeleteOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons'
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
  Row,
  Select,
  Space,
  Spin,
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
import { dateTime, money, num, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { defaultNature, receiptNatures } from '../lib/natures'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { notifySubmissionsChanged, parseClaims } from '../lib/submissions'
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
  const { isStaff, isAdmin } = useAuth()
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
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [newVehicleFor, setNewVehicleFor] = useState<string | null>(null)
  /** 正在审核的业务员提交（通过后清空，变成普通的到账） */
  const [review, setReview] = useState<Submission | null>(null)
  const [dupes, setDupes] = useState<Receipt[]>([])
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  /** 表里的内容是智能填表认出来的第几笔（保存后记成已录） */
  const [aiIndex, setAiIndex] = useState<number | null>(null)
  const rateTouched = useRef(false)

  const accountId = Form.useWatch('account_id', form)
  const amount = num(Form.useWatch('amount_orig', form))
  const rate = num(Form.useWatch('fx_rate', form))
  const account = accountId ? accountById.get(accountId) : undefined
  const currency = account?.currency ?? ''
  const isUsd = currency === 'USD'
  const readOnly = !isStaff

  const rememberVehicles = useCallback((list: (Vehicle | null | undefined)[]) => {
    setVehicles((m) => {
      const next = new Map(m)
      for (const v of list) if (v?.id != null) next.set(v.id, v)
      return next
    })
  }, [])

  const load = useCallback(
    async (id: number) => {
      setLoading(true)
      const [r, c, tx] = await Promise.all([
        supabase.from('v_bank_receipts').select('*').eq('id', id).single(),
        supabase.from('v_receipt_claims').select('*').eq('receipt_id', id).order('id'),
        supabase.rpc('receipt_report_text', { p_receipt_id: id }),
      ])
      if (r.error) {
        message.error(errorText(r.error))
        setLoading(false)
        return
      }
      const rec = r.data
      setReceipt(rec)
      setCurrentId(id)
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
    },
    [form, message, rememberVehicles],
  )

  // 打开时：编辑 → 读数据；审核提交 → 按提交预填；新建 → 清空并预填
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setDirty(false)
    setDupes([])
    setReview(null)
    setAiIndex(null)
    if (receiptId) {
      void load(receiptId)
      return
    }
    setCurrentId(null)
    setReceipt(null)
    setReportText('')
    setVehicles(new Map())
    form.resetFields()
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

  const save = async () => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const rows = claims.filter((c) => c.nature || c.vehicle_id || c.customer_id || num(c.amount_orig) > 0)
    const err = validateClaims(rows)
    if (err) {
      message.error(err)
      return
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
    if (currentId) p_receipt.id = currentId
    else if (review) {
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
      message.error((review ? t('通过失败：') : t('保存失败：')) + errorText(error))
      return
    }
    if (review) {
      message.success(t('已通过，生成了正式到账，报款文字在下面'))
      setReview(null)
      notifySubmissionsChanged()
    } else message.success(currentId ? t('已保存') : t('已保存，报款文字在下面'))
    if (aiIndex !== null) {
      aiSession.markSaved(aiIndex)
      setAiIndex(null)
    }
    setChanged(true)
    await load(data)
  }

  const reject = async () => {
    if (!review) return
    const reason = rejectReason.trim()
    if (!reason) {
      message.error(t('请写退回原因，业务员会看到'))
      return
    }
    const { data, error } = await supabase
      .from('receipt_submissions')
      .update({ status: 'rejected', review_note: reason })
      .eq('id', review.id)
      .eq('status', 'pending')
      .select('id')
    if (error || !data?.length) {
      message.error(error ? errorText(error) : t('这条提交已经处理过了，请刷新后再看'))
      return
    }
    setRejecting(false)
    message.success(t('已退回给业务员'))
    notifySubmissionsChanged()
    onClose(true)
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

  return (
    <Drawer
      open={open}
      title={title}
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
          {!readOnly && review && (
            <Button
              danger
              onClick={() => {
                setRejectReason('')
                setRejecting(true)
              }}
            >
              {t('退回')}
            </Button>
          )}
          {!readOnly && (
            <Button type="primary" loading={saving} onClick={save}>
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
        {prefill?.line_id && !currentId && !review && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={t('这笔是从银行对账单生成的，保存后会自动和那条流水配对。')} />
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
                  <Select showSearch={{ optionFilterProp: 'label' }} options={accountOptions(accounts)} placeholder={t('搜索账户，如 ECO 8651')} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="receipt_date" label={t('到账日期')} rules={[{ required: true, message: t('请选日期') }]}>
                  <DatePicker style={{ width: '100%' }} allowClear={false} />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item
                  name="amount_orig"
                  label={currency ? t('到账金额（{cur}）', { cur: currency }) : t('到账金额')}
                  rules={[{ required: true, message: t('请填金额') }]}
                >
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
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
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="payer_summary" label={t('付款方 / 银行摘要')}>
                  <Input placeholder={t('如 TRF FROM ABC LTD')} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="bank_ref" label={t('银行参考号（有就填）')}>
                  <Input />
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
              <span className="hint">
                {t('一笔钱付多台车时，每台车一行；金额按业务员通知的原币填写。还不知道是哪台车的，不选车、选客户。')}
              </span>
            </Space>
          )}
        </Card>

        {currentId && receipt && (
          <Card size="small" title={t('报款文字')}>
            {dirty && !readOnly ? (
              <Alert type="info" showIcon title={t('有改动还没保存，保存后这里会更新。')} />
            ) : (
              <ReportBox receipt={receipt} text={reportText} readOnly={readOnly} onChanged={() => void load(currentId).then(() => setChanged(true))} />
            )}
          </Card>
        )}
        {review && <ApprovalTrail docType="submission" docId={review.id} version={review.updated_at} />}
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
        open={rejecting}
        title={t('退回给业务员')}
        size={Math.min(480, typeof window !== 'undefined' ? window.innerWidth : 480)}
        onClose={() => setRejecting(false)}
        extra={
          <Button danger type="primary" onClick={reject}>
            {t('退回')}
          </Button>
        }
      >
        <Typography.Paragraph>{t('写清楚哪里不对、要怎么改，业务员会看到，改好后重新提交。')}</Typography.Paragraph>
        <Input.TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder={t('如：凭证看不清，请重新拍；金额和银行对不上')}
          autoFocus
        />
      </Drawer>
    </Drawer>
  )
}
