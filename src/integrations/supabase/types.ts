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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addition_types: {
        Row: {
          code: string
          counts_in_t_days: boolean
          created_at: string
          default_amount: number | null
          formula: Json
          id: string
          is_active: boolean
          name: string
          qty_unit: string | null
          rate_source: string
          sort_order: number
          t_days_bucket: string | null
          updated_at: string
        }
        Insert: {
          code: string
          counts_in_t_days?: boolean
          created_at?: string
          default_amount?: number | null
          formula?: Json
          id?: string
          is_active?: boolean
          name: string
          qty_unit?: string | null
          rate_source?: string
          sort_order?: number
          t_days_bucket?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          counts_in_t_days?: boolean
          created_at?: string
          default_amount?: number | null
          formula?: Json
          id?: string
          is_active?: boolean
          name?: string
          qty_unit?: string | null
          rate_source?: string
          sort_order?: number
          t_days_bucket?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      additions: {
        Row: {
          addition_date: string
          addition_name: string
          addition_type_id: string
          affects_days_for: string[]
          amount: number
          calculation_type: string
          candidate_id: string
          computed_amount: number | null
          created_at: string
          days: number | null
          description: string
          entry_mode: string
          id: string
          include_in_total_days: boolean
          installments: number
          per_day_amount: number | null
          qty: number | null
          source_kind: string
          source_ref: string
          status: string
          updated_at: string
        }
        Insert: {
          addition_date: string
          addition_name: string
          addition_type_id: string
          affects_days_for?: string[]
          amount: number
          calculation_type: string
          candidate_id: string
          computed_amount?: number | null
          created_at?: string
          days?: number | null
          description?: string
          entry_mode?: string
          id?: string
          include_in_total_days?: boolean
          installments?: number
          per_day_amount?: number | null
          qty?: number | null
          source_kind?: string
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Update: {
          addition_date?: string
          addition_name?: string
          addition_type_id?: string
          affects_days_for?: string[]
          amount?: number
          calculation_type?: string
          candidate_id?: string
          computed_amount?: number | null
          created_at?: string
          days?: number | null
          description?: string
          entry_mode?: string
          id?: string
          include_in_total_days?: boolean
          installments?: number
          per_day_amount?: number | null
          qty?: number | null
          source_kind?: string
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      allowance_types: {
        Row: {
          base_components: Json
          calc_type: string
          cap_amount: number | null
          cap_flat_amount: number | null
          counts_in_t_days: boolean
          created_at: string
          day_driver: string
          display_name: string
          earning_type: string
          enabled: boolean
          fixed_calc_method: string
          fixed_duty_components: string[]
          fixed_duty_divisor: string | null
          formula: Json
          formula_expression: string | null
          formula_mode: string
          formula_version: number
          id: string
          include_in_ot: boolean
          is_default: boolean
          name: string
          percentage: number
          short_code: string
          short_name: string
          updated_at: string
        }
        Insert: {
          base_components?: Json
          calc_type?: string
          cap_amount?: number | null
          cap_flat_amount?: number | null
          counts_in_t_days?: boolean
          created_at?: string
          day_driver?: string
          display_name?: string
          earning_type?: string
          enabled?: boolean
          fixed_calc_method?: string
          fixed_duty_components?: string[]
          fixed_duty_divisor?: string | null
          formula?: Json
          formula_expression?: string | null
          formula_mode?: string
          formula_version?: number
          id?: string
          include_in_ot?: boolean
          is_default?: boolean
          name: string
          percentage?: number
          short_code?: string
          short_name?: string
          updated_at?: string
        }
        Update: {
          base_components?: Json
          calc_type?: string
          cap_amount?: number | null
          cap_flat_amount?: number | null
          counts_in_t_days?: boolean
          created_at?: string
          day_driver?: string
          display_name?: string
          earning_type?: string
          enabled?: boolean
          fixed_calc_method?: string
          fixed_duty_components?: string[]
          fixed_duty_divisor?: string | null
          formula?: Json
          formula_expression?: string | null
          formula_mode?: string
          formula_version?: number
          id?: string
          include_in_ot?: boolean
          is_default?: boolean
          name?: string
          percentage?: number
          short_code?: string
          short_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          category: string
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      attendance_codes: {
        Row: {
          code: string
          color: string
          counts_as_present: boolean
          created_at: string
          day_value: number
          description: string
          enabled: boolean
          id: string
          is_leave: boolean
          is_paid: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          color?: string
          counts_as_present?: boolean
          created_at?: string
          day_value?: number
          description?: string
          enabled?: boolean
          id?: string
          is_leave?: boolean
          is_paid?: boolean
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          color?: string
          counts_as_present?: boolean
          created_at?: string
          day_value?: number
          description?: string
          enabled?: boolean
          id?: string
          is_leave?: boolean
          is_paid?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      attendance_entries: {
        Row: {
          candidate_id: string
          code: string
          created_at: string
          designation_id: string | null
          entry_date: string
          id: string
          ot_hours: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          code?: string
          created_at?: string
          designation_id?: string | null
          entry_date: string
          id?: string
          ot_hours?: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          code?: string
          created_at?: string
          designation_id?: string | null
          entry_date?: string
          id?: string
          ot_hours?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_entries_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sheet_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          period_end: string
          period_start: string
          reason: string
          snapshot: Json
          status: string
          unit_id: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_end: string
          period_start: string
          reason?: string
          snapshot?: Json
          status?: string
          unit_id: string
          updated_at?: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_end?: string
          period_start?: string
          reason?: string
          snapshot?: Json
          status?: string
          unit_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      attendance_sheets: {
        Row: {
          amendment_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          current_version: number
          id: string
          period_end: string
          period_start: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          review_proof_url: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          amendment_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_version?: number
          id?: string
          period_end: string
          period_start: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          review_proof_url?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          amendment_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_version?: number
          id?: string
          period_end?: string
          period_start?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          review_proof_url?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_types: {
        Row: {
          code: string | null
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          name: string
          state_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          state_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          state_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: true
            referencedRelation: "states"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_designations: {
        Row: {
          candidate_id: string
          created_at: string
          designation_id: string
          effective_from: string | null
          effective_to: string | null
          id: string
          is_primary: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          designation_id: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_primary?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          designation_id?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_primary?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_designations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_designations_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_reporting_managers: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          is_primary: boolean
          manager_id: string
          source: string
          unit_id: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          manager_id: string
          source?: string
          unit_id?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          manager_id?: string
          source?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_reporting_managers_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_reporting_managers_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_reporting_managers_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_units: {
        Row: {
          candidate_id: string
          created_at: string
          designation_id: string | null
          id: string
          is_primary: boolean
          is_reliever: boolean
          sort_order: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          designation_id?: string | null
          id?: string
          is_primary?: boolean
          is_reliever?: boolean
          sort_order?: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          designation_id?: string | null
          id?: string
          is_primary?: boolean
          is_reliever?: boolean
          sort_order?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_units_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          aadhaar_image_url: string
          aadhaar_number: string
          alt_mobile: string
          application_date: string
          approved_at: string | null
          assigned_asset_ids: string[]
          bank_account_holder: string
          bank_account_number: string
          bank_account_type: string
          bank_branch: string
          bank_ifsc: string
          bank_name: string
          birthplace: string
          candidate_code: string
          caste_category: string
          compliance: Json
          contacts: Json
          created_at: string
          created_by: string | null
          criminal_history: Json
          date_of_birth: string | null
          department_id: string | null
          designation_id: string | null
          documents: Json
          educations: Json
          email: string
          emergency_contact_mobile: string
          emergency_contact_name: string
          emergency_contact_relation: string
          employee_code: string
          esic_card_uploaded_at: string | null
          esic_card_uploaded_by: string | null
          esic_card_url: string | null
          ex_service_id: string | null
          experiences: Json
          extra_curricular: Json
          full_name: string
          gender: string
          id: string
          identification_proofs: Json
          is_disabled: boolean
          is_enabled: boolean
          is_ex_service: boolean
          kyc_completed: boolean
          languages: Json
          marital_status: string
          mobile: string
          no_hire: boolean
          nominations: Json
          non_billable: boolean
          offboarded_at: string | null
          offboarding_details: Json
          offboarding_reason_id: string | null
          onboarding_details: Json
          other_info: Json
          pan_image_url: string
          pan_number: string
          permanent_address1: string
          permanent_address2: string
          permanent_city: string
          permanent_country: string
          permanent_district: string
          permanent_landmark: string
          permanent_pincode: string
          permanent_police_station: string
          permanent_state: string
          photo_url: string
          physical_health: Json
          preferred_joining_date: string | null
          preferred_language: string | null
          present_address1: string
          present_address2: string
          present_city: string
          present_country: string
          present_district: string
          present_landmark: string
          present_pincode: string
          present_police_station: string
          present_state: string
          references: Json
          rejected_at: string | null
          rejection_reason: string
          religion: string
          reports_to: string | null
          role_key: string
          same_as_permanent: boolean
          signature_url: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          aadhaar_image_url?: string
          aadhaar_number?: string
          alt_mobile?: string
          application_date?: string
          approved_at?: string | null
          assigned_asset_ids?: string[]
          bank_account_holder?: string
          bank_account_number?: string
          bank_account_type?: string
          bank_branch?: string
          bank_ifsc?: string
          bank_name?: string
          birthplace?: string
          candidate_code?: string
          caste_category?: string
          compliance?: Json
          contacts?: Json
          created_at?: string
          created_by?: string | null
          criminal_history?: Json
          date_of_birth?: string | null
          department_id?: string | null
          designation_id?: string | null
          documents?: Json
          educations?: Json
          email?: string
          emergency_contact_mobile?: string
          emergency_contact_name?: string
          emergency_contact_relation?: string
          employee_code?: string
          esic_card_uploaded_at?: string | null
          esic_card_uploaded_by?: string | null
          esic_card_url?: string | null
          ex_service_id?: string | null
          experiences?: Json
          extra_curricular?: Json
          full_name?: string
          gender?: string
          id?: string
          identification_proofs?: Json
          is_disabled?: boolean
          is_enabled?: boolean
          is_ex_service?: boolean
          kyc_completed?: boolean
          languages?: Json
          marital_status?: string
          mobile?: string
          no_hire?: boolean
          nominations?: Json
          non_billable?: boolean
          offboarded_at?: string | null
          offboarding_details?: Json
          offboarding_reason_id?: string | null
          onboarding_details?: Json
          other_info?: Json
          pan_image_url?: string
          pan_number?: string
          permanent_address1?: string
          permanent_address2?: string
          permanent_city?: string
          permanent_country?: string
          permanent_district?: string
          permanent_landmark?: string
          permanent_pincode?: string
          permanent_police_station?: string
          permanent_state?: string
          photo_url?: string
          physical_health?: Json
          preferred_joining_date?: string | null
          preferred_language?: string | null
          present_address1?: string
          present_address2?: string
          present_city?: string
          present_country?: string
          present_district?: string
          present_landmark?: string
          present_pincode?: string
          present_police_station?: string
          present_state?: string
          references?: Json
          rejected_at?: string | null
          rejection_reason?: string
          religion?: string
          reports_to?: string | null
          role_key?: string
          same_as_permanent?: boolean
          signature_url?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          aadhaar_image_url?: string
          aadhaar_number?: string
          alt_mobile?: string
          application_date?: string
          approved_at?: string | null
          assigned_asset_ids?: string[]
          bank_account_holder?: string
          bank_account_number?: string
          bank_account_type?: string
          bank_branch?: string
          bank_ifsc?: string
          bank_name?: string
          birthplace?: string
          candidate_code?: string
          caste_category?: string
          compliance?: Json
          contacts?: Json
          created_at?: string
          created_by?: string | null
          criminal_history?: Json
          date_of_birth?: string | null
          department_id?: string | null
          designation_id?: string | null
          documents?: Json
          educations?: Json
          email?: string
          emergency_contact_mobile?: string
          emergency_contact_name?: string
          emergency_contact_relation?: string
          employee_code?: string
          esic_card_uploaded_at?: string | null
          esic_card_uploaded_by?: string | null
          esic_card_url?: string | null
          ex_service_id?: string | null
          experiences?: Json
          extra_curricular?: Json
          full_name?: string
          gender?: string
          id?: string
          identification_proofs?: Json
          is_disabled?: boolean
          is_enabled?: boolean
          is_ex_service?: boolean
          kyc_completed?: boolean
          languages?: Json
          marital_status?: string
          mobile?: string
          no_hire?: boolean
          nominations?: Json
          non_billable?: boolean
          offboarded_at?: string | null
          offboarding_details?: Json
          offboarding_reason_id?: string | null
          onboarding_details?: Json
          other_info?: Json
          pan_image_url?: string
          pan_number?: string
          permanent_address1?: string
          permanent_address2?: string
          permanent_city?: string
          permanent_country?: string
          permanent_district?: string
          permanent_landmark?: string
          permanent_pincode?: string
          permanent_police_station?: string
          permanent_state?: string
          photo_url?: string
          physical_health?: Json
          preferred_joining_date?: string | null
          preferred_language?: string | null
          present_address1?: string
          present_address2?: string
          present_city?: string
          present_country?: string
          present_district?: string
          present_landmark?: string
          present_pincode?: string
          present_police_station?: string
          present_state?: string
          references?: Json
          rejected_at?: string | null
          rejection_reason?: string
          religion?: string
          reports_to?: string | null
          role_key?: string
          same_as_permanent?: boolean
          signature_url?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contracts: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          billing_type_id: string | null
          company_signature_data: string
          contract_code: string | null
          created_at: string
          created_by: string | null
          description: string
          end_date: string | null
          expiry_date: string | null
          gst_option: string
          id: string
          is_internal: boolean
          original_start_date: string | null
          payroll_window_id: string | null
          promoted_at: string | null
          prospect_code: string | null
          prospect_stage: string
          record_type: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string
          renewal_count: number
          service_type_id: string | null
          signed_at: string | null
          signed_pdf_url: string
          start_date: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          billing_type_id?: string | null
          company_signature_data?: string
          contract_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          end_date?: string | null
          expiry_date?: string | null
          gst_option?: string
          id?: string
          is_internal?: boolean
          original_start_date?: string | null
          payroll_window_id?: string | null
          promoted_at?: string | null
          prospect_code?: string | null
          prospect_stage?: string
          record_type?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string
          renewal_count?: number
          service_type_id?: string | null
          signed_at?: string | null
          signed_pdf_url?: string
          start_date?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          billing_type_id?: string | null
          company_signature_data?: string
          contract_code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          end_date?: string | null
          expiry_date?: string | null
          gst_option?: string
          id?: string
          is_internal?: boolean
          original_start_date?: string | null
          payroll_window_id?: string | null
          promoted_at?: string | null
          prospect_code?: string | null
          prospect_stage?: string
          record_type?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string
          renewal_count?: number
          service_type_id?: string | null
          signed_at?: string | null
          signed_pdf_url?: string
          start_date?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contracts_billing_type_id_fkey"
            columns: ["billing_type_id"]
            isOneToOne: false
            referencedRelation: "billing_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contracts_payroll_window_id_fkey"
            columns: ["payroll_window_id"]
            isOneToOne: false
            referencedRelation: "payroll_windows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contracts_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contracts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      company_document_templates: {
        Row: {
          body: string
          created_at: string
          doc_type: string
          id: string
          is_active: boolean
          is_archived: boolean
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body?: string
          created_at?: string
          doc_type: string
          id?: string
          is_active?: boolean
          is_archived?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          doc_type?: string
          id?: string
          is_active?: boolean
          is_archived?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      contract_resources: {
        Row: {
          benefits: Json
          components: Json
          contract_id: string
          created_at: string
          deductions: Json
          designation_id: string | null
          employer_contributions: Json
          gross: number
          id: string
          payroll_day_base_id: string | null
          quantity: number
          role_key: string | null
          service_type_id: string | null
          shift_hours: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          benefits?: Json
          components?: Json
          contract_id: string
          created_at?: string
          deductions?: Json
          designation_id?: string | null
          employer_contributions?: Json
          gross?: number
          id?: string
          payroll_day_base_id?: string | null
          quantity?: number
          role_key?: string | null
          service_type_id?: string | null
          shift_hours?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          benefits?: Json
          components?: Json
          contract_id?: string
          created_at?: string
          deductions?: Json
          designation_id?: string | null
          employer_contributions?: Json
          gross?: number
          id?: string
          payroll_day_base_id?: string | null
          quantity?: number
          role_key?: string | null
          service_type_id?: string | null
          shift_hours?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_resources_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "client_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_resources_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      cost_components: {
        Row: {
          amount: number | null
          base_components: Json
          calc_type: string
          cap_amount: number | null
          cap_flat_amount: number | null
          code: string
          created_at: string
          day_driver: string
          deduction_calc_type: string
          description: string | null
          enabled: boolean
          fixed_calc_method: string
          fixed_duty_components: string[]
          fixed_duty_divisor: string | null
          formula: Json
          formula_expression: string | null
          formula_mode: string
          formula_version: number
          id: string
          name: string
          notes: string
          party: string
          percentage: number
          sort_order: number
          state: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          base_components?: Json
          calc_type?: string
          cap_amount?: number | null
          cap_flat_amount?: number | null
          code?: string
          created_at?: string
          day_driver?: string
          deduction_calc_type?: string
          description?: string | null
          enabled?: boolean
          fixed_calc_method?: string
          fixed_duty_components?: string[]
          fixed_duty_divisor?: string | null
          formula?: Json
          formula_expression?: string | null
          formula_mode?: string
          formula_version?: number
          id?: string
          name: string
          notes?: string
          party?: string
          percentage?: number
          sort_order?: number
          state?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          base_components?: Json
          calc_type?: string
          cap_amount?: number | null
          cap_flat_amount?: number | null
          code?: string
          created_at?: string
          day_driver?: string
          deduction_calc_type?: string
          description?: string | null
          enabled?: boolean
          fixed_calc_method?: string
          fixed_duty_components?: string[]
          fixed_duty_divisor?: string | null
          formula?: Json
          formula_expression?: string | null
          formula_mode?: string
          formula_version?: number
          id?: string
          name?: string
          notes?: string
          party?: string
          percentage?: number
          sort_order?: number
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_gst_numbers: {
        Row: {
          created_at: string
          customer_id: string
          gstin: string
          id: string
          label: string
          state_code: string
          state_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          gstin: string
          id?: string
          label?: string
          state_code?: string
          state_name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          gstin?: string
          id?: string
          label?: string
          state_code?: string
          state_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_gst_numbers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string
          billing_address1: string
          billing_address2: string
          billing_city: string
          billing_country: string
          billing_district: string
          billing_email: string
          billing_fax: string
          billing_name: string
          billing_phone: string
          billing_pincode: string
          billing_salutation: string
          billing_state: string
          code: string
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          description: string
          id: string
          industry_type: string
          logo_url: string
          name: string
          phone: string
          shipping_address1: string
          shipping_address2: string
          shipping_city: string
          shipping_country: string
          shipping_district: string
          shipping_email: string
          shipping_fax: string
          shipping_name: string
          shipping_phone: string
          shipping_pincode: string
          shipping_salutation: string
          shipping_same_as_billing: boolean
          shipping_state: string
          short_name: string
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
          website: string
        }
        Insert: {
          address?: string
          billing_address1?: string
          billing_address2?: string
          billing_city?: string
          billing_country?: string
          billing_district?: string
          billing_email?: string
          billing_fax?: string
          billing_name?: string
          billing_phone?: string
          billing_pincode?: string
          billing_salutation?: string
          billing_state?: string
          code: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          description?: string
          id?: string
          industry_type?: string
          logo_url?: string
          name: string
          phone?: string
          shipping_address1?: string
          shipping_address2?: string
          shipping_city?: string
          shipping_country?: string
          shipping_district?: string
          shipping_email?: string
          shipping_fax?: string
          shipping_name?: string
          shipping_phone?: string
          shipping_pincode?: string
          shipping_salutation?: string
          shipping_same_as_billing?: boolean
          shipping_state?: string
          short_name?: string
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
          website?: string
        }
        Update: {
          address?: string
          billing_address1?: string
          billing_address2?: string
          billing_city?: string
          billing_country?: string
          billing_district?: string
          billing_email?: string
          billing_fax?: string
          billing_name?: string
          billing_phone?: string
          billing_pincode?: string
          billing_salutation?: string
          billing_state?: string
          code?: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          description?: string
          id?: string
          industry_type?: string
          logo_url?: string
          name?: string
          phone?: string
          shipping_address1?: string
          shipping_address2?: string
          shipping_city?: string
          shipping_country?: string
          shipping_district?: string
          shipping_email?: string
          shipping_fax?: string
          shipping_name?: string
          shipping_phone?: string
          shipping_pincode?: string
          shipping_salutation?: string
          shipping_same_as_billing?: boolean
          shipping_state?: string
          short_name?: string
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
          website?: string
        }
        Relationships: []
      }
      deduction_types: {
        Row: {
          code: string
          created_at: string
          default_amount: number | null
          formula: Json
          id: string
          is_active: boolean
          name: string
          rate_source: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_amount?: number | null
          formula?: Json
          id?: string
          is_active?: boolean
          name: string
          rate_source?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_amount?: number | null
          formula?: Json
          id?: string
          is_active?: boolean
          name?: string
          rate_source?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      deductions: {
        Row: {
          affects_days_for: string[]
          amount: number
          calculation_type: string
          candidate_id: string
          computed_amount: number | null
          created_at: string
          days: number | null
          deduction_date: string
          deduction_name: string
          deduction_type_id: string
          description: string
          emi_group_id: string | null
          emi_index: number | null
          emi_total: number | null
          entry_mode: string
          id: string
          include_in_total_days: boolean
          installments: number
          max_duty: number
          min_duty: number
          per_day_amount: number | null
          qty: number | null
          source_kind: string
          source_ref: string
          status: string
          updated_at: string
        }
        Insert: {
          affects_days_for?: string[]
          amount: number
          calculation_type: string
          candidate_id: string
          computed_amount?: number | null
          created_at?: string
          days?: number | null
          deduction_date: string
          deduction_name: string
          deduction_type_id: string
          description?: string
          emi_group_id?: string | null
          emi_index?: number | null
          emi_total?: number | null
          entry_mode?: string
          id?: string
          include_in_total_days?: boolean
          installments?: number
          max_duty?: number
          min_duty?: number
          per_day_amount?: number | null
          qty?: number | null
          source_kind?: string
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Update: {
          affects_days_for?: string[]
          amount?: number
          calculation_type?: string
          candidate_id?: string
          computed_amount?: number | null
          created_at?: string
          days?: number | null
          deduction_date?: string
          deduction_name?: string
          deduction_type_id?: string
          description?: string
          emi_group_id?: string | null
          emi_index?: number | null
          emi_total?: number | null
          entry_mode?: string
          id?: string
          include_in_total_days?: boolean
          installments?: number
          max_duty?: number
          min_duty?: number
          per_day_amount?: number | null
          qty?: number | null
          source_kind?: string
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deductions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deductions_deduction_type_id_fkey"
            columns: ["deduction_type_id"]
            isOneToOne: false
            referencedRelation: "deduction_types"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      designations: {
        Row: {
          billable: boolean
          code: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          billable?: boolean
          code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          billable?: boolean
          code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      device_push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      digilocker_sessions: {
        Row: {
          client_id: string
          created_at: string
          profile: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          profile?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          profile?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      duties: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          hours: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          hours?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          hours?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_scope_assignments: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          scope_id: string
          scope_label: string
          scope_type: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          scope_id: string
          scope_label?: string
          scope_type: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          scope_id?: string
          scope_label?: string
          scope_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_signed_documents: {
        Row: {
          candidate_id: string
          company_signature_data: string
          created_at: string
          doc_type: string
          employee_signature_data: string
          id: string
          rendered_body: string
          signed_at: string | null
          template_id: string
          updated_at: string
          version: number
        }
        Insert: {
          candidate_id: string
          company_signature_data?: string
          created_at?: string
          doc_type: string
          employee_signature_data?: string
          id?: string
          rendered_body?: string
          signed_at?: string | null
          template_id: string
          updated_at?: string
          version: number
        }
        Update: {
          candidate_id?: string
          company_signature_data?: string
          created_at?: string
          doc_type?: string
          employee_signature_data?: string
          id?: string
          rendered_body?: string
          signed_at?: string | null
          template_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      employee_wages: {
        Row: {
          benefits: Json
          candidate_id: string
          components: Json
          created_at: string
          deductions: Json
          department_id: string | null
          designation_id: string | null
          employer_contributions: Json
          gross: number
          id: string
          payroll_day_base_id: string | null
          shift_hours: number
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          benefits?: Json
          candidate_id: string
          components?: Json
          created_at?: string
          deductions?: Json
          department_id?: string | null
          designation_id?: string | null
          employer_contributions?: Json
          gross?: number
          id?: string
          payroll_day_base_id?: string | null
          shift_hours?: number
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          benefits?: Json
          candidate_id?: string
          components?: Json
          created_at?: string
          deductions?: Json
          department_id?: string | null
          designation_id?: string | null
          employer_contributions?: Json
          gross?: number
          id?: string
          payroll_day_base_id?: string | null
          shift_hours?: number
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_wages_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_wages_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_wages_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_wages_payroll_day_base_id_fkey"
            columns: ["payroll_day_base_id"]
            isOneToOne: false
            referencedRelation: "payroll_day_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_wages_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_contributions: {
        Row: {
          amount: number
          candidate_id: string
          contribution_date: string
          contribution_name: string
          created_at: string
          frequency: string
          id: string
          notes: string
          payroll_run_id: string | null
          period_end: string | null
          period_start: string | null
          source_kind: string
          source_ref: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          candidate_id: string
          contribution_date?: string
          contribution_name: string
          created_at?: string
          frequency?: string
          id?: string
          notes?: string
          payroll_run_id?: string | null
          period_end?: string | null
          period_start?: string | null
          source_kind?: string
          source_ref?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          candidate_id?: string
          contribution_date?: string
          contribution_name?: string
          created_at?: string
          frequency?: string
          id?: string
          notes?: string
          payroll_run_id?: string | null
          period_end?: string | null
          period_start?: string | null
          source_kind?: string
          source_ref?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_contributions_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      esic_branches: {
        Row: {
          created_at: string
          enabled: boolean
          esic_code: string
          id: string
          location: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          esic_code: string
          id?: string
          location: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          esic_code?: string
          id?: string
          location?: string
          updated_at?: string
        }
        Relationships: []
      }
      ex_services: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      field_track_points: {
        Row: {
          accuracy: number | null
          candidate_id: string
          created_at: string
          id: string
          lat: number
          lng: number
          recorded_at: string
          track_date: string
          visit_id: string | null
        }
        Insert: {
          accuracy?: number | null
          candidate_id: string
          created_at?: string
          id?: string
          lat: number
          lng: number
          recorded_at?: string
          track_date?: string
          visit_id?: string | null
        }
        Update: {
          accuracy?: number | null
          candidate_id?: string
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          track_date?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_track_points_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_track_points_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "field_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      field_visit_requests: {
        Row: {
          acknowledged_at: string | null
          candidate_id: string
          completed_at: string | null
          created_at: string
          id: string
          priority: string
          reason: string
          requested_by: string | null
          status: string
          unit_id: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          priority?: string
          reason?: string
          requested_by?: string | null
          status?: string
          unit_id: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          priority?: string
          reason?: string
          requested_by?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_visit_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visit_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visit_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "field_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      field_visits: {
        Row: {
          candidate_id: string
          check_in_accuracy: number | null
          check_in_at: string
          check_in_lat: number | null
          check_in_lng: number | null
          check_out_at: string | null
          check_out_lat: number | null
          check_out_lng: number | null
          client_name: string | null
          client_photo_url: string | null
          client_signature_url: string | null
          created_at: string
          customer_rating: number | null
          distance_from_prev_m: number | null
          id: string
          unit_id: string
          updated_at: string
          visit_date: string
          visit_notes: string | null
          visit_seq: number
        }
        Insert: {
          candidate_id: string
          check_in_accuracy?: number | null
          check_in_at?: string
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_at?: string | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          client_name?: string | null
          client_photo_url?: string | null
          client_signature_url?: string | null
          created_at?: string
          customer_rating?: number | null
          distance_from_prev_m?: number | null
          id?: string
          unit_id: string
          updated_at?: string
          visit_date?: string
          visit_notes?: string | null
          visit_seq?: number
        }
        Update: {
          candidate_id?: string
          check_in_accuracy?: number | null
          check_in_at?: string
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_at?: string | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          client_name?: string | null
          client_photo_url?: string | null
          client_signature_url?: string | null
          created_at?: string
          customer_rating?: number | null
          distance_from_prev_m?: number | null
          id?: string
          unit_id?: string
          updated_at?: string
          visit_date?: string
          visit_notes?: string | null
          visit_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "field_visits_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visits_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      indian_states: {
        Row: {
          code: string
          created_at: string
          enabled: boolean
          id: string
          kind: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      inv_adjustment_lines: {
        Row: {
          adjustment_id: string
          created_at: string
          id: string
          item_id: string
          notes: string
          qty_change: number
          size_value: string
        }
        Insert: {
          adjustment_id: string
          created_at?: string
          id?: string
          item_id: string
          notes?: string
          qty_change?: number
          size_value?: string
        }
        Update: {
          adjustment_id?: string
          created_at?: string
          id?: string
          item_id?: string
          notes?: string
          qty_change?: number
          size_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_adjustment_lines_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "inv_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_adjustment_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_adjustments: {
        Row: {
          adjustment_date: string
          adjustment_number: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          location_type: string
          notes: string
          reason: string
          status: string
          updated_at: string
        }
        Insert: {
          adjustment_date?: string
          adjustment_number: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          location_type: string
          notes?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Update: {
          adjustment_date?: string
          adjustment_number?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          location_type?: string
          notes?: string
          reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inv_caps: {
        Row: {
          created_at: string
          id: string
          max_value: number
          min_value: number
          scope_id: string | null
          scope_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_value?: number
          min_value?: number
          scope_id?: string | null
          scope_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_value?: number
          min_value?: number
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      inv_demand_lines: {
        Row: {
          created_at: string
          demand_id: string
          fulfilled_qty: number
          id: string
          item_id: string
          requested_qty: number
          size_value: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          demand_id: string
          fulfilled_qty?: number
          id?: string
          item_id: string
          requested_qty?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          demand_id?: string
          fulfilled_qty?: number
          id?: string
          item_id?: string
          requested_qty?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_demand_lines_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "inv_demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_demand_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_demands: {
        Row: {
          branch_id: string | null
          cancelled_at: string | null
          created_at: string
          demand_date: string
          demand_number: string
          fulfilled_at: string | null
          fulfillment_source: string
          id: string
          notes: string
          requester_candidate_id: string | null
          requester_id: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          branch_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          demand_date?: string
          demand_number: string
          fulfilled_at?: string | null
          fulfillment_source?: string
          id?: string
          notes?: string
          requester_candidate_id?: string | null
          requester_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          branch_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          demand_date?: string
          demand_number?: string
          fulfilled_at?: string | null
          fulfillment_source?: string
          id?: string
          notes?: string
          requester_candidate_id?: string | null
          requester_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inv_demands_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_demands_requester_candidate_id_fkey"
            columns: ["requester_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_demands_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "inv_warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_goods_receipt_lines: {
        Row: {
          accepted_qty: number
          created_at: string
          grn_id: string
          id: string
          item_id: string
          ordered_qty: number
          po_line_id: string | null
          received_qty: number
          rejected_qty: number
          rejection_reason: string
          size_value: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          accepted_qty?: number
          created_at?: string
          grn_id: string
          id?: string
          item_id: string
          ordered_qty?: number
          po_line_id?: string | null
          received_qty?: number
          rejected_qty?: number
          rejection_reason?: string
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          accepted_qty?: number
          created_at?: string
          grn_id?: string
          id?: string
          item_id?: string
          ordered_qty?: number
          po_line_id?: string | null
          received_qty?: number
          rejected_qty?: number
          rejection_reason?: string
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_goods_receipt_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "inv_goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipt_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "inv_po_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_goods_receipts: {
        Row: {
          attachments: Json
          branch_id: string | null
          created_at: string
          demand_id: string | null
          grn_number: string
          id: string
          kind: string
          notes: string
          po_id: string | null
          receipt_date: string
          received_at: string | null
          received_by: string | null
          status: string
          transfer_id: string | null
          updated_at: string
          vehicle_number: string
          vendor_challan_number: string
          vendor_id: string | null
          vendor_invoice_number: string
          vendor_invoice_url: string | null
          warehouse_id: string | null
        }
        Insert: {
          attachments?: Json
          branch_id?: string | null
          created_at?: string
          demand_id?: string | null
          grn_number: string
          id?: string
          kind?: string
          notes?: string
          po_id?: string | null
          receipt_date?: string
          received_at?: string | null
          received_by?: string | null
          status?: string
          transfer_id?: string | null
          updated_at?: string
          vehicle_number?: string
          vendor_challan_number?: string
          vendor_id?: string | null
          vendor_invoice_number?: string
          vendor_invoice_url?: string | null
          warehouse_id?: string | null
        }
        Update: {
          attachments?: Json
          branch_id?: string | null
          created_at?: string
          demand_id?: string | null
          grn_number?: string
          id?: string
          kind?: string
          notes?: string
          po_id?: string | null
          receipt_date?: string
          received_at?: string | null
          received_by?: string | null
          status?: string
          transfer_id?: string | null
          updated_at?: string
          vehicle_number?: string
          vendor_challan_number?: string
          vendor_id?: string | null
          vendor_invoice_number?: string
          vendor_invoice_url?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inv_goods_receipts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipts_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "inv_demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "inv_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipts_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inv_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "inv_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_goods_receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "inv_warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_issuance_lines: {
        Row: {
          condition: string
          created_at: string
          id: string
          issuance_id: string
          item_id: string
          notes: string
          qty: number
          size_value: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          condition?: string
          created_at?: string
          id?: string
          issuance_id: string
          item_id: string
          notes?: string
          qty?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          condition?: string
          created_at?: string
          id?: string
          issuance_id?: string
          item_id?: string
          notes?: string
          qty?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_issuance_lines_issuance_id_fkey"
            columns: ["issuance_id"]
            isOneToOne: false
            referencedRelation: "inv_issuances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_issuance_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_issuances: {
        Row: {
          ack_method: string
          ack_otp_verified: boolean
          ack_photo_url: string
          ack_signature_url: string
          acknowledged_at: string | null
          collected_at: string | null
          collected_by: string | null
          created_at: string
          demand_id: string | null
          destination_id: string
          destination_type: string
          id: string
          issuance_date: string
          issuance_number: string
          issuance_type: string
          issued_at: string | null
          issued_by: string | null
          notes: string
          otp_code: string | null
          received_at: string | null
          received_by: string | null
          source_id: string
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          ack_method?: string
          ack_otp_verified?: boolean
          ack_photo_url?: string
          ack_signature_url?: string
          acknowledged_at?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          demand_id?: string | null
          destination_id: string
          destination_type: string
          id?: string
          issuance_date?: string
          issuance_number: string
          issuance_type: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string
          otp_code?: string | null
          received_at?: string | null
          received_by?: string | null
          source_id: string
          source_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          ack_method?: string
          ack_otp_verified?: boolean
          ack_photo_url?: string
          ack_signature_url?: string
          acknowledged_at?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          demand_id?: string | null
          destination_id?: string
          destination_type?: string
          id?: string
          issuance_date?: string
          issuance_number?: string
          issuance_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string
          otp_code?: string | null
          received_at?: string | null
          received_by?: string | null
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_issuances_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "inv_demands"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_item_categories: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      inv_item_sizes: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          item_id: string
          reorder_level: number
          size_value: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          item_id: string
          reorder_level?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          item_id?: string
          reorder_level?: number
          size_value?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_item_sizes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_items: {
        Row: {
          category_id: string | null
          created_at: string
          default_reorder_level: number
          description: string
          enabled: boolean
          hsn_code: string
          id: string
          image_url: string
          is_serialized: boolean
          is_sized: boolean
          item_code: string
          last_purchase_at: string | null
          last_purchase_price: number | null
          last_purchase_vendor_id: string | null
          name: string
          size_chart_id: string | null
          standard_cost: number
          standard_issue_price: number
          unit: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          default_reorder_level?: number
          description?: string
          enabled?: boolean
          hsn_code?: string
          id?: string
          image_url?: string
          is_serialized?: boolean
          is_sized?: boolean
          item_code: string
          last_purchase_at?: string | null
          last_purchase_price?: number | null
          last_purchase_vendor_id?: string | null
          name: string
          size_chart_id?: string | null
          standard_cost?: number
          standard_issue_price?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          default_reorder_level?: number
          description?: string
          enabled?: boolean
          hsn_code?: string
          id?: string
          image_url?: string
          is_serialized?: boolean
          is_sized?: boolean
          item_code?: string
          last_purchase_at?: string | null
          last_purchase_price?: number | null
          last_purchase_vendor_id?: string | null
          name?: string
          size_chart_id?: string | null
          standard_cost?: number
          standard_issue_price?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "inv_item_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_items_size_chart_id_fkey"
            columns: ["size_chart_id"]
            isOneToOne: false
            referencedRelation: "inv_size_charts"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_po_lines: {
        Row: {
          accepted_qty: number
          created_at: string
          id: string
          item_id: string
          line_total: number
          notes: string
          ordered_qty: number
          po_id: string
          received_qty: number
          size_value: string
          sort_order: number
          tax_percent: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          accepted_qty?: number
          created_at?: string
          id?: string
          item_id: string
          line_total?: number
          notes?: string
          ordered_qty?: number
          po_id: string
          received_qty?: number
          size_value?: string
          sort_order?: number
          tax_percent?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          accepted_qty?: number
          created_at?: string
          id?: string
          item_id?: string
          line_total?: number
          notes?: string
          ordered_qty?: number
          po_id?: string
          received_qty?: number
          size_value?: string
          sort_order?: number
          tax_percent?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_po_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "inv_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_purchase_orders: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          destination_branch_id: string | null
          destination_warehouse_id: string | null
          expected_date: string | null
          grand_total: number
          id: string
          notes: string
          po_date: string
          po_number: string
          po_type: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string
          requesting_branch_id: string | null
          requires_approval: boolean
          source_warehouse_id: string | null
          status: string
          subtotal: number
          tax_total: number
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          destination_branch_id?: string | null
          destination_warehouse_id?: string | null
          expected_date?: string | null
          grand_total?: number
          id?: string
          notes?: string
          po_date?: string
          po_number: string
          po_type?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string
          requesting_branch_id?: string | null
          requires_approval?: boolean
          source_warehouse_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          destination_branch_id?: string | null
          destination_warehouse_id?: string | null
          expected_date?: string | null
          grand_total?: number
          id?: string
          notes?: string
          po_date?: string
          po_number?: string
          po_type?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string
          requesting_branch_id?: string | null
          requires_approval?: boolean
          source_warehouse_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inv_purchase_orders_destination_branch_id_fkey"
            columns: ["destination_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_purchase_orders_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "inv_warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_purchase_orders_requesting_branch_id_fkey"
            columns: ["requesting_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_purchase_orders_source_warehouse_id_fkey"
            columns: ["source_warehouse_id"]
            isOneToOne: false
            referencedRelation: "inv_warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "inv_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_settings: {
        Row: {
          description: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          description?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      inv_size_charts: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          size_type: string
          updated_at: string
          values: Json
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          size_type?: string
          updated_at?: string
          values?: Json
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          size_type?: string
          updated_at?: string
          values?: Json
        }
        Relationships: []
      }
      inv_stock_balances: {
        Row: {
          id: string
          item_id: string
          location_id: string
          location_type: string
          qty: number
          size_value: string
          updated_at: string
        }
        Insert: {
          id?: string
          item_id: string
          location_id: string
          location_type: string
          qty?: number
          size_value?: string
          updated_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          location_id?: string
          location_type?: string
          qty?: number
          size_value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_stock_balances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          location_id: string
          location_type: string
          movement_date: string
          movement_type: string
          notes: string
          qty_change: number
          reference_id: string | null
          reference_type: string
          size_value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          location_id: string
          location_type: string
          movement_date?: string
          movement_type: string
          notes?: string
          qty_change: number
          reference_id?: string | null
          reference_type?: string
          size_value?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          location_id?: string
          location_type?: string
          movement_date?: string
          movement_type?: string
          notes?: string
          qty_change?: number
          reference_id?: string | null
          reference_type?: string
          size_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_transfer_lines: {
        Row: {
          created_at: string
          dispatched_qty: number
          id: string
          item_id: string
          received_qty: number
          size_value: string
          sort_order: number
          transfer_id: string
          updated_at: string
          variance_reason: string
        }
        Insert: {
          created_at?: string
          dispatched_qty?: number
          id?: string
          item_id: string
          received_qty?: number
          size_value?: string
          sort_order?: number
          transfer_id: string
          updated_at?: string
          variance_reason?: string
        }
        Update: {
          created_at?: string
          dispatched_qty?: number
          id?: string
          item_id?: string
          received_qty?: number
          size_value?: string
          sort_order?: number
          transfer_id?: string
          updated_at?: string
          variance_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_transfer_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inv_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_transfers: {
        Row: {
          acknowledgement: Json
          created_at: string
          demand_id: string | null
          destination_id: string
          destination_type: string
          dispatched_at: string | null
          dispatched_by: string | null
          driver_name: string
          driver_phone: string
          id: string
          linked_po_id: string | null
          notes: string
          received_at: string | null
          received_by: string | null
          source_id: string
          source_type: string
          status: string
          transfer_date: string
          transfer_number: string
          updated_at: string
          vehicle_number: string
        }
        Insert: {
          acknowledgement?: Json
          created_at?: string
          demand_id?: string | null
          destination_id: string
          destination_type: string
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_name?: string
          driver_phone?: string
          id?: string
          linked_po_id?: string | null
          notes?: string
          received_at?: string | null
          received_by?: string | null
          source_id: string
          source_type: string
          status?: string
          transfer_date?: string
          transfer_number: string
          updated_at?: string
          vehicle_number?: string
        }
        Update: {
          acknowledgement?: Json
          created_at?: string
          demand_id?: string | null
          destination_id?: string
          destination_type?: string
          dispatched_at?: string | null
          dispatched_by?: string | null
          driver_name?: string
          driver_phone?: string
          id?: string
          linked_po_id?: string | null
          notes?: string
          received_at?: string | null
          received_by?: string | null
          source_id?: string
          source_type?: string
          status?: string
          transfer_date?: string
          transfer_number?: string
          updated_at?: string
          vehicle_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_transfers_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "inv_demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_transfers_linked_po_id_fkey"
            columns: ["linked_po_id"]
            isOneToOne: false
            referencedRelation: "inv_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_vendor_rate_cards: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          item_id: string
          lead_time_days: number
          min_order_qty: number
          notes: string
          size_value: string
          tax_percent: number
          unit_price: number
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          item_id: string
          lead_time_days?: number
          min_order_qty?: number
          notes?: string
          size_value?: string
          tax_percent?: number
          unit_price?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          item_id?: string
          lead_time_days?: number
          min_order_qty?: number
          notes?: string
          size_value?: string
          tax_percent?: number
          unit_price?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_vendor_rate_cards_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inv_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inv_vendor_rate_cards_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "inv_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inv_vendors: {
        Row: {
          address1: string
          address2: string
          bank_details: Json
          city: string
          contact_person: string
          country: string
          created_at: string
          email: string
          enabled: boolean
          gstin: string
          id: string
          name: string
          notes: string
          pan: string
          payment_terms: string
          phone: string
          pincode: string
          state: string
          updated_at: string
          vendor_code: string
        }
        Insert: {
          address1?: string
          address2?: string
          bank_details?: Json
          city?: string
          contact_person?: string
          country?: string
          created_at?: string
          email?: string
          enabled?: boolean
          gstin?: string
          id?: string
          name: string
          notes?: string
          pan?: string
          payment_terms?: string
          phone?: string
          pincode?: string
          state?: string
          updated_at?: string
          vendor_code: string
        }
        Update: {
          address1?: string
          address2?: string
          bank_details?: Json
          city?: string
          contact_person?: string
          country?: string
          created_at?: string
          email?: string
          enabled?: boolean
          gstin?: string
          id?: string
          name?: string
          notes?: string
          pan?: string
          payment_terms?: string
          phone?: string
          pincode?: string
          state?: string
          updated_at?: string
          vendor_code?: string
        }
        Relationships: []
      }
      inv_warehouses: {
        Row: {
          address1: string
          address2: string
          city: string
          country: string
          created_at: string
          enabled: boolean
          id: string
          in_charge_candidate_id: string | null
          is_default: boolean
          name: string
          notes: string
          phone: string
          pincode: string
          state: string
          updated_at: string
          warehouse_code: string
        }
        Insert: {
          address1?: string
          address2?: string
          city?: string
          country?: string
          created_at?: string
          enabled?: boolean
          id?: string
          in_charge_candidate_id?: string | null
          is_default?: boolean
          name: string
          notes?: string
          phone?: string
          pincode?: string
          state?: string
          updated_at?: string
          warehouse_code: string
        }
        Update: {
          address1?: string
          address2?: string
          city?: string
          country?: string
          created_at?: string
          enabled?: boolean
          id?: string
          in_charge_candidate_id?: string | null
          is_default?: boolean
          name?: string
          notes?: string
          phone?: string
          pincode?: string
          state?: string
          updated_at?: string
          warehouse_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "inv_warehouses_in_charge_candidate_id_fkey"
            columns: ["in_charge_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      labour_welfare_funds: {
        Row: {
          created_at: string
          deduction_months: number[]
          employee_contribution: number
          employer_contribution: number
          enabled: boolean
          frequency: string
          id: string
          notes: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deduction_months?: number[]
          employee_contribution?: number
          employer_contribution?: number
          enabled?: boolean
          frequency?: string
          id?: string
          notes?: string
          state: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deduction_months?: number[]
          employee_contribution?: number
          employer_contribution?: number
          enabled?: boolean
          frequency?: string
          id?: string
          notes?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      languages: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          link: string
          message: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          link?: string
          message?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          link?: string
          message?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      offboarding_reasons: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      org_settings: {
        Row: {
          bank_account_no: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          cin: string | null
          company_gstin: string | null
          company_name: string | null
          company_state: string | null
          company_state_code: string | null
          corporate_address: string | null
          created_at: string
          default_hsn_sac: string | null
          email: string | null
          esic_number: string | null
          id: string
          invoice_declaration: string | null
          invoice_note: string | null
          msme_udyam_no: string | null
          pan: string | null
          pf_number: string | null
          phone: string | null
          registered_address: string | null
          singleton: boolean
          supplier_type: string | null
          updated_at: string
        }
        Insert: {
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          company_gstin?: string | null
          company_name?: string | null
          company_state?: string | null
          company_state_code?: string | null
          corporate_address?: string | null
          created_at?: string
          default_hsn_sac?: string | null
          email?: string | null
          esic_number?: string | null
          id?: string
          invoice_declaration?: string | null
          invoice_note?: string | null
          msme_udyam_no?: string | null
          pan?: string | null
          pf_number?: string | null
          phone?: string | null
          registered_address?: string | null
          singleton?: boolean
          supplier_type?: string | null
          updated_at?: string
        }
        Update: {
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          company_gstin?: string | null
          company_name?: string | null
          company_state?: string | null
          company_state_code?: string | null
          corporate_address?: string | null
          created_at?: string
          default_hsn_sac?: string | null
          email?: string | null
          esic_number?: string | null
          id?: string
          invoice_declaration?: string | null
          invoice_note?: string | null
          msme_udyam_no?: string | null
          pan?: string | null
          pf_number?: string | null
          phone?: string | null
          registered_address?: string | null
          singleton?: boolean
          supplier_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payroll_day_bases: {
        Row: {
          code: string
          created_at: string
          description: string
          enabled: boolean
          fixed_days: number | null
          id: string
          included_weekdays: number[] | null
          is_default: boolean
          method: string
          name: string
          sort_order: number
          updated_at: string
          weekly_off_day: number | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string
          enabled?: boolean
          fixed_days?: number | null
          id?: string
          included_weekdays?: number[] | null
          is_default?: boolean
          method: string
          name: string
          sort_order?: number
          updated_at?: string
          weekly_off_day?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          enabled?: boolean
          fixed_days?: number | null
          id?: string
          included_weekdays?: number[] | null
          is_default?: boolean
          method?: string
          name?: string
          sort_order?: number
          updated_at?: string
          weekly_off_day?: number | null
        }
        Relationships: []
      }
      payroll_processing_holds: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string | null
          id: string
          payroll_run_id: string
          reason: string
          status: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          payroll_run_id: string
          reason?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          payroll_run_id?: string
          reason?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_processing_holds_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_snapshots: {
        Row: {
          additions: Json
          candidate_id: string
          created_at: string
          deductions: Json
          earnings: Json
          ed_days: number
          employee_code: string
          employer_contributions: Json
          full_name: string
          gross: number
          id: string
          net_pay: number
          on_hold: boolean
          paid_days: number
          payroll_run_id: string
          posted_at: string
          posted_by: string | null
          total_deductions: number
          total_employer: number
          unit_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          additions?: Json
          candidate_id: string
          created_at?: string
          deductions?: Json
          earnings?: Json
          ed_days?: number
          employee_code?: string
          employer_contributions?: Json
          full_name?: string
          gross?: number
          id?: string
          net_pay?: number
          on_hold?: boolean
          paid_days?: number
          payroll_run_id: string
          posted_at?: string
          posted_by?: string | null
          total_deductions?: number
          total_employer?: number
          unit_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          additions?: Json
          candidate_id?: string
          created_at?: string
          deductions?: Json
          earnings?: Json
          ed_days?: number
          employee_code?: string
          employer_contributions?: Json
          full_name?: string
          gross?: number
          id?: string
          net_pay?: number
          on_hold?: boolean
          paid_days?: number
          payroll_run_id?: string
          posted_at?: string
          posted_by?: string | null
          total_deductions?: number
          total_employer?: number
          unit_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_snapshots_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          invoice_processed_at: string | null
          invoice_processed_by: string | null
          invoice_status: string
          payroll_processed_at: string | null
          payroll_processed_by: string | null
          payroll_status: string
          period_end: string
          period_start: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          unit_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_processed_at?: string | null
          invoice_processed_by?: string | null
          invoice_status?: string
          payroll_processed_at?: string | null
          payroll_processed_by?: string | null
          payroll_status?: string
          period_end: string
          period_start: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          unit_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_processed_at?: string | null
          invoice_processed_by?: string | null
          invoice_status?: string
          payroll_processed_at?: string | null
          payroll_processed_by?: string | null
          payroll_status?: string
          period_end?: string
          period_start?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_windows: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          label: string
          processing_day: number
          updated_at: string
          window_end_day: number
          window_start_day: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          processing_day: number
          updated_at?: string
          window_end_day: number
          window_start_day: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          processing_day?: number
          updated_at?: string
          window_end_day?: number
          window_start_day?: number
        }
        Relationships: []
      }
      pincode_ranges: {
        Row: {
          created_at: string
          id: string
          is_excluded: boolean
          notes: string
          range_end: number
          range_start: number
          region_label: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_excluded?: boolean
          notes?: string
          range_end: number
          range_start: number
          region_label?: string
          state: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_excluded?: boolean
          notes?: string
          range_end?: number
          range_start?: number
          region_label?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      policies: {
        Row: {
          additional_cover: number | null
          created_at: string
          description: string
          document_name: string | null
          document_path: string | null
          enabled: boolean
          end_date: string | null
          id: string
          name: string
          policy_number: string
          provider: string
          start_date: string | null
          sum_assured: number | null
          ttd_enabled: boolean
          updated_at: string
        }
        Insert: {
          additional_cover?: number | null
          created_at?: string
          description?: string
          document_name?: string | null
          document_path?: string | null
          enabled?: boolean
          end_date?: string | null
          id?: string
          name: string
          policy_number?: string
          provider?: string
          start_date?: string | null
          sum_assured?: number | null
          ttd_enabled?: boolean
          updated_at?: string
        }
        Update: {
          additional_cover?: number | null
          created_at?: string
          description?: string
          document_name?: string | null
          document_path?: string | null
          enabled?: boolean
          end_date?: string | null
          id?: string
          name?: string
          policy_number?: string
          provider?: string
          start_date?: string | null
          sum_assured?: number | null
          ttd_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      professional_tax_slabs: {
        Row: {
          created_at: string
          gender: string
          id: string
          period: string
          pincode_coverage: string
          region_label: string
          salary_max: number | null
          salary_min: number
          state: string
          tax_per_month: number
          updated_at: string
          working_days: string
        }
        Insert: {
          created_at?: string
          gender?: string
          id?: string
          period?: string
          pincode_coverage?: string
          region_label?: string
          salary_max?: number | null
          salary_min?: number
          state: string
          tax_per_month?: number
          updated_at?: string
          working_days?: string
        }
        Update: {
          created_at?: string
          gender?: string
          id?: string
          period?: string
          pincode_coverage?: string
          region_label?: string
          salary_max?: number | null
          salary_min?: number
          state?: string
          tax_per_month?: number
          updated_at?: string
          working_days?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address1: string | null
          address2: string | null
          carpet_area_sqft: number | null
          city: string | null
          configuration: string | null
          created_at: string
          current_value: number | null
          enabled: boolean
          house_number: string
          id: string
          name: string | null
          notes: string | null
          owner: string | null
          pincode: string | null
          property_tax_id: string | null
          purchase_date: string | null
          purchase_value: number | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          carpet_area_sqft?: number | null
          city?: string | null
          configuration?: string | null
          created_at?: string
          current_value?: number | null
          enabled?: boolean
          house_number: string
          id?: string
          name?: string | null
          notes?: string | null
          owner?: string | null
          pincode?: string | null
          property_tax_id?: string | null
          purchase_date?: string | null
          purchase_value?: number | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address1?: string | null
          address2?: string | null
          carpet_area_sqft?: number | null
          city?: string | null
          configuration?: string | null
          created_at?: string
          current_value?: number | null
          enabled?: boolean
          house_number?: string
          id?: string
          name?: string | null
          notes?: string | null
          owner?: string | null
          pincode?: string | null
          property_tax_id?: string | null
          purchase_date?: string | null
          purchase_value?: number | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      property_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          enabled: boolean
          expense_date: string
          id: string
          notes: string | null
          payment_mode: string | null
          property_id: string
          receipt_url: string | null
          updated_at: string
          vendor_name: string | null
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          enabled?: boolean
          expense_date: string
          id?: string
          notes?: string | null
          payment_mode?: string | null
          property_id: string
          receipt_url?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          enabled?: boolean
          expense_date?: string
          id?: string
          notes?: string | null
          payment_mode?: string | null
          property_id?: string
          receipt_url?: string | null
          updated_at?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_expenses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_loans: {
        Row: {
          created_at: string
          emi_amount: number | null
          enabled: boolean
          end_date: string | null
          id: string
          interest_rate: number | null
          lender_name: string
          loan_account_number: string | null
          notes: string | null
          outstanding_amount: number | null
          property_id: string
          sanctioned_amount: number | null
          start_date: string | null
          status: string
          tenure_months: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          emi_amount?: number | null
          enabled?: boolean
          end_date?: string | null
          id?: string
          interest_rate?: number | null
          lender_name: string
          loan_account_number?: string | null
          notes?: string | null
          outstanding_amount?: number | null
          property_id: string
          sanctioned_amount?: number | null
          start_date?: string | null
          status?: string
          tenure_months?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          emi_amount?: number | null
          enabled?: boolean
          end_date?: string | null
          id?: string
          interest_rate?: number | null
          lender_name?: string
          loan_account_number?: string | null
          notes?: string | null
          outstanding_amount?: number | null
          property_id?: string
          sanctioned_amount?: number | null
          start_date?: string | null
          status?: string
          tenure_months?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_loans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          enabled: boolean
          holiday_day: number
          holiday_month: number
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          holiday_day: number
          holiday_month: number
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          holiday_day?: number
          holiday_month?: number
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      rehire_request_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          actor_role_key: string
          created_at: string
          id: string
          notes: string
          request_id: string
          step_name: string
          step_order: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          actor_role_key?: string
          created_at?: string
          id?: string
          notes?: string
          request_id: string
          step_name?: string
          step_order?: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          actor_role_key?: string
          created_at?: string
          id?: string
          notes?: string
          request_id?: string
          step_name?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "rehire_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "rehire_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      rehire_requests: {
        Row: {
          aadhaar_number: string
          completed_at: string | null
          created_at: string
          current_step_order: number
          designation_id: string | null
          full_name: string
          id: string
          id_card_url: string
          mobile: string
          new_candidate_id: string | null
          new_employee_code: string
          notes: string
          previous_candidate_id: string | null
          rejection_reason: string
          request_number: string | null
          requested_by: string | null
          requested_by_candidate_id: string | null
          resignation_url: string
          role_key: string
          status: string
          unit_id: string | null
          updated_at: string
          workflow_key: string
        }
        Insert: {
          aadhaar_number: string
          completed_at?: string | null
          created_at?: string
          current_step_order?: number
          designation_id?: string | null
          full_name?: string
          id?: string
          id_card_url?: string
          mobile?: string
          new_candidate_id?: string | null
          new_employee_code?: string
          notes?: string
          previous_candidate_id?: string | null
          rejection_reason?: string
          request_number?: string | null
          requested_by?: string | null
          requested_by_candidate_id?: string | null
          resignation_url?: string
          role_key?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
          workflow_key?: string
        }
        Update: {
          aadhaar_number?: string
          completed_at?: string | null
          created_at?: string
          current_step_order?: number
          designation_id?: string | null
          full_name?: string
          id?: string
          id_card_url?: string
          mobile?: string
          new_candidate_id?: string | null
          new_employee_code?: string
          notes?: string
          previous_candidate_id?: string | null
          rejection_reason?: string
          request_number?: string | null
          requested_by?: string | null
          requested_by_candidate_id?: string | null
          resignation_url?: string
          role_key?: string
          status?: string
          unit_id?: string | null
          updated_at?: string
          workflow_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "rehire_requests_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rehire_requests_new_candidate_id_fkey"
            columns: ["new_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rehire_requests_previous_candidate_id_fkey"
            columns: ["previous_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rehire_requests_requested_by_candidate_id_fkey"
            columns: ["requested_by_candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rehire_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_approve: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          module_key: string
          role_key: string
          sub_module_key: string
          updated_at: string
        }
        Insert: {
          can_approve?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module_key: string
          role_key: string
          sub_module_key?: string
          updated_at?: string
        }
        Update: {
          can_approve?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module_key?: string
          role_key?: string
          sub_module_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string
          is_system: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          is_system?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          is_system?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      self_attendance_punches: {
        Row: {
          battery_charging: boolean | null
          battery_pct: number | null
          candidate_id: string
          check_in_accuracy: number | null
          check_in_at: string | null
          check_in_face_verified: boolean
          check_in_lat: number | null
          check_in_lng: number | null
          check_out_accuracy: number | null
          check_out_at: string | null
          check_out_face_verified: boolean
          check_out_lat: number | null
          check_out_lng: number | null
          created_at: string
          distance_km: number | null
          id: string
          last_accuracy: number | null
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string | null
          network_type: string | null
          notes: string | null
          punch_date: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          battery_charging?: boolean | null
          battery_pct?: number | null
          candidate_id: string
          check_in_accuracy?: number | null
          check_in_at?: string | null
          check_in_face_verified?: boolean
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_accuracy?: number | null
          check_out_at?: string | null
          check_out_face_verified?: boolean
          check_out_lat?: number | null
          check_out_lng?: number | null
          created_at?: string
          distance_km?: number | null
          id?: string
          last_accuracy?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          network_type?: string | null
          notes?: string | null
          punch_date: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          battery_charging?: boolean | null
          battery_pct?: number | null
          candidate_id?: string
          check_in_accuracy?: number | null
          check_in_at?: string | null
          check_in_face_verified?: boolean
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_accuracy?: number | null
          check_out_at?: string | null
          check_out_face_verified?: boolean
          check_out_lat?: number | null
          check_out_lng?: number | null
          created_at?: string
          distance_km?: number | null
          id?: string
          last_accuracy?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string | null
          network_type?: string | null
          notes?: string | null
          punch_date?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "self_attendance_punches_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_attendance_punches_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      states: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          action: string
          created_at: string
          details: Json
          entity_id: string
          entity_label: string
          entity_type: string
          error_message: string
          id: string
          ip_address: string
          module: string
          status: string
          user_agent: string
          user_id: string | null
          user_phone: string
          user_role: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          entity_id?: string
          entity_label?: string
          entity_type?: string
          error_message?: string
          id?: string
          ip_address?: string
          module: string
          status?: string
          user_agent?: string
          user_id?: string | null
          user_phone?: string
          user_role?: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          entity_id?: string
          entity_label?: string
          entity_type?: string
          error_message?: string
          id?: string
          ip_address?: string
          module?: string
          status?: string
          user_agent?: string
          user_id?: string | null
          user_phone?: string
          user_role?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          ambulance_mobile: string
          ambulance_name: string
          billing_address1: string
          billing_address2: string
          billing_city: string
          billing_country: string
          billing_district: string
          billing_name: string
          billing_pincode: string
          billing_salutation: string
          billing_state: string
          bonus_enabled: boolean
          bonus_frequency: string | null
          branch_id: string | null
          closing_date: string | null
          code: string
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          customer_id: string | null
          description: string
          emergency_contact_mobile: string
          emergency_contact_name: string
          enable_lwf: boolean
          enable_pt: boolean
          epf_cap_enabled: boolean
          esic_branch_id: string | null
          gpaip_amount: number
          gpaip_enabled: boolean
          gst_number: string
          gst_payable: boolean
          gst_type: string | null
          id: string
          is_billable: boolean
          latitude: number | null
          location: string
          longitude: number | null
          name: string
          nearby_hospital_mobile: string
          nearby_hospital_name: string
          onboarding_date: string | null
          pan_number: string
          recruitment_fee_amount: number
          recruitment_fee_enabled: boolean
          reporting_officers: Json
          security_service_mobile: string
          security_service_name: string
          shipping_address1: string
          shipping_address2: string
          shipping_city: string
          shipping_country: string
          shipping_district: string
          shipping_name: string
          shipping_pincode: string
          shipping_salutation: string
          shipping_same_as_billing: boolean
          shipping_same_as_org: boolean
          shipping_state: string
          status: Database["public"]["Enums"]["customer_status"]
          uniform_fee_amount: number
          uniform_included: boolean
          updated_at: string
        }
        Insert: {
          ambulance_mobile?: string
          ambulance_name?: string
          billing_address1?: string
          billing_address2?: string
          billing_city?: string
          billing_country?: string
          billing_district?: string
          billing_name?: string
          billing_pincode?: string
          billing_salutation?: string
          billing_state?: string
          bonus_enabled?: boolean
          bonus_frequency?: string | null
          branch_id?: string | null
          closing_date?: string | null
          code: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          customer_id?: string | null
          description?: string
          emergency_contact_mobile?: string
          emergency_contact_name?: string
          enable_lwf?: boolean
          enable_pt?: boolean
          epf_cap_enabled?: boolean
          esic_branch_id?: string | null
          gpaip_amount?: number
          gpaip_enabled?: boolean
          gst_number?: string
          gst_payable?: boolean
          gst_type?: string | null
          id?: string
          is_billable?: boolean
          latitude?: number | null
          location?: string
          longitude?: number | null
          name?: string
          nearby_hospital_mobile?: string
          nearby_hospital_name?: string
          onboarding_date?: string | null
          pan_number?: string
          recruitment_fee_amount?: number
          recruitment_fee_enabled?: boolean
          reporting_officers?: Json
          security_service_mobile?: string
          security_service_name?: string
          shipping_address1?: string
          shipping_address2?: string
          shipping_city?: string
          shipping_country?: string
          shipping_district?: string
          shipping_name?: string
          shipping_pincode?: string
          shipping_salutation?: string
          shipping_same_as_billing?: boolean
          shipping_same_as_org?: boolean
          shipping_state?: string
          status?: Database["public"]["Enums"]["customer_status"]
          uniform_fee_amount?: number
          uniform_included?: boolean
          updated_at?: string
        }
        Update: {
          ambulance_mobile?: string
          ambulance_name?: string
          billing_address1?: string
          billing_address2?: string
          billing_city?: string
          billing_country?: string
          billing_district?: string
          billing_name?: string
          billing_pincode?: string
          billing_salutation?: string
          billing_state?: string
          bonus_enabled?: boolean
          bonus_frequency?: string | null
          branch_id?: string | null
          closing_date?: string | null
          code?: string
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          customer_id?: string | null
          description?: string
          emergency_contact_mobile?: string
          emergency_contact_name?: string
          enable_lwf?: boolean
          enable_pt?: boolean
          epf_cap_enabled?: boolean
          esic_branch_id?: string | null
          gpaip_amount?: number
          gpaip_enabled?: boolean
          gst_number?: string
          gst_payable?: boolean
          gst_type?: string | null
          id?: string
          is_billable?: boolean
          latitude?: number | null
          location?: string
          longitude?: number | null
          name?: string
          nearby_hospital_mobile?: string
          nearby_hospital_name?: string
          onboarding_date?: string | null
          pan_number?: string
          recruitment_fee_amount?: number
          recruitment_fee_enabled?: boolean
          reporting_officers?: Json
          security_service_mobile?: string
          security_service_name?: string
          shipping_address1?: string
          shipping_address2?: string
          shipping_city?: string
          shipping_country?: string
          shipping_district?: string
          shipping_name?: string
          shipping_pincode?: string
          shipping_salutation?: string
          shipping_same_as_billing?: boolean
          shipping_same_as_org?: boolean
          shipping_state?: string
          status?: Database["public"]["Enums"]["customer_status"]
          uniform_fee_amount?: number
          uniform_included?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_esic_branch_id_fkey"
            columns: ["esic_branch_id"]
            isOneToOne: false
            referencedRelation: "esic_branches"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_fastags: {
        Row: {
          account_number: string
          balance: number
          bank_name: string
          created_at: string
          enabled: boolean
          expiry_date: string | null
          fastag_number: string
          id: string
          issued_date: string | null
          login_id: string
          login_password: string
          login_type: string
          notes: string
          registered_email: string
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          account_number?: string
          balance?: number
          bank_name?: string
          created_at?: string
          enabled?: boolean
          expiry_date?: string | null
          fastag_number?: string
          id?: string
          issued_date?: string | null
          login_id?: string
          login_password?: string
          login_type?: string
          notes?: string
          registered_email?: string
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          account_number?: string
          balance?: number
          bank_name?: string
          created_at?: string
          enabled?: boolean
          expiry_date?: string | null
          fastag_number?: string
          id?: string
          issued_date?: string | null
          login_id?: string
          login_password?: string
          login_type?: string
          notes?: string
          registered_email?: string
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_fastags_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_fuel_entries: {
        Row: {
          amount: number
          created_at: string
          description: string
          entry_date: string
          entry_time: string | null
          expense_type: string
          filling_photo_url: string
          fuel_type: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          location_text: string
          notes: string
          odometer_km: number
          odometer_photo_url: string
          payment_mode: string
          pump_photo_url: string
          quantity: number
          rate: number
          receipt_photo_url: string
          tags: string[]
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string
          entry_date?: string
          entry_time?: string | null
          expense_type?: string
          filling_photo_url?: string
          fuel_type?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          location_text?: string
          notes?: string
          odometer_km?: number
          odometer_photo_url?: string
          payment_mode?: string
          pump_photo_url?: string
          quantity?: number
          rate?: number
          receipt_photo_url?: string
          tags?: string[]
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          entry_date?: string
          entry_time?: string | null
          expense_type?: string
          filling_photo_url?: string
          fuel_type?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          location_text?: string
          notes?: string
          odometer_km?: number
          odometer_photo_url?: string
          payment_mode?: string
          pump_photo_url?: string
          quantity?: number
          rate?: number
          receipt_photo_url?: string
          tags?: string[]
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      vehicle_insurances: {
        Row: {
          chassis_number: string
          created_at: string
          enabled: boolean
          end_date: string | null
          engine_number: string
          id: string
          insurance_company: string
          notes: string
          policy_number: string
          premium_amount: number
          start_date: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          chassis_number?: string
          created_at?: string
          enabled?: boolean
          end_date?: string | null
          engine_number?: string
          id?: string
          insurance_company?: string
          notes?: string
          policy_number?: string
          premium_amount?: number
          start_date?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          chassis_number?: string
          created_at?: string
          enabled?: boolean
          end_date?: string | null
          engine_number?: string
          id?: string
          insurance_company?: string
          notes?: string
          policy_number?: string
          premium_amount?: number
          start_date?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_insurances_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_pucs: {
        Row: {
          created_at: string
          enabled: boolean
          expiry_date: string | null
          id: string
          issued_date: string | null
          issuing_authority: string
          notes: string
          puc_number: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          expiry_date?: string | null
          id?: string
          issued_date?: string | null
          issuing_authority?: string
          notes?: string
          puc_number?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          expiry_date?: string | null
          id?: string
          issued_date?: string | null
          issuing_authority?: string
          notes?: string
          puc_number?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_pucs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string
          chassis_number: string
          color: string
          created_at: string
          enabled: boolean
          engine_number: string
          fuel_type: string
          id: string
          make: string
          name: string
          notes: string
          owner: string
          registration_date: string | null
          service_interval_km: number
          type: string
          updated_at: string
          vehicle_id: string
          vehicle_number: string
          year: number | null
        }
        Insert: {
          brand?: string
          chassis_number?: string
          color?: string
          created_at?: string
          enabled?: boolean
          engine_number?: string
          fuel_type?: string
          id?: string
          make?: string
          name?: string
          notes?: string
          owner?: string
          registration_date?: string | null
          service_interval_km?: number
          type?: string
          updated_at?: string
          vehicle_id?: string
          vehicle_number: string
          year?: number | null
        }
        Update: {
          brand?: string
          chassis_number?: string
          color?: string
          created_at?: string
          enabled?: boolean
          engine_number?: string
          fuel_type?: string
          id?: string
          make?: string
          name?: string
          notes?: string
          owner?: string
          registration_date?: string | null
          service_interval_km?: number
          type?: string
          updated_at?: string
          vehicle_id?: string
          vehicle_number?: string
          year?: number | null
        }
        Relationships: []
      }
      workflow_definitions: {
        Row: {
          created_at: string
          description: string
          entity_type: string
          id: string
          is_active: boolean
          key: string
          name: string
          route_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          entity_type?: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          route_path?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          entity_type?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          route_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_steps: {
        Row: {
          action_label: string
          approver_role_key: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          key: string
          name: string
          step_order: number
          updated_at: string
          workflow_id: string
        }
        Insert: {
          action_label?: string
          approver_role_key: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          key: string
          name: string
          step_order: number
          updated_at?: string
          workflow_id: string
        }
        Update: {
          action_label?: string
          approver_role_key?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          step_order?: number
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_fpl_master_fill: {
        Args: { _id: string; p: Json }
        Returns: undefined
      }
      autofill_daily_attendance: { Args: never; Returns: undefined }
      can_phone_login: { Args: { _mobile: string }; Returns: boolean }
      candidate_branch_ids: {
        Args: { _candidate_id: string }
        Returns: string[]
      }
      current_user_assigned_guard_ids: { Args: never; Returns: string[] }
      current_user_branch_id: { Args: never; Returns: string }
      current_user_branch_scope_ids: { Args: never; Returns: string[] }
      current_user_can_action_rehire: {
        Args: { _request_id: string }
        Returns: boolean
      }
      current_user_can_approve_onboarding: { Args: never; Returns: boolean }
      current_user_can_edit_organizations: { Args: never; Returns: boolean }
      current_user_can_manage_attendance_unit: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      current_user_can_manage_guard_unit_mapping: {
        Args: { _candidate_id: string; _unit_id: string }
        Returns: boolean
      }
      current_user_can_manage_unit_scope_assignment: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      current_user_can_manage_unit_scope_assignments: {
        Args: never
        Returns: boolean
      }
      current_user_can_onboard_unit: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      current_user_can_submit_onboarding: { Args: never; Returns: boolean }
      current_user_can_view_self_attendance: {
        Args: { _candidate_id: string; _unit_id?: string }
        Returns: boolean
      }
      current_user_candidate_id: { Args: never; Returns: string }
      current_user_has_branch_scope: { Args: never; Returns: boolean }
      current_user_has_permission: {
        Args: {
          _action?: string
          _module_key: string
          _sub_module_key?: string
        }
        Returns: boolean
      }
      current_user_is_inventory_manager: { Args: never; Returns: boolean }
      current_user_is_people_ops: { Args: never; Returns: boolean }
      current_user_is_rehire_participant: { Args: never; Returns: boolean }
      current_user_mobile: { Args: never; Returns: string }
      current_user_owns_onboarding_candidate: {
        Args: { _candidate_id: string }
        Returns: boolean
      }
      current_user_role_key: { Args: never; Returns: string }
      current_user_unit_ids: { Args: never; Returns: string[] }
      ensure_annual_gpaip_deductions: { Args: never; Returns: number }
      find_rehire_candidate_by_aadhaar: {
        Args: { _aadhaar: string }
        Returns: {
          aadhaar_number: string
          candidate_code: string
          employee_code: string
          full_name: string
          id: string
          id_card_url: string
          mobile: string
          resignation_url: string
          status: string
          unit_id: string
        }[]
      }
      get_admin_user_ids: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      get_candidate_id_by_user_id: {
        Args: { _user_id: string }
        Returns: string
      }
      get_inventory_admin_user_ids: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      get_onboarding_approver_user_ids: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      get_recent_notification_push_tokens: {
        Args: { _user_ids: string[] }
        Returns: {
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }[]
      }
      get_user_display_name: {
        Args: { _user_id: string }
        Returns: {
          full_name: string
          mobile: string
          role_key: string
        }[]
      }
      get_user_id_by_candidate: {
        Args: { _candidate_id: string }
        Returns: string
      }
      get_user_id_by_candidate_id: {
        Args: { _candidate_id: string }
        Returns: string
      }
      get_user_ids_by_branch: {
        Args: { _branch_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_user_ids_by_role: {
        Args: { _role_key: string }
        Returns: {
          user_id: string
        }[]
      }
      get_user_ids_by_unit: {
        Args: { _unit_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_user_ids_with_approve: {
        Args: { _module: string }
        Returns: {
          user_id: string
        }[]
      }
      is_active_field_officer: {
        Args: { _candidate_id: string }
        Returns: boolean
      }
      is_admin_user: { Args: never; Returns: boolean }
      is_candidate_in_current_user_branch: {
        Args: { _candidate_id: string }
        Returns: boolean
      }
      is_current_employee_active: { Args: never; Returns: boolean }
      is_inv_location_in_current_user_scope: {
        Args: { _id: string; _type: string }
        Returns: boolean
      }
      is_unit_in_current_user_branch: {
        Args: { _unit_id: string }
        Returns: boolean
      }
      list_active_field_officers: {
        Args: never
        Returns: {
          employee_code: string
          full_name: string
          id: string
          mobile: string
          status: string
        }[]
      }
      nextval: { Args: { sequence_name: string }; Returns: number }
      register_device_push_token: {
        Args: { _platform?: string; _token: string }
        Returns: {
          saved: boolean
          token_count: number
          token_suffix: string
        }[]
      }
      rehire_current_step_role: {
        Args: { _request_id: string }
        Returns: string
      }
      resolve_candidate_issuance_field_officer: {
        Args: { _candidate_id: string; _reports_to: string; _unit_id: string }
        Returns: {
          fo_candidate_id: string
          fo_name: string
          fo_user_id: string
        }[]
      }
    }
    Enums: {
      customer_status: "active" | "inactive"
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
      customer_status: ["active", "inactive"],
    },
  },
} as const
