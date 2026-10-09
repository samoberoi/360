drop policy if exists self_att_own_insert on public.self_attendance_punches;
create policy self_att_own_insert on public.self_attendance_punches for insert to authenticated
  with check (candidate_id = public.current_user_candidate_id());
drop policy if exists self_att_own_update on public.self_attendance_punches;
create policy self_att_own_update on public.self_attendance_punches for update to authenticated
  using (candidate_id = public.current_user_candidate_id() or public.is_admin_user())
  with check (candidate_id = public.current_user_candidate_id() or public.is_admin_user());
drop policy if exists "FO manage own visits" on public.field_visits;
create policy "FO manage own visits" on public.field_visits for all to authenticated
  using (candidate_id = public.current_user_candidate_id())
  with check (candidate_id = public.current_user_candidate_id());