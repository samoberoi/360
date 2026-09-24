CREATE TABLE IF NOT EXISTS public.billing_day_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  method text NOT NULL,
  fixed_days integer,
  weekly_off_day smallint,
  included_weekdays smallint[],
  description text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_day_bases TO authenticated;
GRANT ALL ON public.billing_day_bases TO service_role;

ALTER TABLE public.billing_day_bases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read billing day bases" ON public.billing_day_bases;
CREATE POLICY "Authenticated can read billing day bases" ON public.billing_day_bases
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated can insert billing day bases" ON public.billing_day_bases;
CREATE POLICY "Authenticated can insert billing day bases" ON public.billing_day_bases
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can update billing day bases" ON public.billing_day_bases;
CREATE POLICY "Authenticated can update billing day bases" ON public.billing_day_bases
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can delete billing day bases" ON public.billing_day_bases;
CREATE POLICY "Authenticated can delete billing day bases" ON public.billing_day_bases
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS set_billing_day_bases_updated_at ON public.billing_day_bases;
CREATE TRIGGER set_billing_day_bases_updated_at BEFORE UPDATE ON public.billing_day_bases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contract_resources
  ADD COLUMN IF NOT EXISTS billing_day_base_id uuid REFERENCES public.billing_day_bases(id);

INSERT INTO public.billing_day_bases (name, code, method, fixed_days, weekly_off_day, description, is_default, sort_order)
SELECT 'Month Days minus Sundays', 'MTH_MINUS_SUN', 'actual_minus_weekly_off', NULL, 0, 'Calendar days of the month less all Sundays', true, 1
WHERE NOT EXISTS (SELECT 1 FROM public.billing_day_bases WHERE code = 'MTH_MINUS_SUN');

INSERT INTO public.billing_day_bases (name, code, method, fixed_days, weekly_off_day, description, is_default, sort_order)
SELECT 'Fixed 26 Days', 'FIXED_26', 'fixed_days', 26, NULL, 'Fixed 26 billable days every month', false, 2
WHERE NOT EXISTS (SELECT 1 FROM public.billing_day_bases WHERE code = 'FIXED_26');