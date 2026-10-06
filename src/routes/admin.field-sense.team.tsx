import { createFileRoute, Link } from "@tanstack/react-router";
import { FieldSenseAdminGuard } from "@/components/FieldSenseAdminGuard";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeLivePunches } from "@/lib/use-live-location-beacon";
import { ArrowUpRight, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signedSelfieUrl } from "@/lib/selfie";

function SelfieThumb({ path, title, initial }: { path: string | null; title: string; initial?: string }) {
  const [open, setOpen] = useState(false);
  const urlQ = useQuery({ queryKey: ["selfie-url", path], enabled: !!path, staleTime: 8 * 60_000, queryFn: () => signedSelfieUrl(path) });
  if (!path || !urlQ.data) {
    if (initial == null) return <div className="h-8 w-8 shrink-0 rounded-lg border border-border/60 bg-muted/30" />;
    return (
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100 text-[12px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
        {initial}
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-8 w-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-border" aria-label={`View ${title} photo`}>
        <img src={urlQ.data} alt="" className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <img src={urlQ.data} alt={title} className="w-full rounded-2xl" />
        </DialogContent>
      </Dialog>
    </>
  );
}

export const Route = createFileRoute("/admin/field-sense/team")({
  component: () => (<FieldSenseAdminGuard sub="day_patrol"><MyTeamPage /></FieldSenseAdminGuard>),
  validateSearch: (s: Record<string, unknown>): { date?: string } => ({
    date: (s.date as string | undefined) ?? undefined,
  }),
  head: () => ({
    meta: [
      { title: "Radar — Day Patrol" },
      { name: "description", content: "Field officer roster with punch-in status, current location and travel distance." },
    ],
  }),
});

function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Row = {
  id: string;
  full_name: string;
  employee_code: string | null;
  punch_in: string | null;
  punch_out: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  in_meeting_unit: string | null;
  work_ms: number | null;
  km_today: number;
  selfie_in: string | null;
  selfie_out: string | null;
  status: "in_meeting" | "in_transit" | "punched_in" | "not_punched" | "checkout_missing";
};


function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fmtDur(ms: number | null) {
  if (ms == null) return "—";
  if (ms <= 0) return "0:00 hrs";
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")} hrs`;
}


function timeShort(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function MyTeamPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string>(search.date || todayIso());

  // Live: refresh the moment any officer's telemetry changes.
  useEffect(() => subscribeLivePunches(() => {
    void qc.invalidateQueries({ queryKey: ["field-sense-team", selectedDate] });
  }), [qc, selectedDate]);

  const dataQ = useQuery({
    queryKey: ["field-sense-team", selectedDate],
    refetchInterval: selectedDate === todayIso() ? 15_000 : false,
    staleTime: selectedDate === todayIso() ? 15_000 : 5 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: Row[]; total: number }> => {
      const [foRes, punchRes, visitsRes, tracksRes, unitsRes] = await Promise.all([
        supabase
          .from("candidates" as never)
          .select("id, full_name, employee_code")
          .eq("role_key", "field_officer")
          .in("status", ["approved", "active"])
          .order("full_name", { ascending: true }),
        supabase
          .from("self_attendance_punches" as never)
          .select("candidate_id, check_in_at, check_out_at, last_lat, last_lng, last_seen_at, distance_km, check_in_selfie_path, check_out_selfie_path")
          .eq("punch_date", selectedDate),
        supabase
          .from("field_visits" as never)
          .select("candidate_id, unit_id, check_in_at, check_out_at")
          .eq("visit_date", selectedDate),
        Promise.resolve({ data: [] as unknown[] }),
        supabase.from("units" as never).select("id, name").limit(5000),
      ]);

      const fos = ((foRes.data ?? []) as unknown) as Array<{ id: string; full_name: string; employee_code: string | null }>;
      const punches = ((punchRes.data ?? []) as unknown) as Array<{
        candidate_id: string;
        check_in_at: string | null;
        check_out_at: string | null;
        last_lat: number | null;
        last_lng: number | null;
        last_seen_at: string | null;
        distance_km: number | string | null;
        check_in_selfie_path: string | null;
        check_out_selfie_path: string | null;
      }>;
      const visits = ((visitsRes.data ?? []) as unknown) as Array<{
        candidate_id: string;
        unit_id: string;
        check_in_at: string | null;
        check_out_at: string | null;
      }>;
      const tracks = ((tracksRes.data ?? []) as unknown) as Array<{
        candidate_id: string;
        lat: number | string;
        lng: number | string;
      }>;
      const unitMap = new Map(
        (((unitsRes.data ?? []) as unknown) as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]),
      );

      const punchByCand = new Map(punches.map((p) => [p.candidate_id, p]));
      const activeVisitByCand = new Map<string, string>();
      for (const v of visits) {
        if (v.check_in_at && !v.check_out_at) {
          activeVisitByCand.set(v.candidate_id, unitMap.get(v.unit_id) ?? "Site");
        }
      }
      const kmByCand = new Map<string, number>();
      const grouped = new Map<string, Array<{ lat: number; lng: number }>>();
      for (const t of tracks) {
        const arr = grouped.get(t.candidate_id) ?? [];
        arr.push({ lat: Number(t.lat), lng: Number(t.lng) });
        grouped.set(t.candidate_id, arr);
      }
      for (const [cid, pts] of grouped) {
        let m = 0;
        for (let i = 1; i < pts.length; i += 1) m += haversineM(pts[i - 1], pts[i]);
        kmByCand.set(cid, m / 1000);
      }

      const isToday = selectedDate === todayIso();
      const isPast = selectedDate < todayIso();

      const rows: Row[] = fos.map((f) => {
        const p = punchByCand.get(f.id);
        const inMeetingUnit = activeVisitByCand.get(f.id) ?? null;
        let status: Row["status"] = "not_punched";
        if (p?.check_in_at) {
          if (p.check_out_at) status = "punched_in";
          else if (isPast) status = "checkout_missing";
          else if (inMeetingUnit) status = "in_meeting";
          else status = "in_transit";
        }
        let workMs: number | null = null;
        if (p?.check_in_at) {
          if (p.check_out_at) {
            workMs = new Date(p.check_out_at).getTime() - new Date(p.check_in_at).getTime();
          } else if (isToday) {
            workMs = Date.now() - new Date(p.check_in_at).getTime();
          } else {
            workMs = null; // past day with no checkout — do not accrue
          }
        }
        return {
          id: f.id,
          full_name: f.full_name,
          employee_code: f.employee_code,
          punch_in: p?.check_in_at ?? null,
          punch_out: p?.check_out_at ?? null,
          last_lat: p?.last_lat ?? null,
          last_lng: p?.last_lng ?? null,
          last_seen_at: p?.last_seen_at ?? null,
          in_meeting_unit: inMeetingUnit,
          work_ms: workMs != null ? Math.max(0, workMs) : null,
          km_today: Number((p?.distance_km != null && Number.isFinite(Number(p.distance_km)) ? Number(p.distance_km) : kmByCand.get(f.id) ?? 0).toFixed(2)),
          selfie_in: p?.check_in_selfie_path ?? null,
          selfie_out: p?.check_out_selfie_path ?? null,
          status,
        };
      });
      return { rows, total: fos.length };
    },
  });


  const rows = dataQ.data?.rows ?? [];
  const total = dataQ.data?.total ?? 0;
  const isPast = selectedDate < todayIso();
  const punchedIn = rows.filter((r) => r.punch_in && !r.punch_out).length;
  const inMeeting = rows.filter((r) => r.status === "in_meeting").length;
  const inTransit = rows.filter((r) => r.status === "in_transit").length;
  const checkoutMissing = rows.filter((r) => r.status === "checkout_missing").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Day Patrol"
        description="Live snapshot of field officers — punch-in, current location and travel today."
        crumbs={[
          { label: "Admin", to: "/admin/dashboard" },
          { label: "Radar", to: "/admin/field-sense" },
          { label: "Day Patrol" },
        ]}
      />

      {/* Filter + counters */}
      <section className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            Date
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || todayIso())}
              className="rounded-md border border-border bg-background px-2 py-1 text-[12px] font-semibold text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={() => setSelectedDate(todayIso())}
            className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Today
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
            <Counter label="Punched-In" value={`${punchedIn}/${total}`} tone="sky" />
            <Counter label="In Meeting" value={inMeeting} tone="emerald" />
            {isPast ? (
              <Counter label="Checkout missing" value={checkoutMissing} tone="amber" />
            ) : (
              <Counter label="In Transit" value={inTransit} tone="amber" />
            )}
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="hidden grid-cols-[minmax(160px,1.4fr)_minmax(160px,1.4fr)_minmax(120px,1fr)_130px_130px_100px_90px_44px] items-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground md:grid">
          <div>Name</div>
          <div>Location</div>
          <div>Status</div>
          <div>Punched-in</div>
          <div>Punched-out</div>
          <div>Work</div>
          <div>Travel</div>
          <div />
        </div>
        {dataQ.isLoading ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground">Loading team…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground">No field officers found.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r) => (
              <TeamRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number | string; tone: "sky" | "emerald" | "amber" }) {
  const toneCls =
    tone === "sky" ? "text-sky-700 dark:text-sky-300" : tone === "emerald" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300";
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className={`font-display text-lg font-bold tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

function StatusPill({ row }: { row: Row }) {
  const map: Record<Row["status"], { label: string; cls: string }> = {
    in_meeting: { label: row.in_meeting_unit ? `In Meeting · ${row.in_meeting_unit}` : "In Meeting", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
    in_transit: { label: "In Transit", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300" },
    punched_in: { label: "Ended shift", cls: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300" },
    not_punched: { label: "Not Punched In", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
    checkout_missing: { label: "Checkout missing", cls: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300" },
  };
  const it = map[row.status];
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${it.cls}`}>
      <span className="truncate">{it.label}</span>
    </span>
  );
}

function LocationCell({ row }: { row: Row }) {
  if (row.last_lat == null || row.last_lng == null) {
    return <span className="text-[11px] italic text-muted-foreground">no ping yet</span>;
  }
  const href = `https://www.google.com/maps/search/?api=1&query=${row.last_lat},${row.last_lng}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 truncate text-[12px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
    >
      <MapPin className="h-3.5 w-3.5 flex-none" />
      <span className="truncate font-mono">{Number(row.last_lat).toFixed(4)}, {Number(row.last_lng).toFixed(4)}</span>
    </a>
  );
}

function TeamRow({ row }: { row: Row }) {
  const initial = row.full_name.trim().charAt(0).toUpperCase();
  const dot = row.punch_in && !row.punch_out ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600";
  const linkProps = {
    to: "/admin/field-sense/officer/$id" as const,
    params: { id: row.id },
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(160px,1.4fr)_minmax(160px,1.4fr)_minmax(120px,1fr)_130px_130px_100px_90px_44px]">
      {/* Name */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`relative flex h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100 text-[12px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">{initial}</div>
        <div className="min-w-0">
          <Link {...linkProps} className="block truncate text-[13px] font-semibold text-foreground hover:underline">
            {row.full_name}
          </Link>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{row.employee_code ?? "—"}</div>
        </div>
      </div>

      {/* Mobile: stacked meta chips */}
      <div className="flex shrink-0 items-center gap-2 md:hidden">
        <StatusPill row={row} />
        <Link {...linkProps} className="grid h-8 w-8 place-items-center rounded-full border border-border/60 text-muted-foreground hover:text-foreground">
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 md:hidden">
        <div className="text-[11px] text-muted-foreground">In {timeShort(row.punch_in)} · Out {timeShort(row.punch_out)}</div>
        <div className="text-[11px] font-semibold text-foreground">{fmtDur(row.work_ms)}</div>
        <div className="text-[11px] font-semibold text-foreground">{row.km_today.toFixed(2)} km</div>
        <LocationCell row={row} />
      </div>

      {/* Desktop cells */}
      <div className="hidden min-w-0 md:block">
        <LocationCell row={row} />
      </div>
      <div className="hidden min-w-0 md:block">
        <StatusPill row={row} />
      </div>
      <div className="hidden items-center gap-2 text-[12px] font-semibold text-foreground md:flex">
        {row.punch_in && <SelfieThumb path={row.selfie_in} title={`${row.full_name} · Log in`} />}
        {timeShort(row.punch_in)}
      </div>
      <div className="hidden items-center gap-2 text-[12px] font-semibold text-foreground md:flex">
        {row.punch_out && <SelfieThumb path={row.selfie_out} title={`${row.full_name} · Log out`} />}
        {timeShort(row.punch_out)}
      </div>
      <div className="hidden text-[12px] font-semibold tabular-nums text-foreground md:block">{fmtDur(row.work_ms)}</div>
      <div className="hidden text-[12px] font-semibold tabular-nums text-foreground md:block">{row.km_today.toFixed(2)} km</div>
      <Link
        {...linkProps}
        className="hidden h-8 w-8 place-items-center rounded-full border border-border/60 text-muted-foreground hover:border-sky-300 hover:text-sky-700 md:grid"
        aria-label={`Open map for ${row.full_name}`}
      >
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </li>
  );
}
