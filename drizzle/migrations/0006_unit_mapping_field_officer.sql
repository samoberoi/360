ALTER TABLE public.units ADD COLUMN IF NOT EXISTS field_officer_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_units_field_officer ON public.units(field_officer_id);
COMMENT ON COLUMN public.units.field_officer_id IS 'Mapping: primary field officer for this unit (also linked in candidate_units for Radar).';