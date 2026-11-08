// 解析银行导出的 CSV / Excel：认表头、对列、取贷方（入账）记录，以及把文件里的账户名对到系统账户
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { round2 } from './format'
import type { Account } from './supabase'

dayjs.extend(customParseFormat)

export type Mapping = { date?: number; credit?: number; drcr?: number; summary?: number; ref?: number; cheque?: number; account?: number }
export type ParsedLine = { line_date: string; amount_orig: number; payer_summary: string; bank_ref: string; cheque_no: string; account_key: string }
/** 贷方列里的负数：退票、冲回。paired 表示在同一文件里找到了被冲掉的那笔入账（两笔都不导入） */
export type Reversal = { account_key: string; line_date: string | null; amount: number; payer_summary: string; paired: boolean }
export type Parsed = {
  lines: ParsedLine[]
  bad: number[]
  reversals: Reversal[]
  /** 文件里出现过的账户名和行数（含只有支出、“无交易”的行），只在选了“账户列”时有 */
  seen: Map<string, number>
  minDate: string | null
  maxDate: string | null
}
export type ImportResult = { inserted: number; skipped: number; matched: number; unmatched: number }

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

// 按优先级找列：先找名字最像的，找不到再放宽；exclude 匹配到的列不要（如“合计”“期初”）
function findCol(headers: string[], patterns: RegExp[], exclude?: RegExp): number | undefined {
  for (const re of patterns) {
    const i = headers.findIndex((h) => re.test(h.trim()) && !exclude?.test(h))
    if (i >= 0) return i
  }
  return undefined
}

export function guessMapping(headers: string[]): Mapping {
  return {
    date: findCol(headers, [/value[\s_]*date|起息/i, /trans(action)?[\s_]*date|交易日期|记账日期/i, /posting[\s_]*date/i, /日期|date/i], /create|print|打印|生成/i),
    // “Credit”一类的列优先，免得把表头上的“Total_Deposit”“本月收入”当成入账列
    credit: findCol(
      headers,
      [/^(credit|cr\.?)(\s*amount)?(\s|\(|$)/i, /^(贷方|收入|入账|存入)/, /credit|贷方|收入|money\s*in/i, /deposit/i],
      /total|合计|汇总|期初|期末|opening|closing|available|本月/i,
    ),
    drcr: findCol(headers, [/^(dr\s*\/\s*cr|cr\s*\/\s*dr|借贷|借贷标志)$/i]),
    summary: findCol(headers, [/narration|description|details|remark|particular|payee|memo|摘要|备注|用途/i]),
    ref: findCol(headers, [/reference|ref\.?\s*no|^ref\b|transaction\s*id|流水号|参考/i]),
    cheque: findCol(headers, [/cheque|check\s*no|支票/i]),
    // 只认中文的“账户名称”一类。网银导出里的“Account Name”是户名，不是哪个账户
    account: findCol(headers, [/^(账户名称|账户|收款账户|账户名|银行账户)$/]),
  }
}

export function toLines(rows: unknown[][], headerRow: number, m: Mapping, fmt: string): Parsed {
  const out: Parsed = { lines: [], bad: [], reversals: [], seen: new Map(), minDate: null, maxDate: null }
  if (m.credit === undefined || m.date === undefined) return out
  // 选的是有正有负的“金额”列时，负数就是支出；选的是贷方 / 收入列时，负数才是退票、冲回
  const creditHeader = String(rows[headerRow - 1]?.[m.credit] ?? '')
  const signedColumn = /amount|金额/i.test(creditHeader) && !/credit|贷方|收入|deposit|入账|存入/i.test(creditHeader)
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
    const amt = parseAmount(r[m.credit])
    if (amt === null || amt === 0) continue // 借方或空行
    if (m.drcr !== undefined && /^d/i.test(String(r[m.drcr] ?? '').trim())) continue
    if (rawDate === '' || rawDate === null || rawDate === undefined) continue // 没有日期的是合计行、期初余额行
    const summary = m.summary !== undefined ? String(r[m.summary] ?? '').trim() : ''
    if (amt < 0) {
      if (!signedColumn) out.reversals.push({ account_key: acct, line_date: d, amount: round2(-amt), payer_summary: summary, paired: false })
      continue
    }
    if (!d) {
      out.bad.push(i + 1)
      continue
    }
    out.lines.push({
      line_date: d,
      amount_orig: round2(amt),
      payer_summary: summary,
      bank_ref: m.ref !== undefined ? String(r[m.ref] ?? '').trim() : '',
      cheque_no: m.cheque !== undefined ? String(r[m.cheque] ?? '').trim() : '',
      account_key: acct,
    })
  }
  // 退票、冲回：在同一账户里找冲回日或之前最近一笔同额入账，两笔都不导入。
  // 这样原来录的到账在流水里就找不到了，会出现在“录了、银行查不到”，提醒财务处理
  for (const rv of out.reversals) {
    let best = -1
    out.lines.forEach((l, idx) => {
      if (l.account_key !== rv.account_key || l.amount_orig !== rv.amount) return
      if (rv.line_date && l.line_date > rv.line_date) return
      if (best < 0 || l.line_date >= out.lines[best].line_date) best = idx
    })
    if (best >= 0) {
      out.lines.splice(best, 1)
      rv.paired = true
    }
  }
  return out
}

// 前 15 行里第一行同时认得出“日期”和“贷方/收入”列的就是表头；认不出返回 0
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const m = guessMapping((rows[i] ?? []).map((c) => String(c ?? '')))
    if (m.date !== undefined && m.credit !== undefined) return i + 1
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
