import { PaperClipOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Segmented, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { dateTime, money, num, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { claimsSummary, STATUS_COLOR, STATUS_LABEL } from '../lib/submissions'
import type { Submission, SubmissionStatus } from '../lib/submissions'
import { supabase } from '../lib/supabase'
import ReceiptEditor from './ReceiptEditor'
import SubmissionForm from './SubmissionForm'

// 财务：业务员提交的到账。待审核的打开就是到账编辑页（按提交预填），通过后生成正式到账

type Filter = SubmissionStatus | 'all'

export default function SubmissionList({ onChanged }: { onChanged?: () => void }) {
  const t = useT()
  const { accountById, salespersons } = useRefData()
  const [rows, setRows] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('pending')
  const [spId, setSpId] = useState<number | undefined>()
  const [review, setReview] = useState<Submission | null>(null)
  const [receiptId, setReceiptId] = useState<number | null>(null)
  const [view, setView] = useState<Submission | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('receipt_submissions')
      .select('*')
      .order('submitted_at', { ascending: filter === 'pending' })
      .limit(500)
    if (filter !== 'all') q = q.eq('status', filter)
    if (spId) q = q.eq('salesperson_id', spId)
    const { data } = await q
    setRows(data ?? [])
    setLoading(false)
  }, [filter, spId])

  useEffect(() => {
    void load()
  }, [load])

  // 业务员那边有新提交，或者别的财务审核了，列表跟着刷新
  useEffect(() => {
    const h = () => void load()
    window.addEventListener('submissions-changed', h)
    return () => window.removeEventListener('submissions-changed', h)
  }, [load])

  const spName = (id: number) => salespersons.find((s) => s.id === id)?.name ?? ''

  const open = (s: Submission) => {
    if (s.status === 'pending') setReview(s)
    else if (s.status === 'approved' && s.receipt_id) setReceiptId(s.receipt_id)
    else setView(s)
  }

  const columns: ColumnsType<Submission> = [
    { title: t('提交时间'), dataIndex: 'submitted_at', width: 140, render: (v: string) => dateTime(v) },
    { title: t('业务员'), dataIndex: 'salesperson_id', width: 120, ellipsis: true, render: (v: number) => spName(v) },
    { title: t('到账日期'), dataIndex: 'receipt_date', width: 104 },
    { title: t('收款账户'), dataIndex: 'account_id', width: 200, ellipsis: true, render: (v: number) => accountById.get(v)?.short_name ?? '' },
    {
      title: t('金额'),
      width: 150,
      align: 'right',
      render: (_, r) => (
        <span className="num">
          {r.currency} {money(r.amount_orig)}
        </span>
      ),
    },
    {
      title: 'USD',
      width: 96,
      align: 'right',
      render: (_, r) => (num(r.fx_rate) > 0 ? <span className="num">{usd(num(r.amount_orig) / num(r.fx_rate))}</span> : ''),
    },
    {
      title: t('业务员说是哪台车的'),
      render: (_, r) => (
        <div>
          {claimsSummary(r, t).map((line, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              {line}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: '',
      width: 36,
      render: (_, r) =>
        r.attachments.length > 0 ? (
          <Tooltip title={t('{n} 个凭证', { n: r.attachments.length })}>
            <PaperClipOutlined />
          </Tooltip>
        ) : null,
    },
    {
      title: t('状态'),
      width: 160,
      render: (_, r) => (
        <div>
          <Tag color={STATUS_COLOR[r.status as SubmissionStatus]}>{t(STATUS_LABEL[r.status as SubmissionStatus])}</Tag>
          {r.status === 'rejected' && r.review_note && <div className="hint">{r.review_note}</div>}
        </div>
      ),
    },
  ]

  const filters: { value: Filter; label: string }[] = [
    ...(['pending', 'rejected', 'approved', 'withdrawn'] as SubmissionStatus[]).map((s) => ({ value: s, label: t(STATUS_LABEL[s]) })),
    { value: 'all', label: t('全部') },
  ]

  const closed = (changed: boolean) => {
    setReview(null)
    setReceiptId(null)
    setView(null)
    if (changed) {
      void load()
      onChanged?.()
    }
  }

  return (
    <div>
      <Space wrap className="filters">
        <Segmented options={filters} value={filter} onChange={(v) => setFilter(v as Filter)} />
        <Select
          allowClear
          placeholder={t('业务员')}
          style={{ width: 160 }}
          showSearch={{ optionFilterProp: 'label' }}
          options={salespersons.map((s) => ({ value: s.id, label: s.name }))}
          value={spId}
          onChange={setSpId}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1200 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => t('共 {n} 条', { n }) }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => open(r) })}
        locale={{ emptyText: filter === 'pending' ? t('没有等审核的提交') : undefined }}
      />
      <ReceiptEditor open={review !== null || receiptId !== null} submission={review} receiptId={receiptId} onClose={closed} />
      <SubmissionForm open={view !== null} submission={view} onClose={closed} />
    </div>
  )
}
