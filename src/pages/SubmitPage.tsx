import { PaperClipOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import SubmissionForm from '../components/SubmissionForm'
import { useFlow } from '../lib/flow'
import { dateTime, money, num, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { claimsSummary, isFillRequest, STATUS_COLOR, STATUS_LABEL } from '../lib/submissions'
import type { Submission, SubmissionStatus } from '../lib/submissions'
import { supabase } from '../lib/supabase'

// 业务员：提交到账、看审核结果。被退回的改好再提交

type Filter = 'all' | SubmissionStatus

export default function SubmitPage() {
  const t = useT()
  const { accountById } = useRefData()
  const rflow = useFlow('receipt')
  const [rows, setRows] = useState<Submission[]>([])
  /** 审核通过后生成的到账：编号、审批状态（到账自己还要走审批，批完才算到账） */
  const [receipts, setReceipts] = useState<Map<number, { no: string; status: string | null; step: string | null }>>(new Map())
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<{ open: boolean; sub: Submission | null }>({ open: false, sub: null })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('receipt_submissions').select('*').order('submitted_at', { ascending: false }).limit(300)
    const list = data ?? []
    setRows(list)
    const ids = list.map((x) => x.receipt_id).filter((x): x is number => x != null)
    if (ids.length) {
      const r = await supabase.from('bank_receipts').select('id, receipt_no, status, step').in('id', ids)
      setReceipts(new Map((r.data ?? []).map((x) => [x.id, { no: x.receipt_no, status: x.status, step: x.step }])))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const options: { value: Filter; label: string }[] = [
    { value: 'all', label: t('全部') },
    // 只列有提交的状态，手机上一行放得下
    ...(['requested', 'rejected', 'pending', 'approved', 'withdrawn'] as SubmissionStatus[])
      .filter((s) => counts[s] || filter === s)
      .map((s) => ({
        value: s,
        label: counts[s] ? `${t(STATUS_LABEL[s])} ${counts[s]}` : t(STATUS_LABEL[s]),
      })),
  ]

  return (
    <div>
      <div className="page-title">
        <h2>{t('提交到账')}</h2>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ open: true, sub: null })}>
            {t('提交新的到账')}
          </Button>
        </Space>
      </div>
      <Typography.Paragraph type="secondary">
        {t('客户的钱到了就在这里提交，附上转账截图。财务审核通过后才算到账；被退回的按原因改好再提交。财务请你填写的也在这里：填好这笔钱是哪台车的再提交。')}
      </Typography.Paragraph>
      <Segmented options={options} value={filter} onChange={(v) => setFilter(v as Filter)} style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }} />
      <Spin spinning={loading}>
        {shown.length === 0 ? (
          <Empty description={filter === 'all' ? t('还没有提交过到账') : t('没有这个状态的提交')} />
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            {shown.map((s) => {
              const status = s.status as SubmissionStatus
              const acc = accountById.get(s.account_id)
              const amountUsd = s.currency === 'USD' ? num(s.amount_orig) : num(s.fx_rate) > 0 ? num(s.amount_orig) / num(s.fx_rate) : null
              return (
                <Card key={s.id} size="small" className="sub-card" hoverable onClick={() => setEditing({ open: true, sub: s })}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div>
                        <b>{s.receipt_date}</b> · {acc?.short_name ?? ''}
                      </div>
                      <div style={{ fontSize: 16, margin: '2px 0' }} className="num">
                        {s.currency} {money(s.amount_orig)}
                        {s.currency !== 'USD' && amountUsd != null && <span className="hint"> ≈ {usd(amountUsd)}</span>}
                      </div>
                      {claimsSummary(s, t).map((line, i) => (
                        <div key={i} className="hint" style={{ wordBreak: 'break-word' }}>
                          {line}
                        </div>
                      ))}
                    </div>
                    <Space orientation="vertical" align="end" size={2}>
                      <Tag color={STATUS_COLOR[status]} style={{ marginInlineEnd: 0 }}>
                        {t(STATUS_LABEL[status])}
                      </Tag>
                      {s.attachments.length > 0 && <PaperClipOutlined className="hint" />}
                    </Space>
                  </div>
                  {status === 'requested' && (
                    <div className="text-warn" style={{ marginTop: 6 }}>
                      {t('财务 {name} 请你填写', { name: s.requested_name ?? '' })}
                      {s.request_note ? `：${s.request_note}` : ''}
                    </div>
                  )}
                  {status === 'rejected' && (
                    <div className="text-danger" style={{ marginTop: 6 }}>
                      {t('退回原因：{reason}', { reason: s.review_note ?? '' })}
                    </div>
                  )}
                  {status === 'approved' && s.receipt_id != null && receipts.get(s.receipt_id) && (
                    <div className="text-ok" style={{ marginTop: 6 }}>
                      <Space size={6}>
                        {t('到账编号 {no}', { no: receipts.get(s.receipt_id)?.no ?? '' })}
                        <Tag color={rflow.stageColor(receipts.get(s.receipt_id)?.status, receipts.get(s.receipt_id)?.step)}>
                          {rflow.stageLabel(receipts.get(s.receipt_id)?.status, receipts.get(s.receipt_id)?.step)}
                        </Tag>
                      </Space>
                    </div>
                  )}
                  <div className="hint" style={{ marginTop: 4 }}>
                    {isFillRequest(s) && status === 'requested'
                      ? t('{when} 发来', { when: dateTime(s.requested_at) })
                      : t('提交于 {when}', { when: dateTime(s.submitted_at) })}
                  </div>
                </Card>
              )
            })}
          </Space>
        )}
      </Spin>
      <SubmissionForm
        open={editing.open}
        submission={editing.sub}
        onClose={(changed) => {
          setEditing({ open: false, sub: null })
          if (changed) void load()
        }}
      />
    </div>
  )
}
