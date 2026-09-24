import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, Download, AlertTriangle, BarChart3, Warehouse, Building2, UserCog, Shield, FileSpreadsheet, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserBranchScope } from "@/lib/use-user-branch-scope";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { useCurrentUserRole } from "@/lib/use-current-user-role";

export const Route = createFileRoute("/admin/inventory/stock")({ component: StockPage });

type HolderType = "all" | "warehouse" | "branch" | "field_officer" | "security_guard";
type Balance = { location_type: string; location_id: string; item_id: string; size_value: string; qty: number };
type Item = { id: string; name: string; item_code: string; unit: string; default_reorder_level: number };
type Holder = { id: string; name: string; sub?: string };

const HOLDER_LABEL: Record<HolderType, string> = {
  all: "All locations",
  warehouse: "Warehouses",
  branch: "Branches",
  field_officer: "Field Officers",
  security_guard: "Security Guards",
};

function normalizeType(t: string): HolderType | null {
  if (t === "warehouse") return "warehouse";
  if (t === "branch") return "branch";
  if (t === "field_officer") return "field_officer";
  if (t === "guard" || t === "security_guard") return "security_guard";
  return null;
}

function StockPage() {
  const { data: balances = [] } = useQuery({
    queryKey: ["inv", "stock-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inv_stock_balances" as never).select("*");
      if (error) throw error;
      return (data as unknown as Balance[]) ?? [];
    },
  });
  const { data: items = [] } = useQuery({
    queryKey: ["inv", "items-list-full"],
    queryFn: async () => {
      const { data } = await supabase.from("inv_items" as never).select("id,name,item_code,unit,default_reorder_level");
      return (data as unknown as Item[]) ?? [];
    },
  });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv", "warehouses-list-full"], queryFn: async () => { const { data } = await supabase.from("inv_warehouses" as never).select("id,name").eq("enabled", true); return (data as unknown as { id: string; name: string }[]) ?? []; } });
  const { data: branches = [] } = useQuery({ queryKey: ["branches-full"], queryFn: async () => { const { data } = await supabase.from("branches" as never).select("id,name,code"); return (data as unknown as { id: string; name: string; code: string }[]) ?? []; } });
  const { data: candidates = [] } = useQuery({ queryKey: ["candidates-min-all"], queryFn: async () => { const { data } = await supabase.from("candidates" as never).select("id,full_name,employee_code,role_key,reports_to").eq("status", "active"); return (data as unknown as { id: string; full_name: string; employee_code: string; role_key: string; reports_to: string | null }[]) ?? []; } });

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const brMap = useMemo(() => new Map(branches.map((b) => [b.id, b.code ? `${b.code} – ${b.name}` : b.name])), [branches]);
  const cMap = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const fieldOfficers = useMemo(
    () => candidates.filter((c) => c.role_key === "field_officer").sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [candidates],
  );
  const guards = useMemo(
    () => candidates.filter((c) => c.role_key === "guard" || c.role_key === "security_guard").sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [candidates],
  );

  const holderLabel = (type: HolderType, id: string): string => {
    if (type === "warehouse") return whMap.get(id) ?? "—";
    if (type === "branch") return brMap.get(id) ?? "—";
    const c = cMap.get(id);
    return c ? `${c.full_name}${c.employee_code ? ` (${c.employee_code})` : ""}` : "—";
  };

  const scope = useUserBranchScope();
  const role = useCurrentUserRole();

  // ---------- Top-level KPI counts (active across the org) ----------
  const counts = useMemo(
    () => ({
      all: warehouses.length + branches.length + fieldOfficers.length + guards.length,
      warehouse: warehouses.length,
      branch: branches.length,
      field_officer: fieldOfficers.length,
      security_guard: guards.length,
    }),
    [warehouses, branches, fieldOfficers, guards],
  );

  // ---------- Filters ----------
  const [holderType, setHolderType] = useState<HolderType>("all");
  const [holderId, setHolderId] = useState<string>("all");
  const [q, setQ] = useState("");

  const holderOptions: Holder[] = useMemo(() => {
    if (holderType === "warehouse") return warehouses.map((w) => ({ id: w.id, name: w.name }));
    if (holderType === "branch") return branches.map((b) => ({ id: b.id, name: b.code ? `${b.code} – ${b.name}` : b.name }));
    if (holderType === "field_officer") return fieldOfficers.map((f) => ({ id: f.id, name: f.full_name, sub: f.employee_code }));
    if (holderType === "security_guard") return guards.map((g) => ({ id: g.id, name: g.full_name, sub: g.employee_code }));
    return [];
  }, [holderType, warehouses, branches, fieldOfficers, guards]);

  // Apply branch-scope / FO-scope to which holders the user may see.
  const visibleHolderIds = useMemo(() => {
    if (role.isFieldOfficer && role.candidateId) {
      if (holderType === "field_officer") return new Set([role.candidateId]);
      if (holderType === "security_guard") {
        return new Set(
          candidates.filter((c) => (c.role_key === "guard" || c.role_key === "security_guard") && c.reports_to === role.candidateId).map((c) => c.id),
        );
      }
      return new Set<string>();
    }
    // Branch-scoped (non-FO) users only get their branch context — keep wide for admins.
    if (scope.isScoped && scope.branchId) {
      if (holderType === "branch") return new Set([scope.branchId]);
    }
    return null; // null => no restriction
  }, [role.isFieldOfficer, role.candidateId, scope.isScoped, scope.branchId, holderType, candidates]);

  // ---------- Filtered rows ----------
  const rows = useMemo(() => {
    const out: {
      key: string;
      holder_type: HolderType;
      holder_id: string;
      holder_label: string;
      item_id: string;
      item_name: string;
      item_code: string;
      size_value: string;
      qty: number;
      unit: string;
      reorder: number;
      low: boolean;
    }[] = [];
    for (const b of balances) {
      const t = normalizeType(b.location_type);
      if (!t || t === "all") continue;
      if (holderType !== "all" && t !== holderType) continue;
      if (Number(b.qty) === 0) continue;
      if (visibleHolderIds && !visibleHolderIds.has(b.location_id)) continue;
      if (holderType !== "all" && holderId !== "all" && b.location_id !== holderId) continue;
      const it = itemMap.get(b.item_id);
      const label = holderLabel(t, b.location_id);
      if (q.trim()) {
        const ql = q.toLowerCase();
        const hay = `${label} ${it?.name ?? ""} ${it?.item_code ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) continue;
      }
      const reorder = it?.default_reorder_level ?? 0;
      out.push({
        key: `${b.location_type}-${b.location_id}-${b.item_id}-${b.size_value}`,
        holder_type: t,
        holder_id: b.location_id,
        holder_label: label,
        item_id: b.item_id,
        item_name: it?.name ?? "—",
        item_code: it?.item_code ?? "",
        size_value: b.size_value ?? "",
        qty: Number(b.qty),
        unit: it?.unit ?? "",
        reorder,
        low: Number(b.qty) > 0 && Number(b.qty) <= reorder,
      });
    }
    return out.sort((a, b) => a.holder_label.localeCompare(b.holder_label) || a.item_name.localeCompare(b.item_name));
  }, [balances, itemMap, holderType, holderId, q, visibleHolderIds]);

  // Under-stock count is computed across ALL holder types so the KPI is global.
  const lowCountGlobal = useMemo(() => {
    let n = 0;
    for (const b of balances) {
      const it = itemMap.get(b.item_id);
      const reorder = it?.default_reorder_level ?? 0;
      if (Number(b.qty) > 0 && Number(b.qty) <= reorder) n += 1;
    }
    return n;
  }, [balances, itemMap]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const pg = usePagination(rows);

  // ---------- Pretty XLSX one-click report ----------
  function downloadFullReport() {
    const wb = XLSX.utils.book_new();
    const today = new Date().toISOString().slice(0, 10);

    // ===== Summary sheet =====
    const buckets: { type: Exclude<HolderType, "all">; title: string; }[] = [
      { type: "warehouse", title: "Warehouses" },
      { type: "branch", title: "Branches" },
      { type: "field_officer", title: "Field Officers" },
      { type: "security_guard", title: "Security Guards" },
    ];
    const bucketTotals: Record<Exclude<HolderType, "all">, { holders: number; qty: number; lines: number }> = {
      warehouse: { holders: 0, qty: 0, lines: 0 },
      branch: { holders: 0, qty: 0, lines: 0 },
      field_officer: { holders: 0, qty: 0, lines: 0 },
      security_guard: { holders: 0, qty: 0, lines: 0 },
    };
    const seenHolders: Record<Exclude<HolderType, "all">, Set<string>> = {
      warehouse: new Set(), branch: new Set(), field_officer: new Set(), security_guard: new Set(),
    };
    for (const b of balances) {
      const t = normalizeType(b.location_type);
      if (!t || t === "all") continue;
      if (Number(b.qty) === 0) continue;
      bucketTotals[t].qty += Number(b.qty);
      bucketTotals[t].lines += 1;
      seenHolders[t].add(b.location_id);
    }
    for (const t of Object.keys(bucketTotals) as Exclude<HolderType, "all">[]) {
      bucketTotals[t].holders = seenHolders[t].size;
    }

    const summaryAOA: (string | number)[][] = [
      ["PLUS 360 FAHRENHEIT SOLUTIONS — Stock Report"],
      [`Generated: ${today}`],
      [],
      ["Bucket", "Active Holders", "Holders With Stock", "Line Items", "Total Qty"],
      ...buckets.map((b) => [
        b.title,
        counts[b.type],
        bucketTotals[b.type].holders,
        bucketTotals[b.type].lines,
        bucketTotals[b.type].qty,
      ]),
      [],
      ["Under-stock lines (qty ≤ reorder level, across all buckets)", lowCountGlobal],
    ];
    const summary = XLSX.utils.aoa_to_sheet(summaryAOA);
    summary["!cols"] = [{ wch: 38 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 14 }];
    summary["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    ];
    XLSX.utils.book_append_sheet(wb, summary, "Summary");

    // ===== One sheet per bucket =====
    for (const bk of buckets) {
      const bucketRows = balances
        .filter((b) => normalizeType(b.location_type) === bk.type && Number(b.qty) !== 0)
        .map((b) => {
          const it = itemMap.get(b.item_id);
          const reorder = it?.default_reorder_level ?? 0;
          return {
            holder: holderLabel(bk.type, b.location_id),
            item: it?.name ?? "—",
            code: it?.item_code ?? "",
            size: b.size_value || "—",
            qty: Number(b.qty),
            unit: it?.unit ?? "",
            reorder,
            low: Number(b.qty) > 0 && Number(b.qty) <= reorder ? "LOW" : "",
          };
        })
        .sort((a, b) => a.holder.localeCompare(b.holder) || a.item.localeCompare(b.item));

      const aoa: (string | number)[][] = [
        [`Stock at ${bk.title}`],
        [`Generated: ${today}`],
        [],
        ["Holder", "Item Code", "Item", "Size", "Qty", "Unit", "Reorder", "Status"],
        ...bucketRows.map((r) => [r.holder, r.code, r.item, r.size, r.qty, r.unit, r.reorder, r.low]),
      ];
      if (!bucketRows.length) aoa.push(["— No stock on hand —"]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      ];
      XLSX.utils.book_append_sheet(wb, ws, bk.title.slice(0, 31));
    }

    XLSX.writeFile(wb, `stock-report-${today}.xlsx`);
  }

  // Single-bucket export (current view) as XLSX too.
  function downloadCurrentView() {
    const today = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();
    const title = `${HOLDER_LABEL[holderType]}${holderId !== "all" ? ` — ${holderOptions.find((o) => o.id === holderId)?.name ?? ""}` : ""}`;
    const aoa: (string | number)[][] = [
      [`Stock — ${title}`],
      [`Generated: ${today}`],
      [],
      ["Holder", "Item Code", "Item", "Size", "Qty", "Unit", "Reorder", "Status"],
      ...rows.map((r) => [r.holder_label, r.item_code, r.item_name, r.size_value || "—", r.qty, r.unit, r.reorder, r.low ? "LOW" : ""]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws, HOLDER_LABEL[holderType].slice(0, 31));
    XLSX.writeFile(wb, `stock-${holderType}-${today}.xlsx`);
  }

  if (scope.isLoading || role.isLoading) {
    return (
      <div>
        <PageHeader title="Stock Report" description="Live balances for all locations." crumbs={[{ label: "Uniform Manager", to: "/admin/inventory" }, { label: "Stock" }]} />
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const isFO = role.isFieldOfficer;

  // For FO: force the type filter to their own stock + their guards, and hide
  // the top-level warehouse/branch/other-FO KPIs. Everyone else sees the full
  // command-center KPI band.
  useEffect(() => {
    if (isFO && holderType !== "field_officer" && holderType !== "security_guard") {
      setHolderType("field_officer");
      setHolderId("all");
    }
  }, [isFO, holderType]);

  return (
    <div>
      <PageHeader
        title={isFO ? "My Stock" : "Stock Report"}
        description={isFO ? "Live balances for you and your guards." : "Live balances for all locations."}
        crumbs={[{ label: "Uniform Manager", to: "/admin/inventory" }, { label: isFO ? "My Stock" : "Stock" }]}
      />

      {/* KPI band */}
      {!isFO ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <KpiCard icon={<Layers className="h-4 w-4" />} label="All locations" value={counts.all} active={holderType === "all"} onClick={() => { setHolderType("all"); setHolderId("all"); }} />
          <KpiCard icon={<Warehouse className="h-4 w-4" />} label="Warehouses" value={counts.warehouse} active={holderType === "warehouse"} onClick={() => { setHolderType("warehouse"); setHolderId("all"); }} />
          <KpiCard icon={<Building2 className="h-4 w-4" />} label="Branches" value={counts.branch} active={holderType === "branch"} onClick={() => { setHolderType("branch"); setHolderId("all"); }} />
          <KpiCard icon={<UserCog className="h-4 w-4" />} label="Field Officers" value={counts.field_officer} active={holderType === "field_officer"} onClick={() => { setHolderType("field_officer"); setHolderId("all"); }} />
          <KpiCard icon={<Shield className="h-4 w-4" />} label="Security Guards" value={counts.security_guard} active={holderType === "security_guard"} onClick={() => { setHolderType("security_guard"); setHolderId("all"); }} />
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Under stock</div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums text-amber-700">{lowCountGlobal.toLocaleString("en-IN")}</div>
          </div>
        </div>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard icon={<UserCog className="h-4 w-4" />} label="My stock" value={1} active={holderType === "field_officer"} onClick={() => { setHolderType("field_officer"); setHolderId("all"); }} />
          <KpiCard icon={<Shield className="h-4 w-4" />} label="My guards" value={(visibleHolderIds && holderType === "security_guard" ? visibleHolderIds.size : candidates.filter((c) => (c.role_key === "guard" || c.role_key === "security_guard") && c.reports_to === role.candidateId).length)} active={holderType === "security_guard"} onClick={() => { setHolderType("security_guard"); setHolderId("all"); }} />
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Under stock</div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums text-amber-700">{rows.filter((r) => r.low).length.toLocaleString("en-IN")}</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Select value={holderType} onValueChange={(v) => { setHolderType(v as HolderType); setHolderId("all"); }}>
            <SelectTrigger className="h-10 w-48 rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {!isFO && <SelectItem value="all">All locations</SelectItem>}
              {!isFO && <SelectItem value="warehouse">Warehouses</SelectItem>}
              {!isFO && <SelectItem value="branch">Branches</SelectItem>}
              <SelectItem value="field_officer">{isFO ? "My stock" : "Field Officers"}</SelectItem>
              <SelectItem value="security_guard">{isFO ? "My guards" : "Security Guards"}</SelectItem>
            </SelectContent>
          </Select>
          {holderType !== "all" && (
            <Select value={holderId} onValueChange={setHolderId}>
              <SelectTrigger className="h-10 w-64 rounded-lg"><SelectValue placeholder={`All ${HOLDER_LABEL[holderType].toLowerCase()}`} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {HOLDER_LABEL[holderType].toLowerCase()}</SelectItem>
                {holderOptions
                  .filter((o) => !visibleHolderIds || visibleHolderIds.has(o.id))
                  .map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}{o.sub ? ` · ${o.sub}` : ""}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or holder…" className="h-10 rounded-lg pl-9" />
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/inventory/stock-ledger" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary hover:bg-primary/10">
            <FileSpreadsheet className="h-4 w-4" />Open Stock Ledger
          </Link>
          <Button variant="outline" className="h-10 rounded-lg" disabled={!rows.length} onClick={downloadCurrentView}>
            <Download className="mr-1.5 h-4 w-4" />Export view
          </Button>
          <Button className="h-10 rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90" onClick={downloadFullReport}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />Full report
          </Button>
        </div>
      </div>


      {/* Sub-summary line for current bucket */}
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-secondary/30 px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span>{HOLDER_LABEL[holderType]} · <span className="font-semibold text-foreground tabular-nums">{rows.length}</span> line items</span>
        <span>Total qty · <span className="font-semibold text-foreground tabular-nums">{totalQty.toLocaleString("en-IN")}</span></span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-clip">
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Holder</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3 text-right">Reorder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((r) => (
                <tr key={r.key} className={r.low ? "bg-amber-500/5" : "hover:bg-secondary/30"}>
                  <td className="px-5 py-3 font-medium">{r.holder_label}</td>
                  <td className="px-5 py-3">
                    <span className="font-medium">{r.item_name}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.item_code}</span>
                  </td>
                  <td className="px-5 py-3 text-xs">{r.size_value || "—"}</td>
                  <td className={`px-5 py-3 text-right font-semibold tabular-nums ${r.low ? "text-amber-700" : ""}`}>{r.qty.toLocaleString("en-IN")}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.unit}</td>
                  <td className="px-5 py-3 text-right text-xs text-muted-foreground tabular-nums">{r.reorder || "—"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  <BarChart3 className="mx-auto mb-2 h-8 w-8 opacity-40" />No stock to show for this selection.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DataPagination {...pg} />
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, active, onClick }: { icon: React.ReactNode; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${active ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border bg-card hover:border-primary/40 hover:bg-secondary/40"}`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value.toLocaleString("en-IN")}</div>
    </button>
  );
}
