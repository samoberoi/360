import { createFileRoute } from "@tanstack/react-router";
import { RecordViewButton } from "@/components/RecordViewButton";
import { useMemo, useState } from "react";
import { Download, Edit2, Plus, Search, Trash2, CalendarCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { downloadCsv } from "@/lib/csv-export";
import { toast } from "sonner";
import { confirmAction } from "@/components/ConfirmProvider";
import { PageHeader } from "@/components/PageHeader";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/admin/attendance-code-manager")({
  head: () => ({
    meta: [
      { title: "Attendance Codes | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Configure attendance codes and their payroll behavior." },
      { property: "og:title", content: "Attendance Codes | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Configure attendance codes and their payroll behavior." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AttendanceCodeManagerPage,
});

type AttendanceCode = {
  id: string;
  code: string;
  label: string;
  description: string;
  color: string;
  counts_as_present: boolean;
  is_paid: boolean;
  is_leave: boolean;
  day_value: number;
  sort_order: number;
  enabled: boolean;
};

const QK = ["admin", "attendance_codes"] as const;

function rowToItem(r: Record<string, unknown>): AttendanceCode {
  return {
    id: String(r.id),
    code: String(r.code ?? ""),
    label: String(r.label ?? ""),
    description: String(r.description ?? ""),
    color: String(r.color ?? "#64748b"),
    counts_as_present: Boolean(r.counts_as_present),
    is_paid: Boolean(r.is_paid),
    is_leave: Boolean(r.is_leave),
    day_value: r.day_value == null ? 1 : Number(r.day_value),
    sort_order: Number(r.sort_order ?? 0),
    enabled: Boolean(r.enabled ?? true),
  };
}

function useAttendanceCodes() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: QK,
    queryFn: async (): Promise<AttendanceCode[]> => {
      const { data, error } = await supabase
        .from("attendance_codes" as never)
        .select("id,code,label,description,color,counts_as_present,is_paid,is_leave,day_value,sort_order,enabled")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as Record<string, unknown>[]).map(rowToItem);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });
  type Payload = Omit<AttendanceCode, "id">;
  const toRow = (p: Payload) => ({
    code: p.code.trim().toUpperCase(),
    label: p.label.trim(),
    description: p.description.trim(),
    color: p.color || "#64748b",
    counts_as_present: p.counts_as_present,
    is_paid: p.is_paid,
    is_leave: p.is_leave,
    day_value: Number.isFinite(Number(p.day_value)) ? Number(p.day_value) : 1,
    sort_order: Number(p.sort_order) || 0,
    enabled: p.enabled,
  });

  const addMut = useMutation({
    mutationFn: async (p: Payload) => {
      if (!p.code.trim()) throw new Error("Code is required");
      if (!p.label.trim()) throw new Error("Label is required");
      const { error } = await supabase.from("attendance_codes" as never).insert(toRow(p) as never);
      if (error) throw error;
      void logActivity({ module: "Attendance Code Manager", action: "create", entityType: "attendance_codes", entityLabel: `${p.code} – ${p.label}`, details: p as unknown as Record<string, unknown> });
    },
    onSuccess: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, p }: { id: string; p: Payload }) => {
      const { error } = await supabase
        .from("attendance_codes" as never)
        .update(toRow(p) as never)
        .eq("id", id);
      if (error) throw error;
      void logActivity({ module: "Attendance Code Manager", action: "update", entityType: "attendance_codes", entityId: id, entityLabel: `${p.code} – ${p.label}`, details: p as unknown as Record<string, unknown> });
    },
    onSuccess: invalidate,
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("attendance_codes" as never)
        .update({ enabled } as never)
        .eq("id", id);
      if (error) throw error;
      void logActivity({ module: "Attendance Code Manager", action: enabled ? "enable" : "disable", entityType: "attendance_codes", entityId: id, details: { enabled } });
    },
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("attendance_codes" as never).delete().eq("id", id);
      if (error) throw error;
      void logActivity({ module: "Attendance Code Manager", action: "delete", entityType: "attendance_codes", entityId: id });
    },
    onSuccess: invalidate,
  });

  return { items, addMut, updateMut, toggleMut, deleteMut };
}

function AttendanceCodeManagerPage() {
  const { items, addMut, updateMut, toggleMut, deleteMut } = useAttendanceCodes();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceCode | null>(null);
  const [deleting, setDeleting] = useState<AttendanceCode | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.code.toLowerCase().includes(q) ||
        i.label.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q),
    );
  }, [items, query]);

  const pg = usePagination(filtered);

  return (
    <div>
      <PageHeader
        title="Attendance Code Manager"
        description="Define codes (P, A, L, HD, WO, CL, SL…) used to mark daily attendance and drive payroll calculations."
        crumbs={[{ label: "Control Center", to: "/admin/control-center" }, { label: "Attendance Code Manager" }]}
      />

       <div className="mb-3 grid grid-cols-1 gap-2 sm:mb-4 lg:flex lg:items-center lg:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code or label…"
            className="h-10 rounded-lg pl-9"
          />
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex">
          <Button
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                "attendance-codes",
                filtered.map((i) => ({
                  code: i.code,
                  label: i.label,
                  description: i.description,
                  counts_as_present: i.counts_as_present ? "Yes" : "No",
                  is_paid: i.is_paid ? "Yes" : "No",
                  is_leave: i.is_leave ? "Yes" : "No",
                  sort_order: i.sort_order,
                  enabled: i.enabled ? "Yes" : "No",
                })),
                [
                  { key: "code", header: "Code" },
                  { key: "label", header: "Label" },
                  { key: "description", header: "Description" },
                  { key: "counts_as_present", header: "Counts Present" },
                  { key: "is_paid", header: "Paid" },
                  { key: "is_leave", header: "Leave" },
                  { key: "sort_order", header: "Sort" },
                  { key: "enabled", header: "Enabled" },
                ],
              )
            }
            className="h-10 rounded-lg"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button
            onClick={() => setAddOpen(true)}
            className="h-10 rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            <span className="sm:hidden">Add Code</span><span className="hidden sm:inline">Add Attendance Code</span>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-accent/10 px-5 py-2.5 text-xs font-medium text-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">{filtered.length}</span>
            <span className="uppercase tracking-[0.14em] text-muted-foreground">Total {filtered.length === 1 ? "code" : "codes"}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Label</th>
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3 text-center">Present</th>
                <th className="px-5 py-3 text-center">Paid</th>
                <th className="px-5 py-3 text-center">Leave</th>
                <th className="px-5 py-3 text-right">Sort</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((i) => (
                <tr key={i.id} className="hover:bg-secondary/30">
                  <td data-label="Code" className="px-5 py-3">
                    <span
                      className="inline-flex h-7 min-w-9 items-center justify-center rounded-md px-2 font-mono text-xs font-bold text-white"
                      style={{ backgroundColor: i.color }}
                    >
                      {i.code}
                    </span>
                  </td>
                  <td data-label="Label" className="px-5 py-3 font-medium text-foreground">{i.label}</td>
                  <td data-label="Description" className="px-5 py-3 text-foreground/80">{i.description || "—"}</td>
                  <td data-label="Present" className="px-5 py-3 text-center">{i.counts_as_present ? "✓" : "—"}</td>
                  <td data-label="Paid" className="px-5 py-3 text-center">{i.is_paid ? "✓" : "—"}</td>
                  <td data-label="Leave" className="px-5 py-3 text-center">{i.is_leave ? "✓" : "—"}</td>
                  <td data-label="Sort" className="px-5 py-3 text-right font-mono text-foreground/80">{i.sort_order}</td>
                  <td data-label="Status" className="px-5 py-3">
                    <Switch
                      checked={i.enabled}
                      onCheckedChange={(v) =>
                        toggleMut.mutate(
                          { id: i.id, enabled: v },
                          {
                            onSuccess: () => toast.success(v ? "Enabled" : "Disabled"),
                            onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
                          },
                        )
                      }
                    />
                  </td>
                  <td data-label="Actions" className="px-5 py-3 text-right" data-col="actions">
                    <div className="inline-flex gap-1">
                      <RecordViewButton
                        record={i}
                        title="Attendance Code details"
                        onEdit={() => setEditing(i)}
                      />
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={() => setEditing(i)} aria-label="Edit">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(i)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    <CalendarCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                    No attendance codes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataPagination {...pg} />
      </div>

      <CodeFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add Attendance Code"
        onSubmit={async (p) => {
          try {
            await addMut.mutateAsync(p);
            toast.success("Attendance code added");
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Could not add code";
          }
        }}
      />

      <CodeFormDialog
        open={!!editing}
        initial={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit Attendance Code"
        onSubmit={async (p) => {
          if (!editing) return null;
          try {
            await updateMut.mutateAsync({ id: editing.id, p });
            toast.success("Attendance code updated");
            setEditing(null);
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Could not update code";
          }
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attendance code?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <span className="font-semibold text-foreground">{deleting.code} – {deleting.label}</span>
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
                  toast.success("Attendance code deleted");
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
    </div>
  );
}

function CodeFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: AttendanceCode | null;
  onSubmit: (p: Omit<AttendanceCode, "id">) => Promise<string | null>;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#64748b");
  const [countsPresent, setCountsPresent] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [isLeave, setIsLeave] = useState(false);
  const [sortOrder, setSortOrder] = useState<string>("0");
  const [dayValue, setDayValue] = useState<string>("1");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useResetOnOpen(open, () => {
    setCode(initial?.code ?? "");
    setLabel(initial?.label ?? "");
    setDescription(initial?.description ?? "");
    setColor(initial?.color ?? "#64748b");
    setCountsPresent(initial?.counts_as_present ?? false);
    setIsPaid(initial?.is_paid ?? false);
    setIsLeave(initial?.is_leave ?? false);
    setSortOrder(String(initial?.sort_order ?? 0));
    setDayValue(String(initial?.day_value ?? 1));
    setEnabled(initial?.enabled ?? true);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Used in daily attendance marking and payable-day calculation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="P" maxLength={6} />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Present" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Colour</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Sort order</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Day value</Label>
            <Input
              type="number"
              step="0.25"
              min="0"
              max="2"
              value={dayValue}
              onChange={(e) => setDayValue(e.target.value)}
              placeholder="1.0 (HD=0.5, WO/A=0)"
            />
            <p className="text-xs text-muted-foreground">
              Fractional day this code contributes to payable days. Half-Day = 0.5, full day = 1, unpaid absence = 0.
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description" />
          </div>
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <ToggleRow label="Counts as present" hint="Adds to payable day count" checked={countsPresent} onChange={setCountsPresent} />
            <ToggleRow label="Paid" hint="Day is paid in payroll" checked={isPaid} onChange={setIsPaid} />
            <ToggleRow label="Is leave" hint="Deducts from leave balance" checked={isLeave} onChange={setIsLeave} />
            <ToggleRow label="Enabled" hint="Show in attendance dropdowns" checked={enabled} onChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const err = await onSubmit({
                code,
                label,
                description,
                color,
                counts_as_present: countsPresent,
                is_paid: isPaid,
                is_leave: isLeave,
                day_value: Number.isFinite(Number(dayValue)) ? Number(dayValue) : 1,
                sort_order: Number(sortOrder) || 0,
                enabled,
              });
              setSaving(false);
              if (err) toast.error(err);
              else onOpenChange(false);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function useResetOnOpen(open: boolean, reset: () => void) {
  const [last, setLast] = useState(false);
  if (open !== last) {
    setLast(open);
    if (open) reset();
  }
}
