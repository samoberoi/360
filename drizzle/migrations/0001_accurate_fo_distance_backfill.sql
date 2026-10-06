CREATE INDEX IF NOT EXISTS idx_ftp_cand_date_time ON public.field_track_points (candidate_id, track_date, recorded_at);
CREATE INDEX IF NOT EXISTS idx_ftp_date ON public.field_track_points (track_date);

CREATE OR REPLACE FUNCTION public.fo_track_point_distance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE anchor record; d numeric; secs numeric; thr numeric;
BEGIN
  NEW.counted := false; NEW.step_m := 0;
  IF NEW.lat NOT BETWEEN 6 AND 38 OR NEW.lng NOT BETWEEN 68 AND 98 THEN RETURN NEW; END IF;
  IF NEW.accuracy IS NOT NULL AND NEW.accuracy > 100 THEN RETURN NEW; END IF;
  SELECT lat, lng, accuracy, recorded_at INTO anchor FROM public.field_track_points
   WHERE candidate_id = NEW.candidate_id AND track_date = NEW.track_date AND counted
   ORDER BY recorded_at DESC LIMIT 1;
  IF NOT FOUND THEN NEW.counted := true; RETURN NEW; END IF;
  d := 2 * 6371000 * asin(sqrt(power(sin(radians(NEW.lat - anchor.lat) / 2), 2) +
        cos(radians(anchor.lat)) * cos(radians(NEW.lat)) * power(sin(radians(NEW.lng - anchor.lng) / 2), 2)));
  thr := greatest(20, coalesce(NEW.accuracy, 0), coalesce(anchor.accuracy, 0));
  IF d < thr THEN RETURN NEW; END IF;
  secs := greatest(1, extract(epoch FROM (coalesce(NEW.recorded_at, now()) - anchor.recorded_at)));
  IF d / secs > 35 THEN RETURN NEW; END IF;
  NEW.counted := true; NEW.step_m := round(d, 1);
  UPDATE public.self_attendance_punches SET distance_km = round((coalesce(distance_km, 0) + d / 1000.0)::numeric, 3)
   WHERE candidate_id = NEW.candidate_id AND punch_date = NEW.track_date;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fo_recompute_distance(_cand uuid, _date date)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; a record; have boolean := false; d numeric; total numeric := 0; secs numeric;
BEGIN
  FOR r IN SELECT id, lat, lng, accuracy, recorded_at FROM field_track_points
    WHERE candidate_id = _cand AND track_date = _date ORDER BY recorded_at LOOP
    IF r.lat NOT BETWEEN 6 AND 38 OR r.lng NOT BETWEEN 68 AND 98 OR coalesce(r.accuracy,0) > 100 THEN
      UPDATE field_track_points SET counted=false, step_m=0 WHERE id=r.id; CONTINUE; END IF;
    IF NOT have THEN have := true; a := r; UPDATE field_track_points SET counted=true, step_m=0 WHERE id=r.id; CONTINUE; END IF;
    d := 2 * 6371000 * asin(sqrt(power(sin(radians(r.lat - a.lat) / 2), 2) +
          cos(radians(a.lat)) * cos(radians(r.lat)) * power(sin(radians(r.lng - a.lng) / 2), 2)));
    secs := greatest(1, extract(epoch FROM (r.recorded_at - a.recorded_at)));
    IF d < greatest(20, coalesce(r.accuracy,0), coalesce(a.accuracy,0)) OR d / secs > 35 THEN
      UPDATE field_track_points SET counted=false, step_m=0 WHERE id=r.id; CONTINUE; END IF;
    IF d > 5000 AND secs > 600 THEN a := r; UPDATE field_track_points SET counted=true, step_m=0 WHERE id=r.id; CONTINUE; END IF;
    total := total + d; a := r;
    UPDATE field_track_points SET counted=true, step_m=round(d,1) WHERE id=r.id;
  END LOOP;
  UPDATE self_attendance_punches SET distance_km = round((total/1000.0)::numeric, 3)
   WHERE candidate_id=_cand AND punch_date=_date;
  RETURN round((total/1000.0)::numeric, 3);
END $$;
REVOKE EXECUTE ON FUNCTION public.fo_recompute_distance(uuid, date) FROM anon, authenticated, public;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT candidate_id, punch_date FROM self_attendance_punches LOOP
    PERFORM public.fo_recompute_distance(p.candidate_id, p.punch_date);
  END LOOP;
END $$;