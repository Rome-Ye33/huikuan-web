// 银行日记账、现金日记账：每个账户每天收了多少、付了多少、还剩多少（数据库 36）。
// 分两个模块（菜单、权限各一个）：银行日记账（银行账户，权限 journal）、现金日记账（现金、momo，权限 cash）。
// 银行账户先导流水再填：日记账就是银行流水本身，一条一行，金额、日期、余额都是银行的；
//   收进来的配上到账（设备回款 / 配件回款）或填成其他收入、互转；付出去的填成付款或互转；没填的标“待填”，照样算余额。
// 现金账户（cash、momo）没有流水：一笔笔记（支出、其他收入、互转），加上审批通过的现金到账。
// 账户之间的钱（资金拨付、货币兑换、现金存现、银行取现）录一次“账户互转”，两边各记一笔；银行那一边没流水就“等流水”，导进来自动对上。
// 读：v_journal（一笔一行）、journal_month（每个账户一段时间的期初 / 收 / 付 / 期末 / 银行余额）。
// 写：save_cash_entry、delete_cash_entry、fill_statement_lines（勾几条一起填）、save_openings。
import { useBadges } from './badges'
import { round2 } from './format'
import type { Duty } from './perms'
import type { Account } from './supabase'
import type { Database, Json } from './database.types'

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

/** 哪本日记账：bank 银行日记账（银行账户）、cash 现金日记账（现金、momo） */
export type JournalScope = 'bank' | 'cash'
export const scopeOf = (a: Pick<Account, 'kind'> | undefined | null): JournalScope => (isCashLike(a) ? 'cash' : 'bank')
/** 每本日记账看哪个模块权限 */
export const SCOPE_PERM: Record<JournalScope, 'journal' | 'cash'> = { bank: 'journal', cash: 'cash' }
export const SCOPE_TITLE: Record<JournalScope, string> = { bank: '银行日记账', cash: '现金日记账' }
export const SCOPE_PATH: Record<JournalScope, string> = { bank: '/journal', cash: '/cash' }

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
 * none 这段时间没有流水（灰）；cash 现金账户，没有流水。
 * bank_diff = 最后一条带余额的流水上，算出来的余额 - 银行给的余额（数据库算）；以前导的流水没有余额列，就只看填没填完。
 */
export type AcctStatus = 'ok' | 'todo' | 'broken' | 'none' | 'cash'
export function acctStatus(m: AccountMonth, cash: boolean): AcctStatus {
  if (cash) return 'cash'
  const hasBank = m.bank_balance !== null && m.bank_balance !== undefined
  if (!hasBank && !Number(m.line_n)) return 'none'
  if (hasBank && Math.abs(round2(Number(m.bank_diff ?? 0))) >= 0.005) return 'broken'
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

/**
 * 一笔里的几种业务（数据库 37）：流水（或一笔现金）还是一条、金额照银行的，里面分几种业务，
 * 每种一个业务模块、客户 / 供应商、摘要、金额，加起来等于这一笔的金额。
 * 日记账（v_journal.parts）里还带着：到账的每一笔拆分（设备回款 / 配件回款，带大架号、到账 id），收支那一笔的 id；doc_no 是单号。
 * 只有一种的是空。
 */
export type Part = {
  module: string
  counterparty: string | null
  summary: string | null
  amount: number
  vin: string | null
  receipt_id: number | null
  entry_id: number | null
  doc_no: string | null
}

const optStr = (v: Json | undefined): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const optNum = (v: Json | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

/** 数据库里存的几种业务（jsonb 数组）读成 Part[]；不是数组就是空的 */
export function parseParts(v: Json | null | undefined): Part[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is { [k: string]: Json | undefined } => !!x && typeof x === 'object' && !Array.isArray(x))
    .map((x) => ({
      module: String(x.module ?? ''),
      counterparty: optStr(x.counterparty),
      summary: optStr(x.summary),
      amount: Number(x.amount ?? 0),
      vin: optStr(x.vin),
      receipt_id: optNum(x.receipt_id),
      entry_id: optNum(x.entry_id),
      doc_no: optStr(x.doc_no),
    }))
}

/** 一行日记账里有哪些业务模块（分了几种的每种都算）：按业务模块筛选时，分了几种的里面有就算 */
export function lineModules(l: Pick<JournalLine, 'module' | 'parts'>): string[] {
  const ps = parseParts(l.parts)
  return ps.length ? [...new Set(ps.map((p) => p.module))] : l.module ? [l.module] : []
}

/** 设备回款：要选大架号，走到账录入（到账拆分选车）；在几种业务里出现时，那部分录成到账 */
export const RECEIPT_MODULE = '设备回款'

/** 录入框里的一种业务（还没存）：金额可以先空着 */
export type PartDraft = { key: string; module?: string; counterparty?: string; summary?: string; amount?: number | null }
let partSeq = 0
export const newPart = (p: Omit<PartDraft, 'key'> = {}): PartDraft => ({ key: `p${++partSeq}`, ...p })
/** 几种业务的金额加起来 */
export const partsTotal = (rows: PartDraft[]) => round2(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0))
/** 存进数据库的样子：去空白，空的写 null */
export const partsPayload = (rows: PartDraft[]) =>
  rows.map((r) => ({ module: r.module ?? null, counterparty: r.counterparty?.trim() || null, summary: r.summary?.trim() || null, amount: round2(Number(r.amount ?? 0)) }))

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

/**
 * 菜单角标：银行流水还没填的条数，按分工算（填收款的只算收进来的，填付款的只算付出去的，没分工的两样加起来）。
 * 数字由 badges.ts 的共用轮询取，5 分钟一次；填了、导了流水马上重取
 */
export function useLineTodo(enabled: boolean, duty: Duty | null): number {
  const b = useBadges(enabled, false, true)
  return duty === 'in' ? b.lineIn : duty === 'out' ? b.lineOut : b.lineIn + b.lineOut
}
