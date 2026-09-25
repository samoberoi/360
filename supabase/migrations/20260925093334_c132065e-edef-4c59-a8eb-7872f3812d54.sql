create or replace function public.dashboard_counts(
  p_start date,
  p_end date,
  p_today date,
  p_horizon date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'orgs', (select count(*) from public.customers),
    'units', (select count(*) from public.units),
    'employees', (
      select count(*) from public.candidates
      where status = 'active' and coalesce(is_enabled, true)
    ),
    'contractsActive', (
      select count(*) from public.client_contracts where status = 'active'
    ),
    'contractsExpiring', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.end_date)
      from (
        select id, contract_code, end_date, unit_id, status
        from public.client_contracts
        where status = 'active'
          and end_date between p_today and p_horizon
        order by end_date
      ) x
    ), '[]'::jsonb),
    'vehicles', (select count(*) from public.vehicles),
    'fuelTotal', coalesce((
      select sum(amount) from public.vehicle_fuel_entries
      where entry_date between p_start and p_end
    ), 0),
    'items', (select count(*) from public.inv_items),
    'sheetCounts', jsonb_build_object(
      'approved', (select count(*) from public.attendance_sheets where period_start = p_start and period_end = p_end and status = 'approved'),
      'pending', (select count(*) from public.attendance_sheets where period_start = p_start and period_end = p_end and status = 'submitted'),
      'draft', (select count(*) from public.attendance_sheets where period_start = p_start and period_end = p_end and status = 'draft'),
      'rejected', (select count(*) from public.attendance_sheets where period_start = p_start and period_end = p_end and status = 'rejected'),
      'open', greatest((select count(*) from public.client_contracts where status = 'active') - (select count(*) from public.attendance_sheets where period_start = p_start and period_end = p_end), 0)
    ),
    'runCounts', jsonb_build_object(
      'processed', (select count(*) from public.payroll_runs where period_start = p_start and period_end = p_end and payroll_status = 'processed'),
      'pending', (select count(*) from public.payroll_runs where period_start = p_start and period_end = p_end and payroll_status <> 'processed' and status = 'approved'),
      'open', greatest((select count(*) from public.client_contracts where status = 'active') - (select count(*) from public.payroll_runs where period_start = p_start and period_end = p_end and payroll_status = 'processed'), 0)
    )
  ) into _result;

  return _result;
end;
$$;

revoke all on function public.dashboard_counts(date, date, date, date) from public;
grant execute on function public.dashboard_counts(date, date, date, date) to authenticated;
grant execute on function public.dashboard_counts(date, date, date, date) to service_role;

create or replace function public.dashboard_lifecycle_counts(
  p_year integer,
  p_month integer,
  p_window_start integer,
  p_window_end integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  with active_contracts as (
    select distinct on (cc.unit_id)
      cc.unit_id,
      coalesce(pw.window_start_day, 1) as window_start_day,
      coalesce(pw.window_end_day, 31) as window_end_day
    from public.client_contracts cc
    left join public.payroll_windows pw on pw.id = cc.payroll_window_id
    where cc.status = 'active' and cc.unit_id is not null
    order by cc.unit_id, cc.start_date desc nulls last, cc.created_at desc
  ),
  scoped_units as (
    select ac.*
    from active_contracts ac
    where p_window_start is null
       or (ac.window_start_day = p_window_start and ac.window_end_day = p_window_end)
  ),
  periods as (
    select
      su.unit_id,
      case
        when su.window_start_day <= 1 or su.window_end_day <= 0 or su.window_end_day >= su.window_start_day
          then make_date(p_year, p_month, 1)
        else make_date(
          extract(year from (make_date(p_year, p_month, 1) - interval '1 month'))::integer,
          extract(month from (make_date(p_year, p_month, 1) - interval '1 month'))::integer,
          least(su.window_start_day, extract(day from (date_trunc('month', make_date(p_year, p_month, 1)) - interval '1 day'))::integer)
        )
      end as period_start,
      case
        when su.window_start_day <= 1 or su.window_end_day <= 0 or su.window_end_day >= su.window_start_day
          then (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
        else make_date(
          p_year,
          p_month,
          least(su.window_end_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::integer)
        )
      end as period_end
    from scoped_units su
  ),
  lifecycle as (
    select
      p.unit_id,
      coalesce(a.status, 'none') as attendance_status,
      coalesce(r.payroll_status, 'open') as payroll_status,
      coalesce(r.invoice_status, 'open') as invoice_status
    from periods p
    left join public.attendance_sheets a
      on a.unit_id = p.unit_id
     and a.period_start = p.period_start
     and a.period_end = p.period_end
    left join public.payroll_runs r
      on r.unit_id = p.unit_id
     and r.period_start = p.period_start
     and r.period_end = p.period_end
  )
  select jsonb_build_object(
    'total', count(*),
    'attendance', jsonb_build_object(
      'approved', count(*) filter (where attendance_status = 'approved'),
      'submitted', count(*) filter (where attendance_status = 'submitted'),
      'rejected', count(*) filter (where attendance_status = 'rejected'),
      'open', count(*) filter (where attendance_status not in ('approved', 'submitted', 'rejected'))
    ),
    'payroll', jsonb_build_object(
      'processed', count(*) filter (where payroll_status = 'processed'),
      'ready', count(*) filter (where payroll_status <> 'processed' and attendance_status = 'approved'),
      'open', count(*) filter (where payroll_status <> 'processed' and attendance_status <> 'approved')
    ),
    'invoice', jsonb_build_object(
      'processed', count(*) filter (where invoice_status = 'processed'),
      'ready', count(*) filter (where invoice_status <> 'processed' and attendance_status = 'approved'),
      'open', count(*) filter (where invoice_status <> 'processed' and attendance_status <> 'approved')
    )
  ) into _result
  from lifecycle;

  return coalesce(_result, '{"total":0,"attendance":{"approved":0,"submitted":0,"rejected":0,"open":0},"payroll":{"processed":0,"ready":0,"open":0},"invoice":{"processed":0,"ready":0,"open":0}}'::jsonb);
end;
$$;

revoke all on function public.dashboard_lifecycle_counts(integer, integer, integer, integer) from public;
grant execute on function public.dashboard_lifecycle_counts(integer, integer, integer, integer) to authenticated;
grant execute on function public.dashboard_lifecycle_counts(integer, integer, integer, integer) to service_role;