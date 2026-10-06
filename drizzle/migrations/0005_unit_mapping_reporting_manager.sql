ALTER TABLE public.units ADD COLUMN IF NOT EXISTS reporting_manager_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_units_reporting_manager ON public.units(reporting_manager_id);
COMMENT ON COLUMN public.units.reporting_manager_id IS 'Mapping: reporting manager (employee) for this unit; field officer mapping lives in candidate_units.';