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
      approval_cc: {
        Row: {
          at: string
          doc_id: number
          doc_type: string
          id: number
          log_id: number | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          at?: string
          doc_id: number
          doc_type: string
          id?: never
          log_id?: number | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          at?: string
          doc_id?: number
          doc_type?: string
          id?: never
          log_id?: number | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_cc_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_logs: {
        Row: {
          action: string
          actor: string | null
          actor_name: string | null
          at: string
          doc_id: number
          doc_type: string
          from_status: string | null
          id: number
          note: string | null
          step: string | null
          to_status: string
        }
        Insert: {
          action: string
          actor?: string | null
          actor_name?: string | null
          at?: string
          doc_id: number
          doc_type: string
          from_status?: string | null
          id?: never
          note?: string | null
          step?: string | null
          to_status: string
        }
        Update: {
          action?: string
          actor?: string | null
          actor_name?: string | null
          at?: string
          doc_id?: number
          doc_type?: string
          from_status?: string | null
          id?: never
          note?: string | null
          step?: string | null
          to_status?: string
        }
        Relationships: []
      }
      approval_steps: {
        Row: {
          active: boolean
          by_salesperson: boolean
          created_at: string
          doc_type: string
          key: string
          name: string
          name_en: string | null
          position: number
        }
        Insert: {
          active?: boolean
          by_salesperson?: boolean
          created_at?: string
          doc_type?: string
          key: string
          name: string
          name_en?: string | null
          position: number
        }
        Update: {
          active?: boolean
          by_salesperson?: boolean
          created_at?: string
          doc_type?: string
          key?: string
          name?: string
          name_en?: string | null
          position?: number
        }
        Relationships: []
      }
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
          opening_balance: number | null
          opening_date: string | null
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
          opening_balance?: number | null
          opening_date?: string | null
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
          opening_balance?: number | null
          opening_date?: string | null
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
          approved_at: string | null
          attachments: string[]
          bank_ref: string | null
          cheque_no: string | null
          created_at: string
          created_by: string | null
          currency: string
          flow: Json
          fx_rate: number
          id: number
          import_batch_id: number | null
          import_hash: string | null
          needs_correction: boolean
          note: string | null
          payer_summary: string | null
          receipt_date: string
          receipt_no: string
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_name: string | null
          report_date: string | null
          report_override: string | null
          reported_at: string | null
          reported_by: string | null
          status: string
          step: string | null
          updated_at: string
        }
        Insert: {
          account_id: number
          amount_orig: number
          amount_usd?: number | null
          approved_at?: string | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          flow?: Json
          fx_rate: number
          id?: never
          import_batch_id?: number | null
          import_hash?: string | null
          needs_correction?: boolean
          note?: string | null
          payer_summary?: string | null
          receipt_date: string
          receipt_no: string
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_name?: string | null
          report_date?: string | null
          report_override?: string | null
          reported_at?: string | null
          reported_by?: string | null
          status?: string
          step?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: number
          amount_orig?: number
          amount_usd?: number | null
          approved_at?: string | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          flow?: Json
          fx_rate?: number
          id?: never
          import_batch_id?: number | null
          import_hash?: string | null
          needs_correction?: boolean
          note?: string | null
          payer_summary?: string | null
          receipt_date?: string
          receipt_no?: string
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_name?: string | null
          report_date?: string | null
          report_override?: string | null
          reported_at?: string | null
          reported_by?: string | null
          status?: string
          step?: string | null
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
          balance: number | null
          bank_ref: string | null
          batch_id: number
          cheque_no: string | null
          created_at: string
          entry_id: number | null
          id: number
          ignored: boolean
          line_date: string
          line_hash: string
          line_seq: number | null
          match_type: string | null
          note: string | null
          payer_summary: string | null
          receipt_id: number | null
        }
        Insert: {
          account_id: number
          amount_orig: number
          balance?: number | null
          bank_ref?: string | null
          batch_id: number
          cheque_no?: string | null
          created_at?: string
          entry_id?: number | null
          id?: never
          ignored?: boolean
          line_date: string
          line_hash: string
          line_seq?: number | null
          match_type?: string | null
          note?: string | null
          payer_summary?: string | null
          receipt_id?: number | null
        }
        Update: {
          account_id?: number
          amount_orig?: number
          balance?: number | null
          bank_ref?: string | null
          batch_id?: number
          cheque_no?: string | null
          created_at?: string
          entry_id?: number | null
          id?: never
          ignored?: boolean
          line_date?: string
          line_hash?: string
          line_seq?: number | null
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
      cash_entries: {
        Row: {
          account_id: number
          amount: number
          amount_usd: number | null
          attachments: string[]
          bank_ref: string | null
          cheque_no: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency: string
          direction: string
          entry_date: string
          entry_no: string
          fee_of: number | null
          fx_rate: number | null
          id: number
          module: string
          note: string | null
          peer_id: number | null
          summary: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: number
          amount: number
          amount_usd?: number | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction: string
          entry_date: string
          entry_no?: string
          fee_of?: number | null
          fx_rate?: number | null
          id?: never
          module?: string
          note?: string | null
          peer_id?: number | null
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: number
          amount?: number
          amount_usd?: number | null
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction?: string
          entry_date?: string
          entry_no?: string
          fee_of?: number | null
          fx_rate?: number | null
          id?: never
          module?: string
          note?: string | null
          peer_id?: number | null
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_peer_id_fkey"
            columns: ["peer_id"]
            isOneToOne: false
            referencedRelation: "cash_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      cheque_logs: {
        Row: {
          action: string
          actor: string | null
          actor_name: string | null
          at: string
          cheque_id: number
          from_status: string | null
          id: number
          note: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          actor_name?: string | null
          at?: string
          cheque_id: number
          from_status?: string | null
          id?: never
          note?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          actor_name?: string | null
          at?: string
          cheque_id?: number
          from_status?: string | null
          id?: never
          note?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cheque_logs_cheque_id_fkey"
            columns: ["cheque_id"]
            isOneToOne: false
            referencedRelation: "cheques"
            referencedColumns: ["id"]
          },
        ]
      }
      cheque_banks: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cheques: {
        Row: {
          amount: number | null
          cheque_key: string | null
          cheque_no: string
          contract_no: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: number
          deposit_account_id: number | null
          deposit_date: string | null
          drawer_bank: string | null
          drawer_name: string | null
          due_date: string | null
          id: number
          installment_count: number | null
          installment_no: number | null
          installment_usd: number | null
          note: string | null
          plan_date: string | null
          purpose: string
          reason: string | null
          receipt_id: number | null
          salesperson_id: number | null
          status: string
          updated_at: string
          vehicle_id: number | null
          vehicle_ids: number[]
        }
        Insert: {
          amount?: number | null
          cheque_key?: never
          cheque_no: string
          contract_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id: number
          deposit_account_id?: number | null
          deposit_date?: string | null
          drawer_bank?: string | null
          drawer_name?: string | null
          due_date?: string | null
          id?: never
          installment_count?: number | null
          installment_no?: number | null
          installment_usd?: number | null
          note?: string | null
          plan_date?: string | null
          purpose?: string
          reason?: string | null
          receipt_id?: number | null
          salesperson_id?: number | null
          status?: string
          updated_at?: string
          vehicle_id?: number | null
          vehicle_ids?: number[]
        }
        Update: {
          amount?: number | null
          cheque_key?: never
          cheque_no?: string
          contract_no?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: number
          deposit_account_id?: number | null
          deposit_date?: string | null
          drawer_bank?: string | null
          drawer_name?: string | null
          due_date?: string | null
          id?: never
          installment_count?: number | null
          installment_no?: number | null
          installment_usd?: number | null
          note?: string | null
          plan_date?: string | null
          purpose?: string
          reason?: string | null
          receipt_id?: number | null
          salesperson_id?: number | null
          status?: string
          updated_at?: string
          vehicle_id?: number | null
          vehicle_ids?: number[]
        }
        Relationships: []
      }
      commission_vouchers: {
        Row: {
          ar_at: string | null
          ar_by: string | null
          ar_name: string | null
          attachments: string[]
          charges_note: string | null
          commission_usd: number | null
          created_at: string
          created_by: string | null
          customer_id: number
          dept: string
          dept_at: string | null
          dept_by: string | null
          dept_name: string | null
          discount_usd: number
          down_payment_usd: number | null
          finance_at: string | null
          finance_by: string | null
          finance_name: string | null
          flow: Json | null
          full_payment: boolean
          gm_at: string | null
          gm_by: string | null
          gm_name: string | null
          id: number
          other_charges_usd: number
          paid_by: string | null
          paid_name: string | null
          paid_on: string | null
          payments: Json
          payout_ratio: number | null
          payout_rate: number | null
          per_term_usd: number | null
          prepared_at: string | null
          prepared_by: string | null
          prepared_name: string | null
          qty_model: string | null
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_name: string | null
          remarks: string | null
          salesperson_id: number
          status: string
          step: string | null
          terms_count: number | null
          updated_at: string
          vehicles: Json
          voucher_date: string
          voucher_no: string | null
        }
        Insert: {
          ar_at?: string | null
          ar_by?: string | null
          ar_name?: string | null
          attachments?: string[]
          charges_note?: string | null
          commission_usd?: number | null
          created_at?: string
          created_by?: string | null
          customer_id: number
          dept?: string
          dept_at?: string | null
          dept_by?: string | null
          dept_name?: string | null
          discount_usd?: number
          down_payment_usd?: number | null
          finance_at?: string | null
          finance_by?: string | null
          finance_name?: string | null
          flow?: Json | null
          full_payment?: boolean
          gm_at?: string | null
          gm_by?: string | null
          gm_name?: string | null
          id?: never
          other_charges_usd?: number
          paid_by?: string | null
          paid_name?: string | null
          paid_on?: string | null
          payments?: Json
          payout_ratio?: number | null
          payout_rate?: number | null
          per_term_usd?: number | null
          prepared_at?: string | null
          prepared_by?: string | null
          prepared_name?: string | null
          qty_model?: string | null
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_name?: string | null
          remarks?: string | null
          salesperson_id: number
          status?: string
          step?: string | null
          terms_count?: number | null
          updated_at?: string
          vehicles?: Json
          voucher_date?: string
          voucher_no?: string | null
        }
        Update: {
          ar_at?: string | null
          ar_by?: string | null
          ar_name?: string | null
          attachments?: string[]
          charges_note?: string | null
          commission_usd?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: number
          dept?: string
          dept_at?: string | null
          dept_by?: string | null
          dept_name?: string | null
          discount_usd?: number
          down_payment_usd?: number | null
          finance_at?: string | null
          finance_by?: string | null
          finance_name?: string | null
          flow?: Json | null
          full_payment?: boolean
          gm_at?: string | null
          gm_by?: string | null
          gm_name?: string | null
          id?: never
          other_charges_usd?: number
          paid_by?: string | null
          paid_name?: string | null
          paid_on?: string | null
          payments?: Json
          payout_ratio?: number | null
          payout_rate?: number | null
          per_term_usd?: number | null
          prepared_at?: string | null
          prepared_by?: string | null
          prepared_name?: string | null
          qty_model?: string | null
          reject_note?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_name?: string | null
          remarks?: string | null
          salesperson_id?: number
          status?: string
          step?: string | null
          terms_count?: number | null
          updated_at?: string
          vehicles?: Json
          voucher_date?: string
          voucher_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_vouchers_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_vouchers_step_fkey"
            columns: ["step"]
            isOneToOne: false
            referencedRelation: "approval_steps"
            referencedColumns: ["key"]
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
      notifications: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          doc_id: number
          doc_type: string
          due_at: string | null
          error: string | null
          id: number
          kind: string
          log_id: number | null
          next_try_at: string
          sent_at: string | null
          status: string
          user_id: string
          wa_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          doc_id: number
          doc_type: string
          due_at?: string | null
          error?: string | null
          id?: never
          kind: string
          log_id?: number | null
          next_try_at?: string
          sent_at?: string | null
          status?: string
          user_id: string
          wa_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          doc_id?: number
          doc_type?: string
          due_at?: string | null
          error?: string | null
          id?: never
          kind?: string
          log_id?: number | null
          next_try_at?: string
          sent_at?: string | null
          status?: string
          user_id?: string
          wa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      journal_log: {
        Row: {
          account_id: number | null
          action: string
          at: string
          by_user: string | null
          detail: Json
          doc_no: string | null
          entry_id: number | null
          id: number
          line_id: number | null
          txid: number
        }
        Insert: {
          account_id?: number | null
          action: string
          at?: string
          by_user?: string | null
          detail?: Json
          doc_no?: string | null
          entry_id?: number | null
          id?: never
          line_id?: number | null
          txid?: number
        }
        Update: {
          account_id?: number | null
          action?: string
          at?: string
          by_user?: string | null
          detail?: Json
          doc_no?: string | null
          entry_id?: number | null
          id?: never
          line_id?: number | null
          txid?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          approval_posts: string[]
          cc_docs: string[]
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          journal_duty: string | null
          notify_email: boolean
          notify_lang: string
          perms: Json | null
          role: Database["public"]["Enums"]["app_role"] | null
          salesperson_id: number | null
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          approval_posts?: string[]
          cc_docs?: string[]
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          journal_duty?: string | null
          notify_email?: boolean
          notify_lang?: string
          perms?: Json | null
          role?: Database["public"]["Enums"]["app_role"] | null
          salesperson_id?: number | null
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          approval_posts?: string[]
          cc_docs?: string[]
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          journal_duty?: string | null
          notify_email?: boolean
          notify_lang?: string
          perms?: Json | null
          role?: Database["public"]["Enums"]["app_role"] | null
          salesperson_id?: number | null
          whatsapp?: string | null
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
          import_key: string | null
          model_desc: string | null
          nature: string
          receipt_id: number | null
          report_note: string | null
          salesperson_id: number | null
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
          import_key?: string | null
          model_desc?: string | null
          nature: string
          receipt_id?: number | null
          report_note?: string | null
          salesperson_id?: number | null
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
          import_key?: string | null
          model_desc?: string | null
          nature?: string
          receipt_id?: number | null
          report_note?: string | null
          salesperson_id?: number | null
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
            foreignKeyName: "receipt_claims_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
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
      receipt_submissions: {
        Row: {
          account_id: number
          amount_orig: number
          attachments: string[]
          bank_ref: string | null
          cheque_no: string | null
          claims: Json
          created_at: string
          currency: string
          fx_rate: number | null
          id: number
          note: string | null
          payer_summary: string | null
          receipt_date: string
          receipt_id: number | null
          request_note: string | null
          requested_at: string | null
          requested_by: string | null
          requested_name: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          salesperson_id: number
          status: string
          submitted_at: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          account_id: number
          amount_orig: number
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          claims?: Json
          created_at?: string
          currency: string
          fx_rate?: number | null
          id?: never
          note?: string | null
          payer_summary?: string | null
          receipt_date: string
          receipt_id?: number | null
          request_note?: string | null
          requested_at?: string | null
          requested_by?: string | null
          requested_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salesperson_id: number
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: number
          amount_orig?: number
          attachments?: string[]
          bank_ref?: string | null
          cheque_no?: string | null
          claims?: Json
          created_at?: string
          currency?: string
          fx_rate?: number | null
          id?: never
          note?: string | null
          payer_summary?: string | null
          receipt_date?: string
          receipt_id?: number | null
          request_note?: string | null
          requested_at?: string | null
          requested_by?: string | null
          requested_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salesperson_id?: number
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_submissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_submissions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_submissions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_submissions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "v_receipt_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_submissions_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
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
          approval_posts: string[]
          cc_docs: string[]
          created_at: string
          email: string
          full_name: string | null
          invited_by: string | null
          journal_duty: string | null
          perms: Json | null
          role: Database["public"]["Enums"]["app_role"]
          salesperson_id: number | null
        }
        Insert: {
          approval_posts?: string[]
          cc_docs?: string[]
          created_at?: string
          email: string
          full_name?: string | null
          invited_by?: string | null
          journal_duty?: string | null
          perms?: Json | null
          role: Database["public"]["Enums"]["app_role"]
          salesperson_id?: number | null
        }
        Update: {
          approval_posts?: string[]
          cc_docs?: string[]
          created_at?: string
          email?: string
          full_name?: string | null
          invited_by?: string | null
          journal_duty?: string | null
          perms?: Json | null
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
          approved_at: string | null
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
          flow: Json | null
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
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_name: string | null
          report_date: string | null
          report_override: string | null
          reported_at: string | null
          reported_by: string | null
          status: string | null
          step: string | null
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
      v_cheques: {
        Row: {
          amount: number | null
          cheque_key: string | null
          cheque_no: string | null
          contract_no: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_id: number | null
          customer_name: string | null
          days_deposited: number | null
          days_to_due: number | null
          deposit_account_id: number | null
          deposit_account_name: string | null
          deposit_date: string | null
          drawer_bank: string | null
          drawer_name: string | null
          due_date: string | null
          id: number | null
          installment_count: number | null
          installment_no: number | null
          installment_usd: number | null
          is_reported: boolean | null
          last_note: string | null
          last_note_at: string | null
          last_note_by: string | null
          model: string | null
          models: string | null
          note: string | null
          plan_date: string | null
          purpose: string | null
          reason: string | null
          receipt_date: string | null
          receipt_id: number | null
          receipt_no: string | null
          receipt_status: string | null
          salesperson_id: number | null
          salesperson_name: string | null
          status: string | null
          updated_at: string | null
          vehicle_count: number | null
          vehicle_id: number | null
          vehicle_ids: number[] | null
          vin: string | null
          vins: string | null
        }
        Relationships: []
      }
      v_commission_vouchers: {
        Row: {
          ar_at: string | null
          ar_by: string | null
          ar_name: string | null
          attachments: string[] | null
          balance_usd: number | null
          charges_note: string | null
          commission_usd: number | null
          created_at: string | null
          created_by: string | null
          customer_id: number | null
          customer_name: string | null
          dept: string | null
          dept_at: string | null
          dept_by: string | null
          dept_name: string | null
          discount_usd: number | null
          down_payment_usd: number | null
          finance_at: string | null
          finance_by: string | null
          finance_name: string | null
          flow: Json | null
          full_payment: boolean | null
          gm_at: string | null
          gm_by: string | null
          gm_name: string | null
          id: number | null
          other_charges_usd: number | null
          paid_by: string | null
          paid_name: string | null
          paid_on: string | null
          paid_usd: number | null
          payments: Json | null
          payout_ghs: number | null
          payout_rate: number | null
          payout_ratio: number | null
          payout_usd: number | null
          per_term_usd: number | null
          prepared_at: string | null
          prepared_by: string | null
          prepared_name: string | null
          qty_model: string | null
          reject_note: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_name: string | null
          remarks: string | null
          salesperson_id: number | null
          salesperson_name: string | null
          status: string | null
          step: string | null
          terms_count: number | null
          total_sales_usd: number | null
          updated_at: string | null
          vehicle_count: number | null
          vehicles: Json | null
          vehicles_usd: number | null
          vins: string | null
          voucher_date: string | null
          voucher_no: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_vouchers_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_vouchers_step_fkey"
            columns: ["step"]
            isOneToOne: false
            referencedRelation: "approval_steps"
            referencedColumns: ["key"]
          },
        ]
      }
      v_journal: {
        Row: {
          account_id: number | null
          account_kind: string | null
          account_name: string | null
          amount_in: number | null
          amount_out: number | null
          amount_usd: number | null
          bank_balance: number | null
          bank_ref: string | null
          bank_summary: string | null
          counterparty: string | null
          created_at: string | null
          created_by_name: string | null
          currency: string | null
          doc_no: string | null
          entry_date: string | null
          entry_id: number | null
          fill_status: string | null
          fx_rate: number | null
          key: string | null
          line_id: number | null
          module: string | null
          peer_account_id: number | null
          peer_account_name: string | null
          receipt_id: number | null
          seq: number | null
          source: string | null
          source_id: number | null
          summary: string | null
        }
        Relationships: []
      }
      v_journal_log: {
        Row: {
          account_id: number | null
          account_kind: string | null
          account_name: string | null
          action: string | null
          at: string | null
          by_name: string | null
          by_user: string | null
          currency: string | null
          detail: Json | null
          doc_no: string | null
          entry_id: number | null
          id: number | null
          line_id: number | null
          txid: number | null
        }
        Relationships: []
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
          model_desc: string | null
          nature: string | null
          nature_kind: string | null
          receipt_amount_orig: number | null
          receipt_id: number | null
          receipt_no: string | null
          receipt_status: string | null
          report_note: string | null
          salesperson_id: number | null
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
          balance: number | null
          bank_ref: string | null
          batch_id: number | null
          cheque_no: string | null
          created_at: string | null
          currency: string | null
          entry_id: number | null
          entry_module: string | null
          entry_no: string | null
          id: number | null
          ignored: boolean | null
          line_date: string | null
          line_hash: string | null
          line_seq: number | null
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
      v_workbench: {
        Row: {
          account_id: number | null
          activity_at: string | null
          amount: number | null
          amount_usd: number | null
          claims: Json | null
          currency: string | null
          customer_name: string | null
          doc_date: string | null
          doc_id: number | null
          doc_no: string | null
          doc_type: string | null
          in_cc: boolean | null
          in_done: boolean | null
          in_ended: boolean | null
          in_mine: boolean | null
          in_todo: boolean | null
          initiated_at: string | null
          is_ended: boolean | null
          is_request: boolean | null
          step_by_salesperson: boolean | null
          last_action: string | null
          last_actor_name: string | null
          last_at: string | null
          last_note: string | null
          last_step: string | null
          my_action: string | null
          my_at: string | null
          my_step: string | null
          receipt_id: number | null
          receipt_no: string | null
          salesperson_id: number | null
          salesperson_name: string | null
          status: string | null
          step: string | null
          updated_at: string | null
          vehicle_count: number | null
          vins: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cn_num: { Args: { n: number }; Returns: string }
      cheque_action: {
        Args: { p?: Json; p_action: string; p_id: number }
        Returns: Json
      }
      cheque_alert_count: { Args: never; Returns: number }
      commission_voucher_action: {
        Args: {
          p_action: string
          p_date?: string
          p_id: number
          p_note?: string
        }
        Returns: undefined
      }
      commission_voucher_attach: {
        Args: { p_id: number; p_paths: string[]; p_replace?: boolean }
        Returns: string[]
      }
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
      delete_cash_entry: { Args: { p_id: number; p_updated_at?: string }; Returns: undefined }
      journal_todo_count: { Args: never; Returns: Json }
      fill_statement_lines: { Args: { p: Json; p_line_ids: number[] }; Returns: number }
      import_cheques: { Args: { p_rows: Json }; Returns: Json }
      import_vehicles: {
        Args: { p_opening_date: string; p_rows: Json; p_update?: boolean }
        Returns: Json
      }
      journal_month: {
        Args: { p_account?: number; p_from: string; p_to: string }
        Returns: {
          account_id: number
          bank_balance: number | null
          bank_date: string | null
          bank_diff: number | null
          closing: number
          expense: number
          has_opening: boolean
          income: number
          line_n: number
          opening: number
          pending_amount: number
          pending_n: number
          unfilled_n: number
          waiting_amount: number
          waiting_n: number
        }[]
      }
      link_submission: {
        Args: { p_receipt_id: number; p_submission_id: number }
        Returns: undefined
      }
      match_statement_lines: { Args: { p_account_id: number }; Returns: number }
      notify_check_secret: { Args: { p_secret: string }; Returns: boolean }
      notify_claim: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          go: string
          id: number
          lang: string
          to_number: string
        }[]
      }
      notify_claim_digest: {
        Args: { p_limit?: number }
        Returns: {
          items: Json
          lang: string
          to_email: string
          to_name: string
        }[]
      }
      notify_claim_email: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          go: string
          id: number
          lang: string
          to_email: string
          to_name: string
        }[]
      }
      notify_done: {
        Args: {
          p_error?: string
          p_id: number
          p_status: string
          p_wa_id?: string
        }
        Returns: undefined
      }
      notify_done_many: {
        Args: {
          p_error?: string
          p_ids: number[]
          p_status: string
          p_wa_id?: string
        }
        Returns: undefined
      }
      receipt_action: {
        Args: { p_action: string; p_id: number; p_note?: string }
        Returns: undefined
      }
      receipt_report_text: { Args: { p_receipt_id: number }; Returns: string }
      request_receipt_info: {
        Args: { p_note?: string; p_receipt_id: number; p_salesperson_id: number }
        Returns: number
      }
      save_approval_flow: {
        Args: { p_doc_type: string; p_steps: Json }
        Returns: undefined
      }
      save_cash_entry: { Args: { p: Json }; Returns: Json }
      save_claims: {
        Args: { p_claims: Json; p_receipt_id: number }
        Returns: undefined
      }
      save_commission_voucher: { Args: { p: Json }; Returns: number }
      save_cheques: { Args: { p_rows: Json }; Returns: Json }
      save_openings: { Args: { p_date: string; p_rows: Json }; Returns: number }
      save_receipt: {
        Args: { p_claims?: Json; p_receipt: Json }
        Returns: number
      }
      save_voucher_flow: { Args: { p_steps: Json }; Returns: undefined }
      set_my_email_notify: {
        Args: { p_lang: string; p_on: boolean }
        Returns: undefined
      }
      set_my_notify: {
        Args: { p_lang: string; p_whatsapp: string }
        Returns: undefined
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
