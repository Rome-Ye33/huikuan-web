import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled, LeftOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Col, DatePicker, Input, Row, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CashEntryEditor from '../components/CashEntryEditor'
import type { CashEntryPrefill } from '../components/CashEntryEditor'
import OpeningEditor from '../components/OpeningEditor'
import ReceiptEditor from '../components/ReceiptEditor'
import type { ReceiptPrefill } from '../components/ReceiptEditor'
import { useAuth } from '../lib/auth'
import { cleanSearch, money, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import {
  ACCT_STATUS_COLOR,
  accountGroup,
  acctStatus,
  buildLedger,
  currencyRank,
  CURRENCY_ZH,
  FILL_COLOR,
  groupRank,
  isCashLike,
  JOURNAL_MODULES,
  moduleColor,
  monthRange,
  SCOPE_PERM,
  SCOPE_TITLE,
  scopeOf,
} from '../lib/journal'
import type { AccountMonth, AcctStatus, FillHow, JournalLine, JournalScope, LedgerRow } from '../lib/journal'
import { describeGroup, groupLogs, LOG_KINDS } from '../lib/journalLog'
import type { JournalLog, LogGroup } from '../lib/journalLog'
import { accountOptions, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Account } from '../lib/supabase'

// 银行日记账、现金日记账：照《终端解款表》做的，两本分开（两个菜单、两个模块权限），同一个页面，scope 不一样。
// 银行日记账（scope bank）：银行账户先导流水再填（在「银行对账」里导入、填写）：日记账一行就是一条银行流水，金额、日期、余额都是银行的，
//   所以余额和银行一致；还没填的也算进余额，标「待填」。
// 现金日记账（scope cash）：现金、momo 没有流水，收支在这里一笔一笔记；客户交的现金走到账录入，审批通过后自动进来。
// 现金存现、银行取现这类账户互转记一次，两边各一笔，两本日记账都出现。
// 账户余额 = 解款表的“银行主页 / 现金主页”：每个账户这个月的月初余额、收、付、月末余额，流水填完了没有。
// 日记账明细 = 一个账户一段时间里的每一笔，每行带余额，每天一行小计。
// 修改记录 = 这本日记账里谁、什么时候、做了什么（数据库触发器记的）。

type Editor = { open: boolean; id: number | null; prefill: CashEntryPrefill | null }

export default function JournalPage({ scope }: { scope: JournalScope }) {
  const t = useT()
  const jEdit = useAuth().canEdit(SCOPE_PERM[scope])
  const { accounts } = useRefData()
  const [tab, setTab] = useState('summary')
  const [month, setMonth] = useState(todayAccra().slice(0, 7))
  const [accountId, setAccountId] = useState<number | undefined>()
  const [editor, setEditor] = useState<Editor>({ open: false, id: null, prefill: null })
  const [receipt, setReceipt] = useState<{ open: boolean; id: number | null; prefill: ReceiptPrefill | null }>({ open: false, id: null, prefill: null })
  const [openingOpen, setOpeningOpen] = useState(false)
  const [version, setVersion] = useState(0)

  // 别处（录到账、填流水、改期初）改了就重读
  useEffect(() => {
    const h = () => setVersion((x) => x + 1)
    window.addEventListener('journal-changed', h)
    window.addEventListener('submissions-changed', h)
    return () => {
      window.removeEventListener('journal-changed', h)
      window.removeEventListener('submissions-changed', h)
    }
  }, [])

  // 点一行：填好的流水打开它填成的那一笔；现金账户的打开那一笔
  const openLine = (l: JournalLine) => {
    const rid = l.receipt_id ?? (l.source === 'receipt' ? l.source_id : null)
    const eid = l.entry_id ?? (l.source === 'entry' ? l.source_id : null)
    if (rid) setReceipt({ open: true, id: rid, prefill: null })
    else if (eid) setEditor({ open: true, id: eid, prefill: null })
  }
  // 填一条待填的流水：日期、账户、金额都照银行的
  const fill = (l: JournalLine, how: FillHow) => {
    const amt = Number(l.amount_in ?? 0) || Number(l.amount_out ?? 0)
    const line = { entry_date: l.entry_date ?? undefined, summary: l.bank_summary, bank_ref: l.bank_ref, bank_summary: l.bank_summary, line_id: l.line_id ?? undefined }
    if (how === 'receipt')
      setReceipt({
        open: true,
        id: null,
        prefill: { account_id: l.account_id ?? undefined, receipt_date: l.entry_date ?? undefined, amount_orig: amt, payer_summary: l.bank_summary, bank_ref: l.bank_ref, line_id: l.line_id ?? undefined },
      })
    else if (how === 'transfer' && l.amount_in) setEditor({ open: true, id: null, prefill: { ...line, kind: 'transfer', to_account_id: l.account_id ?? undefined, to_amount: amt } })
    else setEditor({ open: true, id: null, prefill: { ...line, kind: how, account_id: l.account_id ?? undefined, amount: amt } })
  }
  const noOpening = accounts.length > 0 && !accounts.some((a) => a.opening_date)

  return (
    <div>
      <div className="page-title">
        <h2>{t(SCOPE_TITLE[scope])}</h2>
        <Space wrap>
          {jEdit && (
            <Button icon={<SettingOutlined />} onClick={() => setOpeningOpen(true)}>
              {t('期初余额')}
            </Button>
          )}
          {jEdit && scope === 'cash' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, id: null, prefill: null })}>
              {t('记一笔现金')}
            </Button>
          )}
        </Space>
      </div>
      {noOpening && (
        <Alert
          type="warning"
          showIcon
          className="filters"
          title={t('还没设期初余额：先点右上角「期初余额」，填开始用系统那天每个账户有多少钱，余额才对得上。')}
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'summary',
            label: t('账户余额'),
            children: (
              <SummaryTab
                scope={scope}
                month={month}
                onMonth={setMonth}
                version={version}
                onPick={(id) => {
                  setAccountId(id)
                  setTab('ledger')
                }}
              />
            ),
          },
          {
            key: 'ledger',
            label: t('日记账明细'),
            children: <LedgerTab scope={scope} month={month} accountId={accountId} onAccount={setAccountId} version={version} onOpen={openLine} onFill={fill} />,
          },
          {
            key: 'log',
            label: t('修改记录'),
            children: <LogTab scope={scope} version={version} />,
          },
        ]}
      />
      <CashEntryEditor
        open={editor.open}
        entryId={editor.id}
        prefill={editor.prefill}
        defaultAccountId={accountId}
        onClose={(changed) => {
          setEditor({ open: false, id: null, prefill: null })
          if (changed) setVersion((x) => x + 1)
        }}
      />
      <ReceiptEditor
        open={receipt.open}
        receiptId={receipt.id}
        prefill={receipt.prefill}
        onClose={(changed) => {
          setReceipt({ open: false, id: null, prefill: null })
          if (changed) setVersion((x) => x + 1)
        }}
      />
      <OpeningEditor
        open={openingOpen}
        scope={scope}
        onClose={(changed) => {
          setOpeningOpen(false)
          if (changed) setVersion((x) => x + 1)
        }}
      />
    </div>
  )
}

/** 选月份：◀ 2026-11 ▶ */
function MonthPicker({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const t = useT()
  const shift = (n: number) => onMonth(dayjs(month + '-01').add(n, 'month').format('YYYY-MM'))
  return (
    <Space.Compact>
      <Tooltip title={t('上个月')}>
        <Button icon={<LeftOutlined />} onClick={() => shift(-1)} />
      </Tooltip>
      <DatePicker picker="month" value={dayjs(month + '-01')} allowClear={false} onChange={(d) => d && onMonth(d.format('YYYY-MM'))} />
      <Tooltip title={t('下个月')}>
        <Button icon={<RightOutlined />} onClick={() => shift(1)} disabled={month >= todayAccra().slice(0, 7)} />
      </Tooltip>
    </Space.Compact>
  )
}

/** 银行账户的流水填完了没有、余额接不接得上 */
function StatusTag({ status, m }: { status: AcctStatus; m: AccountMonth }) {
  const t = useT()
  if (status === 'cash') return <span className="hint">{t('现金')}</span>
  const label =
    status === 'ok' ? t('已填完') : status === 'todo' ? t('待填 {n} 条', { n: m.unfilled_n }) : status === 'broken' ? t('余额接不上') : t('没有流水')
  // 以前导的流水没有余额列：只能看填没填完，对不了余额
  const hasBank = m.bank_balance !== null && m.bank_balance !== undefined
  const tip =
    status === 'ok'
      ? hasBank
        ? t('流水都填好了，余额和银行一致')
        : t('流水都填好了（这段流水没有余额列，对不了余额）')
      : status === 'todo'
        ? hasBank
          ? t('还有 {n} 条银行流水没填业务模块和摘要；余额已经算进去了，和银行一致', { n: m.unfilled_n })
          : t('还有 {n} 条银行流水没填业务模块和摘要', { n: m.unfilled_n })
        : status === 'broken'
          ? t('按期初和流水算到 {date} 是 {book}，银行流水上那天的余额是 {bank}，差 {diff}：多半是漏导了一段流水，或者期初余额填错了', {
              date: (m.bank_date ?? '').slice(5),
              book: money(round2(Number(m.bank_balance) + Number(m.bank_diff ?? 0))),
              bank: money(m.bank_balance),
              diff: money(m.bank_diff),
            })
          : t('这段时间没有这个账户的银行流水')
  return (
    <Tooltip title={tip}>
      <Tag color={ACCT_STATUS_COLOR[status]}>{label}</Tag>
    </Tooltip>
  )
}

// ---------------------------------------------------------------- 账户余额
type SumRow =
  | { type: 'group'; key: string; label: string }
  | { type: 'acct'; key: string; a: Account; m: AccountMonth; status: AcctStatus }
  | { type: 'total'; key: string; label: string; currency: string; opening: number; income: number; expense: number; closing: number }

function SummaryTab({
  scope,
  month,
  onMonth,
  version,
  onPick,
}: {
  scope: JournalScope
  month: string
  onMonth: (m: string) => void
  version: number
  onPick: (id: number) => void
}) {
  const t = useT()
  const { accounts: all } = useRefData()
  const accounts = useMemo(() => all.filter((a) => scopeOf(a) === scope), [all, scope])
  const [data, setData] = useState<AccountMonth[]>([])
  const [loading, setLoading] = useState(false)
  const [group, setGroup] = useState<string | undefined>()
  const [onlyActive, setOnlyActive] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [from, to] = monthRange(month)
    const { data } = await supabase.rpc('journal_month', { p_from: from, p_to: to })
    setData(data ?? [])
    setLoading(false)
  }, [month])

  useEffect(() => {
    void load()
  }, [load, version])

  // 每个账户一行，按 FET AUTO / FEIYA / FET MINING / 其他 / 现金分组，组里先塞地、后美元；每组末尾按币种加合计
  const { rows, totals, counts } = useMemo(() => {
    const byId = new Map(data.map((m) => [m.account_id, m]))
    const list = accounts
      .map((a) => ({ a, m: byId.get(a.id) }))
      .filter((x): x is { a: Account; m: AccountMonth } => !!x.m)
      .filter(({ a, m }) => !onlyActive || a.active || Math.abs(Number(m.closing)) > 0.004 || Number(m.income) > 0 || Number(m.expense) > 0)
      .filter(({ a }) => !group || accountGroup(a) === group)
      .sort(
        (x, y) =>
          groupRank(accountGroup(x.a)) - groupRank(accountGroup(y.a)) ||
          currencyRank(x.a.currency) - currencyRank(y.a.currency) ||
          x.a.short_name.localeCompare(y.a.short_name),
      )
    const out: SumRow[] = []
    const totals = new Map<string, { closing: number; n: number }>()
    const counts = { ok: 0, todo: 0, broken: 0, none: 0, cash: 0, lines: 0, entries: 0, pending: 0 }
    let g: string | null = null
    let sub = new Map<string, { opening: number; income: number; expense: number; closing: number }>()
    const flush = () => {
      if (g === null) return
      for (const [cur, s] of [...sub.entries()].sort((a, b) => currencyRank(a[0]) - currencyRank(b[0])))
        out.push({ type: 'total', key: `total-${g}-${cur}`, label: g, currency: cur, ...s })
      sub = new Map()
    }
    for (const { a, m } of list) {
      const grp = accountGroup(a)
      if (grp !== g) {
        flush()
        g = grp
        out.push({ type: 'group', key: `group-${grp}`, label: grp })
      }
      const status = acctStatus(m, isCashLike(a))
      counts[status]++
      counts.lines += Number(m.unfilled_n ?? 0)
      counts.entries += Number(m.line_n ?? 0)
      counts.pending += Number(m.pending_n ?? 0)
      out.push({ type: 'acct', key: `a-${a.id}`, a, m, status })
      const s = sub.get(a.currency) ?? { opening: 0, income: 0, expense: 0, closing: 0 }
      s.opening = round2(s.opening + Number(m.opening))
      s.income = round2(s.income + Number(m.income))
      s.expense = round2(s.expense + Number(m.expense))
      s.closing = round2(s.closing + Number(m.closing))
      sub.set(a.currency, s)
      const tt = totals.get(a.currency) ?? { closing: 0, n: 0 }
      tt.closing = round2(tt.closing + Number(m.closing))
      tt.n += 1
      totals.set(a.currency, tt)
    }
    flush()
    return { rows: out, totals: [...totals.entries()].sort((a, b) => currencyRank(a[0]) - currencyRank(b[0])), counts }
  }, [data, accounts, group, onlyActive])

  const groups = [...new Set(accounts.map(accountGroup))].sort((a, b) => groupRank(a) - groupRank(b))
  const isLast = month === todayAccra().slice(0, 7)
  const amt = (v: number | null | undefined) => <span className="num">{money(v)}</span>
  const span = (r: SumRow, n: number) => (r.type === 'group' ? { colSpan: n } : {})
  const hide = (r: SumRow) => (r.type === 'group' ? { colSpan: 0 } : {})

  const columns: ColumnsType<SumRow> = [
    {
      title: t('币别'),
      width: 64,
      onCell: (r) => span(r, 9),
      render: (_, r) =>
        r.type === 'group' ? <span className="group-title">{t(r.label)}</span> : r.type === 'acct' ? t(CURRENCY_ZH[r.a.currency] ?? r.a.currency) : null,
    },
    {
      title: t('账户'),
      width: 260,
      onCell: hide,
      render: (_, r) =>
        r.type === 'acct' ? (
          <span>
            <a>{r.a.short_name}</a>
            {!r.m.has_opening && (
              <Tooltip title={t('这个账户还没设期初余额，按 0 算')}>
                <Tag className="tag-mini">{t('没设期初')}</Tag>
              </Tooltip>
            )}
            {Number(r.m.waiting_n) > 0 && (
              <Tooltip title={t('已经录了（到账或互转），银行流水里还没有，共 {amt}；流水导进来会自动对上，现在不算进余额', { amt: money(r.m.waiting_amount) })}>
                <Tag color="blue" className="tag-mini">
                  {t('{n} 笔等流水', { n: r.m.waiting_n })}
                </Tag>
              </Tooltip>
            )}
            {Number(r.m.pending_n) > 0 && (
              <Tooltip title={t('{n} 笔到账在审批中，共 {amt}，审批通过后才算进来', { n: r.m.pending_n, amt: money(r.m.pending_amount) })}>
                <Tag color="gold" className="tag-mini">
                  {t('{n} 笔审批中', { n: r.m.pending_n })}
                </Tag>
              </Tooltip>
            )}
          </span>
        ) : r.type === 'total' ? (
          <b>{t('{group} {cur}合计', { group: t(r.label), cur: t(CURRENCY_ZH[r.currency] ?? r.currency) })}</b>
        ) : null,
    },
    { title: t('月初余额'), width: 140, align: 'right', onCell: hide, render: (_, r) => (r.type === 'acct' ? amt(r.m.opening) : r.type === 'total' ? amt(r.opening) : null) },
    {
      title: t('本月收款'),
      width: 140,
      align: 'right',
      onCell: hide,
      render: (_, r) => (r.type === 'acct' ? <span className="num text-ok">{Number(r.m.income) ? money(r.m.income) : ''}</span> : r.type === 'total' ? amt(r.income) : null),
    },
    {
      title: t('本月支出'),
      width: 140,
      align: 'right',
      onCell: hide,
      render: (_, r) => (r.type === 'acct' ? <span className="num text-warn">{Number(r.m.expense) ? money(r.m.expense) : ''}</span> : r.type === 'total' ? amt(r.expense) : null),
    },
    {
      title: isLast ? t('现在余额') : t('月末余额'),
      width: 150,
      align: 'right',
      onCell: hide,
      render: (_, r) =>
        r.type === 'acct' ? (
          <b className={`num bal-${r.status}`}>{money(r.m.closing)}</b>
        ) : r.type === 'total' ? (
          <b className="num">{money(r.closing)}</b>
        ) : null,
    },
    {
      title: t('银行余额'),
      width: 150,
      align: 'right',
      onCell: hide,
      render: (_, r) =>
        r.type === 'acct' && r.m.bank_balance != null ? (
          <span className="num">
            {money(r.m.bank_balance)}
            <div className="hint">{t('流水到 {date}', { date: r.m.bank_date?.slice(5) ?? '' })}</div>
          </span>
        ) : null,
    },
    {
      title: t('流水'),
      width: 120,
      onCell: hide,
      render: (_, r) => (r.type === 'acct' ? <StatusTag status={r.status} m={r.m} /> : null),
    },
    { title: '', onCell: hide, render: () => null },
  ]

  return (
    <div>
      <Space wrap className="filters">
        <MonthPicker month={month} onMonth={onMonth} />
        {groups.length > 1 && (
          <Select
            allowClear
            placeholder={t('全部分组')}
            style={{ width: 170 }}
            value={group}
            onChange={setGroup}
            options={groups.map((g) => ({ value: g, label: t(g) }))}
          />
        )}
        <Checkbox checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)}>
          {t('不看停用、没钱也没发生额的账户')}
        </Checkbox>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('刷新')}
        </Button>
      </Space>
      <Row gutter={[12, 12]} className="balance-cards">
        {totals.map(([cur, v]) => (
          <Col key={cur} xs={24} sm={12} lg={6}>
            <Card size="small">
              <div className="hint">{scope === 'bank' ? t('{cur} 银行余额合计', { cur: t(CURRENCY_ZH[cur] ?? cur) }) : t('{cur} 现金余额合计', { cur: t(CURRENCY_ZH[cur] ?? cur) })}</div>
              <div className="balance-big num">
                {cur} {money(v.closing)}
              </div>
              <div className="hint">{t('{n} 个账户', { n: v.n })}</div>
            </Card>
          </Col>
        ))}
        <Col xs={24} sm={24} lg={12}>
          {scope === 'bank' ? (
            <Card size="small">
              <div className="hint">{t('这个月的银行流水')}</div>
              <Space size={[14, 4]} wrap className="check-counts">
                <span>
                  <CheckCircleFilled className="text-ok" /> {t('已填完 {n} 个账户', { n: counts.ok })}
                </span>
                <span>
                  <ExclamationCircleFilled className={counts.lines ? 'text-orange' : 'hint'} /> {t('待填 {n} 条', { n: counts.lines })}
                </span>
                <span>
                  <CloseCircleFilled className={counts.broken ? 'text-danger' : 'hint'} /> {t('余额接不上 {n} 个', { n: counts.broken })}
                </span>
                <span className="hint">{t('没有流水 {n} 个', { n: counts.none })}</span>
                <Link to="/reconcile">{t('去银行对账导入、填写 →')}</Link>
              </Space>
            </Card>
          ) : (
            <Card size="small">
              <div className="hint">{t('这个月的现金')}</div>
              <Space size={[14, 4]} wrap className="check-counts">
                <span>
                  <CheckCircleFilled className="text-ok" /> {t('记了 {n} 笔', { n: counts.entries })}
                </span>
                <span>
                  <ClockCircleOutlined className={counts.pending ? 'text-orange' : 'hint'} /> {t('{n} 笔现金到账在审批中', { n: counts.pending })}
                </span>
              </Space>
            </Card>
          )}
        </Col>
      </Row>
      <Table<SumRow>
        size="small"
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1180 }}
        className="journal-summary"
        rowClassName={(r) => (r.type === 'group' ? 'row-group' : r.type === 'total' ? 'row-total' : 'clickable-row')}
        onRow={(r) => (r.type === 'acct' ? { onClick: () => onPick(r.a.id) } : {})}
      />
      <Typography.Paragraph type="secondary" className="journal-note">
        {scope === 'bank'
          ? t('银行账户的收付就是导进来的银行流水（在「银行对账」里导入、填写），余额跟着银行走；还没填的流水也算进余额，标「待填」。现金存现、银行取现记一次，银行日记账和现金日记账都会出现。')
          : t('现金、momo 账户的收付在这里一笔一笔记；客户交的现金走到账录入，审批通过后自动进来。存进银行、从银行取现记成「账户互转」，银行那一边等流水导进来自动对上。')}
      </Typography.Paragraph>
    </div>
  )
}

// ---------------------------------------------------------------- 日记账明细
function LedgerTab({
  scope,
  month,
  accountId,
  onAccount,
  version,
  onOpen,
  onFill,
}: {
  scope: JournalScope
  month: string
  accountId?: number
  onAccount: (id: number | undefined) => void
  version: number
  onOpen: (l: JournalLine) => void
  onFill: (l: JournalLine, how: FillHow) => void
}) {
  const t = useT()
  const { canEdit, mine } = useAuth()
  const jEdit = canEdit('journal')
  const rxEdit = canEdit('receipts')
  const { accounts: all, accountById } = useRefData()
  const accounts = useMemo(() => all.filter((a) => scopeOf(a) === scope), [all, scope])
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => {
    const [a, b] = monthRange(month)
    const end = dayjs(b).isAfter(dayjs(todayAccra())) ? dayjs(todayAccra()) : dayjs(b)
    return [dayjs(a), end]
  })
  const [lines, setLines] = useState<JournalLine[]>([])
  const [head, setHead] = useState<AccountMonth | null>(null)
  const [loading, setLoading] = useState(false)
  const [modules, setModules] = useState<string[]>([])
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [q, setQ] = useState('')
  const [daySub, setDaySub] = useState(true)
  const acct = accountId ? accountById.get(accountId) : undefined

  // 从“账户余额”点进来换了月份
  useEffect(() => {
    const [a, b] = monthRange(month)
    const end = dayjs(b).isAfter(dayjs(todayAccra())) ? dayjs(todayAccra()) : dayjs(b)
    setRange([dayjs(a), end])
  }, [month])

  const load = useCallback(async () => {
    setLoading(true)
    const from = range[0].format('YYYY-MM-DD')
    const to = range[1].format('YYYY-MM-DD')
    let query = supabase
      .from('v_journal')
      .select('*')
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: true })
      .order('seq', { ascending: true })
      .limit(5000)
    if (accountId) query = query.eq('account_id', accountId)
    else query = scope === 'bank' ? query.eq('account_kind', 'bank') : query.neq('account_kind', 'bank')
    const [{ data }, m] = await Promise.all([
      query,
      accountId ? supabase.rpc('journal_month', { p_from: from, p_to: to, p_account: accountId }) : Promise.resolve({ data: null }),
    ])
    setLines(data ?? [])
    setHead(m.data?.[0] ?? null)
    setLoading(false)
  }, [range, accountId, scope])

  useEffect(() => {
    void load()
  }, [load, version])

  // 业务模块、待填、搜索只是筛着看：一筛余额就不连续了，所以筛的时候不显示余额和小计
  const s = cleanSearch(q).toLowerCase()
  const filtering = modules.length > 0 || onlyTodo || !!s
  const shown = lines.filter(
    (l) =>
      (!modules.length || modules.includes(l.module ?? '')) &&
      (!onlyTodo || l.fill_status === '待填') &&
      (!s || `${l.doc_no ?? ''} ${l.summary ?? ''} ${l.bank_summary ?? ''} ${l.counterparty ?? ''} ${l.amount_in ?? ''} ${l.amount_out ?? ''}`.toLowerCase().includes(s)),
  )
  const todoN = lines.filter((l) => l.fill_status === '待填').length
  const ledger: LedgerRow[] = buildLedger(shown, acct && head && !filtering ? Number(head.opening) : null, range[0].format('YYYY-MM-DD'), daySub && !filtering)
  const inSum = round2(shown.reduce((x, l) => x + Number(l.amount_in ?? 0), 0))
  const outSum = round2(shown.reduce((x, l) => x + Number(l.amount_out ?? 0), 0))
  const closing = head ? Number(head.closing) : null
  const status = acct && head ? acctStatus(head, isCashLike(acct)) : null
  const showBalance = !!accountId && !filtering
  // 不是美元的，金额上悬停看折多少美元
  const usdTip = (l: JournalLine) =>
    l.currency !== 'USD' && l.amount_usd ? t('≈ {usd}（汇率 {rate}）', { usd: usd(l.amount_usd), rate: Number(l.fx_rate ?? 0) }) : undefined

  // 待填的流水：付出去的填付款或互转；收进来的录成到账、其他收入或互转。按分工：不是自己那一摊的不出按钮
  const fillButtons = (l: JournalLine) => {
    if (!mine(l.amount_out ? 'out' : 'in')) return <span className="hint">{l.amount_out ? t('付款归填付款的人填') : t('收款归填收款的人填')}</span>
    const btn = (how: FillHow, label: string, primary = false) => (
      <Button key={how} size="small" type={primary ? 'primary' : 'default'} ghost={primary} onClick={() => onFill(l, how)}>
        {label}
      </Button>
    )
    const list = l.amount_out
      ? [jEdit && btn('out', t('填付款'), true), jEdit && btn('transfer', t('互转'))]
      : [rxEdit && btn('receipt', t('录成到账'), true), jEdit && btn('in', t('其他收入')), jEdit && btn('transfer', t('互转'))]
    return <span className="fill-buttons">{list.filter(Boolean)}</span>
  }

  const columns: ColumnsType<LedgerRow> = [
    {
      title: t('日期 / 单号'),
      width: 136,
      render: (_, r) =>
        r.type === 'line' ? (
          <>
            <div>{r.line.entry_date}</div>
            <div className="num doc-no">{r.line.doc_no ?? r.line.bank_ref}</div>
          </>
        ) : r.type === 'opening' ? (
          <span className="hint">{r.date}</span>
        ) : null,
    },
    ...(!accountId
      ? [{ title: t('账户'), width: 170, render: (_: unknown, r: LedgerRow) => (r.type === 'line' ? <div className="clamp2">{r.line.account_name}</div> : null) }]
      : []),
    {
      title: t('业务模块'),
      width: 104,
      render: (_, r) => {
        if (r.type !== 'line') return null
        const l = r.line
        if (l.fill_status === '待填') return <Tag color={FILL_COLOR['待填']}>{t('待填')}</Tag>
        if (l.fill_status === '已忽略')
          return (
            <Tooltip title={t('在银行对账里忽略了（不用填）；钱确实动了，照样算进余额')}>
              <Tag>{t('已忽略')}</Tag>
            </Tooltip>
          )
        return (
          <>
            {l.module && <Tag color={moduleColor(l.module)}>{t(l.module)}</Tag>}
            {l.fill_status === '审批中' && (
              <Tooltip title={t('这条流水已经录成到账，到账还在审批')}>
                <Tag color={FILL_COLOR['审批中']} className="tag-under">
                  {t('审批中')}
                </Tag>
              </Tooltip>
            )}
          </>
        )
      },
    },
    {
      title: t('客户 / 供应商'),
      width: 140,
      render: (_, r) => {
        if (r.type !== 'line') return null
        const l = r.line
        // 互转没有客户：写转到哪个账户、从哪个账户转进来
        const text = l.peer_account_name
          ? l.amount_out
            ? t('转到 {name}', { name: l.peer_account_name })
            : t('从 {name} 转入', { name: l.peer_account_name })
          : l.counterparty
        return text ? <div className={l.peer_account_name ? 'clamp2 peer-acct' : 'clamp2'}>{text}</div> : null
      },
    },
    {
      title: t('摘要'),
      render: (_, r) => {
        if (r.type === 'opening') return <b>{t('期初余额')}</b>
        if (r.type === 'day') return <span className="day-label">{t('{date} 本日合计（{n} 笔）', { date: r.date.slice(5), n: r.count })}</span>
        const l = r.line
        if (l.fill_status === '待填')
          return (
            <div className="todo-cell">
              <Tooltip title={t('银行摘要：{text}', { text: l.bank_summary ?? '' })} placement="topLeft" mouseEnterDelay={0.4}>
                <div className="clamp2 hint">{l.bank_summary}</div>
              </Tooltip>
              {fillButtons(l)}
            </div>
          )
        const tip = [l.summary, l.bank_summary && t('银行摘要：{text}', { text: l.bank_summary })].filter(Boolean).join('\n')
        return l.summary || l.bank_summary ? (
          <Tooltip title={<div className="pre-line">{tip}</div>} placement="topLeft" mouseEnterDelay={0.4}>
            <div className="clamp2">{l.summary || <span className="hint">{l.bank_summary}</span>}</div>
          </Tooltip>
        ) : null
      },
    },
    {
      title: t('收入'),
      width: 112,
      align: 'right',
      render: (_, r) =>
        r.type === 'line' ? (
          r.line.amount_in ? (
            <Tooltip title={usdTip(r.line)}>
              <span className="num text-ok">{money(r.line.amount_in)}</span>
            </Tooltip>
          ) : null
        ) : r.type === 'day' ? (
          <span className="num">{r.income ? money(r.income) : ''}</span>
        ) : null,
    },
    {
      title: t('支出'),
      width: 112,
      align: 'right',
      render: (_, r) =>
        r.type === 'line' ? (
          r.line.amount_out ? (
            <Tooltip title={usdTip(r.line)}>
              <span className="num text-warn">{money(r.line.amount_out)}</span>
            </Tooltip>
          ) : null
        ) : r.type === 'day' ? (
          <span className="num">{r.expense ? money(r.expense) : ''}</span>
        ) : null,
    },
    ...(showBalance
      ? [
          {
            title: t('余额'),
            width: 124,
            align: 'right' as const,
            render: (_: unknown, r: LedgerRow) => {
              if (r.type === 'day') return null
              // 银行流水上自己带着余额：和算出来的不一样就标红（漏导了流水或期初不对）
              const bank = r.type === 'line' ? r.line.bank_balance : null
              const off = bank != null && r.balance != null && Math.abs(round2(r.balance - Number(bank))) >= 0.005
              return off ? (
                <Tooltip title={t('银行流水上这一条的余额是 {amt}，和算出来的接不上', { amt: money(bank) })}>
                  <b className="num text-danger">{money(r.balance)}</b>
                </Tooltip>
              ) : (
                <b className="num">{money(r.balance)}</b>
              )
            },
          },
        ]
      : []),
    { title: t('入账人员'), width: 76, ellipsis: true, render: (_, r) => (r.type === 'line' ? r.line.created_by_name : null) },
  ]
  // 合计行：收入前面有几列
  const lead = accountId ? 4 : 5

  return (
    <div>
      <Space wrap className="filters">
        <Select
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          placeholder={t('全部账户（不算余额）')}
          style={{ width: 280 }}
          value={accountId}
          onChange={onAccount}
          options={accountOptions(accounts, false)}
        />
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select
          mode="multiple"
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          maxTagCount="responsive"
          placeholder={t('业务模块')}
          style={{ width: 200 }}
          value={modules}
          onChange={setModules}
          options={JOURNAL_MODULES.map((m) => ({ value: m.name, label: t(m.name) }))}
        />
        <Input.Search allowClear placeholder={t('搜摘要、单号、客户、金额')} style={{ width: 220 }} onSearch={setQ} />
        <Checkbox checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)}>
          {t('只看待填（{n}）', { n: todoN })}
        </Checkbox>
        <span className="switch-label">
          <Switch size="small" checked={daySub} onChange={setDaySub} /> {t('按日小计')}
        </span>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('刷新')}
        </Button>
      </Space>
      {acct && head && (
        <div className="ledger-head">
          <span className="ledger-acct">
            {acct.short_name} <span className="hint">{t(CURRENCY_ZH[acct.currency] ?? acct.currency)}</span>
          </span>
          <span>
            <span className="hint">{t('期初')}</span> <span className="num">{money(head.opening)}</span>
          </span>
          <span>
            <span className="hint">{t('收入')}</span> <span className="num text-ok">{money(head.income)}</span>
          </span>
          <span>
            <span className="hint">{t('支出')}</span> <span className="num text-warn">{money(head.expense)}</span>
          </span>
          <span>
            <span className="hint">{t('期末')}</span> <b className="num">{money(closing)}</b>
          </span>
          {status && status !== 'cash' && (
            <span>
              <span className="hint">{head.bank_date ? t('银行余额（流水到 {date}）', { date: head.bank_date.slice(5) }) : t('银行余额')}</span>{' '}
              <span className="num">{head.bank_balance != null ? money(head.bank_balance) : '—'}</span> <StatusTag status={status} m={head} />
            </span>
          )}
        </div>
      )}
      {acct && head && Number(head.waiting_n) > 0 && (
        <Alert
          type="info"
          showIcon
          className="filters"
          title={t('还有 {n} 笔已经录了、银行流水里还没有（共 {cur} {amt}），等流水导进来自动对上，现在不算进余额。', {
            n: head.waiting_n,
            cur: acct.currency,
            amt: money(head.waiting_amount),
          })}
        />
      )}
      {acct && head && Number(head.pending_n) > 0 && (
        <Alert
          type="warning"
          showIcon
          className="filters"
          title={t('这个账户还有 {n} 笔到账在审批中，共 {cur} {amt}，审批通过后才记进日记账。', {
            n: head.pending_n,
            cur: acct.currency,
            amt: money(head.pending_amount),
          })}
        />
      )}
      {filtering && acct && <div className="hint filters">{t('筛选的时候不显示余额（筛掉的行也影响余额）')}</div>}
      <Table<LedgerRow>
        size="small"
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={ledger}
        scroll={{ x: accountId ? 1100 : 1200 }}
        pagination={{ defaultPageSize: 100, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500], showTotal: () => t('共 {n} 笔', { n: shown.length }) }}
        className="journal-ledger"
        rowClassName={(r) =>
          r.type === 'day' ? 'row-day' : r.type === 'opening' ? 'row-opening' : r.line.fill_status === '待填' ? 'row-todo' : 'clickable-row'
        }
        onRow={(r) => (r.type === 'line' && r.line.fill_status !== '待填' ? { onClick: () => onOpen(r.line) } : {})}
        summary={() =>
          shown.length ? (
            <Table.Summary fixed>
              <Table.Summary.Row className="row-total">
                <Table.Summary.Cell index={0} colSpan={lead}>
                  <b>{t('本期合计')}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <b className="num">{money(inSum)}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <b className="num">{money(outSum)}</b>
                </Table.Summary.Cell>
                {showBalance && (
                  <Table.Summary.Cell index={3} align="right">
                    <b className="num">{money(closing)}</b>
                  </Table.Summary.Cell>
                )}
                <Table.Summary.Cell index={4} />
              </Table.Summary.Row>
            </Table.Summary>
          ) : null
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------- 修改记录
const LOG_LIMIT = 2000

/** 这本日记账的修改记录：谁、什么时候、做了什么（数据库触发器记的，同一次操作合成一条） */
function LogTab({ scope, version }: { scope: JournalScope; version: number }) {
  const t = useT()
  const { accounts: all, accountById } = useRefData()
  const accounts = useMemo(() => all.filter((a) => scopeOf(a) === scope), [all, scope])
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => [dayjs(todayAccra()).subtract(6, 'day'), dayjs(todayAccra())])
  const [accountId, setAccountId] = useState<number | undefined>()
  const [kind, setKind] = useState<string | undefined>()
  const [who, setWho] = useState<string | undefined>()
  const [rows, setRows] = useState<JournalLog[]>([])
  const [loading, setLoading] = useState(false)
  // 现金日记账没有流水：只有新记、修改、删除、期初
  const kinds = LOG_KINDS.filter((k) => scope === 'bank' || ['create', 'update', 'delete', 'opening'].includes(k.key))

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('v_journal_log')
      .select('*')
      .gte('at', range[0].startOf('day').toISOString())
      .lte('at', range[1].endOf('day').toISOString())
      .order('id', { ascending: false })
      .limit(LOG_LIMIT)
    // 期初（不分账户）两本都出
    q = accountId ? q.eq('account_id', accountId) : q.or(scope === 'bank' ? 'account_kind.eq.bank,account_id.is.null' : 'account_kind.neq.bank,account_id.is.null')
    const k = LOG_KINDS.find((x) => x.key === kind)
    if (k) q = q.in('action', k.actions)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [range, accountId, kind, scope])

  useEffect(() => {
    void load()
  }, [load, version])

  const people = [...new Set(rows.map((r) => r.by_name ?? ''))].filter(Boolean).sort()
  const groups = groupLogs(who ? rows.filter((r) => r.by_name === who) : rows)
  const name = (id: number) => accountById.get(id)?.short_name ?? ''

  return (
    <div>
      <Space wrap className="filters">
        <DatePicker.RangePicker value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Select
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          placeholder={t('全部账户')}
          style={{ width: 260 }}
          value={accountId}
          onChange={setAccountId}
          options={accountOptions(accounts, false)}
        />
        <Select allowClear placeholder={t('全部类型')} style={{ width: 130 }} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k.key, label: t(k.label) }))} />
        <Select allowClear placeholder={t('所有人')} style={{ width: 150 }} value={who} onChange={setWho} options={people.map((p) => ({ value: p, label: p }))} />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('刷新')}
        </Button>
      </Space>
      {rows.length >= LOG_LIMIT && <div className="hint filters">{t('只显示最近的 {n} 条，看更早的请把日期范围缩短', { n: LOG_LIMIT })}</div>}
      <Table<LogGroup>
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={groups}
        className="journal-log-table"
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 200], showTotal: (n) => t('共 {n} 次操作', { n }) }}
        scroll={{ x: 760 }}
        columns={[
          { title: t('时间'), width: 150, render: (_, g) => <span className="num">{dayjs(g.at).format('YYYY-MM-DD HH:mm')}</span> },
          { title: t('操作人'), width: 120, render: (_, g) => g.by || t('系统') },
          {
            title: t('做了什么'),
            render: (_, g) =>
              describeGroup(g, t, name).map((line, i) => (
                <div key={i} className="log-line">
                  {line}
                </div>
              )),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" className="journal-note">
        {t('修改记录由系统自动记下，谁都改不了、删不了：记一笔、改了什么（从什么改成什么）、删掉的那一笔原来的样子；填流水、配到账、忽略、导流水、改期初也都有。')}
      </Typography.Paragraph>
    </div>
  )
}
