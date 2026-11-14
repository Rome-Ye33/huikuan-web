import { Tag } from 'antd'
import { money, round2 } from '../lib/format'
import { useT } from '../lib/i18n'
import { moduleColor } from '../lib/journal'
import type { Part } from '../lib/journal'

// 日记账里一行分了几种业务（数据库 37）：每种一行，业务模块、客户 / 供应商、摘要、大架号、金额。
// 点一种打开它所在的那一张（到账 / 收支）；到账和收支一起填的同一条流水（单号不止一个），每种后面写单号。
// total = 这一行的金额：到账里还有没拆到车的钱，最后写一句还剩多少没分。

export default function PartsList({ parts, total, onOpen }: { parts: Part[]; total?: number | null; onOpen?: (p: Part) => void }) {
  const t = useT()
  const docs = new Set(parts.map((p) => p.doc_no ?? '')).size > 1
  const left = total == null ? 0 : round2(total - parts.reduce((s, p) => s + p.amount, 0))
  return (
    <div className="parts-list">
      {parts.map((p, i) => (
        <div
          key={i}
          className={onOpen ? 'parts-item clickable' : 'parts-item'}
          onClick={
            onOpen
              ? (e) => {
                  e.stopPropagation()
                  onOpen(p)
                }
              : undefined
          }
        >
          <Tag color={moduleColor(p.module)}>{t(p.module)}</Tag>
          <span className="parts-item-text">
            {p.counterparty && <span>{p.counterparty}</span>}
            {p.summary && <span className="hint">{p.summary}</span>}
            {p.vin && <span className="num parts-vin">{p.vin}</span>}
          </span>
          {docs && p.doc_no && <span className="num doc-no">{p.doc_no}</span>}
          <span className="num parts-item-amt">{money(p.amount)}</span>
        </div>
      ))}
      {left >= 0.005 && (
        <div className="parts-item parts-left hint">
          <span className="parts-item-text">{t('到账里还有没拆到车的')}</span>
          <span className="num parts-item-amt">{money(left)}</span>
        </div>
      )}
    </div>
  )
}
