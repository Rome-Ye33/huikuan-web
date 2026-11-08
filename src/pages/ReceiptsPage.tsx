import { PaperClipOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, DatePicker, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import ReceiptEditor from '../components/ReceiptEditor'
import { cleanSearch, money, todayAccra, usd } from '../lib/format'
import { accountOptions, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Receipt } from '../lib/supabase'

export const CLAIM_COLOR: Record<string, string> = { 未认领: 'red', 部分认领: 'orange', 已认领: 'green' }
export const BANK_COLOR: Record<string, string> = { 已核对: 'green', 银行查不到: 'red', 待核对: 'default', 无需核对: 'default' }

export function reportTag(r: Receipt) {
  if (r.needs_correction) return <Tag color="orange">需发修改</Tag>
  if (r.is_reported) return <Tag color="green">已报 {r.report_date?.slice(5)}</Tag>
  return <Tag color="blue">未报</Tag>
}

export default function ReceiptsPage() {
  const { accounts } = useRefData()
  const [rows, setRows] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs(todayAccra()).subtract(30, 'day'), dayjs(todayAccra())])
  const [accountId, setAccountId] = useState<number | undefined>()
  const [claimStatus, setClaimStatus] = useState<string | undefined>()
  const [reportStatus, setReportStatus] = useState<string | undefined>()
  const [bankStatus, setBankStatus] = useState<string | undefined>()
  const [q, setQ] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })

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
    if (claimStatus) query = query.eq('claim_status', claimStatus)
    if (bankStatus) query = query.eq('bank_status', bankStatus)
    if (reportStatus === '未报') query = query.eq('is_reported', false)
    if (reportStatus === '已报') query = query.eq('is_reported', true)
    if (reportStatus === '需发修改') query = query.eq('needs_correction', true)
    const s = cleanSearch(q)
    if (s) query = query.or(`receipt_no.ilike.%${s}%,payer_summary.ilike.%${s}%,note.ilike.%${s}%,bank_ref.ilike.%${s}%,cheque_no.ilike.%${s}%`)
    const { data } = await query
    setRows(data ?? [])
    setLoading(false)
  }, [range, accountId, claimStatus, reportStatus, bankStatus, q])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ColumnsType<Receipt> = [
    { title: '编号', dataIndex: 'receipt_no', width: 150 },
    { title: '到账日期', dataIndex: 'receipt_date', width: 104 },
    { title: '收款账户', dataIndex: 'account_name', width: 210, ellipsis: true },
    {
      title: '金额',
      width: 150,
      align: 'right',
      render: (_, r) => (
        <span className="num">
          {r.currency} {money(r.amount_orig)}
        </span>
      ),
    },
    { title: '汇率', dataIndex: 'fx_rate', width: 76, align: 'right', render: (v: number) => (v == 1 ? '' : Number(v)) },
    { title: 'USD', dataIndex: 'amount_usd', width: 96, align: 'right', render: (v: number) => <span className="num">{usd(v)}</span> },
    {
      title: '拆分',
      width: 150,
      render: (_, r) => (
        <Space size={4}>
          <Tag color={CLAIM_COLOR[r.claim_status ?? '']}>{r.claim_status}</Tag>
          {r.claim_status === '部分认领' && (
            <span className="hint">
              剩 {money(r.pending_orig)}
            </span>
          )}
        </Space>
      ),
    },
    { title: '报款', width: 100, render: (_, r) => reportTag(r) },
    {
      title: '银行核对',
      dataIndex: 'bank_status',
      width: 96,
      render: (v: string) => <Tag color={BANK_COLOR[v]}>{v}</Tag>,
    },
    { title: '付款方 / 摘要', dataIndex: 'payer_summary', ellipsis: true },
    {
      title: '',
      width: 36,
      render: (_, r) =>
        r.attachments && r.attachments.length > 0 ? (
          <Tooltip title={`${r.attachments.length} 个凭证`}>
            <PaperClipOutlined />
          </Tooltip>
        ) : null,
    },
  ]

  const total = rows.reduce((s, r) => s + Number(r.amount_usd ?? 0), 0)

  return (
    <div>
      <div className="page-title">
        <h2>到账录入</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, id: null })}>
            新建到账
          </Button>
        </Space>
      </div>
      <Space wrap className="filters">
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          presets={[
            { label: '今天', value: [dayjs(todayAccra()), dayjs(todayAccra())] },
            { label: '最近 7 天', value: [dayjs(todayAccra()).subtract(7, 'day'), dayjs(todayAccra())] },
            { label: '最近 30 天', value: [dayjs(todayAccra()).subtract(30, 'day'), dayjs(todayAccra())] },
            { label: '今年', value: [dayjs(todayAccra()).startOf('year'), dayjs(todayAccra())] },
          ]}
        />
        <Select
          allowClear
          placeholder="收款账户"
          style={{ width: 230 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={accountOptions(accounts, false)}
          value={accountId}
          onChange={setAccountId}
        />
        <Select
          allowClear
          placeholder="拆分状态"
          style={{ width: 110 }}
          value={claimStatus}
          onChange={setClaimStatus}
          options={['未认领', '部分认领', '已认领'].map((x) => ({ value: x, label: x }))}
        />
        <Select
          allowClear
          placeholder="报款状态"
          style={{ width: 110 }}
          value={reportStatus}
          onChange={setReportStatus}
          options={['未报', '已报', '需发修改'].map((x) => ({ value: x, label: x }))}
        />
        <Select
          allowClear
          placeholder="银行核对"
          style={{ width: 120 }}
          value={bankStatus}
          onChange={setBankStatus}
          options={['已核对', '待核对', '银行查不到', '无需核对'].map((x) => ({ value: x, label: x }))}
        />
        <Input.Search allowClear placeholder="编号、摘要、参考号、支票号" style={{ width: 240 }} onSearch={setQ} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => `共 ${n} 笔，合计 ${usd(total)}` }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => setEditor({ open: true, id: r.id }) })}
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
