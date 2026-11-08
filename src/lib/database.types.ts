export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      bank_accounts: {
        Row: {
          active: boolean
          bank: string | null
          company: string | null
          country: string
          created_at: string
          currency: string
          id: number
          kind: string
          last4: string | null
          list_name: string | null
          masked_hints: string[]
          short_name: string
        }
        Insert: {
          active?: boolean
          bank?: string | null
          company?: string | null
          country?: string
          created_at?: string
          currency: string
          id?: never
          kind?: string
          last4?: string | null
          list_name?: string | null
          masked_hints?: string[]
          short_name: string
        }
        Update: {
          active?: boolean
          bank?: string | null
          company?: string | null
          country?: string
          created_at?: string
          currency?: string
          id?: never
          kind?: string
          last4?: string | null
          list_name?: string | null
          masked_hints?: string[]
          short_name?: string
        }
        Relationships: []
      }
      bank_import_formats: {
        Row: {
          bank: string | null
          created_at: string
          date_format: string
          header_row: number
          id: number
          mapping: Json
          name: string
          note: string | null
        }
        Insert: {
          bank?: string | null
          created_at?: string
          date_format?: string
          header_row?: number
          id?: never
          mapping: Json
          name: string
          note?: string | null
        }
        Update: {
          bank?: string | null
          created_at?: string
          date_format?: string
          header_row?: number
          id?: never
          mapping?: Json
          name?: string
          note?: string | null
        }
        Relationships: []
      }
      bank_receipts: {
        Row: {
          account_id: number
          amount_orig: number
          amount_usd: number | null
          attachments: string[]
          bank_ref: string | null
          cheque_no: string | null
          created_at: string
          created_by: string | null
          currency: string
          fx_rate: number
          id: number
          import_batch_id: number | null
          import_hash: string | null
          needs_correction: boolean
          note: string | null
          payer_summary: string | null
          receipt_date: string
          receipt_no: string
          report_date: string | null
          report_override: string | null
          reported_at: string | null
          reported_by: string | null
          updated_at: string
        }
        Insert: {
          account_id: number
          amount_orig: number
          amount_usd?: number | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          fx_rate: number
          id?: never
          import_batch_id?: number | null
          import_hash?: string | null
          needs_correction?: boolean
          note?: string | null
          payer_summary?: string | null
          receipt_date: string
          receipt_no: string
          report_date?: string | null
          report_override?: string | null
          reported_at?: string | null
          reported_by?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: number
          amount_orig?: number
          amount_usd?: number | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: never
          import_batch_id?: number | null
          import_hash?: string | null
          needs_correction?: boolean
          note?: string | null
          payer_summary?: string | null
          receipt_date?: string
          receipt_no?: string
          report_date?: string | null
          report_override?: string | null
          reported_at?: string | null
          reported_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_receipts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          account_id: number
          amount_orig: number
          bank_ref: string | null
          batch_id: number
          cheque_no: string | null
          created_at: string
          id: number
          ignored: boolean
          line_date: string
          line_hash: string
          match_type: string | null
          note: string | null
          payer_summary: string | null
          receipt_id: number | null
        }
        Insert: {
          account_id: number
          amount_orig: number
          bank_ref?: string | null
          batch_id: number
          cheque_no?: string | null
          created_at?: string
          id?: never
          ignored?: boolean
          line_date: string
          line_hash: string
          match_type?: string | null
          note?: string | null
          payer_summary?: string | null
          receipt_id?: number | null
        }
        Update: {
          account_id?: number
          amount_orig?: number
          bank_ref?: string | null
          batch_id?: number
          cheque_no?: string | null
          created_at?: string
          id?: never
          ignored?: boolean
          line_date?: string
          line_hash?: string
          match_type?: string | null
          note?: string | null
          payer_summary?: string | null
          receipt_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_receipt_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          country: string | null
          created_at: string
          crm_id: string | null
          id: number
          name: string
          note: string | null
          phone: string | null
          salesperson_id: number | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          crm_id?: string | null
          id?: never
          name: string
          note?: string | null
          phone?: string | null
          salesperson_id?: number | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          crm_id?: string | null
          id?: never
          name?: string
          note?: string | null
          phone?: string | null
          salesperson_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          currency: string
          rate: number
          rate_date: string
          source: string | null
        }
        Insert: {
          currency: string
          rate: number
          rate_date: string
          source?: string | null
        }
        Update: {
          currency?: string
          rate?: number
          rate_date?: string
          source?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          account_id: number
          created_at: string
          created_by: string | null
          file_name: string | null
          format_id: number | null
          id: number
          period_from: string | null
          period_to: string | null
          row_count: number
          skipped: number
        }
        Insert: {
          account_id: number
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          format_id?: number | null
          id?: never
          period_from?: string | null
          period_to?: string | null
          row_count?: number
          skipped?: number
        }
        Update: {
          account_id?: number
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          format_id?: number | null
          id?: never
          period_from?: string | null
          period_to?: string | null
          row_count?: number
          skipped?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "bank_import_formats"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_natures: {
        Row: {
          active: boolean
          kind: string
          name: string
          prepaid_remark: boolean
          settled_remark: boolean
          sort_order: number
        }
        Insert: {
          active?: boolean
          kind: string
          name: string
          prepaid_remark?: boolean
          settled_remark?: boolean
          sort_order?: number
        }
        Update: {
          active?: boolean
          kind?: string
          name?: string
          prepaid_remark?: boolean
          settled_remark?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          salesperson_id: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"] | null
          salesperson_id?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          salesperson_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_claims: {
        Row: {
          amount_orig: number | null
          amount_usd: number
          claim_date: string
          claim_no: string
          created_at: string
          created_by: string | null
          customer_id: number | null
          id: number
          nature: string
          receipt_id: number | null
          report_note: string | null
          updated_at: string
          vehicle_id: number | null
        }
        Insert: {
          amount_orig?: number | null
          amount_usd: number
          claim_date: string
          claim_no: string
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          id?: never
          nature: string
          receipt_id?: number | null
          report_note?: string | null
          updated_at?: string
          vehicle_id?: number | null
        }
        Update: {
          amount_orig?: number | null
          amount_usd?: number
          claim_date?: string
          claim_no?: string
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          id?: never
          nature?: string
          receipt_id?: number | null
          report_note?: string | null
          updated_at?: string
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_nature_fkey"
            columns: ["nature"]
            isOneToOne: false
            referencedRelation: "payment_natures"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_receipt_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "v_vehicle_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_no_counters: {
        Row: {
          last_no: number
          prefix: string
        }
        Insert: {
          last_no: number
          prefix: string
        }
        Update: {
          last_no?: number
          prefix?: string
        }
        Relationships: []
      }
      salespersons: {
        Row: {
          active: boolean
          commission_type: string | null
          commission_value: number | null
          created_at: string
          id: number
          lark_account: string | null
          name: string
          updated_at: string
          wechat: string | null
        }
        Insert: {
          active?: boolean
          commission_type?: string | null
          commission_value?: number | null
          created_at?: string
          id?: never
          lark_account?: string | null
          name: string
          updated_at?: string
          wechat?: string | null
        }
        Update: {
          active?: boolean
          commission_type?: string | null
          commission_value?: number | null
          created_at?: string
          id?: never
          lark_account?: string | null
          name?: string
          updated_at?: string
          wechat?: string | null
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          salesperson_id: number | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          salesperson_id?: number | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          salesperson_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_invites_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          contract_date: string | null
          contract_usd: number
          created_at: string
          created_by: string | null
          customer_id: number
          down_payment_usd: number | null
          id: number
          model: string
          note: string | null
          payment_method: string
          salesperson_id: number | null
          ship_status: string
          shipped_at: string | null
          updated_at: string
          vin: string
        }
        Insert: {
          contract_date?: string | null
          contract_usd: number
          created_at?: string
          created_by?: string | null
          customer_id: number
          down_payment_usd?: number | null
          id?: never
          model: string
          note?: string | null
          payment_method: string
          salesperson_id?: number | null
          ship_status?: string
          shipped_at?: string | null
          updated_at?: string
          vin: string
        }
        Update: {
          contract_date?: string | null
          contract_usd?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number
          down_payment_usd?: number | null
          id?: never
          model?: string
          note?: string | null
          payment_method?: string
          salesperson_id?: number | null
          ship_status?: string
          shipped_at?: string | null
          updated_at?: string
          vin?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_bank_receipts: {
        Row: {
          account_id: number | null
          account_kind: string | null
          account_name: string | null
          amount_orig: number | null
          amount_usd: number | null
          attachments: string[] | null
          bank_line_id: number | null
          bank_ref: string | null
          bank_status: string | null
          cheque_no: string | null
          claim_count: number | null
          claim_status: string | null
          claimed_orig: number | null
          claimed_usd: number | null
          company: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          fx_rate: number | null
          id: number | null
          import_batch_id: number | null
          import_hash: string | null
          is_late: boolean | null
          is_reported: boolean | null
          needs_correction: boolean | null
          note: string | null
          payer_summary: string | null
          pending_orig: number | null
          pending_usd: number | null
          receipt_date: string | null
          receipt_no: string | null
          report_date: string | null
          report_override: string | null
          reported_at: string | null
          reported_by: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_receipts_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_receipt_claims: {
        Row: {
          account_name: string | null
          amount_orig: number | null
          amount_usd: number | null
          claim_date: string | null
          claim_no: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_id: number | null
          customer_name: string | null
          fx_rate: number | null
          id: number | null
          model: string | null
          nature: string | null
          nature_kind: string | null
          receipt_amount_orig: number | null
          receipt_id: number | null
          receipt_no: string | null
          report_note: string | null
          salesperson_name: string | null
          updated_at: string | null
          vehicle_id: number | null
          vin: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_nature_fkey"
            columns: ["nature"]
            isOneToOne: false
            referencedRelation: "payment_natures"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_receipt_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "v_vehicle_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_claims_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_receipt_reports: {
        Row: {
          account_name: string | null
          amount_orig: number | null
          amount_usd: number | null
          claim_status: string | null
          currency: string | null
          id: number | null
          is_late: boolean | null
          is_reported: boolean | null
          needs_correction: boolean | null
          receipt_date: string | null
          receipt_no: string | null
          report_text: string | null
        }
        Relationships: []
      }
      v_statement_lines: {
        Row: {
          account_id: number | null
          account_name: string | null
          amount_orig: number | null
          bank_ref: string | null
          batch_id: number | null
          cheque_no: string | null
          created_at: string | null
          currency: string | null
          id: number | null
          ignored: boolean | null
          line_date: string | null
          line_hash: string | null
          match_status: string | null
          match_type: string | null
          note: string | null
          payer_summary: string | null
          receipt_amount_orig: number | null
          receipt_date: string | null
          receipt_id: number | null
          receipt_no: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_receipt_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vehicle_ledger: {
        Row: {
          balance_usd: number | null
          can_ship: boolean | null
          can_transfer: boolean | null
          contract_date: string | null
          contract_usd: number | null
          created_at: string | null
          created_by: string | null
          customer_id: number | null
          customer_name: string | null
          discount_usd: number | null
          down_payment_usd: number | null
          id: number | null
          last_received_on: string | null
          model: string | null
          note: string | null
          pay_status: string | null
          payment_method: string | null
          received_usd: number | null
          salesperson_id: number | null
          salesperson_name: string | null
          ship_status: string | null
          shipped_at: string | null
          updated_at: string | null
          vin: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cn_num: { Args: { n: number }; Returns: string }
      fmt_money: { Args: { decimals?: number; n: number }; Returns: string }
      import_statement: {
        Args: {
          p_account_id: number
          p_file_name: string
          p_format_id: number
          p_period_from?: string
          p_period_to?: string
          p_rows: Json
        }
        Returns: Json
      }
      match_statement_lines: { Args: { p_account_id: number }; Returns: number }
      receipt_report_text: { Args: { p_receipt_id: number }; Returns: string }
      save_claims: {
        Args: { p_claims: Json; p_receipt_id: number }
        Returns: undefined
      }
      save_receipt: {
        Args: { p_claims?: Json; p_receipt: Json }
        Returns: number
      }
      today_accra: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "finance" | "sales"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "finance", "sales"],
    },
  },
} as const
