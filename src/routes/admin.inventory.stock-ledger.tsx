import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Search, BookOpenCheck, ArrowDownCircle, ArrowUpCircle, Scale, List, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserBranchScope } from "@/lib/use-user-branch-scope";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { DataPagination, usePagination } from "@/components/DataPagination";

export const Route = createFileRoute("/admin/inventory/stock-ledger")({ component: StockLedgerPage });

type Movement = {
  id: string;
  movement_date: string;
  movement_type: string;
  location_type: string;
  location_id: string;
  item_id: string;
  size_value: string;
  qty_change: number;
  reference_type: string;
  reference_id: string | null;
  notes: string;
};
type Item = { id: string; name: string; item_code: string; unit: string; standard_cost: number };
type ScopeAssignment = { candidate_id: string; scope_id: string; scope_type: string };

type HolderTypeFilter = "all" | "warehouse" | "branch" | "field_officer" | "security_guard";

function normalizeType(t: string): "warehouse" | "branch" | "field_officer" | "security_guard" | null {
  if (t === "warehouse") return "warehouse";
  if (t === "branch") return "branch";
  if (t === "field_officer") return "field_officer";
  if (t === "guard" || t === "security_guard") return "security_guard";
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  warehouse: "Warehouse",
  branch: "Branch",
  field_officer: "Field Officer",
  security_guard: "Security Guard",
};

function StockLedgerPage() {
  const scope = useUserBranchScope();
  const role = useCurrentUserRole();

  // Default last 30 days
  const today = new Date();
  const startDefault = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [fromDate, setFromDate] = useState(startDefault.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));
  const [holderType, setHolderType] = useState<HolderTypeFilter>("all");
  const [holderId, setHolderId] = useState<string>("all");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"movement" | "item">("movement");
  const [mode, setMode] = useState<"count" | "value">("count");

  // ------- Reference data -------
  const { data: items = [] } = useQuery({
    queryKey: ["ledger", "items"],
    queryFn: async () => {
      const { data } = await supabase.from("inv_items" as never).select("id,name,item_code,unit,standard_cost");
      return (data as unknown as Item[]) ?? [];
    },
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ["ledger", "warehouses"],
    queryFn: async () => {
      const { data } = await supabase.from("inv_warehouses" as never).select("id,name");
      return (data as unknown as { id: string; name: string }[]) ?? [];
    },
  });
  const { data: branches = [] } = useQuery({
    queryKey: ["ledger", "branches"],
    queryFn: async () => {
      const { data } = await supabase.from("branches" as never).select("id,name,code");
      return (data as unknown as { id: string; name: string; code: string | null }[]) ?? [];
    },
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["ledger", "candidates"],
    queryFn: async () => {
      const { data } = await supabase.from("candidates" as never).select("id,full_name,employee_code,role_key,reports_to").eq("status", "active");
      return (data as unknown as { id: string; full_name: string; employee_code: string | null; role_key: string; reports_to: string | null }[]) ?? [];
    },
  });
  const { data: scopeAssignments = [] } = useQuery({
    queryKey: ["ledger", "scope-assignments"],
    queryFn: async () => {
      const { data } = await supabase.from("employee_scope_assignments" as never).select("candidate_id,scope_id,scope_type").eq("scope_type", "branch");
      return (data as unknown as ScopeAssignment[]) ?? [];
    },
  });

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const brMap = useMemo(() => new Map(branches.map((b) => [b.id, b.code ? `${b.code} – ${b.name}` : b.name])), [branches]);
  const cMap = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const holderLabel = (locType: string, locId: string): string => {
    const t = normalizeType(locType);
    if (!t) return "—";
    if (t === "warehouse") return whMap.get(locId) ?? "—";
    if (t === "branch") return brMap.get(locId) ?? "—";
    const c = cMap.get(locId);
    return c ? `${c.full_name}${c.employee_code ? ` (${c.employee_code})` : ""}` : "—";
  };

  // ------- Movements: server-side date filter -------
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ["ledger", "movements", fromDate, toDate],
    queryFn: async () => {
      const fromIso = new Date(fromDate + "T00:00:00").toISOString();
      const toIso = new Date(toDate + "T23:59:59.999").toISOString();
      // page through to be safe
      const all: Movement[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("inv_stock_movements" as never)
          .select("id,movement_date,movement_type,location_type,location_id,item_id,size_value,qty_change,reference_type,reference_id,notes")
          .gte("movement_date", fromIso)
          .lte("movement_date", toIso)
          .order("movement_date", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data as unknown as Movement[]) ?? [];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  // ------- Opening balances: all movements strictly before fromDate (for By-Item view) -------
  const { data: openingMoves = [] } = useQuery({
    queryKey: ["ledger", "opening", fromDate],
    enabled: view === "item",
    queryFn: async () => {
      const fromIso = new Date(fromDate + "T00:00:00").toISOString();
      const all: Movement[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("inv_stock_movements" as never)
          .select("id,movement_date,movement_type,location_type,location_id,item_id,size_value,qty_change,reference_type,reference_id,notes")
          .lt("movement_date", fromIso)
          .order("movement_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data as unknown as Movement[]) ?? [];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  // ------- Role-based visible-location filter -------
  // Returns a function that decides whether a given (locType, locId) is visible to the user.
  const isVisible = useMemo(() => {
    if (role.isLoading || scope.isLoading) return () => false;

    // Super admin / inventory manager (unscoped admin) -> see everything
    if (role.isSuperAdmin || (!scope.isScoped && !role.isFieldOfficer)) {
      return () => true;
    }

    // Field officer: own + their guards' movements only.
    if (role.isFieldOfficer && role.candidateId) {
      const myGuards = new Set(
        candidates
          .filter((c) => (c.role_key === "guard" || c.role_key === "security_guard") && c.reports_to === role.candidateId)
          .map((c) => c.id),
      );
      return (locType: string, locId: string) => {
        const t = normalizeType(locType);
        if (t === "field_officer") return locId === role.candidateId;
        if (t === "security_guard") return myGuards.has(locId) || locId === role.candidateId;
        return false;
      };
    }

    // Branch-scoped (e.g. branch manager): own branch + FO/guards mapped to that branch.
    if (scope.isScoped && scope.branchId) {
      const myBranchId = scope.branchId;
      // candidate -> branch ids set (from employee_scope_assignments) + reports_to chain (light)
      const candidateBranches = new Map<string, Set<string>>();
      for (const sa of scopeAssignments) {
        const set = candidateBranches.get(sa.candidate_id) ?? new Set<string>();
        set.add(sa.scope_id);
        candidateBranches.set(sa.candidate_id, set);
      }
      const candidateInBranch = (candId: string): boolean => {
        const set = candidateBranches.get(candId);
        if (set?.has(myBranchId)) return true;
        // walk reports_to up to 3 levels
        let cur: string | null = candId;
        for (let i = 0; i < 3 && cur; i++) {
          const c = cMap.get(cur);
          if (!c) break;
          if (c.reports_to && candidateBranches.get(c.reports_to)?.has(myBranchId)) return true;
          cur = c.reports_to;
        }
        return false;
      };
      return (locType: string, locId: string) => {
        const t = normalizeType(locType);
        if (t === "branch") return locId === myBranchId;
        if (t === "field_officer" || t === "security_guard") return candidateInBranch(locId);
        // Warehouse movements aren't part of a branch ledger.
        return false;
      };
    }

    return () => false;
  }, [role.isLoading, role.isSuperAdmin, role.isFieldOfficer, role.candidateId, scope.isLoading, scope.isScoped, scope.branchId, candidates, cMap, scopeAssignments]);

  // ------- Holder options for the picker (respect visibility) -------
  const holderOptions = useMemo(() => {
    type Opt = { id: string; label: string };
    const out: Opt[] = [];
    if (holderType === "warehouse" || holderType === "all") {
      for (const w of warehouses) if (isVisible("warehouse", w.id)) out.push({ id: w.id, label: `[WH] ${w.name}` });
    }
    if (holderType === "branch" || holderType === "all") {
      for (const b of branches) if (isVisible("branch", b.id)) out.push({ id: b.id, label: `[Branch] ${brMap.get(b.id) ?? b.name}` });
    }
    if (holderType === "field_officer" || holderType === "all") {
      for (const c of candidates) {
        if (c.role_key === "field_officer" && isVisible("field_officer", c.id)) {
          out.push({ id: c.id, label: `[FO] ${c.full_name}${c.employee_code ? ` (${c.employee_code})` : ""}` });
        }
      }
    }
    if (holderType === "security_guard" || holderType === "all") {
      for (const c of candidates) {
        if ((c.role_key === "guard" || c.role_key === "security_guard") && isVisible("security_guard", c.id)) {
          out.push({ id: c.id, label: `[Guard] ${c.full_name}${c.employee_code ? ` (${c.employee_code})` : ""}` });
        }
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [holderType, warehouses, branches, candidates, brMap, isVisible]);

  // ------- Filtered rows -------
  const rows = useMemo(() => {
    const out: {
      id: string;
      when: string;
      type: string;
      holder_type: string;
      holder_label: string;
      item_name: string;
      item_code: string;
      size: string;
      debit: number;
      credit: number;
      debit_val: number;
      credit_val: number;
      ref: string;
      notes: string;
    }[] = [];
    const ql = q.trim().toLowerCase();
    for (const m of movements) {
      if (!isVisible(m.location_type, m.location_id)) continue;
      const t = normalizeType(m.location_type);
      if (!t) continue;
      if (holderType !== "all" && t !== holderType) continue;
      if (holderId !== "all" && m.location_id !== holderId) continue;
      const qty = Number(m.qty_change);
      if (direction === "in" && qty <= 0) continue;
      if (direction === "out" && qty >= 0) continue;
      const it = itemMap.get(m.item_id);
      const label = holderLabel(m.location_type, m.location_id);
      if (ql) {
        const hay = `${label} ${it?.name ?? ""} ${it?.item_code ?? ""} ${m.movement_type} ${m.reference_type}`.toLowerCase();
        if (!hay.includes(ql)) continue;
      }
      const cost = Number(it?.standard_cost ?? 0);
      const debit = qty > 0 ? qty : 0;
      const credit = qty < 0 ? -qty : 0;
      out.push({
        id: m.id,
        when: m.movement_date,
        type: m.movement_type,
        holder_type: TYPE_LABEL[t] ?? t,
        holder_label: label,
        item_name: it?.name ?? "—",
        item_code: it?.item_code ?? "",
        size: m.size_value || "—",
        debit,
        credit,
        debit_val: debit * cost,
        credit_val: credit * cost,
        ref: m.reference_type ? `${m.reference_type.toUpperCase()}${m.reference_id ? ` · ${m.reference_id.slice(0, 8)}` : ""}` : "—",
        notes: m.notes || "",
      });
    }
    return out;
  }, [movements, isVisible, holderType, holderId, direction, q, itemMap, holderLabel]);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const totalDebitVal = rows.reduce((s, r) => s + r.debit_val, 0);
  const totalCreditVal = rows.reduce((s, r) => s + r.credit_val, 0);
  const net = totalDebit - totalCredit;
  const netVal = totalDebitVal - totalCreditVal;
  const pgMovement = usePagination(rows);
  const fmtInr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // ------- By-Item summary: opening + in/out (in period) + closing, per item+size -------
  type ItemRow = {
    key: string;
    item_id: string;
    item_name: string;
    item_code: string;
    unit: string;
    size: string;
    opening: number;
    in_qty: number;
    out_qty: number;
    closing: number;
    last_movement: string | null;
  };
  const itemRows = useMemo<ItemRow[]>(() => {
    if (view !== "item") return [];
    const map = new Map<string, ItemRow>();
    const ql = q.trim().toLowerCase();
    const keyOf = (item_id: string, size: string) => `${item_id}__${size}`;
    const ensure = (item_id: string, size: string): ItemRow => {
      const k = keyOf(item_id, size);
      let r = map.get(k);
      if (!r) {
        const it = itemMap.get(item_id);
        r = {
          key: k,
          item_id,
          item_name: it?.name ?? "—",
          item_code: it?.item_code ?? "",
          unit: it?.unit ?? "",
          size: size || "—",
          opening: 0, in_qty: 0, out_qty: 0, closing: 0,
          last_movement: null,
        };
        map.set(k, r);
      }
      return r;
    };
    // Opening = all movements strictly before fromDate, within visible scope and holder filters
    const passFilters = (m: Movement) => {
      if (!isVisible(m.location_type, m.location_id)) return false;
      const t = normalizeType(m.location_type);
      if (!t) return false;
      if (holderType !== "all" && t !== holderType) return false;
      if (holderId !== "all" && m.location_id !== holderId) return false;
      return true;
    };
    for (const m of openingMoves) {
      if (!passFilters(m)) continue;
      const r = ensure(m.item_id, m.size_value || "");
      r.opening += Number(m.qty_change);
    }
    for (const m of movements) {
      if (!passFilters(m)) continue;
      const qty = Number(m.qty_change);
      const r = ensure(m.item_id, m.size_value || "");
      if (qty > 0) r.in_qty += qty;
      else r.out_qty += -qty;
      if (!r.last_movement || m.movement_date > r.last_movement) r.last_movement = m.movement_date;
    }
    let out = Array.from(map.values()).map((r) => ({ ...r, closing: r.opening + r.in_qty - r.out_qty }));
    // Hide rows that had zero opening AND no period activity
    out = out.filter((r) => r.opening !== 0 || r.in_qty !== 0 || r.out_qty !== 0);
    if (ql) {
      out = out.filter((r) => `${r.item_name} ${r.item_code} ${r.size}`.toLowerCase().includes(ql));
    }
    out.sort((a, b) => a.item_name.localeCompare(b.item_name) || a.size.localeCompare(b.size));
    return out;
  }, [view, movements, openingMoves, isVisible, holderType, holderId, q, itemMap]);

  const pgItem = usePagination(itemRows);
  const itemTotals = useMemo(() => ({
    opening: itemRows.reduce((s, r) => s + r.opening, 0),
    in_qty: itemRows.reduce((s, r) => s + r.in_qty, 0),
    out_qty: itemRows.reduce((s, r) => s + r.out_qty, 0),
    closing: itemRows.reduce((s, r) => s + r.closing, 0),
  }), [itemRows]);


  // ------- XLSX export -------
  function fmtWhen(s: string): string {
    const d = new Date(s);
    return `${d.toLocaleDateString("en-IN")} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  function downloadLedgerXlsx() {
    const wb = XLSX.utils.book_new();
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeLine = role.isSuperAdmin
      ? "Scope: All locations (Super Admin)"
      : role.isFieldOfficer
      ? "Scope: Field Officer (own + reporting guards)"
      : scope.isScoped
      ? `Scope: Branch — ${scope.branchLabel}`
      : "Scope: All locations";

    // --- Sheet 1: Summary ---
    const byType = new Map<string, { debit: number; credit: number; rows: number }>();
    for (const r of rows) {
      const cur = byType.get(r.holder_type) ?? { debit: 0, credit: 0, rows: 0 };
      cur.debit += r.debit;
      cur.credit += r.credit;
      cur.rows += 1;
      byType.set(r.holder_type, cur);
    }
    const summary: (string | number)[][] = [
      ["PLUS 360 FAHRENHEIT SOLUTIONS — Stock Ledger (Debit / Credit Reconciliation)"],
      [`Period: ${fromDate}  →  ${toDate}`],
      [scopeLine],
      [`Generated: ${stamp}`],
      [],
      ["Holder Type", "Entries", "Debit (IN)", "Credit (OUT)", "Net"],
      ...Array.from(byType.entries()).map(([k, v]) => [k, v.rows, v.debit, v.credit, v.debit - v.credit]),
      [],
      ["TOTAL", rows.length, totalDebit, totalCredit, net],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(summary);
    wsSum["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    wsSum["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
    ];
    XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

    // --- Sheet 2: Full ledger (chronological) ---
    const chrono = [...rows].sort((a, b) => a.when.localeCompare(b.when));
    const ledgerAoa: (string | number)[][] = [
      ["Stock Ledger — All Entries"],
      [`${fromDate} → ${toDate}  ·  ${scopeLine}`],
      [],
      ["Date", "Type", "Holder Bucket", "Holder", "Item Code", "Item", "Size", "Debit (IN)", "Credit (OUT)", "Reference", "Notes"],
      ...chrono.map((r) => [
        fmtWhen(r.when), r.type, r.holder_type, r.holder_label, r.item_code, r.item_name, r.size,
        r.debit || "", r.credit || "", r.ref, r.notes,
      ]),
      [],
      ["TOTAL", "", "", "", "", "", "", totalDebit, totalCredit, "", `Net ${net}`],
    ];
    const wsAll = XLSX.utils.aoa_to_sheet(ledgerAoa);
    wsAll["!cols"] = [
      { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 28 },
      { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 30 },
    ];
    wsAll["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
    ];
    XLSX.utils.book_append_sheet(wb, wsAll, "Ledger");

    // --- One sheet per holder bucket ---
    const buckets: { key: string; title: string }[] = [
      { key: "Warehouse", title: "Warehouses" },
      { key: "Branch", title: "Branches" },
      { key: "Field Officer", title: "Field Officers" },
      { key: "Security Guard", title: "Security Guards" },
    ];
    for (const bk of buckets) {
      const bRows = chrono.filter((r) => r.holder_type === bk.key);
      if (!bRows.length) continue;
      // group by holder, then by item+size, with running totals
      const grouped = new Map<string, typeof bRows>();
      for (const r of bRows) {
        const arr = grouped.get(r.holder_label) ?? [];
        arr.push(r);
        grouped.set(r.holder_label, arr);
      }
      const aoa: (string | number)[][] = [
        [`${bk.title} — Stock Ledger`],
        [`${fromDate} → ${toDate}`],
        [],
      ];
      for (const [holder, items] of grouped) {
        aoa.push([`Holder: ${holder}`]);
        aoa.push(["Date", "Type", "Item Code", "Item", "Size", "Debit (IN)", "Credit (OUT)", "Reference", "Notes"]);
        let d = 0, c = 0;
        for (const r of items) {
          aoa.push([fmtWhen(r.when), r.type, r.item_code, r.item_name, r.size, r.debit || "", r.credit || "", r.ref, r.notes]);
          d += r.debit; c += r.credit;
        }
        aoa.push(["", "", "", "", "Subtotal", d, c, "", `Net ${d - c}`]);
        aoa.push([]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, bk.title.slice(0, 31));
    }

    XLSX.writeFile(wb, `stock-ledger-${fromDate}_to_${toDate}.xlsx`);
  }

  function downloadCurrentViewCsv() {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
      ["Date", "Type", "Holder Bucket", "Holder", "Item Code", "Item", "Size", "Debit (IN)", "Credit (OUT)", "Reference", "Notes"],
      ...rows.map((r) => [fmtWhen(r.when), r.type, r.holder_type, r.holder_label, r.item_code, r.item_name, r.size, r.debit || "", r.credit || "", r.ref, r.notes]),
      [],
      ["TOTAL", "", "", "", "", "", "", totalDebit, totalCredit, "", `Net ${net}`],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, `stock-ledger-view-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadItemSummaryXlsx() {
    const wb = XLSX.utils.book_new();
    const scopeLine = role.isSuperAdmin
      ? "All locations (Super Admin)"
      : role.isFieldOfficer
      ? "Field Officer (own + reporting guards)"
      : scope.isScoped
      ? `Branch — ${scope.branchLabel}`
      : "All locations";
    const aoa: (string | number)[][] = [
      ["Stock Ledger — By Item (Opening · IN · OUT · Closing)"],
      [`Period: ${fromDate} → ${toDate}  ·  Scope: ${scopeLine}`],
      [],
      ["Item Code", "Item", "Size", "Unit", "Opening", "IN (period)", "OUT (period)", "Closing", "Last Movement"],
      ...itemRows.map((r) => [
        r.item_code, r.item_name, r.size, r.unit,
        r.opening, r.in_qty, r.out_qty, r.closing,
        r.last_movement ? fmtWhen(r.last_movement) : "",
      ]),
      [],
      ["TOTAL", "", "", "", itemTotals.opening, itemTotals.in_qty, itemTotals.out_qty, itemTotals.closing, ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }];
    XLSX.utils.book_append_sheet(wb, ws, "By Item");
    XLSX.writeFile(wb, `stock-by-item-${fromDate}_to_${toDate}.xlsx`);
  }

  return (
    <div>
      <PageHeader
        title="Stock Ledger"
        description="Daybook — every stock-in and stock-out movement. Super admin sees all; branches see their chain; field officers see their own and reporting guards."
        crumbs={[{ label: "Uniform Manager", to: "/admin/inventory" }, { label: "Stock Ledger" }]}
      />

      {/* Mode toggle (By Count / By Value) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex h-10 items-center rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setMode("count")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold uppercase tracking-wider transition ${mode === "count" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >By Count</button>
          <button
            type="button"
            onClick={() => setMode("value")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold uppercase tracking-wider transition ${mode === "value" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >By Value</button>
        </div>
      </div>

      {/* KPI band */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<ArrowDownCircle className="h-4 w-4 text-white" />} label={mode === "value" ? "Stock In Value" : "Stock In"} value={mode === "value" ? fmtInr(totalDebitVal) : totalDebit} accent="emerald" />
        <KpiCard icon={<ArrowUpCircle className="h-4 w-4 text-white" />} label={mode === "value" ? "Stock Out Value" : "Stock Out"} value={mode === "value" ? fmtInr(totalCreditVal) : totalCredit} accent="rose" />
        <KpiCard icon={<Scale className="h-4 w-4 text-white" />} label={mode === "value" ? "Net Value" : "Net Movement"} value={mode === "value" ? fmtInr(netVal) : net} accent={(mode === "value" ? netVal : net) >= 0 ? "emerald" : "rose"} />
        <KpiCard icon={<BookOpenCheck className="h-4 w-4 text-white" />} label="Ledger Entries" value={rows.length} accent="slate" />
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">From</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-40 rounded-lg" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">To</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 w-40 rounded-lg" />
          </div>
          <div className="inline-flex h-10 items-center rounded-lg border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("movement")}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === "movement" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="h-3.5 w-3.5" />By Movement
            </button>
            <button
              type="button"
              onClick={() => setView("item")}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === "item" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Package className="h-3.5 w-3.5" />By Item
            </button>
          </div>
          <Select value={holderType} onValueChange={(v) => { setHolderType(v as HolderTypeFilter); setHolderId("all"); }}>
            <SelectTrigger className="h-10 w-44 rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All holder types</SelectItem>
              <SelectItem value="warehouse">Warehouses</SelectItem>
              <SelectItem value="branch">Branches</SelectItem>
              <SelectItem value="field_officer">Field Officers</SelectItem>
              <SelectItem value="security_guard">Security Guards</SelectItem>
            </SelectContent>
          </Select>
          <Select value={holderId} onValueChange={setHolderId}>
            <SelectTrigger className="h-10 w-64 rounded-lg"><SelectValue placeholder="All holders" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All holders</SelectItem>
              {holderOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {view === "movement" && (
            <Select value={direction} onValueChange={(v) => setDirection(v as "all" | "in" | "out")}>
              <SelectTrigger className="h-10 w-44 rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Stock In & Out</SelectItem>
                <SelectItem value="in">Stock In only</SelectItem>
                <SelectItem value="out">Stock Out only</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === "item" ? "Search item, code, size…" : "Search item, holder, type…"} className="h-10 rounded-lg pl-9" />
          </div>
        </div>
        <div className="flex gap-2">
          {view === "movement" ? (
            <>
              <Button variant="outline" className="h-10 rounded-lg" disabled={!rows.length} onClick={downloadCurrentViewCsv}>
                <Download className="mr-1.5 h-4 w-4" />Export view
              </Button>
              <Button className="h-10 rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={!rows.length} onClick={downloadLedgerXlsx}>
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />Full Ledger
              </Button>
            </>
          ) : (
            <Button className="h-10 rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={!itemRows.length} onClick={downloadItemSummaryXlsx}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />Export Item Summary
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          {view === "movement" ? (
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Holder</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3 text-right">{mode === "value" ? "Stock In (₹)" : "Stock In"}</th>
                <th className="px-4 py-3 text-right">{mode === "value" ? "Stock Out (₹)" : "Stock Out"}</th>
                <th className="px-4 py-3">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">Loading ledger…</td></tr>
              )}
              {!isLoading && pgMovement.pageRows.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtWhen(r.when)}</td>
                  <td className="px-4 py-3 text-xs"><span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{r.type}</span></td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.holder_label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.holder_type}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.item_name}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.item_code}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{r.size}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{mode === "value" ? (r.debit_val ? fmtInr(r.debit_val) : "") : (r.debit ? r.debit.toLocaleString("en-IN") : "")}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-rose-700">{mode === "value" ? (r.credit_val ? fmtInr(r.credit_val) : "") : (r.credit ? r.credit.toLocaleString("en-IN") : "")}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{r.ref}</td>
                </tr>
              ))}
              {!isLoading && !rows.length && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  <BookOpenCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />No movements in this range / scope.
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-secondary/30 text-sm">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right text-xs uppercase tracking-wider text-muted-foreground">Totals</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">{mode === "value" ? fmtInr(totalDebitVal) : totalDebit.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-700">{mode === "value" ? fmtInr(totalCreditVal) : totalCredit.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right text-xs">
                    Net <span className={`font-bold tabular-nums ${(mode === "value" ? netVal : net) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{mode === "value" ? fmtInr(netVal) : net.toLocaleString("en-IN")}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          ) : (
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Opening</th>
                <th className="px-4 py-3 text-right">Stock In (period)</th>
                <th className="px-4 py-3 text-right">Stock Out (period)</th>
                <th className="px-4 py-3 text-right">Closing</th>
                <th className="px-4 py-3">Last Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && pgItem.pageRows.map((r) => (
                <tr key={r.key} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.item_name}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.item_code}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{r.size}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.opening.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{r.in_qty ? r.in_qty.toLocaleString("en-IN") : ""}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-rose-700">{r.out_qty ? r.out_qty.toLocaleString("en-IN") : ""}</td>
                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${r.closing < 0 ? "text-rose-700" : ""}`}>{r.closing.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground whitespace-nowrap">{r.last_movement ? fmtWhen(r.last_movement) : "—"}</td>
                </tr>
              ))}
              {!isLoading && !itemRows.length && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />No item activity in this range / scope.
                </td></tr>
              )}
            </tbody>
            {itemRows.length > 0 && (
              <tfoot className="bg-secondary/30 text-sm">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-xs uppercase tracking-wider text-muted-foreground">Totals</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{itemTotals.opening.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">{itemTotals.in_qty.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-700">{itemTotals.out_qty.toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{itemTotals.closing.toLocaleString("en-IN")}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          )}
          {view === "movement" ? <DataPagination {...pgMovement} /> : <DataPagination {...pgItem} />}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string; accent: "emerald" | "rose" | "slate" }) {
  const cls =
    accent === "emerald" ? "bg-emerald-600 text-white"
    : accent === "rose" ? "bg-rose-500 text-white"
    : "bg-slate-700 text-white";
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${cls}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/90">{icon}{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-white">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div>
    </div>
  );
}
