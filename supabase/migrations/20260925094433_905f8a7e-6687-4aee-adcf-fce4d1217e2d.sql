alter function public.dashboard_pnl_inputs(date, date, date) security invoker;
alter function public.dashboard_pnl_inputs(date, date, date) set search_path = public;
revoke all on function public.dashboard_pnl_inputs(date, date, date) from public;
grant execute on function public.dashboard_pnl_inputs(date, date, date) to authenticated;
grant execute on function public.dashboard_pnl_inputs(date, date, date) to service_role;