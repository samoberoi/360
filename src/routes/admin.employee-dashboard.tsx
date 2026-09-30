import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  Cake,
  ClipboardCheck,
  Package,
  PartyPopper,
  UserRound,
  Users,
  ArrowUpRight,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";


import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/lib/auth";
import { useCountUp } from "@/hooks/useCountUp";
import { nextOccurrence, yearsBetween } from "@/lib/people-insights";
import { DashboardSkeleton } from "@/components/Skeletons";
import { MarkAttendanceCard } from "@/components/MarkAttendanceCard";
import { DashboardShell } from "@/components/LiveFeed";


export const Route = createFileRoute("/admin/employee-dashboard")({
  head: () => ({
    meta: [
      { title: "My Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Personal attendance, duty, assignments, team, and workplace updates." },
      { property: "og:title", content: "My Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Personal attendance, duty, assignments, team, and workplace updates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmployeeDashboard,
});

type Me = {
  id: string;
  full_name: string;
  employee_code: string | null;
  photo_url: string | null;
  mobile: string | null;
  email: string | null;
  role_key: string | null;
  status: string | null;
  unit_id: string | null;
  designation_id: string | null;
  reports_to: string | null;
  date_of_birth: string | null;
  approved_at: string | null;
  created_at: string | null;
};

type Teammate = {
  id: string;
  full_name: string;
  employee_code: string | null;
  photo_url: string | null;
  date_of_birth: string | null;
  approved_at: string | null;
  created_at: string | null;
  designation_id: string | null;
  role_key: string | null;
  unit_id: string | null;
};

type Manager = {
  id: string;
  full_name: string;
  employee_code: string | null;
  photo_url: string | null;
  mobile: string | null;
  email: string | null;
  role_key: string | null;
  designation_id: string | null;
};

type AssignedUnit = {
  id: string;
  name: string;
  code: string | null;
  site_address: string | null;
  latitude: number | null;
  longitude: number | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  is_primary: boolean;
  designation_id: string | null;
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(d: Date) { return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]?.toUpperCase()??"").join("") || "?";
}

type Accent = "emerald" | "rose" | "amber" | "sky" | "indigo" | "violet";
const ACCENT_CHIP: Record<Accent, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20",
};
const ACCENT_BAR: Record<Accent, string> = {
  emerald: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-500",
  sky: "bg-sky-500", indigo: "bg-indigo-500", violet: "bg-violet-500",
};
const ACCENT_TILE_BG: Record<Accent, string> = {
  emerald: "bg-emerald-100/80 dark:bg-emerald-500/15",
  rose: "bg-rose-100/80 dark:bg-rose-500/15",
  amber: "bg-amber-100/80 dark:bg-amber-500/15",
  sky: "bg-sky-100/80 dark:bg-sky-500/15",
  indigo: "bg-indigo-100/80 dark:bg-indigo-500/15",
  violet: "bg-violet-100/80 dark:bg-violet-500/15",
};


function EmployeeDashboard() {
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";

  const meQ = useQuery({
    queryKey: ["me-emp", phone],
    enabled: !!phone,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,full_name,employee_code,photo_url,mobile,email,role_key,status,unit_id,designation_id,reports_to,date_of_birth,approved_at,created_at")
        .eq("mobile", phone)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Me) ?? null;
    },
  });
  const me = meQ.data;

  const lookupsQ = useQuery({
    queryKey: ["me-emp-lookups", me?.unit_id, me?.designation_id],
    enabled: !!me,
    queryFn: async () => {
      const [u, d] = await Promise.all([
        me?.unit_id
          ? supabase.from("units").select("id,name,code,branch_id,customer_id,is_billable,location,latitude,longitude").eq("id", me.unit_id).maybeSingle()
          : Promise.resolve({ data: null }),
        me?.designation_id
          ? supabase.from("designations").select("id,name").eq("id", me.designation_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        unit: u.data ? {
          ...(u.data as unknown as { id: string; name: string; code: string; branch_id: string | null; customer_id: string | null; is_billable: boolean | null; location: string | null; latitude: number | null; longitude: number | null }),
          site_address: (u.data as unknown as { location: string | null }).location,
          shift_start_time: null,
          shift_end_time: null,
        } : null,
        designation: (d.data as unknown as { id: string; name: string } | null),
      };
    },
  });
  const unit = lookupsQ.data?.unit ?? null;
  

  const monthStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }, []);
  const monthEnd = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }, []);
  const attQ = useQuery({
    queryKey: ["me-attendance", me?.id, monthStart],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_entries")
        .select("code,ot_hours,entry_date")
        .eq("candidate_id", me!.id)
        .gte("entry_date", monthStart)
        .lte("entry_date", monthEnd);
      if (error) throw error;
      return (data as unknown as { code: string; ot_hours: number; entry_date: string }[]) ?? [];
    },
  });
  const attStats = useMemo(() => {
    const rows = attQ.data ?? [];
    let present = 0, absent = 0, leave = 0, ot = 0;
    for (const r of rows) {
      const c = (r.code || "").toUpperCase();
      if (c === "A") absent++;
      else if (c === "L" || c === "LV") leave++;
      else if (c) present++;
      ot += Number(r.ot_hours || 0);
    }
    return { present, absent, leave, ot, total: rows.length };
  }, [attQ.data]);

  const myUnitsQ = useQuery({
    queryKey: ["me-assigned-units-v3", me?.id],
    enabled: !!me?.id,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_assigned_units" as never);
      if (error) throw error;
      const rows = ((data as unknown) as AssignedUnit[]) ?? [];
      const primaryId = rows.find((row) => row.is_primary)?.id ?? me?.unit_id ?? rows[0]?.id ?? null;
      const desigIds = Array.from(new Set(rows.map((row) => row.designation_id).filter(Boolean))) as string[];
      const designationByUnit: Record<string, string> = {};
      if (desigIds.length) {
        const { data: desigs } = await supabase
          .from("designations")
          .select("id,name")
          .in("id", desigIds);
        const nameById = new Map(
          ((desigs as unknown as Array<{ id: string; name: string }>) ?? []).map((d) => [d.id, d.name]),
        );
        for (const row of rows) {
          if (row.designation_id && nameById.has(row.designation_id)) {
            designationByUnit[row.id] = nameById.get(row.designation_id) ?? "";
          }
        }
      }
      return { units: rows, primaryId, designationByUnit };
    },
  });
  const myUnitIds = useMemo(() => myUnitsQ.data?.units.map((row) => row.id) ?? [], [myUnitsQ.data]);
  const primaryUnitId = myUnitsQ.data?.primaryId ?? null;
  const designationByUnit = myUnitsQ.data?.designationByUnit ?? {};



  const teamQ = useQuery({
    queryKey: ["me-team", myUnitIds.join(","), me?.id],
    enabled: !!me?.id && myUnitIds.length > 0,
    queryFn: async () => {
      // Guards mapped via candidates.unit_id
      const { data: direct, error } = await supabase
        .from("candidates")
        .select("id,full_name,employee_code,photo_url,date_of_birth,approved_at,created_at,designation_id,role_key,unit_id")
        .in("unit_id", myUnitIds)
        .in("status", ["active", "approved"])
        .neq("id", me!.id)
        .order("full_name");
      if (error) throw error;
      // Guards mapped via candidate_units (many-to-many)
      const { data: cu } = await supabase
        .from("candidate_units" as never)
        .select("candidate_id")
        .in("unit_id", myUnitIds);
      const extraIds = Array.from(
        new Set(((cu as unknown as Array<{ candidate_id: string }>) ?? []).map((r) => r.candidate_id).filter((id) => id && id !== me!.id)),
      );
      let extras: Teammate[] = [];
      if (extraIds.length) {
        const { data: ex } = await supabase
          .from("candidates")
          .select("id,full_name,employee_code,photo_url,date_of_birth,approved_at,created_at,designation_id,role_key,unit_id")
          .in("id", extraIds)
          .in("status", ["active", "approved"]);
        extras = (ex as unknown as Teammate[]) ?? [];
      }
      const map = new Map<string, Teammate>();
      for (const t of (direct as unknown as Teammate[]) ?? []) map.set(t.id, t);
      for (const t of extras) if (!map.has(t.id)) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
  const team = teamQ.data ?? [];
  const guardTeam = useMemo(
    () => team.filter((t) => t.role_key === "guard" || t.role_key === "security_guard"),
    [team],
  );

  const myUnits = useMemo(() => {
    const byId = new Map<string, AssignedUnit>();
    if (unit) {
      byId.set(unit.id, {
        id: unit.id,
        name: unit.name,
        code: unit.code,
        site_address: unit.site_address,
        latitude: unit.latitude,
        longitude: unit.longitude,
        shift_start_time: unit.shift_start_time,
        shift_end_time: unit.shift_end_time,
        is_primary: unit.id === primaryUnitId,
        designation_id: null,
      });
    }
    for (const assignedUnit of myUnitsQ.data?.units ?? []) byId.set(assignedUnit.id, assignedUnit);
    return Array.from(byId.values());
  }, [unit, myUnitsQ.data?.units, primaryUnitId]);
  const isGuard = me?.role_key === "guard" || me?.role_key === "security_guard";
  // Attendance can only be marked at the primary unit. All other units are
  // reliever units where the guard is only paid for extra duty (ED).
  const allowedUnits = useMemo(() => {
    const list = myUnits.map((u) => ({
      id: u.id,
      name: u.name,
      latitude: u.latitude,
      longitude: u.longitude,
      isPrimary: primaryUnitId ? u.id === primaryUnitId : u.is_primary,
    }));
    if (!isGuard) return list;
    // Guards may pick any assigned unit; only the primary unit accepts a
    // present-day punch (all others are extra-duty/reliever units).
    if (!primaryUnitId || list.some((u) => u.isPrimary)) return list;
    return list.map((u, i) => (i === 0 ? { ...u, isPrimary: true } : u));
  }, [myUnits, isGuard, primaryUnitId]);



  // Reporting manager (field officer)
  const managerQ = useQuery({
    queryKey: ["me-manager", me?.reports_to],
    enabled: !!me?.reports_to,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,full_name,employee_code,photo_url,mobile,email,role_key,designation_id")
        .eq("id", me!.reports_to!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Manager) ?? null;
    },
  });
  const manager = managerQ.data ?? null;


  const desigIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of team) if (t.designation_id) ids.add(t.designation_id);
    if (manager?.designation_id) ids.add(manager.designation_id);
    return Array.from(ids);
  }, [team, manager]);
  const desigNameQ = useQuery({
    queryKey: ["me-team-desig", desigIds.join(",")],
    enabled: desigIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("designations").select("id,name").in("id", desigIds);
      if (error) throw error;
      const m = new Map<string, string>();
      for (const d of (data as unknown as { id: string; name: string }[]) ?? []) m.set(d.id, d.name);
      return m;
    },
  });
  const desigMap = desigNameQ.data ?? new Map<string, string>();

  const issQ = useQuery({
    queryKey: ["me-iss-count", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_issuances")
        .select("id,status")
        .eq("destination_id", me!.id)
        .in("destination_type", ["guard", "field_officer"]);
      if (error) throw error;
      const rows = (data as unknown as { id: string; status: string }[]) ?? [];
      return { total: rows.length, pending: rows.filter((r) => r.status === "issued").length };
    },
  });

  const HORIZON = useMemo(() => {
    const today = new Date();
    const eoy = new Date(today.getFullYear(), 11, 31);
    return Math.round((eoy.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  }, []);
  const birthdays = useMemo(() => {
    const list: Array<{ id: string; name: string; photo: string | null; days: number; date: Date; turningAge: number }> = [];
    for (const t of team) {
      if (!t.date_of_birth) continue;
      const { next, days } = nextOccurrence(t.date_of_birth);
      if (days <= HORIZON) list.push({ id: t.id, name: t.full_name, photo: t.photo_url, days, date: next, turningAge: yearsBetween(t.date_of_birth, next) });
    }
    return list.sort((a, b) => a.days - b.days);
  }, [team, HORIZON]);
  const anniversaries = useMemo(() => {
    const list: Array<{ id: string; name: string; photo: string | null; days: number; date: Date; years: number }> = [];
    for (const t of team) {
      const started = t.approved_at || t.created_at;
      if (!started) continue;
      const { next, days } = nextOccurrence(started);
      const years = yearsBetween(started, next);
      if (days <= HORIZON && years >= 1) list.push({ id: t.id, name: t.full_name, photo: t.photo_url, days, date: next, years });
    }
    return list.sort((a, b) => a.days - b.days);
  }, [team, HORIZON]);

  if (meQ.isLoading) return <DashboardSkeleton />;
  if (!me) return <div className="p-4 text-sm text-muted-foreground">No employee profile found for this phone.</div>;

  const started = me.approved_at || me.created_at;
  const tenureYears = started ? yearsBetween(started, new Date()) : null;

  const roleLabel = (lookupsQ.data?.designation?.name || me.role_key || "employee").replace(/_/g, " ");

  const insights = (
    <div className="flex flex-col gap-3">
      <SidePanel Icon={Cake} accent="rose" eyebrow="This year" title="Upcoming Birthdays" count={birthdays.length}>
            {birthdays.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No more birthdays this year.</div>
            ) : (
              <ul className="divide-y divide-border/60">
                {birthdays.slice(0, 25).map((b) => {
                  const today = b.days === 0;
                  return (
                    <li key={b.id} className={`flex items-center gap-3 px-4 py-2.5 ${today ? "bg-accent/8" : ""}`}>
                      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent/15 text-[11px] font-bold text-accent ring-1 ring-inset ring-accent/20">
                        {b.photo ? <img src={b.photo} alt="" className="h-full w-full object-cover" /> : initials(b.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-foreground">{b.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{fmt(b.date)} · turning {b.turningAge}</div>
                      </div>
                      <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${today ? "text-accent" : "text-muted-foreground"}`}>{today ? "Today" : `in ${b.days}d`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SidePanel>
          <SidePanel Icon={PartyPopper} accent="amber" eyebrow="This year" title="Work Anniversaries" count={anniversaries.length}>
            {anniversaries.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No more anniversaries this year.</div>
            ) : (
              <ul className="divide-y divide-border/60">
                {anniversaries.slice(0, 25).map((a) => {
                  const today = a.days === 0;
                  return (
                    <li key={a.id} className={`flex items-center gap-3 px-4 py-2.5 ${today ? "bg-accent/8" : ""}`}>
                      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent/15 text-[11px] font-bold text-accent ring-1 ring-inset ring-accent/20">
                        {a.photo ? <img src={a.photo} alt="" className="h-full w-full object-cover" /> : initials(a.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-foreground">{a.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{fmt(a.date)} · {a.years} yr{a.years===1?"":"s"} with RGS</div>
                      </div>
                      <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${today ? "text-accent" : "text-muted-foreground"}`}>{today ? "Today" : `in ${a.days}d`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SidePanel>
    </div>
  );

  return (
    <DashboardShell rightExtras={insights} fixedRightRail>
      <div className="space-y-5">
        <div className="flex flex-col gap-4">
          <header className="flex min-w-0 flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                <ShieldCheck className="h-3.5 w-3.5" /> {roleLabel}
                {me.employee_code && <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{me.employee_code}</span>}
              </div>
              <h1 className="mt-1 truncate text-2xl font-bold text-foreground sm:text-3xl">{me.full_name}</h1>
              {(myUnits.find((u) => u.id === primaryUnitId) ?? unit) && (
                <p className="mt-1 truncate text-xs text-muted-foreground">Primary · {(myUnits.find((u) => u.id === primaryUnitId) ?? unit)?.name}</p>
              )}
            </div>
          </header>

          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <HeroStat label="Present" value={attStats.present} icon={ClipboardCheck} tone="mint" />
            <HeroStat label="ED hrs" value={attStats.ot} icon={CalendarDays} tone="blue" />
            <HeroStat label="Uniform" value={issQ.data?.total ?? 0} icon={Package} tone="amber" to="/admin/my-inventory" />
          </div>
          <div className="min-w-0 [&>*]:h-full">
              {isGuard ? (
                <MarkAttendanceCard candidateId={me.id} allowedUnits={allowedUnits} proximityThresholdM={300} />
              ) : (
                <section className="flex h-full min-h-[180px] flex-col justify-between rounded-3xl border border-border/70 bg-[rgb(var(--tint-blue))] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
                    <span className="rounded-full bg-background px-2.5 py-1 text-[10px] font-semibold text-foreground ring-1 ring-border">{me.status || "Active"}</span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Workplace</div>
                    <h2 className="mt-1 text-lg font-bold text-foreground">{unit?.name || "Assignment pending"}</h2>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{unit?.site_address || "Your assigned workplace will appear here."}</p>
                  </div>
                </section>
              )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section className="min-w-0">
            <div className="mb-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Overview</div>
              <h2 className="mt-1 text-xl font-bold text-foreground">My workspace</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PastelTile palette="teal" label="My attendance" value={attStats.total} hint={new Date().toLocaleString("en-IN", { month: "long" })} delta={0} deltaSuffix="" icon={ClipboardCheck} to="/admin/my-attendance" />
              <PastelTile palette="rose" label="Absent" value={attStats.absent} hint="This month" delta={0} deltaSuffix="" icon={ClipboardCheck} />
              <PastelTile palette="amber" label="Leaves" value={attStats.leave} hint="This month" delta={0} deltaSuffix="" icon={CalendarDays} className="col-span-2 sm:col-span-1" />
            </div>
          </section>
        </div>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
              <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Today</div><h2 className="text-base font-bold text-foreground">My duty</h2></div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-[rgb(var(--tint-sky))] p-3"><dt className="text-[10px] uppercase text-muted-foreground">Starts</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{unit?.shift_start_time || "Not set"}</dd></div>
              <div className="rounded-2xl bg-[rgb(var(--tint-blue))] p-3"><dt className="text-[10px] uppercase text-muted-foreground">Ends</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{unit?.shift_end_time || "Not set"}</dd></div>
              <div className="rounded-2xl bg-[rgb(var(--tint-emerald))] p-3"><dt className="text-[10px] uppercase text-muted-foreground">Extra duty</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{attStats.ot} hrs</dd></div>
              <div className="rounded-2xl bg-[rgb(var(--tint-amber))] p-3"><dt className="text-[10px] uppercase text-muted-foreground">Tenure</dt><dd className="mt-1 font-semibold text-foreground">{tenureYears == null ? "—" : `${tenureYears} yr${tenureYears === 1 ? "" : "s"}`}</dd></div>
            </dl>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
              <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Assignment</div><h2 className="text-base font-bold text-foreground">My units</h2></div>
              <span className="ml-auto rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground ring-1 ring-border">{myUnits.length}</span>
            </div>
            {myUnitsQ.isPending ? (
              <div className="rounded-2xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">Loading assignment…</div>
            ) : myUnits.length === 0 ? <div className="rounded-2xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">No unit assigned yet.</div> : (
              <ul className="space-y-2">
                {[...myUnits].sort((a, b) => Number(b.id === primaryUnitId) - Number(a.id === primaryUnitId)).map((u) => {
                  const isPrimary = u.id === primaryUnitId;
                  return <li key={u.id} className="flex items-center gap-3 rounded-2xl bg-[rgb(var(--tint-violet))] p-3 ring-1 ring-border/70">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{u.name}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{u.site_address || "Location not added"}</span>
                      </span>
                      {(designationByUnit[u.id] || u.code) && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{[designationByUnit[u.id], u.code].filter(Boolean).join(" · ")}</span>}
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                      isPrimary
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
                    )}>{isPrimary ? "Primary" : "Secondary"}</span>
                  </li>;
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Reports to</div><h2 className="text-base font-bold text-foreground">Reporting manager</h2></div></div>
            {!manager ? <div className="rounded-2xl bg-muted/60 p-6 text-center text-sm text-muted-foreground">Not assigned yet.</div> : <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-accent/15 text-sm font-bold text-accent">{manager.photo_url ? <img src={manager.photo_url} alt={`${manager.full_name} profile`} className="h-full w-full object-cover" /> : initials(manager.full_name)}</div>
              <div className="min-w-0"><div className="truncate text-sm font-semibold text-foreground">{manager.full_name}</div><div className="truncate text-xs text-muted-foreground">{manager.designation_id ? desigMap.get(manager.designation_id) ?? "Manager" : "Manager"}</div>{manager.mobile && <div className="mt-1 text-xs text-muted-foreground">{manager.mobile}</div>}</div>
            </div>}
          </div>

          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
            <header className="flex items-center gap-3 border-b border-border/60 px-5 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">My unit</div><h2 className="text-base font-bold text-foreground">Team</h2></div><span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{guardTeam.length}</span></header>
            {guardTeam.length === 0 ? <div className="px-5 py-10 text-center text-sm text-muted-foreground">No teammates listed yet.</div> : <ul className="max-h-[320px] divide-y divide-border/60 overflow-y-auto">{guardTeam.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-3"><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-accent/15 text-xs font-bold text-accent">{t.photo_url ? <img src={t.photo_url} alt={`${t.full_name} profile`} className="h-full w-full object-cover" /> : initials(t.full_name)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-foreground">{t.full_name}</div><div className="truncate text-xs text-muted-foreground">{t.designation_id ? desigMap.get(t.designation_id) ?? "Team member" : "Team member"}</div></div>{t.employee_code && <span className="shrink-0 text-xs text-muted-foreground">{t.employee_code}</span>}</li>)}</ul>}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function SidePanel({
  Icon, accent, eyebrow, title, count, children,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
  eyebrow: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm backdrop-blur-xl">
      <header className="flex items-center gap-3 border-b border-border/50 bg-card px-5 py-3.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${ACCENT_CHIP[accent]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</div>
          <div className="font-display text-[15px] font-bold text-foreground leading-tight">{title}</div>
        </div>
        {count > 0 && (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 px-1.5 text-[10px] font-bold text-accent ring-1 ring-inset ring-accent/20">
            {count}
          </span>
        )}
      </header>
      <div className="max-h-[320px] overflow-y-auto">{children}</div>
    </section>
  );
}

function MetricTile({
  icon: Icon, label, value, accent, sub, to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent: Accent;
  sub?: string;
  to?: string;
}) {
  const display = useCountUp(value);
  const inner = (
    <>
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-semibold text-foreground leading-tight">{label}</div>
          {sub && <div className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
        {to && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-foreground shadow-sm ring-1 ring-black/5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="relative mt-auto flex items-end justify-between gap-3">
        <div className="font-display text-[46px] font-bold leading-none tabular-nums tracking-tight text-foreground">{display}</div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80 ring-1 ring-inset ${ACCENT_CHIP[accent]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </>
  );
  const cls = `group relative flex h-[188px] flex-col overflow-hidden rounded-[26px] border border-border/40 ${ACCENT_TILE_BG[accent]} p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg`;
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;

}

function HeroStat({ label, value, icon: Icon, tone, to }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; tone: "blue" | "mint" | "amber"; to?: string }) {
  const surface = {
    blue: "bg-[rgb(var(--tint-blue))]",
    mint: "bg-[rgb(var(--tint-emerald))]",
    amber: "bg-[rgb(var(--tint-amber))]",
  }[tone];
  const content = (
    <div className={cn("flex min-w-0 flex-col justify-between rounded-xl border border-border/60 p-3 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-sm sm:min-h-[140px] sm:rounded-2xl sm:p-5", surface)}>
      <div className="flex items-start justify-between gap-2"><span className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span><Icon className="h-4 w-4 shrink-0 text-primary" /></div>
      <div className="mt-2 font-display text-[22px] font-bold tabular-nums leading-none text-foreground sm:text-3xl">{value}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{content}</Link> : content;
}

function PastelTile({
  palette, label, value, hint, delta, deltaSuffix, invertColor, icon: Icon, to, className,
}: {
  palette: "lime" | "teal" | "rose" | "amber";
  label: string; value: number | string; hint: string;
  delta: number; deltaSuffix: string; invertColor?: boolean;
  icon: React.ComponentType<{ className?: string }>; to?: string; className?: string;
}) {
  const bg = {
    lime: "bg-[rgb(var(--tint-emerald))]",
    teal: "bg-[rgb(var(--tint-blue))]",
    rose: "bg-[rgb(var(--tint-rose))]",
    amber: "bg-[rgb(var(--tint-amber))]",
  }[palette];

  const positive = invertColor ? delta < 0 : delta > 0;
  const negative = invertColor ? delta > 0 : delta < 0;
  const TrendIcon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendCls = delta === 0
    ? "bg-card/70 text-foreground/60"
    : positive ? "bg-card/85 text-emerald-700 dark:text-emerald-300"
    : negative ? "bg-card/85 text-rose-700 dark:text-rose-300"
    : "bg-card/70 text-foreground/60";

  const inner = (
    <div className={cn("relative flex h-full min-h-[108px] flex-col justify-between overflow-hidden rounded-2xl border border-border/50 p-3 shadow-sm transition-transform hover:-translate-y-0.5 sm:min-h-[132px] sm:rounded-3xl sm:p-5", bg)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold leading-tight text-foreground/80 sm:text-[13px]">{label}</div>
          <div className="mt-0.5 line-clamp-1 text-[10px] text-foreground/60 sm:text-[11px]">{hint}</div>
        </div>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-card/80 text-foreground/70 shadow-sm sm:h-9 sm:w-9">
          <ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2 sm:gap-3">
        <div className="font-display text-[22px] font-bold leading-none tabular-nums tracking-tight text-foreground sm:text-[36px]">
          {value}
        </div>
        <div className="flex flex-col items-end gap-1 sm:gap-1.5">
          {delta !== 0 && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${trendCls}`}>
              <TrendIcon className="h-3 w-3" />
              {delta > 0 ? "+" : ""}{delta}{deltaSuffix}
            </span>
          )}
          <span className="hidden h-7 w-7 place-items-center rounded-full bg-card/70 text-foreground/70 sm:grid">
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to} className={cn("block", className)}>{inner}</Link> : <div className={className}>{inner}</div>;
}

