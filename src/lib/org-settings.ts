import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OrgSettings = {
  id: string;
  company_name: string | null;
  company_gstin: string | null;
  company_state: string | null;
  company_state_code: string | null;
  registered_address: string | null;
  corporate_address: string | null;
  cin: string | null;
  pan: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_branch: string | null;
  bank_ifsc: string | null;
  msme_udyam_no: string | null;
  supplier_type: string | null;
  pf_number: string | null;
  esic_number: string | null;
  default_hsn_sac: string | null;
  invoice_declaration: string | null;
  invoice_note: string | null;
};

export function useOrgSettings() {
  return useQuery({
    queryKey: ["org_settings"],
    staleTime: 60_000,
    queryFn: async (): Promise<OrgSettings | null> => {
      const { data, error } = await supabase
        .from("org_settings" as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as OrgSettings | null;
    },
  });
}
