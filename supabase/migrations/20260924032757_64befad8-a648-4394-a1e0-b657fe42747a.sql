CREATE TABLE IF NOT EXISTS public.invoice_extra_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.client_contracts(id) ON DELETE SET NULL,
  period_start date,
  period_end date,
  description text NOT NULL,
  hsn_sac text NOT NULL DEFAULT '998525',
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  per_label text NOT NULL DEFAULT 'Duty',
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_extra_charges_unit_idx ON public.invoice_extra_charges(unit_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_extra_charges TO authenticated;
GRANT ALL ON public.invoice_extra_charges TO service_role;

ALTER TABLE public.invoice_extra_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read invoice extra charges" ON public.invoice_extra_charges;
CREATE POLICY "Authenticated can read invoice extra charges" ON public.invoice_extra_charges
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated can insert invoice extra charges" ON public.invoice_extra_charges;
CREATE POLICY "Authenticated can insert invoice extra charges" ON public.invoice_extra_charges
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can update invoice extra charges" ON public.invoice_extra_charges;
CREATE POLICY "Authenticated can update invoice extra charges" ON public.invoice_extra_charges
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated can delete invoice extra charges" ON public.invoice_extra_charges;
CREATE POLICY "Authenticated can delete invoice extra charges" ON public.invoice_extra_charges
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS set_invoice_extra_charges_updated_at ON public.invoice_extra_charges;
CREATE TRIGGER set_invoice_extra_charges_updated_at BEFORE UPDATE ON public.invoice_extra_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();