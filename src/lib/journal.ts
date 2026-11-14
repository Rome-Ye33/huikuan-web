// 银行现金日记账：每个账户每天收了多少、付了多少、还剩多少，和银行流水的余额比。
// 收：到账录入里审批通过的到账自动带进来（设备回款 / 配件回款），加上这里录的“其他收入”。
// 付：这里录的“支出”。账户之间的钱（资金拨付、货币兑换、现金存现、银行取现）录一次“账户互转”，两边各记一笔。
// 读：v_journal（一笔一行）、journal_month（每个账户一段时间的期初 / 收 / 付 / 期末 / 银行余额）。写：save_cash_entry、delete_cash_entry。
import { round2 } from './format'
import type { Account } from './supabase'
import type { Database } from './database.types'

export type JournalLine = Database['public']['Views']['v_journal']['Row']
export type AccountMonth = Database['public']['Functions']['journal_month']['Returns'][number]
export type CashEntry = Database['public']['Tables']['cash_entries']['Row']

export type Dir = 'in' | 'out'
/** 录哪一种：支出、其他收入、账户互转 */
export type EntryKind = 'out' | 'in' | 'transfer'
/** 待填的银行流水怎么填：付款、其他收入、互转、录成到账 */
export type FillHow = 'out' | 'in' | 'transfer' | 'receipt'

/**
 * 业务模块：和《终端解款表》里的一样。dir = 平时是收还是付（两边都有的不写）；
 * transfer = 账户之间的钱；auto = 由到账录入自动带进来，这里不能手录。
 */
export const JOURNAL_MODULES: { name: string; dir?: Dir; transfer?: boolean; auto?: boolean }[] = [
  { name: '设备回款', dir: 'in', auto: true },
  { name: '配件回款', dir: 'in' },
  { name: '飞亚配件款', dir: 'in' },
  { name: '维修收入', dir: 'in' },
  { name: '其他收入', dir: 'in' },
  { name: '利息收入', dir: 'in' },
  { name: '保险理赔款', dir: 'in' },
  { name: '不明货款', dir: 'in' },
  { name: '其他费用', dir: 'out' },
  { name: '关税', dir: 'out' },
  { name: '清关费用', dir: 'out' },
  { name: '滞港费', dir: 'out' },
  { name: '手续费', dir: 'out' },
  { name: '账户管理费', dir: 'out' },
  { name: 'VAT', dir: 'out' },
  { name: '采购款-设备', dir: 'out' },
  { name: '采购款-配件', dir: 'out' },
  { name: '在建工程', dir: 'out' },
  { name: '固定资产', dir: 'out' },
  { name: '信保款', dir: 'out' },
  { name: '信用证' },
  { name: '代收代付' },
  { name: '其他往来款' },
  { name: '个人往来' },
  { name: '第三方往来' },
  { name: '倒账往来' },
  { name: '资金拨付', transfer: true },
  { name: '货币兑换', transfer: true },
  { name: '现金存现', transfer: true },
  { name: '现金存现-库马西', transfer: true },
  { name: '银行取现', transfer: true },
  { name: '资金归集', transfer: true },
]

/** 业务模块的颜色：收绿、付橙、往来蓝、互转紫 */
export function moduleColor(name: string | null | undefined): string {
  const m = JOURNAL_MODULES.find((x) => x.name === name)
  if (!m) return 'default'
  if (m.transfer) return 'purple'
  if (m.dir === 'in') return 'green'
  if (m.dir === 'out') return 'orange'
  return 'blue'
}

/** 录入时下拉里的业务模块：这一类常用的排前面，往来类的放后面；手录不能选“设备回款”（车款走到账录入） */
export function moduleOptions(kind: EntryKind): string[] {
  if (kind === 'transfer') return JOURNAL_MODULES.filter((m) => m.transfer).map((m) => m.name)
  const own = JOURNAL_MODULES.filter((m) => m.dir === kind && !m.auto).map((m) => m.name)
  const both = JOURNAL_MODULES.filter((m) => !m.dir && !m.transfer).map((m) => m.name)
  return [...own, ...both]
}

/** 现金类的账户（现金、momo）：没有银行流水，不用对账 */
export const isCashLike = (a: Pick<Account, 'kind'> | undefined | null) => !!a && a.kind !== 'bank'

/** 账户互转是哪一种：现金→银行 现金存现，银行→现金 银行取现，币种不同 货币兑换，其余 资金拨付 */
export function transferModule(from: Account | undefined, to: Account | undefined): string {
  if (!from || !to) return '资金拨付'
  if (from.currency !== to.currency) return '货币兑换'
  if (isCashLike(from) && !isCashLike(to)) return '现金存现'
  if (!isCashLike(from) && isCashLike(to)) return '银行取现'
  return '资金拨付'
}

/** 账号后 4 位（解款表里写“8651户转4418户”）；现金账户用简称 */
export const accountTail = (a: Account | undefined) => (a ? (a.kind === 'bank' && a.last4 ? `${a.last4}户` : a.short_name) : '')

/** 账户互转的默认摘要，照解款表的写法：资金拨付【8651户转4418户】、货币兑换【5662户塞地兑换美元至1727户】 */
export function transferSummary(module: string, from: Account | undefined, to: Account | undefined): string {
  if (!from || !to) return ''
  if (module === '货币兑换') return `货币兑换【${accountTail(from)}${CURRENCY_ZH[from.currency] ?? from.currency}兑换${CURRENCY_ZH[to.currency] ?? to.currency}至${accountTail(to)}】`
  return `${module}【${accountTail(from)}转${accountTail(to)}】`
}

/** 币别的中文名（解款表里的叫法） */
export const CURRENCY_ZH: Record<string, string> = {
  GHS: '塞地',
  USD: '美元',
  CNY: '人民币',
  EUR: '欧元',
  GBP: '英镑',
  XOF: '西非法郎',
  SLL: '利昂',
  SLE: '利昂',
  GNF: '几内亚法郎',
}

/**
 * 银行账户先导流水再填：日记账就是流水本身，所以余额一定跟着银行走。账户的状态只有这几种：
 * ok 流水都填完了（绿）；todo 还有流水没填（橙）；broken 算出来的余额和银行流水上的余额接不上（红，多半是漏导了一段或期初填错）；
 * none 还没导过流水（灰）；cash 现金账户，没有流水。
 */
export type AcctStatus = 'ok' | 'todo' | 'broken' | 'none' | 'cash'
export function acctStatus(m: AccountMonth, cash: boolean): AcctStatus {
  if (cash) return 'cash'
  if (m.bank_balance === null || m.bank_balance === undefined) return 'none'
  if (Math.abs(round2(Number(m.closing) - Number(m.bank_balance))) >= 0.005) return 'broken'
  return Number(m.unfilled_n) > 0 ? 'todo' : 'ok'
}
export const ACCT_STATUS_COLOR: Record<AcctStatus, string> = { ok: 'success', todo: 'orange', broken: 'error', none: 'default', cash: 'default' }

/** 明细表里的一行：一笔收付，或者某一天的小计 */
export type LedgerRow =
  | { type: 'opening'; key: string; date: string; balance: number }
  | { type: 'line'; key: string; line: JournalLine; balance: number | null }
  | { type: 'day'; key: string; date: string; income: number; expense: number; balance: number | null; count: number }

/**
 * 给一个账户的明细算每一行的余额，每天最后加一行“本日合计”。
 * opening = 这段时间开始那天之前的余额；没选单个账户（opening 为 null）就不算余额。
 */
export function buildLedger(lines: JournalLine[], opening: number | null, from: string, daySubtotal: boolean): LedgerRow[] {
  const out: LedgerRow[] = []
  let bal = opening
  if (opening !== null) out.push({ type: 'opening', key: 'opening', date: from, balance: opening })
  let day: string | null = null
  let dIn = 0
  let dOut = 0
  let dCount = 0
  const closeDay = () => {
    if (day && daySubtotal && dCount > 1) out.push({ type: 'day', key: `day-${day}`, date: day, income: round2(dIn), expense: round2(dOut), balance: bal, count: dCount })
    dIn = 0
    dOut = 0
    dCount = 0
  }
  for (const l of lines) {
    if (l.entry_date !== day) {
      closeDay()
      day = l.entry_date
    }
    const inc = Number(l.amount_in ?? 0)
    const exp = Number(l.amount_out ?? 0)
    if (bal !== null) bal = round2(bal + inc - exp)
    dIn += inc
    dOut += exp
    dCount++
    out.push({ type: 'line', key: l.key ?? `${l.source}-${l.source_id}`, line: l, balance: bal })
  }
  closeDay()
  return out
}

/** 一条银行流水填了没有：待填（橙）、到账还在审批（金）；填好了不用标 */
export const FILL_COLOR: Record<string, string> = { 待填: 'orange', 审批中: 'gold' }

/** 账户分组（和解款表主页一样：按公司分开，现金单独一组） */
export function accountGroup(a: Account): string {
  if (a.kind !== 'bank') return '现金 / momo'
  return a.company || '其他银行账户'
}
const GROUP_ORDER = ['FET AUTO', 'FEIYA', 'FET MINING']
export function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g)
  if (i >= 0) return i
  return g === '现金 / momo' ? 99 : 50
}
const CUR_ORDER = ['GHS', 'USD']
export function currencyRank(c: string): number {
  const i = CUR_ORDER.indexOf(c)
  return i >= 0 ? i : 9
}

/** 一个月的第一天和最后一天 */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

/** 通知别的页面：日记账变了（录了一笔、改了期初） */
export function notifyJournalChanged() {
  window.dispatchEvent(new Event('journal-changed'))
}
