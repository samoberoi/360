ALTER TABLE public.self_attendance_punches
  ADD COLUMN IF NOT EXISTS check_in_selfie_path text,
  ADD COLUMN IF NOT EXISTS check_out_selfie_path text;
ALTER TABLE public.field_visits
  ADD COLUMN IF NOT EXISTS check_in_selfie_path text;
ALTER TABLE public.field_track_points
  ADD COLUMN IF NOT EXISTS counted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_m numeric NOT NULL DEFAULT 0;

DROP POLICY IF EXISTS self_att_own_insert ON public.self_attendance_punches;
CREATE POLICY self_att_own_insert ON public.self_attendance_punches FOR INSERT TO authenticated
  WITH CHECK (candidate_id = public.current_user_candidate_id() AND public.current_user_role_key() = 'field_officer');

DROP POLICY IF EXISTS self_att_own_update ON public.self_attendance_punches;
CREATE POLICY self_att_own_update ON public.self_attendance_punches FOR UPDATE TO authenticated
  USING ((candidate_id = public.current_user_candidate_id() AND public.current_user_role_key() = 'field_officer') OR public.is_admin_user())
  WITH CHECK ((candidate_id = public.current_user_candidate_id() AND public.current_user_role_key() = 'field_officer') OR public.is_admin_user());

DROP POLICY IF EXISTS "FO manage own visits" ON public.field_visits;
CREATE POLICY "FO manage own visits" ON public.field_visits FOR ALL TO authenticated
  USING (candidate_id = public.current_user_candidate_id() AND public.current_user_role_key() = 'field_officer')
  WITH CHECK (candidate_id = public.current_user_candidate_id() AND public.current_user_role_key() = 'field_officer');

-- Server-side accurate distance
CREATE OR REPLACE FUNCTION public.fo_track_point_distance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  anchor record;
  d numeric;
  secs numeric;
  thr numeric;
BEGIN
  NEW.counted := false;
  NEW.step_m := 0;
  IF NEW.accuracy IS NOT NULL AND NEW.accuracy > 100 THEN
    RETURN NEW;
  END IF;
  SELECT lat, lng, accuracy, recorded_at INTO anchor
    FROM public.field_track_points
   WHERE candidate_id = NEW.candidate_id AND track_date = NEW.track_date AND counted
   ORDER BY recorded_at DESC LIMIT 1;
  IF NOT FOUND THEN
    NEW.counted := true;
    RETURN NEW;
  END IF;
  d := 2 * 6371000 * asin(sqrt(
        power(sin(radians(NEW.lat - anchor.lat) / 2), 2) +
        cos(radians(anchor.lat)) * cos(radians(NEW.lat)) * power(sin(radians(NEW.lng - anchor.lng) / 2), 2)));
  thr := greatest(20, coalesce(NEW.accuracy, 0), coalesce(anchor.accuracy, 0));
  IF d < thr THEN
    RETURN NEW;
  END IF;
  secs := greatest(1, extract(epoch FROM (coalesce(NEW.recorded_at, now()) - anchor.recorded_at)));
  IF d / secs > 45 THEN -- faster than ~160 km/h = GPS jump
    RETURN NEW;
  END IF;
  NEW.counted := true;
  NEW.step_m := round(d, 1);
  UPDATE public.self_attendance_punches
     SET distance_km = round((coalesce(distance_km, 0) + d / 1000.0)::numeric, 3)
   WHERE candidate_id = NEW.candidate_id AND punch_date = NEW.track_date;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fo_track_point_distance ON public.field_track_points;
CREATE TRIGGER trg_fo_track_point_distance BEFORE INSERT ON public.field_track_points
  FOR EACH ROW EXECUTE FUNCTION public.fo_track_point_distance();