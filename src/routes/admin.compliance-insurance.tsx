import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Download, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import {
  INSURANCE_HEADS,
  matchesHead,
  monthRange,
  type InsuranceHeadKey,
} from "@/components/InsuranceHeadTiles";

import { ComplianceAccessGate } from "@/components/ComplianceAccessGate";

function InsuranceRegisterPageGated() {
  return (
    <ComplianceAccessGate>
      <InsuranceRegisterPage />
    </ComplianceAccessGate>
  );
}

export const Route = createFileRoute("/admin/compliance-insurance")({
  component: InsuranceRegisterPageGated,
  validateSearch: (search: Record<string, unknown>): { ym?: string; head?: string } => ({
    ym: typeof search.ym === "string" ? search.ym : undefined,
    head: typeof search.head === "string" ? search.head : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Insurance Register — PLUS 360" },
      {
        name: "description",
        content:
          "GPAIP, ESIC and Workmen's Compensation recovered this month, employee by employee, grouped by the client that carries the cover.",
      },
      { property: "og:title", content: "Insurance Register" },
      {
        property: "og:description",
        content: "Month-wise insurance register recoveries with the employees covered.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const inr = (n: number) =>
  "₹" + Math.round(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type EsicBasis = "basic_da" | "gross";

const BASIS_LABEL: Record<EsicBasis, string> = {
  basic_da: "Basic + DA",
  gross: "Gross − washing",
};

type Row = {
  id: string;
  candidateId: string;
  name: string;
  code: string;
  unitId: string | null;
  unit: string;
  joining: string | null;
  amount: number;
  date: string;
  note: string;
  side: "ee" | "er";
  branchId: string | null;
  location: string;
  esicCode: string;
  basis: EsicBasis;
};


type Policy = {
  id: string;
  name: string;
  provider: string | null;
  policy_number: string | null;
  end_date: string | null;
  sum_assured: number | null;
  is_active: boolean | null;
};

type Branch = { id: string; location: string; esic_code: string; enabled: boolean };

/** Derive whether a unit's ESIC is computed on Basic + DA or on Gross − washing. */
function deriveUnitEsicBasis(
  contracts: Array<{ id: string; unit_id: string | null }>,
  resources: Array<{ contract_id: string; deductions: unknown; employer_contributions: unknown }>,
): Map<string, EsicBasis> {
  const contractUnit = new Map(contracts.map((c) => [c.id, c.unit_id]));
  const out = new Map<string, EsicBasis>();
  const isEsi = (n: string) => /\besi(c)?\b/i.test(n) || /esi/i.test(n.replace(/[^a-z]/gi, ""));
  for (const r of resources) {
    const unitId = contractUnit.get(r.contract_id);
    if (!unitId) continue;
    const lines = [
      ...(Array.isArray(r.deductions) ? (r.deductions as Record<string, unknown>[]) : []),
      ...(Array.isArray(r.employer_contributions) ? (r.employer_contributions as Record<string, unknown>[]) : []),
    ];
    for (const l of lines) {
      const name = String(l.name ?? "");
      if (!isEsi(name)) continue;
      const blob = JSON.stringify(l.formulaExpression ?? "") + JSON.stringify(l.baseComponents ?? "") + name;
      const basis: EsicBasis = /basic/i.test(blob) && !/gross/i.test(blob) ? "basic_da" : "gross";
      out.set(unitId, basis);
    }
  }
  return out;
}


function useInsuranceRegister(ym: string, head: InsuranceHeadKey) {
  return useQuery({
    queryKey: ["insurance-register", ym, head],
    staleTime: 60_000,
    queryFn: async (): Promise<{
      rows: Row[];
      policies: Policy[];
      units: Array<{ id: string; name: string; enabled: boolean; amount: number }>;
      branches: Branch[];
    }> => {
      const { from, to } = monthRange(ym);
      const [{ data: deds, error }, { data: contribs }, { data: pol }, { data: branchRows }, { data: contractRows }] =
        await Promise.all([
          supabase
            .from("deductions")
            .select("id, candidate_id, amount, computed_amount, deduction_name, deduction_date, status")
            .gte("deduction_date", from)
            .lte("deduction_date", to),
          supabase
            .from("employer_contributions")
            .select("id, candidate_id, amount, contribution_name, contribution_date")
            .gte("contribution_date", from)
            .lte("contribution_date", to),
          supabase.from("policies").select("*"),
          supabase.from("esic_branches").select("id, location, esic_code, enabled").order("location"),
          supabase.from("units").select("id, esic_branch_id"),
        ]);
      if (error) throw error;

      const branches = ((branchRows ?? []) as Branch[]).slice();
      const branchMap = new Map(branches.map((b) => [b.id, b]));
      const unitBranch = new Map<string, string>();
      for (const c of contractRows ?? []) {
        const uid = (c as { id?: string | null }).id;
        const bid = (c as { esic_branch_id?: string | null }).esic_branch_id;
        if (uid && bid) unitBranch.set(uid, bid);
      }


      const raw: Array<{
        id: string;
        candidate_id: string;
        amount: number;
        date: string;
        note: string;
        side: "ee" | "er";
      }> = [];
      for (const d of deds ?? []) {
        if (!matchesHead(d.deduction_name, head) || !d.candidate_id) continue;
        if ((d.status ?? "active") === "cancelled") continue;
        raw.push({
          id: d.id,
          candidate_id: d.candidate_id,
          amount: Number(d.computed_amount ?? d.amount ?? 0),
          date: d.deduction_date,
          note: d.deduction_name ?? "",
          side: "ee",
        });
      }
      for (const c of contribs ?? []) {
        if (!matchesHead(c.contribution_name, head) || !c.candidate_id) continue;
        raw.push({
          id: c.id,
          candidate_id: c.candidate_id,
          amount: Number(c.amount ?? 0),
          date: c.contribution_date,
          note: c.contribution_name ?? "",
          side: "er",
        });
      }

      const policies = ((pol ?? []) as unknown as Policy[]).filter((p) => {
        const n = `${p.name ?? ""}`.toLowerCase();
        return INSURANCE_HEADS.find((h) => h.key === head)!.policyMatch.some((m) => n.includes(m));
      });

      const { data: unitRows } = await supabase
        .from("units")
        .select("id, name, gpaip_enabled, gpaip_amount");
      const units = (unitRows ?? []).map((u) => ({
        id: u.id,
        name: u.name as string,
        enabled: Boolean((u as { gpaip_enabled?: boolean }).gpaip_enabled),
        amount: Number((u as { gpaip_amount?: number }).gpaip_amount ?? 0),
      }));

      const [{ data: ctrRows }, { data: resRows }] = await Promise.all([
        supabase.from("client_contracts").select("id, unit_id"),
        supabase.from("contract_resources").select("contract_id, deductions, employer_contributions"),
      ]);
      const basisMap = deriveUnitEsicBasis(
        (ctrRows ?? []) as Array<{ id: string; unit_id: string | null }>,
        (resRows ?? []) as Array<{ contract_id: string; deductions: unknown; employer_contributions: unknown }>,
      );

      if (raw.length === 0) return { rows: [], policies, units, branches };


      const ids = Array.from(new Set(raw.map((r) => r.candidate_id)));
      const { data: cands } = await supabase
        .from("candidates")
        .select("id, full_name, employee_code, candidate_code, unit_id, preferred_joining_date")
        .in("id", ids);
      const candMap = new Map((cands ?? []).map((c) => [c.id, c]));
      const unitMap = new Map(units.map((u) => [u.id, u]));

      const rows: Row[] = raw.map((r) => {
        const c = candMap.get(r.candidate_id);
        const u = c?.unit_id ? unitMap.get(c.unit_id) : undefined;
        const bid = (c?.unit_id ? unitBranch.get(c.unit_id) : undefined) ?? null;
        const b = bid ? branchMap.get(bid) : undefined;
        return {
          id: r.id,
          candidateId: r.candidate_id,
          name: c?.full_name ?? "—",
          code: c?.employee_code ?? c?.candidate_code ?? "—",
          unitId: c?.unit_id ?? null,
          unit: u?.name ?? "Unassigned",
          joining: (c?.preferred_joining_date as string | null) ?? null,
          amount: r.amount,
          date: r.date,
          note: r.note,
          side: r.side,
          branchId: b?.id ?? null,
          location: b?.location ?? "Unmapped location",
          esicCode: b?.esic_code ?? "—",
          basis: (c?.unit_id ? basisMap.get(c.unit_id) : undefined) ?? "gross",

        };
      });
      rows.sort((a, b) => a.location.localeCompare(b.location) || a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
      return { rows, policies, units, branches };
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

function InsuranceRegisterPage() {
  const now = new Date();
  const { ym: ymParam, head: headParam } = Route.useSearch();
  const ym = ymParam ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const head: InsuranceHeadKey =
    headParam === "wc" ? "wc" : headParam === "esic" ? "esic" : "gpaip";
  const meta = INSURANCE_HEADS.find((h) => h.key === head)!;
  const navigate = useNavigate({ from: "/admin/compliance-insurance" });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loc, setLoc] = useState<string>("all");
  const [basisFilter, setBasisFilter] = useState<"all" | EsicBasis>("all");


  const { data, isLoading } = useInsuranceRegister(ym, head);
  const all = data?.rows ?? [];

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (head === "esic" && loc !== "all" && (r.branchId ?? "none") !== loc) return false;
      if (head === "esic" && basisFilter !== "all" && r.basis !== basisFilter) return false;
      if (!needle) return true;
      return `${r.name} ${r.code} ${r.unit} ${r.location} ${r.esicCode}`.toLowerCase().includes(needle);
    });
  }, [all, q, loc, basisFilter, head]);


  const total = rows.reduce((s, r) => s + r.amount, 0);
  const eeTotal = rows.filter((r) => r.side === "ee").reduce((s, r) => s + r.amount, 0);
  const erTotal = rows.filter((r) => r.side === "er").reduce((s, r) => s + r.amount, 0);
  const people = new Set(rows.map((r) => r.candidateId)).size;

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.unit) ?? [];
      list.push(r);
      map.set(r.unit, list);
    }
    return Array.from(map.entries())
      .map(([unit, members]) => ({
        unit,
        members,
        total: members.reduce((s, r) => s + r.amount, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  // Location → unit → employee tree for the ESIC register
  const esicTree = useMemo(() => {
    type Emp = { candidateId: string; name: string; code: string; joining: string | null; ee: number; er: number };
    type UnitNode = { unitId: string | null; unit: string; basis: EsicBasis; ee: number; er: number; emps: Emp[] };
    const locMap = new Map<
      string,
      { key: string; location: string; esicCode: string; ee: number; er: number; units: Map<string, UnitNode> }
    >();
    for (const r of rows) {
      const key = r.branchId ?? "none";
      let node = locMap.get(key);
      if (!node) {
        node = { key, location: r.location, esicCode: r.esicCode, ee: 0, er: 0, units: new Map() };
        locMap.set(key, node);
      }
      let unit = node.units.get(r.unit);
      if (!unit) {
        unit = { unitId: r.unitId, unit: r.unit, basis: r.basis, ee: 0, er: 0, emps: [] };
        node.units.set(r.unit, unit);

      }
      let emp = unit.emps.find((e) => e.candidateId === r.candidateId);
      if (!emp) {
        emp = { candidateId: r.candidateId, name: r.name, code: r.code, joining: r.joining, ee: 0, er: 0 };
        unit.emps.push(emp);
      }
      emp[r.side] += r.amount;
      unit[r.side] += r.amount;
      node[r.side] += r.amount;
    }
    return Array.from(locMap.values())
      .map((n) => ({
        ...n,
        unitList: Array.from(n.units.values())
          .map((u) => ({ ...u, emps: u.emps.sort((a, b) => a.name.localeCompare(b.name)) }))
          .sort((a, b) => b.ee + b.er - (a.ee + a.er)),
      }))
      .sort((a, b) => b.ee + b.er - (a.ee + a.er));
  }, [rows]);


  const monthLabel = new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const enabledUnits = (data?.units ?? []).filter((u) => u.enabled);

  return (
    <div className="page-shell">
      <PageHeader
        icon={meta.icon}
        eyebrow="Governance"
        title={`${meta.label} Register`}
        description={`${meta.full} recovered in the month, employee by employee, grouped by the unit that carries the cover.`}
        crumbs={[{ label: "Compliance", to: "/admin/compliance" }, { label: `${meta.label} Register` }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthYearPicker value={ym} onChange={(next) => navigate({ search: { ym: next, head } })} />
            {head === "gpaip" ? (
              <Button size="sm" asChild>
                <Link to="/admin/compliance-gpaip-register" search={{ ym, view: "staff" }}>
                  View register
                </Link>
              </Button>
            ) : null}
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
                  `${head}-register-${ym}`,
                  rows.map((r) => ({
                    location: r.location,
                    esicCode: r.esicCode,
                    basis: BASIS_LABEL[r.basis],

                    code: r.code,
                    name: r.name,
                    unit: r.unit,
                    joining: r.joining ?? "",
                    side: r.side === "ee" ? "Employee" : "Employer",
                    amount: r.amount,
                    date: r.date,
                    note: r.note,
                  })),
                  [
                    ...(head === "esic"
                      ? [
                          { key: "location", header: "ESIC location" },
                          { key: "esicCode", header: "ESIC code" },
                          { key: "basis", header: "ESIC basis" },

                        ]
                      : []),
                    { key: "code", header: "Employee code" },
                    { key: "name", header: "Name" },
                    { key: "unit", header: "Client" },
                    { key: "joining", header: "Date of joining" },
                    ...(head === "esic" ? [{ key: "side", header: "Contribution" }] : []),
                    { key: "amount", header: `${meta.label} amount` },
                    { key: "date", header: "Recovered on" },
                    { key: "note", header: "Line" },
                  ],
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {head === "esic" ? (
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger className="h-9 w-full text-xs sm:w-[260px]">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {(data?.branches ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.location} · {b.esic_code}
                </SelectItem>
              ))}
              <SelectItem value="none">Unmapped location</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {head === "esic" ? (
          <Select value={basisFilter} onValueChange={(v) => setBasisFilter(v as "all" | EsicBasis)}>
            <SelectTrigger className="h-9 w-full text-xs sm:w-[220px]">
              <SelectValue placeholder="All ESIC bases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ESIC bases</SelectItem>
              <SelectItem value="basic_da">ESIC on Basic + DA</SelectItem>
              <SelectItem value="gross">ESIC on Gross − washing</SelectItem>
            </SelectContent>
          </Select>

        ) : null}
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Totals */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        <StatCard label={`${meta.label} recovered · ${monthLabel}`} value={inr(total)} sub={`${people} employees`} />
        <StatCard
          label="Employees covered"
          value={String(people)}
          sub={people ? `avg ${inr(total / people)} each` : "No records"}
        />
        {head === "esic" ? (
          <>
            <StatCard label="Employee contribution" value={inr(eeTotal)} sub="0.75% of gross" />
            <StatCard label="Employer contribution" value={inr(erTotal)} sub="3.25% of gross" />
            <StatCard label="ESIC locations" value={String(esicTree.length)} sub={`${groups.length} clients`} />
          </>
        ) : (
          <>
            <StatCard label="Clients covered" value={String(groups.length)} />
            <StatCard
              label="Clients with cover on"
              value={head === "gpaip" ? String(enabledUnits.length) : "—"}
              sub={head === "gpaip" ? "Client-level GPAIP toggle" : "Employer-borne cover"}
            />
          </>
        )}
      </div>



      {/* Policies backing this head */}
      {data?.policies?.length ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {data.policies.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-[11px] backdrop-blur"
            >
              <p className="font-semibold">{p.name}</p>
              <p className="text-muted-foreground">
                {[p.provider, p.policy_number, p.end_date ? `valid till ${fmtDate(p.end_date)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          Loading {meta.label} recoveries…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          No {meta.label} recovered for {monthLabel}.
        </div>
      ) : head === "esic" ? (
        <div className="space-y-3">
          {esicTree.map((node) => {
            const locOpen = open[`loc:${node.key}`] ?? true;
            return (
              <section
                key={node.key}
                className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur"
              >
                <header
                  onClick={() => setOpen((s) => ({ ...s, [`loc:${node.key}`]: !(s[`loc:${node.key}`] ?? true) }))}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/40 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", locOpen && "rotate-90")} />
                    <h2 className="truncate text-[13px] font-semibold">{node.location}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {node.esicCode}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {node.unitList.length} units
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] tabular-nums">
                    <span className="text-muted-foreground">
                      EE <b className="text-foreground">{inr(node.ee)}</b>
                    </span>
                    <span className="text-muted-foreground">
                      ER <b className="text-foreground">{inr(node.er)}</b>
                    </span>
                    <span className="text-[13px] font-semibold">{inr(node.ee + node.er)}</span>
                  </div>
                </header>

                {locOpen ? (
                  <div className="divide-y divide-border/60">
                    {node.unitList.map((u) => {
                      const uk = `unit:${node.key}:${u.unit}`;
                      const uOpen = open[uk] ?? false;
                      return (
                        <div key={uk}>
                          <div
                            onClick={() => setOpen((s) => ({ ...s, [uk]: !(s[uk] ?? false) }))}
                            className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 pl-6 hover:bg-muted/30"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <ChevronRight className={cn("h-3 w-3 transition-transform", uOpen && "rotate-90")} />
                              <span className="truncate text-[12px] font-medium">{u.unit}</span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                  u.basis === "basic_da"
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-primary/10 text-primary",
                                )}
                              >
                                {BASIS_LABEL[u.basis]}
                              </span>

                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                                {u.emps.length}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] tabular-nums">
                              <span className="text-muted-foreground">EE {inr(u.ee)}</span>
                              <span className="text-muted-foreground">ER {inr(u.er)}</span>
                              <span className="font-semibold">{inr(u.ee + u.er)}</span>
                            </div>
                          </div>
                          {uOpen ? (
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="border-y border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  <th className="px-3 py-2 pl-10 text-left font-semibold">Employee</th>
                                  <th className="px-3 py-2 text-left font-semibold">Code</th>
                                  <th className="px-3 py-2 text-left font-semibold">Date of joining</th>
                                  <th className="px-3 py-2 text-right font-semibold">ESIC employee</th>
                                  <th className="px-3 py-2 text-right font-semibold">ESIC employer</th>
                                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {u.emps.map((e) => (
                                  <tr key={e.candidateId} className="hover:bg-muted/30">
                                    <td className="px-3 py-2 pl-10 font-medium">{e.name}</td>
                                    <td className="px-3 py-2 text-muted-foreground">{e.code}</td>
                                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(e.joining)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{inr(e.ee)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{inr(e.er)}</td>
                                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                      {inr(e.ee + e.er)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (

        <div className="space-y-3">
          {groups.map((g) => {
            const isOpen = open[g.unit] ?? true;
            return (
              <section
                key={g.unit}
                className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur"
              >
                <header
                  onClick={() => setOpen((s) => ({ ...s, [g.unit]: !(s[g.unit] ?? true) }))}
                  className="flex cursor-pointer items-center justify-between gap-2 border-b border-border/60 bg-background/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
                    />
                    <h2 className="text-[13px] font-semibold">{g.unit}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {new Set(g.members.map((m) => m.candidateId)).size} employees
                    </span>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums">{inr(g.total)}</span>
                </header>

                {isOpen ? (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 text-left font-semibold">Employee</th>
                        <th className="px-3 py-2 text-left font-semibold">Code</th>
                        <th className="px-3 py-2 text-left font-semibold">Date of joining</th>
                        <th className="px-3 py-2 text-left font-semibold">Recovered on</th>
                        <th className="px-3 py-2 text-right font-semibold">{meta.label}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {g.members.map((m) => (
                        <Fragment key={m.id}>
                          <tr className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">{m.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{m.code}</td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.joining)}</td>
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(m.date)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {inr(m.amount)}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
