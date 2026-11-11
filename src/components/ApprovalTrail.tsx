import { Card, Spin, Timeline } from 'antd'
import { useEffect, useState } from 'react'
import { dateTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { ACTION_COLOR, fetchTrail, useDocLabels } from '../lib/workbench'
import type { ApprovalLog, DocType } from '../lib/workbench'

// 审批记录：一张单据从提交到结束，每一步谁做的、什么时候、退回原因

type Props = {
  docType: DocType
  docId: number | null | undefined
  /** 单据有变化（比如 updated_at 变了）时重新读 */
  version?: string | null
}

export default function ApprovalTrail({ docType, docId, version }: Props) {
  const t = useT()
  const labels = useDocLabels()
  // 读到的记录属于哪张单据（换了单据，旧的不显示）
  const [data, setData] = useState<{ key: string; rows: ApprovalLog[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const key = `${docType}-${docId ?? ''}`

  useEffect(() => {
    if (!docId) return
    let alive = true
    setLoading(true)
    void fetchTrail(docType, docId).then((list) => {
      if (!alive) return
      setData({ key: `${docType}-${docId}`, rows: list })
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [docType, docId, version])

  // 第一次读完之前不占位置；没有记录（比如还没提交的草稿）也不显示
  const rows = data?.key === key ? data.rows : []
  if (!docId || rows.length === 0) return null

  return (
    <Card size="small" title={t('审批记录')} className="approval-trail" style={{ marginTop: 12 }}>
      <Spin spinning={loading}>
        <Timeline
          items={rows.map((r) => ({
            key: r.id,
            color: ACTION_COLOR[r.action] ?? 'gray',
            content: (
              <div>
                <div>
                  <b>{labels.action(r.action, r.step, docType)}</b>
                  <span className="hint" style={{ marginInlineStart: 8 }}>
                    {r.actor_name || t('系统')} · {dateTime(r.at)}
                  </span>
                </div>
                {r.note && <div className={r.action === 'reject' ? 'text-danger' : undefined}>{t('原因：{note}', { note: r.note })}</div>}
              </div>
            ),
          }))}
        />
      </Spin>
    </Card>
  )
}
