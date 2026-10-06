import { useMemo, useState } from "react";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, MapPin, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveRange, type RangePreset } from "@/lib/field-visits";
import { FieldSenseRangeFilter } from "@/components/FieldSenseRangeFilter";

type Row = {
  id: string;
  candidate_id: string;
  unit_id: string;
  visit_date: string;
  check_in_at: string;
  check_out_at: string | null;
  customer_rating: number | null;
  candidate: { full_name: string | null; employee_code: string | null } | null;
  unit: {
    name: string | null;
    code: string | null;
    customer: { name: string | null } | null;
  } | null;
};

function whenAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmtHm(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function AdminVisitProgressCard() {
  const mgrScope = useManagerFieldOfficerScope();
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const range = useMemo(
    () => resolveRange(preset, customStart || null, customEnd || null),
    [preset, customStart, customEnd],
  );

  const q = useQuery({
    queryKey: ["admin-visit-progress", range.start, range.end],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("field_visits" as never)
        .select(
          "id, candidate_id, unit_id, visit_date, check_in_at, check_out_at, customer_rating, " +
            "candidate:candidates!inner(full_name, employee_code), " +
            "unit:units!inner(name, code, customer:customers(name))",
        )
        .gte("visit_date", range.start)
        .lte("visit_date", range.end)
        .order("check_in_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = (q.data ?? []).filter((r) => !mgrScope.isScoped || mgrScope.fieldOfficerIds.has(r.candidate_id));
  const inProgress = rows.filter((r) => !r.check_out_at);
  const completed = rows.filter((r) => r.check_out_at);
  const officers = new Set(inProgress.map((r) => r.candidate_id)).size;
  const avgRating = (() => {
    const rated = completed.filter((r) => r.customer_rating != null);
    if (!rated.length) return null;
    const s = rated.reduce((a, r) => a + (r.customer_rating ?? 0), 0);
    return Math.round((s / rated.length) * 10) / 10;
  })();

  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 shadow-sm backdrop-blur-xl sm:rounded-3xl">
      <header className="border-b border-border/50 px-4 py-3 space-y-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Site visits
          </div>
          <h3 className="mt-0.5 font-display text-base font-bold tracking-tight text-foreground">
            Completed vs in-progress · {range.label}
          </h3>
        </div>
        <FieldSenseRangeFilter
          bare
          preset={preset}
          onPresetChange={setPreset}
          customStart={customStart}
          customEnd={customEnd}
          onCustomChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
          resolvedLabel={range.start === range.end ? range.start : `${range.start} → ${range.end}`}
        />
      </header>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-4">
        <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} tone="emerald"
          label="Completed" value={completed.length} />
        <Stat icon={<Clock className="h-3.5 w-3.5" />} tone="amber"
          label="In progress" value={inProgress.length} />
        <Stat icon={<MapPin className="h-3.5 w-3.5" />} tone="sky"
          label="Live officers" value={officers} />
        <Stat icon={<Star className="h-3.5 w-3.5" />} tone="violet"
          label="Avg rating" value={avgRating ?? "—"} />
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-border/50 px-4 py-3 md:grid-cols-2">
        <Column
          title="In progress"
          tone="amber"
          empty="No visits in progress."
          rows={inProgress}
          isLoading={q.isLoading}
          renderMeta={(r) => (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
              </span>
              {fmtHm(r.check_in_at)} · in {whenAgo(r.check_in_at)}
            </span>
          )}
        />
        <Column
          title="Completed"
          tone="emerald"
          empty={preset === "today" ? "No visits completed yet today." : "No completed visits in this range."}
          rows={completed}
          isLoading={q.isLoading}
          renderMeta={(r) => (
            <span className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <span>{fmtHm(r.check_in_at, r.check_out_at)}</span>
              {r.customer_rating != null && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-current" />
                  {r.customer_rating}
                </span>
              )}
            </span>
          )}
        />
      </div>
    </section>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "emerald" | "amber" | "sky" | "violet";
}) {
  const toneCls = {
    emerald: "text-emerald-700 bg-emerald-500/10 ring-emerald-500/20 dark:text-emerald-400",
    amber: "text-amber-700 bg-amber-500/10 ring-amber-500/20 dark:text-amber-400",
    sky: "text-sky-700 bg-sky-500/10 ring-sky-500/20 dark:text-sky-400",
    violet: "text-violet-700 bg-violet-500/10 ring-violet-500/20 dark:text-violet-400",
  }[tone];
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
      <div className={"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 " + toneCls}>
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-black leading-none tracking-tight text-foreground">
        {value}
      </div>
    </div>
  );
}

function Column({
  title, tone, rows, isLoading, empty, renderMeta,
}: {
  title: string;
  tone: "emerald" | "amber";
  rows: Row[];
  isLoading: boolean;
  empty: string;
  renderMeta: (r: Row) => React.ReactNode;
}) {
  const dot = tone === "emerald" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="rounded-xl border border-border/50 bg-card/60">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
          <span className={"h-1.5 w-1.5 rounded-full " + dot} />
          {title}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">
          {rows.length}
        </span>
      </div>
      <ul className="max-h-[280px] divide-y divide-border/50 overflow-y-auto">
        {isLoading && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</li>
        )}
        {!isLoading && rows.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">{empty}</li>
        )}
        {rows.map((r) => {
          const unitLabel = [r.unit?.customer?.name, r.unit?.name].filter(Boolean).join(" — ") || "Client";
          return (
            <li key={r.id} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-foreground">{unitLabel}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {r.candidate?.full_name ?? "—"} · {r.candidate?.employee_code ?? ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px] font-semibold">
                  {renderMeta(r)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
