import { createFileRoute } from "@tanstack/react-router";
import { resolvePayrollDayCount } from "@/lib/payroll-days";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Copy,
  Download,
  Edit2,
  Eye,

  FileSignature,
  FileSpreadsheet,
  FileText,
  Flag,
  Plus,
  RefreshCcw,
  Search,
  ShieldAlert,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { ContractApprovalDialog, type ApprovalMode } from "@/components/ContractApprovalDialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";

import { useCurrentPermissions, fetchRoles, type RoleRow } from "@/lib/rbac";
import { notifyApprovers } from "@/lib/notifications";
import { csvDate, downloadCsv } from "@/lib/csv-export";
import {
  evaluateFormula,
  parseFormulaConfig,
  presetToExpression,
  slugifyVar,
  type FormulaContext,
} from "@/lib/formula-engine";

import { DeleteGuardButton } from "@/components/DeleteGuardButton";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { toast } from "sonner";
import { confirmAction, notifySaved } from "@/components/ConfirmProvider";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { GuidedForm, useGuidedFormCloseGuard, useGuidedFormDraft, type GuidedFormStep } from "@/components/GuidedForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fetchAllPages } from "@/lib/supabase-batch";
import { payrollPeriodForMonth } from "@/lib/payroll-period";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/contracts/client-contracts")({
  validateSearch: (search: Record<string, unknown>): { status?: string; tab?: "prospect" | "client"; renewals?: true; unit?: string } => ({
    status: typeof search.status === "string" ? search.status : undefined,
    tab: search.tab === "prospect" || search.tab === "client" ? search.tab : undefined,
    renewals: search.renewals === true || search.renewals === "true" ? true : undefined,
    unit: typeof search.unit === "string" ? search.unit : undefined,
  }),
  component: ClientContractsPage,
});


type GstOption = "csgst" | "igst" | "none";
type ContractStatus = "active" | "inactive" | "expired";
type ApprovalStatus = "pending" | "approved" | "rejected";
type RecordType = "prospect" | "client";
type ProspectStage =
  | "new"
  | "qualified"
  | "contract_sent"
  | "negotiation"
  | "closed"
  | "lost";
const PROSPECT_STAGES: { value: ProspectStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "contract_sent", label: "Contract Sent" },
  { value: "negotiation", label: "Negotiation" },
  { value: "closed", label: "Closed" },
  { value: "lost", label: "Lost" },
];
const PROSPECT_STAGE_LABEL: Record<ProspectStage, string> = Object.fromEntries(
  PROSPECT_STAGES.map((s) => [s.value, s.label]),
) as Record<ProspectStage, string>;

// ---------------------------------------------------------------------------
// Unified status nomenclature — one vocabulary for clients AND prospects.
// ---------------------------------------------------------------------------
type UnifiedStatus = "active" | "inactive" | "expired" | "pending_approval" | "lost";

const STATUS_OPTIONS: { value: UnifiedStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "lost", label: "Lost" },
];

const STATUS_LABEL: Record<UnifiedStatus, string> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label]),
) as Record<UnifiedStatus, string>;

function deriveStatus(c: {
  recordType: RecordType;
  status: ContractStatus;
  approvalStatus: ApprovalStatus;
  prospectStage: ProspectStage;
  endDate?: string;
}): UnifiedStatus {
  if (c.prospectStage === "lost") return "lost";
  if (c.recordType === "prospect") {
    if (c.approvalStatus === "pending") return "pending_approval";
    if (c.approvalStatus === "rejected") return "inactive";
  }
  if (c.status === "active" && c.endDate && c.endDate < new Date().toISOString().slice(0, 10)) return "expired";
  if (c.status === "expired") return "expired";
  if (c.status === "active") return "active";
  return "inactive";
}

type ClientContract = {
  id: string;
  contractCode: string;
  prospectCode: string;
  recordType: RecordType;
  unitId: string;
  startDate: string;
  endDate: string;
  expiryDate: string;
  originalStartDate: string;
  renewalCount: number;
  description: string;
  serviceTypeId: string | null;
  payrollWindowId: string | null;
  billingTypeId: string | null;
  
  gstOption: GstOption;
  status: ContractStatus;
  approvalStatus: ApprovalStatus;
  prospectStage: ProspectStage;
  rejectionReason: string;
  createdBy: string | null;
  promotedAt: string | null;
  unitName?: string;
  unitCode?: string;
  orgName?: string;
  orgId?: string;
  stateLabel?: string;
  cityLabel?: string;
};

// Add N months to an ISO yyyy-mm-dd date string. Returns "" on empty input.
function addMonthsISO(iso: string, months: number): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return "";
  const base = new Date(Date.UTC(y, m - 1, d));
  const targetMonth = base.getUTCMonth() + months;
  const target = new Date(Date.UTC(base.getUTCFullYear(), targetMonth, 1));
  // Clamp day to the last day of the target month
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// Number of whole months between two ISO dates (end - start). Negative if invalid.
function monthsBetweenISO(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const [sy, sm, sd] = startIso.split("-").map((n) => parseInt(n, 10));
  const [ey, em, ed] = endIso.split("-").map((n) => parseInt(n, 10));
  if (!sy || !ey) return 0;
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months -= 1;
  return months;
}

type ApprovalPickerValue = "approved" | "rejected" | "lost" | null;

type ServiceType = { id: string; name: string };
type PayrollWindow = {
  id: string;
  label: string;
  windowStartDay: number;
  windowEndDay: number;
  processingDay: number;
};
type BillingType = { id: string; name: string };
type EsicBranch = { id: string; esicCode: string; location: string };
type Designation = { id: string; name: string; code: string };
export type AllowanceType = {
  id: string;
  name: string;
  displayName: string;
  shortName: string;
  isDefault: boolean;
  calcType: "fixed" | "percentage";
  percentage: number;
  baseComponents: { label: string; operator: "+" | "-" }[];
  capAmount: number | null;
  includeInOt: boolean;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
  fixedCalcMethod?: "flat" | "per_duty";
  fixedDutyComponents?: ("p_days" | "ot_days" | "ph_days" | "other_paid_days")[];
  fixedDutyDivisor?: "base_days" | "days_in_month" | "payable_days" | "fixed_26";
};

export type ResourceComponent = {
  allowanceId: string;
  name: string;
  amount: number;
  calcType?: "fixed" | "percentage";
  includeInOt?: boolean;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
  fixedCalcMethod?: "flat" | "per_duty";
  fixedDutyComponents?: ("p_days" | "ot_days" | "ph_days" | "other_paid_days")[];
  fixedDutyDivisor?: "base_days" | "days_in_month" | "payable_days" | "fixed_26";
};

type FixedCalcMethod = "flat" | "per_duty";
type FixedDutyBucket = "p_days" | "ot_days" | "ph_days" | "other_paid_days";
type FixedDutyDivisor = "base_days" | "days_in_month" | "payable_days" | "fixed_26";

export type BenefitItem = {
  costComponentId: string;
  name: string;
  calcType: "percentage" | "fixed";
  percentage: number;
  baseComponents: { label: string; operator: "+" | "-" }[];
  capAmount: number | null;
  capFlatAmount: number | null;
  amount: number; // computed (percentage) or manual (fixed)
  state: string;
  deductionCalcType?: "earned_salary" | "fixed_amount";
  fixedCalcMethod?: FixedCalcMethod;
  fixedDutyComponents?: FixedDutyBucket[];
  fixedDutyDivisor?: FixedDutyDivisor;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
};


export type ContractResource = {
  id?: string;
  designationId: string;
  roleKey?: string | null;
  serviceTypeId: string;
  quantity: number;
  shiftHours: number;
  components: ResourceComponent[];
  payrollDayBaseId: string | null;
  billingDayBaseId: string | null;
  benefits: BenefitItem[];
  deductions: BenefitItem[];
  employerContributions: BenefitItem[];
};

function cloneBenefitItem(item: BenefitItem): BenefitItem {
  return {
    ...item,
    percentage: Number(item.percentage) || 0,
    amount: Number(item.amount) || 0,
    baseComponents: (item.baseComponents ?? []).map((b) => ({ ...b })),
    capAmount: item.capAmount == null ? null : Number(item.capAmount),
    capFlatAmount: item.capFlatAmount == null ? null : Number(item.capFlatAmount),
  };
}

function cloneContractResource(resource: ContractResource): ContractResource {
  return {
    id: resource.id,
    designationId: resource.designationId,
    roleKey: resource.roleKey ?? null,
    serviceTypeId: resource.serviceTypeId,
    quantity: Number(resource.quantity) || 1,
    shiftHours: Number(resource.shiftHours) === 12 ? 12 : 8,
    components: (resource.components ?? []).map((c) => ({
      ...c,
      amount: Number(c.amount) || 0,
    })),
    payrollDayBaseId: resource.payrollDayBaseId ?? null,
    billingDayBaseId: resource.billingDayBaseId ?? null,
    benefits: (resource.benefits ?? []).map(cloneBenefitItem),
    deductions: (resource.deductions ?? []).map(cloneBenefitItem),
    employerContributions: (resource.employerContributions ?? []).map(cloneBenefitItem),
  };
}

function serializeContractResources(resources: ContractResource[]): string {
  return JSON.stringify(resources.map(cloneContractResource));
}

export type PayrollDayBase = {
  id: string;
  name: string;
  code: string;
  method: "actual_days" | "fixed_days" | "actual_minus_weekly_off" | "custom_weekdays" | "fixed_annual_average";
  fixedDays: number | null;
  weeklyOffDay: number | null;
  includedWeekdays: number[] | null;
  enabled: boolean;
  sortOrder: number;
};

export type CostComponentOption = {
  id: string;
  name: string;
  code?: string;

  calcType: "percentage" | "fixed";
  percentage: number;
  baseComponents: { label: string; operator: "+" | "-" }[];
  capAmount: number | null;
  capFlatAmount: number | null;
  amount: number | null;
  state: string;
  description: string;
  party: "employee" | "employer" | "both";
  deductionCalcType: "earned_salary" | "fixed_amount";
  fixedCalcMethod: FixedCalcMethod;
  fixedDutyComponents: FixedDutyBucket[];
  fixedDutyDivisor: FixedDutyDivisor;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
};


const QK = ["admin", "client-contracts"] as const;
const QK_SVC = ["admin", "service-types", "enabled"] as const;
const QK_PAY = ["admin", "payroll-windows", "enabled"] as const;
const QK_BIL = ["admin", "billing-types", "enabled"] as const;
const QK_DSG = ["admin", "designations", "enabled"] as const;
const QK_ALW = ["admin", "allowance-types", "enabled"] as const;
const QK_PDB = ["admin", "payroll-day-bases", "enabled"] as const;
const QK_BDB = ["admin", "billing-day-bases", "enabled"] as const;
const QK_CC = ["admin", "cost-components", "enabled"] as const;
const QK_ESIC = ["admin", "esic-branches", "enabled"] as const;
const QK_CONTRACT_DIRECTORY = ["admin", "contract-directory"] as const;

type ContractDirectoryUnit = {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  contractStartDate: string;
  contractEndDate: string;
  panNumber: string;
  gstPayable: boolean;
  gstType: string;
  gstNumber: string;
};

type ContractDirectoryCustomer = { id: string; name: string };

function useContractDirectory(enabled = true) {
  const { data } = useQuery({
    queryKey: QK_CONTRACT_DIRECTORY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{
      units: ContractDirectoryUnit[];
      customers: ContractDirectoryCustomer[];
    }> => {
      const [unitRows, customerRows] = await Promise.all([
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from("units" as never)
            .select("id,code,name,customer_id,contract_start_date,contract_end_date,pan_number,gst_payable,gst_type,gst_number")
            .order("code", { ascending: true })
            .range(from, to),
        ),
        fetchAllPages<Record<string, unknown>>((from, to) =>
          supabase
            .from("customers" as never)
            .select("id,name")
            .order("name", { ascending: true })
            .range(from, to),
        ),
      ]);
      return {
        units: unitRows.map((row) => ({
          id: String(row.id),
          code: String(row.code ?? ""),
          name: String(row.name ?? ""),
          customerId: row.customer_id ? String(row.customer_id) : null,
          contractStartDate: row.contract_start_date ? String(row.contract_start_date) : "",
          contractEndDate: row.contract_end_date ? String(row.contract_end_date) : "",
          panNumber: String(row.pan_number ?? ""),
          gstPayable: Boolean(row.gst_payable),
          gstType: String(row.gst_type ?? ""),
          gstNumber: String(row.gst_number ?? ""),
        })),
        customers: customerRows.map((row) => ({
          id: String(row.id),
          name: String(row.name ?? ""),
        })),
      };
    },
  });
  return { units: data?.units ?? [], customers: data?.customers ?? [] };
}


function rowToContract(r: Record<string, unknown>): ClientContract {
  const unit = r.units && typeof r.units === "object" && !Array.isArray(r.units)
    ? (r.units as Record<string, unknown>)
    : null;
  const customer = unit?.customers && typeof unit.customers === "object" && !Array.isArray(unit.customers)
    ? (unit.customers as Record<string, unknown>)
    : null;
  return {
    id: String(r.id),
    contractCode: String(r.contract_code ?? ""),
    prospectCode: String(r.prospect_code ?? ""),
    recordType: (r.record_type as RecordType) ?? "prospect",
    unitId: String(r.unit_id ?? ""),
    startDate: r.start_date ? String(r.start_date) : "",
    endDate: r.end_date ? String(r.end_date) : "",
    expiryDate: r.expiry_date ? String(r.expiry_date) : "",
    originalStartDate: r.original_start_date ? String(r.original_start_date) : (r.start_date ? String(r.start_date) : ""),
    renewalCount: typeof r.renewal_count === "number" ? r.renewal_count : parseInt(String(r.renewal_count ?? "0"), 10) || 0,
    description: String(r.description ?? ""),
    serviceTypeId: r.service_type_id ? String(r.service_type_id) : null,
    payrollWindowId: r.payroll_window_id ? String(r.payroll_window_id) : null,
    billingTypeId: r.billing_type_id ? String(r.billing_type_id) : null,
    
    gstOption: (r.gst_option as GstOption) ?? "csgst",
    status: (r.status as ContractStatus) ?? "inactive",
    approvalStatus: (r.approval_status as ApprovalStatus) ?? "pending",
    prospectStage: (r.prospect_stage as ProspectStage) ?? "new",
    rejectionReason: String(r.rejection_reason ?? ""),
    createdBy: r.created_by ? String(r.created_by) : null,
    promotedAt: r.promoted_at ? String(r.promoted_at) : null,
    unitName: String(unit?.name ?? "—"),
    unitCode: String(unit?.code ?? ""),
    orgName: String(customer?.name ?? "—"),
    orgId: customer?.id ? String(customer.id) : "",
    stateLabel: String(unit?.billing_state ?? "").trim(),
    cityLabel: String(unit?.billing_city ?? "").trim(),
  };
}

function getApprovalPickerValue(contract: ClientContract | null): ApprovalPickerValue {
  if (!contract) return null;
  if (contract.prospectStage === "lost") return "lost";
  if (contract.approvalStatus === "approved") return "approved";
  if (contract.approvalStatus === "rejected") return "rejected";
  return null;
}

function applyApprovalPickerToPayload(
  payload: Omit<ClientContract, "id">,
  approvalValue: ApprovalPickerValue,
  current: ClientContract | null,
): Omit<ClientContract, "id"> {
  if (approvalValue === "approved") {
    return {
      ...payload,
      approvalStatus: "approved",
      status: "active",
      recordType: "client",
      prospectStage: "closed",
      rejectionReason: "",
    };
  }

  if (approvalValue === "rejected") {
    return {
      ...payload,
      approvalStatus: "rejected",
      status: "inactive",
      recordType: "prospect",
      prospectStage: current?.prospectStage === "lost" ? "new" : (current?.prospectStage ?? "new"),
    };
  }

  if (approvalValue === "lost") {
    return {
      ...payload,
      approvalStatus: "pending",
      status: "inactive",
      recordType: "prospect",
      prospectStage: "lost",
      rejectionReason: "",
    };
  }

  return payload;
}

function nextContractCode(existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = code.match(/CON(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `CON${String(max + 1).padStart(5, "0")}`;
}

/**
 * A unit may hold at most ONE active client contract at a time. Expired /
 * pending / lost contracts for the same unit are fine. Throws when another
 * active contract already exists for the unit.
 */
async function assertSingleActiveContract(unitId: string, excludeId?: string | null) {
  if (!unitId) return;
  let q = supabase
    .from("client_contracts" as never)
    .select("id, contract_code")
    .eq("unit_id", unitId)
    .eq("record_type", "client")
    .eq("status", "active");
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw error;
  const dup = ((data as unknown as Record<string, unknown>[]) ?? [])[0];
  if (dup) {
    throw new Error(
      `Client already has an active contract (${String(dup.contract_code ?? "—")}). Expire or end it before activating another one.`,
    );
  }
}


function nextProspectCode(existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = code?.match(/PROS-(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PROS-${String(max + 1).padStart(4, "0")}`;
}

function useContracts() {
  const qc = useQueryClient();
  const contractsQuery = useQuery({
    queryKey: QK,
    retry: false,
    queryFn: async (): Promise<ClientContract[]> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12_000);
      try {
        // Keep the register request flat. The former nested
        // contracts -> units -> customers relationship intermittently stalled
        // in PostgREST, leaving every organisation/client cell blank even
        // though the contract rows had arrived. A flat register read plus the
        // narrow directory RPC is deterministic and avoids full unit records.
        const [contractRows, directoryResult] = await Promise.all([
          fetchAllPages<Record<string, unknown>>((from, to) =>
            supabase
              .from("client_contracts" as never)
              .select("id,contract_code,prospect_code,record_type,prospect_stage,promoted_at,unit_id,start_date,end_date,expiry_date,original_start_date,renewal_count,description,service_type_id,payroll_window_id,billing_type_id,gst_option,status,approval_status,rejection_reason,created_by,created_at")
              .order("created_at", { ascending: false })
              .range(from, to)
              .abortSignal(controller.signal),
          ),
          supabase.rpc("contract_register_directory" as never).abortSignal(controller.signal),
        ]);
        if (directoryResult.error) throw directoryResult.error;
        const directoryRows = (directoryResult.data ?? []) as unknown as Record<string, unknown>[];
        const unitsById = new Map(directoryRows.map((row) => [String(row.unit_id), row]));
        return contractRows.map((row) => {
          const unit = unitsById.get(String(row.unit_id ?? ""));
          return rowToContract({
            ...row,
            units: unit ? {
              id: unit.unit_id,
              code: unit.unit_code,
              name: unit.unit_name,
              customer_id: unit.customer_id,
              billing_state: unit.unit_state ?? "",
              billing_city: unit.unit_city ?? "",
              customers: unit.customer_id ? { id: unit.customer_id, name: unit.customer_name } : null,
            } : null,
          });
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("Contracts took too long to load. Please try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    },
  });
  const items = contractsQuery.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: QK });
    qc.invalidateQueries({ queryKey: ["admin", "units"] });
    qc.invalidateQueries({ queryKey: QK_CONTRACT_DIRECTORY });
  };

  const syncUnitDates = async (unitId: string, startDate: string, endDate: string) => {
    if (!unitId) return;
    const patch: Record<string, unknown> = {
      contract_start_date: startDate || null,
      contract_end_date: endDate || null,
    };
    const { error } = await supabase
      .from("units" as never)
      .update(patch as never)
      .eq("id", unitId);
    if (error) console.warn("Failed to sync unit contract dates:", error.message);
  };

  type Payload = Omit<ClientContract, "id">;
  const toRow = (p: Payload, opts: { isNew: boolean }) => {
    const base: Record<string, unknown> = {
      unit_id: p.unitId,
      start_date: p.startDate || null,
      end_date: p.endDate || null,
      expiry_date: p.expiryDate || null,
      original_start_date: p.originalStartDate || p.startDate || null,
      renewal_count: p.renewalCount ?? 0,
      description: p.description.trim(),
      service_type_id: p.serviceTypeId,
      payroll_window_id: p.payrollWindowId,
      billing_type_id: p.billingTypeId,
      gst_option: p.gstOption,
    };
    if (opts.isNew) {
      // New entries are always prospects, inactive, pending approval.
      base.record_type = "prospect";
      base.prospect_code = p.prospectCode;
      base.status = "inactive";
      base.approval_status = "pending";
      base.prospect_stage = "new";
      // contract_code is intentionally null until promoted.
    }
    return base;
  };

  const addMut = useMutation({
    mutationFn: async (p: Payload): Promise<string> => {
      if (!p.unitId) throw new Error("Client is required");
      const uidRes = await supabase.auth.getUser();
      const insertRow = { ...toRow(p, { isNew: true }), created_by: uidRes.data.user?.id ?? null };
      const { data, error } = await supabase
        .from("client_contracts" as never)
        .insert(insertRow as never)
        .select("id")
        .single();
      if (error) throw error;
      const id = String((data as Record<string, unknown>).id);
      await syncUnitDates(p.unitId, p.startDate, p.endDate);
      void logActivity({ module: "Client Contracts", action: "create", entityType: "client_contracts", entityId: id, entityLabel: p.prospectCode, details: p as unknown as Record<string, unknown> });
      // Notify everyone with approve rights on contracts (fully RBAC-driven).
      void notifyApprovers({
        moduleKey: "contracts",
        type: "contract_pending_approval",
        title: `Prospect ${p.prospectCode} awaiting approval`,
        message: "A new prospect contract has been submitted and needs your sign-off.",
        link: "/admin/contracts/client-contracts",
        entityType: "client_contracts",
        entityId: id,
      });
      return id;
    },
    onSuccess: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: async ({
      id,
      p,
      canApproveApproval,
    }: {
      id: string;
      p: Payload;
      canApproveApproval: boolean;
    }) => {
      const beforeRes = await supabase
        .from("client_contracts" as never)
        .select(
          "contract_code,prospect_code,unit_id,start_date,end_date,expiry_date,description,service_type_id,payroll_window_id,billing_type_id,gst_option,status,record_type,approval_status,prospect_stage,rejection_reason,promoted_at,approved_by,approved_at",
        )
        .eq("id", id)
        .single();
      const before = (beforeRes.data ?? null) as Record<string, unknown> | null;
      const after = toRow(p, { isNew: false });

      const approvalChanged =
        String(before?.approval_status ?? "pending") !== p.approvalStatus ||
        String(before?.prospect_stage ?? "new") !== p.prospectStage ||
        String(before?.record_type ?? "prospect") !== p.recordType ||
        String(before?.status ?? "inactive") !== p.status;

      if (approvalChanged && !canApproveApproval) {
        throw new Error("You do not have permission to change approval.");
      }

      if (p.approvalStatus === "approved") {
        const unitId = p.unitId || String(before?.unit_id ?? "");
        await assertSingleActiveContract(unitId, id);


        let nextCode = p.contractCode || String(before?.contract_code ?? "");
        if (!nextCode) {
          const { data: codeRows, error: codeErr } = await supabase
            .from("client_contracts" as never)
            .select("contract_code")
            .not("contract_code", "is", null);
          if (codeErr) throw codeErr;
          const existing = ((codeRows as unknown as Record<string, unknown>[]) ?? [])
            .map((r) => String(r.contract_code ?? ""))
            .filter(Boolean);
          nextCode = nextContractCode(existing);
        }

        const uidRes = await supabase.auth.getUser();
        const uid = uidRes.data.user?.id ?? null;
        const nowIso = new Date().toISOString();
        // Editing an already-approved contract must not rewrite its original
        // approval trail — keep the first approver and timestamp intact.
        const wasApproved = String(before?.approval_status ?? "") === "approved";
        const approvedByRow = (before as Record<string, unknown> | null)?.["approved_by"];
        const approvedAtRow = (before as Record<string, unknown> | null)?.["approved_at"];

        Object.assign(after, {
          approval_status: "approved",
          approved_by: wasApproved && approvedByRow ? approvedByRow : uid,
          approved_at: wasApproved && approvedAtRow ? approvedAtRow : nowIso,
          status: "active",
          rejection_reason: "",
          rejected_by: null,
          rejected_at: null,
          record_type: "client",
          promoted_at: String(before?.promoted_at ?? "") || nowIso,
          contract_code: nextCode,
          prospect_stage: "closed",
        });
      } else {
        const beforeUnitId = String(before?.unit_id ?? "");
        const becameActiveClient =
          p.status === "active" &&
          p.recordType === "client" &&
          (String(before?.status ?? "") !== "active" ||
            String(before?.record_type ?? "") !== "client" ||
            (p.unitId || beforeUnitId) !== beforeUnitId);
        if (becameActiveClient) {
          await assertSingleActiveContract(p.unitId || String(before?.unit_id ?? ""), id);
        }
        Object.assign(after, {
          approval_status: p.approvalStatus,
          status: p.status,
          record_type: p.recordType,
          prospect_stage: p.prospectStage,
        });


        if (p.approvalStatus === "rejected") {
          const uidRes = await supabase.auth.getUser();
          const uid = uidRes.data.user?.id ?? null;
          Object.assign(after, {
            rejected_by: uid,
            rejected_at: new Date().toISOString(),
          });
        } else {
          Object.assign(after, {
            rejected_by: null,
            rejected_at: null,
          });
        }
      }

      const { data: savedRow, error } = await supabase
        .from("client_contracts" as never)
        .update(after as never)
        .eq("id", id)
        .select("id,start_date,end_date,expiry_date")
        .single();
      if (error) throw error;
      const saved = savedRow as Record<string, unknown> | null;
      const savedStartDate = String(saved?.start_date ?? "");
      const savedEndDate = String(saved?.end_date ?? "");
      const savedExpiryDate = String(saved?.expiry_date ?? "");
      if (
        savedStartDate !== p.startDate ||
        savedEndDate !== p.endDate ||
        savedExpiryDate !== p.expiryDate
      ) {
        throw new Error("The contract dates were not saved. Please try again.");
      }
      await syncUnitDates(p.unitId || String(before?.unit_id ?? ""), p.startDate, p.endDate);
      void logActivity({
        module: "Client Contracts",
        action: "update",
        entityType: "client_contracts",
        entityId: id,
        entityLabel: p.contractCode || p.prospectCode,
        before,
        after: after as unknown as Record<string, unknown>,
      });
    },
    onSuccess: invalidate,
  });

  /**
   * Duplicate a contract exactly (header + all resource lines) under the next
   * available contract / prospect code. The copy is always created inactive.
   */
  const duplicateMut = useMutation({
    mutationFn: async (id: string): Promise<{ id: string; code: string }> => {
      const { data: srcRow, error: srcErr } = await supabase
        .from("client_contracts" as never)
        .select("*")
        .eq("id", id)
        .single();
      if (srcErr) throw srcErr;
      const src = srcRow as unknown as Record<string, unknown>;

      const { data: codeRows, error: codeErr } = await supabase
        .from("client_contracts" as never)
        .select("contract_code,prospect_code");
      if (codeErr) throw codeErr;
      const all = (codeRows as unknown as Record<string, unknown>[]) ?? [];
      const newContractCode = src.contract_code
        ? nextContractCode(all.map((r) => String(r.contract_code ?? "")).filter(Boolean))
        : null;
      const newProspectCode = nextProspectCode(
        all.map((r) => String(r.prospect_code ?? "")).filter(Boolean),
      );

      const uidRes = await supabase.auth.getUser();
      const copy: Record<string, unknown> = { ...src };
      delete copy.id;
      delete copy.created_at;
      delete copy.updated_at;
      Object.assign(copy, {
        contract_code: newContractCode,
        prospect_code: newProspectCode,
        status: "inactive",
        created_by: uidRes.data.user?.id ?? null,
        signed_at: null,
        company_signature_data: null,
        signed_pdf_url: null,
      });

      const { data: inserted, error: insErr } = await supabase
        .from("client_contracts" as never)
        .insert(copy as never)
        .select("id")
        .single();
      if (insErr) throw insErr;
      const newId = String((inserted as Record<string, unknown>).id);

      const { data: resRows, error: resErr } = await supabase
        .from("contract_resources" as never)
        .select("*")
        .eq("contract_id", id);
      if (resErr) throw resErr;
      const lines = ((resRows as unknown as Record<string, unknown>[]) ?? []).map((r) => {
        const line: Record<string, unknown> = { ...r, contract_id: newId };
        delete line.id;
        delete line.created_at;
        delete line.updated_at;
        return line;
      });
      if (lines.length > 0) {
        const { error: lineErr } = await supabase
          .from("contract_resources" as never)
          .insert(lines as never);
        if (lineErr) throw lineErr;
      }

      const code = String(newContractCode ?? newProspectCode);
      void logActivity({
        module: "Client Contracts",
        action: "duplicate",
        entityType: "client_contracts",
        entityId: newId,
        entityLabel: code,
        details: { duplicatedFrom: id, resourceLines: lines.length },
      });
      return { id: newId, code };
    },
    onSuccess: invalidate,
  });


  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("client_contracts" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
      void logActivity({ module: "Client Contracts", action: "delete", entityType: "client_contracts", entityId: id });
    },
    onSuccess: invalidate,
  });

  const updateStageMut = useMutation({
    mutationFn: async ({ id, stage, label }: { id: string; stage: ProspectStage; label: string }) => {
      const { error } = await supabase
        .from("client_contracts" as never)
        .update({ prospect_stage: stage } as never)
        .eq("id", id);
      if (error) throw error;
      void logActivity({
        module: "Client Contracts",
        action: "stage-change",
        entityType: "client_contracts",
        entityId: id,
        entityLabel: label,
        details: { stage },
      });
    },
    onSuccess: invalidate,
  });

  const resubmitMut = useMutation({
    mutationFn: async ({ id, prospectCode }: { id: string; prospectCode: string }) => {
      const { error } = await supabase
        .from("client_contracts" as never)
        .update({
          approval_status: "pending",
          rejection_reason: "",
          rejected_by: null,
          rejected_at: null,
          status: "inactive",
        } as never)
        .eq("id", id);
      if (error) throw error;
      void logActivity({
        module: "Client Contracts",
        action: "resubmit",
        entityType: "client_contracts",
        entityId: id,
        entityLabel: prospectCode,
      });
      void notifyApprovers({
        moduleKey: "contracts",
        type: "contract_pending_approval",
        title: `Prospect ${prospectCode} resubmitted for approval`,
        message: "A previously rejected prospect contract has been updated and resubmitted.",
        link: "/admin/contracts/client-contracts",
        entityType: "client_contracts",
        entityId: id,
      });
    },
    onSuccess: invalidate,
  });

  return {
    items,
    isLoading: contractsQuery.isLoading,
    error: contractsQuery.error,
    refetch: contractsQuery.refetch,
    addMut,
    updateMut,
    deleteMut,
    duplicateMut,
    updateStageMut,
    resubmitMut,
  };
}

function useServiceTypes() {
  const { data = [] } = useQuery({
    queryKey: QK_SVC,
    queryFn: async (): Promise<ServiceType[]> => {
      const { data, error } = await supabase
        .from("service_types" as never)
        .select("id,name,enabled")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({ id: String(r.id), name: String(r.name) }));
    },
  });
  return data;
}

function usePayrollWindows() {
  const { data = [] } = useQuery({
    queryKey: QK_PAY,
    queryFn: async (): Promise<PayrollWindow[]> => {
      const { data, error } = await supabase
        .from("payroll_windows" as never)
        .select("id,label,window_start_day,window_end_day,processing_day,enabled")
        .order("window_start_day");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          label: String(r.label),
          windowStartDay: Number(r.window_start_day),
          windowEndDay: Number(r.window_end_day),
          processingDay: Number(r.processing_day),
        }));
    },
  });
  return data;
}

function useBillingTypes() {
  const { data = [] } = useQuery({
    queryKey: QK_BIL,
    queryFn: async (): Promise<BillingType[]> => {
      const { data, error } = await supabase
        .from("billing_types" as never)
        .select("id,name,enabled")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({ id: String(r.id), name: String(r.name) }));
    },
  });
  return data;
}

function useEsicBranches() {
  const { data = [] } = useQuery({
    queryKey: QK_ESIC,
    queryFn: async (): Promise<EsicBranch[]> => {
      const { data, error } = await supabase
        .from("esic_branches" as never)
        .select("id,esic_code,location,enabled")
        .order("esic_code");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          esicCode: String(r.esic_code ?? ""),
          location: String(r.location ?? ""),
        }));
    },
  });
  return data;
}


function useDesignations() {
  const { data = [] } = useQuery({
    queryKey: QK_DSG,
    queryFn: async (): Promise<Designation[]> => {
      const { data, error } = await supabase
        .from("designations" as never)
        .select("id,name,code,enabled")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          code: String(r.code ?? ""),
        }));
    },
  });
  return data;
}

function useRolesList() {
  const { data = [] } = useQuery({
    queryKey: ["admin", "roles-list"],
    queryFn: async (): Promise<RoleRow[]> => fetchRoles(),
  });
  return data;
}


export function useAllowanceTypes() {
  const { data = [] } = useQuery({
    queryKey: QK_ALW,
    queryFn: async (): Promise<AllowanceType[]> => {
      const { data, error } = await supabase
        .from("allowance_types" as never)
        .select("id,name,display_name,short_name,is_default,enabled,calc_type,percentage,base_components,cap_amount,include_in_ot,formula_mode,formula_expression,formula_version,fixed_calc_method,fixed_duty_components,fixed_duty_divisor,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          displayName: String(r.display_name ?? r.name),
          shortName: String(r.short_name ?? ""),
          isDefault: Boolean(r.is_default),
          calcType: (String(r.calc_type ?? "fixed") as "fixed" | "percentage"),
          percentage: Number(r.percentage ?? 0),
          baseComponents: Array.isArray(r.base_components)
            ? (r.base_components as { label: string; operator: "+" | "-" }[])
            : [],
          capAmount: r.cap_amount == null ? null : Number(r.cap_amount),
          includeInOt: r.include_in_ot == null ? true : Boolean(r.include_in_ot),
          formulaMode: r.formula_mode == null ? null : String(r.formula_mode),
          formulaExpression: r.formula_expression == null ? null : String(r.formula_expression),
          formulaVersion: r.formula_version == null ? null : Number(r.formula_version),
          fixedCalcMethod: (String(r.fixed_calc_method ?? "flat") as "flat" | "per_duty"),
          fixedDutyComponents: Array.isArray(r.fixed_duty_components)
            ? ((r.fixed_duty_components as string[]).filter((b) =>
                ["p_days","ot_days","ph_days","other_paid_days"].includes(b),
              ) as ("p_days"|"ot_days"|"ph_days"|"other_paid_days")[])
            : [],
          fixedDutyDivisor: (["base_days","days_in_month","payable_days","fixed_26"].includes(String(r.fixed_duty_divisor))
            ? (r.fixed_duty_divisor as "base_days"|"days_in_month"|"payable_days"|"fixed_26")
            : "base_days"),
        }));
    },
  });
  return data;
}

function useContractResources(contractId: string | null) {
  const { data = [] } = useQuery({
    queryKey: ["admin", "contract-resources", contractId ?? "none"],
    enabled: !!contractId,
    queryFn: async (): Promise<ContractResource[]> => {
      if (!contractId) return [];
      const { data, error } = await supabase
        .from("contract_resources" as never)
        .select(
          "id,designation_id,role_key,service_type_id,quantity,shift_hours,components,sort_order,payroll_day_base_id,billing_day_base_id,benefits,deductions,employer_contributions",
        )
        .eq("contract_id", contractId)
        .order("sort_order");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        designationId: r.designation_id ? String(r.designation_id) : "",
        roleKey: r.role_key ? String(r.role_key) : null,
        serviceTypeId: r.service_type_id ? String(r.service_type_id) : "",
        quantity: Number(r.quantity ?? 1),
        shiftHours: Number(r.shift_hours ?? 8) === 12 ? 12 : 8,
        components: Array.isArray(r.components)
          ? (r.components as ResourceComponent[])
          : [],
        payrollDayBaseId: r.payroll_day_base_id ? String(r.payroll_day_base_id) : null,
        billingDayBaseId: r.billing_day_base_id ? String(r.billing_day_base_id) : null,
        benefits: Array.isArray(r.benefits) ? (r.benefits as BenefitItem[]) : [],
        deductions: Array.isArray(r.deductions) ? (r.deductions as BenefitItem[]) : [],
        employerContributions: Array.isArray(r.employer_contributions) ? (r.employer_contributions as BenefitItem[]) : [],
      }));
    },
  });
  return data;
}

export function useBillingDayBases() {
  const { data = [] } = useQuery({
    queryKey: QK_BDB,
    queryFn: async (): Promise<PayrollDayBase[]> => {
      const { data, error } = await supabase
        .from("billing_day_bases" as never)
        .select("id,name,code,method,fixed_days,weekly_off_day,included_weekdays,enabled,sort_order")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          code: String(r.code),
          method: r.method as PayrollDayBase["method"],
          fixedDays: r.fixed_days == null ? null : Number(r.fixed_days),
          weeklyOffDay: r.weekly_off_day == null ? null : Number(r.weekly_off_day),
          includedWeekdays: Array.isArray(r.included_weekdays)
            ? (r.included_weekdays as unknown[]).map((n) => Number(n)).filter((n) => n >= 0 && n <= 6)
            : null,
          enabled: Boolean(r.enabled ?? true),
          sortOrder: Number(r.sort_order ?? 0),
        }));
    },
  });
  return data;
}

export function usePayrollDayBases() {
  const { data = [] } = useQuery({
    queryKey: QK_PDB,
    queryFn: async (): Promise<PayrollDayBase[]> => {
      const { data, error } = await supabase
        .from("payroll_day_bases" as never)
        .select("id,name,code,method,fixed_days,weekly_off_day,included_weekdays,enabled,sort_order")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          code: String(r.code),
          method: r.method as PayrollDayBase["method"],
          fixedDays: r.fixed_days == null ? null : Number(r.fixed_days),
          weeklyOffDay: r.weekly_off_day == null ? null : Number(r.weekly_off_day),
          includedWeekdays: Array.isArray(r.included_weekdays)
            ? (r.included_weekdays as unknown[]).map((n) => Number(n)).filter((n) => n >= 0 && n <= 6)
            : null,
          enabled: Boolean(r.enabled ?? true),
          sortOrder: Number(r.sort_order ?? 0),
        }));
    },
  });
  return data;
}

export function useCostComponentOptions() {
  const { data = [] } = useQuery({
    queryKey: QK_CC,
    queryFn: async (): Promise<CostComponentOption[]> => {
      const { data, error } = await supabase
        .from("cost_components" as never)
        .select("id,name,code,calc_type,percentage,base_components,cap_amount,cap_flat_amount,amount,state,enabled,sort_order,deduction_calc_type,fixed_calc_method,fixed_duty_components,fixed_duty_divisor,description,formula_mode,formula_expression,formula_version,party")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as unknown as Record<string, unknown>[])
        .filter((r) => r.enabled !== false)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          code: String(r.code ?? ""),
          calcType: (r.calc_type as "percentage" | "fixed") ?? "percentage",
          percentage: Number(r.percentage ?? 0),
          baseComponents: Array.isArray(r.base_components)
            ? (r.base_components as { label: string; operator: "+" | "-" }[])
            : [],
          capAmount: r.cap_amount == null ? null : Number(r.cap_amount),
          capFlatAmount: r.cap_flat_amount == null ? null : Number(r.cap_flat_amount),
          amount: r.amount == null ? null : Number(r.amount),
          state: String(r.state ?? "N/A"),
          description: String(r.description ?? "").trim(),
          party: (["employee", "employer", "both"].includes(String(r.party))
            ? (r.party as "employee" | "employer" | "both")
            : "both"),
          deductionCalcType:
            (String(r.deduction_calc_type ?? "earned_salary") as "earned_salary" | "fixed_amount"),
          fixedCalcMethod:
            (String(r.fixed_calc_method ?? "flat") as FixedCalcMethod),
          fixedDutyComponents: Array.isArray(r.fixed_duty_components)
            ? ((r.fixed_duty_components as string[]).filter((b) =>
                ["p_days","ot_days","ph_days","other_paid_days"].includes(b),
              ) as FixedDutyBucket[])
            : [],
          fixedDutyDivisor: (["base_days","days_in_month","payable_days","fixed_26"].includes(String(r.fixed_duty_divisor))
            ? (r.fixed_duty_divisor as FixedDutyDivisor)
            : "base_days"),
          formulaMode: r.formula_mode == null ? null : String(r.formula_mode),
          formulaExpression: r.formula_expression == null ? null : String(r.formula_expression),
          formulaVersion: r.formula_version == null ? null : Number(r.formula_version),
        }));
    },

  });
  return data;
}

/** Compute total payable days for a resource in the current month, based on the payroll-day base rule. */
function computePayableDays(base: PayrollDayBase | undefined, ref: Date = new Date()): number {
  if (!base) return 0;
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (base.method === "fixed_days") return Number(base.fixedDays) || 0;
  if (base.method === "fixed_annual_average") return 30.4166;
  if (base.method === "actual_days") return daysInMonth;
  if (base.method === "actual_minus_weekly_off") {
    const off = base.weeklyOffDay == null ? 0 : Number(base.weeklyOffDay); // 0=Sun..6=Sat
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month, d).getDay() === off) count++;
    }
    return daysInMonth - count;
  }
  if (base.method === "custom_weekdays") {
    const allowed = base.includedWeekdays ?? [];
    if (allowed.length === 0) return 0;
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (allowed.includes(new Date(year, month, d).getDay())) count++;
    }
    return count;
  }
  return daysInMonth;
}

const ESI_CONTRACT_NOTE = "Calculated in payroll from earned gross minus washing/conveyance";
const ESI_COMPONENT_RE = /\b(?:e[er]\s*)?e?si(c)?\b/i;

function isEsiItem(item: { name?: unknown } | null | undefined): boolean {
  return ESI_COMPONENT_RE.test(String(item?.name ?? ""));
}

export function hasConfiguredFormula(item: { formulaExpression?: string | null }): boolean {
  return !!item.formulaExpression?.trim();
}

// ---- Canonical statutory masters -----------------------------------------
// EPF must be computed on (Gross − HRA) with the ₹15,000 wage ceiling, i.e.
// ₹1,800 employee / ₹1,950 employer once the base crosses the ceiling, and
// ESIC on (earned gross − washing − conveyance). Contract rows that still
// point at an uncapped EPF master, or at an ESI master with no formula, are
// re-linked to these canonical masters so every contract uses the correct
// statutory formula without manual re-selection.
const EPF_COMPONENT_RE = /(epf|provident\s*fund|\bpf\b)/i;

function isEpfItem(item: { name?: unknown } | null | undefined): boolean {
  return EPF_COMPONENT_RE.test(String(item?.name ?? ""));
}

const CANONICAL_STATUTORY_CODES = {
  employee: { epf: "EPFEMPLOYEECONTRIBUTIONGROSSHRA", esi: "ESIEMPLOYEECONTRIBUTIONGROSS" },
  employer: { epf: "EPFEMPLOYERCONTRIBUTIONGROSSHRA", esi: "ESIEMPLOYERCONTRIBUTIONNET" },
} as const;

function isEmployerStatutoryRow(item: { name?: unknown }): boolean {
  return /^\s*er\b|employer/i.test(String(item?.name ?? ""));
}

/**
 * Returns the canonical statutory master a row should use, or undefined when
 * the row is already correctly configured (capped EPF, or ESI with a formula).
 */
function canonicalStatutoryMaster(
  item: { name?: unknown; calcType?: string | null; capAmount?: number | null; formulaExpression?: string | null },
  masters: CostComponentOption[],
): CostComponentOption | undefined {
  // Exact source-card amounts are intentionally fixed. Keep their master link
  // for auditability without replacing the saved amount with a generic rule.
  if (item.calcType === "fixed" && !hasConfiguredFormula(item)) return undefined;
  const party = isEmployerStatutoryRow(item) ? "employer" : "employee";
  const byCode = (code: string) => masters.find((m) => (m.code ?? "").toUpperCase() === code);
  if (isEpfItem(item)) {
    const capped = Number(item.capAmount) > 0;
    if (capped || hasConfiguredFormula(item)) return undefined;
    return byCode(CANONICAL_STATUTORY_CODES[party].epf);
  }
  if (isEsiItem(item) && !hasConfiguredFormula(item)) {
    return byCode(CANONICAL_STATUTORY_CODES[party].esi);
  }
  return undefined;
}


// ESI rows fall back to the statutory calc only when no custom formula is set
// in Cost Component Manager. When a formula IS configured the row uses its own
// evaluated amount instead of the statutory 0.75% / 3.25% override.
function isStatutoryEsi(item: { name?: unknown; calcType?: string | null; formulaExpression?: string | null } | null | undefined): boolean {
  return isEsiItem(item) && item?.calcType !== "fixed" && !hasConfiguredFormula(item ?? {});
}

function contractTotalAmount(item: { name?: unknown; amount?: unknown; formulaExpression?: string | null }): number {
  if (isStatutoryEsi(item)) return 0;
  return Number(item.amount) || 0;
}

function addFormulaAliases(ctx: FormulaContext, amount: number, labels: Array<string | null | undefined>) {
  const keys = new Set<string>();
  const compact = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string[]> = {
    splallow: ["spl_allow", "specialallowance", "special_allowance"],
    splallowance: ["spl_allowance", "specialallowance", "special_allowance"],
    specialallowance: ["special_allowance", "splallow", "spl_allow", "splallowance", "spl_allowance"],
    convallow: ["conv_allow", "conveyanceallowance", "conveyance_allowance"],
    conveyanceallowance: ["conveyance_allowance", "convallow", "conv_allow"],
    wa: ["washingallowance", "washing_allowance"],
    washingallowance: ["washing_allowance", "wa"],
    hra: ["houserentallowance", "house_rent_allowance"],
    houserentallowance: ["house_rent_allowance", "hra"],
  };
  for (const label of labels) {
    const raw = String(label ?? "").trim();
    if (!raw) continue;
    keys.add(slugifyVar(raw));
    keys.add(compact(raw));
    const canonical = raw
      .replace(/[\s\-_]*[\(\[]?\s*\d+(?:\.\d+)?\s*%\s*[\)\]]?\s*$/gi, "")
      .replace(/[\s\-_]+\d+(?:\.\d+)?\s*$/g, "")
      .trim();
    if (canonical) {
      keys.add(slugifyVar(canonical));
      keys.add(compact(canonical));
      for (const alias of aliases[compact(canonical)] ?? []) keys.add(alias);
    }
  }
  for (const key of keys) {
    if (!key) continue;
    ctx[key] = Math.round(((ctx[key] ?? 0) + amount) * 100) / 100;
  }
}

function allowanceLabelKey(label: string | null | undefined): string {
  return String(label ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findAllowanceForResourceComponent(
  component: Pick<ResourceComponent, "allowanceId" | "name">,
  allowanceTypes: AllowanceType[],
): AllowanceType | undefined {
  const byId = allowanceTypes.find((a) => a.id === component.allowanceId);
  if (byId) return byId;

  const componentKey = allowanceLabelKey(component.name);
  if (!componentKey) return undefined;
  const exact = allowanceTypes.find((a) =>
    [a.name, a.displayName, a.shortName].some((label) => allowanceLabelKey(label) === componentKey),
  );
  if (exact) return exact;

  const stripSuffix = (label: string) =>
    allowanceLabelKey(
      label
        .replace(/[\s\-_]*[\(\[]?\s*\d+(?:\.\d+)?\s*%\s*[\)\]]?\s*$/gi, "")
        .replace(/[\s\-_]+\d+(?:\.\d+)?\s*$/g, ""),
    );
  const canonicalKey = stripSuffix(component.name);
  if (!canonicalKey) return undefined;
  const candidates = allowanceTypes.filter((a) =>
    [a.name, a.displayName, a.shortName].some((label) => stripSuffix(label) === canonicalKey),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function syncResourceComponentMasterFields(
  component: ResourceComponent,
  allowanceTypes: AllowanceType[],
): ResourceComponent {
  const at = findAllowanceForResourceComponent(component, allowanceTypes);
  if (!at) return { ...component };
  // Imported source-card rows can retain a master ID for traceability while
  // deliberately locking the exact printed amount. Do not put the generic
  // master formula back onto those rows when the contract editor opens.
  if (component.calcType === "fixed" && !hasConfiguredFormula(component)) {
    return { ...component };
  }
  return {
    ...component,
    allowanceId: at.id,
    name: at.shortName || at.displayName || at.name,
    // Per-resource OT selection — keep the resource's own choice.
    includeInOt: component.includeInOt !== false,

    formulaMode: at.formulaMode ?? null,
    formulaExpression: at.formulaExpression ?? null,
    formulaVersion: at.formulaVersion ?? null,
  };
}

/**
 * Reliever charges and the management fee are billing add-ons, never wage or
 * CTC lines. They sit *after* Total CTC: CTC + reliever = Billing Rate,
 * + management fee = Final Billing Rate.
 */
export const isRelieverLine = (x: { name?: unknown }) => /reliever/i.test(String(x?.name ?? ""));
export const isMgmtFeeLine = (x: { name?: unknown }) =>
  /management\s*fee|\bmgmt\s*fee\b/i.test(String(x?.name ?? ""));
const isBillingAddOn = (x: { name?: unknown }) => isRelieverLine(x) || isMgmtFeeLine(x);
const CUSTOM_MANAGEMENT_FEE_ID = "__custom_management_fee__";
const CUSTOM_RELIEVER_ID = "__custom_reliever_charges__";

function normalizeBillingAddOns(
  benefits: BenefitItem[],
  employerContributions: BenefitItem[],
): { benefits: BenefitItem[]; employerContributions: BenefitItem[] } {
  const all = [...employerContributions, ...benefits.filter(isBillingAddOn)];
  const relievers = all.filter(isRelieverLine);
  const managementFees = all.filter(isMgmtFeeLine);
  const referencesCtc = (item: BenefitItem) =>
    /\bctc\b/i.test(item.formulaExpression ?? "") ||
    item.baseComponents.some((base) => /^(total\s+)?ctc$/i.test(base.label.trim()));
  const reliever = [...relievers].sort(
    (a, b) => Number(referencesCtc(b)) - Number(referencesCtc(a)),
  )[0];
  const managementFee = [...managementFees].sort((a, b) => {
    const customDifference =
      Number(b.costComponentId === CUSTOM_MANAGEMENT_FEE_ID) -
      Number(a.costComponentId === CUSTOM_MANAGEMENT_FEE_ID);
    if (customDifference) return customDifference;
    return (Number(b.amount) || 0) - (Number(a.amount) || 0);
  })[0];
  // Legacy contracts could hold the same billing add-on in both benefits and
  // employer contributions. Keep exactly one canonical row of each type.
  // If duplicate management rows include a real entered amount while formula
  // rows are zero, preserve that value as a custom fixed fee.
  const canonicalManagementFee =
    managementFees.length > 1 && managementFee && Number(managementFee.amount) > 0
      ? {
          ...managementFee,
          costComponentId: CUSTOM_MANAGEMENT_FEE_ID,
          name: "Custom Management Fee",
          calcType: "fixed" as const,
          percentage: 0,
          baseComponents: [],
          capAmount: null,
          capFlatAmount: null,
          formulaMode: null,
          formulaExpression: null,
        }
      : managementFee;
  return {
    benefits: benefits.filter((item) => !isBillingAddOn(item)),
    employerContributions: [
      ...employerContributions.filter((item) => !isBillingAddOn(item)),
      ...(reliever ? [reliever] : []),
      ...(canonicalManagementFee ? [canonicalManagementFee] : []),
    ],
  };
}

/* ---------------- Readable formula descriptions ---------------- */

const FORMULA_VAR_LABELS: Record<string, string> = {
  earned_gross: "Earned Gross",
  earnedgross: "Earned Gross",
  earned_wages: "Earned Gross",
  gross: "Gross",
  basic: "Basic",
  da: "DA",
  hra: "HRA",
  ctc: "Total CTC",
  total_ctc: "Total CTC",
  wa: "WA",
  conv_allow: "Conv Allow",
  conveyance: "Conveyance",
  fixed_amount: "Fixed Amount",
  payable_days: "Payable Days",
  working_days: "Working Days",
  days_in_month: "Days in Month",
  other_allowance: "Other Allowance",
  management_fee: "Management Fee",
};

/** Turn a raw math expression into something a human can read. */
export function humanizeFormulaExpression(raw: string): string {
  const expr = String(raw ?? "").trim();
  if (!expr) return "";
  const pretty = (s: string) =>
    s
      .replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (t) => {
        const key = t.toLowerCase();
        if (["min", "max", "round", "floor", "ceil"].includes(key)) return key;
        return (
          FORMULA_VAR_LABELS[key] ??
          key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        );
      })
      .replace(/\s+/g, " ")
      .trim();

  // "X * 0.75 / 100" reads much better as "0.75% of X".
  const pct = expr.match(/^\s*\(?(.+?)\)?\s*\*\s*([\d.]+)\s*\/\s*100\s*$/);
  if (pct) {
    const base = pretty(pct[1]).replace(/^\((.*)\)$/, "$1");
    return `${Number(pct[2])}% of ${base}`;
  }
  const div = expr.match(/^\s*\(?(.+?)\)?\s*\/\s*([\d.]+)\s*$/);
  if (div && !/[+\-*/]/.test(div[1])) return `${pretty(div[1])} ÷ ${Number(div[2])}`;
  return pretty(expr);
}

/**
 * Best available human description for a component row: the description kept
 * on the Cost Component / Allowance master wins, then a readable rendering of
 * the configured formula, then the percentage/base summary. Raw formula JSON
 * is never shown.
 */
export function describeComponentFormula(
  b: {
    name?: string;
    calcType?: "percentage" | "fixed";
    percentage?: number;
    baseComponents?: { label: string; operator: "+" | "-" }[];
    capAmount?: number | null;
    formulaMode?: string | null;
    formulaExpression?: string | null;
  },
  masterDescription?: string | null,
): string {
  const desc = String(masterDescription ?? "").trim();
  if (desc) return desc;
  const cfg = parseFormulaConfig(b.formulaMode ?? null, b.formulaExpression ?? null);
  if (cfg) {
    try {
      const expr = cfg.mode === "preset" ? presetToExpression(cfg.preset) : cfg.expression;
      const readable = humanizeFormulaExpression(expr ?? "");
      if (readable) return readable;
    } catch {
      /* fall through to the percentage summary */
    }
  }
  if (b.calcType === "percentage" && Number(b.percentage) > 0) {
    const base = (b.baseComponents ?? [])
      .map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`))
      .join(" ");
    return `${b.percentage}%${base ? ` of ${base}` : ""}${
      b.capAmount ? ` (cap ₹${Number(b.capAmount).toLocaleString("en-IN")})` : ""
    }`;
  }
  return "";
}


/** Compute benefit amount from a percentage component using the resource's wage components. */
export function computeBenefitAmount(
  benefit: Pick<BenefitItem, "calcType" | "percentage" | "baseComponents" | "capAmount" | "capFlatAmount" | "amount"> & {
    formulaMode?: string | null;
    formulaExpression?: string | null;
    name?: string;
  },
  wageComponents: ResourceComponent[],
  benefitItems: BenefitItem[] = [],
  allowanceTypes: AllowanceType[] = [],
  employerItems: BenefitItem[] = [],
): number {
  // Formula-first: if the master record (allowance / cost component) has a
  // formula expression configured, evaluate it against a slugified context
  // built from the current wage components.
  const cfg = hasConfiguredFormula(benefit)
    ? parseFormulaConfig(benefit.formulaMode ?? null, benefit.formulaExpression ?? null)
    : null;
  if (cfg && !(cfg.mode === "advanced" && !cfg.expression?.trim())) {
    const componentsTotal = wageComponents.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    // Billing add-ons (reliever charges, management fee) sit above Total CTC and
    // must never inflate gross or CTC bases.
    const benefitsTotal = benefitItems
      .filter((b) => !isBillingAddOn(b))
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const employerTotal = employerItems
      .filter((b) => !isBillingAddOn(b))
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const relieverTotal = employerItems
      .filter(isRelieverLine)
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const totalCtc = componentsTotal + benefitsTotal + employerTotal;
    const ctx: FormulaContext = {
      basic: 0,
      da: 0,
      gross: componentsTotal + benefitsTotal,
      // Earned gross is the wage-component total only. Cost benefits are
      // included in the broader contract gross above, but must not inflate
      // statutory ESIC formulas such as earned gross - WA - conveyance.
      earned_gross: componentsTotal,
      earnedgross: componentsTotal,
      earned_wages: componentsTotal,
      earnedwages: componentsTotal,
      ctc: totalCtc,
      total_ctc: totalCtc,
      billing_rate: totalCtc + relieverTotal,
      billingrate: totalCtc + relieverTotal,
      fixed_amount: Number(benefit.amount) || 0,
      days_in_month: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
      working_days: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
    };
    for (const c of wageComponents) {
      const amt = Number(c.amount) || 0;
      const at = allowanceTypes.find((a) => a.id === c.allowanceId);
      addFormulaAliases(ctx, amt, [c.name, at?.name, at?.displayName, at?.shortName]);
    }
    for (const b of benefitItems) {
      addFormulaAliases(ctx, Number(b.amount) || 0, [b.name]);
    }
    for (const b of employerItems) {
      addFormulaAliases(ctx, Number(b.amount) || 0, [b.name]);
    }
    const r = evaluateFormula(cfg, ctx);
    if (!r.error) return r.amount;
  }
  if (benefit.calcType === "fixed") return Number(benefit.amount) || 0;
  const componentsTotal = wageComponents.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const benefitsTotal = benefitItems
    .filter((b) => !isBillingAddOn(b))
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const employerTotal = employerItems
    .filter((b) => !isBillingAddOn(b))
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  if (isEsiItem(benefit as { name?: unknown })) return 0;
  const norm = (s: string) => s.trim().toLowerCase();
  const compactNorm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const grossOf = (label: string): number => {
    const l = norm(label);
    if (l === "gross") {
      return componentsTotal + benefitsTotal;
    }
    if (l === "ctc" || l === "total ctc") {
      return componentsTotal + benefitsTotal + employerTotal;
    }
    // Direct match on the wage component's stored name (often the short name)
    let match = wageComponents.find((c) => norm(c.name) === l);
    if (!match) match = wageComponents.find((c) => compactNorm(c.name) === compactNorm(label));
    if (match) return Number(match.amount) || 0;
    // Resolve via allowance type aliases: name / displayName / shortName -> allowanceId
    const at = allowanceTypes.find(
      (a) => norm(a.name) === l || norm(a.displayName) === l || norm(a.shortName) === l,
    );
    if (at) {
      match = wageComponents.find((c) => c.allowanceId === at.id);
      if (match) return Number(match.amount) || 0;
    }
    // Resolve against benefit / employer item names
    const benefitMatch = benefitItems.find((b) => norm(b.name) === l);
    if (benefitMatch) return Number(benefitMatch.amount) || 0;
    const employerMatch = employerItems.find((b) => norm(b.name) === l);
    if (employerMatch) return Number(employerMatch.amount) || 0;
    return 0;
  };
  const base = benefit.baseComponents.reduce((sum, b) => {
    const v = grossOf(b.label);
    return b.operator === "-" ? sum - v : sum + v;
  }, 0);
  let amt = (Number(benefit.percentage) || 0) * base / 100;
  if (benefit.capAmount != null && benefit.capAmount > 0 && base > benefit.capAmount) {
    amt =
      benefit.capFlatAmount != null && benefit.capFlatAmount > 0
        ? Number(benefit.capFlatAmount)
        : (Number(benefit.percentage) || 0) * benefit.capAmount / 100;
  }
  return Math.round(amt * 100) / 100;
}

async function persistResources(contractId: string, resources: ContractResource[]) {
  const normalizedResources = resources.map(cloneContractResource);
  const prev = await supabase
    .from("contract_resources" as never)
    .select("id,designation_id,service_type_id,quantity,shift_hours,components,benefits,deductions,employer_contributions,payroll_day_base_id,billing_day_base_id,sort_order")
    .eq("contract_id", contractId)
    .order("sort_order");
  if (prev.error) throw prev.error;
  const beforeRows = (prev.data ?? []) as Record<string, unknown>[];
  if (normalizedResources.length === 0) {
    if (beforeRows.length > 0) {
      throw new Error("This contract already has resource lines. Remove them individually before saving an empty contract.");
    }
    return;
  }
  const rows = normalizedResources.map((r, idx) => ({
    contract_id: contractId,
    designation_id: r.designationId || null,
    role_key: r.roleKey || null,
    service_type_id: r.serviceTypeId || null,
    quantity: r.quantity,
    shift_hours: r.shiftHours === 12 ? 12 : 8,
    components: r.components,
    gross: r.components.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    sort_order: idx,
    payroll_day_base_id: r.payrollDayBaseId || null,
    billing_day_base_id: r.billingDayBaseId || null,
    benefits: r.benefits,
    deductions: r.deductions,
    employer_contributions: r.employerContributions,
  }));
  // Save first and delete stale rows only after every write succeeds. The old
  // delete-then-insert sequence could permanently empty a contract whenever
  // an insert failed or a stale client submitted an empty resource array.
  const savedRows: Record<string, unknown>[] = [];
  for (let idx = 0; idx < rows.length; idx += 1) {
    const resource = normalizedResources[idx];
    const row = rows[idx];
    const write = resource.id
      ? await supabase
          .from("contract_resources" as never)
          .update(row as never)
          .eq("id", resource.id)
          .eq("contract_id", contractId)
          .select("id,designation_id,service_type_id,quantity,shift_hours,components,benefits,deductions,employer_contributions,payroll_day_base_id,billing_day_base_id,sort_order")
          .single()
      : await supabase
          .from("contract_resources" as never)
          .insert(row as never)
          .select("id,designation_id,service_type_id,quantity,shift_hours,components,benefits,deductions,employer_contributions,payroll_day_base_id,billing_day_base_id,sort_order")
          .single();
    if (write.error) throw write.error;
    savedRows.push(write.data as unknown as Record<string, unknown>);
  }

  const savedIds = new Set(savedRows.map((row) => String(row.id)));
  const staleIds = beforeRows
    .map((row) => String(row.id))
    .filter((id) => !savedIds.has(id));
  for (const staleId of staleIds) {
    const removed = await supabase
      .from("contract_resources" as never)
      .delete()
      .eq("id", staleId)
      .eq("contract_id", contractId);
    if (removed.error) throw removed.error;
  }

  savedRows.sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  if (savedRows.length !== rows.length) {
    throw new Error("Could not verify saved resources. Please try again.");
  }
  const normalizeForCompare = (arr: unknown): string => {
    const list = Array.isArray(arr) ? arr : [];
    return JSON.stringify(
      list.map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        return Object.keys(o)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            const v = o[k];
            acc[k] = typeof v === "number" ? Number(v) : v;
            return acc;
          }, {});
      }),
    );
  };
  rows.forEach((row, idx) => {
    const saved = savedRows[idx];
    if (normalizeForCompare(row.deductions) !== normalizeForCompare(saved?.deductions)) {
      throw new Error("Resource deductions were not saved correctly. Please try again.");
    }
  });
  void logActivity({
    module: "Contract Resources",
    action: "update",
    entityType: "contract_resources",
    entityId: contractId,
    before: { count: beforeRows.length, resources: beforeRows },
    after: { count: rows.length, resources: rows },
  });
}

// ============= Excel export / import =============

const CONTRACT_FIELDS = [
  "contract_code",
  "unit_id",
  "start_date",
  "end_date",
  "expiry_date",
  "description",
  "service_type_id",
  "payroll_window_id",
  "billing_type_id",
  
  "gst_option",
  "status",
] as const;

async function exportContractToXlsx(contract: ClientContract): Promise<void> {
  const { data: resData, error } = await supabase
    .from("contract_resources" as never)
    .select(
      "designation_id,service_type_id,quantity,shift_hours,payroll_day_base_id,components,benefits,deductions,employer_contributions,sort_order",
    )
    .eq("contract_id", contract.id)
    .order("sort_order");
  if (error) throw error;
  const resources = (resData as unknown as Record<string, unknown>[]) ?? [];

  // Resolve lookup labels in parallel
  const [unitsRes, desigRes, svcRes, pwRes, btRes, pdbRes, esicRes] = await Promise.all([
    supabase.from("units" as never).select("id,code,name").eq("id", contract.unitId).maybeSingle(),
    supabase.from("designations" as never).select("id,name,code"),
    supabase.from("service_types" as never).select("id,name"),
    supabase.from("payroll_windows" as never).select("id,label"),
    supabase.from("billing_types" as never).select("id,name"),
    supabase.from("payroll_day_bases" as never).select("id,name,code"),
    supabase.from("esic_branches" as never).select("id,esic_code,location"),
  ]);
  const unitRow = unitsRes.data as Record<string, unknown> | null;
  const nameMap = (rows: unknown, key = "name"): Map<string, string> => {
    const m = new Map<string, string>();
    ((rows as Record<string, unknown>[]) ?? []).forEach((r) =>
      m.set(String(r.id), String(r[key] ?? "")),
    );
    return m;
  };
  const desigMap = nameMap(desigRes.data);
  const svcMap = nameMap(svcRes.data);
  const pwMap = nameMap(pwRes.data, "label");
  const btMap = nameMap(btRes.data);
  const pdbMap = nameMap(pdbRes.data);
  const esicMap = new Map<string, string>();
  ((esicRes.data as Record<string, unknown>[]) ?? []).forEach((r) =>
    esicMap.set(String(r.id), `${String(r.esic_code ?? "")} — ${String(r.location ?? "")}`),
  );

  const sumArr = (arr: unknown): number =>
    Array.isArray(arr)
      ? (arr as { name?: unknown; amount?: unknown }[]).reduce((s, x) => s + contractTotalAmount(x), 0)
      : 0;

  // ---- Sheet 1: Summary
  const summaryRows: Array<[string, string | number]> = [];
  summaryRows.push(["Contract Code", contract.contractCode]);
  summaryRows.push([
    "Client",
    unitRow ? `${String(unitRow.code ?? "")} — ${String(unitRow.name ?? "")}` : contract.unitId,
  ]);
  summaryRows.push(["Start Date", contract.startDate]);
  summaryRows.push(["End Date", contract.endDate]);
  summaryRows.push(["Expiry Date", contract.expiryDate]);
  summaryRows.push(["Status", contract.status]);
  summaryRows.push(["Description", contract.description]);
  summaryRows.push(["Service Type", svcMap.get(contract.serviceTypeId ?? "") ?? ""]);
  summaryRows.push(["Payroll Window", pwMap.get(contract.payrollWindowId ?? "") ?? ""]);
  summaryRows.push(["Billing Type", btMap.get(contract.billingTypeId ?? "") ?? ""]);
  
  summaryRows.push(["GST Option", contract.gstOption]);

  let totalHeadcount = 0;
  let totalMonthlyCTC = 0;
  let totalGross = 0;
  let totalBenefits = 0;
  let totalDeductions = 0;
  let totalEmployer = 0;
  resources.forEach((r) => {
    const qty = Number(r.quantity ?? 1) || 1;
    const wage = sumArr(r.components);
    const ben = sumArr(r.benefits);
    const ded = sumArr(r.deductions);
    const emp = sumArr(r.employer_contributions);
    totalHeadcount += qty;
    totalGross += (wage + ben) * qty;
    totalBenefits += ben * qty;
    totalDeductions += ded * qty;
    totalEmployer += emp * qty;
    totalMonthlyCTC += (wage + ben + emp) * qty;
  });
  summaryRows.push(["", ""]);
  summaryRows.push(["Resource Lines", resources.length]);
  summaryRows.push(["Total Headcount", totalHeadcount]);
  summaryRows.push(["Total Monthly Gross", totalGross]);
  summaryRows.push(["Total Monthly Benefits (in gross)", totalBenefits]);
  summaryRows.push(["Total Monthly Deductions", totalDeductions]);
  summaryRows.push(["Total Monthly Employer Contribution", totalEmployer]);
  summaryRows.push(["Total Monthly CTC (Gross + Employer)", totalMonthlyCTC]);
  summaryRows.push(["Total Monthly Net Payable (Gross - Deductions)", totalGross - totalDeductions]);

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet([["Field", "Value"], ...summaryRows]);
  wsSummary["!cols"] = [{ wch: 42 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // ---- Sheet 2: Resources (human-readable)
  const resHeader = [
    "#",
    "Designation",
    "Service Type",
    "Quantity",
    "Payroll Day Basis",
    "Wage Components Total",
    "Benefits Total",
    "Gross (Wage + Benefits)",
    "Deductions Total",
    "Net Payable",
    "Employer Contribution Total",
    "Monthly CTC",
    "Annual CTC",
    "Line Monthly CTC (× Qty)",
    "Line Annual CTC (× Qty)",
  ];
  const resHumanRows = resources.map((r, idx) => {
    const qty = Number(r.quantity ?? 1) || 1;
    const wage = sumArr(r.components);
    const ben = sumArr(r.benefits);
    const ded = sumArr(r.deductions);
    const emp = sumArr(r.employer_contributions);
    const gross = wage + ben;
    const ctc = gross + emp;
    return [
      idx + 1,
      desigMap.get(String(r.designation_id ?? "")) ?? "",
      svcMap.get(String(r.service_type_id ?? "")) ?? "",
      qty,
      pdbMap.get(String(r.payroll_day_base_id ?? "")) ?? "",
      wage,
      ben,
      gross,
      ded,
      gross - ded,
      emp,
      ctc,
      ctc * 12,
      ctc * qty,
      ctc * qty * 12,
    ];
  });
  const wsRes = XLSX.utils.aoa_to_sheet([resHeader, ...resHumanRows]);
  wsRes["!cols"] = resHeader.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsRes, "Resources");

  // ---- Sheet 3: Salary Breakdown (long format)
  const breakdownHeader = [
    "Resource #",
    "Designation",
    "Quantity",
    "Section",
    "Component",
    "Calc Type",
    "Percentage",
    "State",
    "Monthly Amount",
    "Line Total (× Qty)",
  ];
  const breakdownRows: (string | number)[][] = [];
  resources.forEach((r, idx) => {
    const qty = Number(r.quantity ?? 1) || 1;
    const desig = desigMap.get(String(r.designation_id ?? "")) ?? "";
    const pushSection = (section: string, items: unknown) => {
      if (!Array.isArray(items)) return;
      (items as Array<Record<string, unknown>>).forEach((it) => {
        const amt = contractTotalAmount(it);
        breakdownRows.push([
          idx + 1,
          desig,
          qty,
          section,
          String(it.name ?? ""),
          String(it.calcType ?? ""),
          Number(it.percentage ?? 0) || 0,
          String(it.state ?? ""),
          amt,
          amt * qty,
        ]);
      });
    };
    pushSection("Wage", r.components);
    pushSection("Benefit", r.benefits);
    pushSection("Deduction", r.deductions);
    pushSection("Employer Contribution", r.employer_contributions);
  });
  const wsBreak = XLSX.utils.aoa_to_sheet([breakdownHeader, ...breakdownRows]);
  wsBreak["!cols"] = breakdownHeader.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsBreak, "Salary Breakdown");

  // ---- Sheet 4: Contract (raw, importable)
  const contractRow: Record<string, string | number> = {
    contract_code: contract.contractCode,
    unit_id: contract.unitId,
    start_date: contract.startDate,
    end_date: contract.endDate,
    expiry_date: contract.expiryDate,
    description: contract.description,
    service_type_id: contract.serviceTypeId ?? "",
    payroll_window_id: contract.payrollWindowId ?? "",
    billing_type_id: contract.billingTypeId ?? "",
    
    gst_option: contract.gstOption,
    status: contract.status,
  };
  const wsContract = XLSX.utils.json_to_sheet([contractRow], {
    header: [...CONTRACT_FIELDS],
  });
  XLSX.utils.book_append_sheet(wb, wsContract, "Contract");

  // ---- Sheet 5: Resources_Raw (importable JSON columns)
  const resourceRawRows = resources.map((r, idx) => ({
    sort_order: Number(r.sort_order ?? idx),
    designation_id: r.designation_id ? String(r.designation_id) : "",
    service_type_id: r.service_type_id ? String(r.service_type_id) : "",
    quantity: Number(r.quantity ?? 1),
    shift_hours: Number(r.shift_hours ?? 8) === 12 ? 12 : 8,
    payroll_day_base_id: r.payroll_day_base_id ? String(r.payroll_day_base_id) : "",
    components_json: JSON.stringify(r.components ?? []),
    benefits_json: JSON.stringify(r.benefits ?? []),
    deductions_json: JSON.stringify(r.deductions ?? []),
    employer_contributions_json: JSON.stringify(r.employer_contributions ?? []),
  }));
  const wsRaw = XLSX.utils.json_to_sheet(resourceRawRows, {
    header: [
      "sort_order",
      "designation_id",
      "service_type_id",
      "quantity",
      "shift_hours",
      "payroll_day_base_id",
      "components_json",
      "benefits_json",
      "deductions_json",
      "employer_contributions_json",
    ],
  });
  XLSX.utils.book_append_sheet(wb, wsRaw, "Resources_Raw");

  XLSX.writeFile(wb, `${contract.contractCode || "contract"}.xlsx`);
}

type ImportedContract = {
  contractRow: Record<string, unknown>;
  resourceRows: Record<string, unknown>[];
};

function parseContractWorkbook(buf: ArrayBuffer): ImportedContract {
  const wb = XLSX.read(buf, { type: "array" });
  const cSheet = wb.Sheets["Contract"];
  if (!cSheet) throw new Error("Workbook is missing a 'Contract' sheet");
  const cRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(cSheet, {
    defval: "",
  });
  if (cRows.length === 0) throw new Error("'Contract' sheet has no rows");
  const contractRow = { ...cRows[0] };

  // Allow user to edit the human-readable Summary sheet (Contract Code, Status,
  // Description, GST Option). When those values diverge from the raw Contract
  // sheet, the Summary edits win — that's the sheet users actually look at.
  const sSheet = wb.Sheets["Summary"];
  if (sSheet) {
    const sRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sSheet, {
      header: 1,
      defval: "",
    }) as unknown as Array<Array<unknown>>;
    const sMap = new Map<string, string>();
    for (const row of sRows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const k = String(row[0] ?? "").trim();
      const v = row[1];
      if (k) sMap.set(k.toLowerCase(), v == null ? "" : String(v));
    }
    const apply = (label: string, field: string) => {
      const v = sMap.get(label.toLowerCase());
      if (v != null && v !== "") contractRow[field] = v;
    };
    apply("Contract Code", "contract_code");
    apply("Status", "status");
    apply("Description", "description");
    apply("GST Option", "gst_option");
    apply("Start Date", "start_date");
    apply("End Date", "end_date");
    apply("Expiry Date", "expiry_date");
  }

  // Summary values are human-readable ("Inactive", "CSGST", "1 to 30/31"),
  // but the DB has strict lowercase checks — normalise before use.
  contractRow.status = normalizeStatus(contractRow.status);
  contractRow.gst_option = normalizeGstOption(contractRow.gst_option);

  const rSheet = wb.Sheets["Resources_Raw"] ?? wb.Sheets["Resources"];
  const rRows = rSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(rSheet, { defval: "" })
    : [];
  return { contractRow, resourceRows: rRows };
}

function normalizeStatus(v: unknown): ContractStatus {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "active" || s === "inactive" || s === "expired") return s;
  if (s === "lost" || s === "rejected" || s === "pending") return "inactive";
  return "active";
}

function normalizeGstOption(v: unknown): "csgst" | "igst" | "none" {
  const s = String(v ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("igst")) return "igst";
  if (s === "none" || s === "na" || s === "") return s === "" ? "csgst" : "none";
  return "csgst";
}

/** Supabase errors are plain objects, not Error instances — surface their text. */
function importErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length) return `${parts.join(" — ")}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Import failed";
}


function safeJsonArray(v: unknown): unknown[] {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(String(v));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** Read-only look at what an uploaded workbook would do, before touching the DB. */
async function inspectContractWorkbook(buf: ArrayBuffer): Promise<{
  code: string;
  unitId: string;
  existing: { id: string; status: string; unitId: string } | null;
}> {
  const { contractRow } = parseContractWorkbook(buf);
  const code = String(contractRow.contract_code ?? "").trim();
  if (!code) throw new Error("Missing contract_code in workbook");
  const unitId = String(contractRow.unit_id ?? "").trim();
  if (!unitId) throw new Error("Missing unit_id in workbook");

  const { data, error } = await supabase
    .from("client_contracts" as never)
    .select("id, status, unit_id")
    .eq("contract_code", code)
    .maybeSingle();
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  return {
    code,
    unitId,
    existing: row
      ? {
          id: String(row.id),
          status: String(row.status ?? ""),
          unitId: String(row.unit_id ?? ""),
        }
      : null,
  };
}

async function importContractFromXlsx(buf: ArrayBuffer): Promise<{
  action: "created" | "updated";
  contractCode: string;
}> {
  const { contractRow, resourceRows } = parseContractWorkbook(buf);
  const code = String(contractRow.contract_code ?? "").trim();
  if (!code) throw new Error("Missing contract_code in workbook");
  const unitId = String(contractRow.unit_id ?? "").trim();
  if (!unitId) throw new Error("Missing unit_id in workbook");

  const row = {
    contract_code: code,
    unit_id: unitId,
    start_date: contractRow.start_date ? String(contractRow.start_date) : null,
    end_date: contractRow.end_date ? String(contractRow.end_date) : null,
    expiry_date: contractRow.expiry_date ? String(contractRow.expiry_date) : null,
    description: String(contractRow.description ?? ""),
    service_type_id: contractRow.service_type_id ? String(contractRow.service_type_id) : null,
    payroll_window_id: contractRow.payroll_window_id ? String(contractRow.payroll_window_id) : null,
    billing_type_id: contractRow.billing_type_id ? String(contractRow.billing_type_id) : null,
    
    gst_option: normalizeGstOption(contractRow.gst_option),
    status: normalizeStatus(contractRow.status),
    // Imported client contracts must land in the Clients tab, not as prospects
    // (the column default is 'prospect').
    record_type: "client",
    approval_status: "approved",
    prospect_stage: "closed",
  };


  const existing = await supabase
    .from("client_contracts" as never)
    .select("id")
    .eq("contract_code", code)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const existingId = existing.data
    ? String((existing.data as Record<string, unknown>).id)
    : null;

  // One active contract per unit — an import must never create a second one.
  if (row.status === "active") {
    await assertSingleActiveContract(unitId, existingId);
  }

  let contractId: string;
  let action: "created" | "updated";
  if (existingId) {
    contractId = existingId;
    const upd = await supabase
      .from("client_contracts" as never)
      .update(row as never)
      .eq("id", contractId);
    if (upd.error) throw upd.error;
    action = "updated";
  } else {
    const ins = await supabase
      .from("client_contracts" as never)
      .insert(row as never)
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    contractId = String((ins.data as Record<string, unknown>).id);
    action = "created";
  }


  const resources: ContractResource[] = resourceRows.map((r) => ({
    designationId: String(r.designation_id ?? ""),
    serviceTypeId: String(r.service_type_id ?? ""),
    quantity: Number(r.quantity ?? 1) || 1,
    shiftHours: Number(r.shift_hours ?? 8) === 12 ? 12 : 8,
    payrollDayBaseId: r.payroll_day_base_id ? String(r.payroll_day_base_id) : null,
    billingDayBaseId: r.billing_day_base_id ? String(r.billing_day_base_id) : null,
    components: safeJsonArray(r.components_json) as ResourceComponent[],
    benefits: safeJsonArray(r.benefits_json) as BenefitItem[],
    deductions: safeJsonArray(r.deductions_json) as BenefitItem[],
    employerContributions: safeJsonArray(r.employer_contributions_json) as BenefitItem[],
  }));
  await persistResources(contractId, resources);

  void logActivity({
    module: "Client Contracts",
    action: action === "created" ? "import-create" : "import-update",
    entityType: "client_contracts",
    entityId: contractId,
    entityLabel: code,
  });

  return { action, contractCode: code };
}

function ClientContractsPage() {
  const qc = useQueryClient();
  const {
    items,
    isLoading,
    error,
    refetch,
    addMut,
    updateMut,
    deleteMut,
    duplicateMut,
    updateStageMut,
    resubmitMut,
  } = useContracts();
  const { can, roleKey, isSuperAdmin } = useCurrentPermissions();
  // Super Admin always retains full control over every existing contract.
  const canApprove = isSuperAdmin || can("contracts", "approve");
  const canEdit = isSuperAdmin || can("contracts", "edit");
  const canDelete = isSuperAdmin || can("contracts", "delete");
  const isHrReadOnly = !isSuperAdmin && roleKey === "hr";
  const units = useMemo(
    () => Array.from(new Map(items.filter((item) => item.unitId).map((item) => [item.unitId, {
      id: item.unitId,
      code: item.unitCode ?? "",
      name: item.unitName ?? "—",
      customerId: item.orgId || null,
    }])).values()),
    [items],
  );
  const customers = useMemo(
    () => Array.from(new Map(items.filter((item) => item.orgId).map((item) => [item.orgId, {
      id: item.orgId ?? "",
      name: item.orgName ?? "—",
    }])).values()).sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [unitFilter, setUnitFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [windowFilter, setWindowFilter] = useState<string>("all");
  const payrollWindows = usePayrollWindows();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientContract | null>(null);
  const [deleting, setDeleting] = useState<ClientContract | null>(null);
  const [viewing, setViewing] = useState<
    (ClientContract & { unitName?: string; unitCode?: string; orgName?: string }) | null
  >(null);
  const [renewalOnly, setRenewalOnly] = useState(false);

  const [tab, setTab] = useState<RecordType>("client");
  const [approvalTarget, setApprovalTarget] = useState<{
    contract: ClientContract;
    mode: ApprovalMode;
  } | null>(null);

  // Deep-link from the leadership dashboard: /admin/contracts/client-contracts?status=lost
  const search = Route.useSearch();
  const appliedDeepLink = useRef(false);
  useEffect(() => {
    if (appliedDeepLink.current) return;
    if (!search.status && !search.tab && !search.renewals) return;
    appliedDeepLink.current = true;
    if (search.tab && !isHrReadOnly) setTab(search.tab);
    if (search.status) setStatusFilter([search.status]);
    if (search.renewals) {
      setTab("client");
      setStatusFilter([]);
      setRenewalOnly(true);
    }
    if (search.unit) {
      setTab("client");
      setUnitFilter([search.unit]);
    }
  }, [search.status, search.tab, search.renewals, search.unit]);


  const enriched = useMemo(() => {
    return items.map((c) => {
      const unit = unitById.get(c.unitId);
      const org = unit?.customerId ? customerById.get(unit.customerId) : undefined;
      return {
        ...c,
        unitName: c.unitName ?? unit?.name ?? "—",
        unitCode: c.unitCode ?? unit?.code ?? "",
        orgName: c.orgName ?? org?.name ?? "—",
        orgId: c.orgId ?? org?.id ?? "",
      };
    });
  }, [items, unitById, customerById]);

  // Renewal window: contracts whose next renewal / expiry date falls between
  // today and six months from today.
  const renewalWindow = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: addMonthsISO(today, 6) };
  }, []);

  const isUpForRenewal = (c: { recordType: RecordType; status: ContractStatus; expiryDate: string; endDate: string }) => {
    if (c.recordType !== "client") return false;
    if (c.status !== "active") return false;
    const due = c.expiryDate || c.endDate;
    if (!due) return false;
    return due >= renewalWindow.from && due <= renewalWindow.to;
  };

  const stateOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of enriched) {
      const label = (c.stateLabel ?? "").trim();
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ value: label, label }));
  }, [enriched]);

  const cityOptions = useMemo(() => {
    const selected = new Set(stateFilter.map((s) => s.toLowerCase()));
    const seen = new Map<string, string>();
    for (const c of enriched) {
      const state = (c.stateLabel ?? "").trim();
      if (selected.size && !selected.has(state.toLowerCase())) continue;
      const label = (c.cityLabel ?? "").trim();
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ value: label, label }));
  }, [enriched, stateFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const stateSet = new Set(stateFilter.map((s) => s.toLowerCase()));
    const citySet = new Set(cityFilter.map((s) => s.toLowerCase()));
    return enriched.filter((c) => {
      if (c.recordType !== tab) return false;
      if (renewalOnly && !isUpForRenewal(c)) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(deriveStatus(c))) return false;
      if (orgFilter.length > 0 && !orgFilter.includes(c.orgId)) return false;
      if (unitFilter.length > 0 && !unitFilter.includes(c.unitId)) return false;
      if (stateSet.size && !stateSet.has((c.stateLabel ?? "").trim().toLowerCase())) return false;
      if (citySet.size && !citySet.has((c.cityLabel ?? "").trim().toLowerCase())) return false;
      if (windowFilter !== "all" && (c.payrollWindowId ?? "") !== windowFilter) return false;
      if (!q) return true;
      return (
        c.contractCode.toLowerCase().includes(q) ||
        c.prospectCode.toLowerCase().includes(q) ||
        c.unitName.toLowerCase().includes(q) ||
        c.unitCode.toLowerCase().includes(q) ||
        c.orgName.toLowerCase().includes(q) ||
        (c.stateLabel ?? "").toLowerCase().includes(q) ||
        (c.cityLabel ?? "").toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, query, statusFilter, orgFilter, unitFilter, stateFilter, cityFilter, windowFilter, tab, renewalOnly, renewalWindow]);

  const pg = usePagination(filtered);

  const renewalCount6m = useMemo(
    () => items.filter(isUpForRenewal).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, renewalWindow],
  );

  const hasFilters =
    !!query || orgFilter.length > 0 || unitFilter.length > 0 || statusFilter.length > 0 || stateFilter.length > 0 || cityFilter.length > 0 || windowFilter !== "all" || renewalOnly;


  const tabCounts = useMemo(() => {
    let prospects = 0;
    let clients = 0;
    for (const c of items) {
      if (c.recordType === "client") clients++;
      else prospects++;
    }
    return { prospects, clients };
  }, [items]);

  // Merged stats — one status vocabulary across clients AND prospects.
  const statusCounts = useMemo(() => {
    const empty = (): Record<UnifiedStatus, number> => ({
      active: 0,
      inactive: 0,
      expired: 0,
      pending_approval: 0,
      lost: 0,
    });
    const client = empty();
    const prospect = empty();
    const all = empty();
    for (const c of items) {
      const s = deriveStatus(c);
      all[s]++;
      if (c.recordType === "client") client[s]++;
      else prospect[s]++;
    }
    return { client, prospect, all };
  }, [items]);

  // Clicking a KPI tile filters by that status, and jumps to whichever tab
  // actually holds those records.
  const applyStatusTile = (s: UnifiedStatus) => {
    setRenewalOnly(false);
    setStatusFilter((prev) => (prev.length === 1 && prev[0] === s ? [] : [s]));
    if (statusFilter.length === 1 && statusFilter[0] === s) return;
    if (statusCounts[tab][s] === 0) {
      const other: RecordType = tab === "client" ? "prospect" : "client";
      if (statusCounts[other][s] > 0) setTab(other);
    }
  };

  const overview = useMemo(() => {
    return {
      total: items.length,
      ...statusCounts.all,
    };
  }, [items, statusCounts]);

  return (
    <div>
      <PageHeader
        title="Client Contracts"
        eyebrow="Contracts"
        description={isHrReadOnly ? "View contracts across organisations and clients." : "Manage contracts across organisations and clients."}
        crumbs={[{ label: "Contracts" }, { label: "Client Contracts" }]}
        kpis={
          <>
            <PageStat label="Clients + Prospects" value={isLoading ? "—" : overview.total} />
            <PageStat
              label="Active"
              value={isLoading ? "—" : overview.active}
              tone="accent"
              active={statusFilter.length === 1 && statusFilter[0] === "active"}
              onClick={() => applyStatusTile("active")}
            />
            <PageStat
              label="Renewals ≤ 6 months"
              value={isLoading ? "—" : renewalCount6m}
              tone="warning"
              active={renewalOnly}
              onClick={() => {
                setTab("client");
                setStatusFilter([]);
                setRenewalOnly((v) => !v);
              }}
            />
            <PageStat
              label="Inactive"
              value={isLoading ? "—" : overview.inactive}
              tone="warning"
              active={statusFilter.length === 1 && statusFilter[0] === "inactive"}
              onClick={() => applyStatusTile("inactive")}
            />
            <PageStat
              label="Expired"
              value={overview.expired}
              tone="destructive"
              active={statusFilter.length === 1 && statusFilter[0] === "expired"}
              onClick={() => applyStatusTile("expired")}
            />
            <PageStat
              label="Pending Approval"
              value={overview.pending_approval}
              tone="warning"
              active={statusFilter.length === 1 && statusFilter[0] === "pending_approval"}
              onClick={() => applyStatusTile("pending_approval")}
            />
            <PageStat
              label="Lost"
              value={overview.lost}
              tone="destructive"
              active={statusFilter.length === 1 && statusFilter[0] === "lost"}
              onClick={() => applyStatusTile("lost")}
            />


          </>
        }
      />





      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as RecordType);
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="client">
            Clients <span className="ml-1.5 text-xs text-muted-foreground">({tabCounts.clients})</span>
          </TabsTrigger>
          {!isHrReadOnly && (
            <TabsTrigger value="prospect">
              Prospects <span className="ml-1.5 text-xs text-muted-foreground">({tabCounts.prospects})</span>
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <div className="mobile-directory-toolbar mb-3 grid grid-cols-2 items-center gap-1.5 rounded-xl border border-border/60 bg-card/70 p-2 sm:mb-4 sm:flex sm:flex-wrap sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        <div className="col-span-2 grid min-w-0 grid-cols-1 items-center gap-2 sm:mr-auto sm:flex">
          <Select value={windowFilter} onValueChange={setWindowFilter}>
            <SelectTrigger className="h-10 w-full rounded-xl sm:w-[220px]">
              <SelectValue placeholder="All payroll windows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payroll windows</SelectItem>
              {payrollWindows.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.label} ({w.windowStartDay}–{w.windowEndDay})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {windowFilter !== "all" && (
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary sm:inline-flex">
              {filtered.length} contract{filtered.length === 1 ? "" : "s"} in this window — matches
              Attendance, Payroll &amp; Invoicing scope
            </span>
          )}
        </div>
        <Button
          variant="outline"
          disabled={filtered.length === 0}
          onClick={() =>
            downloadCsv(
              "client-contracts",
              filtered.map((c) => ({
                code: c.contractCode,
                organization: c.orgName,
                unit: `${c.unitCode} – ${c.unitName}`,
                start: csvDate(c.startDate),
                end: csvDate(c.endDate),
                description: c.description,
                gst: c.gstOption.toUpperCase(),
                status: STATUS_LABEL[deriveStatus(c)],
              })),
              [
                { key: "code", header: "Contract ID" },
                { key: "organization", header: "Organization" },
                { key: "unit", header: "Client" },
                { key: "start", header: "Start date" },
                { key: "end", header: "End date" },
                { key: "description", header: "Description" },
                { key: "gst", header: "GST option" },
                { key: "status", header: "Status" },
              ],
            )
          }
          className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:px-4 sm:text-sm"
        >
          <Download className="mr-1.5 h-4 w-4" />
          <span className="sm:hidden">Export</span><span className="hidden sm:inline">Export Contracts</span>
        </Button>
        {canEdit && (
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const buf = await file.arrayBuffer();
              const peek = await inspectContractWorkbook(buf);
              if (peek.existing) {
                const unitLabel = unitById.get(peek.existing.unitId)?.name ?? "";
                const ok = await confirmAction({
                  title: "Update an existing contract?",
                  description: `Contract ${peek.code}${unitLabel ? ` (${unitLabel})` : ""} already exists and is currently ${peek.existing.status}. Importing this file will OVERWRITE its details and replace all of its resource lines. This cannot be undone.`,
                  confirmText: "Yes, update it",
                  cancelText: "Cancel",
                  destructive: true,
                });
                if (!ok) return;
              }
              const res = await importContractFromXlsx(buf);
              toast.success(
                `Contract ${res.contractCode} ${res.action === "created" ? "imported" : "updated"} from Excel`,
              );
              await qc.invalidateQueries({ queryKey: QK });

            } catch (err) {
              console.error("[contract import]", err);
              toast.error(importErrorMessage(err));

            }
            }}
          />
        )}
        {canEdit && (
          <>
            <Button
              variant="outline"
              onClick={() => importInputRef.current?.click()}
              className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:px-4 sm:text-sm"
            >
              <Upload className="mr-1.5 h-4 w-4" />
              <span className="sm:hidden">Import</span><span className="hidden sm:inline">Import Contract</span>
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="h-9 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 sm:h-10 sm:px-4 sm:text-sm"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              <span className="sm:hidden">Create</span><span className="hidden sm:inline">Create Contract</span>
            </Button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="mobile-directory-filters mb-4 rounded-xl border border-border bg-card p-2 sm:rounded-2xl sm:p-4">
        <div className="grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(5,minmax(0,180px))_auto]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by contract ID, client, organisation…"
              className="h-10 rounded-lg pl-9"
            />
          </div>
          <MultiSelectFilter
            selected={orgFilter}
            onChange={(v) => {
              setOrgFilter(v);
              setUnitFilter([]);
            }}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
            allLabel="All organizations"
          />
          <MultiSelectFilter
            selected={unitFilter}
            onChange={setUnitFilter}
            options={units
              .filter((u) => orgFilter.length === 0 || (u.customerId != null && orgFilter.includes(u.customerId)))
              .map((u) => ({ value: u.id, label: `${u.code} – ${u.name}` }))}
            allLabel="All units"
          />
          <MultiSelectFilter
            selected={stateFilter}
            onChange={(v) => {
              setStateFilter(v);
              setCityFilter([]);
            }}
            options={stateOptions}
            allLabel="All states"
          />
          <MultiSelectFilter
            selected={cityFilter}
            onChange={setCityFilter}
            options={cityOptions}
            allLabel="All cities"
          />
          <MultiSelectFilter
            selected={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            allLabel="All statuses"
          />
          <Button
            variant="outline"
            className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:px-4 sm:text-sm"
            disabled={!hasFilters}
            onClick={() => {
              setQuery("");
              setOrgFilter([]);
              setUnitFilter([]);
              setStateFilter([]);
              setCityFilter([]);
              setStatusFilter([]);
              setWindowFilter("all");
              setRenewalOnly(false);
            }}
          >
            <X className="mr-1.5 h-4 w-4" /> Clear
          </Button>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {isLoading ? (
            "Loading contracts…"
          ) : error ? (
            "Contracts could not be loaded."
          ) : (
            <>Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {items.length} contracts</>
          )}
          {renewalOnly && (
            <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600">
              Up for renewal by {renewalWindow.to}
            </span>
          )}
        </div>

      </div>

      <div className="ios-table-card overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-clip">
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3" data-col="code">{tab === "client" ? "Contract ID" : "Prospect ID"}</th>
                <th className="px-5 py-3">Organization</th>
                <th className="px-5 py-3">Client</th>
                {tab === "client" ? (
                  <>
                    <th className="px-5 py-3" data-col="date">Start</th>
                    <th className="px-5 py-3" data-col="date">End</th>
                  </>
                ) : (
                  <th className="px-5 py-3" data-col="date">Start</th>
                )}
                <th className="px-5 py-3" data-col="status">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-accent" data-col="code">
                    {tab === "client" ? c.contractCode : c.prospectCode}
                  </td>
                  <td className="px-5 py-3 font-medium text-foreground">
                    <span className="cell-primary">{c.orgName}</span>
                  </td>
                  <td className="px-5 py-3 text-foreground">
                    <div className="cell-stack">
                      <span className="cell-secondary font-mono">{c.unitCode}</span>
                      <span className="cell-primary">{c.unitName}</span>
                    </div>
                  </td>
                  {tab === "client" ? (
                  <>
                    <td className="px-5 py-3 text-muted-foreground" data-col="date">{c.startDate || "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground" data-col="date">{c.endDate || "—"}</td>
                  </>
                ) : (
                  <td className="px-5 py-3 text-muted-foreground" data-col="date">
                    {c.startDate || "—"}
                  </td>
                )}
                <td className="px-5 py-3" data-col="status">
                    <StatusBadge
                      status={deriveStatus(c)}
                      reason={c.approvalStatus === "rejected" ? c.rejectionReason : ""}
                    />
                  </td>
                  <td className="px-5 py-3 text-right" data-col="actions">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-accent"
                        onClick={() => setViewing(c)}
                        aria-label="View contract"
                        title="View contract"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-accent"
                        onClick={async () => {
                          try {
                            await exportContractToXlsx(c);
                            toast.success(`Exported ${c.contractCode || c.prospectCode}.xlsx`);
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Export failed");
                          }
                        }}
                        aria-label="Export to Excel"
                        title="Export to Excel"
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-accent"
                          disabled={duplicateMut.isPending}
                          onClick={async () => {
                            try {
                              const res = await duplicateMut.mutateAsync(c.id);
                              toast.success(`Duplicated as ${res.code} (inactive)`);
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Duplicate failed");
                            }
                          }}
                          aria-label="Duplicate contract"
                          title="Duplicate contract"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <DeleteGuardButton
                          id={c.id}
                          entityLabel="contract"
                          checks={[
                            { table: "contract_resources", column: "contract_id", label: "resource lines" },
                          ]}
                          onDelete={() => setDeleting(c)}
                        />
                      )}
                      {tab === "prospect" &&
                        c.approvalStatus === "pending" &&
                        c.prospectStage !== "lost" &&
                        canApprove && (
                          <>
                            <Button
                              size="icon"
                              data-variant="success"
                              className="h-8 w-8 rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                              onClick={() => setApprovalTarget({ contract: c, mode: "approve" })}
                              title="Approve & sign — promote to client"
                              aria-label="Approve"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              data-variant="danger"
                              variant="outline"
                              className="h-8 w-8 rounded-full border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                              onClick={() => setApprovalTarget({ contract: c, mode: "reject" })}
                              title="Reject"
                              aria-label="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      {tab === "prospect" &&
                        c.approvalStatus === "rejected" &&
                        c.prospectStage !== "lost" &&
                        canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-muted-foreground hover:text-accent"
                            onClick={() =>
                              resubmitMut.mutate({ id: c.id, prospectCode: c.prospectCode })
                            }
                            title="Resubmit this prospect for approval"
                            aria-label="Resubmit"
                          >
                            <RefreshCcw className="h-4 w-4" />
                          </Button>
                        )}
                      {tab === "prospect" && canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "text-muted-foreground",
                            c.prospectStage === "lost" && "text-rose-600",
                          )}
                          onClick={() =>
                            updateStageMut.mutate({
                              id: c.id,
                              stage: c.prospectStage === "lost" ? "new" : "lost",
                              label: c.contractCode || c.prospectCode,
                            })
                          }
                          title={
                            c.prospectStage === "lost"
                              ? "Restore from Lost"
                              : "Mark as Lost"
                          }
                          aria-label="Mark Lost"
                        >
                          <Flag className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    Loading contracts…
                  </td>
                </tr>
              )}
              {!isLoading && error && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-destructive">
                    <ShieldAlert className="mx-auto mb-2 h-6 w-6" />
                    <p>{error instanceof Error ? error.message : "Contracts could not be loaded."}</p>
                    <Button className="mt-4" variant="outline" onClick={() => void refetch()}>
                      <RefreshCcw className="mr-1.5 h-4 w-4" /> Try again
                    </Button>
                  </td>
                </tr>
              )}
              {!isLoading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    {items.length === 0
                      ? "No contracts yet. Create your first contract to get started."
                      : tab === "prospect"
                        ? "No prospects match your filters."
                        : "No clients match your filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      </div>

      <ContractFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
        editing={editing}
        existingProspectCodes={items.map((i) => i.prospectCode).filter((c): c is string => !!c)}
        onSubmit={async (p, resources) => {
          try {
            let contractId: string;
            if (editing) {
              await updateMut.mutateAsync({
                id: editing.id,
                p,
                canApproveApproval: canApprove || isSuperAdmin,
              });
              contractId = editing.id;
            } else {
              contractId = await addMut.mutateAsync(p);
            }
            await persistResources(contractId, resources);
            await qc.invalidateQueries({ queryKey: ["admin", "contract-resources", contractId] });
            await qc.invalidateQueries({ queryKey: ["contract-designation-follow-up"] });
            void notifySaved({ title: "Saved", description: editing ? "Contract updated" : "Contract created" });
            return null;
          } catch (e) {
            console.error("[contract-save] failed", e);
            const err = e as { message?: string; details?: string; hint?: string; code?: string } | null;
            const parts = [err?.message, err?.details, err?.hint, err?.code ? `(${err.code})` : ""].filter(
              (x): x is string => !!x && x.trim().length > 0,
            );
            return parts.length ? parts.join(" · ") : "Could not save contract";
          }
        }}
        canManageApproval={canApprove}
        canSkipSteps={isSuperAdmin}
      />

      <ContractViewDialog
        contract={viewing}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
        onEdit={(c) => {
          setViewing(null);
          setEditing(c);
          setFormOpen(true);
        }}
        canEdit={canEdit}
      />



      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contract?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <span className="font-mono font-semibold text-foreground">
                  {deleting.contractCode}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  await deleteMut.mutateAsync(deleting.id);
                  toast.success("Contract deleted");
                  setDeleting(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContractApprovalDialog
        open={!!approvalTarget}
        onOpenChange={(o) => !o && setApprovalTarget(null)}
        mode={approvalTarget?.mode ?? "approve"}
        contract={
          approvalTarget
            ? {
                id: approvalTarget.contract.id,
                prospectCode: approvalTarget.contract.prospectCode,
                contractCode: approvalTarget.contract.contractCode,
                createdBy: approvalTarget.contract.createdBy,
              }
            : null
        }
        onDone={() => {
          void qc.invalidateQueries({ queryKey: QK });
          setApprovalTarget(null);
        }}
      />
    </div>
  );
}

function StatusBadge({ status, reason }: { status: UnifiedStatus; reason?: string }) {
  const map: Record<UnifiedStatus, string> = {
    active: "bg-accent/15 text-accent",
    inactive: "bg-muted text-muted-foreground",
    expired: "bg-destructive/15 text-destructive",
    pending_approval: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    lost: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
          map[status],
        )}
        title={reason || undefined}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {STATUS_LABEL[status]}
      </span>
      {reason ? (
        <span className="max-w-[220px] truncate text-[11px] text-destructive/80" title={reason}>
          {reason}
        </span>
      ) : null}
    </div>
  );
}

type ViewContract = ClientContract & {
  unitName?: string;
  unitCode?: string;
  orgName?: string;
};

function ViewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value || "—"}</div>
    </div>
  );
}

function money(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN")}`;
}

function ContractViewDialog({
  contract,
  onOpenChange,
  onEdit,
  canEdit,
}: {
  contract: ViewContract | null;
  onOpenChange: (o: boolean) => void;
  onEdit: (c: ViewContract) => void;
  canEdit: boolean;
}) {
  const resources = useContractResources(contract?.id ?? null);
  const designations = useDesignations();
  const serviceTypes = useServiceTypes();
  const payrollWindows = usePayrollWindows();
  const billingTypes = useBillingTypes();
  const payrollDayBases = usePayrollDayBases();
  const costComponents = useCostComponentOptions();
  const allowanceTypes = useAllowanceTypes();

  const componentDescriptions = useMemo(() => {
    const descriptions: Record<string, string> = {};
    for (const component of costComponents) {
      if (component.description) descriptions[component.id] = String(component.description);
    }
    for (const allowance of allowanceTypes) {
      const description = (allowance as { description?: string | null }).description;
      if (description) descriptions[allowance.id] = String(description);
    }
    return descriptions;
  }, [allowanceTypes, costComponents]);

  const designationName = (id: string) =>
    designations.find((d) => d.id === id)?.name ?? "—";
  const serviceTypeName = (id: string | null) =>
    serviceTypes.find((s) => s.id === id)?.name ?? "—";

  if (!contract) return null;

  const isClient = contract.recordType === "client";

  return (
    <Dialog open={!!contract} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:w-[calc(100vw-3rem)] sm:max-w-6xl xl:max-w-7xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">
              {isClient ? contract.contractCode : contract.prospectCode}
            </span>
            <StatusBadge status={deriveStatus(contract)} />
          </DialogTitle>
          <DialogDescription>
            {contract.orgName} · {contract.unitCode} {contract.unitName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-3">
          <ViewRow label="Organisation" value={contract.orgName} />
          <ViewRow label="Client" value={`${contract.unitCode ?? ""} ${contract.unitName ?? ""}`.trim()} />
          <ViewRow label="Service type" value={serviceTypeName(contract.serviceTypeId)} />
          <ViewRow label="Start date" value={contract.startDate} />
          <ViewRow label="End date" value={contract.endDate} />
          <ViewRow label="Next renewal / expiry" value={contract.expiryDate} />
          <ViewRow label="Original start" value={contract.originalStartDate} />
          <ViewRow label="Renewals so far" value={String(contract.renewalCount ?? 0)} />
          <ViewRow label="GST option" value={contract.gstOption?.toUpperCase()} />
          <ViewRow
            label="Payroll window"
            value={payrollWindows.find((p) => p.id === contract.payrollWindowId)?.label ?? "—"}
          />
          <ViewRow
            label="Billing type"
            value={billingTypes.find((b) => b.id === contract.billingTypeId)?.name ?? "—"}
          />
        </div>

        {contract.description ? (
          <div className="mt-2">
            <ViewRow label="Description" value={contract.description} />
          </div>
        ) : null}

        <div className="mt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Resource lines ({resources.length})
          </div>
          {resources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No resource lines on this contract.
            </div>
          ) : (
            <div className="space-y-5">
              {resources.map((r, idx) => {
                return (
                  <div key={r.id ?? idx} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
                      <div className="text-sm font-semibold text-foreground">
                        {designationName(r.designationId)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Qty {r.quantity} · {serviceTypeName(r.serviceTypeId)} · {r.shiftHours}-hour shift
                        </span>
                      </div>
                    </div>
                    <SalaryBreakdownTable
                      designationName={designationName(r.designationId)}
                      payrollDayBase={payrollDayBases.find((base) => base.id === r.payrollDayBaseId)}
                      components={r.components ?? []}
                      benefits={r.benefits ?? []}
                      deductions={r.deductions ?? []}
                      employerContributions={r.employerContributions ?? []}
                      componentDescriptions={componentDescriptions}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canEdit && (
            <Button onClick={() => onEdit(contract)}>
              <Edit2 className="mr-1.5 h-4 w-4" />
              Edit contract
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function ContractFormDialog({
  open,
  onOpenChange,
  editing,
  existingProspectCodes,
  onSubmit,
  canManageApproval,
  canSkipSteps = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ClientContract | null;
  existingProspectCodes: string[];
  onSubmit: (
    p: Omit<ClientContract, "id">,
    resources: ContractResource[],
  ) => Promise<string | null>;
  canManageApproval: boolean;
  canSkipSteps?: boolean;
}) {
  const { units, customers } = useContractDirectory(open);
  const serviceTypes = useServiceTypes();
  const payrollWindows = usePayrollWindows();
  const billingTypes = useBillingTypes();
  

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const [contractCode, setContractCode] = useState("");
  const [prospectCode, setProspectCode] = useState("");
  const [unitId, setUnitId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [originalStartDate, setOriginalStartDate] = useState("");
  const [renewalCount, setRenewalCount] = useState(0);
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const endDateInputRef = useRef<HTMLInputElement | null>(null);
  const expiryDateInputRef = useRef<HTMLInputElement | null>(null);
  const expiryManuallySetRef = useRef(false);
  // Dates the user has touched must never be overwritten by the unit auto-fill,
  // which can resolve after the dialog is already open and mid-edit.
  const datesTouchedRef = useRef(false);
  const [description, setDescription] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [payrollWindowId, setPayrollWindowId] = useState<string>("");
  const [billingTypeId, setBillingTypeId] = useState<string>("");
  
  const [gstOption, setGstOption] = useState<GstOption>("csgst");
  const [approvalValue, setApprovalValue] = useState<ApprovalPickerValue>(null);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [unitQuery, setUnitQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [stepKey, setStepKey] = useState("client");
  const [resources, setResources] = useState<ContractResource[]>([]);
  const [savedResourcesSnapshot, setSavedResourcesSnapshot] = useState("[]");
  const [hasStagedResourceChanges, setHasStagedResourceChanges] = useState(false);
  const [resourceDialog, setResourceDialog] = useState<{
    open: boolean;
    index: number | null;
    initial: ContractResource | null;
  }>({ open: false, index: null, initial: null });

  const existingResources = useContractResources(editing?.id ?? null);
  const existingResourcesSnapshot = useMemo(
    () => serializeContractResources(existingResources),
    [existingResources],
  );
  const resourcesSnapshot = useMemo(() => serializeContractResources(resources), [resources]);
  const qc = useQueryClient();

  const auditQ = useQuery({
    queryKey: ["contract-audit", editing?.id],
    enabled: !!editing?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_contracts" as never)
        .select(
          "approval_status,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,company_signature_data,signed_at",
        )
        .eq("id", editing!.id)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      const lookup = async (uid: string | null) => {
        if (!uid) return null;
        const { data: n } = await supabase.rpc("get_user_display_name" as never, {
          _user_id: uid,
        } as never);
        const arr = n as Array<{ full_name?: string; role_key?: string }> | null;
        return arr && arr[0] ? arr[0] : null;
      };
      const approver = await lookup((row?.approved_by as string | null) ?? null);
      const rejecter = await lookup((row?.rejected_by as string | null) ?? null);
      return { row, approver, rejecter };
    },
  });
  const audit = auditQ.data;

  // Reset when opened
  useEffect(() => {
    if (!open) return;
    datesTouchedRef.current = false;
    if (editing) {
      setContractCode(editing.contractCode);
      setProspectCode(editing.prospectCode);
      setUnitId(editing.unitId);
      setStartDate(editing.startDate);
      setEndDate(editing.endDate);
      setExpiryDate(editing.expiryDate);
      setOriginalStartDate(editing.originalStartDate || editing.startDate || "");
      setRenewalCount(editing.renewalCount ?? 0);
      expiryManuallySetRef.current = !!editing.expiryDate;
      setDescription(editing.description);
      setServiceTypeId(editing.serviceTypeId ?? "");
      setPayrollWindowId(editing.payrollWindowId ?? "");
      setBillingTypeId(editing.billingTypeId ?? "");
      
      setGstOption(editing.gstOption);
      setApprovalValue(getApprovalPickerValue(editing));
    } else {
      setContractCode("");
      setProspectCode(nextProspectCode(existingProspectCodes));
      setUnitId("");
      setStartDate("");
      setEndDate("");
      setExpiryDate("");
      setOriginalStartDate("");
      setRenewalCount(0);
      expiryManuallySetRef.current = false;
      setDescription("");
      setServiceTypeId("");
      setPayrollWindowId("");
      setBillingTypeId("");
      
      setGstOption("csgst");
      setApprovalValue(null);
    }
    setResources([]);
    setSavedResourcesSnapshot("[]");
    setHasStagedResourceChanges(false);
    setStepKey("client");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Auto-derive expiry date = start date + 6 months (unless user manually overrode).
  useEffect(() => {
    if (!open) return;
    if (!startDate) return;
    if (expiryManuallySetRef.current) return;
    const derived = addMonthsISO(startDate, 6);
    setExpiryDate((prev) => (prev === derived ? prev : derived));
  }, [startDate, open]);

  // Total renewal checkpoints over the whole contract span (one every 6 months).
  const totalRenewalCheckpoints = useMemo(() => {
    const months = monthsBetweenISO(startDate, endDate);
    if (months <= 0) return 0;
    return Math.max(1, Math.floor(months / 6));
  }, [startDate, endDate]);
  const currentCheckpoint = Math.min(totalRenewalCheckpoints || 0, (renewalCount ?? 0) + 1);

  // Hydrate existing resources when editing
  useEffect(() => {
    if (!open || !editing || existingResources.length === 0) return;
    const clonedResources = existingResources.map(cloneContractResource);
    const snapshot = serializeContractResources(clonedResources);
    if (resources.length > 0 && resourcesSnapshot !== savedResourcesSnapshot) return;
    if (resourcesSnapshot === snapshot && savedResourcesSnapshot === snapshot) return;
    setResources(clonedResources);
    setSavedResourcesSnapshot(snapshot);
    setHasStagedResourceChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, existingResources.length, existingResourcesSnapshot, resources.length, resourcesSnapshot, savedResourcesSnapshot]);

  const selectedUnit = units.find((u) => u.id === unitId);
  const selectedOrg = selectedUnit?.customerId
    ? customerById.get(selectedUnit.customerId)
    : undefined;

  // Auto-fill contract start/end from the selected unit's contract period.
  // Never applies when editing an existing contract, and never once the user
  // has touched a date field — the unit list can resolve mid-edit and would
  // otherwise silently restore the old dates.
  useEffect(() => {
    if (!selectedUnit) return;
    if (editing) return;
    if (datesTouchedRef.current) return;
    if (selectedUnit.contractStartDate) {
      setStartDate((prev) => prev || selectedUnit.contractStartDate);
    }
    if (selectedUnit.contractEndDate) {
      setEndDate((prev) => prev || selectedUnit.contractEndDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit?.id, editing?.id]);
  const filteredUnits = useMemo(() => {
    const query = unitQuery.trim().toLowerCase();
    if (!query) return units;
    return units.filter((u) => {
      const org = u.customerId ? customerById.get(u.customerId) : null;
      return [u.code, u.name, org?.name ?? "", u.id]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [customerById, unitQuery, units]);

  const selectedWindow = payrollWindows.find((w) => w.id === payrollWindowId);
  const payDate = selectedWindow ? `Day ${selectedWindow.processingDay}` : "—";
  const billingDates = selectedWindow
    ? `${selectedWindow.windowStartDay} – ${selectedWindow.windowEndDay}`
    : "—";
  const resourceSaveBypassEnabled = hasStagedResourceChanges || resourcesSnapshot !== savedResourcesSnapshot;
  const steps: GuidedFormStep[] = [
    { key: "client", label: "Contract", caption: "Client, dates and approval" },
    { key: "payroll", label: "Payroll", caption: "Payroll window and billing type" },
    { key: "gst", label: "GST", caption: "Review statutory details and GST mode" },
    { key: "resources", label: "Resources", caption: "Roles, wages and contract costing" },
    { key: "review", label: "Review", caption: "Check the contract before saving" },
  ];
  const validateStep = (key: string) => {
    if (key === "client" && !unitId) return "Select a client";
    if (key === "resources" && resources.length === 0) return "Add at least one resource";
    return null;
  };
  const isStepComplete = (key: string): boolean => {
    if (key === "client" || key === "resources") return !validateStep(key);
    if (key === "payroll") return Boolean(payrollWindowId && billingTypeId);
    if (key === "gst") return Boolean(gstOption);
    return steps.slice(0, 4).every((step) => isStepComplete(step.key));
  };
  const requestStep = (key: string) => {
    // Super Admin moves freely between steps, even on a partially filled contract.
    if (canSkipSteps) { setStepKey(key); return; }
    const target = steps.findIndex((step) => step.key === key);
    for (let index = 0; index < target; index += 1) {
      const problem = validateStep(steps[index].key);
      if (problem) { toast.error(problem); setStepKey(steps[index].key); return; }
    }
    setStepKey(key);
  };
  const draftValue = useMemo(() => ({ contractCode, prospectCode, unitId, startDate, endDate, expiryDate, originalStartDate, renewalCount, description, serviceTypeId, payrollWindowId, billingTypeId, gstOption, resources }), [contractCode, prospectCode, unitId, startDate, endDate, expiryDate, originalStartDate, renewalCount, description, serviceTypeId, payrollWindowId, billingTypeId, gstOption, resources]);
  const restoreDraft = useCallback((draft: typeof draftValue) => {
    setContractCode(draft.contractCode); setProspectCode(draft.prospectCode); setUnitId(draft.unitId);
    setStartDate(draft.startDate); setEndDate(draft.endDate); setExpiryDate(draft.expiryDate);
    setOriginalStartDate(draft.originalStartDate); setRenewalCount(draft.renewalCount); setDescription(draft.description);
    setServiceTypeId(draft.serviceTypeId); setPayrollWindowId(draft.payrollWindowId); setBillingTypeId(draft.billingTypeId);
    setGstOption(draft.gstOption); setResources(draft.resources.map(cloneContractResource));
  }, []);
  const meaningfulDraft = useCallback((draft: typeof draftValue) => Boolean(draft.unitId || draft.startDate || draft.resources.length), []);
  const draft = useGuidedFormDraft({ open, storageKey: editing ? null : "rg-wizard-draft-contract", value: draftValue, onRestore: restoreDraft, isMeaningful: meaningfulDraft });
  const saveContract = async () => {
    if (!unitId) { toast.error("Select a client"); setStepKey("client"); return; }
    // Read date controls directly at submit time as well as from React state.
    // Native date pickers can retain a just-selected value until blur; relying
    // only on the preceding change event can otherwise submit the old date.
    const submittedStartDate = startDateInputRef.current?.value ?? startDate;
    const submittedEndDate = endDateInputRef.current?.value ?? endDate;
    const submittedExpiryDate = expiryDateInputRef.current?.value ?? expiryDate;
    const payload = applyApprovalPickerToPayload({
      contractCode, prospectCode, recordType: editing?.recordType ?? "prospect", unitId,
      startDate: submittedStartDate, endDate: submittedEndDate,
      expiryDate: submittedExpiryDate, originalStartDate: originalStartDate || submittedStartDate, renewalCount, description,
      serviceTypeId: serviceTypeId || null, payrollWindowId: payrollWindowId || null,
      billingTypeId: billingTypeId || null, gstOption, status: editing?.status ?? "inactive",
      approvalStatus: editing?.approvalStatus ?? "pending", prospectStage: editing?.prospectStage ?? "new",
      rejectionReason: editing?.rejectionReason ?? "", createdBy: editing?.createdBy ?? null,
      promotedAt: editing?.promotedAt ?? null,
    }, approvalValue, editing);
    const ok = await confirmAction({
      title: editing ? "Confirm changes?" : "Create contract?",
      description: editing ? "Save contract changes? Updates will apply to payroll." : "This will create the contract and save all resource details.",
      confirmText: editing ? "Yes, Save Changes" : "Create Contract", cancelText: "Review Again",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const resourcesToSave = resources.map(cloneContractResource);
      const err = await onSubmit(payload, resourcesToSave);
      if (err) toast.error(err);
      else { setSavedResourcesSnapshot(serializeContractResources(resourcesToSave)); setHasStagedResourceChanges(false); draft.clear(); onOpenChange(false); }
    } finally { setSaving(false); }
  };

  const closeGuard = useGuidedFormCloseGuard(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={closeGuard.onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl sm:border">
        <DialogHeader className="sr-only">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>{editing ? "Edit Contract" : "Create Contract"}</DialogTitle>
              <DialogDescription>
                Capture client information, payroll, billing and GST settings.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>


        <GuidedForm closeGuardRef={closeGuard.ref} title={editing ? "Edit contract" : "New contract"} steps={steps} stepKey={stepKey} onStepChange={requestStep} isStepComplete={isStepComplete} onCancel={() => onOpenChange(false)} onSaveDraft={editing ? undefined : () => { draft.save(); toast.success("Draft saved"); }} onSubmit={() => void saveContract()} saving={saving} submitLabel={editing ? "Save changes" : "Create contract"}>
        {draft.hasDraft && !editing && stepKey === "client" && <div className="mb-4 flex items-center justify-between rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm"><span className="text-muted-foreground">Saved draft available</span><Button size="sm" variant="outline" onClick={draft.restore}>Restore</Button></div>}
        <div className="modern-business-form space-y-5">
          <div className={stepKey === "client" ? "space-y-5" : "hidden"}>
          {/* Client Information */}
          <Section title="Client Information">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contract ID">
                <Input
                  value={editing && editing.recordType === "client" ? contractCode : prospectCode}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (editing && editing.recordType === "client") setContractCode(v);
                    else setProspectCode(v);
                  }}
                  className="font-mono"
                />
              </Field>
              <Field label="Unit ID *">
                <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className="h-10 w-full justify-between rounded-lg font-normal"
                    >
                      {selectedUnit ? (
                        <span className="truncate font-mono text-xs">
                          {selectedUnit.code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Search unit ID…</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search by unit ID or name…"
                        value={unitQuery}
                        onValueChange={setUnitQuery}
                      />
                      <CommandList className="max-h-64 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                        <CommandEmpty>No units found.</CommandEmpty>
                        <CommandGroup>
                          {filteredUnits.map((u) => {
                            const org = u.customerId ? customerById.get(u.customerId) : null;
                            return (
                              <CommandItem
                                key={u.id}
                                value={`${u.code} ${u.name} ${org?.name ?? ""} ${u.id}`}
                                onSelect={() => {
                                  setUnitId(u.id);
                                  setUnitQuery("");
                                  setUnitPickerOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    unitId === u.id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span className="font-mono text-xs font-semibold text-accent">
                                    {u.code}
                                  </span>
                                  <span className="text-sm">{u.name}</span>
                                  {org && (
                                    <span className="text-xs text-muted-foreground">
                                      {org.name}
                                    </span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </Field>
              <Field label="Unit Name">
                <Input value={selectedUnit?.name ?? ""} readOnly placeholder="Auto-filled" />
              </Field>
              <Field label="Organization Name">
                <Input value={selectedOrg?.name ?? ""} readOnly placeholder="Auto-filled" />
              </Field>
            </div>
          </Section>

          {/* Approval Audit Trail */}
          {editing && audit?.row ? (
            <Section title="Approval Audit Trail">
              {(() => {
                const r = audit.row as Record<string, unknown>;
                const status = String(r.approval_status ?? "pending");
                const approvedAt = r.approved_at as string | null;
                const rejectedAt = r.rejected_at as string | null;
                const signedAt = r.signed_at as string | null;
                const reason = String(r.rejection_reason ?? "");
                
                const fmt = (iso: string | null) =>
                  iso ? new Date(iso).toLocaleString() : "—";
                return (
                  <div className="space-y-4">
                    {status === "approved" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">
                            Approved By
                          </div>
                          <div className="text-sm font-medium">
                            {audit.approver?.full_name ?? "—"}
                            {audit.approver?.role_key ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({audit.approver.role_key})
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">
                            Approved At
                          </div>
                          <div className="text-sm">{fmt(approvedAt ?? signedAt)}</div>
                        </div>
                      </div>
                    )}
                    {status === "rejected" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">
                            Rejected By
                          </div>
                          <div className="text-sm font-medium">
                            {audit.rejecter?.full_name ?? "—"}
                            {audit.rejecter?.role_key ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({audit.rejecter.role_key})
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">
                            Rejected At
                          </div>
                          <div className="text-sm">{fmt(rejectedAt)}</div>
                        </div>
                        {reason && (
                          <div className="sm:col-span-2 space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground">
                              Reason
                            </div>
                            <div className="rounded-md border bg-muted/30 p-2 text-sm">
                              {reason}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {status === "pending" && (
                      <div className="text-sm italic text-muted-foreground">
                        Awaiting approval.
                      </div>
                    )}

                  </div>
                );
              })()}
            </Section>
          ) : null}


          {/* General Information */}
          <Section title="General Information">
            <div className="grid gap-4 sm:grid-cols-2">
              {editing ? (
                <Field label="Approval">
                  <Select
                    value={approvalValue ?? undefined}
                    onValueChange={(v) => setApprovalValue(v as Exclude<ApprovalPickerValue, null>)}
                    disabled={!canManageApproval}
                  >
                    <SelectTrigger className="h-10 rounded-lg">
                      <SelectValue placeholder="Pending" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field label="Contract start date">
                <Input
                  ref={startDateInputRef}
                  type="date"
                  value={startDate}
                  onInput={(e) => {
                    datesTouchedRef.current = true;
                    setStartDate(e.currentTarget.value);
                  }}
                  onChange={(e) => {
                    datesTouchedRef.current = true;
                    setStartDate(e.target.value);
                    expiryManuallySetRef.current = false;
                  }}
                />
                {originalStartDate && originalStartDate !== startDate ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Client onboarded on{" "}
                    <span className="font-medium text-foreground">{originalStartDate}</span>{" "}
                    (preserved across renewals).
                  </p>
                ) : null}
              </Field>
              <Field label="Contract end date">
                <Input
                  ref={endDateInputRef}
                  type="date"
                  value={endDate}
                  onInput={(e) => {
                    datesTouchedRef.current = true;
                    setEndDate(e.currentTarget.value);
                  }}
                  onChange={(e) => {
                    datesTouchedRef.current = true;
                    setEndDate(e.target.value);
                  }}
                />
              </Field>
              <Field label="Next renewal / expiry date" className="sm:col-span-2">
                <Input
                  ref={expiryDateInputRef}
                  type="date"
                  value={expiryDate}
                  onInput={(e) => {
                    setExpiryDate(e.currentTarget.value);
                    expiryManuallySetRef.current = true;
                  }}
                  onChange={(e) => {
                    setExpiryDate(e.target.value);
                    expiryManuallySetRef.current = true;
                  }}
                />


                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Auto-set to 6 months after start. Renewal happens every 6 months.</span>
                  {totalRenewalCheckpoints > 0 ? (
                    <span className="font-medium text-foreground">
                      Checkpoint {currentCheckpoint} of {totalRenewalCheckpoints}
                    </span>
                  ) : null}
                </div>
              </Field>

              <Field label="Service Type">
                <Select
                  value={serviceTypeId || "none"}
                  onValueChange={(v) => setServiceTypeId(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-10 rounded-lg">
                    <SelectValue placeholder="Select service type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {serviceTypes.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>
          </div>


          {/* Payroll Information */}
          <div className={stepKey === "payroll" ? "block" : "hidden"}>
          <Section title="Payroll Information">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Payroll Window">
                <Select
                  value={payrollWindowId || "none"}
                  onValueChange={(v) => setPayrollWindowId(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-10 rounded-lg">
                    <SelectValue placeholder="Select window" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {payrollWindows.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.label} ({w.windowStartDay}–{w.windowEndDay})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pay Date (auto)">
                <Input value={payDate} readOnly />
              </Field>
              <Field label="Billing Dates (auto)">
                <Input value={billingDates} readOnly />
              </Field>
              <div className="sm:col-span-3">
                <Field label="Billing Type">
                  <Select
                    value={billingTypeId || "none"}
                    onValueChange={(v) => setBillingTypeId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-10 rounded-lg">
                      <SelectValue placeholder="Select billing type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {billingTypes.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </Section>
          </div>

          {/* GST */}
          <div className={stepKey === "gst" ? "block" : "hidden"}>
          <Section title="GST">
            {selectedUnit ? (
              <div className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">PAN</div>
                  <div className="font-medium">{selectedUnit.panNumber || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">GST type</div>
                  <div className="font-medium">
                    {selectedUnit.gstPayable ? (selectedUnit.gstType || "—") : "Not payable"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">GST number</div>
                  <div className="font-medium">
                    {selectedUnit.gstPayable ? (selectedUnit.gstNumber || "—") : "—"}
                  </div>
                </div>
                <div className="sm:col-span-3 text-[11px] text-muted-foreground">
                  Manage these in Clients.
                </div>
              </div>
            ) : (
              <div className="mb-4 text-sm italic text-muted-foreground">
                Select a unit to view its GST information.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { value: "csgst", label: "CGST + SGST" },
                  { value: "igst", label: "IGST" },
                  { value: "none", label: "No GST" },
                ] as { value: GstOption; label: string }[]
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    gstOption === opt.value
                      ? "border-accent bg-accent/10 text-foreground"
                      : "border-border bg-card hover:bg-secondary/40",
                  )}
                >
                  <input
                    type="radio"
                    name="gst-option"
                    value={opt.value}
                    checked={gstOption === opt.value}
                    onChange={() => setGstOption(opt.value)}
                    className="h-4 w-4 accent-accent"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </Section>
          </div>

          {/* Resources */}
          <div className={stepKey === "resources" ? "block" : "hidden"}>
          <ResourcesSection
            resources={resources}
            payrollWindow={selectedWindow}
            onAdd={() =>
              setResourceDialog({ open: true, index: null, initial: null })
            }
            onEdit={(idx) =>
              setResourceDialog({
                open: true,
                index: idx,
                initial: cloneContractResource(resources[idx]),
              })
            }
            onCopy={(idx) =>
              setResourceDialog({
                open: true,
                index: null,
                initial: { ...cloneContractResource(resources[idx]), id: undefined },
              })
            }
            onDelete={(idx) => {
              setResources((prev) => prev.filter((_, i) => i !== idx));
              setHasStagedResourceChanges(true);
            }}
          />
          </div>
          <div className={stepKey === "review" ? "space-y-5" : "hidden"}>
            <Section title="Review">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Client</dt><dd className="mt-1 font-medium">{selectedUnit?.name || "Not selected"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Organization</dt><dd className="mt-1 font-medium">{selectedOrg?.name || "Not selected"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Period</dt><dd className="mt-1 font-medium">{startDate || "—"} to {endDate || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Resources</dt><dd className="mt-1 font-medium">{resources.length}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Payroll</dt><dd className="mt-1 font-medium">{selectedWindow?.label || "Not selected"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">GST</dt><dd className="mt-1 font-medium">{gstOption === "csgst" ? "CGST + SGST" : gstOption === "igst" ? "IGST" : "No GST"}</dd></div>
              </dl>
            </Section>
          </div>
        </div>
        </GuidedForm>

        <ResourceFormDialog
          open={resourceDialog.open}
          initial={resourceDialog.initial}
          onOpenChange={(o) =>
            setResourceDialog((s) => ({ ...s, open: o }))
          }
          onSubmit={(r) => {
            const stagedResource = cloneContractResource(r);
            const nextResources =
              resourceDialog.index !== null
                ? resources.map((x, i) => (i === resourceDialog.index ? stagedResource : x))
                : [...resources, stagedResource];
            setResources(nextResources);
            setHasStagedResourceChanges(true);
            setResourceDialog({ open: false, index: null, initial: null });
            toast.message("Resource staged — click Save Changes to confirm");
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const DECIMAL_INPUT_REGEX = /^\d*\.?\d*$/;

function DecimalAmountInput({
  value,
  onValueChange,
  className,
}: {
  value: number;
  onValueChange: (amount: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value === 0 ? "" : String(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(value === 0 ? "" : String(value));
    }
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder="0.00"
      className={className}
      value={draft}
      onChange={(e) => {
        const next = e.target.value.trim();
        if (!DECIMAL_INPUT_REGEX.test(next)) return;
        setDraft(next);
        if (next === "" || next === ".") {
          onValueChange(0);
          return;
        }
        const parsed = Number.parseFloat(next);
        if (Number.isFinite(parsed)) {
          onValueChange(parsed);
        }
      }}
      onFocus={(e) => {
        editingRef.current = true;
        e.target.select();
      }}
      onBlur={() => {
        editingRef.current = false;
        const next = draft.trim();
        if (next === "" || next === ".") {
          setDraft("");
          onValueChange(0);
          return;
        }
        const parsed = Number.parseFloat(next);
        if (!Number.isFinite(parsed)) {
          setDraft(value === 0 ? "" : String(value));
          return;
        }
        onValueChange(parsed);
        setDraft(parsed === 0 ? "" : String(parsed));
      }}
    />
  );
}

function ResourcesSection({
  resources,
  payrollWindow,
  onAdd,
  onEdit,
  onCopy,
  onDelete,
}: {
  resources: ContractResource[];
  payrollWindow?: PayrollWindow;
  onAdd: () => void;
  onEdit: (idx: number) => void;
  onCopy: (idx: number) => void;
  onDelete: (idx: number) => void;
}) {
  const designations = useDesignations();
  const serviceTypes = useServiceTypes();
  const rolesList = useRolesList();
  const dById = useMemo(
    () => new Map(designations.map((d) => [d.id, d])),
    [designations],
  );
  const sById = useMemo(
    () => new Map(serviceTypes.map((s) => [s.id, s])),
    [serviceTypes],
  );
  const roleByKey = useMemo(
    () => new Map(rolesList.map((r) => [r.key, r])),
    [rolesList],
  );
  const billingDayBasesList = useBillingDayBases();
  const payrollDayBasesList = usePayrollDayBases();

  /** Monthly client billing (wages + employer cost lines) and the four
   *  payroll-period billing rates: 31/30/29/28 days use 27/26/25/24 duties. */
  const dayRates = useMemo(
    () =>
      resources.map((r) => {
        const gross = r.components.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const employer = (r.employerContributions ?? []).reduce(
          (s, c) => s + (Number((c as { amount?: unknown }).amount) || 0),
          0,
        );
        const monthly = gross + employer;
        return {
          label: dById.get(r.designationId)?.name ?? "Resource",
          shiftHours: r.shiftHours,
          monthly,
        };
      }),
    [resources, dById],
  );

  const currentPayrollPeriod = useMemo(() => {
    const now = new Date();
    return payrollPeriodForMonth(
      now.getFullYear(),
      now.getMonth(),
      payrollWindow
        ? {
            windowStartDay: payrollWindow.windowStartDay,
            windowEndDay: payrollWindow.windowEndDay,
          }
        : null,
      now,
    );
  }, [payrollWindow]);
  const currentPayrollPeriodDays = currentPayrollPeriod.totalDays;
  const billingRateScenarios = useMemo(() => {
    const scenarios = [31, 30, 29, 28].map((calendarDays) => {
      // Sample dates for weekday-based rules, starting at the current period start.
      const [y, m, d] = currentPayrollPeriod.start.split("-").map(Number);
      const dates = Array.from({ length: calendarDays }, (_, i) => {
        const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + i);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      });
      return { calendarDays, dates };
    });
    return scenarios.sort((a, b) => {
      if (a.calendarDays === currentPayrollPeriodDays) return -1;
      if (b.calendarDays === currentPayrollPeriodDays) return 1;
      return b.calendarDays - a.calendarDays;
    });
  }, [currentPayrollPeriodDays, currentPayrollPeriod.start]);
  const divisorFor = (idx: number, dates: string[]) => {
    const r = resources[idx];
    const base =
      billingDayBasesList.find((b) => b.id === r?.billingDayBaseId) ??
      payrollDayBasesList.find((b) => b.id === r?.payrollDayBaseId) ??
      null;
    const n = resolvePayrollDayCount(base, dates, { clampToPeriod: false });
    return n && n > 0 ? n : Math.max(1, dates.length - 4);
  };
  const baseNameFor = (idx: number) => {
    const r = resources[idx];
    return (
      billingDayBasesList.find((b) => b.id === r?.billingDayBaseId)?.name ??
      payrollDayBasesList.find((b) => b.id === r?.payrollDayBaseId)?.name ??
      null
    );
  };
  const fmtRate = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Section title="Resources">
      {resources.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-accent hover:bg-accent/5 hover:text-foreground"
        >
          <Users className="h-6 w-6 opacity-60" />
          <span className="font-medium">No resources mapped to the contract.</span>
          <span className="text-xs">Add resources</span>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Billing rate per day
            </div>
            <div className="mt-2 space-y-3">
              {dayRates.map((d, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {d.label}
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {d.shiftHours}h{baseNameFor(i) ? ` · ${baseNameFor(i)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      Monthly {fmtRate(d.monthly)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {billingRateScenarios.map((scenario) => {
                      const isCurrent = scenario.calendarDays === currentPayrollPeriodDays;
                      const billingDays = divisorFor(i, scenario.dates);
                      const shown = Math.round(billingDays * 10000) / 10000;
                      return (
                        <div
                          key={scenario.calendarDays}
                          className={cn(
                            "rounded-md border px-2 py-1.5",
                            isCurrent
                              ? "border-accent bg-accent/10"
                              : "border-border bg-background/60",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                            <span>{scenario.calendarDays}-day payroll period</span>
                            {isCurrent ? <span className="font-medium text-accent">Current</span> : null}
                          </div>
                          <div className="mt-0.5 text-sm font-semibold text-foreground">
                            {fmtRate(d.monthly / billingDays)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            ÷ {shown} billing days
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {resources.map((r, idx) => {
            const dn = dById.get(r.designationId);
            const sn = sById.get(r.serviceTypeId);
            const rn = r.roleKey ? roleByKey.get(r.roleKey) : null;
            return (
              <div
                key={idx}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {dn?.name ?? "—"}
                      </span>
                      {dn?.code && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {dn.code}
                        </span>
                      )}
                      {rn && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {rn.name}
                        </span>
                      )}
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {sn?.name ?? "—"}
                      </span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                        Qty {r.quantity}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.components.map((c) => (
                        <span
                          key={c.allowanceId}
                          className="rounded bg-secondary/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {c.name}: {c.amount.toFixed(2)}
                        </span>
                      ))}
                      {r.components.length === 0 && (
                        <span className="text-[11px] italic text-muted-foreground">
                          No wage components
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs font-semibold text-foreground">
                      <span>
                        Billing: {fmtRate(dayRates[idx]?.monthly ?? 0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => onEdit(idx)}
                      aria-label="Edit"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => onCopy(idx)}
                      aria-label="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(idx)}
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onAdd}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add another resource
          </Button>
        </div>
      )}
    </Section>
  );
}

export type WagesSubject = {
  name: string;
  employeeCode?: string | null;
  designationName?: string | null;
  departmentName?: string | null;
};

export function ResourceFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  /**
   * "wages" = per-employee wage sheet (non-billable onboarding). Hides the
   * contract-only deployment fields (designation, service type, agreed
   * deployment quantity, role) — those come from the employee record.
   */
  variant = "contract",
  subject,
  /**
   * inline = render the fields directly inside the parent form (no dialog,
   * no header/footer, no Save button). Every change is pushed up through
   * onChange so the parent owns persistence.
   */
  inline = false,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: ContractResource | null;
  onSubmit: (r: ContractResource) => void;
  variant?: "contract" | "wages";
  subject?: WagesSubject | null;
  inline?: boolean;
  onChange?: (r: ContractResource) => void;
}) {
  const isWages = variant === "wages";
  const designations = useDesignations();
  const serviceTypes = useServiceTypes();
  const allowanceTypes = useAllowanceTypes();
  const payrollDayBases = usePayrollDayBases();
  const billingDayBases = useBillingDayBases();
  const costComponents = useCostComponentOptions();
  const rolesList = useRolesList();

  const [designationId, setDesignationId] = useState("");
  const [roleKey, setRoleKey] = useState<string>("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [shiftHours, setShiftHours] = useState("8");
  const [components, setComponents] = useState<ResourceComponent[]>([]);
  const [payrollDayBaseId, setPayrollDayBaseId] = useState<string>("");
  const [billingDayBaseId, setBillingDayBaseId] = useState<string>("");
  const [benefits, setBenefits] = useState<BenefitItem[]>([]);
  const [deductions, setDeductions] = useState<BenefitItem[]>([]);
  const [employerContributions, setEmployerContributions] = useState<BenefitItem[]>([]);
  const [designationOpen, setDesignationOpen] = useState(false);
  const [allowancePickerOpen, setAllowancePickerOpen] = useState(false);
  const [designationQuery, setDesignationQuery] = useState("");
  const [allowanceQuery, setAllowanceQuery] = useState("");
  const [benefitPickerOpen, setBenefitPickerOpen] = useState(false);
  const [benefitQuery, setBenefitQuery] = useState("");
  const [deductionPickerOpen, setDeductionPickerOpen] = useState(false);
  const [deductionQuery, setDeductionQuery] = useState("");
  const [employerPickerOpen, setEmployerPickerOpen] = useState(false);
  const [employerQuery, setEmployerQuery] = useState("");
  const [resourceBaselineSnapshot, setResourceBaselineSnapshot] = useState("");
  const dialogContentRef = useRef<HTMLDivElement | null>(null);

  const preserveDialogScroll = (update: () => void) => {
    const scrollTop = dialogContentRef.current?.scrollTop ?? 0;
    update();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (dialogContentRef.current) {
          dialogContentRef.current.scrollTop = scrollTop;
        }
      });
    });
  };

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const nextComponents = (() => {
        return initial.components
          .map((c) => syncResourceComponentMasterFields(c, allowanceTypes));
      })();
      const loadedBenefits = initial.benefits.map(cloneBenefitItem);
      const nextDeductions = (initial.deductions ?? []).map(cloneBenefitItem);
      const loadedEmployerContributions = (initial.employerContributions ?? []).map(cloneBenefitItem);
      const normalizedAddOns = normalizeBillingAddOns(loadedBenefits, loadedEmployerContributions);
      const nextBenefits = normalizedAddOns.benefits;
      const nextEmployerContributions = normalizedAddOns.employerContributions;
      setDesignationId(initial.designationId);
      setRoleKey(initial.roleKey ?? "");
      setServiceTypeId(initial.serviceTypeId);
      setQuantity(String(initial.quantity));
      setShiftHours(String(initial.shiftHours ?? 8));
      setComponents(nextComponents);
      setPayrollDayBaseId(initial.payrollDayBaseId ?? "");
      setBillingDayBaseId(initial.billingDayBaseId ?? "");
      setBenefits(nextBenefits);
      setDeductions(nextDeductions);
      setEmployerContributions(nextEmployerContributions);
      setResourceBaselineSnapshot(serializeContractResources([{ ...initial, components: nextComponents, benefits: nextBenefits, deductions: nextDeductions, employerContributions: nextEmployerContributions }]));
    } else {
      const nextComponents = allowanceTypes
        .filter((a) => a.isDefault)
        .map((a) => ({
          allowanceId: a.id,
          name: a.shortName || a.displayName,
          amount: 0,
          includeInOt: a.includeInOt !== false,
          formulaMode: a.formulaMode ?? null,
          formulaExpression: a.formulaExpression ?? null,
          formulaVersion: a.formulaVersion ?? null,
          fixedCalcMethod: a.fixedCalcMethod ?? "flat",
          fixedDutyComponents: a.fixedDutyComponents ?? [],
          fixedDutyDivisor: a.fixedDutyDivisor ?? "base_days",
        }));
      setDesignationId("");
      setRoleKey("");
      setServiceTypeId("");
      setQuantity("1");
      setShiftHours("8");
      // Pre-load defaults from allowance types
      setComponents(nextComponents);
      setPayrollDayBaseId("");
      setBillingDayBaseId("");
      setBenefits([]);
      setDeductions([]);
      setEmployerContributions([]);
      setResourceBaselineSnapshot(serializeContractResources([{ designationId: "", serviceTypeId: "", quantity: 1, shiftHours: 8, components: nextComponents, payrollDayBaseId: null, billingDayBaseId: null, benefits: [], deductions: [], employerContributions: [] }]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, allowanceTypes.length]);

  const currentResourceSnapshot = useMemo(
    () =>
      serializeContractResources([
        {
          id: initial?.id,
          designationId,
          roleKey: roleKey || null,
          serviceTypeId,
          quantity: Number.parseInt(quantity, 10) || 1,
          shiftHours: Number.parseInt(shiftHours, 10) === 12 ? 12 : 8,
          components,
          payrollDayBaseId: payrollDayBaseId || null,
          billingDayBaseId: billingDayBaseId || null,
          benefits,
          deductions,
          employerContributions,
        },
      ]),
    [benefits, billingDayBaseId, components, deductions, designationId, employerContributions, initial?.id, payrollDayBaseId, quantity, shiftHours, roleKey, serviceTypeId],
  );
  const resourceHasChanges = resourceBaselineSnapshot !== "" && currentResourceSnapshot !== resourceBaselineSnapshot;

  const gross = components.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const usedIds = new Set(components.map((c) => c.allowanceId));
  const availableExtras = allowanceTypes.filter((a) => !usedIds.has(a.id));
  const filteredDesignations = useMemo(() => {
    const query = designationQuery.trim().toLowerCase();
    if (!query) return designations;
    return designations.filter((d) =>
      [d.code, d.name, d.id].join(" ").toLowerCase().includes(query),
    );
  }, [designationQuery, designations]);
  const filteredAvailableExtras = useMemo(() => {
    const query = allowanceQuery.trim().toLowerCase();
    if (!query) return availableExtras;
    return availableExtras.filter((a) =>
      [a.shortName, a.displayName, a.name, a.id]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [allowanceQuery, availableExtras]);

  // Recompute formula-based wage components (e.g. HRA = 5% of Basic + DA)
  // whenever any other component changes. Skips self-reference and no-ops
  // when the amount is unchanged so React doesn't re-render in a loop.
  useEffect(() => {
    setComponents((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        // A source-card amount marked fixed is authoritative. The allowance
        // master may use a generic formula that is valid for new contracts but
        // must not recalculate this imported contract line.
        if (c.calcType === "fixed" && !hasConfiguredFormula(c)) return c;
        const at = findAllowanceForResourceComponent(c, allowanceTypes);
        if (!at) return c;
        const hasFormula = hasConfiguredFormula(at);
        if (!hasFormula && at.calcType !== "percentage") return c;
        const others = prev.filter((x) => x.allowanceId !== c.allowanceId);
        const newAmt = computeBenefitAmount(
          {
            calcType: at.calcType,
            percentage: at.percentage,
            baseComponents: at.baseComponents,
            capAmount: at.capAmount,
            capFlatAmount: null,
            amount: 0,
            formulaMode: at.formulaMode ?? null,
            formulaExpression: at.formulaExpression ?? null,
            name: at.shortName || at.displayName || at.name,
          },
          others,
          [],
          allowanceTypes,
        );
        const synced = {
          ...c,
          // includeInOt is a per-resource OT choice — never overwritten by the master
          includeInOt: c.includeInOt !== false,
          formulaMode: at.formulaMode ?? null,
          formulaExpression: at.formulaExpression ?? null,
          formulaVersion: at.formulaVersion ?? null,
          amount: newAmt,
        };
        const metaChanged =
          c.allowanceId !== synced.allowanceId ||
          c.name !== synced.name ||
          c.formulaMode !== synced.formulaMode ||
          c.formulaExpression !== synced.formulaExpression ||
          c.formulaVersion !== synced.formulaVersion;
        if (!metaChanged && Math.abs((Number(c.amount) || 0) - newAmt) < 0.005) return c;
        changed = true;
        return synced;
      });
      return changed ? next : prev;
    });
  }, [components, allowanceTypes]);

  // Recompute percentage/formula benefits whenever wage components change
  const hasFormula = (b: BenefitItem) => hasConfiguredFormula(b);
  useEffect(() => {
    setBenefits((prev) =>
      prev.map((b) =>
        b.calcType === "percentage" || hasFormula(b)
          ? { ...b, amount: computeBenefitAmount(b, components, [], allowanceTypes) }
          : b,
      ),
    );
  }, [components, allowanceTypes]);

  // Deductions/employer contributions also depend on benefits (Gross = components + benefits)
  useEffect(() => {
    setDeductions((prev) =>
      prev.map((b) =>
        b.calcType === "percentage" || hasFormula(b)
          ? { ...b, amount: computeBenefitAmount(b, components, benefits, allowanceTypes) }
          : b,
      ),
    );
    setEmployerContributions((prev) => {
      const refsCtc = (b: BenefitItem) =>
        /\bctc\b/i.test(b.formulaExpression ?? "") ||
        b.baseComponents.some((x) => {
          const l = x.label.trim().toLowerCase();
          return l === "ctc" || l === "total ctc";
        });
      const isMgmtFee = (b: BenefitItem) => /management\s*fee/i.test(b.name);
      const firstPass = prev.map((b) =>
        (b.calcType === "percentage" || hasFormula(b)) && !refsCtc(b)
          ? { ...b, amount: computeBenefitAmount(b, components, benefits, allowanceTypes) }
          : b,
      );
      const ctcBase = firstPass.filter((b) => !refsCtc(b) && !isMgmtFee(b));
      return firstPass.map((b) =>
        (b.calcType === "percentage" || hasFormula(b)) && refsCtc(b)
          ? { ...b, amount: computeBenefitAmount(b, components, benefits, allowanceTypes, ctcBase) }
          : b,
      );
    });
  }, [components, benefits, allowanceTypes]);

  // Overlay latest formula_mode / formula_expression from Cost Component master
  // onto loaded benefits/deductions/employer rows so existing contracts pick up
  // formula edits made in Control Center without needing to re-save the row.
  useEffect(() => {
    if (!costComponents.length) return;
    const byId = new Map(costComponents.map((c) => [c.id, c]));
    const componentNameKey = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const findMaster = (b: BenefitItem) => {
      // Do not hydrate source-locked fixed rows from a generic master formula.
      if (b.calcType === "fixed" && !hasConfiguredFormula(b)) return undefined;
      // Custom (manually entered) billing add-ons have synthetic ids and must
      // never be re-linked to a master formula.
      if (String(b.costComponentId).startsWith("__")) return undefined;
      const resolved = (() => {
        const byStoredId = byId.get(b.costComponentId);
        if (byStoredId) return byStoredId;
        const key = componentNameKey(b.name);
        if (!key) return undefined;
        const exactName = costComponents.find((c) => componentNameKey(c.name) === key);
        if (exactName) return exactName;
        if (isRelieverLine(b)) {
          return costComponents.find((c) => componentNameKey(c.name) === "relievercharges");
        }
        return undefined;
      })();
      // EPF without the ₹15,000 ceiling, or ESI without a formula, is upgraded
      // to the canonical statutory master (capped Gross − HRA EPF / gross-based
      // ESIC) so the contract shows ₹1,800 / ₹1,950 and the correct ESIC.
      const canonical = canonicalStatutoryMaster(resolved ?? b, costComponents);
      return canonical ?? resolved;
    };


    const overlay = (b: BenefitItem): BenefitItem => {
      // Older contract rows may carry a deleted/replaced component ID. Recover
      // the current master by its stable display name so formula updates apply.
      const m = findMaster(b);
      if (!m) return b;
      const synced: BenefitItem = {
        ...b,
        costComponentId: m.id,
        name: m.name,
        calcType: m.calcType,
        percentage: m.percentage,
        baseComponents: m.baseComponents,
        capAmount: m.capAmount,
        capFlatAmount: m.capFlatAmount,
        formulaMode: m.formulaMode ?? null,
        formulaExpression: m.formulaExpression ?? null,
        formulaVersion: m.formulaVersion ?? null,
      };
      const unchanged =
        b.costComponentId === synced.costComponentId &&
        b.name === synced.name &&
        b.calcType === synced.calcType &&
        b.percentage === synced.percentage &&
        JSON.stringify(b.baseComponents) === JSON.stringify(synced.baseComponents) &&
        b.capAmount === synced.capAmount &&
        b.capFlatAmount === synced.capFlatAmount &&
        b.formulaMode === synced.formulaMode &&
        b.formulaExpression === synced.formulaExpression &&
        b.formulaVersion === synced.formulaVersion;
      return unchanged ? b : synced;
    };
    setBenefits((prev) => {
      const next = prev.map(overlay);
      return next.some((b, i) => b !== prev[i]) ? next : prev;
    });
    setDeductions((prev) => {
      const next = prev.map((b) => {
        const synced = overlay(b);
        if (synced === b) return b;
        return synced.calcType === "percentage" || hasConfiguredFormula(synced)
          ? { ...synced, amount: computeBenefitAmount(synced, components, benefits, allowanceTypes) }
          : synced;
      });
      return next.some((b, i) => b !== prev[i]) ? next : prev;
    });

    setEmployerContributions((prev) => {
      const synced = prev.map(overlay);
      const referencesCtc = (b: BenefitItem) =>
        /\bctc\b/i.test(b.formulaExpression ?? "") ||
        b.baseComponents.some((base) => /^(total\s+)?ctc$/i.test(base.label.trim()));
      const firstPass = synced.map((b) =>
        (b.calcType === "percentage" || hasConfiguredFormula(b)) && !referencesCtc(b)
          ? { ...b, amount: computeBenefitAmount(b, components, benefits, allowanceTypes) }
          : b,
      );
      const ctcContributions = firstPass.filter((b) => !referencesCtc(b) && !isBillingAddOn(b));
      const next = firstPass.map((b) =>
        (b.calcType === "percentage" || hasConfiguredFormula(b)) && referencesCtc(b)
          ? {
              ...b,
              amount: computeBenefitAmount(b, components, benefits, allowanceTypes, ctcContributions),
            }
          : b,
      );
      return next.some((b, i) => b !== prev[i]) ? next : prev;
    });
  }, [allowanceTypes, benefits, components, costComponents]);

  const PT_SYNTHETIC_ID = "__pt__";
  const ptSynthetic: CostComponentOption = {
    id: PT_SYNTHETIC_ID,
    name: "Professional Tax (PT)",
    calcType: "fixed",
    percentage: 0,
    baseComponents: [],
    capAmount: null,
    capFlatAmount: null,
    amount: 0,
    state: "Per state slab (resolved at payroll from unit state, employee gender, earned gross)",
    description: "",
    party: "employee",
    deductionCalcType: "fixed_amount",
    fixedCalcMethod: "flat",
    fixedDutyComponents: [],
    fixedDutyDivisor: "base_days",
  };


  const costComponentById = new Map(costComponents.map((c) => [c.id, c]));
  // Description map handed to the breakdown preview so it can show the master
  // description instead of a raw formula string.
  const componentDescriptions = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of costComponents) {
      if (c.description) map[c.id] = String(c.description);
    }
    for (const a of allowanceTypes) {
      const d = (a as { description?: string | null }).description;
      if (d) map[a.id] = String(d);
    }
    return map;
  }, [costComponents, allowanceTypes]);
  // Human-readable description for formula-driven components: prefer the
  // description maintained on the Cost Component master, fall back to a
  // readable formula/percentage summary, and never show the raw formula JSON.
  const describeFormulaItem = (b: BenefitItem): string =>
    describeComponentFormula(b, costComponentById.get(b.costComponentId)?.description ?? null) ||
    "Custom formula";


  const usedBenefitIds = new Set(benefits.map((b) => b.costComponentId));
  const usedDeductionIds = new Set(deductions.map((b) => b.costComponentId));
  const usedEmployerIds = new Set(employerContributions.map((b) => b.costComponentId));
  const availableBenefits = costComponents.filter((c) => !usedBenefitIds.has(c.id));
  const availableDeductions: CostComponentOption[] = [
    ...costComponents.filter((c) => !usedDeductionIds.has(c.id) && c.party !== "employer"),
    ...(usedDeductionIds.has(PT_SYNTHETIC_ID) ? [] : [ptSynthetic]),
  ];
  const availableEmployer = costComponents.filter(
    (c) =>
      !usedEmployerIds.has(c.id) &&
      c.party !== "employee" &&
      !isRelieverLine(c) &&
      !isMgmtFeeLine(c),
  );
  const filteredAvailableBenefits = useMemo(() => {
    const q = benefitQuery.trim().toLowerCase();
    if (!q) return availableBenefits;
    return availableBenefits.filter((c) =>
      [c.name, c.description, c.state, c.id].join(" ").toLowerCase().includes(q),
    );
  }, [benefitQuery, availableBenefits]);
  const filteredAvailableDeductions = useMemo(() => {
    const q = deductionQuery.trim().toLowerCase();
    if (!q) return availableDeductions;
    return availableDeductions.filter((c) =>
      [c.name, c.description, c.state, c.id].join(" ").toLowerCase().includes(q),
    );
  }, [deductionQuery, availableDeductions]);
  const filteredAvailableEmployer = useMemo(() => {
    const q = employerQuery.trim().toLowerCase();
    if (!q) return availableEmployer;
    return availableEmployer.filter((c) =>
      [c.name, c.description, c.state, c.id].join(" ").toLowerCase().includes(q),
    );
  }, [employerQuery, availableEmployer]);
  const benefitOptionsKey = useMemo(
    () => availableBenefits.map((c) => c.id).join("|") || "empty",
    [availableBenefits],
  );
  const deductionOptionsKey = useMemo(
    () => availableDeductions.map((c) => c.id).join("|") || "empty",
    [availableDeductions],
  );
  const employerOptionsKey = useMemo(
    () => availableEmployer.map((c) => c.id).join("|") || "empty",
    [availableEmployer],
  );

  const updateAmount = (allowanceId: string, amount: number) => {
    setComponents((prev) =>
      prev.map((c) => (c.allowanceId === allowanceId ? { ...c, amount } : c)),
    );
  };

  const toggleOtComponent = (allowanceId: string) => {
    preserveDialogScroll(() => {
      setComponents((prev) =>
        prev.map((c) =>
          c.allowanceId === allowanceId
            ? { ...c, includeInOt: c.includeInOt === false }
            : c,
        ),
      );
    });
  };

  const setAllOtComponents = (on: boolean) => {
    preserveDialogScroll(() => {
      setComponents((prev) => prev.map((c) => ({ ...c, includeInOt: on })));
    });
  };

  const otBaseTotal = components
    .filter((c) => c.includeInOt !== false)
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const otDivisorDays = useMemo(() => {
    const base = payrollDayBases.find((p) => p.id === payrollDayBaseId);
    if (!base) return 0;
    if (base.method === "fixed_days") return base.fixedDays ?? 26;
    if (base.method === "fixed_annual_average") return 30.4166;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (base.method === "actual_days") return daysInMonth;
    if (base.method === "actual_minus_weekly_off") {
      let count = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(now.getFullYear(), now.getMonth(), d).getDay() !== (base.weeklyOffDay ?? 0)) count++;
      }
      return count;
    }
    return 0;
  }, [payrollDayBaseId, payrollDayBases]);

  const removeComponent = (allowanceId: string) => {
    setComponents((prev) => prev.filter((c) => c.allowanceId !== allowanceId));
  };


  const addComponent = (a: AllowanceType) => {
    preserveDialogScroll(() => {
      setComponents((prev) => {
        const next: ResourceComponent = {
          allowanceId: a.id,
          name: a.shortName || a.displayName,
          amount: 0,
          includeInOt: a.includeInOt !== false,
          formulaMode: a.formulaMode ?? null,
          formulaExpression: a.formulaExpression ?? null,
          formulaVersion: a.formulaVersion ?? null,
          fixedCalcMethod: a.fixedCalcMethod ?? "flat",
          fixedDutyComponents: a.fixedDutyComponents ?? [],
          fixedDutyDivisor: a.fixedDutyDivisor ?? "base_days",
        };
        const hasF = hasConfiguredFormula(a);
        if (a.calcType === "percentage" || hasF) {
          next.amount = computeBenefitAmount(
            {
              calcType: a.calcType,
              percentage: a.percentage,
              baseComponents: a.baseComponents,
              capAmount: a.capAmount,
              capFlatAmount: null,
              amount: 0,
              formulaMode: a.formulaMode ?? null,
              formulaExpression: a.formulaExpression ?? null,
              name: a.shortName || a.displayName || a.name,
            },
            prev,
            [],
            allowanceTypes,
          );
        }
        return [...prev, next];
      });
      setAllowanceQuery("");
      setAllowancePickerOpen(false);
    });
  };

  const addBenefit = (c: CostComponentOption) => {
    const benefit: BenefitItem = {
      costComponentId: c.id,
      name: c.name,
      calcType: c.calcType,
      percentage: c.percentage,
      baseComponents: c.baseComponents,
      capAmount: c.capAmount,
      capFlatAmount: c.capFlatAmount,
      amount: c.calcType === "fixed" ? Number(c.amount ?? 0) : 0,
      state: c.state,
      deductionCalcType: c.deductionCalcType,
      fixedCalcMethod: c.fixedCalcMethod,
      fixedDutyComponents: c.fixedDutyComponents,
      fixedDutyDivisor: c.fixedDutyDivisor,
      formulaMode: c.formulaMode ?? null,
      formulaExpression: c.formulaExpression ?? null,
      formulaVersion: c.formulaVersion ?? null,
    };
    const hasF = hasConfiguredFormula(benefit);
    if (benefit.calcType === "percentage" || hasF) {
      benefit.amount = computeBenefitAmount(benefit, components, [], allowanceTypes);
    }
    preserveDialogScroll(() => {
      setBenefits((prev) => [...prev, benefit]);
      setBenefitQuery("");
      setBenefitPickerOpen(false);
    });
  };

  const updateBenefitAmount = (id: string, amount: number) => {
    setBenefits((prev) => prev.map((b) => (b.costComponentId === id ? { ...b, amount } : b)));
  };

  const removeBenefit = (id: string) => {
    setBenefits((prev) => prev.filter((b) => b.costComponentId !== id));
  };

  const addDeduction = (c: CostComponentOption) => {
    const item: BenefitItem = {
      costComponentId: c.id,
      name: c.name,
      calcType: c.calcType,
      percentage: c.percentage,
      baseComponents: c.baseComponents,
      capAmount: c.capAmount,
      capFlatAmount: c.capFlatAmount,
      amount: c.calcType === "fixed" ? Number(c.amount ?? 0) : 0,
      state: c.state,
      deductionCalcType: c.deductionCalcType,
      fixedCalcMethod: c.fixedCalcMethod,
      fixedDutyComponents: c.fixedDutyComponents,
      fixedDutyDivisor: c.fixedDutyDivisor,
      formulaMode: c.formulaMode ?? null,
      formulaExpression: c.formulaExpression ?? null,
      formulaVersion: c.formulaVersion ?? null,
    };
    const hasF = hasConfiguredFormula(item);
    if (item.calcType === "percentage" || hasF) {
      item.amount = computeBenefitAmount(item, components, benefits, allowanceTypes);
    }
    preserveDialogScroll(() => {
      setDeductions((prev) => [...prev, item]);
      setDeductionQuery("");
      setDeductionPickerOpen(false);
    });
  };

  const updateDeductionAmount = (id: string, amount: number) => {
    setDeductions((prev) => prev.map((b) => (b.costComponentId === id ? { ...b, amount } : b)));
  };

  const removeDeduction = (id: string) => {
    setDeductions((prev) => prev.filter((b) => b.costComponentId !== id));
  };

  const buildEmployerItem = (c: CostComponentOption): BenefitItem => {
    const item: BenefitItem = {
      costComponentId: c.id,
      name: c.name,
      calcType: c.calcType,
      percentage: c.percentage,
      baseComponents: c.baseComponents,
      capAmount: c.capAmount,
      capFlatAmount: c.capFlatAmount,
      amount: c.calcType === "fixed" ? Number(c.amount ?? 0) : 0,
      state: c.state,
      deductionCalcType: c.deductionCalcType,
      fixedCalcMethod: c.fixedCalcMethod,
      fixedDutyComponents: c.fixedDutyComponents,
      fixedDutyDivisor: c.fixedDutyDivisor,
      formulaMode: c.formulaMode ?? null,
      formulaExpression: c.formulaExpression ?? null,
      formulaVersion: c.formulaVersion ?? null,
    };
    const hasF = hasConfiguredFormula(item);
    if (item.calcType === "percentage" || hasF) {
      const l = (s: string) => s.trim().toLowerCase();
      const refsCtc = item.baseComponents.some(
        (x) => l(x.label) === "ctc" || l(x.label) === "total ctc",
      );
      item.amount = computeBenefitAmount(
        item,
        components,
        benefits,
        allowanceTypes,
        refsCtc ? employerContributions : [],
      );
    }
    return item;
  };

  const addEmployerContribution = (c: CostComponentOption) => {
    const item = buildEmployerItem(c);
    preserveDialogScroll(() => {
      setEmployerContributions((prev) => [...prev, item]);
      setEmployerQuery("");
      setEmployerPickerOpen(false);
    });
  };

  const updateEmployerAmount = (id: string, amount: number) => {
    setEmployerContributions((prev) => prev.map((b) => (b.costComponentId === id ? { ...b, amount } : b)));
  };

  const removeEmployerContribution = (id: string) => {
    setEmployerContributions((prev) => prev.filter((b) => b.costComponentId !== id));
  };

  // ---- Billing add-ons (Reliever charges / Management fee) -----------------
  // These are picked as a single choice each (multiple masters can exist), and
  // are stored alongside employer contributions so all downstream calculation
  // and persistence keeps working unchanged.
  const relieverMasters = useMemo(
    () => costComponents.filter((c) => isRelieverLine(c)),
    [costComponents],
  );
  const mgmtFeeMasters = useMemo(
    () => costComponents.filter((c) => isMgmtFeeLine(c)),
    [costComponents],
  );
  const selectedRelieverId =
    employerContributions.find((b) => isRelieverLine(b))?.costComponentId ?? "";
  const selectedMgmtFeeId =
    employerContributions.find((b) => isMgmtFeeLine(b))?.costComponentId ?? "";

  // The card must display exactly what the Salary Breakdown row / Billing Rate
  // uses: a custom or plain-fixed add-on keeps its entered amount, anything
  // formula-driven is recomputed live against the current Total CTC instead of
  // showing a stale saved figure.
  const liveAddOnAmount = (kind: "reliever" | "mgmt", item: BenefitItem): number => {
    const customId = kind === "mgmt" ? CUSTOM_MANAGEMENT_FEE_ID : CUSTOM_RELIEVER_ID;
    if (item.costComponentId === customId || (item.calcType === "fixed" && !hasConfiguredFormula(item))) {
      return Number(item.amount) || 0;
    }
    const coreBenefits = benefits.filter((b) => !isRelieverLine(b) && !isMgmtFeeLine(b));
    const coreEmployer = employerContributions.filter(
      (b) => !isRelieverLine(b) && !isMgmtFeeLine(b),
    );
    if (kind === "reliever") {
      return computeBenefitAmount(item, components, coreBenefits, [], coreEmployer);
    }
    const relieverBase = employerContributions
      .filter(isRelieverLine)
      .slice(0, 1)
      .map((r) => ({ ...r, amount: liveAddOnAmount("reliever", r) }));
    return computeBenefitAmount(item, components, coreBenefits, [], [
      ...coreEmployer,
      ...relieverBase,
    ]);
  };


  const setBillingAddOn = (kind: "reliever" | "mgmt", componentId: string) => {
    const match = kind === "reliever" ? isRelieverLine : isMgmtFeeLine;
    preserveDialogScroll(() => {
      setBenefits((prev) => prev.filter((b) => !match(b)));
      setEmployerContributions((prev) => {
        const rest = prev.filter((b) => !match(b));
        if (componentId === "__none__") return rest;
        if (
          (componentId === CUSTOM_MANAGEMENT_FEE_ID && kind === "mgmt") ||
          (componentId === CUSTOM_RELIEVER_ID && kind === "reliever")
        ) {
          const isCustomMgmt = kind === "mgmt";
          const previousAmount =
            prev.find(isCustomMgmt ? isMgmtFeeLine : isRelieverLine)?.amount ?? 0;
          return [
            ...rest,
            {
              costComponentId: isCustomMgmt ? CUSTOM_MANAGEMENT_FEE_ID : CUSTOM_RELIEVER_ID,
              name: isCustomMgmt ? "Custom Management Fee" : "Custom Reliever Charges",
              calcType: "fixed",
              percentage: 0,
              baseComponents: [],
              capAmount: null,
              capFlatAmount: null,
              amount: Number(previousAmount) || 0,
              state: "Custom fixed amount",
              formulaMode: null,
              formulaExpression: null,
              formulaVersion: null,
            },
          ];
        }
        const master = costComponents.find((c) => c.id === componentId);
        if (!master) return rest;
        return [...rest, buildEmployerItem(master)];
      });
    });
  };

  const handleSubmit = () => {
    if (!isWages && !designationId) {
      toast.error("Select a designation");
      return;
    }
    if (!isWages && !serviceTypeId) {
      toast.error("Select a service type");
      return;
    }
    if (!payrollDayBaseId) {
      toast.error("Please select Payroll Days");
      return;
    }
    const q = isWages ? 1 : parseInt(quantity, 10);
    if (!q || q < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }
    onSubmit({
      id: initial?.id,
      designationId,
      roleKey: roleKey || null,
      serviceTypeId,
      quantity: q,
      shiftHours: Number.parseInt(shiftHours, 10) === 12 ? 12 : 8,
      components,
      payrollDayBaseId: payrollDayBaseId || null,
      billingDayBaseId: billingDayBaseId || null,
      benefits,
      deductions,
      employerContributions,
    });
  };

  // Inline mode: no Save button — every edit is pushed up immediately.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!inline || !onChangeRef.current || resourceBaselineSnapshot === "") return;
    if (currentResourceSnapshot === resourceBaselineSnapshot) return;
    onChangeRef.current({
      id: initial?.id,
      designationId,
      roleKey: roleKey || null,
      serviceTypeId,
      quantity: isWages ? 1 : parseInt(quantity, 10) || 1,
      shiftHours: Number.parseInt(shiftHours, 10) === 12 ? 12 : 8,
      components,
      payrollDayBaseId: payrollDayBaseId || null,
      billingDayBaseId: billingDayBaseId || null,
      benefits,
      deductions,
      employerContributions,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, currentResourceSnapshot]);

  const totalBenefits = benefits.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  // Statutory ESI on the contract (full-month) gross. Percentages and the
  // wage ceiling are driven by the ESI cost components configured in
  // Control Center → Cost Component Manager (employee & employer entries).
  // Falls back to statutory defaults (0.75% / 3.25% / ₹21,000) only if not set.
  const _esiComponentsTotal = components.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const _esiBenefitsTotal = benefits.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const _esiGross = _esiComponentsTotal + _esiBenefitsTotal;
  const _esiWashing = components
    .filter((c) => /\bwashing\b/i.test(c.name))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const _esiConveyance = components
    .filter((c) => /\bconveyance\b|\bconv\.?\b/i.test(c.name))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const _esiBase = Math.max(0, _esiGross - _esiWashing - _esiConveyance);
  const _esiEmpItem = deductions.find(isEsiItem);
  const _esiErItem = employerContributions.find(isEsiItem);
  const _esiEmpPct =
    _esiEmpItem && Number(_esiEmpItem.percentage) > 0 ? Number(_esiEmpItem.percentage) : 0.75;
  const _esiErPct =
    _esiErItem && Number(_esiErItem.percentage) > 0 ? Number(_esiErItem.percentage) : 3.25;
  const _esiCap =
    (_esiEmpItem && Number(_esiEmpItem.capAmount) > 0 && Number(_esiEmpItem.capAmount)) ||
    (_esiErItem && Number(_esiErItem.capAmount) > 0 && Number(_esiErItem.capAmount)) ||
    21000;
  // ESI ceiling applies to ESI wages (gross excluding washing & conveyance),
  // not raw gross — those allowances are statutorily excluded from ESI wages.
  const _esiEligible = _esiBase > 0 && _esiBase <= _esiCap;
  const esiEmployeeAmount = _esiEligible ? Math.ceil(_esiBase * (_esiEmpPct / 100)) : 0;
  const esiEmployerAmount = _esiEligible ? Math.ceil(_esiBase * (_esiErPct / 100)) : 0;

  const totalDeductions =
    deductions.reduce((s, b) => s + (isStatutoryEsi(b) ? esiEmployeeAmount : contractTotalAmount(b)), 0);
  const totalEmployer = employerContributions
    .filter((b) => !isRelieverLine(b) && !isMgmtFeeLine(b))
    .reduce((s, b) => s + (isStatutoryEsi(b) ? esiEmployerAmount : contractTotalAmount(b)), 0);

  const selectedDesignation = designations.find((d) => d.id === designationId);

  const content = (
        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-3">
            {!isWages && (<>
            <Field label="Designation *">
              <Popover open={designationOpen} onOpenChange={setDesignationOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="h-10 w-full justify-between rounded-lg font-normal"
                  >
                    {selectedDesignation ? (
                      <span className="truncate">
                        {selectedDesignation.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                  onWheel={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search designation…"
                      value={designationQuery}
                      onValueChange={setDesignationQuery}
                    />
                    <CommandList className="max-h-64 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                      <CommandEmpty>No designation found.</CommandEmpty>
                      <CommandGroup>
                        {filteredDesignations.map((d) => (
                          <CommandItem
                            key={d.id}
                            value={`${d.code} ${d.name} ${d.id}`}
                            onSelect={() => {
                              setDesignationId(d.id);
                              setDesignationQuery("");
                              setDesignationOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                designationId === d.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="text-sm">{d.name}</span>
                              {d.code && (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {d.code}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>

            <Field label="Service Type *">
              <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
                <SelectTrigger className="h-10 rounded-lg">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {serviceTypes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Agreed Deployment *">
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>

            </>)}
            <Field label="Shift Hours *">
              <Select value={shiftHours} onValueChange={setShiftHours}>
                <SelectTrigger className="h-10 rounded-lg">
                  <SelectValue placeholder="Select shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 hours</SelectItem>
                  <SelectItem value="12">12 hours</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>


          {!isWages && (
          <Field label="Role">
            <Select value={roleKey || "__none"} onValueChange={(v) => setRoleKey(v === "__none" ? "" : v)}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue placeholder="Map to a system role (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {rolesList.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>


          )}

          <Field label="Payroll Days *">
            <Select value={payrollDayBaseId} onValueChange={setPayrollDayBaseId}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue placeholder="Select payroll-days rule" />
              </SelectTrigger>
              <SelectContent>
                {payrollDayBases.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex flex-col">
                      <span>{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.method === "fixed_days"
                          ? `Fixed ${p.fixedDays ?? 26} days`
                          : p.method === "fixed_annual_average"
                            ? `Fixed 30.4166 days`
                            : p.method === "actual_minus_weekly_off"
                              ? `Actual − weekly off`
                              : (p.method as string) === "actual_minus_days"
                                ? `Actual − ${p.fixedDays ?? 4} days`
                                : `Actual days in month`}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Billing Days">
            <Select value={billingDayBaseId} onValueChange={setBillingDayBaseId}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue placeholder="Same as payroll days" />
              </SelectTrigger>
              <SelectContent>
                {billingDayBases.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex flex-col">
                      <span>{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.method === "fixed_days"
                          ? `Fixed ${p.fixedDays ?? 26} days`
                          : p.method === "fixed_annual_average"
                            ? `Fixed 30.4166 days`
                            : p.method === "actual_minus_weekly_off"
                              ? `Actual − weekly off`
                              : (p.method as string) === "actual_minus_days"
                                ? `Actual − ${p.fixedDays ?? 4} days`
                                : `Actual days in month`}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Wages Components
              </h4>
              <Popover
                open={allowancePickerOpen}
                onOpenChange={setAllowancePickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={availableExtras.length === 0}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add allowance
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-72 p-0"
                  align="end"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search allowance…"
                      value={allowanceQuery}
                      onValueChange={setAllowanceQuery}
                    />
                    <CommandList className="max-h-64 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                      <CommandEmpty>No more allowances.</CommandEmpty>
                      <CommandGroup>
                        {filteredAvailableExtras.map((a) => (
                          <CommandItem
                            key={a.id}
                            value={`${a.shortName} ${a.displayName} ${a.name} ${a.id}`}
                            onSelect={() => addComponent(a)}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm">
                                {a.shortName || a.displayName}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {a.displayName}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {components.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No wage components yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {components.map((c) => (
                  <div key={c.allowanceId} className="grid gap-1">
                    <Label className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span className="truncate">{c.name}</span>
                      <button
                        type="button"
                        onClick={() => removeComponent(c.allowanceId)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Label>
                    <DecimalAmountInput
                      value={c.amount}
                      onValueChange={(amount) => updateAmount(c.allowanceId, amount)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Gross
              </span>
              <span className="ml-3 text-base font-bold text-foreground">
                {gross.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Overtime basis — per-resource selection of wage components */}
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Extra Duty (ED)
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Pick which wage components form the ED base for this resource. All wage components are included by default — remove any that shouldn't be paid on extra duty.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={components.length === 0}
                  onClick={() => setAllOtComponents(true)}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={components.length === 0}
                  onClick={() => setAllOtComponents(false)}
                >
                  Clear all
                </Button>
              </div>
            </div>

            {components.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Add wage components first — extra duty is calculated from them.
              </div>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  {components.map((c) => {
                    const on = c.includeInOt !== false;
                    return (
                      <button
                        key={`ot-${c.allowanceId}`}
                        type="button"
                        onClick={() => toggleOtComponent(c.allowanceId)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                          on
                            ? "border-primary/40 bg-primary/10"
                            : "border-border bg-card opacity-60",
                        )}
                        aria-pressed={on}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {c.name}
                          </span>
                          <span className="block text-[11px] tabular-nums text-muted-foreground">
                            {Number(c.amount || 0).toFixed(2)}
                          </span>
                        </span>
                        {on ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    ED per duty = ED base ÷ payroll days
                    {otDivisorDays ? ` (${otDivisorDays})` : ""}
                    {otDivisorDays ? ` = ${(otBaseTotal / otDivisorDays).toFixed(2)}` : ""}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    ED Base
                  </span>
                  <span className="text-base font-bold text-foreground">
                    {otBaseTotal.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>




          {/* Deductions Management */}
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Deductions
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Add deduction components (LWF, PT, etc.) that reduce gross to arrive at net payable.
                </p>
              </div>
              <Popover open={deductionPickerOpen} onOpenChange={setDeductionPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add component
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-0"
                  align="end"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <Command key={deductionOptionsKey} shouldFilter={false}>
                    <CommandInput
                      placeholder="Which deduction would you like to add?"
                      value={deductionQuery}
                      onValueChange={setDeductionQuery}
                    />
                    <CommandList className="max-h-64 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                      <CommandEmpty>No more components.</CommandEmpty>
                      <CommandGroup>
                        {filteredAvailableDeductions.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.state} ${c.id}`}
                            onSelect={() => addDeduction(c)}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm">{c.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {c.description
                                  ? c.description
                                  : c.calcType === "percentage"
                                    ? `${c.percentage}% of ${c.baseComponents.map((b, i) => (i === 0 ? b.label : `${b.operator} ${b.label}`)).join(" ") || "—"}`
                                    : c.amount != null && c.amount > 0
                                      ? `Fixed ₹${c.amount.toLocaleString("en-IN")}`
                                      : "Fixed amount (manual)"}
                                {!c.description && c.state && c.state !== "N/A" ? ` · ${c.state}` : ""}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {deductions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-4 py-6 text-center">
                <div className="text-sm font-medium text-foreground">No deductions added</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Click <span className="font-semibold text-foreground">Add component</span> to attach LWF, PT…
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {deductions.map((b) => (
                  <div
                    key={b.costComponentId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{b.name}</span>
                        {b.state && b.state !== "N/A" && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {b.state}
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            hasConfiguredFormula(b)
                              ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                              : b.calcType === "percentage"
                              ? "bg-accent/15 text-accent"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                          )}
                          title={hasConfiguredFormula(b) ? String(b.formulaExpression ?? "") : undefined}
                        >
                          {hasConfiguredFormula(b)
                            ? "Formula"
                            : b.calcType === "percentage"
                            ? `${b.percentage}%`
                            : "Fixed"}
                        </span>
                        {hasConfiguredFormula(b) && b.formulaVersion != null && (
                          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 dark:text-violet-300" title="Formula master version">
                            v{b.formulaVersion}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground" title={hasConfiguredFormula(b) ? String(b.formulaExpression ?? "") : undefined}>
                        {hasConfiguredFormula(b)
                          ? describeFormulaItem(b)
                          : b.calcType === "percentage"
                          ? isStatutoryEsi(b)
                            ? `${b.percentage}% · ${ESI_CONTRACT_NOTE}`
                            : `${b.percentage}% of ${b.baseComponents.map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`)).join(" ") || "—"}${b.capAmount ? ` · cap ₹${b.capAmount.toLocaleString("en-IN")}` : ""}`
                          : "Manual entry"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.calcType === "fixed" && !hasConfiguredFormula(b) ? (
                         <DecimalAmountInput
                           value={b.amount}
                           className="h-9 w-28"
                           onValueChange={(amount) => updateDeductionAmount(b.costComponentId, amount)}
                         />
                      ) : (
                        <span className="w-28 text-right text-sm font-semibold text-foreground">
                          {isStatutoryEsi(b) ? esiEmployeeAmount.toFixed(2) : Number(b.amount).toFixed(2)}
                        </span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDeduction(b.costComponentId)}
                        aria-label="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end border-t border-border pt-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Deductions
                  </span>
                  <span className="ml-3 text-base font-bold text-foreground">
                    {totalDeductions.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Employer Contribution */}
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Employer Contribution
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Add employer-side cost components (PF, ESIC, LWF, Gratuity, Bonus, Uniform, Management Fee, etc.) to compute Total CTC.
                </p>
              </div>
              <Popover open={employerPickerOpen} onOpenChange={setEmployerPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add component
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-0"
                  align="end"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <Command key={employerOptionsKey} shouldFilter={false}>
                    <CommandInput
                      placeholder="Which contribution would you like to add?"
                      value={employerQuery}
                      onValueChange={setEmployerQuery}
                    />
                    <CommandList className="max-h-64 overflow-y-auto overscroll-contain" onWheel={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                      <CommandEmpty>No more components.</CommandEmpty>
                      <CommandGroup>
                        {filteredAvailableEmployer.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.state} ${c.id}`}
                            onSelect={() => addEmployerContribution(c)}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm">{c.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {c.description
                                  ? c.description
                                  : c.calcType === "percentage"
                                    ? `${c.percentage}% of ${c.baseComponents.map((b, i) => (i === 0 ? b.label : `${b.operator} ${b.label}`)).join(" ") || "—"}`
                                    : c.amount != null && c.amount > 0
                                      ? `Fixed ₹${c.amount.toLocaleString("en-IN")}`
                                      : "Fixed amount (manual)"}
                                {!c.description && c.state && c.state !== "N/A" ? ` · ${c.state}` : ""}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {employerContributions.filter((b) => !isRelieverLine(b) && !isMgmtFeeLine(b)).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-4 py-6 text-center">
                <div className="text-sm font-medium text-foreground">No employer contributions added</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Click <span className="font-semibold text-foreground">Add component</span> to attach PF, ESIC, Gratuity, Bonus…
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {employerContributions.filter((b) => !isRelieverLine(b) && !isMgmtFeeLine(b)).map((b) => (
                  <div
                    key={b.costComponentId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{b.name}</span>
                        {b.state && b.state !== "N/A" && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {b.state}
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            hasConfiguredFormula(b)
                              ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                              : b.calcType === "percentage"
                              ? "bg-accent/15 text-accent"
                              : /management\s*fee/i.test(b.name)
                                ? "bg-primary/15 text-primary"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                          )}
                          title={hasConfiguredFormula(b) ? String(b.formulaExpression ?? "") : undefined}
                        >
                          {hasConfiguredFormula(b)
                            ? "Formula"
                            : b.calcType === "percentage"
                            ? `${b.percentage}%`
                            : /management\s*fee/i.test(b.name)
                              ? "Prorated"
                              : "Fixed"}
                        </span>
                        {hasConfiguredFormula(b) && b.formulaVersion != null && (
                          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-700 dark:text-violet-300" title="Formula master version">
                            v{b.formulaVersion}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground" title={hasConfiguredFormula(b) ? String(b.formulaExpression ?? "") : undefined}>
                        {hasConfiguredFormula(b)
                          ? describeFormulaItem(b)
                          : b.calcType === "percentage"
                          ? isStatutoryEsi(b)
                            ? `${b.percentage}% · ${ESI_CONTRACT_NOTE}`
                            : `${b.percentage}% of ${b.baseComponents.map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`)).join(" ") || "—"}${b.capAmount ? ` · cap ₹${b.capAmount.toLocaleString("en-IN")}` : ""}`
                          : /management\s*fee/i.test(b.name)
                            ? "Prorated by T Days (per-day × actual payable days)"
                            : "Fixed amount"}
                      </div>

                    </div>
                    <div className="flex items-center gap-2">
                      {b.calcType === "fixed" && !hasConfiguredFormula(b) ? (
                         <DecimalAmountInput
                           value={b.amount}
                           className="h-9 w-28"
                           onValueChange={(amount) => updateEmployerAmount(b.costComponentId, amount)}
                         />
                      ) : (
                        <span className="w-28 text-right text-sm font-semibold text-foreground">
                          {isStatutoryEsi(b) ? esiEmployerAmount.toFixed(2) : Number(b.amount).toFixed(2)}
                        </span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeEmployerContribution(b.costComponentId)}
                        aria-label="Remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end border-t border-border pt-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Employer Contribution
                  </span>
                  <span className="ml-3 text-base font-bold text-foreground">
                    {totalEmployer.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Reliever & Management Fee (billing add-ons) */}
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="mb-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Reliever &amp; Management Fee
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Billing add-ons applied after Total CTC: Total CTC → Reliever → Billing Rate → Management Fee → Final Billing Rate.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { kind: "reliever" as const, label: "Reliever charges", masters: relieverMasters, selected: selectedRelieverId },
                { kind: "mgmt" as const, label: "Management fee", masters: mgmtFeeMasters, selected: selectedMgmtFeeId },
              ]).map((cfg) => {
                const item = employerContributions.find((b) =>
                  cfg.kind === "reliever" ? isRelieverLine(b) : isMgmtFeeLine(b),
                );
                return (
                  <div key={cfg.kind} className="rounded-lg border border-border bg-card px-3 py-2">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {cfg.label}
                    </Label>
                    <Select
                      value={cfg.selected || "__none__"}
                      onValueChange={(v) => setBillingAddOn(cfg.kind, v)}
                    >
                      <SelectTrigger className="mt-1 h-9">
                        <SelectValue placeholder={`Select ${cfg.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not applicable</SelectItem>
                        {cfg.masters.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                        <SelectItem
                          value={cfg.kind === "mgmt" ? CUSTOM_MANAGEMENT_FEE_ID : CUSTOM_RELIEVER_ID}
                        >
                          Custom amount
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {(item?.costComponentId === CUSTOM_MANAGEMENT_FEE_ID ||
                      item?.costComponentId === CUSTOM_RELIEVER_ID) && (
                      <div className="mt-2">
                        <Label className="sr-only" htmlFor={`custom-${cfg.kind}-amount`}>
                          Custom {cfg.label.toLowerCase()} amount
                        </Label>
                        <Input
                          id={`custom-${cfg.kind}-amount`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={Number(item.amount) || ""}
                          placeholder="Enter custom amount"
                          onChange={(event) =>
                            updateEmployerAmount(
                              item.costComponentId,
                              Math.max(0, Number(event.target.value) || 0),
                            )
                          }
                        />
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {item ? describeFormulaItem(item) : "None selected"}
                      </span>
                      {item && (
                        <span className="text-sm font-semibold text-foreground">
                          {liveAddOnAmount(cfg.kind, item).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>



          {/* Salary Breakdown Preview */}
          <SalaryBreakdownTable
            designationName={selectedDesignation?.name ?? ""}
            payrollDayBase={payrollDayBases.find((p) => p.id === payrollDayBaseId)}
            components={components}
            benefits={benefits}
            deductions={deductions}
            employerContributions={employerContributions}
            componentDescriptions={componentDescriptions}
          />

        </div>
  );

  if (inline) {
    return (
      <div ref={dialogContentRef} className="modern-business-form">
        <div className="modern-business-form">{content}</div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        overlayClassName={isWages ? "z-[110]" : undefined}
        className={`max-h-[94dvh] overflow-y-auto sm:w-[calc(100vw-3rem)] sm:max-w-6xl xl:max-w-7xl${isWages ? " z-[110]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle>
            {isWages
              ? initial?.id ? "Edit Wages" : "Add Wages"
              : initial?.id ? "Edit Resource" : "Add Resource"}
          </DialogTitle>
          <DialogDescription>
            {isWages
              ? "Configure this employee's own wage sheet — shift hours, payroll days and wage components."
              : "Map a designation, service type and quantity, then configure wage components."}
          </DialogDescription>
        </DialogHeader>

        {isWages && subject && (
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <div className="text-sm font-semibold text-foreground">
              {subject.name || "—"}
              {subject.employeeCode ? (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{subject.employeeCode}</span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {subject.designationName ? (
                <span className="rounded-full bg-secondary px-2 py-0.5">{subject.designationName}</span>
              ) : null}
              {subject.departmentName ? (
                <span className="rounded-full bg-secondary px-2 py-0.5">{subject.departmentName}</span>
              ) : null}
            </div>
          </div>
        )}

        {content}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-force-enabled={resourceHasChanges ? "true" : undefined}
            onClick={handleSubmit}
          >
            {initial?.id ? "Save Resource" : "Add Resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Salary Breakdown Table                                             */
/* ------------------------------------------------------------------ */

export function SalaryBreakdownTable({
  designationName,
  payrollDayBase,
  components,
  benefits,
  deductions,
  employerContributions,
  componentDescriptions,
}: {
  designationName: string;
  payrollDayBase: PayrollDayBase | undefined;
  components: ResourceComponent[];
  benefits: BenefitItem[];
  deductions: BenefitItem[];
  employerContributions: BenefitItem[];
  componentDescriptions?: Record<string, string>;
}) {
  const describeRow = (b: BenefitItem) =>
    describeComponentFormula(b, componentDescriptions?.[b.costComponentId] ?? null);
  const payableDays = computePayableDays(payrollDayBase);
  const divisorDays = payableDays;

  const componentsTotal = components.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  // Reliever charges and management fee are billing add-ons — they sit after
  // Total CTC, never inside gross.
  const coreBenefits = benefits.filter((b) => !isRelieverLine(b) && !isMgmtFeeLine(b));
  const benefitAddOns = benefits.filter((b) => isRelieverLine(b) || isMgmtFeeLine(b));
  const benefitsTotal = coreBenefits.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const gross = componentsTotal + benefitsTotal;

  // Statutory ESI: percentages and the wage ceiling come from the ESI
  // cost components configured in Control Center → Cost Component Manager
  // (employee & employer entries). Falls back to statutory defaults
  // (0.75% / 3.25% / ₹21,000) only if not configured. The ceiling applies
  // to ESI wages (gross excluding washing & conveyance), NOT raw gross.
  const washingTotal = components
    .filter((c) => /\bwashing\b/i.test(c.name))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const conveyanceTotal = components
    .filter((c) => /\bconveyance\b|\bconv\.?\b/i.test(c.name))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const esiBase = Math.max(0, gross - washingTotal - conveyanceTotal);
  const esiEmpItem = deductions.find(isEsiItem);
  const esiErItem = employerContributions.find(isEsiItem);
  const esiEmpPct =
    esiEmpItem && Number(esiEmpItem.percentage) > 0 ? Number(esiEmpItem.percentage) : 0.75;
  const esiErPct =
    esiErItem && Number(esiErItem.percentage) > 0 ? Number(esiErItem.percentage) : 3.25;
  const esiCap =
    (esiEmpItem && Number(esiEmpItem.capAmount) > 0 && Number(esiEmpItem.capAmount)) ||
    (esiErItem && Number(esiErItem.capAmount) > 0 && Number(esiErItem.capAmount)) ||
    21000;
  const esiEligible = esiBase > 0 && esiBase <= esiCap;
  const esiEmployeeAmount = esiEligible ? Math.ceil(esiBase * (esiEmpPct / 100)) : 0;
  const esiEmployerAmount = esiEligible ? Math.ceil(esiBase * (esiErPct / 100)) : 0;

  const isReliever = (b: BenefitItem) => isRelieverLine(b);
  const isMgmtFee = (b: BenefitItem) => isMgmtFeeLine(b);
  const coreEmployer = employerContributions.filter((b) => !isReliever(b) && !isMgmtFee(b));
  const relieverItems = [...employerContributions, ...benefitAddOns].filter(isReliever).slice(0, 1);
  const mgmtFeeItems = [...employerContributions, ...benefitAddOns].filter(isMgmtFee).slice(0, 1);

  // Totals must use exactly the same value each row displays: the statutory
  // fallback only applies when the ESI component has no configured formula.
  const deductionsTotal = deductions.reduce(
    (sum, item) => sum + (isStatutoryEsi(item) ? esiEmployeeAmount : contractTotalAmount(item)),
    0,
  );
  const coreEmployerTotal = coreEmployer.reduce(
    (sum, item) => sum + (isStatutoryEsi(item) ? esiEmployerAmount : contractTotalAmount(item)),
    0,
  );
  // Always evaluate reliever against the live Total CTC. Saved contract rows
  // may contain an amount from an older master formula and must not win here.
  // Exception: a custom / plain-fixed reliever keeps the entered amount — the
  // breakdown row must use this same helper so it never disagrees with the
  // Reliever & Management Fee card or the Billing Rate total.
  const relieverAmountFor = (item: BenefitItem) =>
    item.costComponentId === CUSTOM_RELIEVER_ID ||
    (item.calcType === "fixed" && !hasConfiguredFormula(item))
      ? Number(item.amount) || 0
      : computeBenefitAmount(item, components, coreBenefits, [], coreEmployer);
  const relieverTotal = relieverItems.reduce(
    (sum, item) => sum + relieverAmountFor(item),
    0,
  );

  const totalCTC = gross + coreEmployerTotal;
  const totalRate = totalCTC + relieverTotal;
  const managementAmountFor = (item: BenefitItem) =>
    item.costComponentId === CUSTOM_MANAGEMENT_FEE_ID ||
    (item.calcType === "fixed" && !hasConfiguredFormula(item))
      ? Number(item.amount) || 0
      : computeBenefitAmount(item, components, coreBenefits, [], [
          ...coreEmployer,
          ...relieverItems.map((reliever) => ({
            ...reliever,
            amount: relieverAmountFor(reliever),
          })),

        ]);
  const mgmtFeeTotal = mgmtFeeItems.reduce((sum, item) => sum + managementAmountFor(item), 0);
  const grandTotal = totalRate + mgmtFeeTotal;

  const basisLabel = payrollDayBase
    ? payrollDayBase.method === "fixed_days"
      ? `${payrollDayBase.fixedDays ?? 0} Days`
      : payrollDayBase.method === "fixed_annual_average"
        ? `30.4166 Days (annual average)`
        : payrollDayBase.method === "actual_minus_weekly_off"
          ? `${payableDays} Days (actual − weekly off)`
          : payrollDayBase.method === "custom_weekdays"
            ? `${payableDays} Days (custom weekdays)`
            : `${payableDays} Days (actual)`
    : "—";

  const earnedFor = (amount: number) =>
    divisorDays > 0 ? (amount / divisorDays) * payableDays : 0;

  const earnedGross = earnedFor(gross);
  const earnedDeductions = earnedFor(deductionsTotal);
  const netPayable = gross - deductionsTotal;
  const earnedNetPayable = earnedFor(netPayable);
  const earnedCTC = earnedFor(totalCTC);
  const earnedRate = earnedFor(totalRate);
  const earnedGrand = earnedFor(grandTotal);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-secondary/40 px-4 py-2.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Salary Breakdown Preview
        </h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Auto-computed from wage components, benefits, deductions and the selected payroll-days rule.
        </p>
      </div>
      <div className="overflow-x-clip">
        <table className="ios-table w-full text-sm">
          <tbody className="[&_tr]:border-b [&_tr]:border-border/60 [&_td]:px-3 [&_td]:py-2">
            <tr className="bg-secondary/20">
              <td className="font-medium text-muted-foreground">Designation</td>
              <td className="text-center font-semibold">{designationName || "—"}</td>
              <td className="text-right text-muted-foreground">Total Payable Days</td>
              <td className="text-right">
                <span className="inline-block rounded bg-amber-200/70 px-2 py-0.5 font-bold text-amber-900 dark:bg-amber-300/30 dark:text-amber-100">
                  {payableDays || "—"}
                </span>
              </td>
            </tr>
            <tr className="bg-muted/40">
              <td className="font-bold uppercase text-foreground">Salary Particulars</td>
              <td className="text-center font-bold">{basisLabel}</td>
              <td />
              <td className="text-right font-bold tracking-wider">( EARNED ) Rs.</td>
            </tr>
            {(() => {
              const visibleComponents = components.filter((c) => Number(c.amount) > 0);
              const visibleBenefits = coreBenefits.filter((b) => Number(b.amount) > 0);
              if (visibleComponents.length === 0 && visibleBenefits.length === 0) {
                return (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                      No salary particulars configured.
                    </td>
                  </tr>
                );
              }
              return (
                <>
                  {visibleComponents.map((c) => (
                    <tr key={`c-${c.allowanceId}`}>
                      <td>{c.name}</td>
                      <td className="text-center tabular-nums">{Number(c.amount).toFixed(2)}</td>
                      <td />
                      <td className="text-right tabular-nums">{earnedFor(Number(c.amount)).toFixed(2)}</td>
                    </tr>
                  ))}
                  {visibleBenefits.map((b) => (
                    <tr key={`b-${b.costComponentId}`}>
                      <td>
                        {b.name}
                        {b.calcType === "percentage" && (
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            @ {b.percentage}% of{" "}
                            {b.baseComponents
                              .map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`))
                              .join(" ") || "—"}
                            {b.capAmount ? ` (cap ₹${b.capAmount.toLocaleString("en-IN")})` : ""}
                          </span>
                        )}
                      </td>
                      <td className="text-center tabular-nums">{Number(b.amount).toFixed(2)}</td>
                      <td />
                      <td className="text-right tabular-nums">{earnedFor(Number(b.amount)).toFixed(2)}</td>
                    </tr>
                  ))}
                </>
              );
            })()}
            <tr className="bg-sky-100 font-bold dark:bg-sky-500/20">
              <td className="uppercase">TOTAL Gross Rs.</td>
              <td className="text-center tabular-nums">{gross.toFixed(2)}</td>
              <td />
              <td className="text-right text-base tabular-nums">{earnedGross.toFixed(2)}</td>
            </tr>
            <tr className="bg-muted/40">
              <td className="font-bold uppercase text-foreground">Deductions</td>
              <td />
              <td />
              <td className="text-right font-bold tracking-wider">( EARNED ) Rs.</td>
            </tr>
            {(() => {
              const visibleDeductions = deductions.filter((b) => Number(b.amount) > 0 || isStatutoryEsi(b));
              if (visibleDeductions.length === 0) {
                return (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                      No deductions configured.
                    </td>
                  </tr>
                );
              }
              return visibleDeductions.map((b) => (
                <tr key={`d-${b.costComponentId}`}>
                  <td>
                    {b.name}
                    {isStatutoryEsi(b) ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {describeRow(b) || `${b.percentage}% · ${ESI_CONTRACT_NOTE}`}
                      </span>
                    ) : describeRow(b) ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">{describeRow(b)}</span>
                    ) : null}


                  </td>
                  <td className="text-center tabular-nums">{isStatutoryEsi(b) ? esiEmployeeAmount.toFixed(2) : Number(b.amount).toFixed(2)}</td>
                  <td />
                  <td className="text-right tabular-nums">{isStatutoryEsi(b) ? earnedFor(esiEmployeeAmount).toFixed(2) : earnedFor(Number(b.amount)).toFixed(2)}</td>
                </tr>
              ));
            })()}
            <tr className="bg-rose-100 font-semibold dark:bg-rose-500/20">
              <td className="uppercase">Total Deductions Rs.</td>
              <td className="text-center tabular-nums">{deductionsTotal.toFixed(2)}</td>
              <td />
              <td className="text-right tabular-nums">{earnedDeductions.toFixed(2)}</td>
            </tr>
            <tr className="bg-cyan-100 font-bold dark:bg-cyan-500/20">
              <td className="uppercase">Total Amount (Payable) Rs.</td>
              <td className="text-center tabular-nums">{netPayable.toFixed(2)}</td>
              <td />
              <td className="text-right text-base tabular-nums">{earnedNetPayable.toFixed(2)}</td>
            </tr>
            <tr className="bg-muted/40">
              <td className="font-bold uppercase text-foreground">Employer Contribution</td>
              <td />
              <td />
              <td className="text-right font-bold tracking-wider">( EARNED ) Rs.</td>
            </tr>
            {(() => {
              const visibleEmployer = coreEmployer.filter((b) => Number(b.amount) > 0 || isStatutoryEsi(b));
              if (visibleEmployer.length === 0) {
                return (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                      No employer contributions configured.
                    </td>
                  </tr>
                );
              }
              return visibleEmployer.map((b) => (
                <tr key={`e-${b.costComponentId}`}>
                  <td>
                    {b.name}
                    {isStatutoryEsi(b) ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {describeRow(b) || `${b.percentage}% · ${ESI_CONTRACT_NOTE}`}
                      </span>
                    ) : describeRow(b) ? (
                      <span className="ml-2 text-[11px] text-muted-foreground">{describeRow(b)}</span>
                    ) : null}


                  </td>
                  <td className="text-center tabular-nums">{isStatutoryEsi(b) ? esiEmployerAmount.toFixed(2) : Number(b.amount).toFixed(2)}</td>
                  <td />
                  <td className="text-right tabular-nums">{isStatutoryEsi(b) ? earnedFor(esiEmployerAmount).toFixed(2) : earnedFor(Number(b.amount)).toFixed(2)}</td>
                </tr>
              ));
            })()}
            <tr className="bg-emerald-100 font-bold dark:bg-emerald-500/20">
              <td className="uppercase">Total CTC Rs.</td>
              <td className="text-center tabular-nums">{totalCTC.toFixed(2)}</td>
              <td />
              <td className="text-right text-base tabular-nums">{earnedCTC.toFixed(2)}</td>
            </tr>
            {relieverItems.map((b) => {
              const liveAmount = relieverAmountFor(b);
              return (
              <tr key={`r-${b.costComponentId}`}>
                <td>
                  {b.name}
                  {b.calcType === "percentage" && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      @ {b.percentage}% of{" "}
                      {b.baseComponents
                        .map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`))
                        .join(" ") || "—"}
                      {b.capAmount ? ` (cap ₹${b.capAmount.toLocaleString("en-IN")})` : ""}
                    </span>
                  )}
                </td>
                <td className="text-center tabular-nums">{liveAmount.toFixed(2)}</td>
                <td />
                <td className="text-right tabular-nums">{earnedFor(liveAmount).toFixed(2)}</td>
              </tr>
              );
            })}
            {relieverItems.length > 0 && (
              <tr className="bg-teal-100 font-bold dark:bg-teal-500/20">
                <td className="uppercase">Billing Rate Rs.</td>
                <td className="text-center tabular-nums">{totalRate.toFixed(2)}</td>
                <td />
                <td className="text-right text-base tabular-nums">{earnedRate.toFixed(2)}</td>
              </tr>
            )}
            {mgmtFeeItems.map((b) => {
              const liveAmount = managementAmountFor(b);
              return (
              <tr key={`m-${b.costComponentId}`} className="bg-amber-50 dark:bg-amber-500/10">
                <td className="font-semibold">
                  {b.name}
                  {b.calcType === "percentage" && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      @ {b.percentage}% of{" "}
                      {b.baseComponents
                        .map((x, i) => (i === 0 ? x.label : `${x.operator} ${x.label}`))
                        .join(" ") || "—"}
                      {b.capAmount ? ` (cap ₹${b.capAmount.toLocaleString("en-IN")})` : ""}
                    </span>
                  )}
                </td>
                <td className="text-center tabular-nums">{liveAmount.toFixed(2)}</td>
                <td />
                <td className="text-right tabular-nums">{earnedFor(liveAmount).toFixed(2)}</td>
              </tr>
              );
            })}
            {mgmtFeeItems.length > 0 && (
              <tr className="bg-indigo-100 font-bold dark:bg-indigo-500/20">
                <td className="uppercase">Final Billing Rate Rs.</td>
                <td className="text-center tabular-nums">{grandTotal.toFixed(2)}</td>
                <td />
                <td className="text-right text-base tabular-nums">{earnedGrand.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
