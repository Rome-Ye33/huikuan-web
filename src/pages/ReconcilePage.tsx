import { DeleteOutlined, InboxOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Key } from 'react'
import * as XLSX from 'xlsx'
import CashEntryEditor from '../components/CashEntryEditor'
import type { CashEntryPrefill } from '../components/CashEntryEditor'
import ReceiptEditor from '../components/ReceiptEditor'
import type { ReceiptPrefill } from '../components/ReceiptEditor'
import { useAuth } from '../lib/auth'
import { pickCol, textCol } from '../lib/colFilter'
import { errorText } from '../lib/errors'
import { money, round2, todayAccra } from '../lib/format'
import { accountOptions, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import { moduleColor, moduleOptions, notifyJournalChanged } from '../lib/journal'
import { DATE_FORMATS, findHeaderRow, guessMapping, matchAccount, toLines } from '../lib/statement'
import type { ImportResult, Mapping, ParsedLine } from '../lib/statement'
import type { ImportFormat, Receipt, StatementLine } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import { useT } from '../lib/i18n'

export default function ReconcilePage() {
  const t = useT()
  // 导入流水、配对、忽略要“银行对账”可编辑；只看的看得到三张表
  const rcEdit = useAuth().canEdit('reconcile')
  const [tab, setTab] = useState('unmatched')
  const [accountId, setAccountId] = useState<number | undefined>()
  const [editor, setEditor] = useState<{ open: boolean; id: number | null; prefill: ReceiptPrefill | null }>({
    open: false,
    id: null,
    prefill: null,
  })
  const [version, setVersion] = useState(0)
  // 填付款、其他收入、互转（银行现金日记账的收支）；id = 打开已经填好的那一笔
  const [entry, setEntry] = useState<{ id: number | null; prefill: CashEntryPrefill | null } | null>(null)
  const { accounts } = useRefData()
  const bankAccounts = accounts.filter((a) => a.kind !== 'cash')
  /** 一条流水填成收支：付出去的填付款或互转，收进来的填其他收入或互转。日期、账户、金额照银行的 */
  const fillLine = (l: StatementLine, kind: 'out' | 'in' | 'transfer') => {
    const amt = Math.abs(Number(l.amount_orig))
    const base = { entry_date: l.line_date ?? undefined, summary: l.payer_summary, bank_ref: l.bank_ref, bank_summary: l.payer_summary, line_id: l.id ?? undefined }
    if (kind === 'transfer' && Number(l.amount_orig) > 0) setEntry({ id: null, prefill: { ...base, kind, to_account_id: l.account_id ?? undefined, to_amount: amt } })
    else setEntry({ id: null, prefill: { ...base, kind, account_id: l.account_id ?? undefined, amount: amt } })
  }

  return (
    <div>
      <div className="page-title">
        <h2>{t('银行对账')}</h2>
        <Select
          allowClear
          placeholder={t('全部账户')}
          style={{ width: 260 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={accountOptions(bankAccounts, false)}
          value={accountId}
          onChange={setAccountId}
        />
      </div>
      <Typography.Paragraph type="secondary">
        {t('先导银行流水，再一条一条填：收进来的按“同账户、同金额、日期相差 3 天内”自动和已录的到账配对，配不上的在「银行有、没人报」里录成到账；付出去的在「付款待填」里填业务模块和摘要。填好的流水就是银行现金日记账。')}
      </Typography.Paragraph>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          {
            key: 'unmatched',
            label: t('银行有、没人报'),
            children: (
              <UnmatchedLines
                accountId={accountId}
                version={version}
                onEntry={fillLine}
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
            key: 'payments',
            label: t('付款待填'),
            children: <UnfilledPayments accountId={accountId} version={version} onFill={fillLine} />,
          },
          {
            key: 'missing',
            label: t('录了、银行查不到'),
            children: <MissingReceipts accountId={accountId} version={version} onOpen={(id) => setEditor({ open: true, id, prefill: null })} />,
          },
          ...(rcEdit
            ? [
                {
                  key: 'import',
                  label: t('导入银行流水'),
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
              ]
            : []),
          {
            key: 'all',
            label: t('全部流水明细'),
            children: (
              <AllLines
                accountId={accountId}
                version={version}
                onOpen={(id) => setEditor({ open: true, id, prefill: null })}
                onEntry={(id) => setEntry({ id, prefill: null })}
              />
            ),
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
      <CashEntryEditor
        open={!!entry}
        entryId={entry?.id ?? null}
        prefill={entry?.prefill ?? null}
        onClose={(changed) => {
          setEntry(null)
          if (changed) setVersion((x) => x + 1)
        }}
      />
    </div>
  )
}

/**
 * 多选流水：管理员可以删除选中的（已配对、已填的不删：要删先取消配对或删掉填的那一笔；删掉的行再导入同一份对账单时会重新进来）；
 * select = 能一起填的地方（付款待填）别人也能勾
 */
function useLineBulk(rows: StatementLine[], reload: () => void, select = false) {
  const t = useT()
  const { isAdmin } = useAuth()
  const { message } = App.useApp()
  const [sel, setSel] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const chosen = rows.filter((r) => sel.includes(r.id as number))

  const remove = async () => {
    const matched = chosen.filter((r) => r.receipt_id != null || r.entry_id != null)
    const ids = chosen.filter((r) => r.receipt_id == null && r.entry_id == null).map((r) => r.id as number)
    setBusy(true)
    if (ids.length) {
      const { error } = await supabase.from('bank_statement_lines').delete().in('id', ids)
      if (error) {
        setBusy(false)
        message.error(errorText(error))
        return
      }
    }
    setBusy(false)
    if (matched.length)
      message.warning(
        t('已删除 {n} 条；{m} 条没删：{list}', {
          n: ids.length,
          m: matched.length,
          list: matched.map((l) => `${l.line_date} ${l.currency} ${money(l.amount_orig)}（${t(l.receipt_id != null ? '已配对' : '已填')}）`).join('、'),
        }),
        8,
      )
    else message.success(t('已删除 {n} 条', { n: ids.length }))
    setSel([])
    reload()
  }

  const rowSelection =
    isAdmin || select
      ? { selectedRowKeys: sel, onChange: (keys: Key[]) => setSel(keys as number[]), selections: [Table.SELECTION_ALL, Table.SELECTION_NONE], columnWidth: 40 }
      : undefined
  const button =
    isAdmin && chosen.length > 0 ? (
      <Popconfirm
        title={t('删除选中的 {n} 条流水？', { n: chosen.length })}
        description={t('已配对、已填的不会删（要删先取消配对，或删掉填的那一笔）。以后再导入同一份对账单，删掉的行会重新进来。')}
        okText={t('删除')}
        okButtonProps={{ danger: true }}
        onConfirm={() => void remove()}
      >
        <Button danger icon={<DeleteOutlined />} loading={busy}>
          {t('删除选中 {n} 条', { n: chosen.length })}
        </Button>
      </Popconfirm>
    ) : null
  return { rowSelection, button, chosen, clear: () => setSel([]) }
}

// ---------------------------------------------------------------------------
// 银行有、没人报
// ---------------------------------------------------------------------------
function UnmatchedLines({
  accountId,
  version,
  onCreate,
  onEntry,
}: {
  accountId?: number
  version: number
  onCreate: (l: StatementLine) => void
  onEntry: (l: StatementLine, kind: 'in' | 'transfer') => void
}) {
  const t = useT()
  const { message } = App.useApp()
  const { canEdit } = useAuth()
  /** 关联、忽略、重新配对：“银行对账”可编辑；录成到账还要“到账录入”可编辑 */
  const rcEdit = canEdit('reconcile')
  const canCreate = rcEdit && canEdit('receipts')
  /** 填成其他收入、互转：“银行现金日记账”可编辑 */
  const canFill = canEdit('journal')
  const [rows, setRows] = useState<StatementLine[]>([])
  const [loading, setLoading] = useState(false)
  const [linkFor, setLinkFor] = useState<StatementLine | null>(null)
  const [ignoreFor, setIgnoreFor] = useState<StatementLine | null>(null)
  const [ignoreNote, setIgnoreNote] = useState('')
  const [matching, setMatching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // 只看收进来的；付出去的在「付款待填」
    let q = supabase.from('v_statement_lines').select('*').eq('match_status', '未配对').gt('amount_orig', 0).order('line_date').order('id').limit(2000)
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
    message.success(n ? t('新配对上 {n} 笔', { n }) : t('没有新的可配对'))
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
      message.success(t('已忽略'))
      setIgnoreFor(null)
      void load()
    }
  }

  const bulk = useLineBulk(rows, () => void load())

  const columns: ColumnsType<StatementLine> = [
    { title: t('银行日期'), dataIndex: 'line_date', width: 104, ...textCol<StatementLine>((l) => l.line_date) },
    { title: t('账户'), dataIndex: 'account_name', width: 210, ellipsis: true, ...pickCol(rows, (l) => l.account_name) },
    {
      title: t('金额'),
      width: 150,
      align: 'right',
      render: (_, l) => (
        <span className="num">
          {l.currency} {money(l.amount_orig)}
        </span>
      ),
      ...textCol<StatementLine>((l) => `${l.currency} ${money(l.amount_orig)}`),
    },
    { title: t('银行摘要'), dataIndex: 'payer_summary', ellipsis: true, ...textCol<StatementLine>((l) => l.payer_summary) },
    { title: t('参考号'), dataIndex: 'bank_ref', width: 140, ellipsis: true, ...textCol<StatementLine>((l) => l.bank_ref) },
  ]
  if (rcEdit || canFill)
    columns.push({
      title: t('处理'),
      width: 330,
      render: (_, l) => (
        <Space size={4} wrap>
          {canCreate && (
            <Button size="small" type="primary" onClick={() => onCreate(l)}>
              {t('录成到账')}
            </Button>
          )}
          {rcEdit && (
            <Button size="small" onClick={() => setLinkFor(l)}>
              {t('关联已录的')}
            </Button>
          )}
          {canFill && (
            <Button size="small" onClick={() => onEntry(l, 'in')}>
              {t('其他收入')}
            </Button>
          )}
          {canFill && (
            <Button size="small" onClick={() => onEntry(l, 'transfer')}>
              {t('互转')}
            </Button>
          )}
          {rcEdit && (
            <Button
              size="small"
              type="text"
              onClick={() => {
                setIgnoreNote('')
                setIgnoreFor(l)
              }}
            >
              {t('忽略')}
            </Button>
          )}
        </Space>
      ),
    })

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        {rcEdit && (
          <Button icon={<SyncOutlined />} loading={matching} onClick={rematch} disabled={!rows.length}>
            {t('重新自动配对')}
          </Button>
        )}
        {bulk.button}
        <span className="hint">
          {rcEdit
            ? t('银行流水里有、但系统里没人录的款。是回款就“录成到账”；已经录过但金额或日期对不上就“关联已录的”；利息、退款记“其他收入”；自己账户之间转来的记“互转”。')
            : t('银行流水里有、但系统里没人录的款。')}
        </span>
      </Space>
      <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1000 }} pagination={{ defaultPageSize: 50 }} rowSelection={bulk.rowSelection} />
      <LinkModal line={linkFor} onClose={(ok) => {
        setLinkFor(null)
        if (ok) void load()
      }} />
      <Modal open={!!ignoreFor} title={t('忽略这条流水')} okText={t('忽略')} onOk={ignore} onCancel={() => setIgnoreFor(null)}>
        <Typography.Paragraph>
          {ignoreFor?.line_date} · {ignoreFor?.currency} {money(ignoreFor?.amount_orig)} · {ignoreFor?.payer_summary}
        </Typography.Paragraph>
        <Input placeholder={t('原因，如：利息、公司内部转账')} value={ignoreNote} onChange={(e) => setIgnoreNote(e.target.value)} />
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 付款待填：银行流水里付出去的、还没填业务模块和摘要的（银行账户先导流水再填）
// ---------------------------------------------------------------------------
function UnfilledPayments({
  accountId,
  version,
  onFill,
}: {
  accountId?: number
  version: number
  onFill: (l: StatementLine, kind: 'out' | 'transfer') => void
}) {
  const t = useT()
  const { message } = App.useApp()
  const { canEdit } = useAuth()
  /** 忽略：“银行对账”可编辑；填付款、互转、一起填：“银行现金日记账”可编辑 */
  const rcEdit = canEdit('reconcile')
  const canFill = canEdit('journal')
  const [rows, setRows] = useState<StatementLine[]>([])
  const [loading, setLoading] = useState(false)
  const [ignoreFor, setIgnoreFor] = useState<StatementLine | null>(null)
  const [ignoreNote, setIgnoreNote] = useState('')
  const [batch, setBatch] = useState<StatementLine[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('v_statement_lines')
      .select('*')
      .lt('amount_orig', 0)
      .eq('ignored', false)
      .is('entry_id', null)
      .order('line_date')
      .order('line_seq')
      .order('id')
      .limit(2000)
    if (accountId) q = q.eq('account_id', accountId)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load, version])

  const ignore = async () => {
    if (!ignoreFor) return
    const { error } = await supabase
      .from('bank_statement_lines')
      .update({ ignored: true, note: ignoreNote.trim() || null })
      .eq('id', ignoreFor.id as number)
    if (error) message.error(errorText(error))
    else {
      message.success(t('已忽略'))
      setIgnoreFor(null)
      void load()
    }
  }

  const bulk = useLineBulk(rows, () => void load(), canFill)
  const total = new Map<string, number>()
  for (const r of rows) total.set(r.currency ?? '', round2((total.get(r.currency ?? '') ?? 0) - Number(r.amount_orig)))

  const columns: ColumnsType<StatementLine> = [
    { title: t('银行日期'), dataIndex: 'line_date', width: 104, ...textCol<StatementLine>((l) => l.line_date) },
    { title: t('账户'), dataIndex: 'account_name', width: 210, ellipsis: true, ...pickCol(rows, (l) => l.account_name) },
    {
      title: t('付出'),
      width: 150,
      align: 'right',
      render: (_, l) => (
        <span className="num text-warn">
          {l.currency} {money(-Number(l.amount_orig))}
        </span>
      ),
      ...textCol<StatementLine>((l) => `${l.currency} ${money(-Number(l.amount_orig))}`),
    },
    { title: t('银行摘要'), dataIndex: 'payer_summary', ellipsis: true, ...textCol<StatementLine>((l) => l.payer_summary) },
    { title: t('参考号'), dataIndex: 'bank_ref', width: 130, ellipsis: true, ...textCol<StatementLine>((l) => l.bank_ref) },
    {
      title: t('银行余额'),
      width: 130,
      align: 'right',
      render: (_, l) => (l.balance != null ? <span className="num hint">{money(l.balance)}</span> : null),
    },
  ]
  if (rcEdit || canFill)
    columns.push({
      title: t('处理'),
      width: 220,
      render: (_, l) => (
        <Space size={4}>
          {canFill && (
            <Button size="small" type="primary" onClick={() => onFill(l, 'out')}>
              {t('填付款')}
            </Button>
          )}
          {canFill && (
            <Button size="small" onClick={() => onFill(l, 'transfer')}>
              {t('互转')}
            </Button>
          )}
          {rcEdit && (
            <Button
              size="small"
              type="text"
              onClick={() => {
                setIgnoreNote('')
                setIgnoreFor(l)
              }}
            >
              {t('忽略')}
            </Button>
          )}
        </Space>
      ),
    })

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        {canFill && bulk.chosen.length > 0 && (
          <Button type="primary" onClick={() => setBatch(bulk.chosen)}>
            {t('一起填（{n} 条）', { n: bulk.chosen.length })}
          </Button>
        )}
        {bulk.button}
        <span className="hint">
          {t('银行流水里付出去、还没填的。点「填付款」选业务模块、写摘要（日期、账户、金额照银行的）；转到自己别的账户的点「互转」；手续费这类小额的勾上几条「一起填」；银行冲正之类不算收付的点「忽略」。')}
        </span>
      </Space>
      {rows.length > 0 && (
        <div className="hint filters">
          {t('一共 {n} 条待填：{sum}', {
            n: rows.length,
            sum: [...total.entries()].map(([c, v]) => `${c} ${money(v)}`).join('，'),
          })}
        </div>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1100 }}
        pagination={{ defaultPageSize: 50 }}
        rowSelection={bulk.rowSelection}
        className="payments-todo"
        locale={{ emptyText: t('付出去的流水都填好了') }}
      />
      <Modal open={!!ignoreFor} title={t('忽略这条流水')} okText={t('忽略')} onOk={ignore} onCancel={() => setIgnoreFor(null)}>
        <Typography.Paragraph>
          {ignoreFor?.line_date} · {ignoreFor?.currency} {money(ignoreFor?.amount_orig)} · {ignoreFor?.payer_summary}
        </Typography.Paragraph>
        <Input placeholder={t('原因，如：银行冲正')} value={ignoreNote} onChange={(e) => setIgnoreNote(e.target.value)} />
      </Modal>
      <BatchFillModal
        lines={batch}
        onClose={(ok) => {
          setBatch(null)
          if (ok) {
            bulk.clear()
            void load()
          }
        }}
      />
    </div>
  )
}

/** 勾上的几条付款一起填：同一个业务模块、收款方；摘要空着就用各自的银行摘要。每条记成一笔付款，日期、账户、金额照银行的 */
function BatchFillModal({ lines, onClose }: { lines: StatementLine[] | null; onClose: (ok: boolean) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const [form] = Form.useForm<{ module: string; counterparty?: string; summary?: string }>()
  const [saving, setSaving] = useState(false)
  const sums = new Map<string, number>()
  for (const l of lines ?? []) sums.set(l.currency ?? '', round2((sums.get(l.currency ?? '') ?? 0) - Number(l.amount_orig)))

  const save = async () => {
    let v: { module: string; counterparty?: string; summary?: string }
    try {
      v = await form.validateFields()
    } catch {
      return // 没填的地方表单上已经标红了
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('fill_statement_lines', {
      p_line_ids: (lines ?? []).map((l) => l.id as number),
      p: { module: v.module, counterparty: v.counterparty?.trim() || null, summary: v.summary?.trim() || null },
    })
    setSaving(false)
    if (error) return message.error(errorText(error))
    message.success(t('已填 {n} 条', { n: data ?? 0 }))
    notifyJournalChanged()
    onClose(true)
  }

  return (
    <Modal
      open={!!lines}
      title={t('一起填 {n} 条付款', { n: lines?.length ?? 0 })}
      okText={t('填好了')}
      confirmLoading={saving}
      onOk={() => void save()}
      onCancel={() => onClose(false)}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t('合计 {sum}。每条记成一笔付款，日期、账户、金额照各自的银行流水。', {
          sum: [...sums].map(([c, v]) => `${c} ${money(v)}`).join('，'),
        })}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="module" label={t('业务模块')} rules={[{ required: true, message: t('请选业务模块') }]}>
          <Select
            showSearch={{ optionFilterProp: 'label' }}
            options={moduleOptions('out').map((m) => ({ value: m, label: t(m) }))}
            placeholder={t('如：手续费')}
          />
        </Form.Item>
        <Form.Item name="counterparty" label={t('收款方 / 供应商')}>
          <Input placeholder={t('可以不填')} />
        </Form.Item>
        <Form.Item name="summary" label={t('摘要')} extra={t('空着就用各自的银行摘要')}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** 把一条银行流水手工关联到已录的到账 */
function LinkModal({ line, onClose }: { line: StatementLine | null; onClose: (ok: boolean) => void }) {
  const t = useT()
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
      message.success(t('已关联'))
      onClose(true)
    }
  }

  return (
    <Modal open={!!line} title={t('关联到已录的到账')} okText={t('关联')} okButtonProps={{ disabled: !picked }} onOk={link} onCancel={() => onClose(false)} width={760}>
      {line && (
        <Typography.Paragraph>
          {t('银行流水：')}{line.line_date} · {line.currency} {money(line.amount_orig)} · {line.payer_summary}
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
        locale={{ emptyText: t('这个账户前后 30 天内没有还没核对的到账') }}
        columns={[
          { title: t('编号'), dataIndex: 'receipt_no', width: 150 },
          { title: t('到账日期'), dataIndex: 'receipt_date', width: 104 },
          { title: t('金额'), width: 140, align: 'right', render: (_, r) => `${r.currency} ${money(r.amount_orig)}` },
          {
            title: t('差额'),
            width: 110,
            align: 'right',
            render: (_, r) => {
              const diff = round2(Number(r.amount_orig) - Number(line?.amount_orig ?? 0))
              return diff === 0 ? <Tag color="green">{t('一致')}</Tag> : <span className="text-warn">{money(diff)}</span>
            },
          },
          { title: t('摘要'), dataIndex: 'payer_summary', ellipsis: true },
        ]}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// 录了、银行查不到
// ---------------------------------------------------------------------------
function MissingReceipts({ accountId, version, onOpen }: { accountId?: number; version: number; onOpen: (id: number) => void }) {
  const t = useT()
  const rxView = useAuth().canView('receipts')
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
        title={t('这些到账已经录进系统，但导入的银行流水里找不到对应的入账。常见原因：日期或金额录错、账户选错、银行扣了手续费、客户其实没付。请逐笔核实。')}
      />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 50 }}
        rowClassName={() => (rxView ? 'clickable-row' : '')}
        onRow={(r) => ({ onClick: () => rxView && onOpen(r.id as number) })}
        scroll={{ x: 900 }}
        columns={[
          { title: t('编号'), dataIndex: 'receipt_no', width: 150, ...textCol<Receipt>((r) => r.receipt_no) },
          { title: t('到账日期'), dataIndex: 'receipt_date', width: 104, ...textCol<Receipt>((r) => r.receipt_date) },
          { title: t('账户'), dataIndex: 'account_name', width: 210, ellipsis: true, ...pickCol(rows, (r) => r.account_name) },
          { title: t('金额'), width: 150, align: 'right', render: (_, r) => `${r.currency} ${money(r.amount_orig)}`, ...textCol<Receipt>((r) => `${r.currency} ${money(r.amount_orig)}`) },
          { title: t('付款方 / 摘要'), dataIndex: 'payer_summary', ellipsis: true, ...textCol<Receipt>((r) => r.payer_summary) },
          {
            title: t('报款'),
            width: 90,
            render: (_, r) => (r.is_reported ? <Tag color="green">{t('已报')}</Tag> : <Tag>{t('未报')}</Tag>),
            ...pickCol(rows, (r) => (r.is_reported ? '已报' : '未报'), t),
          },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 全部流水明细：收、付都在，带银行余额；填了什么、配了哪笔到账
// ---------------------------------------------------------------------------
function AllLines({
  accountId,
  version,
  onOpen,
  onEntry,
}: {
  accountId?: number
  version: number
  onOpen: (id: number) => void
  onEntry: (id: number) => void
}) {
  const t = useT()
  const { message } = App.useApp()
  const { canEdit, canView } = useAuth()
  /** 取消配对、取消忽略：“银行对账”可编辑；点开到账：“到账录入”看得到；点开填的那一笔：“银行现金日记账”看得到 */
  const rcEdit = canEdit('reconcile')
  const rxView = canView('receipts')
  const jView = canView('journal')
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
      .order('line_seq', { ascending: false })
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

  const MATCH_LABEL: Record<string, string> = { auto: t('自动'), manual: t('手工'), created: t('由流水生成') }
  const bulk = useLineBulk(rows, () => void load())

  return (
    <div>
      <Space wrap className="filters">
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select
          allowClear
          placeholder={t('状态')}
          style={{ width: 120 }}
          value={status}
          onChange={setStatus}
          options={['已配对', '已填', '未配对', '待填', '已忽略'].map((x) => ({ value: x, label: t(x) }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        {bulk.button}
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 50 }}
        scroll={{ x: 1280 }}
        rowSelection={bulk.rowSelection}
        columns={[
          { title: t('银行日期'), dataIndex: 'line_date', width: 104, ...textCol<StatementLine>((l) => l.line_date) },
          { title: t('账户'), dataIndex: 'account_name', width: 200, ellipsis: true, ...pickCol(rows, (l) => l.account_name) },
          {
            title: t('收 / 付'),
            width: 150,
            align: 'right',
            render: (_, l) => (
              <span className={Number(l.amount_orig) < 0 ? 'num text-warn' : 'num'}>
                {l.currency} {money(l.amount_orig)}
              </span>
            ),
            ...textCol<StatementLine>((l) => `${l.currency} ${money(l.amount_orig)}`),
          },
          {
            title: t('银行余额'),
            width: 130,
            align: 'right',
            render: (_, l) => (l.balance != null ? <span className="num hint">{money(l.balance)}</span> : null),
          },
          { title: t('银行摘要'), dataIndex: 'payer_summary', ellipsis: true, ...textCol<StatementLine>((l) => l.payer_summary) },
          {
            title: t('状态'),
            width: 190,
            ...pickCol(rows, (l) => l.match_status, t),
            render: (_, l) =>
              l.match_status === '已配对' ? (
                <Space size={4}>
                  <Tag color="green">{t('已配对')}</Tag>
                  <span className="hint">{MATCH_LABEL[l.match_type ?? ''] ?? ''}</span>
                </Space>
              ) : l.match_status === '已填' ? (
                <Space size={4}>
                  <Tag color="blue">{t('已填')}</Tag>
                  {l.entry_module && <Tag color={moduleColor(l.entry_module)}>{t(l.entry_module)}</Tag>}
                </Space>
              ) : l.match_status === '已忽略' ? (
                <Space size={4}>
                  <Tag>{t('已忽略')}</Tag>
                  <span className="hint">{l.note ? t(l.note) : ''}</span>
                </Space>
              ) : l.match_status === '待填' ? (
                <Tag color="orange">{t('待填')}</Tag>
              ) : (
                <Tag color="red">{t('未配对')}</Tag>
              ),
          },
          {
            title: t('配上的单据'),
            width: 230,
            ...textCol<StatementLine>((l) => l.receipt_no ?? l.entry_no),
            render: (_, l) =>
              l.receipt_id ? (
                <Space size={4}>
                  {rxView ? <a onClick={() => onOpen(l.receipt_id as number)}>{l.receipt_no}</a> : l.receipt_no}
                  {Number(l.receipt_amount_orig) !== Number(l.amount_orig) && (
                    <Tag color="orange">{t('差')} {money(Number(l.receipt_amount_orig) - Number(l.amount_orig))}</Tag>
                  )}
                  {rcEdit && (
                    <Button size="small" type="link" onClick={() => patch(l.id as number, { receipt_id: null, match_type: null }, t('已取消配对'))}>
                      {t('取消配对')}
                    </Button>
                  )}
                </Space>
              ) : l.entry_id ? (
                jView ? <a onClick={() => onEntry(l.entry_id as number)}>{l.entry_no}</a> : l.entry_no
              ) : l.ignored && rcEdit ? (
                <Button size="small" type="link" onClick={() => patch(l.id as number, { ignored: false }, t('已取消忽略'))}>
                  {t('取消忽略')}
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
// 两种文件：单个账户的网银导出（在上面选账户）；或者月度汇总，一张表里有多个账户、有“账户名称”列（按账户分别导入）
// ---------------------------------------------------------------------------
type ImportSummary = ImportResult & { accounts: number; failed: string[]; multi: boolean; chainList: string[] }
type AccountGroup = { key: string; rows: number; lines: ParsedLine[]; inN: number; inSum: number; outN: number; outSum: number; auto?: number }

/** 收、付各几条、合计多少 */
function inOut(lines: ParsedLine[]) {
  const r = { inN: 0, inSum: 0, outN: 0, outSum: 0 }
  for (const l of lines) {
    if (l.amount_orig > 0) {
      r.inN += 1
      r.inSum = round2(r.inSum + l.amount_orig)
    } else {
      r.outN += 1
      r.outSum = round2(r.outSum - l.amount_orig)
    }
  }
  return r
}

function ImportStatement({
  accountId,
  onAccount,
  onDone,
}: {
  accountId?: number
  onAccount: (id: number | undefined) => void
  onDone: () => void
}) {
  const t = useT()
  const { isAdmin } = useAuth()
  const { accounts, accountById } = useRefData()
  const { message } = App.useApp()
  const [formats, setFormats] = useState<ImportFormat[]>([])
  const [formatId, setFormatId] = useState<number | undefined>()
  const [fileName, setFileName] = useState('')
  const [book, setBook] = useState<XLSX.WorkBook | null>(null)
  const [sheet, setSheet] = useState('')
  const [sheetRows, setSheetRows] = useState<unknown[][]>([])
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<Mapping>({})
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [period, setPeriod] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [saveName, setSaveName] = useState('')
  // 用户在“文件里的账户”表里手工改过的对应；null 表示这个账户不导入
  const [acctPick, setAcctPick] = useState<Record<string, number | null>>({})

  const bankAccounts = useMemo(() => accounts.filter((a) => a.kind !== 'cash'), [accounts])
  const multi = mapping.account !== undefined

  useEffect(() => {
    void supabase
      .from('bank_import_formats')
      .select('*')
      .order('name')
      .then(({ data }) => setFormats(data ?? []))
  }, [])

  const headers = useMemo(() => (sheetRows[headerRow - 1] ?? []).map((h, i) => String(h ?? '').trim() || t('第{n}列', { n: i + 1 })), [sheetRows, headerRow, t])
  const parsed = useMemo(() => toLines(sheetRows, headerRow, mapping, dateFormat), [sheetRows, headerRow, mapping, dateFormat])

  const groups = useMemo<AccountGroup[]>(() => {
    if (!multi) return []
    return [...parsed.seen.entries()].map(([key, rows]) => {
      const lines = parsed.lines.filter((l) => l.account_key === key)
      return { key, rows, lines, ...inOut(lines), auto: matchAccount(key, bankAccounts) }
    })
  }, [multi, parsed, bankAccounts])
  const targetOf = (g: AccountGroup) => (g.key in acctPick ? (acctPick[g.key] ?? undefined) : g.auto)
  const readyGroups = groups.filter((g) => targetOf(g) !== undefined)

  // 流水覆盖日期：默认取文件里最早到最晚的日期；月度汇总按整月算（某个账户月初几天没交易也算覆盖了）
  useEffect(() => {
    if (!parsed.minDate || !parsed.maxDate) {
      setPeriod(null)
      return
    }
    const a = dayjs(parsed.minDate)
    const b = dayjs(parsed.maxDate)
    setPeriod(multi ? [a.startOf('month'), b.endOf('month')] : [a, b])
  }, [parsed, multi])

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
    setMapping({
      date: idx(m.date),
      credit: idx(m.credit),
      debit: idx(m.debit),
      balance: idx(m.balance),
      drcr: idx(m.drcr),
      summary: idx(m.summary),
      ref: idx(m.ref),
      cheque: idx(m.cheque),
      account: idx(m.account),
    })
  }

  const sheetToRows = (wb: XLSX.WorkBook, name: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' })

  const loadSheet = (wb: XLSX.WorkBook, name: string) => {
    const rows = sheetToRows(wb, name)
    setSheet(name)
    setSheetRows(rows)
    setAcctPick({})
    setResult(null)
    const f = formats.find((x) => x.id === formatId)
    if (f) return applyFormat(f, rows)
    const hr = findHeaderRow(rows) || 1
    setHeaderRow(hr)
    setMapping(guessMapping((rows[hr - 1] ?? []).map((c) => String(c ?? ''))))
  }

  const readFile = async (file: File) => {
    const buf = await file.arrayBuffer()
    // raw: true 让 CSV 里的文字原样保留。否则 08/11/2026 会被当成美国格式的 8 月 11 日，
    // 而 13/11/2026 又保持文字，日期就乱了。日期统一交给下面按所选的日期格式解析。
    const wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: false })
    setBook(wb)
    setFileName(file.name)
    // 有多个工作表时，默认用第一个认得出表头的（月度汇总里是“流水明细”）
    loadSheet(wb, wb.SheetNames.find((n) => findHeaderRow(sheetToRows(wb, n)) > 0) ?? wb.SheetNames[0])
  }

  // 按银行的先后（从旧到新）送：数据库照这个顺序查余额接不接得上
  const rowsForRpc = (lines: ParsedLine[]) =>
    lines.map((l) => ({
      line_date: l.line_date,
      amount_orig: l.amount_orig,
      payer_summary: l.payer_summary,
      bank_ref: l.bank_ref,
      cheque_no: l.cheque_no,
      balance: l.balance,
      ignored: l.ignored ?? false,
      note: l.note ?? null,
    })) as unknown as Json
  const parsedIO = useMemo(() => inOut(parsed.lines), [parsed])

  /** 导完数据库查出来的余额接不上：哪个账户、几处、在哪几天差多少 */
  const chainText = (id: number, r: ImportResult) =>
    r.chain && r.chain.n > 0
      ? t('{account}：{n} 处，在 {dates}', {
          account: accountById.get(id)?.short_name ?? id,
          n: r.chain.n,
          dates: r.chain.first.map((f) => `${f.line_date}（${t('差')} ${money(f.diff)}）`).join(t('、')),
        })
      : null

  const runImport = (id: number, lines: ParsedLine[]) =>
    supabase.rpc('import_statement', {
      p_account_id: id,
      p_format_id: (formatId ?? null) as number, // 没选格式时传 null
      p_file_name: sheet && book && book.SheetNames.length > 1 ? `${fileName}（${sheet}）` : fileName,
      p_rows: rowsForRpc(lines),
      p_period_from: period ? period[0].format('YYYY-MM-DD') : undefined,
      p_period_to: period ? period[1].format('YYYY-MM-DD') : undefined,
    })

  const doImport = async () => {
    setResult(null)
    if (!multi) {
      if (!accountId) return message.error(t('先选收款账户'))
      if (!parsed.lines.length) return message.error(t('没有解析出收付记录，请检查列的对应'))
      setImporting(true)
      const { data, error } = await runImport(accountId, parsed.lines)
      setImporting(false)
      if (error) return message.error(t('导入失败：') + errorText(error))
      const r = data as ImportResult
      const chain = chainText(accountId, r)
      setResult({ ...r, accounts: 1, failed: [], multi: false, chainList: chain ? [chain] : [] })
      message.success(t('导入完成'))
      notifyJournalChanged()
      onDone()
      return
    }
    if (!readyGroups.length) return message.error(t('文件里的账户都没对上系统账户，请在“文件里的账户”表里选'))
    if (!period) return message.error(t('请选流水覆盖日期'))
    // 同一个系统账户可能对应文件里的几个名字，合在一起导。
    // 只有支出或“无交易”的账户也导一次（0 条），记下这段日期已经核对过，录了但银行没有的款才查得出来。
    const byId = new Map<number, ParsedLine[]>()
    for (const g of readyGroups) {
      const id = targetOf(g) as number
      byId.set(id, [...(byId.get(id) ?? []), ...g.lines])
    }
    setImporting(true)
    const sum: ImportSummary = {
      inserted: 0,
      skipped: 0,
      matched: 0,
      unmatched: 0,
      debits: 0,
      unfilled: 0,
      balance_filled: 0,
      accounts: 0,
      failed: [],
      multi: true,
      chainList: [],
    }
    for (const [id, lines] of byId) {
      const { data, error } = await runImport(id, lines)
      if (error) {
        sum.failed.push(`${accountById.get(id)?.short_name ?? id}：${errorText(error)}`)
        continue
      }
      const r = data as ImportResult
      sum.inserted += r.inserted
      sum.skipped += r.skipped
      sum.matched += r.matched
      sum.unmatched += r.unmatched
      sum.debits = (sum.debits ?? 0) + (r.debits ?? 0)
      sum.unfilled = (sum.unfilled ?? 0) + (r.unfilled ?? 0)
      sum.balance_filled = (sum.balance_filled ?? 0) + (r.balance_filled ?? 0)
      const chain = chainText(id, r)
      if (chain) sum.chainList.push(chain)
      sum.accounts += 1
    }
    setImporting(false)
    setResult(sum)
    notifyJournalChanged()
    if (sum.failed.length) message.warning(t('有 {n} 个账户没导进去，原因见下方', { n: sum.failed.length }))
    else message.success(t('导入完成'))
    onDone()
  }

  const saveFormat = async () => {
    const name = saveName.trim()
    if (!name) return message.error(t('给格式起个名字，如“GCB 网银 Excel”'))
    const pick = (i?: number) => (i === undefined ? undefined : headers[i])
    const row = {
      name,
      bank: !multi && accountId ? (accountById.get(accountId)?.bank ?? null) : null,
      header_row: headerRow,
      date_format: dateFormat,
      mapping: {
        date: pick(mapping.date),
        credit: pick(mapping.credit),
        debit: pick(mapping.debit),
        balance: pick(mapping.balance),
        drcr: pick(mapping.drcr),
        summary: pick(mapping.summary),
        ref: pick(mapping.ref),
        cheque: pick(mapping.cheque),
        account: pick(mapping.account),
      },
    }
    const { data, error } = await supabase.from('bank_import_formats').insert(row).select('*').single()
    if (error) return message.error(errorText(error))
    setFormats((f) => [...f, data])
    setFormatId(data.id)
    message.success(t('格式已保存，下次选它就不用再对列了'))
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
        placeholder={t('选列')}
      />
    </Col>
  )

  const previewColumns: ColumnsType<ParsedLine> = [
    ...(multi ? [{ title: t('账户'), dataIndex: 'account_key', width: 220, ellipsis: true }] : []),
    { title: t('日期'), dataIndex: 'line_date', width: 110 },
    { title: t('收入'), width: 130, align: 'right', render: (_, l) => (l.amount_orig > 0 ? money(l.amount_orig) : '') },
    {
      title: t('支出'),
      width: 130,
      align: 'right',
      render: (_, l) => (l.amount_orig < 0 ? <span className="text-warn">{money(-l.amount_orig)}</span> : ''),
    },
    { title: t('余额'), dataIndex: 'balance', width: 130, align: 'right', render: (v: number | null) => (v === null ? '' : money(v)) },
    {
      title: t('摘要'),
      dataIndex: 'payer_summary',
      ellipsis: true,
      render: (v: string, l) => (
        <>
          {l.ignored && <Tag>{t(l.note ?? '已忽略')}</Tag>}
          {v}
        </>
      ),
    },
    { title: t('参考号'), dataIndex: 'bank_ref', width: 160, ellipsis: true },
    { title: t('支票号'), dataIndex: 'cheque_no', width: 100 },
  ]

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10}>
            <div className="hint">
              {t('收款账户')}{!multi && <span className="text-danger"> *</span>}
            </div>
            {multi ? (
              <div style={{ lineHeight: '32px' }}>{t('文件里有“账户”列，按账户分别导入，不用选')}</div>
            ) : (
              <Select
                style={{ width: '100%' }}
                showSearch={{ optionFilterProp: 'label' }}
                options={accountOptions(bankAccounts)}
                value={accountId}
                onChange={onAccount}
                placeholder={t('这份流水是哪个账户的')}
              />
            )}
          </Col>
          <Col xs={24} md={8}>
            <div className="hint">{t('银行导出格式（保存过的）')}</div>
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
              placeholder={t('没有就不选，下面手工对列')}
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
          <p className="ant-upload-text">{fileName ? t('已读取：{fileName}（点这里换一个文件）', { fileName }) : t('把网银导出的 Excel / CSV，或每月的流水汇总表拖到这里，或点击选择')}</p>
          <p className="ant-upload-hint">{t('收、付都导进来（有余额列也导），同一份流水重复导入不会重复；以前只导了收入的，再导一次会补上付出去的和余额。')}</p>
        </Upload.Dragger>
      </Card>

      {sheetRows.length > 0 && (
        <Card size="small" title={t('对应列')} style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            {book && book.SheetNames.length > 1 && (
              <Col xs={24} md={8} lg={6}>
                <div className="hint">{t('工作表')}</div>
                <Select
                  style={{ width: '100%' }}
                  value={sheet}
                  onChange={(n: string) => loadSheet(book, n)}
                  options={book.SheetNames.map((n) => ({ value: n, label: n }))}
                />
              </Col>
            )}
            <Col xs={12} md={8} lg={4}>
              <div className="hint">{t('表头在第几行')}</div>
              <InputNumber min={1} max={50} value={headerRow} onChange={(v) => setHeaderRow(v ?? 1)} style={{ width: '100%' }} />
            </Col>
            {colSelect('date', t('日期列'), true)}
            {colSelect('credit', t('贷方 / 入账金额列'), mapping.debit === undefined)}
            {colSelect('debit', t('借方 / 支出金额列'))}
            {colSelect('balance', t('余额列'))}
            {colSelect('summary', t('摘要列'))}
            {colSelect('ref', t('参考号列'))}
            {colSelect('cheque', t('支票号列'))}
            {colSelect('drcr', t('借贷标志列（有就选）'))}
            {colSelect('account', t('账户列（一个文件多个账户时选）'))}
            <Col xs={12} md={8} lg={4}>
              <div className="hint">{t('日期格式')}</div>
              <Select style={{ width: '100%' }} value={dateFormat} onChange={setDateFormat} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />
            </Col>
          </Row>
          {isAdmin && (
            <Space style={{ marginTop: 12 }}>
              <Input placeholder={t('保存为格式，如“GCB 网银 Excel”')} value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ width: 260 }} />
              <Button onClick={saveFormat}>{t('保存格式')}</Button>
            </Space>
          )}
        </Card>
      )}

      {multi && sheetRows.length > 0 && (
        <Card
          size="small"
          title={t('文件里的账户：{total} 个，对上 {matched} 个', { total: groups.length, matched: readyGroups.length })}
          extra={<span className="hint">{t('按账户名自动对上；没对上的请选，留空就不导入')}</span>}
          style={{ marginBottom: 12 }}
        >
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={groups}
            scroll={{ y: 360 }}
            columns={[
              { title: t('文件里的账户'), dataIndex: 'key', ellipsis: true },
              { title: t('行数'), dataIndex: 'rows', width: 70, align: 'right' },
              { title: t('收入'), width: 170, align: 'right', render: (_, g) => (g.inN ? `${g.inN} · ${money(g.inSum)}` : '') },
              {
                title: t('支出'),
                width: 170,
                align: 'right',
                render: (_, g) => (g.outN ? <span className="text-warn">{`${g.outN} · ${money(g.outSum)}`}</span> : ''),
              },
              {
                title: t('对应系统账户'),
                width: 300,
                render: (_, g) => (
                  <Select
                    allowClear
                    size="small"
                    style={{ width: '100%' }}
                    showSearch={{ optionFilterProp: 'label' }}
                    options={accountOptions(bankAccounts)}
                    value={targetOf(g)}
                    status={targetOf(g) === undefined ? 'warning' : undefined}
                    placeholder={t('不导入')}
                    onChange={(v: number | undefined) => setAcctPick((p) => ({ ...p, [g.key]: v ?? null }))}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}

      {sheetRows.length > 0 && (
        <Card
          size="small"
          title={
            multi
              ? t('预览：收 {inN} 条、付 {outN} 条，{accounts} 个账户', { inN: parsedIO.inN, outN: parsedIO.outN, accounts: groups.length })
              : t('预览：收 {inN} 条 {inSum}，付 {outN} 条 {outSum}', {
                  inN: parsedIO.inN,
                  inSum: money(parsedIO.inSum),
                  outN: parsedIO.outN,
                  outSum: money(parsedIO.outSum),
                })
          }
          extra={
            <Space>
              <span className="hint">{t('流水覆盖日期')}</span>
              <DatePicker.RangePicker value={period} onChange={(v) => setPeriod(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
              <Button
                type="primary"
                loading={importing}
                onClick={doImport}
                disabled={multi ? !readyGroups.length : !parsed.lines.length || !accountId}
              >
                {t('导入并自动配对')}
              </Button>
            </Space>
          }
        >
          {parsed.bad.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              title={t('第 {rows} 行的日期认不出来，已跳过。请检查“日期格式”。', { rows: parsed.bad.slice(0, 10).join(t('、')) })}
            />
          )}
          {parsed.breaks.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              title={t('这份文件里的余额有 {n} 处接不上（第 {rows} 行）：文件可能不全，或者余额列、收付列对错了。照样可以导，导完再看日记账的余额。', {
                n: parsed.breaks.length,
                rows: parsed.breaks
                  .slice(0, 10)
                  .map((b) => b.row)
                  .join(t('、')),
              })}
            />
          )}
          {parsed.reversals.some((r) => r.paired) && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              title={t('有 {n} 对退票或冲回（先入账、后来又被冲掉的同额款）：两条都导进来、标成“已忽略”，不会配到账，余额照算。', {
                n: parsed.reversals.filter((r) => r.paired).length,
              })}
            />
          )}
          {parsed.reversals.some((r) => !r.paired) && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              title={t('下面这些冲回在这份文件里找不到原来那笔入账（多半在上个月的流水里），导进来算付出去的。请到“全部流水明细”找到原来那笔入账，配过对的先取消配对，再把两条都忽略。')}
              description={parsed.reversals
                .filter((r) => !r.paired)
                .map((r) => [r.account_key, r.line_date, t('冲回'), money(r.amount), r.payer_summary].filter(Boolean).join(' '))
                .join(t('；'))}
            />
          )}
          {result && (
            <Alert
              type={result.failed.length || result.chainList.length ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 8 }}
              title={
                (result.multi ? t('导入了 {n} 个账户：', { n: result.accounts }) : '') +
                t('新导入 {inserted} 条（其中付出去的 {debits} 条，重复跳过 {skipped} 条），自动配对上 {matched} 笔。', {
                  inserted: result.inserted,
                  debits: result.debits ?? 0,
                  skipped: result.skipped,
                  matched: result.matched,
                }) +
                t('还有 {unmatched} 条收入没人报（到“银行有、没人报”处理）、{unfilled} 条付款待填（到“付款待填”填）。', {
                  unmatched: result.unmatched,
                  unfilled: result.unfilled ?? 0,
                }) +
                (result.balance_filled ? t('以前导过的 {n} 条补上了余额。', { n: result.balance_filled }) : '')
              }
              description={
                result.failed.length || result.chainList.length ? (
                  <>
                    {result.chainList.length > 0 && (
                      <div>
                        {t('余额接不上：{list}。多半是中间漏导了一段流水，补导缺的那段就好。', { list: result.chainList.join(t('；')) })}
                      </div>
                    )}
                    {result.failed.length > 0 && <div>{t('没导进去的账户：{list}', { list: result.failed.join(t('；')) })}</div>}
                  </>
                ) : undefined
              }
            />
          )}
          <Table rowKey="row" size="small" dataSource={parsed.lines} pagination={{ defaultPageSize: 20 }} columns={previewColumns} />
        </Card>
      )}
    </div>
  )
}
