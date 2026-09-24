import { createFileRoute } from "@tanstack/react-router";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Download, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { supabaseSessionReady } from "@/lib/supabase-ready";
import { PageHeader } from "@/components/PageHeader";
import { PayrollTabs } from "@/components/PayrollTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/employer-contributions")({
  head: () => ({
    meta: [
      { title: "Employer Contributions — PLUS 360 Payroll" },
      { name: "description", content: "Employer-side statutory and benefit contributions parked per payroll run." },
      { property: "og:title", content: "Employer Contributions — PLUS 360 Payroll" },
      { property: "og:description", content: "Employer-side statutory and benefit contributions parked per payroll run." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmployerContributionsPage,
});

type Row = {
  id: string;
  candidate_id: string;
  unit_id: string | null;
  contribution_name: string;
  amount: number;
  frequency: string;
  period_start: string | null;
  period_end: string | null;
  contribution_date: string;
  status: string;
  notes: string;
  source_kind?: string | null;
};

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const FREQ_LABEL: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
  half_yearly: "Half-yearly",
};

function EmployerContributionsPage() {
  const [q, setQ] = useState("");
  const [freq, setFreq] = useState<"all" | string>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "employer-contributions"],
    queryFn: async (): Promise<Row[]> => {
      await supabaseSessionReady();
      const { data, error } = await supabase
        .from("employer_contributions" as never)
        .select(
          "id, candidate_id, unit_id, contribution_name, amount, frequency, period_start, period_end, contribution_date, status, notes, source_kind",
        )
        .order("contribution_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
  });

  const { data: people = new Map<string, { name: string; code: string }>() } = useQuery({
    queryKey: ["admin", "employer-contributions", "people"],
    queryFn: async () => {
      const { data } = await supabase.from("candidates").select("id, full_name, employee_code");
      return new Map(
        (data ?? []).map((c) => [
          c.id as string,
          { name: (c.full_name as string) ?? "—", code: (c.employee_code as string) ?? "" },
        ]),
      );
    },
  });

  const { data: units = new Map<string, string>() } = useQuery({
    queryKey: ["admin", "employer-contributions", "units"],
    queryFn: async () => {
      const { data } = await supabase.from("units").select("id, name, code");
      return new Map((data ?? []).map((u) => [u.id as string, (u.name as string) || (u.code as string) || "—"]));
    },
  });

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        empName: people.get(r.candidate_id)?.name ?? "—",
        empCode: people.get(r.candidate_id)?.code ?? "",
        unitName: r.unit_id ? units.get(r.unit_id) ?? "—" : "—",
      })),
    [rows, people, units],
  );

  const frequencies = useMemo(() => Array.from(new Set(rows.map((r) => r.frequency))), [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return enriched.filter((r) => {
      if (freq !== "all" && r.frequency !== freq) return false;
      if (!s) return true;
      return (
        r.empName.toLowerCase().includes(s) ||
        r.empCode.toLowerCase().includes(s) ||
        r.unitName.toLowerCase().includes(s) ||
        r.contribution_name.toLowerCase().includes(s)
      );
    });
  }, [enriched, q, freq]);

  const total = useMemo(() => filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0), [filtered]);

  const pg = usePagination(filtered);

  const byHead = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(r.contribution_name, (m.get(r.contribution_name) ?? 0) + (Number(r.amount) || 0));
    return Array.from(m, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  return (
    <div className="page-shell">
      <PageHeader
        title="Employer Contributions"
        description="Employer-side contributions parked at payroll processing — monthly, half-yearly or annual."
        icon={Building2}
        crumbs={[{ label: "Payroll", to: "/admin/payroll" }, { label: "Employer Contributions" }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                "employer-contributions",
                filtered.map((r) => ({
                  emp_id: r.empCode,
                  name: r.empName,
                  unit: r.unitName,
                  contribution: r.contribution_name,
                  amount: r.amount,
                  frequency: FREQ_LABEL[r.frequency] ?? r.frequency,
                  period: r.period_start && r.period_end ? `${r.period_start} → ${r.period_end}` : "",
                  processed_on: r.contribution_date,
                  status: r.status,
                })),
              )
            }
          >
            <Download className="mr-1.5 h-4 w-4" /> Export
          </Button>
        }
      />

      <PayrollTabs />

      <div className="mb-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:gap-3 md:grid-cols-4">
        <SummaryTile label="Contributions" value={String(filtered.length)} />
        <SummaryTile label="Employees" value={String(new Set(filtered.map((r) => r.candidate_id)).size)} />
        <SummaryTile label="Total employer outgo" value={fmtINR(total)} tone />
        <SummaryTile label="Heads" value={String(byHead.length)} />
      </div>

      <div className="rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {["all", ...frequencies].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFreq(f)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  freq === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "all" ? "All" : FREQ_LABEL[f] ?? f}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employee, client or contribution…"
              className="pl-9"
            />
          </div>
        </div>

        {byHead.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border/60 px-4 py-3">
            {byHead.slice(0, 8).map((h) => (
              <span
                key={h.name}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs"
              >
                <span className="text-muted-foreground">{h.name}</span>
                <span className="font-semibold tabular-nums">{fmtINR(h.amount)}</span>
              </span>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="ios-table min-w-[900px] table-auto text-sm whitespace-nowrap">
            <thead className="border-b border-border/60 bg-secondary/40">
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Emp ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Contribution</th>
                <th className="px-4 py-3 font-medium">Frequency</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    No employer contributions yet. They are parked here the moment a payroll run is processed.
                  </td>
                </tr>
              ) : (
                pg.pageRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono text-xs">{r.empCode || "—"}</td>
                    <td className="px-4 py-3 font-medium">{r.empName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.unitName}</td>
                    <td className="px-4 py-3">{r.contribution_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{FREQ_LABEL[r.frequency] ?? r.frequency}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.period_start && r.period_end ? `${r.period_start} → ${r.period_end}` : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", Number(r.amount) < 0 && "text-destructive")}>
                      {fmtINR(Number(r.amount) || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t border-border/60 bg-secondary/30 text-sm font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={6}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtINR(total)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
          <DataPagination {...pg} />
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", tone && "text-violet-700 dark:text-violet-300")}>
        {value}
      </div>
    </div>
  );
}
