import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Search, ExternalLink, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMonthPunches,
  distanceMeters,
  formatDistance,
  mapsUrl,
  DEVIATION_THRESHOLD_M,
  type SelfPunch,
} from "@/lib/self-attendance";
import {
  attendanceCodeForShift,
  fetchShiftHoursMap,
  shiftHoursFor,
  DEFAULT_SHIFT_HOURS,
} from "@/lib/shift-hours";

import { MarkAttendanceCard } from "@/components/MarkAttendanceCard";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { signedSelfieUrl } from "@/lib/selfie";

export const Route = createFileRoute("/admin/my-attendance")({
  component: MyAttendancePage,
});

type CodeRow = { code: string; label: string; color: string | null; counts_as_present: boolean; is_paid: boolean; is_leave: boolean; day_value: number | string | null };
type EntryRow = { entry_date: string; code: string; ot_hours: number | string | null };

function ym(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}
function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
function fmtHM(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function duration(a: string | null, b: string | null) {
  if (!a || !b) return "—";
  const mins = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function workedHoursFromPunch(punch: SelfPunch | undefined): number | null {
  if (!punch?.check_in_at || !punch.check_out_at) return null;
  const mins = (new Date(punch.check_out_at).getTime() - new Date(punch.check_in_at).getTime()) / 60000;
  if (!Number.isFinite(mins)) return null;
  return Math.max(0, mins / 60);
}

function punchAttendanceCode(
  punch: SelfPunch | undefined,
  date: string,
  todayIso: string,
  shiftHours: number = DEFAULT_SHIFT_HOURS,
): "P" | "HD" | "A" | null {
  if (!punch?.check_in_at) return null;
  if (!punch.check_out_at) return date < todayIso ? "A" : null;
  const hours = workedHoursFromPunch(punch);
  return hours == null ? null : attendanceCodeForShift(hours, shiftHours);
}

function attendanceDayValue(code: CodeRow | undefined) {
  if (!code) return 0;
  const value = code.day_value == null || Number.isNaN(Number(code.day_value)) ? 1 : Number(code.day_value);
  return Math.max(0, value);
}

function PunchPhoto({ path, title }: { path: string | null | undefined; title: string }) {
  const [open, setOpen] = useState(false);
  const urlQ = useQuery({
    queryKey: ["attendance-selfie-url", path],
    enabled: Boolean(path),
    staleTime: 8 * 60_000,
    queryFn: () => signedSelfieUrl(path),
  });
  if (!path) return null;
  return (
    <>
      <Button type="button" variant="ghost" size="icon" disabled={!urlQ.data} onClick={() => setOpen(true)} className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border/60 p-0" aria-label={`View ${title}`}>
        {urlQ.data ? <img src={urlQ.data} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {urlQ.data && <img src={urlQ.data} alt={title} className="w-full rounded-xl" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MyAttendancePage() {
  const [me, setMe] = useState<{
    candidate_id: string | null;
    name: string;
    code: string;
    role_key: string | null;
    unit_id: string | null;
    designation_id: string | null;
  }>({
    candidate_id: null,
    name: "",
    code: "",
    role_key: null,
    unit_id: null,
    designation_id: null,
  });
  const [monthDate, setMonthDate] = useState<Date>(() => new Date());
  const [search, setSearch] = useState("");

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const em = u.user?.email ?? "";
      const phone = em.match(/phone-(\d{10})@/)?.[1];
      if (!phone) return;
      const { data: c } = await supabase
        .from("candidates")
        .select("id,full_name,employee_code,role_key,unit_id,designation_id")
        .eq("mobile", phone)
        .maybeSingle();
      const row = c as {
        id?: string;
        full_name?: string;
        employee_code?: string;
        role_key?: string;
        unit_id?: string | null;
        designation_id?: string | null;
      } | null;
      setMe({
        candidate_id: row?.id ?? null,
        name: row?.full_name ?? "",
        code: row?.employee_code ?? "",
        role_key: row?.role_key ?? null,
        unit_id: row?.unit_id ?? null,
        designation_id: row?.designation_id ?? null,
      });
    })();
  }, []);


  const ymKey = ym(monthDate);

  const codesQ = useQuery({
    queryKey: ["self-attendance-codes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance_codes" as never)
        .select("code,label,color,counts_as_present,is_paid,is_leave,day_value");
      return (data ?? []) as CodeRow[];
    },
  });

  const punchQ = useQuery({
    queryKey: ["self-attendance-month", me.candidate_id, ymKey],
    enabled: !!me.candidate_id,
    queryFn: () => fetchMonthPunches(me.candidate_id!, ymKey),
  });

  const entriesQ = useQuery({
    queryKey: ["self-attendance-entries-month", me.candidate_id, ymKey],
    enabled: !!me.candidate_id,
    queryFn: async () => {
      const [y, m] = ymKey.split("-").map(Number);
      const first = `${ymKey}-01`;
      const nextD = new Date(y, m, 1);
      const last = iso(nextD);
      const { data } = await supabase
        .from("attendance_entries")
        .select("entry_date,code,ot_hours")
        .eq("candidate_id", me.candidate_id!)
        .gte("entry_date", first)
        .lt("entry_date", last);
      return (data ?? []) as EntryRow[];
    },
  });

  const isGuard = me.role_key === "guard" || me.role_key === "security_guard";
  const guardUnitsQ = useQuery({
    queryKey: ["my-guard-units", me.candidate_id],
    enabled: !!me.candidate_id && isGuard,
    queryFn: async () => {
      const { data: cu } = await supabase
        .from("candidate_units")
        .select("unit_id,is_primary,is_reliever")
        .eq("candidate_id", me.candidate_id!);
      const ids = Array.from(new Set(
        ((cu ?? []) as Array<{ unit_id: string | null; is_primary: boolean | null; is_reliever: boolean | null }>)
          .filter((r) => r.is_primary === true && r.is_reliever !== true)
          .map((r) => r.unit_id)
          .filter(Boolean),
      )) as string[];
      if (ids.length === 0) return [];
      const { data: units } = await supabase
        .from("units")
        .select("id,name,latitude,longitude")
        .in("id", ids);
      return ((units ?? []) as Array<{ id: string; name: string; latitude: number | null; longitude: number | null }>).map((u) => ({
        id: u.id,
        name: u.name,
        latitude: u.latitude,
        longitude: u.longitude,
      }));
    },
  });


  // Contractual shift length (8h / 12h) drives half-day + OT thresholds.
  const shiftQ = useQuery({
    queryKey: ["shift-hours-map", me.unit_id],
    enabled: !!me.unit_id,
    queryFn: () => fetchShiftHoursMap([me.unit_id!]),
  });
  const myShiftHours = shiftHoursFor(shiftQ.data, me.unit_id, me.designation_id) || DEFAULT_SHIFT_HOURS;

  const codeMap = useMemo(() => {
    const m = new Map<string, CodeRow>();
    for (const c of codesQ.data ?? []) m.set(c.code, c);
    return m;
  }, [codesQ.data]);

  const byDay = useMemo(() => {
    const m = new Map<string, { punch?: SelfPunch; entry?: EntryRow }>();
    for (const p of punchQ.data ?? []) m.set(p.punch_date, { ...(m.get(p.punch_date) || {}), punch: p });
    for (const e of entriesQ.data ?? []) m.set(e.entry_date, { ...(m.get(e.entry_date) || {}), entry: e });
    return m;
  }, [punchQ.data, entriesQ.data]);

  const days = useMemo(() => {
    const y = monthDate.getFullYear();
    const mo = monthDate.getMonth() + 1;
    const n = daysInMonth(y, mo);
    const todayIso = iso(new Date());
    const list: Array<{ date: string; day: number; weekday: string; isFuture: boolean; isToday: boolean }> = [];
    for (let d = 1; d <= n; d++) {
      const date = iso(new Date(y, mo - 1, d));
      const wd = new Date(y, mo - 1, d).toLocaleDateString([], { weekday: "short" });
      list.push({ date, day: d, weekday: wd, isFuture: date > todayIso, isToday: date === todayIso });
    }
    return list.reverse();
  }, [monthDate]);

  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return days;
    return days.filter((d) => d.date.includes(q) || String(d.day).padStart(2, "0") === q);
  }, [days, search]);

  const totals = useMemo(() => {
    let present = 0, absent = 0, leave = 0;
    const todayIso = iso(new Date());
    for (const d of days) {
      if (d.isFuture) continue;
      const rec = byDay.get(d.date);
      const punchCode = punchAttendanceCode(rec?.punch, d.date, todayIso, myShiftHours);
      if (rec?.punch?.check_in_at && !rec.punch.check_out_at && !punchCode) continue;
      const code = punchCode ? codeMap.get(punchCode) : rec?.entry?.code ? codeMap.get(rec.entry.code) : undefined;
      if (code?.is_leave) leave += attendanceDayValue(code);
      else if (code?.counts_as_present || code?.is_paid) present += attendanceDayValue(code);
      else absent += 1;
    }
    return { present, absent, leave };
  }, [days, byDay, codeMap, myShiftHours]);

  function shiftMonth(delta: number) {
    const d = new Date(monthDate);
    d.setDate(1);
    d.setMonth(d.getMonth() + delta);
    setMonthDate(d);
  }

  const monthLabel = monthDate.toLocaleDateString([], { month: "long", year: "numeric" });

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="My Attendance"
        description={me.name ? `${me.name}${me.code ? ` · ${me.code}` : ""}` : "Track your own check-in / check-out"}
        crumbs={[{ label: "Home", to: "/" }, { label: "My Attendance" }]}
      />

      <MarkAttendanceCard
        candidateId={me.candidate_id}
        allowedUnits={isGuard ? (guardUnitsQ.data ?? []) : undefined}
        proximityThresholdM={300}
      />


      {/* Month picker + totals */}
      <section className="rounded-3xl border border-border/60 bg-card/95 p-4 shadow-sm backdrop-blur-xl sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5 font-display text-[15px] font-bold tracking-tight sm:text-lg">
              <Calendar className="h-4 w-4 text-muted-foreground" /> {monthLabel}
            </div>
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              Monthly attendance
            </div>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 min-[320px]:grid-cols-3 gap-2 sm:gap-3">
          <StatBox label="Present" value={totals.present} tone="emerald" />
          <StatBox label="Absent" value={totals.absent} tone="rose" />
          <StatBox label="Leave" value={totals.leave} tone="sky" />
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by day (e.g. 05)"
            className="h-11 rounded-2xl border-border/60 bg-background/80 pl-10 text-sm"
          />
        </div>
      </section>

      {/* Day cards */}
      <section className="space-y-2.5">
        {filteredDays.map((d) => {
          const rec = byDay.get(d.date);
          const p = rec?.punch;
          const todayIso = iso(new Date());
          const punchCode = punchAttendanceCode(p, d.date, todayIso, myShiftHours);
          const code = punchCode ? codeMap.get(punchCode) : rec?.entry?.code ? codeMap.get(rec.entry.code) : undefined;
          const punchDuration = p?.check_in_at && p.check_out_at ? duration(p.check_in_at, p.check_out_at) : null;
          type Tone = "emerald" | "rose" | "amber" | "sky" | "muted";
          const badge: { label: string; tone: Tone } = p?.check_in_at
            ? code && (p.check_out_at || punchCode === "A")
              ? { label: `${code.label || code.code}${punchDuration ? ` · ${punchDuration}` : ""}`, tone: code.counts_as_present ? "emerald" : code.is_paid ? "amber" : "rose" }
              : { label: "On duty", tone: "amber" }
            : code
            ? { label: `${code.label || code.code}`, tone: code.is_leave ? "sky" : code.counts_as_present ? "emerald" : code.is_paid ? "amber" : "rose" }
            : d.isFuture
            ? { label: "—", tone: "muted" }
            : { label: "Absent", tone: "rose" };

          const inUrl = mapsUrl(p?.check_in_lat, p?.check_in_lng);
          const outUrl = mapsUrl(p?.check_out_lat, p?.check_out_lng);
          const dist = distanceMeters(
            p?.check_in_lat != null && p?.check_in_lng != null ? { lat: p.check_in_lat, lng: p.check_in_lng } : null,
            p?.check_out_lat != null && p?.check_out_lng != null ? { lat: p.check_out_lat, lng: p.check_out_lng } : null,
          );
          const deviated = dist != null && dist > DEVIATION_THRESHOLD_M;
          const dateObj = new Date(d.date);
          const monthAbbr = dateObj.toLocaleDateString([], { month: "short" });

          return (
            <div
              key={d.date}
              className={cn(
                "flex items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4",
                d.isToday && "ring-2 ring-primary/40 border-primary/30",
              )}
            >
              {/* Date pill */}
              <div className={cn(
                "flex w-14 shrink-0 flex-col items-center justify-center rounded-xl px-1 py-2",
                d.isToday ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-foreground",
              )}>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                  {monthAbbr}
                </div>
                <div className="font-display text-xl font-bold leading-none tabular-nums">
                  {d.date.slice(8)}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                  {d.weekday}
                </div>
              </div>

              {/* Body */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <StatusBadge label={badge.label} tone={badge.tone} />
                  {d.isToday && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      Today
                    </span>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5">
                    <PunchPhoto path={p?.check_in_selfie_path} title={`${d.date} log in photo`} />
                    <div className="min-w-0">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">In</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold tabular-nums text-foreground">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {fmtHM(p?.check_in_at ?? null)}
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5">
                    <PunchPhoto path={p?.check_out_selfie_path} title={`${d.date} log out photo`} />
                    <div className="min-w-0">
                      <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Out</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold tabular-nums text-foreground">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {fmtHM(p?.check_out_at ?? null)}
                      </div>
                    </div>
                  </div>
                </div>

                {(inUrl || outUrl || dist != null) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    {inUrl && (
                      <a href={inUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                        <MapPin className="h-3 w-3" /> In map
                        <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                      </a>
                    )}
                    {outUrl && (
                      <a href={outUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                        <MapPin className="h-3 w-3" /> Out map
                        <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                      </a>
                    )}
                    {dist != null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold",
                          deviated
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
                        )}
                      >
                        {deviated && <AlertTriangle className="h-3 w-3" />}
                        {deviated ? "Deviation" : "Same spot"} · {formatDistance(dist)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredDays.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/60 px-4 py-10 text-center text-sm text-muted-foreground">
            No days match your search.
          </div>
        )}
      </section>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "sky" }) {
  const map = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20",
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20",
  } as const;
  return (
    <div className={cn("rounded-xl px-3 py-2.5 ring-1", map[tone])}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "emerald" | "rose" | "amber" | "sky" | "muted" }) {
  const map = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20",
    muted: "bg-muted text-muted-foreground ring-border/60",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", map[tone])}>
      {label}
    </span>
  );
}
