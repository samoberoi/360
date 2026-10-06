CREATE OR REPLACE FUNCTION public.get_admin_user_ids()
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT public.current_user_candidate_id() AS id
  ), chain(id, depth) AS (
    SELECT m.mgr, 1 FROM me, LATERAL (
      SELECT c.reports_to AS mgr FROM public.candidates c WHERE c.id = me.id AND c.reports_to IS NOT NULL
      UNION SELECT crm.manager_id FROM public.candidate_reporting_managers crm WHERE crm.candidate_id = me.id
    ) m
    UNION
    SELECT m.mgr, chain.depth + 1 FROM chain, LATERAL (
      SELECT c.reports_to AS mgr FROM public.candidates c WHERE c.id = chain.id AND c.reports_to IS NOT NULL
      UNION SELECT crm.manager_id FROM public.candidate_reporting_managers crm WHERE crm.candidate_id = chain.id
    ) m WHERE chain.depth < 8
  )
  SELECT DISTINCT u.id FROM auth.users u
  WHERE u.email IN ('phone-8373914073@radiantguard.local')
     OR EXISTS (SELECT 1 FROM public.candidates c
                WHERE u.email = 'phone-' || c.mobile || '@radiantguard.local'
                  AND c.status = 'active'
                  AND (c.role_key IN ('admin','super_admin') OR c.id IN (SELECT id FROM chain)))
$function$;