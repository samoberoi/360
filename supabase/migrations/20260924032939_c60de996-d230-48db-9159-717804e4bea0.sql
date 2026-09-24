CREATE TABLE IF NOT EXISTS public.mis_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  row_grain text NOT NULL DEFAULT 'employee',
  mis_applicable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_templates TO authenticated;
GRANT ALL ON public.mis_templates TO service_role;
ALTER TABLE public.mis_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mis_templates_read" ON public.mis_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "mis_templates_write" ON public.mis_templates FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE TABLE IF NOT EXISTS public.mis_template_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mis_templates(id) ON DELETE CASCADE,
  header text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'system',
  system_key text,
  enabled boolean NOT NULL DEFAULT true,
  client_attribute boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_template_columns TO authenticated;
GRANT ALL ON public.mis_template_columns TO service_role;
ALTER TABLE public.mis_template_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mis_template_columns_read" ON public.mis_template_columns FOR SELECT TO authenticated USING (true);
CREATE POLICY "mis_template_columns_write" ON public.mis_template_columns FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE INDEX IF NOT EXISTS mis_template_columns_template_idx ON public.mis_template_columns(template_id);

CREATE TABLE IF NOT EXISTS public.mis_unit_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.mis_templates(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES public.mis_template_columns(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mis_unit_values_column_unit_key UNIQUE (column_id, unit_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_unit_values TO authenticated;
GRANT ALL ON public.mis_unit_values TO service_role;
ALTER TABLE public.mis_unit_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mis_unit_values_read" ON public.mis_unit_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "mis_unit_values_write" ON public.mis_unit_values FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE INDEX IF NOT EXISTS mis_unit_values_template_unit_idx ON public.mis_unit_values(template_id, unit_id);

CREATE TRIGGER mis_templates_set_updated_at BEFORE UPDATE ON public.mis_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER mis_template_columns_set_updated_at BEFORE UPDATE ON public.mis_template_columns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER mis_unit_values_set_updated_at BEFORE UPDATE ON public.mis_unit_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS ph_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ph_multiplier numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ph_day_value numeric,
  ADD COLUMN IF NOT EXISTS paid_weekly_off boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.units.paid_weekly_off IS 'When true, Weekly Off (WO) days are paid and counted inside P Days for this client site.';

ALTER TABLE public.attendance_sheets
  ADD COLUMN IF NOT EXISTS tally_invoice_path text,
  ADD COLUMN IF NOT EXISTS tally_invoice_name text,
  ADD COLUMN IF NOT EXISTS tally_invoice_uploaded_at timestamptz;