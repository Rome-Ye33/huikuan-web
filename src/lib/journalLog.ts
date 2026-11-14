// 日记账的修改记录（数据库 36 的 journal_log / v_journal_log）：谁、什么时候、做了什么。
// 数据库的触发器自动记，绕不过去：记一笔、改（改了哪几项、从什么改成什么）、删；
// 银行流水填上 / 回到待填、配上到账 / 取消配对、忽略 / 取消忽略、删掉；导流水、改期初也记。
// 同一次操作（一个事务）的几行 txid 一样（比如一笔互转两边各一行），页面上合成一条。
import type { Database, Json } from './database.types'
import { money } from './format'
import { supabase } from './supabase'

export type JournalLog = Database['public']['Views']['v_journal_log']['Row']
type Tr = (zh: string, vars?: Record<string, string | number | null | undefined>) => string
type Detail = { [k: string]: Json | undefined }

/** 同一次操作合成的一组：什么时候、谁、做了哪几件事 */
export type LogGroup = { key: string; at: string; by: string; rows: JournalLog[] }

/** 修改记录按类型筛：页面上的选项 → 数据库里的 action */
export const LOG_KINDS: { key: string; label: string; actions: string[] }[] = [
  { key: 'create', label: '新记', actions: ['create'] },
  { key: 'update', label: '修改', actions: ['update'] },
  { key: 'delete', label: '删除', actions: ['delete', 'remove'] },
  { key: 'fill', label: '填流水', actions: ['fill', 'unfill'] },
  { key: 'match', label: '配到账', actions: ['match', 'unmatch'] },
  { key: 'ignore', label: '忽略', actions: ['ignore', 'unignore'] },
  { key: 'import', label: '导流水', actions: ['import'] },
  { key: 'opening', label: '期初', actions: ['opening'] },
]

/** 同一次操作（同一个 txid）合成一组；rows 要按 id 从新到旧排好 */
export function groupLogs(rows: JournalLog[]): LogGroup[] {
  const out: LogGroup[] = []
  const byKey = new Map<string, LogGroup>()
  for (const r of rows) {
    const key = `${r.txid}-${r.by_user ?? ''}`
    let g = byKey.get(key)
    if (!g) {
      g = { key, at: r.at ?? '', by: r.by_name ?? '', rows: [] }
      byKey.set(key, g)
      out.push(g)
    }
    g.rows.push(r)
  }
  // 组里按发生的先后（id 从小到大）说
  for (const g of out) g.rows.sort((a, b) => Number(a.id) - Number(b.id))
  return out
}

const FIELD_LABEL: Record<string, string> = {
  entry_date: '日期',
  account_id: '账户',
  amount: '金额',
  module: '业务模块',
  counterparty: '客户 / 供应商',
  summary: '摘要',
  fx_rate: '汇率',
  bank_ref: '银行参考号',
  cheque_no: '支票号',
  note: '备注',
  attachments: '凭证',
}

const str = (v: Json | undefined): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/**
 * 一行记录说成一句话（界面语言）。accountName：账户 id → 名字（改账户时只记了 id）；
 * noAccount：“改了…”不说是哪个账户（一笔互转两边改了同样的内容，合成一句时用）
 */
export function describeLog(r: JournalLog, t: Tr, accountName: (id: number) => string, noAccount = false): string {
  const d = (r.detail ?? {}) as Detail
  const no = r.doc_no ?? ''
  const cur = r.currency ?? ''
  const acct = r.account_name ?? ''
  const signed = Number(d.amount ?? 0)
  // 一笔收支：账户 收 / 付 金额
  const entryWhat = () =>
    t('{account} {dir} {cur} {amt}', { account: acct, dir: d.direction === 'in' ? t('收') : t('付'), cur, amt: money(d.amount) })
  // 一条银行流水：账户 日期 收 / 付 金额
  const lineWhat = () =>
    t('{account} {date} 的流水（{dir} {cur} {amt}）', {
      account: acct,
      date: str(d.line_date).slice(5),
      dir: signed < 0 ? t('付') : t('收'),
      cur,
      amt: money(Math.abs(signed)),
    })
  const val = (f: string, v: Json | undefined): string => {
    if (v === null || v === undefined || v === '') return t('空')
    if (f === 'amount') return money(v)
    if (f === 'account_id') return accountName(Number(v)) || String(v)
    if (f === 'attachments') return t('{n} 张', { n: Array.isArray(v) ? v.length : 0 })
    if (f === 'module') return t(String(v))
    return str(v)
  }
  switch (r.action) {
    case 'create':
      if (d.fee) return t('记了手续费：{what}', { what: entryWhat() })
      if (d.transfer) return d.direction === 'in' ? t('互转 {no} 转入：{what}', { no, what: entryWhat() }) : t('记了互转 {no}，转出：{what}', { no, what: entryWhat() })
      return t('记了 {no}：{what}，{module}', { no, what: entryWhat(), module: t(str(d.module)) })
    case 'update': {
      const list = Array.isArray(d.changes) ? (d.changes as { f?: string; from?: Json; to?: Json }[]) : []
      const changes = list
        .map((c) => t('{field}：{from} → {to}', { field: t(FIELD_LABEL[c.f ?? ''] ?? c.f ?? ''), from: val(c.f ?? '', c.from), to: val(c.f ?? '', c.to) }))
        .join('；')
      return noAccount ? t('改了 {no}：{changes}', { no, changes }) : t('改了 {no}（{account}）：{changes}', { no, account: acct, changes })
    }
    case 'delete':
      return t('删了 {no}：{what}，{module}', { no, what: entryWhat(), module: t(str(d.module)) })
    case 'fill':
      return d.auto ? t('{line}自动对上了 {no}', { line: lineWhat(), no }) : t('{line}填成了「{module}」（{no}）', { line: lineWhat(), module: t(str(d.module)), no })
    case 'unfill':
      return t('{line}回到待填（{no} 删了）', { line: lineWhat(), no })
    case 'match':
      return d.match_type === 'auto'
        ? t('{line}自动配上了到账 {no}', { line: lineWhat(), no })
        : d.match_type === 'created'
          ? t('{line}录成了到账 {no}', { line: lineWhat(), no })
          : t('{line}关联了到账 {no}', { line: lineWhat(), no })
    case 'unmatch':
      return t('{line}取消了和到账 {no} 的配对', { line: lineWhat(), no })
    case 'ignore':
      return d.note ? t('忽略了{line}：{note}', { line: lineWhat(), note: t(str(d.note)) }) : t('忽略了{line}', { line: lineWhat() })
    case 'unignore':
      return t('取消忽略{line}', { line: lineWhat() })
    case 'remove':
      return t('删了{line}', { line: lineWhat() })
    case 'import': {
      const s = t('导入 {account} 的银行流水《{file}》：新 {n} 条（付出去的 {out} 条），重复的 {skip} 条没导，自动对上 {matched} 条', {
        account: acct,
        file: str(d.file),
        n: Number(d.inserted ?? 0),
        out: Number(d.debits ?? 0),
        skip: Number(d.skipped ?? 0),
        matched: Number(d.matched ?? 0),
      })
      return Number(d.balance_filled ?? 0) > 0 ? s + t('，以前导的补上余额 {n} 条', { n: Number(d.balance_filled) }) : s
    }
    case 'opening': {
      const date = str(d.date)
      const old = str(d.old_date)
      const head = old && old !== date ? t('期初日期 {old} → {date}', { old, date }) : t('期初日期 {date}', { date })
      const list = Array.isArray(d.changes) ? (d.changes as { account_id?: number; from?: Json; to?: Json }[]) : []
      const parts = list.map((c) =>
        t('{account} 期初 {from} → {to}', { account: accountName(Number(c.account_id)), from: val('amount', c.from), to: val('amount', c.to) }),
      )
      return [head, ...parts].join('；')
    }
    default:
      return r.action ?? ''
  }
}

/** 一组里每件事说成一句（一笔互转两边改了同样的内容，只说一次） */
export function describeGroup(g: LogGroup, t: Tr, accountName: (id: number) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  // 从流水填的：“填成了…”一句就够，不再另说“记了…”
  const filled = new Set(g.rows.filter((r) => r.action === 'fill' && !(r.detail as Detail | null)?.auto).map((r) => r.entry_id))
  // 一笔互转改了摘要这类：两边各一行 update，说的话只差账户，合成一句不说账户；只有一边改的照样说是哪个账户
  const plain = (r: JournalLog) => describeLog(r, t, accountName, true)
  const updates = g.rows.filter((r) => r.action === 'update').map(plain)
  const twice = new Set(updates.filter((s, i) => updates.indexOf(s) !== i))
  for (const r of g.rows) {
    if (r.action === 'create' && filled.has(r.entry_id)) continue
    const s = r.action === 'update' && twice.has(plain(r)) ? plain(r) : describeLog(r, t, accountName)
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** 一笔收支（互转连另一边、手续费）和它对上的流水的修改记录，新的在前 */
export async function fetchEntryLogs(entryIds: number[], lineIds: number[]): Promise<JournalLog[]> {
  const conds = [entryIds.length ? `entry_id.in.(${entryIds.join(',')})` : '', lineIds.length ? `line_id.in.(${lineIds.join(',')})` : ''].filter(Boolean)
  if (!conds.length) return []
  const { data } = await supabase.from('v_journal_log').select('*').or(conds.join(',')).order('id', { ascending: false }).limit(200)
  return data ?? []
}

/** 一条银行流水的修改记录：它自己的（填、配对、忽略），填成的那一笔的，加上把它导进来的那一次 */
export async function fetchLineLogs(line: { id: number; entry_id?: number | null; account_id?: number | null; batch_id?: number | null }): Promise<JournalLog[]> {
  const own = supabase
    .from('v_journal_log')
    .select('*')
    .or(`line_id.eq.${line.id}${line.entry_id ? `,entry_id.eq.${line.entry_id}` : ''}`)
    .order('id', { ascending: false })
    .limit(200)
  const imp =
    line.batch_id && line.account_id
      ? supabase.from('v_journal_log').select('*').eq('action', 'import').eq('account_id', line.account_id).eq('detail->>batch_id', String(line.batch_id)).limit(1)
      : null
  const [a, b] = await Promise.all([own, imp ?? Promise.resolve({ data: [] as JournalLog[] })])
  return [...(a.data ?? []), ...(b.data ?? [])].sort((x, y) => Number(y.id) - Number(x.id))
}
