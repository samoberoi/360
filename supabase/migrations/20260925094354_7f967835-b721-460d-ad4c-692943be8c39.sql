create or replace function public.dashboard_pnl_inputs(p_start date, p_end date, p_att_end date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cur as (
    select distinct on (c.unit_id) c.id as contract_id, c.unit_id
    from public.client_contracts c
    where c.status = 'active' and c.record_type = 'client' and c.unit_id is not null
      and (c.start_date is null or c.start_date <= p_end)
      and (c.end_date is null or c.end_date >= p_start)
    order by c.unit_id, c.start_date desc nulls last, c.created_at desc
  ),
  roster as (
    select cu.unit_id, cu.candidate_id from public.candidate_units cu
    join public.candidates ca on ca.id = cu.candidate_id
    where ca.status in ('active', 'approved') and coalesce(ca.is_enabled, true)
    union
    select ca.unit_id, ca.id from public.candidates ca
    where ca.unit_id is not null and ca.status in ('active', 'approved') and coalesce(ca.is_enabled, true)
  ),
  unit_rows as (
    select u.id as unit_id, u.code as unit_code, u.name as unit_name,
      coalesce(cus.name, '') as customer_name, u.epf_cap_enabled,
      cur.contract_id, not coalesce(u.is_billable, true) as is_internal,
      (select count(distinct r.candidate_id) from roster r where r.unit_id = u.id)::int as actual_strength
    from cur join public.units u on u.id = cur.unit_id
    left join public.customers cus on cus.id = u.customer_id
  ),
  res as (
    select r.contract_id, r.designation_id, r.quantity, r.components, r.benefits,
      r.deductions, r.employer_contributions, r.payroll_day_base_id
    from public.contract_resources r where r.contract_id in (select contract_id from cur)
  ),
  pairs as (
    select e.unit_id, e.candidate_id, coalesce(e.designation_id, ca.designation_id) as designation_id,
      sum(case when coalesce(ac.counts_as_present, false) and e.code not in ('PH','WO') then coalesce(ac.day_value,1) else 0 end) as p_days,
      sum(case when e.code='PH' then greatest(coalesce(ac.day_value,0),1) else 0 end) as ph_days,
      sum(case when e.code='WO' then greatest(coalesce(ac.day_value,0),1)
        when e.code not in ('PH','WO') and not coalesce(ac.counts_as_present,false) and coalesce(ac.is_paid,false) then coalesce(ac.day_value,1)
        else 0 end) as other_paid_days,
      sum(coalesce(e.ot_hours,0)) as ot_days
    from public.attendance_entries e
    join public.candidates ca on ca.id=e.candidate_id
    left join public.attendance_codes ac on ac.code=e.code
    where e.entry_date between p_start and least(p_att_end,p_end) and e.unit_id in (select unit_id from cur)
    group by e.unit_id,e.candidate_id,coalesce(e.designation_id,ca.designation_id)
    having coalesce(e.designation_id,ca.designation_id) is not null
  )
  select jsonb_build_object(
    'units',coalesce((select jsonb_agg(to_jsonb(unit_rows)) from unit_rows),'[]'::jsonb),
    'resources',coalesce((select jsonb_agg(to_jsonb(res)) from res),'[]'::jsonb),
    'pairs',coalesce((select jsonb_agg(to_jsonb(pairs)) from pairs),'[]'::jsonb),
    'day_bases',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'method',b.method,'fixed_days',b.fixed_days,'weekly_off_day',b.weekly_off_day,'included_weekdays',b.included_weekdays)) from public.payroll_day_bases b),'[]'::jsonb)
  );
$$;
revoke all on function public.dashboard_pnl_inputs(date,date,date) from public;
grant execute on function public.dashboard_pnl_inputs(date,date,date) to authenticated;
grant execute on function public.dashboard_pnl_inputs(date,date,date) to service_role;