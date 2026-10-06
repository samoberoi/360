import { useMemo, useState } from "react";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, MapPin, Radio, Send, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createFieldVisitRequest,
  listRecentRequestsAdmin,
  type FieldVisitRequest,
  type FieldVisitRequestPriority,
} from "@/lib/field-visit-requests";

type FoRow = { id: string; full_name: string; employee_code: string | null; mobile: string };
type UnitRow = {
  id: string;
  name: string;
  code: string | null;
  customer_id: string | null;
  branch_id: string | null;
  latitude: number | null;
  longitude: number | null;
  billing_city: string | null;
  billing_state: string | null;
};
type UnitForFo = UnitRow & { customer_name: string | null; branch_name: string | null };

async function loadFoDirectory(): Promise<{ fos: FoRow[]; unitsByFo: Map<string, UnitForFo[]> }> {
  const [fosRes, cuRes, esaRes, unitsRes, custRes, branchRes] = await Promise.all([
    supabase
      .from("candidates" as never)
      .select("id, full_name, employee_code, mobile, unit_id, role_key, status")
      .eq("role_key", "field_officer")
      .in("status", ["active", "approved"])
      .order("full_name"),
    supabase.from("candidate_units" as never).select("candidate_id, unit_id"),
    supabase.from("employee_scope_assignments" as never).select("candidate_id, scope_type, scope_id"),
    supabase
      .from("units" as never)
      .select("id, name, code, customer_id, branch_id, latitude, longitude, billing_city, billing_state"),
    supabase.from("customers" as never).select("id, name"),
    supabase.from("branches" as never).select("id, name"),
  ]);

  const fos = ((fosRes.data ?? []) as unknown as Array<
    FoRow & { unit_id: string | null }
  >);
  const cu = (cuRes.data ?? []) as unknown as Array<{ candidate_id: string; unit_id: string }>;
  const esa = (esaRes.data ?? []) as unknown as Array<{
    candidate_id: string;
    scope_type: string;
    scope_id: string;
  }>;
  const allUnits = (unitsRes.data ?? []) as unknown as UnitRow[];
  const customerMap = new Map(
    ((custRes.data ?? []) as unknown as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );
  const branchMap = new Map(
    ((branchRes.data ?? []) as unknown as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]),
  );

  const unitsByFo = new Map<string, UnitForFo[]>();
  for (const fo of fos) {
    const scoped = new Set<string>();
    if (fo.unit_id) scoped.add(fo.unit_id);
    for (const r of cu) if (r.candidate_id === fo.id) scoped.add(r.unit_id);
    const branchIds = new Set<string>();
    const custIds = new Set<string>();
    for (const s of esa) {
      if (s.candidate_id !== fo.id) continue;
      if (s.scope_type === "unit") scoped.add(s.scope_id);
      if (s.scope_type === "branch") branchIds.add(s.scope_id);
      if (s.scope_type === "customer") custIds.add(s.scope_id);
    }
    for (const u of allUnits) {
      if (u.branch_id && branchIds.has(u.branch_id)) scoped.add(u.id);
      if (u.customer_id && custIds.has(u.customer_id)) scoped.add(u.id);
    }
    const list: UnitForFo[] = allUnits
      .filter((u) => scoped.has(u.id))
      .map((u) => ({
        ...u,
        customer_name: u.customer_id ? customerMap.get(u.customer_id) ?? null : null,
        branch_name: u.branch_id ? branchMap.get(u.branch_id) ?? null : null,
      }))
      .sort((a, b) => (a.customer_name ?? "").localeCompare(b.customer_name ?? "") || a.name.localeCompare(b.name));
    unitsByFo.set(fo.id, list);
  }
  return { fos, unitsByFo };
}

function priorityBadge(p: FieldVisitRequestPriority) {
  const cls =
    p === "emergency"
      ? "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300"
      : p === "high"
      ? "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300"
      : "bg-slate-500/15 text-slate-700 ring-1 ring-slate-500/30 dark:text-slate-300";
  const label = p === "emergency" ? "Emergency" : p === "high" ? "High" : "Normal";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", cls)}>
      {label}
    </span>
  );
}

export function AdminFieldOfficerUnitsCard() {
  const mgrScope = useManagerFieldOfficerScope();
  const qc = useQueryClient();
  const dir = useQuery({
    queryKey: ["admin-fo-directory"],
    queryFn: loadFoDirectory,
    staleTime: 60_000,
  });
  const reqQ = useQuery({
    queryKey: ["admin-fvr-recent"],
    queryFn: () => listRecentRequestsAdmin(100),
    refetchInterval: 30_000,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{
    fo: FoRow;
    unit: UnitForFo;
  } | null>(null);

  const openRequestsByFoUnit = useMemo(() => {
    const m = new Map<string, FieldVisitRequest>();
    for (const r of reqQ.data ?? []) {
      if (r.status === "completed" || r.status === "cancelled") continue;
      m.set(`${r.candidate_id}:${r.unit_id}`, r);
    }
    return m;
  }, [reqQ.data]);

  const statusLabel = (s: FieldVisitRequest["status"]) =>
    s === "in_progress" ? "In progress" : s === "acknowledged" ? "Acknowledged" : "Sent";

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const fos = (dir.data?.fos ?? []).filter((f) => !mgrScope.isScoped || mgrScope.fieldOfficerIds.has(f.id));
  const unitsByFo = dir.data?.unitsByFo ?? new Map<string, UnitForFo[]>();

  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 shadow-sm backdrop-blur-xl sm:rounded-3xl">
      <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Field officers &amp; units
          </div>
          <h3 className="mt-0.5 font-display text-base font-bold tracking-tight text-foreground">
            Deployed roster
          </h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary ring-1 ring-primary/20">
          <Radio className="h-3 w-3" /> {fos.length}
        </span>
      </header>

      <ul className="divide-y divide-border/50">
        {dir.isLoading && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">Loading roster…</li>
        )}
        {!dir.isLoading && fos.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            No active field officers.
          </li>
        )}
        {fos.map((fo) => {
          const units = unitsByFo.get(fo.id) ?? [];
          const isOpen = expanded.has(fo.id);
          const openCount = units.reduce(
            (n, u) => (openRequestsByFoUnit.has(`${fo.id}:${u.id}`) ? n + 1 : n),
            0,
          );
          return (
            <li key={fo.id}>
              <button
                type="button"
                onClick={() => toggle(fo.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Shield className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-foreground">{fo.full_name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {fo.employee_code ?? "—"} · {units.length} unit{units.length === 1 ? "" : "s"}
                    {openCount > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-500/25 dark:text-rose-300">
                        <AlertTriangle className="h-2.5 w-2.5" /> {openCount} open
                      </span>
                    )}
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {isOpen && (
                <ul className="border-t border-border/40 bg-muted/30 px-2 py-2">
                  {units.length === 0 && (
                    <li className="px-3 py-2 text-[11px] italic text-muted-foreground">
                      No units mapped.
                    </li>
                  )}
                  {units.map((u) => {
                    const openReq = openRequestsByFoUnit.get(`${fo.id}:${u.id}`);
                    return (
                      <li
                        key={u.id}
                        className="mb-1 flex items-start gap-2 rounded-xl bg-background/70 px-3 py-2 ring-1 ring-border/40 last:mb-0"
                      >
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-foreground">
                            {u.customer_name ? `${u.customer_name} — ` : ""}
                            {u.name}
                          </div>
                          <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                            {u.code ?? "—"} · {u.billing_city ?? "—"}
                            {u.branch_name ? ` · ${u.branch_name}` : ""}
                          </div>
                          {openReq && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                              {priorityBadge(openReq.priority)}
                              <span className="font-semibold text-foreground/80">
                                {statusLabel(openReq.status)}
                              </span>
                              {openReq.reason && <span className="truncate">· {openReq.reason}</span>}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={openReq ? "outline" : "default"}
                          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                          onClick={() => setDialog({ fo, unit: u })}
                        >
                          <Send className="h-3 w-3" />
                          {openReq ? "Re-send" : "Request visit"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <RequestVisitDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        target={dialog}
        onSubmitted={() => {
          void qc.invalidateQueries({ queryKey: ["admin-fvr-recent"] });
        }}
      />
    </section>
  );
}

function RequestVisitDialog({
  open,
  onClose,
  target,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  target: { fo: FoRow; unit: UnitForFo } | null;
  onSubmitted: () => void;
}) {
  const [priority, setPriority] = useState<FieldVisitRequestPriority>("emergency");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!target) return;
    if (!reason.trim()) {
      toast.error("Please add a short reason for the visit.");
      return;
    }
    setSaving(true);
    try {
      await createFieldVisitRequest({
        candidateId: target.fo.id,
        unitId: target.unit.id,
        priority,
        reason: reason.trim(),
        unitLabel: `${target.unit.customer_name ? `${target.unit.customer_name} — ` : ""}${target.unit.name}`,
      });
      toast.success(`Sent to ${target.fo.full_name}`);
      setReason("");
      setPriority("emergency");
      onSubmitted();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error((e as Error).message ?? "Failed to send request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request site visit</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                Send to <span className="font-semibold text-foreground">{target.fo.full_name}</span> for{" "}
                <span className="font-semibold text-foreground">
                  {target.unit.customer_name ? `${target.unit.customer_name} — ` : ""}
                  {target.unit.name}
                </span>
                .
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Priority
            </label>
            <Select value={priority} onValueChange={(v) => setPriority(v as FieldVisitRequestPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="emergency">Emergency</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Reason / escalation notes
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client called — guard not at gate at Sector 12."
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
