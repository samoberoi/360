import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Car,
  ClipboardList,
  CreditCard,
  Download,
  Files,
  Home,
  Boxes,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ComplianceAccessGate } from "@/components/ComplianceAccessGate";
import { StatutoryHeadTiles } from "@/components/StatutoryHeadTiles";
import { InsuranceHeadTiles } from "@/components/InsuranceHeadTiles";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import {
  DOMAIN_META,
  SEVERITY_ORDER,
  complianceScore,
  fetchComplianceIssues,
  type ComplianceIssue,
  type DomainKey,
  type Severity,
} from "@/lib/compliance";

function CompliancePageGated() {
  return (
    <ComplianceAccessGate>
      <CompliancePage />
    </ComplianceAccessGate>
  );
}

export const Route = createFileRoute("/admin/compliance")({
  component: CompliancePageGated,
  head: () => ({
    meta: [
      { title: "Compliance Command Center — PLUS 360" },
      {
        name: "description",
        content:
          "Every exception across organizations, contracts, employees, attendance, uniform, vehicles, assets, payroll, invoice and the control center — scored, ranked and exportable.",
      },
      { property: "og:title", content: "Compliance Command Center" },
      {
        property: "og:description",
        content: "One governance surface for every red flag across the operation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const DOMAIN_ICON: Record<DomainKey, React.ComponentType<{ className?: string }>> = {
  organizations: Building2,
  contracts: Files,
  employees: UserPlus,
  attendance: ClipboardList,
  uniform: Boxes,
  vehicles: Car,
  assets: Home,
  payroll: Wallet,
  invoice: CreditCard,
  control_center: SlidersHorizontal,
};

const SEVERITY_STYLE: Record<Severity, { chip: string; dot: string; label: string; ring: string }> = {
  critical: {
    chip: "bg-destructive/12 text-destructive ring-destructive/25",
    dot: "bg-destructive",
    label: "Critical",
    ring: "ring-destructive/25",
  },
  high: {
    chip: "bg-orange-500/12 text-orange-600 ring-orange-500/25 dark:text-orange-400",
    dot: "bg-orange-500",
    label: "High",
    ring: "ring-orange-500/25",
  },
  medium: {
    chip: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400",
    dot: "bg-amber-500",
    label: "Medium",
    ring: "ring-amber-500/25",
  },
  low: {
    chip: "bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-400",
    dot: "bg-sky-500",
    label: "Low",
    ring: "ring-sky-500/25",
  },
};

function scoreTone(score: number) {
  if (score >= 90) return { text: "text-emerald-600 dark:text-emerald-400", stroke: "stroke-emerald-500", verdict: "Healthy" };
  if (score >= 75) return { text: "text-amber-600 dark:text-amber-400", stroke: "stroke-amber-500", verdict: "Watchlist" };
  if (score >= 55) return { text: "text-orange-600 dark:text-orange-400", stroke: "stroke-orange-500", verdict: "At risk" };
  return { text: "text-destructive", stroke: "stroke-destructive", verdict: "Critical" };
}

function ScoreRing({ score }: { score: number }) {
  const tone = scoreTone(score);
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[124px] w-[124px] shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} className="fill-none stroke-border/60" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className={cn("fill-none transition-[stroke-dashoffset] duration-700", tone.stroke)}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * score) / 100}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className={cn("text-[28px] font-semibold leading-none tabular-nums", tone.text)}>{score}</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {tone.verdict}
        </span>
      </div>
    </div>
  );
}

function CompliancePage() {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [ym, setYm] = useState(currentYm);
  const [showExceptions, setShowExceptions] = useState(false);
  const [domain, setDomain] = useState<DomainKey | "all">("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [q, setQ] = useState("");

  const {
    data: issues = [] as ComplianceIssue[],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["compliance-command-center", ym],
    queryFn: () => fetchComplianceIssues(ym),
    staleTime: 60_000,
    enabled: showExceptions,
  });


  const score = useMemo(() => complianceScore(issues), [issues]);

  const bySeverity = useMemo(() => {
    const map: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) map[i.severity] += 1;
    return map;
  }, [issues]);

  const byDomain = useMemo(() => {
    const map = new Map<DomainKey, { total: number; sev: Record<Severity, number> }>();
    for (const key of Object.keys(DOMAIN_META) as DomainKey[]) {
      map.set(key, { total: 0, sev: { critical: 0, high: 0, medium: 0, low: 0 } });
    }
    for (const i of issues) {
      const bucket = map.get(i.domain)!;
      bucket.total += 1;
      bucket.sev[i.severity] += 1;
    }
    return map;
  }, [issues]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter((i) => {
      if (domain !== "all" && i.domain !== domain) return false;
      if (severity !== "all" && i.severity !== severity) return false;
      if (!needle) return true;
      return `${i.subject} ${i.check} ${i.detail}`.toLowerCase().includes(needle);
    });
  }, [issues, domain, severity, q]);

  const grouped = useMemo(() => {
    const map = new Map<DomainKey, ComplianceIssue[]>();
    for (const i of rows) {
      const list = map.get(i.domain) ?? [];
      list.push(i);
      map.set(i.domain, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  return (
    <div className="page-shell">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Governance"
        title="Compliance Command Center"
        description="Every red flag across the operation — organizations, contracts, people, attendance, uniform, fleet, assets and money — in one ranked queue."
        crumbs={[{ label: "Compliance" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthYearPicker value={ym} onChange={setYm} />
            {showExceptions && (
              <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
              </Button>
            )}
            {showExceptions && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "compliance-register",
                  rows.map((r) => ({
                    domain: DOMAIN_META[r.domain].label,
                    severity: r.severity,
                    check: r.check,
                    subject: r.subject,
                    detail: r.detail,
                    due: r.dueDate ?? "",
                  })),
                  [
                    { key: "domain", header: "Domain" },
                    { key: "severity", header: "Severity" },
                    { key: "check", header: "Check" },
                    { key: "subject", header: "Subject" },
                    { key: "detail", header: "Detail" },
                    { key: "due", header: "Due date" },
                  ],
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            )}
          </div>
        }
      />

      {/* Statutory registers */}
      <StatutoryHeadTiles ym={ym} />

      {/* Insurance registers */}
      <InsuranceHeadTiles ym={ym} />

      {!showExceptions && (
        <button
          onClick={() => setShowExceptions(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-[26px] border border-border/60 bg-card/70 p-4 text-left backdrop-blur transition-all hover:border-border hover:shadow-sm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Run the exception sweep</span>
            <span className="block text-[11px] text-muted-foreground">
              Scans every module for open exceptions. Loaded on demand to keep this dashboard fast.
            </span>
          </span>
          <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {showExceptions && (<>
      {/* Hero: score + severity ladder */}
      <div className="mb-4 overflow-hidden rounded-[26px] border border-border/60 bg-gradient-to-br from-card/90 via-card/70 to-card/40 p-4 shadow-sm backdrop-blur-xl sm:p-5">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={isLoading ? 0 : score} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Compliance score
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {isLoading
                ? "Sweeping every module for exceptions…"
                : issues.length === 0
                  ? "No open exceptions anywhere. The operation is fully compliant."
                  : `${issues.length} open exceptions across ${
                      Array.from(byDomain.values()).filter((d) => d.total > 0).length
                    } modules. Clear criticals first — they block billing, legality or safety.`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SEVERITY_ORDER.map((s) => {
                const style = SEVERITY_STYLE[s];
                const active = severity === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSeverity(active ? "all" : s)}
                    className={cn(
                      "rounded-2xl border px-3 py-2 text-left transition-all",
                      active
                        ? "border-transparent shadow-sm ring-2 " + style.ring + " " + style.chip
                        : "border-border/60 bg-background/50 hover:border-border",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {style.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xl font-semibold whitespace-nowrap tabular-nums">{bySeverity[s]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Domain grid */}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(DOMAIN_META) as DomainKey[]).map((key) => {
          const meta = DOMAIN_META[key];
          const stats = byDomain.get(key)!;
          const Icon = DOMAIN_ICON[key];
          const active = domain === key;
          const worst = SEVERITY_ORDER.find((s) => stats.sev[s] > 0);
          return (
            <button
              key={key}
              onClick={() => setDomain(active ? "all" : key)}
              className={cn(
                "group relative overflow-hidden rounded-2xl border p-3 text-left transition-all",
                active
                  ? "border-accent/40 bg-accent/5 shadow-sm"
                  : "border-border/60 bg-card/70 backdrop-blur hover:border-border hover:shadow-sm",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-xl ring-1 ring-inset",
                    worst ? SEVERITY_STYLE[worst].chip : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-2xl font-semibold leading-none whitespace-nowrap tabular-nums">{stats.total}</span>
              </div>
              <p className="mt-2 truncate text-[12px] font-semibold">{meta.label}</p>
              <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-border/50">
                {stats.total === 0 ? (
                  <span className="h-full w-full bg-emerald-500/60" />
                ) : (
                  SEVERITY_ORDER.map((s) =>
                    stats.sev[s] ? (
                      <span
                        key={s}
                        className={cn("h-full", SEVERITY_STYLE[s].dot)}
                        style={{ width: `${(stats.sev[s] / stats.total) * 100}%` }}
                      />
                    ) : null,
                  )
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setDomain("all");
              setSeverity("all");
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
              domain === "all" && severity === "all"
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            All exceptions
          </button>
          {domain !== "all" && (
            <span className="rounded-full border border-border/60 bg-card px-3 py-1 text-[11px] font-semibold">
              {DOMAIN_META[domain].label}
            </span>
          )}
          {severity !== "all" && (
            <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset", SEVERITY_STYLE[severity].chip)}>
              {SEVERITY_STYLE[severity].label}
            </span>
          )}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employee, client, vehicle, contract…"
          className="h-9 w-full text-xs sm:w-72"
        />
      </div>

      {/* Issue register */}
      {isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center text-xs text-muted-foreground">
          Running compliance sweep across all modules…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-10 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-emerald-600" />
          <p className="mt-2 text-sm font-semibold">Nothing red here</p>
          <p className="mt-1 text-xs text-muted-foreground">No exceptions match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([key, list]) => {
            const Icon = DOMAIN_ICON[key];
            return (
              <section key={key} className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur">
                <header className="flex items-center gap-2 border-b border-border/60 bg-background/40 px-3 py-2 sm:px-4">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-[13px] font-semibold">{DOMAIN_META[key].label}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {list.length}
                  </span>
                  <Link
                    to={DOMAIN_META[key].href}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                  >
                    Open module <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </header>
                <ul className="divide-y divide-border/60">
                  {list.map((i) => {
                    const style = SEVERITY_STYLE[i.severity];
                    return (
                      <li key={i.id} className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-[13px] font-semibold">{i.subject}</p>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset", style.chip)}>
                              {style.label}
                            </span>
                            <span className="text-[11px] font-medium text-muted-foreground">{i.check}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{i.detail}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          {i.dueDate ? (
                            <p className="text-[11px] font-semibold tabular-nums">
                              {new Date(i.dueDate + "T00:00:00").toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "2-digit",
                              })}
                            </p>
                          ) : null}
                          {i.href ? (
                            <Link to={i.href} className="text-[11px] font-semibold text-accent hover:underline">
                              Fix
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {issues.length > 0 && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3" /> Score falls as exceptions accumulate, weighted by severity. Criticals cost 8×
          a low-severity item.
        </p>
      )}
      </>)}
    </div>
  );
}
