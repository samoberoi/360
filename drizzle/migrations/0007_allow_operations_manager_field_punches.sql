drop policy if exists "FO manage own visits" on public.field_visits;
create policy "FO manage own visits" on public.field_visits
  for all to authenticated
  using (candidate_id = current_user_candidate_id() and current_user_role_key() in ('field_officer','operations_manager'))
  with check (candidate_id = current_user_candidate_id() and current_user_role_key() in ('field_officer','operations_manager'));

drop policy if exists "self_att_own_insert" on public.self_attendance_punches;
create policy "self_att_own_insert" on public.self_attendance_punches
  for insert to authenticated
  with check (candidate_id = current_user_candidate_id() and current_user_role_key() in ('field_officer','operations_manager'));