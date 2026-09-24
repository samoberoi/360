CREATE TABLE IF NOT EXISTS public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_month smallint NOT NULL CHECK (holiday_month BETWEEN 1 AND 12),
  holiday_day smallint NOT NULL CHECK (holiday_day BETWEEN 1 AND 31),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, holiday_month, holiday_day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;
GRANT ALL ON public.public_holidays TO service_role;

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read public_holidays" ON public.public_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write public_holidays" ON public.public_holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update public_holidays" ON public.public_holidays FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete public_holidays" ON public.public_holidays FOR DELETE TO authenticated USING (true);