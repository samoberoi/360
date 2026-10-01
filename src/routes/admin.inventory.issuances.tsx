import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, UserCheck, Eye, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { toast } from "sonner";
import { confirmAction, notifySaved } from "@/components/ConfirmProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nextSeq, fmtNumber, postMovements, statusBadgeClass, type LocationType } from "@/lib/inv-helpers";
import { useUserBranchScope } from "@/lib/use-user-branch-scope";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { useDemandRequesters } from "@/lib/use-demand-requesters";
import { useDocItemSummaries } from "@/lib/inv-doc-summary";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { GuidedForm, useGuidedFormCloseGuard, type GuidedFormStep } from "@/components/GuidedForm";




export const Route = createFileRoute("/admin/inventory/issuances")({
  validateSearch: (search: Record<string, unknown>): { candidate?: string; action?: "issue" | "" } => ({
    candidate: typeof search.candidate === "string" ? search.candidate : "",
    action: search.action === "issue" ? "issue" : "",
  }),
  component: IssuancesPage,
});

const MODULE = "Inventory Issuances";
const ENTITY = "inv_issuances";
// Stable empty fallback: a fresh `new Map()` default would change identity on
// every render and re-trigger effects that depend on it (infinite update loop).
const EMPTY_STOCK_MAP: Map<string, number> = new Map();

type Issuance = {
  id: string; issuance_number: string; issuance_type: string; issuance_date: string; status: string;
  source_type: string; source_id: string; destination_type: string; destination_id: string;
  ack_method: string; notes: string;
  demand_id?: string | null;
};
type Warehouse = { id: string; name: string };
type Branch = { id: string; name: string };
type Candidate = {
  id: string;
  full_name: string;
  employee_code: string | null;
  role_key: string;
  status: string;
  unit_id: string | null;
  reports_to: string | null;
  assigned_asset_ids?: string[] | string | null;
  onboarding_details?: {
    issuance_status?: string | null;
    pending_issuance_fo_id?: string | null;
    issuance_asset_ids?: string[] | string | null;
  } | null;
};
type Item = { id: string; name: string; item_code: string; is_sized: boolean };
type Line = { id?: string; item_id: string; size_value: string; qty: number; requested_qty: number };
type OpenDemand = {
  id: string; demand_number: string; branch_id: string | null; warehouse_id: string | null;
  requester_candidate_id: string | null;
  requester_id: string | null; fulfillment_source: string; status: string;
};


function IssuancesPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingCandidateId, setPendingCandidateId] = useState("");
  const { data: issuances = [] } = useQuery({
    queryKey: ["inv", "issuances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inv_issuances" as never).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as Issuance[]) ?? [];
    },
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ["inv", "warehouses-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inv_warehouses" as never).select("id,name").eq("enabled", true);
      if (error) throw error;
      return (data as unknown as Warehouse[]) ?? [];
    },
  });
  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches" as never).select("id,name").order("name");
      if (error) throw error;
      return (data as unknown as Branch[]) ?? [];
    },
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["candidates-active-and-pending-issuance-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,role_key,status,unit_id,reports_to,assigned_asset_ids,onboarding_details")
        .in("status", ["active", "approved"])
        .order("full_name");
      if (error) throw error;
      return (data as unknown as Candidate[]) ?? [];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inv", "items-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inv_items" as never).select("id,name,item_code,is_sized").eq("enabled", true).order("name");
      if (error) throw error;
      return (data as unknown as Item[]) ?? [];
    },
  });

  const { user } = useAuth();
  const myPhone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(myPhone);
  const role = useCurrentUserRole();
  const { data: me = null } = useQuery({
    queryKey: ["candidate-by-phone", myPhone],
    enabled: !!myPhone && !isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("candidates" as never).select("id,full_name,employee_code,role_key,status,unit_id,reports_to").eq("mobile", myPhone).maybeSingle();
      if (error) throw error;
      return (data as unknown as Candidate) ?? null;
    },
  });
  const isFieldOfficer = !isSuperAdmin && me?.role_key === "field_officer";
  const isBranchManager = role.isBranchManager;
  const scope = useUserBranchScope();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: pendingOnboarding = [] } = useQuery({
    queryKey: ["inv", "pending-onboarding-issuance", userId, isSuperAdmin],
    enabled: !!userId || isSuperAdmin,
    refetchInterval: 15_000,
    queryFn: async () => {
      let q = supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,role_key,status,unit_id,reports_to,assigned_asset_ids,onboarding_details")
        .eq("status", "approved")
        .eq("onboarding_details->>issuance_status", "pending")
        .order("updated_at", { ascending: false });
      if (!isSuperAdmin && userId) {
        q = q.eq("onboarding_details->>pending_issuance_fo_id", userId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as Candidate[]) ?? [];
    },
  });

  // Open demands available to fulfil via an issuance.
  // Branch managers see demands bound to their own branch.
  // Warehouse-side users (admin / inventory manager) see every submitted demand,
  // whether it was raised against a branch (base unit) or the warehouse.
  const { data: openDemands = [] } = useQuery({
    queryKey: ["inv", "open-demands-for-issuance", scope.branchId, isBranchManager],
    enabled: !isFieldOfficer,
    refetchInterval: 20_000,
    queryFn: async () => {
      let q = supabase.from("inv_demands" as never)
        .select("id,demand_number,branch_id,warehouse_id,requester_candidate_id,requester_id,fulfillment_source,status")
        .eq("status", "submitted");
      if (isBranchManager && scope.branchId) {
        q = q.eq("branch_id", scope.branchId);
      }
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as OpenDemand[]) ?? [];
    },
  });


  const fos = useMemo(() => candidates.filter((c) => c.status === "active" && /field|fo|supervisor|officer/i.test(c.role_key)), [candidates]);
  const guards = useMemo(() => candidates.filter((c) => {
    if (/field|fo|supervisor|officer|manager|head/i.test(c.role_key)) return false;
    if (c.status === "active") return true;
    return c.status === "approved" && c.onboarding_details?.issuance_status === "pending";
  }), [candidates]);
  const candMap = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const brMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);


  const locName = (type: string, id: string): string => {
    if (type === "warehouse") return whMap.get(id) ?? "—";
    if (type === "branch") return brMap.get(id) ?? "—";
    if (type === "field_officer" || type === "guard") return candMap.get(id)?.full_name ?? "—";
    return "—";
  };

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Issuance | null>(null);
  const [pendingDemandId, setPendingDemandId] = useState("");

  useEffect(() => {
    if (search.action !== "issue" || !search.candidate || pendingOnboarding.length === 0 || active || open) return;
    const target = pendingOnboarding.find((c) => c.id === search.candidate);
    if (!target) return;
    setPendingCandidateId(target.id);
    setActive(null);
    setOpen(true);
  }, [search.action, search.candidate, pendingOnboarding, active, open]);

  const myGuardIds = useMemo(
    () => new Set(
      isFieldOfficer && me
        ? candidates.filter((c) => c.reports_to === me.id && (c.role_key === "guard" || c.role_key === "security_guard")).map((c) => c.id)
        : [],
    ),
    [isFieldOfficer, me, candidates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = issuances;
    if (isFieldOfficer && me) {
      list = list.filter((i) => {
        const involvesMe = (i.source_type === "field_officer" && i.source_id === me.id)
          || (i.destination_type === "field_officer" && i.destination_id === me.id);
        const involvesMyGuard = (i.destination_type === "guard" || i.destination_type === "security_guard") && myGuardIds.has(i.destination_id);
        return involvesMe || involvesMyGuard;
      });
    } else if (scope.isScoped && scope.branchId) {
      list = list.filter(
        (i) =>
          (i.source_type === "branch" && i.source_id === scope.branchId) ||
          (i.destination_type === "branch" && i.destination_id === scope.branchId),
      );
    }
    if (!q) return list;
    return list.filter((i) => i.issuance_number.toLowerCase().includes(q));
  }, [issuances, query, scope.isScoped, scope.branchId, isFieldOfficer, me, myGuardIds]);


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inv", "issuances"] });
    qc.invalidateQueries({ queryKey: ["inv", "balances-sum"] });
  };

  const deleteMut = useMutation({
    mutationFn: async (i: Issuance) => {
      if (i.status !== "draft") throw new Error("Only drafts can be deleted.");
      const { error } = await supabase.from("inv_issuances" as never).delete().eq("id", i.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const demandInfo = useDemandRequesters(filtered.map((i) => i.demand_id));
  const pg = usePagination(filtered);

  return (
    <div>
      <PageHeader title="Issuances" description="Issue items to personnel." crumbs={[{ label: "Uniform Manager", to: "/admin/inventory" }, { label: "Issuances" }]} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search issuance #…" className="h-10 rounded-lg pl-9" />
        </div>
        <Button onClick={() => { setActive(null); setOpen(true); }} className="h-10 rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-1.5 h-4 w-4" />New Issuance
        </Button>
      </div>

      {pendingOnboarding.length > 0 && (
        <PendingOnboardingIssuancePanel
          pending={pendingOnboarding}
          items={items}
          onIssue={(candidateId) => {
            setPendingCandidateId(candidateId);
            setActive(null);
            setOpen(true);
          }}
        />
      )}

      {!isFieldOfficer && openDemands.length > 0 && (
        <section className="mb-4 overflow-hidden rounded-2xl border border-blue-500/30 bg-blue-500/10 shadow-sm">
          <div className="border-b border-blue-500/20 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-200">Demands awaiting issuance</div>
            <div className="mt-0.5 text-sm font-bold text-foreground">
              {openDemands.length} submitted demand{openDemands.length === 1 ? "" : "s"} to fulfil
            </div>
            <div className="text-xs text-muted-foreground">Issue the stock, then the requester confirms the delivery challan to accept it.</div>
          </div>
          <div className="divide-y divide-blue-500/15">
            {openDemands.map((d) => {
              const requester = d.requester_candidate_id ? candMap.get(d.requester_candidate_id) : null;
              const from = d.warehouse_id ? (whMap.get(d.warehouse_id) ?? "Warehouse") : (d.branch_id ? (brMap.get(d.branch_id) ?? "Branch") : "—");
              return (
                <div key={d.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">{d.demand_number}</span>
                      {requester ? ` · ${requester.full_name}` : ""}
                    </div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">Requested from {from}</div>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 shrink-0 rounded-full px-3 text-xs"
                    onClick={() => { setPendingCandidateId(""); setActive(null); setPendingDemandId(d.id); setOpen(true); }}
                  >
                    Issue against demand
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-clip">
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Issuance #</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Requested From</th>
                <th className="px-5 py-3">Requested By</th>
                <th className="px-5 py-3">From</th>
                <th className="px-5 py-3">To</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((i) => {
                const info = i.demand_id ? demandInfo.get(i.demand_id) : null;
                return (
                <tr key={i.id} className="hover:bg-secondary/30">
                  <td className="px-5 py-3 font-mono text-xs">{i.issuance_number}</td>
                  <td className="px-5 py-3 text-xs uppercase tracking-wider text-muted-foreground">{i.issuance_type.replace("_", " ")}</td>
                  <td className="px-5 py-3 font-mono text-xs">{info?.demandNumber ?? "—"}</td>
                  <td className="px-5 py-3">
                    {info ? (
                      <>
                        <div className="font-medium">{info.requesterName}</div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {info.requesterRole}{info.requesterCode ? ` · ${info.requesterCode}` : ""}
                        </div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-5 py-3">{locName(i.source_type, i.source_id)}</td>
                  <td className="px-5 py-3 font-medium">{locName(i.destination_type, i.destination_id)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{i.issuance_date}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${statusBadgeClass(i.status)}`}>{i.status === "completed" ? "completed" : i.status}</span></td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setPendingCandidateId(""); setActive(i); setOpen(true); }}><Eye className="h-4 w-4" /></Button>
                      {i.status === "draft" && (
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:text-destructive" onClick={async () => {
                          if (!(await confirmAction({ title: "Delete?", description: `Delete ${i.issuance_number}?`, confirmText: "Delete" }))) return;
                          try { await deleteMut.mutateAsync(i); toast.success("Deleted"); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                        }}><Trash2 className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {!filtered.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-sm text-muted-foreground"><UserCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />No issuances yet.</td></tr>}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      </div>



      <IssuanceDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setActive(null); setPendingCandidateId(""); setPendingDemandId(""); } }} initial={active} initialCandidateId={pendingCandidateId} initialDemandId={pendingDemandId} currentUserId={userId} warehouses={warehouses} branches={branches} fos={fos} guards={guards} candidates={candidates} items={items} onSaved={invalidate} me={me} isFieldOfficer={isFieldOfficer} isBranchManager={isBranchManager} branchScopeId={scope.branchId} openDemands={openDemands} />
    </div>
  );
}

function PendingOnboardingIssuancePanel({
  pending,
  items,
  onIssue,
}: {
  pending: Candidate[];
  items: Item[];
  onIssue: (candidateId: string) => void;
}) {
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const totalAssets = pending.reduce((sum, c) => {
    const ids = normalizeIdArray(c.onboarding_details?.issuance_asset_ids ?? c.assigned_asset_ids);
    return sum + ids.length;
  }, 0);

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/10 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-amber-500/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200">Issuance pending</div>
          <div className="mt-0.5 text-sm font-bold text-foreground">
            {pending.length} approved guard{pending.length === 1 ? "" : "s"} awaiting {totalAssets} asset{totalAssets === 1 ? "" : "s"}
          </div>
          <div className="text-xs text-muted-foreground">Use the standard Field Officer → Guard issuance. The guard must confirm with OTP before activation.</div>
        </div>
      </div>
      <div className="divide-y divide-amber-500/15">
        {pending.map((c) => {
          const ids = normalizeIdArray(c.onboarding_details?.issuance_asset_ids ?? c.assigned_asset_ids);
          const assetNames = ids.map((id) => itemMap.get(id)?.name ?? "Assigned asset");
          return (
            <div key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{c.full_name || "New guard"}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {c.employee_code ? `${c.employee_code} · ` : ""}{assetNames.slice(0, 3).join(", ")}{assetNames.length > 3 ? ` +${assetNames.length - 3}` : ""}
                </div>
              </div>
              <Button size="sm" className="h-8 shrink-0 rounded-full px-3 text-xs" onClick={() => onIssue(c.id)}>
                Issue via OTP
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ISSUANCE_TYPES = [
  { key: "branch_to_fo", label: "Branch → Field Officer", source: "branch", dest: "field_officer" },
  { key: "branch_to_guard", label: "Branch → Guard", source: "branch", dest: "guard" },
  { key: "fo_to_guard", label: "Field Officer → Guard", source: "field_officer", dest: "guard" },
  { key: "warehouse_to_fo", label: "Warehouse → Field Officer", source: "warehouse", dest: "field_officer" },
  { key: "warehouse_to_guard", label: "Warehouse → Guard", source: "warehouse", dest: "guard" },
] as const;

function IssuanceDialog({ open, onOpenChange, initial, initialCandidateId, initialDemandId, currentUserId, warehouses, branches, fos, guards, candidates, items, onSaved, me, isFieldOfficer, isBranchManager, branchScopeId, openDemands }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: Issuance | null;
  initialCandidateId: string;
  initialDemandId: string;
  currentUserId: string | null;
  warehouses: Warehouse[]; branches: Branch[]; fos: Candidate[]; guards: Candidate[]; candidates: Candidate[]; items: Item[];
  onSaved: () => void;
  me: Candidate | null;
  isFieldOfficer: boolean;
  isBranchManager: boolean;
  branchScopeId: string | null;
  openDemands: OpenDemand[];
}) {
  const defaultType = isFieldOfficer ? "fo_to_guard" : "branch_to_fo";
  const [type, setType] = useState<string>(defaultType);
  const [sourceId, setSourceId] = useState("");
  const [destId, setDestId] = useState("");
  const [issDate, setIssDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  // Keep the latest typed quantity outside React's render cycle as well. The
  // shared number input maintains a display draft, so a fast Next click can
  // otherwise validate the previous line state while the new number is visible.
  const typedQtyRef = useRef<Map<string, number>>(new Map());
  const [saving, setSaving] = useState(false);
  const [demandId, setDemandId] = useState<string>("");
  const [stepKey, setStepKey] = useState("route");

  const meta = ISSUANCE_TYPES.find((t) => t.key === type)!;
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const candById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const isDraft = !initial || initial.status === "draft";
  const isIssued = initial?.status === "issued";
  // Ack method is automatic: OTP when receiver is a guard, signature (delivery challan) when FO.
  const ackMethod = meta.dest === "guard" ? "otp" : "signature";

  // FO scoping for guards
  const foScopedGuards = useMemo(() => {
    if (!isFieldOfficer || !me) return guards;
    return guards.filter((g) =>
      g.reports_to === me.id ||
      (!!currentUserId && g.onboarding_details?.pending_issuance_fo_id === currentUserId),
    );
  }, [guards, isFieldOfficer, me, currentUserId]);
  const foScopedGuardIds = useMemo(() => new Set(foScopedGuards.map((guard) => guard.id)), [foScopedGuards]);

  // Available stock at the source location
  const { data: stockMap = EMPTY_STOCK_MAP } = useQuery({
    queryKey: ["inv", "stock-balances", meta.source, sourceId],
    enabled: !!sourceId && isDraft,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_stock_balances" as never)
        .select("item_id,size_value,qty")
        .eq("location_type", meta.source)
        .eq("location_id", sourceId);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data as unknown as { item_id: string; size_value: string | null; qty: number }[]) ?? []) {
        m.set(`${r.item_id}|${r.size_value ?? ""}`, Number(r.qty ?? 0));
      }
      return m;
    },
  });
  const availableFor = (l: Line) => stockMap.get(`${l.item_id}|${l.size_value ?? ""}`) ?? 0;
  const lineKey = (line: Line) => `${line.item_id}|${line.size_value ?? ""}`;
  const effectiveLines = () => lines.map((line) => ({
    ...line,
    qty: typedQtyRef.current.get(lineKey(line)) ?? line.qty,
  }));

  // FO → Guard has no demand: auto-load every item the FO has in stock so they can pick qty / remove.
  const isFreeIssue = type === "fo_to_guard" && !demandId;
  useEffect(() => {
    if (!open || initial || !isFreeIssue || !sourceId || stockMap.size === 0 || lines.length > 0) return;
    const next: Line[] = [];
    for (const [key, qty] of stockMap.entries()) {
      if (Number(qty) <= 0) continue;
      const [item_id, size_value] = key.split("|");
      next.push({ item_id, size_value: size_value ?? "", qty: 0, requested_qty: Number(qty) });
    }
    next.sort((a, b) => (itemMap.get(a.item_id)?.name ?? "").localeCompare(itemMap.get(b.item_id)?.name ?? ""));
    if (next.length) setLines(next);
  }, [open, initial, isFreeIssue, sourceId, stockMap, lines.length, itemMap]);

  function sourceOptions() {
    if (meta.source === "warehouse") return warehouses;
    if (meta.source === "branch") return branches;
    if (meta.source === "field_officer") return fos;
    return [];
  }
  function destOptions() {
    if (meta.dest === "field_officer") return fos;
    if (meta.dest === "guard") return isFieldOfficer ? foScopedGuards : guards;
    return [];
  }

  // Seed the pending-onboarding kit ONCE per receiver. It must never re-run over
  // typed quantities, otherwise every keystroke gets reset back to 0 and the
  // "Add items with quantity" guard blocks the step.
  const seededForRef = useRef<string>("");
  useEffect(() => {
    if (!open) { seededForRef.current = ""; return; }
    if (initial || !isDraft || demandId || meta.dest !== "guard" || !destId) return;
    if (seededForRef.current === destId || lines.length > 0) return;
    const guard = candById.get(destId);
    if (!guard || guard.status !== "approved" || guard.onboarding_details?.issuance_status !== "pending") return;
    const ids = normalizeIdArray(guard.onboarding_details.issuance_asset_ids ?? guard.assigned_asset_ids)
      .filter((id) => itemMap.has(id));
    if (ids.length === 0) return;
    const next: Line[] = ids.map((id) => {
      // Prefer a size that actually has stock at the source (uniform S/M/L, shoe 6-10).
      let size = "";
      let inStock = stockMap.get(`${id}|`) ?? 0;
      if (inStock <= 0) {
        for (const [key, qty] of stockMap.entries()) {
          const [sItem, sSize] = key.split("|");
          if (sItem === id && Number(qty) > 0) { size = sSize ?? ""; inStock = Number(qty); break; }
        }
      }
      return {
        item_id: id,
        size_value: size,
        qty: inStock > 0 ? 1 : 0,
        requested_qty: 1,
      };
    });
    seededForRef.current = destId;
    setLines(next);
  }, [open, initial, isDraft, demandId, meta.dest, destId, candById, itemMap, stockMap, lines.length]);

  useResetOnOpen(open, async () => {
    typedQtyRef.current.clear();
    setStepKey("route");
    setDemandId("");
    if (initial) {
      setType(initial.issuance_type); setSourceId(initial.source_id); setDestId(initial.destination_id);
      setIssDate(initial.issuance_date); setNotes(initial.notes);
      setDemandId(initial.demand_id ?? "");
      const { data } = await supabase.from("inv_issuance_lines" as never).select("*").eq("issuance_id", initial.id).order("sort_order");
      // Pull demand lines to surface "Requested" qty for context.
      const reqMap = new Map<string, number>();
      if (initial.demand_id) {
        const { data: dl } = await supabase.from("inv_demand_lines" as never).select("item_id,size_value,requested_qty").eq("demand_id", initial.demand_id);
        for (const r of (dl as unknown as { item_id: string; size_value: string; requested_qty: number }[]) ?? []) {
          reqMap.set(`${r.item_id}|${r.size_value ?? ""}`, Number(r.requested_qty ?? 0));
        }
      }
      setLines(((data as unknown as Record<string, unknown>[]) ?? []).map((r) => {
        const itemId = String(r.item_id);
        const sz = String(r.size_value ?? "");
        return {
          id: String(r.id),
          item_id: itemId,
          size_value: sz,
          qty: Number(r.qty ?? 0),
          requested_qty: reqMap.get(`${itemId}|${sz}`) ?? Number(r.qty ?? 0),
        };
      }));
    } else if (isFieldOfficer && me) {
      setType("fo_to_guard"); setSourceId(me.id); setDestId(initialCandidateId);
      setIssDate(new Date().toISOString().slice(0, 10));
      setNotes(""); setLines([]);
    } else if (isBranchManager && branchScopeId) {
      setType("branch_to_fo"); setSourceId(branchScopeId); setDestId("");
      setIssDate(new Date().toISOString().slice(0, 10));
      setNotes(""); setLines([]);
    } else {
      setType("warehouse_to_fo"); setSourceId(""); setDestId("");
      setIssDate(new Date().toISOString().slice(0, 10));
      setNotes(""); setLines([]);
    }
    if (!initial && initialDemandId) {
      await onPickDemand(initialDemandId);
    }
  });

  async function onPickDemand(did: string) {
    typedQtyRef.current.clear();
    setDemandId(did);
    if (!did) return;
    const d = openDemands.find((x) => x.id === did);
    if (!d) return;
    const reqCand = d.requester_candidate_id ? candById.get(d.requester_candidate_id) : null;
    const isFoReq = reqCand && /field|fo|supervisor|officer/i.test(reqCand.role_key);
    const isWarehouseDemand = !!d.warehouse_id;
    if (isWarehouseDemand) {
      // Warehouse → FO/Guard issuance
      if (isFoReq && reqCand) {
        setType("warehouse_to_fo");
        setDestId(reqCand.id);
      } else if (reqCand) {
        setType("warehouse_to_guard");
        setDestId(reqCand.id);
      } else {
        setType("warehouse_to_fo");
        setDestId("");
      }
      setSourceId(d.warehouse_id ?? "");
    } else {
      // Branch → FO/Guard issuance
      if (isFoReq && reqCand) {
        setType("branch_to_fo");
        setDestId(reqCand.id);
      } else if (reqCand) {
        setType("branch_to_guard");
        setDestId(reqCand.id);
      } else {
        setType("branch_to_fo");
        setDestId("");
      }
      setSourceId(branchScopeId ?? d.branch_id ?? "");
    }
    const { data: dls } = await supabase.from("inv_demand_lines" as never)
      .select("item_id,size_value,requested_qty,fulfilled_qty")
      .eq("demand_id", did).order("sort_order");
    const rows = (dls as unknown as { item_id: string; size_value: string | null; requested_qty: number; fulfilled_qty: number }[]) ?? [];
    setLines(rows.map((r) => {
      const remaining = Math.max(0, Number(r.requested_qty ?? 0) - Number(r.fulfilled_qty ?? 0));
      return {
        item_id: r.item_id,
        size_value: r.size_value ?? "",
        qty: remaining,
        requested_qty: remaining,
      };
    }));
  }



  async function saveOrIssue(target: "draft" | "issue") {
    if (!sourceId || !destId) { toast.error("Pick source and destination"); return; }
    if (isFieldOfficer && meta.dest === "guard" && !foScopedGuardIds.has(destId)) {
      toast.error("You can only issue inventory to guards assigned to you");
      setDestId("");
      setStepKey("route");
      return;
    }
    const currentLines = effectiveLines();
    const activeLines = isFreeIssue ? currentLines.filter((l) => l.qty > 0) : currentLines;
    if (!activeLines.length || activeLines.some((l) => !l.item_id || l.qty <= 0)) { toast.error("Add items with qty"); return; }
    setSaving(true);
    try {
      const linesPayload = activeLines.map((l, idx) => ({
        item_id: l.item_id, size_value: l.size_value, qty: l.qty,
        condition: "new", notes: "", sort_order: idx,
      }));
      let id = initial?.id;
      if (initial) {
        await supabase.from("inv_issuances" as never).update({
          issuance_type: type, source_type: meta.source, source_id: sourceId,
          destination_type: meta.dest, destination_id: destId,
          issuance_date: issDate, ack_method: ackMethod, notes,
          demand_id: demandId || null,
        } as never).eq("id", initial.id);
        await supabase.from("inv_issuance_lines" as never).delete().eq("issuance_id", initial.id);
        await supabase.from("inv_issuance_lines" as never).insert(linesPayload.map((l) => ({ ...l, issuance_id: initial.id })) as never);
      } else {
        const n = await nextSeq("inv_issuance_number_seq");
        const number = fmtNumber("ISS", n);
        const { data: ins, error } = await supabase.from("inv_issuances" as never).insert({
          issuance_number: number, issuance_type: type, source_type: meta.source, source_id: sourceId,
          destination_type: meta.dest, destination_id: destId,
          issuance_date: issDate, status: "draft", ack_method: ackMethod, notes,
          demand_id: demandId || null,
        } as never).select("id").single();
        if (error) throw error;
        id = (ins as unknown as { id: string }).id;
        await supabase.from("inv_issuance_lines" as never).insert(linesPayload.map((l) => ({ ...l, issuance_id: id })) as never);
      }

      if (target === "issue" && id) {
        const { data: { user } } = await supabase.auth.getUser();
        const otp = ackMethod === "otp"
          ? String(Math.floor(100000 + Math.random() * 900000))
          : null;
        await supabase.from("inv_issuances" as never).update({
          status: "issued", issued_by: user?.id ?? null, issued_at: new Date().toISOString(),
          otp_code: otp,
        } as never).eq("id", id);
        // Post OUT only — stock leaves source on issue.
        // The IN movement is posted when the receiver acknowledges (delivery challan / OTP).
        const movs = activeLines.map((l) => ({
          movement_type: `ISSUE_${meta.dest.toUpperCase()}_OUT`,
          location_type: meta.source as LocationType, location_id: sourceId,
          item_id: l.item_id, size_value: l.size_value, qty_change: -l.qty,
          reference_type: "issuance", reference_id: id!,
        }));
        await postMovements(movs);
        // Bump demand fulfilment if this was raised against a demand.
        if (demandId) {
          await bumpDemandFulfilled(demandId, activeLines);
        }
        if (otp) toast.message(`OTP for receiver: ${otp}`, { description: "Share with the guard — they'll enter it on their profile to confirm receipt." });
      }


      await logActivity({ module: MODULE, action: target === "issue" ? "issue" : (initial ? "update" : "create"), entityType: ENTITY, entityId: id, entityLabel: initial?.issuance_number ?? "Issuance" });
      void notifySaved({ title: "Saved", description: target === "issue" ? "Issued — stock dispatched from source. Awaiting acknowledgement." : "Saved" });
      onSaved(); onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge() {
    if (!initial) return;
    if (!(await confirmAction({ title: "Confirm delivery challan?", description: "Confirm receipt of the listed items. Stock will be added to your inventory.", confirmText: "Confirm Receipt" }))) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("inv_issuances" as never).update({
        status: "completed", acknowledged_at: new Date().toISOString(),
        received_at: new Date().toISOString(), received_by: user?.id ?? null,
      } as never).eq("id", initial.id);
      // Post IN movements to destination now.
      const movs = lines.map((l) => ({
        movement_type: `ISSUE_${initial.destination_type.toUpperCase()}_IN`,
        location_type: initial.destination_type as LocationType,
        location_id: initial.destination_id,
        item_id: l.item_id, size_value: l.size_value, qty_change: l.qty,
        reference_type: "issuance", reference_id: initial.id,
      }));
      await postMovements(movs);
      // Guard hand-over acknowledgement activates the employee (DB trigger) —
      // attach their statutory Form VII at the same moment.
      if (["guard", "security_guard"].includes(initial.destination_type)) {
        const { autoAttachFormVii } = await import("@/lib/company-documents");
        autoAttachFormVii(initial.destination_id);
      }
      void logActivity({ module: MODULE, action: "acknowledge", entityType: ENTITY, entityId: initial.id, entityLabel: initial.issuance_number });
      toast.success("Receipt confirmed — stock added");
      onSaved(); onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const steps: GuidedFormStep[] = [
    { key: "route", label: "Issue to", caption: "Choose the source and receiver" },
    { key: "items", label: "Items", caption: "Check stock and quantities" },
    { key: "review", label: "Review", caption: "Check and issue the items" },
  ];
  const activeLines = isFreeIssue ? lines.filter((line) => line.qty > 0) : lines;
  const validateStep = (key: string) => {
    if (key === "route" && (!sourceId || !destId)) return "Pick source and destination";
    if (key === "route" && isFieldOfficer && meta.dest === "guard" && !foScopedGuardIds.has(destId)) return "Pick a guard assigned to you";
    if (key === "items") {
      const currentLines = effectiveLines();
      const currentActiveLines = isFreeIssue ? currentLines.filter((line) => line.qty > 0) : currentLines;
      if (!currentActiveLines.length || currentActiveLines.some((line) => !line.item_id || line.qty <= 0)) return "Add items with quantity";
    }
    return null;
  };
  const isStepComplete = (key: string) => key === "review" ? !validateStep("route") && !validateStep("items") : !validateStep(key);
  const requestStep = (key: string) => {
    const target = steps.findIndex((step) => step.key === key);
    for (let index = 0; index < target; index += 1) {
      const problem = validateStep(steps[index].key);
      if (problem) { toast.error(problem); setStepKey(steps[index].key); return; }
    }
    setStepKey(key);
  };


  const closeGuard = useGuidedFormCloseGuard(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={closeGuard.onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl sm:border">
        <DialogHeader className="sr-only">
          <DialogTitle>{initial ? `Issuance ${initial.issuance_number}` : "New Issuance"}</DialogTitle>
          <DialogDescription>{initial?.status === "completed" ? "Completed." : isIssued ? "Issued — waiting for acknowledgement." : "Build and issue."}</DialogDescription>
        </DialogHeader>

        <GuidedForm closeGuardRef={closeGuard.ref} title={initial ? `Issuance ${initial.issuance_number}` : "New issuance"} steps={steps} stepKey={stepKey} onStepChange={requestStep} isStepComplete={isStepComplete} onCancel={() => onOpenChange(false)} onSaveDraft={isDraft ? () => void saveOrIssue("draft") : undefined} onSubmit={() => { if (isDraft) void saveOrIssue("issue"); else if (isIssued && initial?.ack_method !== "otp") void acknowledge(); else onOpenChange(false); }} saving={saving} submitLabel={isDraft ? "Issue now" : isIssued && initial?.ack_method !== "otp" ? "Confirm receipt" : "Close"}>
        <div className="modern-business-form space-y-5">
          <div className={stepKey === "route" ? "block" : "hidden"}>
          <section className="modern-form-section">
            <h3 className="modern-form-section-title">Issue details</h3>
          {!isFieldOfficer && isDraft && !initial && openDemands.length > 0 && (
            <div className="grid gap-2">
              <Label>Against Demand <span className="font-normal text-muted-foreground">(optional — auto-fills items, source &amp; receiver)</span></Label>
              <IssuanceDemandSelect openDemands={openDemands} candById={candById} value={demandId} onChange={onPickDemand} />

            </div>
          )}
          {!isFieldOfficer && !isBranchManager && (
            <div className="grid gap-2"><Label>Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v); setSourceId(""); setDestId(""); }} disabled={!isDraft || !!demandId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUANCE_TYPES.filter((t) => t.source === "warehouse").map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Branch-originated issuances are handled by the branch manager.</p>
            </div>
          )}
          {isBranchManager && (
            <div className="grid gap-2"><Label>Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v); setDestId(""); }} disabled={!isDraft || !!demandId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch_to_fo">Branch → Field Officer</SelectItem>
                  <SelectItem value="branch_to_guard">Branch → Guard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {isBranchManager && (
              <div className="grid gap-2"><Label>From (Branch)</Label>
                <Input value={branches.find((b) => b.id === sourceId)?.name ?? ""} disabled />
              </div>
            )}
            {!isFieldOfficer && !isBranchManager && (
              <div className="grid gap-2"><Label>From ({meta.source.replace("_", " ")})</Label>
                <Select value={sourceId} onValueChange={setSourceId} disabled={!isDraft}>
                  <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                  <SelectContent>{sourceOptions().map((o) => <SelectItem key={o.id} value={o.id}>{"full_name" in o ? `${o.full_name} (${o.employee_code})` : o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {isFieldOfficer && (
              <div className="grid gap-2"><Label>From (Field Officer)</Label>
                <Input value={me ? `${me.full_name} (${me.employee_code ?? ""})` : ""} disabled />
              </div>
            )}
            <div className="grid gap-2"><Label>{meta.dest === "field_officer" ? "Field Officer" : "Guard"}</Label>
              <Select value={destId} onValueChange={setDestId} disabled={!isDraft}>
                <SelectTrigger><SelectValue placeholder={isFieldOfficer && destOptions().length === 0 ? "No guards assigned to you" : `Pick ${meta.dest === "field_officer" ? "field officer" : "guard"}`} /></SelectTrigger>
                <SelectContent>{destOptions().map((o) => <SelectItem key={o.id} value={o.id}>{"full_name" in o ? `${o.full_name} (${o.employee_code})` : (o as { name: string }).name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>Date</Label><Input type="date" value={issDate} onChange={(e) => setIssDate(e.target.value)} disabled={!isDraft} /></div>
          </div>
          </section>
          </div>

          <div className={stepKey === "items" ? "block" : "hidden"}>
          <section className="modern-form-section">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-sm font-semibold">Items</Label>
              <span className="text-[11px] text-muted-foreground">{meta.dest === "guard" ? "Receiver confirms via OTP." : "Receiver confirms via delivery challan."}</span>
            </div>
            <div className="overflow-x-clip rounded-xl border border-border">
              <table className="ios-table w-full text-sm">
                <thead className="bg-secondary/60 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 w-16">Size</th>
                    {!isFreeIssue && <th className="px-3 py-2 w-24 text-right">Requested</th>}
                    {isDraft && <th className="px-3 py-2 w-24 text-right">In Stock</th>}
                    <th className="px-3 py-2 w-24 text-right">Issued</th>
                    {isDraft && isFreeIssue && <th className="px-3 py-2 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l, idx) => {
                    const it = itemMap.get(l.item_id);
                    const avail = availableFor(l);
                    const cap = isFreeIssue ? avail : Math.min(l.requested_qty, avail);
                    const over = isDraft && (l.qty > avail || (!isFreeIssue && l.qty > l.requested_qty));
                    const updateQty = (rawValue: string) => {
                      const raw = Number(rawValue) || 0;
                      let v = Math.max(0, raw);
                      if (!isFreeIssue && v > l.requested_qty) { v = l.requested_qty; toast.error(`Issued cannot exceed requested (${l.requested_qty})`); }
                      if (sourceId && v > avail) { v = avail; toast.error(`Only ${avail} in stock for ${it?.name ?? "item"}`); }
                      typedQtyRef.current.set(lineKey(l), v);
                      setLines((current) => current.map((line, index) => index === idx ? { ...line, qty: v } : line));
                    };
                    return (
                      <tr key={idx} className={over ? "bg-destructive/5" : undefined}>
                        <td className="px-3 py-2 font-medium">{it?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{l.size_value || "—"}</td>
                        {!isFreeIssue && <td className="px-3 py-2 text-right tabular-nums">{l.requested_qty}</td>}
                        {isDraft && <td className={`px-3 py-2 text-right tabular-nums ${!sourceId ? "text-muted-foreground" : avail <= 0 ? "text-destructive" : (!isFreeIssue && avail < l.requested_qty) ? "text-amber-600" : "text-muted-foreground"}`}>{sourceId ? avail : "—"}</td>}
                        <td className="px-2 py-1.5">
                          {isDraft
                            ? <Input
                                type="number"
                                min={0}
                                max={cap}
                                disabled={!sourceId}
                                className={`h-9 text-right ${over ? "border-destructive text-destructive" : ""}`}
                                value={l.qty}
                                 onInput={(e) => updateQty(e.currentTarget.value)}
                                 onChange={(e) => updateQty(e.target.value)}
                              />
                            : <div className="text-right tabular-nums">{l.qty}</div>}
                        </td>
                        {isDraft && isFreeIssue && (
                          <td className="px-2 py-1.5 text-right">
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => { typedQtyRef.current.delete(lineKey(l)); setLines((ls) => ls.filter((_, i) => i !== idx)); }}><X className="h-4 w-4" /></Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!lines.length && <tr><td colSpan={isDraft ? (isFreeIssue ? 5 : 5) : 4} className="px-3 py-6 text-center text-xs text-muted-foreground">{isBranchManager ? "Pick a demand above to load items." : isFreeIssue && !sourceId ? "Select source to load your stock." : isFreeIssue ? "You have no stock to issue." : "No lines."}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          </section>
          </div>

          <div className={stepKey === "review" ? "space-y-5" : "hidden"}>
          <section className="modern-form-section">
            <h3 className="modern-form-section-title">Issuance summary</h3>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Date</dt><dd className="mt-1 font-medium">{issDate}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Items</dt><dd className="mt-1 font-medium">{activeLines.length}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Total quantity</dt><dd className="mt-1 font-medium">{activeLines.reduce((sum, line) => sum + line.qty, 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Confirmation</dt><dd className="mt-1 font-medium">{ackMethod === "otp" ? "OTP" : "Delivery challan"}</dd></div>
            </dl>
          </section>
          <div className="grid gap-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={initial?.status === "completed"} rows={2} /></div>
          {isIssued && initial?.ack_method === "otp" && <p className="text-sm text-muted-foreground">Waiting for the guard to enter the OTP.</p>}
          </div>
        </div>
        </GuidedForm>
      </DialogContent>
    </Dialog>
  );
}

async function bumpDemandFulfilled(demandId: string, lines: Line[]) {
  // Increment fulfilled_qty on matching demand lines, and mark demand fulfilled
  // when every line is satisfied.
  const { data: dls } = await supabase.from("inv_demand_lines" as never)
    .select("id,item_id,size_value,requested_qty,fulfilled_qty")
    .eq("demand_id", demandId);
  const rows = (dls as unknown as { id: string; item_id: string; size_value: string | null; requested_qty: number; fulfilled_qty: number }[]) ?? [];
  for (const l of lines) {
    const match = rows.find((r) => r.item_id === l.item_id && (r.size_value ?? "") === (l.size_value ?? ""));
    if (!match) continue;
    const next = Math.min(Number(match.requested_qty ?? 0), Number(match.fulfilled_qty ?? 0) + l.qty);
    await supabase.from("inv_demand_lines" as never).update({ fulfilled_qty: next } as never).eq("id", match.id);
    match.fulfilled_qty = next;
  }
  const allDone = rows.every((r) => Number(r.fulfilled_qty ?? 0) >= Number(r.requested_qty ?? 0));
  await supabase.from("inv_demands" as never)
    .update({ status: allDone ? "fulfilled" : "partial" } as never)
    .eq("id", demandId);
}

function useResetOnOpen(open: boolean, reset: () => void) {
  const [last, setLast] = useState(false);
  if (open !== last) { setLast(open); if (open) reset(); }
}

function normalizeIdArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1).split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    return [trimmed];
  }
  return [trimmed];
}


function IssuanceDemandSelect({ openDemands, candById, value, onChange }: { openDemands: OpenDemand[]; candById: Map<string, Candidate>; value: string; onChange: (v: string) => void }) {
  const { data: summaries = new Map<string, string>() } = useDocItemSummaries("inv_demand_lines", openDemands.map((d) => d.id));

  const renderRow = (d: OpenDemand) => {
    const c = d.requester_candidate_id ? candById.get(d.requester_candidate_id) : null;
    const s = summaries.get(d.id);
    return (
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold">
          <span className="font-mono">{d.demand_number}</span>
          {c && <span className="text-muted-foreground font-normal"> → {c.full_name}</span>}
        </span>
        {c && <span className="text-[11px] text-muted-foreground truncate">{c.role_key?.replace(/_/g, " ")}{c.employee_code ? ` · ${c.employee_code}` : ""}</span>}
        {s && <span className="text-[11px] text-muted-foreground truncate">{s}</span>}
      </div>
    );
  };

  const selected = openDemands.find((d) => d.id === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-auto min-h-11 py-2 items-start">
        {selected ? renderRow(selected) : <SelectValue placeholder="Pick a pending demand to fulfil…" />}
      </SelectTrigger>
      <SelectContent>
        {openDemands.map((d) => (
          <SelectItem key={d.id} value={d.id} className="py-2">{renderRow(d)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
