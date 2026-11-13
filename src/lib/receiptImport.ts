// 批量导入到账：认表头、对列，把表里的行整理成一笔笔到账（一笔可以拆给几台车），对到系统里的账户、车、客户上，再查重。
// 写库还是一笔一笔调 save_receipt，和点“新建到账”一模一样：走审批流、自动和银行流水配对、对上支票。
//
// 一笔到账怎么认：
// - 有金额的行是一笔新到账；日期、账户空着的沿用上一笔（合并单元格读出来就是这样）。
// - 金额空着、只填了拆分那几列（大架号、客户、款项性质、拆分金额……）的行，接在上一笔到账下面，算它的拆分。
// - 有“到账序号”列时，序号和上一行一样的也接在一起。
// - 连着几行到账日期、账户、金额都一样、每行都写了拆分金额、加起来不超过到账金额：当成一笔钱拆给几台车。
import { EN } from '../i18n/en'
import { matchCustomer } from './aiFill'
import { money, num, round2, todayAccra } from './format'
import { defaultNature } from './natures'
import { parseAmount, parseDate } from './statement'
import type { Account, Customer, Nature, Salesperson, Vehicle } from './supabase'

export type RField =
  | 'group'
  | 'date'
  | 'account'
  | 'amount'
  | 'fx_rate'
  | 'usd'
  | 'payer'
  | 'bank_ref'
  | 'cheque_no'
  | 'note'
  | 'vin'
  | 'customer'
  | 'nature'
  | 'claim_amount'
  | 'salesperson'
  | 'model'
export type RMapping = Partial<Record<RField, number>>

type FieldDef = { key: RField; label: string; part: 'receipt' | 'claim'; required?: boolean; patterns: RegExp[]; exclude?: RegExp }

/** 字段：界面名（中文，同时是翻译的 key；模板的表头也用它）、属于到账还是拆分、认表头的规则（先严后宽）、不要的列 */
export const R_FIELDS: FieldDef[] = [
  {
    key: 'group',
    label: '到账序号',
    part: 'receipt',
    // 只认明说是“到账”的序号；普通的“序号”多半是行号，要用的话自己选
    patterns: [/^(到账序号|到账编号|组号|笔号|receipt\s*(group|no\.?|#))$/i],
  },
  {
    key: 'date',
    label: '到账日期',
    part: 'receipt',
    required: true,
    patterns: [
      /^(到账日期|日期|入账日期|收款日期|交易日期|receipt\s*date|date|value\s*date)$/i,
      /到账日期|入账日期|收款日期|交易日期|日期|date/i,
    ],
    exclude: /合同|发车|报款|到期|签约|开票|contract|due|release|report|print|create/i,
  },
  {
    key: 'account',
    label: '收款账户',
    part: 'receipt',
    required: true,
    patterns: [/^(收款账户|账户|账户名称|收款账号|银行账户|收款银行|receiving\s*account|account)$/i, /收款账户|收款账号|账户|receiving\s*account/i],
    exclude: /户名|开户|account\s*name/i,
  },
  {
    key: 'amount',
    label: '金额',
    part: 'receipt',
    required: true,
    patterns: [
      /^(金额|到账金额|转账金额|收款金额|入账金额|原币金额|amount|amount\s*received)$/i,
      /到账金额|转账金额|收款金额|入账金额|原币金额|金额|amount/i,
    ],
    exclude: /拆分|认领|分配|合同|usd|美元|美金|折美|余额|balance|contract|split|allocat/i,
  },
  { key: 'fx_rate', label: '汇率', part: 'receipt', patterns: [/^(汇率|约定汇率|rate|fx\s*rate|exchange\s*rate)$/i, /汇率|exchange\s*rate/i] },
  {
    key: 'usd',
    label: 'USD金额',
    part: 'receipt',
    patterns: [/^(usd|usd\s*金额|美元|美金|美元金额|折美元|usd\s*amount|amount\s*usd)$/i, /usd|美元|美金|折美/i],
    exclude: /拆分|认领|分配|合同|余额|split|allocat|contract|balance/i,
  },
  {
    key: 'payer',
    label: '付款方 / 摘要',
    part: 'receipt',
    patterns: [/^(付款方\s*\/\s*摘要|付款方|摘要|付款人|付款单位|payer\s*\/\s*narration|payer|narration|description)$/i, /付款方|摘要|付款人|payer|narration/i],
  },
  {
    key: 'bank_ref',
    label: '参考号',
    part: 'receipt',
    patterns: [/^(参考号|银行参考号|流水号|bank\s*ref\.?|reference|ref\.?(\s*no\.?)?)$/i, /参考号|流水号|reference|\bref\b/i],
  },
  {
    key: 'cheque_no',
    label: '支票号',
    part: 'receipt',
    patterns: [/^(支票号|支票号码|cheque\s*no\.?|cheque\s*number|cheque)$/i, /支票号|cheque\s*no|check\s*no/i],
    exclude: /银行|bank/i,
  },
  { key: 'note', label: '备注', part: 'receipt', patterns: [/^(备注|说明|note|notes|remarks?)$/i, /备注|\bnote|remark/i] },
  {
    key: 'vin',
    label: '大架号',
    part: 'claim',
    patterns: [/^(大架号|车架号|vin|chassis(\s*no\.?)?)$/i, /大架号|车架号|\bvin\b|chassis/i],
    exclude: /金蝶/,
  },
  {
    key: 'customer',
    label: '客户',
    part: 'claim',
    patterns: [/^(客户|客户名称|customer|customer\s*name)$/i, /客户|customer/i],
    exclude: /金蝶|编号|电话|代码|code|phone/i,
  },
  {
    key: 'nature',
    label: '款项性质',
    part: 'claim',
    patterns: [/^(款项性质|款项类型|性质|payment\s*type|type)$/i, /款项|性质|payment\s*type/i],
    exclude: /付款方式|车|设备|payment\s*(method|terms)|vehicle|model/i,
  },
  {
    key: 'claim_amount',
    label: '拆分金额',
    part: 'claim',
    patterns: [/^(拆分金额|认领金额|分配金额|本车金额|allocated\s*amount|split\s*amount|allocated)$/i, /拆分|认领|分配|allocat|split/i],
    exclude: /usd|美元|美金/i,
  },
  {
    key: 'salesperson',
    label: '业务员',
    part: 'claim',
    patterns: [/^(业务员|salesperson|sales)$/i, /业务员|sales\s*person/i],
    exclude: /金蝶|部门/,
  },
  {
    key: 'model',
    label: '车型',
    part: 'claim',
    patterns: [/^(车型|型号|设备型号|数量与设备型号|model)$/i, /车型|设备型号|型号|\bmodel/i],
    exclude: /金蝶/,
  },
]

/** 模板的列，按这个顺序 */
export const R_TEMPLATE: RField[] = R_FIELDS.map((f) => f.key)

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

export function guessReceiptMapping(headers: string[]): RMapping {
  const m: RMapping = {}
  const used = new Set<number>()
  for (const f of R_FIELDS) {
    for (const re of f.patterns) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(clean(h)) && !f.exclude?.test(clean(h)))
      if (i >= 0) {
        m[f.key] = i
        used.add(i)
        break
      }
    }
  }
  return m
}

/** 表头在第几行（1 起）：前 20 行里第一行认得出到账日期和金额的；认不出返回 0 */
export function findReceiptHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const m = guessReceiptMapping((rows[i] ?? []).map((c) => String(c ?? '')))
    if (m.date !== undefined && m.amount !== undefined) return i + 1
  }
  return 0
}

// ---------------------------------------------------------------- 读单元格
export type Issue = { key: string; vars?: Record<string, string | number> }
type Note = Issue & { level: 'error' | 'warn' | 'info' }

/** 2026.10.22、2026年10月22日、2026/10/22 先改成 2026-10-22，其余交给 parseDate（日在前） */
export function parseReceiptDate(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})\s*日?/)
    if (m) return parseDate(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, 'YYYY-MM-DD')
  }
  return parseDate(v, 'DD/MM/YYYY')
}

/** 金额单元格里写的币种（只看文字，数字单元格没有） */
function currencyHint(v: unknown): 'USD' | 'GHS' | null {
  if (typeof v !== 'string') return null
  if (/\$|usd|美元|美金/i.test(v)) return 'USD'
  if (/ghs|gh₵|gh¢|cedi|塞地/i.test(v)) return 'GHS'
  return null
}

/** 合计、小计这类行不是到账 */
const TOTAL_ROW = /^(合\s*计|总\s*计|小\s*计|共\s*计|total|grand\s*total|sub\s*total|sum)\s*[:：]?$/i

/** 大架号一格里可以写几个（换行、逗号、顿号、分号隔开）；“无”“-”这类不算 */
export function splitVins(v: unknown): { vins: string[]; short: string[] } {
  const parts = String(v ?? '')
    .toUpperCase()
    .split(/[\s,，;；、/|]+/)
    .map((x) => x.replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
  const vins: string[] = []
  const short: string[] = []
  for (const p of parts) {
    if (p.length >= 6) {
      if (!vins.includes(p)) vins.push(p)
    } else if (/\d/.test(p) && /[0-9]{3,}/.test(p)) short.push(p)
  }
  return { vins, short }
}

type Raw = {
  row: number
  group: string
  date: string | null
  dateText: string
  account: string
  amountText: string
  amount: number | null
  amountCur: 'USD' | 'GHS' | null
  rateText: string
  rate: number | null
  usdText: string
  usd: number | null
  payer: string
  bank_ref: string
  cheque_no: string
  note: string
  vinText: string
  vins: string[]
  shortVins: string[]
  customer: string
  nature: string
  claimText: string
  claim: number | null
  salesperson: string
  model: string
}

function readRow(r: unknown[], row: number, m: RMapping): Raw {
  const cell = (k: RField) => (m[k] === undefined ? '' : r[m[k] as number])
  const text = (k: RField) => clean(cell(k))
  const amount = (k: RField) => (text(k) === '' ? null : parseAmount(cell(k)))
  const { vins, short } = splitVins(cell('vin'))
  return {
    row,
    group: text('group'),
    date: text('date') === '' ? null : parseReceiptDate(cell('date')),
    dateText: text('date'),
    account: text('account'),
    amountText: text('amount'),
    amount: amount('amount'),
    amountCur: currencyHint(cell('amount')),
    rateText: text('fx_rate'),
    rate: amount('fx_rate'),
    usdText: text('usd'),
    usd: amount('usd'),
    payer: text('payer'),
    bank_ref: text('bank_ref'),
    cheque_no: text('cheque_no'),
    note: text('note'),
    vinText: text('vin'),
    vins,
    shortVins: short,
    customer: text('customer'),
    nature: text('nature'),
    claimText: text('claim_amount'),
    claim: amount('claim_amount'),
    salesperson: text('salesperson'),
    model: text('model'),
  }
}

const hasClaimData = (r: Raw) => !!(r.vinText || r.customer || r.nature || r.claimText || r.model || r.salesperson)

// ---------------------------------------------------------------- 整理成一笔笔到账
/** 表里的一行拆分（一格写了几个大架号的，后面按大架号拆成几行） */
export type DraftLine = {
  row: number
  vins: string[]
  shortVins: string[]
  customer: string
  nature: string
  claimText: string
  claim: number | null
  salesperson: string
  model: string
}

export type Draft = {
  /** 第一行的行号，当 key 用 */
  key: number
  rows: number[]
  group: string
  date: string | null
  dateText: string
  /** 沿用了上一笔的日期 / 账户（这一行是空的） */
  dateFilled: boolean
  account: string
  accountFilled: boolean
  amountText: string
  amount: number | null
  amountCur: 'USD' | 'GHS' | null
  rateText: string
  rate: number | null
  usdText: string
  usd: number | null
  payer: string
  bank_ref: string
  cheque_no: string
  note: string
  lines: DraftLine[]
  notes: Note[]
  /** 只有金额（日期、账户都沿用上一行，别的都没写）：可能是合计行，默认不勾 */
  bare: boolean
}

export type Ignored = { row: number; reason: 'total' | 'no_amount' | 'orphan' }

const toLine = (r: Raw): DraftLine => ({
  row: r.row,
  vins: r.vins,
  shortVins: r.shortVins,
  customer: r.customer,
  nature: r.nature,
  claimText: r.claimText,
  claim: r.claim,
  salesperson: r.salesperson,
  model: r.model,
})

/** 到账日期、账户、金额和付款信息都一样（看连着几行是不是同一笔钱） */
const headerKey = (d: Draft) => [d.date ?? d.dateText, d.account.toUpperCase(), d.amount ?? d.amountText, d.rate ?? '', d.usd ?? '', d.payer, d.bank_ref, d.cheque_no].join('|')
const rowRange = (rows: number[]) => (rows.length > 1 ? `${rows[0]}–${rows[rows.length - 1]}` : String(rows[0]))

export function groupReceipts(rows: unknown[][], headerRow: number, m: RMapping): { drafts: Draft[]; ignored: Ignored[] } {
  const drafts: Draft[] = []
  const ignored: Ignored[] = []
  let cur: Draft | null = null
  for (let i = Math.max(headerRow, 1); i < rows.length; i++) {
    const cells = rows[i] ?? []
    const r = readRow(cells, i + 1, m)
    const any = R_FIELDS.some((f) => m[f.key] !== undefined && clean(cells[m[f.key] as number]) !== '')
    if (!any) continue // 空行
    if (cells.some((c) => TOTAL_ROW.test(clean(c)))) {
      ignored.push({ row: r.row, reason: 'total' })
      continue
    }
    const sameGroup = !!cur && m.group !== undefined && r.group !== '' && r.group === cur.group
    if (sameGroup && cur) {
      // 序号一样：同一笔到账。这一行也写了日期、账户、金额的，要和第一行一样
      const diff =
        (r.amountText && r.amount !== cur.amount) || (r.date && cur.date && r.date !== cur.date) || (r.account && r.account.toUpperCase() !== cur.account.toUpperCase())
      if (diff)
        cur.notes.push({ level: 'error', key: '到账序号 {group} 的几行，到账日期、账户或金额不一样（第 {a} 行和第 {b} 行）', vars: { group: r.group, a: cur.rows[0], b: r.row } })
      cur.rows.push(r.row)
      if (hasClaimData(r)) cur.lines.push(toLine(r))
      continue
    }
    if (!r.amountText) {
      // 没写金额：接在上一笔下面当拆分；序号不一样、或者前面还没有到账的不算
      const otherGroup = m.group !== undefined && r.group !== '' && cur && r.group !== cur.group
      if (hasClaimData(r) && cur && !otherGroup) {
        cur.rows.push(r.row)
        cur.lines.push(toLine(r))
      } else ignored.push({ row: r.row, reason: hasClaimData(r) ? 'orphan' : 'no_amount' })
      continue
    }
    // 新的一笔到账：日期、账户空着的沿用上一笔（合并单元格）
    const prev: Draft | null = cur
    const bare = !r.dateText && !r.account && !!prev && !r.payer && !r.bank_ref && !r.cheque_no && !r.note && !hasClaimData(r)
    if (bare && prev && r.amount !== null) {
      // 只有一个金额、正好等于上面同一天同一账户几笔的合计：是合计行
      let sum = 0
      let k = 0
      for (let j = drafts.length - 1; j >= 0 && drafts[j].date === prev.date && drafts[j].account === prev.account; j--) {
        sum += num(drafts[j].amount)
        k++
      }
      if (k >= 2 && Math.abs(round2(sum) - r.amount) < 0.01) {
        ignored.push({ row: r.row, reason: 'total' })
        continue
      }
    }
    const d: Draft = {
      key: r.row,
      rows: [r.row],
      group: r.group,
      date: r.dateText ? r.date : (prev?.date ?? null),
      dateText: r.dateText || (prev?.dateText ?? ''),
      dateFilled: !r.dateText && !!prev?.dateText,
      account: r.account || (prev?.account ?? ''),
      accountFilled: !r.account && !!prev?.account,
      amountText: r.amountText,
      amount: r.amount,
      amountCur: r.amountCur,
      rateText: r.rateText,
      rate: r.rate,
      usdText: r.usdText,
      usd: r.usd,
      payer: r.payer,
      bank_ref: r.bank_ref,
      cheque_no: r.cheque_no,
      note: r.note,
      lines: hasClaimData(r) ? [toLine(r)] : [],
      notes: bare ? [{ level: 'warn', key: '这一行只有金额，日期和账户是沿用上一行的；如果是合计行，别勾它' }] : [],
      bare,
    }
    drafts.push(d)
    cur = d
  }

  // 连着几行到账信息一模一样：每行都写了拆分金额、加起来不超过到账金额的，是同一笔钱拆给几台车；否则当几笔，提醒核对
  const out: Draft[] = []
  for (let i = 0; i < drafts.length; ) {
    let j = i + 1
    while (j < drafts.length && headerKey(drafts[j]) === headerKey(drafts[i]) && !drafts[j].group && !drafts[i].group) j++
    const run = drafts.slice(i, j)
    if (run.length > 1) {
      const lines = run.flatMap((d) => d.lines)
      const amount = run[0].amount ?? 0
      const allSplit = run.every((d) => d.lines.length > 0 && d.lines.every((l) => l.claim !== null && l.claim > 0))
      const sum = round2(lines.reduce((s, l) => s + num(l.claim), 0))
      if (allSplit && amount > 0 && sum <= amount + 0.005) {
        const merged: Draft = { ...run[0], rows: run.flatMap((d) => d.rows), lines, notes: run.flatMap((d) => d.notes) }
        merged.notes.push({
          level: 'info',
          key: '第 {rows} 行到账日期、账户、金额都一样，拆分金额加起来不超过到账金额，当成一笔到账拆给 {n} 行',
          vars: { rows: rowRange(merged.rows), n: lines.length },
        })
        out.push(merged)
      } else {
        out.push(run[0])
        for (const d of run.slice(1))
          out.push({
            ...d,
            notes: [
              ...d.notes,
              { level: 'warn', key: '和第 {row} 行的到账日期、账户、金额一样。如果是同一笔钱拆给几台车，把下面几行的日期、账户、金额清空，或者加一列到账序号', vars: { row: run[0].key } },
            ],
          })
      }
    } else out.push(run[0])
    i = j
  }
  return { drafts: out, ignored }
}

// ---------------------------------------------------------------- 对到系统里
export type VehicleLite = Pick<
  Vehicle,
  'id' | 'vin' | 'customer_id' | 'customer_name' | 'salesperson_id' | 'salesperson_name' | 'payment_method' | 'received_usd' | 'down_payment_usd' | 'balance_usd' | 'model'
>
export type ExistingReceipt = { id: number; receipt_no: string; account_id: number; receipt_date: string; amount_orig: number; bank_ref: string | null }
export type Rate = { currency: string; rate_date: string; rate: number }

export type PClaim = {
  row: number
  vin: string
  vehicle: VehicleLite | null
  customer_id: number | null
  customer_name: string
  nature: string
  amount: number | null
  salesperson_id: number | null
  model_desc: string | null
  /** 存不了（没对上车、也没对上客户），这一行拆分不导 */
  dropped: boolean
}

export type Status = 'new' | 'exists' | 'error'
export type PReceipt = {
  key: number
  rows: number[]
  status: Status
  account_id: number | null
  account_text: string
  currency: string
  date: string | null
  amount: number | null
  fx_rate: number | null
  rate_from: 'file' | 'usd' | 'table' | 'usd_account' | null
  amount_usd: number | null
  payer: string
  bank_ref: string
  cheque_no: string
  note: string
  claims: PClaim[]
  /** 系统里已经有的那笔 */
  existing: ExistingReceipt | null
  /** 可能是合计行（只有金额），默认不勾 */
  suspect: boolean
  errors: Issue[]
  warnings: Issue[]
  infos: Issue[]
}

export type Ctx = {
  /** 文件里的账户写法 → 系统账户 id（大写比较）；没有账户列时用 defaultAccount */
  accountFor: (text: string) => number | undefined
  accountById: Map<number, Account>
  customers: Customer[]
  salespersons: Salesperson[]
  natures: Nature[]
  vehicles: Map<string, VehicleLite>
  rates: Rate[]
  existing: ExistingReceipt[]
  /** 这次刚导进去的：哪一笔（key）存成了哪张到账（id）。查重时先认回自己那张，文件里一模一样的几行不会对错 */
  pinned?: Map<number, number>
  today?: string
}

// 大架号里没有字母 O、I、Q，抄错的当成数字再找一次
const fixVin = (s: string) => s.replace(/[OQ]/g, '0').replace(/I/g, '1')

/** 按大架号找车：一样的；O、I 抄错的；只写了后几位的（只有一台才算） */
export function findVehicle(vin: string, vehicles: Map<string, VehicleLite>, all: VehicleLite[]): { v: VehicleLite; how: 'exact' | 'fixed' | 'tail' } | null {
  const a = vehicles.get(vin)
  if (a) return { v: a, how: 'exact' }
  if (vin.length === 17) {
    const b = vehicles.get(fixVin(vin))
    return b ? { v: b, how: 'fixed' } : null
  }
  if (vin.length < 6 || vin.length > 17) return null
  const tail = all.filter((v) => (v.vin ?? '').endsWith(vin))
  return tail.length === 1 ? { v: tail[0], how: 'tail' } : null
}

const NATURE_ALIAS: Record<string, string> = {
  设备分期款: '分期款',
  设备款: '全款',
  尾款: '全款尾款',
  首付: '首付款',
  预付: '预付款',
  分期: '分期款',
  配件: '配件款',
  退还客户: '退款',
  返还客户: '退款',
}
const natNorm = (s: string) => s.toLowerCase().replace(/[\s_\-/]+/g, '')

/** 款项性质：系统里的名字、英文名、常见的说法都认。not_receipt = 期初余额、优惠折让这类不走到账的 */
export function matchNature(text: string, natures: Nature[]): { name: string | null; how: 'ok' | 'empty' | 'unknown' | 'not_receipt' } {
  const s = natNorm(text)
  if (!s) return { name: null, how: 'empty' }
  const same = (n: Nature) => natNorm(n.name) === s || natNorm(EN[n.name] ?? '') === s
  const usable = natures.filter((n) => n.active && (n.kind === 'payment' || n.kind === 'parts' || n.kind === 'refund'))
  const ok = usable.find(same)
  if (ok) return { name: ok.name, how: 'ok' }
  const alias = NATURE_ALIAS[text.trim()]
  if (alias && usable.some((n) => n.name === alias)) return { name: alias, how: 'ok' }
  const other = natures.find(same)
  return other ? { name: other.name, how: 'not_receipt' } : { name: null, how: 'unknown' }
}

const spNorm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** 一笔钱付几台车、没写每台多少：各台余额加起来正好就按余额分，不然平均分（最后一台补零头） */
function share(total: number, cars: (VehicleLite | null)[], rate: number): { amounts: number[]; how: 'balance' | 'even' } {
  const k = cars.length
  const rest = (list: number[]) => [...list.slice(0, -1), round2(total - list.slice(0, -1).reduce((s, x) => s + x, 0))]
  if (rate > 0 && cars.every((v) => v && num(v.balance_usd) > 0)) {
    const want = cars.map((v) => round2(num(v?.balance_usd) * rate))
    const sum = want.reduce((s, x) => s + x, 0)
    if (Math.abs(sum - total) <= Math.max(1, total * 0.01)) return { amounts: rest(want), how: 'balance' }
  }
  return { amounts: rest(cars.map(() => round2(total / k))), how: 'even' }
}

/** 某币种在某天（或之前最近一天）的汇率 */
function rateOn(rates: Rate[], currency: string, date: string): Rate | null {
  let best: Rate | null = null
  for (const r of rates) if (r.currency === currency && r.rate_date <= date && (!best || r.rate_date > best.rate_date)) best = r
  return best
}

export function resolveReceipts(drafts: Draft[], ctx: Ctx): PReceipt[] {
  const today = ctx.today ?? todayAccra()
  const allVehicles = [...ctx.vehicles.values()]
  const spById = new Map(ctx.salespersons.map((s) => [s.id, s]))
  const spByName = new Map(ctx.salespersons.map((s) => [spNorm(s.name), s]))
  const custById = new Map(ctx.customers.map((c) => [c.id, c]))
  const refSeen = new Map<string, number>()

  const out = drafts.map<PReceipt>((d) => {
    const pick = (level: Note['level']): Issue[] => d.notes.filter((n) => n.level === level).map(({ key, vars }) => ({ key, vars }))
    const errors: Issue[] = pick('error')
    const warnings: Issue[] = pick('warn')
    const infos: Issue[] = pick('info')

    // ---- 账户、日期、金额
    const account_id = ctx.accountFor(d.account) ?? null
    const acc = account_id ? ctx.accountById.get(account_id) : undefined
    if (!acc) errors.push(d.account ? { key: '收款账户“{text}”没对上，请在“收款账户对照”里选', vars: { text: d.account } } : { key: '收款账户空着' })
    const currency = acc?.currency ?? ''
    if (!d.dateText) errors.push({ key: '到账日期空着' })
    else if (!d.date) errors.push({ key: '到账日期“{text}”认不出来', vars: { text: d.dateText } })
    else if (d.date > today) warnings.push({ key: '到账日期 {date} 在今天以后，请核对', vars: { date: d.date } })
    if (d.amount === null) errors.push({ key: '金额“{text}”不是数字', vars: { text: d.amountText } })
    else if (!(d.amount > 0)) errors.push({ key: '金额要大于 0（退票、冲回的不用导）' })
    if (acc && d.amountCur && d.amountCur !== currency)
      errors.push({ key: '金额写的是 {a}，收款账户是 {b} 账户', vars: { a: d.amountCur, b: currency } })
    const amount = d.amount !== null && d.amount > 0 ? round2(d.amount) : null

    // ---- 汇率：USD 账户 = 1；表里写了用表里的；没写按 金额 ÷ USD；再没有用基础资料里的
    let fx_rate: number | null = null
    let rate_from: PReceipt['rate_from'] = null
    if (acc && currency === 'USD') {
      fx_rate = 1
      rate_from = 'usd_account'
    } else if (acc) {
      if (d.rateText && !(d.rate !== null && d.rate > 0)) errors.push({ key: '汇率“{text}”不是数字', vars: { text: d.rateText } })
      else if (d.rate !== null && d.rate > 0) {
        fx_rate = d.rate
        rate_from = 'file'
        if (d.usd !== null && d.usd > 0 && amount) {
          const calc = round2(amount / d.rate)
          if (Math.abs(calc - d.usd) > Math.max(1, d.usd * 0.005))
            warnings.push({ key: '汇率 {rate} 和 USD {usd} 对不上（按汇率算是 {calc}）', vars: { rate: d.rate, usd: money(d.usd), calc: money(calc) } })
        }
      } else if (d.usd !== null && d.usd > 0 && amount) {
        fx_rate = Math.round((amount / d.usd) * 1e6) / 1e6
        rate_from = 'usd'
        infos.push({ key: '汇率按 金额 ÷ USD 算的：{rate}', vars: { rate: fx_rate } })
      } else if (d.date) {
        const r = rateOn(ctx.rates, currency, d.date)
        if (r) {
          fx_rate = r.rate
          rate_from = 'table'
          infos.push({ key: '汇率用的是基础资料里 {date} 的 {rate}', vars: { date: r.rate_date, rate: r.rate } })
        } else errors.push({ key: '{currency} 在 {date} 没有汇率：表里加一列汇率（或 USD 金额），或者先在基础资料里录汇率', vars: { currency, date: d.date } })
      }
      if (fx_rate !== null && fx_rate < 1) warnings.push({ key: '汇率是 1 美元换多少 {currency}，{rate} 看着不对', vars: { currency, rate: fx_rate } })
    }
    const amount_usd = amount && fx_rate ? round2(amount / fx_rate) : null

    // ---- 参考号在文件里重复（同一个账户的参考号不能重复，数据库会拒）
    if (d.bank_ref && account_id) {
      const k = `${account_id}|${d.bank_ref.toUpperCase()}`
      const first = refSeen.get(k)
      if (first !== undefined) errors.push({ key: '参考号 {ref} 在文件里重复（第 {first} 行已有）', vars: { ref: d.bank_ref, first } })
      else refSeen.set(k, d.key)
    }

    // ---- 拆分：每个大架号一行
    type Pre = PClaim & { given: boolean; lineRow: number }
    const pre: Pre[] = []
    for (const l of d.lines) {
      for (const s of l.shortVins) warnings.push({ key: '第 {row} 行：大架号“{vin}”太短，没认', vars: { row: l.row, vin: s } })
      const nat = matchNature(l.nature, ctx.natures)
      // 期初余额、优惠折让不走到账：这一行不导
      const skipNature = nat.how === 'not_receipt'
      if (skipNature) warnings.push({ key: '第 {row} 行：“{nature}”不走到账，这一行拆分没导', vars: { row: l.row, nature: nat.name ?? l.nature } })
      if (nat.how === 'unknown') warnings.push({ key: '第 {row} 行：款项性质“{text}”认不出来', vars: { row: l.row, text: l.nature } })
      const cust = l.customer ? matchCustomer(l.customer, ctx.customers) : { id: null, exact: false, name: '' }
      const fileSp = l.salesperson ? (spByName.get(spNorm(l.salesperson)) ?? null) : null
      if (l.salesperson && !fileSp) warnings.push({ key: '第 {row} 行：业务员“{name}”系统里没有，按车（或客户）上的业务员', vars: { row: l.row, name: l.salesperson } })
      if (l.claimText && !(l.claim !== null && l.claim > 0)) errors.push({ key: '第 {row} 行：拆分金额“{text}”不是正数', vars: { row: l.row, text: l.claimText } })
      const vins: (string | null)[] = l.vins.length ? l.vins : [null]
      // 一行写了拆分金额、又写了几个大架号：这个金额在这几台车之间分
      const lineAmount = l.claim !== null && l.claim > 0 ? round2(l.claim) : null
      const hits = vins.map((vin) => (vin ? findVehicle(vin, ctx.vehicles, allVehicles) : null))
      let parts: (number | null)[] = vins.map(() => lineAmount)
      if (lineAmount !== null && vins.length > 1) {
        const sh = share(lineAmount, hits.map((h) => h?.v ?? null), fx_rate ?? 0)
        parts = sh.amounts
        infos.push({
          key: sh.how === 'balance' ? '第 {row} 行：{amt} 付 {k} 台车，没写每台多少，按各台的余额分的' : '第 {row} 行：{amt} 付 {k} 台车，没写每台多少，先平均分了',
          vars: { row: l.row, amt: money(lineAmount), k: vins.length },
        })
      }
      vins.forEach((vin, i) => {
        const hit = hits[i]
        const base = { row: l.row, lineRow: l.row, vin: vin ?? '', amount: parts[i], given: parts[i] !== null }
        if (hit) {
          const v = hit.v
          if (hit.how === 'tail') infos.push({ key: '第 {row} 行：大架号 {a} 按后几位对上了 {b}', vars: { row: l.row, a: vin ?? '', b: v.vin ?? '' } })
          if (hit.how === 'fixed') warnings.push({ key: '第 {row} 行：大架号 {a} 系统里没有，对上了相近的 {b}（字母 O、I 当成了数字），请核对', vars: { row: l.row, a: vin ?? '', b: v.vin ?? '' } })
          if (l.customer && cust.id !== v.customer_id) {
            const a = (v.customer_name ?? '').toUpperCase().replace(/[^0-9A-Z一-鿿]+/g, '')
            const b = l.customer.toUpperCase().replace(/[^0-9A-Z一-鿿]+/g, '')
            if (!(a && b && (a.includes(b) || b.includes(a))))
              warnings.push({ key: '第 {row} 行：大架号 {vin} 在系统里是“{a}”的车，表里写的客户是“{b}”', vars: { row: l.row, vin: v.vin ?? '', a: v.customer_name ?? '', b: l.customer } })
          }
          if (fileSp && v.salesperson_id && fileSp.id !== v.salesperson_id)
            warnings.push({
              key: '第 {row} 行：大架号 {vin} 在系统里的业务员是 {a}，表里写的是 {b}',
              vars: { row: l.row, vin: v.vin ?? '', a: v.salesperson_name ?? spById.get(v.salesperson_id)?.name ?? '', b: l.salesperson },
            })
          pre.push({
            ...base,
            vehicle: v,
            customer_id: v.customer_id,
            customer_name: v.customer_name ?? '',
            nature: nat.how === 'ok' && nat.name ? nat.name : defaultNature({ payment_method: v.payment_method, received_usd: v.received_usd, down_payment_usd: v.down_payment_usd }),
            salesperson_id: null,
            model_desc: null,
            dropped: skipNature,
          })
          if (nat.how === 'unknown') infos.push({ key: '第 {row} 行：款项性质按这台车猜的：{nature}', vars: { row: l.row, nature: pre[pre.length - 1].nature } })
          return
        }
        // 没对上车：记在客户名下（大架号未锁定），车录进来以后再选车
        const customer = cust.id ? custById.get(cust.id) : undefined
        if (customer && !cust.exact) infos.push({ key: '第 {row} 行：客户“{a}”对上了系统里的“{b}”', vars: { row: l.row, a: l.customer, b: customer.name } })
        let dropped = skipNature
        if (!customer) {
          dropped = true
          if (vin && l.customer) warnings.push({ key: '第 {row} 行：大架号 {vin} 系统里没有，客户“{name}”也对不上，这一行拆分没导', vars: { row: l.row, vin, name: l.customer } })
          else if (vin) warnings.push({ key: '第 {row} 行：大架号 {vin} 系统里没有，也没写客户，这一行拆分没导', vars: { row: l.row, vin } })
          else if (l.customer) warnings.push({ key: '第 {row} 行：客户“{name}”系统里没有（或者有几个相近的），这一行拆分没导', vars: { row: l.row, name: l.customer } })
          else warnings.push({ key: '第 {row} 行：没写大架号也没写客户，这一行拆分没导', vars: { row: l.row } })
        } else if (vin) warnings.push({ key: '第 {row} 行：大架号 {vin} 系统里没有，先记在客户“{name}”名下（大架号未锁定）', vars: { row: l.row, vin, name: customer.name } })
        const nature = nat.how === 'ok' && nat.name ? nat.name : '全款'
        if (!dropped && nat.how !== 'ok') infos.push({ key: '第 {row} 行：款项性质先按全款', vars: { row: l.row } })
        const desc = [l.model, vin && !l.model.toUpperCase().includes(vin) ? vin : ''].filter(Boolean).join(' ')
        pre.push({
          ...base,
          vehicle: null,
          customer_id: customer?.id ?? null,
          customer_name: customer?.name ?? l.customer,
          nature,
          salesperson_id: fileSp?.id ?? customer?.salesperson_id ?? null,
          model_desc: desc || null,
          dropped,
        })
      })
    }

    // ---- 没写拆分金额的：只有一行就是整笔；几行的分剩下的钱
    const live = pre.filter((c) => !c.dropped)
    const known = round2(live.filter((c) => c.given).reduce((s, c) => s + num(c.amount), 0))
    const open = live.filter((c) => !c.given)
    if (amount && open.length) {
      const rest = round2(amount - known)
      if (rest <= 0.005) {
        for (const c of open) {
          c.dropped = true
          warnings.push({ key: '第 {row} 行没写拆分金额，到账金额已经分完了，这一行拆分没导', vars: { row: c.row } })
        }
      } else if (open.length === 1) {
        open[0].amount = rest
        if (live.length > 1) infos.push({ key: '第 {row} 行没写拆分金额，按剩下的 {amt}', vars: { row: open[0].row, amt: money(rest) } })
      } else {
        const sh = share(rest, open.map((c) => c.vehicle), fx_rate ?? 0)
        open.forEach((c, i) => (c.amount = sh.amounts[i]))
        infos.push({
          key: sh.how === 'balance' ? '{k} 行没写拆分金额，剩下的 {amt} 按各台的余额分了，导完可以改' : '{k} 行没写拆分金额，剩下的 {amt} 先平均分了，导完可以改',
          vars: { k: open.length, amt: money(rest) },
        })
      }
    }
    const claimed = round2(pre.filter((c) => !c.dropped).reduce((s, c) => s + num(c.amount), 0))
    if (amount && claimed > amount + 0.005) errors.push({ key: '拆分合计 {a} 超过到账金额 {b}', vars: { a: money(claimed), b: money(amount) } })
    else if (amount && pre.some((c) => !c.dropped) && claimed < amount - 0.005) infos.push({ key: '还有 {amt} 没拆到车上（部分认领），导完可以补', vars: { amt: money(round2(amount - claimed)) } })

    return {
      key: d.key,
      rows: d.rows,
      status: 'new',
      account_id,
      account_text: d.account,
      currency,
      date: d.date,
      amount,
      fx_rate,
      rate_from,
      amount_usd,
      payer: d.payer,
      bank_ref: d.bank_ref,
      cheque_no: d.cheque_no,
      note: d.note,
      claims: pre.map((c) => ({
        row: c.row,
        vin: c.vin,
        vehicle: c.vehicle,
        customer_id: c.customer_id,
        customer_name: c.customer_name,
        nature: c.nature,
        amount: c.amount,
        salesperson_id: c.salesperson_id,
        model_desc: c.model_desc,
        dropped: c.dropped,
      })),
      existing: null,
      suspect: d.bare,
      errors,
      warnings,
      infos,
    }
  })

  // ---- 查重：系统里同账户、同一天、同金额的（参考号都写了又不一样的不算）按先后一笔对一笔；同账户同参考号的一定是录过了
  const used = new Set<number>()
  const byRef = new Map(ctx.existing.filter((e) => e.bank_ref).map((e) => [`${e.account_id}|${(e.bank_ref ?? '').toUpperCase()}`, e]))
  const alike = (p: PReceipt, e: ExistingReceipt) =>
    e.account_id === p.account_id &&
    e.receipt_date === p.date &&
    Math.abs(num(e.amount_orig) - (p.amount ?? 0)) < 0.005 &&
    !(p.bank_ref && e.bank_ref && p.bank_ref.toUpperCase() !== e.bank_ref.toUpperCase())
  // 刚导进去的几笔先认回自己存的那张；其余按文件里的先后，有问题的放最后（别让它占了别的行该对上的那张）
  const pinned = ctx.pinned ?? new Map<number, number>()
  const rank = (p: PReceipt) => (pinned.has(p.key) ? 0 : p.errors.length ? 2 : 1)
  const order = [...out].sort((a, b) => rank(a) - rank(b))
  for (const p of order) {
    if (!p.account_id || !p.date || !p.amount) continue
    const ref = p.bank_ref ? byRef.get(`${p.account_id}|${p.bank_ref.toUpperCase()}`) : undefined
    const mine = pinned.has(p.key) ? ctx.existing.find((e) => e.id === pinned.get(p.key) && !used.has(e.id) && alike(p, e)) : undefined
    const same = mine ?? (ref && !used.has(ref.id) ? ref : ctx.existing.find((e) => !used.has(e.id) && alike(p, e)))
    if (same) {
      used.add(same.id)
      p.existing = same
      continue
    }
    // 日期差几天、其余一样的：很可能是同一笔，提醒一下（照样导）
    const near = ctx.existing.find(
      (e) =>
        !used.has(e.id) &&
        e.account_id === p.account_id &&
        Math.abs(num(e.amount_orig) - (p.amount ?? 0)) < 0.005 &&
        Math.abs(Date.parse(e.receipt_date) - Date.parse(p.date ?? '')) <= 3 * 86400000,
    )
    if (near) p.warnings.push({ key: '系统里有一笔很像的：{no}（{date}，同账户同金额），请确认不是同一笔', vars: { no: near.receipt_no, date: near.receipt_date } })
  }
  for (const p of out) p.status = p.errors.length ? 'error' : p.existing ? 'exists' : 'new'
  return out
}

/** 交给 save_receipt 的内容（和新建到账页存的一样） */
export function receiptPayload(p: PReceipt) {
  return {
    p_receipt: {
      receipt_date: p.date,
      account_id: p.account_id,
      amount_orig: p.amount,
      fx_rate: p.currency === 'USD' ? null : p.fx_rate,
      payer_summary: p.payer,
      bank_ref: p.bank_ref,
      cheque_no: p.cheque_no,
      note: p.note,
      attachments: [] as string[],
    },
    p_claims: p.claims
      .filter((c) => !c.dropped && c.amount !== null && c.amount > 0)
      .map((c) => ({
        id: null,
        nature: c.nature,
        vehicle_id: c.vehicle?.id ?? null,
        customer_id: c.vehicle ? null : c.customer_id,
        amount_orig: round2(num(c.amount)),
        report_note: '',
        model_desc: c.vehicle ? null : c.model_desc,
        salesperson_id: c.vehicle ? null : c.salesperson_id,
      })),
  }
}

export { rowRange }
