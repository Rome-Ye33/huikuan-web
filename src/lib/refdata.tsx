import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchAll, supabase } from './supabase'
import type { Account, Customer, Nature, Salesperson } from './supabase'
import { useAuth } from './auth'
import { tr } from './i18n'

// 下拉框用的基础资料：账户、款项性质、业务员、客户。登录后加载一次，改动后调用 reload。
type RefData = {
  loaded: boolean
  accounts: Account[]
  natures: Nature[]
  salespersons: Salesperson[]
  customers: Customer[]
  accountById: Map<number, Account>
  natureByName: Map<string, Nature>
  reload: () => Promise<void>
}

const RefContext = createContext<RefData | null>(null)

export function RefDataProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth()
  const [loaded, setLoaded] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [natures, setNatures] = useState<Nature[]>([])
  const [salespersons, setSalespersons] = useState<Salesperson[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  const reload = useCallback(async () => {
    const [a, n, s, c] = await Promise.all([
      supabase.from('bank_accounts').select('*').order('company').order('short_name'),
      supabase.from('payment_natures').select('*').order('sort_order'),
      supabase.from('salespersons').select('*').order('name'),
      fetchAll<Customer>(() => supabase.from('customers').select('*').order('name').order('id')),
    ])
    setAccounts(a.data ?? [])
    setNatures(n.data ?? [])
    setSalespersons(s.data ?? [])
    setCustomers(c.data ?? [])
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (role) void reload()
  }, [role, reload])

  const value = useMemo<RefData>(
    () => ({
      loaded,
      accounts,
      natures,
      salespersons,
      customers,
      accountById: new Map(accounts.map((a) => [a.id, a])),
      natureByName: new Map(natures.map((n) => [n.name, n])),
      reload,
    }),
    [loaded, accounts, natures, salespersons, customers, reload],
  )
  return <RefContext.Provider value={value}>{children}</RefContext.Provider>
}

export function useRefData(): RefData {
  const ctx = useContext(RefContext)
  if (!ctx) throw new Error('useRefData must be used inside RefDataProvider')
  return ctx
}

/** 某币种在某天（或之前最近一天）的汇率，没有返回 null */
export async function lookupRate(currency: string, date: string): Promise<number | null> {
  if (currency === 'USD') return 1
  const { data } = await supabase
    .from('fx_rates')
    .select('rate')
    .eq('currency', currency)
    .lte('rate_date', date)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number(data.rate) : null
}

/** 账户下拉选项：按公司分组 */
export function accountOptions(accounts: Account[], onlyActive = true) {
  const groups = new Map<string, { label: string; value: number }[]>()
  for (const a of accounts) {
    if (onlyActive && !a.active) continue
    const g = a.kind === 'bank' ? a.company || tr('其他') : tr('现金 / momo')
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push({ label: a.short_name, value: a.id })
  }
  return [...groups.entries()].map(([label, options]) => ({ label, options }))
}
