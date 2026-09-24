CREATE OR REPLACE FUNCTION public.get_attendance_charter_units()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('units','[]'::jsonb) ELSE
  jsonb_build_object('units', COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)) END
  FROM (
    SELECT u.id, u.code, u.name, COALESCE(u.location::text,'') AS location, u.branch_id,
      u.customer_id, c.name AS customer_name, c.code AS customer_code,
      u.billing_state, u.billing_city,
      COALESCE((SELECT array_agg(cc.contract_code ORDER BY cc.created_at DESC) FROM client_contracts cc WHERE cc.unit_id=u.id AND cc.status='active'), '{}') AS contract_codes,
      (SELECT max(cc.end_date) FROM client_contracts cc WHERE cc.unit_id=u.id AND cc.status='active') AS contract_end,
      (SELECT count(DISTINCT cu.candidate_id) FROM candidate_units cu JOIN candidates ca ON ca.id=cu.candidate_id WHERE cu.unit_id=u.id AND ca.status='active') AS active_employee_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ca.id,'name',ca.full_name) ORDER BY ca.full_name) FROM candidate_units cu JOIN candidates ca ON ca.id=cu.candidate_id WHERE cu.unit_id=u.id AND ca.status='active'), '[]'::jsonb) AS security_guards
    FROM units u LEFT JOIN customers c ON c.id=u.customer_id
    WHERE u.status::text='active'
    ORDER BY u.name
  ) t
$$;
REVOKE ALL ON FUNCTION public.get_attendance_charter_units() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_charter_units() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';