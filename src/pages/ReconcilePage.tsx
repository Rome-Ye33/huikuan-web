import { InboxOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import ReceiptEditor from '../components/ReceiptEditor'
import type { ReceiptPrefill } from '../components/ReceiptEditor'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { money, round2, todayAccra } from '../lib/format'
import { accountOptions, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { ImportFormat, Receipt, StatementLine } from '../lib/supabase'
import type { Json } from '../lib/database.types'

dayjs.extend(customParseFormat)

// ---------------------------------------------------------------------------
// 解析银行导出的 CSV / Excel
// ---------------------------------------------------------------------------

type Mapping = { date?: number; credit?: number; drcr?: number; summary?: number; ref?: number; cheque?: number }
type ParsedLine = { line_date: string; amount_orig: number; payer_summary: string; bank_ref: string; cheque_no: string }

const DATE_FORMATS = ['DD/MM/YYYY', 'D/M/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'DD MMM YYYY', 'DD.MM.YYYY']

function excelSerialToDate(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
}

function parseDate(v: unknown, fmt: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelSerialToDate(v) : null
  const s = String(v).trim().split(/\s+\d{1,2}:\d{2}/)[0] // 去掉时间部分
  for (const f of [fmt, ...DATE_FORMATS]) {
    const d = dayjs(s, f, true)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  return null
}

function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  let s = String(v).trim()
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bDR?\b/i.test(s)
  s = s.replace(/[^0-9.]/g, '')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function guessMapping(headers: string[]): Mapping {
  const find = (re: RegExp) => {
    const i = headers.findIndex((h) => re.test(h))
    return i >= 0 ? i : undefined
  }
  return {
    date: find(/value\s*date|trans.*date|posting.*date|^date|日期/i),
    credit: find(/credit|deposit|贷方|收入|cr\.?\s*amount|money\s*in/i),
    drcr: find(/^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|借贷)$/i),
    summary: find(/narration|description|details|remark|particular|摘要|备注/i),
    ref: find(/reference|ref\.?\s*no|^ref|transaction\s*id|流水号|参考/i),
    cheque: find(/cheque|check\s*no|支票/i),
  }
}

function toLines(rows: unknown[][], headerRow: number, m: Mapping, fmt: string) {
  const out: ParsedLine[] = []
  const bad: number[] = []
  for (let i = headerRow; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === '' || c === null || c === undefined)) continue
    if (m.credit === undefined || m.date === undefined) break
    const amt = parseAmount(r[m.credit])
    if (amt === null || amt <= 0) continue // 借方或空行
    if (m.drcr !== undefined && /^d/i.test(String(r[m.drcr] ?? '').trim())) continue
    const d = parseDate(r[m.date], fmt)
    if (!d) {
      bad.push(i + 1)
      continue
    }
    out.push({
      line_date: d,
      amount_orig: round2(amt),
      payer_summary: m.summary !== undefined ? String(r[m.summary] ?? '').trim() : '',
      bank_ref: m.ref !== undefined ? String(r[m.ref] ?? '').trim() : '',
      cheque_no: m.cheque !== undefined ? String(r[m.cheque] ?? '').trim() : '',
    })
  }
  return { lines: out, bad }
}

// ---------------------------------------------------------------------------

export default function ReconcilePage() {
  const [tab, setTab] = useState('unmatched')
  const [accountId, setAccountId] = useState<number | undefined>()
  const [editor, setEditor] = useState<{ open: boolean; id: number | null; prefill: ReceiptPrefill | null }>({
    open: false,
    id: null,
    prefill: null,
  })
  const [version, setVersion] = useState(0)
  const { accounts } = useRefData()
  const bankAccounts = accounts.filter((a) => a.kind !== 'cash')

  return (
    <div>
      <div className="page-title">
        <h2>银行对账</h2>
        <Select
          allowClear
          placeholder="全部账户"
          style={{ width: 260 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={accountOptions(bankAccounts, false)}
          value={accountId}
          onChange={setAccountId}
        />
      </div>
      <Typography.Paragraph type="secondary">
        每周或每月把银行流水导进来一次。系统按“同账户、同金额、日期相差 3 天内”自动和已录的到账配对，只需要处理下面两种：银行有但没人报的款，和录了但银行查不到的款。
      </Typography.Paragraph>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          {
            key: 'unmatched',
            label: '银行有、没人报',
            children: (
              <UnmatchedLines
                accountId={accountId}
                version={version}
                onCreate={(l) =>
                  setEditor({
                    open: true,
                    id: null,
                    prefill: {
                      account_id: l.account_id ?? undefined,
                      receipt_date: l.line_date ?? undefined,
                      amount_orig: Number(l.amount_orig),
                      payer_summary: l.payer_summary,
                      bank_ref: l.bank_ref,
                      cheque_no: l.cheque_no,
                      line_id: l.id ?? undefined,
                    },
                  })
                }
              />
            ),
          },
          {
            key: 'missing',
            label: '录了、银行查不到',
            children: <MissingReceipts accountId={accountId} version={version} onOpen={(id) => setEditor({ open: true, id, prefill: null })} />,
          },
          {
            key: 'import',
            label: '导入银行流水',
            children: (
              <ImportStatement
                accountId={accountId}
                onAccount={setAccountId}
                onDone={() => {
                  setVersion((x) => x + 1)
                }}
              />
            ),
          },
          {
            key: 'all',
            label: '全部流水明细',
            children: <AllLines accountId={accountId} version={version} onOpen={(id) => setEditor({ open: true, id, prefill: null })} />,
          },
        ]}
      />
      <ReceiptEditor
        open={editor.open}
        receiptId={editor.id}
        prefill={editor.prefill}
        onClose={(changed) => {
          setEditor({ open: false, id: null, prefill: null })
          if (changed) setVersion((x) => x + 1)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 银行有、没人报
// ---------------------------------------------------------------------------
function UnmatchedLines({
  accountId,
  version,
  onCreate,
}: {
  accountId?: number
  version: number
  onCreate: (l: StatementLine) => void
}) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<StatementLine[]>([])
  const [loading, setLoading] = useState(false)
  const [linkFor, setLinkFor] = useState<StatementLine | null>(null)
  const [ignoreFor, setIgnoreFor] = useState<StatementLine | null>(null)
  const [ignoreNote, setIgnoreNote] = useState('')
  const [matching, setMatching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_statement_lines').select('*').eq('match_status', '未配对').order('line_date').order('id').limit(2000)
    if (accountId) q = q.eq('account_id', accountId)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load, version])

  const rematch = async () => {
    setMatching(true)
    const ids = accountId ? [accountId] : [...new Set(rows.map((r) => r.account_id as number))]
    let n = 0
    for (const id of ids) {
      const { data, error } = await supabase.rpc('match_statement_lines', { p_account_id: id })
      if (error) {
        message.error(errorText(error))
        break
      }
      n += data ?? 0
    }
    setMatching(false)
    message.success(n ? `新配对上 ${n} 笔` : '没有新的可配对')
    void load()
  }

  const ignore = async () => {
    if (!ignoreFor) return
    const { error } = await supabase
      .from('bank_statement_lines')
      .update({ ignored: true, note: ignoreNote.trim() || null })
      .eq('id', ignoreFor.id as number)
    if (error) message.error(errorText(error))
    else {
      message.success('已忽略')
      setIgnoreFor(null)
      void load()
    }
  }

  const columns: ColumnsType<StatementLine> = [
    { title: '银行日期', dataIndex: 'line_date', width: 104 },
    { title: '账户', dataIndex: 'account_name', width: 210, ellipsis: true },
    {
      title: '金额',
      width: 150,
      align: 'right',
      render: (_, l) => (
        <span className="num">
          {l.currency} {money(l.amount_orig)}
        </span>
      ),
    },
    { title: '银行摘要', dataIndex: 'payer_summary', ellipsis: true },
    { title: '参考号', dataIndex: 'bank_ref', width: 140, ellipsis: true },
    {
      title: '处理',
      width: 250,
      render: (_, l) => (
        <Space size={4}>
          <Button size="small" type="primary" onClick={() => onCreate(l)}>
            录成到账
          </Button>
          <Button size="small" onClick={() => setLinkFor(l)}>
            关联已录的
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => {
              setIgnoreNote('')
              setIgnoreFor(l)
            }}
          >
            忽略
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        <Button icon={<SyncOutlined />} loading={matching} onClick={rematch} disabled={!rows.length}>
          重新自动配对
        </Button>
        <span className="hint">
          银行流水里有、但系统里没人录的款。是回款就“录成到账”；已经录过但金额或日期对不上就“关联已录的”；利息、内部转账等就“忽略”。
        </span>
      </Space>
      <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1000 }} pagination={{ defaultPageSize: 50 }} />
      <LinkModal line={linkFor} onClose={(ok) => {
        setLinkFor(null)
        if (ok) void load()
      }} />
      <Modal open={!!ignoreFor} title="忽略这条流水" okText="忽略" onOk={ignore} onCancel={() => setIgnoreFor(null)}>
        <Typography.Paragraph>
          {ignoreFor?.line_date} · {ignoreFor?.currency} {money(ignoreFor?.amount_orig)} · {ignoreFor?.payer_summary}
        </Typography.Paragraph>
        <Input placeholder="原因，如：利息、公司内部转账" value={ignoreNote} onChange={(e) => setIgnoreNote(e.target.value)} />
      </Modal>
    </div>
  )
}

/** 把一条银行流水手工关联到已录的到账 */
function LinkModal({ line, onClose }: { line: StatementLine | null; onClose: (ok: boolean) => void }) {
  const { message } = App.useApp()
  const [cands, setCands] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    if (!line) return
    setPicked(null)
    setLoading(true)
    const d = dayjs(line.line_date)
    void supabase
      .from('v_bank_receipts')
      .select('*')
      .eq('account_id', line.account_id as number)
      .is('bank_line_id', null)
      .gte('receipt_date', d.subtract(30, 'day').format('YYYY-MM-DD'))
      .lte('receipt_date', d.add(30, 'day').format('YYYY-MM-DD'))
      .order('receipt_date')
      .then(({ data }) => {
        const amt = Number(line.amount_orig)
        // 金额最接近的排前面
        const list = (data ?? []).sort((a, b) => Math.abs(Number(a.amount_orig) - amt) - Math.abs(Number(b.amount_orig) - amt))
        setCands(list)
        setLoading(false)
      })
  }, [line])

  const link = async () => {
    if (!line || !picked) return
    const { error } = await supabase
      .from('bank_statement_lines')
      .update({ receipt_id: picked, match_type: 'manual' })
      .eq('id', line.id as number)
    if (error) message.error(errorText(error))
    else {
      message.success('已关联')
      onClose(true)
    }
  }

  return (
    <Modal open={!!line} title="关联到已录的到账" okText="关联" okButtonProps={{ disabled: !picked }} onOk={link} onCancel={() => onClose(false)} width={760}>
      {line && (
        <Typography.Paragraph>
          银行流水：{line.line_date} · {line.currency} {money(line.amount_orig)} · {line.payer_summary}
        </Typography.Paragraph>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={cands}
        pagination={false}
        scroll={{ y: 360 }}
        rowSelection={{ type: 'radio', selectedRowKeys: picked ? [picked] : [], onChange: (keys) => setPicked(Number(keys[0])) }}
        onRow={(r) => ({ onClick: () => setPicked(r.id as number) })}
        locale={{ emptyText: '这个账户前后 30 天内没有还没核对的到账' }}
        columns={[
          { title: '编号', dataIndex: 'receipt_no', width: 150 },
          { title: '到账日期', dataIndex: 'receipt_date', width: 104 },
          { title: '金额', width: 140, align: 'right', render: (_, r) => `${r.currency} ${money(r.amount_orig)}` },
          {
            title: '差额',
            width: 110,
            align: 'right',
            render: (_, r) => {
              const diff = round2(Number(r.amount_orig) - Number(line?.amount_orig ?? 0))
              return diff === 0 ? <Tag color="green">一致</Tag> : <span className="text-warn">{money(diff)}</span>
            },
          },
          { title: '摘要', dataIndex: 'payer_summary', ellipsis: true },
        ]}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// 录了、银行查不到
// ---------------------------------------------------------------------------
function MissingReceipts({ accountId, version, onOpen }: { accountId?: number; version: number; onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_bank_receipts').select('*').eq('bank_status', '银行查不到').order('receipt_date').limit(2000)
    if (accountId) q = q.eq('account_id', accountId)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load, version])

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 8 }}
        title="这些到账已经录进系统，但导入的银行流水里找不到对应的入账。常见原因：日期或金额录错、账户选错、银行扣了手续费、客户其实没付。请逐笔核实。"
      />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 50 }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => onOpen(r.id as number) })}
        scroll={{ x: 900 }}
        columns={[
          { title: '编号', dataIndex: 'receipt_no', width: 150 },
          { title: '到账日期', dataIndex: 'receipt_date', width: 104 },
          { title: '账户', dataIndex: 'account_name', width: 210, ellipsis: true },
          { title: '金额', width: 150, align: 'right', render: (_, r) => `${r.currency} ${money(r.amount_orig)}` },
          { title: '付款方 / 摘要', dataIndex: 'payer_summary', ellipsis: true },
          { title: '报款', width: 90, render: (_, r) => (r.is_reported ? <Tag color="green">已报</Tag> : <Tag>未报</Tag>) },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 全部流水明细
// ---------------------------------------------------------------------------
function AllLines({ accountId, version, onOpen }: { accountId?: number; version: number; onOpen: (id: number) => void }) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<StatementLine[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | undefined>()
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs(todayAccra()).subtract(60, 'day'), dayjs(todayAccra())])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('v_statement_lines')
      .select('*')
      .gte('line_date', range[0].format('YYYY-MM-DD'))
      .lte('line_date', range[1].format('YYYY-MM-DD'))
      .order('line_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(3000)
    if (accountId) q = q.eq('account_id', accountId)
    if (status) q = q.eq('match_status', status)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [accountId, status, range])

  useEffect(() => {
    void load()
  }, [load, version])

  const patch = async (id: number, p: { receipt_id?: null; match_type?: null; ignored?: boolean }, ok: string) => {
    const { error } = await supabase.from('bank_statement_lines').update(p).eq('id', id)
    if (error) message.error(errorText(error))
    else {
      message.success(ok)
      void load()
    }
  }

  const MATCH_LABEL: Record<string, string> = { auto: '自动', manual: '手工', created: '由流水生成' }

  return (
    <div>
      <Space wrap className="filters">
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select
          allowClear
          placeholder="配对状态"
          style={{ width: 120 }}
          value={status}
          onChange={setStatus}
          options={['已配对', '未配对', '已忽略'].map((x) => ({ value: x, label: x }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 50 }}
        scroll={{ x: 1100 }}
        columns={[
          { title: '银行日期', dataIndex: 'line_date', width: 104 },
          { title: '账户', dataIndex: 'account_name', width: 200, ellipsis: true },
          { title: '金额', width: 150, align: 'right', render: (_, l) => `${l.currency} ${money(l.amount_orig)}` },
          { title: '银行摘要', dataIndex: 'payer_summary', ellipsis: true },
          {
            title: '状态',
            width: 170,
            render: (_, l) =>
              l.match_status === '已配对' ? (
                <Space size={4}>
                  <Tag color="green">已配对</Tag>
                  <span className="hint">{MATCH_LABEL[l.match_type ?? ''] ?? ''}</span>
                </Space>
              ) : l.match_status === '已忽略' ? (
                <Space size={4}>
                  <Tag>已忽略</Tag>
                  <span className="hint">{l.note}</span>
                </Space>
              ) : (
                <Tag color="red">未配对</Tag>
              ),
          },
          {
            title: '到账',
            width: 230,
            render: (_, l) =>
              l.receipt_id ? (
                <Space size={4}>
                  <a onClick={() => onOpen(l.receipt_id as number)}>{l.receipt_no}</a>
                  {Number(l.receipt_amount_orig) !== Number(l.amount_orig) && (
                    <Tag color="orange">差 {money(Number(l.receipt_amount_orig) - Number(l.amount_orig))}</Tag>
                  )}
                  <Button size="small" type="link" onClick={() => patch(l.id as number, { receipt_id: null, match_type: null }, '已取消配对')}>
                    取消配对
                  </Button>
                </Space>
              ) : l.ignored ? (
                <Button size="small" type="link" onClick={() => patch(l.id as number, { ignored: false }, '已取消忽略')}>
                  取消忽略
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 导入银行流水
// ---------------------------------------------------------------------------
function ImportStatement({
  accountId,
  onAccount,
  onDone,
}: {
  accountId?: number
  onAccount: (id: number | undefined) => void
  onDone: () => void
}) {
  const { isAdmin } = useAuth()
  const { accounts, accountById } = useRefData()
  const { message } = App.useApp()
  const [formats, setFormats] = useState<ImportFormat[]>([])
  const [formatId, setFormatId] = useState<number | undefined>()
  const [fileName, setFileName] = useState('')
  const [sheetRows, setSheetRows] = useState<unknown[][]>([])
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<Mapping>({})
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [period, setPeriod] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number; matched: number; unmatched: number } | null>(null)
  const [saveName, setSaveName] = useState('')

  useEffect(() => {
    void supabase
      .from('bank_import_formats')
      .select('*')
      .order('name')
      .then(({ data }) => setFormats(data ?? []))
  }, [])

  const headers = useMemo(() => (sheetRows[headerRow - 1] ?? []).map((h, i) => String(h ?? '').trim() || `第${i + 1}列`), [sheetRows, headerRow])
  const parsed = useMemo(() => toLines(sheetRows, headerRow, mapping, dateFormat), [sheetRows, headerRow, mapping, dateFormat])

  useEffect(() => {
    if (!parsed.lines.length) {
      setPeriod(null)
      return
    }
    const ds = parsed.lines.map((l) => l.line_date).sort()
    setPeriod([dayjs(ds[0]), dayjs(ds[ds.length - 1])])
  }, [parsed])

  const applyFormat = (f: ImportFormat | undefined, rows: unknown[][]) => {
    if (!f) return
    const m = f.mapping as Record<string, string>
    const hdr = (rows[f.header_row - 1] ?? []).map((h) => String(h ?? '').trim())
    const idx = (name?: string) => {
      if (!name) return undefined
      const i = hdr.findIndex((h) => h.toLowerCase() === name.toLowerCase())
      return i >= 0 ? i : undefined
    }
    setHeaderRow(f.header_row)
    setDateFormat(f.date_format)
    setMapping({ date: idx(m.date), credit: idx(m.credit), drcr: idx(m.drcr), summary: idx(m.summary), ref: idx(m.ref), cheque: idx(m.cheque) })
  }

  const readFile = async (file: File) => {
    setResult(null)
    const buf = await file.arrayBuffer()
    // raw: true 让 CSV 里的文字原样保留。否则 08/11/2026 会被当成美国格式的 8 月 11 日，
    // 而 13/11/2026 又保持文字，日期就乱了。日期统一交给下面按所选的日期格式解析。
    const wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    setFileName(file.name)
    setSheetRows(rows)
    const f = formats.find((x) => x.id === formatId)
    if (f) applyFormat(f, rows)
    else {
      // 找表头：前 15 行里第一行同时有“日期”和“贷方/金额”字样的
      let hr = 1
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const m = guessMapping((rows[i] ?? []).map((c) => String(c ?? '')))
        if (m.date !== undefined && m.credit !== undefined) {
          hr = i + 1
          break
        }
      }
      setHeaderRow(hr)
      setMapping(guessMapping((rows[hr - 1] ?? []).map((c) => String(c ?? ''))))
    }
  }

  const doImport = async () => {
    if (!accountId) return message.error('先在右上角选收款账户')
    if (!parsed.lines.length) return message.error('没有解析出贷方（入账）记录，请检查列的对应')
    setImporting(true)
    const { data, error } = await supabase.rpc('import_statement', {
      p_account_id: accountId,
      p_format_id: (formatId ?? null) as number, // 没选格式时传 null
      p_file_name: fileName,
      p_rows: parsed.lines as unknown as Json,
      p_period_from: period ? period[0].format('YYYY-MM-DD') : undefined,
      p_period_to: period ? period[1].format('YYYY-MM-DD') : undefined,
    })
    setImporting(false)
    if (error) return message.error('导入失败：' + errorText(error))
    const r = data as { inserted: number; skipped: number; matched: number; unmatched: number }
    setResult(r)
    message.success('导入完成')
    onDone()
  }

  const saveFormat = async () => {
    const name = saveName.trim()
    if (!name) return message.error('给格式起个名字，如“GCB 网银 Excel”')
    const pick = (i?: number) => (i === undefined ? undefined : headers[i])
    const row = {
      name,
      bank: accountId ? (accountById.get(accountId)?.bank ?? null) : null,
      header_row: headerRow,
      date_format: dateFormat,
      mapping: { date: pick(mapping.date), credit: pick(mapping.credit), drcr: pick(mapping.drcr), summary: pick(mapping.summary), ref: pick(mapping.ref), cheque: pick(mapping.cheque) },
    }
    const { data, error } = await supabase.from('bank_import_formats').insert(row).select('*').single()
    if (error) return message.error(errorText(error))
    setFormats((f) => [...f, data])
    setFormatId(data.id)
    message.success('格式已保存，下次选它就不用再对列了')
  }

  const colSelect = (k: keyof Mapping, label: string, required = false) => (
    <Col xs={12} md={8} lg={4}>
      <div className="hint">
        {label}
        {required && <span className="text-danger"> *</span>}
      </div>
      <Select
        allowClear={!required}
        style={{ width: '100%' }}
        value={mapping[k]}
        onChange={(v: number | undefined) => setMapping((m) => ({ ...m, [k]: v }))}
        options={headers.map((h, i) => ({ value: i, label: h }))}
        placeholder="选列"
      />
    </Col>
  )

  const bankAccounts = accounts.filter((a) => a.kind !== 'cash')

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10}>
            <div className="hint">收款账户 *</div>
            <Select
              style={{ width: '100%' }}
              showSearch={{ optionFilterProp: 'label' }}
              options={accountOptions(bankAccounts)}
              value={accountId}
              onChange={onAccount}
              placeholder="这份流水是哪个账户的"
            />
          </Col>
          <Col xs={24} md={8}>
            <div className="hint">银行导出格式（保存过的）</div>
            <Select
              allowClear
              style={{ width: '100%' }}
              value={formatId}
              onChange={(id: number | undefined) => {
                setFormatId(id)
                applyFormat(
                  formats.find((f) => f.id === id),
                  sheetRows,
                )
              }}
              options={formats.map((f) => ({ value: f.id, label: f.name }))}
              placeholder="没有就不选，下面手工对列"
            />
          </Col>
        </Row>
        <Upload.Dragger
          accept=".xlsx,.xls,.csv"
          showUploadList={false}
          beforeUpload={(f) => {
            void readFile(f as File)
            return false
          }}
          style={{ marginTop: 12 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{fileName ? `已读取：${fileName}（点这里换一个文件）` : '把网银导出的 Excel / CSV 拖到这里，或点击选择'}</p>
          <p className="ant-upload-hint">只导入贷方（入账）记录，借方自动跳过；同一份流水重复导入不会重复。</p>
        </Upload.Dragger>
      </Card>

      {sheetRows.length > 0 && (
        <Card size="small" title="对应列" style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={8} lg={4}>
              <div className="hint">表头在第几行</div>
              <InputNumber min={1} max={50} value={headerRow} onChange={(v) => setHeaderRow(v ?? 1)} style={{ width: '100%' }} />
            </Col>
            {colSelect('date', '日期列', true)}
            {colSelect('credit', '贷方 / 入账金额列', true)}
            {colSelect('summary', '摘要列')}
            {colSelect('ref', '参考号列')}
            {colSelect('cheque', '支票号列')}
            {colSelect('drcr', '借贷标志列（有就选）')}
            <Col xs={12} md={8} lg={4}>
              <div className="hint">日期格式</div>
              <Select style={{ width: '100%' }} value={dateFormat} onChange={setDateFormat} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />
            </Col>
          </Row>
          {isAdmin && (
            <Space style={{ marginTop: 12 }}>
              <Input placeholder="保存为格式，如“GCB 网银 Excel”" value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ width: 260 }} />
              <Button onClick={saveFormat}>保存格式</Button>
            </Space>
          )}
        </Card>
      )}

      {sheetRows.length > 0 && (
        <Card
          size="small"
          title={`预览：${parsed.lines.length} 条入账，合计 ${money(parsed.lines.reduce((s, l) => s + l.amount_orig, 0))}`}
          extra={
            <Space>
              <span className="hint">流水覆盖日期</span>
              <DatePicker.RangePicker value={period} onChange={(v) => setPeriod(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
              <Button type="primary" loading={importing} onClick={doImport} disabled={!parsed.lines.length || !accountId}>
                导入并自动配对
              </Button>
            </Space>
          }
        >
          {parsed.bad.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              title={`第 ${parsed.bad.slice(0, 10).join('、')} 行的日期认不出来，已跳过。请检查“日期格式”。`}
            />
          )}
          {result && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 8 }}
              title={`新导入 ${result.inserted} 条（重复跳过 ${result.skipped} 条），自动配对上 ${result.matched} 笔；这个账户还有 ${result.unmatched} 条没人报，请到“银行有、没人报”处理。`}
            />
          )}
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            dataSource={parsed.lines}
            pagination={{ defaultPageSize: 20 }}
            columns={[
              { title: '日期', dataIndex: 'line_date', width: 110 },
              { title: '金额', dataIndex: 'amount_orig', width: 140, align: 'right', render: (v: number) => money(v) },
              { title: '摘要', dataIndex: 'payer_summary', ellipsis: true },
              { title: '参考号', dataIndex: 'bank_ref', width: 160, ellipsis: true },
              { title: '支票号', dataIndex: 'cheque_no', width: 100 },
            ]}
          />
        </Card>
      )}
    </div>
  )
}
