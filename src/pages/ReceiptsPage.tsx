import { PaperClipOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Badge, Button, DatePicker, Input, Select, Space, Table, Tabs, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import ReceiptEditor from '../components/ReceiptEditor'
import SubmissionList from '../components/SubmissionList'
import { RECEIPT_STATUS_LABEL, receiptStatus, useFlow } from '../lib/flow'
import type { ReceiptStatus } from '../lib/flow'
import { pickCol, textCol } from '../lib/colFilter'
import { cleanSearch, money, todayAccra, usd } from '../lib/format'
import { tr, useT } from '../lib/i18n'
import { accountOptions, useRefData } from '../lib/refdata'
import { useSubmissionCount } from '../lib/submissions'
import { supabase } from '../lib/supabase'
import type { Receipt } from '../lib/supabase'

export const CLAIM_COLOR: Record<string, string> = { 未认领: 'red', 部分认领: 'orange', 已认领: 'green' }
export const BANK_COLOR: Record<string, string> = { 已核对: 'green', 银行查不到: 'red', 待核对: 'default', 无需核对: 'default' }

export function reportTag(r: Receipt) {
  if (r.needs_correction) return <Tag color="orange">{tr('需发修改')}</Tag>
  if (r.is_reported) return <Tag color="green">{tr('已报 {date}', { date: r.report_date?.slice(5) ?? '' })}</Tag>
  return <Tag color="blue">{tr('未报')}</Tag>
}

function ReceiptList() {
  const t = useT()
  const { accounts } = useRefData()
  const rflow = useFlow('receipt')
  const [rows, setRows] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs(todayAccra()).subtract(30, 'day'), dayjs(todayAccra())])
  const [accountId, setAccountId] = useState<number | undefined>()
  const [approval, setApproval] = useState<ReceiptStatus | undefined>()
  const [claimStatus, setClaimStatus] = useState<string | undefined>()
  const [reportStatus, setReportStatus] = useState<string | undefined>()
  const [bankStatus, setBankStatus] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })
  /** 列头筛选后表里实际显示的行（合计按它算） */
  const [shown, setShown] = useState<Receipt[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('v_bank_receipts')
      .select('*')
      .gte('receipt_date', range[0].format('YYYY-MM-DD'))
      .lte('receipt_date', range[1].format('YYYY-MM-DD'))
      .order('receipt_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(2000)
    if (accountId) query = query.eq('account_id', accountId)
    if (approval) query = query.eq('status', approval)
    if (claimStatus) query = query.eq('claim_status', claimStatus)
    if (bankStatus) query = query.eq('bank_status', bankStatus)
    if (reportStatus === '未报') query = query.eq('is_reported', false)
    if (reportStatus === '已报') query = query.eq('is_reported', true)
    if (reportStatus === '需发修改') query = query.eq('needs_correction', true)
    const s = cleanSearch(q)
    if (s) query = query.or(`receipt_no.ilike.%${s}%,payer_summary.ilike.%${s}%,note.ilike.%${s}%,bank_ref.ilike.%${s}%,cheque_no.ilike.%${s}%`)
    const { data } = await query
    setRows(data ?? [])
    setShown(null)
    setLoading(false)
  }, [range, accountId, approval, claimStatus, reportStatus, bankStatus, q])

  useEffect(() => {
    void load()
  }, [load])

  // 审核通过了业务员的提交，这里也多了一笔
  useEffect(() => {
    const h = () => void load()
    window.addEventListener('submissions-changed', h)
    return () => window.removeEventListener('submissions-changed', h)
  }, [load])

  const columns: ColumnsType<Receipt> = [
    { title: t('编号'), dataIndex: 'receipt_no', width: 150, ...textCol<Receipt>((r) => r.receipt_no) },
    {
      title: t('审批'),
      width: 120,
      render: (_, r) => <Tag color={rflow.stageColor(r.status, r.step)}>{rflow.stageLabel(r.status, r.step)}</Tag>,
      ...pickCol(rows, (r) => rflow.stageLabel(r.status, r.step)),
    },
    { title: t('到账日期'), dataIndex: 'receipt_date', width: 104, ...textCol<Receipt>((r) => r.receipt_date) },
    { title: t('收款账户'), dataIndex: 'account_name', width: 210, ellipsis: true, ...pickCol(rows, (r) => r.account_name) },
    {
      title: t('金额'),
      width: 150,
      align: 'right',
      render: (_, r) => (
        <span className="num">
          {r.currency} {money(r.amount_orig)}
        </span>
      ),
      ...textCol<Receipt>((r) => `${r.currency} ${money(r.amount_orig)}`),
    },
    { title: t('汇率'), dataIndex: 'fx_rate', width: 76, align: 'right', render: (v: number) => (v == 1 ? '' : Number(v)) },
    { title: 'USD', dataIndex: 'amount_usd', width: 96, align: 'right', render: (v: number) => <span className="num">{usd(v)}</span> },
    {
      title: t('拆分'),
      width: 150,
      render: (_, r) => (
        <Space size={4}>
          <Tag color={CLAIM_COLOR[r.claim_status ?? '']}>{t(r.claim_status ?? '')}</Tag>
          {r.claim_status === '部分认领' && <span className="hint">{t('剩 {amt}', { amt: money(r.pending_orig) })}</span>}
        </Space>
      ),
      ...pickCol(rows, (r) => r.claim_status, t),
    },
    { title: t('报款'), width: 100, render: (_, r) => reportTag(r), ...pickCol(rows, (r) => (r.needs_correction ? '需发修改' : r.is_reported ? '已报' : '未报'), t) },
    {
      title: t('银行核对'),
      dataIndex: 'bank_status',
      width: 96,
      render: (v: string) => <Tag color={BANK_COLOR[v]}>{t(v)}</Tag>,
      ...pickCol(rows, (r) => r.bank_status, t),
    },
    { title: t('付款方 / 摘要'), dataIndex: 'payer_summary', ellipsis: true, ...textCol<Receipt>((r) => `${r.payer_summary ?? ''} ${r.bank_ref ?? ''} ${r.cheque_no ?? ''}`) },
    {
      title: '',
      width: 36,
      render: (_, r) =>
        r.attachments && r.attachments.length > 0 ? (
          <Tooltip title={t('{n} 个凭证', { n: r.attachments.length })}>
            <PaperClipOutlined />
          </Tooltip>
        ) : null,
    },
  ]

  // 合计只算已生效的（审批中、退回的还不算到账）
  const total = (shown ?? rows).filter((r) => receiptStatus(r.status) === 'approved').reduce((s, r) => s + Number(r.amount_usd ?? 0), 0)
  const opts = (list: string[]) => list.map((x) => ({ value: x, label: t(x) }))

  return (
    <div>
      <Space wrap className="filters">
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          presets={[
            { label: t('今天'), value: [dayjs(todayAccra()), dayjs(todayAccra())] },
            { label: t('最近 7 天'), value: [dayjs(todayAccra()).subtract(7, 'day'), dayjs(todayAccra())] },
            { label: t('最近 30 天'), value: [dayjs(todayAccra()).subtract(30, 'day'), dayjs(todayAccra())] },
            { label: t('今年'), value: [dayjs(todayAccra()).startOf('year'), dayjs(todayAccra())] },
          ]}
        />
        <Select
          allowClear
          placeholder={t('收款账户')}
          style={{ width: 230 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={accountOptions(accounts, false)}
          value={accountId}
          onChange={setAccountId}
        />
        <Select
          allowClear
          placeholder={t('审批状态')}
          style={{ width: 120 }}
          value={approval}
          onChange={setApproval}
          options={(['pending', 'approved', 'rejected'] as ReceiptStatus[]).map((x) => ({ value: x, label: t(RECEIPT_STATUS_LABEL[x]) }))}
        />
        <Select allowClear placeholder={t('拆分状态')} style={{ width: 120 }} value={claimStatus} onChange={setClaimStatus} options={opts(['未认领', '部分认领', '已认领'])} />
        <Select allowClear placeholder={t('报款状态')} style={{ width: 120 }} value={reportStatus} onChange={setReportStatus} options={opts(['未报', '已报', '需发修改'])} />
        <Select
          allowClear
          placeholder={t('银行核对')}
          style={{ width: 130 }}
          value={bankStatus}
          onChange={setBankStatus}
          options={opts(['已核对', '待核对', '银行查不到', '无需核对'])}
        />
        <Input.Search allowClear placeholder={t('编号、摘要、参考号、支票号')} style={{ width: 240 }} onSearch={setQ} />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, id: null })}>
          {t('新建到账')}
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => t('共 {n} 笔，已生效合计 {usd}', { n, usd: usd(total) }) }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => setEditor({ open: true, id: r.id }) })}
        onChange={(_, __, ___, extra) => setShown(extra.currentDataSource)}
      />
      <ReceiptEditor
        open={editor.open}
        receiptId={editor.id}
        onClose={(changed) => {
          setEditor({ open: false, id: null })
          if (changed) void load()
        }}
      />
    </div>
  )
}

export default function ReceiptsPage() {
  const t = useT()
  const pending = useSubmissionCount('pending', true)
  const [tab, setTab] = useState('receipts')

  return (
    <div>
      <div className="page-title">
        <h2>{t('到账录入')}</h2>
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden={false}
        items={[
          { key: 'receipts', label: t('到账'), children: <ReceiptList /> },
          {
            key: 'subs',
            label: (
              <Badge count={pending} size="small" offset={[8, -2]}>
                {t('业务员提交')}
              </Badge>
            ),
            children: <SubmissionList />,
          },
        ]}
      />
    </div>
  )
}
