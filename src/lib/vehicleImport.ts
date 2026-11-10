// 批量导入车辆和期初：认表头、对列、逐行检查。真正写库在数据库函数 import_vehicles 里（只限管理员）。
// 一行一台车：大架号、车型、客户、合同价必填；分期的首付可以先空着；期初已到账 = 系统上线前这台车已经收到的钱。
import { parseAmount, parseDate } from './statement'

export type VField =
  | 'vin'
  | 'model'
  | 'customer'
  | 'salesperson'
  | 'contract_date'
  | 'payment_method'
  | 'contract_usd'
  | 'down_payment_usd'
  | 'shipped_at'
  | 'opening_paid_usd'
  | 'opening_discount_usd'
  | 'note'
export type VMapping = Partial<Record<VField, number>>

/** 字段：界面名（中文，同时是翻译的 key）、是否必填、认表头的规则（先严后宽）、不要的列 */
export const V_FIELDS: { key: VField; label: string; required?: boolean; patterns: RegExp[]; exclude?: RegExp }[] = [
  { key: 'vin', label: '大架号', required: true, patterns: [/^(大架号|车架号|vin|chassis(\s*no\.?)?)$/i, /大架号|车架号|\bvin\b|chassis/i], exclude: /金蝶/ },
  { key: 'model', label: '车型', required: true, patterns: [/^(车型|型号|设备型号|model)$/i, /车型|产品信息|设备型号|\bmodel\b/i], exclude: /金蝶/ },
  { key: 'customer', label: '客户', required: true, patterns: [/^(客户|客户名称|customer)$/i, /客户|customer/i], exclude: /金蝶/ },
  { key: 'salesperson', label: '业务员', patterns: [/^(业务员|salesperson)$/i, /业务员|sales\s*person/i], exclude: /金蝶|部门/ },
  { key: 'contract_date', label: '合同日期', patterns: [/^(合同日期|contract\s*date)$/i, /合同日期|签约日期|contract\s*date/i] },
  { key: 'payment_method', label: '付款方式', patterns: [/^(付款方式|payment\s*(terms|method))$/i, /付款方式|payment\s*(terms|method)/i] },
  {
    key: 'contract_usd',
    label: '合同价USD',
    required: true,
    patterns: [/^(合同价\s*(usd)?|contract\s*(usd|price))$/i, /合同金额拆分/, /合同(价|金额)|contract\s*(usd|price|amount)/i],
    exclude: /回款/,
  },
  { key: 'down_payment_usd', label: '首付USD', patterns: [/^(首付\s*(usd)?|down\s*payment(\s*usd)?)$/i, /首付|down\s*payment/i] },
  { key: 'shipped_at', label: '发车日期', patterns: [/^(发车日期|release\s*date)$/i, /发车日期|提车(时间|日期)|release\s*date|shipped/i] },
  { key: 'opening_paid_usd', label: '期初已到账USD', patterns: [/期初.*(已到账|已付|已收)|opening\s*(paid|received)/i] },
  { key: 'opening_discount_usd', label: '期初优惠USD', patterns: [/期初.*(优惠|折让)|opening\s*discount/i] },
  { key: 'note', label: '备注', patterns: [/^(备注|note|remarks?)$/i, /备注|\bnote\b|remark/i] },
]

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

export function guessVehicleMapping(headers: string[]): VMapping {
  const m: VMapping = {}
  const used = new Set<number>()
  for (const f of V_FIELDS) {
    for (const re of f.patterns) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(clean(h)) && !f.exclude?.test(h))
      if (i >= 0) {
        m[f.key] = i
        used.add(i)
        break
      }
    }
  }
  return m
}

/** 表头在第几行（1 起）：前 20 行里第一行认得出大架号、客户和合同价的；认不出返回 0 */
export function findVehicleHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const m = guessVehicleMapping((rows[i] ?? []).map((c) => String(c ?? '')))
    if (m.vin !== undefined && m.customer !== undefined && m.contract_usd !== undefined) return i + 1
  }
  return 0
}

const METHODS: Record<string, string> = {
  全款: '全款',
  分期: '分期',
  预付: '预付',
  挂账: '挂账',
  'full payment': '全款',
  full: '全款',
  installments: '分期',
  installment: '分期',
  prepaid: '预付',
  'on credit': '挂账',
  credit: '挂账',
}

/** 付款方式：银行担保按全款录，备注写“银行担保”（Rome 2026-11-08） */
export function normalizeMethod(raw: unknown): { method: string | null; note?: string; bad?: boolean } {
  const s = clean(raw)
  if (!s) return { method: null }
  if (s === '银行担保' || /^bank\s*guarantee$/i.test(s)) return { method: '全款', note: '银行担保' }
  const m = METHODS[s] ?? METHODS[s.toLowerCase()]
  return m ? { method: m } : { method: null, bad: true }
}

/** 名字比对用：不分大小写，多余空格不算（和数据库函数一样） */
export const normName = (s: string) => clean(s).toLowerCase()

export type Issue = { key: string; vars?: Record<string, string | number> }
export type VRow = {
  /** Excel 里的行号 */
  row: number
  vin: string
  model: string
  customer: string
  /** 文件里的原名，导入时按“业务员对照”换成系统里的名字 */
  salesperson: string
  contract_date: string | null
  payment_method: string
  contract_usd: number | null
  down_payment_usd: number | null
  shipped_at: string | null
  note: string
  opening_paid_usd: number | null
  opening_discount_usd: number | null
  errors: Issue[]
  warnings: Issue[]
}

export function parseVehicleRows(rows: unknown[][], headerRow: number, m: VMapping): VRow[] {
  const out: VRow[] = []
  const firstRow = new Map<string, number>()
  const cell = (r: unknown[], k: VField) => (m[k] === undefined ? '' : r[m[k] as number])
  for (let i = Math.max(headerRow, 1); i < rows.length; i++) {
    const r = rows[i] ?? []
    const text = (k: VField) => clean(cell(r, k))
    if (V_FIELDS.every((f) => text(f.key) === '')) continue // 空行
    if (!text('vin') && !text('customer')) continue // 合计、说明行
    const errors: Issue[] = []
    const warnings: Issue[] = []
    const amount = (k: VField, label: string) => {
      const raw = cell(r, k)
      if (clean(raw) === '') return null
      const n = parseAmount(raw)
      if (n === null) errors.push({ key: '{field}不是数字', vars: { field: label } })
      return n
    }
    const date = (k: VField, label: string) => {
      const raw = cell(r, k)
      if (clean(raw) === '') return null
      const d = parseDate(raw, 'YYYY-MM-DD')
      if (!d) warnings.push({ key: '{field}认不出来，按空的导入', vars: { field: label } })
      return d
    }

    const vin = text('vin').toUpperCase().replace(/\s/g, '')
    const pm = normalizeMethod(cell(r, 'payment_method'))
    const contract = amount('contract_usd', '合同价USD')
    const down = amount('down_payment_usd', '首付USD')
    const paid = amount('opening_paid_usd', '期初已到账USD')
    const disc = amount('opening_discount_usd', '期初优惠USD')
    const note = [pm.note, text('note')].filter(Boolean).join('；')

    if (!vin) errors.push({ key: '大架号不能为空' })
    else if (firstRow.has(vin)) errors.push({ key: '大架号 {vin} 在文件里重复（第 {first} 行已有）', vars: { vin, first: firstRow.get(vin) as number } })
    else firstRow.set(vin, i + 1)
    if (!text('model')) errors.push({ key: '车型不能为空' })
    if (!text('customer')) errors.push({ key: '客户不能为空' })
    if (pm.bad) errors.push({ key: '付款方式“{v}”认不出来（只能是全款、分期、预付、挂账）', vars: { v: text('payment_method') } })
    else if (!pm.method) warnings.push({ key: '付款方式空着，按全款导入' })
    if (contract === null || contract < 0) {
      if (!errors.some((e) => e.vars?.field === '合同价USD')) errors.push({ key: '合同价要填，而且不能是负数' })
    }
    if (down !== null && (down < 0 || (contract !== null && down > contract))) errors.push({ key: '首付不能是负数，也不能大于合同价' })
    if ((paid ?? 0) < 0 || (disc ?? 0) < 0) errors.push({ key: '期初已到账、期初优惠不能是负数' })
    if (contract !== null && (paid ?? 0) + (disc ?? 0) > contract + 0.5) warnings.push({ key: '期初已到账加优惠超过合同价' })

    out.push({
      row: i + 1,
      vin,
      model: text('model'),
      customer: text('customer'),
      salesperson: text('salesperson'),
      contract_date: date('contract_date', '合同日期'),
      payment_method: pm.method ?? '全款',
      contract_usd: contract,
      down_payment_usd: down,
      shipped_at: date('shipped_at', '发车日期'),
      note,
      opening_paid_usd: paid,
      opening_discount_usd: disc,
      errors,
      warnings,
    })
  }
  return out
}

/** 模板：表头和两行示例（表头跟着界面语言，导入时中英文表头都认得） */
export const TEMPLATE_FIELDS: VField[] = [
  'vin',
  'model',
  'customer',
  'salesperson',
  'contract_date',
  'payment_method',
  'contract_usd',
  'down_payment_usd',
  'shipped_at',
  'opening_paid_usd',
  'opening_discount_usd',
  'note',
]
