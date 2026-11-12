import { PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ChequeDetail from '../components/ChequeDetail'
import ChequeEditor from '../components/ChequeEditor'
import ChequeImport from '../components/ChequeImport'
import ReceiptEditor from '../components/ReceiptEditor'
import type { ReceiptPrefill } from '../components/ReceiptEditor'
import { useAuth } from '../lib/auth'
import { CHEQUE_ALERT_LABEL, CHEQUE_ALERTS, CHEQUE_STATUS_COLOR, CHEQUE_STATUS_LABEL, CHEQUE_STATUSES, chequeStatus, inAlert } from '../lib/cheques'
import type { Cheque, ChequeAlert, ChequeStatus } from '../lib/cheques'
import { pickCol, textCol } from '../lib/colFilter'
import { cleanSearch, money, shortDate, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { accountOptions, useRefData } from '../lib/refdata'
import { fetchAll, supabase } from '../lib/supabase'

// 支票管理：客户给的（分期）支票一张一行。顶上几个提醒数字点开就是清单；点一行看详情、做操作（存票、对到账、退票…）。
// 读 v_cheques（一次全部读回来，筛选在页面上做，提醒数字按全部算）。写都走数据库函数。

type StatusFilter = 'open' | 'all' | ChequeStatus
const OPEN_STATUSES: string[] = ['pending', 'confirming', 'deposited', 'bounced']

export default function ChequesPage() {
  const t = useT()
  const { isStaff } = useAuth()
  const { accounts, salespersons } = useRefData()
  const [rows, setRows] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [alert, setAlert] = useState<ChequeAlert | null>(null)
  const [salespersonId, setSalespersonId] = useState<number | undefined>()
  const [accountId, setAccountId] = useState<number | undefined>()
  const [q, setQ] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; cheque: Cheque | null }>({ open: false, cheque: null })
  const [detailId, setDetailId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [receipt, setReceipt] = useState<{ open: boolean; id: number | null; prefill: ReceiptPrefill | null }>({ open: false, id: null, prefill: null })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await fetchAll<Cheque>(() =>
      supabase.from('v_cheques').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
    )
    setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 到账那边有变化（审核通过、删除）也会影响支票的到账状态
  useEffect(() => {
    const h = () => void load()
    window.addEventListener('submissions-changed', h)
    return () => window.removeEventListener('submissions-changed', h)
  }, [load])

  const alertCount = useMemo(() => Object.fromEntries(CHEQUE_ALERTS.map((a) => [a, rows.filter((c) => inAlert(c, a)).length])) as Record<ChequeAlert, number>, [rows])

  const shown = useMemo(() => {
    const s = cleanSearch(q).toLowerCase()
    return rows.filter((c) => {
      if (alert) {
        if (!inAlert(c, alert)) return false
      } else if (status === 'open') {
        if (!OPEN_STATUSES.includes(c.status ?? '')) return false
      } else if (status !== 'all' && c.status !== status) return false
      if (salespersonId && c.salesperson_id !== salespersonId) return false
      if (accountId && c.deposit_account_id !== accountId) return false
      if (s && !`${c.cheque_no ?? ''} ${c.customer_name ?? ''} ${c.drawer_name ?? ''} ${c.vin ?? ''} ${c.drawer_bank ?? ''}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [rows, alert, status, salespersonId, accountId, q])

  const detail = detailId == null ? null : (rows.find((c) => c.id === detailId) ?? null)

  const createReceipt = (c: Cheque) => {
    setReceipt({
      open: true,
      id: null,
      prefill: {
        account_id: c.deposit_account_id ?? undefined,
        receipt_date: c.deposit_date ?? undefined,
        amount_orig: c.amount != null ? Number(c.amount) : undefined,
        cheque_no: c.cheque_no,
        payer_summary: c.drawer_name ?? c.customer_name,
        cheque_id: c.id ?? undefined,
        claims: c.vehicle_id
          ? [{ nature: c.purpose === '配件款' ? '配件款' : c.purpose === '预付款' ? '预付款' : '分期款', vehicle_id: c.vehicle_id, customer_id: c.customer_id, amount_orig: c.amount != null ? Number(c.amount) : null }]
          : c.customer_id
            ? [{ customer_id: c.customer_id, amount_orig: c.amount != null ? Number(c.amount) : null }]
            : [],
      },
    })
  }

  const dueCell = (c: Cheque) => {
    if (!c.due_date) return <span className="hint">{t('没写')}</span>
    const d = c.days_to_due
    const open = OPEN_STATUSES.includes(c.status ?? '') && c.status !== 'deposited'
    const cls = !open || d == null ? '' : d < 0 ? 'text-danger' : d <= 7 ? 'text-warn' : ''
    const hint = !open || d == null ? '' : d < 0 ? t('过了 {n} 天', { n: -d }) : d === 0 ? t('今天') : t('还有 {n} 天', { n: d })
    return (
      <span className={cls}>
        {c.due_date}
        {hint && <div className="hint">{hint}</div>}
      </span>
    )
  }

  const columns: ColumnsType<Cheque> = [
    {
      title: t('状态'),
      width: 110,
      render: (_, c) => <Tag color={CHEQUE_STATUS_COLOR[chequeStatus(c.status)]}>{t(CHEQUE_STATUS_LABEL[chequeStatus(c.status)])}</Tag>,
      ...pickCol(rows, (c) => CHEQUE_STATUS_LABEL[chequeStatus(c.status)], t),
    },
    {
      title: t('支票号'),
      width: 130,
      render: (_, c) => (
        <span className="num">
          {c.cheque_no}
          {c.drawer_bank && <div className="hint">{c.drawer_bank}</div>}
        </span>
      ),
      ...textCol<Cheque>((c) => `${c.cheque_no ?? ''} ${c.drawer_bank ?? ''}`),
    },
    {
      title: t('客户'),
      width: 200,
      ellipsis: true,
      render: (_, c) => (
        <span>
          {c.customer_name}
          {c.drawer_name && c.drawer_name !== c.customer_name && <div className="hint">{c.drawer_name}</div>}
        </span>
      ),
      ...textCol<Cheque>((c) => `${c.customer_name ?? ''} ${c.drawer_name ?? ''}`),
    },
    {
      title: t('车'),
      width: 190,
      ellipsis: true,
      render: (_, c) =>
        c.vin ? (
          <span>
            <span className="cv-vin">{c.vin}</span>
            {c.model && <div className="hint">{c.model}</div>}
          </span>
        ) : (
          ''
        ),
      ...textCol<Cheque>((c) => `${c.vin ?? ''} ${c.model ?? ''}`),
    },
    { title: t('业务员'), dataIndex: 'salesperson_name', width: 110, ellipsis: true, ...pickCol(rows, (c) => c.salesperson_name) },
    { title: t('用途'), dataIndex: 'purpose', width: 90, render: (v: string) => t(v), ...pickCol(rows, (c) => c.purpose, t) },
    {
      title: t('金额'),
      width: 130,
      align: 'right',
      render: (_, c) => <span className="num">{c.amount == null ? <span className="hint">{t('空白')}</span> : `${c.currency} ${money(c.amount)}`}</span>,
      ...textCol<Cheque>((c) => (c.amount == null ? '' : `${c.currency} ${money(c.amount)}`)),
    },
    { title: t('分期款 USD'), dataIndex: 'installment_usd', width: 100, align: 'right', render: (v: number | null) => (v == null ? '' : <span className="num">{usd(v)}</span>) },
    { title: t('到期日期'), width: 110, render: (_, c) => dueCell(c), ...textCol<Cheque>((c) => c.due_date) },
    {
      title: t('存票'),
      width: 190,
      ellipsis: true,
      render: (_, c) =>
        c.deposit_date ? (
          <span>
            {c.deposit_date}
            {c.deposit_account_name && <div className="hint">{c.deposit_account_name}</div>}
          </span>
        ) : c.plan_date ? (
          <span className="hint">{t('计划 {date}', { date: c.plan_date })}</span>
        ) : (
          ''
        ),
      ...pickCol(rows, (c) => c.deposit_account_name),
    },
    {
      title: t('到账'),
      width: 150,
      render: (_, c) =>
        c.receipt_id ? (
          <span>
            <a
              onClick={(e) => {
                e.stopPropagation()
                setReceipt({ open: true, id: c.receipt_id, prefill: null })
              }}
            >
              {c.receipt_no ?? `#${c.receipt_id}`}
            </a>
            <div>{c.is_reported ? <Tag color="green">{t('已报')}</Tag> : <Tag color="blue">{t('未报')}</Tag>}</div>
          </span>
        ) : c.status === 'deposited' && c.days_deposited != null ? (
          <span className={c.days_deposited >= 3 ? 'text-warn' : 'hint'}>{t('存了 {n} 天', { n: c.days_deposited })}</span>
        ) : (
          ''
        ),
      ...pickCol(rows, (c) => (c.receipt_id ? (c.is_reported ? '已报' : '未报') : ''), t),
    },
    {
      title: t('最近沟通'),
      ellipsis: true,
      render: (_, c) =>
        c.last_note ? (
          <Tooltip title={c.last_note}>
            <span>
              <span className="hint">{shortDate(c.last_note_at)} </span>
              {c.last_note}
            </span>
          </Tooltip>
        ) : (
          <span className="hint">{c.reason ?? c.note ?? ''}</span>
        ),
      ...textCol<Cheque>((c) => `${c.last_note ?? ''} ${c.reason ?? ''} ${c.note ?? ''}`),
    },
  ]

  const statusOptions = [
    { value: 'open', label: t('还在处理的') },
    { value: 'all', label: t('全部') },
    ...CHEQUE_STATUSES.map((s) => ({ value: s, label: t(CHEQUE_STATUS_LABEL[s]) })),
  ]

  return (
    <div className="cheques-page">
      <Space wrap className="cheque-alerts" style={{ marginBottom: 12 }}>
        {CHEQUE_ALERTS.map((a) => (
          <Button
            key={a}
            className={`cheque-alert cheque-alert-${a}${alert === a ? ' active' : ''}`}
            type={alert === a ? 'primary' : 'default'}
            danger={a === 'overdue' && alertCount[a] > 0 && alert !== a}
            onClick={() => setAlert(alert === a ? null : a)}
          >
            {t(CHEQUE_ALERT_LABEL[a])} <b>{alertCount[a]}</b>
          </Button>
        ))}
      </Space>
      <Space wrap className="filters">
        <Select style={{ width: 150 }} value={alert ? 'all' : status} disabled={!!alert} onChange={(v: StatusFilter) => setStatus(v)} options={statusOptions} />
        <Select
          allowClear
          placeholder={t('业务员')}
          style={{ width: 140 }}
          showSearch={{ optionFilterProp: 'label' }}
          value={salespersonId}
          onChange={setSalespersonId}
          options={salespersons.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          allowClear
          placeholder={t('存票账户')}
          style={{ width: 220 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={accountOptions(accounts, false)}
          value={accountId}
          onChange={setAccountId}
        />
        <Input.Search allowClear placeholder={t('支票号、客户、户名、大架号')} style={{ width: 240 }} onSearch={setQ} />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        {isStaff && (
          <>
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              {t('导入表格')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, cheque: null })}>
              {t('录支票')}
            </Button>
          </>
        )}
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={shown}
        scroll={{ x: 1600 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => t('共 {n} 张支票', { n }) }}
        rowClassName={() => 'clickable-row'}
        onRow={(c) => ({ onClick: () => setDetailId(c.id) })}
      />
      <ChequeEditor
        open={editor.open}
        cheque={editor.cheque}
        onClose={(changed) => {
          setEditor({ open: false, cheque: null })
          if (changed) void load()
        }}
      />
      <ChequeDetail
        open={detailId != null}
        cheque={detail}
        onClose={() => setDetailId(null)}
        onChanged={() => void load()}
        onEdit={(c) => setEditor({ open: true, cheque: c })}
        onCreateReceipt={createReceipt}
        onOpenReceipt={(id) => setReceipt({ open: true, id, prefill: null })}
      />
      <ChequeImport
        open={importOpen}
        onClose={(changed) => {
          setImportOpen(false)
          if (changed) void load()
        }}
      />
      <ReceiptEditor
        open={receipt.open}
        receiptId={receipt.id}
        prefill={receipt.prefill}
        onClose={(changed) => {
          setReceipt({ open: false, id: null, prefill: null })
          if (changed) void load()
        }}
      />
    </div>
  )
}
