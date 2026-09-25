import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, CheckCircle2, XCircle, Send, ChevronDown, ChevronUp, Banknote, PauseCircle, PlayCircle, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,

  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePublicHolidays, holidayMapForDates } from "@/lib/public-holidays";
import { supabaseSessionReady } from "@/lib/supabase-ready";
import { useCurrentPermissions } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import { hydrateFormulasFromMaster } from "@/lib/contract-hydrate";
import {
  applyEpfBreakdownToWageComputation,
  applyEsiToWageComputation,
  applyLwfToWageComputation,
  applyPtToWageComputation,
  computeAttendanceTotals,
  computeWages,
  mergeByCanonicalName,
  fmtINR,
  resolvePtAmount,
  type AttendanceCodeLike,
  type AttendanceEntryLike,
  type ContractResourceLike,
  type PincodeRangeLike,
  type PtSlabLike,
  EXTRA_DUTY_COMPONENT_RE,
} from "@/lib/payroll-calc";
import { resolveLwf, type LwfRow } from "@/lib/lwf-lookup";
import { openExport } from "@/lib/csv-export";
import {
  processPayrollRun,
  processPayrollAmendment,
  fetchRunSnapshots,
  asError,
  diffLines,

  type AmendmentDelta,
} from "@/lib/payroll-process";
import { setAmendmentStatus, fetchAttendanceVersions, fetchLiveSnapshot, diffAttendance } from "@/lib/attendance-versions";

import { fetchAttendanceEntriesForPeriod } from "@/lib/attendance-fetch";
import { downloadWageSlipPdf, downloadWageSlipsPdf, type WageSlipData } from "@/lib/company-documents";
import { downloadWageSlipsXlsx } from "@/lib/wage-slip-xlsx";
import { DataPagination, usePagination } from "@/components/DataPagination";

const searchSchema = z.object({
  start: z.string(),
  end: z.string(),
  candidate: z.string().optional(),
});

export const Route = createFileRoute("/admin/payroll/$unitId")({
  validateSearch: (s) => searchSchema.parse(s),
  component: PayrollUnitPage,
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Ledger names for one-off additions/deductions are stored as
// "<code> - <name> - <date>" (e.g. "41084 - Uniform - 2026-05-01").
// For display and exports we only want the middle "<name>" segment.
function cleanLedgerName(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const parts = s.split(/\s+-\s+/);
  if (parts.length >= 3) return parts[1].trim() || s;
  return s;
}

const ESI_COMPONENT_RE = /\besi(c)?\b/i;
const PT_COMPONENT_RE = /\bprofessional\s*tax\b|\bpt\b/i;
const isEsiItem = (item: { name?: unknown }) => ESI_COMPONENT_RE.test(String(item.name ?? ""));
const isPtItem = (item: { name?: unknown }) => PT_COMPONENT_RE.test(String(item.name ?? ""));
const contractTotalAmount = (item: { name?: unknown; amount?: unknown }) =>
  isEsiItem(item) || isPtItem(item) ? 0 : Number(item.amount) || 0;

// ---- Register column helpers (shared by the on-screen table and the CSV) ----
type NamedAmount = { name: string; amount: number };

const normColName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function lookupAmount(items: NamedAmount[] | undefined, label: string): number {
  if (!items) return 0;
  const target = normColName(label);
  const hit = items.find((i) => normColName(i.name) === target);
  return hit ? Number(hit.amount) || 0 : 0;
}

const sumAmounts = (items: NamedAmount[] | undefined, names: string[]) =>
  names.reduce((s, n) => s + lookupAmount(items, n), 0);

function deductionHeaderOf(name: string): string {
  const n = name.toLowerCase();
  if (/\b(e)?pf\b/.test(n)) return "EE EPF";
  if (/\besi(c)?\b/.test(n)) return "EE ESIC";
  if (/professional\s*tax|\bpt\b/.test(n)) return "EE PT";
  if (/\blwf\b|labour\s*welfare/.test(n)) return "EE LWF";
  const clean = name.replace(/\(.*?\)/g, "").replace(/employee\s*contribution/gi, "").replace(/\bnet\b/gi, "").trim().replace(/\s+/g, " ");
  return clean ? `EE ${clean}` : `EE ${name.trim()}`;
}

function employerHeaderOf(name: string): string {
  const n = name.toLowerCase();
  if (/\b(e)?pf\b/.test(n)) return "ER EPF";
  if (/\besi(c)?\b/.test(n)) return "ER ESIC";
  if (/\blwf\b|labour\s*welfare/.test(n)) return "ER LWF";
  if (/management\s*fee|\bmgmt\s*fee\b/.test(n)) return "ER Management Fee";
  const clean = name.replace(/\(.*?\)/g, "").replace(/employer\s*contribution/gi, "").replace(/\bnet\b/gi, "").trim().replace(/\s+/g, " ");
  return clean ? `ER ${clean}` : `ER ${name.trim()}`;
}

function groupColsByHeader(cols: string[], fmt: (name: string) => string): { header: string; names: string[] }[] {
  const map = new Map<string, string[]>();
  const order: string[] = [];
  for (const name of cols) {
    const h = fmt(name).trim().replace(/\s+/g, " ");
    if (!h) continue;
    if (!map.has(h)) { map.set(h, []); order.push(h); }
    map.get(h)!.push(name);
  }
  return order.map((h) => ({ header: h, names: map.get(h)! }));
}

function fmtPretty(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

function buildDates(start: string, end: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cursor = new Date(ys, ms - 1, ds);
  const stop = new Date(ye, me - 1, de);
  while (cursor <= stop) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function PayrollUnitPage() {
  const { unitId } = Route.useParams();
  const { start, end, candidate: highlightCandidate } = Route.useSearch();
  const lastScrolledCandidateRef = useRef<string | null>(null);

  const periodDates = useMemo(() => buildDates(start, end), [start, end]);

  const publicHolidays = usePublicHolidays();
  const { data: unitPh } = useQuery({
    queryKey: ["payroll-unit-ph", unitId],
    queryFn: async () => {
      const { data } = await supabase
        .from("units")
        .select("ph_enabled, ph_multiplier, ph_day_value" as never)
        .eq("id", unitId)
        .maybeSingle();
      const row = (data ?? null) as {
        ph_enabled?: boolean | null;
        ph_multiplier?: number | null;
        ph_day_value?: number | string | null;
      } | null;
      const dv = row?.ph_day_value;
      return {
        enabled: Boolean(row?.ph_enabled),
        multiplier: Number(row?.ph_multiplier ?? 1) || 1,
        dayValue: dv == null || Number.isNaN(Number(dv)) ? null : Number(dv),
      };
    },
  });
  const phConfig = useMemo(() => {
    if (!unitPh?.enabled) return null;
    const map = holidayMapForDates(periodDates, publicHolidays);
    if (map.size === 0) return null;
    return { dates: Array.from(map.keys()), multiplier: unitPh.multiplier };
  }, [unitPh, periodDates, publicHolidays]);

  const { data: unit } = useQuery({
    queryKey: ["payroll-unit", unitId],
    queryFn: async () => {
      await supabaseSessionReady();
      const { data } = await supabase
        .from("units")
        .select("id, code, name, customer_id, billing_state, billing_pincode, epf_cap_enabled")
        .eq("id", unitId)
        .maybeSingle();
      if (!data) return null;
      const { data: cust } = await supabase
        .from("customers")
        .select("name")
        .eq("id", data.customer_id ?? "")
        .maybeSingle();
      return { ...data, customer_name: cust?.name ?? "" };
    },
  });

  const { data: ptSlabs } = useQuery({
    queryKey: ["pt_slabs_payroll"],
    queryFn: async (): Promise<PtSlabLike[]> => {
      const { data, error } = await supabase
        .from("professional_tax_slabs")
        .select("id, state, region_label, salary_min, salary_max, tax_per_month, gender");
      if (error) throw error;
      return (data ?? []) as PtSlabLike[];
    },
  });

  const { data: pincodeRanges } = useQuery({
    queryKey: ["pincode_ranges_payroll"],
    queryFn: async (): Promise<PincodeRangeLike[]> => {
      const { data, error } = await supabase
        .from("pincode_ranges")
        .select("state, region_label, range_start, range_end, is_excluded");
      if (error) throw error;
      return (data ?? []) as PincodeRangeLike[];
    },
  });

  // LWF Master: live-synced so editing LWF Manager in Control Center
  // affects the very next payroll run.
  const { data: lwfRows } = useQuery({
    queryKey: ["labour_welfare_funds_payroll"],
    queryFn: async (): Promise<LwfRow[]> => {
      const { data, error } = await supabase
        .from("labour_welfare_funds")
        .select("id, state, deduction_months, frequency, employee_contribution, employer_contribution, enabled, notes");
      if (error) throw error;
      return (data ?? []) as LwfRow[];
    },
  });

  const sheetQK = ["payroll-sheet", unitId, start, end];
  const { data: sheet } = useQuery({
    queryKey: sheetQK,
    queryFn: async () => {
      await supabaseSessionReady();
      const { data } = await supabase
        .from("attendance_sheets" as never)
        .select("id, status, approved_at, current_version, amendment_status")
        .eq("unit_id", unitId)
        .eq("period_start", start)
        .eq("period_end", end)
        .maybeSingle();
      return data as unknown as {
        id: string;
        status: string;
        approved_at: string | null;
        current_version: number | null;
        amendment_status: string | null;
      } | null;
    },
  });
  const sheetVersion = Math.max(1, Number(sheet?.current_version) || 1);
  const amendmentStatus = sheet?.amendment_status ?? "none";

  // Which employees' attendance cells actually moved in this amendment.
  // The money diff is restricted to these people — nobody untouched is ever
  // adjusted, whatever the recomputation says.
  const { data: amendedCandidateIds } = useQuery({
    queryKey: ["attendance-amendment-diff", unitId, start, end, sheetVersion],
    enabled: amendmentStatus === "approved" && sheetVersion > 1,
    queryFn: async () => {
      const versions = await fetchAttendanceVersions(unitId, start, end);
      const prev = versions
        .filter((v) => v.version < sheetVersion)
        .sort((a, b) => b.version - a.version)[0];
      if (!prev) return null;
      const live = await fetchLiveSnapshot(unitId, start, end);
      return new Set(diffAttendance(prev.snapshot ?? [], live).map((d) => d.candidateId));
    },
  });




  const queryClient = useQueryClient();
  const { can } = useCurrentPermissions();
  const canApprove = can("payroll", "approve");

  type RunStatus = "draft" | "submitted" | "approved" | "rejected";
  type RunRow = {
    id: string;
    status: RunStatus;
    rejection_reason: string | null;
    approved_at: string | null;
    submitted_at: string | null;
    payroll_status: string | null;
    payroll_processed_at: string | null;
  };
  const runQK = ["payroll-run", unitId, start, end];
  const { data: run } = useQuery({
    queryKey: runQK,
    queryFn: async (): Promise<RunRow | null> => {
      const { data, error } = await supabase
        .from("payroll_runs" as never)
        .select("id, status, rejection_reason, approved_at, submitted_at, payroll_status, payroll_processed_at")
        .eq("unit_id", unitId)
        .eq("period_start", start)
        .eq("period_end", end)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as RunRow | null);
    },
  });
  const runStatus: RunStatus = run?.status ?? "draft";
  const isProcessed = run?.payroll_status === "processed";

  // Employees excluded from processing for this run.
  const holdsQK = ["payroll-holds", run?.id ?? "none"];
  const { data: savedHolds = [] } = useQuery({
    queryKey: holdsQK,
    enabled: !!run?.id,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("payroll_processing_holds" as never)
        .select("candidate_id")
        .eq("payroll_run_id", run!.id);
      if (error) throw error;
      return ((data ?? []) as unknown as { candidate_id: string }[]).map((h) => h.candidate_id);
    },
  });
  const [holdDraft, setHoldDraft] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHoldDraft(new Set(savedHolds));
  }, [savedHolds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleHold = (candidateId: string) => {
    setHoldDraft((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const transitionRun = useMutation({
    mutationFn: async (next: { status: RunStatus; reason?: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      const ts = new Date().toISOString();
      const base: Record<string, unknown> = {
        unit_id: unitId,
        period_start: start,
        period_end: end,
        status: next.status,
      };
      if (next.status === "submitted") { base.submitted_at = ts; base.submitted_by = uid; }
      if (next.status === "approved") { base.approved_at = ts; base.approved_by = uid; }
      if (next.status === "rejected") {
        base.rejected_at = ts; base.rejected_by = uid;
        base.rejection_reason = next.reason ?? "";
      }
      if (next.status === "draft") { base.rejection_reason = null; }
      if (run?.id) {
        const { error } = await supabase.from("payroll_runs" as never).update(base as never).eq("id", run.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("payroll_runs" as never).insert(base as never);
        if (error) throw error;
      }
      void logActivity({
        module: "Payroll",
        action: next.status === "submitted" ? "submit" : next.status === "approved" ? "approve" : next.status === "rejected" ? "reject" : "reopen",
        entityType: "payroll_runs",
        entityLabel: `${unitId} ${start} → ${end}`,
        details: { unit_id: unitId, period_start: start, period_end: end, status: next.status, reason: next.reason ?? "" },
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: runQK });
      toast.success(
        vars.status === "submitted" ? "Payroll submitted for approval" :
        vars.status === "approved" ? "Payroll approved" :
        vars.status === "rejected" ? "Payroll rejected" : "Payroll reopened",
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const unitState = (unit as { billing_state?: string | null } | null | undefined)?.billing_state ?? null;
  const unitPincode = (unit as { billing_pincode?: string | null } | null | undefined)?.billing_pincode ?? null;
  // Unit-level EPF cap policy — contracts on this unit inherit it.
  const epfCapEnabled =
    (unit as { epf_cap_enabled?: boolean | null } | null | undefined)?.epf_cap_enabled ?? true;

  const { data, isPending, error } = useQuery({
    queryKey: ["payroll-register-compute", unitId, start, end, unitState, unitPincode, epfCapEnabled, (ptSlabs?.length ?? 0), (pincodeRanges?.length ?? 0), (lwfRows?.length ?? 0)],
    // `unit` feeds PT state / pincode / EPF-cap policy — computing before it
    // lands produces a wrong (often zero) first render that only self-corrects
    // on a hard refresh.
    enabled: unit !== undefined && !!ptSlabs && !!pincodeRanges && !!lwfRows,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      await supabaseSessionReady();
      // 1. Roster: candidates mapped to this unit (primary + secondary).
      const candidateCols =
        "id, employee_code, full_name, designation_id, gender, is_disabled, bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_branch, approved_at, preferred_joining_date, application_date, pan_number, compliance";
      const [{ data: primary }, { data: links }] = await Promise.all([
        supabase
          .from("candidates")
          .select(candidateCols)
          .eq("unit_id", unitId)
          .eq("is_enabled", true)
          .eq("status", "active"),
        supabase.from("candidate_units").select("candidate_id").eq("unit_id", unitId),
      ]);
      const linkIds = (links ?? []).map((l) => l.candidate_id);
      let secondary: typeof primary = [];
      if (linkIds.length > 0) {
        const { data } = await supabase
          .from("candidates")
          .select(candidateCols)
          .in("id", linkIds)
          .eq("is_enabled", true)
          .eq("status", "active");
        secondary = data ?? [];
      }
      const roster = Array.from(
        new Map([...(primary ?? []), ...(secondary ?? [])].map((c) => [c.id, c])).values(),
      );

      const designationIds = Array.from(
        new Set(roster.map((c) => c.designation_id).filter(Boolean)),
      ) as string[];
      const { data: designations } = await supabase
        .from("designations")
        .select("id, name")
        .in("id", designationIds.length ? designationIds : ["00000000-0000-0000-0000-000000000000"]);
      const desigMap = new Map((designations ?? []).map((d) => [d.id, d.name as string]));

      // 2. Attendance entries (fetched per day to avoid backend row caps)
      const entries = await fetchAttendanceEntriesForPeriod({ unitId, start, end }) as Array<{
        candidate_id: string;
        designation_id: string | null;
        entry_date: string;
        code: string;
        ot_hours: number | string | null;
      }>;

      const { data: codes } = await supabase
        .from("attendance_codes")
        .select("code, counts_as_present, is_paid, day_value")
        .eq("enabled", true);

      // 3. Contract resources for this unit's active contract.
      const { data: contracts } = await supabase
        .from("client_contracts")
        .select("id, payroll_window_id")
        .eq("unit_id", unitId)
        .eq("record_type", "client")
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(1);
      const contractId = contracts?.[0]?.id;

      let resources: Record<string, unknown>[] = [];
      if (contractId) {
        const { data: r } = await supabase
          .from("contract_resources")
          .select(
            "designation_id, components, benefits, deductions, employer_contributions, payroll_day_base_id",
          )
          .eq("contract_id", contractId);
        resources = r ?? [];
      }

      // 3b. Per-employee Additions & Deductions (Control Center catalog).
      // Pull anything dated within the payroll period and still active.
      const candidateIds = roster.map((c) => c.id);
      type PerEmpItem = { name: string; amount: number };
      type DayAdj = { pDays: number; otDays: number; phDays: number; otherPaidDays: number; tDays: number };
      const additionsByCandidate = new Map<string, PerEmpItem[]>();
      const deductionsByCandidate = new Map<string, PerEmpItem[]>();
      const dayAdjustmentByCandidate = new Map<string, DayAdj>();
      const phDisplayCountByCandidate = new Map<string, number>();
      // PH cash override: user-entered PH addition amount is paid as-is on
      // the "Paid Holiday" line (bypasses the engine's perDayRate × phCount).
      const phCashByCandidate = new Map<string, number>();
      if (candidateIds.length > 0) {
        const [addsRes, dedsRes, priorAttendanceRes, addTypesRes] = await Promise.all([
          supabase
            .from("additions" as never)
            .select("candidate_id, addition_type_id, addition_name, calculation_type, amount, installments, status, entry_mode, days, include_in_total_days, affects_days_for, source_kind")
            .in("candidate_id", candidateIds)
            .gte("addition_date", start)
            .lte("addition_date", end)
            .eq("status", "active"),

          supabase
            .from("deductions" as never)
            .select("candidate_id, deduction_name, calculation_type, amount, installments, status, entry_mode, days, include_in_total_days, affects_days_for, source_kind, deduction_date")
            .in("candidate_id", candidateIds)
            .lte("deduction_date", end)
            .eq("status", "active"),
          // A joining fee dated before the employee's first attended payroll
          // window must be carried into that first window rather than lost.
          // Knowing who already attended before this period prevents the
          // one-time fee from repeating in later payrolls.
          supabase
            .from("attendance_entries")
            .select("candidate_id")
            .eq("unit_id", unitId)
            .in("candidate_id", candidateIds)
            .lt("entry_date", start),
          supabase.from("addition_types").select("id, code"),
        ]);
        const phTypeIds = new Set<string>(
          ((addTypesRes.data ?? []) as { id: string; code: string | null }[])
            .filter((t) => (t.code ?? "").toLowerCase() === "paid_holidays")
            .map((t) => t.id),
        );
        type RawAdd = { candidate_id: string; addition_type_id?: string | null; addition_name: string; calculation_type: string; amount: number | string; installments: number; entry_mode?: string | null; days?: number | string | null; include_in_total_days?: boolean | null; affects_days_for?: string[] | null; source_kind?: string | null };
        type RawDed = { candidate_id: string; deduction_name: string; calculation_type: string; amount: number | string; installments: number; entry_mode?: string | null; days?: number | string | null; include_in_total_days?: boolean | null; affects_days_for?: string[] | null; source_kind?: string | null; deduction_date: string };
        // Carry-forward from an amended earlier payroll: flag it on the line so
        // the register shows it came from a previous month.
        const carryLabel = (name: string, sourceKind: string | null | undefined) =>
          sourceKind === "payroll_amendment" ? `${name} — previous period` : name;

        const candidatesWithPriorAttendance = new Set(
          ((priorAttendanceRes.data ?? []) as { candidate_id: string }[]).map((row) => row.candidate_id),
        );
        const applyDayAdj = (cid: string, dayDelta: number, buckets: string[] | null | undefined, sign: 1 | -1) => {
          if (!dayDelta) return;
          const prev = dayAdjustmentByCandidate.get(cid) ?? { pDays: 0, otDays: 0, phDays: 0, otherPaidDays: 0, tDays: 0 };
          const list = (buckets ?? []).filter(Boolean);
          if (list.length === 0) list.push("present");
          for (const b of list) {
            if (b === "present" || b === "worked") prev.pDays += sign * dayDelta;
            else if (b === "ot") prev.otDays += sign * dayDelta;
            else if (b === "ph") prev.phDays += sign * dayDelta;
            else prev.otherPaidDays += sign * dayDelta;
          }
          // Only P / ED / PH buckets add to total PAID days.
          const paidBuckets = list.filter((b) => b === "present" || b === "worked" || b === "ot" || b === "ph").length;
          prev.tDays += sign * dayDelta * paidBuckets;
          dayAdjustmentByCandidate.set(cid, prev);
        };
        // System-computed day buckets: when an addition/deduction affects
        // these buckets via day-adjustments, the cash value is recomputed
        // by computeWages from the contract gross (perDayRate × days for PH,
        // perDutyOt × days for OT). Pushing the manual amount as a cash
        // addition would double-count, so we suppress it and rely on the
        // engine. Buckets like 'present'/'worked'/'other' don't have a
        // built-in cash line, so we still keep the addition row for those.
        const SYSTEM_COMPUTED_BUCKETS = new Set(["ph", "ot"]);
        const isSystemComputedDayAdj = (entryMode: string | null | undefined, includeInTotal: boolean | null | undefined, buckets: string[] | null | undefined) =>
          entryMode === "days_x_per_day"
          && !!includeInTotal
          && Array.isArray(buckets)
          && buckets.length > 0
          && buckets.every((b) => SYSTEM_COMPUTED_BUCKETS.has(b));

        for (const a of ((addsRes.data ?? []) as unknown as RawAdd[])) {
          const inst = Math.max(1, Number(a.installments) || 1);
          const amt = (Number(a.amount) || 0) / inst;
          const isPhType = !!(a.addition_type_id && phTypeIds.has(String(a.addition_type_id)));
          if (isPhType) {
            // PH-type addition: pay the user-entered amount directly on the
            // Paid Holiday line; bump the PH Days display count; skip the
            // generic cash-addition row and day-adjustment paths so we
            // don't double-count.
            phCashByCandidate.set(
              a.candidate_id,
              (phCashByCandidate.get(a.candidate_id) ?? 0) + amt,
            );
            const phDelta = Math.max(1, Number(a.days) || 1);
            phDisplayCountByCandidate.set(
              a.candidate_id,
              (phDisplayCountByCandidate.get(a.candidate_id) ?? 0) + phDelta,
            );
            continue;
          }
          const isDayAdj = isSystemComputedDayAdj(a.entry_mode, a.include_in_total_days, a.affects_days_for);
          if (!isDayAdj) {
            const arr = additionsByCandidate.get(a.candidate_id) ?? [];
            arr.push({ name: carryLabel(cleanLedgerName(a.addition_name), a.source_kind), amount: Math.round(amt * 100) / 100 });
            additionsByCandidate.set(a.candidate_id, arr);
          }
          if (a.entry_mode === "days_x_per_day" && a.include_in_total_days) {
            applyDayAdj(a.candidate_id, Number(a.days) || 0, a.affects_days_for, +1);
          }
        }
        // A one-time joining fee may be dated a few days before the window
        // opens (e.g. joined 5 Jun, window starts 26 Jun). Carry it forward
        // ONLY for genuinely new joiners — i.e. the joining date falls after
        // the previous window's start, so no earlier payroll could have
        // billed it. Long-tenured staff never re-pay a joining fee, and their
        // GPAIP is picked up in the window containing their anniversary.
        const prevWindowStart = (() => {
          const d = new Date(`${start}T00:00:00Z`);
          d.setUTCMonth(d.getUTCMonth() - 1);
          return d.toISOString().slice(0, 10);
        })();
        const joiningDateByCandidate = new Map<string, string | null>(
          roster.map((c) => [
            c.id,
            ((c as unknown as Record<string, unknown>)["preferred_joining_date"] as string | null) ?? null,
          ]),
        );
        for (const d of ((dedsRes.data ?? []) as unknown as RawDed[])) {
          const isInPeriod = d.deduction_date >= start;
          const joined = joiningDateByCandidate.get(d.candidate_id) ?? null;
          const isNewJoiner = !!joined && joined >= prevWindowStart;
          const isFirstWindowJoiningFee = d.source_kind === "unit_fee"
            && isNewJoiner
            && d.deduction_date >= (joined as string)
            && !candidatesWithPriorAttendance.has(d.candidate_id);
          if (!isInPeriod && !isFirstWindowJoiningFee) continue;

          const inst = Math.max(1, Number(d.installments) || 1);
          const rawAmt = (Number(d.amount) || 0) / inst;
          // Gross amendment recoveries are stored as a negative employee net
          // impact in the ledger. In payroll they must still increase the
          // deduction bucket, unlike negative statutory rows (which are
          // genuine refunds and must reduce that bucket).
          const isGrossAmendmentRecovery = d.source_kind === "payroll_amendment"
            && /^gross deduction\b/i.test(cleanLedgerName(d.deduction_name));
          const amt = isGrossAmendmentRecovery ? Math.abs(rawAmt) : rawAmt;
          const isDayAdj = isSystemComputedDayAdj(d.entry_mode, d.include_in_total_days, d.affects_days_for);
          if (!isDayAdj) {
            const arr = deductionsByCandidate.get(d.candidate_id) ?? [];
            arr.push({ name: carryLabel(cleanLedgerName(d.deduction_name), d.source_kind), amount: Math.round(amt * 100) / 100 });
            deductionsByCandidate.set(d.candidate_id, arr);
          }
          if (d.entry_mode === "days_x_per_day" && d.include_in_total_days) {
            applyDayAdj(d.candidate_id, Number(d.days) || 0, d.affects_days_for, -1);
          }
        }

      }


      // Coerce attendance entries missing a designation to the candidate's
      // primary designation so they roll into a real contract-resource line
      // instead of a phantom "no designation" row that shows ₹0.
      const primaryDesigByCandidate = new Map(
        roster.map((c) => [c.id, c.designation_id ?? null] as const),
      );
      for (const e of entries) {
        if (!e.designation_id) {
          const primary = primaryDesigByCandidate.get(e.candidate_id) ?? null;
          if (primary) e.designation_id = primary;
        }
      }

      // Make sure we know the names of any designation_ids referenced by entries
      // that weren't in the roster's primary designation list.
      const allDesigIds = new Set<string>(designationIds);
      for (const e of entries) if (e.designation_id) allDesigIds.add(e.designation_id);
      for (const r of resources) {
        const d = r.designation_id ? String(r.designation_id) : "";
        if (d) allDesigIds.add(d);
      }
      if (allDesigIds.size > 0) {
        const { data: extraDs } = await supabase
          .from("designations")
          .select("id, name")
          .in("id", Array.from(allDesigIds));
        for (const d of extraDs ?? []) desigMap.set(d.id, d.name as string);
      }

      // Load ALL enabled payroll day bases — referenced by contract resources
      // AND by cost component / allowance divisors (pdb:<uuid>).
      const { data: pdbs } = await supabase
        .from("payroll_day_bases")
        .select("id, method, fixed_days, weekly_off_day, included_weekdays, enabled");
      type PdbMethod = "actual_days" | "fixed_days" | "actual_minus_weekly_off" | "custom_weekdays" | "fixed_annual_average";
      const pdbMap = new Map<string, NonNullable<ContractResourceLike["payrollDayBase"]>>(
        (pdbs ?? []).map((p) => [
          p.id,
          {
            method: p.method as PdbMethod,
            fixedDays: p.fixed_days,
            weeklyOffDay: p.weekly_off_day,
            includedWeekdays: Array.isArray((p as unknown as { included_weekdays?: unknown }).included_weekdays)
              ? ((p as unknown as { included_weekdays: unknown[] }).included_weekdays.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6))
              : null,
          },
        ]),
      );
      const dayBases = (pdbs ?? []).map((p) => ({
        id: String(p.id),
        method: p.method as PdbMethod,
        fixedDays: p.fixed_days,
        weeklyOffDay: p.weekly_off_day,
        includedWeekdays: Array.isArray((p as unknown as { included_weekdays?: unknown }).included_weekdays)
          ? ((p as unknown as { included_weekdays: unknown[] }).included_weekdays.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6))
          : null,
      }));

      const resourceByDesignation = new Map<string, ContractResourceLike>();
      for (const r of resources) {
        const did = String(r.designation_id ?? "");
        if (!did) continue;
        resourceByDesignation.set(did, {
          designationId: did,
          components: Array.isArray(r.components)
            ? (r.components as { name: string; amount: number; allowanceId?: string | null; includeInOt?: boolean; formulaMode?: string | null; formulaExpression?: string | null; formulaVersion?: number | null }[]).map((c) => ({
                name: String(c.name ?? ""),
                amount: Number(c.amount) || 0,
                allowanceId: c.allowanceId ?? null,
                includeInOt: c.includeInOt,
                formulaMode: c.formulaMode ?? null,
                formulaExpression: c.formulaExpression ?? null,
                formulaVersion: c.formulaVersion ?? null,
              }))
            : [],
          benefits: Array.isArray(r.benefits) ? (r.benefits as { name: string; amount: number; formulaMode?: string | null; formulaExpression?: string | null }[]) : [],
          deductions: Array.isArray(r.deductions)
            ? (r.deductions as { name: string; amount: number; allowanceId?: string | null; costComponentId?: string | null; deductionCalcType?: "earned_salary" | "fixed_amount"; formulaMode?: string | null; formulaExpression?: string | null }[])
            : [],
          employerContributions: Array.isArray(r.employer_contributions)
            ? (r.employer_contributions as { name: string; amount: number; allowanceId?: string | null; costComponentId?: string | null; deductionCalcType?: "earned_salary" | "fixed_amount"; formulaMode?: string | null; formulaExpression?: string | null }[])
            : [],
          payrollDayBase: r.payroll_day_base_id
            ? pdbMap.get(String(r.payroll_day_base_id)) ?? null
            : null,
        });
      }

      // Hydrate formula_mode/expression/version from Control Center masters
      // so payroll always reflects the LATEST master formula — even when the
      // contract snapshot pre-dates the formula engine. Per-line `amount`
      // (the agreed monetary base) stays from the snapshot.
      const hydratedList = await hydrateFormulasFromMaster(Array.from(resourceByDesignation.values()));
      for (const r of hydratedList) {
        resourceByDesignation.set(r.designationId, r);
      }

      // 3c. Per-employee wage sheets (non-billable employees). These override
      // the contract resource: a non-billable employee is not deployed against
      // a client contract, their wages are their own.
      const resourceByCandidate = new Map<string, ContractResourceLike>();
      {
        const rosterIds = roster.map((c) => c.id);
        if (rosterIds.length > 0) {
          const { data: ew } = await supabase
            .from("employee_wages" as never)
            .select(
              "candidate_id, designation_id, components, benefits, deductions, employer_contributions, payroll_day_base_id",
            )
            .in("candidate_id", rosterIds);
          const raw = ((ew ?? []) as unknown) as Record<string, unknown>[];
          for (const r of raw) {
            resourceByCandidate.set(String(r.candidate_id), {
              designationId: String(r.designation_id ?? ""),
              components: Array.isArray(r.components) ? (r.components as ContractResourceLike["components"]) : [],
              benefits: Array.isArray(r.benefits) ? (r.benefits as ContractResourceLike["benefits"]) : [],
              deductions: Array.isArray(r.deductions) ? (r.deductions as ContractResourceLike["deductions"]) : [],
              employerContributions: Array.isArray(r.employer_contributions)
                ? (r.employer_contributions as ContractResourceLike["employerContributions"])
                : [],
              payrollDayBase: r.payroll_day_base_id ? pdbMap.get(String(r.payroll_day_base_id)) ?? null : null,
            });
          }
          if (resourceByCandidate.size > 0) {
            const ids = Array.from(resourceByCandidate.keys());
            const hydratedEw = await hydrateFormulasFromMaster(
              ids.map((id) => resourceByCandidate.get(id)!),
            );
            hydratedEw.forEach((r, i) => resourceByCandidate.set(ids[i], r));
          }
        }
      }

      // 4. Build line items per (candidate, designation_id).
      // Each candidate gets a primary line (their own designation) plus an extra
      // line for any other designation found in their attendance entries.
      const rosterById = new Map(roster.map((c) => [c.id, c]));
      const pairKey = (cid: string, did: string | null) => `${cid}|${did ?? "__none__"}`;
      const pairs = new Map<string, { candidateId: string; designationId: string | null }>();

      for (const c of roster) {
        const k = pairKey(c.id, c.designation_id ?? null);
        pairs.set(k, { candidateId: c.id, designationId: c.designation_id ?? null });
      }
      for (const e of entries) {
        if (!rosterById.has(e.candidate_id)) continue;
        const k = pairKey(e.candidate_id, e.designation_id);
        if (!pairs.has(k)) pairs.set(k, { candidateId: e.candidate_id, designationId: e.designation_id });
      }

      const rows = Array.from(pairs.values()).map((p) => {
        const c = rosterById.get(p.candidateId)!;
        const did = p.designationId ? String(p.designationId) : "";
        const designationName = (p.designationId && desigMap.get(p.designationId)) || "—";
        // Filter entries to just this (candidate, designation) pair so totals reflect only that line.
        const lineEntries = entries.filter(
          (e) => e.candidate_id === p.candidateId && (e.designation_id ?? null) === p.designationId,
        );
        // Public holiday credit belongs to the employee, not to each line they
        // appear on: a reliever line (designation other than their own) must not
        // earn a second PH credit in the same unit.
        const isPrimaryLine = (c.designation_id ?? null) === p.designationId;
        const totals = computeAttendanceTotals(
          c.id,
          periodDates,
          lineEntries as AttendanceEntryLike[],
          (codes ?? []) as AttendanceCodeLike[],
          isPrimaryLine ? phConfig : null,
          (c as { preferred_joining_date?: string | null }).preferred_joining_date ?? null,
          unitPh?.dayValue ?? null,
        );
        // Apply per-employee day adjustments from additions/deductions that opted into
        // "Include in total days" — only on the candidate's primary designation line.
        const isPrimaryForAdj = (c.designation_id ?? null) === p.designationId;
        if (isPrimaryForAdj) {
          const adj = dayAdjustmentByCandidate.get(c.id);
          if (adj) {
            totals.pDays = Math.max(0, totals.pDays + adj.pDays);
            totals.otDays = Math.max(0, totals.otDays + adj.otDays);
            totals.phDays = Math.max(0, totals.phDays + adj.phDays);
            totals.otherPaidDays = Math.max(0, totals.otherPaidDays + adj.otherPaidDays);
            totals.tDays = Math.max(0, totals.tDays + adj.tDays);
          }
          // Display-only PH count from PH-type lumpsum additions.
          const phDisplay = phDisplayCountByCandidate.get(c.id) ?? 0;
          if (phDisplay) totals.phDays = totals.phDays + phDisplay;
        }
        const resource = resourceByCandidate.get(c.id) ?? resourceByDesignation.get(did);
        const phOverride = isPrimaryForAdj ? phCashByCandidate.get(c.id) : undefined;
        const wages = resource
          ? computeWages(totals, resource, periodDates.length, { phOverrideAmount: phOverride, periodDates: periodDates.map((d) => new Date(d)), dayBases, epfCapEnabled })
          : null;
        const isPrimary = (c.designation_id ?? null) === p.designationId;
        const candidateGender = ((c as unknown as { gender?: string | null }).gender ?? "").toString();
        const candidateIsDisabled = Boolean((c as unknown as { is_disabled?: boolean | null }).is_disabled);

        // Fold per-employee additions/deductions onto the primary line only so
        // we don't double-count across multiple designation lines for one person.
        if (wages && isPrimary) {
          const extraAdds = additionsByCandidate.get(c.id) ?? [];
          const extraDeds = deductionsByCandidate.get(c.id) ?? [];
          const addAdditions: { name: string; amount: number }[] = extraAdds;
          (wages as unknown as { additions: { name: string; amount: number }[] }).additions = addAdditions;
          if (extraDeds.length > 0) {
            wages.deductions = [...wages.deductions, ...extraDeds];
          }
          const addTotal = extraAdds.reduce((s, a) => s + a.amount, 0);
          wages.earnedGross = Math.round((wages.earnedGross + addTotal) * 100) / 100;
          Object.assign(wages, applyEsiToWageComputation(wages, { isDisabled: candidateIsDisabled }));
        }

        // Resolve Professional Tax for this employee from state/gender/earnedGross slabs.
        let ptResolved: ReturnType<typeof resolvePtAmount> | null = null;
        if (wages && isPrimary) {
          ptResolved = resolvePtAmount({
            state: unitState,
            pincode: unitPincode,
            gender: candidateGender,
            // PT slabs are read on regular earned gross; extra duty never
            // counts towards any deduction base.
            earnedGross: Math.max(
              0,
              wages.earnedGross -
                wages.components
                  .filter((c) => EXTRA_DUTY_COMPONENT_RE.test(c.name))
                  .reduce((s2, c) => s2 + (Number(c.amount) || 0), 0),
            ),
            slabs: (ptSlabs ?? []) as PtSlabLike[],
            ranges: (pincodeRanges ?? []) as PincodeRangeLike[],
          });
          Object.assign(wages, applyPtToWageComputation(wages, ptResolved.amount));
        } else if (wages) {
          // PT is a once-a-month statutory deduction per employee. Secondary
          // lines (e.g. extra-duty-only designation rows) must never charge it
          // again — the primary line already carries it.
          const stripped = wages.deductions.filter((d) => !PT_COMPONENT_RE.test(d.name));
          if (stripped.length !== wages.deductions.length) {
            const totalDeductions = Math.round(stripped.reduce((s, d) => s + d.amount, 0) * 100) / 100;
            Object.assign(wages, {
              deductions: stripped,
              totalDeductions,
              netPay: Math.max(0, Math.round((wages.earnedGross - totalDeductions) * 100) / 100),
            });
          }
        }



        // Resolve LWF from Control Center master (pincode → state → LWF row).
        // Only fires if this period's month is in the master's deduction_months
        // and the master row is enabled. Otherwise LWF rows are zeroed.
        if (wages && isPrimary && lwfRows && pincodeRanges) {
          const lwfRes = resolveLwf(String(unitPincode ?? ""), pincodeRanges as never, lwfRows);
          const periodMonth = new Date(start).getMonth() + 1; // 1-12
          let applies = false;
          let employee = 0;
          let employer = 0;
          if (lwfRes.kind === "match" && lwfRes.lwf.enabled) {
            const months = Array.isArray(lwfRes.lwf.deduction_months) ? lwfRes.lwf.deduction_months : [];
            if (months.length === 0 || months.includes(periodMonth)) {
              applies = true;
              employee = Number(lwfRes.lwf.employee_contribution) || 0;
              employer = Number(lwfRes.lwf.employer_contribution) || 0;
            }
          }
          Object.assign(wages, applyLwfToWageComputation(wages, { employee, employer, applies }));
        }

        // Split EPF employer contribution into statutory (EPS + EPF) sub-lines.
        // Total employer cost is preserved.
        if (wages && isPrimary) {
          Object.assign(wages, applyEpfBreakdownToWageComputation(wages, { epfCapEnabled }));
        }




        // Collapse variants like "HRA 5%" / "HRA 15%" into a single "HRA"
        // entry so columns and breakdowns are de-duplicated everywhere
        // (table, drawer, Wage Register, Pay Sheet, MIS). Totals are unchanged.
        const mergedResource = resource
          ? {
              ...resource,
              components: mergeByCanonicalName(resource.components),
              benefits: mergeByCanonicalName(resource.benefits),
              deductions: mergeByCanonicalName(resource.deductions),
              employerContributions: mergeByCanonicalName(resource.employerContributions),
            }
          : null;
        if (wages) {
          wages.components = mergeByCanonicalName(wages.components) as typeof wages.components;
          wages.deductions = mergeByCanonicalName(wages.deductions) as typeof wages.deductions;
          wages.employerContributions = mergeByCanonicalName(wages.employerContributions) as typeof wages.employerContributions;
          const wAny = wages as unknown as { additions?: { name: string; amount: number }[] };
          if (Array.isArray(wAny.additions)) {
            wAny.additions = mergeByCanonicalName(wAny.additions);
          }
        }

        const cAny = c as unknown as Record<string, unknown>;
        return {
          id: c.id,
          rowKey: pairKey(c.id, p.designationId),
          employeeCode: c.employee_code || "",
          name: c.full_name || "—",
          designation: designationName,
          designationId: p.designationId,
          isPrimary,
          totals,
          wages,
          resource: mergedResource ?? null,
          hasContract: !!resource,
          pt: ptResolved,
          bankAccountHolder: (cAny.bank_account_holder as string) || "",
          bankAccountNumber: (cAny.bank_account_number as string) || "",
          bankIfsc: (cAny.bank_ifsc as string) || "",
          bankName: (cAny.bank_name as string) || "",
          bankBranch: (cAny.bank_branch as string) || "",
          dateOfJoining:
            (cAny.preferred_joining_date as string) ||
            (cAny.approved_at as string) ||
            (cAny.application_date as string) ||
            "",
          panNumber: (cAny.pan_number as string) || "",
          pfNumber: ((cAny.compliance as Record<string, unknown> | null)?.pf_number as string) || "",
          esiNumber: ((cAny.compliance as Record<string, unknown> | null)?.esic_number as string) || "",
          uan: ((cAny.compliance as Record<string, unknown> | null)?.uan as string) || "",
        };
      });

      // Drop non-primary designation lines that ended up with zero attendance.
      // Primary always stays — it carries per-candidate additions/deductions.
      const visibleRows = rows.filter((r) => {
        if (r.isPrimary) return true;
        const t = r.totals;
        return (t.pDays + t.phDays + t.otDays + t.otherPaidDays) > 0;
      });

      visibleRows.sort((a, b) => {
        const an = (a.employeeCode || a.name).localeCompare(b.employeeCode || b.name);
        if (an !== 0) return an;
        // primary first, then by designation name
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.designation.localeCompare(b.designation);
      });

      return visibleRows;
    },
  });



  // Keep the last successful register mounted while reference data or a manual
  // recalculation refreshes in the background. Replacing this large table with
  // an empty/loading state tears down every row and is perceived as a full-page
  // flicker, especially when an expanded pay sheet changes the table height.
  const rows = data ?? [];
  const isLoading = isPending && data === undefined;
  const pg = usePagination(rows);

  // ---- Form XVI wage slips -------------------------------------------------
  const [slipBusy, setSlipBusy] = useState<string | null>(null);

  // The salary slip is the document handed to the employee for what was
  // approved in this period. Approved figures are frozen in the v1 snapshot;
  // a later attendance amendment is settled in the next payroll.
  const buildSlip = (r: (typeof rows)[number]): WageSlipData => {
    const paid = snapshots
      .filter((s) => s.candidate_id === r.id)
      .sort((a, b) => a.version - b.version)[0];

    const mergeLines = (lines: NamedAmount[]) => mergeByCanonicalName(lines)
      .map((line) => ({ name: line.name, amount: Math.round((Number(line.amount) || 0) * 100) / 100 }))
      .filter((line) => Math.abs(line.amount) >= 0.005);
    const comps = mergeLines((paid ? paid.earnings : r.wages?.components ?? []) as NamedAmount[]);
    const deds = mergeLines((paid ? paid.deductions : r.wages?.deductions ?? []) as NamedAmount[]);
    const adds = mergeLines((paid ? paid.additions : (r.wages as unknown as { additions?: NamedAmount[] } | null)?.additions ?? []) as NamedAmount[]);
    const grossWages = paid ? Number(paid.gross) || 0 : Number(r.wages!.earnedGross) || 0;
    const total = paid
      ? Number(paid.total_deductions) || 0
      : Number(r.wages!.totalDeductions) || 0;
    const netWages = paid ? Number(paid.net_pay) || 0 : Number(r.wages!.netPay) || 0;
    const paidDays = paid ? Number(paid.paid_days) || 0 : r.totals.tDays;
    const edDays = paid ? Number(paid.ed_days) || 0 : r.totals.otDays;

    const pick = (re: RegExp) =>
      comps.filter((c) => re.test(c.name)).reduce((s2, c) => s2 + (Number(c.amount) || 0), 0);
    const basic = pick(/\bbasic\b/i);
    const da = pick(/\bd\.?\s*a\.?\b|dearness/i);
    const ed = pick(EXTRA_DUTY_COMPONENT_RE);
    const other = Math.max(0, grossWages - basic - da - ed);
    const dedSum = (re: RegExp) =>
      deds.filter((d) => re.test(d.name)).reduce((s2, d) => s2 + (Number(d.amount) || 0), 0);
    const pf = dedSum(/\bepf\b|provident\s*fund|\bpf\b/i);
    const esi = dedSum(/\besi(c)?\b/i);
    return {
      employeeName: r.name,
      employeeCode: r.employeeCode,
      designation: r.designation,
      uan: r.uan || "",
      bankAccountNumber: r.bankAccountNumber || "",
      wagePeriod: `${fmtPretty(start)} – ${fmtPretty(end)}`,
      period: `${fmtPretty(start)} – ${fmtPretty(end)}`,
      establishmentAddress: [unit?.name, unit?.customer_name].filter(Boolean).join(", "),
      rateBasic: basic,
      rateDa: da,
      rateOther: other,
      totalAttendance: paid
        ? `${paidDays} paid day(s) (incl. ED ${edDays})`
        : `${r.totals.tDays} paid day(s) (P ${r.totals.pDays} · PH ${r.totals.phDays} · ED ${r.totals.otDays})`,
      extraDutyWages: ed,
      grossWages,
      dedPf: pf,
      dedEsi: esi,
      dedOthers: Math.max(0, total - pf - esi),
      totalDeductions: total,
      netWages,
      earningLines: comps,
      additionLines: adds,
      deductionLines: deds,
    };
  };

  const payableSlipRows = () => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (!r.wages || seen.has(r.id)) return false;
      const slip = buildSlip(r);
      if (slip.grossWages <= 0 && slip.netWages <= 0) return false;
      seen.add(r.id);
      return true;
    });
  };

  const downloadSlip = async (r: (typeof rows)[number], kind: "xlsx" | "pdf") => {
    if (!r.wages) return;
    setSlipBusy(`${r.rowKey}:${kind}`);
    try {
      const slip = buildSlip(r);
      const filename = `salary-slip-${r.employeeCode || r.name}-${start}-${end}`;
      if (kind === "pdf") await downloadWageSlipPdf(slip, `${filename}.pdf`);
      else await downloadWageSlipsXlsx([slip], filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate salary slip");
    } finally {
      setSlipBusy(null);
    }
  };

  const downloadAllSlips = async (kind: "xlsx" | "pdf") => {
    const list = payableSlipRows();
    if (list.length === 0) return;
    setSlipBusy(`__all__:${kind}`);
    try {
      const slips = list.map(buildSlip);
      const filename = `salary-slips-${unit?.code ?? unitId}-${start}-${end}`;
      if (kind === "pdf") await downloadWageSlipsPdf(slips, filename);
      else await downloadWageSlipsXlsx(slips, filename);
      toast.success(`${list.length} salary slips downloaded in one ${kind === "pdf" ? "PDF" : "Excel workbook"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate salary slips");
    } finally {
      setSlipBusy(null);
    }
  };

  // ---- Versioned processing --------------------------------------------
  // Every processed run stores a per-employee snapshot. An amended attendance
  // sheet (v2+) is settled by posting only the difference against the last
  // snapshot, so nobody is paid twice for the same period.
  const snapshotsQK = ["payroll-snapshots", run?.id ?? "none"];
  const { data: snapshots = [] } = useQuery({
    queryKey: snapshotsQK,
    enabled: !!run?.id,
    queryFn: () => fetchRunSnapshots(run!.id),
  });
  const lastSnapshotVersion = snapshots.reduce((m, s) => Math.max(m, Number(s.version) || 0), 0);
  const amendmentPending = amendmentStatus === "approved" && sheetVersion > lastSnapshotVersion;

  const buildPayloadRows = () =>
    rows
      .filter((r) => r.wages)
      .map((r) => ({
        candidateId: r.id,
        employeeCode: r.employeeCode,
        name: r.name,
        earnings: (r.wages!.components ?? []).map((c) => ({ name: c.name, amount: Number(c.amount) || 0 })),
        deductions: (r.wages!.deductions ?? []).map((d) => ({ name: cleanLedgerName(d.name) || d.name, amount: Number(d.amount) || 0 })),
        employerContributions: (r.wages!.employerContributions ?? []).map((d) => ({ name: d.name, amount: Number(d.amount) || 0 })),
        additions: (((r.wages as unknown as { additions?: { name: string; amount: number }[] }).additions) ?? []).map((a) => ({
          name: cleanLedgerName(a.name) || a.name,
          amount: Number(a.amount) || 0,
        })),
        paidDays: Number(r.totals?.tDays) || 0,
        edDays: Number(r.totals?.otDays) || 0,
        gross: Number(r.wages!.earnedGross) || 0,
        netPay: Number(r.wages!.netPay) || 0,
      }));

  // Employees whose money moved between the last paid snapshot and now.
  // An employee can hold several register rows (one per unit designation), so
  // the live figures are aggregated per candidate first — comparing a single
  // designation row against the whole paid snapshot would flag people whose
  // attendance was never touched.
  const amendmentDeltas: AmendmentDelta[] = useMemo(() => {
    if (!amendmentPending || lastSnapshotVersion === 0) return [];
    const prev = new Map(
      snapshots.filter((s) => s.version === lastSnapshotVersion).map((s) => [s.candidate_id, s]),
    );
    type LiveAgg = {
      code: string;
      name: string;
      after: AmendmentDelta["after"];
      earnings: { name: string; amount: number }[];
      deductions: { name: string; amount: number }[];
      employer: { name: string; amount: number }[];
    };
    const live = new Map<string, LiveAgg>();
    for (const r of rows) {
      if (!r.wages) continue;
      const prevAgg = live.get(r.id);
      const cur = prevAgg?.after ?? {
        paidDays: 0, edDays: 0, gross: 0, totalDeductions: 0, totalEmployer: 0, netPay: 0,
      };
      live.set(r.id, {
        code: r.employeeCode,
        name: r.name,
        after: {
          paidDays: cur.paidDays + (Number(r.totals?.tDays) || 0),
          edDays: cur.edDays + (Number(r.totals?.otDays) || 0),
          gross: cur.gross + (Number(r.wages.earnedGross) || 0),
          totalDeductions: cur.totalDeductions + (Number(r.wages.totalDeductions) || 0),
          totalEmployer: cur.totalEmployer + (Number(r.wages.totalEmployerContributions) || 0),
          netPay: cur.netPay + (Number(r.wages.netPay) || 0),
        },
        earnings: [
          ...(prevAgg?.earnings ?? []),
          ...(r.wages.components ?? []).map((c) => ({ name: c.name, amount: Number(c.amount) || 0 })),
        ],
        deductions: [
          ...(prevAgg?.deductions ?? []),
          ...(r.wages.deductions ?? []).map((x) => ({ name: cleanLedgerName(x.name) || x.name, amount: Number(x.amount) || 0 })),
        ],
        employer: [
          ...(prevAgg?.employer ?? []),
          ...(r.wages.employerContributions ?? []).map((x) => ({ name: x.name, amount: Number(x.amount) || 0 })),
        ],
      });
    }
    const out: AmendmentDelta[] = [];
    for (const [candidateId, l] of live) {
      if (amendedCandidateIds && !amendedCandidateIds.has(candidateId)) continue;

      const p = prev.get(candidateId);
      const before = {
        paidDays: Number(p?.paid_days) || 0,
        edDays: Number(p?.ed_days) || 0,
        gross: Number(p?.gross) || 0,
        totalDeductions: Number(p?.total_deductions) || 0,
        totalEmployer: Number(p?.total_employer) || 0,
        netPay: Number(p?.net_pay) || 0,
      };
      const after = l.after;
      if (
        Math.abs(before.netPay - after.netPay) < 0.005 &&
        Math.abs(before.totalEmployer - after.totalEmployer) < 0.005 &&
        Math.abs(before.paidDays - after.paidDays) < 0.005
      ) continue;
      out.push({
        candidateId,
        employeeCode: l.code,
        name: l.name,
        before,
        after,
        earningsBefore: (p?.earnings ?? []) as { name: string; amount: number }[],
        earningsAfter: l.earnings,
        deductionsBefore: (p?.deductions ?? []) as { name: string; amount: number }[],
        deductionsAfter: l.deductions,
        employerBefore: (p?.employer_contributions ?? []) as { name: string; amount: number }[],
        employerAfter: l.employer,
      });
    }
    return out;
  }, [amendmentPending, lastSnapshotVersion, snapshots, rows, amendedCandidateIds]);



  const [amendReviewOpen, setAmendReviewOpen] = useState(false);

  const processAmendment = useMutation({
    mutationFn: async () => {
      if (!run?.id) throw new Error("Payroll run not found");
      const result = await processPayrollAmendment({
        runId: run.id,
        unitId,
        unitLabel: (unit?.name as string) || (unit?.code as string) || unitId,
        periodStart: start,
        periodEnd: end,
        version: sheetVersion,
        deltas: amendmentDeltas,
        rows: buildPayloadRows(),
        heldCandidateIds: Array.from(holdDraft),
      });
      if (sheet?.id) await setAmendmentStatus(sheet.id, "processed");
      void logActivity({
        module: "Payroll",
        action: "process",
        entityType: "payroll_runs",
        entityLabel: `${unitId} ${start} → ${end} amendment v${sheetVersion}`,
        details: { unit_id: unitId, period_start: start, period_end: end, ...result },
      });
      return result;
    },
    onSuccess: (res) => {
      setAmendReviewOpen(false);
      queryClient.invalidateQueries({ queryKey: runQK });
      queryClient.invalidateQueries({ queryKey: sheetQK });
      queryClient.invalidateQueries({ queryKey: snapshotsQK });
      queryClient.invalidateQueries({ queryKey: ["admin", "deductions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "additions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "employer-contributions"] });
      toast.success(
        `Amendment v${res.version} processed — ${res.affected} employee${res.affected === 1 ? "" : "s"} adjusted. ` +
          `Arrears ${fmtINR(res.arrears)}, recoveries ${fmtINR(res.recoveries)} (net ${fmtINR(res.netImpact)}).`,
        { duration: 8000 },
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to process amendment"),
  });

  // Approval immediately parks every computed money line into its permanent
  // ledger and freezes the salary-slip snapshot. There is no second process step.
  const processRun = useMutation({
    mutationFn: async () => {
      if (!run?.id) throw new Error("Payroll run not found");
      const payloadRows = buildPayloadRows();

      const result = await processPayrollRun({
        runId: run.id,
        unitId,
        unitLabel: (unit?.name as string) || (unit?.code as string) || unitId,
        periodStart: start,
        periodEnd: end,
        rows: payloadRows,
        heldCandidateIds: Array.from(holdDraft),
        version: sheetVersion,

      });
      void logActivity({
        module: "Payroll",
        action: "process",
        entityType: "payroll_runs",
        entityLabel: `${unitId} ${start} → ${end}`,
        details: { unit_id: unitId, period_start: start, period_end: end, ...result },
      });
      return result;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: runQK });
      queryClient.invalidateQueries({ queryKey: holdsQK });
      queryClient.invalidateQueries({ queryKey: snapshotsQK });

      queryClient.invalidateQueries({ queryKey: ["admin", "employer-contributions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "deductions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "additions"] });
      toast.success(
        `Payroll approved — ${res.processed} employee${res.processed === 1 ? "" : "s"} finalized (${fmtINR(res.netTotal)}). ` +
          `${res.deductionRows} deduction, ${res.employerRows} employer contribution and ${res.additionRows} add-on lines posted.` +
          (res.held ? ` ${res.held} on hold.` : ""),
        { duration: 8000 },
      );
    },
    onError: (e: unknown) => toast.error(asError(e, "Failed to finalize payroll approval").message, { duration: 12000 }),
  });

  const approveImmediately = async () => {
    try {
      if (runStatus === "submitted") await transitionRun.mutateAsync({ status: "approved" });
      await processRun.mutateAsync();
    } catch {
      // Each mutation displays its own specific error.
    }
  };

  useEffect(() => {
    if (!highlightCandidate || rows.length === 0) return;
    const scrollKey = `${unitId}:${start}:${end}:${highlightCandidate}`;
    if (lastScrolledCandidateRef.current === scrollKey) return;
    const el = document.getElementById(`payroll-row-${highlightCandidate}`);
    if (!el) return;
    lastScrolledCandidateRef.current = scrollKey;
    el.scrollIntoView({ behavior: "auto", block: "center" });
  }, [highlightCandidate, rows.length, unitId, start, end]);



  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        if (!r.wages) return acc;
        acc.earnedGross += r.wages.earnedGross;
        acc.deductions += r.wages.totalDeductions;
        acc.employerContrib += r.wages.totalEmployerContributions;
        acc.net += r.wages.netPay;
        acc.employerCost += r.wages.employerCost;
        return acc;
      },
      { earnedGross: 0, deductions: 0, employerContrib: 0, net: 0, employerCost: 0 },
    );
  }, [rows]);

  // On-screen register columns: earnings (Basic / DA / HRA / …) and employee
  // deductions (EE EPF / EE ESIC / EE PT / …) are derived from what the
  // contract actually configures, so the table adapts per client. Columns that
  // are zero across every row are dropped. Employer contributions are hidden
  // by default and can be toggled on.
  const registerCols = useMemo(() => {
    const collect = (pick: (r: (typeof rows)[number]) => NamedAmount[] | undefined) => {
      const seen = new Map<string, string>();
      rows.forEach((r) => {
        (pick(r) ?? []).forEach((it) => {
          if (!it?.name) return;
          const key = normColName(it.name);
          if (!key || seen.has(key)) return;
          seen.set(key, it.name);
        });
      });
      return Array.from(seen.values());
    };

    const earningNames = collect((r) => r.wages?.components as NamedAmount[] | undefined)
      .filter((n) => rows.some((r) => Math.abs(lookupAmount(r.wages?.components as NamedAmount[] | undefined, n)) > 0.005));
    const deductionGroups = groupColsByHeader(
      collect((r) => r.wages?.deductions as NamedAmount[] | undefined),
      deductionHeaderOf,
    ).filter((g) => rows.some((r) => Math.abs(sumAmounts(r.wages?.deductions as NamedAmount[] | undefined, g.names)) > 0.005));
    const employerGroups = groupColsByHeader(
      collect((r) => r.wages?.employerContributions as NamedAmount[] | undefined),
      employerHeaderOf,
    ).filter((g) => rows.some((r) => Math.abs(sumAmounts(r.wages?.employerContributions as NamedAmount[] | undefined, g.names)) > 0.005));

    return { earningNames, deductionGroups, employerGroups };
  }, [rows]);

  const showEarnings = true;
  const showDeductionCols = true;
  const showEmployerCols = false;

  const earningCols = showEarnings ? registerCols.earningNames : [];
  const deductionCols = showDeductionCols ? registerCols.deductionGroups : [];
  const employerCols = showEmployerCols ? registerCols.employerGroups : [];
  // expander + emp id + name + designation + total paid days
  // + earnings + earned gross + deductions + total deductions + net pay
  // + employer groups (+ employer cost when shown)
  // Pay-status / hold column only matters once payroll is approved.
  const showHoldColumn = runStatus === "approved";
  const registerColCount =
    5 + (showHoldColumn ? 1 : 0) + earningCols.length + 1 + deductionCols.length + 1 + 1 + employerCols.length + (showEmployerCols ? 1 : 0);


  const exportCsv = () => {
    if (isLoading || rows.length === 0) {
      toast.error(
        isLoading
          ? "Payroll is still loading — please wait a moment and try again."
          : "No payroll data to export for this period.",
      );
      return;
    }

    // ---- helpers ----
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const lookup = (items: { name: string; amount: number }[] | undefined, label: string) => {
      if (!items) return 0;
      const target = norm(label);
      const hit = items.find((i) => norm(i.name) === target);
      return hit ? Number(hit.amount) || 0 : 0;
    };
    const sumByNames = (
      items: { name: string; amount: number }[] | undefined,
      names: string[],
    ) => names.reduce((s, n) => s + lookup(items, n), 0);

    const collectUnique = (
      pick: (r: (typeof rows)[number]) => { name: string }[] | undefined,
    ) => {
      const seen = new Map<string, string>();
      rows.forEach((r) => {
        (pick(r) ?? []).forEach((it) => {
          if (!it?.name) return;
          const key = norm(it.name);
          if (!key || seen.has(key)) return;
          seen.set(key, it.name);
        });
      });
      return Array.from(seen.values());
    };

    const formatDeductionHeader = (name: string): string => {
      const n = name.toLowerCase();
      if (/\b(e)?pf\b/.test(n)) return "EE EPF";
      if (/\besi(c)?\b/.test(n)) return "EE ESIC";
      if (/professional\s*tax|\bpt\b/.test(n)) return "EE PT";
      if (/\blwf\b|labour\s*welfare/.test(n)) return "EE LWF";
      const clean = name.replace(/\(.*?\)/g, "").replace(/employee\s*contribution/gi, "").replace(/\bnet\b/gi, "").trim().replace(/\s+/g, " ");
      return clean ? `EE ${clean}` : `EE ${name.trim()}`;
    };
    const formatEmployerHeader = (name: string): string => {
      const n = name.toLowerCase();
      if (/\b(e)?pf\b/.test(n)) return "ER EPF";
      if (/\besi(c)?\b/.test(n)) return "ER ESIC";
      if (/\blwf\b|labour\s*welfare/.test(n)) return "ER LWF";
      if (/management\s*fee|\bmgmt\s*fee\b/.test(n)) return "ER Management Fee";
      const clean = name.replace(/\(.*?\)/g, "").replace(/employer\s*contribution/gi, "").replace(/\bnet\b/gi, "").trim().replace(/\s+/g, " ");
      return clean ? `ER ${clean}` : `ER ${name.trim()}`;
    };

    const groupByHeader = (
      cols: string[],
      fmt: (name: string) => string,
    ): { header: string; names: string[] }[] => {
      const map = new Map<string, string[]>();
      const order: string[] = [];
      for (const name of cols) {
        const h = fmt(name).trim().replace(/\s+/g, " ");
        if (!h) continue;
        if (!map.has(h)) { map.set(h, []); order.push(h); }
        map.get(h)!.push(name);
      }
      return order.map((h) => ({ header: h, names: map.get(h)! }));
    };

    // ---- collect columns ----
    const CONTRACT_COMPONENT_COLS = collectUnique((r) => r.resource?.components);
    const EARNED_COMPONENT_COLS = collectUnique((r) => r.wages?.components);
    const DEDUCTION_COLS = collectUnique((r) => r.wages?.deductions);
    const ADDITION_COLS = collectUnique((r) =>
      (r.wages as unknown as { additions?: { name: string; amount: number }[] } | null)?.additions,
    );
    const EMPLOYER_CONTRIB_COLS = collectUnique((r) => r.wages?.employerContributions);
    const DEDUCTION_GROUPS = groupByHeader(DEDUCTION_COLS, formatDeductionHeader);
    const EMP_CONTRIB_GROUPS = groupByHeader(EMPLOYER_CONTRIB_COLS, formatEmployerHeader);

    // Drop component columns that are zero/blank across every row, so a
    // client only sees columns its contract actually configures. Headers
    // are canonicalized via formatDeductionHeader / formatEmployerHeader
    // so naming variants ("PF 12%", "EPF Employee", "ESI") collapse to
    // the same column — the table SHAPE is consistent across clients
    // even though the column SET adapts per contract.
    const keepNonZero = (
      names: string[],
      get: (r: (typeof rows)[number], name: string) => number,
    ) => names.filter((n) => rows.some((r) => Math.abs(get(r, n)) > 0.005));

    const contractComponentCols = keepNonZero(CONTRACT_COMPONENT_COLS, (r, n) => lookup(r.resource?.components, n));
    const earnedComponentCols = keepNonZero(EARNED_COMPONENT_COLS, (r, n) => lookup(r.wages?.components, n));
    const additionCols = keepNonZero(ADDITION_COLS, (r, n) => lookup((r.wages as unknown as { additions?: { name: string; amount: number }[] } | null)?.additions, n));
    const deductionGroups = DEDUCTION_GROUPS.filter((g) => rows.some((r) => Math.abs(sumByNames(r.wages?.deductions, g.names)) > 0.005));
    const empContribGroups = EMP_CONTRIB_GROUPS.filter((g) => rows.some((r) => Math.abs(sumByNames(r.wages?.employerContributions, g.names)) > 0.005));

    const F_CONTRACT_COMPONENT_COLS = contractComponentCols.map((c) => `F ${c}`);
    const E_EARNED_COMPONENT_COLS = earnedComponentCols.map((c) => `E ${c}`);
    const DEDUCTION_HEADERS = deductionGroups.map((g) => g.header);
    const EMP_CONTRIB_LABELS = empContribGroups.map((g) => g.header);

    const periodMonth = (() => {
      const [y, m] = end.split("-");
      return `${m}-${y}`;
    })();
    const customerName = unit?.customer_name || "";
    const clientId = unit?.code || "";
    const siteName = unit?.name || "";

    const approvedDate = run?.approved_at ? run.approved_at.slice(0, 10) : "";
    const approvalInfo =
      runStatus === "approved" ? "Approved"
      : runStatus === "submitted" ? "Submitted — awaiting approval"
      : runStatus === "rejected" ? `Rejected: ${run?.rejection_reason ?? ""}`.trim()
      : "Draft";

    // ---- Wage Register headers (shared baseline) ----
    // Days are broken out so PH (paid holidays), Other Paid (sick/EL) and OT
    // are visible as separate columns instead of being lumped into a single
    // "Duties" cell. Payroll additions that opt into "Include in total days"
    // with affects_days_for=ph already roll into PH Days via day-adjustments.
    const wageHeaders = [
      "SI No", "Month", "Client ID", "Client Name", "Site Name",
      "Employee ID", "Employee Name", "Designation", "Date Of Joining",
      "ESI No", "UAN", "PAN",
      ...F_CONTRACT_COMPONENT_COLS,
      "F Gross Salary",
      "Fixed Duties", "Present Days", "PH Days", "Other Paid Days",
      "ED Hours", "ED Duties", "Total Days",
      ...E_EARNED_COMPONENT_COLS,
      ...additionCols,
      "E Gross Salary",
      ...DEDUCTION_HEADERS,
      "Total Deductions", "Net Pay",
      "Bank Acc No", "Bank IFSC", "Bank Name", "Bank Branch", "Bank Account Holder",
      "Approved Date", "Approval Info",
    ];

    const buildWageRow = (r: (typeof rows)[number], idx: number): Record<string, unknown> => {
      const w = r.wages;
      const contractComponents = r.resource?.components ?? [];
      const earnedComponents = w?.components ?? [];
      const earnedDeductions = w?.deductions ?? [];
      const earnedAdditions = (w as unknown as { additions?: { name: string; amount: number }[] } | null)?.additions ?? [];

      const cells: unknown[] = [
        idx + 1, periodMonth, clientId, customerName, siteName,
        r.employeeCode, r.name, r.designation,
        r.dateOfJoining ? r.dateOfJoining.slice(0, 10) : "",
        r.esiNumber, r.uan, r.panNumber,
        ...contractComponentCols.map((c) => round2(lookup(contractComponents, c))),
        w ? round2(w.contractGross) : 0,
        w ? w.baseDays : 0,
        round2(r.totals.pDays),
        round2(r.totals.phDays),
        round2(r.totals.otherPaidDays),
        round2(r.totals.otHours),
        round2(r.totals.otDays),
        round2(r.totals.tDays),
        ...earnedComponentCols.map((c) => round2(lookup(earnedComponents, c))),
        ...additionCols.map((c) => round2(lookup(earnedAdditions, c))),
        w ? round2(w.earnedGross) : 0,
        ...deductionGroups.map((g) => round2(sumByNames(earnedDeductions, g.names))),
        w ? round2(w.totalDeductions) : 0,
        w ? round2(w.netPay) : 0,
        r.bankAccountNumber, r.bankIfsc, r.bankName, r.bankBranch, r.bankAccountHolder,
        approvedDate, approvalInfo,
      ];
      const row: Record<string, unknown> = {};
      wageHeaders.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    };

    const dataRows = rows.map((r, idx) => buildWageRow(r, idx));

    // ---- Totals row (numeric columns only) ----
    const numericHeaderSet = new Set<string>([
      ...F_CONTRACT_COMPONENT_COLS, "F Gross Salary",
      "Fixed Duties", "Present Days", "PH Days", "Other Paid Days",
      "ED Hours", "ED Duties", "Total Days",
      ...E_EARNED_COMPONENT_COLS, ...additionCols, "E Gross Salary",
      ...DEDUCTION_HEADERS, "Total Deductions", "Net Pay",
    ]);
    const totalsRow = (headers: string[]): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      headers.forEach((h) => { out[h] = ""; });
      out["SI No"] = "";
      out["Employee Name"] = "TOTAL";
      headers.forEach((h) => {
        if (!numericHeaderSet.has(h)) return;
        const sum = dataRows.reduce((s, r) => s + (Number(r[h]) || 0), 0);
        out[h] = round2(sum);
      });
      return out;
    };

    const wageColumns = wageHeaders.map((h) => ({ key: h, header: h }));
    const wageRowsWithTotal = [...dataRows, totalsRow(wageHeaders)];

    // ---- Pay Sheet (PDF): slim, only essential columns so everything fits ----
    const STATUTORY_LABELS = ["EE EPF", "EE ESIC", "EE PT", "EE LWF"];
    const paySheetStatutoryDed = STATUTORY_LABELS.filter((h) => DEDUCTION_HEADERS.includes(h));
    const paySheetHeaders = [
      "SI No", "Employee ID", "Employee Name", "Designation",
      "Fixed Duties", "Present Days", "PH Days", "ED Hours", "ED Duties", "Total Days",
      "F Gross Salary", "E Gross Salary",
      ...paySheetStatutoryDed,
      "Total Deductions", "Net Pay",
      "Bank Acc No", "Bank IFSC",
    ];
    const paySheetColumns = paySheetHeaders.map((h) => ({ key: h, header: h }));
    const paySheetRows = [...dataRows, totalsRow(paySheetHeaders)];

    // ---- MIS: Wage Register + employer-contribution breakdown + CTC ----
    const misHeaders = [
      ...wageHeaders,
      ...EMP_CONTRIB_LABELS,
      "Total Employer Contributions",
      "Employer Cost (CTC)",
    ];
    const isLwfName = (n: string) => /\blwf\b|labour\s*welfare/i.test(n);
    const misDataRows = dataRows.map((row, idx) => {
      const r = rows[idx];
      const w = r.wages;
      const empContribs = w?.employerContributions ?? [];
      const extra: Record<string, unknown> = {};
      empContribGroups.forEach((g) => {
        const val = sumByNames(empContribs, g.names);
        extra[g.header] = g.names.some(isLwfName) ? round2(val) : round2(val);
      });
      extra["Total Employer Contributions"] = w ? round2(w.totalEmployerContributions) : 0;
      extra["Employer Cost (CTC)"] = w ? round2(w.employerCost) : 0;
      return { ...row, ...extra };
    });
    const misNumericExtras = [...EMP_CONTRIB_LABELS, "Total Employer Contributions", "Employer Cost (CTC)"];
    misNumericExtras.forEach((h) => numericHeaderSet.add(h));
    const misTotals: Record<string, unknown> = { ...totalsRow(wageHeaders) };
    misNumericExtras.forEach((h) => {
      misTotals[h] = round2(misDataRows.reduce((s, r) => s + (Number(r[h]) || 0), 0));
    });
    const misColumns = misHeaders.map((h) => ({ key: h, header: h }));
    const misRowsWithTotal = [...misDataRows, misTotals];

    const baseName = `${unit?.code ?? unitId}-${start}-${end}`;
    openExport({
      filename: `wage-register-${baseName}`,
      rows: wageRowsWithTotal,
      columns: wageColumns,
      pdfFilename: `pay-sheet-${baseName}`,
      pdfColumns: paySheetColumns,
      pdfRows: paySheetRows,
      labels: {
        xlsx: { title: "Download Wage Register", desc: "Full wage register (Excel)" },
        pdf: { title: "Download Pay Sheet", desc: "Printable pay sheet (PDF)" },
      },
      mis: {
        filename: `mis-${baseName}`,
        rows: misRowsWithTotal,
        columns: misColumns,
        title: "Download MIS",
        desc: "Full register + employer cost breakdown (Excel)",
      },
    });
  };


  const attendanceApproved = sheet?.status === "approved";
  if (!attendanceApproved) {
    const attStatus = sheet?.status ?? null;
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/admin/payroll" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> Back to payroll units
          </Link>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-amber-900 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em]">Payroll locked</div>
          <h1 className="mt-1 text-2xl font-semibold">{unit?.name || unit?.code || "Client"}</h1>
          <p className="mt-3 text-sm">
            Payroll for {fmtPretty(start)} – {fmtPretty(end)} cannot be generated because attendance is
            {attStatus ? ` "${attStatus}"` : " not yet submitted"}. Payroll only runs against <strong>approved</strong> attendance.
          </p>
          <div className="mt-4">
            <Link to="/admin/attendance/$unitId" params={{ unitId }} search={{ month: new Date(start).getMonth(), year: new Date(start).getFullYear() }}>
              <Button size="sm">Open attendance sheet</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/admin/payroll"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Back to payroll units
        </Link>
        <div className="flex items-center gap-2">
          {isProcessed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadAllSlips("pdf")}
              disabled={isLoading || rows.length === 0 || slipBusy !== null}
            >
               {slipBusy === "__all__:pdf" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
               All slips PDF
            </Button>
          )}
          {isProcessed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadAllSlips("xlsx")}
              disabled={isLoading || rows.length === 0 || slipBusy !== null}
            >
               {slipBusy === "__all__:xlsx" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />}
               All slips Excel
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading || rows.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            {isLoading ? "Loading…" : "Export"}
          </Button>
        </div>

      </div>


      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Payroll computation</div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">{unit?.name || unit?.code || "Client"}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {unit?.customer_name} · Period {fmtPretty(start)} – {fmtPretty(end)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sheet?.status === "approved" && (
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Attendance approved
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["payroll-register-compute", unitId, start, end] });
                queryClient.invalidateQueries({ queryKey: ["admin", "additions"] });
                queryClient.invalidateQueries({ queryKey: ["admin", "deductions"] });
                queryClient.invalidateQueries({ queryKey: ["admin", "allowance-types"] });
                queryClient.invalidateQueries({ queryKey: ["admin", "cost-components"] });
                toast.success("Recalculating from latest contract, attendance, additions and deductions");
              }}
            >
              Recalculate
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Earned gross" value={fmtINR(totals.earnedGross)} />
          <Stat label="Deductions" value={fmtINR(totals.deductions)} onClick={() => scrollToSection("payroll-deductions-section")} />
          <Stat label="Net pay" value={fmtINR(totals.net)} tone="emerald" />
          <Stat label="Employer contrib" value={fmtINR(totals.employerContrib)} onClick={() => scrollToSection("payroll-employer-contrib-section")} />
          <Stat label="Total employer cost" value={fmtINR(totals.employerCost)} tone="amber" />
        </div>

      </div>

      {/* Payroll approval workflow */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Payroll status</span>
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            runStatus === "draft" && "bg-slate-100 text-slate-700",
            runStatus === "submitted" && "bg-amber-100 text-amber-800",
            runStatus === "approved" && (isProcessed ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"),
            runStatus === "rejected" && "bg-rose-100 text-rose-800",
          )}>
            {runStatus === "draft" && "Draft"}
            {runStatus === "submitted" && "Submitted — awaiting approval"}
            {runStatus === "approved" && (
              isProcessed
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> Approved</>
                : <><CheckCircle2 className="h-3.5 w-3.5" /> Approval incomplete</>
            )}
            {runStatus === "rejected" && <><XCircle className="h-3.5 w-3.5" /> Rejected</>}
          </span>
          {runStatus === "rejected" && run?.rejection_reason && (
            <span className="text-xs text-rose-700">Reason: {run.rejection_reason}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sheet?.status !== "approved" && (
            <span className="text-xs text-amber-700">Approve attendance first to submit payroll.</span>
          )}
          {sheet?.status === "approved" && (runStatus === "draft" || runStatus === "rejected") && (
            <Button size="sm" onClick={() => transitionRun.mutate({ status: "submitted" })} disabled={transitionRun.isPending}>
              <Send className="mr-1.5 h-4 w-4" /> Submit for Approval
            </Button>
          )}
          {runStatus === "submitted" && canApprove && (
            <>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void approveImmediately()} disabled={transitionRun.isPending || processRun.isPending || rows.length === 0}>
                {processRun.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)} disabled={transitionRun.isPending}>
                <XCircle className="mr-1.5 h-4 w-4" /> Reject
              </Button>
            </>
          )}
          {runStatus === "submitted" && !canApprove && (
            <span className="text-xs text-muted-foreground">Awaiting leadership approval</span>
          )}
          {runStatus === "approved" && !isProcessed && (
            <Button size="sm" onClick={() => void approveImmediately()} disabled={processRun.isPending || rows.length === 0}>
              {processRun.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Complete approval
            </Button>
          )}
          {isProcessed && !amendmentPending && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Payroll approved
              {lastSnapshotVersion > 1 ? ` · v${lastSnapshotVersion}` : ""}
              {run?.payroll_processed_at ? ` · ${new Date(run.payroll_processed_at).toLocaleDateString("en-IN")}` : ""}
            </span>
          )}
          {amendmentPending && (
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => setAmendReviewOpen(true)}
              disabled={processAmendment.isPending || rows.length === 0}
            >
              <Banknote className="mr-1.5 h-4 w-4" /> Review &amp; process amendment v{sheetVersion}
            </Button>
          )}
        </div>
      </div>

      {amendmentPending && (
        <div className="rounded-md border border-indigo-300/60 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 print:hidden">
          <b>Attendance amendment v{sheetVersion} approved.</b> Payroll v{lastSnapshotVersion} is already paid — processing
          the amendment posts only the difference for the {amendmentDeltas.length} affected employee
          {amendmentDeltas.length === 1 ? "" : "s"} as arrears or recovery. Nothing already paid is reversed.
        </div>
      )}
      {amendmentStatus === "open" || amendmentStatus === "submitted" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
          An attendance amendment (v{sheetVersion}) is {amendmentStatus === "open" ? "being edited" : "awaiting approval"}.
          Payroll figures below still reflect the paid version until it is approved.
        </div>
      ) : null}

      <Dialog open={amendReviewOpen} onOpenChange={setAmendReviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Process payroll amendment v{sheetVersion}</DialogTitle>
            <DialogDescription>
              Only the employees below changed. Every head is posted on its own line — wage components as arrears or
              recovery, and each statutory head (ESI, EPF, PT, LWF) adjusted separately so the ESI, EPF and employer
              contribution registers stay correct. Their earlier pay sheet stays intact as v{lastSnapshotVersion}.
            </DialogDescription>
          </DialogHeader>
          {amendmentDeltas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No money changed — nothing to post.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
              {amendmentDeltas.map((d) => {
                const delta = Math.round((d.after.netPay - d.before.netPay) * 100) / 100;
                const earn = diffLines(d.earningsBefore, d.earningsAfter);
                const ded = diffLines(d.deductionsBefore, d.deductionsAfter);
                const emp = diffLines(d.employerBefore, d.employerAfter);
                const section = (
                  title: string,
                  lines: Array<{ name: string; before: number; after: number; delta: number }>,
                  totals: { before: number; after: number },
                  goodWhenUp: boolean,
                ) => (
                  <div className="rounded-xl border border-border/60">
                    <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide">
                      <span>{title}</span>
                      <span className="tabular-nums">
                        {fmtINR(totals.before)} → {fmtINR(totals.after)}
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody>
                        {lines.length === 0 ? (
                          <tr><td className="px-3 py-1.5 text-muted-foreground">No change</td></tr>
                        ) : lines.map((l) => {
                          const good = goodWhenUp ? l.delta >= 0 : l.delta <= 0;
                          return (
                            <tr key={l.name} className="border-t border-border/40">
                              <td className="px-3 py-1.5">{l.name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtINR(l.before)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{fmtINR(l.after)}</td>
                              <td className={cn(
                                "px-3 py-1.5 text-right font-semibold tabular-nums",
                                Math.abs(l.delta) < 0.005 ? "text-muted-foreground" : good ? "text-emerald-700" : "text-amber-700",
                              )}>
                                {l.delta >= 0 ? "+" : "−"}{fmtINR(Math.abs(l.delta))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
                return (
                  <div key={d.candidateId} className="rounded-2xl border border-border/60 bg-card/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-semibold">{d.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{d.employeeCode}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          Paid days {d.before.paidDays} → {d.after.paidDays}
                        </span>
                      </div>
                      <div className={cn("text-sm font-semibold", delta >= 0 ? "text-emerald-700" : "text-rose-700")}>
                        Net {fmtINR(d.before.netPay)} → {fmtINR(d.after.netPay)}{" "}
                        <span className="text-xs uppercase tracking-wide">
                          ({delta >= 0 ? "+" : "−"}{fmtINR(Math.abs(delta))} {delta >= 0 ? "arrears" : "recovery"})
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {section("Earnings (gross)", earn, { before: d.before.gross, after: d.after.gross }, true)}
                      {section("Employee deductions", ded, { before: d.before.totalDeductions, after: d.after.totalDeductions }, false)}
                      {section("Employer contributions", emp, { before: d.before.totalEmployer, after: d.after.totalEmployer }, true)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAmendReviewOpen(false)}>Cancel</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => processAmendment.mutate()}
              disabled={processAmendment.isPending || amendmentDeltas.length === 0}
            >
              {processAmendment.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Post difference for {amendmentDeltas.length} employee{amendmentDeltas.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject payroll</DialogTitle>
            <DialogDescription>Provide a reason so the submitter knows what to fix.</DialogDescription>
          </DialogHeader>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection…" rows={4} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (!rejectReason.trim()) { toast.error("Reason required"); return; }
              transitionRun.mutate({ status: "rejected", reason: rejectReason.trim() }, {
                onSuccess: () => { setRejectOpen(false); setRejectReason(""); },
              });
            }}>Reject</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="overflow-x-auto overscroll-x-contain rounded-b-3xl [scrollbar-gutter:stable] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-muted/30">
          <table
            data-payroll-register
            className="w-max min-w-full table-auto text-sm whitespace-nowrap"
          >
            <thead className="border-b border-border/60 bg-secondary/40">
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {showHoldColumn && (
                  <th className="px-3 py-3 font-medium w-[44px]">
                    <input
                      type="checkbox"
                      aria-label="Include all employees"
                      disabled={isProcessed}
                      checked={holdDraft.size === 0}
                      ref={(el) => {
                        if (el) el.indeterminate = holdDraft.size > 0 && holdDraft.size < rows.length;
                      }}
                      onChange={(e) =>
                        setHoldDraft(e.target.checked ? new Set() : new Set(rows.map((r) => r.id)))
                      }
                      className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-medium w-[60px]"></th>
                <th className="px-4 py-3 font-medium">Emp ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium" title="Total paid days (P + PH + ED)">Total Paid Days</th>
                {earningCols.map((n) => (
                  <th key={`h-e-${n}`} className="px-4 py-3 text-left font-medium" title={`Earned ${n}`}>{n}</th>
                ))}
                <th className="px-4 py-3 text-left font-medium" title="Sum of every earned wage line, including extra duty and paid holiday">Earned gross</th>
                {deductionCols.map((g) => (
                  <th key={`h-d-${g.header}`} className="px-4 py-3 text-left font-medium" title={g.names.join(", ")}>{g.header}</th>
                ))}
                <th className="px-4 py-3 text-left font-medium">Total deductions</th>
                <th className="px-4 py-3 text-left font-medium">Net pay</th>
                {employerCols.map((g) => (
                  <th key={`h-r-${g.header}`} className="px-4 py-3 text-left font-medium" title={g.names.join(", ")}>{g.header}</th>
                ))}
                {showEmployerCols && <th className="px-4 py-3 text-left font-medium">Employer cost</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={registerColCount} className="px-4 py-10 text-center text-muted-foreground">Computing wages…</td></tr>
              ) : error ? (
                <tr><td colSpan={registerColCount} className="px-4 py-10 text-center text-destructive">{error instanceof Error ? error.message : "Failed"}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={registerColCount} className="px-4 py-10 text-center text-muted-foreground">No employees mapped to this unit.</td></tr>
              ) : pg.pageRows.map((r) => {
                const isHighlighted = highlightCandidate === r.id;
                const isExpanded = expandedRows.has(r.rowKey);
                return (
                <Fragment key={r.rowKey}>
                <tr
                  id={isHighlighted ? `payroll-row-${r.id}` : `payroll-row-${r.rowKey}`}

                  className={`hover:bg-muted/40 ${isHighlighted ? "bg-emerald-50 ring-2 ring-emerald-400 dark:bg-emerald-950/40" : ""}`}
                >
                  {showHoldColumn && (
                    <td className="px-3 py-3">
                      {isProcessed ? (
                        holdDraft.has(r.id) ? (
                          <PauseCircle className="h-4 w-4 text-amber-600" aria-label="On hold" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Paid" />
                        )
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`Include ${r.name} in payroll`}
                          checked={!holdDraft.has(r.id)}
                          onChange={() => toggleHold(r.id)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={isExpanded ? `Collapse pay sheet for ${r.name}` : `Expand pay sheet for ${r.name}`}
                      onClick={() => {
                        setExpandedRows((current) => {
                          const next = new Set(current);
                          if (next.has(r.rowKey)) next.delete(r.rowKey);
                          else next.add(r.rowKey);
                          return next;
                        });
                      }}
                      className="h-7 w-7"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.employeeCode || "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{r.name}</span>
                      {r.wages && isProcessed && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Download salary slip in PDF"
                          aria-label={`Download salary slip for ${r.name} in PDF`}
                          onClick={() => void downloadSlip(r, "pdf")}
                          disabled={slipBusy !== null}
                          className="h-7 w-7 text-muted-foreground"
                        >
                          {slipBusy === `${r.rowKey}:pdf` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      {r.wages && isProcessed && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Download salary slip in Excel"
                          aria-label={`Download salary slip for ${r.name} in Excel`}
                          onClick={() => void downloadSlip(r, "xlsx")}
                          disabled={slipBusy !== null}
                          className="h-7 w-7 text-muted-foreground"
                        >
                          {slipBusy === `${r.rowKey}:xlsx` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.designation}
                    {!r.isPrimary && (
                      <span
                        className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        title="Duties performed in a role other than the employee's own designation — billed as reliever."
                      >
                        Reliever
                      </span>
                    )}
                    {!r.wages && (
                      <span
                        className="ml-2 text-xs text-amber-600"
                        title={`The contract for this client has no resource line for the designation "${r.designation}". Add it on the contract, or change the employee's designation to a contracted one.`}
                      >
                        not on contract
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-left tabular-nums font-medium">{r.totals.tDays}</td>
                  {earningCols.map((n) => (
                    <td key={`${r.rowKey}-e-${n}`} className="px-4 py-3 text-left tabular-nums">
                      {r.wages ? fmtINR(lookupAmount(r.wages.components as NamedAmount[], n)) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left font-medium">{r.wages ? fmtINR(r.wages.earnedGross) : "—"}</td>
                  {deductionCols.map((g) => (
                    <td key={`${r.rowKey}-d-${g.header}`} className="px-4 py-3 text-left tabular-nums">
                      {r.wages ? fmtINR(sumAmounts(r.wages.deductions as NamedAmount[], g.names)) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left">{r.wages ? fmtINR(r.wages.totalDeductions) : "—"}</td>
                  <td className="px-4 py-3 text-left font-semibold text-emerald-700">{r.wages ? fmtINR(r.wages.netPay) : "—"}</td>
                  {employerCols.map((g) => (
                    <td key={`${r.rowKey}-r-${g.header}`} className="px-4 py-3 text-left tabular-nums">
                      {r.wages ? fmtINR(sumAmounts(r.wages.employerContributions as NamedAmount[], g.names)) : "—"}
                    </td>
                  ))}
                  {showEmployerCols && (
                    <td className="px-4 py-3 text-left">{r.wages ? fmtINR(r.wages.employerCost) : "—"}</td>
                  )}
                </tr>
                {isExpanded && r.wages && r.resource && (
                  <tr key={`${r.rowKey}-detail`} className="bg-secondary/20">
                    <td colSpan={registerColCount} className="px-4 py-0">
                      <PaySheetPanel
                        r={r as unknown as PaySheetRow}
                        versions={snapshots.filter((s) => s.candidate_id === r.id)}
                      />

                    </td>
                  </tr>
                )}
                </Fragment>

                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-border/60 bg-secondary/30 text-sm font-semibold">
                <tr>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" colSpan={4}>Totals</td>
                  {earningCols.map((n) => (
                    <td key={`f-e-${n}`} className="px-4 py-3 text-left tabular-nums">
                      {fmtINR(rows.reduce((s, r) => s + lookupAmount(r.wages?.components as NamedAmount[] | undefined, n), 0))}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left">{fmtINR(totals.earnedGross)}</td>
                  {deductionCols.map((g) => (
                    <td key={`f-d-${g.header}`} className="px-4 py-3 text-left tabular-nums">
                      {fmtINR(rows.reduce((s, r) => s + sumAmounts(r.wages?.deductions as NamedAmount[] | undefined, g.names), 0))}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left">{fmtINR(totals.deductions)}</td>
                  <td className="px-4 py-3 text-left text-emerald-700">{fmtINR(totals.net)}</td>
                  {employerCols.map((g) => (
                    <td key={`f-r-${g.header}`} className="px-4 py-3 text-left tabular-nums">
                      {fmtINR(rows.reduce((s, r) => s + sumAmounts(r.wages?.employerContributions as NamedAmount[] | undefined, g.names), 0))}
                    </td>
                  ))}
                  {showEmployerCols && <td className="px-4 py-3 text-left">{fmtINR(totals.employerCost)}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <DataPagination {...pg} />
      </div>


      <div id="payroll-deductions-section" className="scroll-mt-24">
        <DeductionsSection rows={rows as unknown as DeductionSourceRow[]} />
      </div>

      <div id="payroll-employer-contrib-section" className="scroll-mt-24">
        <EmployerContribSection rows={rows as unknown as DeductionSourceRow[]} />
      </div>
    </div>
  );
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  // Payroll registers can span hundreds of rows. Smooth-scrolling across that
  // distance shows several seconds of empty page between sections and looks
  // like the register has unmounted. Jump directly and let scroll-margin keep
  // the destination clear of the sticky admin header.
  if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
}

// --------------------------------------------------------------------------
// Deductions breakdown: one row per employee with every deduction bucketed
// into EPF / ESI / PT / Uniform / GPAIP / Recruitment fee / Other, searchable
// by employee or by deduction head.
// --------------------------------------------------------------------------
type DeductionSourceRow = {
  id: string;
  employeeCode: string;
  name: string;
  designation: string;
  wages: {
    deductions: { name: string; amount: number }[];
    employerContributions?: { name: string; amount: number }[];
  } | null;
};


const DEDUCTION_BUCKETS = [
  { key: "epf", label: "EPF", re: /\b(epf|pf|provident)\b/i },
  { key: "esi", label: "ESI", re: /\besi(c)?\b/i },
  { key: "pt", label: "PT", re: /professional\s*tax|\bpt\b/i },
  { key: "uniform", label: "Uniform", re: /uniform|kit\b/i },
  { key: "gpaip", label: "GPAIP", re: /gpaip|group\s*personal\s*accident/i },
  { key: "recruitment", label: "Recruitment fee", re: /recruit/i },
] as const;

type BucketKey = (typeof DEDUCTION_BUCKETS)[number]["key"] | "other";

function bucketOf(name: string): BucketKey {
  for (const b of DEDUCTION_BUCKETS) if (b.re.test(name)) return b.key;
  return "other";
}

function DeductionsSection({ rows }: { rows: DeductionSourceRow[] }) {
  const [search, setSearch] = useState("");
  const [head, setHead] = useState<BucketKey | "all">("all");

  const people = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        employeeCode: string;
        name: string;
        designations: Set<string>;
        buckets: Record<string, number>;
        lines: { name: string; amount: number }[];
        total: number;
      }
    >();
    for (const r of rows) {
      if (!r.wages) continue;
      let p = map.get(r.id);
      if (!p) {
        p = {
          id: r.id,
          employeeCode: r.employeeCode,
          name: r.name,
          designations: new Set<string>(),
          buckets: {},
          lines: [],
          total: 0,
        };
        map.set(r.id, p);
      }
      if (r.designation && r.designation !== "—") p.designations.add(r.designation);
      for (const d of r.wages.deductions) {
        const amt = Math.round((Number(d.amount) || 0) * 100) / 100;
        if (!amt) continue;
        const clean = cleanLedgerName(d.name) || d.name;
        const key = bucketOf(clean);
        p.buckets[key] = Math.round(((p.buckets[key] ?? 0) + amt) * 100) / 100;
        p.lines.push({ name: clean, amount: amt });
        p.total = Math.round((p.total + amt) * 100) / 100;
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.employeeCode || a.name).localeCompare(b.employeeCode || b.name),
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (head !== "all" && !(p.buckets[head] > 0)) return false;
      if (!q) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.employeeCode.toLowerCase().includes(q)) return true;
      if (Array.from(p.designations).some((d) => d.toLowerCase().includes(q))) return true;
      return p.lines.some((l) => l.name.toLowerCase().includes(q));
    });
  }, [people, search, head]);

  const colTotals = useMemo(() => {
    const t: Record<string, number> = { other: 0, total: 0 };
    for (const p of filtered) {
      for (const b of DEDUCTION_BUCKETS) t[b.key] = Math.round(((t[b.key] ?? 0) + (p.buckets[b.key] ?? 0)) * 100) / 100;
      t.other = Math.round((t.other + (p.buckets.other ?? 0)) * 100) / 100;
      t.total = Math.round((t.total + p.total) * 100) / 100;
    }
    return t;
  }, [filtered]);

  if (people.length === 0) return null;

  const chip = (key: BucketKey | "all", label: string, amount?: number) => (
    <button
      key={key}
      onClick={() => setHead(head === key ? "all" : key)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        head === key
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      {amount !== undefined && <span className="ml-1.5 tabular-nums opacity-80">{fmtINR(amount)}</span>}
    </button>
  );

  return (
    <div className="rounded-3xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Deductions</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {filtered.length} employee{filtered.length === 1 ? "" : "s"} · {fmtINR(colTotals.total)} total
          </div>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee, designation or deduction (EPF, ESI, PT…)"
          className="h-9 w-full rounded-xl border border-border/60 bg-background px-3 text-sm md:w-96"
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/60 px-4 py-3">
        {chip("all", "All")}
        {DEDUCTION_BUCKETS.map((b) => chip(b.key, b.label, colTotals[b.key] ?? 0))}
        {chip("other", "Other", colTotals.other)}
      </div>

      <div className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]">
        <table className="ios-table min-w-[1000px] table-auto text-sm whitespace-nowrap">
          <thead className="border-b border-border/60 bg-secondary/40">
            <tr className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <th className="px-4 py-3 font-medium">Emp ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Designation</th>
              {DEDUCTION_BUCKETS.map((b) => (
                <th key={b.key} className="px-4 py-3 text-left font-medium">{b.label}</th>
              ))}
              <th className="px-4 py-3 text-left font-medium">Other</th>
              <th className="px-4 py-3 text-left font-medium">Total deduction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={DEDUCTION_BUCKETS.length + 5} className="px-4 py-10 text-center text-muted-foreground">
                  No deductions match this search.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono text-xs">{p.employeeCode || "—"}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {Array.from(p.designations).join(", ") || "—"}
                  </td>
                  {DEDUCTION_BUCKETS.map((b) => (
                    <td key={b.key} className="px-4 py-3 text-left tabular-nums">
                      {p.buckets[b.key] ? fmtINR(p.buckets[b.key]) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left tabular-nums">
                    {p.buckets.other ? fmtINR(p.buckets.other) : "—"}
                  </td>
                  <td className="px-4 py-3 text-left font-semibold tabular-nums">{fmtINR(p.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t border-border/60 bg-secondary/30 text-sm font-semibold">
              <tr>
                <td className="px-4 py-3" colSpan={3}>Totals</td>
                {DEDUCTION_BUCKETS.map((b) => (
                  <td key={b.key} className="px-4 py-3 text-left tabular-nums">{fmtINR(colTotals[b.key] ?? 0)}</td>
                ))}
                <td className="px-4 py-3 text-left tabular-nums">{fmtINR(colTotals.other)}</td>
                <td className="px-4 py-3 text-left tabular-nums">{fmtINR(colTotals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}


function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: "emerald" | "amber"; onClick?: () => void }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${cls}`}>{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border border-border/60 bg-background px-4 py-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/60"
      >
        {inner}
      </button>
    );
  }
  return <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">{inner}</div>;
}

// --------------------------------------------------------------------------
// Employer contribution breakdown: one row per employee, columns derived from
// the actual contribution heads present (EPF, EPS, ESI, LWF, bonus, …), with
// the same search + head-chip filtering as the deductions section.
// --------------------------------------------------------------------------
function EmployerContribSection({ rows }: { rows: DeductionSourceRow[] }) {
  const [search, setSearch] = useState("");
  const [head, setHead] = useState<string>("all");

  const { people, heads } = useMemo(() => {
    const headSet = new Set<string>();
    const map = new Map<
      string,
      {
        id: string;
        employeeCode: string;
        name: string;
        designations: Set<string>;
        heads: Record<string, number>;
        total: number;
      }
    >();
    for (const r of rows) {
      const lines = r.wages?.employerContributions ?? [];
      if (!r.wages) continue;
      let p = map.get(r.id);
      if (!p) {
        p = { id: r.id, employeeCode: r.employeeCode, name: r.name, designations: new Set<string>(), heads: {}, total: 0 };
        map.set(r.id, p);
      }
      if (r.designation && r.designation !== "—") p.designations.add(r.designation);
      for (const l of lines) {
        const amt = Math.round((Number(l.amount) || 0) * 100) / 100;
        if (!amt) continue;
        const label = cleanLedgerName(l.name) || l.name;
        headSet.add(label);
        p.heads[label] = Math.round(((p.heads[label] ?? 0) + amt) * 100) / 100;
        p.total = Math.round((p.total + amt) * 100) / 100;
      }
    }
    return {
      people: Array.from(map.values())
        .filter((p) => p.total > 0)
        .sort((a, b) => (a.employeeCode || a.name).localeCompare(b.employeeCode || b.name)),
      heads: Array.from(headSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (head !== "all" && !(p.heads[head] > 0)) return false;
      if (!q) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.employeeCode.toLowerCase().includes(q)) return true;
      if (Array.from(p.designations).some((d) => d.toLowerCase().includes(q))) return true;
      return Object.keys(p.heads).some((h) => h.toLowerCase().includes(q));
    });
  }, [people, search, head]);

  const colTotals = useMemo(() => {
    const t: Record<string, number> = { total: 0 };
    for (const p of filtered) {
      for (const h of heads) t[h] = Math.round(((t[h] ?? 0) + (p.heads[h] ?? 0)) * 100) / 100;
      t.total = Math.round((t.total + p.total) * 100) / 100;
    }
    return t;
  }, [filtered, heads]);

  if (people.length === 0) return null;

  const chip = (key: string, label: string, amount?: number) => (
    <button
      key={key}
      onClick={() => setHead(head === key ? "all" : key)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        head === key
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      {amount !== undefined && <span className="ml-1.5 tabular-nums opacity-80">{fmtINR(amount)}</span>}
    </button>
  );

  return (
    <div className="rounded-3xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Employer contribution</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {filtered.length} employee{filtered.length === 1 ? "" : "s"} · {fmtINR(colTotals.total)} total
          </div>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee, designation or head (EPF, ESI, LWF…)"
          className="h-9 w-full rounded-xl border border-border/60 bg-background px-3 text-sm md:w-96"
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/60 px-4 py-3">
        {chip("all", "All")}
        {heads.map((h) => chip(h, h, colTotals[h] ?? 0))}
      </div>

      <div className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]">
        <table className="ios-table min-w-[900px] table-auto text-sm whitespace-nowrap">
          <thead className="border-b border-border/60 bg-secondary/40">
            <tr className="text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <th className="px-4 py-3 font-medium">Emp ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Designation</th>
              {heads.map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}
              <th className="px-4 py-3 text-left font-medium">Total contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={heads.length + 4} className="px-4 py-10 text-center text-muted-foreground">
                  No employer contributions match this search.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono text-xs">{p.employeeCode || "—"}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{Array.from(p.designations).join(", ") || "—"}</td>
                  {heads.map((h) => (
                    <td key={h} className="px-4 py-3 text-left tabular-nums">
                      {p.heads[h] ? fmtINR(p.heads[h]) : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-left font-semibold tabular-nums">{fmtINR(p.total)}</td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t border-border/60 bg-secondary/30 text-sm font-semibold">
              <tr>
                <td className="px-4 py-3" colSpan={3}>Totals</td>
                {heads.map((h) => (
                  <td key={h} className="px-4 py-3 text-left tabular-nums">{fmtINR(colTotals[h] ?? 0)}</td>
                ))}
                <td className="px-4 py-3 text-left tabular-nums">{fmtINR(colTotals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}


// --------------------------------------------------------------------------
// Pay sheet panel: full per-employee breakdown rendered INLINE under the row.
// Every figure comes from the computed wage result, so the lines always add
// up to Earned Gross (Overtime / Paid Holiday / formula lines included).
// No horizontal scrolling — sections stack and wrap responsively.
// --------------------------------------------------------------------------
type Line = { name: string; amount: number };

type PaySheetRow = {
  totals: { pDays: number; otDays: number; phDays: number; otherPaidDays: number; tDays: number };
  pt?: { source: string; state?: string | null; regionLabel?: string | null } | null;
  wages: {
    baseDays: number;
    contractGross: number;
    earnedGross: number;
    totalDeductions: number;
    netPay: number;
    employerCost: number;
    totalEmployerContributions: number;
    components: Line[];
    deductions: Line[];
    employerContributions: Line[];
    additions?: Line[];
  };
  resource: {
    components: Line[];
    benefits?: Line[] | null;
    deductions?: Line[] | null;
    employerContributions?: Line[] | null;
  };
};

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function contractLookup(items: Line[] | null | undefined, name: string): number | null {
  if (!items) return null;
  const t = normName(name);
  const hit = items.find((i) => normName(i.name) === t);
  return hit ? Number(hit.amount) || 0 : null;
}

function BreakdownSection({
  title,
  tone,
  lines,
  contractOf,
  totalLabel,
  totalContract,
  totalEarned,
  note,
}: {
  title: string;
  tone: "emerald" | "rose" | "violet" | "amber";
  lines: Line[];
  contractOf: (name: string) => number | null;
  totalLabel: string;
  totalContract: number | null;
  totalEarned: number;
  note?: (name: string) => string | null;
}) {
  const toneMap = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  } as const;
  const visible = lines.filter((l) => Math.abs(Number(l.amount) || 0) > 0.004);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-background">
      <div className={`flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${toneMap[tone]}`}>
        <span>{title}</span>
        <span className="flex gap-6 text-[10px] tracking-normal">
          <span className="w-20 text-right normal-case">Contract</span>
          <span className="w-24 text-right normal-case">Earned ₹</span>
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {visible.length === 0 ? (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">None applicable.</div>
        ) : (
          visible.map((l) => {
            const contract = contractOf(l.name);
            const hint = note?.(l.name);
            return (
              <div key={l.name} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {l.name}
                  {hint && <span className="ml-1.5 text-[10px] text-muted-foreground">{hint}</span>}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  {contract == null ? "—" : contract.toFixed(2)}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums font-medium">
                  {(Number(l.amount) || 0).toFixed(2)}
                </span>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/40 px-3 py-2 text-xs font-semibold">
        <span className="min-w-0 flex-1 truncate uppercase tracking-wide">{totalLabel}</span>
        <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
          {totalContract == null ? "—" : totalContract.toFixed(2)}
        </span>
        <span className="w-24 shrink-0 text-right tabular-nums">{totalEarned.toFixed(2)}</span>
      </div>
    </div>
  );
}

type PaySheetVersion = {
  version: number;
  paid_days: number;
  gross: number;
  total_deductions: number;
  total_employer?: number;
  net_pay: number;
  posted_at: string;
  earnings?: { name: string; amount: number }[];
  deductions?: { name: string; amount: number }[];
  employer_contributions?: { name: string; amount: number }[];
};

/** Head-by-head Before → After (Δ) for one amendment version, per register. */
function VersionHeadDiff({ prev, curr }: { prev: PaySheetVersion; curr: PaySheetVersion }) {
  const groups = [
    { title: "Earnings", tone: "text-emerald-700", before: prev.earnings, after: curr.earnings },
    { title: "Deductions", tone: "text-rose-700", before: prev.deductions, after: curr.deductions },
    {
      title: "Employer contributions",
      tone: "text-violet-700",
      before: prev.employer_contributions,
      after: curr.employer_contributions,
    },
  ]
    .map((g) => ({ ...g, lines: diffLines(g.before, g.after).filter((l) => Math.abs(l.delta) > 0.004) }))
    .filter((g) => g.lines.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-indigo-200/70 bg-background/70 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-800">
        v{curr.version} adjustment breakup — applied head by head in the next payroll
      </div>
      {groups.map((g) => (
        <div key={g.title} className="overflow-hidden rounded-md border border-border/60">
          <div className={cn("flex items-center justify-between bg-muted/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", g.tone)}>
            <span>{g.title}</span>
            <span className="flex gap-4 tracking-normal">
              <span className="w-20 text-right normal-case">Before</span>
              <span className="w-20 text-right normal-case">After</span>
              <span className="w-20 text-right normal-case">Δ</span>
            </span>
          </div>
          <div className="divide-y divide-border/40">
            {g.lines.map((l) => (
              <div key={l.name} className="flex items-center justify-between gap-3 px-2 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">{l.before.toFixed(2)}</span>
                <span className="w-20 shrink-0 text-right tabular-nums">{l.after.toFixed(2)}</span>
                <span
                  className={cn(
                    "w-20 shrink-0 text-right font-semibold tabular-nums",
                    l.delta > 0 ? "text-emerald-700" : "text-rose-700",
                  )}
                >
                  {l.delta > 0 ? "+" : "−"}
                  {Math.abs(l.delta).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 bg-muted/30 px-2 py-1 text-[11px] font-semibold">
              <span className="min-w-0 flex-1 truncate uppercase tracking-wide">Net {g.title.toLowerCase()} change</span>
              <span className="w-20 shrink-0" />
              <span className="w-20 shrink-0" />
              <span className="w-20 shrink-0 text-right tabular-nums">
                {(() => {
                  const t = Math.round(g.lines.reduce((s, l) => s + l.delta, 0) * 100) / 100;
                  return `${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(2)}`;
                })()}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


function PaySheetPanel({ r, versions = [] }: { r: PaySheetRow; versions?: PaySheetVersion[] }) {
  const w = r.wages;
  const contractComponents = [...(r.resource.components ?? []), ...(r.resource.benefits ?? [])];
  const contractGrossTotal = contractComponents.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const additions = w.additions ?? [];
  const additionsTotal = additions.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  const dayChips = [
    { label: "Contract days", value: w.baseDays },
    { label: "Present", value: r.totals.pDays },
    { label: "Paid holiday", value: r.totals.phDays },
    { label: "Other paid", value: r.totals.otherPaidDays },
    { label: "Extra duty days", value: r.totals.otDays },
    { label: "Total paid days", value: r.totals.tDays },
  ];

  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        {dayChips.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px]"
          >
            <span className="text-muted-foreground">{c.label}</span>
            <span className="font-semibold tabular-nums">{c.value}</span>
          </span>
        ))}
      </div>

      {versions.length > 1 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-2.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-800">
            Pay sheet versions
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">Version</th>
                <th className="px-2 py-1 text-left font-medium">Settlement</th>
                <th className="px-2 py-1 text-right font-medium">Paid days</th>
                <th className="px-2 py-1 text-right font-medium">Gross</th>
                <th className="px-2 py-1 text-right font-medium">Deductions</th>
                <th className="px-2 py-1 text-right font-medium">Net</th>
                <th className="px-2 py-1 text-right font-medium">Posted</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => {
                const prev = versions[i - 1];
                const delta = prev ? Math.round((v.net_pay - prev.net_pay) * 100) / 100 : 0;
                return (
                  <tr key={v.version} className="border-t border-indigo-200/60">
                    <td className="px-2 py-1 font-semibold">
                      v{v.version}
                      {delta !== 0 && (
                        <span className={cn("ml-1.5 font-medium", delta > 0 ? "text-emerald-700" : "text-rose-700")}>
                          {delta > 0 ? "+" : "−"}{fmtINR(Math.abs(delta))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {i === 0 ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                          Paid this period · wage slip issued
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                            delta >= 0 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800",
                          )}
                        >
                          {delta >= 0 ? "Arrear" : "Recovery"} · applied in next payroll
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{v.paid_days}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtINR(v.gross)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtINR(v.total_deductions)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtINR(v.net_pay)}</td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      {v.posted_at ? new Date(v.posted_at).toLocaleDateString("en-IN") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {versions.slice(1).map((v, i) => (
            <VersionHeadDiff key={`diff-${v.version}`} prev={versions[i]} curr={v} />
          ))}

          <p className="mt-1.5 text-[11px] leading-relaxed text-indigo-900/80">
            The wage slip for this period stays frozen at <span className="font-semibold">v1</span> — the amount actually
            paid. The v2 difference is carried as an open arrear/recovery and will appear on the next month&rsquo;s payroll
            and wage slip, tagged &ldquo;previous period&rdquo;.
          </p>
        </div>
      )}



      <div className="grid gap-3 lg:grid-cols-2">
        <BreakdownSection
          title="Earnings"
          tone="emerald"
          lines={w.components}
          contractOf={(n) => contractLookup(contractComponents, n)}
          totalLabel="Earned gross"
          totalContract={contractGrossTotal}
          totalEarned={w.earnedGross}
        />
        <BreakdownSection
          title="Deductions"
          tone="rose"
          lines={w.deductions}
          contractOf={(n) => contractLookup(r.resource.deductions, n)}
          totalLabel="Total deductions"
          totalContract={null}
          totalEarned={w.totalDeductions}
          note={(n) => {
            if (/\besi(c)?\b/i.test(n)) return "0.75% of earned gross − washing − conveyance";
            if (/\bprofessional\s*tax\b|\bpt\b/i.test(n)) {
              if (!r.pt) return null;
              return r.pt.source === "resolved"
                ? `Per ${r.pt.state ?? ""} slab`
                : r.pt.source === "no_state"
                ? "Client state not set"
                : "No matching slab";
            }
            return null;
          }}
        />
        {additions.length > 0 && (
          <BreakdownSection
            title="Additions"
            tone="amber"
            lines={additions}
            contractOf={() => null}
            totalLabel="Total additions"
            totalContract={null}
            totalEarned={additionsTotal}
          />
        )}
        <BreakdownSection
          title="Employer contributions"
          tone="violet"
          lines={w.employerContributions}
          contractOf={(n) => contractLookup(r.resource.employerContributions, n)}
          totalLabel="Employer total"
          totalContract={null}
          totalEarned={w.totalEmployerContributions}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryCell label="Earned gross" value={w.earnedGross} />
        <SummaryCell label="Net pay" value={w.netPay} tone="emerald" />
        <SummaryCell label="CTC (employer cost)" value={w.employerCost} tone="amber" />
      </div>
    </div>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/60 bg-background px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${cls}`}>{fmtINR(value)}</div>
    </div>
  );
}



