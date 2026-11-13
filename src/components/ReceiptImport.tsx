import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Col, Drawer, InputNumber, Progress, Row, Segmented, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { Json } from '../lib/database.types'
import { errorText } from '../lib/errors'
import { parseFlow, useFlow } from '../lib/flow'
import { money, num, usd } from '../lib/format'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { accountOptions, useRefData } from '../lib/refdata'
import { findReceiptHeaderRow, groupReceipts, guessReceiptMapping, R_FIELDS, R_TEMPLATE, receiptPayload, resolveReceipts, rowRange } from '../lib/receiptImport'
import type { ExistingReceipt, Issue, PReceipt, Rate, RField, RMapping, Status, VehicleLite } from '../lib/receiptImport'
import { matchAccount } from '../lib/statement'
import { notifySubmissionsChanged } from '../lib/submissions'
import { fetchAll, supabase } from '../lib/supabase'

// 批量导入到账：选 Excel → 对列 → 收款账户对照 → 预览（勾要导的）→ 一笔一笔调 save_receipt，和点“新建到账”存的一样：
// 按现在的审批流开始审批、自动和银行流水配对、对上支票。系统里已经有的（同账户、同日期、同金额）默认不勾，重复导不会多。
// 管理员可以勾“导入后直接生效”：存好后以管理员身份把每一级批完（审批记录里照样一级一级记着是谁批的）。

type Filter = 'all' | 'new' | 'exists' | 'error'
type Outcome = { key: number; rows: number[]; id?: number; error?: string; approveError?: string }
type Summary = {
  imported: number
  approved: number
  pending: number
  matched: number
  unclaimed: number
  partly: number
  failed: Outcome[]
  approveFailed: Outcome[]
}

const LABEL = new Map(R_FIELDS.map((f) => [f.key, f.label]))
const VEHICLE_COLS = 'id, vin, customer_id, customer_name, salesperson_id, salesperson_name, payment_method, received_usd, down_payment_usd, balance_usd, model'
const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
const addDays = (d: string, k: number) => new Date(Date.parse(d) + k * 86400000).toISOString().slice(0, 10)
const acctKey = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()

export default function ReceiptImport({ open, onClose }: { open: boolean; onClose: (changed: boolean, range?: [string, string]) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const { isAdmin } = useAuth()
  const { accounts, accountById, customers, salespersons, natures } = useRefData()
  const rflow = useFlow('receipt')
  const [fileName, setFileName] = useState('')
  const [book, setBook] = useState<XLSX.WorkBook | null>(null)
  const [sheet, setSheet] = useState('')
  const [sheetRows, setSheetRows] = useState<unknown[][]>([])
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<RMapping>({})
  // 收款账户对照：文件里的写法（大写）→ 系统账户；没有账户列时整个文件记到 oneAccount
  const [acctPick, setAcctPick] = useState<Record<string, number | undefined>>({})
  const [oneAccount, setOneAccount] = useState<number | undefined>()
  const [vehicles, setVehicles] = useState<Map<string, VehicleLite> | null>(null)
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [existing, setExisting] = useState<ExistingReceipt[] | null>([])
  const [refreshKey, setRefreshKey] = useState(0)
  // 这次导进去的：哪一笔（key）存成了哪张到账（id），导完查重时先认回自己那张
  const [created, setCreated] = useState<Map<number, number>>(new Map())
  // 勾选：用户点过的记在这里，没点过的按默认（能导入的勾上，系统里已有、可能是合计行的不勾）
  const [pick, setPick] = useState<Record<number, boolean>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [direct, setDirect] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const changed = useRef(false)
  const imported = useRef<string[]>([])

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts])

  const close = () => {
    if (importing) return
    const c = changed.current
    const dates = [...imported.current].sort()
    changed.current = false
    imported.current = []
    setFileName('')
    setBook(null)
    setSheet('')
    setSheetRows([])
    setMapping({})
    setAcctPick({})
    setOneAccount(undefined)
    setPick({})
    setCreated(new Map())
    setFilter('all')
    setDirect(false)
    setSummary(null)
    setProgress(null)
    onClose(c, dates.length ? [dates[0], dates[dates.length - 1]] : undefined)
  }

  // ---------- 车、汇率：打开时读一次（对大架号、补汇率用） ----------
  useEffect(() => {
    if (!open) return
    let stop = false
    setVehicles(null)
    setRates(null)
    void (async () => {
      const [v, r] = await Promise.all([
        fetchAll<VehicleLite>(() => supabase.from('v_vehicle_ledger').select(VEHICLE_COLS).order('id')),
        fetchAll<Rate>(() => supabase.from('fx_rates').select('currency, rate_date, rate').order('rate_date').order('currency')),
      ])
      if (stop) return
      if (v.error || r.error) message.error(errorText(v.error ?? r.error))
      setVehicles(new Map(v.data.filter((x) => x.vin).map((x) => [String(x.vin).toUpperCase(), x])))
      setRates(r.data.map((x) => ({ ...x, rate: Number(x.rate) })))
    })()
    return () => {
      stop = true
    }
  }, [open, message])

  // ---------- 读文件 ----------
  const sheetToRows = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' })
  const applyHeaderRow = (rows: unknown[][], hr: number) => {
    setHeaderRow(hr)
    setMapping(guessReceiptMapping((rows[hr - 1] ?? []).map((c) => String(c ?? ''))))
  }
  const loadSheet = (wb: XLSX.WorkBook, name: string) => {
    const rows = sheetToRows(wb, name)
    setSheet(name)
    setSheetRows(rows)
    setAcctPick({})
    setPick({})
    setCreated(new Map())
    setSummary(null)
    setProgress(null)
    applyHeaderRow(rows, findReceiptHeaderRow(rows) || 1)
  }
  const readFile = async (file: File) => {
    let wb: XLSX.WorkBook
    try {
      // raw：CSV 里的 08/11/2026 原样留着，按“日在前”认；Excel 里的日期是数字，另外换算
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false })
    } catch {
      message.error(t('读不了这个文件。有密码的 Excel 请先另存一份没有密码的'))
      return
    }
    setBook(wb)
    setFileName(file.name)
    loadSheet(wb, wb.SheetNames.find((n) => findReceiptHeaderRow(sheetToRows(wb, n)) > 0) ?? wb.SheetNames[0])
  }

  const downloadTemplate = () => {
    const head = R_TEMPLATE.map((k) => t(LABEL.get(k) ?? k))
    const ws = XLSX.utils.aoa_to_sheet([head])
    const widths: Partial<Record<RField, number>> = { date: 12, account: 26, payer: 22, note: 18, vin: 22, customer: 24, nature: 12, model: 20 }
    ws['!cols'] = R_TEMPLATE.map((k) => ({ wch: widths[k] ?? 11 }))
    // 说明和示例放第二张表（导入时只读第一张认得出表头的）
    const row = (v: Partial<Record<RField, string | number>>) => R_TEMPLATE.map((k) => v[k] ?? '')
    const help = XLSX.utils.aoa_to_sheet([
      [t('一行一笔到账。必填：到账日期、收款账户、金额；其余可以空着。')],
      [t('收款账户写系统里的名字（如 FET AUTO ECO GHS-8651），写币种加账号后四位（GHS 8651）也认得，导入时还能逐个对。')],
      [t('汇率 = 1 美元换多少 GHS，USD 账户不用填。没填汇率就按 金额 ÷ USD金额 算，都没填就用基础资料里的汇率。')],
      [t('一笔钱拆给几台车：第一行写到账，下面几行只填 大架号、客户、款项性质、拆分金额（日期、账户、金额空着），或者这几行填一样的到账序号。')],
      [t('拆分金额是到账币种的金额。只有一台车可以不填；几台车都没填，按各台余额或平均分，导完可以改。')],
      [t('大架号系统里没有的，先记在客户名下（大架号未锁定），车录进来以后再点开这笔到账选车。')],
      [t('系统里已经有的到账（同账户、同日期、同金额）默认不导，同一个文件导两次不会重复。')],
      [],
      [t('示例（导入时不读这张表）：')],
      head,
      row({ date: '2026-11-05', account: 'FET AUTO ECO GHS-8651', amount: 230000, fx_rate: 12, payer: 'ABC MOTORS LTD', vin: 'LZZEXAMPLE0000001', customer: 'ABC MOTORS LTD', nature: t('全款') }),
      row({ date: '2026-11-06', account: 'FET AUTO GCB GHS-7773', amount: 500000, fx_rate: 12.2, payer: 'XYZ BUILDING LTD', cheque_no: '000309', vin: 'LZZEXAMPLE0000002', customer: 'XYZ BUILDING LTD', nature: t('分期款'), claim_amount: 300000 }),
      row({ vin: 'LZZEXAMPLE0000003', customer: 'XYZ BUILDING LTD', nature: t('分期款'), claim_amount: 200000 }),
      row({ date: '2026-11-07', account: 'FET AUTO ACCESS USD-2967', amount: 20000, payer: 'GOLDEN SAND LTD', bank_ref: 'FT2631100123', customer: 'GOLDEN SAND LTD', nature: t('预付款'), salesperson: 'BOSS', model: t('1台装载机') }),
      row({ date: '2026-11-07', account: 'momo', amount: 12000, usd: 1000, vin: 'LZZEXAMPLE0000001', nature: t('全款尾款') }),
    ])
    help['!cols'] = R_TEMPLATE.map((k) => ({ wch: widths[k] ?? 11 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, t('到账'))
    XLSX.utils.book_append_sheet(wb, help, t('说明'))
    XLSX.writeFile(wb, `${t('批量导入到账模板')}.xlsx`)
  }

  // ---------- 整理成一笔笔到账 ----------
  const headers = useMemo(() => (sheetRows[headerRow - 1] ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()), [sheetRows, headerRow])
  const grouped = useMemo(() => (sheetRows.length ? groupReceipts(sheetRows, headerRow, mapping) : { drafts: [], ignored: [] }), [sheetRows, headerRow, mapping])
  const hasAccountCol = mapping.account !== undefined

  // 文件里出现的账户写法，和自动对上的系统账户
  const acctGroups = useMemo(() => {
    if (!hasAccountCol) return []
    const m = new Map<string, { key: string; text: string; count: number; auto?: number }>()
    for (const d of grouped.drafts) {
      const k = acctKey(d.account)
      if (!k) continue
      const g = m.get(k) ?? { key: k, text: d.account, count: 0, auto: matchAccount(d.account, activeAccounts) }
      g.count++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [grouped, hasAccountCol, activeAccounts])
  const autoAcct = useMemo(() => new Map(acctGroups.map((g) => [g.key, g.auto])), [acctGroups])
  const accountFor = useMemo(
    () => (text: string) => {
      if (!hasAccountCol) return oneAccount
      const k = acctKey(text)
      if (!k) return undefined
      return k in acctPick ? acctPick[k] : autoAcct.get(k)
    },
    [hasAccountCol, oneAccount, acctPick, autoAcct],
  )

  // ---------- 查系统里已有的到账（查重） ----------
  const dedupKey = useMemo(() => {
    const ids = new Set<number>()
    let lo = ''
    let hi = ''
    const refs = new Set<string>()
    for (const d of grouped.drafts) {
      const id = accountFor(d.account)
      if (id) ids.add(id)
      if (d.date) {
        if (!lo || d.date < lo) lo = d.date
        if (!hi || d.date > hi) hi = d.date
      }
      if (d.bank_ref) refs.add(d.bank_ref)
    }
    return ids.size && lo ? JSON.stringify({ ids: [...ids].sort((a, b) => a - b), lo, hi, refs: [...refs].sort() }) : ''
  }, [grouped, accountFor])

  useEffect(() => {
    let stop = false
    if (!dedupKey) {
      setExisting([])
      return
    }
    setExisting(null)
    const { ids, lo, hi, refs } = JSON.parse(dedupKey) as { ids: number[]; lo: string; hi: string; refs: string[] }
    const cols = 'id, receipt_no, account_id, receipt_date, amount_orig, bank_ref'
    type Row = { id: number | null; receipt_no: string | null; account_id: number | null; receipt_date: string | null; amount_orig: number | null; bank_ref: string | null }
    void (async () => {
      // 前后多看 3 天：日期差几天的也提醒一下
      const a = await fetchAll<Row>(() =>
        supabase.from('v_bank_receipts').select(cols).in('account_id', ids).gte('receipt_date', addDays(lo, -3)).lte('receipt_date', addDays(hi, 3)).order('id'),
      )
      const found: Row[] = [...a.data]
      let err = a.error
      for (let i = 0; i < refs.length && !err; i += 100) {
        const b = await supabase.from('v_bank_receipts').select(cols).in('account_id', ids).in('bank_ref', refs.slice(i, i + 100))
        err = b.error
        for (const x of b.data ?? []) if (!found.some((y) => y.id === x.id)) found.push(x)
      }
      if (stop) return
      if (err) message.error(errorText(err))
      setExisting(
        found.flatMap((x) =>
          x.id && x.account_id && x.receipt_date
            ? [{ id: x.id, receipt_no: x.receipt_no ?? '', account_id: x.account_id, receipt_date: x.receipt_date, amount_orig: Number(x.amount_orig), bank_ref: x.bank_ref }]
            : [],
        ),
      )
    })()
    return () => {
      stop = true
    }
  }, [dedupKey, refreshKey, message])

  // ---------- 每笔的情况 ----------
  const ready = vehicles !== null && rates !== null && existing !== null
  const receipts: PReceipt[] = useMemo(
    () =>
      ready
        ? resolveReceipts(grouped.drafts, {
            accountFor,
            accountById,
            customers,
            salespersons,
            natures,
            vehicles: vehicles!,
            rates: rates!,
            existing: existing!,
            pinned: created,
          })
        : [],
    [ready, grouped, accountFor, accountById, customers, salespersons, natures, vehicles, rates, existing, created],
  )
  const isPicked = (p: PReceipt) => p.status !== 'error' && (pick[p.key] ?? (p.status === 'new' && !p.suspect))
  const selected = receipts.filter(isPicked)
  const count = (s: Status) => receipts.filter((p) => p.status === s).length
  const selUsd = selected.reduce((s, p) => s + num(p.amount_usd), 0)
  const selClaims = selected.flatMap((p) => p.claims.filter((c) => !c.dropped))
  const missingRequired = R_FIELDS.filter((f) => f.required && mapping[f.key] === undefined && !(f.key === 'account' && oneAccount))
  const hasLevels = rflow.active.length > 0

  // ---------- 导入 ----------
  /** 管理员把这笔到账的审批一级一级批完（和在到账页上一级一级点“通过”一样） */
  const approveAll = async (id: number): Promise<string | null> => {
    const { data, error } = await supabase.from('v_bank_receipts').select('status, step, flow').eq('id', id).maybeSingle()
    if (error) return errorText(error)
    if (!data || data.status !== 'pending') return null
    const flow = parseFlow(data.flow)
    for (let i = flow.findIndex((f) => f.step === data.step); i >= 0 && i < flow.length; i++) {
      const r = await supabase.rpc('receipt_action', { p_id: id, p_action: `approve_${flow[i].step}` })
      if (r.error) return errorText(r.error)
    }
    return null
  }

  const doImport = async () => {
    const list = selected
    if (!list.length) return message.warning(t('没有勾选要导入的到账'))
    setImporting(true)
    setSummary(null)
    setProgress({ done: 0, total: list.length })
    const outcomes: Outcome[] = []
    for (const [i, p] of list.entries()) {
      const { p_receipt, p_claims } = receiptPayload(p)
      const { data, error } = await supabase.rpc('save_receipt', { p_receipt: p_receipt as unknown as Json, p_claims: p_claims as unknown as Json })
      if (error || !data) outcomes.push({ key: p.key, rows: p.rows, error: errorText(error) })
      else {
        changed.current = true
        if (p.date) imported.current.push(p.date)
        const o: Outcome = { key: p.key, rows: p.rows, id: Number(data) }
        if (direct && isAdmin && hasLevels) {
          const e = await approveAll(o.id!)
          if (e) o.approveError = e
        }
        outcomes.push(o)
      }
      setProgress({ done: i + 1, total: list.length })
    }
    // 导完看一眼：生效了几笔、和银行流水配上了几笔、拆分得怎样
    const ids = outcomes.filter((o) => o.id).map((o) => o.id!)
    const after: { status: string | null; bank_status: string | null; claim_status: string | null }[] = []
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await supabase.from('v_bank_receipts').select('status, bank_status, claim_status').in('id', ids.slice(i, i + 150))
      after.push(...(data ?? []))
    }
    setSummary({
      imported: ids.length,
      approved: after.filter((r) => r.status === 'approved').length,
      pending: after.filter((r) => r.status === 'pending').length,
      matched: after.filter((r) => r.bank_status === '已核对').length,
      unclaimed: after.filter((r) => r.claim_status === '未认领').length,
      partly: after.filter((r) => r.claim_status === '部分认领').length,
      failed: outcomes.filter((o) => o.error),
      approveFailed: outcomes.filter((o) => o.approveError),
    })
    setImporting(false)
    setCreated((old) => new Map([...old, ...outcomes.flatMap((o): [number, number][] => (o.id ? [[o.key, o.id]] : []))]))
    // 导过的这几笔回到默认勾法（导进去的变成“系统里已有”不勾，没导进去的还勾着）；没导的那些照用户原来勾的
    setPick((old) => {
      const next = { ...old }
      for (const p of list) delete next[p.key]
      return next
    })
    setRefreshKey((k) => k + 1)
    if (ids.length) notifySubmissionsChanged()
  }

  // ---------- 表格 ----------
  const issueText = (i: Issue) => t(i.key, Object.fromEntries(Object.entries(i.vars ?? {}).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v])))
  const STATUS: Record<Status, [string, string]> = {
    new: ['green', t('可以导入')],
    exists: ['default', t('系统里已有')],
    error: ['red', t('有问题，不能导入')],
  }
  const RATE_FROM: Record<string, string> = { usd: t('按 USD 算'), table: t('基础资料') }
  const columns: ColumnsType<PReceipt> = [
    { title: t('行'), width: 56, fixed: 'left', render: (_, p) => rowRange(p.rows) },
    {
      title: t('状态'),
      width: 230,
      render: (_, p) => (
        <div className="ri-status">
          <Tag color={STATUS[p.status][0]}>{STATUS[p.status][1]}</Tag>
          {p.existing && <span className="hint">{p.existing.receipt_no}</span>}
          {p.errors.map((e, i) => (
            <div key={`e${i}`} className="text-danger">
              {issueText(e)}
            </div>
          ))}
          {p.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-warn">
              {issueText(w)}
            </div>
          ))}
          {p.infos.map((w, i) => (
            <div key={`i${i}`} className="hint">
              {issueText(w)}
            </div>
          ))}
        </div>
      ),
    },
    { title: t('到账日期'), dataIndex: 'date', width: 96 },
    {
      title: t('收款账户'),
      width: 170,
      render: (_, p) =>
        p.account_id ? (
          <span>
            {accountById.get(p.account_id)?.short_name}
            {p.account_text && acctKey(p.account_text) !== acctKey(accountById.get(p.account_id)?.short_name ?? '') && <div className="hint">{p.account_text}</div>}
          </span>
        ) : (
          <span className="text-danger">{p.account_text || t('（空）')}</span>
        ),
    },
    {
      title: t('金额'),
      width: 130,
      align: 'right',
      render: (_, p) => (p.amount === null ? '' : <span className="num">{`${p.currency} ${money(p.amount)}`}</span>),
    },
    {
      title: t('汇率'),
      width: 72,
      align: 'right',
      render: (_, p) =>
        p.fx_rate === null || p.currency === 'USD' ? (
          ''
        ) : (
          <span>
            {p.fx_rate}
            {p.rate_from && RATE_FROM[p.rate_from] && <div className="hint">{RATE_FROM[p.rate_from]}</div>}
          </span>
        ),
    },
    { title: 'USD', width: 90, align: 'right', render: (_, p) => <span className="num">{usd(p.amount_usd)}</span> },
    {
      title: t('拆分到车'),
      width: 330,
      render: (_, p) =>
        p.claims.length === 0 ? (
          <span className="hint">{t('没拆分（导进去是未认领，之后点开拆）')}</span>
        ) : (
          <div className="ri-claims">
            {p.claims.map((c, i) => (
              <div key={i} className={c.dropped ? 'ri-claim ri-dropped' : 'ri-claim'}>
                <div className="ri-claim-top">
                  <span>
                    {c.vehicle ? <span className="cv-vin">{c.vehicle.vin}</span> : <Tag color="orange">{t('大架号未锁定')}</Tag>}
                    {c.dropped && <Tag style={{ marginLeft: 6 }}>{t('不导')}</Tag>}
                  </span>
                  {c.amount !== null && <span className="num ri-amt">{money(c.amount)}</span>}
                </div>
                <div>
                  {c.customer_name || c.vin}
                  <span className="hint"> · {t(c.nature)}</span>
                </div>
              </div>
            ))}
          </div>
        ),
    },
    {
      title: t('付款方 / 摘要'),
      width: 170,
      render: (_, p) => (
        <div>
          {p.payer}
          {p.bank_ref && <div className="hint">{t('参考号 {v}', { v: p.bank_ref })}</div>}
          {p.cheque_no && <div className="hint">{t('支票号 {v}', { v: p.cheque_no })}</div>}
          {p.note && <div className="hint">{p.note}</div>}
        </div>
      ),
    },
  ]
  const shown = receipts.filter((p) => filter === 'all' || p.status === filter)
  const colOptions = headers.map((h, i) => ({ value: i, label: `${colName(i)} · ${h || t('（空）')}` }))
  const ignoredText = (reason: string) => (reason === 'total' ? t('合计行') : reason === 'orphan' ? t('只有拆分，前面没有到账') : t('没写金额'))

  const fieldSelect = (f: (typeof R_FIELDS)[number]) => (
    <Col key={f.key} xs={12} md={8} lg={4}>
      <div className="hint">
        {t(f.label)}
        {f.required && !(f.key === 'account' && oneAccount) && <span className="text-danger"> *</span>}
      </div>
      <Select
        allowClear
        style={{ width: '100%' }}
        value={mapping[f.key]}
        status={f.required && mapping[f.key] === undefined && !(f.key === 'account' && oneAccount) ? 'error' : undefined}
        placeholder={t('没有')}
        showSearch={{ optionFilterProp: 'label' }}
        options={colOptions}
        onChange={(v: number | undefined) => {
          setMapping((m) => ({ ...m, [f.key]: v }))
          setPick({})
        }}
      />
    </Col>
  )

  return (
    <Drawer
      open={open}
      className="receipt-import"
      title={t('批量导入到账')}
      size={Math.min(1280, typeof window !== 'undefined' ? window.innerWidth : 1280)}
      onClose={close}
      maskClosable={!importing}
      closable={!importing}
      destroyOnHidden
    >
      <Card size="small" title={t('1. 选文件')} style={{ marginBottom: 12 }} extra={<Button icon={<DownloadOutlined />} onClick={downloadTemplate}>{t('下载模板')}</Button>}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t('一行一笔到账，必填到账日期、收款账户、金额。一笔钱拆给几台车的，下面几行只填拆分那几列（大架号、客户、款项性质、拆分金额）。导进来和点“新建到账”一样：走审批流、自动和银行流水配对。系统里已经有的（同账户、同日期、同金额）默认不导。')}
        </Typography.Paragraph>
        <Upload.Dragger
          accept=".xlsx,.xls,.csv"
          showUploadList={false}
          disabled={importing}
          beforeUpload={(f) => {
            void readFile(f as File)
            return false
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{fileName ? t('已读取：{fileName}（点这里换一个文件）', { fileName }) : t('把到账 Excel 拖到这里，或点击选择')}</p>
        </Upload.Dragger>
      </Card>

      {sheetRows.length > 0 && (
        <Card size="small" title={t('2. 对应列')} style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            {book && book.SheetNames.length > 1 && (
              <Col xs={24} md={8} lg={6}>
                <div className="hint">{t('工作表')}</div>
                <Select style={{ width: '100%' }} value={sheet} onChange={(n: string) => loadSheet(book, n)} options={book.SheetNames.map((n) => ({ value: n, label: n }))} />
              </Col>
            )}
            <Col xs={12} md={8} lg={4}>
              <div className="hint">{t('表头在第几行')}</div>
              <InputNumber
                min={1}
                max={50}
                value={headerRow}
                onChange={(v) => {
                  applyHeaderRow(sheetRows, v ?? 1)
                  setPick({})
                }}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
          <div className="ri-part">{t('到账')}</div>
          <Row gutter={[12, 12]}>{R_FIELDS.filter((f) => f.part === 'receipt').map(fieldSelect)}</Row>
          <div className="ri-part">{t('拆分到车（可以不填，导完再拆）')}</div>
          <Row gutter={[12, 12]}>{R_FIELDS.filter((f) => f.part === 'claim').map(fieldSelect)}</Row>
          {missingRequired.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              title={t('还没对上的必填列：{list}', { list: missingRequired.map((f) => t(f.label)).join(t('、')) })}
            />
          )}
        </Card>
      )}

      {sheetRows.length > 0 && (
        <Card size="small" title={t('3. 收款账户对照')} style={{ marginBottom: 12 }}>
          {hasAccountCol ? (
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={acctGroups}
              scroll={{ y: 320 }}
              columns={[
                { title: t('文件里的写法'), dataIndex: 'text', ellipsis: true },
                { title: t('笔数'), dataIndex: 'count', width: 70, align: 'right' },
                {
                  title: t('系统里的收款账户'),
                  width: 340,
                  render: (_, g) => {
                    const v = g.key in acctPick ? acctPick[g.key] : g.auto
                    return (
                      <Select
                        allowClear
                        size="small"
                        style={{ width: '100%' }}
                        status={v ? undefined : 'error'}
                        placeholder={t('没对上，请选')}
                        showSearch={{ optionFilterProp: 'label' }}
                        options={accountOptions(accounts, true)}
                        value={v}
                        onChange={(x: number | undefined) => {
                          setAcctPick((p) => ({ ...p, [g.key]: x }))
                          setPick({})
                        }}
                      />
                    )
                  },
                },
              ]}
            />
          ) : (
            <Space wrap>
              <span>{t('文件里没有收款账户列，全部记到：')}</span>
              <Select
                allowClear
                style={{ width: 280 }}
                status={oneAccount ? undefined : 'error'}
                placeholder={t('选收款账户')}
                showSearch={{ optionFilterProp: 'label' }}
                options={accountOptions(accounts, true)}
                value={oneAccount}
                onChange={(x: number | undefined) => {
                  setOneAccount(x)
                  setPick({})
                }}
              />
            </Space>
          )}
        </Card>
      )}

      {sheetRows.length > 0 && (
        <Card size="small" title={t('4. 预览和导入')}>
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            {!ready ? (
              <div className="hint">{t('正在查系统里的车、汇率和已有的到账…')}</div>
            ) : (
              <>
                <div>
                  {t('共 {n} 笔到账：可以导入 {a} 笔，系统里已有 {b} 笔，有问题 {c} 笔（不能导入）。', {
                    n: receipts.length,
                    a: count('new'),
                    b: count('exists'),
                    c: count('error'),
                  })}
                </div>
                <div className="hint">
                  {t('勾了 {n} 笔，合计 {usd}；拆分 {k} 行，其中大架号未锁定 {u} 行。', {
                    n: selected.length,
                    usd: usd(selUsd),
                    k: selClaims.length,
                    u: selClaims.filter((c) => !c.vehicle).length,
                  })}
                </div>
                {grouped.ignored.length > 0 && (
                  <div className="hint">
                    {t('这些行没当成到账：{list}', {
                      list: grouped.ignored
                        .slice(0, 12)
                        .map((x) => t('第 {row} 行（{why}）', { row: x.row, why: ignoredText(x.reason) }))
                        .join(t('、')),
                    })}
                    {grouped.ignored.length > 12 && t('…等 {n} 行', { n: grouped.ignored.length })}
                  </div>
                )}
              </>
            )}
            <Space wrap>
              {isAdmin && hasLevels && (
                <Checkbox checked={direct} disabled={importing} onChange={(e) => setDirect(e.target.checked)}>
                  {t('导入后直接生效（我以管理员身份批完每一级）')}
                </Checkbox>
              )}
              <Button type="primary" loading={importing} disabled={!ready || !selected.length || missingRequired.length > 0} onClick={() => void doImport()}>
                {t('导入选中的 {n} 笔', { n: selected.length })}
              </Button>
            </Space>
            {hasLevels ? (
              <div className="hint">
                {direct && isAdmin
                  ? t('导入后每笔都直接生效，审批记录里记着是你批的。')
                  : t('导入后每笔都从第一级“{name}”开始审批，批完才算到账。', { name: rflow.name(rflow.active[0]?.key) })}
              </div>
            ) : (
              <div className="hint">{t('现在到账没有设审批级别，导入后直接生效。')}</div>
            )}
            {progress && importing && <Progress percent={Math.round((progress.done / progress.total) * 100)} />}
            {summary && (
              <Alert
                type={summary.failed.length && !summary.imported ? 'error' : summary.failed.length || summary.approveFailed.length ? 'warning' : 'success'}
                showIcon
                title={t('导入了 {n} 笔：已生效 {a} 笔，审批中 {b} 笔；和银行流水配上 {m} 笔；未认领 {u} 笔，部分认领 {p} 笔。', {
                  n: summary.imported,
                  a: summary.approved,
                  b: summary.pending,
                  m: summary.matched,
                  u: summary.unclaimed,
                  p: summary.partly,
                })}
                description={
                  summary.failed.length || summary.approveFailed.length ? (
                    <div>
                      {summary.failed.length > 0 && <div className="text-danger">{t('有 {n} 笔没导进去，原因如下（改好后可以再导，导过的不会重复）：', { n: summary.failed.length })}</div>}
                      {summary.failed.map((o) => (
                        <div key={`f${o.key}`}>{t('第 {rows} 行没导进去：{err}', { rows: rowRange(o.rows), err: o.error ?? '' })}</div>
                      ))}
                      {summary.approveFailed.map((o) => (
                        <div key={`a${o.key}`}>{t('第 {rows} 行导进去了，但没批完：{err}', { rows: rowRange(o.rows), err: o.approveError ?? '' })}</div>
                      ))}
                    </div>
                  ) : undefined
                }
              />
            )}
            <Segmented
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              options={[
                { value: 'all', label: t('全部 {n}', { n: receipts.length }) },
                { value: 'new', label: t('可以导入 {n}', { n: count('new') }) },
                { value: 'exists', label: t('系统里已有 {n}', { n: count('exists') }) },
                { value: 'error', label: t('有问题 {n}', { n: count('error') }) },
              ]}
            />
            <Table
              rowKey="key"
              size="small"
              dataSource={shown}
              columns={columns}
              scroll={{ x: 1380 }}
              pagination={{ defaultPageSize: 50, showSizeChanger: true }}
              rowSelection={{
                selectedRowKeys: receipts.filter(isPicked).map((p) => p.key),
                getCheckboxProps: (p) => ({ disabled: p.status === 'error' || importing }),
                onChange: (keys) => {
                  const on = new Set(keys.map(Number))
                  setPick((old) => {
                    const next = { ...old }
                    for (const p of shown) if (p.status !== 'error') next[p.key] = on.has(p.key)
                    return next
                  })
                },
              }}
            />
          </Space>
        </Card>
      )}
    </Drawer>
  )
}
