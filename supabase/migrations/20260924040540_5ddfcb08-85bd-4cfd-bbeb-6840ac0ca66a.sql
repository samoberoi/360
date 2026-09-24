CREATE OR REPLACE FUNCTION public.contract_register_directory()
RETURNS TABLE(unit_id uuid, unit_code text, unit_name text, customer_id uuid, customer_name text, unit_state text, unit_city text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.code::text, u.name::text, u.customer_id, c.name::text, u.billing_state::text, u.billing_city::text
  FROM public.units u LEFT JOIN public.customers c ON c.id = u.customer_id
  WHERE auth.uid() IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.get_missing_contract_designations()
RETURNS TABLE(candidate_id uuid, full_name text, employee_code text, candidate_code text, unit_id uuid, unit_name text, unit_code text, customer_name text, designation_id uuid, designation_name text, contract_id uuid, missing_since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ca.id, ca.full_name::text, ca.employee_code::text, ca.candidate_code::text,
         u.id, u.name::text, u.code::text, cu2.name::text,
         d.id, d.name::text, cc.id, cu.created_at
  FROM public.candidate_units cu
  JOIN public.candidates ca ON ca.id = cu.candidate_id
  JOIN public.units u ON u.id = cu.unit_id
  LEFT JOIN public.customers cu2 ON cu2.id = u.customer_id
  JOIN public.designations d ON d.id = COALESCE(cu.designation_id, ca.designation_id)
  LEFT JOIN LATERAL (SELECT c.id FROM public.client_contracts c WHERE c.unit_id = u.id AND c.status='active' AND c.record_type='client' ORDER BY c.created_at DESC LIMIT 1) cc ON true
  WHERE auth.uid() IS NOT NULL
    AND COALESCE(cu.is_reliever,false) = false
    AND NOT EXISTS (SELECT 1 FROM public.contract_resources r WHERE r.contract_id = cc.id AND r.designation_id = d.id)
$$;
REVOKE ALL ON FUNCTION public.contract_register_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_missing_contract_designations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_register_directory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_missing_contract_designations() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';