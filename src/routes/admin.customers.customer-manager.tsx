import { createFileRoute } from "@tanstack/react-router";
import { RecordViewButton } from "@/components/RecordViewButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Edit2, ExternalLink, List as ListIcon, MapPin, Network, Plus, Search, Users, Warehouse } from "lucide-react";
import { DeleteGuardButton } from "@/components/DeleteGuardButton";
import { csvStatus, downloadCsv } from "@/lib/csv-export";
import { toast } from "sonner";
import { confirmAction, notifySaved } from "@/components/ConfirmProvider";
import { logActivity } from "@/lib/activity-log";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { DataPagination, usePagination } from "@/components/DataPagination";
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
  INDUSTRY_TYPES,
  nextCustomerCode,
  useCustomers,
  useUnits,
  useBranches,
  useStates,
  type Customer,
  type CustomerStatus,
  type Unit,
} from "@/lib/admin-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

import { cn } from "@/lib/utils";
import { useOperationalUnitScope } from "@/lib/use-manager-scope";
import { UnitDeployedPeople } from "@/components/UnitDeployedPeople";
import { GuidedForm, useGuidedFormCloseGuard, useGuidedFormDraft, type GuidedFormStep } from "@/components/GuidedForm";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Mx."];

export const Route = createFileRoute("/admin/customers/customer-manager")({
  head: () => ({
    meta: [
      { title: "Organizations | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Manage organizations and their client locations." },
      { property: "og:title", content: "Organizations | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Manage organizations and their client locations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerManagerPage,
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function CustomerManagerPage() {
  const { customers: allCustomers, addCustomer, updateCustomer, deleteCustomer } = useCustomers();
  const foScope = useOperationalUnitScope();
  // Field officers only see the organizations they are actually mapped to.
  const customers = useMemo(
    () => (foScope.isScoped ? allCustomers.filter((c) => foScope.customerIds.has(c.id)) : allCustomers),
    [allCustomers, foScope.isScoped, foScope.customerIds],
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [viewingUnits, setViewingUnits] = useState<Customer | null>(null);

  const rows = useMemo(() => {
    const list = [...customers]
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .sort((a, b) => {
        const na = parseInt(a.code.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.code.replace(/\D/g, ""), 10) || 0;
        return na - nb;
      });
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.website.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q),
    );
  }, [customers, query, statusFilter]);

  const activeCount = customers.filter((c) => c.status === "active").length;
  const pg = usePagination(rows);

  return (
    <div>
      <PageHeader
        title="Organizations"
        eyebrow="Organizations"
        icon={Network}
        description="Onboard organisations and manage their contract details."
        crumbs={[
          { label: "Organizations", to: "/admin/customers/customer-manager" },
          { label: "Organizations" },
        ]}
        kpis={
          <>
            <PageStat label="Total organizations" value={customers.length} icon={Network} />
            <PageStat label="Active" value={activeCount} tone="accent" icon={Users} />
            <PageStat label="Inactive" value={customers.length - activeCount} tone="warning" />
          </>
        }
      />

      <div className="mobile-directory-toolbar mobile-glass-surface mb-3 grid grid-cols-1 gap-1.5 rounded-xl border border-border/60 bg-card/60 p-2 sm:mb-4 sm:flex sm:items-center sm:justify-between sm:gap-2 sm:rounded-2xl sm:p-2.5">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_8.5rem] gap-2 sm:flex sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID, name, website, phone, address…"
              className="h-10 rounded-xl border-transparent bg-card/80 pl-9 shadow-sm focus-visible:border-accent/30"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full rounded-xl border-transparent bg-card/80 shadow-sm sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "organizations",
                rows.map((c) => ({
                  orgId: c.code,
                  organisation: c.name,
                  website: c.website,
                  phone: c.phone,
                  address: c.address,
                  status: csvStatus(c.status),
                })),
                [
                  { key: "orgId", header: "Org ID" },
                  { key: "organisation", header: "Organisation" },
                  { key: "website", header: "Website" },
                  { key: "phone", header: "Phone" },
                  { key: "address", header: "Address" },
                  { key: "status", header: "Status" },
                ],
              )
            }
            disabled={rows.length === 0}
            className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="h-9 shrink-0 whitespace-nowrap rounded-lg bg-primary px-2.5 text-xs text-primary-foreground shadow-sm hover:bg-primary/90 sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="sm:hidden">Add</span><span className="hidden sm:inline">Add Organization</span>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/60 bg-accent/[0.06] px-3 py-2 text-xs text-foreground sm:px-5 sm:py-2.5">
          <span className="inline-flex items-center gap-2"><span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] text-primary-foreground">{rows.length}</span><span className="uppercase tracking-[0.14em] text-muted-foreground">Total {rows.length === 1 ? "row" : "rows"}</span></span>
        </div>

        <div className="min-w-0 overflow-x-auto overscroll-x-contain">
          <table className="ios-table w-full table-auto text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Org ID</th>
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Website</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td data-label="Org ID" className="px-5 py-3 font-mono text-xs font-semibold text-accent">
                    {c.code}
                  </td>
                  <td data-label="Organization" className="px-5 py-3" data-wrap="true">
                    <div className="font-semibold text-foreground">{c.name}</div>
                    {c.address && (
                      <div className="text-xs text-muted-foreground">
                        {c.address}
                      </div>
                    )}
                  </td>
                  <td data-label="Website" className="px-5 py-3 text-muted-foreground" data-wrap="true">
                    {c.website ? (
                      <a
                        href={normaliseUrl(c.website)}
                        target="_blank"
                        rel="noreferrer"
                        className="cell-pill"
                        title={c.website}
                      >
                        <span>{c.website}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="italic opacity-60">—</span>
                    )}
                  </td>
                  <td data-label="Phone" className="px-5 py-3 font-mono text-xs text-foreground">
                    {c.phone || <span className="italic opacity-60">—</span>}
                  </td>
                  <td data-label="Status" className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td data-label="Actions" className="px-5 py-3 text-right" data-col="actions">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-accent"
                        onClick={() => setViewingUnits(c)}
                        aria-label="View clients"
                        title="View mapped clients"
                      >
                        <Network className="h-4 w-4" />
                      </Button>
                      <RecordViewButton
                        record={c}
                        title="Customer details"
                        onEdit={() => { setEditing(c);
                          setFormOpen(true); }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        aria-label="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <DeleteGuardButton
                        id={c.id}
                        entityLabel="organization"
                        checks={[
                          { table: "units", column: "customer_id", label: "units" },
                        ]}
                        onDelete={() => setDeleting(c)}
                      />

                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-sm text-muted-foreground"
                  >
                    <Users className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    {customers.length === 0
                      ? "No organizations yet. Add your first organization to get started."
                      : "No organizations match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      </div>

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSubmit={async (data) => {
          if (editing) {
            const r = await updateCustomer(editing.id, data);
            if (!r.ok) return { error: r.error, id: null };
            void logActivity({ module: "Organizations", action: "update", entityType: "customers", entityId: editing.id, entityLabel: String(data.name ?? ""), details: data as Record<string, unknown> });
            return { error: null, id: editing.id };
          }
          const r = await addCustomer(data);
          if (!r.ok) return { error: r.error, id: null };
          void logActivity({ module: "Organizations", action: "create", entityType: "customers", entityId: r.id, entityLabel: String(data.name ?? ""), details: data as Record<string, unknown> });
          return { error: null, id: r.id };
        }}
        onSuccess={() => {
          void notifySaved({ title: "Saved", description: editing ? "Organization updated" : "Organization added" });
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <span className="font-semibold text-foreground">{deleting?.name}</span>{" "}
              (
              <span className="font-mono text-foreground">{deleting?.code}</span>
              ) from the directory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  const _delId = deleting.id;
                  const _delLabel = String((deleting as Record<string, unknown>).name ?? (deleting as Record<string, unknown>).code ?? _delId);
                  await deleteCustomer(_delId);
                  void logActivity({ module: "Organizations", action: "delete", entityType: "customers", entityId: _delId, entityLabel: _delLabel });
                  toast.success("Organization deleted");
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

      <CustomerUnitsDialog
        customer={viewingUnits}
        onOpenChange={(o) => !o && setViewingUnits(null)}
      />
    </div>
  );
}

function CustomerUnitsDialog({
  customer,
  onOpenChange,
}: {
  customer: Customer | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { units: allUnits, updateUnit } = useUnits();
  const foScope = useOperationalUnitScope();
  const units = useMemo(
    () => (foScope.isScoped ? allUnits.filter((u) => foScope.unitIds.has(u.id)) : allUnits),
    [allUnits, foScope.isScoped, foScope.unitIds],
  );
  const { branches } = useBranches();
  const { states } = useStates();
  const [view, setView] = useState<"list" | "tree">("list");

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const stateById = useMemo(() => new Map(states.map((s) => [s.id, s])), [states]);

  const orgUnits = useMemo(() => {
    if (!customer) return [];
    return units
      .filter((u) => u.customerId === customer.id)
      .sort((a, b) => {
        const na = parseInt(a.code.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.code.replace(/\D/g, ""), 10) || 0;
        return na - nb;
      });
  }, [units, customer]);

  const branchLabel = (u: Unit) => {
    if (!u.branchId) return "—";
    const b = branchById.get(u.branchId);
    if (!b) return "—";
    const st = stateById.get(b.stateId)?.name ?? "";
    return `${b.code} – ${st}`;
  };

  const toggleStatus = async (u: Unit) => {
    const next = u.status === "active" ? "inactive" : "active";
    const { id: _id, ...rest } = u;
    void _id;
    const r = await updateUnit(u.id, { ...rest, status: next });
    if (r.ok) toast.success(`${u.code} marked ${next}`);
    else toast.error(r.error);
  };

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            {customer?.name}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{customer?.code}</span>
            {customer?.address ? <> · {customer.address}</> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {orgUnits.length} unit{orgUnits.length === 1 ? "" : "s"} mapped
          </div>
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold",
                view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <ListIcon className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setView("tree")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold",
                view === "tree" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <Network className="h-3.5 w-3.5" /> Tree
            </button>
          </div>
        </div>

        {orgUnits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            <Warehouse className="mx-auto mb-2 h-6 w-6 opacity-50" />
            No units mapped to this organisation yet.
          </div>
        ) : view === "list" ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="ios-table w-full text-sm">
              <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Branch</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orgUnits.map((u) => (
                  <tr key={u.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs font-semibold text-accent">{u.code}</div>
                      <div className="font-semibold text-foreground">{u.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{branchLabel(u)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="line-clamp-1">{u.location || "—"}</span>
                        {u.latitude != null && u.longitude != null && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${u.latitude},${u.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/10"
                            title="Open in Google Maps"
                          >
                            <MapPin className="h-3 w-3" /> Map
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Switch
                        checked={u.status === "active"}
                        onCheckedChange={() => toggleStatus(u)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-accent" />
              {customer?.name}
              <span className="font-mono text-xs text-muted-foreground">({customer?.code})</span>
            </div>
            <ul className="mt-2 space-y-1.5 border-l-2 border-dashed border-border pl-4">
              {orgUnits.map((u) => {
                const stName = u.branchId
                  ? stateById.get(branchById.get(u.branchId)?.stateId ?? "")?.name ?? ""
                  : "";
                return (
                  <li
                    key={u.id}
                    className="relative rounded-lg border border-border bg-secondary/30 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <Warehouse className="h-4 w-4 text-accent" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-accent">{u.code}</span>
                          <span className="font-semibold text-foreground">{u.name}</span>
                          <StatusBadge status={u.status} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {branchLabel(u)} · {u.location || "—"}
                        </div>
                      </div>
                      {u.latitude != null && u.longitude != null && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${u.latitude},${u.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
                        >
                          <MapPin className="h-3 w-3" /> Map
                        </a>
                      )}
                      <Switch
                        checked={u.status === "active"}
                        onCheckedChange={() => toggleStatus(u)}
                      />
                    </div>
                    <div className="mt-2 ml-7 border-l-2 border-dashed border-border pl-3">
                      <UnitDeployedPeople
                        unitId={u.id}
                        branchId={u.branchId ?? null}
                        customerId={u.customerId ?? null}
                        stateName={stName}
                        isBillable={u.isBillable !== false}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function normaliseUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function StatusBadge({ status }: { status: CustomerStatus }) {
  return (
                        <span
      className={cn(
                            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
        status === "active"
          ? "bg-accent/15 text-accent"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "active" ? "bg-accent" : "bg-muted-foreground",
        )}
      />
      {status}
    </span>
  );
}





function CustomerFormDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Customer | null;
  onSubmit: (
    data: Omit<Customer, "id">,
  ) => Promise<{ error: string | null; id: string | null }>;
  onSuccess: () => void;
}) {
  const { customers } = useCustomers();
  const [form, setForm] = useState<Omit<Customer, "id">>(emptyCustomer());
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stepKey, setStepKey] = useState("profile");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const { id: _id, ...rest } = editing;
      void _id;
      setForm(rest);
    } else {
      setForm({ ...emptyCustomer(), code: nextCustomerCode(customers) });
    }
    setError(null);
    setStepKey("profile");
  }, [open, editing, customers]);

  const set = <K extends keyof Omit<Customer, "id">>(key: K, value: Omit<Customer, "id">[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const handleLogo = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${form.code || "ORG"}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("org-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("org-logos").getPublicUrl(path);
      set("logoUrl", data.publicUrl);
      toast.success("Logo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const contactFields: Array<{ key: keyof Omit<Customer, "id">; label: string; placeholder?: string; full?: boolean }> = [
    { key: "billingName", label: "Name" },
  ];
  const billingFields: Array<{ key: keyof Omit<Customer, "id">; label: string; placeholder?: string; full?: boolean }> = [
    { key: "billingAddress1", label: "Address line 1", full: true },
    { key: "billingAddress2", label: "Address line 2", full: true },
    { key: "billingPincode", label: "Pincode" },
    { key: "billingCity", label: "City" },
    { key: "billingDistrict", label: "District" },
    { key: "billingState", label: "State" },
    { key: "billingCountry", label: "Country" },
    { key: "billingEmail", label: "Email" },
    { key: "billingPhone", label: "Phone" },
    { key: "billingFax", label: "Alternate phone" },
  ];
  const shippingFields = billingFields.map((f) => ({
    ...f,
    key: f.key.toString().replace("billing", "shipping") as keyof Omit<Customer, "id">,
  }));

  const steps: GuidedFormStep[] = [
    { key: "profile", label: "Profile", caption: "Name, identity and status" },
    { key: "contact", label: "Contact", caption: "Primary contact person" },
    { key: "billing", label: "Billing", caption: "Billing address and contact" },
    { key: "deployment", label: "Deployment", caption: "Shipping or deployment address" },
    { key: "review", label: "Review", caption: "Check and create the organization" },
  ];
  const validateStep = (key: string) => {
    if (key === "profile") {
      if (!form.code.trim()) return "Organization ID is required";
      if (!form.name.trim()) return "Organization name is required";
    }
    if (key === "billing" && form.billingPincode && !/^\d{6}$/.test(form.billingPincode)) return "Enter a valid 6-digit billing pincode";
    if (key === "deployment" && !form.shippingSameAsBilling && form.shippingPincode && !/^\d{6}$/.test(form.shippingPincode)) return "Enter a valid 6-digit deployment pincode";
    return null;
  };
  const isStepComplete = (key: string): boolean => {
    if (key === "profile") return !validateStep(key);
    if (key === "contact") return Boolean(form.billingName.trim());
    if (key === "billing") return Boolean(form.billingAddress1.trim() && form.billingCity.trim() && !validateStep(key));
    if (key === "deployment") return form.shippingSameAsBilling || Boolean(form.shippingAddress1.trim() && form.shippingCity.trim() && !validateStep(key));
    return steps.slice(0, 4).every((step) => isStepComplete(step.key));
  };
  const requestStep = (key: string) => {
    const currentIndex = steps.findIndex((step) => step.key === stepKey);
    const targetIndex = steps.findIndex((step) => step.key === key);
    if (targetIndex > currentIndex) {
      for (let index = 0; index < targetIndex; index += 1) {
        const problem = validateStep(steps[index].key);
        if (problem) {
          toast.error(problem);
          setStepKey(steps[index].key);
          return;
        }
      }
    }
    setStepKey(key);
  };
  const restoreDraft = useCallback((draft: Omit<Customer, "id">) => setForm(draft), []);
  const meaningfulDraft = useCallback((draft: Omit<Customer, "id">) => Boolean(draft.name || draft.billingName || draft.billingAddress1), []);
  const draft = useGuidedFormDraft({
    open,
    storageKey: editing ? null : "rg-wizard-draft-organization",
    value: form,
    onRestore: restoreDraft,
    isMeaningful: meaningfulDraft,
  });
  const submitForm = async () => {
    for (const step of steps.slice(0, 4)) {
      const problem = validateStep(step.key);
      if (problem) {
        toast.error(problem);
        setStepKey(step.key);
        return;
      }
    }
    setSubmitting(true);
    try {
      const result = await onSubmit(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      draft.clear();
      onSuccess();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const closeGuard = useGuidedFormCloseGuard(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={closeGuard.onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl sm:border">
        <DialogHeader className="sr-only">
          <DialogTitle>{editing ? "Edit organization" : "Add organization"}</DialogTitle>
          <DialogDescription>Organization setup</DialogDescription>
        </DialogHeader>
        <GuidedForm closeGuardRef={closeGuard.ref}
          title={editing ? "Edit organization" : "New organization"}
          steps={steps}
          stepKey={stepKey}
          onStepChange={requestStep}
          isStepComplete={isStepComplete}
          onCancel={() => onOpenChange(false)}
          onSaveDraft={editing ? undefined : () => { draft.save(); toast.success("Draft saved"); }}
          onSubmit={() => void submitForm()}
          saving={submitting || uploading}
          submitLabel={editing ? "Save changes" : "Create organization"}
        >
          {draft.hasDraft && !editing && stepKey === "profile" && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Saved draft available</span>
              <Button type="button" size="sm" variant="outline" onClick={() => { draft.restore(); toast.success("Draft restored"); }}>Restore</Button>
            </div>
          )}
          {stepKey === "profile" && <section className="modern-form-section">
            <SectionHeading title="Organization profile" />
            <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organisation ID" required>
              <Input
                value={form.code}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
                placeholder="ORG1"
                className="font-mono"
              />
            </Field>
            <Field label="Organisation name" required>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Acme Industries Pvt Ltd"
                autoFocus
              />
            </Field>
            <Field label="Short name">
              <Input
                value={form.shortName}
                onChange={(e) => set("shortName", e.target.value)}
                placeholder="Acme"
              />
            </Field>
            <Field label="Industry / Organization type">
              <select
                value={form.industryType}
                onChange={(e) => set("industryType", e.target.value)}
                className="flex h-10 w-full rounded-xl border border-border/80 bg-card px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10"
              >
                <option value="">Select industry…</option>
                {INDUSTRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Website">
              <Input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="acme.com"
              />
            </Field>
            <Field label="Status">
              <div className="modern-form-toggle">
                <span className="text-sm font-medium text-foreground">
                  {form.status === "active" ? "Active" : "Inactive"}
                </span>
                <Switch
                  checked={form.status === "active"}
                  onCheckedChange={(v) => set("status", v ? "active" : "inactive")}
                />
              </div>
            </Field>
            </div>
          </section>}

          {stepKey === "contact" && <section className="modern-form-section">
            <SectionHeading title="Contact person" />
            <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Salutation">
              <Select value={form.billingSalutation} onValueChange={(value) => set("billingSalutation", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select salutation" />
                </SelectTrigger>
                <SelectContent>
                  {SALUTATIONS.map((salutation) => (
                    <SelectItem key={salutation} value={salutation}>{salutation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {contactFields.map((f) => (
              <Field key={f.key} label={f.label} full={f.full} required={REQUIRED_ORG_FIELD_KEYS.has(f.key)}>
                <Input
                  value={(form[f.key] as string) ?? ""}
                  onChange={(e) => set(f.key, e.target.value as never)}
                  placeholder={f.placeholder}
                />
              </Field>
            ))}
            </div>
          </section>}

          {stepKey === "billing" && <section className="modern-form-section">
            <SectionHeading title="Billing information" />
            <div className="grid gap-4 sm:grid-cols-2">
            {billingFields.map((f) => {
              const isPincode = f.key === "billingPincode";
              const isPhone = f.key === "billingPhone" || f.key === "billingFax";
              return (
                <Field key={f.key} label={f.label} full={f.full} required={REQUIRED_ORG_FIELD_KEYS.has(f.key)}>
                  <Input
                    value={(form[f.key] as string) ?? ""}
                    onChange={(e) => {
                      let v = e.target.value;
                      if (isPincode) v = v.replace(/\D/g, "").slice(0, 6);
                      else if (isPhone) v = v.replace(/\D/g, "").slice(0, 10);
                      set(f.key, v as never);
                    }}
                    placeholder={f.placeholder ?? (isPincode ? "6-digit pincode" : isPhone ? "10-digit number" : undefined)}
                    inputMode={isPincode || isPhone ? "numeric" : undefined}
                    maxLength={isPincode ? 6 : isPhone ? 10 : undefined}
                  />
                </Field>
              );
            })}
            </div>
          </section>}

          {stepKey === "deployment" && <section className="modern-form-section">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
              <SectionHeading title="Shipping / Deployment address" inline />
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                Same as billing
                <Switch
                  checked={form.shippingSameAsBilling}
                  onCheckedChange={(v) => set("shippingSameAsBilling", v)}
                />
              </label>
            </div>
            {!form.shippingSameAsBilling && (
              <div className="grid gap-4 sm:grid-cols-2">
                {shippingFields.map((f) => {
                  const isPincode = f.key === "shippingPincode";
                  const isPhone = f.key === "shippingPhone" || f.key === "shippingFax";
                  return (
                    <Field key={f.key} label={f.label} full={f.full} required={REQUIRED_ORG_FIELD_KEYS.has(f.key)}>
                      <Input
                        value={(form[f.key] as string) ?? ""}
                        onChange={(e) => {
                          let v = e.target.value;
                          if (isPincode) v = v.replace(/\D/g, "").slice(0, 6);
                          else if (isPhone) v = v.replace(/\D/g, "").slice(0, 10);
                          set(f.key, v as never);
                        }}
                        placeholder={f.placeholder ?? (isPincode ? "6-digit pincode" : isPhone ? "10-digit number" : undefined)}
                        inputMode={isPincode || isPhone ? "numeric" : undefined}
                        maxLength={isPincode ? 6 : isPhone ? 10 : undefined}
                      />
                    </Field>
                  );
                })}
              </div>
            )}
          </section>}

          {stepKey === "review" && <section className="modern-form-section">
            <SectionHeading title="Review" />
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Organization</dt><dd className="mt-1 font-medium">{form.name || "Not entered"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">ID</dt><dd className="mt-1 font-mono font-medium">{form.code || "Not entered"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contact</dt><dd className="mt-1 font-medium">{form.billingName || "Not entered"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 font-medium capitalize">{form.status}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Billing address</dt><dd className="mt-1 font-medium">{[form.billingAddress1, form.billingCity, form.billingState, form.billingPincode].filter(Boolean).join(", ") || "Not entered"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Deployment address</dt><dd className="mt-1 font-medium">{form.shippingSameAsBilling ? "Same as billing" : [form.shippingAddress1, form.shippingCity, form.shippingState, form.shippingPincode].filter(Boolean).join(", ") || "Not entered"}</dd></div>
            </dl>
          </section>}

          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        </GuidedForm>
      </DialogContent>
    </Dialog>
  );
}

function emptyCustomer(): Omit<Customer, "id"> {
  return {
    code: "",
    name: "",
    shortName: "",
    description: "",
    logoUrl: "",
    industryType: "",
    website: "",
    phone: "",
    address: "",
    contractStartDate: todayIso(),
    contractEndDate: "",
    status: "active",
    billingSalutation: "",
    billingName: "",
    billingAddress1: "",
    billingAddress2: "",
    billingPincode: "",
    billingCity: "",
    billingDistrict: "",
    billingState: "",
    billingCountry: "India",
    billingEmail: "",
    billingPhone: "",
    billingFax: "",
    shippingSameAsBilling: true,
    shippingSalutation: "",
    shippingName: "",
    shippingAddress1: "",
    shippingAddress2: "",
    shippingPincode: "",
    shippingCity: "",
    shippingDistrict: "",
    shippingState: "",
    shippingCountry: "India",
    shippingEmail: "",
    shippingPhone: "",
    shippingFax: "",
  };
}

function SectionHeading({ title, inline }: { title: string; inline?: boolean }) {
  return (
    <h3
      className={cn(
        "modern-form-section-title",
        !inline && "border-b border-border pb-2",
      )}
    >
      {title}
    </h3>
  );
}

const REQUIRED_ORG_FIELD_KEYS = new Set<string>(["billingName", "billingAddress1", "billingCity", "shippingAddress1", "shippingCity"]);

function Field({
  label,
  children,
  full,
  required,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
}) {
  return (
    <div className={cn("modern-form-field", full && "sm:col-span-2")}>
      <Label className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
