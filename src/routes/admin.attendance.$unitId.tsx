import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePublicHolidays, holidayMapForDates } from "@/lib/public-holidays";
import {
  CalendarDays,
  ChevronLeft,
  Printer,
  Download,
  CheckCircle2,
  XCircle,
  Send,
  RotateCcw,
  Plus,
  X,
  Upload,
  Loader2,
  FileSpreadsheet,
  Image as ImageIcon,
  Trash2,
  Search,
  History as HistoryIcon,
  GitCompare,
  Camera,
  Clock3,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import { z } from "zod";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { withNetworkRetry, networkErrorMessage } from "@/lib/net-retry";
import { notifyApprovers, notifyUser } from "@/lib/notifications";
import { extractAttendanceViaApi, extractMigrationSheetViaApi } from "@/lib/sheet-ocr-api";
import type { MigrationSheetDay } from "@/lib/sheet-ocr-types";
import { scanDocument, qualityTone, type ScanQuality, type ScanResult } from "@/lib/document-scan";
import { DocumentScanCamera } from "@/components/DocumentScanCamera";
import {
  SCAN_JOBS_QK,
  failScanJob,
  finishScanJob,
  formatRemaining,
  heartbeatScanJob,
  readScanEstimateSeconds,
  recordScanDuration,
  startScanJob,
} from "@/lib/attendance-scan-jobs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  classifyAttendanceEmployee,
  isNonBillableRoleKey,
  matchesAttendanceScope,
  type AttendanceScopeAssignment,
  type AttendanceUnitContext,
} from "@/lib/attendance";
import { fetchAttendanceEntriesForPeriod } from "@/lib/attendance-fetch";
import {
  ensureAttendanceUnitMapping,
  forcePrimaryAttendanceMapping,
  looksLikeRelieverText,
  resolveSheetPersonForUnit,
} from "@/lib/attendance-sheet-people";
import {
  fetchAttendanceVersions,
  startAttendanceAmendment,
  setAmendmentStatus,
  diffAttendance,
  fetchLiveSnapshot,
  type AmendmentStatus,
  type AttendanceSnapshotEntry,
} from "@/lib/attendance-versions";

import {
  attendanceCodeForShift,
  fetchShiftHoursMap,
  overtimeDaysForShift,
  shiftHoursFor,
} from "@/lib/shift-hours";
import { resolvePayrollDayCount, type PayrollDayBaseLike } from "@/lib/payroll-days";

import { cn } from "@/lib/utils";
import { useCurrentPermissions } from "@/lib/rbac";
import { useCurrentUserRole } from "@/lib/use-current-user-role";

const searchSchema = z.object({
  month: z.coerce.number().min(0).max(11).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const Route = createFileRoute("/admin/attendance/$unitId")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Mark Attendance | PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "description",
        content: "Mark and review employee attendance for a selected unit and payroll period.",
      },
      { property: "og:title", content: "Mark Attendance | PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        property: "og:description",
        content: "Mark and review employee attendance for a selected unit and payroll period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MusterRollPage,
});

type AttendanceCode = {
  id: string;
  code: string;
  label: string;
  color: string;
  counts_as_present: boolean;
  is_paid: boolean;
  is_leave: boolean;
  day_value: number | string | null;
  sort_order: number;
};

type EntryRow = {
  candidate_id: string;
  designation_id: string | null;
  entry_date: string;
  code: string;
  ot_hours: number;
};

type OcrRowSummary = {
  candidate_id: string;
  p_days: number | null;
  ot_days: number | null;
  t_days: number | null;
  confident: boolean;
};

const SERVICE_PROVIDER = {
  name: "PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.",
  address: "Office No. 818, 8th Floor, Clover Hills Plaza, NIBM Road, Pune. 411048",
};

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

const ATTENDANCE_EMPLOYEE_STATUSES = ["active", "approved"] as const;

function daysInMonth(year: number, monthIdx0: number) {
  return new Date(year, monthIdx0 + 1, 0).getDate();
}

function ymd(year: number, monthIdx0: number, day: number) {
  const m = String(monthIdx0 + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.01) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= epsilon;
}

function isSummaryClose(actual: OcrRowSummary, expected: OcrRowSummary) {
  const pOk = expected.p_days == null || nearlyEqual(actual.p_days, roundHalf(expected.p_days), 1);
  // Printed muster rolls commonly total Extra Duty in hours (8, 16, 32),
  // while attendance_entries stores Extra Duty as days (1, 2, 4). Accept
  // either representation so a correct row is never rejected on units alone.
  const otOk =
    expected.ot_days == null ||
    nearlyEqual(actual.ot_days, roundHalf(expected.ot_days), 1) ||
    nearlyEqual(actual.ot_days, roundHalf(expected.ot_days / 8), 0.25);
  const tOk =
    expected.t_days == null || nearlyEqual(actual.t_days, roundHalf(expected.t_days), 1.5);
  return { pOk, otOk, tOk, ok: pOk && otOk && tOk };
}

async function downscaleImage(file: File, maxDim: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(async () => {
    // Safari/HEIC fallback via <img>
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      return img as unknown as ImageBitmap;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  const w = (bitmap as ImageBitmap).width ?? (bitmap as unknown as HTMLImageElement).naturalWidth;
  const h = (bitmap as ImageBitmap).height ?? (bitmap as unknown as HTMLImageElement).naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, tw, th);
  return canvas.toDataURL("image/jpeg", quality);
}

/** One photo of the muster, with its cleaned scan and quality verdict. */
type UploadPage = {
  name: string;
  /** Cleaned, perspective-corrected image. */
  dataUrl: string;
  /** Untouched photo, used when the person prefers the original. */
  originalDataUrl: string;
  cropped: boolean;
  quality: ScanQuality | null;
};

/**
 * Attendance register period = the contract's payroll window.
 * Standard windows (1 → 30/31) render the plain calendar month. Spanning
 * windows such as "26 to 25" render from day 26 of the previous month through
 * day 25 of the viewed month, so the register the client signs off matches the
 * payroll cut-off exactly. Dates are always taken from the real calendar, so
 * 30/31-day months and leap-year February stay exact.
 */
function buildPeriodCells(
  year: number,
  monthIdx: number,
  win?: { window_start_day: number; window_end_day: number } | null,
): Array<{ date: string; dayNum: number; monthIdx: number; year: number }> {
  const startDay = Math.max(1, Number(win?.window_start_day) || 1);
  const endDayRaw = Number(win?.window_end_day) || 0;
  const cells: Array<{ date: string; dayNum: number; monthIdx: number; year: number }> = [];

  // Same-month window (1 → 30/31): the full calendar month.
  if (startDay <= 1 || endDayRaw <= 0 || endDayRaw >= startDay) {
    const last = daysInMonth(year, monthIdx);
    for (let day = 1; day <= last; day += 1) {
      cells.push({ date: ymd(year, monthIdx, day), dayNum: day, monthIdx, year });
    }
    return cells;
  }

  // Spanning window (e.g. 26 → 25): previous month day `startDay` … this month day `endDay`.
  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1;
  const prevYear = monthIdx === 0 ? year - 1 : year;
  const prevLast = daysInMonth(prevYear, prevMonthIdx);
  for (let day = Math.min(startDay, prevLast); day <= prevLast; day += 1) {
    cells.push({
      date: ymd(prevYear, prevMonthIdx, day),
      dayNum: day,
      monthIdx: prevMonthIdx,
      year: prevYear,
    });
  }
  const endDay = Math.min(endDayRaw, daysInMonth(year, monthIdx));
  for (let day = 1; day <= endDay; day += 1) {
    cells.push({ date: ymd(year, monthIdx, day), dayNum: day, monthIdx, year });
  }
  return cells;
}

function buildExactPeriodCells(start: string, end: string) {
  const cells: Array<{ date: string; dayNum: number; monthIdx: number; year: number }> = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cursor <= last && cells.length < 62) {
    cells.push({
      date: ymd(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
      dayNum: cursor.getDate(),
      monthIdx: cursor.getMonth(),
      year: cursor.getFullYear(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

const NULL_DESIG = "__none__"; // sentinel row-key segment when an employee has no designation

const rowKey = (candidateId: string, designationId: string | null) =>
  `${candidateId}|${designationId ?? NULL_DESIG}`;

function MusterRollPage() {
  const { unitId } = Route.useParams();
  const search = Route.useSearch();
  const now = new Date();
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  const [year, setYear] = useState(search.year ?? now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(search.month ?? now.getMonth());
  const [musterQuery, setMusterQuery] = useState("");

  type AttendanceUnitRow = {
    id: string;
    code: string | null;
    name: string | null;
    location: string | null;
    epf_cap_enabled: boolean | null;
    branch_id: string | null;
    customer_id: string | null;
    billing_state: string | null;
    ph_enabled: boolean | null;
    ph_multiplier: number | null;
    reporting_officers: unknown;
    shipping_address1: string | null;
    shipping_address2: string | null;
    shipping_city: string | null;
    shipping_district: string | null;
    shipping_state: string | null;
    shipping_pincode: string | null;
    billing_address1: string | null;
    billing_address2: string | null;
    billing_city: string | null;
    billing_district: string | null;
    billing_pincode: string | null;
  };

  const { data: unit } = useQuery({
    queryKey: ["attendance-unit", unitId],
    queryFn: async () => {
      const { data: raw, error } = await supabase
        .from("units")
        .select(
          "id, code, name, location, epf_cap_enabled, branch_id, customer_id, billing_state, ph_enabled, ph_multiplier, ph_day_value, reporting_officers, shipping_address1, shipping_address2, shipping_city, shipping_district, shipping_state, shipping_pincode, billing_address1, billing_address2, billing_city, billing_district, billing_pincode" as never,
        )
        .eq("id", unitId)
        .maybeSingle();
      if (error) throw error;
      const data = (raw ?? null) as AttendanceUnitRow | null;
      if (!data) return null;
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name")
        .eq("id", String(data.customer_id ?? ""))
        .maybeSingle();
      return { ...data, customer_name: cust?.name ?? "" };
    },
  });

  const publicHolidays = usePublicHolidays();
  const phEnabled = Boolean(
    (unit as { ph_enabled?: boolean | null } | null | undefined)?.ph_enabled,
  );
  const phMultiplier =
    Number((unit as { ph_multiplier?: number | null } | null | undefined)?.ph_multiplier ?? 1) || 1;
  // Per-unit duty value of one PH-marked day. NULL = use the PH code's day_value.
  const unitPhDayValueRaw = (unit as { ph_day_value?: number | string | null } | null | undefined)
    ?.ph_day_value;
  const unitPhDayValue =
    unitPhDayValueRaw == null || Number.isNaN(Number(unitPhDayValueRaw))
      ? null
      : Number(unitPhDayValueRaw);

  const {
    data: rosterEmployees,
    isLoading,
    error: rosterError,
  } = useQuery({
    queryKey: ["attendance-roster-v5", unitId],
    queryFn: async () => {
      const rosterSelect =
        "id, employee_code, full_name, designation_id, preferred_joining_date, offboarded_at, date_of_birth, is_enabled, status, role_key, non_billable";

      const { data: prim, error: primError } = await supabase
        .from("candidates")
        .select(rosterSelect)
        .eq("unit_id", unitId)
        .eq("is_enabled", true)
        .in("status", [...ATTENDANCE_EMPLOYEE_STATUSES]);
      if (primError) throw primError;

      const [
        { data: links, error: linksError },
        { data: rawUnit, error: rawUnitError },
        { data: scopeAssignments, error: scopeAssignmentsError },
      ] = await Promise.all([
        supabase
          .from("candidate_units")
          .select("candidate_id, is_reliever, designation_id")
          .eq("unit_id", unitId),
        supabase
          .from("units")
          .select("id, branch_id, customer_id, billing_state")
          .eq("id", unitId)
          .maybeSingle(),
        supabase
          .from("employee_scope_assignments")
          .select("candidate_id, scope_type, scope_id")
          .limit(5000),
      ]);
      if (linksError) throw linksError;
      if (rawUnitError) throw rawUnitError;
      if (scopeAssignmentsError) throw scopeAssignmentsError;

      const context: AttendanceUnitContext | null = rawUnit
        ? {
            id: rawUnit.id,
            branch_id: rawUnit.branch_id,
            customer_id: rawUnit.customer_id,
            billing_state: rawUnit.billing_state,
          }
        : null;

      const scopeIds = new Set<string>();
      for (const assignment of (scopeAssignments ?? []) as AttendanceScopeAssignment[]) {
        // Only include people explicitly scoped to THIS unit. Branch / customer /
        // state scopes on field officers are oversight markers — they must not
        // pull unrelated people into another unit's muster roll.
        if (assignment.scope_type === "unit" && context && assignment.scope_id === context.id) {
          scopeIds.add(assignment.candidate_id);
        }
      }

      const secondaryIds = Array.from(
        new Set([...(links ?? []).map((l) => l.candidate_id), ...scopeIds]),
      );
      let extra: typeof prim = [];
      if (secondaryIds.length) {
        const { data, error } = await supabase
          .from("candidates")
          .select(rosterSelect)
          .in("id", secondaryIds)
          .eq("is_enabled", true)
          .in("status", [...ATTENDANCE_EMPLOYEE_STATUSES]);
        if (error) throw error;
        extra = data ?? [];
      }
      const all = [...(prim ?? []), ...(extra ?? [])];
      const dedup = Array.from(new Map(all.map((c) => [c.id, c])).values());
      // A guard can be deployed at several units at once — there is no "home unit".
      // Anyone assigned to this unit (own unit_id, a regular candidate_units link, or
      // a unit scope) is a regular deployed line. Only people HR added ad-hoc from the
      // muster search carry is_reliever = true on the link: those are (R) lines and are
      // tracked as overtime only.
      const relieverLinks = new Set(
        ((links ?? []) as Array<{ candidate_id: string; is_reliever?: boolean | null }>)
          .filter((l) => l.is_reliever === true)
          .map((l) => l.candidate_id),
      );
      const assignedIds = new Set<string>([
        ...(prim ?? []).map((c) => c.id),
        ...((links ?? []) as Array<{ candidate_id: string; is_reliever?: boolean | null }>)
          .filter((l) => l.is_reliever !== true)
          .map((l) => l.candidate_id),
        ...scopeIds,
      ]);
      const homeMapped = new Set(Array.from(assignedIds).filter((id) => !relieverLinks.has(id)));

      // The designation a person fills AT THIS UNIT comes from the unit mapping
      // (contracted role slot), not from their master record. "Security guard" is
      // a role; the designation drives salary and the payroll-day cap.
      const unitDesigByCandidate = new Map<string, string>();
      for (const l of (links ?? []) as Array<{
        candidate_id: string;
        designation_id?: string | null;
      }>) {
        if (l.designation_id) unitDesigByCandidate.set(l.candidate_id, l.designation_id);
      }

      const desigIds = Array.from(
        new Set([
          ...dedup.map((c) => c.designation_id).filter(Boolean),
          ...unitDesigByCandidate.values(),
        ]),
      ) as string[];
      const { data: desigs } = await supabase
        .from("designations")
        .select("id, name")
        .in("id", desigIds.length ? desigIds : ["00000000-0000-0000-0000-000000000000"]);
      const dMap = new Map((desigs ?? []).map((d) => [d.id, d.name]));

      const mappedEmployees = dedup
        .map((c) => {
          const isNonBillable =
            isNonBillableRoleKey(c.role_key) ||
            (c as { non_billable?: boolean }).non_billable === true;
          const effectiveDesignationId =
            unitDesigByCandidate.get(c.id) ?? (c.designation_id as string | null);
          const designationName =
            (effectiveDesignationId && dMap.get(effectiveDesignationId)) || "";
          return {
            id: c.id,
            employee_code: c.employee_code || "",
            full_name: c.full_name || "",
            designation_id: effectiveDesignationId,
            designation: designationName,
            employee_type: classifyAttendanceEmployee(c.role_key, designationName),
            doj: c.preferred_joining_date || "",
            left_on: ((c as { offboarded_at?: string | null }).offboarded_at || "").slice(0, 10),
            is_non_billable: isNonBillable,
            is_home_mapped: homeMapped.has(c.id),
            is_reliever: relieverLinks.has(c.id) && !homeMapped.has(c.id),
            role_key: (c.role_key || "").toLowerCase(),
          };
        })

        // Muster rolls are billable-only for client units. Non-billable staff
        // (field officers, branch managers, HR, etc.) only appear on the
        // Radiant home-unit muster (UN-RGS-PUNE), where their payroll lives.
        .filter((c) => !c.is_non_billable || unitId === "92541381-14d3-4be6-ae8c-078b79c2e0f1")
        .sort((a, b) =>
          (a.employee_code || a.full_name).localeCompare(b.employee_code || b.full_name),
        );

      return mappedEmployees;
    },
    enabled: Boolean(unit),
  });

  // Contract effective for the viewed month: payroll window + designations
  // available on this unit. Prefer the latest contract that overlaps the
  // register period; an older still-active record must not override a renewal.
  const { data: contractInfo } = useQuery({
    queryKey: ["attendance-contract", unitId, year, monthIdx],
    queryFn: async () => {
      const viewedMonthStart = search.start ?? ymd(year, monthIdx, 1);
      const viewedMonthEnd = search.end ?? ymd(year, monthIdx, daysInMonth(year, monthIdx));
      const { data: contracts, error } = await supabase
        .from("client_contracts")
        .select("id, payroll_window_id, start_date, end_date, status, record_type")
        .eq("unit_id", unitId)
        .eq("record_type", "client")
        .eq("status", "active")
        .lte("start_date", viewedMonthEnd)
        .or(`end_date.is.null,end_date.gte.${viewedMonthStart}`)
        .order("start_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      const winId = contracts?.[0]?.payroll_window_id;
      const startDate = contracts?.[0]?.start_date ?? null;
      const contractId = contracts?.[0]?.id ?? null;

      type Win = {
        id: string;
        label: string | null;
        window_start_day: number;
        window_end_day: number;
      };
      let win: Win | null = null;
      if (winId) {
        const { data: winRow } = await supabase
          .from("payroll_windows")
          .select("id, label, window_start_day, window_end_day")
          .eq("id", winId)
          .maybeSingle();
        win = (winRow as Win | null) ?? null;
      }

      let resources: Array<{
        designationId: string;
        designationName: string;
        quantity: number;
        payrollDayBase: PayrollDayBaseLike | null;
      }> = [];
      if (contractId) {
        const { data: r } = await supabase
          .from("contract_resources")
          .select("designation_id, quantity, sort_order, payroll_day_base_id")
          .eq("contract_id", contractId)
          .order("sort_order", { ascending: true });
        const rows = (r ?? []).filter((x) => x.designation_id) as Array<{
          designation_id: string;
          quantity: number | null;
          payroll_day_base_id: string | null;
        }>;
        const qtyById = new Map<string, number>();
        const pdbIdByDesig = new Map<string, string>();
        const orderedIds: string[] = [];
        for (const row of rows) {
          if (!qtyById.has(row.designation_id)) orderedIds.push(row.designation_id);
          qtyById.set(
            row.designation_id,
            (qtyById.get(row.designation_id) ?? 0) + Math.max(1, Number(row.quantity) || 1),
          );
          if (row.payroll_day_base_id && !pdbIdByDesig.has(row.designation_id)) {
            pdbIdByDesig.set(row.designation_id, String(row.payroll_day_base_id));
          }
        }
        const pdbById = new Map<string, PayrollDayBaseLike>();
        const pdbIds = Array.from(new Set(pdbIdByDesig.values()));
        if (pdbIds.length) {
          const { data: bases } = await supabase
            .from("payroll_day_bases")
            .select("id, method, fixed_days, weekly_off_day, included_weekdays")
            .in("id", pdbIds);
          for (const b of (bases ?? []) as Array<Record<string, unknown>>) {
            pdbById.set(String(b.id), {
              method: String(b.method) as PayrollDayBaseLike["method"] | "fixed_annual_average",
              fixedDays: b.fixed_days == null ? null : Number(b.fixed_days),
              weeklyOffDay: b.weekly_off_day == null ? null : Number(b.weekly_off_day),
              includedWeekdays: Array.isArray(b.included_weekdays)
                ? (b.included_weekdays as unknown[])
                    .map((n) => Number(n))
                    .filter((n) => n >= 0 && n <= 6)
                : null,
            });
          }
        }
        if (orderedIds.length) {
          const { data: ds } = await supabase
            .from("designations")
            .select("id, name")
            .in("id", orderedIds);
          const nameById = new Map((ds ?? []).map((d) => [d.id, d.name]));
          resources = orderedIds.map((id) => ({
            designationId: id,
            designationName: nameById.get(id) ?? "—",
            quantity: qtyById.get(id) ?? 1,
            payrollDayBase: pdbById.get(pdbIdByDesig.get(id) ?? "") ?? null,
          }));
        }
      }
      return { window: win, startDate, contractId, resources };
    },
    enabled: Boolean(unitId),
  });
  const payrollWindow = contractInfo?.window ?? null;
  const contractStartDate = contractInfo?.startDate ?? null;
  const contractDesignations = contractInfo?.resources ?? [];

  const periodCells = useMemo(
    () =>
      search.start && search.end
        ? buildExactPeriodCells(search.start, search.end)
        : buildPeriodCells(year, monthIdx, payrollWindow ?? null),
    [year, monthIdx, payrollWindow, search.start, search.end],
  );
  const dayCount = periodCells.length;
  const periodStart = periodCells[0]?.date ?? ymd(year, monthIdx, 1);
  const periodEnd =
    periodCells[periodCells.length - 1]?.date ?? ymd(year, monthIdx, daysInMonth(year, monthIdx));

  // ---- Period roster -----------------------------------------------------
  // Every period starts with an EMPTY muster roll. Unit mappings (primary
  // guards, relievers, unit scopes) never pre-fill a month: whatever is
  // uploaded — or added by hand — for that period IS the master roster for
  // that period. People appear only once they have attendance for these dates.
  const entriesQK = ["attendance-entries-v4", unitId, periodStart, periodEnd];
  const { data: entries = [] } = useQuery({
    queryKey: entriesQK,
    queryFn: async () => {
      return fetchAttendanceEntriesForPeriod({
        unitId,
        start: periodStart,
        end: periodEnd,
      }) as Promise<EntryRow[]>;
    },
    enabled: Boolean(unitId),
  });
  // People added to this period by hand (slot mapping / add line item) before
  // any attendance exists for them. Cleared when the period or unit changes.
  const [manualRosterIds, setManualRosterIds] = useState<Set<string>>(() => new Set<string>());
  useEffect(() => {
    setManualRosterIds(new Set<string>());
  }, [unitId, periodStart, periodEnd]);
  const periodRosterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries as EntryRow[]) ids.add(e.candidate_id);
    for (const id of manualRosterIds) ids.add(id);
    return ids;
  }, [entries, manualRosterIds]);
  const employees = useMemo(
    () => (rosterEmployees ?? []).filter((e) => periodRosterIds.has(e.id)),
    [rosterEmployees, periodRosterIds],
  );
  const [mobileDate, setMobileDate] = useState(() => {
    const requested =
      search.start && search.end && todayStr >= search.start && todayStr <= search.end
        ? todayStr
        : "";
    return requested;
  });
  useEffect(() => {
    if (periodCells.some((cell) => cell.date === mobileDate && cell.date <= todayStr)) return;
    const latestAvailable = [...periodCells].reverse().find((cell) => cell.date <= todayStr);
    setMobileDate(latestAvailable?.date ?? periodCells[0]?.date ?? "");
  }, [mobileDate, periodCells, todayStr]);
  const holidayByDate = useMemo(
    () =>
      holidayMapForDates(
        periodCells.map((c) => c.date),
        publicHolidays,
      ),
    [periodCells, publicHolidays],
  );

  // Max "P" days allowed per designation for this period, driven by the
  // contract resource's Payroll Days entry (26 fixed, actual days, actual
  // minus weekly off, custom weekdays...). This is deliberately independent
  // of the unit's EPF-cap setting: EPF contribution capping must never alter
  // the contractual attendance basis.
  const maxPDaysByDesignation = useMemo(() => {
    const dates = periodCells.map((c) => c.date);
    const m = new Map<string, number>();
    for (const d of contractDesignations) {
      // "Actual Days in Month" already means every visible calendar date in
      // this register is eligible for Present. The fixed annual average (30.41)
      // is used for invoicing and should not cap attendance either.
      if (
        d.payrollDayBase?.method === "actual_days" ||
        d.payrollDayBase?.method === "fixed_annual_average"
      )
        continue;
      const cap = resolvePayrollDayCount(d.payrollDayBase, dates);
      if (cap != null && cap > 0) m.set(d.designationId, cap);
    }
    return m;
  }, [contractDesignations, periodCells]);

  // Unit-level fallback cap. Reliever / extra-designation lines are often on a
  // designation that is not on the contract (e.g. "Admin Executive" on a unit
  // contracted only for "Security Guard"). A capped unit must still limit those
  // lines, so fall back to the strictest payroll-day base on the contract.
  const unitMaxPDays = useMemo(() => {
    const values = Array.from(maxPDaysByDesignation.values());
    if (values.length === 0) return null;
    return Math.min(...values);
  }, [maxPDaysByDesignation]);

  const queryClient = useQueryClient();
  const { can } = useCurrentPermissions();
  const canApprove = can("attendance", "approve");

  type SheetStatus = "draft" | "submitted" | "approved" | "rejected";
  type SheetRow = {
    id: string;
    status: SheetStatus;
    rejection_reason: string;
    review_proof_url: string | null;
    submitted_by: string | null;
    current_version: number | null;
    amendment_status: AmendmentStatus | null;
  };
  const sheetQK = ["attendance-sheet", unitId, periodStart, periodEnd];
  const { data: sheet } = useQuery({
    queryKey: sheetQK,
    queryFn: async (): Promise<SheetRow | null> => {
      const { data, error } = await supabase
        .from("attendance_sheets" as never)
        .select(
          "id, status, rejection_reason, review_proof_url, submitted_by, current_version, amendment_status",
        )
        .eq("unit_id", unitId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SheetRow | null;
    },
    enabled: Boolean(unitId && periodStart && periodEnd),
  });
  const status: SheetStatus = sheet?.status ?? "draft";
  const currentVersion = Math.max(1, Number(sheet?.current_version) || 1);
  const amendment: AmendmentStatus = (sheet?.amendment_status ?? "none") as AmendmentStatus;

  // Payroll-run state for this period — used to decide whether the
  // "Send for Payroll & Invoice" handoff has happened.
  type PayrollRunLite = {
    id: string;
    status: "draft" | "submitted" | "approved" | "rejected";
    payroll_status: string | null;
    invoice_status: string | null;
  };
  const payrollRunQK = ["attendance-payroll-run", unitId, periodStart, periodEnd];
  const { data: payrollRun } = useQuery({
    queryKey: payrollRunQK,
    enabled: Boolean(unitId && periodStart && periodEnd),
    queryFn: async (): Promise<PayrollRunLite | null> => {
      const { data, error } = await supabase
        .from("payroll_runs" as never)
        .select("id, status, payroll_status, invoice_status")
        .eq("unit_id", unitId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PayrollRunLite | null;
    },
  });
  const sentToPayroll = ["submitted", "approved"].includes(payrollRun?.status ?? "");
  const payrollProcessed = payrollRun?.payroll_status === "processed";

  // Frozen versions of this muster roll (v1 = the sheet that payroll paid).
  const versionsQK = ["attendance-versions", unitId, periodStart, periodEnd];
  const { data: versions = [] } = useQuery({
    queryKey: versionsQK,
    enabled: Boolean(unitId && periodStart && periodEnd),
    queryFn: () => fetchAttendanceVersions(unitId, periodStart, periodEnd),
  });

  const amendmentOpen = amendment === "open";
  const amendmentSubmitted = amendment === "submitted";
  const amendmentApproved = amendment === "approved";
  const amendmentActive = amendmentOpen || amendmentSubmitted || amendmentApproved;

  // FO/admin edit when draft or rejected. Approver may also edit inline while
  // the sheet is submitted (HR can fix in place instead of bouncing back).
  // An open amendment (v2+) is editable again even though the sheet is approved.
  const editable =
    status === "draft" ||
    status === "rejected" ||
    (status === "submitted" && canApprove) ||
    amendmentOpen ||
    (amendmentSubmitted && canApprove);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectProof, setRejectProof] = useState<File | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  const transitionSheet = useMutation({
    mutationFn: async (next: { status: SheetStatus; reason?: string; proofFile?: File | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      const ts = new Date().toISOString();
      const base: Record<string, unknown> = {
        unit_id: unitId,
        period_start: periodStart,
        period_end: periodEnd,
        status: next.status,
      };
      if (next.status === "submitted") {
        base.submitted_at = ts;
        base.submitted_by = uid;
      }
      if (next.status === "approved") {
        base.approved_at = ts;
        base.approved_by = uid;
      }
      if (next.status === "rejected") {
        base.rejected_at = ts;
        base.rejected_by = uid;
        base.rejection_reason = next.reason ?? "";
        // Upload the optional proof image and store its path.
        if (next.proofFile) {
          setUploadingProof(true);
          try {
            const ext = next.proofFile.name.split(".").pop() || "png";
            const path = `${unitId}/${periodStart}_${periodEnd}/${Date.now()}.${ext}`;
            const up = await supabase.storage
              .from("attendance-review-proofs")
              .upload(path, next.proofFile, { upsert: true });
            if (up.error) throw up.error;
            base.review_proof_url = path;
          } finally {
            setUploadingProof(false);
          }
        }
      }
      if (next.status === "draft" || next.status === "submitted") {
        // Resubmit after fix — clear prior rejection metadata.
        base.rejection_reason = "";
        base.review_proof_url = null;
      }
      if (sheet?.id) {
        const { error } = await supabase
          .from("attendance_sheets" as never)
          .update(base as never)
          .eq("id", sheet.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("attendance_sheets" as never).insert(base as never);
        if (error) throw error;
      }
      void logActivity({
        module: "Attendance",
        action:
          next.status === "submitted"
            ? "submit"
            : next.status === "approved"
              ? "approve"
              : next.status === "rejected"
                ? "reject"
                : "reopen",
        entityType: "attendance_sheets",
        entityLabel: `${unitId} ${periodStart} → ${periodEnd}`,
        details: {
          unit_id: unitId,
          period_start: periodStart,
          period_end: periodEnd,
          status: next.status,
          reason: next.reason ?? "",
        },
      });
      // Fan out notifications.
      const link = `/admin/attendance/${unitId}?month=${new Date(periodStart).getMonth()}&year=${new Date(periodStart).getFullYear()}`;
      const unitLabel = (
        (unit as { customer_name?: string; name?: string } | null | undefined)?.customer_name
          ? `${(unit as { customer_name?: string }).customer_name} — ${(unit as { name?: string }).name ?? ""}`
          : ((unit as { name?: string } | null | undefined)?.name ?? "unit")
      ).trim();
      const periodLabel = `${MONTH_NAMES[monthIdx]} ${year}`;
      if (next.status === "submitted") {
        // Look up the field officer's display name for a richer approver message.
        let actorName = "A field officer";
        if (uid) {
          const { data: rows } = await supabase.rpc(
            "get_user_display_name" as never,
            { _user_id: uid } as never,
          );
          const row = Array.isArray(rows)
            ? (rows[0] as { full_name?: string } | undefined)
            : undefined;
          if (row?.full_name) actorName = row.full_name;
        }
        void notifyApprovers({
          moduleKey: "attendance",
          type: "attendance_submitted",
          title: `Attendance approval needed — ${unitLabel}`,
          message: `${actorName} submitted attendance for ${unitLabel} (${periodLabel}). Tap to review.`,
          link,
          entityType: "attendance_sheets",
          entityId: sheet?.id ?? "",
        }).catch(() => undefined);
      } else if (next.status === "approved" || next.status === "rejected") {
        void notifyUser(sheet?.submitted_by ?? null, {
          type: next.status === "approved" ? "attendance_approved" : "attendance_rejected",
          title:
            next.status === "approved"
              ? `Attendance approved — ${unitLabel}`
              : `Attendance rejected — ${unitLabel}`,
          message:
            next.status === "approved"
              ? `Your attendance for ${unitLabel} (${periodLabel}) was approved.`
              : `Your attendance for ${unitLabel} (${periodLabel}) was rejected. Reason: ${next.reason ?? ""}`,
          link,
          entityType: "attendance_sheets",
          entityId: sheet?.id ?? "",
        }).catch(() => undefined);
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: sheetQK });
      queryClient.invalidateQueries({ queryKey: payrollRunQK });
      toast.success(
        vars.status === "submitted"
          ? "Submitted for approval"
          : vars.status === "approved"
            ? "Attendance approved — payroll unlocked"
            : vars.status === "rejected"
              ? "Attendance rejected"
              : "Reopened for editing",
      );
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Handoff to Payroll & Invoice teams. Creates/updates payroll_runs
  // row for this period with status='submitted' so the payroll and
  // invoice pages surface it as pending, and fans out notifications
  // to both approver groups.
  const sendToPayroll = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      const ts = new Date().toISOString();
      const base: Record<string, unknown> = {
        unit_id: unitId,
        period_start: periodStart,
        period_end: periodEnd,
        status: "submitted",
        submitted_at: ts,
        submitted_by: uid,
        rejection_reason: null,
      };
      // Upsert on the (unit, period) unique key so a row that exists but is
      // not visible to this user's read scope does not cause a duplicate-key
      // failure on handoff.
      const { error } = await supabase
        .from("payroll_runs" as never)
        .upsert(base as never, { onConflict: "unit_id,period_start,period_end" } as never);
      if (error) {
        const pg = error as { message?: string; details?: string; hint?: string };
        throw new Error(pg.message || pg.details || pg.hint || "Failed to send to payroll");
      }

      void logActivity({
        module: "Attendance",
        action: "send_to_payroll",
        entityType: "attendance_sheets",
        entityLabel: `${unitId} ${periodStart} → ${periodEnd}`,
        details: { unit_id: unitId, period_start: periodStart, period_end: periodEnd },
      });
      const unitLabel = (
        (unit as { customer_name?: string; name?: string } | null | undefined)?.customer_name
          ? `${(unit as { customer_name?: string }).customer_name} — ${(unit as { name?: string }).name ?? ""}`
          : ((unit as { name?: string } | null | undefined)?.name ?? "unit")
      ).trim();
      const periodLabel = `${MONTH_NAMES[monthIdx]} ${year}`;
      let actorName = "An approver";
      if (uid) {
        const { data: rows } = await supabase.rpc(
          "get_user_display_name" as never,
          { _user_id: uid } as never,
        );
        const row = Array.isArray(rows)
          ? (rows[0] as { full_name?: string } | undefined)
          : undefined;
        if (row?.full_name) actorName = row.full_name;
      }
      const payrollLink = `/admin/payroll/${unitId}?start=${periodStart}&end=${periodEnd}`;
      const invoiceLink = `/admin/invoice/${unitId}?start=${periodStart}&end=${periodEnd}`;
      await Promise.all([
        notifyApprovers({
          moduleKey: "payroll",
          type: "payroll_pending",
          title: `Payroll ready to process — ${unitLabel}`,
          message: `${actorName} sent ${unitLabel} (${periodLabel}) for payroll. Tap to open.`,
          link: payrollLink,
          entityType: "payroll_runs",
          entityId: payrollRun?.id ?? "",
        }).catch(() => undefined),
        notifyApprovers({
          moduleKey: "invoice",
          type: "invoice_pending",
          title: `Invoice ready to generate — ${unitLabel}`,
          message: `${actorName} sent ${unitLabel} (${periodLabel}) for invoicing. Tap to open.`,
          link: invoiceLink,
          entityType: "payroll_runs",
          entityId: payrollRun?.id ?? "",
        }).catch(() => undefined),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollRunQK });
      toast.success("Sent for Payroll & Invoice");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to send"),
  });

  // Reopen after handoff — clears the payroll_runs handoff back to draft
  // and moves the attendance sheet back to draft in one click.
  const reopenAfterHandoff = useMutation({
    mutationFn: async () => {
      if (payrollRun?.id) {
        const { error } = await supabase
          .from("payroll_runs" as never)
          .update({
            status: "draft",
            submitted_at: null,
            submitted_by: null,
            rejection_reason: null,
          } as never)
          .eq("id", payrollRun.id);
        if (error) throw error;
      }
      await new Promise<void>((resolve, reject) => {
        transitionSheet.mutate(
          { status: "draft" },
          { onSuccess: () => resolve(), onError: (e) => reject(e) },
        );
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollRunQK });
      queryClient.invalidateQueries({ queryKey: sheetQK });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to reopen"),
  });

  // ---- Post-payroll amendment ------------------------------------------
  // Payroll is already processed, so the sheet is never "reopened". The paid
  // muster roll is frozen as a version and a new editable version is started.
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState("");

  const invalidateAmendment = () => {
    queryClient.invalidateQueries({ queryKey: sheetQK });
    queryClient.invalidateQueries({ queryKey: versionsQK });
    queryClient.invalidateQueries({ queryKey: payrollRunQK });
    queryClient.invalidateQueries({
      predicate: (q) => String(q.queryKey[0] ?? "").startsWith("payroll"),
    });
  };

  const startAmendment = useMutation({
    mutationFn: async () => {
      const reason = amendReason.trim();
      if (reason.length < 5)
        throw new Error("Give a reason (at least 5 characters) for the amendment");
      return startAttendanceAmendment({
        unitId,
        periodStart,
        periodEnd,
        sheetId: sheet?.id ?? null,
        currentVersion,
        reason,
      });
    },
    onSuccess: (v) => {
      setAmendOpen(false);
      setAmendReason("");
      invalidateAmendment();
      toast.success(`Version ${v} opened — version ${v - 1} archived as the paid sheet`);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not start amendment"),
  });

  const moveAmendment = useMutation({
    mutationFn: async (next: AmendmentStatus) => {
      if (!sheet?.id) throw new Error("Attendance sheet not found");
      await setAmendmentStatus(sheet.id, next);
      return next;
    },
    onSuccess: (next) => {
      invalidateAmendment();
      toast.success(
        next === "submitted"
          ? `Version ${currentVersion} submitted for approval`
          : next === "approved"
            ? `Version ${currentVersion} approved — payroll can now post the difference`
            : "Amendment updated",
      );
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update amendment"),
  });

  // Live diff of the current (amended) sheet against the last frozen version.
  const previousVersion = useMemo(
    () =>
      versions.filter((v) => v.version < currentVersion).sort((a, b) => b.version - a.version)[0] ??
      null,
    [versions, currentVersion],
  );
  const { data: amendmentDiff = [] } = useQuery({
    // Prefixed with the entries key so every attendance save refreshes the diff.
    queryKey: [
      "attendance-entries-v4",
      unitId,
      periodStart,
      periodEnd,
      "amendment-diff",
      currentVersion,
    ],

    enabled: Boolean(amendmentActive && previousVersion),
    queryFn: async () => {
      const live = await fetchLiveSnapshot(unitId, periodStart, periodEnd);
      return diffAttendance((previousVersion?.snapshot ?? []) as AttendanceSnapshotEntry[], live);
    },
  });

  // Approval IS the handoff: once the sheet is approved, payroll & invoice are
  // notified automatically — no separate "send" click.
  const autoHandoffRef = useRef<string | null>(null);
  const handoffKey = `${unitId}:${periodStart}:${periodEnd}`;
  useEffect(() => {
    if (status !== "approved" || !canApprove || sentToPayroll) return;
    if (sendToPayroll.isPending || autoHandoffRef.current === handoffKey) return;
    autoHandoffRef.current = handoffKey;
    sendToPayroll.mutate();
  }, [status, canApprove, sentToPayroll, handoffKey, sendToPayroll]);

  const { data: codes = [] } = useQuery({
    queryKey: ["attendance-codes-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_codes")
        .select(
          "id, code, label, color, counts_as_present, is_paid, is_leave, day_value, sort_order",
        )
        .eq("enabled", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AttendanceCode[];
    },
  });

  const codeMap = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);

  // Multi-designation master: any additional designations a candidate carries
  const candidateIds = useMemo(() => (employees ?? []).map((e) => e.id), [employees]);
  const { data: candDesignations = [] } = useQuery({
    queryKey: ["attendance-candidate-designations", unitId, candidateIds.join(",")],
    queryFn: async () => {
      if (!candidateIds.length)
        return [] as Array<{ candidate_id: string; designation_id: string; is_primary: boolean }>;
      const { data, error } = await supabase
        .from("candidate_designations" as never)
        .select("candidate_id, designation_id, is_primary")
        .in("candidate_id", candidateIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        candidate_id: string;
        designation_id: string;
        is_primary: boolean;
      }>;
    },
    enabled: candidateIds.length > 0,
  });


  // --- Self-attendance punches (guards + non-billable employees) ---
  // Employees mapped to this unit can record attendance through the self-punch
  // flow. Their Punch In / Punch Out rows are derived into muster entries using
  // the duty-duration rules: <4h = A, 4h–<8h = HD, >=8h = P.
  const selfPunchCandidateIds = useMemo(
    // Relievers never generate regular attendance from punches. Their unit
    // assignment is ED-only and is filled exclusively on the ED row.
    () => (employees ?? []).filter((e) => !e.is_reliever).map((e) => e.id),
    [employees],
  );
  const selfPunchQK = [
    "attendance-self-punches",
    unitId,
    periodStart,
    periodEnd,
    selfPunchCandidateIds.join(","),
  ];
  const { data: selfPunches = [] } = useQuery({
    queryKey: selfPunchQK,
    queryFn: async () => {
      if (!selfPunchCandidateIds.length)
        return [] as Array<{
          candidate_id: string;
          punch_date: string;
          check_in_at: string | null;
          check_out_at: string | null;
        }>;
      const { data, error } = await supabase
        .from("self_attendance_punches")
        .select("candidate_id, punch_date, check_in_at, check_out_at")
        .in("candidate_id", selfPunchCandidateIds)
        .gte("punch_date", periodStart)
        .lte("punch_date", periodEnd);
      if (error) throw error;
      return data ?? [];
    },
    enabled: selfPunchCandidateIds.length > 0,
  });

  // Contractual shift hours (8h / 12h) per designation for this unit — the
  // foundation for attendance codes and overtime.
  const { data: shiftMap } = useQuery({
    queryKey: ["shift-hours-map", unitId],
    queryFn: () => fetchShiftHoursMap([unitId]),
    enabled: Boolean(unitId),
  });

  const derivedSelfEntries = useMemo(() => {
    const desigByCand = new Map<string, string | null>(
      (employees ?? []).map((e) => [e.id, e.designation_id ?? null]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const rows: EntryRow[] = [];
    for (const p of selfPunches) {
      if (!p.check_in_at) continue;
      // Wait for checkout before counting attendance.
      // If the punch date has already passed and the officer never checked out,
      // treat that day as Absent. For today with no checkout yet, skip entirely
      // so the cell stays blank until they check out.
      if (!p.check_out_at) {
        if (p.punch_date < today) {
          rows.push({
            candidate_id: p.candidate_id,
            designation_id: desigByCand.get(p.candidate_id) ?? null,
            entry_date: p.punch_date,
            code: "A",
            ot_hours: 0,
          });
        }
        continue;
      }
      const mins = (new Date(p.check_out_at).getTime() - new Date(p.check_in_at).getTime()) / 60000;
      const hours = Math.max(0, mins / 60);
      const designationId = desigByCand.get(p.candidate_id) ?? null;
      const shift = shiftHoursFor(shiftMap, unitId, designationId);
      const otDays = overtimeDaysForShift(hours, shift);
      const code = attendanceCodeForShift(hours, shift);
      rows.push({
        candidate_id: p.candidate_id,
        designation_id: designationId,
        entry_date: p.punch_date,
        code,
        ot_hours: otDays,
      });
    }
    return rows;
  }, [selfPunches, employees, shiftMap, unitId]);

  const entryMap = useMemo(() => {
    const m = new Map<string, EntryRow>();
    // Self-punch derived rows only FILL BLANKS. A stored attendance_entries row
    // is a human decision (HR/FO marked the muster) and always wins — otherwise
    // a forgotten checkout would keep flipping a manually corrected P back to A.
    for (const e of derivedSelfEntries)
      m.set(`${rowKey(e.candidate_id, e.designation_id)}|${e.entry_date}`, e);
    for (const e of entries)
      m.set(`${rowKey(e.candidate_id, e.designation_id)}|${e.entry_date}`, e);
    return m;
  }, [entries, derivedSelfEntries]);

  // Persist derived self-punch entries into attendance_entries so payroll
  // picks them up. Only rows with NO stored entry are written; existing rows
  // are never overwritten by punch derivation.
  useEffect(() => {
    if (!unitId || !derivedSelfEntries.length) return;
    const toPersist = derivedSelfEntries.filter((e) => {
      const existing = entries.find(
        (x) =>
          x.candidate_id === e.candidate_id &&
          x.entry_date === e.entry_date &&
          (x.designation_id ?? null) === (e.designation_id ?? null),
      );
      return !existing;
    });
    if (!toPersist.length) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = toPersist.map((e) => ({
          unit_id: unitId,
          candidate_id: e.candidate_id,
          designation_id: e.designation_id,
          entry_date: e.entry_date,
          code: e.code,
          ot_hours: e.ot_hours,
        }));
        const { error } = await supabase
          .from("attendance_entries")
          .upsert(payload, { onConflict: "unit_id,candidate_id,designation_id,entry_date" });
        if (error) throw error;
        if (!cancelled) queryClient.invalidateQueries({ queryKey: entriesQK });
      } catch {
        // Silently ignore — the derived view still displays correctly.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, derivedSelfEntries, entries]);

  // Extra (candidate, designation) rows the user added locally — persisted as soon as an entry is saved.
  const [extraRows, setExtraRows] = useState<Set<string>>(new Set());

  // ---- Map an employee onto an unassigned (vacant) contracted slot ----
  const [mapSlot, setMapSlot] = useState<{
    designationId: string | null;
    designationName: string;
  } | null>(null);
  const [mapQuery, setMapQuery] = useState("");
  const [mapSaving, setMapSaving] = useState(false);

  const currentRole = useCurrentUserRole();
  const restrictMapToOwnPeople = currentRole.isFieldOfficer;
  const managerCandidateId = currentRole.candidateId;
  const managerUserId = currentRole.userId;
  const mapScopeLoading = currentRole.isLoading;
  const mapScopeKey = restrictMapToOwnPeople
    ? `own:${managerCandidateId ?? managerUserId ?? "none"}`
    : "all";

  const mapSearch = mapQuery.trim();
  const { data: mapResults, isFetching: mapSearching } = useQuery({
    queryKey: ["attendance-map-lookup", unitId, mapSearch, mapScopeKey],
    enabled: Boolean(mapSlot) && mapSearch.length >= 2 && !mapScopeLoading,
    queryFn: async () => {
      // A field officer may only place people he owns: the ones he onboarded
      // (created_by / reports_to) or is recorded as reporting manager for.
      // Everyone else in the company must stay invisible to him here.
      let allowedIds: string[] | null = null;
      if (restrictMapToOwnPeople) {
        const [byManager, byReports, byCreator] = await Promise.all([
          managerCandidateId
            ? supabase
                .from("candidate_reporting_managers")
                .select("candidate_id")
                .eq("manager_id", managerCandidateId)
            : Promise.resolve({ data: [] as { candidate_id: string }[] }),
          managerCandidateId
            ? supabase.from("candidates").select("id").eq("reports_to", managerCandidateId)
            : Promise.resolve({ data: [] as { id: string }[] }),
          managerUserId
            ? supabase.from("candidates").select("id").eq("created_by", managerUserId)
            : Promise.resolve({ data: [] as { id: string }[] }),
        ]);
        const ids = new Set<string>();
        for (const r of (byManager.data ?? []) as { candidate_id: string }[])
          ids.add(r.candidate_id);
        for (const r of (byReports.data ?? []) as { id: string }[]) ids.add(r.id);
        for (const r of (byCreator.data ?? []) as { id: string }[]) ids.add(r.id);
        allowedIds = Array.from(ids);
        if (allowedIds.length === 0) return [];
      }

      const like = mapSearch.replace(/[%,]/g, " ");
      let query = supabase
        .from("candidates")
        .select(
          "id, full_name, employee_code, candidate_code, designation_id, preferred_joining_date, role_key, non_billable",
        )
        .eq("is_enabled", true)
        .in("status", [...ATTENDANCE_EMPLOYEE_STATUSES])
        .or(
          `full_name.ilike.%${like}%,employee_code.ilike.%${like}%,candidate_code.ilike.%${like}%`,
        );
      if (allowedIds) query = query.in("id", allowedIds);
      const { data, error } = await query.order("full_name").limit(30);
      if (error) throw error;
      // Non-billable staff (field officers, branch managers, HR…) never belong on a
      // client muster roll — mapping them here silently produces an empty roster.
      const rows = (data ?? []).filter((r) => {
        if (unitId === "92541381-14d3-4be6-ae8c-078b79c2e0f1") return true;
        const roleKey = ((r as { role_key?: string | null }).role_key || "").toLowerCase();
        return (
          !isNonBillableRoleKey(roleKey) && (r as { non_billable?: boolean }).non_billable !== true
        );
      });
      const desigIds = Array.from(
        new Set(rows.map((r) => r.designation_id).filter(Boolean)),
      ) as string[];
      const { data: desigs } = await supabase
        .from("designations")
        .select("id, name")
        .in("id", desigIds.length ? desigIds : ["00000000-0000-0000-0000-000000000000"]);
      const dMap = new Map((desigs ?? []).map((d) => [d.id as string, d.name as string]));
      return rows.map((r) => ({
        id: r.id as string,
        full_name: (r.full_name as string) || "—",
        employee_code: (r.employee_code as string) || (r.candidate_code as string) || "—",
        designation_id: (r.designation_id as string | null) ?? null,
        designation: (r.designation_id && dMap.get(r.designation_id as string)) || "—",
        doj: (r.preferred_joining_date as string | null) || "",
      }));
    },
  });

  const rosterIds = useMemo(() => new Set((employees ?? []).map((e) => e.id)), [employees]);

  const mapEmployeeToSlot = async (cand: {
    id: string;
    full_name: string;
    designation_id: string | null;
  }) => {
    if (!mapSlot) return;
    setMapSaving(true);
    try {
      // A guard holds exactly ONE primary posting. If he has no primary unit yet,
      // filling a contracted slot here deploys him properly (full attendance).
      // If he is already posted elsewhere, he can only stand in as a reliever (ED).
      const { data: existingLinks, error: linkError } = await supabase
        .from("candidate_units")
        .select("unit_id, is_primary, is_reliever")
        .eq("candidate_id", cand.id);
      if (linkError) throw linkError;
      const hasPrimaryElsewhere = ((existingLinks ?? []) as Array<{
        unit_id: string;
        is_primary?: boolean | null;
        is_reliever?: boolean | null;
      }>).some((l) => l.unit_id !== unitId && l.is_primary === true && l.is_reliever !== true);
      const asReliever = hasPrimaryElsewhere;

      const { error } = await supabase.from("candidate_units").upsert(
        {
          candidate_id: cand.id,
          unit_id: unitId,
          is_reliever: asReliever,
          is_primary: !asReliever,
          designation_id: mapSlot.designationId ?? cand.designation_id ?? null,
        },
        { onConflict: "candidate_id,unit_id" },
      );
      if (error) throw error;

      // If the slot's designation differs from the employee's own, surface the
      // line on the contracted designation so the slot is actually filled.
      if (mapSlot.designationId && mapSlot.designationId !== cand.designation_id) {
        setExtraRows((prev) => new Set(prev).add(rowKey(cand.id, mapSlot.designationId)));
      }

      // Show the person on THIS period's muster immediately, before any
      // attendance exists for them.
      setManualRosterIds((prev) => new Set(prev).add(cand.id));
      await queryClient.invalidateQueries({ queryKey: ["attendance-roster-v5", unitId] });
      logActivity({
        module: "Attendance",
        action: "update",
        entityType: "muster_slot",
        entityId: cand.id,
        entityLabel: `${cand.full_name} → ${mapSlot.designationName} @ ${unit?.name ?? unitId}`,
      });
      toast.success(
        asReliever
          ? `${cand.full_name} added as reliever (R) on ${mapSlot.designationName} — extra duty only`
          : `${cand.full_name} deployed on ${mapSlot.designationName}`,
      );
      setMapSlot(null);
      setMapQuery("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to map employee");
    } finally {
      setMapSaving(false);
    }
  };

  // Derived list of muster rows: one per (candidate, designation)
  const musterRows = useMemo(() => {
    const out: Array<{
      key: string;
      candidateId: string;
      designationId: string | null;
      designationName: string;
      emp: NonNullable<typeof employees>[number];
      isPrimary: boolean;
      /**
       * Reliever line — either an extra designation for the same person, or a
       * stand-in HR added ad-hoc from the muster search. Relievers can be
       * removed from the muster; regular deployed people cannot.
       */
      reliever?: boolean;
      /**
       * Ad-hoc stand-in: tracked as overtime only, so the attendance row is
       * read-only and only the OT row can be filled.
       */
      otOnly?: boolean;
      /** Contracted designation slot with nobody mapped yet — read-only placeholder. */
      vacant?: boolean;
      /** Open line offered past the contract's agreed quantity. */
      beyondAgreed?: boolean;
    }> = [];
    const seen = new Set<string>();
    const desigNameMap = new Map(
      contractDesignations.map((d) => [d.designationId, d.designationName]),
    );
    // Who actually has any attendance recorded inside this period?
    const candidatesWithEntries = new Set((entries ?? []).map((e) => e.candidate_id));

    for (const emp of employees ?? []) {
      // Joining date never hides real data: a person is only kept off a
      // historical sheet when they joined after the period AND have no
      // attendance recorded in it (i.e. they belong to a later month).
      if (emp.doj && emp.doj > periodEnd && !candidatesWithEntries.has(emp.id)) continue;
      // Same rule on the exit side: someone who left before this period started
      // and has no attendance in it belongs to earlier months only.
      const leftOn = (emp as { left_on?: string }).left_on;
      if (leftOn && leftOn < periodStart && !candidatesWithEntries.has(emp.id)) continue;
      // A guard may be deployed at many units — "is_home_mapped" here means
      // "regularly assigned to this unit", not "this is their only unit".
      const assigned = (emp as { is_home_mapped?: boolean }).is_home_mapped === true;
      // Primary row from candidate's own designation
      const primaryKey = rowKey(emp.id, emp.designation_id);
      out.push({
        key: primaryKey,
        candidateId: emp.id,
        designationId: emp.designation_id,
        designationName: emp.designation || "—",
        emp,
        isPrimary: true,
        reliever: !assigned,
        otOnly: !assigned,
      });
      seen.add(primaryKey);

      // Additional designations from candidate master are intentionally NOT auto-added
      // here. They only surface in the muster when (a) attendance entries exist for that
      // (candidate, designation) pair in this period, or (b) the user explicitly adds a
      // line via "Add line item". This keeps the sheet free of empty designation rows.

      // Additional rows from any entries with a different designation

      for (const e of entries) {
        if (e.candidate_id !== emp.id) continue;
        const k = rowKey(e.candidate_id, e.designation_id);
        if (seen.has(k)) continue;
        seen.add(k);
        const dName = (e.designation_id && desigNameMap.get(e.designation_id)) || "—";
        out.push({
          key: k,
          candidateId: emp.id,
          designationId: e.designation_id,
          designationName: dName,
          emp,
          isPrimary: false,
          reliever: true,
          otOnly: true,
        });
      }

      // Locally added extras for this candidate
      for (const xk of extraRows) {
        if (!xk.startsWith(emp.id + "|")) continue;
        if (seen.has(xk)) continue;
        seen.add(xk);
        const did = xk.split("|")[1];
        const designationId = did === NULL_DESIG ? null : did;
        const dName = (designationId && desigNameMap.get(designationId)) || "—";
        out.push({
          key: xk,
          candidateId: emp.id,
          designationId,
          designationName: dName,
          emp,
          isPrimary: false,
          reliever: true,
          otOnly: true,
        });
      }
    }

    // Contracted designations always appear on the muster, even with nobody
    // mapped. For each designation we render `quantity` slots; slots already
    // filled by mapped employees are subtracted, the remainder show as
    // read-only vacant lines (no employee name / code / DOJ).
    const filledByDesignation = new Map<string, number>();
    for (const r of out) {
      if (!r.designationId) continue;
      filledByDesignation.set(r.designationId, (filledByDesignation.get(r.designationId) ?? 0) + 1);
    }
    for (const d of contractDesignations) {
      const filled = filledByDesignation.get(d.designationId) ?? 0;
      const vacantCount = Math.max(0, (d.quantity ?? 1) - filled);
      // Agreed deployment is a commitment, not a cap — billing runs on actuals.
      // Once the agreed count is filled we still offer one open line so more
      // people can be deployed on the same designation.
      const extraSlots = vacantCount === 0 ? 1 : 0;
      for (let i = 0; i < vacantCount + extraSlots; i += 1) {
        out.push({
          key: `vacant|${d.designationId}|${i}`,
          candidateId: "",
          designationId: d.designationId,
          designationName: d.designationName,
          emp: {
            id: "",
            full_name: "",
            employee_code: "",
            designation_id: d.designationId,
            designation: d.designationName,
            doj: null,
          } as unknown as NonNullable<typeof employees>[number],
          isPrimary: true,
          vacant: true,
          beyondAgreed: vacantCount === 0,
        });
      }
    }

    // Group the sheet by designation so vacant slots sit with their peers.
    return out
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          a.r.designationName.localeCompare(b.r.designationName) ||
          Number(a.r.vacant ?? false) - Number(b.r.vacant ?? false) ||
          a.i - b.i,
      )
      .map((x) => x.r);
  }, [employees, entries, extraRows, contractDesignations, periodStart, periodEnd]);

  // Client-side filter: name / employee_code / designation substring match.
  const visibleMusterRows = useMemo(() => {
    const q = musterQuery.trim().toLowerCase();
    if (!q) return musterRows;
    return musterRows.filter((r) => {
      const hay =
        `${r.emp.full_name ?? ""} ${r.emp.employee_code ?? ""} ${r.designationName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [musterRows, musterQuery]);

  // ---- Mutations ----

  // Supabase/PostgREST errors are plain objects, not Error instances — without
  // this the UI collapsed every database rejection into a bare "Failed to save".
  const saveErrorMessage = (e: unknown): string => networkErrorMessage(e, "Failed to save");

  const upsertEntries = async (
    candidate_id: string,
    designation_id: string | null,
    rows: Array<{ entry_date: string; code: string; ot_hours: number }>,
  ) => {
    // Reliever status belongs to a specific muster line, not the employee as
    // a whole. A guard may have an ED-only reliever line and a normal primary
    // line in the same unit; blanking by employee silently discarded valid P
    // marks on the primary line. Callers block reliever lines and the database
    // trigger remains the final invariant.
    const filtered = rows.filter((r) => r.entry_date <= todayStr);
    if (filtered.length === 0) {
      toast.error("All selected dates are in the future — nothing marked");
      return 0;
    }

    // ---- Payroll-days cap: max present days = contract's Payroll Days base.
    // Days beyond the cap are NOT discarded — they are converted to Extra Duty
    // (code blanked, day value moved into ot_hours, which stores ED DAYS), the
    // same conversion the database trigger performs as the final invariant.
    const dayValueOf = (code: string) => {
      const c = codeMap.get(code);
      if (!c || !c.counts_as_present) return 0;
      const v = c.day_value == null || Number.isNaN(Number(c.day_value)) ? 1 : Number(c.day_value);
      return v;
    };
    const contractResource = designation_id
      ? contractDesignations.find((resource) => resource.designationId === designation_id)
      : undefined;
    const usesActualCalendarDays = contractResource?.payrollDayBase?.method === "actual_days";
    const desigCap = designation_id ? maxPDaysByDesignation.get(designation_id) : undefined;
    // A known contract designation must use its own rule. The unit fallback is
    // only for designations absent from the contract; otherwise an Accounts
    // line configured as Actual Days could incorrectly inherit another line's
    // Fixed 26 Days restriction.
    const cap = usesActualCalendarDays
      ? null
      : contractResource
        ? (desigCap ?? null)
        : unitMaxPDays;
    let capped = filtered;
    let convertedDays = 0;
    let movedDays = 0;
    const extraRows: Array<{ entry_date: string; code: string; ot_hours: number }> = [];
    if (cap != null) {
      const rk = rowKey(candidate_id, designation_id);
      const touched = new Set(filtered.map((r) => r.entry_date));
      let used = 0;
      for (const cell of periodCells) {
        if (touched.has(cell.date)) continue;
        const e = entryMap.get(`${rk}|${cell.date}`);
        if (!e) continue;
        used += dayValueOf(e.code);
      }
      // A converted duty must not stack on a date that already carries extra
      // duty (that produced "24h" cells). It is parked on the next free date
      // of the same period instead.
      const overflow: Array<{ afterDate: string; days: number }> = [];
      capped = [...filtered]
        .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
        .map((r) => {
          const dv = dayValueOf(r.code);
          if (dv <= 0) return r;
          if (used + dv <= cap) {
            used += dv;
            return r;
          }
          convertedDays += dv;
          if ((Number(r.ot_hours) || 0) > 0) {
            overflow.push({ afterDate: r.entry_date, days: dv });
            return { ...r, code: "" };
          }
          return { ...r, code: "", ot_hours: dv };
        });

      if (overflow.length > 0) {
        const taken = new Set(capped.map((r) => r.entry_date));
        const isFree = (date: string) => {
          if (taken.has(date) || date > todayStr) return false;
          const e = entryMap.get(`${rk}|${date}`);
          if (!e) return true;
          return (e.code ?? "") === "" && (Number(e.ot_hours) || 0) === 0;
        };
        for (const o of overflow) {
          const free = periodCells.find((cell) => cell.date > o.afterDate && isFree(cell.date));
          if (free) {
            taken.add(free.date);
            extraRows.push({ entry_date: free.date, code: "", ot_hours: o.days });
            movedDays += o.days;
          } else {
            const target = capped.find((r) => r.entry_date === o.afterDate);
            if (target) target.ot_hours = (Number(target.ot_hours) || 0) + o.days;
          }
        }
      }
    }

    if (capped.length === 0 && extraRows.length === 0) return 0;

    const payload = [...capped, ...extraRows].map((r) => ({
      unit_id: unitId,
      candidate_id,
      designation_id,
      entry_date: r.entry_date,
      code: r.code,
      ot_hours: r.ot_hours,
    }));

    // A dropped connection ("Failed to fetch") means the write never reached the
    // database, so it is retried instead of being reported as a save failure.
    const savedRows = await withNetworkRetry(async () => {
      const { data, error } = await supabase
        .from("attendance_entries")
        .upsert(payload, { onConflict: "unit_id,candidate_id,designation_id,entry_date" })
        .select("entry_date,code,ot_hours");
      if (error) throw error;
      return data;
    });
    const savedByDate = new Map((savedRows ?? []).map((row) => [row.entry_date, row]));
    const mismatched = capped.filter((row) => {
      const saved = savedByDate.get(row.entry_date);
      return !saved || saved.code !== row.code || Number(saved.ot_hours ?? 0) !== row.ot_hours;
    });
    if (mismatched.length > 0) {
      throw new Error(
        `Attendance was not saved for ${mismatched.length} selected cell${mismatched.length === 1 ? "" : "s"}`,
      );
    }
    if (convertedDays > 0) {
      toast.info(
        `Payroll days limit (${cap}) reached — ${convertedDays} day${convertedDays === 1 ? "" : "s"} recorded as Extra Duty` +
          (movedDays > 0 ? ` (${movedDays} moved to the next free date)` : ""),
      );
    }
    return capped.length;
  };

  const rowsForAttendanceRole = (
    rows: Array<{ entry_date: string; code: string; ot_hours: number }>,
    isReliever: boolean,
  ) => {
    if (!isReliever) return rows;
    return rows.map((row) => {
      const meta = codeMap.get(row.code);
      const dutyDays = meta?.counts_as_present
        ? meta.day_value == null || Number.isNaN(Number(meta.day_value))
          ? 1
          : Number(meta.day_value)
        : 0;
      return {
        ...row,
        code: dutyDays > 0 ? "" : row.code,
        ot_hours: (Number(row.ot_hours) || 0) + dutyDays,
      };
    });
  };

  const confirm = useConfirm();
  const [clearingAll, setClearingAll] = useState(false);
  const handleClearAll = async () => {
    if (!editable) {
      toast.error("Sheet is locked");
      return;
    }
    const ok = await confirm({
      title: "Clear all attendance?",
      description: `This deletes every attendance entry on this sheet for ${periodStart} → ${periodEnd}. This cannot be undone.`,
      confirmText: "Clear all",
      destructive: true,
    });
    if (!ok) return;
    setClearingAll(true);
    try {
      const { error, count } = await supabase
        .from("attendance_entries")
        .delete({ count: "exact" })
        .eq("unit_id", unitId)
        .gte("entry_date", periodStart)
        .lte("entry_date", periodEnd);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: entriesQK });
      setUncertainCells(new Set());
      const n = count ?? 0;
      toast.success(`Cleared ${n} entr${n === 1 ? "y" : "ies"}`);
      logActivity({
        module: "Attendance",
        action: "Clear all entries",
        details: { unit_id: unitId, period_start: periodStart, period_end: periodEnd, deleted: n },
      }).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear");
    } finally {
      setClearingAll(false);
    }
  };

  // Drag-to-select state — a selection is a set of cells (`rowKey|date`),
  // so a drag can span both horizontally (days) and vertically (employees).
  type CellRef = { rowKey: string; date: string };
  const [selAnchor, setSelAnchor] = useState<CellRef | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCells, setPickerCells] = useState<string[]>([]);
  const [mobileSelectedRows, setMobileSelectedRows] = useState<Set<string>>(new Set());

  const [otSelAnchor, setOtSelAnchor] = useState<CellRef | null>(null);
  const [isOtDragging, setIsOtDragging] = useState(false);
  const [otSelectedCells, setOtSelectedCells] = useState<Set<string>>(new Set());
  const [otPickerOpen, setOtPickerOpen] = useState(false);
  const [otPickerCells, setOtPickerCells] = useState<string[]>([]);

  // ---- OCR / Excel upload state ----
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<"image" | "excel" | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  // Several photos of the same muster (page 1, page 2, …) are read one after
  // another so a multi-page sheet can be uploaded in one go.
  const [uploadImages, setUploadImages] = useState<UploadPage[]>([]);
  const [scanStep, setScanStep] = useState<{ index: number; total: number } | null>(null);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [uncertainCells, setUncertainCells] = useState<Set<string>>(new Set());
  const [ocrSummary, setOcrSummary] = useState<string | null>(null);
  const [uploadReadyToContinue, setUploadReadyToContinue] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Document-scan state: every photo is auto-cropped, straightened and cleaned
  // before it is read, and the person is told when a photo is too poor to use.
  const [preparingScan, setPreparingScan] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // The camera opens as its own dialog, so the upload dialog is hidden while it
  // is on screen. Without this flag the hide would wipe the pages just captured.
  const skipUploadResetRef = useRef(false);
  const autoReadRef = useRef(false);
  const [useCleaned, setUseCleaned] = useState(true);

  // ---- Reading progress (keeps running after the dialog is closed) ----
  const [scanPct, setScanPct] = useState(0);
  const [scanRemaining, setScanRemaining] = useState<number | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanJobIdRef = useRef<string | null>(null);

  const beginScanProgress = async (kind: "image" | "excel") => {
    const estimate = kind === "excel" ? 10 : readScanEstimateSeconds();
    const startedAt = Date.now();
    setScanPct(2);
    setScanRemaining(estimate);
    const jobId = await startScanJob({
      unitId,
      periodStart,
      periodEnd,
      kind,
      estimateSeconds: estimate,
    });
    scanJobIdRef.current = jobId;
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    let beats = 0;
    scanTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      // Google does not expose token-level progress for image reads. Move only
      // through the reading portion of the bar and switch to an honest
      // "finishing" state if the learned estimate is exceeded; never claim
      // 96% and leave it stuck there for minutes.
      const pct = Math.min(90, 5 + (elapsed / estimate) * 80);
      const remaining = elapsed < estimate ? estimate - elapsed : -1;
      setScanPct(pct);
      setScanRemaining(remaining);
      beats += 1;
      if (jobId && beats % 3 === 0) heartbeatScanJob(jobId, pct, remaining).catch(() => {});
    }, 1000);
    return { startedAt, estimate };
  };

  const endScanProgress = async (
    outcome: { summary?: string; error?: string },
    startedAt: number,
  ) => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    const jobId = scanJobIdRef.current;
    scanJobIdRef.current = null;
    setScanPct(outcome.error ? 0 : 100);
    setScanRemaining(0);
    if (outcome.error) {
      if (jobId) await failScanJob(jobId, outcome.error).catch(() => {});
    } else {
      recordScanDuration((Date.now() - startedAt) / 1000);
      if (jobId) await finishScanJob(jobId, outcome.summary ?? "Sheet read").catch(() => {});
    }
    await queryClient.invalidateQueries({ queryKey: [SCAN_JOBS_QK] });
  };

  useEffect(
    () => () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    },
    [],
  );

  const detectKind = (file: File): "image" | "excel" | null => {
    const name = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/.test(name))
      return "image";
    if (/\.(xlsx|xls|xlsm|csv|ods)$/.test(name)) return "excel";
    return null;
  };

  const readImageDataUrl = async (file: File) => {
    // Keep handwriting legible: attendance accuracy depends on cell detail, so
    // only very large photos are scaled down, at high JPEG quality.
    try {
      return await downscaleImage(file, 2200, 0.92);
    } catch {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.readAsDataURL(file);
      });
    }
  };

  /**
   * Run every picked photo through the document scanner: find the sheet, remove
   * the camera angle, flatten shadows and sharpen. The untouched photo is kept
   * so a bad crop can always be overridden.
   */
  const prepareScans = async (files: File[]): Promise<UploadPage[]> => {
    const out: UploadPage[] = [];
    for (const f of files) {
      try {
        const scan = await scanDocument(f);
        out.push({
          name: f.name,
          dataUrl: scan.dataUrl,
          originalDataUrl: scan.originalDataUrl,
          cropped: scan.cropped,
          quality: scan.quality,
        });
      } catch {
        const raw = await readImageDataUrl(f);
        out.push({
          name: f.name,
          dataUrl: raw,
          originalDataUrl: raw,
          cropped: false,
          quality: null,
        });
      }
    }
    return out;
  };

  const onPickUploadFiles = (files: File[]) => {
    setUploadFile(files[0] ?? null);
    setUploadPreview(null);
    setUploadImages([]);
    setUploadKind(null);
    setOcrSummary(null);
    setUploadReadyToContinue(false);
    if (!files.length) return;

    const kinds = files.map(detectKind);
    if (kinds.some((k) => k === null)) {
      toast.error("Unsupported file. Choose images or an Excel/CSV file.");
      return;
    }
    const images = files.filter((_, i) => kinds[i] === "image");
    if (images.length && images.length !== files.length) {
      toast.error("Upload photos together, or one Excel/CSV file — not both at once.");
      return;
    }
    if (!images.length && files.length > 1) {
      toast.error("Only one Excel/CSV file can be imported at a time.");
      setUploadFile(files[0] ?? null);
      setUploadKind("excel");
      setUploadPreview(files[0]?.name ?? null);
      return;
    }

    if (images.length) {
      setUploadKind("image");
      setUseCleaned(true);
      setPreparingScan(true);
      void prepareScans(images)
        .then((list) => {
          setUploadImages(list);
          setUploadPreview(list[0]?.dataUrl ?? null);
          const poor = list.filter((p) => p.quality?.verdict === "poor");
          if (poor.length) {
            toast.warning(
              poor.length === 1
                ? `${poor[0]!.name}: ${poor[0]!.quality?.hint ?? "photo quality is poor"}`
                : `${poor.length} photos are unclear — check the tips shown on each`,
            );
          }
        })
        .catch(() => toast.error("Could not read the selected photos."))
        .finally(() => setPreparingScan(false));
    } else {
      setUploadKind("excel");
      setUploadPreview(files[0]!.name);
    }
  };

  /** Hide the upload dialog (keeping its state) and open the camera scanner. */
  const openCameraScan = () => {
    skipUploadResetRef.current = true;
    setUploadOpen(false);
    setCameraOpen(true);
  };

  /** Accept pages captured with the live camera scanner. */
  const onCameraCapture = (
    captured: Array<{ name: string; dataUrl: string; scan: ScanResult }>,
  ) => {
    if (!captured.length) return;
    const list: UploadPage[] = captured.map((c) => ({
      name: c.name,
      dataUrl: c.scan.dataUrl,
      originalDataUrl: c.scan.originalDataUrl,
      cropped: c.scan.cropped,
      quality: c.scan.quality,
    }));
    setUploadKind("image");
    setUseCleaned(true);
    setUploadImages(list);
    setUploadPreview(list[0]!.dataUrl);
    setUploadFile(new File([], list[0]!.name, { type: "image/jpeg" }));
    setOcrSummary(null);
    setUploadReadyToContinue(false);
    setUploadOpen(true);
    // Start reading straight away — the person already confirmed the scan.
    autoReadRef.current = true;
  };

  /** Read every selected photo one after another into this muster. */
  const processAttendanceImages = async () => {
    const pages: Array<{ name: string; dataUrl: string }> = uploadImages.length
      ? uploadImages.map((p) => ({
          name: p.name,
          dataUrl: useCleaned ? p.dataUrl : p.originalDataUrl,
        }))
      : uploadPreview
        ? [{ name: uploadFile?.name ?? "sheet", dataUrl: uploadPreview }]
        : [];
    if (!pages.length) {
      toast.error("Choose an image first");
      return;
    }
    const summaries: string[] = [];
    try {
      for (let i = 0; i < pages.length; i++) {
        setScanStep({ index: i + 1, total: pages.length });
        const summary = await processAttendanceImage(pages[i]!.dataUrl);
        // A failed page is terminal. Continuing would repeat an account or
        // quota error for every remaining photo and could partially import a
        // multi-page muster.
        if (!summary) break;
        summaries.push(pages.length > 1 ? `${pages[i]!.name}: ${summary}` : summary);
      }
    } finally {
      setScanStep(null);
    }
    if (summaries.length > 1) setOcrSummary(summaries.join(" — "));
  };

  /**
   * Reads a sheet WITHOUT needing anyone mapped to the unit first. Names,
   * employee IDs and designations are read straight off the sheet, each person
   * is matched (or created) and mapped to this unit, then attendance is saved.
   */
  const importSheetPeopleWithoutRoster = async (
    sheetImage: string,
    onlyNames?: string[],
  ): Promise<{ cells: number; created: number; mapped: number; people: number }> => {
    const canonicalCode = new Map<string, string>();
    for (const c of codes) canonicalCode.set(c.code.toUpperCase(), c.code);
    const validDates = new Set(periodCells.map((c) => c.date));
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = (onlyNames ?? []).map(normalize).filter(Boolean);

    const result = await extractMigrationSheetViaApi({
      imageDataUrl: sheetImage,
      dates: periodCells.map((c) => c.date),
      codes: codes.map((c) => ({ code: c.code, label: c.label })),
      designations: contractDesignations.map((d) => ({
        id: d.designationId,
        name: d.designationName,
      })),
    });

    const { data: authUser } = await supabase.auth.getUser();
    const createdBy = authUser.user?.id ?? null;
    let cells = 0;
    let created = 0;
    let mapped = 0;
    let people = 0;

    for (const emp of result.employees) {
      if (wanted.length) {
        const n = normalize(emp.name || "");
        const c = normalize(emp.employee_code || "");
        const hit = wanted.some(
          (t) => (n && (t.includes(n) || n.includes(t))) || (c && t.includes(c)),
        );
        if (!hit) continue;
      }
      const rows = (emp.days ?? [])
        .filter(
          (d: MigrationSheetDay) =>
            validDates.has(d.entry_date) &&
            d.entry_date <= todayStr &&
            canonicalCode.has(String(d.code).toUpperCase()),
        )
        .map((d: MigrationSheetDay) => ({
          entry_date: d.entry_date,
          code: canonicalCode.get(String(d.code).toUpperCase())!,
          ot_hours: Number(d.ot_hours) || 0,
        }));
      if (!rows.length) continue;

      const designationId =
        emp.designation_id ??
        (contractDesignations.length === 1 ? contractDesignations[0].designationId : null);
      const resolved = await resolveSheetPersonForUnit({
        unitId,
        contractId: contractInfo?.contractId ?? null,
        ref: {
          codeTokens: [emp.employee_code, emp.mobile].filter(Boolean) as string[],
          nameTokens: [emp.name].filter(Boolean) as string[],
          designationId,
          designationName: emp.designation_name ?? null,
          isReliever: looksLikeRelieverText(emp.name, emp.designation_name),
        },
        joiningDate: periodStart,
        createdBy,
      });
      if (!resolved) continue;
      if (resolved.created) created += 1;
      else if (resolved.mapped) mapped += 1;
      people += 1;

      // Sheet-authoritative for this person's period.
      const { error: delError } = await supabase
        .from("attendance_entries")
        .delete()
        .eq("unit_id", unitId)
        .eq("candidate_id", resolved.candidateId)
        .gte("entry_date", periodStart)
        .lte("entry_date", periodEnd);
      if (delError) throw delError;
      const writeRows = async () =>
        upsertEntries(
          resolved.candidateId,
          resolved.designationId,
          rowsForAttendanceRole(rows, resolved.isReliever),
        );
      try {
        await writeRows();
      } catch (writeError) {
        // A stale reliever link at this site makes the database reject normal
        // attendance. The sheet is authoritative: post the guard here and retry.
        const msg = networkErrorMessage(writeError, "");
        if (!resolved.isReliever && /extra duty/i.test(msg)) {
          await forcePrimaryAttendanceMapping(
            resolved.candidateId,
            unitId,
            resolved.designationId,
          );
          await writeRows();
        } else throw writeError;
      }
      cells += rows.length;
    }

    await queryClient.invalidateQueries({ queryKey: entriesQK });
    await queryClient.invalidateQueries({ queryKey: ["attendance-roster-v5", unitId] });
    return { cells, created, mapped, people };
  };

  const processAttendanceImage = async (imageDataUrl?: string): Promise<string | null> => {
    const sheetImage = imageDataUrl ?? uploadPreview;
    if (!sheetImage) {
      toast.error("Choose an image first");
      return null;
    }
    if (!editable) {
      toast.error("Sheet is locked");
      return null;
    }
    if (!codes.length) {
      toast.error("No attendance codes configured");
      return null;
    }
    setProcessingOcr(true);
    setOcrSummary(null);
    setUploadReadyToContinue(false);
    const { startedAt } = await beginScanProgress("image");
    try {
      // Build the set of allowed (candidate × designation) pairs. The roster
      // sent to OCR includes EVERY designation on this unit's active contract
      // for each candidate, not just the row blocks currently on the muster —
      // so OCR can place a guard's OT under "Office Assistant" even if the FO
      // never manually added that row block yet. New pairs picked up from the
      // sheet are auto-created on apply. Out-of-contract designations are
      // blocked with a warning toast.
      const pairByKey = new Map<string, (typeof musterRows)[number]>();
      const candidatePairs = new Map<string, Array<(typeof musterRows)[number]>>();
      for (const mr of musterRows) {
        pairByKey.set(`${mr.candidateId}|${mr.designationId ?? ""}`, mr);
        const list = candidatePairs.get(mr.candidateId) ?? [];
        list.push(mr);
        candidatePairs.set(mr.candidateId, list);
      }
      // Synthetic pairs for contract designations not already on the muster.
      // These are "virtual" musterRow stand-ins used purely for OCR resolution
      // + upsert; the real row block appears after entries are saved and
      // musterRows re-derives.
      // Vacant (unmapped) slots carry no candidate id — they must never be sent
      // to the reader, otherwise the payload fails uuid validation.
      const namedRows = musterRows.filter((m) => !m.vacant && Boolean(m.candidateId));
      const candidatesById = new Map(namedRows.map((m) => [m.candidateId, m]));
      const employeesPayload: Array<{
        id: string;
        name: string;
        employee_code: string | null;
        designation: string | null;
        designation_id: string;
      }> = [];
      const seenPair = new Set<string>();
      for (const mr of namedRows) {
        const k = `${mr.candidateId}|${mr.designationId ?? ""}`;
        if (seenPair.has(k)) continue;
        seenPair.add(k);
        employeesPayload.push({
          id: mr.candidateId,
          name: mr.emp.full_name,
          employee_code: mr.emp.employee_code ?? null,
          designation: mr.designationName ?? null,
          designation_id: mr.designationId ?? "",
        });
      }
      if (!employeesPayload.length) {
        // Nobody mapped yet — read the people straight off the sheet, map /
        // create them, then save their attendance.
        const auto = await importSheetPeopleWithoutRoster(sheetImage);
        if (!auto.people) {
          throw new Error("No employee rows were detected on that sheet");
        }
        const autoSummary = `${auto.cells} cell${auto.cells === 1 ? "" : "s"} auto-filled for ${auto.people} ${auto.people === 1 ? "person" : "people"}${auto.mapped ? ` · mapped ${auto.mapped} to this unit` : ""}${auto.created ? ` · created ${auto.created} new employee${auto.created === 1 ? "" : "s"}` : ""}`;
        setOcrSummary(autoSummary);
        setUploadReadyToContinue(true);
        toast.success(autoSummary);
        await endScanProgress({ summary: autoSummary }, startedAt);
        logActivity({
          module: "Attendance",
          action: "Upload attendance image (OCR, auto-mapped)",
          details: { ...auto, unit_id: unitId },
        }).catch(() => {});
        return autoSummary;
      }
      // Speed guard: on contracts with many designations the candidate ×
      // designation cross-product makes the prompt enormous and the read very
      // slow. Beyond a handful of designations we send only the real muster
      // pairs; the reader still falls back to each person's primary row.
      const synthDesignations = contractDesignations.length <= 8 ? contractDesignations : [];
      for (const [candidateId, anyMr] of candidatesById) {
        for (const d of synthDesignations) {
          const k = `${candidateId}|${d.designationId}`;
          if (seenPair.has(k)) continue;
          seenPair.add(k);
          employeesPayload.push({
            id: candidateId,
            name: anyMr.emp.full_name,
            employee_code: anyMr.emp.employee_code ?? null,
            designation: d.designationName,
            designation_id: d.designationId,
          });
          // Virtual musterRow for resolution / upsert (mirrors structure of real rows).
          pairByKey.set(k, {
            ...anyMr,
            key: `${candidateId}|${d.designationId}`,
            designationId: d.designationId,
            designationName: d.designationName,
            isPrimary: false,
          });
        }
      }

      const result = await extractAttendanceViaApi({
        imageDataUrl: sheetImage,
        dates: periodCells.map((c) => c.date),
        employees: employeesPayload,
        codes: codes.map((c) => ({ code: c.code, label: c.label })),
      });

      const validDates = new Set(periodCells.map((c) => c.date));
      const pairKey = (cid: string, did: string | null) => `${cid}|${did ?? ""}`;
      const blockedDesigNames = new Set<string>();
      const resolvePairKey = (cid: string, did: string | null): string | null => {
        const direct = pairKey(cid, did);
        if (pairByKey.has(direct)) return direct;
        // OCR returned a designation that isn't a resource on this client's
        // contract — block per "Block with a warning" rule.
        if (did) {
          // Try to label it for the warning.
          const dname =
            contractDesignations.find((d) => d.designationId === did)?.designationName ?? did;
          blockedDesigNames.add(dname);
          return null;
        }
        // OCR couldn't place a designation at all — fall back to primary.
        const list = candidatePairs.get(cid);
        if (!list || list.length === 0) return null;
        const primary = list.find((m) => m.isPrimary) ?? list[0];
        return primary.key;
      };
      const byPair = new Map<string, typeof result.rows>();
      const uncertainNext = new Set<string>();
      const totalsMismatchPairs = new Set<string>();
      let confidentCount = 0;
      let uncertainCount = 0;

      for (const r of result.rows) {
        if (!validDates.has(r.entry_date)) continue;
        if (r.entry_date > todayStr) continue;
        const pk = resolvePairKey(r.candidate_id, r.designation_id);
        if (!pk) continue;
        const mr = pairByKey.get(pk)!;
        const cellKey = `${mr.key}|${r.entry_date}`;
        if (r.confident && r.code) {
          const list = byPair.get(pk) ?? [];
          list.push(r);
          byPair.set(pk, list);
          confidentCount += 1;
        } else {
          uncertainNext.add(cellKey);
          uncertainCount += 1;
        }
      }

      if (blockedDesigNames.size) {
        toast.warning(
          `Skipped rows for ${Array.from(blockedDesigNames).join(", ")} — not on this unit's active contract. Add the designation to the contract first, then re-import.`,
          { duration: 8000 },
        );
      }

      const computeImportedSummary = (
        rows: Array<{ entry_date: string; code: string; ot_hours: number }>,
      ): OcrRowSummary => {
        let pDays = 0;
        let otherPaidDays = 0;
        let phCount = 0;
        let otHours = 0;
        for (const row of rows) {
          otHours += Number(row.ot_hours) || 0;
          const meta = codeMap.get(row.code);
          if (!meta) continue;
          if (row.code === "PH") {
            phCount +=
              unitPhDayValue != null
                ? unitPhDayValue
                : meta.day_value == null || Number.isNaN(Number(meta.day_value))
                  ? 1
                  : Number(meta.day_value);
            continue;
          }
          if (row.code === "WO" || row.code === "W") continue;
          const dayValue =
            meta.day_value == null || Number.isNaN(Number(meta.day_value))
              ? 1
              : Number(meta.day_value);
          if (meta.counts_as_present) pDays += dayValue;
          else if (meta.is_paid) otherPaidDays += dayValue;
        }
        const otDays = roundHalf(otHours);
        // Paid days = P + PH (as configured) + ED only. Other paid codes never add days.
        const tDays = roundHalf(pDays + phCount + otDays);

        return {
          candidate_id: "",
          p_days: roundHalf(pDays),
          ot_days: otDays,
          t_days: tDays,
          confident: true,
        };
      };

      const summaryByPair = new Map(
        (result.row_summaries ?? []).map((summary) => {
          const pk =
            resolvePairKey(summary.candidate_id, summary.designation_id) ??
            pairKey(summary.candidate_id, summary.designation_id);
          return [pk, summary as OcrRowSummary];
        }),
      );

      for (const [pk, rows] of Array.from(byPair.entries())) {
        const expected = summaryByPair.get(pk);
        if (!expected?.confident) continue;
        const actual = computeImportedSummary(rows);
        const totalsCheck = isSummaryClose(actual, expected);
        if (!totalsCheck.ok) {
          totalsMismatchPairs.add(pk);
        }
      }

      if (byPair.size === 0) {
        // Nobody on the sheet matched this unit's roster (different guards, or
        // the reader could not tie rows to mapped people). Resolve the people
        // from the sheet itself — match or create them, map them to this unit,
        // then save their attendance. Never ask the user to map first.
        const auto = await importSheetPeopleWithoutRoster(
          sheetImage,
          result.unmatched_names.length ? result.unmatched_names : undefined,
        );
        if (!auto.people) {
          throw new Error(
            "No employee rows could be read from that sheet. Retake the photo in better light and try again.",
          );
        }
        const autoSummary = `${auto.cells} cell${auto.cells === 1 ? "" : "s"} auto-filled for ${auto.people} ${auto.people === 1 ? "person" : "people"}${auto.mapped ? ` · mapped ${auto.mapped} to this unit` : ""}${auto.created ? ` · created ${auto.created} new employee${auto.created === 1 ? "" : "s"}` : ""}`;
        await queryClient.invalidateQueries({ queryKey: entriesQK });
        await queryClient.invalidateQueries({ queryKey: ["attendance-roster-v5", unitId] });
        setOcrSummary(autoSummary);
        setUploadReadyToContinue(true);
        toast.success(autoSummary);
        await endScanProgress({ summary: autoSummary }, startedAt);
        logActivity({
          module: "Attendance",
          action: "Upload attendance image (OCR, auto-mapped)",
          details: { ...auto, unit_id: unitId },
        }).catch(() => {});
        return autoSummary;
      }

      const sheetPairKeys = new Set<string>([...byPair.keys()]);
      const mappingByPair = new Map<
        string,
        Awaited<ReturnType<typeof ensureAttendanceUnitMapping>>
      >();

      // Sheet-authoritative: for any candidate present in the uploaded sheet,
      // wipe ALL prior entries for the period (across every designation),
      // then re-write only what the sheet shows. Prevents phantom rows under
      // a designation the sheet didn't include.
      const candidatesInSheet = new Set<string>();
      for (const pk of sheetPairKeys) {
        const mr = pairByKey.get(pk);
        if (mr) candidatesInSheet.add(mr.candidateId);
      }
      if (candidatesInSheet.size) {
        // Normalize every person found on the uploaded muster before writing.
        // Existing reliever links accept only Extra Duty at DB level and would
        // otherwise silently clear all normal attendance codes.
        await Promise.all(
          Array.from(sheetPairKeys).map(async (pk) => {
            const mr = pairByKey.get(pk);
            if (!mr) return;
            // Reliever status is whatever the muster line already says — a
            // normal deployed line stays mapped to this unit as primary.
            const mapping = await ensureAttendanceUnitMapping(
              mr.candidateId,
              unitId,
              mr.designationId,
              mr.reliever === true,
            );
            mappingByPair.set(pk, mapping);
          }),
        );
        const { error } = await supabase
          .from("attendance_entries")
          .delete()
          .eq("unit_id", unitId)
          .in("candidate_id", Array.from(candidatesInSheet))
          .gte("entry_date", periodStart)
          .lte("entry_date", periodEnd);
        if (error) throw error;
      }

      confidentCount = Array.from(byPair.values()).reduce((sum, rows) => sum + rows.length, 0);
      uncertainCount = uncertainNext.size;

      await Promise.all(
        Array.from(byPair.entries()).map(async ([pk, rows]) => {
          const mr = pairByKey.get(pk)!;
          await upsertEntries(
            mr.candidateId,
            mr.designationId,
            rowsForAttendanceRole(
              rows.map((r) => ({ entry_date: r.entry_date, code: r.code, ot_hours: r.ot_hours })),
              mappingByPair.get(pk)?.isReliever ?? false,
            ),
          );
        }),
      );
      await queryClient.invalidateQueries({ queryKey: entriesQK });
      await queryClient.invalidateQueries({ queryKey: ["attendance-roster-v5", unitId] });

      setUncertainCells((prev) => {
        const next = new Set(prev);
        for (const k of uncertainNext) next.add(k);
        return next;
      });

      // Rows the reader could not match to anyone on the muster are resolved
      // from the sheet itself: match / create the person, map them to this unit
      // and save their attendance — never ask the user to map first.
      let auto = { cells: 0, created: 0, mapped: 0, people: 0 };
      if (result.unmatched_names.length) {
        auto = await importSheetPeopleWithoutRoster(sheetImage, result.unmatched_names);
      }
      const stillUnmatched = Math.max(0, result.unmatched_names.length - auto.people);
      const summary = `${confidentCount + auto.cells} cell${confidentCount + auto.cells === 1 ? "" : "s"} auto-filled · ${uncertainCount} flagged for review${totalsMismatchPairs.size ? ` · ${totalsMismatchPairs.size} row${totalsMismatchPairs.size === 1 ? "" : "s"} marked for totals review` : ""}${auto.mapped ? ` · mapped ${auto.mapped} employee${auto.mapped === 1 ? "" : "s"} to this unit` : ""}${auto.created ? ` · created ${auto.created} new employee${auto.created === 1 ? "" : "s"}` : ""}${stillUnmatched ? ` · ${stillUnmatched} unmatched row${stillUnmatched === 1 ? "" : "s"}` : ""}`;
      setOcrSummary(summary);
      setUploadReadyToContinue(true);
      toast.success(summary);
      await endScanProgress({ summary }, startedAt);
      logActivity({
        module: "Attendance",
        action: "Upload attendance image (OCR)",
        details: { confidentCount, uncertainCount, unit_id: unitId },
      }).catch(() => {});
      return summary;
    } catch (e) {
      // Never swallow a database / trigger error behind a bare "OCR failed":
      // those arrive as plain objects (PostgrestError), not Error instances.
      const message = networkErrorMessage(e, "Could not read this sheet. Please try again.");
      toast.error(message);
      await endScanProgress({ error: message }, startedAt);
      return null;
    } finally {
      setProcessingOcr(false);
    }
  };

  const processAttendanceExcel = async () => {
    if (!uploadFile) {
      toast.error("Choose a file first");
      return;
    }
    if (!editable) {
      toast.error("Sheet is locked");
      return;
    }
    if (!codes.length) {
      toast.error("No attendance codes configured");
      return;
    }
    setProcessingOcr(true);
    setOcrSummary(null);
    setUploadReadyToContinue(false);
    const { startedAt } = await beginScanProgress("excel");
    try {
      const buf = await uploadFile.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

      const validDateSet = new Set(periodCells.map((c) => c.date));
      const dayToDate = new Map<number, string>();
      for (const c of periodCells) dayToDate.set(Number(c.date.slice(8, 10)), c.date);

      const toIsoDate = (v: any): string | null => {
        if (v == null) return null;
        if (v instanceof Date) {
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, "0");
          const d = String(v.getDate()).padStart(2, "0");
          const iso = `${y}-${m}-${d}`;
          return validDateSet.has(iso) ? iso : null;
        }
        const s = String(v).trim();
        if (!s) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return validDateSet.has(s) ? s : null;
        const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m1) {
          const dd = Number(m1[1]);
          const mm = Number(m1[2]);
          let yy = Number(m1[3]);
          if (yy < 100) yy += 2000;
          const iso = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
          return validDateSet.has(iso) ? iso : null;
        }
        if (/^\d{1,2}$/.test(s)) return dayToDate.get(Number(s)) ?? null;
        return null;
      };

      let headerRowIdx = -1;
      let headerDates: Array<{ col: number; date: string }> = [];
      for (let r = 0; r < Math.min(aoa.length, 25); r++) {
        const row = aoa[r] || [];
        const hits: Array<{ col: number; date: string }> = [];
        for (let c = 0; c < row.length; c++) {
          const iso = toIsoDate(row[c]);
          if (iso) hits.push({ col: c, date: iso });
        }
        if (hits.length > headerDates.length) {
          headerDates = hits;
          headerRowIdx = r;
        }
      }
      if (headerRowIdx < 0 || headerDates.length === 0) {
        throw new Error(
          "Could not find date columns. Header row must contain dates or day numbers from this period.",
        );
      }

      const primaryByCandidate = new Map<string, (typeof musterRows)[number]>();
      for (const mr of musterRows) {
        if (mr.isPrimary && !primaryByCandidate.has(mr.candidateId)) {
          primaryByCandidate.set(mr.candidateId, mr);
        }
      }
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const byName = new Map<string, (typeof musterRows)[number]>();
      const byCode = new Map<string, (typeof musterRows)[number]>();
      for (const mr of primaryByCandidate.values()) {
        byName.set(norm(mr.emp.full_name), mr);
        if (mr.emp.employee_code) byCode.set(norm(String(mr.emp.employee_code)), mr);
      }

      // Locate the Designation column on the header row so we can route each
      // row to a (candidate, designation) pair instead of always the primary.
      const headerRow = aoa[headerRowIdx] || [];
      let designationCol = -1;
      for (let c = 0; c < headerRow.length; c++) {
        const h = norm(String(headerRow[c] ?? ""));
        if (!h) continue;
        if (h.includes("designation") || h.includes("department")) {
          designationCol = c;
          break;
        }
      }
      const contractDesigByNorm = new Map(
        contractDesignations.map((d) => [norm(d.designationName), d]),
      );
      // Letter-sorted key catches single-letter transpositions/typos like
      // "OPREATOR" vs "OPERATOR" (same letters, different order) without
      // doing broad fuzzy matching across unrelated designations.
      const sortLetters = (s: string) => s.split("").sort().join("");
      const contractDesigBySorted = new Map<string, (typeof contractDesignations)[number]>();
      for (const d of contractDesignations) {
        const key = sortLetters(norm(d.designationName));
        if (!contractDesigBySorted.has(key)) contractDesigBySorted.set(key, d);
      }
      const fuzzyDesigMatch = (n: string) => {
        const exact = contractDesigByNorm.get(n);
        if (exact) return exact;
        return contractDesigBySorted.get(sortLetters(n));
      };

      const codeSet = new Map<string, string>();
      for (const c of codes) codeSet.set(c.code.toUpperCase(), c.code);

      const byPair = new Map<
        string,
        {
          mr: (typeof musterRows)[number];
          rows: Array<{ entry_date: string; code: string; ot_hours: number }>;
        }
      >();
      const unmatchedNames: string[] = [];
      const designationsNotOnContract = new Set<string>();
      const candidatesInSheet = new Set<string>();
      let secondaryDesigRowCount = 0;
      let filled = 0;
      // Rows whose person is not yet on this unit's muster. They are resolved
      // (matched by employee code / name, created when missing, then mapped to
      // this unit) after the sheet is read — uploading never asks the user to
      // map a resource first.
      const pendingPeople: Array<{
        label: string;
        tokens: string[];
        designationId: string | null;
        designationName: string | null;
        isReliever: boolean;
        rows: Array<{ entry_date: string; code: string; ot_hours: number }>;
      }> = [];

      const parseSheetRowCells = (row: Array<unknown>) => {
        const out: Array<{ entry_date: string; code: string; ot_hours: number }> = [];
        for (const h of headerDates) {
          if (h.date > todayStr) continue;
          const raw = row[h.col];
          if (raw == null || String(raw).trim() === "") continue;
          // Accept "P", "D ,1", "P ,0.5", "ED ,1", "W ,1" etc.
          const cell = String(raw).trim().toUpperCase();
          const m = cell.match(/^([A-Z]+)(?:\s*,?\s*(\d+(?:\.\d+)?))?$/);
          if (!m) continue;
          // FPL muster shorthand: "D" / "ED" mean Duty / Extra-Duty — both are a
          // PRESENT day, with the trailing number being OT days for that date.
          // Re-map to canonical "P" so payroll counts them as present.
          let codeKey = m[1];
          if (codeKey === "D" || codeKey === "ED") codeKey = "P";
          const canonical = codeSet.get(codeKey);
          if (!canonical) continue;
          const ot = m[2] ? Number(m[2]) : 0;
          out.push({
            entry_date: h.date,
            code: canonical,
            ot_hours: Number.isFinite(ot) ? ot : 0,
          });
        }
        return out;
      };


      for (let r = headerRowIdx + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        if (!row.some((v) => v != null && String(v).trim() !== "")) continue;

        let mr: (typeof musterRows)[number] | undefined;
        let labelCell = "";
        for (let c = 0; c < Math.min(row.length, 6); c++) {
          const v = row[c];
          if (v == null) continue;
          const s = String(v).trim();
          if (!s) continue;
          if (!labelCell) labelCell = s;
          const n = norm(s);
          if (!n) continue;
          if (byCode.has(n)) {
            mr = byCode.get(n);
            break;
          }
          if (byName.has(n)) {
            mr = byName.get(n);
            break;
          }
        }
        if (!mr) {
          const joined = norm(
            row
              .slice(0, 4)
              .map((v) => (v == null ? "" : String(v)))
              .join(" "),
          );
          if (joined) {
            for (const [k, m] of byName.entries()) {
              if (k && (joined.includes(k) || k.includes(joined))) {
                mr = m;
                break;
              }
            }
          }
        }
        if (!mr) {
          // Not on the muster yet — keep the row and resolve the person below.
          const sheetRows = parseSheetRowCells(row);
          const tokens = row
            .slice(0, 6)
            .map((v) => (v == null ? "" : String(v).trim()))
            .filter((s) => s.length > 0 && s.length <= 80);
          let pendingDesigId: string | null = null;
          let pendingDesigName: string | null = null;
          if (designationCol >= 0) {
            const desigCell = norm(String(row[designationCol] ?? ""));
            const match = desigCell ? fuzzyDesigMatch(desigCell) : null;
            if (match) {
              pendingDesigId = match.designationId;
              pendingDesigName = match.designationName;
            } else if (desigCell) {
              designationsNotOnContract.add(String(row[designationCol]).trim());
            }
          }
          if (!pendingDesigId && contractDesignations.length === 1) {
            pendingDesigId = contractDesignations[0].designationId;
            pendingDesigName = contractDesignations[0].designationName;
          }
          if (sheetRows.length && tokens.length) {
            pendingPeople.push({
              label: labelCell,
              tokens,
              designationId: pendingDesigId,
              designationName: pendingDesigName,
              // Only an explicit reliever marking on the sheet row makes this
              // person a reliever; everyone else is mapped to this unit.
              isReliever: looksLikeRelieverText(
                ...tokens,
                designationCol >= 0 ? String(row[designationCol] ?? "") : null,
              ),
              rows: sheetRows,
            });
          } else if (labelCell) {
            unmatchedNames.push(labelCell);
          }
          continue;
        }
        candidatesInSheet.add(mr.candidateId);

        // Designation routing: if the sheet has a designation column and the
        // value matches a contract resource on this unit, save under that
        // designation. The auto-create row block already kicks in when
        // musterRows re-derives from the new entries.
        let targetDesignationId: string | null = mr.designationId;
        let targetDesignationName: string = mr.designationName;
        let isSecondary = false;
        if (designationCol >= 0) {
          const desigCell = norm(String(row[designationCol] ?? ""));
          if (desigCell) {
            const match = fuzzyDesigMatch(desigCell);
            if (match) {
              if (match.designationId !== mr.designationId) {
                targetDesignationId = match.designationId;
                targetDesignationName = match.designationName;
                isSecondary = true;
              }
            } else {
              designationsNotOnContract.add(String(row[designationCol]).trim());
            }
          }
        }

        const rows = parseSheetRowCells(row);
        if (rows.length) {
          const key = `${mr.candidateId}|${targetDesignationId ?? ""}`;
          const bucket = byPair.get(key);
          // Synthetic mr clone so upsert uses the routed designation, not the primary.
          const routedMr = isSecondary
            ? {
                ...mr,
                key,
                designationId: targetDesignationId,
                designationName: targetDesignationName,
                isPrimary: false,
              }
            : mr;
          if (bucket) {
            bucket.rows.push(...rows);
          } else {
            byPair.set(key, { mr: routedMr, rows });
          }
          if (isSecondary) secondaryDesigRowCount += 1;
          filled += rows.length;
        }
      }

      // Auto-resolve everyone on the sheet who is not on the muster yet: match
      // by employee code (or an unambiguous name), create the employee when
      // there is no record, and map them to this unit.
      const autoPairs: Array<{
        candidateId: string;
        designationId: string | null;
        isReliever: boolean;
        rows: Array<{ entry_date: string; code: string; ot_hours: number }>;
      }> = [];
      let autoCreated = 0;
      let autoMapped = 0;
      if (pendingPeople.length) {
        const { data: authUser } = await supabase.auth.getUser();
        const createdBy = authUser.user?.id ?? null;
        for (const person of pendingPeople) {
          try {
            const resolved = await resolveSheetPersonForUnit({
              unitId,
              contractId: contractInfo?.contractId ?? null,
              ref: {
                codeTokens: person.tokens,
                nameTokens: person.tokens,
                designationId: person.designationId,
                designationName: person.designationName,
                isReliever: person.isReliever,
              },
              joiningDate: periodStart,
              createdBy,
            });
            if (!resolved) {
              if (person.label) unmatchedNames.push(person.label);
              continue;
            }
            if (resolved.created) autoCreated += 1;
            else if (resolved.mapped) autoMapped += 1;
            candidatesInSheet.add(resolved.candidateId);
            const existing = autoPairs.find(
              (p) =>
                p.candidateId === resolved.candidateId &&
                (p.designationId ?? "") === (resolved.designationId ?? ""),
            );
            if (existing) existing.rows.push(...person.rows);
            else
              autoPairs.push({
                candidateId: resolved.candidateId,
                designationId: resolved.designationId,
                isReliever: resolved.isReliever,
                rows: person.rows,
              });
            filled += person.rows.length;
          } catch {
            if (person.label) unmatchedNames.push(person.label);
          }
        }
      }

      // Sheet-authoritative: wipe every prior entry in this period for any
      // candidate present in the uploaded sheet (across all designations),
      // then write only what the sheet shows.
      let clearedStale = 0;
      if (candidatesInSheet.size) {
        const { error, count } = await supabase
          .from("attendance_entries")
          .delete({ count: "exact" })
          .eq("unit_id", unitId)
          .in("candidate_id", Array.from(candidatesInSheet))
          .gte("entry_date", periodStart)
          .lte("entry_date", periodEnd);
        if (error) throw error;
        clearedStale = count ?? 0;
      }

      for (const { mr, rows } of byPair.values()) {
        const mapping = await ensureAttendanceUnitMapping(
          mr.candidateId,
          unitId,
          mr.designationId,
          mr.reliever === true,
        );
        await upsertEntries(
          mr.candidateId,
          mr.designationId,
          rowsForAttendanceRole(rows, mapping.isReliever),
        );
      }
      for (const pair of autoPairs) {
        await upsertEntries(
          pair.candidateId,
          pair.designationId,
          rowsForAttendanceRole(pair.rows, pair.isReliever),
        );
      }
      await queryClient.invalidateQueries({ queryKey: entriesQK });
      // Mapping and designation changes must appear on the muster immediately.
      await queryClient.invalidateQueries({ queryKey: ["attendance-roster-v5", unitId] });

      if (designationsNotOnContract.size) {
        toast.warning(
          `Skipped designation routing for ${Array.from(designationsNotOnContract).slice(0, 6).join(", ")} — not on this unit's active contract. Saved under each person's primary designation. Add to contract and re-import to split.`,
          { duration: 8000 },
        );
      }

      const summary = `${filled} cell${filled === 1 ? "" : "s"} imported from ${uploadFile.name}${autoMapped ? ` · mapped ${autoMapped} employee${autoMapped === 1 ? "" : "s"} to this unit` : ""}${autoCreated ? ` · created ${autoCreated} new employee${autoCreated === 1 ? "" : "s"}` : ""}${clearedStale ? ` · cleared ${clearedStale} stale entr${clearedStale === 1 ? "y" : "ies"}` : ""}${secondaryDesigRowCount ? ` · ${secondaryDesigRowCount} row${secondaryDesigRowCount === 1 ? "" : "s"} on secondary designation` : ""}${unmatchedNames.length ? ` · ${unmatchedNames.length} unmatched row${unmatchedNames.length === 1 ? "" : "s"}` : ""}${designationsNotOnContract.size ? ` · ${designationsNotOnContract.size} designation${designationsNotOnContract.size === 1 ? "" : "s"} not on contract` : ""}`;
      setOcrSummary(summary);
      setUploadReadyToContinue(true);
      toast.success(summary);
      await endScanProgress({ summary }, startedAt);
      logActivity({
        module: "Attendance",
        action: "Upload attendance Excel",
        details: {
          filled,
          clearedStale,
          candidates: Array.from(candidatesInSheet),
          unmatched: unmatchedNames.length,
          secondaryDesigRowCount,
          notOnContract: Array.from(designationsNotOnContract),
          unit_id: unitId,
          file: uploadFile.name,
        },
      }).catch(() => {});
    } catch (e) {
      const message = e instanceof Error ? e.message : "Excel import failed";
      toast.error(message);
      await endScanProgress({ error: message }, startedAt);
    } finally {
      setProcessingOcr(false);
    }
  };

  const processUpload = () => {
    if (uploadReadyToContinue) {
      setUploadOpen(false);
      return;
    }
    if (uploadKind === "excel") return processAttendanceExcel();
    return processAttendanceImages();
  };

  // Photos captured with the camera scanner start reading on their own, so the
  // progress bar appears immediately after "Use this scan".
  useEffect(() => {
    if (!autoReadRef.current) return;
    if (!uploadOpen || processingOcr || preparingScan || !uploadImages.length) return;
    autoReadRef.current = false;
    void processAttendanceImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen, uploadImages, processingOcr, preparingScan]);

  const cellKey = (rowKey: string, date: string) => `${rowKey}|${date}`;
  const splitCellKey = (k: string) => {
    const i = k.lastIndexOf("|");
    return { rowKey: k.slice(0, i), date: k.slice(i + 1) };
  };
  type MusterRowT = (typeof musterRows)[number];
  const attCellBlocked = (mr: MusterRowT, date: string) =>
    date > todayStr ||
    (typeof mr.emp.doj === "string" && date < mr.emp.doj) ||
    Boolean(mr.vacant) ||
    Boolean(mr.otOnly) ||
    Boolean(mr.reliever);
  const otCellBlocked = (mr: MusterRowT, date: string) =>
    date > todayStr || (typeof mr.emp.doj === "string" && date < mr.emp.doj) || Boolean(mr.vacant);

  /** Rectangular selection between two cells — spans rows and days. */
  const buildRect = (
    anchor: CellRef,
    cur: CellRef,
    blocked: (mr: MusterRowT, date: string) => boolean,
  ) => {
    const rowIdx = new Map(visibleMusterRows.map((r, i) => [r.key, i]));
    const r1 = rowIdx.get(anchor.rowKey);
    const r2 = rowIdx.get(cur.rowKey);
    const d1 = periodCells.findIndex((c) => c.date === anchor.date);
    const d2 = periodCells.findIndex((c) => c.date === cur.date);
    const out = new Set<string>();
    if (r1 == null || r2 == null || d1 < 0 || d2 < 0) {
      out.add(cellKey(cur.rowKey, cur.date));
      return out;
    }
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r += 1) {
      const mr = visibleMusterRows[r];
      if (!mr) continue;
      for (let d = Math.min(d1, d2); d <= Math.max(d1, d2); d += 1) {
        const date = periodCells[d]?.date;
        if (!date || blocked(mr, date)) continue;
        out.add(cellKey(mr.key, date));
      }
    }
    return out;
  };

  useEffect(() => {
    if (!isDragging) return;
    const onUp = () => {
      setIsDragging(false);
      setSelectedCells((current) => {
        if (current.size > 0) {
          setPickerCells(Array.from(current).sort());
          setPickerOpen(true);
          setSelAnchor(null);
          return new Set();
        }
        return current;
      });
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [isDragging]);

  useEffect(() => {
    if (!isOtDragging) return;
    const onUp = () => {
      setIsOtDragging(false);
      setOtSelectedCells((current) => {
        if (current.size > 0) {
          setOtPickerCells(Array.from(current).sort());
          setOtPickerOpen(true);
          setOtSelAnchor(null);
          return new Set();
        }
        return current;
      });
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [isOtDragging]);

  const openPickerForSelection = () => {
    if (selectedCells.size === 0) return;
    setPickerCells(Array.from(selectedCells).sort());
    setPickerOpen(true);
  };

  const openOtPickerForSelection = () => {
    if (otSelectedCells.size === 0) return;
    setOtPickerCells(Array.from(otSelectedCells).sort());
    setOtPickerOpen(true);
  };

  const clearSelection = () => {
    setSelectedCells(new Set());
    setSelAnchor(null);
  };
  const clearOtSelection = () => {
    setOtSelectedCells(new Set());
    setOtSelAnchor(null);
  };

  const findRow = (k: string | null) => musterRows.find((r) => r.key === k);

  /** Group a flat list of cell keys into { rowKey → dates[] }. */
  const groupCells = (cells: string[]) => {
    const map = new Map<string, string[]>();
    for (const c of cells) {
      const { rowKey, date } = splitCellKey(c);
      const list = map.get(rowKey) ?? [];
      list.push(date);
      map.set(rowKey, list);
    }
    return map;
  };

  const selectionLabel = (cells: string[]) => {
    const grouped = groupCells(cells);
    if (grouped.size === 1) {
      const row = findRow(Array.from(grouped.keys())[0] ?? null);
      return row ? `${row.emp.full_name ?? ""} — ${row.designationName ?? ""}` : "";
    }
    return `${grouped.size} employees`;
  };

  // Contractual shift length for a muster row (8h / 12h) — never hard-coded,
  // it comes from the unit's active contract resource line.
  const rowShiftHours = (k: string | null) => {
    const row = findRow(k);
    return shiftHoursFor(shiftMap, unitId, row?.designationId ?? null);
  };

  const applyCodeToCells = async (
    cells: string[],
    code: string,
    preserveMobileSelection = false,
  ) => {
    const grouped = groupCells(cells);
    if (grouped.size === 0) return;
    try {
      let applied = 0;
      let blocked = 0;
      for (const [rowKey, dates] of grouped) {
        const row = findRow(rowKey);
        if (!row) continue;
        // Reliever / extra-designation lines are Extra Duty only — they can
        // never carry a regular attendance code.
        if (row.otOnly || row.reliever) {
          blocked += dates.length;
          continue;
        }
        const rows = dates.map((d) => ({
          entry_date: d,
          code,
          ot_hours: entryMap.get(`${row.key}|${d}`)?.ot_hours ?? 0,
        }));
        applied += await upsertEntries(row.candidateId, row.designationId, rows);
      }
      if (blocked > 0) {
        toast.error("Reliever lines are Extra Duty only — mark ED hours on the ED row instead");
      }

      await queryClient.invalidateQueries({ queryKey: entriesQK });
      setPickerOpen(false);
      setSelectedCells(new Set());
      if (!preserveMobileSelection) setMobileSelectedRows(new Set());
      setSelAnchor(null);
      if (applied > 0) {
        toast.success(`Applied ${code || "Clear"} to ${applied} cell${applied > 1 ? "s" : ""}`);
      }
    } catch (e) {
      toast.error(saveErrorMessage(e));
    }
  };

  const applyCodeToSelection = async (code: string) => applyCodeToCells(pickerCells, code);

  // `hours` is ED in clock hours (0.5 – 16). It is stored as ED *days*,
  // converted with each row's contractual shift length (8h or 12h).
  // Keep 4 decimals so 1h on an 8h shift (0.125 d) round-trips back to exactly 1h.
  const applyOtToSelection = async (hours: number) => {
    const grouped = groupCells(otPickerCells);
    if (grouped.size === 0) return;
    try {
      let count = 0;
      for (const [rowKey, dates] of grouped) {
        const row = findRow(rowKey);
        if (!row) continue;
        const shift = shiftHoursFor(shiftMap, unitId, row.designationId ?? null);
        const otDays = Math.round((hours / shift) * 10000) / 10000;

        const rows = dates.map((d) => ({
          entry_date: d,
          code: entryMap.get(`${row.key}|${d}`)?.code ?? "",
          ot_hours: otDays,
        }));
        await upsertEntries(row.candidateId, row.designationId, rows);
        count += dates.length;
      }
      await queryClient.invalidateQueries({ queryKey: entriesQK });
      setOtPickerOpen(false);
      setOtSelectedCells(new Set());
      setOtSelAnchor(null);
      toast.success(
        hours > 0
          ? `Set ${hours}h ED on ${count} cell${count > 1 ? "s" : ""}`
          : `Cleared ED on ${count} cell${count > 1 ? "s" : ""}`,
      );
    } catch (e) {
      toast.error(saveErrorMessage(e));
    }
  };

  // edOnlyLine = reliever / extra-designation line: it earns extra duty only and
  // must not receive a second public-holiday credit for the same employee/unit.
  const computeTotalsForRow = (rk: string, edOnlyLine = false, joiningDate?: string | null) => {
    let pDays = 0;
    let otDaysSum = 0;
    let phCount = 0;
    let unitPhDays = 0;
    let otherPaidDays = 0;
    for (const cell of periodCells) {
      const e = entryMap.get(`${rk}|${cell.date}`);
      if (!e) continue;
      otDaysSum += Number(e.ot_hours) || 0;
      const c = codeMap.get(e.code);
      if (!c) continue;
      // Unit-level public holiday credit: granted on the listed holiday whether
      // the employee worked (P + PH) or was absent (A + PH).
      if (
        phEnabled &&
        !edOnlyLine &&
        e.code !== "PH" &&
        holidayByDate.has(cell.date) &&
        (!joiningDate || cell.date >= joiningDate)
      ) {
        unitPhDays += phMultiplier;
      }

      if (e.code === "PH") {
        // Unit setting first, else the PH day value from Attendance Code settings.
        const phValue =
          unitPhDayValue != null
            ? unitPhDayValue
            : c.day_value == null || Number.isNaN(Number(c.day_value))
              ? 1
              : Number(c.day_value);
        phCount += phValue;
        continue;
      }
      // Weekly off is not a payable duty — it must never inflate the payable total.
      if (e.code === "WO" || e.code === "W") continue;
      const dayValue =
        c.day_value == null || Number.isNaN(Number(c.day_value)) ? 1 : Number(c.day_value);
      if (c.counts_as_present) pDays += dayValue;
      else if (c.is_paid) otherPaidDays += dayValue;
    }
    const phDays = Math.round((phCount + unitPhDays) * 100) / 100;
    const otDays = Math.round(otDaysSum * 100) / 100;
    // OT cell value is OT-days; expose under both names for display compat.
    const otHours = otDays;
    const tDays = pDays + phDays + otDays;
    return { pDays, otHours, otDays, phDays, tDays };
  };

  const principalEmployer = unit
    ? `${unit.customer_name || ""}${unit.code ? ` - ${unit.code}` : ""}`.trim()
    : "—";
  const principalAddress = unit
    ? [
        unit.shipping_address1 || unit.billing_address1 || unit.location,
        unit.shipping_address2 || unit.billing_address2,
        [
          unit.shipping_city || unit.billing_city,
          unit.shipping_district || unit.billing_district,
          unit.shipping_state || unit.billing_state,
          unit.shipping_pincode || unit.billing_pincode,
        ]
          .filter(Boolean)
          .join(", "),
      ]
        .filter((v) => v && String(v).trim())
        .join(", ")
    : "";

  const monthLabel = `${MONTH_NAMES[monthIdx]} ${year}`;
  const formatPretty = (iso: string) => {
    const [yy, mm, dd] = iso.split("-").map(Number);
    return `${String(dd).padStart(2, "0")} ${MONTH_NAMES[mm - 1].slice(0, 3)} ${yy}`;
  };
  const periodLabel =
    periodCells.length > 0
      ? `${formatPretty(periodStart)} – ${formatPretty(periodEnd)}`
      : monthLabel;
  const windowLabel = payrollWindow?.label
    ? `Payroll window: ${payrollWindow.label}`
    : "Payroll window: full calendar month";

  // "Add line item" UI state
  const [addCand, setAddCand] = useState<string>("");
  const [addDesig, setAddDesig] = useState<string>("");
  const handleAddLineItem = () => {
    if (!addCand || !addDesig) {
      toast.error("Pick both an employee and a designation");
      return;
    }
    const k = rowKey(addCand, addDesig);
    if (musterRows.some((r) => r.key === k)) {
      toast.info("That line item already exists");
      return;
    }
    setExtraRows((prev) => new Set(prev).add(k));
    setManualRosterIds((prev) => new Set(prev).add(addCand));
    const empName = (rosterEmployees ?? []).find((e) => e.id === addCand)?.full_name ?? "";
    const dName =
      contractDesignations.find((d) => d.designationId === addDesig)?.designationName ?? "";
    toast.success(`Added row: ${empName} — ${dName}`);
    setAddCand("");
    setAddDesig("");
  };

  return (
    <div className="space-y-3 px-0 py-2 sm:space-y-4 sm:px-6 sm:py-6">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          #form-xvi-print, #form-xvi-print * { visibility: visible !important; }
          #form-xvi-print {
            position: absolute !important;
            left: 0; top: 0;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: 0 !important;
          }
        }
      `}</style>
      <div className="mobile-glass-surface rounded-xl border border-border/60 bg-card/80 p-2.5 shadow-sm sm:rounded-2xl sm:p-4 print:hidden">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
          <Link
            to="/admin/attendance"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 sm:flex sm:gap-2">
            <Select value={String(monthIdx)} onValueChange={(v) => setMonthIdx(Number(v))}>
              <SelectTrigger className="h-10 min-w-0 w-full rounded-xl text-sm sm:w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => {
                  if (contractStartDate) {
                    const [sy, sm] = contractStartDate.split("-").map(Number);
                    if (year < sy || (year === sy && i < sm - 1)) return null;
                  }
                  if (
                    year > now.getFullYear() ||
                    (year === now.getFullYear() && i > now.getMonth())
                  )
                    return null;
                  return (
                    <SelectItem key={m} value={String(i)}>
                      {m}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-10 w-[84px] rounded-xl text-sm sm:w-[86px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[year - 2, year - 1, year, year + 1].map((y) => {
                  if (contractStartDate) {
                    const sy = Number(contractStartDate.split("-")[0]);
                    if (y < sy) return null;
                  }
                  if (y > now.getFullYear()) return null;
                  return (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 min-w-0 truncate px-1 text-sm font-medium text-foreground sm:hidden">
          {unit?.name || unit?.code || "Attendance"}
          {unit?.customer_name ? (
            <span className="text-muted-foreground"> · {unit.customer_name}</span>
          ) : null}
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:mt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <Button
            onClick={() => {
              setUploadOpen(true);
            }}
            disabled={!editable}
            title={editable ? "Upload an attendance sheet image to auto-fill" : "Sheet locked"}
            className="h-10 min-w-0 rounded-xl px-3 text-sm shadow-sm"
          >
            <Upload className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">Upload Attendance</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => window.print()}
            title="Print"
            className="hidden h-10 w-10 shrink-0 rounded-xl sm:inline-flex"
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled
            title="Export (coming soon)"
            className="hidden h-10 w-10 shrink-0 rounded-xl sm:inline-flex"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleClearAll}
            disabled={!editable || clearingAll}
            title={editable ? "Delete every attendance entry on this sheet" : "Sheet locked"}
            className="h-10 w-10 shrink-0 rounded-xl text-destructive hover:text-destructive"
          >
            {clearingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Upload Attendance dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          if (!o && skipUploadResetRef.current) {
            skipUploadResetRef.current = false;
            setUploadOpen(false);
            return;
          }
          setUploadOpen(o);
          if (!o) {
            setUploadFile(null);
            setUploadPreview(null);
            setUploadImages([]);
            setUploadKind(null);
            setOcrSummary(null);
            setUploadReadyToContinue(false);
            setScanStep(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload attendance sheet</DialogTitle>
            <DialogDescription>
              Photos (several at once), Excel or CSV. Unclear cells are left blank and marked in
              red.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*,.xlsx,.xls,.xlsm,.csv,.ods"
              className="hidden"
              onChange={(e) => onPickUploadFiles(Array.from(e.target.files ?? []))}
            />
            {!uploadFile ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-sm text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Upload className="h-6 w-6" />
                  <span>Upload images or Excel</span>
                  <span className="text-xs">
                    Select several photos at once · PNG, JPG, HEIC · XLSX, XLS, CSV
                  </span>
                </button>
                <Button variant="outline" className="w-full" onClick={openCameraScan}>
                  <Camera className="mr-1.5 h-4 w-4" /> Scan with camera
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Every photo is automatically straightened, cropped to the sheet and sharpened
                  before it is read.
                </p>
              </div>
            ) : uploadKind === "image" && uploadPreview ? (
              <div className="space-y-2">
                {preparingScan ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning and cleaning the
                    photos…
                  </div>
                ) : null}
                {uploadImages.length > 1 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {uploadImages.map((img, i) => (
                      <div
                        key={`${img.name}-${i}`}
                        className="overflow-hidden rounded-lg border border-border bg-muted/20"
                      >
                        <img
                          src={useCleaned ? img.dataUrl : img.originalDataUrl}
                          alt={img.name}
                          className="h-28 w-full object-cover"
                        />
                        <div className="truncate px-2 py-1 text-[10px] text-muted-foreground">
                          {i + 1}. {img.name}
                        </div>
                        {img.quality ? (
                          <div
                            className={cn(
                              "border-t px-2 py-1 text-[10px]",
                              qualityTone(img.quality.verdict),
                            )}
                          >
                            {img.quality.verdict === "good" ? "Clear" : img.quality.hint}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                    <img
                      src={
                        useCleaned
                          ? (uploadImages[0]?.dataUrl ?? uploadPreview)
                          : (uploadImages[0]?.originalDataUrl ?? uploadPreview)
                      }
                      alt="Attendance preview"
                      className="max-h-80 w-full object-contain"
                    />
                  </div>
                )}
                {uploadImages[0]?.quality && uploadImages.length === 1 ? (
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2 text-xs",
                      qualityTone(uploadImages[0]!.quality!.verdict),
                    )}
                  >
                    {uploadImages[0]!.cropped
                      ? "Sheet detected, straightened and cleaned. "
                      : "Cleaned — sheet edges were not detected. "}
                    {uploadImages[0]!.quality!.verdict === "good"
                      ? "Quality looks good."
                      : `${uploadImages[0]!.quality!.hint}. Retake for a more accurate read.`}
                  </div>
                ) : null}
                {uploadImages.length ? (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={useCleaned}
                      onChange={(e) => setUseCleaned(e.target.checked)}
                    />
                    Use the cleaned scan (uncheck to read the original photo)
                  </label>
                ) : null}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5" />
                    {uploadImages.length > 1
                      ? `${uploadImages.length} photos selected`
                      : uploadFile.name}
                  </span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={openCameraScan}
                    >
                      Scan with camera
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => uploadInputRef.current?.click()}
                    >
                      Choose different files
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-6">
                  <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{uploadFile.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Excel/CSV · matched by employee name or code · dates from header row
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    Choose a different file
                  </button>
                </div>
              </div>
            )}
            {processingOcr && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {scanStep && scanStep.total > 1
                      ? `Reading photo ${scanStep.index} of ${scanStep.total} · ${Math.round(scanPct)}%`
                      : `Reading ${Math.round(scanPct)}%`}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatRemaining(scanRemaining)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700"
                    style={{ width: `${Math.max(2, Math.min(100, scanPct))}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  You can close this window — reading continues and the progress shows on the
                  attendance list.
                </p>
              </div>
            )}
            {ocrSummary && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {ocrSummary}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Codes: {codes.map((c) => c.code).join(", ") || "—"} · {periodStart} → {periodEnd}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setUploadOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={processUpload}
              disabled={(!uploadFile && !uploadReadyToContinue) || processingOcr || preparingScan}
              className={cn(
                uploadReadyToContinue &&
                  !processingOcr &&
                  "bg-primary text-primary-foreground opacity-100 hover:bg-primary/90",
              )}
            >
              {processingOcr ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {Math.round(scanPct)}% ·{" "}
                  {formatRemaining(scanRemaining)}
                </>
              ) : uploadReadyToContinue ? (
                "Continue"
              ) : uploadKind === "excel" ? (
                "Import"
              ) : uploadImages.length > 1 ? (
                `Read ${uploadImages.length} sheets`
              ) : (
                "Read sheet"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentScanCamera
        open={cameraOpen}
        onOpenChange={(o) => {
          setCameraOpen(o);
          // Cancelling the camera must bring the upload dialog back, never drop
          // the person on the attendance screen with nothing to do.
          if (!o) setUploadOpen(true);
        }}
        onCapture={onCameraCapture}
      />

      {/* Approval workflow */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border/60 bg-card p-2.5 sm:flex sm:flex-wrap sm:justify-between sm:gap-3 sm:p-3 print:hidden">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:gap-3">
          <span className="hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:inline">
            Status
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              status === "draft" && "bg-slate-100 text-slate-700",
              status === "submitted" && "bg-amber-100 text-amber-800",
              status === "approved" && "bg-emerald-100 text-emerald-800",
              status === "rejected" && "bg-rose-100 text-rose-800",
            )}
          >
            {status === "draft" && "Draft"}
            {status === "submitted" && "Submitted — awaiting approval"}
            {status === "approved" && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {payrollProcessed ? "Approved — payroll processed" : "Approved"}
              </>
            )}

            {status === "rejected" && (
              <>
                <XCircle className="h-3.5 w-3.5" /> Rejected
              </>
            )}
          </span>
          {currentVersion > 1 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-800">
              <HistoryIcon className="h-3.5 w-3.5" /> Version {currentVersion}
              {amendmentOpen && " — amendment open"}
              {amendmentSubmitted && " — awaiting approval"}
              {amendmentApproved && " — approved, pending payroll"}
              {amendment === "processed" && " — payroll posted"}
            </span>
          )}

          {status === "rejected" && sheet?.rejection_reason && (
            <span className="text-xs text-rose-700">Reason: {sheet.rejection_reason}</span>
          )}
          {status === "rejected" && sheet?.review_proof_url && (
            <button
              type="button"
              className="text-xs font-semibold text-rose-700 underline underline-offset-2"
              onClick={async () => {
                const { data, error } = await supabase.storage
                  .from("attendance-review-proofs")
                  .createSignedUrl(sheet.review_proof_url as string, 300);
                if (error || !data?.signedUrl) {
                  toast.error("Could not open proof image");
                  return;
                }
                window.open(data.signedUrl, "_blank", "noopener,noreferrer");
              }}
            >
              View HR proof image
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {(status === "draft" || status === "rejected") && (
            <Button
              size="sm"
              onClick={() => transitionSheet.mutate({ status: "submitted" })}
              disabled={transitionSheet.isPending}
            >
              <Send className="mr-1.5 h-4 w-4" /> Submit for Approval
            </Button>
          )}
          {status === "submitted" && canApprove && (
            <>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => transitionSheet.mutate({ status: "approved" })}
                disabled={transitionSheet.isPending}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={transitionSheet.isPending}
              >
                <XCircle className="mr-1.5 h-4 w-4" /> Reject
              </Button>
            </>
          )}
          {status === "submitted" && !canApprove && (
            <span className="text-xs text-muted-foreground">Awaiting approver action</span>
          )}
          {status === "approved" &&
            canApprove &&
            !payrollProcessed &&
            !amendmentActive &&
            !sentToPayroll && (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved — payroll &amp; invoice updated
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => transitionSheet.mutate({ status: "draft" })}
                  disabled={transitionSheet.isPending}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen
                </Button>
              </>
            )}
          {status === "approved" &&
            canApprove &&
            !payrollProcessed &&
            !amendmentActive &&
            sentToPayroll && (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved — payroll &amp; invoice updated
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reopenAfterHandoff.mutate()}
                  disabled={reopenAfterHandoff.isPending || transitionSheet.isPending}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Reopen
                </Button>
              </>
            )}

          {/* Payroll already paid this period — amend instead of reopen. */}
          {status === "approved" && payrollProcessed && !amendmentActive && canApprove && (
            <Button size="sm" variant="outline" onClick={() => setAmendOpen(true)}>
              <GitCompare className="mr-1.5 h-4 w-4" /> Amend attendance (v{currentVersion + 1})
            </Button>
          )}
          {amendmentOpen && (
            <Button
              size="sm"
              onClick={() => moveAmendment.mutate("submitted")}
              disabled={moveAmendment.isPending || amendmentDiff.length === 0}
            >
              <Send className="mr-1.5 h-4 w-4" /> Submit v{currentVersion} for approval
            </Button>
          )}
          {amendmentSubmitted && canApprove && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => moveAmendment.mutate("approved")}
              disabled={moveAmendment.isPending}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve v{currentVersion}
            </Button>
          )}
          {amendmentSubmitted && !canApprove && (
            <span className="text-xs text-muted-foreground">
              Amendment awaiting approver action
            </span>
          )}
          {amendmentApproved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Approved — process the payroll difference
            </span>
          )}
        </div>
      </div>

      {!editable && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          <span className="sm:hidden">
            {status === "approved" ? "Approved and locked." : "Submitted and locked."}
          </span>
          <span className="hidden sm:inline">
            This attendance sheet is {status === "approved" ? "approved" : "submitted"} and locked
            for editing.{" "}
          </span>{" "}
          <span className="hidden sm:inline">
            {status === "submitted"
              ? "Reject it to allow further edits."
              : payrollProcessed
                ? "Payroll for this period is processed — start an amendment to correct it; the paid sheet is kept as a version."
                : "Reopen it to make changes."}
          </span>
        </div>
      )}
      {status === "submitted" && canApprove && (
        <div className="rounded-md border border-sky-300/60 bg-sky-50 px-3 py-2 text-xs text-sky-800 print:hidden">
          You can edit this attendance in place, or reject with a note so the submitter can fix it.
        </div>
      )}
      {amendmentActive && (
        <div className="rounded-md border border-indigo-300/60 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 print:hidden">
          <b>Amendment version {currentVersion}.</b>{" "}
          {amendmentOpen
            ? "Edit the muster roll below. Version " +
              (currentVersion - 1) +
              " stays archived exactly as it was paid. Submit once the corrections are in."
            : amendmentSubmitted
              ? "Submitted for approval. Approving it unlocks the payroll difference."
              : "Approved. Open Payroll for this unit and process the difference — only affected employees get an arrears or recovery line."}
          {previousVersion?.reason ? <> Reason: {previousVersion.reason}</> : null}
        </div>
      )}

      {/* Version history + change log */}
      {(versions.length > 0 || amendmentActive) && (
        <div className="rounded-xl border border-border/60 bg-card p-2.5 print:hidden sm:p-3">
          <div className="mb-2 flex items-center gap-2">
            <HistoryIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Muster roll versions
            </span>
          </div>
          <div className="scrollbar-hide flex gap-2 overflow-x-auto text-xs">
            {versions.map((v) => (
              <span key={v.id} className="rounded-full border border-border/60 px-2.5 py-1">
                v{v.version} · archived {new Date(v.created_at).toLocaleDateString()} ·{" "}
                {v.snapshot?.length ?? 0} entries
              </span>
            ))}
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
              v{currentVersion} · live
            </span>
          </div>

          {previousVersion && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-semibold text-foreground">
                Changes in v{currentVersion} vs v{previousVersion.version}
              </div>
              {amendmentDiff.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No changes yet — edit a cell to record an amendment.
                </p>
              ) : (
                <div className="max-h-48 overflow-auto rounded-lg border border-border/60 sm:max-h-64">
                  <table className="min-w-[360px] w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold">Employee</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                        <th className="px-2 py-1.5 text-left font-semibold">
                          v{previousVersion.version}
                        </th>
                        <th className="px-2 py-1.5 text-left font-semibold">v{currentVersion}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {amendmentDiff.map((d) => {
                        const row = musterRows.find((r) => r.candidateId === d.candidateId);
                        const label = row
                          ? `${row.emp.employee_code || "—"} · ${row.emp.full_name}`
                          : d.candidateId.slice(0, 8);
                        return (
                          <tr
                            key={`${d.candidateId}-${d.date}-${d.designationId ?? ""}`}
                            className="border-t border-border/50"
                          >
                            <td className="px-2 py-1.5">{label}</td>
                            <td className="px-2 py-1.5">{d.date}</td>
                            <td className="px-2 py-1.5 text-rose-700">
                              {d.beforeCode || "—"}
                              {d.beforeEd ? ` +${d.beforeEd} ED` : ""}
                            </td>
                            <td className="px-2 py-1.5 font-semibold text-emerald-700">
                              {d.afterCode || "—"}
                              {d.afterEd ? ` +${d.afterEd} ED` : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={amendOpen}
        onOpenChange={(o) => {
          setAmendOpen(o);
          if (!o) setAmendReason("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Amend approved attendance</DialogTitle>
            <DialogDescription>
              Payroll for this period is already processed. The current muster roll will be archived
              as version {currentVersion} and a new editable version {currentVersion + 1} will open.
              Nothing that was already paid is deleted — payroll will later post only the difference
              for affected employees.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={amendReason}
            onChange={(e) => setAmendReason(e.target.value)}
            rows={3}
            placeholder="Why is this being amended? (e.g. EMP-192 was paid for 26 days but was absent on 12 July)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAmendOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => startAmendment.mutate()} disabled={startAmendment.isPending}>
              {startAmendment.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <GitCompare className="mr-1.5 h-4 w-4" />
              )}
              Start version {currentVersion + 1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onOpenChange={(o) => {
          setRejectOpen(o);
          if (!o) {
            setRejectReason("");
            setRejectProof(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject attendance</DialogTitle>
            <DialogDescription>
              Give a clear reason and optionally attach a proof image (photo of physical register,
              WhatsApp screenshot, etc.).
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (min 5 characters)…"
            rows={4}
          />
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Proof image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setRejectProof(e.target.files?.[0] ?? null)}
              className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-secondary/80"
            />
            {rejectProof && (
              <div className="text-[11px] text-muted-foreground">
                {rejectProof.name} ({Math.round(rejectProof.size / 1024)} KB)
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setRejectOpen(false)}
              disabled={uploadingProof || transitionSheet.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={uploadingProof || transitionSheet.isPending}
              onClick={() => {
                if (rejectReason.trim().length < 5) {
                  toast.error("Reason must be at least 5 characters");
                  return;
                }
                transitionSheet.mutate(
                  { status: "rejected", reason: rejectReason.trim(), proofFile: rejectProof },
                  {
                    onSuccess: () => {
                      setRejectOpen(false);
                      setRejectReason("");
                      setRejectProof(null);
                    },
                  },
                );
              }}
            >
              {uploadingProof || transitionSheet.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Rejecting…
                </>
              ) : (
                "Reject"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-2 print:hidden">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 rounded-md border border-border/70 bg-card px-3 py-2 sm:basis-auto sm:min-w-[260px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={musterQuery}
            onChange={(e) => setMusterQuery(e.target.value)}
            placeholder="Search employees…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {musterQuery && (
            <button
              type="button"
              onClick={() => setMusterQuery("")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
          {musterQuery && (
            <span className="text-[11px] text-muted-foreground">
              {visibleMusterRows.length}/{musterRows.length}
            </span>
          )}
        </div>
        <div className="hidden rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:block">
          Click or drag to mark attendance. Add another role below when needed.
        </div>
      </div>

      {/* Add line item panel */}
      <div className="hidden rounded-xl border border-border/70 bg-card p-3 print:hidden sm:block">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Employee
            </label>
            <Select value={addCand} onValueChange={setAddCand}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                {(rosterEmployees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name || e.employee_code || e.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Additional designation
            </label>
            <Select value={addDesig} onValueChange={setAddDesig} disabled={!addCand}>
              <SelectTrigger className="w-full sm:w-[260px]">
                <SelectValue placeholder="Designation" />
              </SelectTrigger>
              <SelectContent>
                {contractDesignations.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No designations on this contract.
                  </div>
                ) : (
                  contractDesignations.map((d) => {
                    const used =
                      !!addCand &&
                      musterRows.some(
                        (r) => r.candidateId === addCand && r.designationId === d.designationId,
                      );
                    return (
                      <SelectItem key={d.designationId} value={d.designationId}>
                        {d.designationName}
                        {used ? " (already added)" : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={handleAddLineItem}
            disabled={!editable || !addCand || !addDesig}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add role
          </Button>
          <div className="ml-auto text-[11px] text-muted-foreground">
            {contractDesignations.length === 0
              ? "No contract resources mapped — add designations on the contract first."
              : `${contractDesignations.length} designation(s) on contract`}
          </div>
        </div>
      </div>

      {/* Phone muster: same employee-by-day model as Form XVI, condensed for touch. */}
      <section className="space-y-2 sm:hidden print:hidden" aria-label="Mobile attendance muster">
        <div className="mobile-glass-surface sticky top-1 z-30 space-y-2 rounded-xl border border-border/70 bg-card/90 p-2 shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <label className="relative min-w-0">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <select
                aria-label="Bulk attendance date"
                value={mobileDate}
                onChange={(event) => setMobileDate(event.target.value)}
                className="h-9 w-full appearance-none rounded-lg border border-primary/30 bg-primary/5 pl-8 pr-2 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"
              >
                {periodCells.map((cell) => (
                  <option key={cell.date} value={cell.date} disabled={cell.date > todayStr}>
                    {new Date(`${cell.date}T12:00:00`).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 shrink-0 px-2.5 text-xs"
              disabled={!editable}
              onClick={() => {
                const eligible = visibleMusterRows.filter(
                  (row) =>
                    !row.vacant &&
                    !row.otOnly &&
                    !row.reliever &&
                    (!row.emp.doj || mobileDate >= row.emp.doj),
                );
                setMobileSelectedRows((current) =>
                  current.size === eligible.length
                    ? new Set()
                    : new Set(eligible.map((row) => row.key)),
                );
              }}
            >
              {mobileSelectedRows.size > 0 ? `${mobileSelectedRows.size} selected` : "Select all"}
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/60 pt-2">
            <div className="scrollbar-hide flex min-w-0 gap-1 overflow-x-auto">
              {codes.map((code) => (
                <Button
                  key={code.id}
                  size="sm"
                  variant="outline"
                  className="h-8 min-w-9 shrink-0 rounded-lg px-2 text-xs font-medium"
                  disabled={!editable || mobileSelectedRows.size === 0}
                  title={
                    mobileSelectedRows.size === 0 ? "Select employees first" : `Apply ${code.label}`
                  }
                  onClick={() =>
                    applyCodeToCells(
                      Array.from(mobileSelectedRows, (row) => `${row}|${mobileDate}`),
                      code.code,
                      true,
                    )
                  }
                >
                  {code.code}
                </Button>
              ))}
            </div>
            {mobileSelectedRows.size > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                aria-label="Clear selected employees"
                onClick={() => setMobileSelectedRows(new Set())}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
          <div
            className="scrollbar-hide overflow-x-auto overscroll-x-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <table className="w-max min-w-full border-separate border-spacing-0 text-center text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 w-[176px] min-w-[176px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-foreground shadow-sm">
                    Employee
                  </th>
                  {periodCells.map((cell) => (
                    <th
                      key={cell.date}
                      className={cn(
                        "h-11 w-10 min-w-10 border-b border-r border-border bg-muted p-0 font-medium",
                        cell.date === mobileDate && "bg-primary/10 text-primary",
                        cell.date > todayStr && "text-muted-foreground/50",
                      )}
                    >
                      <span className="block text-[9px] uppercase leading-none">
                        {MONTH_NAMES[cell.monthIdx]?.slice(0, 3)}
                      </span>
                      <span className="mt-1 block text-xs leading-none">{cell.dayNum}</span>
                    </th>
                  ))}
                  <th className="h-11 w-12 min-w-12 border-b border-border bg-muted px-1 font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={dayCount + 2} className="p-6 text-muted-foreground">
                      Loading employees…
                    </td>
                  </tr>
                ) : visibleMusterRows.length === 0 ? (
                  <tr>
                    <td colSpan={dayCount + 2} className="p-6 text-muted-foreground">
                      No employees found.
                    </td>
                  </tr>
                ) : (
                  visibleMusterRows.map((mr) => {
                    if (mr.vacant) {
                      return (
                        <tr key={mr.key}>
                          <td className="sticky left-0 z-20 w-[176px] min-w-[176px] border-b border-r border-border bg-card p-1.5 text-left shadow-sm">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto w-full justify-start px-1 py-1 text-left"
                              disabled={!editable}
                              onClick={() => {
                                setMapQuery("");
                                setMapSlot({
                                  designationId: mr.designationId,
                                  designationName: mr.designationName,
                                });
                              }}
                            >
                              <Plus className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 truncate">{mr.designationName}</span>
                            </Button>
                          </td>
                          <td
                            colSpan={dayCount + 1}
                            className="border-b border-border px-3 text-left text-[11px] text-muted-foreground"
                          >
                            Vacant deployment
                          </td>
                        </tr>
                      );
                    }
                    const totals = computeTotalsForRow(
                      mr.key,
                      Boolean(mr.otOnly) || Boolean(mr.reliever),
                      mr.emp.doj || null,
                    );
                    const selected = mobileSelectedRows.has(mr.key);
                    return [
                      <tr
                        key={`${mr.key}-mobile-att`}
                        className="bg-card"
                      >
                        <td
                          className={cn(
                            "sticky left-0 z-20 w-[176px] min-w-[176px] border-b border-r border-border bg-card px-2 py-1.5 text-left shadow-sm",
                            selected && "ring-2 ring-inset ring-primary/30",
                            !mr.otOnly && !mr.reliever && editable && "cursor-pointer",
                          )}
                          onClick={() => {
                            if (!editable || mr.otOnly || mr.reliever) return;
                            setMobileSelectedRows((current) => {
                              const next = new Set(current);
                              if (next.has(mr.key)) next.delete(mr.key);
                              else next.add(mr.key);
                              return next;
                            });
                          }}
                        >
                          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5">
                            {!mr.otOnly && !mr.reliever ? (
                              <Checkbox
                                checked={selected}
                                aria-label={`Select ${mr.emp.full_name}`}
                                onClick={(event) => event.stopPropagation()}
                                onCheckedChange={(checked) =>
                                  setMobileSelectedRows((current) => {
                                    const next = new Set(current);
                                    if (checked) next.add(mr.key);
                                    else next.delete(mr.key);
                                    return next;
                                  })
                                }
                              />
                            ) : (
                              <Clock3 className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div className="min-w-0 overflow-hidden px-1 py-1">
                              <div className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-tight text-foreground">
                                {mr.emp.full_name || "Unnamed"}
                              </div>
                              <div className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[9px] leading-tight text-muted-foreground">
                                {mr.emp.employee_code || "No ID"} · {mr.designationName}
                              </div>
                            </div>
                          </div>
                        </td>
                        {periodCells.map((cell) => {
                          const date = cell.date;
                          const beforeDoj = Boolean(mr.emp.doj) && date < mr.emp.doj;
                          const edOnly = Boolean(mr.otOnly) || Boolean(mr.reliever);
                          const blocked = !editable || date > todayStr || beforeDoj || edOnly;
                          const entry = entryMap.get(`${mr.key}|${date}`);
                          const displayCode = edOnly ? "" : entry?.code || (!blocked ? "A" : "");
                          const codeMeta = displayCode ? codeMap.get(displayCode) : undefined;
                          return (
                            <td
                              key={date}
                              className={cn(
                                "border-b border-r border-border p-0",
                                date === mobileDate && "bg-primary/5",
                              )}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                className={cn(
                                  "h-11 w-10 min-w-10 rounded-none p-0 text-xs font-medium",
                                  !entry?.code && displayCode === "A" && "text-muted-foreground",
                                )}
                                disabled={blocked}
                                aria-label={`${mr.emp.full_name}, ${date}: ${displayCode || "not marked"}`}
                                title={
                                  blocked
                                    ? beforeDoj
                                      ? "Before joining date"
                                      : edOnly
                                        ? "Extra Duty only"
                                        : "Not editable"
                                    : `${date} · ${codeMeta?.label || displayCode}`
                                }
                                style={{ color: codeMeta?.color }}
                                onClick={() => {
                                  setMobileDate(date);
                                  setPickerCells([`${mr.key}|${date}`]);
                                  setPickerOpen(true);
                                }}
                              >
                                {displayCode}
                              </Button>
                            </td>
                          );
                        })}
                        <td className="border-b border-border px-1 font-medium text-foreground">
                          {totals.tDays}
                        </td>
                      </tr>,
                      <tr key={`${mr.key}-mobile-ed`} className="bg-muted/25">
                        <td className="sticky left-0 z-20 w-[176px] min-w-[176px] border-b border-r border-border bg-card px-3 py-1 text-left text-[9px] font-medium text-muted-foreground shadow-sm">
                          Extra Duty
                        </td>
                        {periodCells.map((cell) => {
                          const beforeDoj = Boolean(mr.emp.doj) && cell.date < mr.emp.doj;
                          const blocked = !editable || cell.date > todayStr || beforeDoj;
                          const entry = entryMap.get(`${mr.key}|${cell.date}`);
                          const rowShift = shiftHoursFor(
                            shiftMap,
                            unitId,
                            mr.designationId ?? null,
                          );
                          const hours =
                            Math.round((Number(entry?.ot_hours) || 0) * rowShift * 4) / 4;
                          return (
                            <td
                              key={cell.date}
                              className={cn(
                                "border-b border-r border-border p-0",
                                hours > 0 && "bg-secondary",
                              )}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 w-10 min-w-10 rounded-none p-0 text-[10px] font-medium text-secondary-foreground"
                                disabled={blocked}
                                aria-label={`${mr.emp.full_name}, ${cell.date}: ${hours || 0} Extra Duty hours`}
                                onClick={() => {
                                  setMobileDate(cell.date);
                                  setOtPickerCells([`${mr.key}|${cell.date}`]);
                                  setOtPickerOpen(true);
                                }}
                              >
                                {hours > 0 ? `${hours}h` : "·"}
                              </Button>
                            </td>
                          );
                        })}
                        <td className="border-b border-border px-1 text-[10px] font-medium">
                          {Math.round(
                            totals.otDays *
                              shiftHoursFor(shiftMap, unitId, mr.designationId ?? null) *
                              4,
                          ) / 4}
                          h
                        </td>
                      </tr>,
                    ];
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedCells.size > 0 && !isDragging && (
        <div className="sticky top-2 z-20 hidden items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm shadow-sm sm:flex print:hidden">
          <div>
            <span className="font-semibold">{selectedCells.size}</span> cell
            {selectedCells.size > 1 ? "s" : ""} selected for{" "}
            <span className="font-semibold">{selectionLabel(Array.from(selectedCells))}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
            <Button size="sm" onClick={openPickerForSelection}>
              Apply attendance
            </Button>
          </div>
        </div>
      )}

      {otSelectedCells.size > 0 && !isOtDragging && (
        <div className="sticky top-2 z-20 hidden items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm shadow-sm sm:flex print:hidden">
          <div>
            <span className="font-semibold">{otSelectedCells.size}</span> ED cell
            {otSelectedCells.size > 1 ? "s" : ""} selected for{" "}
            <span className="font-semibold">{selectionLabel(Array.from(otSelectedCells))}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearOtSelection}>
              Clear
            </Button>
            <Button size="sm" onClick={openOtPickerForSelection}>
              Set ED hours
            </Button>
          </div>
        </div>
      )}

      {/* Muster Roll Sheet */}
      <div
        id="form-xvi-print"
        className="hidden rounded-xl border border-border/60 bg-white p-3 text-[11px] text-slate-900 shadow-sm print:block print:rounded-none print:border-0 print:shadow-none sm:block sm:p-6"
      >
        <div className="text-center">
          <div className="text-base font-bold">Form XVI</div>
          <div className="text-[10px] italic">[ See Rule 78 (1) (a) (i) ]</div>
          <div className="mt-1 text-sm font-bold tracking-wide">MUSTER ROLL</div>
        </div>

        {/* Mobile: stacked meta cards to prevent overflow */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:hidden">
          <div className="rounded-md border border-slate-300 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Service Provider
            </div>
            <div className="mt-1 font-bold break-words">{SERVICE_PROVIDER.name}</div>
            <div className="text-slate-700 break-words">{SERVICE_PROVIDER.address}</div>
          </div>
          <div className="rounded-md border border-slate-300 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Principal Employer
            </div>
            <div className="mt-1 font-bold break-words">{principalEmployer || "—"}</div>
            {principalAddress && (
              <div className="text-slate-700 break-words">{principalAddress}</div>
            )}
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Month
            </div>
            <div className="font-semibold">{monthLabel}</div>
            <div className="text-slate-700 break-words">Period: {periodLabel}</div>
            <div className="text-[10px] text-slate-500 break-words">{windowLabel}</div>
          </div>
        </div>
        {/* Tablet/desktop: original two-column table */}
        <table className="mt-3 hidden w-full border border-slate-400 text-[11px] sm:table">
          <tbody>
            <tr>
              <td className="w-1/2 border border-slate-400 p-2 align-top">
                <div className="font-semibold">Name And Address Of Service Provider :</div>
                <div className="mt-1 font-bold">{SERVICE_PROVIDER.name}</div>
                <div className="text-slate-700">{SERVICE_PROVIDER.address}</div>
              </td>
              <td className="w-1/2 border border-slate-400 p-2 align-top">
                <div className="font-semibold">Name and Address of Principal Employer :</div>
                <div className="mt-1 font-bold">{principalEmployer || "—"}</div>
                {principalAddress && <div className="text-slate-700">{principalAddress}</div>}
                <div className="mt-3 font-semibold">For the month of {monthLabel}</div>
                <div className="text-slate-700">Period: {periodLabel}</div>
                <div className="text-[10px] text-slate-500">{windowLabel}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:hidden">
          Swipe horizontally to view all days →
        </div>
        <div
          className="mt-2 -mx-3 min-w-0 w-full overflow-x-auto overscroll-x-contain rounded-md border border-slate-300 sm:mx-0 sm:rounded-none sm:border-0"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <table className="w-full min-w-[900px] border-collapse border border-slate-400 text-center text-[10px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="border border-slate-400 p-1 align-middle">
                  Sl.
                  <br />
                  No.
                </th>
                <th className="border border-slate-400 p-1 align-middle">Emp ID</th>
                <th className="border border-slate-400 p-1 text-left align-middle">
                  Employee Name
                </th>
                <th className="border border-slate-400 p-1 text-left align-middle">Designation</th>
                <th className="border border-slate-400 p-1 align-middle">DOJ</th>
                <th className="border border-slate-400 p-1 align-middle" colSpan={dayCount}>
                  Days
                </th>
                <th className="border border-slate-400 p-1 align-middle" rowSpan={2}>
                  P<br />
                  Days
                </th>
                <th className="border border-slate-400 p-1 align-middle">
                  ED
                  <br />
                  Days
                </th>
                <th className="border border-slate-400 p-1 align-middle" rowSpan={2}>
                  PH
                  <br />
                  Days
                </th>
                <th
                  className="border border-slate-400 p-1 align-middle"
                  rowSpan={2}
                  title="Total paid days = P + ED + PH"
                >
                  Total
                  <br />
                  Paid
                  <br />
                  Days
                </th>
              </tr>
              <tr className="bg-slate-50">
                <th className="border border-slate-400 p-1"></th>
                <th className="border border-slate-400 p-1"></th>
                <th className="border border-slate-400 p-1"></th>
                <th className="border border-slate-400 p-1"></th>
                <th className="border border-slate-400 p-1"></th>
                {periodCells.map((cell) => {
                  const isMonthBoundary = cell.dayNum === 1 || cell === periodCells[0];
                  const isFuture = cell.date > todayStr;
                  return (
                    <th
                      key={cell.date}
                      className={cn(
                        "border border-slate-400 p-0.5 text-[9px] font-medium",
                        isMonthBoundary && "border-l-2 border-l-slate-600",
                        isFuture && "bg-slate-200 text-slate-400",
                      )}
                      style={{ minWidth: 18 }}
                      title={cell.date + (isFuture ? " (future)" : "")}
                    >
                      {isMonthBoundary && (
                        <div className="text-[7px] font-bold uppercase leading-none text-slate-600">
                          {MONTH_NAMES[cell.monthIdx]?.slice(0, 3)}
                        </div>
                      )}
                      {cell.dayNum}
                    </th>
                  );
                })}
                <th className="border border-slate-400 p-1 text-[9px] font-medium">
                  ED
                  <br />
                  Hrs
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9 + dayCount} className="p-4 text-slate-500">
                    Loading roster…
                  </td>
                </tr>
              ) : rosterError ? (
                <tr>
                  <td colSpan={9 + dayCount} className="p-6 text-red-600">
                    Failed to load mapped employees for this unit.
                  </td>
                </tr>
              ) : musterRows.length === 0 ? (
                <tr>
                  <td colSpan={9 + dayCount} className="p-6 text-slate-500">
                    No active security guards are mapped to this unit.
                  </td>
                </tr>
              ) : visibleMusterRows.length === 0 ? (
                <tr>
                  <td colSpan={9 + dayCount} className="p-6 text-slate-500">
                    No rows match &ldquo;{musterQuery}&rdquo;.
                  </td>
                </tr>
              ) : (
                visibleMusterRows.flatMap((mr, idx) => {
                  const cellBase = "border border-slate-400 align-middle";
                  const totals = computeTotalsForRow(
                    mr.key,
                    Boolean(mr.otOnly) || Boolean(mr.reliever),
                    mr.emp.doj || null,
                  );
                  return [
                    <tr key={mr.key + "-att"}>
                      <td className={cn(cellBase, "p-1 font-medium")} rowSpan={2}>
                        {idx + 1}
                      </td>
                      <td className={cn(cellBase, "p-1")} rowSpan={2}>
                        {mr.emp.employee_code || "—"}
                      </td>
                      <td className={cn(cellBase, "p-1 text-left")} rowSpan={2}>
                        <div className="flex items-center gap-1.5">
                          {mr.vacant ? (
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => {
                                setMapQuery("");
                                setMapSlot({
                                  designationId: mr.designationId,
                                  designationName: mr.designationName,
                                });
                              }}
                              className="flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] italic text-slate-400 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              title={
                                mr.beyondAgreed
                                  ? "Agreed deployment is already filled — you can still deploy more (billing is on actuals)"
                                  : "Search and map an employee to this slot"
                              }
                            >
                              <Search className="h-3 w-3" />
                              {mr.beyondAgreed ? "Add deployment" : "Unassigned"}
                            </button>
                          ) : (
                            <span>{mr.emp.full_name || "—"}</span>
                          )}

                          {mr.reliever && !mr.vacant && (
                            <button
                              type="button"
                              title="Remove this reliever line and delete its attendance entries in this period"
                              disabled={!editable}
                              onClick={async () => {
                                if (!editable) return;
                                const hasEntries = entries.some(
                                  (e) =>
                                    e.candidate_id === mr.candidateId &&
                                    e.designation_id === mr.designationId,
                                );
                                if (
                                  !window.confirm(
                                    hasEntries
                                      ? `Remove reliever line "${mr.designationName}" for ${mr.emp.full_name}? This deletes attendance entries on this line for ${periodStart} → ${periodEnd}.`
                                      : `Remove reliever line "${mr.designationName}" for ${mr.emp.full_name} from this muster?`,
                                  )
                                ) {
                                  return;
                                }
                                try {
                                  if (hasEntries) {
                                    let q = supabase
                                      .from("attendance_entries")
                                      .delete()
                                      .eq("unit_id", unitId)
                                      .eq("candidate_id", mr.candidateId)
                                      .gte("entry_date", periodStart)
                                      .lte("entry_date", periodEnd);
                                    q = mr.designationId
                                      ? q.eq("designation_id", mr.designationId)
                                      : q.is("designation_id", null);
                                    const { error } = await q;
                                    if (error) throw error;
                                  }
                                  // A reliever who reached this muster through a
                                  // candidate_units link (their home unit is elsewhere)
                                  // is unmapped entirely when their last line goes.
                                  if (mr.isPrimary) {
                                    const { error: unlinkError } = await supabase
                                      .from("candidate_units")
                                      .delete()
                                      .eq("unit_id", unitId)
                                      .eq("candidate_id", mr.candidateId);
                                    if (unlinkError) throw unlinkError;
                                  }
                                  setExtraRows((prev) => {
                                    const next = new Set(prev);
                                    next.delete(mr.key);
                                    return next;
                                  });
                                  queryClient.invalidateQueries({ queryKey: entriesQK });
                                  queryClient.invalidateQueries({
                                    queryKey: ["attendance-roster-v5", unitId],
                                  });
                                  toast.success("Reliever line removed");
                                } catch (e) {
                                  toast.error(
                                    e instanceof Error ? e.message : "Failed to remove line",
                                  );
                                }
                              }}
                              className="rounded-full p-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-40 print:hidden"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}

                          {!mr.reliever && !mr.vacant && (
                            <button
                              type="button"
                              title="Remove this person from this unit's muster (their saved attendance is kept)"
                              disabled={!editable}
                              onClick={async () => {
                                if (!editable) return;
                                if (
                                  !window.confirm(
                                    `Remove ${mr.emp.full_name} from this unit's muster? Their saved attendance entries are kept, but they will no longer appear on this sheet.`,
                                  )
                                ) {
                                  return;
                                }
                                try {
                                  const { error: unlinkError } = await supabase
                                    .from("candidate_units")
                                    .delete()
                                    .eq("unit_id", unitId)
                                    .eq("candidate_id", mr.candidateId);
                                  if (unlinkError) throw unlinkError;
                                  // If this unit is their home unit, clear that too.
                                  const { error: homeError } = await supabase
                                    .from("candidates")
                                    .update({ unit_id: null })
                                    .eq("id", mr.candidateId)
                                    .eq("unit_id", unitId);
                                  if (homeError) throw homeError;
                                  const { error: scopeError } = await supabase
                                    .from("employee_scope_assignments")
                                    .delete()
                                    .eq("candidate_id", mr.candidateId)
                                    .eq("scope_type", "unit")
                                    .eq("scope_id", unitId);
                                  if (scopeError) throw scopeError;
                                  queryClient.invalidateQueries({
                                    queryKey: ["attendance-roster-v5", unitId],
                                  });
                                  toast.success(`${mr.emp.full_name} removed from this muster`);
                                } catch (e) {
                                  toast.error(
                                    e instanceof Error ? e.message : "Failed to remove person",
                                  );
                                }
                              }}
                              className="rounded-full p-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-40 print:hidden"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className={cn(cellBase, "p-1 text-left")} rowSpan={2}>
                        {mr.designationName || "—"}
                        {mr.reliever && !mr.vacant && (
                          <span
                            className="ml-1 font-semibold text-violet-700"
                            title="Reliever (stand-in) line — tracked as extra duty only"
                          >
                            (R)
                          </span>
                        )}
                      </td>

                      <td className={cn(cellBase, "p-1")} rowSpan={2}>
                        {mr.emp.doj ? new Date(mr.emp.doj).toLocaleDateString("en-GB") : "—"}
                      </td>
                      {periodCells.map((cell) => {
                        const date = cell.date;
                        const isFuture = date > todayStr;
                        const beforeDoj = Boolean(mr.emp.doj) && date < mr.emp.doj;
                        const entry = entryMap.get(`${mr.key}|${date}`);
                        // Reliever / extra-designation lines are extra-duty only:
                        // never editable, never an implicit "A".
                        const edOnlyLine = Boolean(mr.otOnly) || Boolean(mr.reliever);
                        const displayCode =
                          mr.vacant || edOnlyLine
                            ? ""
                            : entry?.code
                              ? entry.code
                              : !isFuture && !beforeDoj
                                ? "A"
                                : "";
                        const codeMeta = displayCode ? codeMap.get(displayCode) : undefined;
                        const isImplicitAbsent = !entry?.code && displayCode === "A";
                        const isSelected = selectedCells.has(`${mr.key}|${date}`);
                        const isUncertain = !entry?.code && uncertainCells.has(`${mr.key}|${date}`);
                        const isBlocked = isFuture || beforeDoj || Boolean(mr.vacant) || edOnlyLine;
                        return (
                          <td
                            key={`a-${cell.date}`}
                            className={cn(
                              cellBase,
                              "p-0 print:bg-transparent select-none",
                              isFuture && "bg-slate-100 cursor-not-allowed",
                              beforeDoj && "bg-slate-50 cursor-not-allowed",
                              edOnlyLine && "bg-violet-50/60 cursor-not-allowed",
                              !isBlocked && "cursor-pointer",
                              isSelected && "ring-2 ring-primary ring-inset",
                              isUncertain && "ring-2 ring-rose-500 ring-inset bg-rose-50",
                            )}
                            style={{
                              height: 22,
                              minWidth: 18,
                              backgroundColor: isBlocked
                                ? undefined
                                : codeMeta?.color
                                  ? `${codeMeta.color}22`
                                  : undefined,
                            }}
                            title={
                              edOnlyLine
                                ? "Reliever line — extra duty only. Use the ED row below."
                                : beforeDoj
                                  ? `Before joining date (${mr.emp.doj})`
                                  : isFuture
                                    ? "Future date — cannot mark attendance"
                                    : isUncertain
                                      ? "OCR could not read this cell — please mark manually"
                                      : isImplicitAbsent
                                        ? "No attendance recorded — treated as Absent"
                                        : undefined
                            }
                            onMouseDown={(e) => {
                              if (isBlocked) {
                                e.preventDefault();
                                return;
                              }
                              if (!editable) {
                                e.preventDefault();
                                return;
                              }
                              e.preventDefault();
                              const key = `${mr.key}|${date}`;
                              if (e.ctrlKey || e.metaKey) {
                                setSelectedCells((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                                setSelAnchor({ rowKey: mr.key, date });
                                return;
                              }
                              if (e.shiftKey && selAnchor) {
                                setSelectedCells(
                                  buildRect(selAnchor, { rowKey: mr.key, date }, attCellBlocked),
                                );
                                return;
                              }
                              setSelAnchor({ rowKey: mr.key, date });
                              setIsDragging(true);
                              setSelectedCells(new Set([key]));
                            }}
                            onMouseEnter={() => {
                              if (!isDragging || !selAnchor) return;
                              setSelectedCells(
                                buildRect(selAnchor, { rowKey: mr.key, date }, attCellBlocked),
                              );
                            }}
                            onClick={(e) => {
                              if (e.ctrlKey || e.metaKey) e.preventDefault();
                            }}
                          >
                            <div
                              className={cn(
                                "h-full w-full px-0 text-[10px] font-semibold leading-none flex items-center justify-center",
                                isImplicitAbsent && "opacity-60",
                              )}
                              style={{ color: codeMeta?.color }}
                            >
                              {displayCode}
                            </div>
                          </td>
                        );
                      })}

                      <td className={cn(cellBase, "p-1 font-semibold")} rowSpan={2}>
                        {totals.pDays}
                      </td>
                      <td className={cn(cellBase, "p-1 font-semibold")}>{totals.otHours}</td>
                      <td className={cn(cellBase, "p-1 font-semibold")} rowSpan={2}>
                        {totals.phDays}
                      </td>
                      <td className={cn(cellBase, "p-1 font-semibold")} rowSpan={2}>
                        {totals.tDays}
                      </td>
                    </tr>,
                    <tr key={mr.key + "-ot"}>
                      {periodCells.map((cell) => {
                        const date = cell.date;
                        const isFuture = date > todayStr;
                        const beforeDoj = Boolean(mr.emp.doj) && date < mr.emp.doj;
                        const isBlocked = isFuture || beforeDoj || Boolean(mr.vacant);
                        const entry = entryMap.get(`${mr.key}|${date}`);
                        const rowShift = shiftHoursFor(shiftMap, unitId, mr.designationId ?? null);
                        const otDaysCell = Number(entry?.ot_hours) || 0;
                        // Stored value is ED *days*; the grid shows clock hours.
                        // Snap to the nearest quarter hour so legacy rounded
                        // day-values (0.13 d) read as a clean 1h, not 1.04h.
                        const hrs = Math.round(otDaysCell * rowShift * 4) / 4;

                        const isSelected = otSelectedCells.has(`${mr.key}|${date}`);
                        return (
                          <td
                            key={`o-${cell.date}`}
                            className={cn(
                              cellBase,
                              "p-0 select-none transition-colors",
                              isFuture && "bg-slate-100 cursor-not-allowed",
                              beforeDoj && "bg-slate-50 cursor-not-allowed",
                              !isBlocked && "cursor-pointer",
                              hrs > 0 && !isBlocked && "bg-amber-50",
                              isSelected && "ring-2 ring-amber-500 ring-inset bg-amber-100",
                            )}
                            style={{ height: 22, minWidth: 18 }}
                            onMouseDown={(e) => {
                              if (isBlocked || !editable) {
                                e.preventDefault();
                                return;
                              }
                              e.preventDefault();
                              const key = `${mr.key}|${date}`;
                              if (e.ctrlKey || e.metaKey) {
                                setOtSelectedCells((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                                setOtSelAnchor({ rowKey: mr.key, date });
                                return;
                              }
                              if (e.shiftKey && otSelAnchor) {
                                setOtSelectedCells(
                                  buildRect(otSelAnchor, { rowKey: mr.key, date }, otCellBlocked),
                                );
                                return;
                              }
                              setOtSelAnchor({ rowKey: mr.key, date });
                              setIsOtDragging(true);
                              setOtSelectedCells(new Set([key]));
                            }}
                            onMouseEnter={() => {
                              if (!isOtDragging || !otSelAnchor) return;
                              setOtSelectedCells(
                                buildRect(otSelAnchor, { rowKey: mr.key, date }, otCellBlocked),
                              );
                            }}
                            onClick={(e) => {
                              if (e.ctrlKey || e.metaKey) e.preventDefault();
                            }}
                            title={
                              beforeDoj
                                ? `Before joining date (${mr.emp.doj})`
                                : isFuture
                                  ? "Future date — cannot mark extra duty"
                                  : `ED for ${date}${hrs > 0 ? ` · ${hrs}h` : ""}`
                            }
                          >
                            {(() => {
                              const showPh =
                                phEnabled &&
                                mr.isPrimary &&
                                holidayByDate.has(date) &&
                                Boolean(entry) &&
                                (!mr.emp.doj || date >= mr.emp.doj);
                              return (
                                <div className="flex h-full w-full flex-col items-center justify-center leading-none">
                                  {hrs > 0 && (
                                    <span className="text-[10px] font-semibold text-amber-700">
                                      {hrs}
                                    </span>
                                  )}
                                  {showPh && (
                                    <span className="pointer-events-none text-[8px] font-bold text-emerald-600">
                                      {phMultiplier > 1 ? `PH×${phMultiplier}` : "PH"}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        );
                      })}
                      <td className={cn(cellBase, "p-1 font-semibold")}>
                        {Math.round(
                          totals.otDays *
                            shiftHoursFor(shiftMap, unitId, mr.designationId ?? null) *
                            4,
                        ) / 4}
                      </td>
                    </tr>,
                  ];
                })
              )}
              {!isLoading &&
                !rosterError &&
                visibleMusterRows.length > 0 &&
                (() => {
                  const grand = visibleMusterRows.reduce(
                    (acc, mr) => {
                      const t = computeTotalsForRow(
                        mr.key,
                        Boolean(mr.otOnly) || Boolean(mr.reliever),
                        mr.emp.doj || null,
                      );
                      acc.pDays += t.pDays;
                      acc.otHours += t.otHours;
                      acc.phDays += t.phDays;
                      acc.tDays += t.tDays;
                      return acc;
                    },
                    { pDays: 0, otHours: 0, phDays: 0, tDays: 0 },
                  );
                  const r2 = (n: number) => Math.round(n * 100) / 100;
                  return (
                    <tr className="bg-slate-100 font-bold">
                      <td className="border border-slate-400 p-1 text-right" colSpan={5 + dayCount}>
                        Grand Total
                      </td>
                      <td className="border border-slate-400 p-1">{r2(grand.pDays)}</td>
                      <td className="border border-slate-400 p-1">{r2(grand.otHours)}</td>
                      <td className="border border-slate-400 p-1">{r2(grand.phDays)}</td>
                      <td className="border border-slate-400 p-1">{r2(grand.tDays)}</td>
                    </tr>
                  );
                })()}
            </tbody>
          </table>
        </div>

        <div className="mt-3 hidden text-[10px] text-slate-600 sm:block">
          Att = Attendance · ED row = Extra duty hours (converted to ED days at the contractual
          shift length) · Each (employee × designation) is a separate payroll line.
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="!max-w-none rounded-t-[24px] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:!max-w-sm sm:rounded-xl sm:p-6">
          <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
          <DialogHeader className="pt-1 sm:pt-0">
            <DialogTitle>Mark attendance</DialogTitle>
            <DialogDescription className="line-clamp-2 pr-2">
              {pickerCells.length} cell{pickerCells.length > 1 ? "s" : ""} selected
              {pickerCells.length ? ` for ${selectionLabel(pickerCells)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2">
            {codes.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="outline"
                onClick={() => applyCodeToSelection(c.code)}
                className="h-12 rounded-xl px-2 text-sm font-medium"
                style={{ color: c.color }}
                title={c.label}
              >
                {c.code}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyCodeToSelection("")}
            className="mt-1 h-10 w-full rounded-xl text-sm font-medium text-muted-foreground"
          >
            Clear selection
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(mapSlot)}
        onOpenChange={(o) => {
          if (!o) {
            setMapSlot(null);
            setMapQuery("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Map employee to slot</DialogTitle>
            <DialogDescription>
              Find an employee for{" "}
              <span className="font-medium">{mapSlot?.designationName ?? "—"}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={mapQuery}
              onChange={(e) => setMapQuery(e.target.value)}
              placeholder="Search employees…"
              className="h-10 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="max-h-[45vh] space-y-1 overflow-y-auto">
            {mapSearch.length < 2 ? (
              <p className="p-3 text-xs text-muted-foreground">Enter 2 or more characters.</p>
            ) : mapSearching ? (
              <p className="p-3 text-xs text-muted-foreground">Searching…</p>
            ) : (mapResults ?? []).length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No matching employees.</p>
            ) : (
              (mapResults ?? []).map((c) => {
                const already = rosterIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={already || mapSaving}
                    onClick={() => mapEmployeeToSlot(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition hover:border-primary hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.full_name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.employee_code} · {c.designation} · DOJ {c.doj || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-primary">
                      {already ? "On roster" : "Add"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={otPickerOpen} onOpenChange={setOtPickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set ED hours</DialogTitle>
            <DialogDescription>
              Choose ED hours. {otPickerCells.length} cell{otPickerCells.length > 1 ? "s" : ""}{" "}
              selected
              {otPickerCells.length ? ` for ${selectionLabel(otPickerCells)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[45vh] grid-cols-3 gap-2 overflow-y-auto pr-1 min-[380px]:grid-cols-4">
            {[0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => {
              const shift = rowShiftHours(
                otPickerCells[0] ? splitCellKey(otPickerCells[0]).rowKey : null,
              );
              const days = Math.round((n / shift) * 100) / 100;
              return (
                <Button
                  key={n}
                  type="button"
                  variant="outline"
                  onClick={() => applyOtToSelection(n)}
                  title={`${n}h = ${days} ED day${days === 1 ? "" : "s"}`}
                  className="h-11 rounded-lg bg-secondary px-2 text-sm font-medium leading-tight text-secondary-foreground"
                >
                  {n}h
                  <span className="block text-[9px] font-medium text-muted-foreground">
                    {days}d
                  </span>
                </Button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => applyOtToSelection(0)}
            className="mt-2 h-10 w-full rounded-lg text-sm font-medium text-muted-foreground"
          >
            Clear ED
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
