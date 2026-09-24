import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Download, ReceiptText, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { ComplianceAccessGate } from "@/components/ComplianceAccessGate";

function PtRegisterPageGated() {
  return (
    <ComplianceAccessGate>
      <PtRegisterPage />
    </ComplianceAccessGate>
  );
}

export const Route = createFileRoute("/admin/compliance-pt")({
  component: PtRegisterPageGated,
  validateSearch: (search: Record<string, unknown>): { ym?: string } => ({
    ym: typeof search.ym === "string" ? search.ym : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Professional Tax Register — PLUS 360" },
      {
        name: "description",
        content:
          "State-wise Professional Tax deducted this month, bifurcated by slab band and gender, searchable down to an individual employee.",
      },
      { property: "og:title", content: "Professional Tax Register" },
      {
        property: "og:description",
        content: "State-wise PT deducted, split by slab band and gender.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const inr = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

type Slab = {
  id: string;
  state: string;
  salary_min: number;
  salary_max: number | null;
  tax_per_month: number;
  gender: string;
};

type PtRow = {
  id: string;
  candidateId: string;
  name: string;
  code: string;
  gender: string;
  state: string;
  unit: string;
  amount: number;
  slabId: string | null;
  band: string;
  bandOrder: number;
  date: string;
};

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

const normGender = (g: string | null | undefined) => {
  const s = (g ?? "").trim().toLowerCase();
  if (s.startsWith("m")) return "Male";
  if (s.startsWith("f")) return "Female";
  return "Unspecified";
};

function bandLabel(min: number, max: number | null) {
  if (!max) return `${inr(min)} & above`;
  return `${inr(min)} – ${inr(max)}`;
}

function usePtData(ym: string) {
  return useQuery({
    queryKey: ["pt-register", ym],
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: PtRow[]; slabs: Slab[] }> => {
      const { from, to } = monthRange(ym);
      const [{ data: deds, error }, { data: slabData }] = await Promise.all([
        supabase
          .from("deductions")
          .select("id, candidate_id, amount, computed_amount, deduction_name, deduction_date, status")
          .gte("deduction_date", from)
          .lte("deduction_date", to)
          .ilike("deduction_name", "%profession%"),
        supabase
          .from("professional_tax_slabs")
          .select("id, state, salary_min, salary_max, tax_per_month, gender")
          .order("salary_min"),
      ]);
      if (error) throw error;
      const slabs = ((slabData ?? []) as Slab[]).map((s) => ({
        ...s,
        salary_min: Number(s.salary_min),
        salary_max: s.salary_max === null ? null : Number(s.salary_max),
        tax_per_month: Number(s.tax_per_month),
      }));
      const rows = deds ?? [];
      if (rows.length === 0) return { rows: [], slabs };

      const ids = Array.from(new Set(rows.map((r) => r.candidate_id).filter(Boolean)));
      const { data: cands } = await supabase
        .from("candidates")
        .select("id, full_name, employee_code, candidate_code, gender, permanent_state, unit_id")
        .in("id", ids);

      const unitIds = Array.from(
        new Set((cands ?? []).map((c) => c.unit_id).filter(Boolean) as string[]),
      );
      const { data: units } = unitIds.length
        ? await supabase.from("units").select("id, name, billing_state, shipping_state").in("id", unitIds)
        : { data: [] as Array<{ id: string; name: string; billing_state: string | null; shipping_state: string | null }> };

      const unitMap = new Map((units ?? []).map((u) => [u.id, u]));
      const candMap = new Map((cands ?? []).map((c) => [c.id, c]));

      const mapped: PtRow[] = rows.map((r) => {
        const c = candMap.get(r.candidate_id);
        const u = c?.unit_id ? unitMap.get(c.unit_id) : undefined;
        const state =
          (u?.billing_state || u?.shipping_state || c?.permanent_state || "Unknown").trim();
        const gender = normGender(c?.gender);
        const amount = Number(r.computed_amount ?? r.amount ?? 0);
        const stateSlabs = slabs.filter(
          (s) => (s.state ?? "").trim().toLowerCase() === state.toLowerCase(),
        );
        const hit =
          stateSlabs.find(
            (s) =>
              Number(s.tax_per_month) === Math.round(amount) &&
              (normGender(s.gender) === gender || normGender(s.gender) === "Unspecified"),
          ) ?? stateSlabs.find((s) => Number(s.tax_per_month) === Math.round(amount));
        return {
          id: r.id,
          candidateId: r.candidate_id,
          name: c?.full_name ?? "—",
          code: c?.employee_code ?? c?.candidate_code ?? "—",
          gender,
          state: state || "Unknown",
          unit: u?.name ?? "—",
          amount,
          slabId: hit?.id ?? null,
          band: hit ? bandLabel(hit.salary_min, hit.salary_max) : `${inr(amount)}/month slab`,
          bandOrder: hit ? hit.salary_min : 9_999_999,
          date: r.deduction_date,
        };
      });
      return { rows: mapped, slabs };
    },
  });
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-3 backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold whitespace-nowrap tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function PtRegisterPage() {
  const now = new Date();
  const { ym: ymParam } = Route.useSearch();
  const ym = ymParam ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const navigate = useNavigate({ from: "/admin/compliance-pt" });
  const setYm = (next: string) => navigate({ search: { ym: next } });
  const [state, setState] = useState<string>("all");
  const [gender, setGender] = useState<string>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { data, isLoading } = usePtData(ym);
  const all = data?.rows ?? [];
  const slabs = data?.slabs ?? [];

  // Only states that actually appear in this month's records.
  const states = useMemo(
    () => Array.from(new Set(all.map((r) => r.state))).sort(),
    [all],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (state !== "all" && r.state !== state) return false;
      if (gender !== "all" && r.gender !== gender) return false;
      if (!needle) return true;
      return `${r.name} ${r.code} ${r.unit}`.toLowerCase().includes(needle);
    });
  }, [all, state, gender, q]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  // State → every slab in the schedule for that state, with counts (zero shown).
  const groups = useMemo(() => {
    const activeStates = states.filter((s) => state === "all" || s === state);
    return activeStates.map((st) => {
      const stateSlabs = slabs
        .filter((s) => s.state.trim().toLowerCase() === st.toLowerCase())
        .filter((s) => gender === "all" || normGender(s.gender) === gender || normGender(s.gender) === "Unspecified")
        .sort((a, b) => a.salary_min - b.salary_min);
      const stateRows = rows.filter((r) => r.state === st);
      const bands = stateSlabs.map((s) => {
        const members = stateRows.filter((r) => r.slabId === s.id);
        return {
          key: s.id,
          label: bandLabel(s.salary_min, s.salary_max),
          gender: normGender(s.gender),
          rate: s.tax_per_month,
          members,
          total: members.reduce((x, r) => x + r.amount, 0),
        };
      });
      // Rows that couldn't be mapped to any slab in the schedule
      const unmatched = stateRows.filter((r) => !r.slabId || !stateSlabs.some((s) => s.id === r.slabId));
      if (unmatched.length) {
        bands.push({
          key: `${st}-unmatched`,
          label: "Outside published schedule",
          gender: "—",
          rate: 0,
          members: unmatched,
          total: unmatched.reduce((x, r) => x + r.amount, 0),
        });
      }
      return {
        state: st,
        bands,
        total: stateRows.reduce((x, r) => x + r.amount, 0),
        count: stateRows.length,
      };
    });
  }, [states, slabs, rows, state, gender]);

  const monthLabel = new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="page-shell">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Governance"
        title="Professional Tax Register"
        description="State-wise PT deducted, laid out against the full slab schedule — expand a slab to see the employees in it."
        crumbs={[{ label: "Compliance", to: "/admin/compliance" }, { label: "Professional Tax" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthYearPicker value={ym} onChange={setYm} />
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/compliance">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Compliance
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `pt-register-${ym}`,
                  rows.map((r) => ({
                    code: r.code,
                    name: r.name,
                    gender: r.gender,
                    state: r.state,
                    unit: r.unit,
                    band: r.band,
                    amount: r.amount,
                    date: r.date,
                  })),
                  [
                    { key: "code", header: "Employee code" },
                    { key: "name", header: "Name" },
                    { key: "gender", header: "Gender" },
                    { key: "state", header: "State" },
                    { key: "unit", header: "Client" },
                    { key: "band", header: "Slab band" },
                    { key: "amount", header: "PT deducted" },
                    { key: "date", header: "Deduction date" },
                  ],
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-[160px]">
            <SelectValue placeholder="Employees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All employees</SelectItem>
            <SelectItem value="Male">Male</SelectItem>
            <SelectItem value="Female">Female</SelectItem>
            <SelectItem value="Unspecified">Unspecified</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Totals */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label={`PT deducted · ${monthLabel}`} value={inr(total)} sub={`${rows.length} employees`} />
        <StatCard label="States" value={String(groups.length)} />
        <StatCard
          label="Slabs in schedule"
          value={String(groups.reduce((s, g) => s + g.bands.length, 0))}
        />
        <StatCard
          label="Slabs with deductions"
          value={String(groups.reduce((s, g) => s + g.bands.filter((b) => b.members.length).length, 0))}
        />
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          Loading professional tax deductions…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          No professional tax deducted for {monthLabel} with the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section
              key={g.state}
              className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur"
            >
              <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-background/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold">{g.state}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {g.count} employees
                  </span>
                </div>
                <span className="text-[13px] font-semibold tabular-nums">{inr(g.total)}</span>
              </header>

              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Slab band</th>
                    <th className="px-3 py-2 text-left font-semibold">Applies to</th>
                    <th className="px-3 py-2 text-right font-semibold">Rate / month</th>
                    <th className="px-3 py-2 text-right font-semibold">Employees</th>
                    <th className="px-3 py-2 text-right font-semibold">PT deducted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {g.bands.map((b) => {
                    const key = `${g.state}:${b.key}`;
                    const isOpen = !!open[key];
                    const empty = b.members.length === 0;
                    return (
                      <Fragment key={key}>
                        <tr
                          onClick={() =>
                            !empty && setOpen((s) => ({ ...s, [key]: !s[key] }))
                          }
                          className={cn(
                            "transition-colors",
                            empty ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/30",
                            isOpen && "bg-accent/5",
                          )}
                        >
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-1.5 font-medium">
                              {!empty ? (
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 transition-transform",
                                    isOpen && "rotate-90",
                                  )}
                                />
                              ) : (
                                <span className="w-3.5" />
                              )}
                              {b.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{b.gender}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {b.rate ? inr(b.rate) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{b.members.length}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {empty ? "—" : inr(b.total)}
                          </td>
                        </tr>
                        {isOpen && !empty ? (
                          <tr className="bg-background/40">
                            <td colSpan={5} className="px-3 py-2">
                              <ul className="divide-y divide-border/50">
                                {b.members
                                  .slice()
                                  .sort((a, c) => a.name.localeCompare(c.name))
                                  .map((r) => (
                                    <li
                                      key={r.id}
                                      className="flex items-center justify-between gap-3 py-1.5"
                                    >
                                      <span className="min-w-0">
                                        <span className="block truncate text-[12px] font-medium">
                                          {r.name}
                                        </span>
                                        <span className="block truncate text-[10px] text-muted-foreground">
                                          {r.code} · {r.unit} · {r.gender}
                                        </span>
                                      </span>
                                      <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                                        {inr(r.amount)}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/60 bg-background/40">
                    <td
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      colSpan={3}
                    >
                      {g.state} total
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold tabular-nums">
                      {g.count}
                    </td>
                    <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums">
                      {inr(g.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
