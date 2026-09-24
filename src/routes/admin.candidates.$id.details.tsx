import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { autoIssuePostingOrder } from "@/lib/posting-order-auto";
import { toast } from "sonner";
import { confirmAction } from "@/components/ConfirmProvider";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Activity,
  ShieldCheck,
  GraduationCap,
  Heart,
  Phone,
  FileBadge,
  Gavel,
  AlertTriangle,
  UserCheck,
  Building2,
  Star,
  Plus,
  Trash2,
  Briefcase,
  Undo2,
  FileText,
  FileSignature,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  emptyProof,
  emptyContact,
  SectionHeader,
  Field,
  PhysicalSection,
  ComplianceSection,
  KnowledgeSection,
  CriminalSection,
  ListSection,
  IdentificationSection,
  NomineeSection,
} from "@/components/candidate-extra-sections";
import { useCurrentPermissions } from "@/lib/rbac";
import { OffboardingRecordsSection } from "@/components/offboarding-records-section";
import { CandidateCompanyDocuments } from "@/components/CandidateCompanyDocuments";
import { CandidateEsicCard } from "@/components/CandidateEsicCard";
import { ensureFormViiForCandidate, ensureIdCardForCandidate } from "@/lib/company-documents";
import { UnitDesignationSelect } from "@/components/UnitDesignationSelect";



const MODULE = "Candidate Details";

const SECTIONS = [
  { id: "basic", label: "Basic Info", icon: Activity },
  { id: "units", label: "Client Mapping", icon: Building2 },
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
  { id: "knowledge", label: "Knowledge & Experience", icon: GraduationCap },
  { id: "physical", label: "Physical & Health", icon: Heart },
  { id: "contacts", label: "Contacts", icon: Phone },
  { id: "identification", label: "Identification Proofs", icon: FileBadge },
  { id: "criminal", label: "Criminal History", icon: Gavel },
  { id: "nominee", label: "Nominee", icon: UserCheck },
  
  { id: "company_docs", label: "Company Documents", icon: FileSignature },
  { id: "esic_card", label: "ESIC Card", icon: FileBadge },
  { id: "offboarding", label: "Offboarding Docs", icon: FileText },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function normalizeCandidate(data: any) {
  return {
    ...data,
    physical_health: data.physical_health ?? {},
    compliance: data.compliance ?? {},
    identification_proofs: Array.isArray(data.identification_proofs)
      ? data.identification_proofs
      : [],
    criminal_history:
      data.criminal_history && typeof data.criminal_history === "object"
        ? data.criminal_history
        : { has_history: false, incidents: [] },
    extra_curricular: Array.isArray(data.extra_curricular) ? data.extra_curricular : [],
    other_info: data.other_info ?? {},
    documents: Array.isArray(data.documents) ? data.documents : [],
    nominations: Array.isArray(data.nominations) ? data.nominations : [],
    contacts: Array.isArray(data.contacts) ? data.contacts : [],
  };
}

function buildCandidatePayload(form: any) {
  return {
    physical_health: form.physical_health,
    compliance: form.compliance,
    identification_proofs: form.identification_proofs,
    criminal_history: form.criminal_history,
    extra_curricular: form.extra_curricular,
    other_info: form.other_info,
    documents: form.documents,
    nominations: form.nominations,
    contacts: form.contacts,
    kyc_completed: form.kyc_completed ?? false,
    status: form.status,
    non_billable: form.non_billable ?? false,
    is_disabled: form.is_disabled ?? false,
    rejection_reason: form.rejection_reason ?? "",
  };
}

export const Route = createFileRoute("/admin/candidates/$id/details")({
  validateSearch: (search: Record<string, unknown>): { section?: string } => ({
    section: typeof search.section === "string" ? search.section : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Employee Profile | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Review and update employee onboarding, compliance, and assignment details." },
      { property: "og:title", content: "Employee Profile | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Review and update employee onboarding, compliance, and assignment details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CandidateDetailsPage,
});

function CandidateDetailsPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const initialSection = SECTIONS.some((s) => s.id === search.section) ? (search.section as SectionId) : "basic";
  const [active, setActive] = useState<SectionId>(initialSection);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [baselinePayload, setBaselinePayload] = useState<string>("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const selectSection = (section: SectionId) => {
    setActive(section);
    void navigate({ to: "/admin/candidates/$id/details", params: { id }, search: { section }, replace: true });
    requestAnimationFrame(() => document.getElementById("candidate-detail-content")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const { data, isLoading } = useQuery({
    queryKey: ["candidate-details", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: esicBranchesData } = useQuery({
    queryKey: ["esic-branches-lite"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("esic_branches" as never)
        .select("id,location,esic_code,enabled")
        .eq("enabled", true)
        .order("location", { ascending: true });
      if (error) throw error;
      return (data as unknown) as Array<{ id: string; location: string; esic_code: string }>;
    },
  });
  const esicBranches = esicBranchesData ?? [];

  useEffect(() => {
    if (!data) return;
    const normalized = normalizeCandidate(data);
    setForm(normalized);
    setBaselinePayload(JSON.stringify(buildCandidatePayload(normalized)));
  }, [data]);

  const set = (path: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [path]: value }));
  };
  const setSection = (key: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [key]: { ...(prev?.[key] ?? {}), ...value } }));
  };

  const dirty = useMemo(() => {
    if (!form || !baselinePayload) return false;
    return JSON.stringify(buildCandidatePayload(form)) !== baselinePayload;
  }, [form, baselinePayload]);

  const { roleKey, isSuperAdmin } = useCurrentPermissions();
  const canEditInactiveProfile = isSuperAdmin || roleKey === "leadership" || roleKey === "super_admin";
  const editLocked = form?.status === "inactive" && !canEditInactiveProfile;

  const handleSave = async (closeAfter = false) => {
    if (!form) return;
    if (editLocked) {
      toast.error("Only leadership or super admin can edit an inactive employee's profile.");
      return;
    }
    setSaving(true);
    try {
      const payload = buildCandidatePayload(form);
      const { data: updated, error } = await supabase.from("candidates").update(payload).eq("id", id).select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error("You do not have permission to edit this employee.");
      }
      await logActivity({
        module: MODULE,
        action: "update",
        entityType: "candidate",
        entityId: id,
        entityLabel: form.full_name || id,
      });
      const [formResult, cardResult] = await Promise.all([
        ensureFormViiForCandidate(id, { force: true }),
        ensureIdCardForCandidate(id, { force: true }),
      ]);
      if (formResult === "no-template" || cardResult === "no-template") {
        toast.warning("Profile saved, but an active company-document template is missing");
      } else {
        toast.success("Saved — company documents updated automatically");
      }
      setBaselinePayload(JSON.stringify(payload));
      if (closeAfter) navigate({ to: "/admin/employees" });
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };


  // markKyc removed per product decision

  const changeStatus = async (
    next: "approved" | "rejected" | "pending",
    reason = "",
  ) => {
    setStatusBusy(true);
    try {
      // Approval immediately promotes the candidate to an "active" employee
      // so they appear in attendance rosters and the Active stat tile.
      const dbStatus = next === "approved" ? "active" : next;
      const { error } = await supabase
        .from("candidates")
        .update({ status: dbStatus, rejection_reason: reason })
        .eq("id", id);
      if (error) throw error;
      setForm((p: any) => {
        const updated = { ...p, status: dbStatus, rejection_reason: reason };
        setBaselinePayload(JSON.stringify(buildCandidatePayload(updated)));
        return updated;
      });
      await logActivity({
        module: MODULE,
        action: next === "approved" ? "approve" : next === "rejected" ? "reject" : "resubmit",
        entityType: "candidate",
        entityId: id,
        entityLabel: form?.full_name || id,
        details: reason ? { reason } : undefined,
      });
      toast.success(
        next === "approved" ? "Candidate approved" :
        next === "rejected" ? "Candidate rejected" :
        "Candidate resubmitted for review",
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to update status");
    } finally {
      setStatusBusy(false);
    }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
    await changeStatus("rejected", rejectReason.trim());
    setRejectOpen(false);
    setRejectReason("");
  };

  if (isLoading || !form) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
              <h1 className="truncate text-xl font-semibold">{form.full_name || "Candidate"}</h1>
              <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Edit candidate" />
              {form.candidate_code && (
                <Badge variant="outline" className="font-mono text-xs">
                  {form.candidate_code}
                </Badge>
              )}
              <StatusPill status={form.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {form.mobile || "No mobile number"}
            </p>
          </div>
        </div>
        <div className="mobile-glass-bar sticky-action-bar scrollbar-hide sticky z-20 -mx-2 flex max-w-[calc(100%+1rem)] flex-nowrap items-center justify-start gap-1.5 overflow-x-auto rounded-xl border border-border/60 bg-card/85 p-2 shadow-lg sm:static sm:mx-0 sm:max-w-full sm:flex-wrap sm:justify-end sm:overflow-visible sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          {form.status === "pending" && (
            <Button
              size="sm"
              onClick={() => changeStatus("approved")}
              disabled={statusBusy}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {statusBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Approve
            </Button>
          )}
          {form.status === "pending" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setRejectOpen(true)}
              disabled={statusBusy}
            >
              <XCircle className="mr-2 h-4 w-4" /> Reject
            </Button>
          )}
          {form.status === "rejected" && (
            <Button
              size="sm"
              onClick={() => changeStatus("pending", "")}
              disabled={statusBusy}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {statusBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Resubmit for Review
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            Cancel
          </Button>
          {dirty && (
            <>
              <Button size="sm" onClick={() => handleSave(false)} disabled={saving || editLocked} title={editLocked ? "Only leadership or super admin can edit an inactive profile." : undefined}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
              <Button size="sm" onClick={() => handleSave(true)} disabled={saving || editLocked} title={editLocked ? "Only leadership or super admin can edit an inactive profile." : undefined}>
                Save & Close
              </Button>
            </>
          )}

        </div>
      </div>

      {form.status === "rejected" && form.rejection_reason && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div>
            <div className="font-semibold text-rose-700 dark:text-rose-300">Rejected</div>
            <div className="text-rose-700/90 dark:text-rose-200/90">{form.rejection_reason}</div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Section tabs (horizontal) */}
        <nav aria-label="Candidate sections" className="mobile-glass-surface scrollbar-hide sticky top-[52px] z-10 flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-card/85 p-1">
          {SECTIONS.filter(
            (s) =>
              s.id !== "esic_card" ||
              ["approved", "active"].includes(String(form.status ?? "").toLowerCase()),
          ).map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                key={s.id}
                onClick={() => selectSection(s.id)}
                className={`h-10 shrink-0 gap-2 rounded-lg px-3 text-sm ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </Button>
            );
          })}
        </nav>

        {/* Content */}
        <section id="candidate-detail-content" className="scroll-mt-20 rounded-xl border bg-card p-3 sm:p-6">
          {active === "basic" && <BasicSection form={form} />}
          {active === "units" && <UnitMappingSection candidateId={id} primaryUnitId={form.unit_id ?? null} />}
          {active === "physical" && (
            <PhysicalSection form={form} setSection={setSection} set={set} />
          )}
          {active === "compliance" && (
            <ComplianceSection form={form} setSection={setSection} esicBranches={esicBranches} />
          )}
          {active === "knowledge" && (
            <KnowledgeSection form={form} set={set} />
          )}
          {active === "contacts" && (
            <ListSection
              title="Contacts"
              description="Additional contact persons for this candidate"
              items={form.contacts}
              onChange={(v) => set("contacts", v)}
              empty={emptyContact}
              fields={[
                { key: "name", label: "Name" },
                { key: "relation", label: "Relation" },
                { key: "phone", label: "Phone" },
                { key: "email", label: "Email" },
              ]}
            />
          )}
          {active === "identification" && (
            <IdentificationSection form={form} set={set} setSection={setSection} />
          )}
          {active === "criminal" && (
            <CriminalSection form={form} set={set} />
          )}
          {active === "nominee" && (
            <NomineeSection form={form} setSection={setSection} set={set} />
          )}
          {active === "company_docs" && (
            <CandidateCompanyDocuments
              candidateId={id}
              employeeName={form.full_name || ""}
              employeeCode={form.employee_code || form.candidate_code || ""}
            />
          )}
          {active === "esic_card" &&
            ["approved", "active"].includes(String(form.status ?? "").toLowerCase()) && (
              <CandidateEsicCard
                candidateId={id}
                employeeName={form.full_name || ""}
                employeeCode={form.employee_code || form.candidate_code || ""}
              />
            )}
          {active === "offboarding" && (
            <OffboardingRecordsSection details={form.offboarding_details} />
          )}
        </section>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject candidate</DialogTitle>
            <DialogDescription>
              Provide a reason. The candidate can be resubmitted for review after edits.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection…"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={statusBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitReject} disabled={statusBusy}>
              {statusBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-slate-500/15 text-slate-600",
    pending: "bg-amber-500/15 text-amber-600",
    approved: "bg-emerald-500/15 text-emerald-600",
    active: "bg-emerald-500/15 text-emerald-600",
    inactive: "bg-slate-500/15 text-slate-600",
    rejected: "bg-rose-500/15 text-rose-600",
  };
  const label = status === "approved" ? "active" : status;
  return (
    <Badge className={`border-0 font-semibold capitalize ${map[status] ?? "bg-secondary text-foreground"}`}>
      {label || "—"}
    </Badge>
  );
}

/* ---------- Section components ---------- */

function BasicSection({ form }: { form: any }) {
  return (
    <div>
      <SectionHeader title="Basic Info" desc="Read-only. Edit via the candidate wizard." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Candidate Code"><Input value={form.candidate_code || "—"} readOnly className="font-mono" /></Field>
        <Field label="Full Name"><Input value={form.full_name || ""} readOnly /></Field>
        <Field label="Mobile"><Input value={form.mobile || ""} readOnly /></Field>
        <Field label="Email"><Input value={form.email || ""} readOnly /></Field>
        <Field label="DOB"><Input value={form.date_of_birth || ""} readOnly /></Field>
        <Field label="Gender"><Input value={form.gender || ""} readOnly /></Field>
        <Field label="Aadhaar"><Input value={form.aadhaar_number || ""} readOnly /></Field>
      </div>
    </div>
  );
}

/* ---------- Unit Mapping ---------- */

type UnitRow = { id: string; code: string; name: string; location: string; customer_id: string | null };
type CandidateUnitRow = { id: string; unit_id: string; is_primary: boolean; is_reliever: boolean; sort_order: number; designation_id: string | null };

function UnitMappingSection({ candidateId, primaryUnitId }: { candidateId: string; primaryUnitId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [addUnitId, setAddUnitId] = useState<string>("");
  const [addDesignationId, setAddDesignationId] = useState<string | null>(null);


  const unitsQ = useQuery({
    queryKey: ["units-for-mapping"],
    staleTime: 60_000,
    queryFn: async (): Promise<UnitRow[]> => {
      const { data, error } = await supabase
        .from("units" as never)
        .select("id,code,name,location,customer_id")
        .order("code", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as UnitRow[]) ?? [];
    },
  });

  const mappingsQ = useQuery({
    queryKey: ["candidate-units", candidateId],
    queryFn: async (): Promise<CandidateUnitRow[]> => {
      const { data, error } = await supabase
        .from("candidate_units" as never)
        .select("id,unit_id,is_primary,is_reliever,sort_order,designation_id")
        .eq("candidate_id", candidateId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as CandidateUnitRow[]) ?? [];
    },
  });


  const units = unitsQ.data ?? [];
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const mappings = mappingsQ.data ?? [];
  const mappedIds = new Set(mappings.map((m) => m.unit_id));
  const available = units.filter((u) => !mappedIds.has(u.id));

  const refresh = () => mappingsQ.refetch();

  const addMapping = async () => {
    if (!addUnitId) return;
    if (!addDesignationId) {
      toast.error("Pick the designation this employee fills at that client — attendance and salary follow the designation.");
      return;
    }
    const isFirstMapping = mappings.length === 0;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("candidate_units" as never)
        .insert({
          candidate_id: candidateId,
          unit_id: addUnitId,
          designation_id: addDesignationId,
          // Only the first mapping is primary. Every additional unit is a
          // reliever posting — extra duty (ED) only, no regular muster line.
          is_primary: isFirstMapping,
          is_reliever: !isFirstMapping,
          sort_order: mappings.length,
        } as never);
      if (error) throw error;
      await logActivity({
        module: MODULE,
        action: "add_unit_mapping",
        entityType: "candidate",
        entityId: candidateId,
        details: { unit_id: addUnitId, designation_id: addDesignationId },
      });
      const unitLabel = unitMap.get(addUnitId)?.name ?? "the site";
      toast.success(isFirstMapping ? "Primary client mapped" : `Mapped as reliever at ${unitLabel} (extra duty only)`);
      if (isFirstMapping) {
        // Work orders are only dispatched for the primary unit.
        await supabase
          .from("candidates")
          .update({ unit_id: addUnitId, designation_id: addDesignationId })
          .eq("id", candidateId);
        void autoIssuePostingOrder({ candidateId, unitId: addUnitId }).then((r) => {
          if (r.sent) toast.success(`Posting order for ${unitLabel} emailed to ${r.to}`);
          else if (!/only issued to security guards/.test(r.reason))
            toast.warning(`Posting order not sent — ${r.reason}`);
        });
      }
      setAddUnitId("");
      setAddDesignationId(null);
      refresh();

    } catch (e: any) {
      toast.error(e.message || "Failed to map client");
    } finally {
      setBusy(false);
    }
  };

  const removeMapping = async (row: CandidateUnitRow) => {
    if (!(await confirmAction({ title: "Remove client mapping?", description: "This will unmap the employee from this client.", confirmText: "Remove" }))) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("candidate_units" as never).delete().eq("id", row.id);
      if (error) throw error;
      await logActivity({
        module: MODULE,
        action: "remove_unit_mapping",
        entityType: "candidate",
        entityId: candidateId,
        details: { unit_id: row.unit_id },
      });
      toast.success("Mapping removed");
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  const setPrimary = async (row: CandidateUnitRow) => {
    if (!row.designation_id) {
      toast.error("Set the designation for this client before making it primary — attendance and salary follow the designation.");
      return;
    }
    setBusy(true);
    try {
      // Unset previous primary
      const { error: e1 } = await supabase
        .from("candidate_units" as never)
        .update({ is_primary: false, is_reliever: true } as never)
        .eq("candidate_id", candidateId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("candidate_units" as never)
        .update({ is_primary: true, is_reliever: false } as never)
        .eq("id", row.id);
      if (e2) throw e2;
      // Mirror into candidates.unit_id / designation_id for compatibility
      await supabase
        .from("candidates")
        .update({ unit_id: row.unit_id, designation_id: row.designation_id })
        .eq("id", candidateId);

      await logActivity({
        module: MODULE,
        action: "set_primary_unit",
        entityType: "candidate",
        entityId: candidateId,
        details: { unit_id: row.unit_id },
      });
      toast.success("Primary unit updated — all other units are reliever (extra duty) postings");
      const label = unitMap.get(row.unit_id)?.name ?? "the site";
      void autoIssuePostingOrder({ candidateId, unitId: row.unit_id }).then((r) => {
        if (r.sent) toast.success(`Posting order for ${label} emailed to ${r.to}`);
        else if (!/only issued to security guards/.test(r.reason))
          toast.warning(`Posting order not sent — ${r.reason}`);
      });
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to update primary");
    } finally {
      setBusy(false);
    }
  };

  const updateDesignation = async (row: CandidateUnitRow, designationId: string | null) => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("candidate_units" as never)
        .update({ designation_id: designationId } as never)
        .eq("id", row.id);
      if (error) throw error;
      if (row.is_primary && designationId) {
        await supabase.from("candidates").update({ designation_id: designationId }).eq("id", candidateId);
      }
      await logActivity({
        module: MODULE,
        action: "set_unit_designation",
        entityType: "candidate",
        entityId: candidateId,
        details: { unit_id: row.unit_id, designation_id: designationId },
      });
      toast.success("Designation updated for this client");
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to update designation");
    } finally {
      setBusy(false);
    }
  };

  const loading = unitsQ.isLoading || mappingsQ.isLoading;


  return (
    <div>
      <SectionHeader
        title="Client Mapping"
        desc="One primary client. Others are ED-only."
      />

      {primaryUnitId && !mappings.some((m) => m.unit_id === primaryUnitId) && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <div>
            <div className="font-medium text-amber-700 dark:text-amber-300">
              Current primary unit: {unitMap.get(primaryUnitId)?.code ?? "—"} {unitMap.get(primaryUnitId)?.name ?? ""}
            </div>
            <div className="text-amber-700/80 dark:text-amber-200/80">
              Not present in mappings yet. Add it below to manage from here.
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Add unit</label>
          <select
            value={addUnitId}
            onChange={(e) => {
              setAddUnitId(e.target.value);
              setAddDesignationId(null);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            disabled={busy || loading}
          >
            <option value="">Select client</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name} {u.location ? `(${u.location})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Designation
          </label>
          {addUnitId ? (
            <UnitDesignationSelect
              unitId={addUnitId}
              value={addDesignationId}
              onChange={setAddDesignationId}
              disabled={busy}
            />
          ) : (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Select a unit first
            </div>
          )}
        </div>
        <Button size="sm" className="w-full sm:w-auto" onClick={addMapping} disabled={!addUnitId || !addDesignationId || busy}>
          <Plus className="mr-2 h-4 w-4" /> Add
        </Button>
      </div>


      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : mappings.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No units mapped yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="ios-table w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-left">Designation</th>
                <th className="px-3 py-2 text-left">Primary</th>
                <th className="px-3 py-2 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => {
                const u = unitMap.get(m.unit_id);
                return (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{u?.code ?? "—"}</td>
                    <td className="px-3 py-2">{u?.name ?? "—"}</td>
                    <td className="min-w-0 px-3 py-2 sm:min-w-[200px]">
                      <UnitDesignationSelect
                        unitId={m.unit_id}
                        value={m.designation_id}
                        onChange={(id) => updateDesignation(m, id)}
                        disabled={busy}
                      />
                    </td>

                    <td className="px-3 py-2">
                      {m.is_primary ? (
                        <Badge className="border-0 bg-amber-500/15 font-semibold text-amber-600">
                          <Star className="mr-1 h-3 w-3 fill-current" /> Primary
                        </Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge className="border-0 bg-violet-500/15 font-semibold text-violet-600">Reliever · ED only</Badge>
                          <Button size="sm" variant="ghost" onClick={() => setPrimary(m)} disabled={busy}>
                            <Star className="mr-1 h-3 w-3" /> Set primary
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => removeMapping(m)} disabled={busy}>
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}




