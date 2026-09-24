create table if not exists public.attendance_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  kind text not null default 'image',
  status text not null default 'running',
  progress numeric not null default 0,
  eta_seconds integer,
  estimate_seconds integer,
  summary text,
  error text,
  created_by uuid,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists attendance_scan_jobs_unit_status_idx on public.attendance_scan_jobs (unit_id, status, heartbeat_at desc);
grant select, insert, update, delete on public.attendance_scan_jobs to authenticated;
grant all on public.attendance_scan_jobs to service_role;
alter table public.attendance_scan_jobs enable row level security;
create policy "Authenticated read scan jobs" on public.attendance_scan_jobs for select to authenticated using (true);
create policy "Authenticated insert own scan jobs" on public.attendance_scan_jobs for insert to authenticated with check (created_by is null or created_by = auth.uid());
create policy "Authenticated update scan jobs" on public.attendance_scan_jobs for update to authenticated using (true) with check (true);