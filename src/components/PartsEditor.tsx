import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { AutoComplete, Button, Col, Input, InputNumber, Row, Select, Tag } from 'antd'
import { money, round2 } from '../lib/format'
import { useT } from '../lib/i18n'
import { moduleColor, newPart, partsTotal, RECEIPT_MODULE } from '../lib/journal'
import type { PartDraft } from '../lib/journal'

// 一笔里的几种业务（数据库 37）：每行一个业务模块、客户 / 供应商、摘要、金额。
// total 给了（从银行流水填的、到账以外剩下的钱）：几行加起来要等于它，下面写还差多少；没给（记现金）：金额就是几行加起来。
// 设备回款那几行（填收进来的流水时才有）：客户、摘要不在这里填，下一步录成到账时选车（大架号）。
// 有 total 时第一行“兜底”：改了后面几行的金额（或删了一行），第一行自动变成剩下的，常见的两种分（关税 + 手续费）只填一个数。

export default function PartsEditor({
  rows,
  onChange,
  modules,
  total,
  currency,
  readOnly,
  counterparties,
  minRows = 2,
}: {
  rows: PartDraft[]
  onChange: (rows: PartDraft[]) => void
  /** 下拉里能选的业务模块 */
  modules: string[]
  /** 几行加起来要等于多少；空 = 不限（金额跟着几行加起来走） */
  total?: number | null
  currency?: string
  readOnly?: boolean
  /** 客户 / 供应商的候选（客户资料里的名字） */
  counterparties: { value: string }[]
  /** 最少留几行（删到这么多就不让删了） */
  minRows?: number
}) {
  const t = useT()
  const sum = partsTotal(rows)
  const diff = total == null ? 0 : round2(total - sum)
  /** 第一行兜底：等于 total 减去后面几行（减出来不是正数就空着） */
  const settle = (next: PartDraft[]): PartDraft[] => {
    if (total == null || next.length < 2) return next
    const rest = round2(total - partsTotal(next.slice(1)))
    return [{ ...next[0], amount: rest > 0 ? rest : null }, ...next.slice(1)]
  }
  const set = (key: string, patch: Partial<PartDraft>) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
    onChange('amount' in patch && rows[0]?.key !== key ? settle(next) : next)
  }
  const add = () => onChange([...rows, newPart({ amount: diff > 0 ? diff : null })])
  const remove = (key: string) => onChange(settle(rows.filter((r) => r.key !== key)))

  return (
    <div className="parts-box">
      <Row gutter={8} className="parts-head hint">
        <Col sm={6}>{t('业务模块')}</Col>
        <Col sm={6}>{t('客户 / 供应商')}</Col>
        <Col sm={7}>{t('摘要')}</Col>
        <Col sm={4}>{t('金额')}</Col>
      </Row>
      {rows.map((r, i) => {
        const car = r.module === RECEIPT_MODULE
        return (
          <Row gutter={8} key={r.key} className="parts-row" align="middle">
            <Col xs={24} sm={6}>
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                virtual={false}
                className="part-module"
                style={{ width: '100%' }}
                placeholder={t('第 {n} 种业务', { n: i + 1 })}
                value={r.module}
                disabled={readOnly}
                onChange={(m: string) => set(r.key, m === RECEIPT_MODULE ? { module: m, counterparty: undefined, summary: undefined } : { module: m })}
                options={modules.map((m) => ({ value: m, label: t(m) }))}
                labelRender={(o) => <Tag color={moduleColor(String(o.value))}>{o.label}</Tag>}
              />
            </Col>
            <Col xs={24} sm={6}>
              <AutoComplete
                className="part-cp"
                style={{ width: '100%' }}
                value={r.counterparty}
                disabled={readOnly || car}
                placeholder={car ? t('下一步选车') : t('客户 / 供应商')}
                options={counterparties}
                filterOption={(q, o) => String(o?.value ?? '').toLowerCase().includes(q.toLowerCase())}
                onChange={(v: string) => set(r.key, { counterparty: v })}
              />
            </Col>
            <Col xs={24} sm={7}>
              <Input
                className="part-summary"
                value={r.summary}
                maxLength={500}
                disabled={readOnly || car}
                placeholder={car ? t('下一步选车') : t('摘要')}
                onChange={(e) => set(r.key, { summary: e.target.value })}
              />
            </Col>
            <Col xs={20} sm={4}>
              <InputNumber
                className="part-amount"
                style={{ width: '100%' }}
                min={0.01}
                precision={2}
                value={r.amount ?? null}
                disabled={readOnly}
                placeholder={t('金额')}
                onChange={(v) => set(r.key, { amount: v === null ? null : Number(v) })}
              />
            </Col>
            <Col xs={4} sm={1}>
              {!readOnly && (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  aria-label={t('删掉这一种')}
                  title={t('删掉这一种')}
                  disabled={rows.length <= minRows}
                  onClick={() => remove(r.key)}
                />
              )}
            </Col>
          </Row>
        )
      })}
      <div className="parts-foot">
        {!readOnly && rows.length < 20 ? (
          <Button size="small" icon={<PlusOutlined />} onClick={add}>
            {t('再加一种')}
          </Button>
        ) : (
          <span />
        )}
        <span className={total == null ? 'num' : Math.abs(diff) < 0.005 ? 'num text-ok' : 'num text-warn'}>
          {total == null
            ? t('合计 {cur} {sum}', { cur: currency ?? '', sum: money(sum) })
            : Math.abs(diff) < 0.005
              ? t('合计 {cur} {sum}，正好', { cur: currency ?? '', sum: money(sum) })
              : diff > 0
                ? t('合计 {cur} {sum}，还差 {diff}', { cur: currency ?? '', sum: money(sum), diff: money(diff) })
                : t('合计 {cur} {sum}，多了 {diff}', { cur: currency ?? '', sum: money(sum), diff: money(-diff) })}
        </span>
      </div>
    </div>
  )
}
