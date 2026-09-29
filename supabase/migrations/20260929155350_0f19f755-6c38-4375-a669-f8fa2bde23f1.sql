CREATE TABLE public.attendance_location_rules (
  role_key text PRIMARY KEY,
  mark_mode text NOT NULL DEFAULT 'home_office' CHECK (mark_mode IN ('home_office','mapped_site','anywhere')),
  allowed_distance_m integer NOT NULL DEFAULT 300 CHECK (allowed_distance_m BETWEEN 25 AND 5000),
  save_new_site_locations boolean NOT NULL DEFAULT true,
  face_photo_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_location_rules TO authenticated;
GRANT ALL ON public.attendance_location_rules TO service_role;
ALTER TABLE public.attendance_location_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read rules" ON public.attendance_location_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert rules" ON public.attendance_location_rules FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());
CREATE POLICY "Admins update rules" ON public.attendance_location_rules FOR UPDATE TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE POLICY "Admins delete rules" ON public.attendance_location_rules FOR DELETE TO authenticated USING (public.is_admin_user());
CREATE TRIGGER attendance_location_rules_updated BEFORE UPDATE ON public.attendance_location_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.attendance_location_rules (role_key, mark_mode, allowed_distance_m, save_new_site_locations, face_photo_required) VALUES
 ('field_officer','anywhere',300,true,true),
 ('guard','mapped_site',300,true,true),
 ('accounts','home_office',300,true,false),
 ('admin','home_office',300,true,false),
 ('branch_manager','home_office',300,true,false),
 ('control_center','home_office',300,true,false),
 ('finance','home_office',300,true,false),
 ('head_control_center','home_office',300,true,false),
 ('hr','home_office',300,true,false);