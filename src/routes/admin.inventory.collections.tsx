import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, PackageCheck, Inbox, ShieldCheck, Warehouse, ChevronDown, ChevronRight, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { toast } from "sonner";
import { confirmAction } from "@/components/ConfirmProvider";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { postMovements, type LocationType } from "@/lib/inv-helpers";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";

export const Route = createFileRoute("/admin/inventory/collections")({ component: CollectionsPage });

const MODULE = "Inventory Collections";
const ENTITY = "inv_stock_movements";

export type ExitDocumentRecord = {
  key: "resignation_letter" | "id_card_photo";
  label: string;
  collected: boolean;
  file_url?: string | null;
  reason?: string;
};

export type ExitAssetNote = {
  item_id: string;
  size_value: string;
  item_name: string;
  held: number;
  collected: number;
  reason?: string;
};

type OffboardingDetails = {
  pending_collection_fo_id?: string | null;
  collection_status?: "pending" | "completed" | null;
  collection_requested_at?: string | null;
  reason_text?: string;
  date_of_offboarding?: string | null;
  exit_documents?: ExitDocumentRecord[];
  exit_asset_notes?: ExitAssetNote[];
};
type Candidate = { id: string; full_name: string; employee_code: string | null; mobile: string | null; role_key: string; unit_id: string | null; reports_to: string | null; offboarding_details?: OffboardingDetails | null };

type Unit = { id: string; code: string; name: string };
type Item = { id: string; name: string; item_code: string; is_sized: boolean };
type Balance = { location_type: string; location_id: string; item_id: string; size_value: string; qty: number };

function CollectionsPage() {
  const { user } = useAuth();
  const myPhone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(myPhone);

  const { data: me = null, isLoading: meLoading } = useQuery({
    queryKey: ["candidate-by-phone", myPhone],
    enabled: !!myPhone && !isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,mobile,role_key,unit_id,reports_to")
        .eq("mobile", myPhone)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Candidate) ?? null;
    },
  });

  const isFieldOfficer = !isSuperAdmin && me?.role_key === "field_officer";

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Collect stock back from guards reporting to you. New employee asset issue stays under Issuances with OTP acknowledgement."
        crumbs={[{ label: "Uniform Manager", to: "/admin/inventory" }, { label: "Collections" }]}
      />
      {meLoading ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !isFieldOfficer || !me ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
          Collections are available to field officers only.
        </div>
      ) : (
        <div className="space-y-6">
          <CollectionsPanel me={me} />
        </div>
      )}
    </div>
  );
}

function CollectionsPanel({ me }: { me: Candidate }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openGuard, setOpenGuard] = useState<string | null>(null);

  // 1. Guards reporting to me
  const { data: guards = [], isLoading: guardsLoading } = useQuery({
    queryKey: ["collections", "guards", me.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,mobile,role_key,unit_id,reports_to,offboarding_details")
        .eq("reports_to", me.id)
        .in("role_key", ["guard", "security_guard"])
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      const rows = (data as unknown as Candidate[]) ?? [];
      // One row per guard, even if the underlying query ever returns repeats.
      return Array.from(new Map(rows.map((r) => [r.id, r])).values());

    },
  });


  // Units covered by this field officer, so Collections opens with unit coverage first.
  const { data: coveredUnitIds = [] } = useQuery({
    queryKey: ["collections", "fo-covered-units", me.id],
    queryFn: async () => {
      const [scopeRes, legacyRes] = await Promise.all([
        supabase
          .from("employee_scope_assignments" as never)
          .select("scope_id,scope_type")
          .eq("candidate_id", me.id)
          .eq("scope_type", "unit"),
        supabase
          .from("candidate_units" as never)
          .select("unit_id")
          .eq("candidate_id", me.id),
      ]);
      if (scopeRes.error) throw scopeRes.error;
      if (legacyRes.error) throw legacyRes.error;
      const scoped = ((scopeRes.data ?? []) as unknown as { scope_id: string }[]).map((r) => r.scope_id);
      const legacy = ((legacyRes.data ?? []) as unknown as { unit_id: string }[]).map((r) => r.unit_id);
      return Array.from(new Set([...scoped, ...legacy]));
    },
  });

  // 2. Unit assignments (handles guards whose unit_id is null but who have scope_assignments)
  const guardIds = useMemo(() => guards.map((g) => g.id), [guards]);
  const { data: scopeUnits = [] } = useQuery({
    queryKey: ["collections", "guard-scope-units", guardIds.join(",")],
    enabled: guardIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_scope_assignments" as never)
        .select("candidate_id,scope_id,scope_type")
        .in("candidate_id", guardIds)
        .eq("scope_type", "unit");
      if (error) throw error;
      return (data as unknown as { candidate_id: string; scope_id: string }[]) ?? [];
    },
  });

  const guardUnitMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of guards) if (g.unit_id) m.set(g.id, g.unit_id);
    for (const r of scopeUnits) if (!m.has(r.candidate_id)) m.set(r.candidate_id, r.scope_id);
    return m;
  }, [guards, scopeUnits]);

  const unitIds = useMemo(() => Array.from(new Set([...coveredUnitIds, ...guardUnitMap.values()])), [coveredUnitIds, guardUnitMap]);

  const { data: units = [] } = useQuery({
    queryKey: ["collections", "units", unitIds.join(",")],
    enabled: unitIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("units" as never).select("id,code,name").in("id", unitIds);
      if (error) throw error;
      return (data as unknown as Unit[]) ?? [];
    },
  });
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  // 3. Stock at each guard
  const { data: balances = [], isLoading: balancesLoading } = useQuery({
    queryKey: ["collections", "balances", guardIds.join(",")],
    enabled: guardIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_stock_balances" as never)
        .select("location_type,location_id,item_id,size_value,qty")
        .in("location_type", ["guard", "security_guard"])
        .in("location_id", guardIds)
        .gt("qty", 0);
      if (error) throw error;
      return (data as unknown as Balance[]) ?? [];
    },
  });

  const itemIds = useMemo(() => Array.from(new Set(balances.map((b) => b.item_id))), [balances]);
  const { data: items = [] } = useQuery({
    queryKey: ["collections", "items", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("inv_items" as never).select("id,name,item_code,is_sized").in("id", itemIds);
      if (error) throw error;
      return (data as unknown as Item[]) ?? [];
    },
  });
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const balByGuard = useMemo(() => {
    const m = new Map<string, Balance[]>();
    for (const b of balances) {
      const arr = m.get(b.location_id) ?? [];
      arr.push(b);
      m.set(b.location_id, arr);
    }
    return m;
  }, [balances]);

  const recoverableGuards = useMemo(
    () => guards.filter((guard) => (balByGuard.get(guard.id) ?? []).some((balance) => Number(balance.qty) > 0)),
    [guards, balByGuard],
  );

  // Group by unit — a guard appears in exactly ONE block (their primary unit),
  // never duplicated across unit groups.
  const grouped = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Dedupe guards by id first (defensive: multi-unit joins can return repeats)
    const uniqueGuards = Array.from(new Map(recoverableGuards.map((g) => [g.id, g])).values());
    const filteredGuards = uniqueGuards.filter((g) => {
      if (!s) return true;
      return g.full_name.toLowerCase().includes(s) || (g.employee_code ?? "").toLowerCase().includes(s) || (g.mobile ?? "").includes(s);
    });
    const m = new Map<string, Candidate[]>();
    const UNASSIGNED = "__unassigned__";
    const placed = new Set<string>();
    for (const g of filteredGuards) {
      if (placed.has(g.id)) continue;
      placed.add(g.id);
      const uid = guardUnitMap.get(g.id) ?? UNASSIGNED;
      const arr = m.get(uid) ?? [];
      arr.push(g);
      m.set(uid, arr);
    }
    const out: { unit: Unit | null; guards: Candidate[] }[] = [];
    for (const [uid, arr] of m) {
      if (arr.length === 0) continue;
      out.push({ unit: uid === UNASSIGNED ? null : unitMap.get(uid) ?? null, guards: arr });
    }
    out.sort((a, b) => (a.unit?.name ?? "zzz").localeCompare(b.unit?.name ?? "zzz"));
    return out;
  }, [recoverableGuards, guardUnitMap, unitMap, q]);


  const totalGuards = recoverableGuards.length;
  const guardsWithStock = recoverableGuards.length;
  const pendingOffboardCount = useMemo(
    () =>
      recoverableGuards.filter(
        (g) =>
          g.offboarding_details?.collection_status === "pending" &&
          g.offboarding_details?.pending_collection_fo_id === me.id,
      ).length,
    [recoverableGuards, me.id],
  );


  const activeGuard = openGuard ? recoverableGuards.find((g) => g.id === openGuard) ?? null : null;
  const activeBalances = openGuard ? balByGuard.get(openGuard) ?? [] : [];

  const collectMut = useMutation({
    mutationFn: async (payload: {
      guard: Candidate;
      rows: { item_id: string; size_value: string; qty: number }[];
      docs?: ExitDocumentRecord[];
      notes?: ExitAssetNote[];
    }) => {
      const movs = payload.rows.flatMap((r) => ([
        {
          movement_type: "COLLECT_GUARD_OUT",
          location_type: (payload.guard.role_key === "security_guard" ? "guard" : "guard") as LocationType,
          location_id: payload.guard.id,
          item_id: r.item_id, size_value: r.size_value, qty_change: -r.qty,
          reference_type: "collection", reference_id: payload.guard.id,
        },
        {
          movement_type: "COLLECT_FO_IN",
          location_type: "field_officer" as LocationType,
          location_id: me.id,
          item_id: r.item_id, size_value: r.size_value, qty_change: r.qty,
          reference_type: "collection", reference_id: payload.guard.id,
        },
      ]));
      if (movs.length) await postMovements(movs);

      // Offboarding handshake — if this guard was flagged pending-offboarding for me,
      // record the exit-document checklist and finalise the offboarding.
      const od = payload.guard.offboarding_details ?? null;
      const isPendingOffboarding =
        od?.collection_status === "pending" && od?.pending_collection_fo_id === me.id;
      let finalisedOffboarding = false;
      if (isPendingOffboarding && payload.docs?.length) {
        const nowIso = new Date().toISOString();
        const nextDetails: OffboardingDetails = {
          ...od,
          collection_status: "completed",
          collection_requested_at: od?.collection_requested_at ?? nowIso,
          exit_documents: payload.docs,
          exit_asset_notes: payload.notes ?? [],
        };
        const { error: upErr } = await supabase
          .from("candidates" as never)
          .update({
            is_enabled: false,
            status: "inactive",
            offboarded_at: nowIso,
            offboarding_details: { ...nextDetails, collection_completed_at: nowIso, collection_completed_by: me.id },
          } as unknown as never)
          .eq("id", payload.guard.id);
        if (upErr) throw upErr;
        finalisedOffboarding = true;
        void logActivity({
          module: "Employees",
          action: "offboard",
          entityType: "candidate",
          entityId: payload.guard.id,
          entityLabel: `${payload.guard.full_name} finalised on FO collection`,
          details: {
            collected_by: me.id,
            exit_documents: payload.docs,
            exit_asset_notes: payload.notes ?? [],
          },
        });
      }

      void logActivity({
        module: MODULE, action: "collect", entityType: ENTITY, entityId: payload.guard.id,
        entityLabel: `Collected from ${payload.guard.full_name} (${payload.rows.length} item${payload.rows.length === 1 ? "" : "s"})`,
      });

      return { finalisedOffboarding };
    },
    onSuccess: (res) => {
      if (res?.finalisedOffboarding) {
        toast.success("Collection confirmed — employee offboarded.");
      } else {
        toast.success("Collected — stock returned to you");
      }
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["inv", "balances-sum"] });
      qc.invalidateQueries({ queryKey: ["inv"] });
      setOpenGuard(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });


  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Warehouse} label="Units with recovery" value={grouped.length} accent="bg-cyan-600" />
        <StatTile icon={ShieldCheck} label="Recoveries" value={totalGuards} accent="bg-emerald-600" />
        <StatTile icon={PackageCheck} label="Guards with stock" value={guardsWithStock} accent="bg-violet-600" />
        <StatTile icon={Inbox} label="Total items at guards" value={balances.reduce((s, b) => s + Number(b.qty || 0), 0)} accent="bg-amber-500" />
      </div>

      {pendingOffboardCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 shadow-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/20">
            <PackageCheck className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="font-semibold">Offboarding collection pending</div>
            <div className="text-[12px] text-rose-700/80">
              {pendingOffboardCount} guard{pendingOffboardCount === 1 ? "" : "s"} awaiting your inventory recovery.
              Their offboarding will complete only after you confirm collection.
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guard name, code or mobile…" className="h-10 rounded-lg pl-9" />
        </div>
      </div>


      {guardsLoading || balancesLoading ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
          {q.trim() ? "No recoverable stock matches your search." : "No stock is currently due for recovery."}
        </div>
      ) : (
        <div className="modern-business-form">
          {grouped.map(({ unit, guards: gList }) => (
            <UnitBlock
              key={unit?.id ?? "__unassigned__"}
              unit={unit}
              guards={gList}
              balByGuard={balByGuard}
              itemMap={itemMap}
              onCollect={(g) => setOpenGuard(g.id)}
            />
          ))}
        </div>
      )}

      {activeGuard && (
        <CollectDialog
          open={!!activeGuard}
          onOpenChange={(o) => !o && setOpenGuard(null)}
          guard={activeGuard}
          unit={unitMap.get(guardUnitMap.get(activeGuard.id) ?? "") ?? null}
          balances={activeBalances}
          itemMap={itemMap}
          submitting={collectMut.isPending}
          isOffboarding={
            activeGuard.offboarding_details?.collection_status === "pending" &&
            activeGuard.offboarding_details?.pending_collection_fo_id === me.id
          }
          onConfirm={(rows, docs, notes) => collectMut.mutate({ guard: activeGuard, rows, docs, notes })}
        />
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; accent: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-4 shadow-sm text-white ${accent}`}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/25">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90">{label}</div>
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular-nums tracking-tight text-white">{value.toLocaleString()}</div>
    </div>
  );
}

function UnitBlock({ unit, guards, balByGuard, itemMap, onCollect }: {
  unit: Unit | null;
  guards: Candidate[];
  balByGuard: Map<string, Balance[]>;
  itemMap: Map<string, Item>;
  onCollect: (g: Candidate) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-5 py-4 text-left transition hover:bg-secondary/30">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600">
            <Warehouse className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{unit ? `${unit.code} · ${unit.name}` : "Unassigned guards"}</div>
            <div className="text-[11px] text-muted-foreground">{guards.length} guard{guards.length === 1 ? "" : "s"}</div>
          </div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="divide-y divide-border/50">
          {guards.map((g) => {
            const bals = balByGuard.get(g.id) ?? [];
            const totalQty = bals.reduce((s, b) => s + Number(b.qty || 0), 0);
            const isPendingOff =
              g.offboarding_details?.collection_status === "pending" &&
              !!g.offboarding_details?.pending_collection_fo_id;
            return (
              <div
                key={g.id}
                className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${isPendingOff ? "bg-rose-500/5" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isPendingOff ? "bg-rose-500/15 text-rose-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                      <span>{g.full_name}</span>
                      {isPendingOff && (
                        <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                          Offboarding · collect pending
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{g.employee_code ?? "—"}{g.mobile ? ` · +91 ${g.mobile}` : ""}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {bals.length === 0 && <span className="text-[11px] text-muted-foreground">Nothing assigned</span>}
                      {bals.map((b, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {itemMap.get(b.item_id)?.name ?? "—"}
                          {b.size_value ? <span className="text-muted-foreground">({b.size_value})</span> : null}
                          <span className="text-muted-foreground">× {b.qty}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right text-[11px] text-muted-foreground">{totalQty} item{totalQty === 1 ? "" : "s"} held</div>
                  <Button
                    size="sm"
                    disabled={bals.length === 0}
                    onClick={() => onCollect(g)}
                    className={`h-9 rounded-md ${isPendingOff ? "bg-rose-600 text-white hover:bg-rose-700" : ""}`}
                  >
                    <PackageCheck className="mr-1.5 h-4 w-4" /> {isPendingOff ? "Confirm collection" : "Recover"}
                  </Button>
                </div>
              </div>
            );

          })}
        </div>
      )}
    </div>
  );
}

const EXIT_DOCS: { key: ExitDocumentRecord["key"]; label: string; hint: string }[] = [
  { key: "resignation_letter", label: "Resignation letter", hint: "Signed resignation letter from the employee (image or PDF)." },
  { key: "id_card_photo", label: "Identity card photo", hint: "Photo of the company identity card being surrendered." },
];

function CollectDialog({ open, onOpenChange, guard, unit, balances, itemMap, onConfirm, submitting, isOffboarding }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  guard: Candidate;
  unit: Unit | null;
  balances: Balance[];
  itemMap: Map<string, Item>;
  onConfirm: (
    rows: { item_id: string; size_value: string; qty: number }[],
    docs?: ExitDocumentRecord[],
    notes?: ExitAssetNote[],
  ) => void;
  submitting: boolean;
  isOffboarding: boolean;
}) {
  // Default: take everything back
  const [qtyMap, setQtyMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const b of balances) m[`${b.item_id}|${b.size_value}`] = Number(b.qty || 0);
    return m;
  });
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const b of balances) m[`${b.item_id}|${b.size_value}`] = Number(b.qty || 0) > 0;
    return m;
  });
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [docState, setDocState] = useState<Record<string, { collected: boolean | null; url: string | null; fileName: string; reason: string; uploading: boolean }>>(
    () => Object.fromEntries(EXIT_DOCS.map((d) => [d.key, { collected: null, url: null, fileName: "", reason: "", uploading: false }])),
  );

  const uploadDoc = async (key: string, file: File | null) => {
    if (!file) return;
    setDocState((s) => ({ ...s, [key]: { ...s[key], uploading: true } }));
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `offboarding/${guard.id}/${key}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("candidate-files")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data: signed, error: signErr } = await supabase.storage
        .from("candidate-files")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (signErr) throw signErr;
      setDocState((s) => ({ ...s, [key]: { ...s[key], url: signed.signedUrl, fileName: file.name, uploading: false } }));
    } catch (e) {
      setDocState((s) => ({ ...s, [key]: { ...s[key], uploading: false } }));
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const setAll = (mode: "all" | "none") => {
    const q: Record<string, number> = {};
    const checked: Record<string, boolean> = {};
    for (const b of balances) {
      const key = `${b.item_id}|${b.size_value}`;
      q[key] = mode === "all" ? Number(b.qty || 0) : 0;
      checked[key] = mode === "all";
    }
    setQtyMap(q);
    setCheckedMap(checked);
  };

  const totalSelected = balances.reduce((s, b) => {
    const key = `${b.item_id}|${b.size_value}`;
    return s + (checkedMap[key] ? Number(qtyMap[key] || 0) : 0);
  }, 0);

  // Which asset lines are short (not fully recovered) and therefore need a reason
  const shortKeys = balances
    .map((b) => {
      const key = `${b.item_id}|${b.size_value}`;
      const taken = checkedMap[key] ? Number(qtyMap[key] || 0) : 0;
      return taken < Number(b.qty || 0) ? key : null;
    })
    .filter(Boolean) as string[];

  const docsAnswered = EXIT_DOCS.every((d) => {
    const st = docState[d.key];
    if (st.collected === null) return false;
    return st.collected ? !!st.url : st.reason.trim().length >= 3;
  });
  const reasonsGiven = shortKeys.every((k) => (reasonMap[k] ?? "").trim().length >= 3);
  const canSubmit = isOffboarding ? docsAnswered && reasonsGiven : totalSelected > 0;

  const handleConfirm = async () => {
    const rows = balances
      .map((b) => ({ item_id: b.item_id, size_value: b.size_value, qty: Math.min(Number(qtyMap[`${b.item_id}|${b.size_value}`] || 0), Number(b.qty || 0)) }))
      .filter((r) => checkedMap[`${r.item_id}|${r.size_value}`] && r.qty > 0);

    if (!isOffboarding && !rows.length) return toast.error("Select at least one item");

    if (isOffboarding) {
      if (!docsAnswered) return toast.error("Answer both exit documents — upload the file or give a reason");
      if (!reasonsGiven) return toast.error("Give a reason for every asset that was not fully recovered");
    }

    const allFull = rows.length === balances.length && rows.every((r) => {
      const b = balances.find((x) => x.item_id === r.item_id && x.size_value === r.size_value);
      return b && r.qty === Number(b.qty || 0);
    });
    if (!(await confirmAction({
      title: isOffboarding ? "Confirm exit collection" : "Confirm collection",
      description: isOffboarding
        ? `Finalise the exit collection for ${guard.full_name}? The employee will be deactivated once you confirm.`
        : allFull
          ? `Recover everything from ${guard.full_name}? It will be removed from the guard and added to your field-officer stock.`
          : `Recover ${rows.length} selected item${rows.length === 1 ? "" : "s"} from ${guard.full_name}?`,
      confirmText: isOffboarding ? "Confirm exit" : "Mark Recovered",
    }))) return;

    if (!isOffboarding) {
      onConfirm(rows);
      return;
    }

    const docs: ExitDocumentRecord[] = EXIT_DOCS.map((d) => ({
      key: d.key,
      label: d.label,
      collected: docState[d.key].collected === true,
      file_url: docState[d.key].url,
      reason: docState[d.key].collected ? "" : docState[d.key].reason.trim(),
    }));
    const notes: ExitAssetNote[] = balances.map((b) => {
      const key = `${b.item_id}|${b.size_value}`;
      const taken = checkedMap[key] ? Number(qtyMap[key] || 0) : 0;
      return {
        item_id: b.item_id,
        size_value: b.size_value,
        item_name: itemMap.get(b.item_id)?.name ?? "",
        held: Number(b.qty || 0),
        collected: taken,
        reason: taken < Number(b.qty || 0) ? (reasonMap[key] ?? "").trim() : "",
      };
    });
    onConfirm(rows, docs, notes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isOffboarding ? "Exit collection" : "Recover stock"} — {guard.full_name}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {guard.employee_code ?? "—"}{unit ? ` · ${unit.code} · ${unit.name}` : ""}
          </div>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
          {isOffboarding && (
            <div className="space-y-2 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Mandatory exit documents
              </div>
              {EXIT_DOCS.map((d) => {
                const st = docState[d.key];
                return (
                  <div key={d.key} className="rounded-lg border border-border/60 bg-card p-3">
                    <div className="text-sm font-medium text-foreground">{d.label}</div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{d.hint}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={st.collected === true ? "default" : "outline"}
                        className="h-7 rounded-md text-xs"
                        onClick={() => setDocState((s) => ({ ...s, [d.key]: { ...s[d.key], collected: true } }))}
                      >
                        Collected
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={st.collected === false ? "default" : "outline"}
                        className="h-7 rounded-md text-xs"
                        onClick={() => setDocState((s) => ({ ...s, [d.key]: { ...s[d.key], collected: false } }))}
                      >
                        Not collected
                      </Button>
                    </div>
                    {st.collected === true && (
                      <div className="mt-2 space-y-1">
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          className="h-9 rounded-md text-xs"
                          onChange={(e) => void uploadDoc(d.key, e.target.files?.[0] ?? null)}
                        />
                        <div className="text-[11px] text-muted-foreground">
                          {st.uploading ? "Uploading…" : st.url ? `Uploaded: ${st.fileName}` : "Upload is mandatory when marked collected."}
                        </div>
                      </div>
                    )}
                    {st.collected === false && (
                      <Input
                        placeholder="Reason for not collecting (mandatory)"
                        value={st.reason}
                        className="mt-2 h-9 rounded-md text-sm"
                        onChange={(e) => setDocState((s) => ({ ...s, [d.key]: { ...s[d.key], reason: e.target.value } }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Tick the items being recovered, then set the quantity.</div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="h-7 rounded-md text-xs" onClick={() => setAll("all")}>Recover all</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md text-xs" onClick={() => setAll("none")}>Clear</Button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 bg-background p-3">
            {balances.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Nothing assigned to this guard.</div>
            ) : balances.map((b) => {
              const key = `${b.item_id}|${b.size_value}`;
              const item = itemMap.get(b.item_id);
              const max = Number(b.qty || 0);
              const val = qtyMap[key] ?? 0;
              const checked = checkedMap[key] ?? false;
              const short = (checked ? val : 0) < max;
              return (
                <div key={key} className={`rounded-lg border border-border/60 bg-card px-3 py-2 transition ${checked ? "ring-1 ring-emerald-500/25" : "opacity-70"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        const isChecked = next === true;
                        setCheckedMap((m) => ({ ...m, [key]: isChecked }));
                        if (isChecked && Number(qtyMap[key] || 0) === 0) {
                          setQtyMap((m) => ({ ...m, [key]: max }));
                        }
                      }}
                      aria-label={`Recover ${item?.name ?? "item"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{item?.name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {item?.item_code ?? ""}{b.size_value ? ` · Size ${b.size_value}` : ""} · Held: {max}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="outline" disabled={!checked} className="h-8 w-8 rounded-md p-0" onClick={() => setQtyMap((m) => ({ ...m, [key]: Math.max(0, (m[key] ?? 0) - 1) }))}>−</Button>
                      <Input
                        type="number"
                        min={0}
                        max={max}
                        value={val}
                        disabled={!checked}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(max, Number(e.target.value) || 0));
                          setQtyMap((m) => ({ ...m, [key]: n }));
                          setCheckedMap((m) => ({ ...m, [key]: n > 0 }));
                        }}
                        className="h-8 w-16 rounded-md text-center"
                      />
                      <Button type="button" size="sm" variant="outline" disabled={!checked} className="h-8 w-8 rounded-md p-0" onClick={() => setQtyMap((m) => ({ ...m, [key]: Math.min(max, (m[key] ?? 0) + 1) }))}>+</Button>
                      <span className="ml-1 text-[11px] text-muted-foreground">/ {max}</span>
                    </div>
                  </div>
                  {isOffboarding && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={checked && val === max ? "default" : "outline"}
                        className="h-7 rounded-md text-xs"
                        onClick={() => {
                          setCheckedMap((m) => ({ ...m, [key]: true }));
                          setQtyMap((m) => ({ ...m, [key]: max }));
                          setReasonMap((m) => ({ ...m, [key]: "" }));
                        }}
                      >
                        Collected
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={!checked || val === 0 ? "default" : "outline"}
                        className="h-7 rounded-md text-xs"
                        onClick={() => {
                          setCheckedMap((m) => ({ ...m, [key]: false }));
                          setQtyMap((m) => ({ ...m, [key]: 0 }));
                        }}
                      >
                        Not collected
                      </Button>
                    </div>
                  )}
                  {isOffboarding && short && (
                    <Input
                      placeholder="Reason for not collecting this item (mandatory)"
                      value={reasonMap[key] ?? ""}
                      className="mt-2 h-9 rounded-md text-sm"
                      onChange={(e) => setReasonMap((m) => ({ ...m, [key]: e.target.value }))}
                    />
                  )}

                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-9 rounded-md">
            <X className="mr-1.5 h-4 w-4" /> Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting || !canSubmit} className="h-9 rounded-md">
            <PackageCheck className="mr-1.5 h-4 w-4" />
            {submitting ? "Saving…" : isOffboarding ? "Confirm exit collection" : `Mark recovered (${totalSelected})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


