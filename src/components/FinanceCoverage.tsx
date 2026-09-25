import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Gauge,
  PiggyBank,
  Receipt,
  Search,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv-export";
import { fmtINR } from "@/lib/payroll-calc";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Committed vs actual (MTD) money charters — payroll, invoice and P&L.
// Mirrors the deployment (workforce) charter format exactly: four headline
// tiles (committed / actual / variance / coverage) plus a drill-down dialog
// listing every unit.
// ---------------------------------------------------------------------------
//
// Both lists page through their rows: with several hundred client units,
// rendering every row at once was the slowest part of painting the dashboard.

import { Pager, usePaged } from "@/components/Pager";

// ---------------------------------------------------------------------------

export type UnitFinanceRow = {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  customer_name: string;
  internal: boolean;
  committed_strength: number;
  actual_strength: number;
  committed_payroll: number;
  actual_payroll: number;
  committed_invoice: number;
  actual_invoice: number;
};

export type Tone = "success" | "ok" | "warning" | "destructive";

/**
 * Completion tone — actual earned value against the full-month commitment.
 * No calendar-day extrapolation is used: OT and payroll-day bases make that
 * comparison misleading, especially at the start of a month.
 */
export function completionTone(committed: number, actual: number): Tone {
  if (committed <= 0) return "ok";
  const completion = (actual / committed) * 100;
  if (completion >= 98) return "success";
  if (completion >= 85) return "warning";
  return "destructive";
}

/** Shortfall tone for money: under-delivery beyond 5% is red, up to 5% amber. */
function moneyTone(committed: number, actual: number): "ok" | "warning" | "destructive" {
  if (committed <= 0) return "ok";
  if (actual >= committed) return "ok";
  const deltaPct = ((committed - actual) / committed) * 100;
  return deltaPct > 5 ? "destructive" : "warning";
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Users;
  tone?: "accent" | "success" | "warning" | "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        tone === "success"
          ? "border-emerald-500/40 bg-emerald-500/10"
          : tone === "warning"
            ? "border-amber-500/40 bg-amber-500/10"
            : tone === "destructive"
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-background/60",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "accent" && "text-primary",
            tone === "success" && "text-emerald-600",
            tone === "warning" && "text-amber-500",
            tone === "destructive" && "text-destructive",
          )}
        />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold tabular-nums",
          tone === "success" && "text-emerald-600",
          tone === "warning" && "text-amber-600",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}


function VarianceChip({ diff, money }: { diff: number; money?: boolean }) {
  const tone =
    diff >= 0
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
      : "bg-destructive/10 text-destructive border-destructive/25";
  const text = money
    ? `${diff >= 0 ? "+" : "−"}${fmtINR(Math.abs(diff))}`
    : `${diff > 0 ? "+" : ""}${diff}`;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        tone,
      )}
    >
      {text}
    </span>
  );
}

type Money = { committed: number; actual: number };

function CoverageCard({
  eyebrow,
  title,
  description,
  rows,
  pick,
  buttonLabel,
  labels,
  icons,
  strengthOf,
}: {
  eyebrow: string;
  title: string;
  description: string;
  rows: UnitFinanceRow[];
  pick: (r: UnitFinanceRow) => Money;
  buttonLabel: string;
  labels: { committed: string; actual: string };
  icons: { committed: typeof Users; actual: typeof Users };
  strengthOf?: (r: UnitFinanceRow) => { committed: number; actual: number };
}) {
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => {
    const committed = rows.reduce((s, r) => s + pick(r).committed, 0);
    const actual = rows.reduce((s, r) => s + pick(r).actual, 0);
    const strength = rows.reduce(
      (s, r) => {
        const st = strengthOf?.(r) ?? { committed: 0, actual: 0 };
        return { committed: s.committed + st.committed, actual: s.actual + st.actual };
      },
      { committed: 0, actual: 0 },
    );
    return {
      committed,
      actual,
      remaining: committed - actual,
      coverage: committed > 0 ? Math.round((actual / committed) * 100) : 0,
      tone: completionTone(committed, actual),
      strength,
    };
  }, [rows, pick, strengthOf]);

  const toneTile = totals.tone === "ok" ? undefined : totals.tone;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" className="h-9 rounded-lg" onClick={() => setOpen(true)}>
          {buttonLabel}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={labels.committed}
          value={fmtINR(totals.committed)}
          sub={
            strengthOf
              ? `${totals.strength.committed} committed strength · full month`
              : "Full month"
          }
          icon={icons.committed}
          tone="accent"
        />
        <Tile
          label={labels.actual}
          value={fmtINR(totals.actual)}
          sub="Earned from attendance this month"
          icon={icons.actual}
          tone={toneTile}
        />
        <Tile
          label="Remaining to full month"
          value={`${totals.remaining < 0 ? "+" : ""}${fmtINR(Math.abs(Math.round(totals.remaining)))}`}
          sub={totals.remaining >= 0 ? "Contract value not yet earned" : "Earned above commitment"}
          icon={TrendingDown}
          tone={toneTile}
        />
        <Tile
          label="MTD completion"
          value={`${totals.coverage}%`}
          sub="Actual ÷ full-month committed"
          icon={Gauge}
          tone={toneTile}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Actual MTD is calculated from attendance duties and each contract resource&apos;s
        payroll-day base. Completion is actual divided by the full-month commitment;
        no calendar-day projection or static target is applied.
      </p>

      <CharterDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        rows={rows}
        pick={pick}
        labels={labels}
        strengthOf={strengthOf}
      />
    </div>
  );
}

function CharterDialog({
  open,
  onOpenChange,
  title,
  description,
  rows,
  pick,
  labels,
  strengthOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  rows: UnitFinanceRow[];
  pick: (r: UnitFinanceRow) => Money;
  labels: { committed: string; actual: string };
  strengthOf?: (r: UnitFinanceRow) => { committed: number; actual: number };
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.unit_name, r.customer_name, r.unit_code].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),

    );
  }, [query, rows]);

  const paged = usePaged(filtered, `${query}|${rows.length}`);

  const totals = useMemo(
    () => ({
      committed: filtered.reduce((s, r) => s + pick(r).committed, 0),
      actual: filtered.reduce((s, r) => s + pick(r).actual, 0),
    }),
    [filtered, pick],
  );

  const exportCsv = () => {
    downloadCsv(
      title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      filtered.map((r) => ({
        Unit: r.unit_name,
        Code: r.unit_code,
        Organisation: r.customer_name,
        [labels.committed]: Math.round(pick(r).committed),
        [labels.actual]: Math.round(pick(r).actual),
        Variance: Math.round(pick(r).actual - pick(r).committed),
      })),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-5 sm:pt-4">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-9 rounded-lg pl-9"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {fmtINR(totals.committed)}
            </span>{" "}
            committed ·{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {fmtINR(totals.actual)}
            </span>{" "}
            actual
          </div>
          <Button variant="outline" className="h-9 rounded-lg" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 pb-5 pt-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No units match this search.
            </div>
          ) : (
            <div className="space-y-2">
              {paged.pageRows.map((r) => {
                const m = pick(r);
                const isOpen = !!expanded[r.unit_id];
                const st = strengthOf?.(r);
                return (
                  <div
                    key={r.unit_id}
                    className="overflow-hidden rounded-xl border border-border bg-background/50"
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [r.unit_id]: !p[r.unit_id] }))}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.unit_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.customer_name} · {r.unit_code}
                          {r.internal ? " · Internal" : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-sm tabular-nums">
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Committed
                          </div>
                          <div className="whitespace-nowrap font-semibold">
                            {fmtINR(m.committed)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Actual MTD
                          </div>
                          <div
                            className={cn(
                              "whitespace-nowrap font-semibold",
                              moneyTone(m.committed, m.actual) === "destructive" &&
                                "text-destructive",
                              moneyTone(m.committed, m.actual) === "warning" && "text-amber-600",
                            )}
                          >
                            {fmtINR(m.actual)}
                          </div>
                        </div>
                        <VarianceChip diff={m.actual - m.committed} money />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="grid gap-2 border-t border-border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
                        {st && (
                          <div>
                            <div className="text-muted-foreground">Strength</div>
                            <div className="font-semibold tabular-nums">
                              {st.actual} / {st.committed}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="text-muted-foreground">Coverage</div>
                          <div className="font-semibold tabular-nums">
                            {m.committed > 0 ? Math.round((m.actual / m.committed) * 100) : 0}%
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Variance</div>
                          <div className="font-semibold tabular-nums">
                            {fmtINR(m.actual - m.committed)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Pager
            page={paged.page}
            pageCount={paged.pageCount}
            from={paged.from}
            to={paged.to}
            total={paged.total}
            onPage={paged.setPage}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Payroll committed vs actual (MTD). */
export function PayrollCoverageCard({ rows }: { rows: UnitFinanceRow[] }) {
  return (
    <CoverageCard
      eyebrow="Payroll"
      title="Committed vs Actual Payroll"
      description="Full-month payroll cost across all active client and internal units against payroll actually earned month-till-date."
      rows={rows}
      pick={(r) => ({ committed: r.committed_payroll, actual: r.actual_payroll })}
      buttonLabel="View full payroll charter"
      labels={{ committed: "Committed payroll", actual: "Actual payroll MTD" }}
      icons={{ committed: Wallet, actual: Banknote }}
      strengthOf={(r) => ({ committed: r.committed_strength, actual: r.actual_strength })}
    />
  );
}

/** Invoice committed vs actual (MTD). */
export function InvoiceCoverageCard({ rows }: { rows: UnitFinanceRow[] }) {
  const billable = rows.filter((r) => !r.internal);
  return (
    <CoverageCard
      eyebrow="Invoice"
      title="Committed vs Actual Invoice"
      description="Contracted billable value across active client contracts against invoice value earned month-till-date."
      rows={billable}
      pick={(r) => ({ committed: r.committed_invoice, actual: r.actual_invoice })}
      buttonLabel="View full invoice charter"
      labels={{ committed: "Committed invoice", actual: "Actual invoice MTD" }}
      icons={{ committed: Receipt, actual: Banknote }}
      strengthOf={(r) => ({ committed: r.committed_strength, actual: r.actual_strength })}
    />
  );
}

/** Unit-wise P&L: contracted MTD, actual invoice, actual payroll, profitability. */
export function ProfitabilityCard({ rows: allRows }: { rows: UnitFinanceRow[] }) {
  const [query, setQuery] = useState("");

  // Internal / non-billable units carry cost with no customer revenue by
  // design — including them would make P&L negative by construction.
  const rows = useMemo(() => allRows.filter((r) => !r.internal), [allRows]);

  const totals = useMemo(() => {
    const committedProfit = rows.reduce(
      (s, r) => s + (r.committed_invoice - r.committed_payroll),
      0,
    );
    const actualProfit = rows.reduce((s, r) => s + (r.actual_invoice - r.actual_payroll), 0);
    const committedInvoice = rows.reduce((s, r) => s + r.committed_invoice, 0);
    const actualInvoice = rows.reduce((s, r) => s + r.actual_invoice, 0);
    const committedMargin = committedInvoice > 0 ? (committedProfit / committedInvoice) * 100 : 0;
    const actualMargin = actualInvoice > 0 ? (actualProfit / actualInvoice) * 100 : 0;
    return {
      committedProfit,
      actualProfit,
      remainingProfit: committedProfit - actualProfit,
      committedMargin,
      actualMargin,
      tone: completionTone(committedMargin, actualMargin),
    };
  }, [rows]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((r) =>
          [r.unit_name, r.customer_name, r.unit_code].some((v) =>
            (v ?? "").toLowerCase().includes(q),
          ),
        )
      : rows;
    return [...list].sort(
      (a, b) => b.actual_invoice - b.actual_payroll - (a.actual_invoice - a.actual_payroll),
    );
  }, [rows, query]);

  const paged = usePaged(filtered, `${query}|${rows.length}`);

  const exportCsv = () =>
    downloadCsv(
      "unit-profitability",
      filtered.map((r) => ({
        Unit: r.unit_name,
        Organisation: r.customer_name,
        "Contracted MTD": Math.round(r.committed_invoice),
        "Actual invoice MTD": Math.round(r.actual_invoice),
        "Actual payroll MTD": Math.round(r.actual_payroll),
        Profitability: Math.round(r.actual_invoice - r.actual_payroll),
      })),
    );

  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            P&amp;L
          </div>
          <h2 className="text-base font-semibold">Client Profitability — Committed vs Actual</h2>
          <p className="text-xs text-muted-foreground">
            Contracted value against invoice earned and payroll spent month-till-date, per unit.
          </p>
        </div>
        <Button variant="outline" className="h-9 rounded-lg" onClick={exportCsv}>
          <Download className="mr-1.5 h-4 w-4" />
          Export
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Committed profitability"
          value={fmtINR(totals.committedProfit)}
          sub={`${totals.committedMargin.toFixed(1)}% margin · full month`}
          icon={PiggyBank}
          tone="accent"
        />
        <Tile
          label="Actual profitability MTD"
          value={fmtINR(totals.actualProfit)}
          sub={`${totals.actualMargin.toFixed(1)}% margin earned`}
          icon={Banknote}
          tone={totals.tone === "ok" ? undefined : totals.tone}
        />
        <Tile
          label="Remaining full-month profit"
          value={`${totals.remainingProfit < 0 ? "+" : ""}${fmtINR(Math.abs(Math.round(totals.remainingProfit)))}`}
          sub={totals.remainingProfit >= 0 ? "Committed less actual MTD" : "Above committed profit"}
          icon={TrendingDown}
          tone={totals.tone === "ok" ? undefined : totals.tone}
        />
        <Tile
          label="Margin health"
          value={`${totals.actualMargin.toFixed(1)}%`}
          sub={`vs ${totals.committedMargin.toFixed(1)}% committed margin`}
          icon={Gauge}
          tone={totals.tone === "ok" ? undefined : totals.tone}
        />
      </div>


      <div className="relative mt-3 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search client or organisation…"
          className="h-9 rounded-lg pl-9"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Client</th>
              <th className="px-3 py-2 text-right font-semibold">Contracted</th>
              <th className="px-3 py-2 text-right font-semibold">Invoice MTD</th>
              <th className="px-3 py-2 text-right font-semibold">Payroll MTD</th>
              <th className="px-3 py-2 text-right font-semibold">Profitability</th>
              <th className="px-3 py-2 text-right font-semibold">Margin</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No units to report for this cycle.
                </td>
              </tr>
            )}
            {paged.pageRows.map((r) => {
              const profit = r.actual_invoice - r.actual_payroll;
              const margin = r.actual_invoice > 0 ? (profit / r.actual_invoice) * 100 : 0;
              return (
                <tr key={r.unit_id} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.unit_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.customer_name}
                      {r.internal ? " · Internal" : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.committed_invoice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.actual_invoice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtINR(r.actual_payroll)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums",
                      profit < 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    {fmtINR(profit)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                      margin < 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {margin.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager
          page={paged.page}
          pageCount={paged.pageCount}
          from={paged.from}
          to={paged.to}
          total={paged.total}
          onPage={paged.setPage}
        />
      </div>
    </div>
  );
}
