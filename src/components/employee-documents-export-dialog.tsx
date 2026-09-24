import { useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import radiantLogo from "@/assets/radiant-logo-v2.png";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Search } from "lucide-react";

export type DocExportPerson = {
  id: string;
  full_name: string | null;
  employee_code?: string | null;
  candidate_code?: string | null;
  mobile?: string | null;
  role_key?: string | null;
  designation_id?: string | null;
  unit_id?: string | null;
  reports_to?: string | null;
  status?: string | null;
  is_enabled?: boolean | null;
};

type Option = { value: string; label: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  people: DocExportPerson[];
  roles: Option[];
  designations: Option[];
  organizations: Option[];
  units: Array<Option & { customerId?: string | null }>;
  managers: Option[];
  labelFor: (p: DocExportPerson) => {
    role: string;
    designation: string;
    organization: string;
    unit: string;
    manager: string;
  };
  organizationOfUnit: (unitId: string | null | undefined) => string;
  onExported?: (count: number) => void;
};

type DocItem = { label: string; url: string };

const ALL = "__all__";

function isActivePerson(p: { status?: string | null; is_enabled?: boolean | null }) {
  return (p.is_enabled ?? true) && (p.status ?? "") !== "inactive";
}

function collectDocs(row: Record<string, any>): DocItem[] {
  const out: DocItem[] = [];
  const push = (label: string, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) out.push({ label, url });
  };
  push("Photograph", row.photo_url);
  push("Aadhaar card image", row.aadhaar_image_url);
  push("PAN card image", row.pan_image_url);
  push("Signature", row.signature_url);
  const proofs = Array.isArray(row.identification_proofs) ? row.identification_proofs : [];
  for (const p of proofs) {
    const t = p?.type || "Identification proof";
    push(p?.number ? `${t} (${p.number})` : String(t), p?.url);
  }
  const docs = Array.isArray(row.documents) ? row.documents : [];
  for (const d of docs) push(d?.name || d?.type || "Document", d?.url);
  const off = row.offboarding_details && typeof row.offboarding_details === "object" ? row.offboarding_details : null;
  if (off) {
    const exitDocs = Array.isArray(off.exit_documents) ? off.exit_documents : [];
    for (const d of exitDocs) push(`Exit · ${d?.label || d?.key || "Document"}`, d?.file_url ?? d?.url);
    // Deep-scan for any other stored file/screenshot URLs anywhere in the exit payload
    const walk = (node: unknown, trail: string[]) => {
      if (!node) return;
      if (typeof node === "string") {
        if (/^https?:\/\//i.test(node)) push(`Exit · ${trail.slice(-2).join(" · ") || "File"}`, node);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, [...trail, String(i + 1)]));
        return;
      }
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          walk(v, [...trail, k.replace(/_/g, " ")]);
        }
      }
    };
    walk(off, []);
  }
  // de-duplicate by url
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.url) ? false : (seen.add(d.url), true)));
}


async function fetchImage(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 600, h: img.naturalHeight || 800 });
      img.onerror = () => resolve({ w: 600, h: 800 });
      img.src = dataUrl;
    });
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

async function loadDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}


export function EmployeeDocumentsExportDialog({
  open,
  onOpenChange,
  people,
  roles,
  designations,
  organizations,
  units,
  managers,
  labelFor,
  organizationOfUnit,
  onExported,
}: Props) {
  const [role, setRole] = useState(ALL);
  const [designation, setDesignation] = useState(ALL);
  const [organization, setOrganization] = useState(ALL);
  const [unit, setUnit] = useState(ALL);
  const [manager, setManager] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const unitOptions = useMemo(
    () => (organization === ALL ? units : units.filter((u) => (u.customerId ?? "") === organization)),
    [units, organization],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (role !== ALL && (p.role_key ?? "") !== role) return false;
      if (designation !== ALL && (p.designation_id ?? "") !== designation) return false;
      if (unit !== ALL && (p.unit_id ?? "") !== unit) return false;
      if (organization !== ALL && organizationOfUnit(p.unit_id) !== organization) return false;
      if (manager !== ALL && (p.reports_to ?? "") !== manager) return false;
      if (statusFilter !== "all") {
        const active = isActivePerson(p);
        if (statusFilter === "active" && !active) return false;
        if (statusFilter === "inactive" && active) return false;
      }
      if (q) {
        const hay = `${p.full_name ?? ""} ${p.employee_code ?? ""} ${p.candidate_code ?? ""} ${p.mobile ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [people, role, designation, unit, organization, manager, statusFilter, search, organizationOfUnit]);


  const selectedIds = useMemo(() => filtered.filter((p) => selected[p.id]).map((p) => p.id), [filtered, selected]);
  const allChecked = filtered.length > 0 && selectedIds.length === filtered.length;

  const toggleAll = (v: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const p of filtered) next[p.id] = v;
      return next;
    });
  };

  const resetFilters = () => {
    setRole(ALL);
    setDesignation(ALL);
    setOrganization(ALL);
    setUnit(ALL);
    setManager(ALL);
    setStatusFilter("all");
    setSearch("");
  };

  const exportPdf = async () => {
    const ids = selectedIds;
    if (ids.length === 0) {
      toast.error("Select at least one employee");
      return;
    }
    setBusy(true);
    setProgress("Loading records…");
    try {
      const rows: Record<string, any>[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from("candidates" as never)
          .select(
            "id,full_name,employee_code,candidate_code,mobile,email,aadhaar_number,pan_number,photo_url,aadhaar_image_url,pan_image_url,signature_url,identification_proofs,documents,offboarding_details,offboarded_at,status,is_enabled,unit_id,designation_id,role_key,reports_to",
          )
          .in("id", ids.slice(i, i + 200));
        if (error) throw error;
        rows.push(...((data as unknown as Record<string, any>[]) ?? []));
      }
      const ordered = ids
        .map((id) => rows.find((r) => r.id === id))
        .filter(Boolean) as Record<string, any>[];

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const M = 40;
      let first = true;
      let totalDocs = 0;

      const brand: [number, number, number] = [24, 24, 27];
      const gold: [number, number, number] = [201, 162, 39];
      const muted: [number, number, number] = [110, 116, 129];
      const logoData = await loadDataUrl(radiantLogo);

      const drawChrome = (subtitle: string, rightTop?: string, rightSub?: string) => {
        doc.setFillColor(...brand);
        doc.rect(0, 0, pw, 70, "F");
        doc.setFillColor(...gold);
        doc.rect(0, 70, pw, 3, "F");
        if (logoData) {
          try {
            doc.addImage(logoData, "PNG", M, 12, 46, 46);
          } catch {
            /* ignore */
          }
        }
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.text("RADIANT GUARD SERVICES", M + 56, 32);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(220, 220, 220);
        doc.text(subtitle, M + 56, 48);
        if (rightTop) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(255, 255, 255);
          doc.text(rightTop, pw - M, 30, { align: "right" });
        }
        if (rightSub) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(255, 210, 120);
          doc.text(rightSub, pw - M, 46, { align: "right" });
        }
        // Footer
        const fy = ph - 22;
        doc.setDrawColor(220, 222, 228);
        doc.line(M, fy - 8, pw - M, fy - 8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text("PLUS 360 FAHRENHEIT SOLUTIONS · Confidential — internal HR record.", M, fy);
        doc.text(`Page ${doc.getNumberOfPages()}`, pw - M, fy, { align: "right" });
        doc.setTextColor(0, 0, 0);
      };

      const newPage = (subtitle: string, rightTop?: string, rightSub?: string) => {
        doc.addPage();
        drawChrome(subtitle, rightTop, rightSub);
      };

      // Cover
      drawChrome("Employee Document Pack", `${ordered.length} employee${ordered.length === 1 ? "" : "s"}`);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(24, 24, 27);
      doc.text("Employee Document Pack", M, 122);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...muted);
      doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 142);
      doc.text(`Employees included: ${ordered.length}`, M, 158);
      doc.setTextColor(0, 0, 0);
      first = false;

      for (let idx = 0; idx < ordered.length; idx++) {
        const row = ordered[idx];
        const person = people.find((p) => p.id === row.id);
        const meta = person
          ? labelFor(person)
          : { role: "", designation: "", organization: "", unit: "", manager: "" };
        const docs = collectDocs(row);
        totalDocs += docs.length;
        setProgress(`Employee ${idx + 1} of ${ordered.length} — ${docs.length} document(s)`);

        const code = row.employee_code || row.candidate_code || "—";
        const subtitle = `Employee Document Pack · ${row.full_name || "Unnamed"}`;
        if (!first) newPage(subtitle, code);
        first = false;

        doc.setDrawColor(220, 222, 228);
        doc.setFillColor(250, 250, 252);
        doc.roundedRect(M, 96, pw - M * 2, 112, 6, 6, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(24, 24, 27);
        doc.text(`${idx + 1}. ${row.full_name || "Unnamed"} — ${code}`, M + 12, 120);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 45);
        const active = (row.is_enabled ?? true) && (row.status ?? "") !== "inactive";
        const lines = [
          `Role: ${meta.role || "—"}    Designation: ${meta.designation || "—"}`,
          `Organization: ${meta.organization || "—"}    Client: ${meta.unit || "—"}`,
          `Reports to: ${meta.manager || "—"}    Mobile: ${row.mobile || "—"}`,
          `Aadhaar: ${row.aadhaar_number || "—"}    PAN: ${row.pan_number || "—"}    Documents: ${docs.length}`,
          `Status: ${active ? "Active" : "Inactive / offboarded"}`,
        ];
        lines.forEach((l, i) => doc.text(l, M + 12, 140 + i * 13));

        let y = 216;

        const off =
          row.offboarding_details && typeof row.offboarding_details === "object"
            ? (row.offboarding_details as Record<string, any>)
            : null;
        const hasExit = !!off && Object.keys(off).length > 0;
        if (hasExit) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text("OFFBOARDING RECORD", M, y);
          y += 14;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(30, 30, 30);
          const exitLines = [
            `Resignation date: ${off!.date_of_resignation || "—"}    Last working day: ${off!.date_of_last_working || "—"}`,
            `Offboarded on: ${off!.date_of_offboarding || (row.offboarded_at ? String(row.offboarded_at).slice(0, 10) : "—")}    Collection: ${off!.collection_status || "—"}`,
            `PF updated: ${off!.date_of_pf_update || "—"}    ESIC updated: ${off!.date_of_esic_update || "—"}`,
            `Reason: ${off!.reason_text || "—"}`,
            `Review: ${off!.review || "—"}    Rating: ${off!.rating ?? "—"}`,
          ];
          for (const l of exitLines) {
            for (const wrapped of doc.splitTextToSize(l, pw - M * 2) as string[]) {
              if (y > ph - M - 20) { newPage(subtitle, code); y = 100; }
              doc.text(wrapped, M, y);
              y += 12;
            }
          }
          const returns = Array.isArray(off!.inventory_returns) ? off!.inventory_returns : [];
          if (returns.length) {
            y += 4;
            doc.setFont("helvetica", "bold");
            doc.text("Assets recovered", M, y);
            doc.setFont("helvetica", "normal");
            y += 12;
            for (const r of returns) {
              if (y > ph - M - 20) { newPage(subtitle, code); y = 100; }
              doc.text(
                `• ${r?.item_name || "Item"}${r?.size_value ? ` (${r.size_value})` : ""} — qty ${r?.qty_returned ?? 0} → ${r?.destination_label || "—"}`,
                M,
                y,
              );
              y += 12;
            }
          }
          y += 8;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text("DOCUMENT INDEX", M, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(30, 30, 30);
        y += 16;
        if (docs.length === 0) {
          doc.text("No documents on record.", M, y);
        } else {
          for (const [i, d] of docs.entries()) {
            if (y > ph - M - 20) {
              newPage(subtitle, code);
              y = 100;
            }
            doc.text(`${i + 1}. ${d.label}`, M, y);
            y += 12;
          }
        }

        for (const [i, d] of docs.entries()) {
          const img = await fetchImage(d.url);
          newPage(subtitle, code, `DOC ${i + 1} / ${docs.length}`);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(24, 24, 27);
          doc.text(`${row.full_name || "Unnamed"} (${code}) · Doc ${i + 1}/${docs.length}`, M, 100);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(...muted);
          doc.text(d.label, M, 114);
          doc.setTextColor(0, 0, 0);
          if (img) {
            const maxW = pw - M * 2;
            const maxH = ph - 150 - M;
            const scale = Math.min(maxW / img.w, maxH / img.h);
            const w = img.w * scale;
            const h = img.h * scale;
            try {
              doc.addImage(img.dataUrl, M + (maxW - w) / 2, 130, w, h, undefined, "FAST");
            } catch {
              doc.text("Could not render this file.", M, 150);
            }
          } else {
            doc.setTextColor(120);
            doc.text("Preview not available (non-image file). Source link:", M, 146);
            doc.setTextColor(30, 64, 175);
            doc.textWithLink("Open document", M, 162, { url: d.url });
            doc.setTextColor(0);
          }
        }
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const name =
        ordered.length === 1
          ? `radiant-documents-${(ordered[0].employee_code || ordered[0].full_name || "employee").toString().replace(/\s+/g, "-")}-${stamp}.pdf`
          : `radiant-employee-documents-${ordered.length}-${stamp}.pdf`;
      doc.save(name);

      toast.success(`Exported ${totalDocs} document(s) for ${ordered.length} employee(s)`);
      onExported?.(ordered.length);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Document export failed");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,1000px)] max-w-none flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Export documents
          </DialogTitle>
          <DialogDescription className="text-xs">
            Filter, select employees and download every document they have as one PDF, clearly separated per employee.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">All roles</SelectItem>
              {roles.map((r) => <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={designation} onValueChange={setDesignation}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All designations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">All designations</SelectItem>
              {designations.map((d) => <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={organization}
            onValueChange={(v) => { setOrganization(v); setUnit(ALL); }}
          >
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All organizations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">All organizations</SelectItem>
              {organizations.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">All units</SelectItem>
              {unitOptions.map((u) => <SelectItem key={u.value} value={u.value} className="text-xs">{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={manager} onValueChange={setManager}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All managers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">All managers</SelectItem>
              {managers.map((m) => <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Active &amp; inactive</SelectItem>
              <SelectItem value="active" className="text-xs">Active only</SelectItem>
              <SelectItem value="inactive" className="text-xs">Inactive / offboarded only</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / code / mobile"
              className="h-9 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium">
            <Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(Boolean(v))} />
            Select all ({filtered.length})
          </label>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[11px]">{selectedIds.length} selected</Badge>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>Reset filters</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No employees match these filters.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Reports to</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const meta = labelFor(p);
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={!!selected[p.id]}
                          onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.id]: Boolean(v) }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{p.full_name || "—"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.employee_code || p.candidate_code || "—"} · {p.mobile || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{meta.role || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{meta.organization || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{meta.unit || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{meta.manager || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={isActivePerson(p) ? "secondary" : "outline"} className="text-[10px]">
                          {isActivePerson(p) ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{busy ? progress : "One PDF, one section per employee."}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={busy || selectedIds.length === 0} onClick={() => void exportPdf()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Export PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
