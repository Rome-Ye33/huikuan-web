import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://lltqxosyzzbpellfljpv.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_kGF93JQzkOgPsUXA6jqoHQ_dIpw_YVl'

export const supabase = createClient<Database>(url, key)

type PublicSchema = Database['public']
export type TableRow<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type ViewRow<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row']

export type AppRole = PublicSchema['Enums']['app_role']
export type Account = TableRow<'bank_accounts'>
export type Nature = TableRow<'payment_natures'>
export type Salesperson = TableRow<'salespersons'>
export type Customer = TableRow<'customers'>
export type Profile = TableRow<'profiles'>
export type Invite = TableRow<'user_invites'>
export type FxRate = TableRow<'fx_rates'>
export type ImportFormat = TableRow<'bank_import_formats'>
export type Receipt = ViewRow<'v_bank_receipts'>
export type Claim = ViewRow<'v_receipt_claims'>
export type Vehicle = ViewRow<'v_vehicle_ledger'>
export type StatementLine = ViewRow<'v_statement_lines'>
export type ReceiptReport = ViewRow<'v_receipt_reports'>

export const VOUCHER_BUCKET = 'vouchers'
