// GPAIP Register — cohort views (Staff / Director / Guard) sourced from Policy Manager.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Search, ShieldPlus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

export type CohortKey = "staff" | "director" | "guard";

const COHORTS: Array<{ key: CohortKey; label: string; policyMatch: string }> = [
  { key: "staff", label: "Staff view", policyMatch: "staff" },
  { key: "director", label: "Director view", policyMatch: "director" },
  { key: "guard", label: "Guard view", policyMatch: "guard" },
];

const GUARD_ROLES = new Set(["guard", "security_guard"]);
const DIRECTOR_ROLES = new Set(["leadership", "vp_operations", "director"]);

export function cohortForRole(roleKey: string | null | undefined): CohortKey {
  const r = (roleKey ?? "").toLowerCase();
  if (GUARD_ROLES.has(r)) return "guard";
  if (DIRECTOR_ROLES.has(r)) return "director";
  return "staff";
}

import { ComplianceAccessGate } from "@/components/ComplianceAccessGate";

function GpaipRegisterPageGated() {
  return (
    <ComplianceAccessGate>
      <GpaipRegisterPage />
    </ComplianceAccessGate>
  );
}

export const Route = createFileRoute("/admin/compliance-gpaip-register")({
  component: GpaipRegisterPageGated,
  validateSearch: (search: Record<string, unknown>): { ym?: string; view?: string } => ({
    ym: typeof search.ym === "string" ? search.ym : undefined,
    view: typeof search.view === "string" ? search.view : undefined,
  }),
  head: () => ({
    meta: [
      { title: "GPAIP Register — PLUS 360" },
      {
        name: "description",
        content:
          "Insurer-ready GPAIP register split into staff, director and guard views with sum assured, additional cover and TTD remarks from the policy master.",
      },
      { property: "og:title", content: "GPAIP Register" },
      {
        property: "og:description",
        content: "Staff, director and guard GPAIP cover listings with age, gender and joining details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const lakh = (n: number | null | undefined) => {
  if (!n || Number(n) <= 0) return "—";
  const v = Number(n);
  const inLakh = v >= 1000 ? v / 100000 : v; // stored either in rupees or already in lakh
  const rounded = Math.round(inLakh * 100) / 100;
  return `${rounded} Lakh`;
};

const ageFrom = (dob: string | null | undefined, asOf: Date) => {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  let a = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) a -= 1;
  return a >= 0 && a < 120 ? a : null;
};

type Member = {
  id: string;
  code: string;
  name: string;
  designation: string;
  doj: string | null;
  dob: string | null;
  age: number | null;
  gender: string;
  cohort: CohortKey;
};

type PolicyLite = {
  id: string;
  name: string;
  policy_number: string | null;
  end_date: string | null;
  sum_assured: number | null;
  additional_cover: number | null;
  ttd_enabled: boolean | null;
  enabled: boolean | null;
};

function useGpaipRegister(ym: string) {
  return useQuery({
    queryKey: ["gpaip-register", ym],
    staleTime: 60_000,
    queryFn: async (): Promise<{ members: Member[]; policies: PolicyLite[] }> => {
      const asOf = new Date(ym + "-01T00:00:00");
      const monthEnd = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);

      const [{ data: cands, error }, { data: desigs }, { data: pols }] = await Promise.all([
        supabase
          .from("candidates")
          .select(
            "id, full_name, employee_code, candidate_code, role_key, designation_id, preferred_joining_date, date_of_birth, gender, status, is_enabled",
          )
          .in("status", ["active", "approved"])
          .limit(5000),
        supabase.from("designations").select("id, name").limit(2000),
        supabase.from("policies").select("*"),
      ]);
      if (error) throw error;

      const desigMap = new Map(
        ((desigs ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
      );

      const members: Member[] = ((cands ?? []) as Array<Record<string, unknown>>)
        .filter((c) => (c.is_enabled as boolean | null) !== false)
        .filter((c) => {
          const doj = c.preferred_joining_date as string | null;
          if (!doj) return true;
          return new Date(doj + "T00:00:00") <= monthEnd;
        })
        .map((c) => {
          const dob = (c.date_of_birth as string | null) ?? null;
          return {
            id: c.id as string,
            code:
              ((c.employee_code as string | null) || (c.candidate_code as string | null) || "—") ?? "—",
            name: (c.full_name as string | null) ?? "—",
            designation: desigMap.get((c.designation_id as string) ?? "") ?? "—",
            doj: (c.preferred_joining_date as string | null) ?? null,
            dob,
            age: ageFrom(dob, monthEnd),
            gender: ((c.gender as string | null) ?? "").replace(/^./, (s) => s.toUpperCase()) || "—",
            cohort: cohortForRole(c.role_key as string | null),
          };
        })
        .sort((a, b) => (a.doj ?? "").localeCompare(b.doj ?? "") || a.name.localeCompare(b.name));

      return { members, policies: ((pols ?? []) as unknown as PolicyLite[]) };
    },
  });
}

function GpaipRegisterPage() {
  const now = new Date();
  const { ym: ymParam, view } = Route.useSearch();
  const ym = ymParam ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const cohort: CohortKey =
    view === "director" ? "director" : view === "guard" ? "guard" : "staff";
  const navigate = useNavigate({ from: "/admin/compliance-gpaip-register" });
  const [q, setQ] = useState("");

  const { data, isLoading } = useGpaipRegister(ym);
  const members = data?.members ?? [];

  const policy = useMemo(() => {
    const match = COHORTS.find((c) => c.key === cohort)!.policyMatch;
    return (data?.policies ?? []).find((p) => `${p.name ?? ""}`.toLowerCase().includes(match)) ?? null;
  }, [data, cohort]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members
      .filter((m) => m.cohort === cohort)
      .filter((m) => (!needle ? true : `${m.name} ${m.code} ${m.designation}`.toLowerCase().includes(needle)));
  }, [members, cohort, q]);

  const counts = useMemo(() => {
    const c: Record<CohortKey, number> = { staff: 0, director: 0, guard: 0 };
    for (const m of members) c[m.cohort] += 1;
    return c;
  }, [members]);

  const pg = usePagination(rows);

  const monthLabel = new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const remarks = policy?.ttd_enabled ? "TTD" : "";
  const sumAssured = lakh(policy?.sum_assured);
  const addlCover = lakh(policy?.additional_cover);

  return (
    <div className="page-shell">
      <PageHeader
        icon={ShieldPlus}
        eyebrow="Governance"
        title="GPAIP Register"
        description={`Insurer-ready cover listing for ${monthLabel} — staff, directors and guards on cover, with sum assured and TTD applied from the policy master.`}
        crumbs={[
          { label: "Compliance", to: "/admin/compliance" },
          { label: "GPAIP", to: "/admin/compliance-insurance" },
          { label: "Register" },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/compliance-insurance" search={{ ym, head: "gpaip" }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> GPAIP
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `gpaip-register-${cohort}-${ym}`,
                  rows.map((r, i) => ({
                    sr: i + 1,
                    code: r.code,
                    name: r.name,
                    designation: r.designation,
                    doj: r.doj ?? "",
                    dob: r.dob ?? "",
                    age: r.age ?? "",
                    gender: r.gender,
                    sum: sumAssured,
                    addl: addlCover,
                    remarks,
                    status: "Active",
                  })),
                  [
                    { key: "sr", header: "Sr No" },
                    { key: "code", header: "Employee ID" },
                    { key: "name", header: "Employee Name" },
                    { key: "designation", header: "Designation" },
                    { key: "doj", header: "Date Of Joining" },
                    { key: "dob", header: "Date of Birth" },
                    { key: "age", header: "Age" },
                    { key: "gender", header: "Gender" },
                    { key: "sum", header: "Sum Assured" },
                    { key: "addl", header: "Additional Cover" },
                    { key: "remarks", header: "Remarks" },
                    { key: "status", header: "Status" },
                  ],
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          </div>
        }
      />

      {/* Cohort switcher */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {COHORTS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => navigate({ search: { ym, view: c.key } })}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
              cohort === c.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-card/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[c.key]}</span>
          </button>
        ))}
        <div className="relative min-w-0 flex-1 basis-full sm:ml-auto sm:basis-auto sm:min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Policy banner */}
      <div className="mb-3 rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-[11px] backdrop-blur">
        {policy ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold">{policy.name}</span>
            <span className="text-muted-foreground">
              {[
                policy.policy_number,
                policy.end_date ? `valid till ${fmtDate(policy.end_date)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="text-muted-foreground">
              Sum assured <strong className="text-foreground">{sumAssured}</strong>
            </span>
            <span className="text-muted-foreground">
              Additional cover <strong className="text-foreground">{addlCover}</strong>
            </span>
            <span className="text-muted-foreground">
              TTD <strong className="text-foreground">{policy.ttd_enabled ? "Yes" : "No"}</strong>
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            No policy found for this view — add one named “Policy {COHORTS.find((c) => c.key === cohort)!.policyMatch}” in the Policy Manager.
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          Loading register…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          No employees on cover in this view for {monthLabel}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/80 backdrop-blur">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Sr</th>
                <th className="px-3 py-2 text-left font-semibold">Employee ID</th>
                <th className="px-3 py-2 text-left font-semibold">Employee name</th>
                <th className="px-3 py-2 text-left font-semibold">Designation</th>
                <th className="px-3 py-2 text-left font-semibold">Date of joining</th>
                <th className="px-3 py-2 text-left font-semibold">Date of birth</th>
                <th className="px-3 py-2 text-right font-semibold">Age</th>
                <th className="px-3 py-2 text-left font-semibold">Gender</th>
                <th className="px-3 py-2 text-left font-semibold">Sum assured</th>
                <th className="px-3 py-2 text-left font-semibold">Additional cover</th>
                <th className="px-3 py-2 text-left font-semibold">Remarks</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {pg.pageRows.map((r, i) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.code}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.designation}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.doj)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.dob)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.age ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.gender}</td>
                  <td className="px-3 py-2 tabular-nums">{sumAssured}</td>
                  <td className="px-3 py-2 tabular-nums">{addlCover}</td>
                  <td className="px-3 py-2 text-muted-foreground">{remarks || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      )}
    </div>
  );
}
