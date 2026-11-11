// 基础资料批量删除：先查哪些还被别的记录用着（删不掉的说明原因），其余按 id 删
import { supabase } from './supabase'

export type MasterKind = 'customers' | 'salespersons' | 'bank_accounts'

/** 哪些表引用它：表、列、删不掉时的原因（翻译 key） */
const REFS: Record<MasterKind, { table: string; col: string; reason: string }[]> = {
  customers: [
    { table: 'vehicles', col: 'customer_id', reason: '有车辆' },
    { table: 'receipt_claims', col: 'customer_id', reason: '有到账记录' },
    { table: 'commission_vouchers', col: 'customer_id', reason: '有提成单' },
  ],
  salespersons: [
    { table: 'vehicles', col: 'salesperson_id', reason: '有车辆' },
    { table: 'customers', col: 'salesperson_id', reason: '名下有客户' },
    { table: 'receipt_claims', col: 'salesperson_id', reason: '有到账记录' },
    { table: 'receipt_submissions', col: 'salesperson_id', reason: '有到账提交' },
    { table: 'commission_vouchers', col: 'salesperson_id', reason: '有提成单' },
    { table: 'profiles', col: 'salesperson_id', reason: '有登录账号' },
    { table: 'user_invites', col: 'salesperson_id', reason: '在邀请名单' },
  ],
  bank_accounts: [
    { table: 'bank_receipts', col: 'account_id', reason: '有到账' },
    { table: 'receipt_submissions', col: 'account_id', reason: '有到账提交' },
    { table: 'bank_statement_lines', col: 'account_id', reason: '有银行流水' },
    { table: 'import_batches', col: 'account_id', reason: '有导入批次' },
  ],
}

const CHUNK = 150
type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
// 表名是动态的，绕开按表生成的类型
const db = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => { in: (col: string, v: number[]) => Res<Record<string, number | null>> }
    delete: () => { in: (col: string, v: number[]) => { select: (cols: string) => Res<{ id: number }> } }
    update: (v: Record<string, unknown>) => { in: (col: string, v: number[]) => { select: (cols: string) => Res<{ id: number }> } }
  }
}

/** 这些 id 里哪些还在用：id → 原因（翻译 key）。第一个查到的原因为准 */
export async function findInUse(kind: MasterKind, ids: number[]): Promise<Map<number, string>> {
  const used = new Map<number, string>()
  for (const ref of REFS[kind]) {
    const left = ids.filter((id) => !used.has(id))
    if (!left.length) break
    for (let i = 0; i < left.length; i += CHUNK) {
      const chunk = left.slice(i, i + CHUNK)
      const { data, error } = await db.from(ref.table).select(ref.col).in(ref.col, chunk)
      if (error) throw error
      for (const r of data ?? []) {
        const v = r[ref.col]
        if (v != null && !used.has(v)) used.set(v, ref.reason)
      }
    }
  }
  return used
}

/** 按 id 删，返回删掉的条数 */
export async function deleteByIds(kind: MasterKind, ids: number[]): Promise<number> {
  let n = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from(kind).delete().in('id', ids.slice(i, i + CHUNK)).select('id')
    if (error) throw error
    n += data?.length ?? 0
  }
  return n
}

/** 批量停用 / 启用，返回改了几条 */
export async function setActive(kind: 'salespersons' | 'bank_accounts', ids: number[], active: boolean): Promise<number> {
  let n = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from(kind).update({ active }).in('id', ids.slice(i, i + CHUNK)).select('id')
    if (error) throw error
    n += data?.length ?? 0
  }
  return n
}
