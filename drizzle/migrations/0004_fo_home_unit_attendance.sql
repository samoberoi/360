-- Field officers are non-billable PLUS 360 staff whose attendance lives on the head-office unit.
UPDATE public.candidates
   SET non_billable = true,
       unit_id = coalesce(unit_id, '87f16953-2bfe-477b-80b4-22b8f3626459')
 WHERE role_key = 'field_officer';

CREATE OR REPLACE FUNCTION public.sync_self_punch_to_attendance_entry()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _designation_id uuid; _home uuid; _unit uuid;
  _hours numeric := 0; _code text; _ot_days numeric := 0;
BEGIN
  IF NEW.candidate_id IS NULL OR NEW.check_in_at IS NULL THEN RETURN NEW; END IF;
  SELECT c.designation_id, c.unit_id INTO _designation_id, _home FROM public.candidates c WHERE c.id = NEW.candidate_id;
  _unit := coalesce(NEW.unit_id, _home);
  IF _unit IS NULL THEN RETURN NEW; END IF;

  IF NEW.check_out_at IS NULL THEN
    -- On duty right now: show Present live; a past day never closed stays Present (logged in, no log-out).
    _code := 'P';
  ELSE
    _hours := GREATEST(0, EXTRACT(EPOCH FROM (NEW.check_out_at - NEW.check_in_at))::numeric / 3600);
    IF _hours >= 8 THEN
      _code := 'P';
      _ot_days := ROUND(((GREATEST(0, _hours - 8) / 8) * 2)) / 2;
    ELSIF _hours >= 4 THEN _code := 'HD';
    ELSE _code := 'A';
    END IF;
  END IF;

  INSERT INTO public.attendance_entries (unit_id, candidate_id, designation_id, entry_date, code, ot_hours)
  VALUES (_unit, NEW.candidate_id, _designation_id, NEW.punch_date, _code, _ot_days)
  ON CONFLICT ON CONSTRAINT attendance_entries_unit_cand_desig_date_unique
  DO UPDATE SET code = EXCLUDED.code, ot_hours = EXCLUDED.ot_hours, updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_self_punch_to_attendance_entry_trigger ON public.self_attendance_punches;
CREATE TRIGGER sync_self_punch_to_attendance_entry_trigger
  AFTER INSERT OR UPDATE OF check_in_at, check_out_at, unit_id ON public.self_attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.sync_self_punch_to_attendance_entry();

-- Backfill all field-officer punches since 1 Oct 2026.
UPDATE public.self_attendance_punches p SET check_in_at = p.check_in_at
  FROM public.candidates c
 WHERE c.id = p.candidate_id AND c.role_key = 'field_officer' AND p.punch_date >= '2026-09-30';