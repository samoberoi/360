import { useMemo } from "react";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Radio, Send, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listRecentRequestsAdmin, type FieldVisitRequest, type FieldVisitRequestPriority, type FieldVisitRequestStatus } from "@/lib/field-visit-requests";
import { cn } from "@/lib/utils";

type Meta = {
  candidateById: Map<string, { full_name: string; employee_code: string | null }>;
  unitById: Map<string, { name: string; customer_name: string | null }>;
};

async function loadMeta(): Promise<Meta> {
  const [candRes, unitRes, custRes] = await Promise.all([
    supabase.from("candidates" as never).select("id, full_name, employee_code").eq("role_key", "field_officer"),
    supabase.from("units" as never).select("id, name, customer_id"),
    supabase.from("customers" as never).select("id, name"),
  ]);
  const cust = new Map(
    ((custRes.data ?? []) as unknown as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );
  const candidateById = new Map(
    ((candRes.data ?? []) as unknown as Array<{ id: string; full_name: string; employee_code: string | null }>).map(
      (c) => [c.id, { full_name: c.full_name, employee_code: c.employee_code }],
    ),
  );
  const unitById = new Map(
    ((unitRes.data ?? []) as unknown as Array<{ id: string; name: string; customer_id: string | null }>).map((u) => [
      u.id,
      { name: u.name, customer_name: u.customer_id ? cust.get(u.customer_id) ?? null : null },
    ]),
  );
  return { candidateById, unitById };
}

const STAGES: Array<{ key: FieldVisitRequestStatus; label: string; icon: typeof Send }> = [
  { key: "pending", label: "Sent", icon: Send },
  { key: "acknowledged", label: "Acknowledged", icon: Radio },
  { key: "in_progress", label: "In progress", icon: Zap },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
];

function stageIndex(s: FieldVisitRequestStatus): number {
  if (s === "cancelled") return -1;
  const i = STAGES.findIndex((x) => x.key === s);
  return i < 0 ? 0 : i;
}

function priorityTone(p: FieldVisitRequestPriority) {
  if (p === "emergency") return "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300";
  if (p === "high") return "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300";
  return "bg-slate-500/15 text-slate-700 ring-slate-500/30 dark:text-slate-300";
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Timeline({ req }: { req: FieldVisitRequest }) {
  const cur = stageIndex(req.status);
  const cancelled = req.status === "cancelled";
  return (
    <div className="mt-2 flex items-center gap-1">
      {STAGES.map((st, i) => {
        const done = !cancelled && i <= cur;
        const active = !cancelled && i === cur;
        const Icon = st.icon;
        return (
          <div key={st.key} className="flex flex-1 items-center gap-1">
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 transition",
                cancelled
                  ? "bg-muted text-muted-foreground ring-border/60"
                  : done
                  ? "bg-primary text-primary-foreground ring-primary/40"
                  : "bg-muted text-muted-foreground ring-border/60",
                active && !cancelled && "shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]",
              )}
              title={st.label}
            >
              <Icon className="h-2.5 w-2.5" />
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  "h-0.5 flex-1 rounded",
                  cancelled ? "bg-muted" : i < cur ? "bg-primary" : "bg-border/60",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AdminEscalationRequestsCard() {
  const mgrScope = useManagerFieldOfficerScope();
  const reqQ = useQuery({
    queryKey: ["admin-fvr-recent"],
    queryFn: () => listRecentRequestsAdmin(50),
    refetchInterval: 20_000,
  });
  const metaQ = useQuery({ queryKey: ["admin-fvr-meta"], queryFn: loadMeta, staleTime: 60_000 });

  const rows = useMemo(() => {
    const list = (reqQ.data ?? []).filter((r) => !mgrScope.isScoped || mgrScope.fieldOfficerIds.has(r.candidate_id));
    // Sort: active first (pending/ack/in_progress), then most recent
    const rank = (r: FieldVisitRequest) =>
      r.status === "cancelled" ? 4 : r.status === "completed" ? 3 : r.status === "in_progress" ? 0 : r.status === "acknowledged" ? 1 : 2;
    return [...list].sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [reqQ.data, mgrScope.isScoped, mgrScope.fieldOfficerIds]);

  const counts = useMemo(() => {
    const c = { pending: 0, acknowledged: 0, in_progress: 0, completed: 0 };
    for (const r of reqQ.data ?? []) {
      if (r.status === "pending") c.pending += 1;
      else if (r.status === "acknowledged") c.acknowledged += 1;
      else if (r.status === "in_progress") c.in_progress += 1;
      else if (r.status === "completed") c.completed += 1;
    }
    return c;
  }, [reqQ.data]);

  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 shadow-sm backdrop-blur-xl sm:rounded-3xl">
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Escalation tracker
          </div>
          <h3 className="mt-0.5 font-display text-base font-bold tracking-tight text-foreground">
            Site visit requests
          </h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[10px] font-bold">
          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300">
            {counts.pending} sent
          </span>
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-600 ring-1 ring-sky-500/20 dark:text-sky-300">
            {counts.acknowledged} ack
          </span>
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-300">
            {counts.in_progress} in progress
          </span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300">
            {counts.completed} done
          </span>
        </div>
      </header>

      <ul className="max-h-[420px] divide-y divide-border/50 overflow-y-auto">
        {reqQ.isLoading && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">Loading escalations…</li>
        )}
        {!reqQ.isLoading && rows.length === 0 && (
          <li className="flex flex-col items-center gap-1 px-4 py-8 text-center text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 opacity-60" />
            No site visit requests raised yet.
          </li>
        )}
        {rows.map((r) => {
          const fo = metaQ.data?.candidateById.get(r.candidate_id);
          const unit = metaQ.data?.unitById.get(r.unit_id);
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ring-1",
                        priorityTone(r.priority),
                      )}
                    >
                      {r.priority === "emergency" ? "Emergency" : r.priority === "high" ? "High" : "Normal"}
                    </span>
                    <span className="truncate text-[12.5px] font-semibold text-foreground">
                      {unit?.customer_name ? `${unit.customer_name} — ` : ""}
                      {unit?.name ?? "Client"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>
                      To <span className="font-semibold text-foreground/80">{fo?.full_name ?? "Field officer"}</span>
                      {fo?.employee_code ? ` · ${fo.employee_code}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {relTime(r.created_at)}
                    </span>
                  </div>
                  {r.reason && (
                    <div className="mt-1 line-clamp-2 rounded-lg bg-muted/40 px-2 py-1 text-[11px] text-foreground/80">
                      {r.reason}
                    </div>
                  )}
                </div>
                {r.status === "cancelled" && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    Cancelled
                  </span>
                )}
              </div>
              <Timeline req={r} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
                <span>Sent {relTime(r.created_at)}</span>
                <span>
                  {r.acknowledged_at ? `Ack ${relTime(r.acknowledged_at)}` : "Awaiting ack"}
                </span>
                <span>
                  {r.completed_at
                    ? `Completed ${relTime(r.completed_at)}`
                    : r.status === "in_progress"
                    ? "Visit in progress"
                    : "—"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
