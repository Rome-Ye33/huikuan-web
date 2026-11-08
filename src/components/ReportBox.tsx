import { CheckOutlined, CopyOutlined, EditOutlined, RollbackOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { copyText } from '../lib/clipboard'
import { errorText } from '../lib/errors'
import { money, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Receipt } from '../lib/supabase'
import type { TablesUpdate } from '../lib/database.types'

type Props = {
  receipt: Receipt
  text: string
  onChanged: () => void
  readOnly?: boolean
}

/** 报款文字 + 复制 + 标记已发群 */
export default function ReportBox({ receipt, text, onChanged, readOnly }: Props) {
  const { message, modal } = App.useApp()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const id = receipt.id as number

  const update = async (patch: TablesUpdate<'bank_receipts'>, ok: string) => {
    setBusy(true)
    const { error } = await supabase.from('bank_receipts').update(patch).eq('id', id)
    setBusy(false)
    if (error) message.error(errorText(error))
    else {
      message.success(ok)
      onChanged()
    }
  }

  const copy = async () => {
    if (await copyText(text)) message.success('已复制，可以粘贴到群里')
    else message.error('复制失败，请手动选中文字复制')
  }

  const pending = Number(receipt.pending_orig ?? 0)

  return (
    <div>
      {receipt.claim_status !== '已认领' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={
            receipt.claim_status === '未认领'
              ? '这笔还没有拆分到车，报款文字不完整'
              : `还有 ${receipt.currency} ${money(pending)} 没有拆分（如果要退还客户，请加一行“退款”）`
          }
        />
      )}
      <pre className="report-text">{text}</pre>
      <Space wrap>
        <Button type="primary" icon={<CopyOutlined />} onClick={copy}>
          复制报款文字
        </Button>
        {!readOnly && !receipt.is_reported && (
          <Button icon={<CheckOutlined />} loading={busy} onClick={() => update({ reported_at: new Date().toISOString() }, '已标记为已发群')}>
            标记已发群
          </Button>
        )}
        {!readOnly && receipt.needs_correction && (
          <Button icon={<CheckOutlined />} loading={busy} onClick={() => update({ needs_correction: false }, '已标记修改信息已发')}>
            修改信息已发群
          </Button>
        )}
        {receipt.is_reported && !receipt.needs_correction && (
          <Tag color="green">已报款 {shortDate(receipt.report_date)}</Tag>
        )}
        {receipt.needs_correction && <Tag color="orange">报款后有改动，需要发修改信息</Tag>}
        {!readOnly && receipt.is_reported && (
          <Button
            type="link"
            size="small"
            icon={<RollbackOutlined />}
            onClick={() =>
              modal.confirm({
                title: '撤销“已发群”？',
                content: '撤销后这笔会回到待报款列表。',
                onOk: () => update({ reported_at: null, report_date: null, reported_by: null, needs_correction: false }, '已撤销'),
              })
            }
          >
            撤销已发
          </Button>
        )}
        {!readOnly && (
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setDraft(text)
              setEditing(true)
            }}
          >
            手工改文字
          </Button>
        )}
        {!readOnly && receipt.report_override && (
          <Button type="link" size="small" onClick={() => update({ report_override: null }, '已恢复自动生成')}>
            恢复自动生成
          </Button>
        )}
      </Space>
      {receipt.report_override && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
          这笔用的是手工修改过的文字，拆分改动后不会自动更新。
        </Typography.Paragraph>
      )}
      <Modal
        open={editing}
        title="手工修改报款文字"
        okText="保存"
        onCancel={() => setEditing(false)}
        onOk={async () => {
          await update({ report_override: draft.trim() || null }, '已保存手工文字')
          setEditing(false)
        }}
        width={640}
      >
        <Typography.Paragraph type="secondary">
          特殊情况（代付、换车差额等）公式写不出来时用。保存后这笔一直用这段文字，直到点“恢复自动生成”。
        </Typography.Paragraph>
        <Input.TextArea value={draft} onChange={(e) => setDraft(e.target.value)} autoSize={{ minRows: 10, maxRows: 24 }} />
      </Modal>
    </div>
  )
}
