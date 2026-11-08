// 金额、日期的统一显示

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 1,234.50 */
export function money(v: unknown, decimals: 0 | 2 = 2): string {
  if (v === null || v === undefined || v === '') return ''
  return decimals === 0 ? nf0.format(Math.round(num(v))) : nf2.format(num(v))
}

/** $ 1,235 */
export function usd(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  return '$ ' + money(v, 0)
}

/** 四舍五入到分 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 加纳 = UTC+0，“今天”按 UTC 日期算，与数据库 today_accra() 一致 */
export function todayAccra(): string {
  return new Date().toISOString().slice(0, 10)
}

export function shortDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : ''
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 搜索词里去掉会破坏 PostgREST or() 语法的字符 */
export function cleanSearch(q: string): string {
  return q.replace(/[,()%*\\]/g, ' ').trim()
}
