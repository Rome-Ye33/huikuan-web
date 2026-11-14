import { Empty } from 'antd'
import dayjs from 'dayjs'
import { useT } from '../lib/i18n'
import { describeGroup, groupLogs } from '../lib/journalLog'
import type { JournalLog } from '../lib/journalLog'
import { useRefData } from '../lib/refdata'

/** 修改记录（数据库 36 的 journal_log）：同一次操作合成一条，新的在前；每条是时间、谁，下面一句句说做了什么 */
export default function JournalLogList({ rows }: { rows: JournalLog[] }) {
  const t = useT()
  const { accountById } = useRefData()
  const name = (id: number) => accountById.get(id)?.short_name ?? ''
  const groups = groupLogs(rows)
  if (!groups.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('还没有记录')} />
  return (
    <div className="log-list">
      {groups.map((g) => (
        <div key={g.key} className="log-group">
          <div className="log-head">
            <span className="num">{dayjs(g.at).format('YYYY-MM-DD HH:mm')}</span>
            <b>{g.by || t('系统')}</b>
          </div>
          {describeGroup(g, t, name).map((s, i) => (
            <div key={i} className="log-line">
              {s}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
