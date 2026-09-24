
CREATE TABLE IF NOT EXISTS public.invoice_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code text NOT NULL, state_name text NOT NULL DEFAULT '', number_prefix text,
  fiscal_year text NOT NULL, last_sequence integer NOT NULL DEFAULT 0, seq_padding integer NOT NULL DEFAULT 4,
  enabled boolean NOT NULL DEFAULT true, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_code, fiscal_year));
CREATE TABLE IF NOT EXISTS public.invoice_number_client_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code text NOT NULL, token text NOT NULL, sample_party_name text,
  customer_id uuid, unit_id uuid, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.invoice_number_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code text NOT NULL, fiscal_year text NOT NULL, month_code text NOT NULL, sequence integer NOT NULL,
  client_token text, invoice_no text NOT NULL UNIQUE, party_name text, irn_number text, remarks text,
  irn_date_text text, source text NOT NULL DEFAULT 'app', issued_on date, unit_id uuid, created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_code, fiscal_year, sequence));
CREATE TABLE IF NOT EXISTS public.final_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE, state_code text NOT NULL, fiscal_year text NOT NULL, month_code text NOT NULL,
  sequence integer NOT NULL, client_token text, party_name text, billing_state text, customer_id uuid,
  invoice_date date NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  taxable_value numeric DEFAULT 0, tax_total numeric DEFAULT 0, total_value numeric DEFAULT 0,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.final_invoice_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  final_invoice_id uuid NOT NULL REFERENCES public.final_invoices(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, period_start, period_end));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_number_series, public.invoice_number_client_tokens, public.invoice_number_registry, public.final_invoices, public.final_invoice_units TO authenticated;
GRANT ALL ON public.invoice_number_series, public.invoice_number_client_tokens, public.invoice_number_registry, public.final_invoices, public.final_invoice_units TO service_role;

ALTER TABLE public.invoice_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_number_client_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_number_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_invoice_units ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_invoices() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin_user() OR public.current_user_has_permission('billing','invoices','approve')
$$;

CREATE POLICY "signed in read series" ON public.invoice_number_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write series" ON public.invoice_number_series FOR ALL TO authenticated USING (public.current_user_can_manage_invoices()) WITH CHECK (public.current_user_can_manage_invoices());
CREATE POLICY "signed in read tokens" ON public.invoice_number_client_tokens FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write tokens" ON public.invoice_number_client_tokens FOR ALL TO authenticated USING (public.current_user_can_manage_invoices()) WITH CHECK (public.current_user_can_manage_invoices());
CREATE POLICY "signed in read registry" ON public.invoice_number_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write registry" ON public.invoice_number_registry FOR ALL TO authenticated USING (public.current_user_can_manage_invoices()) WITH CHECK (public.current_user_can_manage_invoices());
CREATE POLICY "signed in read final" ON public.final_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "signed in read final units" ON public.final_invoice_units FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE VIEW public.invoice_number_month_counts WITH (security_invoker = on) AS
  SELECT state_code, fiscal_year, month_code,
    (array_position(ARRAY['APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR'], month_code)) AS month_order,
    count(*)::int AS invoice_count, min(sequence) AS first_sequence, max(sequence) AS last_sequence
  FROM public.invoice_number_registry GROUP BY 1,2,3;
GRANT SELECT ON public.invoice_number_month_counts TO authenticated;

CREATE OR REPLACE FUNCTION public._inv_fy(_d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lpad(((CASE WHEN extract(month FROM _d)>=4 THEN extract(year FROM _d) ELSE extract(year FROM _d)-1 END)::int % 100)::text,2,'0')
    || '-' || lpad((((CASE WHEN extract(month FROM _d)>=4 THEN extract(year FROM _d) ELSE extract(year FROM _d)-1 END)::int + 1) % 100)::text,2,'0')
$$;
CREATE OR REPLACE FUNCTION public._inv_mc(_d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(to_char(_d,'MON'))
$$;

CREATE OR REPLACE FUNCTION public.peek_invoice_number(_state_code text, _invoice_date date, _client_token text DEFAULT NULL)
RETURNS TABLE(invoice_no text, next_sequence integer, fiscal_year text, month_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; fy text := public._inv_fy(_invoice_date); mc text := public._inv_mc(_invoice_date); nxt int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO s FROM invoice_number_series ss WHERE ss.state_code=_state_code AND ss.fiscal_year=fy;
  nxt := COALESCE(s.last_sequence,0)+1;
  RETURN QUERY SELECT (CASE WHEN COALESCE(trim(s.number_prefix),'')<>'' THEN trim(s.number_prefix)||'-' ELSE '' END)
      || mc || fy || '-' || upper(COALESCE(trim(_client_token),'')) || lpad(nxt::text, greatest(COALESCE(s.seq_padding,4),1), '0'),
    nxt, fy, mc;
END $$;

CREATE OR REPLACE FUNCTION public.allocate_invoice_number(_state_code text, _invoice_date date, _party_name text DEFAULT NULL, _client_token text DEFAULT NULL, _unit_id uuid DEFAULT NULL)
RETURNS TABLE(invoice_no text, sequence integer, fiscal_year text, month_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; fy text := public._inv_fy(_invoice_date); mc text := public._inv_mc(_invoice_date); nxt int; no text;
BEGIN
  IF NOT public.current_user_can_manage_invoices() THEN RAISE EXCEPTION 'You do not have permission to issue invoice numbers'; END IF;
  INSERT INTO invoice_number_series(state_code, fiscal_year) VALUES (_state_code, fy) ON CONFLICT (state_code, fiscal_year) DO NOTHING;
  UPDATE invoice_number_series ss SET last_sequence = ss.last_sequence+1, updated_at=now()
    WHERE ss.state_code=_state_code AND ss.fiscal_year=fy RETURNING * INTO s;
  IF NOT s.enabled THEN RAISE EXCEPTION 'Invoice numbering is disabled for this state'; END IF;
  nxt := s.last_sequence;
  no := (CASE WHEN COALESCE(trim(s.number_prefix),'')<>'' THEN trim(s.number_prefix)||'-' ELSE '' END)
      || mc || fy || '-' || upper(COALESCE(trim(_client_token),'')) || lpad(nxt::text, greatest(s.seq_padding,1), '0');
  INSERT INTO invoice_number_registry(state_code, fiscal_year, month_code, sequence, client_token, invoice_no, party_name, issued_on, unit_id)
    VALUES (_state_code, fy, mc, nxt, _client_token, no, _party_name, _invoice_date, _unit_id);
  RETURN QUERY SELECT no, nxt, fy, mc;
END $$;

CREATE OR REPLACE FUNCTION public.generate_final_invoice(_unit_ids uuid[], _period_start date, _period_end date, _invoice_date date, _billing_state text, _client_token text DEFAULT NULL, _customer_id uuid DEFAULT NULL, _party_name text DEFAULT NULL, _taxable_value numeric DEFAULT 0, _tax_total numeric DEFAULT 0, _total_value numeric DEFAULT 0)
RETURNS TABLE(invoice_no text, sequence integer, fiscal_year text, month_code text, state_code text, final_invoice_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; fid uuid; st text := COALESCE(NULLIF(trim(_billing_state),''),'NA');
BEGIN
  IF NOT public.current_user_can_manage_invoices() THEN RAISE EXCEPTION 'You do not have permission to finalise invoices'; END IF;
  IF EXISTS (SELECT 1 FROM final_invoice_units f WHERE f.unit_id = ANY(_unit_ids) AND f.period_start=_period_start AND f.period_end=_period_end) THEN
    RAISE EXCEPTION 'A final invoice already exists for this site and period';
  END IF;
  SELECT * INTO a FROM public.allocate_invoice_number(st, _invoice_date, _party_name, _client_token, _unit_ids[1]);
  INSERT INTO final_invoices(invoice_no, state_code, fiscal_year, month_code, sequence, client_token, party_name, billing_state, customer_id, invoice_date, period_start, period_end, taxable_value, tax_total, total_value)
    VALUES (a.invoice_no, st, a.fiscal_year, a.month_code, a.sequence, _client_token, _party_name, _billing_state, _customer_id, _invoice_date, _period_start, _period_end, _taxable_value, _tax_total, _total_value)
    RETURNING id INTO fid;
  INSERT INTO final_invoice_units(final_invoice_id, unit_id, period_start, period_end)
    SELECT fid, u, _period_start, _period_end FROM unnest(_unit_ids) u;
  RETURN QUERY SELECT a.invoice_no, a.sequence, a.fiscal_year, a.month_code, st, fid;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_field_scope()
RETURNS TABLE(unit_id uuid, unit_name text, unit_code text, customer_name text, branch_id uuid, branch_name text, address text, latitude double precision, longitude double precision, is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT public.current_user_candidate_id() AS cid),
  ids AS (
    SELECT cu.unit_id, bool_or(cu.is_primary) AS is_primary FROM candidate_units cu, me WHERE cu.candidate_id = me.cid GROUP BY 1
    UNION ALL
    SELECT u.id, false FROM employee_scope_assignments e JOIN me ON e.candidate_id = me.cid
      JOIN units u ON (e.scope_type='unit' AND u.id::text = e.scope_id) OR (e.scope_type='customer' AND u.customer_id::text = e.scope_id) OR (e.scope_type='branch' AND u.branch_id::text = e.scope_id)
  ), agg AS (SELECT ids.unit_id, bool_or(ids.is_primary) p FROM ids GROUP BY 1)
  SELECT u.id, u.name::text, u.code::text, c.name::text, u.branch_id, b.name::text,
    concat_ws(', ', NULLIF(u.billing_address1::text,''), NULLIF(u.billing_address2::text,''), NULLIF(u.billing_city::text,'')),
    u.latitude::double precision, u.longitude::double precision, agg.p
  FROM agg JOIN units u ON u.id = agg.unit_id LEFT JOIN customers c ON c.id=u.customer_id LEFT JOIN branches b ON b.id=u.branch_id
  ORDER BY agg.p DESC, u.name
$$;
CREATE OR REPLACE FUNCTION public.get_my_field_scope_fresh()
RETURNS SETOF record LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::record WHERE false $$;
DROP FUNCTION public.get_my_field_scope_fresh();
CREATE OR REPLACE FUNCTION public.get_my_field_scope_fresh()
RETURNS TABLE(unit_id uuid, unit_name text, unit_code text, customer_name text, branch_id uuid, branch_name text, address text, latitude double precision, longitude double precision, is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT * FROM public.get_my_field_scope() $$;

CREATE OR REPLACE FUNCTION public.get_my_assigned_units()
RETURNS TABLE(id uuid, name text, code text, site_address text, latitude double precision, longitude double precision, shift_start_time text, shift_end_time text, is_primary boolean, designation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.name::text, u.code::text,
    concat_ws(', ', NULLIF(u.billing_address1::text,''), NULLIF(u.billing_address2::text,''), NULLIF(u.billing_city::text,'')),
    u.latitude::double precision, u.longitude::double precision, NULL::text, NULL::text,
    COALESCE(cu.is_primary,false), COALESCE(cu.designation_id, ca.designation_id)
  FROM candidate_units cu JOIN candidates ca ON ca.id=cu.candidate_id JOIN units u ON u.id=cu.unit_id
  WHERE cu.candidate_id = public.current_user_candidate_id()
  ORDER BY cu.is_primary DESC NULLS LAST, u.name
$$;

CREATE OR REPLACE FUNCTION public.capture_unit_coordinates(_unit_id uuid, _lat double precision, _lng double precision, _accuracy integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR _accuracy IS NULL OR _accuracy > 100 THEN RETURN false; END IF;
  IF NOT (public.is_admin_user() OR EXISTS (SELECT 1 FROM public.get_my_field_scope() s WHERE s.unit_id=_unit_id)) THEN RETURN false; END IF;
  UPDATE units SET latitude=_lat, longitude=_lng WHERE id=_unit_id AND (latitude IS NULL OR longitude IS NULL);
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.people_insights(p_unit_ids uuid[] DEFAULT NULL, p_days integer DEFAULT 366, p_sixty boolean DEFAULT false, p_limit integer DEFAULT 200, p_role_keys text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT ca.id, ca.full_name, ca.photo_url, ca.mobile, ca.date_of_birth, ca.approved_at, ca.created_at, ca.unit_id, u.name AS unit_name, ca.designation_id, d.name AS designation_name
    FROM candidates ca LEFT JOIN units u ON u.id=ca.unit_id LEFT JOIN designations d ON d.id=ca.designation_id
    WHERE auth.uid() IS NOT NULL AND ca.status::text='active'
      AND (p_unit_ids IS NULL OR ca.unit_id = ANY(p_unit_ids))
      AND (p_role_keys IS NULL OR ca.role_key = ANY(p_role_keys))
  ), bd AS (
    SELECT b.*, (CASE WHEN (b.date_of_birth::date + (extract(year from age(current_date, b.date_of_birth::date))::int * interval '1 year'))::date >= current_date
        THEN (b.date_of_birth::date + (extract(year from age(current_date, b.date_of_birth::date))::int * interval '1 year'))::date
        ELSE (b.date_of_birth::date + ((extract(year from age(current_date, b.date_of_birth::date))::int + 1) * interval '1 year'))::date END) AS nd
    FROM base b WHERE date_of_birth IS NOT NULL
  ), an AS (
    SELECT b.*, COALESCE(approved_at, created_at)::date AS j FROM base b WHERE COALESCE(approved_at, created_at) IS NOT NULL
  ), an2 AS (
    SELECT an.*, (CASE WHEN (j + (extract(year from age(current_date, j))::int * interval '1 year'))::date >= current_date
        THEN (j + (extract(year from age(current_date, j))::int * interval '1 year'))::date
        ELSE (j + ((extract(year from age(current_date, j))::int + 1) * interval '1 year'))::date END) AS nd
    FROM an
  )
  SELECT jsonb_build_object(
    'birthdays', COALESCE((SELECT jsonb_agg(x) FROM (SELECT id, full_name, photo_url, mobile, date_of_birth, approved_at, created_at, unit_id, unit_name, designation_id, designation_name,
        (nd - current_date) AS "daysUntil", nd AS "nextDate", extract(year from age(nd, date_of_birth))::int AS "turningAge"
      FROM bd WHERE nd - current_date <= p_days ORDER BY nd LIMIT p_limit) x), '[]'::jsonb),
    'anniversaries', COALESCE((SELECT jsonb_agg(x) FROM (SELECT id, full_name, photo_url, mobile, date_of_birth, approved_at, created_at, unit_id, unit_name, designation_id, designation_name,
        (nd - current_date) AS "daysUntil", nd AS "nextDate", extract(year from age(nd, j))::int AS years
      FROM an2 WHERE nd - current_date <= p_days AND extract(year from age(nd, j)) >= 1 ORDER BY nd LIMIT p_limit) x), '[]'::jsonb),
    'sixtyPlus', CASE WHEN p_sixty THEN COALESCE((SELECT jsonb_agg(x) FROM (SELECT id, full_name, photo_url, mobile, date_of_birth, approved_at, created_at, unit_id, unit_name, designation_id, designation_name,
        extract(year from age(date_of_birth))::int AS age FROM base WHERE date_of_birth <= current_date - interval '60 years' ORDER BY date_of_birth LIMIT p_limit) x), '[]'::jsonb) ELSE '[]'::jsonb END
  )
$$;

REVOKE ALL ON FUNCTION public.peek_invoice_number(text,date,text), public.allocate_invoice_number(text,date,text,text,uuid),
  public.generate_final_invoice(uuid[],date,date,date,text,text,uuid,text,numeric,numeric,numeric),
  public.get_my_field_scope(), public.get_my_field_scope_fresh(), public.get_my_assigned_units(),
  public.capture_unit_coordinates(uuid,double precision,double precision,integer),
  public.people_insights(uuid[],integer,boolean,integer,text[]), public.current_user_can_manage_invoices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peek_invoice_number(text,date,text), public.allocate_invoice_number(text,date,text,text,uuid),
  public.generate_final_invoice(uuid[],date,date,date,text,text,uuid,text,numeric,numeric,numeric),
  public.get_my_field_scope(), public.get_my_field_scope_fresh(), public.get_my_assigned_units(),
  public.capture_unit_coordinates(uuid,double precision,double precision,integer),
  public.people_insights(uuid[],integer,boolean,integer,text[]), public.current_user_can_manage_invoices() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
