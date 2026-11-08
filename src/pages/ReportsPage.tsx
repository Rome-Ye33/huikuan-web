import { CheckOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Card, Checkbox, Empty, Segmented, Space, Spin, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import ReceiptEditor from '../components/ReceiptEditor'
import ReportBox from '../components/ReportBox'
import { copyText } from '../lib/clipboard'
import { errorText } from '../lib/errors'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Receipt } from '../lib/supabase'
import { CLAIM_COLOR } from './ReceiptsPage'

type Item = { receipt: Receipt; text: string }

export default function ReportsPage() {
  const { message } = App.useApp()
  const [mode, setMode] = useState<'todo' | 'done'>('todo')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [editId, setEditId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('v_bank_receipts').select('*')
    q =
      mode === 'todo'
        ? q.or('is_reported.eq.false,needs_correction.eq.true').order('receipt_date').order('id')
        : q.eq('is_reported', true).order('reported_at', { ascending: false }).limit(40)
    const { data: recs } = await q
    const ids = (recs ?? []).map((r) => r.id as number)
    const texts = new Map<number, string>()
    if (ids.length) {
      const { data } = await supabase.from('v_receipt_reports').select('id, report_text').in('id', ids)
      for (const t of data ?? []) texts.set(t.id as number, t.report_text ?? '')
    }
    setItems((recs ?? []).map((r) => ({ receipt: r, text: texts.get(r.id as number) ?? '' })))
    setSelected([])
    setLoading(false)
  }, [mode])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = items.filter((i) => selected.includes(i.receipt.id as number))

  const copyChosen = async () => {
    const text = chosen.map((i) => i.text).join('\n\n')
    if (await copyText(text)) message.success(`已复制 ${chosen.length} 条，可以一起粘贴到群里`)
    else message.error('复制失败')
  }

  const markChosen = async () => {
    const now = new Date().toISOString()
    const notReported = chosen.filter((i) => !i.receipt.is_reported).map((i) => i.receipt.id as number)
    const corrected = chosen.filter((i) => i.receipt.needs_correction).map((i) => i.receipt.id as number)
    if (notReported.length) {
      const { error } = await supabase.from('bank_receipts').update({ reported_at: now }).in('id', notReported)
      if (error) return message.error(errorText(error))
    }
    if (corrected.length) {
      const { error } = await supabase.from('bank_receipts').update({ needs_correction: false }).in('id', corrected)
      if (error) return message.error(errorText(error))
    }
    message.success(`已标记 ${chosen.length} 条为已发群`)
    void load()
  }

  return (
    <div>
      <div className="page-title">
        <h2>报款</h2>
        <Space wrap>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as 'todo' | 'done')}
            options={[
              { value: 'todo', label: '待发群' },
              { value: 'done', label: '最近已发' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        </Space>
      </div>
      {mode === 'todo' && items.length > 0 && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Checkbox
            checked={selected.length === items.length}
            indeterminate={selected.length > 0 && selected.length < items.length}
            onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.receipt.id as number) : [])}
          >
            全选
          </Checkbox>
          <Button icon={<CopyOutlined />} disabled={!chosen.length} onClick={copyChosen}>
            复制选中（{chosen.length}）
          </Button>
          <Button icon={<CheckOutlined />} disabled={!chosen.length} onClick={markChosen}>
            选中的都标记已发群
          </Button>
          <span className="hint">建议先复制、发到群里，再标记已发。</span>
        </Space>
      )}
      <Spin spinning={loading}>
        {items.length === 0 && !loading && <Empty description={mode === 'todo' ? '没有待发的报款' : '还没有已发的报款'} />}
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          {items.map(({ receipt: r, text }) => (
            <Card
              key={r.id}
              size="small"
              className="report-card"
              title={
                <Space wrap>
                  {mode === 'todo' && (
                    <Checkbox
                      checked={selected.includes(r.id as number)}
                      onChange={(e) =>
                        setSelected((s) => (e.target.checked ? [...s, r.id as number] : s.filter((x) => x !== r.id)))
                      }
                    />
                  )}
                  <b>{r.receipt_no}</b>
                  <span>{r.receipt_date}</span>
                  <span>{r.account_name}</span>
                  <span className="num">
                    {r.currency} {money(r.amount_orig)}
                  </span>
                  <Tag color={CLAIM_COLOR[r.claim_status ?? '']}>{r.claim_status}</Tag>
                  {r.is_late && !r.needs_correction && <Tag>补</Tag>}
                </Space>
              }
              extra={
                <Button type="link" onClick={() => setEditId(r.id as number)}>
                  打开
                </Button>
              }
            >
              <ReportBox receipt={r} text={text} onChanged={() => void load()} />
            </Card>
          ))}
        </Space>
      </Spin>
      <ReceiptEditor
        open={editId !== null}
        receiptId={editId}
        onClose={(changed) => {
          setEditId(null)
          if (changed) void load()
        }}
      />
    </div>
  )
}
