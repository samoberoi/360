import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Building2,
  Briefcase,
  ClipboardList,
  Files,
  Fuel,
  PackageOpen,
  Receipt,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  MapPin,
  Radio,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { DashboardShell } from "@/components/LiveFeed";
import { Button } from "@/components/ui/button";
import { useCountUp } from "@/hooks/useCountUp";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentPermissions } from "@/lib/rbac";
import { ROLE_KEYS } from "@/lib/role-keys";
import { InventoryOwnerDashboard } from "./admin.inventory.dashboard";
import { fmtINR, computeWages, type ContractResourceLike } from "@/lib/payroll-calc";
import { useIsMobile } from "@/hooks/use-mobile";
import { hydrateFormulasFromMaster } from "@/lib/contract-hydrate";
import { refreshBillingAddOns } from "@/lib/contract-billing-addons";
import { resolvePayrollDayCount } from "@/lib/payroll-days";
import { PeopleInsightsCard } from "@/components/PeopleInsightsCard";
import { usePeopleInsights } from "@/lib/people-insights";
import { LiveFieldOfficersCard } from "@/components/LiveFieldOfficersCard";
import { UanFollowUp } from "@/components/UanFollowUp";
import { ContractDesignationFollowUp } from "@/components/ContractDesignationFollowUp";
import {
  OperationsRadarSummary,
  useOperationsRadarLive,
} from "@/components/OperationsRadarSummary";
import { OperationsDeployments } from "@/components/OperationsDeployments";
import { OperationsOrgTree } from "@/components/OperationsOrgTree";
import { DepartmentOrgTree } from "@/components/DepartmentOrgTree";
import {
  OperationsClientLocations,
  useOperationsOverview,
  VisitInsightTile,
} from "@/components/OperationsOverview";
import { AdminVisitProgressCard } from "@/components/AdminVisitProgressCard";
import { useOperationsFocus, OPS_PEOPLE_ROLE_KEYS } from "@/lib/ops-scope";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { PayrollWindowPeriodPicker } from "@/components/PayrollWindowPeriodPicker";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { CHARTER_UNITS_QK, fetchCharterUnits, readCharterUnitsSnapshot } from "@/lib/charter-units";
import { usePayrollWindowSelection } from "@/lib/use-payroll-window-selection";
import { payrollPeriodForMonth } from "@/lib/payroll-period";

type ContractExpiringRow = {
  id: string;
  contract_code: string;
  end_date: string;
  unit_id: string;
  status: string;
};

type DashboardCounts = {
  orgs: number;
  units: number;
  employees: number;
  contractsActive: number;
  contractsExpiring: ContractExpiringRow[];
  vehicles: number;
  fuelTotal: number;
  items: number;
  sheetCounts: StatusCounts;
  runCounts: StatusCounts;
  invoiceCounts: StatusCounts;
};

type StatusCounts = {
  approved: number;
  pending: number;
  draft: number;
  rejected: number;
  open: number;
  processed: number;
};

function isMissingDatabaseFunction(error: { code?: string } | null) {
  return error?.code === "PGRST202";
}

async function fetchDashboardCountsFallback(
  today: string,
  horizon: string,
): Promise<DashboardCounts> {
  const [orgs, units, employees, activeContracts, expiringContracts, vehicles, items] =
    await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }),
      supabase.from("units").select("id", { count: "exact", head: true }),
      supabase.from("candidates").select("id", { count: "exact", head: true }),
      supabase
        .from("client_contracts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("client_contracts")
        .select("id,contract_code,end_date,unit_id,status")
        .eq("status", "active")
        .gte("end_date", today)
        .lte("end_date", horizon)
        .order("end_date", { ascending: true }),
      supabase.from("vehicles").select("id", { count: "exact", head: true }),
      supabase.from("inv_items").select("id", { count: "exact", head: true }),
    ]);

  const buckets = {
    approved: 0,
    pending: 0,
    draft: 0,
    rejected: 0,
    open: 0,
    processed: 0,
  };
  return {
    orgs: orgs.error ? 0 : (orgs.count ?? 0),
    units: units.error ? 0 : (units.count ?? 0),
    employees: employees.error ? 0 : (employees.count ?? 0),
    contractsActive: activeContracts.error ? 0 : (activeContracts.count ?? 0),
    contractsExpiring: expiringContracts.error
      ? []
      : (((expiringContracts.data ?? []) as unknown) as ContractExpiringRow[]),
    vehicles: vehicles.error ? 0 : (vehicles.count ?? 0),
    fuelTotal: 0,
    items: items.error ? 0 : (items.count ?? 0),
    sheetCounts: { ...buckets },
    runCounts: { ...buckets },
    invoiceCounts: { ...buckets },
  };
}

const DASHBOARD_COUNTS_SNAPSHOT = "radiant:dashboard-counts:v2";

function readDashboardCountsSnapshot(key: string): DashboardCounts | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${DASHBOARD_COUNTS_SNAPSHOT}:${key}`);
    return raw ? (JSON.parse(raw) as DashboardCounts) : undefined;
  } catch {
    return undefined;
  }
}

function writeDashboardCountsSnapshot(key: string, value: DashboardCounts) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DASHBOARD_COUNTS_SNAPSHOT}:${key}`, JSON.stringify(value));
  } catch {
    // The snapshot is only a resilience aid; a full or blocked store is harmless.
  }
}

import { EmployeeInsightsSection } from "@/components/EmployeeInsightsSection";
import { ClientContractPortfolioCard } from "@/components/ClientContractPortfolioCard";
import {
  PayrollCoverageCard,
  InvoiceCoverageCard,
  ProfitabilityCard,
  type UnitFinanceRow,
} from "@/components/FinanceCoverage";

function PeopleInsightsSection({
  compact,
  hideLive,
  roleKeys,
}: {
  compact?: boolean;
  hideLive?: boolean;
  roleKeys?: readonly string[];
}) {
  const { isLoading, showSixtyPlus, birthdays, anniversaries, sixtyPlus } = usePeopleInsights({
    roleKeys,
  });
  return (
    <div className="flex flex-col gap-4">
      {!hideLive && <LiveFieldOfficersCard />}
      {!compact && (
        <>
          <PeopleInsightsCard kind="birthdays" items={birthdays} isLoading={isLoading} />
          <PeopleInsightsCard kind="anniversaries" items={anniversaries} isLoading={isLoading} />
          {showSixtyPlus && (
            <PeopleInsightsCard kind="sixty-plus" items={sixtyPlus} isLoading={isLoading} />
          )}
        </>
      )}
    </div>
  );
}

/** Active field officers — the operations headcount that matters. */
function DashboardErrorState({ error }: { error: Error }) {
  return (
    <div className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-lg font-semibold">Dashboard could not load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {error?.message || "Something went wrong while loading your data."}
      </p>
      <Button onClick={() => window.location.reload()} className="mt-5 w-full">
        Try again
      </Button>
    </div>
  );
}

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Leadership Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Leadership overview across operations, attendance, payroll, and invoicing." },
      { property: "og:title", content: "Leadership Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Leadership overview across operations, attendance, payroll, and invoicing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
  errorComponent: DashboardErrorState,
});

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type PnLRow = {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  customer_name: string;
  contract_value: number;
  invoice_amount: number;
  payroll_cost: number;
  variance: number;
  variance_pct: number;
  /** Full-month contracted payroll cost (components + ER + benefits) × headcount. */
  committed_payroll: number;
  /** Contracted headcount and employees actually mapped to the unit. */
  committed_strength: number;
  actual_strength: number;
  /** Internal (own-company) unit: cost centre, never billed to a customer. */
  internal: boolean;
};

function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const { can, isLoading: permsLoading, roleKey } = useCurrentPermissions();
  // People-function dashboards close with their own reporting structure, the
  // same way operations closes with its org tree.
  const departmentTree =
    roleKey === ROLE_KEYS.HR ? (
      <DepartmentOrgTree
        title="Human resources"
        departments={["HR"]}
        labels={["HR head", "Managers", "Assistant managers & seniors", "Executives"]}
      />
    ) : roleKey === ROLE_KEYS.FINANCE || roleKey === ROLE_KEYS.ACCOUNTS ? (
      <DepartmentOrgTree
        title="Finance & accounts"
        departments={["Accounts", "Finance"]}
        labels={["Finance leadership", "Managers", "Executives"]}
      />
    ) : null;
  const showInventoryDashboard =
    roleKey === ROLE_KEYS.INVENTORY_MANAGER || roleKey === ROLE_KEYS.INVENTORY;
  // Transport owns fleet and assets only — no payroll window, no leadership
  // snapshot, no client money. Their homepage is vehicles + assets combined.
  const showTransportDashboard = roleKey === ROLE_KEYS.TRANSPORT;
  // Operations focus: Radar access without payroll/invoicing. Their homepage is
  // field deployment, not money.
  const opsFocus = useOperationsFocus();
  const managerScope = useManagerFieldOfficerScope();
  const operationsOverviewQ = useOperationsOverview();
  const operationsLiveQ = useOperationsRadarLive();
  const operationsOverview = operationsOverviewQ.data;
  const liveOfficerCount = new Set((operationsLiveQ.data ?? []).map((row) => row.candidate_id))
    .size;

  const charterUnitsQ = useQuery({
    queryKey: CHARTER_UNITS_QK,
    queryFn: fetchCharterUnits,
    initialData: () => readCharterUnitsSnapshot() ?? undefined,
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
  const dashboardUnits = useMemo(() => {
    const units = charterUnitsQ.data?.units ?? [];
    return managerScope.isScoped ? units.filter((unit) => managerScope.unitIds.has(unit.id)) : units;
  }, [charterUnitsQ.data?.units, managerScope.isScoped, managerScope.unitIds]);
  const periodSelection = usePayrollWindowSelection(dashboardUnits.map((unit) => unit.id), { month, year });
  const selectedWindow = periodSelection.selectedWindow;
  const selectedPeriod = selectedWindow
    ? payrollPeriodForMonth(year, month, selectedWindow)
    : null;
  const monthStart = selectedPeriod?.start ?? `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = selectedPeriod?.end ?? (() => {
    const d = new Date(year, month + 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // Phones cannot hold the whole-month profitability computation in memory
  // (it loads every contract, roster and attendance row). Keep the mobile
  // dashboard to the light counts so the app never runs out of memory.
  const lightMode = useIsMobile();

  // Fast tile counts paint first; the heavy month P&L loads in a second,
  // independent query so the dashboard is usable immediately.
  const countsQuery = useQuery({
    queryKey: ["dashboard-counts", year, month, periodSelection.selectedKey],
    enabled: !permsLoading && !showInventoryDashboard && !showTransportDashboard,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    initialData: () =>
      readDashboardCountsSnapshot(`${year}-${month}-${periodSelection.selectedKey}`),
    initialDataUpdatedAt: 0,
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    queryFn: async () => {
      const sixtyDaysOut = new Date();
      sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
      const sixtyStr = sixtyDaysOut.toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);

      // Counts are essential; lifecycle totals are supplementary. Keep them
      // independent so a slow Attendance/Payroll/Invoice aggregate can never
      // take down the Leadership dashboard.
      const { data, error } = await supabase.rpc(
        "dashboard_counts" as never,
        {
          p_start: monthStart,
          p_end: monthEnd,
          p_today: todayStr,
          p_horizon: sixtyStr,
        } as never,
      );
      if (error) {
        if (!isMissingDatabaseFunction(error)) throw error;
        const fallback = await fetchDashboardCountsFallback(todayStr, sixtyStr);
        writeDashboardCountsSnapshot(
          `${year}-${month}-${periodSelection.selectedKey}`,
          fallback,
        );
        return fallback;
      }

      const lifecycleResult =
        can("attendance") || can("payroll") || can("invoice")
          ? await supabase.rpc(
              "dashboard_lifecycle_counts" as never,
              {
                p_year: year,
                p_month: month + 1,
                p_window_start: selectedWindow?.windowStartDay ?? null,
                p_window_end: selectedWindow?.windowEndDay ?? null,
              } as never,
            )
          : { data: null, error: null };
      const lifecycleData = lifecycleResult.error ? null : lifecycleResult.data;

      const d = (data ?? {}) as {
        orgs?: number;
        units?: number;
        employees?: number;
        contractsActive?: number;
        contractsExpiring?: Array<{
          id: string;
          contract_code: string;
          end_date: string;
          unit_id: string;
          status: string;
        }>;
        vehicles?: number;
        fuelTotal?: number | string;
        items?: number;
        sheetCounts?: { approved?: number; pending?: number; draft?: number; rejected?: number };
        runCounts?: {
          approved?: number;
          pending?: number;
          draft?: number;
          rejected?: number;
          open?: number;
          processed?: number;
        };
      };
      const buckets = (v?: {
        approved?: number;
        pending?: number;
        draft?: number;
        rejected?: number;
        open?: number;
        processed?: number;
      }) => ({
        approved: v?.approved ?? 0,
        pending: v?.pending ?? 0,
        draft: v?.draft ?? 0,
        rejected: v?.rejected ?? 0,
        open: v?.open ?? 0,
        processed: v?.processed ?? 0,
      });

      const lifecycle = (lifecycleData ?? {}) as {
        attendance?: { approved?: number; submitted?: number; rejected?: number; open?: number };
        payroll?: { processed?: number; ready?: number; open?: number };
        invoice?: { processed?: number; ready?: number; open?: number };
      };
      const sheetCounts = lifecycleData
        ? {
            approved: lifecycle.attendance?.approved ?? 0,
            pending: lifecycle.attendance?.submitted ?? 0,
            draft: 0,
            rejected: lifecycle.attendance?.rejected ?? 0,
            open: lifecycle.attendance?.open ?? 0,
            processed: 0,
          }
        : buckets(d.sheetCounts);
      const runCounts = lifecycleData
        ? {
            approved: 0,
            pending: lifecycle.payroll?.ready ?? 0,
            draft: 0,
            rejected: 0,
            open: lifecycle.payroll?.open ?? 0,
            processed: lifecycle.payroll?.processed ?? 0,
          }
        : buckets(d.runCounts);
      const invoiceCounts = lifecycleData
        ? {
            approved: 0,
            pending: lifecycle.invoice?.ready ?? 0,
            draft: 0,
            rejected: 0,
            open: lifecycle.invoice?.open ?? 0,
            processed: lifecycle.invoice?.processed ?? 0,
          }
        : buckets(undefined);

      const result: DashboardCounts = {
        orgs: d.orgs ?? 0,
        units: d.units ?? 0,
        employees: d.employees ?? 0,
        contractsActive: d.contractsActive ?? 0,
        contractsExpiring: d.contractsExpiring ?? [],
        vehicles: d.vehicles ?? 0,
        fuelTotal: Number(d.fuelTotal ?? 0),
        items: d.items ?? 0,
        sheetCounts,
        runCounts,
        invoiceCounts,
      };
      writeDashboardCountsSnapshot(`${year}-${month}-${periodSelection.selectedKey}`, result);
      return result;
    },
  });

  const pnlQuery = useQuery({
    queryKey: ["dashboard-pnl", year, month, periodSelection.selectedKey],
    // Phones stay on the light counts: the month P&L is a desktop view.
    // Commercial figures are RBAC-gated: skip the whole computation for roles
    // (e.g. HR) that hold payroll access but no client-commercial access.
    enabled:
      !permsLoading &&
      !showInventoryDashboard &&
      !showTransportDashboard &&
      !opsFocus &&
      !lightMode &&
      (can("payroll") || can("invoice") || can("contracts")),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const selectedPeriodIsCurrent = monthStart <= todayStr && todayStr <= monthEnd;
      const attendanceEnd = selectedPeriodIsCurrent ? todayStr : monthEnd;

      // One round trip. The database picks the current contract per unit,
      // resolves the roster (primary unit + mapped units) and collapses every
      // attendance row of the month into per (unit, employee, designation)
      // duty totals. Previously this screen paged through every unit,
      // customer, contract line, employee and attendance row and reduced them
      // in the browser.
      const { data, error } = await supabase.rpc(
        "dashboard_pnl_inputs" as never,
        {
          p_start: monthStart,
          p_end: monthEnd,
          p_att_end: attendanceEnd,
        } as never,
      );
      if (error) {
        if (isMissingDatabaseFunction(error)) {
          return {
            pnlRows: [] as PnLRow[],
            pnlTotals: { contract: 0, invoice: 0, payroll: 0 },
          };
        }
        throw error;
      }

      type UnitRow = {
        unit_id: string;
        unit_code: string;
        unit_name: string;
        customer_name: string;
        epf_cap_enabled: boolean | null;
        contract_id: string;
        is_internal: boolean | null;
        actual_strength: number | null;
      };
      type ResourceRow = {
        contract_id: string;
        designation_id: string | null;
        quantity: number | null;
        components: unknown;
        benefits: unknown;
        deductions: unknown;
        employer_contributions: unknown;
        payroll_day_base_id: string | null;
      };
      type PairRow = {
        unit_id: string;
        candidate_id: string;
        designation_id: string;
        p_days: number | string;
        ph_days: number | string;
        other_paid_days: number | string;
        ot_days: number | string;
      };
      type DayBaseRow = {
        id: string;
        method: string;
        fixed_days: number | null;
        weekly_off_day: number | null;
        included_weekdays: unknown;
      };

      const payload = (data ?? {}) as {
        units?: UnitRow[];
        resources?: ResourceRow[];
        pairs?: PairRow[];
        day_bases?: DayBaseRow[];
      };
      const allowedUnitIds = periodSelection.unitIdsForWindow;
      const unitRows = (payload.units ?? []).filter((unit) => allowedUnitIds.has(unit.unit_id));
      const resources = payload.resources ?? [];
      const pairRows = payload.pairs ?? [];

      const pdbMap = new Map<string, NonNullable<ContractResourceLike["payrollDayBase"]>>(
        (payload.day_bases ?? []).map((p) => [
          p.id,
          {
            method: p.method as
              | "actual_days"
              | "fixed_days"
              | "actual_minus_weekly_off"
              | "custom_weekdays"
              | "fixed_annual_average",
            fixedDays: p.fixed_days,
            weeklyOffDay: p.weekly_off_day,
            includedWeekdays: Array.isArray(p.included_weekdays)
              ? (p.included_weekdays as unknown[]).map(Number)
              : null,
          },
        ]),
      );

      const toResource = (r: ResourceRow): ContractResourceLike => ({
        designationId: r.designation_id ?? "",
        components: Array.isArray(r.components)
          ? (r.components as ContractResourceLike["components"])
          : [],
        benefits: Array.isArray(r.benefits) ? (r.benefits as ContractResourceLike["benefits"]) : [],
        deductions: Array.isArray(r.deductions)
          ? (r.deductions as ContractResourceLike["deductions"])
          : [],
        employerContributions: Array.isArray(r.employer_contributions)
          ? (r.employer_contributions as ContractResourceLike["employerContributions"])
          : [],
        payrollDayBase: r.payroll_day_base_id ? (pdbMap.get(r.payroll_day_base_id) ?? null) : null,
      });

      // Resources grouped by (contract_id → designation_id).
      const resByContractDesig = new Map<string, Map<string, ResourceRow>>();
      for (const r of resources) {
        if (!r.designation_id) continue;
        if (!resByContractDesig.has(r.contract_id))
          resByContractDesig.set(r.contract_id, new Map());
        resByContractDesig.get(r.contract_id)!.set(r.designation_id, r);
      }

      const hydratedResources = (await hydrateFormulasFromMaster(resources.map(toResource))).map(
        refreshBillingAddOns,
      );
      const hydratedByContractDesignation = new Map(
        resources.map((row, index) => [
          `${row.contract_id}|${row.designation_id ?? ""}`,
          hydratedResources[index] ?? toResource(row),
        ]),
      );
      const isNonBillableInvoiceItem = (item: { name?: string }) =>
        /\besi(c)?\b|\bprofessional\s*tax\b|\bpt\b/i.test(String(item.name ?? ""));

      // Period dates.
      const periodDates: string[] = [];
      {
        const s = new Date(monthStart);
        const e = new Date(monthEnd);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          periodDates.push(d.toISOString().slice(0, 10));
        }
      }
      const periodDateObjects = periodDates.map((date) => new Date(`${date}T00:00:00`));

      const pairsByUnit = new Map<string, PairRow[]>();
      for (const p of pairRows) {
        const list = pairsByUnit.get(p.unit_id);
        if (list) list.push(p);
        else pairsByUnit.set(p.unit_id, [p]);
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;

      const pnlByUnit = new Map<string, PnLRow>();
      for (const u of unitRows) {
        const resMap = resByContractDesig.get(u.contract_id) ?? new Map<string, ResourceRow>();
        const isInternal = u.is_internal === true;

        // Contract value reference: full-month projected per resource × quantity.
        let contractValue = 0;
        let committedPayroll = 0;
        let committedStrength = 0;
        for (const r of resMap.values()) {
          const qty = Number(r.quantity) || 0;
          committedStrength += qty;
          const resource =
            hydratedByContractDesignation.get(`${r.contract_id}|${r.designation_id ?? ""}`) ??
            toResource(r);
          const payrollPerHead = resource.components.reduce(
            (sum, item) => sum + (Number(item.amount) || 0),
            0,
          );
          const invoicePerHead =
            payrollPerHead +
            resource.employerContributions.reduce(
              (sum, item) => sum + (isNonBillableInvoiceItem(item) ? 0 : Number(item.amount) || 0),
              0,
            );
          committedPayroll += qty * payrollPerHead;
          if (!isInternal) contractValue += qty * invoicePerHead;
        }

        // Actuals: duty totals already aggregated per employee × designation.
        let invoiceAmount = 0;
        let payrollCost = 0;
        for (const p of pairsByUnit.get(u.unit_id) ?? []) {
          const resRow = resMap.get(p.designation_id);
          if (!resRow) continue;
          const pDays = round2(Number(p.p_days) || 0);
          const phDays = round2(Number(p.ph_days) || 0);
          const otDays = round2(Number(p.ot_days) || 0);
          const otherPaidDays = round2(Number(p.other_paid_days) || 0);
          const totals = {
            pDays,
            otHours: otDays,
            otDays,
            phDays,
            woDays: 0,
            otherPaidDays,
            tDays: round2(pDays + phDays + otDays),
          };
          const resource =
            hydratedByContractDesignation.get(`${u.contract_id}|${p.designation_id}`) ??
            toResource(resRow);
          const wages = computeWages(totals, resource, periodDates.length, {
            periodDates: periodDateObjects,
            epfCapEnabled: u.epf_cap_enabled ?? true,
          });
          const contractedInvoice =
            resource.components.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) +
            resource.employerContributions.reduce(
              (sum, item) => sum + (isNonBillableInvoiceItem(item) ? 0 : Number(item.amount) || 0),
              0,
            );
          const payrollDays =
            resolvePayrollDayCount(resource.payrollDayBase, periodDates) ?? wages.baseDays;
          const earnedInvoice =
            payrollDays > 0 ? (contractedInvoice / payrollDays) * totals.tDays : 0;
          if (!isInternal) invoiceAmount += earnedInvoice;
          payrollCost += wages.earnedGross;
        }

        const variance = invoiceAmount - payrollCost;
        pnlByUnit.set(u.unit_id, {
          unit_id: u.unit_id,
          unit_code: u.unit_code,
          unit_name: u.unit_name,
          customer_name: u.customer_name || "—",
          contract_value: contractValue,
          invoice_amount: invoiceAmount,
          payroll_cost: payrollCost,
          variance,
          variance_pct: invoiceAmount > 0 ? (variance / invoiceAmount) * 100 : 0,
          internal: isInternal,
          committed_payroll: committedPayroll,
          committed_strength: committedStrength,
          actual_strength: Number(u.actual_strength) || 0,
        });
      }

      const pnlRows = Array.from(pnlByUnit.values()).sort(
        (a, b) => b.contract_value - a.contract_value,
      );
      const pnlTotals = pnlRows.reduce(
        (s, r) => ({
          contract: s.contract + r.contract_value,
          invoice: s.invoice + r.invoice_amount,
          payroll: s.payroll + r.payroll_cost,
        }),
        { contract: 0, invoice: 0, payroll: 0 },
      );

      return { pnlRows, pnlTotals };
    },
  });

  // Managers count only what their own field officers cover, so the headline
  // tiles never show company-wide totals to a scoped manager.
  const scopedUnitIds = useMemo(
    () => (managerScope.isScoped ? [...managerScope.unitIds].sort() : null),
    [managerScope.isScoped, managerScope.unitIds],
  );
  const scopedCountsQuery = useQuery({
    queryKey: ["dashboard-counts-scoped", scopedUnitIds],
    enabled: !!scopedUnitIds,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const unitIds = scopedUnitIds ?? [];
      if (unitIds.length === 0)
        return { orgs: 0, units: 0, employees: 0, contractsActive: 0, contractsExpiring: [] as ContractExpiringRow[] };
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 60);
      const todayStr = new Date().toISOString().slice(0, 10);
      const horizonStr = horizon.toISOString().slice(0, 10);

      const [unitRows, links, contracts] = await Promise.all([
        supabase.from("units").select("id,customer_id").in("id", unitIds),
        supabase.from("candidate_units").select("candidate_id").in("unit_id", unitIds).limit(20000),
        supabase.from("client_contracts").select("id,contract_code,end_date,unit_id,status").in("unit_id", unitIds),
      ]);
      if (unitRows.error) throw unitRows.error;
      if (links.error) throw links.error;
      if (contracts.error) throw contracts.error;

      const orgs = new Set(
        ((unitRows.data ?? []) as Array<{ customer_id: string | null }>)
          .map((u) => u.customer_id)
          .filter(Boolean) as string[],
      );
      const employees = new Set(((links.data ?? []) as Array<{ candidate_id: string }>).map((l) => l.candidate_id));
      const contractRows = ((contracts.data ?? []) as unknown) as ContractExpiringRow[];
      const active = contractRows.filter((c) => c.status === "active");
      return {
        orgs: orgs.size,
        units: unitIds.length,
        employees: employees.size,
        contractsActive: active.length,
        contractsExpiring: active
          .filter((c) => c.end_date && c.end_date >= todayStr && c.end_date <= horizonStr)
          .sort((a, b) => a.end_date.localeCompare(b.end_date)),
      };
    },
  });

  const isLoading = countsQuery.isLoading;
  const data = useMemo(() => {
    if (!countsQuery.data) return undefined;
    return {
      ...countsQuery.data,
      ...(scopedCountsQuery.data ?? {}),
      pnlRows: pnlQuery.data?.pnlRows ?? ([] as PnLRow[]),
      pnlTotals: pnlQuery.data?.pnlTotals ?? { contract: 0, invoice: 0, payroll: 0 },
    };
  }, [countsQuery.data, scopedCountsQuery.data, pnlQuery.data]);

  const isCurrent = now.getFullYear() === year && now.getMonth() === month;

  const tiles = useMemo(() => {
    const t: { key: string; module: string; node: React.ReactNode }[] = [];
    if (data && opsFocus) {
      // Operations homepage: organizations, clients, contracts and field
      // officers. No designation follow-up, no employees, no money.
      if (can("organizations"))
        t.push({
          key: "orgs",
          module: "organizations",
          node: (
            <MetricTile
              icon={Building2}
              label="Organizations"
              value={data.orgs}
              accent="rose"
              to="/admin/customers/customer-manager"
            />
          ),
        });
      if (can("organizations"))
        t.push({
          key: "units",
          module: "organizations",
          node: (
            <MetricTile
              icon={Warehouse}
              label="Clients"
              value={data.units}
              accent="cyan"
              to="/admin/customers/unit-manager"
            />
          ),
        });
      if (can("contracts"))
        t.push({
          key: "contracts",
          module: "contracts",
          node: <ContractsTile active={data.contractsActive} expiring={data.contractsExpiring} />,
        });
      t.push({
        key: "fo",
        module: "field_sense",
        node: (
          <MetricTile
            icon={Users}
            label="Field officers"
            value={operationsOverview?.fieldOfficers ?? 0}
            accent="lime"
            to="/admin/field-sense/team"
            sub="Operations workforce"
          />
        ),
      });
      t.push({
        key: "fo-live",
        module: "field_sense",
        node: (
          <MetricTile
            icon={Radio}
            label="Live on duty today"
            value={liveOfficerCount}
            accent="emerald"
            to="/admin/field-sense"
            sub={`of ${operationsOverview?.fieldOfficers ?? 0} field officers`}
          />
        ),
      });
      t.push({
        key: "sites-today",
        module: "field_sense",
        node: (
          <MetricTile
            icon={MapPin}
            label="Sites visited today"
            value={operationsOverview?.sitesVisitedToday ?? 0}
            accent="sky"
            to="/admin/field-sense"
            sub="Distinct active client sites"
          />
        ),
      });
      t.push({
        key: "most-visited",
        module: "field_sense",
        node: <VisitInsightTile kind="most" items={operationsOverview?.topVisited ?? []} />,
      });
      t.push({
        key: "least-visited",
        module: "field_sense",
        node: <VisitInsightTile kind="least" items={operationsOverview?.bottomVisited ?? []} />,
      });
      return t;
    }
    if (data) {
      if (can("organizations"))
        t.push({
          key: "orgs",
          module: "organizations",
          node: (
            <MetricTile
              icon={Building2}
              label="Organizations"
              value={data.orgs}
              accent="rose"
              to="/admin/customers/customer-manager"
            />
          ),
        });
      if (can("organizations"))
        t.push({
          key: "units",
          module: "organizations",
          node: (
            <MetricTile
              icon={Warehouse}
              label="Clients"
              value={data.units}
              accent="cyan"
              to="/admin/customers/unit-manager"
            />
          ),
        });
      if (can("contracts"))
        t.push({
          key: "contracts",
          module: "contracts",
          node: <ContractsTile active={data.contractsActive} expiring={data.contractsExpiring} />,
        });
      if (can("contracts"))
        t.push({
          key: "contract-designations",
          module: "contracts",
          node: <ContractDesignationFollowUp actionable />,
        });
      if (can("employees"))
        t.push({
          key: "emp",
          module: "employees",
          node: (
            <MetricTile
              icon={UserPlus}
              label="Employees"
              value={data.employees}
              accent="lime"
              to="/admin/employees"
            />
          ),
        });
      if (can("employees")) t.push({ key: "uan", module: "employees", node: <UanFollowUp /> });
      if (can("vehicles"))
        t.push({
          key: "veh",
          module: "vehicles",
          node: (
            <DualTile
              icon={Briefcase}
              label="Vehicles"
              primary={data.vehicles}
              primaryLabel="In fleet"
              secondary={fmtINR(data.fuelTotal)}
              secondaryLabel="Spend this month"
              accent="violet"
              to="/admin/vehicles/inventory"
            />
          ),
        });
      if (can("inventory"))
        t.push({
          key: "inv",
          module: "inventory",
          node: (
            <MetricTile
              icon={PackageOpen}
              label="Inventory SKUs"
              value={data.items}
              accent="amber"
              to="/admin/inventory/stock"
            />
          ),
        });
      if (can("attendance"))
        t.push({
          key: "att",
          module: "attendance",
          node: (
            <StatusTile
              icon={ClipboardList}
              label="Attendance"
              approved={data.sheetCounts.approved}
              pending={data.sheetCounts.pending}
              draft={data.sheetCounts.draft}
              rejected={data.sheetCounts.rejected}
              open={data.sheetCounts.open}
              approvedLabel="Approved"
              pendingLabel="Submitted"
              openLabel="Open"
              accent="emerald"
              to="/admin/attendance"
            />
          ),
        });
      if (can("payroll"))
        t.push({
          key: "pay",
          module: "payroll",
          node: (
            <StatusTile
              icon={Wallet}
              label="Payroll"
              approved={data.runCounts.processed}
              pending={data.runCounts.pending}
              draft={0}
              rejected={0}
              open={data.runCounts.open}
              approvedLabel="Processed"
              pendingLabel="Ready"
              openLabel="Open"
              accent="sky"
              to="/admin/payroll"
            />
          ),
        });
      if (can("invoice"))
        t.push({
          key: "inv2",
          module: "invoice",
          node: (
            <StatusTile
              icon={Receipt}
              label="Invoicing"
              approved={data.invoiceCounts.processed}
              pending={data.invoiceCounts.pending}
              draft={0}
              rejected={0}
              open={data.invoiceCounts.open}
              approvedLabel="Invoiced"
              pendingLabel="Ready"
              openLabel="Open"
              accent="indigo"
              to="/admin/invoice"
            />
          ),
        });
    }
    return t;
  }, [data, can, opsFocus, operationsOverview, liveOfficerCount]);

  if (permsLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70" />
      </div>
    );
  }

  if (showTransportDashboard) {
    return (
      <div className="px-0 py-1 sm:p-6">
        <DashboardShell>
          <PageHeader
            title="Fleet & Assets"
            description="Vehicles and assets in one view — fleet strength, running spend, compliance renewals, asset value and loans."
            crumbs={[{ label: "Dashboard" }]}
          />
          <TransportFleetAssetsTiles />
        </DashboardShell>
      </div>
    );
  }

  if (showInventoryDashboard) {
    return (
      <div className="px-0 py-1 sm:p-6">
        <DashboardShell>
          <PageHeader
            title="Inventory Dashboard"
            description="Live inventory overview with stock value, quantities, procurement, transfers, and issuances."
            crumbs={[{ label: "Dashboard" }]}
          />
          <InventoryOwnerDashboard />
        </DashboardShell>
      </div>
    );
  }

  // RBAC: commercial figures never reach the render tree for roles without
  // invoicing access — payroll-only roles (HR) get payroll columns zeroed of
  // any client-billing data, so no profit can be derived from what renders.
  const canSeeCommercial = can("invoice");
  const financeRows: UnitFinanceRow[] = (data?.pnlRows ?? []).map((r) => ({
    unit_id: r.unit_id,
    unit_code: r.unit_code,
    unit_name: r.unit_name,
    customer_name: r.customer_name,
    internal: r.internal,
    committed_strength: r.committed_strength,
    actual_strength: r.actual_strength,
    committed_payroll: r.committed_payroll,
    actual_payroll: r.payroll_cost,
    committed_invoice: canSeeCommercial ? r.contract_value : 0,
    actual_invoice: canSeeCommercial ? r.invoice_amount : 0,
  }));

  return (
    <div data-mobile-dashboard className="w-full min-w-0 px-0 py-1 sm:p-6">
      <DashboardShell
        rightExtras={
          opsFocus ? (
            <PeopleInsightsSection hideLive roleKeys={OPS_PEOPLE_ROLE_KEYS} />
          ) : can("employees") ? (
            <PeopleInsightsSection compact />
          ) : null
        }
        fullWidthBelow={
          opsFocus ? (
            <>
              <OperationsRadarSummary />
              <AdminVisitProgressCard />
              <OperationsClientLocations data={operationsOverview} />
              <OperationsDeployments />
              <OperationsOrgTree />
            </>
          ) : (
            <>
              {!isLoading && data && (
                <>
                  {can("employees") && <EmployeeInsightsSection />}
                  {can("contracts") && <ClientContractPortfolioCard />}
                  {(can("payroll") || can("invoice")) && pnlQuery.isLoading && (
                    <div className="mb-4 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                      Loading payroll and invoice totals…
                    </div>
                  )}
                  {pnlQuery.error && (
                    <div className="mb-4 rounded-2xl border border-destructive/30 bg-card p-6">
                      <p className="text-sm font-medium text-destructive">
                        Payroll and invoice totals could not load.
                      </p>
                      <Button
                        className="mt-3"
                        variant="outline"
                        onClick={() => void pnlQuery.refetch()}
                      >
                        Try again
                      </Button>
                    </div>
                  )}
                  {pnlQuery.data && can("payroll") && <PayrollCoverageCard rows={financeRows} />}
                  {pnlQuery.data && can("invoice") && <InvoiceCoverageCard rows={financeRows} />}
                  {pnlQuery.data && can("invoice") && <ProfitabilityCard rows={financeRows} />}
                  {departmentTree}
                </>
              )}
            </>
          )
        }
      >
        {/* Month hero — restrained slate panel */}
        <div className="mobile-glass-surface relative overflow-hidden rounded-2xl border border-border/70 bg-card/72 p-3 shadow-sm sm:p-6">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-foreground/80" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <Sparkles className="h-3 w-3" /> Leadership snapshot
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display text-2xl font-bold leading-none tracking-tight text-foreground sm:text-[26px]">
                  {MONTH_NAMES[month]} {year}
                </span>
                {isCurrent && (
                  <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-background">
                    Current
                  </span>
                )}
              </div>
            </div>

            <div className="scrollbar-hide flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-0.5">
              <PayrollWindowPeriodPicker
                options={periodSelection.options}
                selectedKey={periodSelection.selectedKey}
                onWindowChange={periodSelection.selectWindow}
              />
              <MonthYearPicker
                className="border-primary/40 bg-primary/5 ring-1 ring-primary/15 dark:border-primary/50 dark:bg-primary/10"
                value={`${year}-${String(month + 1).padStart(2, "0")}`}
                onChange={(ym) => {
                  const [nextYear, nextMonth] = ym.split("-").map(Number);
                  setYear(nextYear);
                  setMonth(nextMonth - 1);
                  periodSelection.setPeriod(nextYear, nextMonth - 1);
                }}
              />
            </div>
          </div>
        </div>

        {/* Tiles */}
        <div
          className={`grid auto-rows-[124px] grid-cols-2 items-stretch gap-2 sm:auto-rows-[172px] sm:gap-4 md:grid-cols-3 lg:grid-cols-3 ${opsFocus ? "xl:grid-cols-4" : "xl:grid-cols-4"}`}
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[124px] animate-pulse rounded-2xl border border-border/60 bg-card sm:h-[172px] sm:rounded-[26px]"
                />
              ))
            : tiles.map((t, i) => (
                <motion.div
                  key={t.key}
                  className="h-full"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, delay: i * 0.045, ease: [0.22, 1, 0.36, 1] }}
                >
                  {t.node}
                </motion.div>
              ))}
        </div>

        {/* P&L renders full-width below the shell via fullWidthBelow */}
      </DashboardShell>
    </div>
  );
}

/* -------------------- Tiles — neutral card with subtle accent -------------------- */

type Accent = "rose" | "cyan" | "lime" | "violet" | "amber" | "emerald" | "sky" | "indigo";

const ACCENT_CHIP: Record<Accent, string> = {
  rose: "bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200/70 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20",
  lime: "bg-lime-50 text-lime-700 ring-lime-200/70 dark:bg-lime-500/10 dark:text-lime-300 dark:ring-lime-400/20",
  violet:
    "bg-violet-50 text-violet-700 ring-violet-200/70 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20",
  amber:
    "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20",
  indigo:
    "bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20",
};

const ACCENT_BAR: Record<Accent, string> = {
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  lime: "bg-lime-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  indigo: "bg-indigo-500",
};

const ACCENT_TILE_BG: Record<Accent, string> = {
  rose: "bg-rose-100/80 dark:bg-rose-500/15",
  cyan: "bg-cyan-100/80 dark:bg-cyan-500/15",
  lime: "bg-lime-100/80 dark:bg-lime-500/15",
  violet: "bg-violet-100/80 dark:bg-violet-500/15",
  amber: "bg-amber-100/80 dark:bg-amber-500/15",
  emerald: "bg-emerald-100/80 dark:bg-emerald-500/15",
  sky: "bg-sky-100/80 dark:bg-sky-500/15",
  indigo: "bg-indigo-100/80 dark:bg-indigo-500/15",
};

function Shell({
  children,
  to,
  accent = "indigo",
}: {
  children: React.ReactNode;
  to: string;
  accent?: Accent;
}) {
  return (
    <Link
      to={to}
      className={`group relative flex h-[124px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border/40 ${ACCENT_TILE_BG[accent]} p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:h-[172px] sm:rounded-[26px] sm:p-5`}
    >
      {children}
    </Link>
  );
}

function TileHeader({
  Icon,
  accent,
  label,
  sub,
}: {
  Icon?: React.ComponentType<{ className?: string }>;
  accent: Accent;
  label: string;
  sub?: string;
}) {
  void Icon;
  void accent;
  return (
    <div className="relative flex items-start justify-between gap-2 sm:gap-3">
      <div className="min-w-0">
        <div className="truncate whitespace-nowrap font-display text-[13px] font-medium leading-tight text-foreground sm:text-[15px]">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 truncate whitespace-nowrap text-[10px] leading-snug text-muted-foreground sm:mt-1 sm:text-[11px]">
            {sub}
          </div>
        )}
      </div>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-card text-foreground shadow-sm ring-1 ring-border/60 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:h-9 sm:w-9">
        <ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </span>
    </div>
  );
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  to,
  accent = "indigo",
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: Accent;
  to: string;
  sub?: string;
}) {
  const display = useCountUp(value);
  const I = icon;
  return (
    <Shell to={to} accent={accent}>
      <TileHeader accent={accent} label={label} sub={sub} />
      <div className="relative mt-auto flex items-end justify-between gap-3">
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[26px] font-medium leading-none tabular-nums text-foreground sm:text-[40px]">
          {display}
        </div>
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-card/80 ring-1 ring-inset sm:h-9 sm:w-9 ${ACCENT_CHIP[accent]}`}
        >
          <I className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </span>
      </div>
    </Shell>
  );
}

function DualTile({
  icon,
  label,
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
  to,
  accent = "violet",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: number;
  primaryLabel: string;
  secondary: string;
  secondaryLabel: string;
  accent?: Accent;
  to: string;
}) {
  const display = useCountUp(primary);
  return (
    <Shell to={to} accent={accent}>
      <TileHeader accent={accent} label={label} sub={primaryLabel} />
      <div className="relative mt-auto flex items-end justify-between gap-3">
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[26px] font-medium leading-none tabular-nums text-foreground sm:text-[40px]">
          {display}
        </div>
        <div className="min-w-0 max-w-[58%] flex flex-col items-end overflow-hidden text-right">
          <span className="w-full truncate whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-muted-foreground sm:text-[10px] sm:tracking-[0.1em]">
            {secondaryLabel}
          </span>
          <span className="mt-0.5 flex max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap font-display text-xs font-medium tabular-nums text-foreground sm:text-sm">
            <Fuel className="h-3.5 w-3.5 text-muted-foreground" />
            {secondary}
          </span>
        </div>
      </div>
    </Shell>
  );
}

function StatusTile({
  icon,
  label,
  approved,
  pending,
  draft,
  rejected,
  open,
  approvedLabel = "Approved",
  pendingLabel = "Pending",
  openLabel = "Open",
  to,
  accent = "emerald",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  approved: number;
  pending: number;
  draft: number;
  rejected: number;
  open?: number;
  accent?: Accent;
  approvedLabel?: string;
  pendingLabel?: string;
  openLabel?: string;
  to: string;
}) {
  const total = Math.max(approved + pending + draft + rejected + (open ?? 0), 1);
  return (
    <Shell to={to} accent={accent}>
      <TileHeader accent={accent} label={label} />
      <div
        className={`relative mt-auto grid min-w-0 gap-1.5 pb-2 sm:gap-3 sm:pb-3 ${open != null ? "grid-cols-3" : "grid-cols-2"}`}
      >
        <div className="min-w-0">
          <div className="whitespace-nowrap font-display text-[24px] font-medium tabular-nums leading-none text-foreground sm:text-[26px]">
            {approved}
          </div>
          <div className="mt-0.5 truncate whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-muted-foreground sm:mt-1 sm:text-[10px] sm:tracking-[0.1em]">
            {approvedLabel}
          </div>
        </div>
        <div className="min-w-0">
          <div className="whitespace-nowrap font-display text-[24px] font-medium tabular-nums leading-none text-foreground sm:text-[26px]">
            {pending}
          </div>
          <div className="mt-0.5 truncate whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-muted-foreground sm:mt-1 sm:text-[10px] sm:tracking-[0.1em]">
            {pendingLabel}
          </div>
        </div>
        {open != null && (
          <div className="min-w-0">
            <div className="whitespace-nowrap font-display text-[24px] font-medium tabular-nums leading-none text-foreground sm:text-[26px]">
              {open}
            </div>
            <div className="mt-0.5 truncate whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-muted-foreground sm:mt-1 sm:text-[10px] sm:tracking-[0.1em]">
              {openLabel}
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-auto flex h-1.5 overflow-hidden rounded-full bg-card/60">
        {approved > 0 && (
          <div className={ACCENT_BAR[accent]} style={{ width: `${(approved / total) * 100}%` }} />
        )}
        {pending > 0 && (
          <div
            className="bg-muted-foreground/50"
            style={{ width: `${(pending / total) * 100}%` }}
          />
        )}
        {draft > 0 && (
          <div className="bg-muted-foreground/30" style={{ width: `${(draft / total) * 100}%` }} />
        )}
        {rejected > 0 && (
          <div className="bg-rose-400/70" style={{ width: `${(rejected / total) * 100}%` }} />
        )}
        {(open ?? 0) > 0 && (
          <div
            className="bg-muted-foreground/20"
            style={{ width: `${((open ?? 0) / total) * 100}%` }}
          />
        )}
      </div>
    </Shell>
  );
}

function ContractsTile({
  active,
  expiring,
}: {
  active: number;
  expiring: Array<{ id: string; contract_code: string | null; end_date: string | null }>;
}) {
  const soonest = expiring[0];
  const display = useCountUp(active);
  const hasExpiring = expiring.length > 0;
  const alertText = hasExpiring
    ? `${expiring.length} renewal${expiring.length === 1 ? "" : "s"} in 60d`
    : "No renewals in 60d";
  const alertTone = hasExpiring
    ? "border-amber-200/70 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300"
    : "border-emerald-200/70 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300";
  return (
    <Shell to="/admin/contracts/client-contracts" accent="amber">
      <TileHeader accent="amber" label="Contracts" sub="Active client contracts" />
      <div className="relative mt-auto flex items-end justify-between gap-3">
        <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[26px] font-medium leading-none tabular-nums text-foreground sm:text-[40px]">
          {display}
        </div>
        <div
          className={`flex max-w-[55%] items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${alertTone}`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span
            className="truncate leading-none"
            title={hasExpiring && soonest?.end_date ? `Soonest: ${soonest.end_date}` : alertText}
          >
            {alertText}
          </span>
        </div>
      </div>
    </Shell>
  );
}

/* -------------------- Transport: fleet + assets combined -------------------- */

type FleetAssetsSnapshot = {
  vehicles: number;
  vehicleSpend: number;
  insuranceDue: number;
  pucDue: number;
  properties: number;
  propertyValue: number;
  assetSpend: number;
  loanOutstanding: number;
};

function TransportFleetAssetsTiles() {
  const q = useQuery<FleetAssetsSnapshot>({
    queryKey: ["transport-fleet-assets"],
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
    queryFn: async () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + 30);
      const horizonStr = horizon.toISOString().slice(0, 10);
      const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

      const [veh, fuel, ins, puc, props, expenses, loans] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase.from("vehicle_fuel_entries").select("amount").gte("entry_date", monthStart),
        supabase
          .from("vehicle_insurances")
          .select("id", { count: "exact", head: true })
          .gte("end_date", todayStr)
          .lte("end_date", horizonStr),
        supabase
          .from("vehicle_pucs")
          .select("id", { count: "exact", head: true })
          .gte("expiry_date", todayStr)
          .lte("expiry_date", horizonStr),
        supabase.from("properties").select("current_value,purchase_value").eq("enabled", true),
        supabase.from("property_expenses").select("amount").gte("expense_date", monthStart),
        supabase.from("property_loans").select("outstanding_amount").eq("enabled", true),
      ]);

      const sum = (rows: Array<Record<string, unknown>> | null, key: string) =>
        (rows ?? []).reduce((acc, row) => acc + Number(row[key] ?? 0), 0);

      const propertyRows = (props.data ?? []) as Array<{
        current_value: number | null;
        purchase_value: number | null;
      }>;

      return {
        vehicles: veh.count ?? 0,
        vehicleSpend: sum(fuel.data as Array<Record<string, unknown>> | null, "amount"),
        insuranceDue: ins.count ?? 0,
        pucDue: puc.count ?? 0,
        properties: propertyRows.length,
        propertyValue: propertyRows.reduce(
          (acc, p) => acc + Number(p.current_value ?? p.purchase_value ?? 0),
          0,
        ),
        assetSpend: sum(expenses.data as Array<Record<string, unknown>> | null, "amount"),
        loanOutstanding: sum(
          loans.data as Array<Record<string, unknown>> | null,
          "outstanding_amount",
        ),
      };
    },
  });

  if (q.isLoading) {
    return (
      <div className="grid auto-rows-[124px] grid-cols-2 gap-2 sm:auto-rows-[172px] sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[124px] animate-pulse rounded-2xl border border-border/60 bg-card sm:h-[172px] sm:rounded-[26px]"
          />
        ))}
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-6">
        <p className="text-sm font-medium text-destructive">Fleet and asset totals could not load.</p>
        <Button className="mt-3" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const d = q.data as FleetAssetsSnapshot;

  return (
    <div className="grid auto-rows-[124px] grid-cols-2 items-stretch gap-2 sm:auto-rows-[172px] sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      <DualTile
        icon={Briefcase}
        label="Vehicles"
        primary={d.vehicles}
        primaryLabel="In fleet"
        secondary={fmtINR(d.vehicleSpend)}
        secondaryLabel="Spend this month"
        accent="violet"
        to="/admin/vehicles/inventory"
      />
      <MetricTile
        icon={Fuel}
        label="Insurance renewals"
        value={d.insuranceDue}
        accent="rose"
        to="/admin/vehicles/insurances"
        sub="Due in 30 days"
      />
      <MetricTile
        icon={ClipboardList}
        label="PUC renewals"
        value={d.pucDue}
        accent="amber"
        to="/admin/vehicles/pucs"
        sub="Due in 30 days"
      />
      <DualTile
        icon={Building2}
        label="Assets"
        primary={d.properties}
        primaryLabel="On book"
        secondary={fmtINR(d.propertyValue)}
        secondaryLabel="Current value"
        accent="cyan"
        to="/admin/assets/inventory"
      />
      <MetricTile
        icon={Receipt}
        label="Asset spend"
        value={Math.round(d.assetSpend)}
        accent="emerald"
        to="/admin/assets/expense-manager"
        sub="This month"
      />
      <MetricTile
        icon={Wallet}
        label="Loan outstanding"
        value={Math.round(d.loanOutstanding)}
        accent="sky"
        to="/admin/assets/loan-manager"
        sub="Across asset loans"
      />
    </div>
  );
}
