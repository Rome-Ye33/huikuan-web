import { DeleteOutlined, PlusOutlined, SwapRightOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Col, Collapse, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { money, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import {
  isCashLike,
  moduleColor,
  moduleOptions,
  newPart,
  notifyJournalChanged,
  parseParts,
  partsPayload,
  partsTotal,
  RECEIPT_MODULE,
  transferModule,
  transferSummary,
} from '../lib/journal'
import type { CashEntry, EntryKind, PartDraft } from '../lib/journal'
import { fetchEntryLogs } from '../lib/journalLog'
import type { JournalLog } from '../lib/journalLog'
import type { Duty } from '../lib/perms'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import JournalLogList from './JournalLogList'
import PartsEditor from './PartsEditor'
import type { ReceiptPrefill } from './ReceiptEditor'
import Vouchers from './Vouchers'

// 收支录入：支出、其他收入、账户互转。一笔一行，存进 cash_entries（数据库 36 的 save_cash_entry）。
// 两种用法：
// 1. 填银行流水（prefill 带 line_id）：银行账户先导流水再填，日期、账户、金额照银行的，不能改；保存后这条流水就“已填”。
// 2. 记现金（没有 line_id）：只能选现金账户；银行账户的收付都从流水填，不在这里手工记，免得和流水重复。
// 客户的车款不在这里录：走到账录入，审批通过后自动出现在日记账里。
// 账户互转录一次，两个账户各记一笔（转出账户记支出、转入账户记收入），两笔互相指着对方（peer_id）；币种不同就是货币兑换。
// 互转里银行那一边：从流水填的就是那条流水；从现金这边先记的，银行那边“等流水”，流水导进来按同账户、同金额、3 天内自动对上。
// “保存并记下一笔”：日期、账户、业务模块留着，金额、摘要清空，出纳一天记几十笔现金不用每次重选。
// 谁能改（数据库 36）：从流水填要能改“银行日记账”；记现金要能改“现金日记账”；改、删一笔要能改其中一边账户所在的那本。
// 银行流水分工：对上的流水不是自己那一摊（填收款 / 填付款）的，只能看。
// 几个人同时改：存的时候带上打开时的版本，别人刚改过就挡住、说是谁改的，点“重新打开”看最新的；
// 同一天、同账户、同金额已经有人记了一笔现金，先提醒，确定了再记。下面有这一笔的修改记录。
// 一笔里分几种业务（数据库 37）：点「分几种业务」，每种一个业务模块、客户 / 供应商、摘要、金额，加起来等于这一笔（流水还是一条）。
//   填收进来的流水时可以选「设备回款」：那几行要选大架号，点「下一步：录成到账」转到到账录入，别的几种跟着到账一起存。
//   流水已经配上了到账、钱还有剩的（prefill.with_receipt）：这里填剩下的钱。和到账一起填的这一笔金额不能改、不能单删。

/** 从银行流水填的时候带过来的内容 */
export type CashEntryPrefill = {
  kind?: EntryKind
  account_id?: number
  entry_date?: string
  amount?: number
  /** 收进来的流水填成互转：这条流水是转入那一边 */
  to_account_id?: number
  to_amount?: number
  summary?: string | null
  bank_ref?: string | null
  /** 银行摘要，显示在上面让人照着填 */
  bank_summary?: string | null
  /** 填的是哪条银行流水：保存后这条流水就填好了 */
  line_id?: number
  /** 这条流水已经配上了到账（37）：这里填到账以外剩下的钱，amount 是剩下的 */
  with_receipt?: boolean
  receipt_no?: string | null
  receipt_amount?: number
  /** 流水本身的金额（填剩下的钱时用来说明） */
  line_amount?: number
}

/** 和这一笔一起填同一条流水的到账（37）：流水 = 到账 + 这一笔 */
type RestOf = { receipt_id: number; receipt_no: string; receipt_amount: number; line_amount: number }

type FormValues = {
  entry_date: dayjs.Dayjs
  account_id?: number
  amount?: number
  module?: string
  counterparty?: string
  summary?: string
  fx_rate?: number | null
  bank_ref?: string
  cheque_no?: string
  note?: string
  to_account_id?: number
  to_amount?: number
  fee?: number | null
}

const KIND_LABEL: Record<EntryKind, string> = { out: '支出', in: '其他收入', transfer: '账户互转' }

export default function CashEntryEditor({
  open,
  entryId,
  prefill,
  defaultAccountId,
  onClose,
  onReceipt,
}: {
  open: boolean
  entryId: number | null
  prefill?: CashEntryPrefill | null
  /** 明细页上选着的账户：新记一笔时默认用它 */
  defaultAccountId?: number
  onClose: (changed: boolean) => void
  /** 转到到账录入（37）：prefill = 设备回款那几行录成到账（别的几种跟着一起存）；id = 打开和这一笔一起填的到账。没给就不出这两样 */
  onReceipt?: (r: { id?: number; prefill?: ReceiptPrefill }) => void
}) {
  const t = useT()
  const { message, modal } = App.useApp()
  const { canEdit, mine } = useAuth()
  const canBank = canEdit('journal')
  const canCash = canEdit('cash')
  const { accounts, accountById, customers } = useRefData()
  const [form] = Form.useForm<FormValues>()
  const [kind, setKind] = useState<EntryKind>('out')
  const [entry, setEntry] = useState<CashEntry | null>(null)
  const [peer, setPeer] = useState<CashEntry | null>(null)
  // 改的时候：哪一边已经和银行流水对上了（那一边的账户、金额照银行的，不能改；对上了日期也不能改）
  const [linked, setLinked] = useState<{ out: boolean; in: boolean }>({ out: false, in: false })
  const [attachments, setAttachments] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState(false)
  const [count, setCount] = useState(0)
  const [logs, setLogs] = useState<JournalLog[]>([])
  // 别人刚改过 / 删了 / 流水被别人填了：说清楚，存不了；stale 可以重新打开看最新的
  const [conflict, setConflict] = useState<{ kind: 'stale' | 'gone' | 'line'; msg: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** 分了几种业务（37）：null = 只有一种（用上面的业务模块、客户） */
  const [parts, setParts] = useState<PartDraft[] | null>(null)
  /** 改的这一笔是和到账一起填同一条流水的（37） */
  const [rest, setRest] = useState<RestOf | null>(null)
  const editing = entryId !== null
  // 从银行流水填：流水那一边的日期、账户、金额照银行的，不能改
  const fromLine = !editing && !!prefill?.line_id
  // 收进来的流水（填成其他收入，或者互转的转入那一边）
  const lineCredit = fromLine && (!!prefill?.to_account_id || prefill?.kind === 'in')
  // 能不能改：现金账户那一边看“现金日记账”；银行账户那一边看“银行日记账”，对上了流水的还要是自己那一摊（分工）
  const sideOk = (accId: number | null | undefined, lineDir: Duty | null, duty = true) => {
    const a = accId ? accountById.get(accId) : undefined
    if (!a) return false
    if (isCashLike(a)) return canCash
    return canBank && (!duty || !lineDir || mine(lineDir))
  }
  const outDir: Duty | null = linked.out ? (peer ? 'out' : ((entry?.direction as Duty | undefined) ?? null)) : null
  const editableAs = (duty: boolean) => !!entry && (sideOk(entry.account_id, outDir, duty) || (!!peer && sideOk(peer.account_id, linked.in ? 'in' : null, duty)))
  const allowed = fromLine ? canBank && mine(lineCredit ? 'in' : 'out') : editing ? editableAs(true) : canCash
  // 能改，只是按分工这条流水归别人管
  const dutyLocked = editing && !!entry && !editableAs(true) && editableAs(false)
  const readOnly = !allowed
  const lockFrom = (fromLine && !lineCredit) || linked.out
  const lockTo = (fromLine && lineCredit) || linked.in
  const lockDate = fromLine || linked.out || linked.in
  /** 填流水里到账以外剩下的钱（37） */
  const withReceipt = fromLine && !!prefill?.with_receipt
  /** 金额定死了（照流水、对上了流水）：分几种业务时要加起来等于它；没定死（记现金）：金额就是几种加起来 */
  const lockAmount = fromLine || linked.out
  /** 收进来的流水分几种业务时能选「设备回款」，那几行下一步录成到账（要能录到账、配流水） */
  const canReceipt = !!onReceipt && fromLine && lineCredit && !withReceipt && canEdit('receipts') && canEdit('reconcile')
  const carRows = parts?.filter((r) => r.module === RECEIPT_MODULE) ?? []

  // 打开时：新记一笔按带过来的内容填；改一笔先读回来（互转的把另一边也读回来）
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setCount(0)
    setEntry(null)
    setPeer(null)
    setLinked({ out: false, in: false })
    setLogs([])
    setConflict(null)
    setParts(null)
    setRest(null)
    form.resetFields()
    if (entryId === null) {
      const k = prefill?.kind ?? 'out'
      setKind(k)
      setAttachments([])
      // 记现金时，明细页上选着的是银行账户就不带过来（银行账户从流水填）
      const def = defaultAccountId && isCashLike(accountById.get(defaultAccountId)) ? defaultAccountId : undefined
      form.setFieldsValue({
        entry_date: dayjs(prefill?.entry_date ?? todayAccra()),
        account_id: prefill?.line_id ? prefill.account_id : (prefill?.account_id ?? def),
        amount: prefill?.amount,
        to_account_id: prefill?.to_account_id,
        to_amount: prefill?.to_amount,
        summary: prefill?.summary ?? undefined,
        bank_ref: prefill?.bank_ref ?? undefined,
      })
      return
    }
    let alive = true
    void (async () => {
      let { data } = await supabase.from('cash_entries').select('*').eq('id', entryId).maybeSingle()
      // 互转的手续费：打开那笔互转（手续费跟着互转改）
      if (data?.fee_of) ({ data } = await supabase.from('cash_entries').select('*').eq('id', data.fee_of).maybeSingle())
      if (!alive || !data) return
      let out = data
      let other: CashEntry | null = null
      if (data.peer_id) {
        const { data: p } = await supabase.from('cash_entries').select('*').eq('id', data.peer_id).maybeSingle()
        other = p ?? null
        // 互转统一按“转出 → 转入”显示
        if (other && data.direction === 'in') [out, other] = [other, data]
      }
      const ids = [out.id, other?.id].filter((x): x is number => !!x)
      const [{ data: fee }, { data: lines }] = await Promise.all([
        other ? supabase.from('cash_entries').select('id, amount').eq('fee_of', out.id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('bank_statement_lines').select('id, entry_id, receipt_id, amount_orig').in('entry_id', ids),
      ])
      // 和到账一起填的同一条流水（37）：读到账的单号、金额，说清楚流水 = 到账 + 这一笔
      const withR = (lines ?? []).find((l) => l.entry_id === out.id && l.receipt_id)
      const rcpt = withR?.receipt_id
        ? (await supabase.from('bank_receipts').select('id, receipt_no, amount_orig').eq('id', withR.receipt_id).maybeSingle()).data
        : null
      if (!alive) return
      setRest(
        withR && rcpt
          ? { receipt_id: rcpt.id, receipt_no: rcpt.receipt_no ?? '', receipt_amount: Number(rcpt.amount_orig), line_amount: Number(withR.amount_orig) }
          : null,
      )
      const ps = parseParts(out.parts)
      setParts(ps.length ? ps.map((x) => newPart({ module: x.module, counterparty: x.counterparty ?? undefined, summary: x.summary ?? undefined, amount: x.amount })) : null)
      // 修改记录：这一笔（互转两边、手续费）和对上的流水
      void fetchEntryLogs([...ids, ...(fee ? [fee.id] : [])], (lines ?? []).map((l) => l.id)).then((rows) => {
        if (alive) setLogs(rows)
      })
      const on = new Set((lines ?? []).map((l) => l.entry_id))
      setLinked({ out: on.has(out.id), in: !!other && on.has(other.id) })
      setEntry(out)
      setPeer(other)
      setKind(other ? 'transfer' : (out.direction as EntryKind))
      setAttachments(out.attachments ?? [])
      form.setFieldsValue({
        entry_date: dayjs(out.entry_date),
        account_id: out.account_id,
        amount: Number(out.amount),
        module: out.module ?? undefined,
        counterparty: out.counterparty ?? undefined,
        summary: out.summary ?? undefined,
        fx_rate: out.fx_rate == null ? null : Number(out.fx_rate),
        bank_ref: out.bank_ref ?? undefined,
        cheque_no: out.cheque_no ?? undefined,
        note: out.note ?? undefined,
        to_account_id: other?.account_id,
        to_amount: other ? Number(other.amount) : undefined,
        fee: fee ? Number(fee.amount) : null,
      })
    })()
    return () => {
      alive = false
    }
  }, [open, entryId, prefill, defaultAccountId, accountById, form, reloadKey])

  const accountId = Form.useWatch('account_id', form)
  const toAccountId = Form.useWatch('to_account_id', form)
  const amount = Form.useWatch('amount', form)
  const toAmount = Form.useWatch('to_amount', form)
  const fee = Form.useWatch('fee', form)
  const fxRate = Form.useWatch('fx_rate', form)
  const entryDate = Form.useWatch('entry_date', form)
  const module = Form.useWatch('module', form)
  const acct = accountId ? accountById.get(accountId) : undefined
  const toAcct = toAccountId ? accountById.get(toAccountId) : undefined
  const sameCurrency = !acct || !toAcct || acct.currency === toAcct.currency

  // 汇率：按日期带出基础资料里的汇率（美元账户就是 1），可以改
  useEffect(() => {
    if (!open || kind === 'transfer' || !acct || !entryDate || readOnly) return
    if (editing && entry && entry.account_id === acct.id && entry.entry_date === entryDate.format('YYYY-MM-DD')) return
    let alive = true
    void lookupRate(acct.currency, entryDate.format('YYYY-MM-DD')).then((r) => {
      if (alive) form.setFieldValue('fx_rate', r)
    })
    return () => {
      alive = false
    }
  }, [open, kind, acct, entryDate, editing, entry, readOnly, form])

  // 互转：业务模块按两边的账户自动定；币种一样时转入金额跟着转出金额走；摘要照解款表的写法先填好
  const autoModule = transferModule(acct, toAcct)
  useEffect(() => {
    if (kind !== 'transfer' || readOnly) return
    form.setFieldValue('module', autoModule)
  }, [kind, autoModule, readOnly, form])
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || !sameCurrency || lockTo) return
    form.setFieldValue('to_amount', amount)
  }, [kind, amount, sameCurrency, readOnly, lockTo, form])
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || !sameCurrency || !lockTo) return
    form.setFieldValue('amount', toAmount)
  }, [kind, toAmount, sameCurrency, readOnly, lockTo, form])
  const [summaryTouched, setSummaryTouched] = useState(false)
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || summaryTouched || editing) return
    form.setFieldValue('summary', transferSummary(autoModule, acct, toAcct))
  }, [kind, autoModule, acct, toAcct, summaryTouched, editing, readOnly, form])

  const counterpartyOptions = useMemo(() => {
    const q = String(form.getFieldValue('counterparty') ?? '').toLowerCase()
    return customers
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((c) => ({ value: c.name }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, open, count])

  /** 分几种业务时每一行的客户 / 供应商候选：全部客户 */
  const allCounterparties = useMemo(() => customers.map((c) => ({ value: c.name })), [customers])

  // 分几种业务（37）：记现金时金额就是几种加起来
  useEffect(() => {
    if (!parts || lockAmount || kind === 'transfer' || readOnly) return
    const sum = partsTotal(parts)
    form.setFieldValue('amount', sum > 0 ? sum : undefined)
  }, [parts, lockAmount, kind, readOnly, form])
  /** 开始分几种业务：第一种照上面填的，再空一行 */
  const startParts = () => {
    const v = form.getFieldsValue()
    setParts([newPart({ module: v.module, counterparty: v.counterparty, amount: v.amount ?? null }), newPart()])
  }
  /** 不分了：回到一种，业务模块、客户用第一种的 */
  const stopParts = () => {
    const first = parts?.[0]
    setParts(null)
    if (first) form.setFieldsValue({ module: first.module === RECEIPT_MODULE ? undefined : first.module, counterparty: first.counterparty })
  }
  const partModules = [...(canReceipt && kind === 'in' ? [RECEIPT_MODULE] : []), ...moduleOptions(kind)]

  /** 设备回款那几行录成到账（下一步选大架号），别的几种跟着到账一起存（save_receipt_with_parts） */
  const goReceipt = (v: FormValues) => {
    if (!prefill?.line_id || !onReceipt || !parts) return
    const others = parts.filter((r) => r.module !== RECEIPT_MODULE)
    onReceipt({
      prefill: {
        account_id: prefill.account_id,
        receipt_date: prefill.entry_date,
        amount_orig: partsTotal(carRows),
        payer_summary: prefill.bank_summary ?? null,
        bank_ref: prefill.bank_ref ?? null,
        line_id: prefill.line_id,
        line_amount: Number(prefill.amount ?? 0),
        claims: carRows.map((c) => ({ amount_orig: Number(c.amount ?? 0) })),
        others: others.map((o) => ({ module: o.module ?? '', counterparty: o.counterparty?.trim() || null, summary: o.summary?.trim() || null, amount: Number(o.amount ?? 0) })),
        others_summary: v.summary?.trim() || null,
      },
    })
  }

  /** 存不了：别人刚改过、删了、流水被别人填了的，在上面说清楚（列表也重读）；别的报错照常提示 */
  const fail = (error: { message: string }) => {
    const msg = errorText(error)
    const kind = /请关掉重新打开/.test(error.message) ? 'stale' : /已经不在了/.test(error.message) ? 'gone' : /请刷新/.test(error.message) ? 'line' : null
    if (!kind) {
      message.error(msg)
      return
    }
    setConflict({ kind, msg })
    notifyJournalChanged()
  }

  const save = async (next: boolean) => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    // 分了几种业务：每种都要选业务模块、填金额，加起来等于这一笔
    if (parts && kind !== 'transfer') {
      const bad = parts.findIndex((r) => !r.module || !(Number(r.amount) > 0))
      if (bad >= 0) {
        message.error(t('第 {n} 种业务：请选业务模块、填金额', { n: bad + 1 }))
        return
      }
      if (lockAmount && Math.abs(partsTotal(parts) - Number(v.amount ?? 0)) >= 0.005) {
        message.error(t('几种业务加起来是 {sum}，要等于 {total}', { sum: money(partsTotal(parts)), total: money(v.amount) }))
        return
      }
      if (carRows.length) {
        goReceipt(v)
        return
      }
    }
    const split = !!parts && kind !== 'transfer'
    const p: Record<string, Json | undefined> = {
      id: entry?.id,
      // 打开时读到的版本（互转是转出那一边的）：别人在这之后改过就存不了，免得悄悄盖掉
      updated_at: entry?.updated_at,
      kind,
      entry_date: v.entry_date.format('YYYY-MM-DD'),
      account_id: v.account_id,
      amount: split && !lockAmount ? partsTotal(parts) : v.amount,
      module: kind === 'transfer' ? autoModule : split ? parts[0].module : v.module,
      counterparty: split ? parts[0].counterparty?.trim() || null : v.counterparty?.trim() || null,
      parts: split ? partsPayload(parts) : null,
      with_receipt: withReceipt || undefined,
      summary: v.summary?.trim() || null,
      fx_rate: kind === 'transfer' ? null : (v.fx_rate ?? null),
      bank_ref: v.bank_ref?.trim() || null,
      cheque_no: v.cheque_no?.trim() || null,
      note: v.note?.trim() || null,
      attachments,
      line_id: prefill?.line_id,
    }
    if (kind === 'transfer') {
      p.to_account_id = v.to_account_id
      p.to_amount = v.to_amount
      p.fee = v.fee || null
    }
    setSaving(true)
    let { error } = await supabase.rpc('save_cash_entry', { p })
    // 同一天、同账户、同金额已经有人记了一笔：问一下，确定了再记
    if (error?.hint === 'dup_cash_entry') {
      setSaving(false)
      const again = await modal.confirm({
        title: t('可能记重了'),
        content: errorText(error),
        okText: t('确定，再记一笔'),
        cancelText: t('不记了'),
      })
      if (!again) return
      setSaving(true)
      ;({ error } = await supabase.rpc('save_cash_entry', { p: { ...p, confirm_dup: true } }))
    }
    setSaving(false)
    if (error) {
      fail(error)
      return
    }
    notifyJournalChanged()
    setChanged(true)
    message.success(kind === 'transfer' ? t('已保存，两个账户各记了一笔') : t('已保存'))
    if (!next) {
      onClose(true)
      return
    }
    // 记下一笔：日期、账户、业务模块留着，其余清空
    setCount((n) => n + 1)
    setAttachments([])
    setSummaryTouched(false)
    setParts(null)
    form.setFieldsValue({ amount: undefined, counterparty: undefined, summary: undefined, bank_ref: undefined, cheque_no: undefined, note: undefined, to_amount: undefined, fee: undefined })
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const { error } = await supabase.rpc('delete_cash_entry', { p_id: entry.id, p_updated_at: entry.updated_at })
    setSaving(false)
    if (error) {
      fail(error)
      return
    }
    notifyJournalChanged()
    message.success(peer ? t('已删除，两个账户的两笔都删了') : t('已删除'))
    onClose(true)
  }

  const allAccounts = accountOptions(accounts, !editing)
  // 记现金（不是从流水填）：支出、其他收入只能选现金账户
  const cashAccounts = accountOptions(
    accounts.filter((a) => isCashLike(a)),
    !editing,
  )
  const bankSide = kind === 'transfer' && !fromLine && ((acct && !isCashLike(acct)) || (toAcct && !isCashLike(toAcct)))
  const cur = acct?.currency ?? ''
  const usdAmount = kind !== 'transfer' && amount && fxRate ? round2(amount / fxRate) : null
  const rateText =
    kind === 'transfer' && !sameCurrency && amount && toAmount
      ? acct?.currency === 'USD'
        ? `1 USD = ${money(toAmount / amount)} ${toAcct?.currency}`
        : toAcct?.currency === 'USD'
          ? `1 USD = ${money(amount / toAmount)} ${acct?.currency}`
          : `1 ${acct?.currency} = ${(toAmount / amount).toFixed(4)} ${toAcct?.currency}`
      : null

  const title = editing
    ? t('{kind} {no}', { kind: t(KIND_LABEL[kind]), no: entry?.entry_no ?? '' })
    : fromLine
      ? t('填银行流水')
      : t('记一笔现金')

  const footer = (
    <div className="entry-footer">
      {editing && allowed && !rest ? (
        <Popconfirm
          title={
            peer
              ? t('删除这笔互转？两个账户的两笔一起删')
              : linked.out
                ? t('删除这一笔？对上的银行流水回到“待填”')
                : t('删除这一笔？')
          }
          okText={t('删除')}
          okButtonProps={{ danger: true }}
          onConfirm={() => void remove()}
        >
          <Button danger icon={<DeleteOutlined />} loading={saving} disabled={!!conflict}>
            {t('删除')}
          </Button>
        </Popconfirm>
      ) : (
        <span>{count > 0 && <span className="hint">{t('这次已记 {n} 笔', { n: count })}</span>}</span>
      )}
      <Space wrap>
        <Button onClick={() => onClose(changed)}>{readOnly ? t('关闭') : t('取消')}</Button>
        {!editing && !fromLine && allowed && (
          <Button onClick={() => void save(true)} loading={saving} disabled={!!conflict}>
            {t('保存并记下一笔')}
          </Button>
        )}
        {allowed && (
          <Button type="primary" onClick={() => void save(false)} loading={saving} disabled={!!conflict}>
            {carRows.length ? t('下一步：录成到账（选大架号）') : t('保存')}
          </Button>
        )}
      </Space>
    </div>
  )

  return (
    <Modal open={open} title={title} onCancel={() => onClose(changed)} footer={footer} width={760} destroyOnHidden className="cash-entry-editor">
      {conflict && (
        <Alert
          type="warning"
          showIcon
          className="entry-tip"
          title={conflict.msg}
          action={
            conflict.kind === 'stale' ? (
              <Button size="small" type="primary" onClick={() => setReloadKey((k) => k + 1)}>
                {t('重新打开')}
              </Button>
            ) : (
              <Button size="small" onClick={() => onClose(true)}>
                {t('关闭')}
              </Button>
            )
          }
        />
      )}
      {dutyLocked && (
        <Alert
          type="info"
          showIcon
          className="entry-tip"
          title={
            outDir === 'in' || (!linked.out && linked.in)
              ? t('这一笔对上的是收进来的银行流水，按分工归填收款的人管，你只能看。')
              : t('这一笔对上的是付出去的银行流水，按分工归填付款的人管，你只能看。')
          }
        />
      )}
      {!editing && (
        <Segmented<EntryKind>
          block
          className="entry-kind"
          value={kind}
          onChange={(k) => {
            // 从流水填的，换成互转时流水那一边不动：付出去的是转出，收进来的是转入
            if (fromLine && prefill) {
              const acc = prefill.account_id ?? prefill.to_account_id
              const amt = prefill.amount ?? prefill.to_amount
              if (k === 'transfer' && lineCredit) form.setFieldsValue({ account_id: undefined, amount: undefined, to_account_id: acc, to_amount: amt })
              else form.setFieldsValue({ account_id: acc, amount: amt, to_account_id: undefined, to_amount: undefined })
            }
            setKind(k)
            form.setFieldValue('module', undefined)
            setSummaryTouched(false)
            // 分几种业务：互转不能分；收、付之间换了，业务模块不一样，重新分
            setParts(null)
          }}
          options={(fromLine ? (withReceipt ? ['in'] : lineCredit ? ['in', 'transfer'] : ['out', 'transfer']) : (['out', 'in', 'transfer'] as EntryKind[])).map((k) => ({
            value: k as EntryKind,
            label: t(KIND_LABEL[k as EntryKind]),
          }))}
        />
      )}
      {withReceipt && prefill && (
        <Alert
          type="success"
          showIcon
          className="entry-tip"
          title={t('这条银行流水 {cur} {line} 已经配上了到账 {no}（{cur} {rcpt}），这里填剩下的 {cur} {rest}。', {
            cur: acct?.currency ?? '',
            line: money(prefill.line_amount),
            no: prefill.receipt_no ?? '',
            rcpt: money(prefill.receipt_amount),
            rest: money(prefill.amount),
          })}
          description={t('剩下的钱填成收入（代收代付、其他收入这些），可以再分几种业务；日期、账户、金额照银行的。')}
        />
      )}
      {fromLine && prefill && !withReceipt && (
        <Alert
          type="success"
          showIcon
          className="entry-tip"
          title={
            <span>
              {t('银行流水')}：<span className="num">{prefill.entry_date}</span> · {prefill.bank_summary || '—'} ·{' '}
              <b className="num">
                {lineCredit ? '' : '−'}
                {money(prefill.amount ?? prefill.to_amount)}
              </b>
            </span>
          }
          description={t('日期、账户、金额照银行的，不能改；填好业务模块和摘要，保存后这条流水就填好了。')}
        />
      )}
      {editing && rest && (
        <Alert
          type="info"
          showIcon
          className="entry-tip"
          title={t('这一笔和到账 {no} 一起填的同一条银行流水：流水 {cur} {line} = 到账 {rcpt} + 这一笔 {amt}。', {
            no: rest.receipt_no,
            cur: acct?.currency ?? '',
            line: money(rest.line_amount),
            rcpt: money(rest.receipt_amount),
            amt: money(amount),
          })}
          description={t('业务模块、分几种业务、摘要可以改，金额不能改。要重新分，请到「银行对账 → 全部流水明细」取消那笔到账的配对（这一笔会一起删掉），再重新填。')}
          action={
            onReceipt ? (
              <Button size="small" onClick={() => onReceipt({ id: rest.receipt_id })}>
                {t('打开到账')}
              </Button>
            ) : undefined
          }
        />
      )}
      {editing && !rest && (linked.out || linked.in) && (
        <Alert
          type="success"
          showIcon
          className="entry-tip"
          title={t('已经和银行流水对上：日期、账户、金额照银行的，不能改；要改请删掉这一笔（流水回到“待填”）再重新填。')}
        />
      )}
      {!fromLine && !editing && kind !== 'transfer' && (
        <Alert
          type="info"
          showIcon
          className="entry-tip"
          title={
            kind === 'in'
              ? t('这里记现金的其他收入（维修、配件零售等）。客户的车款请在「到账录入」里录；银行账户的收付在「银行对账」里从流水填。')
              : t('这里记现金账户的支出。银行账户的付款在「银行对账」里从流水填，不在这里手工记，免得和流水重复。')
          }
        />
      )}
      {kind === 'in' && fromLine && !withReceipt && (
        <Alert
          type="info"
          showIcon
          className="entry-tip"
          title={
            canReceipt
              ? t('客户的车款请点「录成到账」，这里记利息、退款、理赔这些其他收入。一条流水里既有车款、又有别的钱的，点下面「分几种业务」，车款那几行选「设备回款」，下一步录成到账选大架号。')
              : t('客户的车款请点「录成到账」，这里记利息、退款、理赔这些其他收入。')
          }
        />
      )}
      <Form form={form} layout="vertical" disabled={readOnly} requiredMark={false}>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="entry_date" label={t('日期')} rules={[{ required: true, message: t('请选日期') }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} disabled={readOnly || lockDate} />
            </Form.Item>
          </Col>
          {kind !== 'transfer' && (
            <>
              <Col xs={24} sm={16}>
                <Form.Item
                  name="account_id"
                  label={kind === 'out' ? t('付款账户') : t('收款账户')}
                  rules={[{ required: true, message: t('请选账户') }]}
                >
                  <Select
                    showSearch={{ optionFilterProp: 'label' }}
                    options={fromLine || editing ? allAccounts : cashAccounts}
                    placeholder={t('现金账户')}
                    disabled={readOnly || fromLine || linked.out}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="amount"
                  label={t('金额')}
                  rules={[{ required: true, message: parts ? t('几种业务的金额加起来就是这一笔') : t('请填金额') }]}
                  extra={parts && !lockAmount ? t('几种业务加起来') : undefined}
                >
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={cur} disabled={readOnly || lockAmount || !!parts} />
                </Form.Item>
              </Col>
              {!parts && (
                <Col xs={24} sm={8}>
                  <Form.Item name="module" label={t('业务模块')} rules={[{ required: true, message: t('请选业务模块') }]}>
                    <Select
                      showSearch={{ optionFilterProp: 'label' }}
                      virtual={false}
                      options={moduleOptions(kind).map((m) => ({ value: m, label: t(m) }))}
                      labelRender={(o) => <Tag color={moduleColor(String(o.value))}>{o.label}</Tag>}
                    />
                  </Form.Item>
                </Col>
              )}
              <Col xs={24} sm={8}>
                <Form.Item
                  name="fx_rate"
                  label={t('汇率')}
                  tooltip={t('按日期自动带基础资料里的汇率，可以改；用来折美元，不填就只记原币')}
                  extra={usdAmount !== null ? <span className="num">≈ {usd(usdAmount)}</span> : null}
                >
                  <InputNumber style={{ width: '100%' }} min={0.0001} precision={4} disabled={readOnly || cur === 'USD'} />
                </Form.Item>
              </Col>
              {!parts && (
                <Col xs={24} sm={12}>
                  <Form.Item name="counterparty" label={kind === 'out' ? t('收款方 / 供应商') : t('付款方 / 客户')}>
                    <AutoComplete options={counterpartyOptions} filterOption={(q, o) => String(o?.value ?? '').toLowerCase().includes(q.toLowerCase())} />
                  </Form.Item>
                </Col>
              )}
              <Col xs={24} sm={12}>
                <Form.Item name="bank_ref" label={t('银行参考号 / 支票号')}>
                  <Input maxLength={80} />
                </Form.Item>
              </Col>
            </>
          )}
          {kind === 'transfer' && (
            <>
              <Col xs={24} sm={8}>
                <Form.Item label={t('业务模块')}>
                  <div className="auto-module-box">
                    <Tag color="purple" className="auto-module">
                      {t(module || autoModule)}
                    </Tag>
                    <span className="hint">{t('按两边的账户自动定')}</span>
                  </div>
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="bank_ref" label={t('银行参考号')}>
                  <Input maxLength={80} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
        {kind !== 'transfer' &&
          (parts ? (
            <div className="parts-wrap">
              <div className="parts-title">
                <Typography.Text strong>{t('这一笔分几种业务')}</Typography.Text>
                <span className="hint">
                  {lockAmount ? t('加起来要等于 {cur} {amt}（流水还是一条）', { cur, amt: money(amount) }) : t('金额就是几种加起来')}
                </span>
                {!readOnly && (
                  <Button size="small" type="link" onClick={stopParts}>
                    {t('不分了')}
                  </Button>
                )}
              </div>
              <PartsEditor
                rows={parts}
                onChange={setParts}
                modules={partModules}
                total={lockAmount ? Number(amount ?? 0) : null}
                currency={cur}
                readOnly={readOnly}
                counterparties={allCounterparties}
              />
              {carRows.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  className="parts-car-tip"
                  title={t('设备回款 {cur} {amt} 要选大架号：点「下一步：录成到账」，在到账里拆到车；别的几种跟着到账一起保存。', {
                    cur,
                    amt: money(partsTotal(carRows)),
                  })}
                />
              )}
            </div>
          ) : (
            !readOnly && (
              <Button type="link" size="small" icon={<PlusOutlined />} className="parts-toggle" onClick={startParts}>
                {t('分几种业务')}
              </Button>
            )
          ))}
        {kind === 'transfer' && (
          <div className="transfer-box">
            <Row gutter={12}>
              <Col xs={24} sm={11}>
                <Form.Item name="account_id" label={t('从哪个账户转出')} rules={[{ required: true, message: t('请选转出账户') }]}>
                  <Select showSearch={{ optionFilterProp: 'label' }} options={allAccounts} disabled={readOnly || lockFrom} />
                </Form.Item>
                <Form.Item name="amount" label={t('转出金额')} rules={[{ required: true, message: t('请填金额') }]}>
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={acct?.currency} disabled={readOnly || lockFrom || (lockTo && sameCurrency)} />
                </Form.Item>
                <Form.Item name="fee" label={t('手续费（转出账户付）')} tooltip={t('银行转账另扣的手续费；填了就在转出账户另记一笔“手续费”支出')}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} suffix={acct?.currency} />
                </Form.Item>
              </Col>
              <Col xs={0} sm={2} className="transfer-arrow">
                <SwapRightOutlined />
              </Col>
              <Col xs={24} sm={11}>
                <Form.Item
                  name="to_account_id"
                  label={t('转进哪个账户')}
                  dependencies={['account_id']}
                  rules={[
                    { required: true, message: t('请选转入账户') },
                    ({ getFieldValue }) => ({
                      validator: (_, v) => (v && v === getFieldValue('account_id') ? Promise.reject(new Error(t('转出、转入不能是同一个账户'))) : Promise.resolve()),
                    }),
                    // 手工记的互转（现金日记账里记）：至少一边是现金账户；银行账户之间的在银行对账里从流水填
                    ({ getFieldValue }) => ({
                      validator: (_, v) =>
                        !fromLine && !editing && v && !isCashLike(accountById.get(v)) && !isCashLike(accountById.get(getFieldValue('account_id')))
                          ? Promise.reject(new Error(t('这里记的互转至少一边是现金账户；银行账户之间的转账在「银行对账」里从流水填')))
                          : Promise.resolve(),
                    }),
                  ]}
                >
                  <Select showSearch={{ optionFilterProp: 'label' }} options={allAccounts} disabled={readOnly || lockTo} />
                </Form.Item>
                <Form.Item
                  name="to_amount"
                  label={t('转入金额')}
                  rules={[{ required: true, message: t('请填金额') }]}
                  extra={rateText ? <span className="num">{t('兑换汇率 {rate}', { rate: rateText })}</span> : sameCurrency && acct && toAcct ? t('币种一样，跟转出金额一样') : null}
                >
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={toAcct?.currency} disabled={readOnly || lockTo || sameCurrency} />
                </Form.Item>
              </Col>
            </Row>
            {bankSide && <div className="hint transfer-note">{t('银行那一边先记着“等流水”，银行流水导进来按同账户、同金额、3 天内自动对上，对上之前不算进银行余额。')}</div>}
          </div>
        )}
        <Form.Item name="summary" label={t('摘要')} rules={[{ required: true, whitespace: true, message: t('请写摘要') }]}>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={500}
            onChange={() => setSummaryTouched(true)}
            placeholder={
              kind === 'out'
                ? t('例：付2台龙工挖机完税税款 BOE：40326179267')
                : kind === 'in'
                  ? t('例：收 10 月存款利息')
                  : t('例：资金拨付【8651户转4418户】')
            }
          />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item label={t('凭证')}>
              <Vouchers value={attachments} onChange={setAttachments} readOnly={readOnly} paste={open} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="note" label={t('备注')}>
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={300} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {kind === 'transfer' && acct && toAcct && amount ? (
        <Typography.Paragraph className="transfer-preview">
          {t('保存后记两笔：')}
          <span className="num">
            {acct.short_name} {t('支出')} {acct.currency} {money(amount)}
          </span>
          {' ； '}
          <span className="num">
            {toAcct.short_name} {t('收入')} {toAcct.currency} {money(toAmount ?? amount)}
          </span>
          {fee ? (
            <>
              {' ； '}
              <span className="num">
                {acct.short_name} {t('手续费')} {acct.currency} {money(fee)}
              </span>
            </>
          ) : null}
          {isCashLike(acct) !== isCashLike(toAcct) && (
            <span className="hint">
              {' '}
              （{isCashLike(acct) ? t('现金存进银行') : t('从银行取现金')}）
            </span>
          )}
        </Typography.Paragraph>
      ) : null}
      {editing && entry && <div className="hint entry-meta">{t('录入时间 {at}', { at: dayjs(entry.created_at).format('YYYY-MM-DD HH:mm') })}</div>}
      {editing && logs.length > 0 && (
        <Collapse
          ghost
          size="small"
          className="entry-log"
          items={[{ key: 'log', label: t('修改记录（{n}）', { n: logs.length }), children: <JournalLogList rows={logs} /> }]}
        />
      )}
    </Modal>
  )
}
