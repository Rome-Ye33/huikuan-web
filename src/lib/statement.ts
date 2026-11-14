// 解析银行导出的 CSV / Excel：认表头、对列，收、付都取（收入正数、支出负数），有余额列也取；以及把文件里的账户名对到系统账户。
// 导入时按银行的先后（从旧到新）送进去：数据库靠这个顺序检查余额接不接得上，同一天的先后也照这个
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { round2 } from './format'
import type { Account } from './supabase'

dayjs.extend(customParseFormat)

export type Mapping = {
  date?: number
  /** 贷方 / 收入；只有一列有正有负的“金额”时也选这一列 */
  credit?: number
  /** 借方 / 支出 */
  debit?: number
  balance?: number
  drcr?: number
  summary?: number
  ref?: number
  cheque?: number
  account?: number
}
export type ParsedLine = {
  line_date: string
  /** 收入正数，支出负数 */
  amount_orig: number
  payer_summary: string
  bank_ref: string
  cheque_no: string
  account_key: string
  /** 这一条之后银行上的余额（文件有余额列才有） */
  balance: number | null
  /** 同一份文件里先入账、后来又被冲掉的一对（退票、冲回）：两条都导进来（余额才接得上），标成忽略 */
  ignored?: boolean
  note?: string
  /** 文件里第几行，提示用 */
  row: number
}
/** 贷方列里的负数：退票、冲回。paired 表示在同一文件里找到了被冲掉的那笔入账 */
export type Reversal = { account_key: string; line_date: string | null; amount: number; payer_summary: string; paired: boolean }
/** 文件里余额接不上的地方。diff = 按上一个余额和中间的收付算出来的 - 银行写的 */
export type ChainBreak = { account_key: string; row: number; line_date: string; diff: number }
export type Parsed = {
  lines: ParsedLine[]
  bad: number[]
  reversals: Reversal[]
  breaks: ChainBreak[]
  /** 文件里出现过的账户名和行数（含“无交易”的行），只在选了“账户列”时有 */
  seen: Map<string, number>
  minDate: string | null
  maxDate: string | null
}
/** 导入后数据库查出来的余额接不上：n 处，前几处在哪一天、差多少（算出来的 - 银行的） */
export type ChainInfo = { n: number; first: { line_id: number; line_date: string; diff: number }[] }
export type ImportResult = {
  inserted: number
  skipped: number
  matched: number
  /** 收进来的、还没配上的 */
  unmatched: number
  /** 这次新导进来的付款条数 */
  debits?: number
  /** 付出去的、还没填的 */
  unfilled?: number
  /** 以前导过、这次补上余额的 */
  balance_filled?: number
  chain?: ChainInfo
}

/** 同一份文件里一对退票、冲回的忽略原因 */
export const REVERSAL_NOTE = '退票 / 冲回'

export const DATE_FORMATS = ['DD/MM/YYYY', 'D/M/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY', 'DD MMM YYYY', 'DD.MM.YYYY']

function excelSerialToDate(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
}

export function parseDate(v: unknown, fmt: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelSerialToDate(v) : null
  const s = String(v)
    .trim()
    .split(/\s+\d{1,2}:\d{2}/)[0] // 去掉时间部分
    .replace(/[A-Za-z]{3,}/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) // 30-JUL-26 → 30-Jul-26，严格匹配才认得
  for (const f of [fmt, ...DATE_FORMATS]) {
    // 银行导出的月份是英文缩写（Jul、AUG），要按英文认；界面用的中文 locale 认不出
    const d = dayjs(s, f, 'en', true)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  return null
}

// 金额：去掉币种、逗号、空格。负号、括号、结尾的 DR 都算负数，如“GHS -1,500.00”“(1,500.00)”“1,500.00 DR”
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  const core = s.replace(/[^0-9.\-()]/g, '')
  if (!/[0-9]/.test(core)) return null
  const negative = /^[-(]/.test(core) || /\bDR?\.?$/i.test(s)
  const n = Number(core.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

// 按优先级找列：先找名字最像的，找不到再放宽；exclude 匹配到的列不要（如“合计”“期初”）；skip 是已经被别的用了的列
function findCol(headers: string[], patterns: RegExp[], exclude?: RegExp, skip: (number | undefined)[] = []): number | undefined {
  for (const re of patterns) {
    const i = headers.findIndex((h, j) => re.test(h.trim()) && !exclude?.test(h) && !skip.includes(j))
    if (i >= 0) return i
  }
  return undefined
}

const TOTALS = /total|合计|汇总|期初|期末|opening|closing|available|本月/i

export function guessMapping(headers: string[]): Mapping {
  // “Credit”一类的列优先，免得把表头上的“Total_Deposit”“本月收入”当成入账列
  const credit = findCol(headers, [/^(credit|cr\.?)(\s*amount)?(\s|\(|$)/i, /^(贷方|收入|入账|存入)/, /credit|贷方|收入|money\s*in/i, /deposit/i], TOTALS)
  const debit = findCol(
    headers,
    [/^(debit|dr\.?)(\s*amount)?(\s|\(|$)/i, /^(借方|支出|付出|取出|支取)/, /debit|借方|支出|money\s*out|withdraw/i],
    TOTALS,
    [credit],
  )
  return {
    date: findCol(headers, [/value[\s_]*date|起息/i, /trans(action)?[\s_]*date|交易日期|记账日期/i, /posting[\s_]*date/i, /日期|date/i], /create|print|打印|生成/i),
    // 只有一列有正有负的“金额”：当贷方列选上，负数是支出
    credit: credit ?? (debit === undefined ? findCol(headers, [/^(transaction\s*)?amount(\s|\(|$)/i, /^(交易)?金额/], TOTALS) : undefined),
    debit,
    // 账面余额；“可用余额”“期初 / 期末余额”不要
    balance: findCol(headers, [/^(running\s*|ledger\s*|book\s*)?balance(\s|\(|$)/i, /^(账户)?余额/, /balance|余额/i], /opening|closing|available|期初|期末|可用|total|合计/i),
    drcr: findCol(headers, [/^(dr\s*\/\s*cr|cr\s*\/\s*dr|借贷|借贷标志)$/i]),
    summary: findCol(headers, [/narration|description|details|remark|particular|payee|memo|摘要|备注|用途/i]),
    ref: findCol(headers, [/reference|ref\.?\s*no|^ref\b|transaction\s*id|流水号|参考/i]),
    cheque: findCol(headers, [/cheque|check\s*no|支票/i]),
    // 只认中文的“账户名称”一类。网银导出里的“Account Name”是户名，不是哪个账户
    account: findCol(headers, [/^(账户名称|账户|收款账户|账户名|银行账户)$/]),
  }
}

export function toLines(rows: unknown[][], headerRow: number, m: Mapping, fmt: string): Parsed {
  const out: Parsed = { lines: [], bad: [], reversals: [], breaks: [], seen: new Map(), minDate: null, maxDate: null }
  if (m.date === undefined || (m.credit === undefined && m.debit === undefined)) return out
  // 选的是有正有负的“金额”列时，负数就是支出；选的是贷方 / 收入列时，负数是退票、冲回
  const creditHeader = m.credit !== undefined ? String(rows[headerRow - 1]?.[m.credit] ?? '') : ''
  const signedColumn = /amount|金额/i.test(creditHeader) && !/credit|贷方|收入|deposit|入账|存入/i.test(creditHeader)
  const raw: ParsedLine[] = []
  /** 贷方列里的负数（退票、冲回） */
  const reversals = new Set<ParsedLine>()
  for (let i = headerRow; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === '' || c === null || c === undefined)) continue
    const acct = m.account !== undefined ? String(r[m.account] ?? '').trim() : ''
    if (m.account !== undefined) {
      if (!acct) continue // 合计行、说明行
      out.seen.set(acct, (out.seen.get(acct) ?? 0) + 1)
    }
    const rawDate = r[m.date]
    const d = parseDate(rawDate, fmt)
    if (d) {
      if (!out.minDate || d < out.minDate) out.minDate = d
      if (!out.maxDate || d > out.maxDate) out.maxDate = d
    }
    const cr = m.credit !== undefined ? parseAmount(r[m.credit]) : null
    const dr = m.debit !== undefined ? parseAmount(r[m.debit]) : null
    const flag = m.drcr !== undefined ? String(r[m.drcr] ?? '').trim() : ''
    let amt = 0
    let reversal = false
    if (cr) {
      if (/^d/i.test(flag)) amt = -Math.abs(cr)
      else if (/^c/i.test(flag)) amt = Math.abs(cr)
      else {
        amt = cr
        reversal = cr < 0 && !signedColumn
      }
    }
    if (dr) amt -= Math.abs(dr)
    amt = round2(amt)
    if (amt === 0) continue // 空行、“无交易”
    if (rawDate === '' || rawDate === null || rawDate === undefined) continue // 没有日期的是合计行、期初余额行
    if (!d) {
      out.bad.push(i + 1)
      continue
    }
    const summary = m.summary !== undefined ? String(r[m.summary] ?? '').trim() : ''
    const line: ParsedLine = {
      line_date: d,
      amount_orig: amt,
      payer_summary: summary,
      bank_ref: m.ref !== undefined ? String(r[m.ref] ?? '').trim() : '',
      cheque_no: m.cheque !== undefined ? String(r[m.cheque] ?? '').trim() : '',
      account_key: acct,
      balance: m.balance !== undefined ? parseAmount(r[m.balance]) : null,
      row: i + 1,
    }
    raw.push(line)
    if (reversal) reversals.add(line)
  }

  // 按账户分开：从新到旧排的倒过来；退票、冲回配对；查余额接不接得上
  const byAcct = new Map<string, ParsedLine[]>()
  for (const l of raw) byAcct.set(l.account_key, [...(byAcct.get(l.account_key) ?? []), l])
  for (const [key, list] of byAcct) {
    if (isNewestFirst(list)) list.reverse()
    // 退票、冲回：找冲回那天或之前最近一笔同额、还没配过的入账，两条都标成忽略（钱进来又出去，照样算余额，但不配到账）
    for (const rv of list) {
      if (!reversals.has(rv)) continue
      let best: ParsedLine | undefined
      for (const l of list) {
        if (l === rv) break
        if (l.amount_orig !== -rv.amount_orig || l.ignored) continue
        best = l
      }
      if (best) {
        best.ignored = rv.ignored = true
        best.note = rv.note = REVERSAL_NOTE
      }
      out.reversals.push({ account_key: key, line_date: rv.line_date, amount: -rv.amount_orig, payer_summary: rv.payer_summary, paired: !!best })
    }
    out.breaks.push(...chainBreaks(list))
    out.lines.push(...list)
  }
  return out
}

/** 一个账户的流水是不是从新到旧排的：有余额就看余额怎么接得上，没有就看头尾的日期 */
function isNewestFirst(list: ParsedLine[]): boolean {
  let fwd = 0
  let back = 0
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]
    const b = list[i]
    if (a.balance === null || b.balance === null) continue
    if (Math.abs(round2(a.balance + b.amount_orig) - b.balance) < 0.005) fwd++
    if (Math.abs(round2(b.balance + a.amount_orig) - a.balance) < 0.005) back++
  }
  if (fwd || back) return back > fwd
  return list.length > 1 && list[0].line_date > list[list.length - 1].line_date
}

/** 从旧到新走一遍：每个余额 = 上一个余额 + 中间的收付 */
function chainBreaks(list: ParsedLine[]): ChainBreak[] {
  const out: ChainBreak[] = []
  let prev: number | null = null
  let sum = 0
  for (const l of list) {
    sum += l.amount_orig
    if (l.balance === null) continue
    if (prev !== null) {
      const diff = round2(prev + sum - l.balance)
      if (Math.abs(diff) >= 0.005) out.push({ account_key: l.account_key, row: l.row, line_date: l.line_date, diff })
    }
    prev = l.balance
    sum = 0
  }
  return out
}

// 前 15 行里第一行同时认得出“日期”和收入或支出列的就是表头；认不出返回 0
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const m = guessMapping((rows[i] ?? []).map((c) => String(c ?? '')))
    if (m.date !== undefined && (m.credit !== undefined || m.debit !== undefined)) return i + 1
  }
  return 0
}

const CURRENCY_CODES = ['GHS', 'USD', 'SLL', 'SLE', 'GNF', 'EUR', 'GBP', 'CNY', 'XOF', 'NGN']
const normName = (s: string) => s.toUpperCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '')

/** 文件里的账户名对到系统账户：先比全名，再按“币种 + 账号后 4 位”找唯一的一个 */
export function matchAccount(raw: string, accounts: Account[]): number | undefined {
  const n = normName(raw)
  const exact = accounts.filter((a) => [a.list_name, a.short_name].some((x) => x && normName(x) === n))
  if (exact.length === 1) return exact[0].id
  const cur = CURRENCY_CODES.find((c) => n.includes(c))
  for (const run of (n.match(/\d{4,}/g) ?? []).reverse()) {
    const hits = accounts.filter((a) => a.last4 === run.slice(-4) && (!cur || a.currency === cur))
    if (hits.length === 1) return hits[0].id
  }
  return undefined
}
