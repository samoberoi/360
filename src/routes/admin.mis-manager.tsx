import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Edit2, Eye, Plus, Search, Trash2, Upload, Table2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { confirmAction } from "@/components/ConfirmProvider";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCurrentPermissions } from "@/lib/rbac";
import {
  MIS_SYSTEM_FIELDS,
  MIS_STANDARD_FIELD_KEYS, MIS_SYSTEM_FIELD_BY_KEY, MIS_NATIVE_CLIENT_KEYS, matchMisSystemKey,
} from "@/lib/mis-template";

export const Route = createFileRoute("/admin/mis-manager")({
  head: () => ({
    meta: [
      { title: "MIS Sheets | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Define the MIS sheet each organization receives, its columns and site values." },
      { property: "og:title", content: "MIS Sheets | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Define the MIS sheet each organization receives, its columns and site values." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MisManagerPage,
});

const MODULE = "MIS Manager";
const QK_TEMPLATES = ["admin", "mis-templates"] as const;

type TemplateRow = {
  id: string;
  customer_id: string;
  name: string;
  enabled: boolean;
  row_grain: string | null;
  mis_applicable: boolean | null;
  columns: ColumnRow[];
};
type ColumnRow = {
  id: string;
  header: string;
  sort_order: number;
  source: "system" | "custom";
  system_key: string | null;
  enabled: boolean;
  client_attribute: boolean | null;
};
type Draft = {
  id?: string;
  header: string;
  source: "system" | "custom";
  system_key: string | null;
  enabled: boolean;
  client_attribute: boolean;
};

function useCustomers() {
  return useQuery({
    queryKey: ["admin", "mis-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, code, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; code: string | null; name: string }>;
    },
  });
}

function useTemplates() {
  return useQuery({
    queryKey: QK_TEMPLATES,
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await supabase
        .from("mis_templates" as never)
        .select("id, customer_id, name, enabled, row_grain, mis_applicable")
        .order("created_at");
      if (error) throw error;
      const templates = (data ?? []) as Array<Omit<TemplateRow, "columns">>;
      if (templates.length === 0) return [];
      const { data: cols, error: colErr } = await supabase
        .from("mis_template_columns" as never)
        .select("id, template_id, header, sort_order, source, system_key, enabled, client_attribute")
        .in("template_id", templates.map((t) => t.id))
        .order("sort_order");
      if (colErr) throw colErr;
      const byTemplate = new Map<string, ColumnRow[]>();
      for (const c of (cols ?? []) as Array<ColumnRow & { template_id: string }>) {
        const list = byTemplate.get(c.template_id) ?? [];
        list.push(c);
        byTemplate.set(c.template_id, list);
      }
      return templates.map((t) => ({ ...t, columns: byTemplate.get(t.id) ?? [] }));
    },
  });
}

/** Read the heading row from an uploaded sheet: the early row with the most text cells. */
async function readHeadersFromFile(file: File): Promise<string[]> {
  const XLSX = await import("xlsx-js-style");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
  let best: unknown[] = [];
  for (const row of aoa.slice(0, 12)) {
    const filled = row.filter((c) => String(c ?? "").trim().length > 0).length;
    if (filled > best.filter((c) => String(c ?? "").trim().length > 0).length) best = row;
  }
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const cell of best) {
    const h = String(cell ?? "").replace(/\s+/g, " ").trim();
    if (!h || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    headers.push(h);
  }
  return headers;
}

function MisManagerPage() {
  const { canSub, isSuperAdmin } = useCurrentPermissions();
  const canEdit = isSuperAdmin || canSub("control_center", "mis_manager", "edit");
  const canDelete = isSuperAdmin || canSub("control_center", "mis_manager", "delete");

  const qc = useQueryClient();
  const { data: customers = [] } = useCustomers();
  const { data: templates = [], isLoading } = useTemplates();

  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [rowGrain, setRowGrain] = useState<"employee" | "site">("employee");
  const [misApplicable, setMisApplicable] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [valuesFor, setValuesFor] = useState<TemplateRow | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((t) => {
      const c = customerById.get(t.customer_id);
      return [t.name, c?.name, c?.code].some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [templates, q, customerById]);

  const pager = usePagination(filtered);
  const pageRows = pager.pageRows;

  const resetForm = () => {
    setEditing(null);
    setCustomerId("");
    setName("");
    setRowGrain("employee");
    setMisApplicable(true);
    setDrafts(MIS_SYSTEM_FIELDS.map<Draft>((f) => ({
      header: f.label, source: "system", system_key: f.key,
      enabled: MIS_STANDARD_FIELD_KEYS.includes(f.key), client_attribute: false,
    })));
  };

  const openCreate = () => {
    resetForm();
    setReadOnly(false);
    setDialogOpen(true);
  };
  const openTemplate = (t: TemplateRow, view: boolean) => {
    setEditing(t);
    setCustomerId(t.customer_id);
    setName(t.name);
    setRowGrain(t.row_grain === "site" ? "site" : "employee");
    setMisApplicable(t.mis_applicable !== false);
    setDrafts(t.columns.map<Draft>((c) => ({
      id: c.id, header: c.header, source: c.source, system_key: c.system_key,
      enabled: c.enabled, client_attribute: c.client_attribute === true,
    })));
    setReadOnly(view);
    setDialogOpen(true);
  };

  const onUpload = async (file: File) => {
    try {
      const headers = await readHeadersFromFile(file);
      if (headers.length === 0) {
        toast.error("No column headings found in that file.");
        return;
      }
      setDrafts(headers.map<Draft>((h) => {
        const key = matchMisSystemKey(h);
        return {
          header: h,
          source: key ? "system" : "custom",
          system_key: key,
          enabled: true,
          client_attribute: false,
        };
      }));
      toast.success(`${headers.length} columns read from the sheet.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error("Choose an organization");
      if (misApplicable && !name.trim()) throw new Error("Give the format a name");
      const formatName = name.trim() || "MIS not applicable";
      const enabled = misApplicable ? drafts.filter((d) => d.enabled && d.header.trim()) : [];
      if (misApplicable && enabled.length === 0) throw new Error("Select at least one column");

      let templateId = editing?.id ?? "";
      if (editing) {
        const { error } = await supabase
          .from("mis_templates" as never)
          .update({ name: formatName, customer_id: customerId, row_grain: rowGrain, mis_applicable: misApplicable } as never)
          .eq("id", editing.id);
        if (error) throw error;
        // Columns that are no longer part of the format go away with their values.
        const keptIds = new Set(enabled.map((d) => d.id).filter(Boolean) as string[]);
        const dropped = editing.columns.filter((c) => !keptIds.has(c.id)).map((c) => c.id);
        if (dropped.length > 0) {
          const { error: delErr } = await supabase
            .from("mis_template_columns" as never)
            .delete()
            .in("id", dropped);
          if (delErr) throw delErr;
        }
        // A client attribute switched off is removed from every client of this
        // organization, together with the values already entered against it.
        const turnedOff = editing.columns
          .filter((c) => c.client_attribute === true)
          .filter((c) => enabled.some((d) => d.id === c.id && !d.client_attribute))
          .map((c) => c.id);
        if (turnedOff.length > 0) {
          const { error: valErr } = await supabase
            .from("mis_unit_values" as never)
            .delete()
            .in("column_id", turnedOff);
          if (valErr) throw valErr;
        }
      } else {
        const { data, error } = await supabase
          .from("mis_templates" as never)
          .insert({ customer_id: customerId, name: formatName, enabled: true, row_grain: rowGrain, mis_applicable: misApplicable } as never)
          .select("id")
          .single();
        if (error) throw error;
        templateId = String((data as { id: string }).id);
      }

      let order = 0;
      for (const d of enabled) {
        order += 1;
        const payload = {
          template_id: templateId,
          header: d.header.trim(),
          sort_order: order,
          source: d.source,
          system_key: d.source === "system" ? d.system_key : null,
          enabled: true,
          client_attribute: d.client_attribute === true,
        };
        if (d.id) {
          const { error: upErr } = await supabase
            .from("mis_template_columns" as never)
            .update(payload as never)
            .eq("id", d.id);
          if (upErr) throw upErr;
        } else {
          const { error: insErr } = await supabase
            .from("mis_template_columns" as never)
            .insert(payload as never);
          if (insErr) throw insErr;
        }
      }

      void logActivity({
        module: MODULE,
        action: editing ? "update" : "create",
        entityType: "mis_templates",
        entityLabel: formatName,
        details: {
          customerId,
          columns: enabled.length,
          clientAttributes: enabled.filter((d) => d.client_attribute).length,
        },
      });
    },
    onSuccess: () => {
      toast.success("MIS format saved.");
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: QK_TEMPLATES });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  const toggleMut = useMutation({
    mutationFn: async (t: TemplateRow) => {
      const { error } = await supabase
        .from("mis_templates" as never)
        .update({ enabled: !t.enabled } as never)
        .eq("id", t.id);
      if (error) throw error;
      void logActivity({
        module: MODULE, action: t.enabled ? "disable" : "enable",
        entityType: "mis_templates", entityLabel: t.name,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_TEMPLATES }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (t: TemplateRow) => {
      const { error } = await supabase.from("mis_templates" as never).delete().eq("id", t.id);
      if (error) throw error;
      void logActivity({ module: MODULE, action: "delete", entityType: "mis_templates", entityLabel: t.name });
    },
    onSuccess: () => {
      toast.success("MIS format removed.");
      void qc.invalidateQueries({ queryKey: QK_TEMPLATES });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
  });

  const systemCount = drafts.filter((d) => d.enabled && d.source === "system").length;
  const customCount = drafts.filter((d) => d.enabled && d.source === "custom").length;
  const attributeCount = drafts.filter((d) => d.enabled && d.client_attribute).length;

  /** Warn before an attribute is taken off every client of the organization. */
  const requestSave = async () => {
    const removed = (editing?.columns ?? [])
      .filter((c) => c.client_attribute === true)
      .filter((c) => !drafts.some((d) => d.id === c.id && d.enabled && d.client_attribute))
      .map((c) => c.header);
    if (removed.length > 0) {
      const orgName = customerById.get(customerId)?.name ?? "this organization";
      const ok = await confirmAction({
        title: removed.length === 1 ? `Remove "${removed[0]}" from every client?` : "Remove these client attributes?",
        description: `${removed.join(", ")} will be deleted from all clients of ${orgName}, along with the values already entered.`,
        confirmText: "Yes, remove",
        destructive: true,
      });
      if (!ok) return;
    }
    saveMut.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="MIS Manager"
        description="Define the MIS sheet each organization receives — which columns appear, in what order, and the values that belong to each site."
        icon={FileSpreadsheet}
        actions={canEdit ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> New MIS format
          </Button>
        ) : undefined}
      />

      <div className="relative w-full sm:w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); pager.setPage(1); }}
          placeholder="Search organization or format"
          className="h-9 rounded-xl pl-9"
        />
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Format</th>
                <th className="px-4 py-3 font-medium">Columns</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No MIS formats yet. Organizations without one receive the standard sheet.
                </td></tr>
              )}
              {pageRows.map((t) => {
                const c = customerById.get(t.customer_id);
                const custom = t.columns.filter((col) => col.source === "custom").length;
                return (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c?.code ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">{t.name}</td>
                    <td className="px-4 py-3">
                      {t.mis_applicable === false ? (
                        <Badge variant="outline">MIS not applicable</Badge>
                      ) : (
                        <>
                          {t.columns.length}
                          {custom > 0 && <Badge variant="secondary" className="ml-2">{custom} custom</Badge>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={t.enabled}
                        disabled={!canEdit}
                        onCheckedChange={() => toggleMut.mutate(t)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="View" onClick={() => openTemplate(t, true)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openTemplate(t, false)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                        {custom > 0 && t.mis_applicable !== false && (
                          <Button variant="ghost" size="icon" title="Site values" onClick={() => setValuesFor(t)}>
                            <Table2 className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: "Remove this MIS format?",
                                description: "The organization will fall back to the standard MIS sheet.",
                                confirmText: "Yes, remove",
                                destructive: true,
                              });
                              if (ok) deleteMut.mutate(t);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataPagination {...pager} />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{readOnly ? "MIS format" : editing ? "Edit MIS format" : "New MIS format"}</DialogTitle>
            <DialogDescription>
              Upload the client's own sheet to read its headings, then tick the columns to include.
              Headings we recognise are filled by the system; the rest become values you enter per site.
              Switch on "Client attribute" to add that column as an optional field on every client of this
              organization — switching it off removes the field and its saved values from all of them.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Organization</Label>
              <Select value={customerId} onValueChange={setCustomerId} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Choose organization" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Format name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder="e.g. Manpower-wise MIS" />
            </div>
            <div className="space-y-1.5">
              <Label>One row per</Label>
              <Select
                value={rowGrain}
                onValueChange={(v) => setRowGrain(v === "site" ? "site" : "employee")}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee (manpower-wise)</SelectItem>
                  <SelectItem value="site">Client site (billing annexure)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3">
            <div>
              <Label>MIS applicable</Label>
              <p className="text-xs text-muted-foreground">
                Switch off when this organization never receives an MIS sheet — the MIS download then
                disappears from every invoice of its clients.
              </p>
            </div>
            <Switch checked={misApplicable} disabled={readOnly} onCheckedChange={setMisApplicable} />
          </div>

          {!readOnly && misApplicable && (
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onUpload(f);
                }}
              />
              <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Upload client sheet
              </Button>
              <span className="text-xs text-muted-foreground">
                {systemCount} system-filled · {customCount} entered per site · {attributeCount} client attributes
              </span>
            </div>
          )}

          {misApplicable && (
          <div className="rounded-xl border">
            <div className="max-h-[45vh] overflow-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="sticky top-0 border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Include</th>
                    <th className="px-3 py-2 font-medium">Column heading</th>
                    <th className="px-3 py-2 font-medium">Filled by</th>
                    <th className="px-3 py-2 font-medium">Client attribute</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, i) => (
                    <tr key={`${d.header}-${i}`} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Switch
                          checked={d.enabled}
                          disabled={readOnly}
                          onCheckedChange={(v) => setDrafts((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={d.header}
                          disabled={readOnly}
                          onChange={(e) => setDrafts((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)))}
                          className="h-8"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {d.source === "system" ? (
                          <Badge variant="secondary">
                            {MIS_SYSTEM_FIELD_BY_KEY.get(d.system_key ?? "")?.label ?? "System"}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Entered per site</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d.source === "system" && MIS_NATIVE_CLIENT_KEYS.has(d.system_key ?? "") ? (
                          <span className="text-xs text-muted-foreground">Already on the client</span>
                        ) : (
                          <Switch
                            checked={d.client_attribute}
                            disabled={readOnly || !d.enabled}
                            onCheckedChange={(v) => setDrafts((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, client_attribute: v } : x)))}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
            {!readOnly && canEdit && (
              <Button onClick={() => void requestSave()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Save format"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {valuesFor && (
        <MisUnitValuesDialog
          template={valuesFor}
          canEdit={canEdit}
          onClose={() => setValuesFor(null)}
        />
      )}
    </div>
  );
}

/** Per-site values for the custom columns of one organization's MIS format. */
function MisUnitValuesDialog({
  template, canEdit, onClose,
}: { template: TemplateRow; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const customCols = template.columns.filter((c) => c.source === "custom" && c.enabled);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const unitsQ = useQuery({
    queryKey: ["admin", "mis-units", template.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, code, name")
        .eq("customer_id", template.customer_id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; code: string | null; name: string }>;
    },
  });

  const valuesQ = useQuery({
    queryKey: ["admin", "mis-unit-values", template.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mis_unit_values" as never)
        .select("column_id, unit_id, value")
        .eq("template_id", template.id);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as Array<{ column_id: string; unit_id: string; value: string | null }>) {
        map[`${r.column_id}|${r.unit_id}`] = r.value ?? "";
      }
      return map;
    },
  });

  const units = unitsQ.data ?? [];
  const saved = valuesQ.data ?? {};
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return units;
    return units.filter((u) => [u.name, u.code].some((v) => String(v ?? "").toLowerCase().includes(needle)));
  }, [units, q]);
  const pager = usePagination(filtered);
  const pageRows = pager.pageRows;

  const valueOf = (colId: string, unitId: string) => {
    const key = `${colId}|${unitId}`;
    return edits[key] ?? saved[key] ?? "";
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(edits).map(([key, value]) => {
        const [column_id, unit_id] = key.split("|");
        return { template_id: template.id, column_id, unit_id, value };
      });
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("mis_unit_values" as never)
        .upsert(rows as never, { onConflict: "column_id,unit_id" });
      if (error) throw error;
      void logActivity({
        module: MODULE, action: "update", entityType: "mis_unit_values",
        entityLabel: template.name, details: { changed: rows.length },
      });
    },
    onSuccess: () => {
      toast.success("Site values saved.");
      setEdits({});
      void qc.invalidateQueries({ queryKey: ["admin", "mis-unit-values", template.id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Site values — {template.name}</DialogTitle>
          <DialogDescription>
            These columns are not held anywhere else, so fill them per client site. Blank values simply print empty.
          </DialogDescription>
        </DialogHeader>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); pager.setPage(1); }}
            placeholder="Search site"
            className="h-9 rounded-xl pl-9"
          />
        </div>

        <div className="rounded-xl border">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Site</th>
                  {customCols.map((c) => (
                    <th key={c.id} className="px-3 py-2 font-medium">{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.code ?? ""}</div>
                    </td>
                    {customCols.map((c) => (
                      <td key={c.id} className="px-3 py-2">
                        <Input
                          className="h-8"
                          disabled={!canEdit}
                          value={valueOf(c.id, u.id)}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [`${c.id}|${u.id}`]: e.target.value }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={customCols.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                    No sites found.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataPagination {...pager} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && (
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || Object.keys(edits).length === 0}>
              {saveMut.isPending ? "Saving…" : `Save ${Object.keys(edits).length || ""} changes`.trim()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
