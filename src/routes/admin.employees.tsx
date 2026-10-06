import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { RecordViewButton } from "@/components/RecordViewButton";
import { useServerFn } from "@tanstack/react-start";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { NOMANS_UNIT_ID as NOMANS_UNIT_ID_CONST } from "@/lib/business-constants";
import { autoIssuePostingOrder } from "@/lib/posting-order-auto";
import {
  ComplianceSection,
  KnowledgeSection,
  PhysicalSection,
  IdentificationSection,
  CriminalSection,
  OtherSection,
  ListSection,
  NomineeSection,
  SectionHeaderContext,
} from "@/components/candidate-extra-sections";
import { GuardReportingManagersEditor } from "@/components/GuardReportingManagersEditor";
import { UnitDesignationSelect } from "@/components/UnitDesignationSelect";
import {
  type ContractResource,
  useAllowanceTypes,
  usePayrollDayBases,
  useCostComponentOptions,
  computeBenefitAmount,
  hasConfiguredFormula,
  SalaryBreakdownTable,
} from "./admin.contracts.client-contracts";

import { notifyOnboardingApprovers, notifyUser, createNotification } from "@/lib/notifications";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Clock,
  Download,
  Edit2,
  FileJson,
  FileSignature,
  FileSpreadsheet,
  FileText,
  HeartHandshake,
  LayoutList,
  Loader2,
  MapPin,
  Network,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { downloadCsv, csvJoin, csvDate, csvYesNo, csvStatus } from "@/lib/csv-export";
import { SignDocumentDialog } from "@/components/SignDocumentDialog";
import type { DocType } from "@/lib/company-documents";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentPermissions } from "@/lib/rbac";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { findCandidateByAadhaar } from "@/lib/workflows";
import { RehireRequestDialog, type ExistingCandidateMatch } from "@/components/RehireRequestDialog";

import { DigilockerVerify } from "@/components/DigilockerVerify";
import { PanVerify } from "@/components/PanVerify";
import { BankVerify } from "@/components/BankVerify";
import { useEmployeeVerificationEnabled } from "@/lib/platform-settings";
import { hasCompletedDigilockerVerification } from "@/lib/surepass.functions";
import { logActivity } from "@/lib/activity-log";
import { prepareUpload, withUploadRetry } from "@/lib/robust-upload";
import { RehireApprovalsCard, useRehireByCandidate } from "@/components/RehirePipelineCard";
import { RehireEnableDialog } from "@/components/RehireEnableDialog";
import { RehireReviewDialog } from "@/components/RehireReviewDialog";
import { type RehireRequest } from "@/lib/workflows";
import { fetchWorkflowByKey, fetchWorkflowSteps, REHIRE_WORKFLOW_KEY } from "@/lib/workflows";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format as formatDateFns, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { confirmAction, confirmDiscardChanges, notifySaved } from "@/components/ConfirmProvider";
import {
  QK_CANDIDATE_UNITS,
  QK_SCOPE_ASSIGNMENTS,
  SCOPE_TYPE_LABEL,
  useScopeAssignments,
  useCandidateUnits,
  type ScopeAssignment,
  type ScopeType,
} from "@/lib/deployment";

import { useBranches, useCustomers, useStates } from "@/lib/admin-data";
import { postMovements, type LocationType } from "@/lib/inv-helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeDocumentsExportDialog } from "@/components/employee-documents-export-dialog";
import { fetchAllPages } from "@/lib/supabase-batch";

type EmployeesSearch = { tab?: "employee" | "candidate"; rehire?: string };

const EMPTY_WAGE: ContractResource = {
  designationId: "",
  roleKey: null,
  serviceTypeId: "",
  quantity: 1,
  shiftHours: 8,
  billingDayBaseId: null,
  components: [],
  payrollDayBaseId: null,
  benefits: [],
  deductions: [],
  employerContributions: [],
};

/**
 * Lightweight inline wage editor for non-billable employees. Rendered directly
 * inside the employee wizard (no nested dialog). Only uses Select/Input
 * primitives — Popover/Command pickers trigger a Radix ref loop when mounted
 * inline inside the wizard's Dialog, so they are intentionally avoided here.
 */
function InlineWageEditor({
  value,
  onChange,
}: {
  value: ContractResource;
  onChange: (r: ContractResource) => void;
}) {
  const allowanceTypes = useAllowanceTypes();
  const payrollDayBases = usePayrollDayBases();
  const costComponents = useCostComponentOptions();
  const components = value.components ?? [];
  const benefits = value.benefits ?? [];
  const deductions = value.deductions ?? [];
  const employerContribs = value.employerContributions ?? [];
  const gross = components.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const edBase = components
    .filter((component) => component.includeInOt !== false)
    .reduce((sum, component) => sum + (Number(component.amount) || 0), 0);
  const selectedPayrollBase = payrollDayBases.find((base) => base.id === value.payrollDayBaseId);
  const edDivisor =
    selectedPayrollBase?.method === "fixed_days"
      ? Number(selectedPayrollBase.fixedDays ?? 0)
      : selectedPayrollBase?.method === "fixed_annual_average"
        ? 30.4166
        : selectedPayrollBase
          ? 30
          : 0;
  const patch = (p: Partial<ContractResource>) => onChange({ ...value, ...p });

  // Recompute percentage / formula-based amounts whenever wage components change.
  useEffect(() => {
    let changed = false;
    const nextComponents = components.map((c) => {
      const at = allowanceTypes.find((a) => a.id === c.allowanceId);
      if (!at) return c;
      if (!hasConfiguredFormula(at) && at.calcType !== "percentage") return c;
      const others = components.filter((x) => x.allowanceId !== c.allowanceId);
      const amt = computeBenefitAmount(
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
      if (amt === c.amount) return c;
      changed = true;
      return { ...c, amount: amt };
    });
    const componentMaster = new Map(costComponents.map((item) => [item.id, item]));
    const syncMaster = (item: (typeof deductions)[number]) => {
      const master = componentMaster.get(item.costComponentId);
      if (!master) return item;
      const next = {
        ...item,
        formulaMode: master.formulaMode ?? null,
        formulaExpression: master.formulaExpression ?? null,
        formulaVersion: master.formulaVersion ?? null,
      };
      if (
        next.formulaMode !== item.formulaMode ||
        next.formulaExpression !== item.formulaExpression ||
        next.formulaVersion !== item.formulaVersion
      )
        changed = true;
      return next;
    };
    const recomputeItems = (
      items: typeof deductions,
      wageBenefits = benefits,
      employerItems = employerContribs,
    ) =>
      items.map((b) => {
        const synced = syncMaster(b);
        if (!hasConfiguredFormula(synced) && synced.calcType !== "percentage") return synced;
        const amt = computeBenefitAmount(
          synced,
          nextComponents,
          wageBenefits,
          allowanceTypes,
          employerItems,
        );
        if (amt === synced.amount) return synced;
        changed = true;
        return { ...synced, amount: amt };
      });
    const nextBenefits = recomputeItems(benefits, []);
    const nextDeductions = recomputeItems(deductions, nextBenefits);
    const firstEmployerPass = recomputeItems(employerContribs, nextBenefits);
    const referencesCtc = (item: (typeof employerContribs)[number]) =>
      item.baseComponents.some((base) =>
        ["ctc", "total ctc"].includes(base.label.trim().toLowerCase()),
      );
    const ctcBase = firstEmployerPass.filter(
      (item) => !referencesCtc(item) && !/management\s*fee/i.test(item.name),
    );
    const nextEmployer = firstEmployerPass.map((item) => {
      if ((!hasConfiguredFormula(item) && item.calcType !== "percentage") || !referencesCtc(item))
        return item;
      const amount = computeBenefitAmount(
        item,
        nextComponents,
        nextBenefits,
        allowanceTypes,
        ctcBase,
      );
      if (amount === item.amount) return item;
      changed = true;
      return { ...item, amount };
    });
    if (changed) {
      onChange({
        ...value,
        components: nextComponents,
        benefits: nextBenefits,
        deductions: nextDeductions,
        employerContributions: nextEmployer,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, allowanceTypes, costComponents]);

  const usedComponentIds = new Set(components.map((c) => c.allowanceId));
  const usedBenefitIds = new Set(benefits.map((b) => b.costComponentId));
  const usedDeductionIds = new Set(deductions.map((b) => b.costComponentId));
  const usedEmployerIds = new Set(employerContribs.map((b) => b.costComponentId));
  const PT_SYNTHETIC_ID = "__pt__";
  const ptSynthetic = {
    id: PT_SYNTHETIC_ID,
    name: "Professional Tax (PT)",
    calcType: "fixed" as const,
    percentage: 0,
    baseComponents: [],
    capAmount: null,
    capFlatAmount: null,
    amount: 0,
    state: "Per state slab (resolved at payroll from unit state, employee gender, earned gross)",
    description: "",
    party: "employee" as const,
    deductionCalcType: "fixed_amount" as const,
    fixedCalcMethod: "flat" as const,
    fixedDutyComponents: [],
    fixedDutyDivisor: "base_days" as const,
    formulaMode: null,
    formulaExpression: null,
    formulaVersion: null,
  };

  const toBenefitItem = (c: (typeof costComponents)[number]) => ({
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
  });

  const addComponent = (id: string) => {
    const at = allowanceTypes.find((a) => a.id === id);
    if (!at) return;
    let amount = 0;
    if (hasConfiguredFormula(at) || at.calcType === "percentage") {
      amount = computeBenefitAmount(
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
        components,
        [],
        allowanceTypes,
      );
    }
    patch({
      components: [
        ...components,
        {
          allowanceId: at.id,
          name: at.shortName || at.displayName || at.name,
          amount,
          includeInOt: at.includeInOt !== false,
          formulaMode: at.formulaMode ?? null,
          formulaExpression: at.formulaExpression ?? null,
          formulaVersion: at.formulaVersion ?? null,
          fixedCalcMethod: at.fixedCalcMethod ?? "flat",
          fixedDutyComponents: at.fixedDutyComponents ?? [],
          fixedDutyDivisor: at.fixedDutyDivisor ?? "base_days",
        },
      ],
    });
  };

  const addDeduction = (id: string) => {
    const c = id === PT_SYNTHETIC_ID ? ptSynthetic : costComponents.find((x) => x.id === id);
    if (!c) return;
    const item = toBenefitItem(c);
    if (hasConfiguredFormula(item) || item.calcType === "percentage") {
      item.amount = computeBenefitAmount(item, components, [], allowanceTypes);
    }
    patch({ deductions: [...deductions, item] });
  };

  const addBenefit = (id: string) => {
    const c = costComponents.find((x) => x.id === id);
    if (!c) return;
    const item = toBenefitItem(c);
    if (hasConfiguredFormula(item) || item.calcType === "percentage") {
      item.amount = computeBenefitAmount(item, components, [], allowanceTypes);
    }
    patch({ benefits: [...benefits, item] });
  };

  const addEmployer = (id: string) => {
    const c = costComponents.find((x) => x.id === id);
    if (!c) return;
    const item = toBenefitItem(c);
    if (hasConfiguredFormula(item) || item.calcType === "percentage") {
      item.amount = computeBenefitAmount(item, components, [], allowanceTypes, employerContribs);
    }
    patch({ employerContributions: [...employerContribs, item] });
  };

  const picker = (
    placeholder: string,
    options: { id: string; label: string }[],
    onPick: (id: string) => void,
  ) => (
    <Select value="" onValueChange={(v) => v && onPick(v)}>
      <SelectTrigger className="h-8 w-full text-xs sm:w-[190px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <SelectItem value="__empty" disabled className="text-xs">
            All components added
          </SelectItem>
        ) : (
          options.map((o) => (
            <SelectItem key={o.id} value={o.id} className="text-xs">
              {o.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );

  const itemRow = (
    key: string,
    name: string,
    amount: number,
    onAmount: (n: number) => void,
    onRemove: () => void,
  ) => (
    <div key={key} className="grid gap-1">
      <Label className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span className="truncate">{name}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      </Label>
      <Input
        type="number"
        className="h-9"
        value={Number.isFinite(amount) ? amount : 0}
        onChange={(e) => onAmount(Number(e.target.value) || 0)}
      />
    </div>
  );

  const itemDescription = (item: (typeof deductions)[number]) => {
    if (hasConfiguredFormula(item))
      return `Formula${item.formulaVersion ? ` · v${item.formulaVersion}` : ""}: ${item.formulaExpression ?? ""}`;
    if (item.calcType === "percentage") {
      const basis =
        item.baseComponents
          .map((base, index) => `${index === 0 ? "" : `${base.operator} `}${base.label}`)
          .join(" ") || "configured base";
      return `${item.percentage}% of ${basis}${item.capAmount ? ` · cap ₹${item.capAmount.toLocaleString("en-IN")}` : ""}`;
    }
    return item.fixedCalcMethod === "per_duty" ? "Fixed per duty" : "Fixed amount";
  };

  const detailedItemRow = (
    item: (typeof deductions)[number],
    onAmount: (amount: number) => void,
    onRemove: () => void,
  ) => (
    <div
      key={item.costComponentId}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{item.name}</span>
          {item.state && item.state !== "N/A" && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {item.state}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            {hasConfiguredFormula(item)
              ? "Formula"
              : item.calcType === "percentage"
                ? `${item.percentage}%`
                : "Fixed"}
          </span>
        </div>
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={itemDescription(item)}
        >
          {itemDescription(item)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {item.calcType === "fixed" && !hasConfiguredFormula(item) ? (
          <Input
            type="number"
            className="h-9 w-28"
            value={Number.isFinite(item.amount) ? item.amount : 0}
            onChange={(event) => onAmount(Number(event.target.value) || 0)}
          />
        ) : (
          <span className="w-28 text-right text-sm font-semibold tabular-nums text-foreground">
            {Number(item.amount).toFixed(2)}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">Shift Hours *</Label>
          <Select
            value={String(value.shiftHours ?? 8)}
            onValueChange={(v) => patch({ shiftHours: v === "12" ? 12 : 8 })}
          >
            <SelectTrigger className="h-10 rounded-lg">
              <SelectValue placeholder="Select shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">8 hours</SelectItem>
              <SelectItem value="12">12 hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Payroll Days *</Label>
          <Select
            value={value.payrollDayBaseId ?? ""}
            onValueChange={(v) => patch({ payrollDayBaseId: v || null })}
          >
            <SelectTrigger className="h-10 rounded-lg">
              <SelectValue placeholder="Select payroll-days rule" />
            </SelectTrigger>
            <SelectContent>
              {payrollDayBases.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ·{" "}
                  {p.method === "fixed_days"
                    ? `Fixed ${p.fixedDays ?? 26} days`
                    : p.method === "fixed_annual_average"
                      ? "Fixed 30.4166 days"
                      : p.method === "actual_minus_weekly_off"
                        ? "Actual − weekly off"
                        : "Actual days in month"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Wage Components
          </h4>
          {picker(
            "Add component…",
            allowanceTypes
              .filter((a) => !usedComponentIds.has(a.id))
              .map((a) => ({ id: a.id, label: a.shortName || a.displayName || a.name })),
            addComponent,
          )}
        </div>
        {components.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            No wage components yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {components.map((c) => (
                <div key={c.allowanceId} className="grid gap-1">
                  <Label className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                    <span className="truncate">{c.name}</span>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        title="Include in Extra Duty base"
                        onClick={() =>
                          patch({
                            components: components.map((x) =>
                              x.allowanceId === c.allowanceId
                                ? { ...x, includeInOt: x.includeInOt === false }
                                : x,
                            ),
                          })
                        }
                        className={cn(
                          "rounded px-1 text-[10px] font-bold uppercase",
                          c.includeInOt !== false
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        ED
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            components: components.filter((x) => x.allowanceId !== c.allowanceId),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </Label>
                  <Input
                    type="number"
                    className="h-9"
                    value={Number.isFinite(c.amount) ? c.amount : 0}
                    onChange={(e) =>
                      patch({
                        components: components.map((x) =>
                          x.allowanceId === c.allowanceId
                            ? { ...x, amount: Number(e.target.value) || 0 }
                            : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Gross
              </span>
              <span className="ml-3 text-base font-bold text-foreground">{gross.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Extra Duty (ED)
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Choose the wage components that form the Extra Duty base.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={components.length === 0}
              onClick={() =>
                patch({
                  components: components.map((component) => ({ ...component, includeInOt: true })),
                })
              }
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={components.length === 0}
              onClick={() =>
                patch({
                  components: components.map((component) => ({ ...component, includeInOt: false })),
                })
              }
            >
              Clear all
            </Button>
          </div>
        </div>
        {components.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            Add wage components first.
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {components.map((component) => {
                const selected = component.includeInOt !== false;
                return (
                  <Button
                    key={`ed-${component.allowanceId}`}
                    type="button"
                    variant="outline"
                    onClick={() =>
                      patch({
                        components: components.map((entry) =>
                          entry.allowanceId === component.allowanceId
                            ? { ...entry, includeInOt: !selected }
                            : entry,
                        ),
                      })
                    }
                    className={cn(
                      "h-auto justify-between px-3 py-2",
                      selected && "border-primary/40 bg-primary/10",
                    )}
                  >
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-xs font-semibold">{component.name}</span>
                      <span className="block text-[11px] tabular-nums text-muted-foreground">
                        {Number(component.amount).toFixed(2)}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">
                ED per duty = ED base ÷ payroll days
                {edDivisor ? ` (${edDivisor}) = ${(edBase / edDivisor).toFixed(2)}` : ""}
              </span>
              <span className="text-xs font-semibold uppercase text-muted-foreground">ED Base</span>
              <span className="text-base font-bold">{edBase.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Benefits
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Add earnings and benefit components included in gross pay.
            </p>
          </div>
          {picker(
            "Add benefit…",
            costComponents
              .filter((c) => !usedBenefitIds.has(c.id))
              .map((c) => ({ id: c.id, label: c.name })),
            addBenefit,
          )}
        </div>
        {benefits.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">No benefits added.</div>
        ) : (
          <div className="space-y-2">
            {benefits.map((item) =>
              detailedItemRow(
                item,
                (amount) =>
                  patch({
                    benefits: benefits.map((entry) =>
                      entry.costComponentId === item.costComponentId ? { ...entry, amount } : entry,
                    ),
                  }),
                () =>
                  patch({
                    benefits: benefits.filter(
                      (entry) => entry.costComponentId !== item.costComponentId,
                    ),
                  }),
              ),
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Deductions
          </h4>
          {picker(
            "Add deduction…",
            [
              ...costComponents.filter(
                (c) => !usedDeductionIds.has(c.id) && c.party !== "employer",
              ),
              ...(usedDeductionIds.has(PT_SYNTHETIC_ID) ? [] : [ptSynthetic]),
            ].map((c) => ({ id: c.id, label: c.name })),
            addDeduction,
          )}
        </div>
        {deductions.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">No deductions added.</div>
        ) : (
          <div className="space-y-2">
            {deductions.map((b) =>
              detailedItemRow(
                b,
                (n) =>
                  patch({
                    deductions: deductions.map((x) =>
                      x.costComponentId === b.costComponentId ? { ...x, amount: n } : x,
                    ),
                  }),
                () =>
                  patch({
                    deductions: deductions.filter((x) => x.costComponentId !== b.costComponentId),
                  }),
              ),
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Employer Contributions
          </h4>
          {picker(
            "Add contribution…",
            costComponents
              .filter((c) => !usedEmployerIds.has(c.id) && c.party !== "employee")
              .map((c) => ({ id: c.id, label: c.name })),
            addEmployer,
          )}
        </div>
        {employerContribs.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">
            No employer contributions added.
          </div>
        ) : (
          <div className="space-y-2">
            {employerContribs.map((b) =>
              detailedItemRow(
                b,
                (n) =>
                  patch({
                    employerContributions: employerContribs.map((x) =>
                      x.costComponentId === b.costComponentId ? { ...x, amount: n } : x,
                    ),
                  }),
                () =>
                  patch({
                    employerContributions: employerContribs.filter(
                      (x) => x.costComponentId !== b.costComponentId,
                    ),
                  }),
              ),
            )}
          </div>
        )}
      </div>

      <SalaryBreakdownTable
        designationName=""
        payrollDayBase={selectedPayrollBase}
        components={components}
        benefits={benefits}
        deductions={deductions}
        employerContributions={employerContribs}
      />
    </div>
  );
}

export const Route = createFileRoute("/admin/employees")({
  validateSearch: (search: Record<string, unknown>): EmployeesSearch => ({
    tab: search.tab === "candidate" || search.tab === "employee" ? search.tab : undefined,
    rehire: typeof search.rehire === "string" ? search.rehire : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Employees and Candidates | PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "description",
        content: "Onboard candidates and manage employee records and assignments.",
      },
      { property: "og:title", content: "Employees and Candidates | PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        property: "og:description",
        content: "Onboard candidates and manage employee records and assignments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmployeesPage,
});

// ---------------- Reference lists ---------------- //
const RELIGIONS = [
  "Hindu",
  "Muslim",
  "Christian",
  "Sikh",
  "Buddhist",
  "Jain",
  "Parsi",
  "Jewish",
  "Other",
];
const CASTE_CATEGORIES = ["General", "OBC", "SC", "ST", "EWS"];
const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Separated"];
const GENDERS = ["Male", "Female", "Other"];
const MOCK_OTP = "1111";

// ---------------- Types ---------------- //
type AddressBlock = {
  address1: string;
  address2: string;
  landmark: string;
  pincode: string;
  city: string;
  district: string;
  state: string;
  country: string;
};

type Candidate = {
  id: string;
  candidate_code: string;
  employee_code: string;
  rejection_reason: string;
  aadhaar_number: string;
  full_name: string;
  photo_url: string;
  aadhaar_image_url: string;
  signature_url: string;
  date_of_birth: string | null;
  gender: string;
  religion: string;
  caste_category: string;
  marital_status: string;
  birthplace: string;
  mobile: string;
  alt_mobile: string;
  email: string;
  // Permanent address (structured)
  permanent_address1: string;
  permanent_address2: string;
  permanent_landmark: string;
  permanent_pincode: string;
  permanent_city: string;
  permanent_district: string;
  permanent_state: string;
  permanent_country: string;
  permanent_police_station: string;
  // Present address (structured)
  present_address1: string;
  present_address2: string;
  present_landmark: string;
  present_pincode: string;
  present_city: string;
  present_district: string;
  present_state: string;
  present_country: string;
  present_police_station: string;
  same_as_permanent: boolean;
  // PAN
  pan_number: string;
  pan_image_url: string;
  // Bank Details
  bank_account_holder: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
  bank_branch: string;
  bank_account_type: string;
  // Emergency Contact (legacy, derived from primary contact on save)
  emergency_contact_name: string;
  emergency_contact_relation: string;
  emergency_contact_mobile: string;
  // Contacts (list, one marked as emergency)
  contacts: CandidateContact[];
  // References
  references: CandidateReference[];
  // Ex-Service
  is_ex_service: boolean;
  ex_service_id: string | null;
  // Languages / Experiences / Education
  languages: string[];
  experiences: CandidateExperience[];
  educations: CandidateEducation[];
  application_date: string;
  preferred_joining_date: string | null;
  unit_id: string | null;
  designation_id: string | null;
  department_id: string | null;
  status: string;
  // Extended (JSONB) sections
  physical_health: Record<string, any>;
  compliance: Record<string, any>;
  identification_proofs: any[];
  criminal_history: { has_history: boolean; incidents: any[] };
  extra_curricular: any[];
  other_info: Record<string, any>;
  documents: any[];
  nominations: any[];
  kyc_completed: boolean;
  // Offboarding & HR
  assigned_asset_ids: string[];
  no_hire: boolean;
  offboarding_details: OffboardingDetails;
};

export type OffboardingAssetReturn = {
  asset_id: string;
  returned: boolean;
  remarks?: string;
};

export type OffboardingInventoryReturn = {
  item_id: string;
  item_name: string;
  size_value: string;
  unit: string;
  on_hand: number;
  qty_returned: number;
  destination_type: LocationType;
  destination_id: string;
  destination_label: string;
  remarks?: string;
};

export type OffboardingDetails = {
  date_of_offboarding?: string | null;
  date_of_resignation?: string | null;
  date_of_last_working?: string | null;
  date_of_pf_update?: string | null;
  date_of_esic_update?: string | null;
  reason_text?: string;
  review?: string;
  asset_returns?: OffboardingAssetReturn[];
  inventory_returns?: OffboardingInventoryReturn[];
  rating?: number;
  rating_remarks?: string;
  // Offboarding-collection handshake with the Field Officer
  pending_collection_fo_id?: string | null;
  pending_collection_fo_name?: string | null;
  collection_status?: "pending" | "completed" | null;
  collection_requested_at?: string | null;
  collection_completed_at?: string | null;
  collection_completed_by?: string | null;
};

export type OnboardingDetails = {
  // Onboarding-issuance handshake with the Field Officer.
  // Mirrors offboarding: on approval, if assets are assigned and a FO is
  // resolvable, the candidate stays at status='approved' until the FO
  // confirms issuance in Uniform Manager → Collections → Issuances.
  pending_issuance_fo_id?: string | null;
  pending_issuance_fo_name?: string | null;
  issuance_status?: "pending" | "completed" | null;
  issuance_requested_at?: string | null;
  issuance_completed_at?: string | null;
  issuance_completed_by?: string | null;
  issuance_asset_ids?: string[];
};

type CandidateExperience = {
  company_name: string;
  designation: string;
  location: string;
  joined_date: string;
  resigned_date: string;
  reason: string;
  remarks: string;
};

type CandidateEducation = {
  education_name: string;
  university: string;
  course: string;
  institution: string;
  year_of_passing: string;
  percentage: string;
};

type CandidateReference = {
  name: string;
  relation_type: string;
  mobile: string;
  address: string;
};

type CandidateContact = {
  name: string;
  relation: string;
  mobile: string;
  dob?: string;
  address?: string;
  guardian_name?: string;
  guardian_mobile?: string;
  guardian_address?: string;
  is_emergency: boolean;
};

const RELATION_TYPES = ["Family", "Friend", "Colleague", "Neighbor", "Other"] as const;
const REFERENCE_RELATIONS = [
  "Father",
  "Mother",
  "Spouse",
  "Brother",
  "Sister",
  "Son",
  "Daughter",
  "Friend",
  "Colleague",
  "Neighbor",
  "Relative",
  "Other",
] as const;
const BANK_ACCOUNT_TYPES = ["Savings", "Current", "Salary"] as const;

type CandidateListItem = Pick<
  Candidate,
  | "id"
  | "candidate_code"
  | "rejection_reason"
  | "aadhaar_number"
  | "full_name"
  | "photo_url"
  | "mobile"
  | "email"
  | "unit_id"
  | "designation_id"
  | "status"
> & {
  employee_code: string;
  role_key: string;
  non_billable: boolean;
  is_enabled: boolean;
  reports_to: string | null;
  department_id: string | null;
  offboarding_reason_id: string | null;
  offboarded_at: string | null;
  assigned_asset_ids: string[];
  no_hire: boolean;
  offboarding_details: OffboardingDetails;
  onboarding_details: OnboardingDetails;
  date_of_birth: string | null;
  preferred_joining_date: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ReactivationResult = {
  id: string;
  employee_code: string;
  full_name: string;
  status: string;
  reusedExisting?: boolean;
  mode?: "reuse" | "new";
  sourceId?: string;
};

type RoleLite = { key: string; name: string };

type UnitLite = {
  id: string;
  code: string;
  name: string;
  customer_id: string | null;
  branch_id: string | null;
  uniform_included?: boolean | null;
  uniform_fee_amount?: number | string | null;
  is_billable?: boolean | null;
  customer_name?: string;
};

type DesignationLite = { id: string; name: string; code: string; billable: boolean };
type ExServiceLite = { id: string; name: string; description: string };
type LanguageLite = { id: string; name: string };

const QK = ["admin", "candidates"] as const;
const QK_UNITS = ["admin", "units-lite"] as const;
const QK_DESIG = ["admin", "designations-lite"] as const;
const QK_EX_SERVICES = ["admin", "ex-services-lite"] as const;
const QK_LANGUAGES = ["admin", "languages-lite"] as const;
const QK_ESIC_BRANCHES = ["admin", "esic-branches-lite"] as const;

function getMutationErrorMessage(error: unknown, fallback: string) {
  const parts: string[] = [];
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) parts.push(value.trim());
    }
  }
  if (typeof error === "string" && error.trim()) parts.push(error.trim());
  const raw = parts.join(" · ");
  if (/candidates_mobile_unique|Key \(mobile\)=/i.test(raw)) {
    return "This mobile number is already used by an active candidate or employee. Open the existing profile or use a different number.";
  }
  if (/candidates_candidate_code_key|Key \(candidate_code\)=/i.test(raw)) {
    return "Candidate number generation collided with an existing record. Please retry once; the next number will be allocated automatically.";
  }
  if (/candidate_units|row-level security|infinite recursion/i.test(raw)) {
    return `Unit assignment failed: ${raw}`;
  }
  if (raw) return raw;
  return fallback;
}

function normalizeIdArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "{}") return [];
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      /* fall through */
    }
    return [trimmed];
  }
  return [];
}

function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function employeeCodeNumber(code: string | null | undefined) {
  const match = (code ?? "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function employeeLifecycleTime(candidate: CandidateListItem) {
  return (
    toTime(candidate.approved_at) ||
    toTime(candidate.created_at) ||
    toTime(candidate.updated_at) ||
    toTime(candidate.offboarded_at)
  );
}

function employeeStatusRank(candidate: CandidateListItem) {
  if (candidate.status !== "inactive" && candidate.is_enabled) return 4;
  if (candidate.status === "active") return 3;
  if (candidate.status === "approved") return 2;
  return 1;
}

function newestEmployeeRecordFirst(a: CandidateListItem, b: CandidateListItem) {
  return (
    employeeCodeNumber(b.employee_code) - employeeCodeNumber(a.employee_code) ||
    employeeLifecycleTime(b) - employeeLifecycleTime(a) ||
    toTime(b.created_at) - toTime(a.created_at) ||
    b.id.localeCompare(a.id)
  );
}

function preferredEmployeeRecordFirst(a: CandidateListItem, b: CandidateListItem) {
  return employeeStatusRank(b) - employeeStatusRank(a) || newestEmployeeRecordFirst(a, b);
}

/**
 * Approved / active people must carry an EMP-### employee ID. Rows that still
 * display their candidate number (CAN-###, EC-###) — or nothing at all — are
 * repaired here by allocating the next free EMP number.
 * Returns how many rows were fixed.
 */
async function healEmployeeCodes(rows: CandidateListItem[]): Promise<number> {
  const needsCode = rows.filter(
    (r) =>
      ["active", "approved"].includes(r.status) &&
      (!r.employee_code || /^(CAN|EC)[-_]?\d*/i.test(r.employee_code)),
  );
  if (needsCode.length === 0) return 0;

  const { data } = await supabase
    .from("candidates" as never)
    .select("employee_code")
    .ilike("employee_code", "EMP-%")
    .limit(5000);
  let next = 0;
  for (const row of (data ?? []) as Array<{ employee_code: string | null }>) {
    const n = Number(String(row.employee_code ?? "").replace(/\D/g, ""));
    if (Number.isFinite(n) && n > next) next = n;
  }

  let fixed = 0;
  for (const r of needsCode) {
    next += 1;
    const code = `EMP-${String(next).padStart(3, "0")}`;
    const { error } = await supabase
      .from("candidates" as never)
      .update({ employee_code: code } as never)
      .eq("id", r.id);
    if (!error) fixed += 1;
  }
  return fixed;
}

type EsicBranchLite = { id: string; location: string; esic_code: string };

function useEsicBranchesLite() {
  return useQuery({
    queryKey: QK_ESIC_BRANCHES,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<EsicBranchLite[]> => {
      const { data, error } = await supabase
        .from("esic_branches" as never)
        .select("id,location,esic_code,enabled")
        .eq("enabled", true)
        .order("location", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data as unknown as EsicBranchLite[]) ?? [];
    },
  });
}

type DepartmentLite = { id: string; name: string };

function useDepartmentsLite() {
  return useQuery({
    queryKey: ["admin", "departments-lite"] as const,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<DepartmentLite[]> => {
      const { data, error } = await supabase
        .from("departments" as never)
        .select("id,name")
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data as unknown as DepartmentLite[]) ?? [];
    },
  });
}

async function runWithQueryTimeout<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 8_000,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} request timed out. Please retry.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------- Hooks ---------------- //

/**
 * Local snapshots so the list and client dropdowns paint instantly on
 * revisit while the fresh rows load in the background.
 */
const SNAP_TTL_MS = 24 * 60 * 60 * 1000;

function readSnapshot<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at?: number; rows?: T };
    if (!parsed?.at || !parsed.rows || Date.now() - parsed.at > SNAP_TTL_MS) return undefined;
    return parsed.rows;
  } catch {
    return undefined;
  }
}

function writeSnapshot(key: string, rows: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* quota or private mode — snapshots are best effort */
  }
}

const SNAP_UNITS = "radiant.snapshot.units.v1";
const SNAP_CANDIDATES = "radiant.snapshot.candidates.v2";

const CANDIDATE_LIST_COLUMNS =
  "id,candidate_code,employee_code,rejection_reason,aadhaar_number,full_name,photo_url,mobile,email,unit_id,designation_id,department_id,status,role_key,non_billable,is_enabled,reports_to,offboarding_reason_id,offboarded_at,assigned_asset_ids,no_hire,offboarding_details,onboarding_details,date_of_birth,preferred_joining_date,approved_at,created_by,created_at,updated_at";

type InlinePickerOption = { id: string; label: string; hint?: string };

/** Compact searchable cell editor used for designation / department / reporting manager. */
function InlinePicker({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
}: {
  value: string | null;
  options: InlinePickerOption[];
  onChange: (id: string | null) => void;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? options.find((o) => o.id === value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 min-w-0 flex-1 justify-start rounded-xl border-border/60 bg-card px-2.5 text-left text-xs font-normal sm:w-[150px] sm:flex-none"
          title={current?.label ?? placeholder}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current?.label ?? placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(268px,calc(100vw-1rem))] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty>No match found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                className="text-xs"
                onSelect={() => {
                  setOpen(false);
                  if (value !== null) onChange(null);
                }}
              >
                {placeholder}
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.label} ${o.hint ?? ""}`}
                  className="text-xs"
                  onSelect={() => {
                    setOpen(false);
                    if (o.id !== value) onChange(o.id);
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function useCandidates() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: QK,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    placeholderData: () => readSnapshot<CandidateListItem[]>(SNAP_CANDIDATES),
    queryFn: async (): Promise<CandidateListItem[]> => {
      return runWithQueryTimeout(
        "Employees",
        async (signal) => {
          const pageSize = 1000;
          const fetchPage = (page: number) =>
            supabase
              .from("candidates" as never)
              .select(CANDIDATE_LIST_COLUMNS)
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(page * pageSize, (page + 1) * pageSize - 1)
              .abortSignal(signal);

          const first = await fetchPage(0);
          if (first.error) throw first.error;

          const rows = ((first.data ?? []) as unknown as CandidateListItem[]).slice();
          qc.setQueryData(QK, rows);

          if (rows.length < pageSize) {
            writeSnapshot(SNAP_CANDIDATES, rows);
            return rows;
          }

          const batchSize = 4;
          for (let startPage = 1; startPage < 60; startPage += batchSize) {
            const results = await Promise.all(
              Array.from({ length: batchSize }, (_, offset) => fetchPage(startPage + offset)),
            );
            let reachedEnd = false;
            for (const result of results) {
              if (result.error) throw result.error;
              const pageRows = (result.data ?? []) as unknown as CandidateListItem[];
              rows.push(...pageRows);
              if (pageRows.length < pageSize) reachedEnd = true;
            }
            qc.setQueryData(QK, rows.slice());
            if (reachedEnd) break;
          }

          writeSnapshot(SNAP_CANDIDATES, rows);
          return rows;
        },
        30_000,
      );
    },
  });
}

function EmployeeSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (value !== draft) setDraft(value);
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => onChange(draft), 150);
    return () => window.clearTimeout(timer);
  }, [draft, onChange]);

  return (
    <div className="relative flex-1 md:w-80">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search name, mobile, code, designation, role…"
        autoComplete="off"
        className="h-10 rounded-xl border-border/70 bg-card pl-11 text-sm shadow-sm focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/10 sm:h-11"
      />
    </div>
  );
}

function useUnits() {
  return useQuery({
    queryKey: QK_UNITS,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    placeholderData: () => readSnapshot<UnitLite[]>(SNAP_UNITS),
    queryFn: async (): Promise<UnitLite[]> => {
      /**
       * PostgREST caps a single response at its `max-rows` limit (1000), so a
       * plain `.limit(5000)` silently truncates and unit lookups by id miss
       * every site past the cap. Page explicitly until a short page arrives.
       */
      const PAGE = 1000;
      const units: UnitLite[] = [];
      for (let page = 0; page < 20; page++) {
        const { data, error } = await runWithQueryTimeout(
          "Clients",
          async (signal) =>
            await supabase
              .from("units" as never)
              .select(
                "id,code,name,customer_id,branch_id,uniform_included,uniform_fee_amount,is_billable",
              )
              .order("name", { ascending: true })
              .order("id", { ascending: true })
              .range(page * PAGE, page * PAGE + PAGE - 1)
              .abortSignal(signal),
        );
        if (error) throw error;
        const rows = (data as unknown as UnitLite[]) ?? [];
        units.push(...rows);
        if (rows.length < PAGE) break;
      }
      const custIds = Array.from(
        new Set(units.map((u) => u.customer_id).filter(Boolean)),
      ) as string[];
      let custMap = new Map<string, string>();
      if (custIds.length) {
        const { data: cs } = await runWithQueryTimeout(
          "Customers",
          async (signal) =>
            await supabase
              .from("customers" as never)
              .select("id,name")
              .in("id", custIds)
              .abortSignal(signal),
        );
        custMap = new Map(
          ((cs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
        );
      }
      const withNames = units.map((u) => ({
        ...u,
        customer_name: u.customer_id ? (custMap.get(u.customer_id) ?? "") : "",
      }));
      writeSnapshot(SNAP_UNITS, withNames);
      return withNames;
    },
  });
}

/**
 * Contract health per unit, used to label (never hide) units in the picker.
 * A unit whose contract has expired stays fully selectable — deployment often
 * continues while a renewal is being drawn up.
 */
type UnitContractState = "active" | "expired" | "none";

function useUnitContractState() {
  return useQuery({
    queryKey: ["admin", "unit-contract-state"],
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, UnitContractState>> => {
      const { data, error } = await supabase
        .from("client_contracts" as never)
        .select("unit_id,status,end_date")
        .not("unit_id", "is", null)
        .limit(20000);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        unit_id: string;
        status: string | null;
        end_date: string | null;
      }>;
      const today = new Date().toISOString().slice(0, 10);
      const out: Record<string, UnitContractState> = {};
      for (const r of rows) {
        const live = r.status === "active" && (!r.end_date || r.end_date >= today);
        if (live) out[r.unit_id] = "active";
        else if (out[r.unit_id] !== "active") out[r.unit_id] = "expired";
      }
      return out;
    },
  });
}

const QK_HOME_UNITS = ["admin", "home-units"] as const;

/**
 * Non-billable "Radiant home" units only (Corporate Office etc.).
 * Deliberately separate from the heavy all-units list so the employee
 * onboarding dropdown never waits on (or dies with) the 5000-row query.
 */
function useHomeUnits() {
  return useQuery({
    queryKey: QK_HOME_UNITS,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UnitLite[]> => {
      const { data, error } = await runWithQueryTimeout(
        "HomeUnits",
        async (signal) =>
          await supabase
            .from("units" as never)
            .select("id,code,name,customer_id,branch_id,is_billable")
            .eq("is_billable", false)
            .order("name", { ascending: true })
            .limit(200)
            .abortSignal(signal),
      );
      if (error) throw error;
      return (data as unknown as UnitLite[]) ?? [];
    },
  });
}

type OperationalMapping = {
  scope_type: "unit" | "customer";
  scope_id: string;
  scope_label: string;
};

/**
 * Inline mapping picker for non-billable employees: pick one or more
 * organizations first, then pick client units belonging to those
 * organizations. Both levels are multi-select and searchable. Rendered inline
 * (no Popover) because popup pickers are unreliable inside the full-screen
 * wizard dialog.
 */
function OperationalMappingPicker({
  units,
  customers,
  value,
  onChange,
  disabled = false,
  loading = false,
  error = null,
  onRetry,
}: {
  units: UnitLite[];
  customers: { id: string; name: string }[];
  value: OperationalMapping[];
  onChange: (rows: OperationalMapping[]) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [orgQuery, setOrgQuery] = useState("");
  const [unitQuery, setUnitQuery] = useState("");

  const selectedOrgIds = useMemo(
    () => value.filter((m) => m.scope_type === "customer").map((m) => m.scope_id),
    [value],
  );
  const selectedOrgSet = useMemo(() => new Set(selectedOrgIds), [selectedOrgIds]);
  const selectedUnitSet = useMemo(
    () => new Set(value.filter((m) => m.scope_type === "unit").map((m) => m.scope_id)),
    [value],
  );

  const orgOptions = useMemo(() => {
    const rows = customers.map((c) => ({ id: c.id, label: c.name }));
    rows.sort((a, b) => a.label.localeCompare(b.label));
    const needle = orgQuery.trim().toLowerCase();
    return needle ? rows.filter((o) => o.label.toLowerCase().includes(needle)) : rows;
  }, [customers, orgQuery]);

  // Units of the selected organizations are fetched directly (paginated) rather
  // than filtered from the shared units list — that list is truncated by the
  // API row cap, so many real client units were simply missing from search.
  const orgKey = useMemo(() => [...selectedOrgIds].sort().join(","), [selectedOrgIds]);
  const orgUnitsQuery = useQuery({
    queryKey: ["admin", "org-units", orgKey],
    enabled: selectedOrgIds.length > 0,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UnitLite[]> => {
      const ids = [...selectedOrgIds];
      const rows = await fetchAllPages<UnitLite>((from, to) =>
        supabase
          .from("units" as never)
          .select("id,code,name,customer_id,branch_id,is_billable")
          .in("customer_id", ids)
          .order("name", { ascending: true })
          .range(from, to),
      );
      return rows ?? [];
    },
  });

  const orgUnits = orgUnitsQuery.data ?? [];
  const orgNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const unitOptions = useMemo(() => {
    const rows = orgUnits
      .filter((u) => u.is_billable !== false)
      .map((u) => ({
        id: u.id,
        label: `${u.name}${u.code ? ` · ${u.code}` : ""}`,
        sub: (u.customer_id && orgNameById.get(u.customer_id)) || "",
      }));
    rows.sort((a, b) => a.label.localeCompare(b.label));
    const needle = unitQuery.trim().toLowerCase();
    return needle ? rows.filter((o) => `${o.label} ${o.sub}`.toLowerCase().includes(needle)) : rows;
  }, [orgUnits, orgNameById, unitQuery]);

  const toggleOrg = (o: { id: string; label: string }) => {
    if (selectedOrgSet.has(o.id)) {
      // Dropping an organization also drops its unit mappings.
      const unitIdsOfOrg = new Set(
        [...orgUnits, ...units].filter((u) => u.customer_id === o.id).map((u) => u.id),
      );
      onChange(
        value.filter(
          (m) =>
            !(m.scope_type === "customer" && m.scope_id === o.id) &&
            !(m.scope_type === "unit" && unitIdsOfOrg.has(m.scope_id)),
        ),
      );
    } else {
      onChange([...value, { scope_type: "customer", scope_id: o.id, scope_label: o.label }]);
    }
  };

  const toggleUnit = (o: { id: string; label: string }) => {
    if (selectedUnitSet.has(o.id)) {
      onChange(value.filter((m) => !(m.scope_type === "unit" && m.scope_id === o.id)));
    } else {
      onChange([...value, { scope_type: "unit", scope_id: o.id, scope_label: o.label }]);
    }
  };

  const removeMapping = (m: OperationalMapping) => {
    if (m.scope_type === "customer") {
      toggleOrg({ id: m.scope_id, label: m.scope_label });
      return;
    }
    onChange(value.filter((x) => !(x.scope_type === "unit" && x.scope_id === m.scope_id)));
  };

  const listShell =
    "max-h-48 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40";

  const renderRow = (
    o: { id: string; label: string; sub?: string },
    checked: boolean,
    onToggle: () => void,
  ) => (
    <label
      key={o.id}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm transition",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40",
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border accent-primary"
        disabled={disabled}
        checked={checked}
        onChange={onToggle}
      />
      <span className="flex-1 truncate">
        {o.label}
        {o.sub && <span className="ml-1.5 text-xs text-muted-foreground">{o.sub}</span>}
      </span>
      {checked && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </label>
  );

  return (
    <div className="space-y-3">
      {/* Step 1 — organizations */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">1 · Organization</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={orgQuery}
            onChange={(e) => setOrgQuery(e.target.value)}
            disabled={disabled || loading}
            placeholder="Search organizations (e.g. L&T)…"
            className="h-9 pl-8"
          />
        </div>
        <div className={listShell}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-destructive">
              <span className="truncate">Could not load: {error}</span>
              {onRetry && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              )}
            </div>
          ) : orgOptions.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {orgQuery ? "No matches — try a different search." : "No organizations found."}
            </div>
          ) : (
            orgOptions.map((o) => renderRow(o, selectedOrgSet.has(o.id), () => toggleOrg(o)))
          )}
        </div>
      </div>

      {/* Step 2 — units of the chosen organizations */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">2 · Client / Unit</p>
        {selectedOrgSet.size === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            Select an organization above to see its clients.
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={unitQuery}
                onChange={(e) => setUnitQuery(e.target.value)}
                disabled={disabled}
                placeholder="Search clients by name or code…"
                className="h-9 pl-8"
              />
            </div>
            <div className={listShell}>
              {orgUnitsQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading clients…
                </div>
              ) : orgUnitsQuery.isError ? (
                <div className="flex items-center justify-center gap-2 p-4 text-xs text-destructive">
                  <span className="truncate">Could not load clients.</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => void orgUnitsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : unitOptions.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {unitQuery
                    ? "No matches — try a different search."
                    : "No clients under the selected organizations."}
                </div>
              ) : (
                unitOptions.map((o) => renderRow(o, selectedUnitSet.has(o.id), () => toggleUnit(o)))
              )}
            </div>
          </>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((m) => (
            <Badge
              key={`${m.scope_type}:${m.scope_id}`}
              variant="secondary"
              className="gap-1 font-normal"
            >
              <span className="max-w-[220px] truncate">
                {m.scope_type === "customer" ? "Org · " : ""}
                {m.scope_label}
              </span>
              <button
                type="button"
                aria-label={`Remove ${m.scope_label}`}
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={() => removeMapping(m)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {value.length} mapping{value.length === 1 ? "" : "s"} selected — payroll always stays on the
        Radiant home unit.
      </p>
    </div>
  );
}

function useDesignations() {
  return useQuery({
    queryKey: QK_DESIG,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<DesignationLite[]> => {
      const { data, error } = await runWithQueryTimeout(
        "Designations",
        async (signal) =>
          await supabase
            .from("designations" as never)
            .select("id,name,code,enabled,billable")
            .eq("enabled", true)
            .order("name", { ascending: true })
            .limit(500)
            .abortSignal(signal),
      );
      if (error) throw error;
      return (data as unknown as DesignationLite[]) ?? [];
    },
  });
}

function useExServices() {
  return useQuery({
    queryKey: QK_EX_SERVICES,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<ExServiceLite[]> => {
      const { data, error } = await runWithQueryTimeout(
        "Ex-Services",
        async (signal) =>
          await supabase
            .from("ex_services" as never)
            .select("id,name,description,enabled")
            .eq("enabled", true)
            .order("name", { ascending: true })
            .limit(500)
            .abortSignal(signal),
      );
      if (error) throw error;
      return (data as unknown as ExServiceLite[]) ?? [];
    },
  });
}

function useLanguagesLite() {
  return useQuery({
    queryKey: QK_LANGUAGES,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<LanguageLite[]> => {
      const { data, error } = await runWithQueryTimeout(
        "Languages",
        async (signal) =>
          await supabase
            .from("languages" as never)
            .select("id,name,enabled")
            .eq("enabled", true)
            .order("name", { ascending: true })
            .limit(500)
            .abortSignal(signal),
      );
      if (error) throw error;
      return (data as unknown as LanguageLite[]) ?? [];
    },
  });
}

const QK_ROLES = ["admin", "roles-lite"] as const;
function useRolesLite() {
  return useQuery({
    queryKey: QK_ROLES,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async (): Promise<RoleLite[]> => {
      const { data, error } = await supabase
        .from("roles" as never)
        .select("key,name,sort_order")
        .order("sort_order", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data as unknown as RoleLite[]) ?? [];
    },
  });
}

function EmployeesPage() {
  const routeSearch = useSearch({ from: "/admin/employees" });
  const [search, setSearch] = useState("");
  const candidatesQuery = useCandidates();
  const unitsQuery = useUnits();
  const designationsQuery = useDesignations();
  const exServicesQuery = useExServices();
  const languagesQuery = useLanguagesLite();
  const rolesQuery = useRolesLite();
  const esicBranchesQuery = useEsicBranchesLite();
  const candidates = candidatesQuery.data ?? [];
  const rowCandidates = candidates;
  const units = unitsQuery.data ?? [];
  const designations = designationsQuery.data ?? [];
  const exServices = exServicesQuery.data ?? [];
  const languagesList = languagesQuery.data ?? [];
  const rolesList = rolesQuery.data ?? [];
  const esicBranches = esicBranchesQuery.data ?? [];
  const isLoading = candidatesQuery.isLoading;
  const candidatesError = candidatesQuery.error;
  const qc = useQueryClient();

  // Self-heal: an approved/active person must carry an EMP-### employee ID.
  // Older records (or rows created before the DB trigger existed) sometimes
  // still show their CAN-### candidate number in the Emp ID column.
  const codeHealRef = useRef(false);
  useEffect(() => {
    if (codeHealRef.current || candidates.length === 0) return;
    codeHealRef.current = true;
    void healEmployeeCodes(candidates).then((n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: QK });
    });
  }, [candidates, qc]);

  const { roleKey, isSuperAdmin, can, canSub } = useCurrentPermissions();
  const isFieldOfficer = roleKey === "field_officer" && !isSuperAdmin;
  const canAddEmployee =
    isSuperAdmin || ["admin", "super_admin", "hr", "leadership"].includes(roleKey ?? "");
  // Onboarding approval is scoped to the Employees → Approvals sub-module only.
  // Using the module-level `can("employees","approve")` leaked the button to any
  // role holding approve on ANY sub-module (e.g. Field Officers with Rehire approve).
  const canApproveOnboarding = isSuperAdmin || canSub("employees", "approvals", "approve");
  const { map: rehireByCandidate } = useRehireByCandidate();
  const [enableRehireTarget, setEnableRehireTarget] = useState<RehireRequest | null>(null);
  const [rehireReviewTarget, setRehireReviewTarget] = useState<RehireRequest | null>(null);
  const rehireStepsQ = useQuery({
    queryKey: ["workflows", "rehire", "steps"],
    queryFn: async () => {
      const wf = await fetchWorkflowByKey(REHIRE_WORKFLOW_KEY);
      return wf ? (await fetchWorkflowSteps(wf.id)).filter((step) => step.is_active) : [];
    },
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const [tab, setTab] = useState<"employee" | "candidate">("employee");
  useEffect(() => {
    if (isFieldOfficer) setTab("candidate");
  }, [isFieldOfficer]);
  useEffect(() => {
    if (routeSearch.tab) setTab(routeSearch.tab);
  }, [routeSearch.tab]);
  useEffect(() => {
    if (!routeSearch.rehire) return;
    const match = Array.from(rehireByCandidate.values()).find(
      (info) => info.request.id === routeSearch.rehire,
    );
    if (match) {
      setTab("candidate");
      setRehireReviewTarget(match.request);
    }
  }, [routeSearch.rehire, rehireByCandidate]);

  const [empStatusTab, setEmpStatusTab] = useState<"active" | "inactive">("active");
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [openWizard, setOpenWizard] = useState(false);
  const [wizardMode, setWizardMode] = useState<"candidate" | "employee">("candidate");
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [openingCandidateId, setOpeningCandidateId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CandidateListItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CandidateListItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvePreview, setApprovePreview] = useState<CandidateListItem | null>(null);
  const [signTarget, setSignTarget] = useState<{ id: string; docType: DocType } | null>(null);
  const [offboardTarget, setOffboardTarget] = useState<CandidateListItem | null>(null);
  const [offboardReasonId, setOffboardReasonId] = useState<string>("");
  const [reactivateTarget, setReactivateTarget] = useState<CandidateListItem | null>(null);

  const offboardReasonsQuery = useQuery({
    queryKey: ["offboarding_reasons_lite"],
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offboarding_reasons" as never)
        .select("id,name,enabled,sort_order")
        .eq("enabled", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data as unknown as Array<{ id: string; name: string }>) ?? [];
    },
  });
  const offboardReasons = offboardReasonsQuery.data ?? [];

  const assetsQuery = useQuery({
    queryKey: ["assets_lite_available"],
    enabled: openWizard || !!offboardTarget,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const [assetsRes, balRes, invItemsRes, invCatsRes] = await Promise.all([
        supabase
          .from("assets" as never)
          .select("id,name,category,enabled,unit_price")
          .eq("enabled", true)
          .order("name", { ascending: true })
          .limit(500),
        supabase
          .from("inv_stock_balances" as never)
          .select("qty,item_id,inv_items:item_id(name,enabled)"),
        supabase
          .from("inv_items" as never)
          .select("id,name,category_id,enabled,standard_issue_price,standard_cost")
          .eq("enabled", true)
          .order("name", { ascending: true })
          .limit(1000),
        supabase.from("inv_item_categories" as never).select("id,name"),
      ]);
      if (assetsRes.error) throw assetsRes.error;
      if (balRes.error) throw balRes.error;
      if (invItemsRes.error) throw invItemsRes.error;
      if (invCatsRes.error) throw invCatsRes.error;

      const rows =
        (assetsRes.data as unknown as Array<{
          id: string;
          name: string;
          category: string;
          unit_price: number | string | null;
        }>) ?? [];
      const availByName = new Map<string, number>();
      const availByItemId = new Map<string, number>();
      type BalRow = {
        qty: number | string;
        item_id: string;
        inv_items: { name: string; enabled: boolean } | null;
      };
      for (const b of (balRes.data as unknown as BalRow[]) ?? []) {
        const q = Number(b.qty ?? 0);
        if (b.item_id) availByItemId.set(b.item_id, (availByItemId.get(b.item_id) ?? 0) + q);
        const it = b.inv_items;
        if (!it || it.enabled === false) continue;
        const key = (it.name ?? "").trim().toLowerCase();
        if (!key) continue;
        availByName.set(key, (availByName.get(key) ?? 0) + q);
      }

      const catNameById = new Map(
        ((invCatsRes.data as unknown as Array<{ id: string; name: string }>) ?? []).map((c) => [
          c.id,
          c.name,
        ]),
      );
      const assetNameSet = new Set(rows.map((r) => (r.name ?? "").trim().toLowerCase()));
      const invRows = (
        (invItemsRes.data as unknown as Array<{
          id: string;
          name: string;
          category_id: string | null;
          standard_issue_price: number | string | null;
          standard_cost: number | string | null;
        }>) ?? []
      )
        .filter((it) => !assetNameSet.has((it.name ?? "").trim().toLowerCase()))
        .map((it) => ({
          id: it.id,
          name: it.name,
          category: (it.category_id && catNameById.get(it.category_id)) || "Inventory",
          available_qty: availByItemId.get(it.id) ?? 0,
          unit_price: Number(it.standard_issue_price ?? it.standard_cost ?? 0) || 0,
        }));

      const merged = rows.map((a) => ({
        ...a,
        available_qty: availByName.get((a.name ?? "").trim().toLowerCase()) ?? 0,
        unit_price: Number(a.unit_price ?? 0) || 0,
      }));
      return [...merged, ...invRows];
    },
  });
  const assets = assetsQuery.data ?? [];

  // Filters
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterDesignation, setFilterDesignation] = useState<string>("all");
  const [filterCustomer, setFilterCustomer] = useState<string>("all");
  const [filterUnit, setFilterUnit] = useState<string>("all");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [filterBillable, setFilterBillable] = useState<"all" | "billable" | "nonbillable">("all");
  const [filterOffboardReason, setFilterOffboardReason] = useState<string>("all");
  const [filterDepartment, setFilterDepartment] = useState<string>("all");

  const departmentsListQuery = useDepartmentsLite();
  const departmentsList = departmentsListQuery.data ?? [];
  const deptMap = useMemo(
    () => new Map(departmentsList.map((d) => [d.id, d.name])),
    [departmentsList],
  );

  const DEFAULT_FILTERS_VIS = {
    role: true,
    designation: true,
    department: false,
    customer: true,
    unit: false,
    manager: false,
    enabled: true,
    billable: false,
    offboardReason: false,
  };
  const [filtersVisible, setFiltersVisible] = useState<typeof DEFAULT_FILTERS_VIS>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS_VIS;
    try {
      const raw = localStorage.getItem("employees.filterPrefs");
      if (raw) return { ...DEFAULT_FILTERS_VIS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_FILTERS_VIS;
  });
  useEffect(() => {
    try {
      localStorage.setItem("employees.filterPrefs", JSON.stringify(filtersVisible));
    } catch {}
  }, [filtersVisible]);

  // Configurable columns for the Employees table
  const DEFAULT_COLUMNS_VIS = {
    mobile: true,
    email: false,
    unit: true,
    designation: true,
    department: true,
    reportsTo: true,
    role: true,
    dob: false,
    doj: false,
    active: true,
  };
  // v2 key: drops stale saved prefs so new default columns (designation, department, reporting manager) always appear
  const COLUMN_PREFS_KEY = "employees.columnPrefs.v2";
  const [columnsVisible, setColumnsVisible] = useState<typeof DEFAULT_COLUMNS_VIS>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS_VIS;
    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (raw) return { ...DEFAULT_COLUMNS_VIS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_COLUMNS_VIS;
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(columnsVisible));
    } catch {}
  }, [columnsVisible]);

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d;
    }
  };

  // Customers (org filter) + scope assignments
  const { customers } = useCustomers();
  const { branches } = useBranches();
  const { states } = useStates();
  const scopeQuery = useScopeAssignments();
  const scopeAssignments = scopeQuery.data ?? [];

  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const desigMap = useMemo(() => new Map(designations.map((d) => [d.id, d])), [designations]);

  const { candidateId: currentCandidateId, isLoading: roleLoading } = useCurrentUserRole();
  const candidateUnitsQuery = useCandidateUnits();
  /**
   * Fallback unit for the list: `candidates.unit_id` mirrors the primary unit,
   * but older / non-billable records may only have rows in `candidate_units`.
   */
  const primaryUnitIdByCandidate = useMemo(() => {
    const m = new Map<string, string>();
    for (const cu of candidateUnitsQuery.data ?? []) {
      if (!cu.unit_id) continue;
      if (cu.is_primary || !m.has(cu.candidate_id)) m.set(cu.candidate_id, cu.unit_id);
    }
    return m;
  }, [candidateUnitsQuery.data]);
  const unitOfCandidate = (c: { id: string; unit_id: string | null }) => {
    const id = c.unit_id || primaryUnitIdByCandidate.get(c.id) || null;
    return id ? unitMap.get(id) : undefined;
  };
  /**
   * Every client site a person covers. A Field Officer's `unit_id` is only their
   * Radiant home/base unit — their real coverage lives in `candidate_units`.
   */
  const siteIdsByCandidate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const cu of candidateUnitsQuery.data ?? []) {
      if (!cu.unit_id) continue;
      const list = m.get(cu.candidate_id);
      if (list) {
        if (!list.includes(cu.unit_id)) list.push(cu.unit_id);
      } else m.set(cu.candidate_id, [cu.unit_id]);
    }
    return m;
  }, [candidateUnitsQuery.data]);
  const siteCountOf = (candidateId: string) => siteIdsByCandidate.get(candidateId)?.length ?? 0;
  const [siteMapTarget, setSiteMapTarget] = useState<CandidateListItem | null>(null);
  const [siteMapSearch, setSiteMapSearch] = useState("");
  const siteMapRows = useMemo(() => {
    if (!siteMapTarget) return [];
    const q = siteMapSearch.trim().toLowerCase();
    return (siteIdsByCandidate.get(siteMapTarget.id) ?? [])
      .map((id) => unitMap.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .filter(
        (u) =>
          !q ||
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.code ?? "").toLowerCase().includes(q) ||
          (u.customer_name ?? "").toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          (a.customer_name ?? "").localeCompare(b.customer_name ?? "") ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      );
  }, [siteMapTarget, siteMapSearch, siteIdsByCandidate, unitMap]);
  /** The saved employee classification is authoritative; unit mappings are operational scope. */
  const isBillableCandidate = (c: Pick<CandidateListItem, "non_billable">) => !c.non_billable;
  const NOMANS_UNIT_ID = NOMANS_UNIT_ID_CONST;

  /**
   * A field officer's own scope, resolved from their scope assignments plus
   * legacy candidate_units rows.
   *
   * NOTE: `scope_type='branch'` on a field officer is their **Home Branch**
   * (payroll/employment marker — always Radiant's own branch). It is NOT an
   * operational scope and must never be expanded into every unit of that
   * branch, otherwise the FO sees the whole organisation's units.
   */
  const myScope = useMemo(() => {
    if (!isFieldOfficer || !currentCandidateId)
      return { unitIds: [] as string[], customerIds: [] as string[] };
    const mine = scopeAssignments.filter((s) => s.candidate_id === currentCandidateId);
    const unitIds = new Set(mine.filter((s) => s.scope_type === "unit").map((s) => s.scope_id));
    const customerIds = new Set(
      mine.filter((s) => s.scope_type === "customer").map((s) => s.scope_id),
    );
    for (const cu of candidateUnitsQuery.data ?? []) {
      if (cu.candidate_id === currentCandidateId && cu.unit_id) unitIds.add(cu.unit_id);
    }
    // Always include "No Man's Land" as a fallback unit for FO onboarding.
    unitIds.add(NOMANS_UNIT_ID);
    return { unitIds: Array.from(unitIds), customerIds: Array.from(customerIds) };
  }, [isFieldOfficer, currentCandidateId, scopeAssignments, candidateUnitsQuery.data]);

  /**
   * Field officers get their handful of clients fetched directly instead of
   * waiting on (and filtering) the ~4,000-row client master, which regularly
   * exceeded the query timeout and made onboarding look unassigned.
   */
  const myUnitsQuery = useQuery({
    queryKey: ["admin", "fo-scoped-units", myScope.unitIds, myScope.customerIds],
    enabled: isFieldOfficer && (myScope.unitIds.length > 0 || myScope.customerIds.length > 0),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<UnitLite[]> => {
      const cols =
        "id,code,name,customer_id,branch_id,uniform_included,uniform_fee_amount,is_billable";
      const results = await Promise.all([
        myScope.unitIds.length
          ? supabase
              .from("units" as never)
              .select(cols)
              .in("id", myScope.unitIds)
          : Promise.resolve({ data: [], error: null }),
        myScope.customerIds.length
          ? supabase
              .from("units" as never)
              .select(cols)
              .in("customer_id", myScope.customerIds)
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const rows = new Map<string, UnitLite>();
      for (const res of results) {
        if (res.error) throw res.error;
        for (const u of (res.data as unknown as UnitLite[]) ?? []) rows.set(u.id, u);
      }
      const list = Array.from(rows.values());
      const custIds = Array.from(
        new Set(list.map((u) => u.customer_id).filter(Boolean)),
      ) as string[];
      let custMap = new Map<string, string>();
      if (custIds.length) {
        const { data: cs } = await supabase
          .from("customers" as never)
          .select("id,name")
          .in("id", custIds);
        custMap = new Map(
          ((cs ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
        );
      }
      return list
        .map((u) => ({
          ...u,
          customer_name: u.customer_id ? (custMap.get(u.customer_id) ?? "") : "",
        }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    },
  });

  const scopedUnitsForWizard = useMemo(() => {
    if (!isFieldOfficer) return units;
    if (!currentCandidateId) return [] as typeof units;
    const unitIds = new Set(myScope.unitIds);
    const customerIds = new Set(myScope.customerIds);
    const merged = new Map<string, UnitLite>();
    for (const u of myUnitsQuery.data ?? []) merged.set(u.id, u);
    for (const u of units) {
      if (merged.has(u.id)) continue;
      const custId = (u as { customer_id?: string | null }).customer_id ?? null;
      if (unitIds.has(u.id) || (custId != null && customerIds.has(custId))) merged.set(u.id, u);
    }
    return Array.from(merged.values());
  }, [isFieldOfficer, currentCandidateId, myScope, units, myUnitsQuery.data]);
  const scopedUnitIdSet = useMemo(
    () => new Set(scopedUnitsForWizard.map((u) => u.id)),
    [scopedUnitsForWizard],
  );

  // "You have no clients assigned" must only appear once every source that can
  // supply clients has actually settled — otherwise a slow client master reads
  // as an unassigned field officer.
  const scopeStillLoading =
    isFieldOfficer &&
    (roleLoading ||
      scopeQuery.isLoading ||
      !currentCandidateId ||
      candidateUnitsQuery.isLoading ||
      myUnitsQuery.isLoading ||
      myUnitsQuery.isFetching ||
      (unitsQuery.isLoading && (myUnitsQuery.data?.length ?? 0) === 0));

  const matchesSearch = (c: CandidateListItem) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      c.full_name,
      c.aadhaar_number,
      c.mobile,
      c.email,
      c.candidate_code,
      c.employee_code,
      c.designation_id ? desigMap.get(c.designation_id)?.name : null,
      c.department_id ? String(deptMap.get(c.department_id) ?? "") : null,
      c.role_key ? rolesList.find((r) => r.key === c.role_key)?.name : null,
      c.role_key?.replace(/_/g, " "),
    ].some((v) => (v ?? "").toLowerCase().includes(q));
  };

  const matchesFilters = (c: CandidateListItem) => {
    if (filterRole !== "all" && c.role_key !== filterRole) return false;
    if (filterDesignation !== "all" && c.designation_id !== filterDesignation) return false;
    if (filterUnit !== "all" && (unitOfCandidate(c)?.id ?? c.unit_id) !== filterUnit) return false;
    if (filterDepartment !== "all") {
      if (filterDepartment === "none") {
        if (c.department_id) return false;
      } else if (c.department_id !== filterDepartment) return false;
    }
    if (filterCustomer !== "all") {
      const unit = unitOfCandidate(c);
      if (!unit || unit.customer_id !== filterCustomer) return false;
    }
    if (filterManager !== "all" && c.reports_to !== filterManager) return false;
    if (filterEnabled === "enabled" && !c.is_enabled) return false;
    if (filterEnabled === "disabled" && c.is_enabled) return false;
    if (filterBillable !== "all") {
      // Use the employee's persisted classification. Non-billable staff can
      // have operational unit mappings without becoming billable employees.
      const isBillable = isBillableCandidate(c);
      if (filterBillable === "billable" && !isBillable) return false;
      if (filterBillable === "nonbillable" && isBillable) return false;
    }
    if (filterOffboardReason !== "all") {
      if (filterOffboardReason === "none") {
        if (c.offboarding_reason_id) return false;
      } else if (c.offboarding_reason_id !== filterOffboardReason) {
        return false;
      }
    }
    return true;
  };

  const isEmployeeStatus = (s: string) => s === "approved" || s === "active" || s === "inactive";

  const supersededEmployeeIds = useMemo(() => {
    const recordsByMobile = new Map<string, CandidateListItem[]>();
    for (const c of candidates) {
      const mobile = c.mobile?.trim();
      if (!mobile) continue;
      if (!recordsByMobile.has(mobile)) recordsByMobile.set(mobile, []);
      recordsByMobile.get(mobile)!.push(c);
    }

    const ids = new Set<string>();
    for (const list of recordsByMobile.values()) {
      const employeeRecords = list.filter((c) => isEmployeeStatus(c.status));
      if (employeeRecords.length <= 1) continue;

      const nonInactiveRecords = list.filter((c) => c.status !== "inactive");
      const visibleEmployee = nonInactiveRecords
        .filter((c) => isEmployeeStatus(c.status))
        .sort(preferredEmployeeRecordFirst)[0];

      if (nonInactiveRecords.length > 0 && !visibleEmployee) {
        // A pending reactivation/onboarding exists for this mobile; hide older inactive employee cards.
        for (const c of employeeRecords) ids.add(c.id);
        continue;
      }

      const keep = visibleEmployee ?? [...employeeRecords].sort(preferredEmployeeRecordFirst)[0];
      for (const c of employeeRecords) {
        if (c.id !== keep.id) ids.add(c.id);
      }
    }
    return ids;
  }, [candidates]);

  const employees = useMemo(
    () =>
      rowCandidates.filter((c) => {
        if (!isEmployeeStatus(c.status)) return false;
        if (rehireByCandidate.has(c.id)) return false;
        if (supersededEmployeeIds.has(c.id)) return false;
        if (!matchesSearch(c)) return false;
        if (!matchesFilters(c)) return false;
        if (isFieldOfficer) {
          // FO sees active employees only within his assigned units.
          if (!c.unit_id || !scopedUnitIdSet.has(c.unit_id)) return false;
        }
        const isActive = c.is_enabled && c.status !== "inactive";
        if (empStatusTab === "active" && !isActive) return false;
        if (empStatusTab === "inactive" && isActive) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rowCandidates,
      supersededEmployeeIds,
      rehireByCandidate,
      search,
      filterRole,
      filterDesignation,
      filterCustomer,
      filterUnit,
      filterManager,
      filterEnabled,
      filterBillable,
      filterOffboardReason,
      filterDepartment,
      units,
      designations,
      isFieldOfficer,
      scopedUnitIdSet,
      empStatusTab,
    ],
  );
  const candidateRows = useMemo(
    () =>
      rowCandidates.filter((c) => {
        const hasRehire = rehireByCandidate.has(c.id);
        if (isEmployeeStatus(c.status) && !hasRehire) return false;
        if (!matchesSearch(c)) return false;
        if (isFieldOfficer) {
          // FO sees pending/rejected/draft submissions within his units,
          // plus his own submissions regardless of unit (in case unit not yet set).
          const inMyUnits = !!c.unit_id && scopedUnitIdSet.has(c.unit_id);
          const isMine = !!currentUserId && c.created_by === currentUserId;
          if (!inMyUnits && !isMine) return false;
          if (c.status === "approved" && !hasRehire) return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowCandidates, rehireByCandidate, search, isFieldOfficer, currentUserId, scopedUnitIdSet],
  );

  const pgEmployees = usePagination(employees);
  const pgCandidates = usePagination(candidateRows);

  // ---------------- Export ---------------- //
  const [exporting, setExporting] = useState(false);
  const [docsExportOpen, setDocsExportOpen] = useState(false);

  const roleNameOf = (key: string | null | undefined) =>
    rolesList.find((r) => r.key === key)?.name ?? key ?? "";
  const unitLabel = (id: string | null | undefined) => {
    if (!id) return "";
    const u = unitMap.get(id);
    return u ? `${u.code} — ${u.name}` : "";
  };
  const customerNameOfUnit = (id: string | null | undefined) => {
    if (!id) return "";
    const u = unitMap.get(id);
    if (!u?.customer_id) return u?.customer_name ?? "";
    return customers.find((c) => c.id === u.customer_id)?.name ?? u.customer_name ?? "";
  };
  const desigName = (id: string | null | undefined) => (id && desigMap.get(id)?.name) || "";
  const managerName = (id: string | null | undefined) =>
    (id && candidates.find((c) => c.id === id)?.full_name) || "";
  const offboardReasonName = (id: string | null | undefined) =>
    (id && offboardReasons.find((r) => r.id === id)?.name) || "";

  const buildSummaryRow = (c: CandidateListItem) => ({
    employee_code: c.employee_code || "",
    candidate_code: c.candidate_code || "",
    full_name: c.full_name || "",
    aadhaar_number: c.aadhaar_number || "",
    mobile: c.mobile || "",
    email: c.email || "",
    role: roleNameOf(c.role_key),
    designation: desigName(c.designation_id),
    unit: unitLabel(c.unit_id),
    customer: customerNameOfUnit(c.unit_id),
    reports_to: managerName(c.reports_to),
    status: csvStatus(c.status),
    enabled: csvYesNo(c.is_enabled),
    no_hire: csvYesNo(c.no_hire),
    offboarding_reason: offboardReasonName(c.offboarding_reason_id),
    offboarded_at: csvDate(c.offboarded_at),
    assigned_assets: csvJoin(
      (c.assigned_asset_ids ?? [])
        .map((aid) => assets.find((a) => a.id === aid)?.name)
        .filter(Boolean),
    ),
    rejection_reason: c.rejection_reason || "",
  });

  const SUMMARY_COLS = [
    { key: "employee_code", header: "Employee code" },
    { key: "candidate_code", header: "Candidate code" },
    { key: "full_name", header: "Full name" },
    { key: "aadhaar_number", header: "Aadhaar" },
    { key: "mobile", header: "Mobile" },
    { key: "email", header: "Email" },
    { key: "role", header: "Role" },
    { key: "designation", header: "Designation" },
    { key: "unit", header: "Client" },
    { key: "customer", header: "Customer" },
    { key: "reports_to", header: "Reports to" },
    { key: "status", header: "Status" },
    { key: "enabled", header: "Enabled" },
    { key: "no_hire", header: "Do not re-hire" },
    { key: "offboarding_reason", header: "Offboarding reason" },
    { key: "offboarded_at", header: "Offboarded at" },
    { key: "assigned_assets", header: "Assigned assets" },
    { key: "rejection_reason", header: "Rejection reason" },
  ];

  const flattenValue = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  };

  const fetchFullCandidates = async (ids: string[]) => {
    if (ids.length === 0) return [] as Array<Record<string, unknown>>;
    const { data, error } = await supabase
      .from("candidates" as never)
      .select("*")
      .in("id", ids);
    if (error) throw error;
    return (data as unknown as Array<Record<string, unknown>>) ?? [];
  };

  const handleExport = async (kind: "summary-csv" | "full-csv" | "full-json") => {
    const sourceRows = tab === "employee" ? employees : candidateRows;
    if (sourceRows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    setExporting(true);
    try {
      const prefix = tab === "employee" ? "employees" : "candidates";
      if (kind === "summary-csv") {
        downloadCsv(prefix + "-summary", sourceRows.map(buildSummaryRow), SUMMARY_COLS);
      } else {
        const full = await fetchFullCandidates(sourceRows.map((r) => r.id));
        // enrich with friendly joins
        const enriched = full.map((row) => {
          const id = row.id as string;
          const src = sourceRows.find((s) => s.id === id);
          return {
            ...row,
            _role_name: roleNameOf((row.role_key as string) ?? src?.role_key),
            _designation_name: desigName(
              (row.designation_id as string) ?? src?.designation_id ?? null,
            ),
            _unit_label: unitLabel((row.unit_id as string) ?? src?.unit_id ?? null),
            _customer_name: customerNameOfUnit((row.unit_id as string) ?? src?.unit_id ?? null),
            _reports_to_name: managerName((row.reports_to as string) ?? src?.reports_to ?? null),
            _offboarding_reason_name: offboardReasonName(
              (row.offboarding_reason_id as string) ?? src?.offboarding_reason_id ?? null,
            ),
            _assigned_asset_names: csvJoin(
              ((row.assigned_asset_ids as string[]) ?? src?.assigned_asset_ids ?? [])
                .map((aid: string) => assets.find((a) => a.id === aid)?.name)
                .filter(Boolean),
            ),
          };
        });
        if (kind === "full-json") {
          const blob = new Blob([JSON.stringify(enriched, null, 2)], {
            type: "application/json;charset=utf-8;",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          a.href = url;
          a.download = `${prefix}-full-${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          // full-csv: union of all keys, flatten objects to JSON strings
          const keySet = new Set<string>();
          for (const r of enriched) for (const k of Object.keys(r)) keySet.add(k);
          const keys = Array.from(keySet);
          const cols = keys.map((k) => ({ key: k, header: k }));
          const rows = enriched.map((r) => {
            const out: Record<string, string> = {};
            for (const k of keys) out[k] = flattenValue((r as Record<string, unknown>)[k]);
            return out;
          });
          downloadCsv(prefix + "-full", rows, cols);
        }
      }
      await logActivity({
        module: "Employees",
        action: "export",
        entityType: "candidate",
        entityLabel: `${sourceRows.length} ${prefix} (${kind})`,
      });
      toast.success(`Exported ${sourceRows.length} ${prefix}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const fieldOfficers = useMemo(
    () => candidates.filter((c) => c.role_key === "field_officer" && isEmployeeStatus(c.status)),
    [candidates],
  );
  const scopeByCandidate = useMemo(() => {
    const m = new Map<string, ScopeAssignment[]>();
    for (const s of scopeAssignments) {
      if (!m.has(s.candidate_id)) m.set(s.candidate_id, []);
      m.get(s.candidate_id)!.push(s);
    }
    return m;
  }, [scopeAssignments]);

  const stats = useMemo(() => {
    // Candidate-tab stats (only non-employee status records)
    const candidateOnly = candidates.filter(
      (c) => !isEmployeeStatus(c.status) || rehireByCandidate.has(c.id),
    );
    const candTotal = candidateOnly.length;
    const candDrafts = candidateOnly.filter((c) => c.status === "draft").length;
    const candPending = candidateOnly.filter((c) => c.status === "pending").length;
    const candRejected = candidateOnly.filter((c) => c.status === "rejected").length;

    // Employee-tab stats (employees only)
    const employeeOnly = candidates.filter(
      (c) =>
        isEmployeeStatus(c.status) &&
        !supersededEmployeeIds.has(c.id) &&
        !rehireByCandidate.has(c.id),
    );
    const empTotal = employeeOnly.length;
    const empActive = employeeOnly.filter((c) => c.is_enabled && c.status !== "inactive").length;
    const empInactive = empTotal - empActive;
    const empBillable = employeeOnly.filter((c) => !c.non_billable).length;
    const empNonBillable = empTotal - empBillable;

    return {
      candTotal,
      candDrafts,
      candPending,
      candRejected,
      empTotal,
      empActive,
      empInactive,
      empBillable,
      empNonBillable,
    };
  }, [candidates, supersededEmployeeIds, rehireByCandidate]);

  const deleteMut = useMutation({
    mutationFn: async (c: CandidateListItem) => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .delete()
        .eq("id", c.id)
        .select("id");
      if (error) throw error;
      if (!data || (data as unknown as { id: string }[]).length === 0) {
        throw new Error("You don't have permission to delete this candidate.");
      }
      await logActivity({
        module: "Employees",
        action: "delete",
        entityType: "candidate",
        entityId: c.id,
        entityLabel: c.full_name || c.aadhaar_number,
        before: c as unknown as Record<string, unknown>,
      });
    },
    onSuccess: () => {
      toast.success("Candidate deleted");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const assignRoleMut = useMutation({
    mutationFn: async ({
      candidate,
      roleKey,
    }: {
      candidate: CandidateListItem;
      roleKey: string;
    }) => {
      const { error } = await supabase
        .from("candidates" as never)
        .update({ role_key: roleKey } as unknown as never)
        .eq("id", candidate.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "assign_role",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        after: { role_key: roleKey },
        before: { role_key: candidate.role_key },
      });
    },
    onSuccess: (_d, vars) => {
      const roleName = rolesList.find((r) => r.key === vars.roleKey)?.name ?? vars.roleKey;
      toast.success(`Role set to ${roleName}`);
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to assign role"),
  });

  const toggleEnabledMut = useMutation({
    mutationFn: async ({
      candidate,
      enabled,
    }: {
      candidate: CandidateListItem;
      enabled: boolean;
    }) => {
      if (enabled && candidate.no_hire) {
        throw new Error("Employee is flagged Do not re-hire and cannot be reactivated.");
      }
      const patch: Record<string, unknown> = {
        is_enabled: enabled,
        status: enabled ? "active" : "inactive",
      };
      if (enabled) {
        patch.offboarding_reason_id = null;
        patch.offboarded_at = null;
      }
      const { error } = await supabase
        .from("candidates" as never)
        .update(patch as unknown as never)
        .eq("id", candidate.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: enabled ? "enable" : "disable",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: { is_enabled: candidate.is_enabled, status: candidate.status },
        after: { is_enabled: enabled, status: enabled ? "active" : "inactive" },
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.enabled ? "Employee activated" : "Employee deactivated");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Toggle failed"),
  });

  const reactivateMut = useMutation({
    mutationFn: async ({
      candidate,
      mode,
    }: {
      candidate: CandidateListItem;
      mode: "reuse" | "new";
    }) => {
      // Fetch fresh source row so we don't act on stale cache (e.g. no_hire just toggled)
      const { data: src, error: fetchErr } = await supabase
        .from("candidates" as never)
        .select("*")
        .eq("id", candidate.id)
        .single();
      if (fetchErr) throw fetchErr;
      const source = src as unknown as Record<string, unknown>;
      if (source.no_hire === true) {
        throw new Error(
          "Employee is flagged Do not re-hire. Uncheck it on the profile and save before reactivating.",
        );
      }

      const canDirectActivate =
        isSuperAdmin || ["admin", "super_admin", "hr", "leadership"].includes(roleKey ?? "");
      const newStatus = canDirectActivate ? "active" : "pending";
      const today = new Date().toISOString().slice(0, 10);
      const sourceMobile = typeof source.mobile === "string" ? source.mobile.trim() : "";

      // Check if a non-inactive record already exists for this mobile (pending reactivation
      // or an active employee). If so we cannot create/keep another one alongside it.
      let existingReactivation: {
        id: string;
        employee_code: string;
        full_name: string;
        status: string;
      } | null = null;
      if (sourceMobile) {
        const { data: existing, error: existingErr } = await supabase
          .from("candidates" as never)
          .select("id,employee_code,full_name,status")
          .eq("mobile", sourceMobile)
          .neq("id", candidate.id)
          .neq("status", "inactive")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingErr) throw existingErr;
        existingReactivation = (existing as typeof existingReactivation) ?? null;
      }
      if (existingReactivation) {
        const existing = existingReactivation as {
          id: string;
          employee_code: string;
          full_name: string;
          status: string;
        };
        if (mode === "reuse") {
          // A pending/active record already exists — surface it instead of creating a duplicate.
          return { ...existing, reusedExisting: true, mode } as ReactivationResult;
        }
        // mode === "new": user explicitly wants a fresh employee ID.
        if (existing.status === "active") {
          throw new Error(
            "This person already has an active employee record. Offboard it first before creating a new one.",
          );
        }
        // Supersede the previous pending reactivation so the mobile unique index frees up.
        const { error: supersedeErr } = await supabase
          .from("candidates" as never)
          .delete()
          .eq("id", existing.id);
        if (supersedeErr) {
          throw new Error(
            getMutationErrorMessage(supersedeErr, "Could not clear previous pending reactivation"),
          );
        }
      }

      if (mode === "reuse") {
        // Update the existing (inactive) record in place — keep the same employee_code / id.
        const patch: Record<string, unknown> = {
          status: newStatus,
          is_enabled: canDirectActivate,
          no_hire: false,
          offboarding_reason_id: null,
          offboarded_at: null,
          rejection_reason: "",
          rejected_at: null,
          preferred_joining_date: today,
        };
        const { data: updated, error: updateErr } = await supabase
          .from("candidates" as never)
          .update(patch as never)
          .eq("id", candidate.id)
          .select("id,employee_code,full_name,status")
          .single();
        if (updateErr) throw new Error(getMutationErrorMessage(updateErr, "Reactivation failed"));
        const rec = updated as unknown as ReactivationResult;
        await logActivity({
          module: "Employees",
          action: "reactivate",
          entityType: "candidate",
          entityId: rec.id,
          entityLabel: rec.full_name || rec.employee_code,
          before: { status: "inactive", employee_code: candidate.employee_code },
          after: { status: rec.status, employee_code: rec.employee_code, mode: "reuse" },
        });
        return { ...rec, mode } as ReactivationResult;
      }

      // mode === "new": clone into a fresh record (new employee_code will be generated on approval)
      const stripped: Record<string, unknown> = { ...source };
      [
        "id",
        "created_at",
        "updated_at",
        "employee_code",
        "candidate_code",
        "approved_at",
        "approved_by",
        "rejected_at",
        "rejection_reason",
      ].forEach((k) => delete stripped[k]);

      stripped.status = newStatus;
      stripped.is_enabled = canDirectActivate;
      stripped.no_hire = false;
      stripped.offboarding_reason_id = null;
      stripped.offboarded_at = null;
      stripped.application_date = today;
      stripped.preferred_joining_date = today;
      stripped.employee_code = "";
      stripped.candidate_code = "";
      stripped.created_by = currentUserId ?? source.created_by ?? null;

      const { data: inserted, error: insertErr } = await supabase
        .from("candidates" as never)
        .insert(stripped as unknown as never)
        .select("id,employee_code,full_name,status")
        .single();
      if (insertErr) {
        const message = getMutationErrorMessage(insertErr, "Reactivation failed");
        if (
          message.includes("candidates_mobile_unique") ||
          message.toLowerCase().includes("duplicate key")
        ) {
          throw new Error(
            "This phone number is already used by another active employee or pending onboarding record.",
          );
        }
        throw new Error(message);
      }
      const newRec = inserted as unknown as ReactivationResult;

      const { data: units } = await supabase
        .from("candidate_units" as never)
        .select("unit_id,is_primary,sort_order")
        .eq("candidate_id", candidate.id);
      const unitsArr =
        (units as unknown as
          | { unit_id: string; is_primary: boolean; sort_order: number }[]
          | null) ?? [];
      if (unitsArr.length > 0) {
        const { error: unitsErr } = await supabase.from("candidate_units" as never).insert(
          unitsArr.map((u) => ({
            candidate_id: newRec.id,
            unit_id: u.unit_id,
            is_primary: u.is_primary,
            sort_order: u.sort_order,
          })) as unknown as never,
        );
        if (unitsErr)
          throw new Error(
            getMutationErrorMessage(
              unitsErr,
              "Reactivation created the employee record but failed to copy client assignments.",
            ),
          );
      }

      await logActivity({
        module: "Employees",
        action: "reactivate",
        entityType: "candidate",
        entityId: newRec.id,
        entityLabel: newRec.full_name || newRec.employee_code,
        before: { source_id: candidate.id, source_employee_code: candidate.employee_code },
        after: {
          new_employee_code: newRec.employee_code,
          joining_date: today,
          status: newRec.status,
          mode: "new",
        },
      });
      return { ...newRec, mode, sourceId: candidate.id } as ReactivationResult;
    },
    onSuccess: (rec) => {
      const reuseLabel = rec.mode === "reuse" ? " (same employee ID)" : " (new employee ID)";
      if (rec.reusedExisting) {
        toast.success(
          `Reactivation is already pending HR/Admin approval for ${rec.full_name || rec.employee_code}`,
        );
        setTab("candidate");
      } else if (rec.status === "pending") {
        toast.success(`Reactivation submitted for HR/Admin approval${reuseLabel}`);
        setTab("candidate");
      } else {
        toast.success(`Reactivated as ${rec.employee_code || "new employee"}${reuseLabel}`);
        setTab("employee");
      }
      if (rec.sourceId) {
        qc.setQueryData<CandidateListItem[]>(
          QK,
          (old) => old?.filter((row) => row.id !== rec.sourceId) ?? old,
        );
      }
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(getMutationErrorMessage(e, "Reactivation failed")),
  });

  const offboardMut = useMutation({
    mutationFn: async ({
      candidate,
      reasonId,
      reasonName,
      details,
      noHire,
    }: {
      candidate: CandidateListItem;
      reasonId: string;
      reasonName: string;
      details: OffboardingDetails;
      noHire: boolean;
    }) => {
      const returns = (details.inventory_returns ?? []).filter((r) => r.qty_returned > 0);
      const pendingFoId =
        returns.length > 0 && returns[0].destination_type === "field_officer"
          ? returns[0].destination_id
          : null;
      const isDeferred = !!pendingFoId;
      const nowIso = new Date().toISOString();

      // Look up FO name for the offboarding_details record (nice-to-have for UI).
      let foName: string | null = null;
      if (pendingFoId) {
        const { data: foRow } = await supabase
          .from("candidates" as never)
          .select("full_name,employee_code")
          .eq("id", pendingFoId)
          .maybeSingle();
        const fo = foRow as { full_name?: string; employee_code?: string } | null;
        foName = fo?.full_name || fo?.employee_code || null;
      }

      const enrichedDetails: OffboardingDetails = {
        ...details,
        pending_collection_fo_id: pendingFoId,
        pending_collection_fo_name: foName,
        collection_status: isDeferred ? "pending" : returns.length > 0 ? "completed" : null,
        collection_requested_at: isDeferred ? nowIso : (details.collection_requested_at ?? null),
        collection_completed_at: isDeferred ? null : returns.length > 0 ? nowIso : null,
      };

      const updatePayload: Record<string, unknown> = {
        offboarding_reason_id: reasonId,
        offboarding_details: enrichedDetails,
        no_hire: noHire,
      };
      if (isDeferred) {
        // Keep the employee active/enabled until the FO confirms collection.
        // Do NOT set offboarded_at here — finalisation happens on FO confirmation.
      } else {
        updatePayload.is_enabled = false;
        updatePayload.status = "inactive";
        updatePayload.offboarded_at = nowIso;
      }

      const { data: updated, error } = await supabase
        .from("candidates" as never)
        .update(updatePayload as unknown as never)
        .eq("id", candidate.id)
        .select("id");
      if (error) throw error;
      if (!updated || (updated as unknown as unknown[]).length === 0) {
        throw new Error(
          "You don't have permission to offboard this employee, or the record could not be updated.",
        );
      }

      if (isDeferred) {
        // Do NOT post inventory movements yet — the FO will confirm and then movements post.
        // Notify the selected Field Officer.
        try {
          const { data: uidRow } = await supabase.rpc(
            "get_user_id_by_candidate_id" as never,
            { _candidate_id: pendingFoId } as never,
          );
          const foUserId = (uidRow as unknown as string | null) ?? null;
          if (foUserId) {
            const itemsSummary = returns
              .map(
                (r) =>
                  `${r.item_name}${r.size_value ? " (" + r.size_value + ")" : ""} × ${r.qty_returned}`,
              )
              .join(", ");
            await createNotification({
              userId: foUserId,
              type: "offboarding_collection_pending",
              title: `Collection pending · ${candidate.full_name || candidate.employee_code}`,
              message: `HR has initiated offboarding. Please recover ${returns.length} item${returns.length === 1 ? "" : "s"}: ${itemsSummary}. Confirm in Uniform Manager → Collections.`,
              link: "/admin/inventory/collections",
              entityType: "candidate",
              entityId: candidate.id,
            });
          }
        } catch (e) {
          console.warn("Failed to notify field officer of pending collection", e);
        }
      } else if (returns.length) {
        // No pending FO handshake — post movements directly (e.g. no items, or non-FO path).
        const moves = returns.flatMap((r) => [
          {
            movement_type: "offboarding_return",
            location_type: "guard" as LocationType,
            location_id: candidate.id,
            item_id: r.item_id,
            size_value: r.size_value ?? "",
            qty_change: -Math.abs(r.qty_returned),
            reference_type: "offboarding_return",
            reference_id: candidate.id,
            notes: r.remarks ?? `Returned on offboarding · ${r.item_name}`,
          },
          {
            movement_type: "offboarding_return",
            location_type: r.destination_type,
            location_id: r.destination_id,
            item_id: r.item_id,
            size_value: r.size_value ?? "",
            qty_change: Math.abs(r.qty_returned),
            reference_type: "offboarding_return",
            reference_id: candidate.id,
            notes:
              r.remarks ?? `Received back from ${candidate.full_name || candidate.employee_code}`,
          },
        ]);
        try {
          await postMovements(moves);
        } catch (e) {
          console.error("Inventory return movement failed", e);
          toast.error(
            "Employee offboarded, but inventory return failed to post. Please review Stock Ledger.",
          );
        }
      }

      await logActivity({
        module: "Employees",
        action: isDeferred ? "offboard_requested" : "offboard",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: { is_enabled: candidate.is_enabled, status: candidate.status },
        after: {
          is_enabled: isDeferred ? candidate.is_enabled : false,
          status: isDeferred ? candidate.status : "inactive",
          offboarding_reason: reasonName,
          no_hire: noHire,
          offboarding_details: enrichedDetails,
          inventory_returns_count: returns.length,
          pending_collection_fo_id: pendingFoId,
        },
      });

      return { isDeferred, pendingFoName: foName };
    },
    onSuccess: (res) => {
      if (res?.isDeferred) {
        toast.success(
          `Offboarding submitted — awaiting inventory collection by ${res.pendingFoName ?? "field officer"}.`,
        );
      } else {
        toast.success("Employee offboarded");
      }
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: ["inv_stock_balances"] });
      qc.invalidateQueries({ queryKey: ["inv_stock_movements"] });
      setOffboardTarget(null);
      setOffboardReasonId("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Offboarding failed"),
  });

  const assignManagerMut = useMutation({
    mutationFn: async ({
      candidate,
      managerId,
    }: {
      candidate: CandidateListItem;
      managerId: string | null;
    }) => {
      const { error } = await supabase
        .from("candidates" as never)
        .update({ reports_to: managerId } as unknown as never)
        .eq("id", candidate.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "assign_manager",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: { reports_to: candidate.reports_to },
        after: { reports_to: managerId },
      });
    },
    onSuccess: () => {
      toast.success("Reporting manager updated");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set manager"),
  });

  const managerOptions = useMemo(
    () =>
      candidates
        .filter((c) => isEmployeeStatus(c.status) && c.role_key !== "guard")
        .map((c) => ({
          id: c.id,
          label: c.full_name || c.employee_code || "—",
          hint: c.employee_code || "",
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [candidates],
  );

  const assignDesignationMut = useMutation({
    mutationFn: async ({
      candidate,
      designationId,
    }: {
      candidate: CandidateListItem;
      designationId: string | null;
    }) => {
      const { error } = await supabase
        .from("candidates" as never)
        .update({ designation_id: designationId } as unknown as never)
        .eq("id", candidate.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "assign_designation",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: { designation_id: candidate.designation_id },
        after: { designation_id: designationId },
      });
    },
    onSuccess: () => {
      toast.success("Designation updated");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set designation"),
  });

  const assignDepartmentMut = useMutation({
    mutationFn: async ({
      candidate,
      departmentId,
    }: {
      candidate: CandidateListItem;
      departmentId: string | null;
    }) => {
      const { error } = await supabase
        .from("candidates" as never)
        .update({ department_id: departmentId } as unknown as never)
        .eq("id", candidate.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "assign_department",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: { department_id: candidate.department_id },
        after: { department_id: departmentId },
      });
    },
    onSuccess: () => {
      toast.success("Department updated");
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set department"),
  });

  const addScopeMut = useMutation({
    mutationFn: async (input: {
      candidate: CandidateListItem;
      scope_type: ScopeType;
      scope_id: string;
      scope_label: string;
    }) => {
      const { error } = await supabase.from("employee_scope_assignments" as never).insert({
        candidate_id: input.candidate.id,
        scope_type: input.scope_type,
        scope_id: input.scope_id,
        scope_label: input.scope_label,
      } as unknown as never);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "add_scope",
        entityType: "candidate",
        entityId: input.candidate.id,
        entityLabel: input.candidate.full_name || input.candidate.employee_code,
        after: {
          scope_type: input.scope_type,
          scope_id: input.scope_id,
          scope_label: input.scope_label,
        },
      });
    },
    onSuccess: () => {
      toast.success("Scope added");
      qc.invalidateQueries({ queryKey: QK_SCOPE_ASSIGNMENTS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add scope"),
  });

  const removeScopeMut = useMutation({
    mutationFn: async ({
      scope,
      candidate,
    }: {
      scope: ScopeAssignment;
      candidate: CandidateListItem;
    }) => {
      const { error } = await supabase
        .from("employee_scope_assignments" as never)
        .delete()
        .eq("id", scope.id);
      if (error) throw error;
      await logActivity({
        module: "Employees",
        action: "remove_scope",
        entityType: "candidate",
        entityId: candidate.id,
        entityLabel: candidate.full_name || candidate.employee_code,
        before: {
          scope_type: scope.scope_type,
          scope_id: scope.scope_id,
          scope_label: scope.scope_label,
        },
      });
    },
    onSuccess: () => {
      toast.success("Scope removed");
      qc.invalidateQueries({ queryKey: QK_SCOPE_ASSIGNMENTS });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove scope"),
  });

  const [scopeTarget, setScopeTarget] = useState<CandidateListItem | null>(null);

  const approveMut = useMutation({
    mutationFn: async (cIn: CandidateListItem) => {
      // Refetch the candidate live — the list snapshot can be stale on
      // assigned_asset_ids / reports_to / unit_id, which silently skipped
      // the issuance handshake and the FO push.
      let c: CandidateListItem = cIn;
      try {
        const { data: fresh } = await supabase
          .from("candidates" as never)
          .select(
            "id,full_name,role_key,unit_id,reports_to,assigned_asset_ids,aadhaar_number,designation_id,created_by",
          )
          .eq("id", cIn.id)
          .maybeSingle();
        if (fresh) {
          const f = fresh as Partial<CandidateListItem>;
          c = {
            ...cIn,
            ...f,
            assigned_asset_ids: normalizeIdArray(f.assigned_asset_ids ?? cIn.assigned_asset_ids),
          };
        }
      } catch {
        /* fall back to snapshot */
      }

      // Onboarding-issuance handshake (mirrors offboarding-collection):
      // If the candidate has assets to be issued and a Field Officer we can
      // resolve, we mark them "approved" with a pending-issuance flag. The FO
      // then uses the standard Issuances flow, and guard OTP acknowledgement
      // flips the row to "active".
      const guardRoles = new Set(["guard", "security_guard"]);
      const assignedAssetIds = normalizeIdArray(c.assigned_asset_ids);
      const hasAssets = assignedAssetIds.length > 0;
      const isGuardRole = guardRoles.has((c.role_key || "").toLowerCase());

      let foCandidateId: string | null = c.reports_to;
      if (!foCandidateId && c.unit_id) {
        try {
          const { data: cu } = await supabase
            .from("candidate_units" as never)
            .select("candidate_id, candidates:candidate_id(role_key,status)")
            .eq("unit_id", c.unit_id);
          const first = (
            cu as unknown as Array<{
              candidate_id: string;
              candidates: { role_key?: string; status?: string } | null;
            }> | null
          )?.find(
            (r) =>
              r.candidates?.role_key === "field_officer" &&
              ["active", "approved"].includes(String(r.candidates?.status ?? "")),
          );
          foCandidateId = first?.candidate_id ?? null;
        } catch {
          /* ignore */
        }
      }

      let foUserId: string | null = null;
      let foName = "";
      if (foCandidateId) {
        try {
          const { data: uid } = await supabase.rpc(
            "get_user_id_by_candidate" as never,
            { _candidate_id: foCandidateId } as never,
          );
          foUserId = uid ? String(uid) : null;
        } catch {
          /* ignore */
        }
        try {
          const { data: foRow } = await supabase
            .from("candidates" as never)
            .select("full_name")
            .eq("id", foCandidateId)
            .maybeSingle();
          foName = String((foRow as { full_name?: string } | null)?.full_name ?? "");
        } catch {
          /* ignore */
        }
      }

      if (!foUserId && isGuardRole && hasAssets) {
        try {
          const { data: resolved } = await supabase.rpc(
            "resolve_candidate_issuance_field_officer" as never,
            { _candidate_id: c.id, _unit_id: c.unit_id, _reports_to: c.reports_to } as never,
          );
          const row = ((resolved as unknown as Array<{
            fo_user_id?: string | null;
            fo_name?: string | null;
          }> | null) ?? [])[0];
          foUserId = row?.fo_user_id ?? null;
          foName = row?.fo_name ?? foName;
        } catch {
          /* trigger still resolves this server-side */
        }
      }

      const deferForIssuance = hasAssets && isGuardRole && !!foUserId;

      const nextStatus = deferForIssuance ? "approved" : "active";
      const nextOnboardingDetails: OnboardingDetails = deferForIssuance
        ? {
            pending_issuance_fo_id: foUserId,
            pending_issuance_fo_name: foName || null,
            issuance_status: "pending",
            issuance_requested_at: new Date().toISOString(),
            issuance_asset_ids: assignedAssetIds,
          }
        : {};

      const { data, error } = await supabase
        .from("candidates" as never)
        .update({
          status: nextStatus,
          // Keep the account enabled while awaiting issuance so the guard can log in
          // and acknowledge the hand-over (OTP) to complete the cycle.
          is_enabled: true,
          rejection_reason: "",
          rejected_at: null,
          offboarding_reason_id: null,
          offboarded_at: null,
          onboarding_details: nextOnboardingDetails,
        } as unknown as never)
        .eq("id", c.id)
        .select("id,employee_code,full_name")
        .single();
      if (error) throw error;
      const empCode = (data as { employee_code?: string })?.employee_code ?? "";
      const label = c.full_name || c.aadhaar_number || "Candidate";
      // Auto-attach Form VII (nomination form) to the newly approved employee.
      void (async () => {
        try {
          const { autoAttachFormVii } = await import("@/lib/company-documents");
          autoAttachFormVii(c.id);
        } catch (e) {
          console.error("Form VII generation failed", e);
        }
      })();
      // Fire-and-forget: activity log + notifications should not block the UI.
      void (async () => {
        try {
          const unit = unitOfCandidate(c);
          const unitName = unit?.name ?? "";
          const clientName = unit?.customer_name ?? "";
          const desig = c.designation_id ? desigMap.get(c.designation_id) : undefined;
          const desigName = desig?.name ?? "";
          const joinDate = new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
          let empUserId: string | null = null;
          try {
            const { data: uid } = await supabase.rpc(
              "get_user_id_by_candidate" as never,
              { _candidate_id: c.id } as never,
            );
            empUserId = uid ? String(uid) : null;
          } catch {
            /* ignore */
          }

          const firstName = (c.full_name || "").split(" ")[0] || "there";
          const welcomeTitle = `Welcome to PLUS 360 FAHRENHEIT SOLUTIONS${empCode ? ` — ${empCode}` : ""}`;
          const welcomeLines = [
            `Hi ${firstName}, we're thrilled to have you on board!`,
            "",
            "Here are your onboarding details:",
            empCode ? `• Employee ID: ${empCode}` : null,
            desigName ? `• Designation: ${desigName}` : null,
            unitName ? `• Job Location: ${unitName}${clientName ? ` (${clientName})` : ""}` : null,
            `• Date of Joining: ${joinDate}`,
            foName ? `• Field Officer: ${foName}` : null,
            "",
            "Thank you for choosing to grow with us — wishing you a proud, safe, and successful journey ahead. 🎉",
          ]
            .filter(Boolean)
            .join("\n");

          const tasks: Array<Promise<unknown>> = [
            logActivity({
              module: "Employees",
              action: deferForIssuance ? "approve_awaiting_issuance" : "approve",
              entityType: "candidate",
              entityId: c.id,
              entityLabel: c.full_name || c.aadhaar_number,
              after: data as unknown as Record<string, unknown>,
            }),
            notifyOnboardingApprovers({
              type: "candidate_approved",
              title: deferForIssuance
                ? "Candidate approved — awaiting issuance"
                : "Candidate approved",
              message: deferForIssuance
                ? `${label} approved${empCode ? ` (${empCode})` : ""} — waiting for ${foName || "Field Officer"} to issue assets.`
                : `${label} was approved${empCode ? ` (${empCode})` : ""}.`,
              link: "/admin/employees",
              entityType: "candidate",
              entityId: c.id,
            }),
            c.created_by
              ? notifyUser(c.created_by, {
                  type: "candidate_approved",
                  title: deferForIssuance
                    ? "Candidate approved — awaiting your issuance"
                    : "Your candidate was approved",
                  message: deferForIssuance
                    ? `${label} approved${empCode ? ` — ${empCode}` : ""}. Issue assets in Uniform Manager → Issuances to activate.`
                    : `${label} was approved${empCode ? ` — Employee Code ${empCode}` : ""}.`,
                  link: deferForIssuance
                    ? `/admin/inventory/issuances?candidate=${c.id}&action=issue`
                    : "/admin/employees",
                  entityType: "candidate",
                  entityId: c.id,
                })
              : Promise.resolve(),
          ];

          if (!deferForIssuance) {
            if (foUserId) {
              tasks.push(
                notifyUser(foUserId, {
                  type: "candidate_approved_for_fo",
                  title: "New team member approved",
                  message: `${label}${empCode ? ` (${empCode})` : ""} is now active under you${unitName ? ` at ${unitName}` : ""}.`,
                  link: "/admin/field-dashboard",
                  entityType: "candidate",
                  entityId: c.id,
                }),
              );
            }
            if (empUserId) {
              tasks.push(
                createNotification({
                  userId: empUserId,
                  type: "welcome_onboarded",
                  title: welcomeTitle,
                  message: welcomeLines,
                  link: "/admin/employee-dashboard",
                  entityType: "candidate",
                  entityId: c.id,
                }),
              );
            }
          }

          await Promise.allSettled(tasks);
        } catch (e) {
          console.error("post-approve side effects failed", e);
        }
      })();
      return { ...(data as { employee_code: string }), deferForIssuance, foName };
    },
    onSuccess: (data) => {
      if (data?.deferForIssuance) {
        toast.success(`Approved — awaiting ${data.foName || "Field Officer"} to issue assets`);
      } else {
        toast.success(`Approved — ${data?.employee_code ?? "Employee code assigned"}`);
      }
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Approve failed"),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ c, reason }: { c: CandidateListItem; reason: string }) => {
      const { error } = await supabase
        .from("candidates" as never)
        .update({ status: "rejected", rejection_reason: reason } as unknown as never)
        .eq("id", c.id);
      if (error) throw error;
      const label = c.full_name || c.aadhaar_number || "Candidate";
      void (async () => {
        try {
          await Promise.allSettled([
            logActivity({
              module: "Employees",
              action: "reject",
              entityType: "candidate",
              entityId: c.id,
              entityLabel: c.full_name || c.aadhaar_number,
              after: { rejection_reason: reason },
            }),
            notifyOnboardingApprovers({
              type: "candidate_rejected",
              title: "Candidate rejected",
              message: `${label} was rejected. Reason: ${reason}`,
              link: "/admin/employees",
              entityType: "candidate",
              entityId: c.id,
            }),
            c.created_by
              ? notifyUser(c.created_by, {
                  type: "candidate_rejected",
                  title: "Your candidate needs changes",
                  message: `${label} was rejected. Reason: ${reason}`,
                  link: "/admin/employees",
                  entityType: "candidate",
                  entityId: c.id,
                })
              : Promise.resolve(),
          ]);
        } catch (e) {
          console.error("post-reject side effects failed", e);
        }
      })();
    },
    onSuccess: () => {
      toast.success("Candidate rejected");
      qc.invalidateQueries({ queryKey: QK });
      setRejectTarget(null);
      setRejectReason("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reject failed"),
  });

  const canEditInactiveProfile =
    isSuperAdmin || roleKey === "leadership" || roleKey === "super_admin";

  const openEditor = async (candidateId: string) => {
    setOpeningCandidateId(candidateId);
    try {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("*")
        .eq("id", candidateId)
        .single();
      if (error) throw error;
      const record = (data as Candidate) ?? null;
      if (record && record.status === "inactive" && !canEditInactiveProfile) {
        toast.error("Only leadership or super admin can edit an inactive employee's profile.");
        return;
      }
      // Editing must reopen in the same billable/non-billable onboarding flow
      // recorded on the employee, independently of later unit assignments.
      setWizardMode(
        (record as (Candidate & { non_billable?: boolean }) | null)?.non_billable
          ? "employee"
          : "candidate",
      );
      setEditing(record);
      setOpenWizard(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open candidate");
    } finally {
      setOpeningCandidateId(null);
    }
  };

  const renderRows = (rows: CandidateListItem[], mode: "employee" | "candidate") => {
    const empCols = 4 + Object.values(columnsVisible).filter(Boolean).length;
    const candCols = 8;
    if (isLoading) {
      const cols = mode === "employee" ? empCols : candCols;
      return (
        <>
          {Array.from({ length: 6 }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <Skeleton className={c === 0 ? "h-8 w-8 rounded-full" : "h-4 w-full"} />
                </td>
              ))}
            </tr>
          ))}
        </>
      );
    }

    if (candidatesError) {
      return (
        <tr>
          <td
            colSpan={mode === "employee" ? empCols : candCols}
            className="px-4 py-8 sm:px-8 sm:py-12"
          >
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/15">
                <UserPlus className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                Candidates could not be loaded
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Check your connection, then try again.
              </p>
              <Button
                variant="outline"
                className="mt-5 h-10 rounded-xl px-4"
                onClick={() => void candidatesQuery.refetch()}
              >
                Try Again
              </Button>
            </div>
          </td>
        </tr>
      );
    }
    if (rows.length === 0) {
      return (
        <tr>
          <td
            colSpan={mode === "employee" ? empCols : candCols}
            className="px-4 py-8 sm:px-8 sm:py-12"
          >
            <div className="mx-auto flex max-w-md flex-col items-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                <UserPlus className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {mode === "employee" ? "No employees yet" : "No candidates available"}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {mode === "employee"
                  ? "Approved candidates will appear here with their Employee ID."
                  : "Ready to onboard someone? Click Add Candidate to create a new profile."}
              </p>
              {mode === "candidate" && (
                <Button
                  className="mt-5 h-10 rounded-xl px-4 text-sm font-semibold"
                  onClick={() => {
                    setEditing(null);
                    setWizardMode("candidate");
                    setOpenWizard(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Candidate
                </Button>
              )}
            </div>
          </td>
        </tr>
      );
    }
    return rows.map((c) => {
      const unit = unitOfCandidate(c);
      const desig = c.designation_id ? desigMap.get(c.designation_id) : undefined;
      const deptName = (c.department_id && deptMap.get(c.department_id)) || "";
      const siteCount = siteCountOf(c.id);
      const showSiteMap = siteCount > 1;
      const code = mode === "employee" ? c.employee_code || "—" : c.candidate_code || "—";
      const isDisabled = mode === "employee" && !c.is_enabled;
      const isPendingOffboarding =
        c.offboarding_details?.collection_status === "pending" &&
        !!c.offboarding_details?.pending_collection_fo_id;
      const pendingFoName = c.offboarding_details?.pending_collection_fo_name;
      const isPendingIssuance =
        c.onboarding_details?.issuance_status === "pending" &&
        !!c.onboarding_details?.pending_issuance_fo_id;
      const pendingIssuanceFoName = c.onboarding_details?.pending_issuance_fo_name;
      const rehire = rehireByCandidate.get(c.id);
      return (
        <tr
          key={c.id}
          className={cn(
            "group transition-colors hover:bg-amber-50/30 dark:hover:bg-amber-500/5",
            isDisabled && "opacity-60",
            (isPendingOffboarding || isPendingIssuance) &&
              "bg-amber-500/[0.04] hover:bg-amber-500/[0.07]",
          )}
        >
          <td className="px-2.5 py-2 align-middle">
            <span className="inline-flex items-center whitespace-nowrap rounded-md bg-secondary px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide tabular-nums text-muted-foreground">
              {code}
            </span>
          </td>
          <td className="px-2.5 py-2 align-middle">
            <HoverCard openDelay={250} closeDelay={100}>
              <HoverCardTrigger asChild>
                <div className="grid cursor-default grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5">
                  {c.photo_url ? (
                    <img
                      src={c.photo_url}
                      alt=""
                      className="h-8 w-8 flex-shrink-0 rounded-full object-cover shadow-sm ring-2 ring-card"
                    />
                  ) : (
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground shadow-sm ring-2 ring-card">
                      <UserPlus className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div
                      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      className="font-semibold leading-tight text-foreground group-hover:text-amber-900 dark:group-hover:text-amber-300"
                    >
                      {c.full_name || "—"}
                    </div>
                  </div>
                </div>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-80 rounded-xl p-0 shadow-xl">
                <div className="border-b border-border/60 px-4 py-3">
                  <div className="font-semibold text-foreground">{c.full_name || "—"}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{code}</div>
                </div>
                <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-xs">
                  <dt className="text-muted-foreground">Mobile</dt>
                  <dd className="truncate font-medium">{c.mobile || "—"}</dd>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate font-medium" title={c.email ?? ""}>
                    {c.email || "—"}
                  </dd>
                  <dt className="text-muted-foreground">Client sites</dt>
                  <dd className="font-medium">{siteCount || "—"}</dd>
                  <dt className="text-muted-foreground">Designation</dt>
                  <dd className="truncate font-medium">{desig?.name || "—"}</dd>
                  <dt className="text-muted-foreground">Department</dt>
                  <dd className="truncate font-medium">{deptName || "—"}</dd>
                  <dt className="text-muted-foreground">Reports to</dt>
                  <dd className="truncate font-medium">{managerName(c.reports_to) || "—"}</dd>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd className="truncate font-medium">{roleNameOf(c.role_key) || "—"}</dd>
                </dl>
              </HoverCardContent>
            </HoverCard>
          </td>
          {(mode === "candidate" || columnsVisible.mobile) && (
            <td className="hidden px-2.5 py-2.5 text-center text-sm font-medium text-muted-foreground md:table-cell">
              {c.mobile || "—"}
            </td>
          )}
          {mode === "employee" && columnsVisible.email && (
            <td className="hidden max-w-[180px] px-2.5 py-2.5 text-sm text-muted-foreground md:table-cell">
              <span className="block truncate" title={c.email ?? ""}>
                {c.email || "—"}
              </span>
            </td>
          )}
          {(mode === "candidate" || columnsVisible.unit) && (
            <td className="hidden w-[112px] px-2.5 py-2 md:table-cell">
              {unit ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="inline-flex min-w-0 whitespace-nowrap rounded-md bg-secondary px-2 py-1 font-mono text-[11px] font-medium tabular-nums text-foreground"
                    title={`${unit.name}${unit.customer_name ? ` · ${unit.customer_name}` : ""}`}
                  >
                    {unit.code || "—"}
                  </span>
                  {showSiteMap && (
                    <button
                      type="button"
                      onClick={() => {
                        setSiteMapSearch("");
                        setSiteMapTarget(c);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
                      title={`View all ${siteCount} client sites`}
                    >
                      <MapPin className="h-3 w-3" />
                      {siteCount}
                    </button>
                  )}
                </div>
              ) : (
                "—"
              )}
            </td>
          )}
          {(mode === "candidate" || columnsVisible.designation) && (
            <td className="hidden px-2.5 py-2.5 md:table-cell">
              {mode === "employee" ? (
                <InlinePicker
                  value={c.designation_id}
                  placeholder="No designation"
                  searchPlaceholder="Search designation…"
                  options={designations.map((d) => ({ id: d.id, label: d.name }))}
                  onChange={(id) =>
                    assignDesignationMut.mutate({ candidate: c, designationId: id })
                  }
                />
              ) : (
                <span
                  className="block max-w-[130px] truncate text-sm text-muted-foreground"
                  title={desig?.name ?? ""}
                >
                  {desig?.name ?? "—"}
                </span>
              )}
            </td>
          )}
          {(mode === "candidate" || columnsVisible.department) && (
            <td className="hidden px-2.5 py-2.5 md:table-cell">
              {mode === "employee" ? (
                <InlinePicker
                  value={c.department_id}
                  placeholder="No department"
                  searchPlaceholder="Search department…"
                  options={departmentsList.map((d) => ({ id: d.id, label: d.name }))}
                  onChange={(id) => assignDepartmentMut.mutate({ candidate: c, departmentId: id })}
                />
              ) : (
                <span
                  className="block max-w-[130px] truncate text-sm text-muted-foreground"
                  title={deptName}
                >
                  {deptName || "—"}
                </span>
              )}
            </td>
          )}
          {mode === "employee" && columnsVisible.reportsTo && (
            <td className="hidden px-2.5 py-2.5 md:table-cell">
              <InlinePicker
                value={c.reports_to}
                placeholder="No manager"
                searchPlaceholder="Search manager…"
                options={managerOptions}
                onChange={(id) => assignManagerMut.mutate({ candidate: c, managerId: id })}
              />
            </td>
          )}
          {mode === "employee" && columnsVisible.dob && (
            <td className="hidden px-2.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
              {fmtDate(c.date_of_birth)}
            </td>
          )}
          {mode === "employee" && columnsVisible.doj && (
            <td className="hidden px-2.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
              {fmtDate(c.approved_at ?? c.preferred_joining_date)}
            </td>
          )}
          {mode === "employee" && columnsVisible.role && (
            <td className="hidden px-2.5 py-2.5 md:table-cell">
              {c.role_key ? (
                <Select
                  value={c.role_key}
                  onValueChange={async (v) => {
                    if (v === c.role_key) return;
                    const ok = await confirmAction({
                      title: "Change role?",
                      description: `Change role for ${c.full_name || c.employee_code} to ${rolesList.find((r) => r.key === v)?.name ?? v}?`,
                      confirmText: "Change role",
                    });
                    if (!ok) return;
                    assignRoleMut.mutate({ candidate: c, roleKey: v });
                  }}
                >
                  <SelectTrigger className="h-8 w-[108px] rounded-lg border-border/60 bg-card text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rolesList.map((r) => (
                      <SelectItem key={r.key} value={r.key} className="text-xs">
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                  >
                    No role assigned
                  </Badge>
                  <Select
                    value=""
                    onValueChange={async (v) => {
                      const ok = await confirmAction({
                        title: "Assign role?",
                        description: `Assign role ${rolesList.find((r) => r.key === v)?.name ?? v} to ${c.full_name || c.employee_code}?`,
                        confirmText: "Assign",
                      });
                      if (!ok) return;
                      assignRoleMut.mutate({ candidate: c, roleKey: v });
                    }}
                  >
                    <SelectTrigger className="h-7 w-[120px] rounded-lg border-dashed border-border/60 bg-transparent text-xs text-muted-foreground">
                      <SelectValue placeholder="Map role" />
                    </SelectTrigger>
                    <SelectContent>
                      {rolesList.map((r) => (
                        <SelectItem key={r.key} value={r.key} className="text-xs">
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </td>
          )}
          {mode === "employee" && columnsVisible.active && (
            <td className="hidden w-[92px] px-2.5 py-2.5 align-middle md:table-cell">
              <Switch
                checked={c.is_enabled && c.status !== "inactive"}
                onCheckedChange={async (v) => {
                  if (!v) {
                    // Disabling → start offboarding workflow
                    setOffboardTarget(c);
                    setOffboardReasonId("");
                    return;
                  }
                  if (c.no_hire) {
                    toast.error(
                      "This employee is flagged Do not re-hire and cannot be reactivated.",
                    );
                    return;
                  }
                  // If previously offboarded, ask whether to reuse the same record or create a new one
                  const wasOffboarded = !!c.offboarding_reason_id || !!c.offboarded_at;
                  if (wasOffboarded) {
                    setReactivateTarget(c);
                    return;
                  }

                  const ok = await confirmAction({
                    title: "Activate employee?",
                    description: `${c.full_name || c.employee_code} will be marked active again.`,
                    confirmText: "Activate",
                  });
                  if (!ok) return;
                  toggleEnabledMut.mutate({ candidate: c, enabled: true });
                }}
                disabled={!c.is_enabled && c.no_hire}
              />
            </td>
          )}
          <td
            className="w-[110px] min-w-[100px] whitespace-nowrap px-2.5 py-2 align-middle"
            data-col="status"
          >
            <div
              className="flex flex-wrap items-center justify-end gap-1.5"
              title={
                c.status === "rejected"
                  ? (c.rejection_reason ?? "Rejected")
                  : c.status === "inactive" && c.offboarding_reason_id
                    ? `${offboardReasons.find((x) => x.id === c.offboarding_reason_id)?.name || "Offboarded"}${c.offboarded_at ? ` · ${new Date(c.offboarded_at).toLocaleDateString()}` : ""}`
                    : isPendingOffboarding
                      ? `Offboarding in progress${pendingFoName ? ` · ${pendingFoName}` : ""}`
                      : isPendingIssuance
                        ? `Awaiting issuance${pendingIssuanceFoName ? ` · ${pendingIssuanceFoName}` : ""}`
                        : undefined
              }
            >
              <StatusBadge status={c.status} />
              {rehire && (
                <span
                  className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-violet-300/70 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
                  title={
                    rehire.isFinal
                      ? "Rehire approved — awaiting enablement. Enable to issue a new employee ID."
                      : `Rehire in progress · ${rehire.stepName}`
                  }
                >
                  <Clock className="h-3 w-3" />
                  <span className="hidden sm:inline">
                    {rehire.isFinal ? "Awaiting enablement" : "Rehire in progress"}
                  </span>
                </span>
              )}
              {isPendingOffboarding && (
                <span
                  className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                  title={`Offboarding in progress — awaiting inventory collection${pendingFoName ? ` by ${pendingFoName}` : ""}. Employee stays active until the Field Officer confirms recovery.`}
                >
                  <Clock className="h-3 w-3" />
                  <span className="hidden sm:inline">Awaiting collection</span>
                </span>
              )}
              {isPendingIssuance && (
                <span
                  className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-sky-300/70 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
                  title={`Approved — awaiting Field Officer${pendingIssuanceFoName ? ` (${pendingIssuanceFoName})` : ""} to issue assets. Activates once issuance is confirmed.`}
                >
                  <Clock className="h-3 w-3" />
                  <span className="hidden sm:inline">Awaiting issuance</span>
                </span>
              )}
            </div>
          </td>

          <td
            className="w-[220px] min-w-[220px] whitespace-nowrap px-3 py-2.5 align-middle"
            data-col="employee-actions"
          >
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {mode === "candidate" && rehire?.canAct && (
                <Button
                  size="sm"
                  onClick={() => setRehireReviewTarget(rehire.request)}
                  className="h-8 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700"
                  title={rehire.isFinal ? "Enable this rehire" : "Review this rehire approval"}
                >
                  {rehire.isFinal ? "Enable" : "Review"}
                </Button>
              )}
              {mode === "employee" && rehire?.isFinal && rehire.canAct && (
                <Button
                  size="sm"
                  onClick={() => setEnableRehireTarget(rehire.request)}
                  className="h-8 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700"
                  title="Enable this rehire and issue a new employee ID"
                >
                  Enable
                </Button>
              )}
              {showSiteMap && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setSiteMapSearch("");
                    setSiteMapTarget(c);
                  }}
                  className="h-8 w-8 rounded-full border-primary/25 bg-primary/5 text-primary hover:bg-primary/10"
                  title={`View site map — ${siteCount} client sites`}
                  aria-label="View site map"
                >
                  <MapPin className="h-4 w-4" />
                </Button>
              )}
              {mode === "candidate" && c.status === "pending" && canApproveOnboarding && (
                <>
                  <Button
                    size="icon"
                    data-variant="success"
                    onClick={() => setApprovePreview(c)}
                    disabled={approveMut.isPending}
                    className="h-8 w-8 rounded-full bg-emerald-600 text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95"
                    title="Review & approve"
                    aria-label="Review & approve"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    data-variant="danger"
                    variant="outline"
                    onClick={() => {
                      setRejectTarget(c);
                      setRejectReason("");
                    }}
                    className="h-8 w-8 rounded-full border-rose-200 bg-rose-50 text-rose-600 transition-all hover:bg-rose-100 hover:text-rose-700 active:scale-95 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                    title="Reject candidate"
                    aria-label="Reject"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
              {mode === "employee" && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    data-variant="warn"
                    onClick={() => setSignTarget({ id: c.id, docType: "nda" })}
                    className="h-8 w-8 rounded-full border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                    title="Sign NDA"
                    aria-label="Sign NDA"
                  >
                    <FileSignature className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    data-variant="warn"
                    onClick={() => setSignTarget({ id: c.id, docType: "appointment_letter" })}
                    className="h-8 w-8 rounded-full border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 dark:border-sky-500/40 dark:bg-transparent dark:text-sky-300 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                    title="Sign Appointment Letter"
                    aria-label="Sign Appointment Letter"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </>
              )}
              <div className="flex flex-nowrap items-center gap-1">
                {(() => {
                  const editLocked = c.status === "inactive" && !canEditInactiveProfile;
                  const lockedTitle = "Inactive profile — only leadership or super admin can edit.";
                  return (
                    <>
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                        title={
                          editLocked
                            ? "View profile & offboarding docs (read-only)"
                            : "Open the full 10-section editor"
                        }
                      >
                        <Link
                          to="/admin/candidates/$id/details"
                          params={{ id: c.id }}
                          search={
                            c.offboarding_details && Object.keys(c.offboarding_details).length > 0
                              ? { section: "offboarding" }
                              : undefined
                          }
                        >
                          <FileText className="h-4 w-4" />
                        </Link>
                      </Button>

                      <RecordViewButton
                        record={c}
                        title="Employee details"
                        onEdit={() => void openEditor(c.id)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void openEditor(c.id)}
                        disabled={openingCandidateId === c.id || editLocked}
                        className="h-7 w-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                        title={editLocked ? lockedTitle : "Quick edit"}
                        aria-label={editLocked ? lockedTitle : "Quick edit"}
                      >
                        {openingCandidateId === c.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Edit2 className="h-4 w-4" />
                        )}
                      </Button>
                    </>
                  );
                })()}

                {mode === "candidate" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmDelete(c)}
                    className="h-7 w-7 rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </td>
        </tr>
      );
    });
  };

  const renderMobileCards = (rows: CandidateListItem[], mode: "employee" | "candidate") => {
    if (isLoading) {
      return (
        <div className="space-y-2.5 md:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (candidatesError) {
      return (
        <div className="rounded-2xl border border-border/70 bg-card px-5 py-10 text-center md:hidden">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/15">
            <UserPlus className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-foreground">
            Candidates could not be loaded
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Check your connection, then try again.
          </p>
          <Button
            variant="outline"
            className="mt-5 h-10 rounded-xl px-4"
            onClick={() => void candidatesQuery.refetch()}
          >
            Try Again
          </Button>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="rounded-2xl border border-border/70 bg-card px-5 py-10 text-center md:hidden">
          <div className="mx-auto flex max-w-sm flex-col items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
              <UserPlus className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-foreground">
              {mode === "employee" ? "No employees yet" : "No candidates available"}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {mode === "employee"
                ? "Approved candidates will appear here with their Employee ID."
                : "Ready to onboard someone? Click Add Candidate to create a new profile."}
            </p>
            {mode === "candidate" && (
              <Button
                className="mt-5 h-10 rounded-xl px-4 text-sm font-semibold"
                onClick={() => {
                  setEditing(null);
                  setWizardMode("candidate");
                  setOpenWizard(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add Candidate
              </Button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-2 md:hidden">
        {rows.map((c) => {
          const unit = unitOfCandidate(c);
          const desig = c.designation_id ? desigMap.get(c.designation_id) : undefined;
          const code = mode === "employee" ? c.employee_code || "—" : c.candidate_code || "—";
          const isDisabled = mode === "employee" && !c.is_enabled;
          const isPendingOffboarding =
            c.offboarding_details?.collection_status === "pending" &&
            !!c.offboarding_details?.pending_collection_fo_id;
          const pendingFoName = c.offboarding_details?.pending_collection_fo_name;
          const isPendingIssuance =
            c.onboarding_details?.issuance_status === "pending" &&
            !!c.onboarding_details?.pending_issuance_fo_id;
          const pendingIssuanceFoName = c.onboarding_details?.pending_issuance_fo_name;
          const editLocked = c.status === "inactive" && !canEditInactiveProfile;
          const lockedTitle = "Inactive profile — only leadership or super admin can edit.";
          const rehire = rehireByCandidate.get(c.id);
          const roleName =
            rolesList.find((r) => r.key === c.role_key)?.name ?? c.role_key ?? "No role";

          return (
            <article
              key={c.id}
              className={cn(
                "rounded-xl border border-border/70 bg-card p-2.5 shadow-sm",
                isDisabled && "opacity-65",
                isPendingOffboarding && "border-amber-300/70 bg-amber-500/[0.05]",
              )}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                {c.photo_url ? (
                  <img
                    src={c.photo_url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm ring-1 ring-border/70"
                  />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground shadow-sm ring-1 ring-border/70">
                    <UserPlus className="h-4 w-4" />
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <h3 className="max-w-full truncate text-sm font-semibold leading-tight text-foreground">
                      {c.full_name || "—"}
                    </h3>
                    <span className="inline-flex shrink-0 items-center rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                      {code}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="truncate">{c.mobile || "No mobile"}</span>
                    <span className="truncate text-right">{roleName}</span>
                    <span
                      className="truncate font-mono"
                      title={unit ? `${unit.name}${unit.customer_name ? ` · ${unit.customer_name}` : ""}` : ""}
                    >
                      {unit?.code || "No client"}
                    </span>
                    <span className="truncate text-right" title={desig?.name ?? ""}>
                      {desig?.name || "No designation"}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusBadge status={c.status} />
                  {mode === "employee" && columnsVisible.active && (
                    <Switch
                      checked={c.is_enabled && c.status !== "inactive"}
                      onCheckedChange={async (v) => {
                        if (!v) {
                          setOffboardTarget(c);
                          setOffboardReasonId("");
                          return;
                        }
                        if (c.no_hire) {
                          toast.error(
                            "This employee is flagged Do not re-hire and cannot be reactivated.",
                          );
                          return;
                        }
                        const wasOffboarded = !!c.offboarding_reason_id || !!c.offboarded_at;
                        if (wasOffboarded) {
                          setReactivateTarget(c);
                          return;
                        }
                        const ok = await confirmAction({
                          title: "Activate employee?",
                          description: `${c.full_name || c.employee_code} will be marked active again.`,
                          confirmText: "Activate",
                        });
                        if (!ok) return;
                        toggleEnabledMut.mutate({ candidate: c, enabled: true });
                      }}
                      disabled={!c.is_enabled && c.no_hire}
                    />
                  )}
                </div>
              </div>

              {rehire && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-300/70 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {rehire.isFinal ? "Awaiting enablement" : `Rehire · ${rehire.stepName}`}
                    </span>
                  </span>
                  {mode === "candidate" && rehire.canAct && (
                    <Button
                      size="sm"
                      onClick={() => setRehireReviewTarget(rehire.request)}
                      className="h-7 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700"
                    >
                      {rehire.isFinal ? "Enable" : "Review"}
                    </Button>
                  )}
                  {mode === "employee" && rehire.isFinal && rehire.canAct && (
                    <Button
                      size="sm"
                      onClick={() => setEnableRehireTarget(rehire.request)}
                      className="h-7 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700"
                    >
                      Enable
                    </Button>
                  )}
                </div>
              )}
              {isPendingOffboarding && (
                <div
                  className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                  title={`Offboarding in progress — awaiting inventory collection${pendingFoName ? ` by ${pendingFoName}` : ""}. Employee stays active until the Field Officer confirms recovery.`}
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Awaiting collection{pendingFoName ? ` · ${pendingFoName}` : ""}
                  </span>
                </div>
              )}
              {isPendingIssuance && (
                <div
                  className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-sky-300/70 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
                  title={`Approved — awaiting Field Officer${pendingIssuanceFoName ? ` (${pendingIssuanceFoName})` : ""} to issue assets. Activates once issuance is confirmed.`}
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Awaiting issuance{pendingIssuanceFoName ? ` · ${pendingIssuanceFoName}` : ""}
                  </span>
                </div>
              )}

              {mode === "employee" && columnsVisible.role && (
                <div className="mt-1.5">
                  {c.role_key ? (
                    <Select
                      value={c.role_key}
                      onValueChange={async (v) => {
                        if (v === c.role_key) return;
                        const ok = await confirmAction({
                          title: "Change role?",
                          description: `Change role for ${c.full_name || c.employee_code} to ${rolesList.find((r) => r.key === v)?.name ?? v}?`,
                          confirmText: "Change role",
                        });
                        if (!ok) return;
                        assignRoleMut.mutate({ candidate: c, roleKey: v });
                      }}
                    >
                      <SelectTrigger className="h-8 w-full rounded-lg border-border/60 bg-card text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rolesList.map((r) => (
                          <SelectItem key={r.key} value={r.key} className="text-xs">
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value=""
                      onValueChange={async (v) => {
                        const ok = await confirmAction({
                          title: "Assign role?",
                          description: `Assign role ${rolesList.find((r) => r.key === v)?.name ?? v} to ${c.full_name || c.employee_code}?`,
                          confirmText: "Assign",
                        });
                        if (!ok) return;
                        assignRoleMut.mutate({ candidate: c, roleKey: v });
                      }}
                    >
                      <SelectTrigger className="h-8 w-full rounded-lg border-dashed border-border/60 bg-card text-xs text-muted-foreground">
                        <SelectValue placeholder="Map role" />
                      </SelectTrigger>
                      <SelectContent>
                        {rolesList.map((r) => (
                          <SelectItem key={r.key} value={r.key} className="text-xs">
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="mt-1.5 flex items-center justify-end gap-1 border-t border-border/50 pt-1.5">
                {mode === "candidate" && c.status === "pending" && canApproveOnboarding && (
                  <>
                    <Button
                      size="icon"
                      data-variant="success"
                      onClick={() => setApprovePreview(c)}
                      disabled={approveMut.isPending}
                      className="h-8 w-8 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                      title="Review & approve"
                      aria-label="Review & approve"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      data-variant="danger"
                      variant="outline"
                      onClick={() => {
                        setRejectTarget(c);
                        setRejectReason("");
                      }}
                      className="h-8 w-8 rounded-full border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                      title="Reject"
                      aria-label="Reject"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {mode === "employee" && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      data-variant="warn"
                      onClick={() => setSignTarget({ id: c.id, docType: "nda" })}
                      className="h-8 w-8 rounded-full border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      title="Sign NDA"
                      aria-label="Sign NDA"
                    >
                      <FileSignature className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      data-variant="warn"
                      onClick={() => setSignTarget({ id: c.id, docType: "appointment_letter" })}
                      className="h-8 w-8 rounded-full border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      title="Sign Appointment Letter"
                      aria-label="Sign Appointment Letter"
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title={
                    editLocked ? "View profile & offboarding docs (read-only)" : "Open full editor"
                  }
                >
                  <Link
                    to="/admin/candidates/$id/details"
                    params={{ id: c.id }}
                    search={
                      c.offboarding_details && Object.keys(c.offboarding_details).length > 0
                        ? { section: "offboarding" }
                        : undefined
                    }
                  >
                    <FileText className="h-4 w-4" />
                  </Link>
                </Button>

                <RecordViewButton
                  record={c}
                  title="Employee details"
                  onEdit={() => void openEditor(c.id)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void openEditor(c.id)}
                  disabled={openingCandidateId === c.id || editLocked}
                  className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  title={editLocked ? lockedTitle : "Quick edit"}
                  aria-label={editLocked ? lockedTitle : "Quick edit"}
                >
                  {openingCandidateId === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Edit2 className="h-4 w-4" />
                  )}
                </Button>
                {mode === "candidate" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmDelete(c)}
                    className="h-8 w-8 rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    );
  };

  const renderTable = (
    rows: CandidateListItem[],
    mode: "employee" | "candidate",
    pg: ReturnType<typeof usePagination<CandidateListItem>>,
  ) => (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm shadow-stone-200/40 dark:shadow-black/20 sm:rounded-3xl">
      <div className="flex items-center justify-between border-b border-border bg-accent/10 px-3 py-2 text-xs font-medium text-foreground sm:px-5 sm:py-2.5">
        <span className="inline-flex items-center gap-2">
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
            {rows.length}
          </span>
          <span className="uppercase tracking-[0.14em] text-muted-foreground">
            Total {rows.length === 1 ? "row" : "rows"}
          </span>
        </span>
      </div>
      <div className="p-2.5 md:hidden">{renderMobileCards(pg.pageRows, mode)}</div>
      <div className="hidden w-full overflow-x-auto md:block">
        <table className="ios-table w-full table-auto text-sm min-w-[1180px] 2xl:min-w-[1480px]">
          <thead className="border-b border-border/60 bg-secondary/40">
            <tr>
              <th className="w-[112px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {mode === "employee" ? "Emp ID" : "Code"}
              </th>
              <th className="w-[240px] min-w-[220px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {mode === "employee" ? "Employee" : "Candidate"}
              </th>
              {(mode === "candidate" || columnsVisible.mobile) && (
                <th className="hidden w-[132px] px-3 py-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Mobile
                </th>
              )}
              {mode === "employee" && columnsVisible.email && (
                <th className="hidden w-[176px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Email
                </th>
              )}
              {(mode === "candidate" || columnsVisible.unit) && (
                <th className="hidden w-[112px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Client ID
                </th>
              )}
              {(mode === "candidate" || columnsVisible.designation) && (
                <th className="hidden w-[168px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Designation
                </th>
              )}
              {(mode === "candidate" || columnsVisible.department) && (
                <th className="hidden w-[160px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Department
                </th>
              )}
              {mode === "employee" && columnsVisible.reportsTo && (
                <th className="hidden w-[168px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Reporting manager
                </th>
              )}
              {mode === "employee" && columnsVisible.dob && (
                <th className="hidden w-[124px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Date of Birth
                </th>
              )}
              {mode === "employee" && columnsVisible.doj && (
                <th className="hidden w-[124px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Date of Joining
                </th>
              )}
              {mode === "employee" && columnsVisible.role && (
                <th className="hidden w-[128px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Role
                </th>
              )}

              {mode === "employee" && columnsVisible.active && (
                <th className="hidden w-[92px] px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground md:table-cell">
                  Active
                </th>
              )}
              <th
                className="w-[110px] min-w-[100px] whitespace-nowrap px-3 py-3 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
                data-col="status"
              >
                Status
              </th>
              <th
                className="w-[220px] min-w-[220px] whitespace-nowrap px-3 py-3 !text-right text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
                data-col="employee-actions"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">{renderRows(pg.pageRows, mode)}</tbody>
        </table>
        <DataPagination {...pg} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title={isFieldOfficer ? "Candidates" : "Employees"}
        description={
          isFieldOfficer
            ? "Manage your candidates."
            : "Onboard and manage candidates joining client sites."
        }
      />

      <RehireEnableDialog
        request={enableRehireTarget}
        onClose={() => setEnableRehireTarget(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: QK });
          qc.invalidateQueries({ queryKey: ["rehire-pipeline"] });
        }}
      />

      <RehireReviewDialog
        request={rehireReviewTarget}
        steps={rehireStepsQ.data ?? []}
        roleKey={roleKey}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setRehireReviewTarget(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: QK });
          qc.invalidateQueries({ queryKey: ["rehire-pipeline"] });
          qc.invalidateQueries({ queryKey: ["workflows", "rehire"] });
        }}
      />

      <div className="scrollbar-hide grid grid-flow-col auto-cols-[minmax(150px,1fr)] gap-2 overflow-x-auto pb-1 sm:grid-flow-row sm:grid-cols-4 sm:overflow-visible lg:grid-cols-5">
        {(tab === "employee" && !isFieldOfficer
          ? [
              { label: "Total", value: stats.empTotal, accent: "sky" as const },
              { label: "Active", value: stats.empActive, accent: "emerald" as const },
              { label: "Inactive", value: stats.empInactive, accent: "rose" as const },
              { label: "Billable", value: stats.empBillable, accent: "cyan" as const },
              { label: "Non-billable", value: stats.empNonBillable, accent: "amber" as const },
            ]
          : [
              { label: "Total", value: stats.candTotal, accent: "sky" as const },
              { label: "Drafts", value: stats.candDrafts, accent: "amber" as const },
              { label: "Pending", value: stats.candPending, accent: "violet" as const },
              { label: "Rejected", value: stats.candRejected, accent: "rose" as const },
            ]
        ).map((item) => (
          <PageStat
            key={item.label}
            label={item.label}
            value={item.value.toLocaleString("en-IN")}
            accent={item.accent}
          />
        ))}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "employee" | "candidate")}
        className="space-y-4 sm:space-y-5"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList className="inline-flex h-auto w-full rounded-xl border border-border/60 bg-secondary/40 p-1 backdrop-blur-sm sm:w-auto">
            {!isFieldOfficer && (
              <TabsTrigger
                value="employee"
                className="flex-1 rounded-lg px-3 py-2 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:flex-none sm:px-6 sm:text-sm"
              >
                Employees <span className="ml-1.5 text-xs opacity-60">({stats.empTotal})</span>
              </TabsTrigger>
            )}
            <TabsTrigger
              value="candidate"
              className="flex-1 rounded-lg px-3 py-2 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:flex-none sm:px-6 sm:text-sm"
            >
              {isFieldOfficer ? "My Candidates" : "Candidates"}{" "}
              <span className="ml-1.5 text-xs opacity-60">({candidateRows.length})</span>
            </TabsTrigger>
          </TabsList>

          <div
            className={cn(
              "grid w-full items-center gap-2 md:flex md:w-auto md:gap-3",
              isFieldOfficer
                ? tab === "candidate"
                  ? "grid-cols-[minmax(0,1fr)_auto]"
                  : "grid-cols-1"
                : tab === "candidate"
                  ? "grid-cols-[minmax(0,1fr)_auto_auto]"
                  : "grid-cols-[minmax(0,1fr)_auto]",
            )}
          >
            <EmployeeSearchInput value={search} onChange={setSearch} />
            {isFieldOfficer ? (
              tab === "candidate" ? (
                <Button
                  className="h-10 whitespace-nowrap rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none sm:h-11 sm:px-5 sm:text-sm"
                  onClick={() => {
                    setEditing(null);
                    setWizardMode("candidate");
                    setOpenWizard(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden min-[360px]:inline">Add Candidate</span>
                  <span className="min-[360px]:hidden">Add</span>
                </Button>
              ) : null
            ) : (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={
                        exporting ||
                        (tab === "employee" ? employees.length === 0 : candidateRows.length === 0)
                      }
                      className="h-10 whitespace-nowrap rounded-xl border-border/70 bg-card px-3 font-semibold shadow-sm sm:h-11 sm:px-4"
                    >
                      {exporting ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">Export</span>
                      <ChevronDown className="ml-1.5 h-4 w-4 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Export {tab === "employee" ? "employees" : "candidates"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExport("summary-csv")} className="gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Summary</span>
                        <span className="text-[11px] text-muted-foreground">
                          Visible list columns
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("full-csv")} className="gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-amber-600" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">All details</span>
                        <span className="text-[11px] text-muted-foreground">
                          Every field, flattened
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("full-json")} className="gap-2">
                      <FileJson className="h-4 w-4 text-sky-600" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">All details (JSON)</span>
                        <span className="text-[11px] text-muted-foreground">
                          Full record incl. nested
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setDocsExportOpen(true)} className="gap-2">
                      <FileText className="h-4 w-4 text-violet-600" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Documents</span>
                        <span className="text-[11px] text-muted-foreground">
                          Aadhaar, PAN & all files as one PDF
                        </span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {tab === "candidate" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-10 whitespace-nowrap rounded-xl bg-primary px-3 font-semibold text-primary-foreground shadow-lg shadow-primary/10 transition-all hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0 sm:h-11 sm:px-6">
                        <Plus className="mr-1.5 h-4 w-4" />
                        <span className="hidden sm:inline">Add Candidate</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Choose type
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(null);
                          setWizardMode("candidate");
                          setOpenWizard(true);
                        }}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">Billable</span>
                          <span className="text-[11px] text-muted-foreground">
                            Client-facing guards / field staff
                          </span>
                        </div>
                      </DropdownMenuItem>
                      {canAddEmployee && (
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(null);
                            setWizardMode("employee");
                            setOpenWizard(true);
                          }}
                          className="gap-2"
                        >
                          <UserPlus className="h-4 w-4" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Non-billable</span>
                            <span className="text-[11px] text-muted-foreground">
                              Internal Radiant employee
                            </span>
                          </div>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </div>
        </div>

        {/* Active / Inactive sub-tabs (Employees tab only) */}
        {tab === "employee" && (
          <div className="flex items-center gap-2">
            <div className="inline-flex h-auto w-full rounded-xl border border-border/60 bg-secondary/40 p-1 backdrop-blur-sm sm:w-auto">
              <button
                type="button"
                onClick={() => setEmpStatusTab("active")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4",
                  empStatusTab === "active"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Active <span className="ml-1 opacity-60">({stats.empActive})</span>
              </button>
              <button
                type="button"
                onClick={() => setEmpStatusTab("inactive")}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4",
                  empStatusTab === "inactive"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Inactive <span className="ml-1 opacity-60">({stats.empInactive})</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter bar (Employees tab only) */}
        {tab === "employee" && (
          <div className="mobile-directory-filters grid grid-cols-2 items-center gap-1.5 rounded-xl border border-border/60 bg-card/60 p-2 shadow-sm backdrop-blur-xl sm:flex sm:flex-wrap sm:gap-2 sm:rounded-2xl sm:p-3">
            {filtersVisible.role && (
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[150px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All roles
                  </SelectItem>
                  {rolesList.map((r) => (
                    <SelectItem key={r.key} value={r.key} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.designation && (
              <Select value={filterDesignation} onValueChange={setFilterDesignation}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[170px]">
                  <SelectValue placeholder="Designation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All designations
                  </SelectItem>
                  {designations.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.department && (
              <Select value={filterDepartment} onValueChange={setFilterDepartment}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All departments
                  </SelectItem>
                  <SelectItem value="none" className="text-xs">
                    No department
                  </SelectItem>
                  {departmentsList.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.customer && (
              <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                  <SelectValue placeholder="Organization" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All organizations
                  </SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.unit && (
              <Select value={filterUnit} onValueChange={setFilterUnit}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                  <SelectValue placeholder="Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All units
                  </SelectItem>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.manager && (
              <Select value={filterManager} onValueChange={setFilterManager}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[180px]">
                  <SelectValue placeholder="Reports to" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    Any manager
                  </SelectItem>
                  {fieldOfficers.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.full_name} ({m.employee_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtersVisible.enabled && (
              <Select
                value={filterEnabled}
                onValueChange={(v) => setFilterEnabled(v as "all" | "enabled" | "disabled")}
              >
                <SelectTrigger className="h-9 w-full text-xs sm:w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All employees
                  </SelectItem>
                  <SelectItem value="enabled" className="text-xs">
                    Active only
                  </SelectItem>
                  <SelectItem value="disabled" className="text-xs">
                    Inactive only
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            {filtersVisible.billable && (
              <Select
                value={filterBillable}
                onValueChange={(v) => setFilterBillable(v as "all" | "billable" | "nonbillable")}
              >
                <SelectTrigger className="h-9 w-full text-xs sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All billing
                  </SelectItem>
                  <SelectItem value="billable" className="text-xs">
                    Billable only
                  </SelectItem>
                  <SelectItem value="nonbillable" className="text-xs">
                    Non-billable only
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            {filtersVisible.offboardReason && (
              <Select value={filterOffboardReason} onValueChange={setFilterOffboardReason}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[170px]">
                  <SelectValue placeholder="Offboarding" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    Any offboarding
                  </SelectItem>
                  <SelectItem value="none" className="text-xs">
                    No offboarding
                  </SelectItem>
                  {offboardReasons.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterRole("all");
                setFilterDesignation("all");
                setFilterCustomer("all");
                setFilterUnit("all");
                setFilterManager("all");
                setFilterEnabled("all");
                setFilterBillable("all");
                setFilterOffboardReason("all");
                setFilterDepartment("all");
              }}
              className="h-8 px-2 text-xs text-muted-foreground"
            >
              Reset
            </Button>
            <div className="col-span-2 ml-auto flex items-center gap-1.5 sm:col-span-1">
              <div className="flex rounded-lg border border-border/60 bg-secondary/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                    viewMode === "list"
                      ? "bg-card shadow-sm text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <LayoutList className="h-3.5 w-3.5" /> List
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("tree")}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                    viewMode === "tree"
                      ? "bg-card shadow-sm text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Network className="h-3.5 w-3.5" /> Tree
                </button>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title="Configure filters & columns"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 max-h-[70vh] overflow-y-auto">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Show filters
                    </div>
                    {(
                      [
                        ["role", "Role"],
                        ["designation", "Designation"],
                        ["department", "Department"],
                        ["customer", "Organization"],
                        ["unit", "Client"],
                        ["manager", "Reports to"],
                        ["enabled", "Active / Inactive"],
                        ["billable", "Billable"],
                        ["offboardReason", "Offboarding reason"],
                      ] as const
                    ).map(([k, label]) => (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                      >
                        <span>{label}</span>
                        <Switch
                          checked={filtersVisible[k]}
                          onCheckedChange={(v) => setFiltersVisible((s) => ({ ...s, [k]: v }))}
                        />
                      </label>
                    ))}
                    <div className="pt-2 mt-2 border-t border-border/60 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Show columns
                    </div>
                    {(
                      [
                        ["mobile", "Mobile"],
                        ["email", "Email"],
                        ["unit", "Client"],
                        ["designation", "Designation"],
                        ["department", "Department"],
                        ["reportsTo", "Reporting manager"],
                        ["dob", "Date of Birth"],
                        ["doj", "Date of Joining"],
                        ["role", "Role"],
                        ["active", "Active toggle"],
                      ] as const
                    ).map(([k, label]) => (
                      <label
                        key={`col-${k}`}
                        className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                      >
                        <span>{label}</span>
                        <Switch
                          checked={columnsVisible[k]}
                          onCheckedChange={(v) => setColumnsVisible((s) => ({ ...s, [k]: v }))}
                        />
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}

        <TabsContent value="employee" className="mt-0">
          {viewMode === "tree" ? (
            <ManagerTree
              employees={employees}
              fieldOfficers={fieldOfficers}
              scopeByCandidate={scopeByCandidate}
              unitMap={unitMap}
            />
          ) : (
            renderTable(employees, "employee", pgEmployees)
          )}
        </TabsContent>
        <TabsContent value="candidate" className="mt-0">
          <div className="mb-4">
            <RehireApprovalsCard onReview={(request) => setRehireReviewTarget(request)} />
          </div>
          {renderTable(candidateRows, "candidate", pgCandidates)}
        </TabsContent>
      </Tabs>

      <CandidateWizard
        open={openWizard}
        onOpenChange={(v) => {
          setOpenWizard(v);
          if (!v) setEditing(null);
        }}
        editing={editing}
        mode={wizardMode}
        units={scopedUnitsForWizard}
        unitsLoading={isFieldOfficer ? scopeStillLoading : unitsQuery.isLoading}
        unitsError={
          // A field officer only needs their own clients, so a failure of the
          // full client master is irrelevant once their own list has arrived.
          isFieldOfficer
            ? scopedUnitsForWizard.length > 0 || scopeStillLoading
              ? null
              : myUnitsQuery.error instanceof Error
                ? myUnitsQuery.error.message
                : unitsQuery.error instanceof Error
                  ? unitsQuery.error.message
                  : "You have no clients assigned. Ask your admin to assign a branch or client before onboarding."
            : unitsQuery.error instanceof Error
              ? unitsQuery.error.message
              : null
        }
        designations={designations}
        designationsLoading={designationsQuery.isLoading}
        designationsError={
          designationsQuery.error instanceof Error ? designationsQuery.error.message : null
        }
        exServices={exServices}
        languagesList={languagesList}
        esicBranches={esicBranches}
        offboardReasons={offboardReasons}
        assets={assets}
        canReview={!!editing && editing.status === "pending" && canApproveOnboarding}
        isApproving={approveMut.isPending}
        onApprove={() => {
          if (!editing) return;
          approveMut.mutate(editing as unknown as CandidateListItem, {
            onSuccess: () => {
              setOpenWizard(false);
              setEditing(null);
            },
          });
        }}
        onReject={() => {
          if (!editing) return;
          setRejectTarget(editing as unknown as CandidateListItem);
          setRejectReason("");
          setOpenWizard(false);
        }}
        onRequestOffboard={() => {
          if (!editing) return;
          setOffboardTarget(editing as unknown as CandidateListItem);
          setOffboardReasonId("");
          setOpenWizard(false);
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {confirmDelete?.full_name || "this candidate"} from the
              system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) deleteMut.mutate(confirmDelete);
                setConfirmDelete(null);
              }}
              className="bg-rose-500 hover:bg-rose-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Offboarding workflow */}
      <OffboardingDialog
        target={offboardTarget}
        reasons={offboardReasons}
        reasonsLoading={offboardReasonsQuery.isLoading}
        assets={assets}
        initialReasonId={offboardReasonId}
        isSubmitting={offboardMut.isPending}
        currentUserCandidateId={currentCandidateId}
        isFieldOfficer={isFieldOfficer}
        onClose={() => {
          setOffboardTarget(null);
          setOffboardReasonId("");
        }}
        onSubmit={({ reasonId, details, noHire }) => {
          if (!offboardTarget) return;
          const reason = offboardReasons.find((r) => r.id === reasonId);
          offboardMut.mutate({
            candidate: offboardTarget,
            reasonId,
            reasonName: reason?.name ?? "",
            details,
            noHire,
          });
        }}
      />

      {/* Reactivation chooser: reuse the archived record vs create a fresh one */}
      <Dialog open={!!reactivateTarget} onOpenChange={(o) => !o && setReactivateTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Reactivate {reactivateTarget?.full_name || reactivateTarget?.employee_code}?
            </DialogTitle>
            <DialogDescription>
              This employee was previously offboarded ({reactivateTarget?.employee_code}). Choose
              how to bring them back.
              {!(
                isSuperAdmin || ["admin", "super_admin", "hr", "leadership"].includes(roleKey ?? "")
              ) && (
                <span className="mt-2 block text-xs">
                  Your request will be sent to HR / Admin for approval before the employee becomes
                  active.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <button
              type="button"
              data-force-enabled="true"
              disabled={reactivateMut.isPending}
              style={{
                pointerEvents: reactivateMut.isPending ? "none" : "auto",
                opacity: reactivateMut.isPending ? 0.5 : 1,
              }}
              className="rounded-lg border-2 border-border bg-background p-3 text-left transition hover:border-primary hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
              onClick={() => {
                if (!reactivateTarget) return;
                const target = reactivateTarget;
                setReactivateTarget(null);
                reactivateMut.mutate({ candidate: target, mode: "new" });
              }}
            >
              <div className="font-semibold text-foreground">1. Create a new employee record</div>
              <div className="mt-1 text-xs text-muted-foreground">
                A brand-new employee ID will be generated. All KYC/documents are copied over; the
                original record ({reactivateTarget?.employee_code || "—"}) stays archived for audit.
              </div>
            </button>
            <button
              type="button"
              data-force-enabled="true"
              disabled={reactivateMut.isPending}
              style={{
                pointerEvents: reactivateMut.isPending ? "none" : "auto",
                opacity: reactivateMut.isPending ? 0.5 : 1,
              }}
              className="rounded-lg border-2 border-border bg-background p-3 text-left transition hover:border-primary hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
              onClick={() => {
                if (!reactivateTarget) return;
                const target = reactivateTarget;
                setReactivateTarget(null);
                reactivateMut.mutate({ candidate: target, mode: "reuse" });
              }}
            >
              <div className="font-semibold text-foreground">2. Reactivate the same record</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Keeps the existing employee ID{" "}
                <span className="font-mono">{reactivateTarget?.employee_code || "—"}</span>.
                Reactivates the same profile while retaining offboarding history.
              </div>
            </button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReactivateTarget(null)}
              disabled={reactivateMut.isPending}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!approvePreview}
        onOpenChange={(o) => {
          if (!o) setApprovePreview(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review candidate before approval</DialogTitle>
            <DialogDescription>
              Confirm the details below. Approving assigns an Employee ID and activates access.
            </DialogDescription>
          </DialogHeader>
          {approvePreview &&
            (() => {
              const c = approvePreview;
              const roleName =
                rolesList.find((r) => r.key === c.role_key)?.name ?? c.role_key ?? "—";
              const unit = units.find((u) => u.id === c.unit_id);
              const unitLabel = unit
                ? `${unit.customer_name ? unit.customer_name + " — " : ""}${unit.name}${unit.code ? ` (${unit.code})` : ""}`
                : "—";
              const desig = designations.find((d) => d.id === c.designation_id);
              const desigLabel = desig
                ? `${desig.name}${unit && unit.is_billable === false ? " · Non-billable" : ""}`
                : "—";
              const aad = c.aadhaar_number
                ? `•••• •••• ${String(c.aadhaar_number).slice(-4)}`
                : "—";
              const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
                <div className="flex items-start justify-between gap-3 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {k}
                  </span>
                  <span className="text-right text-sm font-medium text-foreground">{v || "—"}</span>
                </div>
              );
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
                    {c.photo_url ? (
                      <img
                        src={c.photo_url}
                        alt={c.full_name ?? ""}
                        className="h-14 w-14 rounded-full object-cover ring-2 ring-border"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                        {(c.full_name ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-display text-base font-semibold text-foreground">
                        {c.full_name || "Unnamed"}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {c.employee_code || c.candidate_code || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-border/50 rounded-xl border border-border/60 px-3">
                    <Row k="Role" v={roleName} />
                    <Row k="Designation" v={desigLabel} />
                    <Row k="Client" v={unitLabel} />
                    <Row k="Mobile" v={c.mobile ?? "—"} />
                    <Row k="Email" v={c.email ?? "—"} />
                    <Row k="Aadhaar" v={aad} />
                    <Row k="DOB" v={fmtDate(c.date_of_birth)} />
                    <Row k="Joining date" v={fmtDate(c.preferred_joining_date)} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Need to change something? Cancel and open the candidate to edit, or reject with
                    a reason for the field officer.
                  </p>
                </div>
              );
            })()}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setApprovePreview(null)}
              disabled={approveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
              data-force-enabled="true"
              onClick={() => {
                const c = approvePreview;
                if (!c) return;
                setApprovePreview(null);
                setRejectTarget(c);
                setRejectReason("");
              }}
              disabled={approveMut.isPending}
            >
              <X className="mr-1 h-4 w-4" /> Reject
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              data-force-enabled="true"
              onClick={() => {
                const c = approvePreview;
                if (!c) return;
                approveMut.mutate(c, { onSuccess: () => setApprovePreview(null) });
              }}
              disabled={approveMut.isPending}
            >
              {approveMut.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1 h-4 w-4" />
              )}
              Confirm approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject candidate</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting {rejectTarget?.full_name || "this candidate"}. They
              will see this note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Rejection reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Aadhaar details could not be verified…"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Explain what needs to be corrected so the field officer can fix it (min 5 characters).
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rejectTarget) return;
                if (rejectReason.trim().length < 5) {
                  toast.error("Please enter a rejection reason (min 5 characters)");
                  return;
                }
                rejectMut.mutate({ c: rejectTarget, reason: rejectReason.trim() });
              }}
              disabled={rejectMut.isPending || rejectReason.trim().length < 5}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {rejectMut.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-1 h-4 w-4" />
              )}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDocumentDialog
        open={!!signTarget}
        onOpenChange={(o) => !o && setSignTarget(null)}
        candidateId={signTarget?.id ?? null}
        docType={signTarget?.docType ?? "nda"}
      />

      <Dialog
        open={!!siteMapTarget}
        onOpenChange={(o) => {
          if (!o) {
            setSiteMapTarget(null);
            setSiteMapSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Site map — {siteMapTarget?.full_name || siteMapTarget?.employee_code}
            </DialogTitle>
            <DialogDescription>
              {siteCountOf(siteMapTarget?.id ?? "")} client sites covered. Base unit:{" "}
              {siteMapTarget ? unitOfCandidate(siteMapTarget)?.name || "—" : "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={siteMapSearch}
              onChange={(e) => setSiteMapSearch(e.target.value)}
              placeholder="Search client, site or site code"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <div className="max-h-[55vh] overflow-y-auto rounded-xl border">
            {siteMapRows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No sites match this search.
              </div>
            ) : (
              <ul className="divide-y">
                {siteMapRows.map((u) => (
                  <li key={u.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{u.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u.customer_name || "—"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {u.code}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <EmployeeDocumentsExportDialog
        open={docsExportOpen}
        onOpenChange={setDocsExportOpen}
        people={candidates
          .filter((c) =>
            tab === "employee"
              ? isEmployeeStatus(c.status) && !supersededEmployeeIds.has(c.id)
              : !isEmployeeStatus(c.status),
          )
          .filter((c) => (isFieldOfficer ? !!c.unit_id && scopedUnitIdSet.has(c.unit_id) : true))
          .map((c) => ({
            id: c.id,
            full_name: c.full_name,
            employee_code: c.employee_code,
            candidate_code: c.candidate_code,
            mobile: c.mobile,
            role_key: c.role_key,
            designation_id: c.designation_id,
            unit_id: c.unit_id,
            reports_to: c.reports_to,
            status: c.status,
            is_enabled: c.is_enabled,
          }))}
        roles={rolesList.map((r) => ({ value: r.key, label: r.name }))}
        designations={designations.map((d) => ({ value: d.id, label: d.name }))}
        organizations={customers.map((c) => ({ value: c.id, label: c.name }))}
        units={units.map((u) => ({
          value: u.id,
          label: `${u.code} — ${u.name}`,
          customerId: u.customer_id,
        }))}
        managers={candidates
          .filter((c) => candidates.some((x) => x.reports_to === c.id))
          .map((c) => ({
            value: c.id,
            label: `${c.full_name ?? "—"}${c.employee_code ? ` · ${c.employee_code}` : ""}`,
          }))}
        organizationOfUnit={(unitId) => (unitId ? (unitMap.get(unitId)?.customer_id ?? "") : "")}
        labelFor={(p) => ({
          role: roleNameOf(p.role_key),
          designation: desigName(p.designation_id),
          organization: customerNameOfUnit(p.unit_id),
          unit: unitLabel(p.unit_id),
          manager: managerName(p.reports_to),
        })}
        onExported={(count) => {
          void logActivity({
            module: "Employees",
            action: "export",
            entityType: "candidate",
            entityLabel: `${count} employee document pack (PDF)`,
          });
        }}
      />

      <ScopeAddDialog
        target={scopeTarget}
        onClose={() => setScopeTarget(null)}
        customers={customers}
        branches={branches}
        states={states}
        units={units}
        existing={scopeTarget ? (scopeByCandidate.get(scopeTarget.id) ?? []) : []}
        onAdd={(payload) => {
          if (!scopeTarget) return;
          addScopeMut.mutate({ candidate: scopeTarget, ...payload });
        }}
      />
    </div>
  );
}

function ManagerTree({
  employees,
  fieldOfficers,
  scopeByCandidate,
  unitMap,
}: {
  employees: CandidateListItem[];
  fieldOfficers: CandidateListItem[];
  scopeByCandidate: Map<string, ScopeAssignment[]>;
  unitMap: Map<string, UnitLite>;
}) {
  const guards = employees.filter((e) => e.role_key === "guard");
  const others = employees.filter((e) => e.role_key !== "guard" && e.role_key !== "field_officer");
  const guardsByMgr = new Map<string, CandidateListItem[]>();
  const unassigned: CandidateListItem[] = [];
  for (const g of guards) {
    if (g.reports_to) {
      if (!guardsByMgr.has(g.reports_to)) guardsByMgr.set(g.reports_to, []);
      guardsByMgr.get(g.reports_to)!.push(g);
    } else unassigned.push(g);
  }
  return (
    <div className="space-y-4">
      {fieldOfficers.length === 0 && (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          No field officers yet. Assign the Field Officer role to an employee to build the tree.
        </div>
      )}
      {fieldOfficers.map((fm) => {
        const team = guardsByMgr.get(fm.id) ?? [];
        const scopes = scopeByCandidate.get(fm.id) ?? [];
        return (
          <div key={fm.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Network className="h-4 w-4 text-sky-600" />
              <div className="flex-1">
                <div className="font-semibold">
                  {fm.full_name}{" "}
                  <span className="ml-1 text-xs font-mono text-muted-foreground">
                    {fm.employee_code}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {scopes.length === 0 && (
                    <span className="text-xs text-muted-foreground">No scope assigned</span>
                  )}
                  {scopes.map((s) => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">
                      {SCOPE_TYPE_LABEL[s.scope_type]}: {s.scope_label}
                    </Badge>
                  ))}
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {team.length} guard{team.length === 1 ? "" : "s"}
              </Badge>
            </div>
            {team.length > 0 && (
              <div className="mt-3 space-y-1.5 border-l-2 border-sky-200 pl-4">
                {team.map((g) => {
                  const u = g.unit_id ? unitMap.get(g.unit_id) : undefined;
                  return (
                    <div key={g.id} className="flex items-center gap-2 text-sm">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {g.employee_code}
                      </span>
                      <span className="font-medium">{g.full_name}</span>
                      {u && <span className="text-xs text-muted-foreground">· {u.name}</span>}
                      {!g.is_enabled && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          Disabled
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/60 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unassigned guards ({unassigned.length})
          </div>
          {unassigned.map((g) => (
            <div key={g.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[10px] text-muted-foreground">{g.employee_code}</span>
              <span>{g.full_name}</span>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {others.length} other employee{others.length === 1 ? "" : "s"} not shown in the manager
          tree.
        </div>
      )}
    </div>
  );
}

function ScopeAddDialog({
  target,
  onClose,
  customers,
  branches,
  states,
  units,
  existing,
  onAdd,
}: {
  target: CandidateListItem | null;
  onClose: () => void;
  customers: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; code: string }>;
  states: Array<{ id: string; name: string }>;
  units: UnitLite[];
  existing: ScopeAssignment[];
  onAdd: (payload: { scope_type: ScopeType; scope_id: string; scope_label: string }) => void;
}) {
  const [scopeType, setScopeType] = useState<ScopeType>("unit");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (target) {
      setScopeType("unit");
      setSelectedIds(new Set());
      setSearch("");
    }
  }, [target]);
  useEffect(() => {
    setSelectedIds(new Set());
    setSearch("");
  }, [scopeType]);
  const allOptions: Array<{ id: string; label: string }> = useMemo(() => {
    if (scopeType === "unit")
      return units.map((u) => ({
        id: u.id,
        label: `${u.name}${u.customer_name ? " · " + u.customer_name : ""}`,
      }));
    if (scopeType === "customer") return customers.map((c) => ({ id: c.id, label: c.name }));
    if (scopeType === "branch") return branches.map((b) => ({ id: b.id, label: b.code }));
    return states.map((s) => ({ id: s.name, label: s.name }));
  }, [scopeType, units, customers, branches, states]);
  const existingIds = useMemo(
    () => new Set(existing.filter((e) => e.scope_type === scopeType).map((e) => e.scope_id)),
    [existing, scopeType],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [allOptions, search]);
  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectableFiltered = filtered.filter((o) => !existingIds.has(o.id));
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((o) => selectedIds.has(o.id));
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) selectableFiltered.forEach((o) => next.delete(o.id));
      else selectableFiltered.forEach((o) => next.add(o.id));
      return next;
    });
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map scope · {target?.full_name}</DialogTitle>
          <DialogDescription>
            Pick a scope type, then select one or more entries. Guards in the chosen scope get
            linked automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 sm:grid-cols-4">
            {(["state", "customer", "branch", "unit"] as ScopeType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setScopeType(t)}
                className={cn(
                  "min-h-9 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                  scopeType === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {SCOPE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${SCOPE_TYPE_LABEL[scopeType].toLowerCase()}…`}
              className="h-9 pl-8"
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {selectedIds.size} selected · {selectableFiltered.length} available
            </span>
            <button
              type="button"
              onClick={toggleAll}
              disabled={selectableFiltered.length === 0}
              className="text-primary hover:underline disabled:opacity-40"
            >
              {allFilteredSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
            {filtered.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No {SCOPE_TYPE_LABEL[scopeType].toLowerCase()} found.
              </div>
            )}
            {filtered.map((o) => {
              const already = existingIds.has(o.id);
              const checked = selectedIds.has(o.id);
              return (
                <label
                  key={o.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm transition",
                    already
                      ? "bg-muted/40 cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:bg-muted/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    disabled={already}
                    checked={already || checked}
                    onChange={() => !already && toggleId(o.id)}
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {already && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      Mapped
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={async () => {
              const picks = Array.from(selectedIds)
                .map((id) => allOptions.find((o) => o.id === id))
                .filter((o): o is { id: string; label: string } => !!o);
              if (picks.length === 0) return;
              const ok = await confirmAction({
                title: `Map ${picks.length} ${SCOPE_TYPE_LABEL[scopeType].toLowerCase()}${picks.length === 1 ? "" : "s"}?`,
                description: `Assign ${picks.map((p) => `"${p.label}"`).join(", ")} to ${target?.full_name}.`,
                confirmText: "Map",
              });
              if (!ok) return;
              for (const p of picks) {
                onAdd({ scope_type: scopeType, scope_id: p.id, scope_label: p.label });
              }
              onClose();
            }}
          >
            Map {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-500/15 text-slate-600",
    approved: "bg-emerald-500/15 text-emerald-600",
    active: "bg-emerald-500/15 text-emerald-600",
    inactive: "bg-slate-500/15 text-slate-600",
    pending: "bg-amber-500/15 text-amber-600",
    rejected: "bg-rose-500/15 text-rose-600",
  };
  const label = status === "approved" ? "active" : status;
  return (
    <Badge
      className={cn(
        "inline-flex shrink-0 border-0 font-semibold capitalize whitespace-nowrap",
        map[status] ?? "bg-secondary text-foreground",
      )}
    >
      {label}
    </Badge>
  );
}

function maskAadhaar(n: string) {
  const d = (n ?? "").replace(/\D/g, "");
  if (d.length < 4) return d || "—";
  return `XXXX XXXX ${d.slice(-4)}`;
}

// ---------------- Wizard ---------------- //
type WizardStep = "aadhaar" | "otp" | "form";

type CandidateForm = Omit<Candidate, "id"> & {
  /** Application role (role key from public.roles). Mandatory for non-billable employees. */
  role_key?: string | null;
  /** All units assigned to this candidate. First entry is the primary unit (mirrored to candidates.unit_id). */
  unit_ids: string[];
  /** Contracted designation the person fills at each unit (unit_id -> designation_id). */
  unit_designations?: Record<string, string | null>;
  /** Primary reporting manager (mirrored to candidates.reports_to). */
  reports_to?: string | null;
};

function emptyForm(): CandidateForm {
  return {
    candidate_code: "",
    employee_code: "",
    rejection_reason: "",
    aadhaar_number: "",
    full_name: "",
    photo_url: "",
    aadhaar_image_url: "",
    signature_url: "",
    date_of_birth: null,
    gender: "",
    religion: "",
    caste_category: "",
    marital_status: "",
    birthplace: "",
    mobile: "",
    alt_mobile: "",
    email: "",
    permanent_address1: "",
    permanent_address2: "",
    permanent_landmark: "",
    permanent_pincode: "",
    permanent_city: "",
    permanent_district: "",
    permanent_state: "",
    permanent_country: "India",
    permanent_police_station: "",
    present_address1: "",
    present_address2: "",
    present_landmark: "",
    present_pincode: "",
    present_city: "",
    present_district: "",
    present_state: "",
    present_country: "India",
    present_police_station: "",
    same_as_permanent: true,
    pan_number: "",
    pan_image_url: "",
    bank_account_holder: "",
    bank_account_number: "",
    bank_ifsc: "",
    bank_name: "",
    bank_branch: "",
    bank_account_type: "",
    emergency_contact_name: "",
    emergency_contact_relation: "",
    emergency_contact_mobile: "",
    contacts: [],
    references: [],
    is_ex_service: false,
    ex_service_id: null,
    languages: [],
    experiences: [],
    educations: [],
    application_date: new Date().toISOString().slice(0, 10),
    preferred_joining_date: null,
    unit_id: null,
    unit_ids: [],
    unit_designations: {},

    designation_id: null,
    department_id: null,
    status: "pending",
    physical_health: {},
    compliance: {},
    identification_proofs: [],
    criminal_history: { has_history: false, incidents: [] },
    extra_curricular: [],
    other_info: {},
    documents: [],
    nominations: [],
    kyc_completed: false,
    assigned_asset_ids: [],
    no_hire: false,
    offboarding_details: {},
    role_key: "",
  };
}

const RADIANT_PUNE_HOME_UNIT_CODE = "UN1";
/** Non-billable staff are currently posted to Radiant's Pune head office. */
const isRadiantHomeUnit = (u: UnitLite) =>
  (u.code ?? "").trim().toUpperCase() === RADIANT_PUNE_HOME_UNIT_CODE;

const pickDefaultHomeUnit = (options: UnitLite[]) =>
  options.find((u) => (u.code ?? "").trim().toUpperCase() === RADIANT_PUNE_HOME_UNIT_CODE)?.id ??
  options[0]?.id ??
  "";

function CandidateWizard({
  open,
  onOpenChange,
  editing,
  mode = "candidate",
  units,
  unitsLoading,
  unitsError,
  designations,
  designationsLoading,
  designationsError,
  exServices,
  languagesList,
  esicBranches,
  offboardReasons = [],
  assets = [],
  canReview = false,
  isApproving = false,
  onApprove,
  onReject,
  onRequestOffboard,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Candidate | null;
  mode?: "candidate" | "employee";
  units: UnitLite[];
  unitsLoading: boolean;
  unitsError: string | null;
  designations: DesignationLite[];
  designationsLoading: boolean;
  designationsError: string | null;
  exServices: ExServiceLite[];
  languagesList: LanguageLite[];
  esicBranches: EsicBranchLite[];
  offboardReasons?: { id: string; name: string }[];
  assets?: { id: string; name: string; category: string; available_qty?: number }[];
  canReview?: boolean;
  isApproving?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onRequestOffboard?: () => void;
}) {
  const isEmployeeMode = mode === "employee";
  const qc = useQueryClient();
  const rolesQuery = useRolesLite();
  const rolesList = rolesQuery.data ?? [];
  const { branches } = useBranches();
  const [form, setForm] = useState<CandidateForm>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState<{ title: string; detail?: string } | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [digilockerVerified, setDigilockerVerified] = useState(false);
  // Platform switch — when OFF, Aadhaar/PAN/bank are captured manually and nothing is verified.
  const { enabled: verificationEnabled } = useEmployeeVerificationEnabled();
  const [panVerified, setPanVerified] = useState(false);
  const [bankVerified, setBankVerified] = useState(false);
  const checkSavedDigilockerVerification = useServerFn(hasCompletedDigilockerVerification);
  const [uploading, setUploading] = useState<string | null>(null);
  // Aadhaar is the unique person key — a hit here means this person already
  // exists and must go through the configurable rehire approval chain.
  const [aadhaarChecking, setAadhaarChecking] = useState(false);
  const [rehireOpen, setRehireOpen] = useState(false);
  const [rehireMatch, setRehireMatch] = useState<ExistingCandidateMatch | null>(null);
  const lastAadhaarLookupRef = useRef("");
  const checkAadhaarForRehire = async (value: string) => {
    const clean = (value ?? "").replace(/\D/g, "");
    if (clean.length !== 12) return;
    if (editing && (editing as any).aadhaar_number === clean) return;
    if (lastAadhaarLookupRef.current === clean) return;
    lastAadhaarLookupRef.current = clean;
    setAadhaarChecking(true);
    try {
      const found = await findCandidateByAadhaar(clean);
      if (!found || (editing && found.id === editing.id)) {
        setRehireMatch(null);
        return;
      }
      setRehireMatch(found as ExistingCandidateMatch);
      setRehireOpen(true);
    } catch (e) {
      console.error("aadhaar duplicate check failed", e);
      lastAadhaarLookupRef.current = "";
      toast.error("Could not check Aadhaar against existing records. Please retry.");
    } finally {
      setAadhaarChecking(false);
    }
  };

  const [initialUnitIds, setInitialUnitIds] = useState<string[]>([]);
  // Non-billable employees: payroll home unit is the Radiant office (auto-set);
  // operational mappings (any client unit / organization) are stored separately.
  const [homeUnitId, setHomeUnitId] = useState<string>("");
  const [operationalMappings, setOperationalMappings] = useState<OperationalMapping[]>([]);
  const { customers: wizardCustomersRaw } = useCustomers();
  const wizardCustomers = useMemo(
    () => wizardCustomersRaw.map((c) => ({ id: c.id, name: c.name })),
    [wizardCustomersRaw],
  );
  // Fast, dedicated query for non-billable home units — independent of the
  // heavy all-units list so this dropdown always works.
  const homeUnitsQuery = useHomeUnits();
  const nonBillableUnits = useMemo(() => {
    const rows = homeUnitsQuery.data ?? [];
    return rows
      .filter((u) => isRadiantHomeUnit(u) || u.is_billable === false)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [homeUnitsQuery.data]);
  const homeUnitsLoading = homeUnitsQuery.isLoading;
  const homeUnitsError =
    homeUnitsQuery.error instanceof Error ? homeUnitsQuery.error.message : null;
  // Keep the selection valid as units load / change.
  useEffect(() => {
    if (!isEmployeeMode) return;
    if (nonBillableUnits.length === 0) return;
    if (!nonBillableUnits.some((u) => u.id === homeUnitId)) {
      setHomeUnitId(pickDefaultHomeUnit(nonBillableUnits));
    }
  }, [isEmployeeMode, nonBillableUnits, homeUnitId]);

  // Home Unit is the actual unit assignment for an internal employee. Keep
  // the shared assignment model in sync so validation, candidate_units,
  // wages, and the employee list all persist/read the same unit.
  useEffect(() => {
    if (!isEmployeeMode || !homeUnitId) return;
    setForm((current) => {
      if (
        current.unit_ids.length === 1 &&
        current.unit_ids[0] === homeUnitId &&
        current.unit_id === homeUnitId
      ) {
        return current;
      }
      return { ...current, unit_id: homeUnitId, unit_ids: [homeUnitId] };
    });
  }, [isEmployeeMode, homeUnitId]);
  const isEditingEmployeeProfile =
    !!editing &&
    (editing.status === "approved" || editing.status === "active" || editing.status === "inactive");

  useEffect(() => {
    if (!open) return;
    setSaveError(null);
    lastAadhaarLookupRef.current = "";
    setRehireMatch(null);
    setRehireOpen(false);
    if (editing) {
      const { id: _id, ...rest } = editing;
      void _id;
      const restAny = rest as unknown as Partial<CandidateForm> & { contacts?: CandidateContact[] };
      const existing = Array.isArray(restAny.contacts) ? restAny.contacts : [];
      let contacts = existing;
      if (contacts.length === 0 && (rest.emergency_contact_name || rest.emergency_contact_mobile)) {
        contacts = [
          {
            name: rest.emergency_contact_name || "",
            relation: rest.emergency_contact_relation || "",
            mobile: rest.emergency_contact_mobile || "",
            is_emergency: true,
          },
        ];
      }
      // Optimistically seed with the single mirrored unit_id so the picker isn't empty during fetch.
      const initialUnitIds = rest.unit_id ? [rest.unit_id] : [];
      const normalizedStatus = rest.status === "approved" ? "active" : rest.status;
      const savedVerification = (rest.other_info ?? {}) as Record<string, unknown>;
      const savedVerifiedAadhaar = String(
        savedVerification.digilocker_verified_aadhaar ?? "",
      ).replace(/\D/g, "");
      const savedVerifiedPan = String(savedVerification.pan_verified_number ?? "")
        .trim()
        .toUpperCase();
      setPanVerified(
        savedVerification.pan_verified === true &&
          savedVerifiedPan.length === 10 &&
          savedVerifiedPan ===
            String(rest.pan_number ?? "")
              .trim()
              .toUpperCase(),
      );
      setDigilockerVerified(
        savedVerification.digilocker_verified === true &&
          savedVerifiedAadhaar.length === 12 &&
          savedVerifiedAadhaar === String(rest.aadhaar_number ?? "").replace(/\D/g, ""),
      );
      const currentAadhaar = String(rest.aadhaar_number ?? "").replace(/\D/g, "");
      if (currentAadhaar.length === 12 && savedVerification.digilocker_verified !== true) {
        void checkSavedDigilockerVerification({ data: { aadhaar: currentAadhaar } })
          .then((verified) => {
            if (!verified) return;
            setDigilockerVerified(true);
            setForm((current) => ({
              ...current,
              other_info: {
                ...(current.other_info ?? {}),
                digilocker_verified: true,
                digilocker_verified_aadhaar: currentAadhaar,
              },
            }));
          })
          .catch((error: unknown) =>
            console.error("DigiLocker verification restore failed", error),
          );
      }
      if (isEmployeeMode && rest.unit_id) setHomeUnitId(rest.unit_id);
      setInitialUnitIds(initialUnitIds);
      setForm({
        ...(rest as CandidateForm),
        status: normalizedStatus,
        contacts,
        unit_ids: initialUnitIds,
        unit_designations:
          rest.unit_id && rest.designation_id ? { [rest.unit_id]: rest.designation_id } : {},
      });
      // openEditor already fetches the latest production row before opening.
      // Do not start a second late fetch here: it can arrive after the user has
      // changed a field and silently overwrite that unsaved selection.
      // Load full multi-unit assignment from junction table.
      (async () => {
        const { data, error } = await supabase
          .from("candidate_units" as never)
          .select("unit_id,is_primary,sort_order,designation_id")
          .eq("candidate_id", editing.id)
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true });
        if (error) return;
        const rows = (data ?? []) as {
          unit_id: string;
          is_primary: boolean;
          sort_order: number;
          designation_id: string | null;
        }[];
        if (rows.length === 0) return;
        const ids = rows.map((r) => r.unit_id);
        const desig: Record<string, string | null> = {};
        for (const r of rows) desig[r.unit_id] = r.designation_id ?? null;
        setInitialUnitIds(ids);
        if (isEmployeeMode && ids[0]) setHomeUnitId(ids[0]);
        setForm((f) => ({
          ...f,
          unit_ids: ids,
          unit_id: ids[0] ?? null,
          unit_designations: { ...(f.unit_designations ?? {}), ...desig },
        }));
      })();
    } else {
      setInitialUnitIds([]);
      setForm(emptyForm());
      setDigilockerVerified(false);
      setOperationalMappings([]);
      setHomeUnitId(pickDefaultHomeUnit(nonBillableUnits));
    }
  }, [open, editing, isEmployeeMode]);

  // Load existing operational mappings (employee_scope_assignments · unit/customer)
  // for edit mode. The payroll home unit itself (candidates.unit_id) is excluded —
  // it is a posting, not an operational mapping.
  useEffect(() => {
    if (!open || !editing || !isEmployeeMode) return;
    (async () => {
      const { data, error } = await supabase
        .from("employee_scope_assignments" as never)
        .select("scope_type,scope_id,scope_label")
        .eq("candidate_id", editing.id)
        .in("scope_type", ["unit", "customer"]);
      if (error || !data) return;
      const homeId = editing.unit_id;
      setOperationalMappings(
        (data as Array<{ scope_type: string; scope_id: string; scope_label: string | null }>)
          .filter((r) => r.scope_id && r.scope_id !== homeId)
          .map((r) => ({
            scope_type: r.scope_type === "customer" ? "customer" : "unit",
            scope_id: r.scope_id,
            scope_label: r.scope_label ?? "",
          })),
      );
    })();
  }, [open, editing, isEmployeeMode]);

  // Tracks whether the person actually edited something in this session, so the
  // close prompt only appears when there is real unsaved work.
  const dirtyRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
  };
  const set = <K extends keyof CandidateForm>(k: K, v: CandidateForm[K]) => {
    markDirty();
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setAny = (k: string, v: any) => {
    markDirty();
    setForm((f) => ({ ...f, [k]: v }) as CandidateForm);
  };
  const setSection = (k: string, v: any) => {
    markDirty();
    setForm((f) => ({ ...f, [k]: { ...((f as any)[k] ?? {}), ...v } }) as CandidateForm);
  };

  const primaryUnitId = form.unit_ids[0] ?? null;
  const unit = primaryUnitId ? units.find((u) => u.id === primaryUnitId) : undefined;

  // Contract designations remain identified for guidance, but every enabled
  // designation is selectable so urgent deployment never waits for billing.
  const desigLookupUnitIds = useMemo(() => {
    const ids = new Set(form.unit_ids);
    if (isEmployeeMode && homeUnitId) ids.add(homeUnitId);
    return Array.from(ids);
  }, [form.unit_ids, isEmployeeMode, homeUnitId]);
  const selectedUnitIdsKey = desigLookupUnitIds.slice().sort().join(",");
  const contractDesigQuery = useQuery({
    queryKey: ["wizard-contract-designations", selectedUnitIdsKey],
    enabled: desigLookupUnitIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      const { data: contracts, error: cErr } = await supabase
        .from("client_contracts" as never)
        // Expired / inactive contracts still define the valid designations for a
        // unit: deployment may continue while a fresh contract is being drawn up.
        .select("id,unit_id,status")
        .in("unit_id", desigLookupUnitIds);
      if (cErr) throw cErr;
      const contractIds = ((contracts ?? []) as { id: string }[]).map((c) => c.id);
      if (contractIds.length === 0) return [];
      const { data: res, error: rErr } = await supabase
        .from("contract_resources" as never)
        .select("designation_id")
        .in("contract_id", contractIds);
      if (rErr) throw rErr;
      const ids = Array.from(
        new Set(
          ((res ?? []) as { designation_id: string | null }[])
            .map((r) => r.designation_id)
            .filter((x): x is string => !!x),
        ),
      );
      return ids;
    },
  });
  const allowedDesignationIds = contractDesigQuery.data ?? [];
  const filteredDesignations = useMemo(() => {
    let base = designations;
    // Non-billable employees are NOT deployed against a client contract, so
    // their designation comes straight from the Designation master.
    if (isEmployeeMode) {
      // The designation master owns billable/non-billable classification.
      // Internal onboarding must never offer a client-billable designation.
      return base.filter((designation) => !designation.billable);
    }
    if (desigLookupUnitIds.length === 0 || contractDesigQuery.isLoading) return base;
    const allow = new Set(allowedDesignationIds);
    return [...base].sort(
      (a, b) => Number(allow.has(b.id)) - Number(allow.has(a.id)) || a.name.localeCompare(b.name),
    );
  }, [
    designations,
    desigLookupUnitIds.length,
    contractDesigQuery.isLoading,
    allowedDesignationIds,
    isEmployeeMode,
  ]);

  // ----- Non-billable: departments + per-employee wage sheet ----- //
  const departmentsQuery = useQuery({
    queryKey: ["wizard-departments"],
    enabled: isEmployeeMode,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments" as never)
        .select("id,name,enabled")
        .eq("enabled", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; name: string }>;
    },
  });
  const departments = departmentsQuery.data ?? [];

  /**
   * Wage sheets, keyed by unit id (non-billable employees use their home unit).
   * A person mapped to several units gets one wage sheet per unit.
   */
  const [wagesByUnit, setWagesByUnit] = useState<Record<string, ContractResource | null>>({});
  const [activeWageUnit, setActiveWageUnit] = useState<string>("");

  /** Units the Wages section renders a sheet for. */
  const wageUnitIds = useMemo(() => {
    return form.unit_ids.filter(Boolean);
  }, [form.unit_ids]);

  useEffect(() => {
    if (wageUnitIds.length === 0) {
      setActiveWageUnit("");
      return;
    }
    setActiveWageUnit((u) => (u && wageUnitIds.includes(u) ? u : wageUnitIds[0]));
  }, [wageUnitIds]);

  useEffect(() => {
    let cancelled = false;
    const cid = editing?.id;
    if (!cid) {
      setWagesByUnit({});
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("employee_wages" as never)
        .select(
          "id,unit_id,shift_hours,payroll_day_base_id,components,benefits,deductions,employer_contributions",
        )
        .eq("candidate_id", cid);
      if (cancelled) return;
      const next: Record<string, ContractResource | null> = {};
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        // Older wage rows could have a null unit_id. Attach those to the
        // employee's persisted unit so the saved sheet remains visible.
        const key = (row.unit_id as string | null) ?? editing.unit_id ?? homeUnitId;
        if (!key) continue;
        next[key] = {
          designationId: "",
          roleKey: null,
          serviceTypeId: "",
          quantity: 1,
          shiftHours: Number(row.shift_hours) === 12 ? 12 : 8,
          payrollDayBaseId: (row.payroll_day_base_id as string) ?? null,
          components: (row.components as ContractResource["components"]) ?? [],
          benefits: (row.benefits as ContractResource["benefits"]) ?? [],
          deductions: (row.deductions as ContractResource["deductions"]) ?? [],
          employerContributions:
            (row.employer_contributions as ContractResource["employerContributions"]) ?? [],
        } as ContractResource;
      }
      setWagesByUnit(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [editing?.id, editing?.unit_id, homeUnitId]);

  const activeWage = activeWageUnit ? (wagesByUnit[activeWageUnit] ?? null) : null;
  const setActiveWage = (next: ContractResource | null) =>
    setWagesByUnit((m) => ({ ...m, [activeWageUnit]: next }));

  /** Persist one wage sheet per mapped unit. */
  const syncEmployeeWages = async (candidateId: string) => {
    const rows = wageUnitIds
      .map((unitId) => {
        const w = wagesByUnit[unitId];
        if (!w) return null;
        return {
          candidate_id: candidateId,
          unit_id: unitId,
          designation_id: (form.unit_designations ?? {})[unitId] ?? form.designation_id,
          department_id: form.department_id,
          shift_hours: w.shiftHours,
          payroll_day_base_id: w.payrollDayBaseId ?? null,
          components: w.components ?? [],
          benefits: w.benefits ?? [],
          deductions: w.deductions ?? [],
          employer_contributions: w.employerContributions ?? [],
          gross: (w.components ?? []).reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
        };
      })
      .filter(Boolean);
    // Do not rely on PostgREST's ON CONFLICT schema cache. Some deployed
    // databases were still serving the earlier constraint metadata, causing
    // a valid wage sheet to abort the whole employee save. Resolve each row
    // explicitly and update/insert by its primary key instead.
    const { data: savedRows, error: savedRowsError } = await supabase
      .from("employee_wages" as never)
      .select("id,unit_id")
      .eq("candidate_id", candidateId);
    if (savedRowsError) throw new Error(`Wage sheet save failed: ${savedRowsError.message}`);
    const existingRows = (savedRows ?? []) as Array<{ id: string; unit_id: string | null }>;
    for (const row of rows) {
      if (!row) continue;
      const existing =
        existingRows.find((saved) => saved.unit_id === row.unit_id) ??
        (existingRows.length === 1 && existingRows[0].unit_id === null
          ? existingRows[0]
          : undefined);
      if (existing) {
        const { error } = await supabase
          .from("employee_wages" as never)
          .update(row as never)
          .eq("id", existing.id);
        if (error) throw new Error(`Wage sheet save failed: ${error.message}`);
      } else {
        const { error } = await supabase.from("employee_wages" as never).insert(row as never);
        if (error) throw new Error(`Wage sheet save failed: ${error.message}`);
      }
    }

    // Remove sheets explicitly crossed out and sheets for units no longer
    // assigned to the person.
    const retainedUnits = new Set(rows.map((row) => row?.unit_id).filter(Boolean));
    const staleIds = existingRows
      .filter((row) => !row.unit_id || !retainedUnits.has(row.unit_id))
      .filter(
        (row) => !rows.some((saved) => saved && existingRows.length === 1 && row.unit_id === null),
      )
      .map((row) => row.id);
    if (staleIds.length > 0) {
      const { error: cleanupError } = await supabase
        .from("employee_wages" as never)
        .delete()
        .in("id", staleIds);
      if (cleanupError) throw new Error(`Wage sheet cleanup failed: ${cleanupError.message}`);
    }
  };

  // ----- File upload helper ----- //
  const uploadFile = async (
    file: File,
    slot: "photo" | "signature" | "aadhaar" | "pan",
  ): Promise<string> => {
    const { blob, ext, contentType } = await prepareUpload(file);
    const path = `${slot}/${form.aadhaar_number || "NEW"}-${Date.now()}.${ext}`;
    await withUploadRetry(async () => {
      const { error } = await supabase.storage
        .from("candidate-files")
        .upload(path, blob, { upsert: true, contentType });
      if (error) throw error;
    });
    // Bucket is private — generate a long-lived signed URL (≈10 years)
    const { data: signed, error: signErr } = await withUploadRetry(() =>
      supabase.storage.from("candidate-files").createSignedUrl(path, 60 * 60 * 24 * 365 * 10),
    );
    if (signErr) throw signErr;
    return signed.signedUrl;
  };

  const handleFile = async (file: File | null, slot: "photo" | "signature" | "aadhaar" | "pan") => {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (slot === "photo" && !isImage) {
      toast.error("Photograph must be an image");
      return;
    }
    if ((slot === "aadhaar" || slot === "signature" || slot === "pan") && !isImage && !isPdf) {
      toast.error("Only image or PDF files are allowed");
      return;
    }
    setUploading(slot);
    try {
      const url = await uploadFile(file, slot);
      if (slot === "photo") set("photo_url", url);
      else if (slot === "signature") set("signature_url", url);
      else if (slot === "pan") set("pan_image_url", url);
      else set("aadhaar_image_url", url);
      toast.success(`${slot[0].toUpperCase() + slot.slice(1)} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const getEmergencyContactIssue = (): string | null => {
    const contact = form.contacts.find((item) => item.is_emergency);
    if (!contact) return null;
    if (!contact?.name.trim()) return "Enter the contact's name";
    if (!contact.relation.trim()) return "Select the relationship";
    if (!/^\d{10}$/.test(contact.mobile.trim())) return "Enter a valid 10-digit mobile number";
    if (!contact.dob) return "Select the contact's date of birth";
    const birthDate = new Date(contact.dob);
    if (!Number.isFinite(birthDate.getTime()) || birthDate > new Date())
      return "Select a valid date of birth";
    if (!(contact.address ?? "").trim()) return "Enter the contact's address";
    const age = Math.floor((Date.now() - birthDate.getTime()) / 31557600000);
    if (age < 18) {
      if (!(contact.guardian_name ?? "").trim()) return "Enter the guardian's name";
      if (!/^\d{10}$/.test((contact.guardian_mobile ?? "").trim()))
        return "Enter the guardian's valid mobile number";
      if (!(contact.guardian_address ?? "").trim()) return "Enter the guardian's address";
    }
    return null;
  };

  const getNomineeIssue = (): string | null => {
    const nominees = Array.isArray(
      (form.compliance as Record<string, unknown> | undefined)?.nominees,
    )
      ? ((form.compliance as Record<string, unknown>).nominees as Array<{
          contact?: string;
          percent?: number;
        }>)
      : [];
    if (nominees.length === 0) return "Add at least one nominee";
    if (nominees.some((entry) => !String(entry.contact ?? "").trim()))
      return "Select a contact for every nominee";
    const contactsByKey = new Map(
      form.contacts.map((contact, index) => {
        const name = contact.name.trim();
        const mobile = contact.mobile.trim();
        return [`${name}|${mobile}` || `idx:${index}`, contact] as const;
      }),
    );
    for (const nominee of nominees) {
      const contact = contactsByKey.get(String(nominee.contact ?? ""));
      if (
        !contact?.name.trim() ||
        !contact.relation.trim() ||
        !/^\d{10}$/.test(contact.mobile.trim())
      )
        return "Complete the nominee's name, relationship and 10-digit mobile number";
    }
    const total = nominees.reduce((sum, entry) => sum + (Number(entry.percent) || 0), 0);
    if (total !== 100) return "Nominee shares must total 100%";
    return null;
  };

  // ----- Profile completion meter ----- //
  const completionChecks: Array<{ key: string; ok: boolean }> = [
    { key: "Photograph", ok: !!form.photo_url },
    { key: "Aadhaar verified / uploaded", ok: digilockerVerified || !!form.aadhaar_image_url },
    { key: "PAN upload", ok: !!form.pan_image_url },
    { key: "Signature", ok: !!form.signature_url },
    { key: "Full name", ok: !!form.full_name.trim() },
    { key: "Mobile", ok: /^\d{10}$/.test(form.mobile.trim()) },
    { key: "Aadhaar number", ok: digilockerVerified || /^\d{12}$/.test(form.aadhaar_number) },
    { key: "Date of birth", ok: !!form.date_of_birth },
    { key: "Gender", ok: !!form.gender },
    {
      key: "Blood group",
      ok: !!String(
        ((form.physical_health ?? {}) as Record<string, unknown>).blood_group ?? "",
      ).trim(),
    },

    { key: "Permanent address", ok: !!form.permanent_address1.trim() && !!form.permanent_pincode },
    {
      key: "District",
      ok:
        !!form.permanent_district.trim() &&
        (form.same_as_permanent || !!form.present_district.trim()),
    },
    {
      key: "UAN declaration",
      ok:
        ((form.compliance ?? {}) as Record<string, unknown>).has_uan === false ||
        /^1\d{11}$/.test(
          String(((form.compliance ?? {}) as Record<string, unknown>).uan ?? "").trim(),
        ),
    },
    {
      key: "Nominee",
      ok: getNomineeIssue() === null,
    },

    { key: "Bank account", ok: !!form.bank_account_number.trim() && !!form.bank_ifsc.trim() },
    {
      key: "PAN number",
      ok: /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((form.pan_number || "").trim().toUpperCase()),
    },
    {
      key: "PAN verified",
      ok:
        panVerified ||
        (!verificationEnabled &&
          /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((form.pan_number || "").trim().toUpperCase())),
    },
    { key: "Client assignment", ok: form.unit_ids.length > 0 },
    { key: "Designation", ok: !!(form.designation_id ?? editing?.designation_id) },
  ];
  const completionDone = completionChecks.filter((c) => c.ok).length;
  const completionTotal = completionChecks.length;
  const completionPct = Math.round((completionDone / completionTotal) * 100);
  const profileComplete = completionDone === completionTotal;

  const uploadsComplete =
    !!form.photo_url && !!form.aadhaar_image_url && !!form.signature_url && !!form.pan_image_url;

  // ----- Build payload helper ----- //
  const buildPayload = (status: string) => {
    const emergencyContact = form.contacts.find((c) => c.is_emergency) ?? null;
    // Strip form-only assignment fields. Per-unit designations are persisted in
    // candidate_units, never on candidates (there is no unit_designations column).
    const {
      unit_ids,
      unit_designations: _unitDesignations,
      candidate_code: _candidateCode,
      ...rest
    } = form;
    void _unitDesignations;
    void _candidateCode;
    const mirroredPrimary = unit_ids[0] ?? null;
    // Non-billable employees are billed against their home unit, not a client unit.
    const billingUnitId = isEmployeeMode && homeUnitId ? homeUnitId : mirroredPrimary;
    const basePayload = form.same_as_permanent
      ? {
          ...rest,
          compliance: {
            ...(form.compliance ?? {}),
            ...(((form.compliance ?? {}) as Record<string, unknown>).has_uan === false
              ? {
                  uan: "",
                  uan_missing_since:
                    ((form.compliance ?? {}) as Record<string, unknown>).uan_missing_since ||
                    form.preferred_joining_date ||
                    form.application_date,
                }
              : { uan_missing_since: null }),
          },
          unit_id: billingUnitId,
          present_address1: form.permanent_address1,
          present_address2: form.permanent_address2,
          present_landmark: form.permanent_landmark,
          present_pincode: form.permanent_pincode,
          present_city: form.permanent_city,
          present_district: form.permanent_district,
          present_state: form.permanent_state,
          present_country: form.permanent_country,
          present_police_station: form.permanent_police_station,
        }
      : {
          ...rest,
          compliance: {
            ...(form.compliance ?? {}),
            ...(((form.compliance ?? {}) as Record<string, unknown>).has_uan === false
              ? {
                  uan: "",
                  uan_missing_since:
                    ((form.compliance ?? {}) as Record<string, unknown>).uan_missing_since ||
                    form.preferred_joining_date ||
                    form.application_date,
                }
              : { uan_missing_since: null }),
          },
          unit_id: billingUnitId,
        };
    return {
      ...basePayload,
      status,
      designation_id: form.designation_id ?? editing?.designation_id ?? null,
      // Persist the onboarding classification independently of unit mappings.
      // A non-billable employee may still receive operational unit scope later.
      non_billable: isEmployeeMode,
      // Never write a null role_key (NOT NULL in DB) — omit it when unset so the
      // insert can fall back and updates keep the existing role.
      ...((form.role_key ?? "").trim() ? { role_key: (form.role_key ?? "").trim() } : {}),
      emergency_contact_name: emergencyContact?.name ?? "",
      emergency_contact_relation: emergencyContact?.relation ?? "",
      emergency_contact_mobile: emergencyContact?.mobile ?? "",
    };
  };

  /** Replace the candidate's entries in candidate_units with the current form selection. */
  const syncCandidateUnits = async (candidateId: string) => {
    // Wipe existing rows then re-insert. Simpler & atomic enough for typical 1-5 units.
    const { error: deleteError } = await supabase
      .from("candidate_units" as never)
      .delete()
      .eq("candidate_id", candidateId);
    if (deleteError) throw new Error(`Unit assignment sync failed: ${deleteError.message}`);
    if (form.unit_ids.length === 0) return;
    // First unit = primary (work orders go here). All others are reliever
    // postings: extra duty (ED) only, never a regular muster line.
    const rows = form.unit_ids.map((unit_id, idx) => ({
      candidate_id: candidateId,
      unit_id,
      // The contracted designation this person fills at that unit drives
      // attendance caps and salary — never the master designation.
      designation_id:
        (form.unit_designations ?? {})[unit_id] ??
        (idx === 0 ? (form.designation_id ?? null) : null),
      is_primary: idx === 0,
      is_reliever: idx !== 0,
      sort_order: idx,
    }));

    const { error } = await supabase.from("candidate_units" as never).insert(rows as never);
    if (error) throw new Error(`Unit assignment sync failed: ${error.message}`);

    // Auto-dispatch a posting order for the PRIMARY unit only (guards only).
    // Fires when the primary unit is newly assigned OR switched to another
    // unit — a change of primary posting always needs a fresh posting order.
    // Reliever units never trigger a work order.
    const primaryUnitId = form.unit_ids[0];
    const previousPrimaryUnitId = initialUnitIds[0] ?? null;
    if (primaryUnitId && primaryUnitId !== previousPrimaryUnitId) {
      void autoIssuePostingOrder({ candidateId, unitId: primaryUnitId }).then((r) => {
        if (r.sent) toast.success(`Posting order emailed to ${r.to}`);
        else if (!/only issued to security guards/.test(r.reason))
          toast.warning(`Posting order not sent — ${r.reason}`);
      });
    }
  };

  const persist = async (status: string, successMsg: string, opts?: { fast?: boolean }) => {
    const payload = buildPayload(status);
    const normalizedAadhaar = String(
      (payload as { aadhaar_number?: unknown }).aadhaar_number ?? "",
    ).replace(/\D/g, "");
    if (!editing && normalizedAadhaar.length === 12) {
      const existingCandidate = await findCandidateByAadhaar(normalizedAadhaar);
      if (existingCandidate) {
        setRehireMatch(existingCandidate as ExistingCandidateMatch);
        setRehireOpen(true);
        throw new Error(
          "This Aadhaar already exists. Please continue through the rehire approval process.",
        );
      }
    }
    const normalizedMobile = String((payload as { mobile?: unknown }).mobile ?? "").replace(
      /\D/g,
      "",
    );
    if (normalizedMobile) {
      const duplicateQuery = supabase
        .from("candidates" as never)
        .select("id,full_name,status,candidate_code,employee_code")
        .eq("mobile", normalizedMobile)
        .neq("status", "inactive")
        .limit(1);
      if (editing?.id) duplicateQuery.neq("id", editing.id);
      const { data: duplicateMobileRows, error: duplicateMobileError } = await duplicateQuery;
      if (duplicateMobileError) throw duplicateMobileError;
      const duplicate = (
        duplicateMobileRows as unknown as Array<{
          id: string;
          full_name: string | null;
          status: string | null;
          candidate_code: string | null;
          employee_code: string | null;
        }> | null
      )?.[0];
      if (duplicate) {
        const recordCode = duplicate.employee_code || duplicate.candidate_code || "existing record";
        throw new Error(
          `Mobile ${normalizedMobile} is already linked to ${duplicate.full_name || recordCode} (${recordCode}, ${duplicate.status || "active"}). Open that profile or use a different mobile number.`,
        );
      }
    }
    let createdCandidateId: string | null = null;
    if (editing) {
      const wasRejected = editing.status === "rejected";
      const isResubmit = wasRejected && status === "pending";
      const patched = isResubmit
        ? { ...(payload as Record<string, unknown>), rejection_reason: "", rejected_at: null }
        : (payload as Record<string, unknown>);
      const { data: before } = await supabase
        .from("candidates" as never)
        .select("*")
        .eq("id", editing.id)
        .maybeSingle();
      const { data: saved, error } = await supabase
        .from("candidates" as never)
        .update(patched as never)
        .eq("id", editing.id)
        .select("id,role_key")
        .single();
      if (error) throw error;
      const requestedRole = (patched as { role_key?: unknown }).role_key;
      const savedRole = (saved as unknown as { role_key?: string } | null)?.role_key;
      if (typeof requestedRole === "string" && savedRole !== requestedRole) {
        throw new Error(`Role was not saved. Expected ${requestedRole}, but found ${savedRole ?? "none"}.`);
      }
      // Always sync: unit IDs may be unchanged while a per-unit designation changed.
      await syncCandidateUnits(editing.id);
      setInitialUnitIds([...form.unit_ids]);
      void logActivity({
        module: "Employees",
        action: isResubmit ? "resubmit" : "update",
        entityType: "candidate",
        entityId: editing.id,
        entityLabel: payload.full_name,
        before: (before as unknown as Record<string, unknown>) ?? null,
        after: { ...(patched as Record<string, unknown>), unit_ids: form.unit_ids },
      });
      if (["active", "approved", "inactive"].includes(status)) {
        const { ensureFormViiForCandidate, ensureIdCardForCandidate } =
          await import("@/lib/company-documents");
        await Promise.all([
          ensureFormViiForCandidate(editing.id, { force: true }),
          ensureIdCardForCandidate(editing.id, { force: true }),
        ]);
      }
      if (isResubmit) {
        await notifyOnboardingApprovers({
          type: "candidate_pending_approval",
          title: "Candidate re-submitted after fixes",
          message: `${payload.full_name || "A candidate"} has been updated and re-submitted for approval.`,
          link: "/admin/employees",
          entityType: "candidate",
          entityId: editing.id,
        }).catch((e: unknown) => console.error("notifyOnboardingApprovers resubmit failed", e));
      }
    } else {
      const { data: authData } = await supabase.auth.getUser();
      const creatorId = authData.user?.id ?? null;
      // Auto-derive role_key from the contract_resource mapped to this designation
      // (used primarily by the non-billable "Add Employee" flow).
      let derivedRoleKey = (payload as { role_key?: string | null }).role_key ?? "";
      if (!derivedRoleKey && (payload as { designation_id?: string | null }).designation_id) {
        const { data: cr } = await supabase
          .from("contract_resources" as never)
          .select("role_key")
          .eq("designation_id", (payload as { designation_id: string }).designation_id)
          .not("role_key", "is", null)
          .limit(1)
          .maybeSingle();
        const roleFromContract = (cr as { role_key?: string | null } | null)?.role_key ?? "";
        if (roleFromContract) derivedRoleKey = roleFromContract;
      }
      // role_key is NOT NULL in the database. Drafts are saved before the role is
      // picked, so fall back to "guard" — the user can still change it afterwards.
      const insertPayload = {
        ...(payload as Record<string, unknown>),
        created_by: creatorId,
        role_key: derivedRoleKey || "guard",
      };
      const { data, error } = await supabase
        .from("candidates" as never)
        .insert(insertPayload as never)
        .select("id")
        .single();
      if (error) throw error;

      const newId = (data as { id: string }).id;
      createdCandidateId = newId;
      await syncCandidateUnits(newId);
      setInitialUnitIds([...form.unit_ids]);
      void logActivity({
        module: "Employees",
        action: "create",
        entityType: "candidate",
        entityId: newId,
        entityLabel: payload.full_name,
        after: { ...(payload as unknown as Record<string, unknown>), unit_ids: form.unit_ids },
      });
      if (status === "pending") {
        await notifyOnboardingApprovers({
          type: "candidate_pending_approval",
          title: "New candidate awaiting approval",
          message: `${payload.full_name || "A new candidate"} has been submitted and needs your approval.`,
          link: "/admin/employees",
          entityType: "candidate",
          entityId: newId,
        }).catch((e: unknown) => console.error("notifyOnboardingApprovers submit failed", e));
      }
    }

    // Sync operational mappings → employee_scope_assignments (non-billable
    // employees only). Payroll home unit lives on candidates.unit_id and is
    // never written here — scope rows are operational access only.
    const cidForBranch = editing?.id ?? createdCandidateId;
    if (isEmployeeMode && cidForBranch) {
      await supabase
        .from("employee_scope_assignments" as never)
        .delete()
        .eq("candidate_id", cidForBranch)
        .in("scope_type", ["unit", "customer"]);
      if (operationalMappings.length > 0) {
        const { error: esaErr } = await supabase.from("employee_scope_assignments" as never).insert(
          operationalMappings
            .filter((m) => m.scope_id && m.scope_id !== homeUnitId)
            .map((m) => ({
              candidate_id: cidForBranch,
              scope_type: m.scope_type,
              scope_id: m.scope_id,
              scope_label: m.scope_label,
            })) as never,
        );
        if (esaErr) console.error("operational mapping sync failed", esaErr);
      }
    }
    // Wage sheets belong to non-billable employees only; billable guards are
    // paid via contract resources, so never touch employee_wages for them.
    if (cidForBranch && mode === "employee") await syncEmployeeWages(cidForBranch);

    toast.success(successMsg);
    if (opts?.fast) {
      // Draft saves must feel instant. Patch the cached list so the row shows
      // up right away, then refresh in the background instead of blocking on a
      // full re-read of every candidate.
      const idForCache = editing?.id ?? createdCandidateId;
      if (idForCache) {
        qc.setQueryData(QK, (old: CandidateListItem[] | undefined) => {
          if (!old) return old;
          const patch = {
            ...(payload as unknown as Record<string, unknown>),
            id: idForCache,
          } as unknown as CandidateListItem;
          const idx = old.findIndex((r) => r.id === idForCache);
          if (idx < 0) return [patch, ...old];
          const next = [...old];
          next[idx] = { ...next[idx], ...patch };
          return next;
        });
      }
      void qc.invalidateQueries({ queryKey: QK });
      void qc.invalidateQueries({ queryKey: QK_CANDIDATE_UNITS });
      return;
    }
    // Await so the caller (Save/Send-to-Approval handlers) can close the
    // wizard AFTER the list has refetched — prevents the "count went up
    // but I don't see my row" flash.
    await qc.invalidateQueries({ queryKey: QK, refetchType: "active" });
    await qc.invalidateQueries({ queryKey: QK_CANDIDATE_UNITS, refetchType: "active" });
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    setSaveError(null);
    try {
      // Drafts have no strict validation — let user save partial work.
      await persist(editing && editing.status !== "draft" ? form.status : "draft", "Draft saved", {
        fast: true,
      });
      if (draftStorageKey) {
        try {
          window.localStorage.removeItem(draftStorageKey);
        } catch {
          /* noop */
        }
      }
      dirtyRef.current = false;
      onOpenChange(false);
      void notifySaved({
        title: "Draft saved",
        description: "You can reopen this profile any time and continue where you left off.",
      });
    } catch (e) {
      const msg = getMutationErrorMessage(e, "Could not save draft");
      setSaveError({ title: "Draft not saved", detail: msg });
      toast.error(msg);
    } finally {
      setSavingDraft(false);
    }
  };

  /** Close guard shared with the header X and the Cancel button. */
  const requestClose = async () => {
    if (!dirtyRef.current) {
      onOpenChange(false);
      return;
    }
    const choice = await confirmDiscardChanges({ what: "profile", canSaveDraft: true });
    if (choice === "stay") return;
    if (choice === "draft") {
      await saveDraft();
      return;
    }
    dirtyRef.current = false;
    onOpenChange(false);
  };

  useEffect(() => {
    if (invalidField) setInvalidField(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const failValidation = (message: string, anchor?: string) => {
    setSaveError({ title: "Missing required information", detail: message });
    toast.error(message);
    setInvalidField(anchor ?? null);
    if (anchor) {
      window.setTimeout(() => {
        const el = document.getElementById(`fld-${anchor}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const focusable = el.querySelector<HTMLElement>("input, select, textarea, button");
        focusable?.focus({ preventScroll: true });
      }, 60);
    }
  };

  const submit = async () => {
    setSaveError(null);
    if (!isEditingEmployeeProfile) {
      if (!form.photo_url) return failValidation("Photograph is required");
      if (!digilockerVerified && !form.aadhaar_image_url)
        return failValidation(
          verificationEnabled
            ? "Verify the Aadhaar via DigiLocker, or upload an Aadhaar copy"
            : "Upload an Aadhaar copy",
        );
      if (!form.signature_url) return failValidation("Signature is required");
      if (!form.pan_image_url) return failValidation("PAN card upload is required");
      if (!form.full_name.trim())
        return failValidation("Full name is required (Basic Information)", "full_name");
      if (isEmployeeMode && !String(form.role_key ?? "").trim())
        return failValidation(
          "Role is required for non-billable employees — pick a role (e.g. Operations) in the Employment section",
          "role_key",
        );
      if (!/^\d{10}$/.test(form.mobile.trim()))
        return failValidation(
          "A valid 10-digit mobile number is required (Basic Information) — it is also the login ID",
          "mobile",
        );
      // Email is optional, but when supplied it must be well formed so posting
      // orders and company documents actually deliver.
      const emailValue = (form.email ?? "").trim();
      if (emailValue && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailValue))
        return failValidation(
          "Enter a valid email address, or leave it blank (Basic Information)",
          "email",
        );

      if (
        !String(((form.physical_health ?? {}) as Record<string, unknown>).blood_group ?? "").trim()
      )
        return failValidation(
          "Blood group is required (Physical & Health section) — it is printed on the employee ID card",
          "blood_group",
        );

      if (form.unit_ids.length === 0)
        return failValidation(
          isEmployeeMode
            ? "Pick a PLUS 360 FAHRENHEIT SOLUTIONS unit at the top of this form (e.g. Corporate Office (Pune - HO))"
            : "At least one unit must be mapped before saving (Deployment section)",
        );
      if (!form.permanent_district.trim())
        return failValidation(
          "District is required in the permanent address",
          "permanent_district",
        );
      if (!form.same_as_permanent && !form.present_district.trim())
        return failValidation("District is required in the present address", "present_district");
      const complianceRecord = (form.compliance ?? {}) as Record<string, unknown>;
      const hasUan =
        complianceRecord.has_uan ?? (String(complianceRecord.uan ?? "").trim() ? true : undefined);
      const uanValue = String(complianceRecord.uan ?? "").trim();
      if (typeof hasUan !== "boolean")
        return failValidation("Select whether the candidate has a UAN (Compliance section)");
      if (hasUan && !/^1\d{11}$/.test(uanValue))
        return failValidation("UAN must be 12 digits and must start with 1");
      const nomineeIssue = getNomineeIssue();
      if (nomineeIssue) return failValidation(`Nominee: ${nomineeIssue}`);
      const emergencyContactIssue = getEmergencyContactIssue();
      if (emergencyContactIssue)
        return failValidation(`Emergency contact: ${emergencyContactIssue}`);
      const compliance = (form.compliance ?? {}) as Record<string, unknown>;
      const esicEnabled = compliance.esic_enabled !== false; // default true
      if (esicEnabled && !compliance.esic_branch_id) {
        return failValidation(
          "ESIC Branch is missing. Please map a branch from ESIC Branch Manager (Compliance section).",
        );
      }
      if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan_number.trim().toUpperCase()))
        return failValidation("PAN number format is invalid (e.g. ABCDE1234F)", "pan_number");
      if (form.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc.trim().toUpperCase()))
        return failValidation("IFSC code format is invalid (e.g. SBIN0001234)", "bank_ifsc");
      if (form.bank_account_number && !/^\d{6,18}$/.test(form.bank_account_number.trim()))
        return failValidation("Bank account number must be 6–18 digits", "bank_account_number");
    }
    setSubmitting(true);
    try {
      // Creating / re-submitting moves to "pending" so the admin can approve.
      // For employees, preserve the chosen status (active/inactive). New/candidate edits go to pending.
      const nextStatus = isEditingEmployeeProfile
        ? form.status === "inactive"
          ? "inactive"
          : "active"
        : "pending";
      const successMsg = editing
        ? isEditingEmployeeProfile
          ? "Employee updated"
          : "Candidate updated"
        : "Candidate submitted for approval";
      await persist(nextStatus, successMsg);
      if (draftStorageKey) {
        try {
          window.localStorage.removeItem(draftStorageKey);
        } catch {
          /* noop */
        }
      }
      dirtyRef.current = false;
      onOpenChange(false);
      void notifySaved({
        title: editing ? "Changes saved" : "Sent for approval",
        description: editing
          ? `${form.full_name || "This profile"} has been updated.`
          : `${form.full_name || "The profile"} is now waiting for approval.`,
      });
    } catch (e) {
      const msg = getMutationErrorMessage(e, "Save failed");
      setSaveError({ title: "Could not save candidate", detail: msg });
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const wizardScrollRef = useRef<HTMLDivElement>(null);
  const wizardBodyRef = useRef<HTMLDivElement>(null);

  // ---------- Stepped, mobile-first wizard ----------
  const { isFieldOfficer: wizardIsFieldOfficer } = useCurrentUserRole();
  // Super Admin may jump freely between steps, even with earlier steps incomplete.
  const { isSuperAdmin: wizardIsSuperAdmin, roleKey: wizardRoleKey } = useCurrentPermissions();
  const canSkipSteps = wizardIsSuperAdmin || wizardRoleKey === "super_admin";
  const steps = useMemo(
    () => [
      { key: "aadhaar", label: "Aadhaar", caption: "Identity" },
      { key: "pan", label: "PAN", caption: "Identity" },
      { key: "basic", label: "Personal", caption: "Details" },
      { key: "address", label: "Address", caption: "Addresses" },
      { key: "bank", label: "Bank", caption: "Account" },
      { key: "contacts", label: "Contacts", caption: "Family" },
      { key: "assignment", label: "Posting", caption: "Work" },
      { key: "records", label: "Records", caption: "Checks" },
      // Wage sheets exist only for non-billable staff. Billable guards are
      // paid from the client contract's resources, so this step stays hidden
      // for them — exactly like the older form.
      ...(mode === "employee" && !wizardIsFieldOfficer
        ? [{ key: "wages", label: "Wages", caption: "Pay" }]
        : []),
      { key: "uploads", label: "Documents", caption: "Files" },
      { key: "review", label: "Review", caption: "Submit" },
    ],
    [mode, wizardIsFieldOfficer],
  );
  const [stepKey, setStepKey] = useState("aadhaar");
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === stepKey),
  );
  const currentStep = steps[stepIndex] ?? steps[0];
  const at = (key: string) => stepKey === key;
  const isLastStep = stepIndex === steps.length - 1;

  const resumedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      resumedForRef.current = null;
      return;
    }
    if (!editing) {
      if (resumedForRef.current !== "new") {
        resumedForRef.current = "new";
        setStepKey("aadhaar");
      }
      return;
    }
    // Resume an existing record where the person stopped: the first step whose
    // own required fields are still missing. Waits until the record's data has
    // actually loaded into the form, so the jump reflects saved values.
    if (resumedForRef.current === editing.id) return;
    const loaded = (form as { id?: string }).id === editing.id;
    if (!loaded) return;
    resumedForRef.current = editing.id;
    const resume = steps.find((s) => validatedSteps.has(s.key) && validateStep(s.key) !== null);
    setStepKey(resume?.key ?? "aadhaar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, form]);

  const goToStep = (key: string) => {
    setStepKey(key);
    window.setTimeout(() => {
      wizardScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      wizardBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 10);
  };
  const validateStep = (key: string): string | null => {
    if (key === "aadhaar" && (form.aadhaar_number ?? "").replace(/\D/g, "").length !== 12)
      return "Enter the 12-digit Aadhaar number to continue";
    if (key === "pan") {
      const pan = (form.pan_number ?? "").trim().toUpperCase();
      if (!pan) return "Enter the PAN number to continue";
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return "PAN must look like ABCDE1234F";
    }
    if (key === "basic") {
      if (!form.full_name.trim()) return "Full name is required";
      if (!/^\d{10}$/.test((form.mobile ?? "").trim()))
        return "A valid 10-digit mobile number is required";
    }
    if (key === "address" && !form.permanent_district.trim())
      return "District is required in the permanent address";
    if (key === "bank") {
      const acc = (form.bank_account_number ?? "").trim();
      const ifsc = (form.bank_ifsc ?? "").trim().toUpperCase();
      if (!acc) return "Bank account number is required";
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return "A valid IFSC code is required";
    }
    if (key === "contacts") return getNomineeIssue() ?? getEmergencyContactIssue();
    if (key === "assignment" && form.unit_ids.length === 0 && !form.unit_id)
      return "Select the posting unit to continue";
    if (key === "records") {
      const c = (form.compliance ?? {}) as Record<string, unknown>;
      const hasUan = c.has_uan ?? (String(c.uan ?? "").trim() ? true : undefined);
      const uan = String(c.uan ?? "").trim();
      if (typeof hasUan !== "boolean") return "Select whether the candidate has a UAN";
      if (hasUan && !/^1\d{11}$/.test(uan)) return "Enter a valid 12-digit UAN starting with 1";
      const blood = String(
        ((form.physical_health ?? {}) as Record<string, unknown>).blood_group ?? "",
      ).trim();
      if (!blood) return "Select the blood group";
      const esicOn = (c.esic_enabled ?? true) as boolean;
      if (esicOn) {
        if (!String(c.esic_branch_id ?? "").trim()) return "Select the ESIC branch";
        const family = Array.isArray(c.esic_family)
          ? (c.esic_family as Array<Record<string, unknown>>)
          : [];
        if (family.some((m) => !m?.aadhaar_front_url || !m?.aadhaar_back_url))
          return "Upload both Aadhaar sides for every ESIC family member";
      }
      return null;
    }
    if (key === "wages") {
      if (wageUnitIds.length === 0) return "Assign a unit before setting wages";
      const pending = wageUnitIds.find((uid) => !wagesByUnit[uid]?.components?.length);
      if (pending) return "Add the wage sheet for every mapped unit";
      return null;
    }
    if (key === "uploads") {
      if (!form.photo_url) return "Upload the photograph";
      if (!form.aadhaar_image_url) return "Upload the Aadhaar card";
      if (!form.pan_image_url) return "Upload the PAN card";
      if (!form.signature_url) return "Upload the signature";
      return null;
    }
    return null;
  };
  // A step counts as done only when its own required fields actually pass.
  const validatedSteps = new Set([
    "aadhaar",
    "pan",
    "basic",
    "address",
    "bank",
    "contacts",
    "assignment",
    "records",
    "wages",
    "uploads",
  ]);
  const isStepComplete = (key: string) => validatedSteps.has(key) && validateStep(key) === null;
  const firstBlockingStep = (
    targetIndex: number,
  ): { key: string; label: string; problem: string } | null => {
    for (let i = 0; i < targetIndex; i += 1) {
      const s = steps[i];
      if (!s) continue;
      const problem = validateStep(s.key);
      if (problem) return { key: s.key, label: s.label, problem };
    }
    return null;
  };
  const goNext = () => {
    if (!canSkipSteps) {
      const problem = validateStep(stepKey);
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    const next = steps[stepIndex + 1];
    if (next) goToStep(next.key);
  };
  const goBack = () => {
    const prev = steps[stepIndex - 1];
    if (prev) goToStep(prev.key);
  };
  // Jumping backwards is always allowed; jumping ahead needs the earlier steps done
  // for everyone except Super Admin, who can move to any step at any time.
  const requestStep = (key: string) => {
    const targetIndex = steps.findIndex((s) => s.key === key);
    if (targetIndex < 0 || targetIndex <= stepIndex || canSkipSteps) {
      goToStep(key);
      return;
    }
    const blocking = firstBlockingStep(targetIndex);
    if (blocking) {
      toast.error(`${blocking.label}: ${blocking.problem}`);
      goToStep(blocking.key);
      return;
    }
    goToStep(key);
  };

  // Keeps typed work safe between steps / accidental closes (new entries only).
  const draftStorageKey = !editing ? `rg-wizard-draft-${mode}` : null;
  const [pendingDraft, setPendingDraft] = useState<CandidateForm | null>(null);
  useEffect(() => {
    if (!open || !draftStorageKey) {
      setPendingDraft(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: number; form?: CandidateForm };
      if (!parsed?.form) return;
      if (parsed.savedAt && Date.now() - parsed.savedAt > 86_400_000) {
        window.localStorage.removeItem(draftStorageKey);
        return;
      }
      if (!parsed.form.full_name && !parsed.form.aadhaar_number && !parsed.form.mobile) return;
      setPendingDraft(parsed.form);
    } catch {
      /* noop */
    }
  }, [open, draftStorageKey]);
  useEffect(() => {
    if (!open || !draftStorageKey) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftStorageKey, JSON.stringify({ savedAt: Date.now(), form }));
      } catch {
        /* noop */
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [open, draftStorageKey, form]);
  useEffect(() => {
    if (!open) return;
    const scrollToTop = () => {
      wizardScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      wizardBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      try {
        window.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        /* noop */
      }
    };
    scrollToTop();
    const t1 = window.setTimeout(scrollToTop, 50);
    const t2 = window.setTimeout(scrollToTop, 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open]);

  return (
    <InvalidFieldContext.Provider value={invalidField}>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) onOpenChange(true);
          else void requestClose();
        }}
      >
        <DialogContent
          ref={wizardScrollRef}
          className="candidate-wizard-page z-[100] flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl sm:border sm:border-border/60 sm:shadow-xl"
        >
          <DialogHeader className="shrink-0 border-b border-border/60 bg-card px-3 pb-2 pt-[max(0.625rem,env(safe-area-inset-top))] pr-14 sm:px-6 sm:py-4 sm:pr-16 lg:hidden">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent sm:h-10 sm:w-10 sm:rounded-xl">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base font-semibold sm:text-lg">
                    {editing ? "Edit Candidate" : "Add Candidate"}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {currentStep.label} · {currentStep.caption}
                  </DialogDescription>
                </div>
              </div>
            </div>
            {isEmployeeMode && (
              <div className="mt-3 hidden space-y-2 sm:block">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-0 bg-amber-500/15 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Non-billable
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-border/70 bg-card text-[11px] font-medium"
                  >
                    Payroll home unit ·{" "}
                    {nonBillableUnits.find((u) => u.id === homeUnitId)?.name ??
                      "Corporate Office (Pune - HO)"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">Pay unit: Radiant Pune</p>
              </div>
            )}

            {editing &&
              (editing.status === "approved" ||
                editing.status === "active" ||
                editing.status === "inactive") && (
                <div className="mt-3 hidden flex-wrap items-center gap-2 sm:flex">
                  <StatusBadge status={form.status || editing.status} />
                  {(editing as { employee_code?: string }).employee_code && (
                    <Badge className="border-0 bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                      {(editing as { employee_code?: string }).employee_code}
                    </Badge>
                  )}
                  {(() => {
                    const unitId = form.unit_id || editing.unit_id;
                    const unit = unitId ? units.find((u) => u.id === unitId) : null;
                    return unit ? (
                      <Badge
                        variant="outline"
                        className="border-border/70 bg-card text-[11px] font-medium"
                      >
                        Unit · {unit.name}
                      </Badge>
                    ) : null;
                  })()}
                  {(() => {
                    const desigId = form.designation_id || editing.designation_id;
                    const desig = desigId ? designations.find((d) => d.id === desigId) : null;
                    const bUnitId = form.unit_id || editing.unit_id;
                    const bUnit = bUnitId ? units.find((u) => u.id === bUnitId) : null;
                    const billable = !!bUnit && bUnit.is_billable !== false;
                    return desig ? (
                      <Badge
                        variant="outline"
                        className="border-border/70 bg-card text-[11px] font-medium"
                      >
                        {desig.name}
                        <span
                          className={cn(
                            "ml-2 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                            billable
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-slate-500/15 text-slate-600 dark:text-slate-300",
                          )}
                        >
                          {billable ? "Billable" : "Non-billable"}
                        </span>
                      </Badge>
                    ) : null;
                  })()}
                  {form.mobile && (
                    <Badge
                      variant="outline"
                      className="border-border/70 bg-card text-[11px] font-medium"
                    >
                      {form.mobile}
                    </Badge>
                  )}
                  {(() => {
                    const eAny = editing as unknown as {
                      offboarding_reason_id?: string | null;
                      offboarded_at?: string | null;
                      no_hire?: boolean;
                    };
                    if (eAny.no_hire) {
                      return (
                        <Badge
                          variant="outline"
                          className="border-rose-300/60 bg-rose-500/10 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300"
                        >
                          Do not re-hire
                        </Badge>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const eAny = editing as unknown as {
                      offboarding_reason_id?: string | null;
                      offboarded_at?: string | null;
                    };
                    if (!eAny.offboarding_reason_id) return null;
                    const r = offboardReasons.find((x) => x.id === eAny.offboarding_reason_id);
                    const date = eAny.offboarded_at
                      ? new Date(eAny.offboarded_at).toLocaleDateString()
                      : null;
                    return (
                      <Badge
                        variant="outline"
                        className="border-rose-300/60 bg-rose-500/10 text-[11px] font-medium text-rose-700 dark:text-rose-300"
                      >
                        Offboarded · {r?.name || "Reason"}
                        {date ? ` · ${date}` : ""}
                      </Badge>
                    );
                  })()}
                </div>
              )}
          </DialogHeader>

          {/* Compact mobile progress */}
          <div className="mobile-glass-bar shrink-0 border-b border-border/60 bg-card/85 px-3 py-2 sm:px-6 sm:py-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-accent">
                  Step {stepIndex + 1} of {steps.length}
                </p>
                <p className="truncate text-sm font-medium">{currentStep.label}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(editing?.employee_code || editing?.candidate_code) && (
                  <Badge className="border-0 bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                    {editing.employee_code || editing.candidate_code}
                  </Badge>
                )}
              </div>
            </div>
            <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <div className="-mx-1 mt-2 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {steps.map((s, i) => {
                const done = isStepComplete(s.key);
                return (
                  <Button
                    key={s.key}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => requestStep(s.key)}
                    className={cn(
                      "h-8 shrink-0 snap-start gap-1 rounded-full border px-2.5 text-[11px] font-medium shadow-none transition-colors",
                      i === stepIndex
                        ? "border-accent bg-accent text-accent-foreground hover:bg-accent/90 hover:text-accent-foreground"
                        : done
                          ? "border-accent/35 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent"
                          : i < stepIndex
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-border/70 bg-background text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                        i === stepIndex
                          ? "bg-accent-foreground/20"
                          : done
                            ? "bg-accent/15"
                            : "bg-secondary",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {s.label}
                  </Button>
                );
              })}
            </div>
            {pendingDraft && (
              <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                <span className="truncate text-xs text-muted-foreground">Draft available</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setForm(pendingDraft);
                    setPendingDraft(null);
                    toast.success("Unsaved entry restored");
                  }}
                >
                  Restore
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    if (draftStorageKey) {
                      try {
                        window.localStorage.removeItem(draftStorageKey);
                      } catch {
                        /* noop */
                      }
                    }
                    setPendingDraft(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
            <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-border/60 bg-card px-7 py-8 lg:flex">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-6 shrink-0">
                  <p className="text-xs font-semibold text-muted-foreground">Candidate</p>
                  <h2 className="mt-1 text-xl font-semibold text-foreground">
                    {editing ? "Edit profile" : "New profile"}
                  </h2>
                  {(editing?.employee_code || editing?.candidate_code) && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      {editing.employee_code || editing.candidate_code}
                    </p>
                  )}
                </div>
                <nav
                  aria-label="Candidate form steps"
                  className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-2 pr-1"
                >
                  {steps.map((s, i) => {
                    const done = isStepComplete(s.key);
                    const active = i === stepIndex;
                    return (
                      <Button
                        key={s.key}
                        type="button"
                        variant="ghost"
                        onClick={() => requestStep(s.key)}
                        aria-current={active ? "step" : undefined}
                        className={cn(
                          "h-auto w-full justify-start gap-3 rounded-lg px-2.5 py-2.5 text-left shadow-none",
                          active &&
                            "bg-accent/10 text-accent ring-1 ring-accent/20 hover:bg-accent/10 hover:text-accent",
                          !active &&
                            done &&
                            "bg-accent/5 text-accent hover:bg-accent/10 hover:text-accent",
                          !active &&
                            !done &&
                            i < stepIndex &&
                            "text-destructive hover:bg-destructive/5 hover:text-destructive",
                          !active &&
                            !done &&
                            i >= stepIndex &&
                            "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                            active &&
                              "border-accent bg-accent text-accent-foreground ring-4 ring-accent/10",
                            !active && done && "border-accent/40 bg-accent/15 text-accent",
                            !active && !done && "border-border bg-card",
                          )}
                        >
                          {done ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            String(i + 1).padStart(2, "0")
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{s.label}</span>
                          {active && (
                            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                              {s.caption}
                            </span>
                          )}
                        </span>
                      </Button>
                    );
                  })}
                </nav>
              </div>
              <div className="relative z-10 mt-6 shrink-0 rounded-xl border border-accent/20 bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Completion</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {completionPct}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {completionDone} of {completionTotal} required fields
                </p>
              </div>
            </aside>

            <div
              ref={wizardBodyRef}
              data-candidate-form-scroll
              className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-card px-3 py-3 pb-24 sm:px-7 sm:py-7 lg:px-10 lg:py-9"
            >
              <div className="mx-auto mb-7 hidden max-w-4xl lg:block">
                <p className="text-xs font-medium text-accent">
                  Step {stepIndex + 1} of {steps.length}
                </p>
                <h3 className="mt-1 text-2xl font-semibold text-foreground">{currentStep.label}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{currentStep.caption}</p>
              </div>
              {/* ----- Full form (single page) ----- */}
              {true && (
                <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
                  {/* Identity first — Aadhaar & PAN drive the rest of the profile */}
                  {(at("aadhaar") || at("pan")) && (
                    <Section title={at("aadhaar") ? "Aadhaar" : "PAN"}>
                      <p className="mb-3 text-[11px] text-muted-foreground">
                        {at("aadhaar")
                          ? "Enter 12 digits. Verified details fill automatically."
                          : "Enter the PAN number."}
                      </p>
                      <div className="grid grid-cols-1 gap-4">
                        {at("aadhaar") && (
                          <Field label="Aadhaar Number" required>
                            <Input
                              format="aadhaar"
                              value={form.aadhaar_number}
                              onChange={(e) => {
                                const clean = e.target.value.replace(/\D/g, "").slice(0, 12);
                                const savedVerifiedAadhaar = String(
                                  form.other_info?.digilocker_verified_aadhaar ?? "",
                                ).replace(/\D/g, "");
                                set("aadhaar_number", clean);
                                if (digilockerVerified && clean !== savedVerifiedAadhaar) {
                                  setDigilockerVerified(false);
                                  set("other_info", {
                                    ...(form.other_info ?? {}),
                                    digilocker_verified: false,
                                    digilocker_verified_aadhaar: "",
                                  });
                                }
                                if (clean.length < 12) {
                                  lastAadhaarLookupRef.current = "";
                                  setRehireMatch(null);
                                  setRehireOpen(false);
                                } else {
                                  void checkAadhaarForRehire(clean);
                                }
                              }}
                              onBlur={() => void checkAadhaarForRehire(form.aadhaar_number)}
                            />
                            {aadhaarChecking && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Checking existing records…
                              </div>
                            )}
                            {verificationEnabled && (
                              <DigilockerVerify
                                aadhaar={form.aadhaar_number}
                                mobile={form.mobile}
                                verified={digilockerVerified}
                                onVerified={(profile) => {
                                  const keep = (next: string, current: string) =>
                                    next ? next : current;
                                  setForm((f) => ({
                                    ...f,
                                    full_name: keep(profile.full_name, f.full_name),
                                    date_of_birth: profile.date_of_birth || f.date_of_birth,
                                    gender: keep(profile.gender, f.gender),
                                    aadhaar_number: /^\d{12}$/.test(profile.aadhaar_number ?? "")
                                      ? profile.aadhaar_number
                                      : f.aadhaar_number,
                                    permanent_address1: keep(
                                      profile.address_line1,
                                      f.permanent_address1,
                                    ),
                                    permanent_address2: keep(
                                      profile.address_line2,
                                      f.permanent_address2,
                                    ),
                                    permanent_landmark: keep(
                                      profile.landmark,
                                      f.permanent_landmark,
                                    ),
                                    permanent_city: keep(profile.city, f.permanent_city),
                                    permanent_district: keep(
                                      profile.district,
                                      f.permanent_district,
                                    ),
                                    permanent_state: keep(profile.state, f.permanent_state),
                                    permanent_pincode: keep(profile.pincode, f.permanent_pincode),
                                    permanent_country: keep(profile.country, f.permanent_country),
                                    other_info: {
                                      ...(f.other_info ?? {}),
                                      digilocker_verified: true,
                                      digilocker_verified_aadhaar: /^\d{12}$/.test(
                                        profile.aadhaar_number ?? "",
                                      )
                                        ? profile.aadhaar_number
                                        : f.aadhaar_number,
                                      digilocker_verified_at: new Date().toISOString(),
                                    },
                                  }));
                                  setDigilockerVerified(true);
                                }}
                              />
                            )}

                            <RehireRequestDialog
                              open={rehireOpen}
                              match={rehireMatch}
                              onOpenChange={(nextOpen) => {
                                if (!nextOpen) lastAadhaarLookupRef.current = "";
                                setRehireOpen(nextOpen);
                              }}
                              onSubmitted={() => onOpenChange(false)}
                            />
                          </Field>
                        )}
                        {at("pan") && (
                          <Field label="PAN Number" required anchor="pan_number">
                            <Input
                              format="pan"
                              value={form.pan_number}
                              onChange={(e) => {
                                const next = e.target.value.toUpperCase();
                                set("pan_number", next);
                                const savedPan = String(
                                  form.other_info?.pan_verified_number ?? "",
                                ).toUpperCase();
                                if (panVerified && next.replace(/[^A-Z0-9]/g, "") !== savedPan) {
                                  setPanVerified(false);
                                  set("other_info", {
                                    ...(form.other_info ?? {}),
                                    pan_verified: false,
                                    pan_verified_number: "",
                                  });
                                }
                              }}
                            />
                            {verificationEnabled && (
                              <PanVerify
                                pan={form.pan_number}
                                aadhaar={form.aadhaar_number}
                                name={form.full_name}
                                verified={panVerified}
                                onVerified={(result) => {
                                  const keep = (next: string, current: string) =>
                                    next ? next : current;
                                  setForm((f) => ({
                                    ...f,
                                    pan_number: result.pan_number || f.pan_number,
                                    full_name: keep(f.full_name, result.full_name),
                                    date_of_birth: f.date_of_birth || result.date_of_birth,
                                    gender: keep(f.gender, result.gender),
                                    email: keep(f.email, result.email),
                                    other_info: {
                                      ...(f.other_info ?? {}),
                                      pan_verified: true,
                                      pan_verified_number: result.pan_number,
                                      pan_verified_at: new Date().toISOString(),
                                      pan_status: result.pan_status,
                                      pan_type: result.pan_type,
                                      pan_name: result.full_name,
                                      pan_first_name: result.first_name,
                                      pan_middle_name: result.middle_name,
                                      pan_last_name: result.last_name,
                                      father_name:
                                        result.father_name ||
                                        (f.other_info ?? {}).father_name ||
                                        "",
                                      pan_email: result.email,
                                      pan_mobile: result.mobile,
                                      pan_aadhaar_linked: result.aadhaar_linked,
                                      pan_masked_aadhaar: result.masked_aadhaar,
                                      pan_address: {
                                        address_line1: result.address_line1,
                                        address_line2: result.address_line2,
                                        city: result.city,
                                        district: result.district,
                                        state: result.state,
                                        pincode: result.pincode,
                                        country: result.country,
                                      },
                                    },
                                  }));
                                  setPanVerified(true);
                                }}
                              />
                            )}
                          </Field>
                        )}
                      </div>
                    </Section>
                  )}

                  {(unitsLoading || unitsError || designationsLoading || designationsError) && (
                    <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                      {unitsLoading || designationsLoading
                        ? "Loading units and designations…"
                        : unitsError ||
                          designationsError ||
                          "Reference data is unavailable right now."}
                    </div>
                  )}

                  {at("basic") && (
                    <Section title="Personal details">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Full Name" required anchor="full_name">
                          <Input
                            value={form.full_name}
                            onChange={(e) => set("full_name", e.target.value)}
                          />
                        </Field>
                        <Field label="Mobile" required anchor="mobile">
                          <Input
                            value={form.mobile}
                            inputMode="numeric"
                            placeholder="10-digit mobile"
                            className="font-mono"
                            onChange={(e) =>
                              set("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))
                            }
                          />
                        </Field>
                        <Field label="Alternate Mobile">
                          <Input
                            value={form.alt_mobile}
                            inputMode="numeric"
                            placeholder="Optional"
                            className="font-mono"
                            onChange={(e) =>
                              set("alt_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))
                            }
                          />
                        </Field>
                        <Field label="Email" anchor="email">
                          <Input
                            type="email"
                            value={form.email}
                            inputMode="email"
                            placeholder="Optional"
                            onChange={(e) => set("email", e.target.value.trim())}
                          />
                        </Field>

                        <Field label="Date of Birth" required>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !form.date_of_birth && "text-muted-foreground",
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {form.date_of_birth
                                  ? formatDateFns(parseISO(form.date_of_birth), "dd MMM yyyy")
                                  : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 z-[210]" align="start">
                              <Calendar
                                mode="single"
                                captionLayout="dropdown"
                                selected={
                                  form.date_of_birth ? parseISO(form.date_of_birth) : undefined
                                }
                                defaultMonth={
                                  form.date_of_birth
                                    ? parseISO(form.date_of_birth)
                                    : new Date(2000, 0, 1)
                                }
                                startMonth={new Date(1940, 0)}
                                endMonth={new Date()}
                                disabled={(d) => d > new Date()}
                                onSelect={(d) =>
                                  set("date_of_birth", d ? formatDateFns(d, "yyyy-MM-dd") : null)
                                }
                                className="p-3 pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                        </Field>
                        <Field label="Gender" required>
                          <Select
                            value={form.gender || undefined}
                            onValueChange={(v) => set("gender", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {GENDERS.map((g) => (
                                <SelectItem key={g} value={g}>
                                  {g}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Religion">
                          <Select
                            value={form.religion || undefined}
                            onValueChange={(v) => set("religion", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {RELIGIONS.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Caste Category">
                          <Select
                            value={form.caste_category || undefined}
                            onValueChange={(v) => set("caste_category", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {CASTE_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Marital Status">
                          <Select
                            value={form.marital_status || undefined}
                            onValueChange={(v) => set("marital_status", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {MARITAL_STATUSES.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Birthplace">
                          <Input
                            value={form.birthplace}
                            onChange={(e) => set("birthplace", e.target.value)}
                          />
                        </Field>
                      </div>
                    </Section>
                  )}

                  {at("contacts") && (
                    <Section title="Nominee">
                      <NomineeSection
                        form={form}
                        setSection={setSection}
                        set={(k, v) => set(k as never, v as never)}
                      />
                    </Section>
                  )}

                  {at("contacts") && (
                    <Section title="Contacts">
                      <div className="space-y-4">
                        {(() => {
                          const emergencyIndex = form.contacts.findIndex(
                            (item) => item.is_emergency,
                          );
                          const ct: CandidateContact =
                            emergencyIndex >= 0
                              ? form.contacts[emergencyIndex]
                              : { name: "", relation: "", mobile: "", is_emergency: true };
                          const upd = (patch: Partial<CandidateContact>) =>
                            setForm((f) => {
                              const index = f.contacts.findIndex((item) => item.is_emergency);
                              const base: CandidateContact =
                                index >= 0
                                  ? f.contacts[index]
                                  : { name: "", relation: "", mobile: "", is_emergency: true };
                              const next = [...f.contacts];
                              const updated = { ...base, ...patch, is_emergency: true };
                              if (index >= 0) next[index] = updated;
                              else next.push(updated);
                              return { ...f, contacts: next };
                            });
                          const presentAddress = [
                            form.present_address1,
                            form.present_address2,
                            form.present_landmark,
                            form.present_city,
                            form.present_state,
                            form.present_pincode,
                          ]
                            .filter((x) => x && String(x).trim())
                            .join(", ");
                          const age = ct.dob
                            ? Math.floor((Date.now() - new Date(ct.dob).getTime()) / 31557600000)
                            : null;
                          const isMinor = age !== null && Number.isFinite(age) && age < 18;
                          const contactIssue = getEmergencyContactIssue();
                          return (
                            <>
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 pb-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                                    <HeartHandshake className="h-4.5 w-4.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-foreground">
                                      Emergency contact
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      Optional · used only in an emergency
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className={cn(
                                    "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                    contactIssue
                                      ? "bg-secondary text-muted-foreground"
                                      : "bg-primary/10 text-primary",
                                  )}
                                >
                                  {contactIssue ? (
                                    "Incomplete"
                                  ) : ct.name ? (
                                    <>
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                                    </>
                                  ) : (
                                    "Optional"
                                  )}
                                </div>
                              </div>
                              <div className="pt-4">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                                  <div className="sm:col-span-2">
                                    <Field label="Name">
                                      <Input
                                        value={ct.name}
                                        placeholder="Full name"
                                        autoComplete="name"
                                        onChange={(e) => upd({ name: e.target.value })}
                                      />
                                    </Field>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <Field label="Relationship">
                                      <Select
                                        value={ct.relation || undefined}
                                        onValueChange={(v) => upd({ relation: v })}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {REFERENCE_RELATIONS.map((r) => (
                                            <SelectItem key={r} value={r}>
                                              {r}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </Field>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <Field label="Mobile">
                                      <Input
                                        format="mobile"
                                        value={ct.mobile}
                                        placeholder="10-digit mobile"
                                        onChange={(e) =>
                                          upd({
                                            mobile: e.target.value.replace(/\D/g, "").slice(0, 10),
                                          })
                                        }
                                      />
                                    </Field>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <Field label="Date of Birth">
                                      <DatePickerInput
                                        value={ct.dob ?? ""}
                                        onChange={(v) => upd({ dob: v ?? "" })}
                                        placeholder="Select date of birth"
                                        startYear={1930}
                                        disableFuture
                                      />
                                    </Field>
                                  </div>
                                  <div className="sm:col-span-4">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                      <Label>Address</Label>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 shrink-0 px-2 text-[11px]"
                                        disabled={!presentAddress}
                                        onClick={() => upd({ address: presentAddress })}
                                      >
                                        Use present address
                                      </Button>
                                    </div>
                                    <Input
                                      value={ct.address ?? ""}
                                      placeholder="House / street, landmark, city, state, pincode"
                                      onChange={(e) => upd({ address: e.target.value })}
                                    />
                                  </div>
                                </div>

                                {contactIssue && (
                                  <p className="mt-3 rounded-lg bg-secondary/70 px-3 py-2 text-xs font-medium text-muted-foreground">
                                    {contactIssue}
                                  </p>
                                )}

                                {isMinor && (
                                  <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3">
                                    <p className="mb-3 text-xs font-semibold text-foreground">
                                      Guardian details · contact is {age} years old
                                    </p>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                      <Field label="Guardian Name" required>
                                        <Input
                                          value={ct.guardian_name ?? ""}
                                          onChange={(e) => upd({ guardian_name: e.target.value })}
                                        />
                                      </Field>
                                      <Field label="Guardian Mobile" required>
                                        <Input
                                          value={ct.guardian_mobile ?? ""}
                                          inputMode="numeric"
                                          maxLength={10}
                                          placeholder="10-digit mobile"
                                          onChange={(e) =>
                                            upd({
                                              guardian_mobile: e.target.value
                                                .replace(/\D/g, "")
                                                .slice(0, 10),
                                            })
                                          }
                                        />
                                      </Field>
                                      <Field label="Guardian Address" required>
                                        <Input
                                          value={ct.guardian_address ?? ""}
                                          onChange={(e) =>
                                            upd({ guardian_address: e.target.value })
                                          }
                                        />
                                      </Field>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="border-t border-border pt-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            References
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                references: [
                                  ...f.references,
                                  { name: "", relation_type: "", mobile: "", address: "" },
                                ],
                              }))
                            }
                          >
                            <Plus className="mr-1 h-4 w-4" /> Add Reference
                          </Button>
                        </div>
                        {form.references.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No references.</p>
                        ) : (
                          <div className="space-y-3">
                            {form.references.map((ref, i) => (
                              <div
                                key={i}
                                className="rounded-lg border border-border bg-secondary/30 p-2.5 sm:p-3"
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    Reference #{i + 1}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setForm((f) => ({
                                        ...f,
                                        references: f.references.filter((_, idx) => idx !== i),
                                      }))
                                    }
                                  >
                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                  </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <Field label="Name">
                                    <Input
                                      value={ref.name}
                                      onChange={(e) =>
                                        setForm((f) => ({
                                          ...f,
                                          references: f.references.map((r, idx) =>
                                            idx === i ? { ...r, name: e.target.value } : r,
                                          ),
                                        }))
                                      }
                                    />
                                  </Field>
                                  <Field label="Relation Type">
                                    <Select
                                      value={ref.relation_type || undefined}
                                      onValueChange={(v) =>
                                        setForm((f) => ({
                                          ...f,
                                          references: f.references.map((r, idx) =>
                                            idx === i ? { ...r, relation_type: v } : r,
                                          ),
                                        }))
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Family / Friend / …" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {RELATION_TYPES.map((r) => (
                                          <SelectItem key={r} value={r}>
                                            {r}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                  <Field label="Mobile">
                                    <Input
                                      value={ref.mobile}
                                      inputMode="numeric"
                                      onChange={(e) =>
                                        setForm((f) => ({
                                          ...f,
                                          references: f.references.map((r, idx) =>
                                            idx === i
                                              ? {
                                                  ...r,
                                                  mobile: e.target.value
                                                    .replace(/\D/g, "")
                                                    .slice(0, 10),
                                                }
                                              : r,
                                          ),
                                        }))
                                      }
                                    />
                                  </Field>
                                  <Field label="Address">
                                    <Input
                                      value={ref.address}
                                      onChange={(e) =>
                                        setForm((f) => ({
                                          ...f,
                                          references: f.references.map((r, idx) =>
                                            idx === i ? { ...r, address: e.target.value } : r,
                                          ),
                                        }))
                                      }
                                    />
                                  </Field>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Section>
                  )}

                  {at("bank") && (
                    <Section title="Bank Details">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Account Holder Name">
                          <Input
                            value={form.bank_account_holder}
                            onChange={(e) => set("bank_account_holder", e.target.value)}
                            placeholder="As per bank records"
                          />
                        </Field>
                        <Field label="Account Number" required anchor="bank_account_number">
                          <Input
                            value={form.bank_account_number}
                            inputMode="numeric"
                            onChange={(e) => {
                              setBankVerified(false);
                              set(
                                "bank_account_number",
                                e.target.value.replace(/\D/g, "").slice(0, 18),
                              );
                            }}
                            className="font-mono"
                          />
                        </Field>
                        <Field label="IFSC Code" required anchor="bank_ifsc">
                          <Input
                            value={form.bank_ifsc}
                            onChange={(e) => {
                              setBankVerified(false);
                              set("bank_ifsc", e.target.value.toUpperCase().slice(0, 11));
                            }}
                            placeholder="e.g. SBIN0001234"
                            className="font-mono uppercase"
                          />
                        </Field>
                        <Field label="Bank Name">
                          <Input
                            value={form.bank_name}
                            onChange={(e) => set("bank_name", e.target.value)}
                          />
                        </Field>
                        <Field label="Branch">
                          <Input
                            value={form.bank_branch}
                            onChange={(e) => set("bank_branch", e.target.value)}
                          />
                        </Field>
                        <Field label="Account Type">
                          <Select
                            value={form.bank_account_type || undefined}
                            onValueChange={(v) => set("bank_account_type", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {BANK_ACCOUNT_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <div className="sm:col-span-2">
                          {verificationEnabled && (
                            <BankVerify
                              accountNumber={form.bank_account_number}
                              ifsc={form.bank_ifsc}
                              name={form.bank_account_holder || form.full_name}
                              verified={bankVerified}
                              onVerified={(result) => {
                                setBankVerified(true);
                                setForm((f) => ({
                                  ...f,
                                  bank_account_holder: f.bank_account_holder || result.full_name,
                                  bank_name: result.bank_name || f.bank_name,
                                  bank_branch: result.branch || f.bank_branch,
                                  other_info: {
                                    ...(f.other_info ?? {}),
                                    bank_verified: true,
                                    bank_verified_at: new Date().toISOString(),
                                    bank_verified_account: result.account_number,
                                    bank_verified_ifsc: result.ifsc,
                                    bank_verified_name: result.full_name,
                                    bank_micr: result.micr,
                                    bank_city: result.city,
                                  },
                                }));
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </Section>
                  )}

                  {at("address") && (
                    <Section title="Permanent Address (auto-filled from Aadhaar)">
                      <CandidateAddressFields
                        block={{
                          address1: form.permanent_address1,
                          address2: form.permanent_address2,
                          landmark: form.permanent_landmark,
                          pincode: form.permanent_pincode,
                          city: form.permanent_city,
                          district: form.permanent_district,
                          state: form.permanent_state,
                          country: form.permanent_country,
                        }}
                        anchorPrefix="permanent"
                        requireFullAddress
                        onChange={(patch) => {
                          setForm((f) => {
                            const next = { ...f };
                            for (const [k, v] of Object.entries(patch)) {
                              const key = `permanent_${k}` as keyof CandidateForm;
                              (next as Record<string, unknown>)[key] = v;
                            }
                            if (f.same_as_permanent) {
                              for (const [k, v] of Object.entries(patch)) {
                                const key = `present_${k}` as keyof CandidateForm;
                                (next as Record<string, unknown>)[key] = v;
                              }
                            }
                            return next;
                          });
                        }}
                      />
                    </Section>
                  )}

                  {at("address") && (
                    <Section title="Present Address">
                      <label className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-3 cursor-pointer">
                        <span className="text-sm font-medium leading-snug">
                          Same as permanent address
                        </span>
                        <Switch
                          className="shrink-0"
                          checked={form.same_as_permanent}
                          onCheckedChange={(v) => set("same_as_permanent", v)}
                        />
                      </label>

                      {!form.same_as_permanent && (
                        <>
                          <CandidateAddressFields
                            block={{
                              address1: form.present_address1,
                              address2: form.present_address2,
                              landmark: form.present_landmark,
                              pincode: form.present_pincode,
                              city: form.present_city,
                              district: form.present_district,
                              state: form.present_state,
                              country: form.present_country,
                            }}
                            anchorPrefix="present"
                            onChange={(patch) =>
                              setForm((f) => {
                                const next = { ...f };
                                for (const [k, v] of Object.entries(patch)) {
                                  const key = `present_${k}` as keyof CandidateForm;
                                  (next as Record<string, unknown>)[key] = v;
                                }
                                return next;
                              })
                            }
                          />
                        </>
                      )}
                    </Section>
                  )}

                  {at("assignment") && (
                    <Section title="Assignment">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Application Date">
                          <DatePickerInput
                            value={form.application_date}
                            onChange={(v) => set("application_date", v ?? "")}
                          />
                        </Field>
                        <Field label="Preferred Joining Date">
                          <DatePickerInput
                            value={form.preferred_joining_date ?? ""}
                            onChange={(v) => set("preferred_joining_date", v)}
                            startYear={2000}
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          {isEmployeeMode ? (
                            <Field
                              required
                              label={`Work mapping${operationalMappings.length > 0 ? ` · ${operationalMappings.length}` : ""}`}
                            >
                              <OperationalMappingPicker
                                units={units}
                                customers={wizardCustomers}
                                value={operationalMappings}
                                onChange={setOperationalMappings}
                                loading={unitsLoading}
                                error={unitsError}
                                onRetry={() => void qc.invalidateQueries({ queryKey: QK_UNITS })}
                              />
                            </Field>
                          ) : (
                            <Field
                              required
                              label={`Clients${form.unit_ids.length > 0 ? ` · ${form.unit_ids.length}` : ""}`}
                            >
                              <MultiUnitPicker
                                units={units}
                                value={form.unit_ids}
                                onChange={(ids) => setForm((f) => ({ ...f, unit_ids: ids }))}
                                disabled={unitsLoading || !!unitsError}
                                emptyMessage={
                                  unitsError
                                    ? `Could not load units: ${unitsError}`
                                    : "No clients available."
                                }
                              />
                            </Field>
                          )}
                        </div>
                        {!isEmployeeMode && form.unit_ids.length > 0 && (
                          <div className="sm:col-span-2">
                            <Field label="Client designations">
                              <div className="space-y-2 rounded-md border border-input bg-muted/20 p-2">
                                {form.unit_ids.map((uid, idx) => {
                                  const u = units.find((x) => x.id === uid);
                                  return (
                                    <div key={uid} className="flex flex-wrap items-center gap-2">
                                      <span className="min-w-0 flex-1 basis-full truncate text-sm sm:basis-auto sm:min-w-[180px]">
                                        {u?.name ?? uid}
                                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                          {idx === 0 ? "Primary" : "Reliever · ED"}
                                        </span>
                                      </span>
                                      <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[220px]">
                                        <UnitDesignationSelect
                                          unitId={uid}
                                          value={(form.unit_designations ?? {})[uid] ?? null}
                                          onChange={(id) =>
                                            setForm((f) => ({
                                              ...f,
                                              unit_designations: {
                                                ...(f.unit_designations ?? {}),
                                                [uid]: id,
                                              },
                                              designation_id: idx === 0 ? id : f.designation_id,
                                            }))
                                          }
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </Field>
                          </div>
                        )}

                        {editing &&
                          ["guard", "security_guard"].includes(
                            (editing as { role_key?: string })?.role_key ?? "",
                          ) && (
                            <div className="sm:col-span-2">
                              <GuardReportingManagersEditor
                                candidateId={editing.id}
                                candidateName={editing.full_name || editing.employee_code || ""}
                              />
                            </div>
                          )}
                        {editing &&
                          !["guard", "security_guard", "admin", "super_admin"].includes(
                            (editing as { role_key?: string })?.role_key ?? "",
                          ) && (
                            <div className="sm:col-span-2">
                              <ReportsToPicker
                                value={form.reports_to ?? null}
                                selfId={editing.id}
                                onChange={(id) => setForm((f) => ({ ...f, reports_to: id }))}
                              />
                            </div>
                          )}

                        {!isEmployeeMode && (
                          <div className="sm:col-span-2">
                            <Field
                              label={`Organizations${(() => {
                                const orgs = Array.from(
                                  new Set(
                                    form.unit_ids
                                      .map((id) => units.find((u) => u.id === id)?.customer_name)
                                      .filter(Boolean) as string[],
                                  ),
                                );
                                return orgs.length > 0 ? ` · ${orgs.length}` : "";
                              })()}`}
                            >
                              <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-muted/30 p-2 min-h-[44px]">
                                {(() => {
                                  const orgs = Array.from(
                                    new Set(
                                      form.unit_ids
                                        .map((id) => units.find((u) => u.id === id)?.customer_name)
                                        .filter(Boolean) as string[],
                                    ),
                                  );
                                  if (orgs.length === 0) {
                                    return (
                                      <span className="self-center px-1 text-sm text-muted-foreground">
                                        Select a client first.
                                      </span>
                                    );
                                  }
                                  return orgs.map((org) => (
                                    <Badge key={org} variant="secondary" className="font-normal">
                                      {org}
                                    </Badge>
                                  ));
                                })()}
                              </div>
                            </Field>
                          </div>
                        )}
                        <Field
                          required
                          label={
                            isEmployeeMode
                              ? "Designation"
                              : form.unit_ids.length === 0
                                ? "Designation · select client first"
                                : "Primary designation"
                          }
                        >
                          <DesignationPicker
                            designations={filteredDesignations}
                            value={form.designation_id}
                            onChange={(id) => {
                              setForm((current) => ({
                                ...current,
                                designation_id: id,
                                unit_designations: current.unit_ids[0]
                                  ? {
                                      ...(current.unit_designations ?? {}),
                                      [current.unit_ids[0]]: id,
                                    }
                                  : current.unit_designations,
                              }));
                              markDirty();
                            }}
                            disabled={
                              designationsLoading ||
                              !!designationsError ||
                              (!isEmployeeMode &&
                                (form.unit_ids.length === 0 || contractDesigQuery.isLoading))
                            }
                            emptyMessage={
                              designationsError
                                ? `Could not load designations: ${designationsError}`
                                : form.unit_ids.length === 0
                                  ? "Select a client first."
                                  : contractDesigQuery.isLoading
                                    ? "Loading designations from unit contract…"
                                    : "No enabled designations are available."
                            }
                          />
                          {!isEmployeeMode &&
                            form.designation_id &&
                            !contractDesigQuery.isLoading &&
                            !allowedDesignationIds.includes(form.designation_id) && (
                              <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                This designation is not yet in the primary unit contract. Finance
                                will receive a seven-day follow-up after onboarding.
                              </p>
                            )}
                        </Field>
                        {isEmployeeMode && (
                          <Field label="Department">
                            <Select
                              value={form.department_id ?? "__none"}
                              onValueChange={(v) => set("department_id", v === "__none" ? null : v)}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder="Select department" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">— None —</SelectItem>
                                {departments.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        )}

                        {isEmployeeMode && (
                          <Field label="Role" required>
                            <Select
                              value={form.role_key || "__none"}
                              onValueChange={(v) => set("role_key", v === "__none" ? "" : v)}
                            >
                              <SelectTrigger
                                className={cn("h-10", !form.role_key && "border-amber-400/70")}
                              >
                                <SelectValue placeholder="Select role (e.g. Operations)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">— Select role —</SelectItem>
                                {rolesList.map((r) => (
                                  <SelectItem key={r.key} value={r.key}>
                                    {r.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className="text-[11px] text-muted-foreground">
                              Determines what this employee can access in the app (e.g. Operations,
                              HR, Field Officer).
                            </span>
                          </Field>
                        )}

                        {editing?.id ? (
                          <Field label="Additional Designations">
                            <CandidateDesignationsEditor
                              candidateId={editing.id}
                              primaryDesignationId={form.designation_id}
                              designations={designations}
                            />
                          </Field>
                        ) : null}

                        {editing &&
                        (editing.status === "approved" ||
                          editing.status === "active" ||
                          editing.status === "inactive") ? (
                          <Field label="Status">
                            <Select
                              value={form.status}
                              onValueChange={(v) => {
                                if (
                                  v === "inactive" &&
                                  form.status !== "inactive" &&
                                  onRequestOffboard
                                ) {
                                  onRequestOffboard();
                                  return;
                                }
                                if (v === "active" && form.status === "inactive" && form.no_hire) {
                                  toast.error(
                                    "This employee is flagged Do not re-hire and cannot be reactivated.",
                                  );
                                  return;
                                }
                                set("status", v);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value="active"
                                  disabled={form.status === "inactive" && form.no_hire}
                                >
                                  Active
                                </SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                        ) : (
                          <Field label="Approval status">
                            <div className="flex h-10 items-center rounded-md border border-border bg-secondary/40 px-3 text-sm text-muted-foreground">
                              Pending approval
                            </div>
                          </Field>
                        )}
                        <div className="sm:col-span-2">
                          <Field
                            label={`Assigned Assets${form.assigned_asset_ids.length > 0 ? ` · ${form.assigned_asset_ids.length} selected` : ""}`}
                          >
                            <AssetMultiPicker
                              assets={assets}
                              value={form.assigned_asset_ids}
                              onChange={(ids) =>
                                setForm((f) => ({ ...f, assigned_asset_ids: ids }))
                              }
                              sizes={
                                (form.other_info?.uniform_sizes ?? {}) as Record<string, string>
                              }
                              onSizesChange={(next) =>
                                setForm((f) => ({
                                  ...f,
                                  other_info: { ...(f.other_info ?? {}), uniform_sizes: next },
                                }))
                              }
                              uniformIncluded={(() => {
                                const ids =
                                  form.unit_ids.length > 0
                                    ? form.unit_ids
                                    : form.unit_id
                                      ? [form.unit_id]
                                      : [];
                                if (ids.length === 0) return true;
                                return ids.every((id) => {
                                  const u = units.find((x) => x.id === id);
                                  return u ? u.uniform_included !== false : true;
                                });
                              })()}
                              uniformFeeAmount={(() => {
                                const ids =
                                  form.unit_ids.length > 0
                                    ? form.unit_ids
                                    : form.unit_id
                                      ? [form.unit_id]
                                      : [];
                                let max = 0;
                                for (const id of ids) {
                                  const u = units.find((x) => x.id === id);
                                  if (u && u.uniform_included === false) {
                                    max = Math.max(max, Number(u.uniform_fee_amount ?? 0) || 0);
                                  }
                                }
                                return max;
                              })()}
                            />
                          </Field>
                        </div>

                        {isEmployeeMode && (
                          <div className="sm:col-span-2 flex items-start justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3">
                            <div className="min-w-0 flex-1">
                              <Label className="m-0 block">Do not re-hire</Label>
                              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                                Blocks future hiring.
                              </p>
                            </div>
                            <Switch
                              className="mt-0.5 shrink-0"
                              checked={form.no_hire}
                              onCheckedChange={(v) => set("no_hire", v)}
                            />
                          </div>
                        )}
                      </div>
                    </Section>
                  )}

                  {at("records") && (
                    <Section title="Compliance">
                      <ComplianceSection
                        form={form}
                        setSection={setSection}
                        esicBranches={esicBranches}
                      />
                    </Section>
                  )}

                  {at("records") && (
                    <Section title="Knowledge & Experience">
                      <KnowledgeSection form={form} set={setAny} />
                    </Section>
                  )}

                  {at("records") && (
                    <Section title="Physical & Health">
                      <PhysicalSection form={form} setSection={setSection} />
                    </Section>
                  )}

                  {at("records") && (
                    <Section title="Identification Proofs">
                      <IdentificationSection
                        form={form}
                        set={setAny}
                        setSection={setSection}
                        hideWeapon={isEmployeeMode}
                      />
                    </Section>
                  )}

                  {at("records") && isEmployeeMode && (
                    <Section title="Criminal History">
                      <CriminalSection form={form} set={setAny} />
                    </Section>
                  )}

                  {at("wages") && (
                    <Section title="Wages">
                      {wageUnitIds.length === 0 ? (
                        <div className="rounded-xl border border-input bg-muted/20 p-3 text-xs text-muted-foreground">
                          Assign a unit first.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {wageUnitIds.length > 1 && (
                            <div className="flex flex-wrap gap-1.5">
                              {wageUnitIds.map((uid) => {
                                const u = units.find((x) => x.id === uid);
                                const has = !!wagesByUnit[uid];
                                return (
                                  <button
                                    key={uid}
                                    type="button"
                                    onClick={() => setActiveWageUnit(uid)}
                                    className={cn(
                                      "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                                      activeWageUnit === uid
                                        ? "border-primary bg-primary/10 text-foreground"
                                        : "border-input bg-muted/20 text-muted-foreground hover:text-foreground",
                                    )}
                                  >
                                    {u?.name ?? "Client"}
                                    <span className="ml-1.5 opacity-70">{has ? "✓" : "—"}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {activeWage ? (
                            <div className="rounded-xl border border-input bg-muted/20 p-3 sm:p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-xs text-muted-foreground">
                                  {units.find((x) => x.id === activeWageUnit)?.name ?? "Unit"}
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Remove wages"
                                  onClick={() => setActiveWage(null)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              <InlineWageEditor
                                value={activeWage ?? EMPTY_WAGE}
                                onChange={setActiveWage}
                              />
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-input bg-muted/20 p-3">
                              <p className="text-xs text-muted-foreground">No wages added.</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setActiveWage({
                                    ...EMPTY_WAGE,
                                    components: [],
                                    deductions: [],
                                    employerContributions: [],
                                  })
                                }
                              >
                                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Wages
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </Section>
                  )}

                  {/* Uploads strip */}
                  {at("uploads") && (
                    <Section title={`Documents${uploadsComplete ? "" : " · incomplete"}`}>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <UploadTile
                          label="Photograph"
                          required
                          url={form.photo_url}
                          accept="image/*"
                          allowCamera
                          onPick={(f) => handleFile(f, "photo")}
                          uploading={uploading === "photo"}
                        />
                        <UploadTile
                          label="Aadhaar Card"
                          required={!digilockerVerified}
                          url={form.aadhaar_image_url}
                          accept="image/*,application/pdf"
                          onPick={(f) => handleFile(f, "aadhaar")}
                          uploading={uploading === "aadhaar"}
                        />
                        <UploadTile
                          label="PAN Card"
                          required
                          url={form.pan_image_url}
                          accept="image/*,application/pdf"
                          onPick={(f) => handleFile(f, "pan")}
                          uploading={uploading === "pan"}
                        />
                        <UploadTile
                          label="Signature"
                          required
                          url={form.signature_url}
                          accept="image/*,application/pdf"
                          onPick={(f) => handleFile(f, "signature")}
                          uploading={uploading === "signature"}
                        />
                      </div>
                    </Section>
                  )}

                  {at("review") && (
                    <Section title="Review & submit">
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {(
                            [
                              ["Name", form.full_name],
                              ["Mobile", form.mobile],
                              ["Aadhaar", form.aadhaar_number],
                              ["PAN", form.pan_number],
                              ["Bank A/c", form.bank_account_number],
                              ["Unit", units.find((u) => u.id === form.unit_ids[0])?.name ?? ""],
                            ] as Array<[string, string]>
                          ).map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-xl border border-border/70 bg-secondary/20 p-2.5"
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {label}
                              </p>
                              <p className="truncate text-sm font-medium">{value || "—"}</p>
                            </div>
                          ))}
                        </div>
                        {profileComplete ? (
                          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                            Everything looks complete — submit for approval.
                          </p>
                        ) : (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                              {completionTotal - completionDone} required field(s) still missing
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {completionChecks
                                .filter((c) => !c.ok)
                                .map((c) => (
                                  <Badge
                                    key={c.key}
                                    variant="outline"
                                    className="border-amber-400/50 bg-card text-[10px]"
                                  >
                                    {c.key}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Section>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border/60 bg-card/95 px-3 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:sticky sm:bottom-0 sm:z-10 sm:flex-col sm:items-stretch sm:justify-between sm:px-6 sm:py-3 sm:pb-3">
            {saveError && (
              <div
                role="alert"
                className="w-full rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{saveError.title}</div>
                    {saveError.detail && (
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed opacity-90">
                        {saveError.detail}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSaveError(null)}
                    className="h-7 w-7 shrink-0 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <div className="hidden flex-wrap items-center gap-2 sm:mr-auto sm:flex">
                <Button variant="outline" onClick={() => void requestClose()} className="h-10">
                  Cancel
                </Button>
                {canReview && (
                  <>
                    <Button
                      onClick={() => onApprove?.()}
                      disabled={isApproving || submitting || savingDraft || !!uploading}
                      className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-10 sm:flex-none"
                      title="Approve & assign Employee ID"
                    >
                      {isApproving ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 h-4 w-4" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onReject?.()}
                      disabled={submitting || savingDraft || !!uploading}
                      className="h-11 flex-1 border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-50 hover:text-rose-600 sm:h-10 sm:flex-none dark:border-rose-500/40 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-2">
                {!isLastStep ? (
                  <Button
                    type="button"
                    onClick={goNext}
                    className="col-span-2 h-10 min-w-0 rounded-lg bg-accent px-3 text-accent-foreground hover:bg-accent/90 sm:order-last sm:col-span-1 sm:flex-none sm:px-4"
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={submit}
                    disabled={submitting || savingDraft || !!uploading}
                    title={
                      !editing && !profileComplete
                        ? `Tip: complete all ${completionTotal} required fields (${completionPct}% done)`
                        : undefined
                    }
                    className="col-span-2 h-10 min-w-0 rounded-lg px-3 sm:order-last sm:col-span-1 sm:flex-none sm:px-4"
                  >
                    {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    {editing ? "Save changes" : "Submit"}
                  </Button>
                )}
                {stepIndex > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    disabled={submitting || savingDraft || !!uploading}
                    className="h-9 min-w-0 rounded-lg px-3 text-xs sm:h-10 sm:flex-none sm:px-4 sm:text-sm"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={saveDraft}
                  disabled={savingDraft || submitting || !!uploading}
                  className={cn(
                    "h-9 min-w-0 rounded-lg px-3 text-xs sm:h-10 sm:flex-none sm:px-4 sm:text-sm",
                    stepIndex === 0 && "col-span-2 sm:col-span-1",
                  )}
                >
                  {savingDraft && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Save Draft
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InvalidFieldContext.Provider>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 bg-card px-1 py-4 last:border-b-0 sm:rounded-xl sm:border sm:px-6 sm:py-6">
      <div className="mb-5 text-base font-semibold text-foreground">{title}</div>
      <SectionHeaderContext.Provider value={{ hideHeader: true }}>
        {children}
      </SectionHeaderContext.Provider>
    </section>
  );
}

const InvalidFieldContext = createContext<string | null>(null);

function Field({
  label,
  required,
  anchor,
  children,
}: {
  label: string;
  required?: boolean;
  anchor?: string;
  children: React.ReactNode;
}) {
  const invalidAnchor = useContext(InvalidFieldContext);
  const invalid = !!anchor && invalidAnchor === anchor;
  return (
    <div
      id={anchor ? `fld-${anchor}` : undefined}
      data-invalid={invalid ? "true" : undefined}
      className={cn(
        "min-w-0",
        invalid &&
          "rounded-lg bg-destructive/5 p-2 ring-2 ring-destructive/50 [&_input]:border-destructive [&_button]:border-destructive",
      )}
    >
      <Label className="mb-2 block text-[13px] font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {invalid && <p className="mt-1.5 text-xs font-medium text-destructive">Check this field</p>}
    </div>
  );
}

function DatePickerInput({
  value,
  onChange,
  placeholder = "Pick a date",
  startYear = 1940,
  endYear,
  disableFuture = false,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  placeholder?: string;
  startYear?: number;
  endYear?: number;
  disableFuture?: boolean;
}) {
  const parsed = value ? parseISO(value) : undefined;
  const end = endYear ? new Date(endYear, 11, 31) : new Date(new Date().getFullYear() + 5, 11, 31);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !parsed && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {parsed ? formatDateFns(parsed, "dd MMM yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-[210]" align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          selected={parsed}
          defaultMonth={parsed ?? new Date()}
          startMonth={new Date(startYear, 0)}
          endMonth={end}
          disabled={disableFuture ? (d) => d > new Date() : undefined}
          onSelect={(d) => onChange(d ? formatDateFns(d, "yyyy-MM-dd") : null)}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

function CandidateAddressFields({
  block,
  onChange,
  anchorPrefix,
  requireFullAddress = false,
}: {
  block: AddressBlock;
  onChange: (patch: Partial<AddressBlock>) => void;
  anchorPrefix?: string;
  requireFullAddress?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="District"
        required
        anchor={anchorPrefix ? `${anchorPrefix}_district` : undefined}
      >
        <Input value={block.district} onChange={(e) => onChange({ district: e.target.value })} />
      </Field>
      <Field label="Address line 1" required={requireFullAddress}>
        <Input value={block.address1} onChange={(e) => onChange({ address1: e.target.value })} />
      </Field>
      <Field label="Address line 2">
        <Input value={block.address2} onChange={(e) => onChange({ address2: e.target.value })} />
      </Field>
      <Field label="Landmark">
        <Input value={block.landmark} onChange={(e) => onChange({ landmark: e.target.value })} />
      </Field>
      <Field label="Pincode" required={requireFullAddress}>
        <Input
          value={block.pincode}
          inputMode="numeric"
          maxLength={6}
          onChange={(e) => onChange({ pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
        />
      </Field>
      <Field label="City">
        <Input value={block.city} onChange={(e) => onChange({ city: e.target.value })} />
      </Field>
      <Field label="State">
        <Input value={block.state} onChange={(e) => onChange({ state: e.target.value })} />
      </Field>
      <Field label="Country">
        <Input value={block.country} onChange={(e) => onChange({ country: e.target.value })} />
      </Field>
    </div>
  );
}

function UploadTile({
  label,
  required,
  url,
  accept = "image/*",
  allowCamera = false,
  onPick,
  uploading,
  badge,
}: {
  label: string;
  required?: boolean;
  url: string;
  accept?: string;
  allowCamera?: boolean;
  onPick: (f: File | null) => void;
  uploading: boolean;
  badge?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const isPdf = !!url && /\.pdf(\?|$)/i.test(url);
  const done = !!url;
  return (
    <div
      className={cn(
        "relative flex min-h-48 flex-col items-center gap-3 rounded-xl border p-3 transition-colors",
        done
          ? "border-primary/25 bg-primary/5"
          : required
            ? "border-destructive/30 bg-background"
            : "border-border/70 bg-background",
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </div>
        {done && <CheckCircle2 className="h-4 w-4 text-primary" />}
      </div>
      <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-secondary/30">
        {url ? (
          isPdf ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileText className="h-8 w-8" />
              <span>View PDF</span>
            </a>
          ) : (
            <img src={url} alt={label} className="h-full w-full object-contain" />
          )
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          onPick(f);
        }}
      />
      {allowCamera ? (
        <div className="grid w-full grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCameraOpen(true)}
            disabled={uploading}
            className="min-w-0 px-2"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Camera className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Take</span>
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="min-w-0 px-2"
          >
            <Upload className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Upload</span>
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full min-w-0 px-2"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">{badge ?? "Uploading…"}</span>
            </>
          ) : (
            <span className="truncate">{url ? "Replace" : "Upload (Image or PDF)"}</span>
          )}
        </Button>
      )}
      {allowCamera && (
        <CameraCaptureDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          onCapture={(file) => {
            setCameraOpen(false);
            onPick(file);
          }}
        />
      )}
    </div>
  );
}

function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API not available in this browser");
        }
        if (!window.isSecureContext) {
          throw new Error("Camera requires a secure (HTTPS) context.");
        }
        // On many Windows laptops / desktop webcams the `facingMode` constraint
        // is not supported and getUserMedia rejects with OverconstrainedError.
        // Try the preferred constraints first, then progressively relax.
        const attempts: MediaStreamConstraints[] = [
          {
            video: {
              facingMode: { ideal: facing },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false },
        ];
        let stream: MediaStream | null = null;
        let lastErr: unknown = null;
        for (const constraints of attempts) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (err) {
            lastErr = err;
            const name = (err as { name?: string })?.name;
            // Retry on constraint/availability failures — e.g. a phone-as-webcam
            // disconnects (NotReadableError/AbortError) or doesn't match the
            // requested facingMode (OverconstrainedError).
            if (
              name !== "OverconstrainedError" &&
              name !== "ConstraintNotSatisfiedError" &&
              name !== "NotFoundError" &&
              name !== "NotReadableError" &&
              name !== "AbortError"
            ) {
              throw err;
            }
          }
        }
        if (!stream) throw lastErr ?? new Error("Could not start camera");
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // The <video> element lives inside a Radix Dialog portal that mounts
        // asynchronously — poll briefly for the ref before attaching the stream.
        const attach = async () => {
          for (let i = 0; i < 40; i++) {
            if (cancelled) return;
            const v = videoRef.current;
            if (v) {
              v.srcObject = stream;
              v.onloadedmetadata = () => {
                v.play().catch(() => {});
                setReady(true);
              };
              try {
                await v.play();
              } catch {
                /* autoplay may need user gesture */
              }
              if (v.readyState >= 1) setReady(true);
              return;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
        };
        await attach();
      } catch (e: unknown) {
        const err = e as { name?: string; message?: string };
        if (err.name === "NotAllowedError" || err.name === "SecurityError") {
          setError(
            "Camera permission denied. Click the camera icon in the browser address bar and allow access, then retry.",
          );
        } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
          setError("No compatible camera found on this device.");
        } else if (err.name === "NotReadableError") {
          setError(
            "Camera is in use by another application (e.g. Teams, Zoom). Close it and retry.",
          );
        } else {
          setError(err.message || "Could not start camera");
        }
      }
    })();

    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, facing]);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[200] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Take Photograph</DialogTitle>
          <DialogDescription>Position the subject and click Capture.</DialogDescription>
        </DialogHeader>
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-contain ${error ? "hidden" : ""}`}
          />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-300">
              {error}
            </div>
          )}
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting camera…
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            disabled={!!error}
          >
            Switch camera ({facing === "user" ? "front" : "back"})
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={snap} disabled={!ready || !!error}>
              <Camera className="mr-1.5 h-4 w-4" /> Capture
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnitPicker({
  units,
  value,
  onChange,
  disabled = false,
  emptyMessage = "No clients found.",
}: {
  units: UnitLite[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = value ? units.find((u) => u.id === value) : null;
  const filteredUnits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return units;
    return units.filter((unit) =>
      [unit.code, unit.name, unit.customer_name ?? "", unit.id].some((part) =>
        part.toLowerCase().includes(needle),
      ),
    );
  }, [query, units]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
          onMouseDown={(e) => e.preventDefault()}
        >
          {selected ? (
            <span className="truncate">
              <b>{selected.code}</b> · {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Search unit by code or name…</span>
          )}
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(420px,calc(100vw-1rem))] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef.current?.focus({ preventScroll: true });
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search clients…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filteredUnits.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.code} ${u.name} ${u.customer_name ?? ""}`}
                  onSelect={() => {
                    onChange(u.id);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      <b>{u.code}</b> · {u.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{u.customer_name}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------- Offboarding Dialog ---------------- //

const ABSCONDING_NAMES = new Set(["absconding", "abscond", "absconded"]);

function OffboardingDialog({
  target,
  reasons,
  reasonsLoading,
  assets,
  initialReasonId,
  isSubmitting,
  currentUserCandidateId,
  isFieldOfficer,
  onClose,
  onSubmit,
}: {
  target: CandidateListItem | null;
  reasons: { id: string; name: string }[];
  reasonsLoading: boolean;
  assets: { id: string; name: string; category: string }[];
  initialReasonId: string;
  isSubmitting: boolean;
  currentUserCandidateId: string | null;
  isFieldOfficer: boolean;
  onClose: () => void;
  onSubmit: (args: { reasonId: string; details: OffboardingDetails; noHire: boolean }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [reasonId, setReasonId] = useState<string>(initialReasonId);
  const [dateOfOffboarding, setDateOfOffboarding] = useState<string>(today);
  const [dateOfResignation, setDateOfResignation] = useState<string>("");
  const [dateOfLastWorking, setDateOfLastWorking] = useState<string>("");
  const [dateOfPfUpdate, setDateOfPfUpdate] = useState<string>("");
  const [dateOfEsicUpdate, setDateOfEsicUpdate] = useState<string>("");
  const [reasonText, setReasonText] = useState<string>("");
  const [review, setReview] = useState<string>("");
  const [assetReturns, setAssetReturns] = useState<OffboardingAssetReturn[]>([]);
  const [invReturns, setInvReturns] = useState<OffboardingInventoryReturn[]>([]);
  const [returnDestKey, setReturnDestKey] = useState<string>(""); // "type:id"
  const [rating, setRating] = useState<number>(0);
  const [ratingRemarks, setRatingRemarks] = useState<string>("");
  const [noHire, setNoHire] = useState<boolean>(false);
  const [noHireTouched, setNoHireTouched] = useState<boolean>(false);

  // Fetch inventory currently held by this guard (balances at guard location = candidate.id)
  const balancesQ = useQuery({
    queryKey: ["offboard-inv-balances", target?.id],
    enabled: !!target?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_stock_balances" as never)
        .select("item_id,size_value,qty,inv_items(name,unit)")
        .eq("location_type", "guard")
        .eq("location_id", target!.id)
        .gt("qty", 0);
      if (error) throw error;
      return (
        (data as unknown as Array<{
          item_id: string;
          size_value: string;
          qty: number;
          inv_items: { name: string; unit: string } | null;
        }>) ?? []
      );
    },
  });

  // Last present day from the attendance system (muster roll + self punches)
  const lastPresentQ = useQuery({
    queryKey: ["offboard-last-present", target?.id],
    enabled: !!target?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const [entries, punches] = await Promise.all([
        supabase
          .from("attendance_entries" as never)
          .select("entry_date,code")
          .eq("candidate_id", target!.id)
          .in("code", ["P", "HD", "OT"])
          .order("entry_date", { ascending: false })
          .limit(1),
        supabase
          .from("self_attendance_punches" as never)
          .select("punch_date,check_in_at")
          .eq("candidate_id", target!.id)
          .not("check_in_at", "is", null)
          .order("punch_date", { ascending: false })
          .limit(1),
      ]);
      if (entries.error) throw entries.error;
      if (punches.error) throw punches.error;
      const a = (entries.data as unknown as Array<{ entry_date: string }>)?.[0]?.entry_date ?? "";
      const b = (punches.data as unknown as Array<{ punch_date: string }>)?.[0]?.punch_date ?? "";
      const best = [a, b].filter(Boolean).sort().pop() ?? "";
      return best;
    },
  });

  // Fetch active Field Officers — the offboarding collection MUST be received by an FO

  const fieldOfficersQ = useQuery({
    queryKey: ["offboard-field-officers"],
    enabled: !!target?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,role_key,is_enabled,status")
        .eq("role_key", "field_officer")
        .eq("is_enabled", true)
        .eq("status", "active")
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (
        (data as unknown as Array<{ id: string; full_name: string; employee_code: string }>) ?? []
      );
    },
  });

  // Reset when target changes
  useEffect(() => {
    if (!target) return;
    setReasonId(initialReasonId || "");
    setDateOfOffboarding(today);
    setDateOfResignation("");
    setDateOfLastWorking("");
    setDateOfPfUpdate("");
    setDateOfEsicUpdate("");
    setReasonText("");
    setReview("");
    const prefill = (target.assigned_asset_ids ?? []).map((id) => ({
      asset_id: id,
      returned: false,
      remarks: "",
    }));
    setAssetReturns(prefill);
    setInvReturns([]);
    setReturnDestKey("");
    setRating(0);
    setRatingRemarks("");
    setNoHire(false);
    setNoHireTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // Default last working day = last present day from attendance
  const lastPresent = lastPresentQ.data ?? "";
  useEffect(() => {
    if (lastPresent) setDateOfLastWorking((prev) => prev || lastPresent);
  }, [lastPresent]);

  // Build default destination (Field Officer) + inv return rows once data loads
  useEffect(() => {
    if (!target) return;
    const bal = balancesQ.data ?? [];
    if (bal.length === 0) {
      setInvReturns([]);
      return;
    }
    const fos = fieldOfficersQ.data ?? [];
    // Prefer the guard's reports_to (their FO); else the current-user FO; else the first FO in list.
    let foId = "";
    let foLabel = "";
    const reports = target.reports_to ?? null;
    const preferred =
      (reports && fos.find((f) => f.id === reports)) ||
      (isFieldOfficer &&
        currentUserCandidateId &&
        fos.find((f) => f.id === currentUserCandidateId)) ||
      fos[0];
    if (preferred) {
      foId = preferred.id;
      foLabel = `Field Officer · ${preferred.full_name}${preferred.employee_code ? " · " + preferred.employee_code : ""}`;
    }
    const key = foId ? `field_officer:${foId}` : "";
    setReturnDestKey(key);
    setInvReturns(
      bal.map((b) => ({
        item_id: b.item_id,
        item_name: b.inv_items?.name ?? "Item",
        size_value: b.size_value ?? "",
        unit: b.inv_items?.unit ?? "pcs",
        on_hand: Number(b.qty ?? 0),
        qty_returned: Number(b.qty ?? 0),
        destination_type: "field_officer" as LocationType,
        destination_id: foId,
        destination_label: foLabel,
        remarks: "",
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, balancesQ.data, fieldOfficersQ.data]);

  // Propagate destination change to all rows
  useEffect(() => {
    if (!returnDestKey) return;
    const [type, id] = returnDestKey.split(":") as [LocationType, string];
    const fo = (fieldOfficersQ.data ?? []).find((f) => f.id === id);
    const label = fo
      ? `Field Officer · ${fo.full_name}${fo.employee_code ? " · " + fo.employee_code : ""}`
      : "Field Officer";
    setInvReturns((rows) =>
      rows.map((r) => ({
        ...r,
        destination_type: type,
        destination_id: id,
        destination_label: label,
      })),
    );
  }, [returnDestKey, fieldOfficersQ.data]);

  const selectedReason = reasons.find((r) => r.id === reasonId);
  const isAbsconding =
    !!selectedReason && ABSCONDING_NAMES.has(selectedReason.name.trim().toLowerCase());

  // Auto-enable no-hire on Absconding (unless user manually toggled)
  useEffect(() => {
    if (!noHireTouched) {
      setNoHire(isAbsconding);
    }
  }, [isAbsconding, noHireTouched]);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const toggleReturned = (assetId: string) => {
    setAssetReturns((rows) =>
      rows.map((r) => (r.asset_id === assetId ? { ...r, returned: !r.returned } : r)),
    );
  };
  const setReturnRemarks = (assetId: string, remarks: string) => {
    setAssetReturns((rows) => rows.map((r) => (r.asset_id === assetId ? { ...r, remarks } : r)));
  };

  if (!target) return null;

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Offboard employee</DialogTitle>
          <DialogDescription>
            Capture the full offboarding record for{" "}
            <span className="font-medium text-foreground">
              {target.full_name || target.employee_code || "this employee"}
            </span>
            . If any inventory is still held, the selected Field Officer must confirm collection
            before the employee is finally marked Inactive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Section: Reason + Dates */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Offboarding Details
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Employee</Label>
                <Input
                  value={`${target.full_name}${target.employee_code ? ` · ${target.employee_code}` : ""}`}
                  disabled
                />
              </div>
              <div className="space-y-1">
                <Label>Offboarding type *</Label>
                <Select value={reasonId} onValueChange={setReasonId}>
                  <SelectTrigger>
                    <SelectValue placeholder={reasonsLoading ? "Loading…" : "Select a type"} />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Date of offboarding *</Label>
                <DatePickerInput
                  value={dateOfOffboarding}
                  onChange={(v) => setDateOfOffboarding(v ?? "")}
                  startYear={2000}
                />
              </div>
              <div className="space-y-1">
                <Label>Date of resignation</Label>
                <DatePickerInput
                  value={dateOfResignation}
                  onChange={(v) => setDateOfResignation(v ?? "")}
                  startYear={2000}
                />
              </div>
              <div className="space-y-1">
                <Label>Date of last working day</Label>
                <DatePickerInput
                  value={dateOfLastWorking}
                  onChange={(v) => setDateOfLastWorking(v ?? "")}
                  startYear={2000}
                />
                <p className="text-[11px] text-muted-foreground">
                  {lastPresentQ.isLoading
                    ? "Checking attendance…"
                    : lastPresent
                      ? `Auto-filled from last present day in attendance (${lastPresent})`
                      : "No attendance found — set this manually."}
                </p>
              </div>

              <div className="space-y-1">
                <Label>Date of PF update</Label>
                <DatePickerInput
                  value={dateOfPfUpdate}
                  onChange={(v) => setDateOfPfUpdate(v ?? "")}
                  startYear={2000}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Date of ESIC update</Label>
                <DatePickerInput
                  value={dateOfEsicUpdate}
                  onChange={(v) => setDateOfEsicUpdate(v ?? "")}
                  startYear={2000}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Reason for offboarding</Label>
                <Textarea
                  rows={2}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="Describe the reason in detail (optional)"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Review about employee</Label>
                <Textarea
                  rows={3}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Performance, conduct, anything HR / future hiring should know"
                />
              </div>
            </div>
          </section>

          {/* Handover Checklist removed — inventory return handshake below is the source of truth */}

          {/* Section: Return Issued Inventory (uniform / shoes / torch etc.) */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Return Issued Inventory
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {invReturns.filter((r) => r.qty_returned > 0).length} of {invReturns.length} items
                collected
              </span>
            </div>
            {balancesQ.isLoading ? (
              <p className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                Loading issued inventory…
              </p>
            ) : invReturns.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                No inventory items are currently held by this employee. If they left items behind,
                record them via a stock adjustment.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Collecting Field Officer *</Label>
                    <Select value={returnDestKey} onValueChange={setReturnDestKey}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            fieldOfficersQ.isLoading ? "Loading…" : "Select field officer"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(fieldOfficersQ.data ?? []).map((fo) => (
                          <SelectItem key={fo.id} value={`field_officer:${fo.id}`}>
                            {fo.full_name}
                            {fo.employee_code ? ` · ${fo.employee_code}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Offboarding will be marked{" "}
                      <span className="font-medium text-foreground">
                        Awaiting inventory collection
                      </span>
                      . The selected Field Officer will get a red-flagged notification under Uniform
                      Manager → Collections. The employee is finalised as Inactive only once the FO
                      confirms collection.
                    </p>
                  </div>
                </div>
                <div className="rounded-md border border-border">
                  <div className="grid grid-cols-[2fr,auto,auto,2fr] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div>Item</div>
                    <div className="text-right">Held</div>
                    <div className="text-right">Returned</div>
                    <div>Remarks</div>
                  </div>
                  {invReturns.map((row, idx) => (
                    <div
                      key={`${row.item_id}:${row.size_value}`}
                      className={cn(
                        "grid grid-cols-[2fr,auto,auto,2fr] items-center gap-3 px-3 py-2 text-sm",
                        idx > 0 && "border-t border-border",
                      )}
                    >
                      <div>
                        <div className="font-medium">{row.item_name}</div>
                        {row.size_value && (
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Size {row.size_value}
                          </div>
                        )}
                      </div>
                      <div className="text-right tabular-nums text-xs text-muted-foreground">
                        {row.on_hand} {row.unit}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={row.on_hand}
                        step="1"
                        className="h-8 w-20 text-right tabular-nums"
                        value={row.qty_returned}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(row.on_hand, Number(e.target.value) || 0));
                          setInvReturns((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, qty_returned: v } : r)),
                          );
                        }}
                      />
                      <Input
                        placeholder="Condition / remarks (optional)"
                        className="h-8"
                        value={row.remarks ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setInvReturns((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, remarks: v } : r)),
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Section: Rating */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Employee Rating
            </h3>
            <div className="space-y-2">
              <Label>Overall rating</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => setRating(rating === n ? 0 : n)}
                    className={cn(
                      "rounded p-1 text-2xl leading-none transition-colors",
                      n <= rating
                        ? "text-amber-500"
                        : "text-muted-foreground/40 hover:text-amber-400",
                    )}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">
                  {rating > 0 ? `${rating} / 5` : "Not rated"}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Remarks</Label>
              <Textarea
                rows={2}
                value={ratingRemarks}
                onChange={(e) => setRatingRemarks(e.target.value)}
                placeholder="Optional notes supporting the rating"
              />
            </div>
          </section>

          {/* Section: Re-hire flag */}
          <section className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-3">
            <div>
              <Label className="m-0">Do not re-hire</Label>
              <p className="text-xs text-muted-foreground">
                {isAbsconding
                  ? "Auto-enabled because the offboarding type is Absconding."
                  : "Flag this employee as ineligible for re-hiring."}
              </p>
            </div>
            <Switch
              checked={noHire}
              onCheckedChange={(v) => {
                setNoHireTouched(true);
                setNoHire(v);
              }}
            />
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={
              !reasonId ||
              !dateOfOffboarding ||
              isSubmitting ||
              (invReturns.some((r) => r.qty_returned > 0) && !returnDestKey)
            }
            onClick={() => {
              onSubmit({
                reasonId,
                noHire,
                details: {
                  date_of_offboarding: dateOfOffboarding || null,
                  date_of_resignation: dateOfResignation || null,
                  date_of_last_working: dateOfLastWorking || null,
                  date_of_pf_update: dateOfPfUpdate || null,
                  date_of_esic_update: dateOfEsicUpdate || null,
                  reason_text: reasonText.trim(),
                  review: review.trim(),
                  asset_returns: assetReturns,
                  inventory_returns: invReturns.filter((r) => r.qty_returned > 0),
                  rating,
                  rating_remarks: ratingRemarks.trim(),
                },
              });
            }}
          >
            {isSubmitting ? "Saving…" : "Confirm offboarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportsToPicker({
  value,
  selfId,
  onChange,
}: {
  value: string | null;
  selfId: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const managersQuery = useQuery({
    queryKey: ["employees", "eligible-managers", "all"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,role_key,status,is_enabled")
        .neq("role_key", "guard")
        .in("status", ["approved", "active"])
        .order("full_name", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (
        (data as unknown as Array<{
          id: string;
          full_name: string;
          employee_code: string;
          role_key: string | null;
          is_enabled: boolean;
        }>) ?? []
      ).filter((c) => c.is_enabled !== false && c.id !== selfId);
    },
  });
  const managers = managersQuery.data ?? [];
  const selected = value ? managers.find((m) => m.id === value) : null;
  const roleLabel = (role: string | null) => (role ? role.replace(/_/g, " ") : "employee");
  return (
    <Field label="Reporting Manager">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-10 w-full justify-start rounded-xl border-border/60 bg-card px-3 text-left text-xs font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? `${selected.full_name} · ${roleLabel(selected.role_key)}`
                : managersQuery.isLoading
                  ? "Loading…"
                  : "Select a reporting manager"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(340px,calc(100vw-1rem))] p-0">
          <Command>
            <CommandInput placeholder="Search by name or code…" className="h-9 text-xs" />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>No match found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__ no reporting manager"
                  className="text-xs"
                  onSelect={() => {
                    setOpen(false);
                    onChange(null);
                  }}
                >
                  — No reporting manager —
                </CommandItem>
                {managers.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.full_name} ${m.employee_code ?? ""} ${roleLabel(m.role_key)}`}
                    className="text-xs"
                    onSelect={() => {
                      setOpen(false);
                      onChange(m.id);
                    }}
                  >
                    <span className="truncate">{m.full_name}</span>
                    <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
                      {roleLabel(m.role_key)}
                      {m.employee_code ? ` · ${m.employee_code}` : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Used for approvals, escalations, and the dashboard "reports to" chip.
      </p>
    </Field>
  );
}

function AssetMultiPicker({
  assets,
  value,
  onChange,
  sizes,
  onSizesChange,
  uniformIncluded = true,
  uniformFeeAmount = 0,
}: {
  assets: {
    id: string;
    name: string;
    category: string;
    available_qty?: number;
    unit_price?: number;
  }[];
  value: string[];
  onChange: (ids: string[]) => void;
  sizes?: Record<string, string>;
  onSizesChange?: (next: Record<string, string>) => void;
  uniformIncluded?: boolean;
  uniformFeeAmount?: number;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selected = useMemo(
    () => assets.filter((a) => selectedSet.has(a.id)),
    [assets, selectedSet],
  );

  // Only surface assets that actually have live inventory available.
  const pickable = useMemo(() => assets.filter((a) => (a.available_qty ?? 0) > 0), [assets]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pickable;
    return pickable.filter((a) =>
      [a.name, a.category].some((p) => (p ?? "").toLowerCase().includes(needle)),
    );
  }, [query, pickable]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof assets>();
    for (const a of filtered) {
      const key = a.category || "—";
      const arr = groups.get(key) ?? [];
      arr.push(a);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((v) => v !== id));
      if (sizes && onSizesChange && sizes[id] != null) {
        const next = { ...sizes };
        delete next[id];
        onSizesChange(next);
      }
    } else onChange([...value, id]);
  };

  const isUniform = (a: { category: string; name: string }) =>
    /uniform/i.test(a.category ?? "") || /uniform/i.test(a.name ?? "");

  const flatUniformFee = !uniformIncluded && uniformFeeAmount > 0 ? uniformFeeAmount : 0;

  const priceFor = (a: { category: string; name: string; unit_price?: number }) => {
    if (isUniform(a)) {
      // Uniform included in the contract, or charged as a single unit-level flat fee.
      if (uniformIncluded || flatUniformFee > 0) return 0;
    }
    return Number(a.unit_price ?? 0) || 0;
  };

  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const uniformSelected = selected.filter(isUniform);
  const totalRecoverable =
    selected.reduce((sum, a) => sum + priceFor(a), 0) +
    (uniformSelected.length > 0 ? flatUniformFee : 0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-input bg-background">
        <div className="flex flex-wrap gap-1.5 p-2 min-h-[44px]">
          {selected.length === 0 && (
            <span className="self-center px-1 text-sm text-muted-foreground">
              No assets assigned — click "Add asset" to assign company assets.
            </span>
          )}
          {selected.map((a) => {
            const uni = isUniform(a);
            const price = priceFor(a);
            return (
              <Badge
                key={a.id}
                variant="secondary"
                className="flex items-center gap-1.5 pl-2 pr-1 py-1 text-xs font-normal"
              >
                <span className="font-medium">{a.name}</span>
                <span className="opacity-60 text-[10px]">· {a.category}</span>
                {uni && uniformIncluded ? (
                  <span className="rounded bg-emerald-500/15 px-1 py-[1px] text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    ₹0 · Included
                  </span>
                ) : price > 0 ? (
                  <span className="rounded bg-amber-500/15 px-1 py-[1px] text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    {inr(price)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-1 rounded p-0.5 opacity-70 hover:bg-background/30 hover:opacity-100"
                  title="Remove"
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(a.id);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              {uniformSelected.length > 0 && uniformIncluded
                ? "Uniform items are included in this unit's contract (₹0 to the staff member)."
                : uniformSelected.length > 0 && flatUniformFee > 0
                  ? `Uniform is not included — a flat uniform fee of ${inr(flatUniformFee)} set on this unit will be recovered from the staff member.`
                  : uniformSelected.length > 0
                    ? "Uniform is not included — value shown will be recoverable from the staff member."
                    : "Values shown are recoverable against the staff member."}
            </span>
            <span className="font-semibold text-foreground">
              Recoverable total: {inr(totalRecoverable)}
            </span>
          </div>
        )}
      </div>

      {onSizesChange && uniformSelected.length > 0 && (
        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Uniform sizes
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {uniformSelected.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Label className="flex-1 text-xs">{a.name}</Label>
                <Select
                  value={(sizes ?? {})[a.id] ?? ""}
                  onValueChange={(v) => onSizesChange({ ...(sizes ?? {}), [a.id]: v })}
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue placeholder="Size" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "XS",
                      "S",
                      "M",
                      "L",
                      "XL",
                      "XXL",
                      "XXXL",
                      "28",
                      "30",
                      "32",
                      "34",
                      "36",
                      "38",
                      "40",
                      "42",
                      "44",
                      "46",
                    ].map((sz) => (
                      <SelectItem key={sz} value={sz}>
                        {sz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="font-normal"
          onClick={() => setOpen((prev) => !prev)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {open
            ? "Close asset selector"
            : selected.length === 0
              ? "Add asset…"
              : "Add / manage assets…"}
        </Button>

        {open ? (
          <div className="rounded-md border border-border bg-background">
            <div className="border-b border-border p-2">
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or category…"
              />
            </div>
            <div className="p-2 sm:max-h-[340px] sm:overflow-y-auto">
              {grouped.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No matching assets available in inventory.
                </div>
              ) : (
                <div className="space-y-3">
                  {grouped.map(([cat, list]) => (
                    <div key={cat} className="space-y-1.5">
                      <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {cat}
                      </div>
                      <div className="space-y-1">
                        {list.map((a) => {
                          const checked = selectedSet.has(a.id);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => toggle(a.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                                checked ? "bg-primary/10 text-foreground" : "hover:bg-secondary",
                              )}
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4 shrink-0",
                                  checked ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="flex-1 truncate">{a.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {a.category}
                              </span>
                              {(() => {
                                const uni = isUniform(a);
                                const price = priceFor(a);
                                if (uni && uniformIncluded) {
                                  return (
                                    <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                      ₹0 · Free
                                    </span>
                                  );
                                }
                                if (price > 0) {
                                  return (
                                    <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                      {inr(price)}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                              <span className="ml-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                {a.available_qty} in stock
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MultiUnitPicker({
  units,
  value,
  onChange,
  disabled = false,
  emptyMessage = "No units found.",
  contractState,
}: {
  units: UnitLite[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  emptyMessage?: string;
  contractState?: Record<string, UnitContractState>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contractStateQuery = useUnitContractState();
  const unitContractState = contractState ?? contractStateQuery.data;

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedUnits = useMemo(
    () => value.map((id) => units.find((u) => u.id === id)).filter(Boolean) as UnitLite[],
    [value, units],
  );

  const filteredUnits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return units;
    return units.filter((u) =>
      [u.code, u.name, u.customer_name ?? "", u.id].some((p) => p.toLowerCase().includes(needle)),
    );
  }, [query, units]);

  // Group filtered units by customer/organization
  const grouped = useMemo(() => {
    const groups = new Map<string, UnitLite[]>();
    for (const u of filteredUnits) {
      const key = u.customer_name || "—";
      const arr = groups.get(key) ?? [];
      arr.push(u);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredUnits]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const removeOne = (id: string) => onChange(value.filter((v) => v !== id));

  const makePrimary = (id: string) => {
    if (value[0] === id) return;
    onChange([id, ...value.filter((v) => v !== id)]);
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div className="space-y-2">
      {/* Chips of selected units */}
      <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-[44px]">
        {selectedUnits.length === 0 && (
          <span className="self-center px-1 text-sm text-muted-foreground">
            No units selected — click "Add unit" to assign.
          </span>
        )}
        {selectedUnits.map((u, idx) => {
          const isPrimary = idx === 0;
          return (
            <Badge
              key={u.id}
              variant={isPrimary ? "default" : "secondary"}
              className={cn(
                "flex items-center gap-1.5 pl-2 pr-1 py-1 text-xs font-normal",
                isPrimary && "ring-1 ring-primary/40",
              )}
            >
              {isPrimary && (
                <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                  Primary
                </span>
              )}
              <span className="font-mono font-semibold">{u.code}</span>
              <span className="opacity-80">· {u.name}</span>
              {u.customer_name && (
                <span className="opacity-60 text-[10px]">({u.customer_name})</span>
              )}
              {!isPrimary && (
                <button
                  type="button"
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary transition hover:bg-primary hover:text-primary-foreground"
                  title="Make this the primary unit — a fresh posting order will be emailed on save"
                  onClick={(e) => {
                    e.preventDefault();
                    makePrimary(u.id);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <Check className="h-3 w-3" />
                  Set primary
                </button>
              )}

              <button
                type="button"
                className="ml-0.5 rounded p-0.5 opacity-70 hover:bg-background/30 hover:opacity-100"
                title="Remove"
                onClick={(e) => {
                  e.preventDefault();
                  removeOne(u.id);
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="font-normal"
          onClick={() => setOpen((prev) => !prev)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {open
            ? "Close unit selector"
            : selectedUnits.length === 0
              ? "Add unit…"
              : "Add / manage units…"}
        </Button>

        {open ? (
          <div className="rounded-md border border-border bg-background">
            <div className="border-b border-border p-2">
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code, name or organization…"
              />
            </div>
            <div className="p-2 sm:max-h-[340px] sm:overflow-y-auto">
              {grouped.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </div>
              ) : (
                <div className="space-y-3">
                  {grouped.map(([orgName, list]) => (
                    <div key={orgName} className="space-y-1.5">
                      <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {orgName}
                      </div>
                      <div className="space-y-1">
                        {list.map((u) => {
                          const checked = selectedSet.has(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => toggle(u.id)}
                              className={cn(
                                "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                                checked
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:bg-muted/40",
                              )}
                            >
                              <div
                                className={cn(
                                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                  checked
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input bg-background",
                                )}
                              >
                                {checked ? <Check className="h-3 w-3" /> : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                  <span>
                                    <b>{u.code}</b> · {u.name}
                                  </span>
                                  {unitContractState && unitContractState[u.id] !== "active" ? (
                                    <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                      {unitContractState[u.id] === "expired"
                                        ? "Contract expired"
                                        : "No contract"}
                                    </span>
                                  ) : null}
                                </div>
                                {u.customer_name ? (
                                  <div className="text-[11px] text-muted-foreground">
                                    {u.customer_name}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {value.length} selected
                {value.length > 0 ? " — first one is Primary" : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DesignationPicker({
  designations,
  value,
  onChange,
  disabled = false,
  emptyMessage = "No designations found.",
}: {
  designations: DesignationLite[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = value ? designations.find((d) => d.id === value) : null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return designations;
    return designations.filter((d) =>
      [d.code ?? "", d.name].some((p) => p.toLowerCase().includes(needle)),
    );
  }, [query, designations]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() =>
        searchInputRef.current?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className="w-full justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className="truncate">
            {selected.code ? (
              <>
                <b>{selected.code}</b> ·{" "}
              </>
            ) : null}
            {selected.name}
          </span>
        ) : (
          <span className="text-muted-foreground">Search designation…</span>
        )}
        <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="rounded-md border bg-popover p-2 space-y-2">
          <Input
            ref={searchInputRef}
            placeholder="Search designations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
          />
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-xs text-muted-foreground px-2 py-3">{emptyMessage}</div>
            ) : (
              filtered.map((d) => {
                const isSel = d.id === value;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      onChange(d.id);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-sm hover:bg-accent flex flex-col ${isSel ? "bg-accent" : ""}`}
                  >
                    <span className="font-medium text-sm">{d.name}</span>
                    {d.code ? (
                      <span className="text-xs text-muted-foreground">{d.code}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toTitle(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function CandidateDesignationsEditor({
  candidateId,
  primaryDesignationId,
  designations,
}: {
  candidateId: string;
  primaryDesignationId: string | null;
  designations: DesignationLite[];
}) {
  const qc = useQueryClient();
  const qk = ["candidate-designations", candidateId];
  const { data: rows = [] } = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_designations" as never)
        .select("id, designation_id, is_primary")
        .eq("candidate_id", candidateId);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; designation_id: string; is_primary: boolean }>;
    },
  });
  const [picker, setPicker] = useState("");
  const extras = rows.filter((r) => r.designation_id !== primaryDesignationId);
  const dMap = useMemo(() => new Map(designations.map((d) => [d.id, d.name])), [designations]);

  const add = async () => {
    if (!picker) return;
    if (rows.some((r) => r.designation_id === picker)) {
      toast.error("Already assigned");
      return;
    }
    const { error } = await supabase
      .from("candidate_designations" as never)
      .insert({ candidate_id: candidateId, designation_id: picker, is_primary: false } as never);
    if (error) {
      toast.error(error.message);
      return;
    }
    void logActivity({
      module: "Candidate Designations",
      action: "Add additional designation",
      entityType: "candidate_designations",
      entityLabel: dMap.get(picker) ?? picker,
      details: { candidate_id: candidateId, designation_id: picker },
    });
    setPicker("");
    qc.invalidateQueries({ queryKey: qk });
  };

  const remove = async (id: string, did: string) => {
    const { error } = await supabase
      .from("candidate_designations" as never)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void logActivity({
      module: "Candidate Designations",
      action: "Remove additional designation",
      entityType: "candidate_designations",
      entityLabel: dMap.get(did) ?? did,
      details: { candidate_id: candidateId, designation_id: did },
    });
    qc.invalidateQueries({ queryKey: qk });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-muted/30 p-2 min-h-[44px]">
        {extras.length === 0 ? (
          <span className="self-center px-1 text-sm text-muted-foreground">
            No additional designations.
          </span>
        ) : (
          extras.map((r) => (
            <Badge key={r.id} variant="secondary" className="font-normal gap-1">
              {dMap.get(r.designation_id) ?? r.designation_id}
              <button
                type="button"
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={() => remove(r.id, r.designation_id)}
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Select value={picker} onValueChange={setPicker}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Add another designation…" />
          </SelectTrigger>
          <SelectContent>
            {designations
              .filter(
                (d) =>
                  d.id !== primaryDesignationId && !rows.some((r) => r.designation_id === d.id),
              )
              .map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={!picker}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Used by attendance to route days under different roles when this person works multiple
        designations.
      </p>
    </div>
  );
}
