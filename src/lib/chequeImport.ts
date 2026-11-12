// 导入 Rome 的《支票表》：主表-分期合同支票明细（一份合同一段：第一行是合同，下面每行一张支票）、其他支票明细（一行一张）、
// 支票表存取备忘录（当前在跟进的支票的状态、计划存票日期、沟通记录）。只导还没完成的（已报回款的、历史上已经处理掉的不导）。
// 真正写库在数据库函数 import_cheques 里；这里只把 Excel 整理成它要的行，并把看不懂的标出来。
import { parseDate } from './statement'
import type { Account } from './supabase'

export type ImportStatus = 'pending' | 'confirming' | 'deposited' | 'bounced' | 'cancelled'
export type ChequeImportRow = {
  /** 来自哪张表、第几行（提示用） */
  src: string
  row: number
  cheque_no: string
  drawer_bank: string | null
  drawer_name: string | null
  customer_name: string
  /** 合同备注里的大架号：一张合同可能几台车，支票是整张合同的，所以全部带上 */
  vins: string[]
  /** 主表第一列的 序号：一个合同一个，照原样带上（其他支票明细没有这一列） */
  contract_no: string | null
  /** 第几期 / 共几期：同一个序号下按表里的行序算 */
  installment_no: number | null
  installment_count: number | null
  salesperson_name: string | null
  purpose: string
  currency: 'GHS' | 'USD'
  amount: number | null
  installment_usd: number | null
  due_date: string | null
  status: ImportStatus
  plan_date: string | null
  deposit_date: string | null
  deposit_account_key: string | null
  deposit_account_id: number | null
  reason: string | null
  note: string | null
  import_note: string | null
  notes: { at: string; note: string }[]
  /** 这一行要注意的地方（导入照常，只是提醒） */
  warnings: string[]
  /** 不导：已报回款、已经处理完的 */
  skip: string | null
}

const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/g
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const cell = (r: unknown[], i: number) => (i < r.length ? r[i] : '')
const yes = (v: unknown) => clean(v) === '是'
const BLANK = /^(空白|blank)?$/i

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const s = String(v).replace(/[,，\s]/g, '')
  if (BLANK.test(s)) return null
  const m = /^(?:GHS|GHC|GH₵|\$|USD)?\s*([0-9]+(?:\.[0-9]+)?)$/i.exec(s)
  return m ? Number(m[1]) : null
}

/** 到期日期：Excel 日期数字、2026-10-30、30/12/2026、2026/9/31（不存在的日子算认不出） */
function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  return parseDate(v, 'YYYY-MM-DD') ?? parseDate(String(v).replace(/[.年月]/g, '-').replace(/日/g, ''), 'YYYY-M-D')
}

/** 存票银行（表里手写的，如 “fet auto omni”“FEIYA ECO”“Fet Auto Stanbic”）→ 系统账户。认公司 + 银行 + 币种 */
export function matchDepositAccount(text: string | null, currency: string, accounts: Account[]): Account | null {
  if (!text) return null
  const s = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!s) return null
  const company = /FEIYA|FEITA|FEIYE/.test(s) ? 'FEIYA' : /FET/.test(s) ? 'FET AUTO' : null
  const bank = /OMNI|ONMI|OMINI/.test(s)
    ? 'OMINI'
    : /STANB/.test(s)
      ? 'STANBIC'
      : /ECO/.test(s)
        ? 'ECO'
        : /CAL/.test(s)
          ? 'CAL'
          : /ACCESS/.test(s)
            ? 'ACCESS'
            : /GCB/.test(s)
              ? 'GCB'
              : /ZEN/.test(s)
                ? 'ZENITH'
                : /ABSA/.test(s)
                  ? 'ABSA'
                  : /FIDEL/.test(s)
                    ? 'FIDELITY'
                    : /REPUBLIC/.test(s)
                      ? 'REPUBLIC'
                      : /UBA/.test(s)
                        ? 'UBA'
                        : null
  if (!bank) return null
  const cur = /USD|美元|美金/.test(s) ? 'USD' : currency
  const hit = accounts.filter((a) => {
    const n = a.short_name.toUpperCase()
    return a.kind === 'bank' && a.currency === cur && n.includes(bank) && (!company || n.startsWith(company))
  })
  if (hit.length === 1) return hit[0]
  const active = hit.filter((a) => a.active)
  return active.length === 1 ? active[0] : null
}

/** 备忘录里的一条：按 客户 + 支票号 对到主表的支票上 */
type Memo = { status: ImportStatus | null; plan_date: string | null; deposit_date: string | null; deposit_account_key: string | null; notes: { at: string; note: string }[] }
const MEMO_STATUS: Record<string, ImportStatus | null> = { 待存: 'pending', 等业务确认: 'confirming', 已存: 'deposited', 已到账: 'deposited', 已报回款: null, 取消: 'cancelled' }

export function parseMemo(rows: unknown[][]): Map<string, Memo> {
  const out = new Map<string, Memo>()
  // 表头行：有“支票号码”和“状态”的那一行
  const hi = rows.findIndex((r) => r.some((c) => clean(c) === '支票号码') && r.some((c) => clean(c) === '状态'))
  if (hi < 0) return out
  const h = rows[hi].map(clean)
  const col = (name: string) => h.indexOf(name)
  const iCust = col('客户名称'), iNo = col('支票号码'), iAt = col('记录日期'), iNote = col('沟通内容 / 回复'), iPlan = col('计划存票日期'), iStatus = col('状态'), iDep = col('存票日期'), iBank = col('存票银行')
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]
    const no = clean(cell(r, iNo))
    const cust = clean(cell(r, iCust))
    if (!no || !cust) continue
    const key = memoKey(cust, no)
    const m = out.get(key) ?? { status: null, plan_date: null, deposit_date: null, deposit_account_key: null, notes: [] }
    const st = clean(cell(r, iStatus))
    if (st in MEMO_STATUS) m.status = MEMO_STATUS[st]
    m.plan_date = toDate(cell(r, iPlan)) ?? m.plan_date
    m.deposit_date = toDate(cell(r, iDep)) ?? m.deposit_date
    m.deposit_account_key = clean(cell(r, iBank)) || m.deposit_account_key
    const note = clean(cell(r, iNote)).replace(/^[：:]\s*/, '')
    if (note) m.notes.push({ at: toDate(cell(r, iAt)) ?? '', note })
    out.set(key, m)
  }
  return out
}
export const memoKey = (cust: string, no: string) => `${cust.toUpperCase().replace(/\s+/g, ' ')}|${no.replace(/^0+/, '').toUpperCase()}`

/** 主表“是否存票”一类的文字 → 状态。返回 null = 这张支票按别的列判断 */
function statusFromText(f: string): { status: ImportStatus; reason: string } | null {
  if (!f) return null
  if (/已结清|转账|付现金|现金支付|拿走|收回|取走|作废|退还|退票|写错|过大|退回/.test(f)) return { status: 'cancelled', reason: f }
  if (/^否/.test(f)) return { status: 'cancelled', reason: f }
  return null
}

/** 主表-分期合同支票明细 */
export function parseMainSheet(rows: unknown[][], memo: Map<string, Memo>, accounts: Account[]): ChequeImportRow[] {
  const out: ChequeImportRow[] = []
  const h = (rows[0] ?? []).map(clean)
  const col = (names: string[]) => h.findIndex((x) => names.some((n) => x.replace(/\s/g, '').startsWith(n)))
  const iSeq = col(['序号']), iQty = col(['支票数量'])
  const iCust = col(['客户名称']), iName = col(['支票名称']), iInst = col(['分期款/月']), iNote = col(['备注']), iF = col(['是否存票']), iDep = col(['已存银行']),
    iRep = col(['已报回款']), iDepDate = col(['存票日期']), iDepBank = col(['存票银行']), iBank = col(['支票银行']), iNo = col(['支票号码']),
    iDue = col(['支票/合同到期日期', '到期日期']), iAmt = col(['支票金额塞地', '支票金额']), iUsd = h.findIndex((x) => /支票金额\s*美元/.test(x)), iSp = col(['业务员'])
  if (iNo < 0 || iCust < 0) return out
  let cust = '', name = '', note = '', sp = '', inst: number | null = null
  // 序号和支票数量写在合同那一行，下面的支票行空着，所以往下带
  let seq = '', qty: number | null = null
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const c = clean(cell(r, iCust))
    if (iSeq >= 0 && clean(cell(r, iSeq))) seq = clean(cell(r, iSeq))
    if (iQty >= 0 && toNumber(cell(r, iQty)) != null) qty = toNumber(cell(r, iQty))
    if (c) {
      cust = c
      name = clean(cell(r, iName)) || cust
      note = String(cell(r, iNote) ?? '')
      sp = clean(cell(r, iSp))
      inst = toNumber(cell(r, iInst))
    } else {
      // 合同下面的支票行：客户空着时沿用上面的；有自己的备注、业务员就用自己的
      if (clean(cell(r, iNote))) note = String(cell(r, iNote))
      if (clean(cell(r, iSp))) sp = clean(cell(r, iSp))
      if (toNumber(cell(r, iInst)) != null) inst = toNumber(cell(r, iInst))
    }
    const no = clean(cell(r, iNo))
    if (!no || !cust) continue
    const warnings: string[] = []
    const f = clean(cell(r, iF))
    const reported = yes(cell(r, iRep))
    const deposited = yes(cell(r, iDep))
    const vins = [...new Set((note.toUpperCase().replace(/\s/g, '').match(VIN_RE) ?? []))]
    const amountGhs = toNumber(cell(r, iAmt))
    const amountUsd = iUsd >= 0 ? toNumber(cell(r, iUsd)) : null
    const currency: 'GHS' | 'USD' = amountGhs == null && amountUsd != null ? 'USD' : 'GHS'
    const amount = currency === 'USD' ? amountUsd : amountGhs
    const dueRaw = cell(r, iDue)
    const due = toDate(dueRaw)
    if (clean(dueRaw) && !due && !BLANK.test(clean(dueRaw))) warnings.push(`到期日期“${clean(dueRaw)}”认不出，先空着`)
    const depBankText = clean(cell(r, iDepBank)) || null
    const acc = matchDepositAccount(depBankText, currency, accounts)
    const m = memo.get(memoKey(cust, no))

    let status: ImportStatus = 'pending'
    let reason: string | null = null
    let skip: string | null = null
    if (reported) skip = '已报回款'
    else if (deposited) status = 'deposited'
    else {
      const s = statusFromText(f)
      if (s) {
        status = s.status
        reason = s.reason
      }
    }
    if (m?.status) {
      status = m.status
      if (status !== 'cancelled') reason = null
      else reason = reason ?? '备忘录里标了取消'
    }
    const depDate = m?.deposit_date ?? toDate(cell(r, iDepDate))
    const depKey = m?.deposit_account_key ?? depBankText
    const acc2 = acc ?? matchDepositAccount(depKey, currency, accounts)
    if (status === 'deposited') {
      if (!depDate) warnings.push('表里标了已存但没有存票日期，按到期日期算；没有到期日期就先按待存导入')
      if (!acc2) warnings.push(`存票银行“${depKey ?? ''}”对不上系统账户，先按待存导入，存票时再选账户`)
      if (amount == null) warnings.push('已存的支票没有金额，先按待存导入')
      if (!(depDate ?? due) || !acc2 || amount == null) status = 'pending'
    }
    out.push({
      src: '主表',
      row: i + 1,
      cheque_no: no,
      drawer_bank: clean(cell(r, iBank)).toUpperCase() || null,
      drawer_name: name || null,
      customer_name: cust,
      vins,
      salesperson_name: sp || null,
      purpose: '分期款',
      currency,
      amount,
      installment_usd: inst,
      due_date: due,
      status,
      plan_date: m?.plan_date ?? null,
      deposit_date: status === 'deposited' ? (depDate ?? due) : null,
      deposit_account_key: depKey,
      deposit_account_id: status === 'deposited' ? (acc2?.id ?? null) : null,
      reason,
      note: null,
      import_note: [f ? `是否存票：${f}` : null, deposited ? '已存银行：是' : null, m?.status ? `备忘录状态：${Object.keys(MEMO_STATUS).find((k) => MEMO_STATUS[k] === m.status) ?? ''}` : null]
        .filter(Boolean)
        .join('；') || null,
      notes: m?.notes ?? [],
      contract_no: seq || null,
      installment_no: null,
      installment_count: qty,
      warnings,
      skip,
    })
  }
  numberInstallments(out)
  return out
}

/**
 * 第几期：同一个合同序号下按表里的行序排（**已报回款的那些行也一起数**，所以第一张导进来的
 * 可能就是第 5 期，不会从 1 开始数错）。共几期取 支票数量 和实际行数里大的那个。
 */
function numberInstallments(rows: ChequeImportRow[]) {
  const groups = new Map<string, ChequeImportRow[]>()
  for (const r of rows) {
    if (!r.contract_no) continue
    const g = groups.get(r.contract_no)
    if (g) g.push(r)
    else groups.set(r.contract_no, [r])
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.row - b.row)
    const count = Math.max(g.length, g[0].installment_count ?? 0)
    g.forEach((r, i) => {
      r.installment_no = i + 1
      r.installment_count = count
    })
  }
}

/** 其他支票明细 */
export function parseOtherSheet(rows: unknown[][], accounts: Account[]): ChequeImportRow[] {
  const out: ChequeImportRow[] = []
  const h = (rows[0] ?? []).map((x) => clean(x).replace(/\s/g, ''))
  const col = (re: RegExp) => h.findIndex((x) => re.test(x))
  const iNo = col(/^支票号/), iDate = col(/^日期/), iSp = col(/^业务员/), iName = col(/^支票客户名/), iCust = col(/^客户名/), iAcc = col(/^存取户行/),
    iGhs = col(/^申请金额GHS/), iUsd = col(/^申请金额\$/), iUse = col(/^用途/), iKeep = col(/^存取$/), iDep = col(/^已存银行/), iRep = col(/^已报回款/)
  if (iNo < 0) return out
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const raw = clean(cell(r, iNo))
    if (!raw) continue
    const warnings: string[] = []
    // “000377  STANBIC BANK” → 号码 + 银行
    const m = /^([0-9A-Za-z-]+)\s*(.*)$/.exec(raw)
    const no = m ? m[1] : raw
    const bank = m && m[2] ? m[2].toUpperCase().replace(/\s*BANK$/, '').trim() : null
    const cust = clean(cell(r, iCust)) || clean(cell(r, iName))
    if (!cust) continue
    const ghs = toNumber(cell(r, iGhs))
    const usd = toNumber(cell(r, iUsd))
    const currency: 'GHS' | 'USD' = ghs == null && usd != null ? 'USD' : 'GHS'
    const amount = currency === 'USD' ? usd : ghs
    const use = clean(cell(r, iUse))
    const purpose = /配件/.test(use) ? '配件款' : /预付|首付|定金/.test(use) ? '预付款' : /月供|分期|逾期|尾款/.test(use) ? '分期款' : '其他'
    const keep = clean(cell(r, iKeep))
    const reported = yes(cell(r, iRep))
    const deposited = yes(cell(r, iDep))
    const date = toDate(cell(r, iDate))
    const acc = matchDepositAccount(clean(cell(r, iAcc)) || null, currency, accounts)
    let status: ImportStatus = 'pending'
    let reason: string | null = null
    let skip: string | null = null
    if (reported) skip = '已报回款'
    else if (/退|丢失|未成功|作废|转账/.test(keep)) {
      status = 'cancelled'
      reason = keep
    } else if (deposited) status = 'deposited'
    if (status === 'deposited' && (!date || !acc || amount == null)) {
      warnings.push(!acc ? `存取户行“${clean(cell(r, iAcc))}”对不上系统账户，先按待存导入` : '已存的支票缺日期或金额，先按待存导入')
      status = 'pending'
    }
    out.push({
      src: '其他支票明细',
      row: i + 1,
      cheque_no: no,
      drawer_bank: bank || null,
      drawer_name: clean(cell(r, iName)) || null,
      customer_name: cust,
      vins: [],
      salesperson_name: clean(cell(r, iSp)) || null,
      purpose,
      currency,
      amount,
      installment_usd: null,
      due_date: date,
      status,
      plan_date: null,
      deposit_date: status === 'deposited' ? date : null,
      deposit_account_key: clean(cell(r, iAcc)) || null,
      deposit_account_id: status === 'deposited' ? (acc?.id ?? null) : null,
      reason,
      note: use && use.length <= 120 ? use : null,
      import_note: [keep ? `存取：${keep}` : null, use.length > 120 ? `用途：${use.slice(0, 300)}` : null].filter(Boolean).join('；') || null,
      notes: [],
      // 其他支票明细是一行一张的零散支票，没有合同序号、也不分期
      contract_no: null,
      installment_no: null,
      installment_count: null,
      warnings,
      skip,
    })
  }
  return out
}

export const MAIN_SHEET = /主表|分期合同支票/
export const OTHER_SHEET = /其他支票/
export const MEMO_SHEET = /备忘录/
