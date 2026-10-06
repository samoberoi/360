drop policy if exists "self_att_own_update" on public.self_attendance_punches;
create policy "self_att_own_update" on public.self_attendance_punches
  for update to authenticated
  using ((candidate_id = current_user_candidate_id() and current_user_role_key() in ('field_officer','operations_manager')) or is_admin_user())
  with check ((candidate_id = current_user_candidate_id() and current_user_role_key() in ('field_officer','operations_manager')) or is_admin_user());