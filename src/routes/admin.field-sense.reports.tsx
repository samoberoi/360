import { createFileRoute } from "@tanstack/react-router";
import { FieldSenseAdminGuard } from "@/components/FieldSenseAdminGuard";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { RANGE_PRESETS, resolveRange, type RangePreset } from "@/lib/field-visits";
import { FieldSenseRangeFilter } from "@/components/FieldSenseRangeFilter";
import radiantLogo from "@/assets/radiant-logo-v2.png";
import { DataPagination, usePagination } from "@/components/DataPagination";

export const Route = createFileRoute("/admin/field-sense/reports")({
  component: () => (<FieldSenseAdminGuard sub="reports"><ReportsPage /></FieldSenseAdminGuard>),
  head: () => ({
    meta: [
      { title: "Radar Reports — PLUS 360" },
      { name: "description", content: "Branded, downloadable visit reports for any organization or client across any date range." },
      { property: "og:title", content: "Radar Reports" },
      { property: "og:description", content: "Branded, downloadable visit reports for any organization or client across any date range." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

// --------------------------- types ---------------------------

type Customer = { id: string; name: string; short_name: string | null };
type Unit = { id: string; name: string | null; code: string; customer_id: string | null };
type VisitRow = {
  id: string;
  candidate_id: string;
  unit_id: string;
  visit_date: string;
  visit_seq: number;
  check_in_at: string;
  check_out_at: string | null;
  customer_rating: number | null;
  visit_notes: string | null;
  client_name: string | null;
};
type Candidate = { id: string; full_name: string; employee_code: string | null };

// --------------------------- helpers ---------------------------

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDur(a: string, b: string | null): string {
  if (!b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// --------------------------- page ---------------------------

function ReportsPage() {
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [unitIds, setUnitIds] = useState<string[]>([]); // empty = all
  const [downloading, setDownloading] = useState(false);


  const range = useMemo(
    () => resolveRange(preset, customStart || null, customEnd || null),
    [preset, customStart, customEnd],
  );

  // Customers with at least one unit
  const custQ = useQuery({
    queryKey: ["reports-customers"],
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase
        .from("customers" as never)
        .select("id, name, short_name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Customer[];
    },
  });

  // Units for selected customer
  const unitQ = useQuery({
    queryKey: ["reports-units", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<Unit[]> => {
      const { data, error } = await supabase
        .from("units" as never)
        .select("id, name, code, customer_id")
        .eq("customer_id", customerId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Unit[];
    },
  });

  const activeUnitIds = useMemo(() => {
    const all = (unitQ.data ?? []).map((u) => u.id);
    if (!customerId) return [];
    return unitIds.length === 0 ? all : unitIds.filter((id) => all.includes(id));
  }, [customerId, unitQ.data, unitIds]);

  // Visits within range for selected units
  const visitQ = useQuery({
    queryKey: ["reports-visits", range.start, range.end, activeUnitIds.join(",")],
    enabled: activeUnitIds.length > 0,
    queryFn: async () => {
      const { data: vRows, error: vErr } = await supabase
        .from("field_visits" as never)
        .select("id, candidate_id, unit_id, visit_date, visit_seq, check_in_at, check_out_at, customer_rating, visit_notes, client_name")
        .in("unit_id", activeUnitIds)
        .gte("visit_date", range.start)
        .lte("visit_date", range.end)
        .order("visit_date", { ascending: false })
        .order("check_in_at", { ascending: false });
      if (vErr) throw vErr;
      const visits = (vRows ?? []) as unknown as VisitRow[];

      const candIds = Array.from(new Set(visits.map((v) => v.candidate_id)));
      let cands: Candidate[] = [];
      if (candIds.length) {
        const { data: cRows } = await supabase
          .from("candidates" as never)
          .select("id, full_name, employee_code")
          .in("id", candIds);
        cands = (cRows ?? []) as unknown as Candidate[];
      }
      return { visits, candMap: new Map(cands.map((c) => [c.id, c])) };
    },
  });

  const visits = visitQ.data?.visits ?? [];
  const pg = usePagination(visits);
  const candMap = visitQ.data?.candMap ?? new Map<string, Candidate>();
  const unitMap = useMemo(() => new Map((unitQ.data ?? []).map((u) => [u.id, u])), [unitQ.data]);
  const customer = (custQ.data ?? []).find((c) => c.id === customerId) ?? null;

  // Summary
  const summary = useMemo(() => {
    let completed = 0;
    let rated = 0;
    let ratingSum = 0;
    const perOfficer = new Map<string, number>();
    const perUnit = new Map<string, number>();
    for (const v of visits) {
      if (v.check_out_at) completed += 1;
      if (v.customer_rating != null) {
        rated += 1;
        ratingSum += v.customer_rating;
      }
      perOfficer.set(v.candidate_id, (perOfficer.get(v.candidate_id) ?? 0) + 1);
      perUnit.set(v.unit_id, (perUnit.get(v.unit_id) ?? 0) + 1);
    }
    return {
      total: visits.length,
      completed,
      inProgress: visits.length - completed,
      avgRating: rated > 0 ? ratingSum / rated : null,
      ratedCount: rated,
      officers: perOfficer.size,
      unitsCovered: perUnit.size,
    };
  }, [visits]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const { generateReportPdf } = await import("@/lib/field-sense-report-pdf");
      await generateReportPdf({
        logoSrc: radiantLogo,
        customerName: customer?.name ?? "All organizations",
        unitNames: unitIds.length === 0
          ? ["All clients"]
          : activeUnitIds.map((id) => unitMap.get(id)?.name || unitMap.get(id)?.code || "Client"),
        rangeLabel: range.label,
        rangeStart: range.start,
        rangeEnd: range.end,
        generatedAt: new Date().toISOString(),
        summary,
        visits: visits.map((v) => ({
          date: v.visit_date,
          unit: unitMap.get(v.unit_id)?.name || unitMap.get(v.unit_id)?.code || "—",
          officer: candMap.get(v.candidate_id)?.full_name || "—",
          checkIn: v.check_in_at,
          checkOut: v.check_out_at,
          rating: v.customer_rating,
          client: v.client_name,
          notes: v.visit_notes,
        })),
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Filter visits and export a PDF."
        crumbs={[
          { label: "Admin", to: "/admin/dashboard" },
          { label: "Radar", to: "/admin/field-sense" },
          { label: "Reports" },
        ]}
      />

      {/* Filter bar */}
      <FieldSenseRangeFilter
        preset={preset}
        onPresetChange={setPreset}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
        resolvedLabel={`${range.label} · ${range.start === range.end ? range.start : `${range.start} → ${range.end}`}`}
      />

      {/* Scope */}
      <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[220px]">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Organization</div>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setUnitIds([]);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold"
            >
              <option value="">Select organization</option>
              {(custQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-[2] basis-full sm:basis-auto sm:min-w-[260px]">
            <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              <span>Clients</span>
              {customerId && (unitQ.data?.length ?? 0) > 0 && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setUnitIds([])} className="normal-case text-[10px] font-semibold text-primary hover:underline">All units</button>
                  <button type="button" onClick={() => setUnitIds((unitQ.data ?? []).map((u) => u.id))} className="normal-case text-[10px] font-semibold text-muted-foreground hover:underline">Select all</button>
                </div>
              )}
            </div>
            {!customerId ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] italic text-muted-foreground">
                Select an organization.
              </div>
            ) : (unitQ.data?.length ?? 0) === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] italic text-muted-foreground">
                No clients found.
              </div>
            ) : (
              <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-background p-1.5">
                {(unitQ.data ?? []).map((u) => {
                  const active = unitIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setUnitIds((prev) => active ? prev.filter((x) => x !== u.id) : [...prev, u.id])
                      }
                      className={
                        active
                          ? "rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-bold text-background"
                          : "rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                      }
                    >
                      {u.name || u.code}
                    </button>
                  );
                })}
                {unitIds.length === 0 && (
                  <span className="px-2 py-0.5 text-[10px] italic text-muted-foreground">All {unitQ.data?.length ?? 0} units included</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={downloading || activeUnitIds.length === 0 || visits.length === 0}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      {activeUnitIds.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Total visits" value={String(summary.total)} />
          <SummaryTile label="Completed" value={String(summary.completed)} />
          <SummaryTile label="Avg rating" value={summary.avgRating != null ? `${summary.avgRating.toFixed(2)} / 5` : "—"} sub={summary.avgRating != null ? `${summary.ratedCount} rated` : undefined} />
          <SummaryTile label="Officers · Clients" value={`${summary.officers} · ${summary.unitsCovered}`} />
        </div>
      )}

      {/* Visits table */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="border-b border-border/50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Visits · {customer?.name ?? "Select an organization"} · {range.label}
        </div>
        {activeUnitIds.length === 0 ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground">
            Choose an organization above to preview the report.
          </div>
        ) : visitQ.isLoading ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground">Loading visits…</div>
        ) : visits.length === 0 ? (
          <div className="p-6 text-center text-xs italic text-muted-foreground">No visits recorded in the selected range.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border/50 bg-muted/40 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Field officer</th>
                  <th className="px-3 py-2 text-left">Check-in</th>
                  <th className="px-3 py-2 text-left">Check-out</th>
                  <th className="px-3 py-2 text-left">Duration</th>
                  <th className="px-3 py-2 text-left">Rating</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageRows.map((v) => (
                  <tr key={v.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{fmtDate(v.visit_date)}</td>
                    <td className="px-3 py-2 text-foreground">{unitMap.get(v.unit_id)?.name || unitMap.get(v.unit_id)?.code || "—"}</td>
                    <td className="px-3 py-2 text-foreground">{candMap.get(v.candidate_id)?.full_name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-foreground whitespace-nowrap">{fmtTime(v.check_in_at)}</td>
                    <td className="px-3 py-2 tabular-nums text-foreground whitespace-nowrap">{fmtTime(v.check_out_at)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">{fmtDur(v.check_in_at, v.check_out_at)}</td>
                    <td className="px-3 py-2">
                      {v.customer_rating != null ? (
                        <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-amber-600">
                          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                          {v.customer_rating}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-foreground">{v.client_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[280px] truncate">{v.visit_notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <DataPagination {...pg} />
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-none text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{sub}</div>}
    </div>
  );
}
