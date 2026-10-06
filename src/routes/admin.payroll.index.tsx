import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { z } from "zod";

import { PayrollTabs } from "@/components/PayrollTabs";
import { HeroTile } from "@/components/HeroTile";
import { Button } from "@/components/ui/button";
import { useCharterGeoFilters } from "@/components/CharterGeoFilters";
import { ListSkeleton } from "@/components/Skeletons";
import { FinanceCharter } from "@/components/FinanceCharter";
import { PayrollWindowPeriodPicker } from "@/components/PayrollWindowPeriodPicker";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { CHARTER_UNITS_QK, fetchCharterUnits } from "@/lib/charter-units";
import { usePayrollWindowSelection } from "@/lib/use-payroll-window-selection";
import { useOperationalUnitScope } from "@/lib/use-manager-scope";
import type { MoneyStatus } from "@/lib/period-status";

const searchSchema = z.object({ window: z.string().optional(), month: z.coerce.number().min(0).max(11).optional(), year: z.coerce.number().min(2000).max(2100).optional() });

export const Route = createFileRoute("/admin/payroll/")({
  validateSearch: (search) => searchSchema.parse(search),
  component: PayrollUnitsPage,
});

function PayrollUnitsPage() {
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [unitFilter, setUnitFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | MoneyStatus>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: CHARTER_UNITS_QK,
    queryFn: fetchCharterUnits,
  });

  const foScope = useOperationalUnitScope();
  const rawUnits = data?.units ?? [];
  const units = useMemo(
    () => (foScope.isScoped ? rawUnits.filter((u) => foScope.unitIds.has(u.id)) : rawUnits),
    [rawUnits, foScope.isScoped, foScope.unitIds],
  );
  const periodSelection = usePayrollWindowSelection(units.map((unit) => unit.id), search);
  const { monthIdx, year, selectedKey, windowsByUnit, unitIdsForWindow } = periodSelection;
  const windowUnits = useMemo(() => units.filter((unit) => unitIdsForWindow.has(unit.id)), [units, unitIdsForWindow]);
  const geo = useCharterGeoFilters(windowUnits);
  const unitOptions = useMemo(
    () =>
      windowUnits.filter(
        (u) => orgFilter.length === 0 || orgFilter.includes(u.customer_id || u.customer_name),
      ),
    [windowUnits, orgFilter],
  );
  const organizations = useMemo(() => {
    const all = data?.organizations ?? [];
    const allowed = new Set(windowUnits.map((u) => u.customer_id));
    return all.filter((o) => allowed.has(o.id));
  }, [data?.organizations, windowUnits]);

  const summary = {
    organizations: organizations.length,
    units: windowUnits.length,
    activeEmployees: windowUnits.reduce((s, r) => s + r.active_employee_count, 0),
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return windowUnits.filter((u) => {
      if (!geo.apply(u)) return false;
      if (term) {
        const hay = [u.customer_name, u.customer_code, u.name, u.code, u.location, ...u.contract_codes]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [q, geo, windowUnits]);

  const anyFilter = geo.active || statusFilter !== "all" || q.trim().length > 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <HeroTile
        eyebrow="Payroll"
        title="Payroll"
        subtitle="Contract payroll periods"
        description="Payroll from approved attendance."
      />

      <div className="space-y-2 rounded-xl border border-border/70 bg-card p-2 shadow-sm sm:rounded-2xl sm:p-3">
        <PayrollTabs />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <PayrollWindowPeriodPicker options={periodSelection.options} selectedKey={selectedKey} onWindowChange={periodSelection.selectWindow} />
          <MonthYearPicker
            className="border-primary/40 bg-primary/5 ring-1 ring-primary/15 dark:border-primary/50 dark:bg-primary/10"
            value={`${year}-${String(monthIdx + 1).padStart(2, "0")}`}
            onChange={(ym) => {
              const [y, m] = ym.split("-").map(Number);
              periodSelection.setPeriod(y, m - 1);
            }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm sm:rounded-3xl">
        <div className="border-b border-border/60 px-3 py-2.5 sm:space-y-3 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-base font-bold tracking-tight text-foreground sm:text-lg">
              Payroll charter
            </h2>
            <p className="hidden text-sm leading-relaxed text-muted-foreground sm:block">
              Period-to-date payroll by unit. Open any unit for the full payroll register.
            </p>
          </div>

        </div>


        <div className="px-3 py-3 sm:px-5 sm:py-5">
          {isLoading ? (
            <ListSkeleton rows={5} />
          ) : error ? (
            <div className="px-5 py-12 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load payroll clients right now."}
            </div>
          ) : (
            <FinanceCharter
              mode="payroll"
              units={filtered}
              monthIdx={monthIdx}
              year={year}
              query={q}
              onQueryChange={setQ}
              organizationCount={summary.organizations}
              windowsByUnit={windowsByUnit}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              filters={
                <div className="space-y-2">
                  {geo.render(organizations)}
                  {anyFilter && (
                    <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Filtered to <span className="font-bold text-foreground">{filtered.length}</span> of{" "}
                         {windowUnits.length} units
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          setQ("");
                          geo.clear();
                          setStatusFilter("all");
                        }}
                      >
                        <X className="h-3.5 w-3.5" /> Clear
                      </Button>
                    </div>
                  )}
                </div>
              }
            />

          )}
        </div>
      </div>
    </div>
  );
}

