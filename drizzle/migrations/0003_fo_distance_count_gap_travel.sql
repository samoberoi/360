DO $$ DECLARE src text; BEGIN
  src := pg_get_functiondef('public.fo_recompute_distance(uuid,date)'::regprocedure);
  src := replace(src, 'IF d > 5000 AND secs > 600 THEN a := r; UPDATE field_track_points SET counted=true, step_m=0 WHERE id=r.id; CONTINUE; END IF;', 'IF d > 300000 THEN a := r; UPDATE field_track_points SET counted=true, step_m=0 WHERE id=r.id; CONTINUE; END IF;');
  EXECUTE src;
  src := pg_get_functiondef('public.fo_track_point_distance()'::regprocedure);
  src := replace(src, 'IF d > 5000 AND secs > 600 THEN RETURN NEW; END IF;', 'IF d > 300000 THEN RETURN NEW; END IF;');
  EXECUTE src;
END $$;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT candidate_id, punch_date FROM self_attendance_punches LOOP
    PERFORM public.fo_recompute_distance(p.candidate_id, p.punch_date);
  END LOOP;
END $$;