import { EN } from '../i18n/en'
import {
  PAY_STATE_ZH,
  parsePayments,
  parseVehicles,
  paymentDisplay,
  perCarCommission,
  payStateEn,
  payStateVars,
  savedTotals,
  TRAIL_PRINT,
  VOUCHER_STATUS_EN,
  VOUCHER_STATUS_LABEL,
  voucherStatus,
} from '../lib/commission'
import type { CommissionVoucher } from '../lib/commission'
import { stepPrintNames, voucherFlow } from '../lib/flow'
import { dateTime, money, num, shortDate } from '../lib/format'
import { useRefData } from '../lib/refdata'
import type { ApprovalLog } from '../lib/workbench'

// 打印的提成单：照 Excel 模板（提成单模板 Commission Voucher Template）的版式，中英文都印，A4 竖版。
// 发的提成有人要美元、有人要赛地，所以填了汇率的单子在合计下面多印一行汇率和折合赛地（没填的照旧只印美元）。
// 每台车的提成可以一样、也可以不一样（Rome 2026-11-13），填了就多印一列“本车提成”，合计那一行印小计；
// 一台都没填的单子（以前的单子都是）照旧只有整单一个提成金额，这一列不出现。
// 一张单上可以混着结清和没结清的车（Rome 2026-11-13），所以车辆那一栏印每台车现在的“已到账 / 余额”：
// 这个数来自车辆台账（这台车收到的所有钱），不是这张单勾的那几笔，所以和下面“客户已支付金额合计”不一定对得上。
// 内容是提交时存下的车和付款，审批后再改到账也不会变。签名栏是这张单走的审批流（提交时记下的；草稿是现在的审批流）。
// 签名栏下面是“审批过程”（Rome 2026-11-12：打印上要体现审批的过程）：approval_logs 里这张单的每一步，
// 谁、什么时候、做了什么（提交、哪一级通过、退回和原因、重新提交、撤回、发放），按时间先后。还没提交过的草稿没有这一栏。

/** 中文 + 英文（对照表里有英文的才加） */
function bi(zh: string | null | undefined): string {
  if (!zh) return ''
  const en = EN[zh]
  return en ? `${zh} ${en}` : zh
}

function fill(zh: string, vars?: Record<string, number>): string {
  return zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''))
}

/** 有数才显示（0 和空都留白，和模板一样） */
function amt(v: unknown): string {
  return v === null || v === undefined || v === '' || num(v) === 0 ? '' : money(v)
}

export default function CommissionSheet({
  v,
  trail = [],
  ledger,
}: {
  v: CommissionVoucher
  trail?: ApprovalLog[]
  /** 每台车现在的到账情况（车辆台账里的数，不是这张单上的）：结清了没有、还差多少 */
  ledger?: Map<number, { received: number; balance: number }>
}) {
  const vehicles = parseVehicles(v.vehicles)
  /** 每台车分开填了提成（可以一样、可以不一样）：车辆那一栏多印一列「本车提成」，合计那一行多印一个小计 */
  const perCar = perCarCommission(vehicles)
  const payments = parsePayments(v.payments)
  const tt = savedTotals(v)
  const { steps } = useRefData()
  const byKey = new Map(steps.map((s) => [s.key, s]))
  const status = voucherStatus(v.status)
  const final = status === 'approved' || status === 'paid'
  // 盖在右上角的状态：审批中的写明等哪一级
  const pending = status === 'submitted' && v.step ? stepPrintNames(byKey.get(v.step), v.step) : null
  const stamp = pending
    ? `待${pending.zh}审批 PENDING${pending.en ? ' ' + pending.en : ''}`
    : `${VOUCHER_STATUS_LABEL[status]} ${VOUCHER_STATUS_EN[status]}`
  const flow = voucherFlow(v.flow, steps)
  const many = vehicles.length > 1
  const st = tt.state

  return (
    <div className="cv-sheet">
      <table className="cv-table">
        <colgroup>
          {/* 8 列是固定的，每一行自己拼。第 6 列（填了每台车的提成时是「本车提成」）比模板宽一点，
              宽出来的从大架号和备注里匀，印出来标题才不会断在词中间 */}
          <col style={{ width: '12.7%' }} />
          <col style={{ width: '11.1%' }} />
          <col style={{ width: '13.4%' }} />
          <col style={{ width: '12.2%' }} />
          <col style={{ width: '9.6%' }} />
          <col style={{ width: '12.7%' }} />
          <col style={{ width: '14.3%' }} />
          <col style={{ width: '14.0%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={8} className="cv-company">
              FET AUTO COMPANY LIMITED
            </td>
          </tr>
          <tr>
            <td colSpan={8} className="cv-title">
              提成单&nbsp;&nbsp;COMMISSION VOUCHER
            </td>
          </tr>
          <tr>
            <td colSpan={8} className="cv-meta">
              {!final && <span className="cv-stamp">{stamp}</span>}
              编号 NO.&nbsp;{v.voucher_no ?? '—'}
            </td>
          </tr>
          <tr>
            <th>
              日期
              <br />
              DATE
            </th>
            <td className="c">{v.voucher_date}</td>
            <th>
              申请部门
              <br />
              REQUESTING DEPT
            </th>
            <td>{bi(v.dept)}</td>
            <th colSpan={2}>
              业务员
              <br />
              SALESPERSON
            </th>
            <td colSpan={2}>{v.salesperson_name}</td>
          </tr>

          <tr>
            <td colSpan={8} className="cv-section">
              一、客户及车辆&nbsp;&nbsp;CUSTOMER &amp; VEHICLES
            </td>
          </tr>
          <tr>
            <th>
              客户名称
              <br />
              CUSTOMER
            </th>
            <td colSpan={7}>{v.customer_name}</td>
          </tr>
          <tr>
            <th>
              数量与设备型号
              <br />
              QTY &amp; MODEL
            </th>
            <td colSpan={7}>{v.qty_model}</td>
          </tr>
          <tr className="cv-head">
            <th>
              序号
              <br />
              NO.
            </th>
            <th colSpan={2}>
              大架号
              <br />
              CHASSIS NO.
            </th>
            <th colSpan={perCar == null ? 2 : 1}>
              品牌/车型/规格
              <br />
              BRAND / MODEL
            </th>
            <th>
              单价
              <br />
              UNIT PRICE (USD)
            </th>
            {perCar != null && (
              <th>
                本车提成
                <br />
                COMMISSION (USD)
              </th>
            )}
            <th>
              本车已到账 / 余额
              <br />
              PAID / BALANCE
            </th>
            <th>
              备注
              <br />
              NOTE
            </th>
          </tr>
          {vehicles.map((x, i) => {
            const paid = ledger?.get(x.vehicle_id)
            return (
              <tr key={x.vehicle_id}>
                <td className="c">{i + 1}</td>
                <td colSpan={2} className="cv-vin">
                  {x.vin}
                </td>
                <td colSpan={perCar == null ? 2 : 1}>{x.model}</td>
                <td className="r">{money(x.unit_price_usd)}</td>
                {perCar != null && <td className="r">{x.commission_usd == null ? '' : money(x.commission_usd)}</td>}
                <td className="r">
                  {paid && (
                    <>
                      {money(paid.received)}
                      <br />
                      <span className="cv-trail-en">{paid.balance < 1 ? '已结清 PAID OFF' : `还差 ${money(paid.balance)}`}</span>
                    </>
                  )}
                </td>
                <td>{[bi(x.payment_method), x.note].filter(Boolean).join('; ')}</td>
              </tr>
            )
          })}
          <tr>
            <th>
              台数合计
              <br />
              TOTAL UNITS
            </th>
            <td className="c b">{tt.units}</td>
            <th colSpan={perCar == null ? 3 : 2}>车辆合计&nbsp;&nbsp;VEHICLES TOTAL (USD)</th>
            <td className="r b">{money(tt.vehiclesUsd)}</td>
            {perCar != null && <td className="r b">{money(perCar)}</td>}
            <td colSpan={2} />
          </tr>

          <tr>
            <td colSpan={8} className="cv-section">
              二、销售及付款方式&nbsp;&nbsp;SALES &amp; PAYMENT TERMS
            </td>
          </tr>
          <tr>
            <th>
              其他费用 (USD)
              <br />
              OTHER CHARGES
            </th>
            <td className="r">{amt(v.other_charges_usd)}</td>
            <th>
              费用说明
              <br />
              CHARGES NOTE
            </th>
            <td>{v.charges_note}</td>
            <th colSpan={2}>
              折扣
              <br />
              DISCOUNT (USD)
            </th>
            <td colSpan={2} className="r">
              {amt(v.discount_usd)}
            </td>
          </tr>
          <tr>
            <th>
              销售总金额 (USD)
              <br />
              TOTAL SALES
            </th>
            <td className="r b">{money(tt.totalSales)}</td>
            <th>
              是否全款
              <br />
              FULL PAYMENT
            </th>
            <td className="c">{v.full_payment === false ? '否 NO' : '是 YES'}</td>
            <th colSpan={2}>
              首付金额 (USD)
              <br />
              DOWN PAYMENT
            </th>
            <td colSpan={2} className="r">
              {v.full_payment === false ? amt(v.down_payment_usd) : ''}
            </td>
          </tr>
          <tr>
            <th>
              分期期数
              <br />
              NO. OF TERMS
            </th>
            <td className="c">{v.full_payment === false ? (v.terms_count ?? '') : ''}</td>
            <th>
              每期金额
              <br />
              PER TERM (USD)
            </th>
            <td className="r">{v.full_payment === false ? amt(v.per_term_usd) : ''}</td>
            <th colSpan={2}>
              已还 / 剩余期数
              <br />
              PAID / LEFT TERMS
            </th>
            <td className="c">{tt.termsPaid ?? ''}</td>
            <td className="c">{tt.termsLeft ?? ''}</td>
          </tr>

          <tr>
            <td colSpan={8} className="cv-section">
              三、客户付款明细（每笔按当天汇率）&nbsp;&nbsp;PAYMENTS RECEIVED (each at the day&apos;s rate)
            </td>
          </tr>
          <tr className="cv-head">
            <th>
              款项类型/期次
              <br />
              PAYMENT TYPE
            </th>
            <th>
              收款日期
              <br />
              DATE
            </th>
            <th colSpan={2}>
              本单收款金额
              <br />
              AMOUNT
            </th>
            <th>
              币种
              <br />
              CURRENCY
            </th>
            <th>
              当天汇率
              <br />
              RATE GHS/USD
            </th>
            <th>
              折合美元
              <br />
              USD
            </th>
            <th>
              备注（合付总额/分摊）
              <br />
              NOTE
            </th>
          </tr>
          {payments.map((p) => {
            const d = paymentDisplay(p)
            const note = [p.note, d.sharedFrom ? `合付 TOTAL ${d.sharedFrom}` : '', many && p.vin ? `VIN …${p.vin.slice(-6)}` : '']
              .filter(Boolean)
              .join('; ')
            return (
              <tr key={p.claim_id}>
                <td>{bi(p.nature)}</td>
                <td className="c">{p.pay_date}</td>
                <td colSpan={2} className="r">
                  {money(d.amount)}
                </td>
                <td className="c">{d.currency}</td>
                <td className="r">{d.rate ?? ''}</td>
                <td className="r">{money(d.usd)}</td>
                <td>{note}</td>
              </tr>
            )
          })}
          <tr>
            <th colSpan={6}>客户已支付金额合计&nbsp;&nbsp;TOTAL PAID BY CUSTOMER (USD)</th>
            <td className="r b">{money(tt.paid)}</td>
            <td className="cv-warn">{st.kind === 'overpaid' ? '⚠ 已付超过销售额 OVERPAID' : ''}</td>
          </tr>
          <tr>
            <th>
              未付余额
              <br />
              BALANCE (USD)
            </th>
            <td className="r b">{money(tt.balance)}</td>
            <th>
              付款进度
              <br />
              PAYMENT PROGRESS
            </th>
            <td className="r">{tt.progress == null ? '' : `${(tt.progress * 100).toFixed(1)}%`}</td>
            <th colSpan={2}>
              分期情况
              <br />
              STATUS
            </th>
            <td colSpan={2} className={st.kind === 'overpaid' ? 'cv-warn' : ''}>
              {fill(PAY_STATE_ZH[st.kind], payStateVars(st))} {payStateEn(st)}
            </td>
          </tr>

          <tr>
            <td colSpan={8} className="cv-section">
              四、提成&nbsp;&nbsp;COMMISSION
            </td>
          </tr>
          <tr>
            <th>
              提成金额 (USD)
              <br />
              COMMISSION
            </th>
            <td className="r">{v.commission_usd == null ? '' : money(v.commission_usd)}</td>
            <th>
              本次发放比例
              <br />
              PAYOUT RATIO
            </th>
            <td className="r">{v.payout_ratio == null ? '' : `${Math.round(num(v.payout_ratio) * 10000) / 100}%`}</td>
            <th colSpan={2}>
              备注
              <br />
              REMARKS
            </th>
            <td colSpan={2}>{v.remarks}</td>
          </tr>
          <tr>
            <th colSpan={6}>本次发放提成合计&nbsp;&nbsp;TOTAL (USD)</th>
            <td colSpan={2} className="r b cv-big">
              {tt.payout == null ? '' : money(tt.payout)}
            </td>
          </tr>
          {tt.payoutGhs != null && (
            <tr>
              <th colSpan={3}>
                美元转赛地汇率
                <br />
                RATE GHS/USD
              </th>
              <td className="r">{tt.payoutRate}</td>
              <th colSpan={2}>
                折合赛地
                <br />
                TOTAL (GHS)
              </th>
              <td colSpan={2} className="r b cv-big">
                {money(tt.payoutGhs)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="cv-sign" style={{ gridTemplateColumns: `repeat(${Math.min(flow.length + 1, 6)}, 1fr)` }}>
        <Sign zh="制单人" en="PREPARED BY" name={v.prepared_name} at={v.prepared_at} />
        {flow.map((f) => {
          const n = stepPrintNames(byKey.get(f.step), f.step)
          return <Sign key={f.step} zh={n.zh} en={n.en} name={f.by_name} at={f.at} />
        })}
      </div>
      <div className="cv-sign-note">以上各级为线上审批，无需签字&nbsp;&nbsp;Approved online in the system; no signature required</div>
      {status === 'paid' && (
        <div className="cv-paid">
          已发放 PAID OUT：{v.paid_on}
          {v.paid_name ? ` · ${v.paid_name}` : ''}
        </div>
      )}

      {trail.length > 0 && (
        <table className="cv-table cv-trail">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '37%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '21%' }} />
          </colgroup>
          <tbody>
            <tr>
              <td colSpan={5} className="cv-section">
                审批过程&nbsp;&nbsp;APPROVAL RECORD
              </td>
            </tr>
            <tr className="cv-head">
              <th>
                序号
                <br />
                NO.
              </th>
              <th>
                步骤
                <br />
                STEP
              </th>
              <th>
                处理人
                <br />
                BY
              </th>
              <th>
                时间
                <br />
                TIME
              </th>
              <th>
                意见
                <br />
                NOTE
              </th>
            </tr>
            {trail.map((r, i) => {
              const a = TRAIL_PRINT[r.action] ?? { zh: r.action, en: '' }
              // 通过、退回写明是哪一级
              const lv = r.step ? stepPrintNames(byKey.get(r.step), r.step) : null
              return (
                <tr key={r.id}>
                  <td className="c">{i + 1}</td>
                  <td>
                    {lv ? `${lv.zh} ` : ''}
                    {a.zh}
                    <span className="cv-trail-en">
                      {lv?.en ? ` ${lv.en}` : ''} {a.en}
                    </span>
                  </td>
                  <td>{r.actor_name ?? ''}</td>
                  <td className="c">{dateTime(r.at)}</td>
                  <td>{r.note ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Sign({ zh, en, name, at }: { zh: string; en: string; name: string | null; at: string | null }) {
  return (
    <div>
      <div className="cv-sign-label">
        {zh}
        {en ? (
          <>
            <br />
            {en}:
          </>
        ) : (
          ':'
        )}
      </div>
      <div className="cv-sign-name">{name ?? ''}</div>
      <div className="cv-sign-date">{name ? shortDate(at) : ''}</div>
    </div>
  )
}
