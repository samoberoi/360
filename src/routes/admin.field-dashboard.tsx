import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { autoIssuePostingOrder } from "@/lib/posting-order-auto";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, MoveRight } from "lucide-react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Minus,
  Warehouse,
  ArrowUpRight,
  PackageCheck,
  Route as RouteIcon,
  Flag,
  Clock,
} from "lucide-react";


import { DashboardShell } from "@/components/LiveFeed";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentPermissions } from "@/lib/rbac";
import { readStoredAuthUser } from "@/lib/auth";
import { PeopleInsightsCard } from "@/components/PeopleInsightsCard";
import { usePeopleInsights } from "@/lib/people-insights";
import { MarkAttendanceCard } from "@/components/MarkAttendanceCard";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/Skeletons";
import { RADIANT_BILLING_UNIT_ID } from "@/lib/business-constants";
import { UserCog, UserCheck } from "lucide-react";
import { useRehirePipeline, rehireHolderLabel } from "@/components/RehirePipelineCard";
import { UnitDesignationSelect } from "@/components/UnitDesignationSelect";
import { UanFollowUp } from "@/components/UanFollowUp";
import { ContractDesignationFollowUp } from "@/components/ContractDesignationFollowUp";
import { VisitProofs } from "@/components/VisitProofs";




export const Route = createFileRoute("/admin/field-dashboard")({
  head: () => ({
    meta: [
      { title: "Field Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Field operations attendance, assigned sites, inventory, visits, and team activity." },
      { property: "og:title", content: "Field Dashboard | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Field operations attendance, assigned sites, inventory, visits, and team activity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FieldOfficerDashboard,
});

type Guard = { id: string; full_name: string; employee_code: string | null; designation: string };
type CoFo = { id: string; full_name: string; employee_code: string | null };
type UnitNode = {
  id: string;
  code: string;
  name: string;
  customer_name: string;
  is_primary: boolean;
  guards: Guard[];
  co_field_officers: CoFo[];
  pending_onboarding: number;
  open_demands: number;
  inventory_items: number;
};

type PendingIssuance = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  assigned_asset_ids: string[] | null;
  onboarding_details: { issuance_asset_ids?: string[] | null; issuance_requested_at?: string | null } | null;
};

function dashboardChannelName(phone: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `field-officer-units-${phone}-${crypto.randomUUID()}`;
  }
  return `field-officer-units-${phone}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type FoStats = {
  guardsByUnit: Record<string, Guard[]>;
  coFoByUnit: Record<string, CoFo[]>;
  pendingByUnit: Record<string, number>;
  demandsByUnit: Record<string, number>;
  inventoryByUnit: Record<string, number>;
  guardsTotal: number;
  joinedThisWeek: number;
  joinedLastWeek: number;
  attendanceRateToday: number;
  attendanceRateYesterday: number;
  pendingOnboardingTotal: number;
  pendingOnboardingLastWeek: number;
  openDemandsTotal: number;
  inventoryItemsTotal: number;
  myStockQty: number;
  myStockSkus: number;
};

type FoBaseUnit = {
  id: string;
  code: string;
  name: string;
  customer_id: string | null;
  branch_id: string | null;
  customer_name: string;
  is_primary: boolean;
};
type FoBase = {
  meId: string | null;
  units: FoBaseUnit[];
};

// The signed-in phone is written synchronously by the login flow.
function storedPhone(): string {
  return readStoredAuthUser()?.phone?.replace(/\D/g, "").slice(-10) ?? "";
}

// Local paint cache only — every read still revalidates against the server.
function readSnapshot<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`fo-snap:${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeSnapshot(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`fo-snap:${key}`, JSON.stringify(value));
  } catch {
    /* optional cache */
  }
}


function FieldOfficerDashboard() {
  const { roleKey, isSuperAdmin } = useCurrentPermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  // The signed-in phone is already known synchronously from the login snapshot.
  // Waiting on supabase.auth.getUser() first added a whole round trip before
  // any dashboard read could even start.
  const [phone, setPhone] = useState<string>(() => storedPhone());
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      const em = data.user?.email ?? "";
      const m = em.match(/phone-(\d{10})@/);
      if (m?.[1]) setPhone(m[1]);
      setEmail(em);
    });
  }, []);

  useEffect(() => {
    if (!isSuperAdmin && roleKey && roleKey !== "field_officer") {
      navigate({ to: "/admin/dashboard", replace: true });
    }
  }, [roleKey, isSuperAdmin, navigate]);

  // ── Pass 1: identity + my units. Small, scoped reads only, so the "My units"
  // card paints as soon as this resolves. Heavy team/attendance/inventory
  // aggregation happens in pass 2 and never blocks the unit list.
  const baseQ = useQuery({
    queryKey: ["fo-base-v1", phone],
    enabled: !!phone,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // Last known name/units paint immediately while the fresh read runs.
    initialData: () => readSnapshot<FoBase>(`fo-base:${phone}`) ?? undefined,
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<FoBase> => {
      const { data: me } = await supabase
        .from("candidates")
        .select("id,unit_id")
        .eq("mobile", phone)
        .maybeSingle();
      const meRow = me as
        | { id?: string; unit_id?: string | null }
        | null;
      const meId = meRow?.id ?? null;
      const base: FoBase = {
        meId,
        units: [],
      };
      if (!meId) return base;

      const [resolvedUnitsRes, scopeRes, cuRes] = await Promise.all([
        supabase.rpc("current_user_unit_ids"),
        supabase.from("employee_scope_assignments").select("scope_id,scope_type").eq("candidate_id", meId),
        supabase.from("candidate_units").select("unit_id,is_primary").eq("candidate_id", meId),
      ]);
      const scopeRows = (scopeRes.data ?? []) as Array<{ scope_id: string; scope_type: string }>;
      const scopeCustomerIds = scopeRows.filter((r) => r.scope_type === "customer").map((r) => r.scope_id);
      const legacyUnits = (cuRes.data ?? []) as Array<{ unit_id: string; is_primary: boolean }>;
      const primaryMap = new Map(legacyUnits.map((r) => [r.unit_id, r.is_primary]));

      // "My clients" = units actually ASSIGNED to me. Branch scope rows are NOT
      // expanded — that row is the officer's home/payroll branch.
      const unitIdSet = new Set<string>();
      for (const id of (resolvedUnitsRes.data ?? []) as string[]) unitIdSet.add(id);
      if (meRow?.unit_id) unitIdSet.add(meRow.unit_id);
      for (const r of legacyUnits) unitIdSet.add(r.unit_id);
      for (const r of scopeRows) if (r.scope_type === "unit") unitIdSet.add(r.scope_id);
      if (scopeCustomerIds.length) {
        const { data: orgUnits } = await supabase
          .from("units")
          .select("id")
          .in("customer_id", scopeCustomerIds)
          .eq("is_billable", true);
        for (const r of (orgUnits ?? []) as Array<{ id: string }>) unitIdSet.add(r.id);
      }
      unitIdSet.delete(RADIANT_BILLING_UNIT_ID);
      if (!unitIdSet.size) return base;

      // Single scoped read: only my units, with everything the card needs.
      const { data: unitRowsRaw } = await supabase
        .from("units")
        .select("id,code,name,customer_id,branch_id,is_billable")
        .in("id", Array.from(unitIdSet));
      const unitRows = ((unitRowsRaw ?? []) as Array<{
        id: string;
        code: string;
        name: string;
        customer_id: string | null;
        branch_id: string | null;
        is_billable: boolean | null;
      }>).filter((u) => u.is_billable !== false);

      const customerIds = Array.from(new Set(unitRows.map((u) => u.customer_id).filter(Boolean))) as string[];
      const custMap = new Map<string, string>();
      if (customerIds.length) {
        const { data: custs } = await supabase.from("customers").select("id,name").in("id", customerIds);
        for (const c of (custs ?? []) as Array<{ id: string; name: string }>) custMap.set(c.id, c.name);
      }

      const out: FoBase = {
        ...base,
        units: unitRows
          .map((u) => ({
            id: u.id,
            code: u.code,
            name: u.name,
            customer_id: u.customer_id,
            branch_id: u.branch_id,
            customer_name: (u.customer_id && custMap.get(u.customer_id)) || "—",
            is_primary: primaryMap.get(u.id) ?? false,
          }))
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name)),
      };
      writeSnapshot(`fo-base:${phone}`, out);
      return out;
    },
  });

  const meId = baseQ.data?.meId ?? null;
  const baseUnits = useMemo(() => baseQ.data?.units ?? [], [baseQ.data?.units]);
  const unitIdsKey = useMemo(() => baseUnits.map((u) => u.id).sort().join(","), [baseUnits]);

  // ── Pass 2: team, attendance, onboarding, inventory. Purely additive.
  const statsQ = useQuery({
    queryKey: ["fo-stats-v1", meId, userId, unitIdsKey],
    enabled: !!meId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    // Show the previous counts straight away instead of zeros/blanks while the
    // aggregation runs; they refresh in place a moment later.
    placeholderData: () => (meId ? readSnapshot<FoStats>(`fo-stats:${meId}`) : undefined),
    queryFn: async () => {
      const UNASSIGNED = "__unassigned__";
      const unitIds = baseUnits.map((u) => u.id);
      const emptyStats = {
        guardsByUnit: {} as Record<string, Guard[]>,
        coFoByUnit: {} as Record<string, CoFo[]>,
        pendingByUnit: {} as Record<string, number>,
        demandsByUnit: {} as Record<string, number>,
        inventoryByUnit: {} as Record<string, number>,
        guardsTotal: 0, joinedThisWeek: 0, joinedLastWeek: 0,
        attendanceRateToday: 0, attendanceRateYesterday: 0,
        pendingOnboardingTotal: 0, pendingOnboardingLastWeek: 0,
        openDemandsTotal: 0, inventoryItemsTotal: 0,
        myStockQty: 0, myStockSkus: 0,
      };
      if (!meId) return emptyStats;

      // Guards mapped to my units via candidate_units (multi-unit coverage) must
      // be included even when their primary unit points elsewhere.
      const guardExtraUnits = new Map<string, Set<string>>();
      if (unitIds.length) {
        const { data: cuGuards } = await supabase
          .from("candidate_units")
          .select("candidate_id,unit_id")
          .in("unit_id", unitIds);
        for (const r of (cuGuards ?? []) as Array<{ candidate_id: string; unit_id: string }>) {
          const gs = guardExtraUnits.get(r.candidate_id) ?? new Set<string>();
          gs.add(r.unit_id);
          guardExtraUnits.set(r.candidate_id, gs);
        }
      }
      const extraGuardIds = Array.from(guardExtraUnits.keys());

      const teamFilters: string[] = [];
      if (unitIds.length) teamFilters.push(`unit_id.in.(${unitIds.join(",")})`);
      if (extraGuardIds.length) teamFilters.push(`id.in.(${extraGuardIds.join(",")})`);

      const guardList = teamFilters.length
        ? (((
            await supabase
              .from("candidates")
              .select("id,full_name,employee_code,designation_id,unit_id,role_key,status,is_enabled,created_at")
              .in("role_key", ["guard", "security_guard"])
              .eq("status", "active")
              .eq("is_enabled", true)
              .order("full_name", { ascending: true })
              .or(teamFilters.join(","))
          ).data ?? []) as Array<{
            id: string;
            full_name: string;
            employee_code: string | null;
            designation_id: string | null;
            unit_id: string | null;
            created_at: string | null;
          }>)
        : [];

      // Co-field-officers on my units — scoped by unit / branch / customer ids only.
      const coFoByUnit: Record<string, CoFo[]> = {};
      if (unitIds.length) {
        const branchIds = Array.from(new Set(baseUnits.map((u) => u.branch_id).filter(Boolean))) as string[];
        const customerIds = Array.from(new Set(baseUnits.map((u) => u.customer_id).filter(Boolean))) as string[];
        const scopeIds = Array.from(new Set([...unitIds, ...branchIds, ...customerIds]));
        const [foRes, foCuRes, foEsaRes] = await Promise.all([
          supabase
            .from("candidates")
            .select("id,full_name,employee_code,unit_id,role_key,status,is_enabled")
            .eq("role_key", "field_officer")
            .in("status", ["active", "approved"])
            .eq("is_enabled", true),
          supabase.from("candidate_units").select("candidate_id,unit_id").in("unit_id", unitIds),
          supabase
            .from("employee_scope_assignments")
            .select("candidate_id,scope_id,scope_type")
            .in("scope_id", scopeIds),
        ]);
        const fos = ((foRes.data ?? []) as Array<{ id: string; full_name: string; employee_code: string | null; unit_id: string | null }>).filter((f) => f.id !== meId);
        const foMap = new Map(fos.map((f) => [f.id, f]));
        const foCu = (foCuRes.data ?? []) as Array<{ candidate_id: string; unit_id: string }>;
        const foEsa = (foEsaRes.data ?? []) as Array<{ candidate_id: string; scope_id: string; scope_type: string }>;
        for (const u of baseUnits) {
          const mapped = new Set<string>();
          for (const f of fos) if (f.unit_id === u.id) mapped.add(f.id);
          for (const r of foCu) if (r.unit_id === u.id && foMap.has(r.candidate_id)) mapped.add(r.candidate_id);
          for (const r of foEsa) {
            if (!foMap.has(r.candidate_id)) continue;
            if (r.scope_type === "unit" && r.scope_id === u.id) mapped.add(r.candidate_id);
            if (r.scope_type === "branch" && u.branch_id && r.scope_id === u.branch_id) mapped.add(r.candidate_id);
            if (r.scope_type === "customer" && u.customer_id && r.scope_id === u.customer_id) mapped.add(r.candidate_id);
          }
          if (mapped.size) {
            coFoByUnit[u.id] = Array.from(mapped)
              .map((id) => foMap.get(id)!)
              .filter(Boolean)
              .map((f) => ({ id: f.id, full_name: f.full_name, employee_code: f.employee_code }))
              .sort((a, b) => a.full_name.localeCompare(b.full_name));
          }
        }
      }

      const desigIds = Array.from(new Set(guardList.map((g) => g.designation_id).filter(Boolean))) as string[];
      const [mineRes, desigsRes, codesRes] = await Promise.all([
        userId
          ? supabase.from("candidates").select("id,status,unit_id,created_by,created_at").eq("created_by", userId)
          : Promise.resolve({ data: [] as Array<{ status: string; unit_id: string | null; created_at: string | null }> }),
        desigIds.length
          ? supabase.from("designations").select("id,name").in("id", desigIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
        supabase.from("attendance_codes").select("code,counts_as_present"),
      ]);
      const desigMap = new Map(((desigsRes.data ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]));
      const presentCodes = new Set(
        ((codesRes.data ?? []) as Array<{ code: string; counts_as_present: boolean }>)
          .filter((c) => c.counts_as_present)
          .map((c) => c.code),
      );

      const guardsByUnit: Record<string, Guard[]> = {};
      const guardIdToUnit = new Map<string, string>();
      for (const g of guardList) {
        const primary = g.unit_id ?? UNASSIGNED;
        const placements = new Set<string>([primary]);
        const extras = guardExtraUnits.get(g.id);
        if (extras) for (const uid of extras) placements.add(uid);
        guardIdToUnit.set(g.id, primary);
        const entry = {
          id: g.id,
          full_name: g.full_name,
          employee_code: g.employee_code,
          designation: (g.designation_id && desigMap.get(g.designation_id)) || "—",
        };
        for (const uid of placements) {
          const arr = guardsByUnit[uid] ?? [];
          if (!arr.some((x) => x.id === entry.id)) arr.push(entry);
          guardsByUnit[uid] = arr;
        }
      }

      const today = isoDaysAgo(0);
      const yday = isoDaysAgo(1);
      const guardIds = guardList.map((g) => g.id);
      let presentToday = 0, totalToday = 0, presentYday = 0, totalYday = 0;
      if (guardIds.length) {
        const { data: entries } = await supabase
          .from("attendance_entries")
          .select("candidate_id,code,entry_date")
          .in("entry_date", [today, yday])
          .in("candidate_id", guardIds);
        for (const e of (entries ?? []) as Array<{ code: string; entry_date: string }>) {
          if (e.entry_date === today) { totalToday += 1; if (presentCodes.has(e.code)) presentToday += 1; }
          else { totalYday += 1; if (presentCodes.has(e.code)) presentYday += 1; }
        }
      }

      const mine = (mineRes.data ?? []) as Array<{ status: string; unit_id: string | null; created_at: string | null }>;
      const weekAgoIso = isoDaysAgo(7);
      const twoWeeksAgoIso = isoDaysAgo(14);
      const pendingStatuses = ["pending", "rejected", "draft"];
      const pendingOnboardingTotal = mine.filter((r) => pendingStatuses.includes(r.status)).length;
      const pendingOnboardingLastWeek = mine.filter((r) => {
        const d = r.created_at ?? "";
        return d && d >= twoWeeksAgoIso && d < weekAgoIso && pendingStatuses.includes(r.status);
      }).length;
      const pendingByUnit: Record<string, number> = {};
      for (const c of mine) {
        if (!pendingStatuses.includes(c.status)) continue;
        const uid = c.unit_id ?? UNASSIGNED;
        pendingByUnit[uid] = (pendingByUnit[uid] ?? 0) + 1;
      }

      let joinedThisWeek = 0, joinedLastWeek = 0;
      for (const g of guardList) {
        const d = g.created_at ?? "";
        if (!d) continue;
        if (d >= weekAgoIso) joinedThisWeek += 1;
        else if (d >= twoWeeksAgoIso) joinedLastWeek += 1;
      }

      const demandsByUnit: Record<string, number> = {};
      const inventoryByUnit: Record<string, number> = {};
      try {
        const teamIds = [meId, ...guardIds];
        const orClauses = [`requested_by.in.(${teamIds.join(",")})`];
        if (unitIds.length) orClauses.push(`unit_id.in.(${unitIds.join(",")})`);
        const { data: demands } = await supabase
          .from("inv_demands" as never)
          .select("id,status,unit_id,requested_by")
          .or(orClauses.join(","))
          .in("status", ["pending", "approved", "partial", "open", "raised", "submitted"]);
        for (const d of (demands ?? []) as Array<{ unit_id: string | null }>) {
          const uid = d.unit_id ?? UNASSIGNED;
          demandsByUnit[uid] = (demandsByUnit[uid] ?? 0) + 1;
        }
      } catch { /* ignore */ }

      let myStockQty = 0;
      let myStockSkus = 0;
      try {
        const { data: myBal } = await supabase
          .from("inv_stock_balances" as never)
          .select("item_id,size_value,qty")
          .eq("location_type", "field_officer")
          .eq("location_id", meId);
        for (const b of (myBal ?? []) as Array<{ qty: number }>) {
          const q = Number(b.qty) || 0;
          if (q > 0) { myStockQty += q; myStockSkus += 1; }
        }
        if (guardIds.length) {
          const { data: bal } = await supabase
            .from("inv_stock_balances" as never)
            .select("location_type,location_id,qty")
            .in("location_type", ["guard", "security_guard", "field_officer"])
            .in("location_id", [meId, ...guardIds]);
          for (const b of (bal ?? []) as Array<{ location_id: string; qty: number }>) {
            const uid = guardIdToUnit.get(b.location_id) ?? UNASSIGNED;
            if (b.qty > 0) inventoryByUnit[uid] = (inventoryByUnit[uid] ?? 0) + 1;
          }
        }
      } catch { /* ignore */ }

      const guardsTotal = new Set(guardList.map((g) => g.id)).size;
      const outStats: typeof emptyStats = {
        guardsByUnit, coFoByUnit, pendingByUnit, demandsByUnit, inventoryByUnit,
        guardsTotal, joinedThisWeek, joinedLastWeek,
        attendanceRateToday: totalToday ? Math.round((presentToday / totalToday) * 100) : 0,
        attendanceRateYesterday: totalYday ? Math.round((presentYday / totalYday) * 100) : 0,
        pendingOnboardingTotal, pendingOnboardingLastWeek,
        openDemandsTotal: Object.values(demandsByUnit).reduce((s, n) => s + n, 0),
        inventoryItemsTotal: Object.values(inventoryByUnit).reduce((s, n) => s + n, 0),
        myStockQty, myStockSkus,
      };
      writeSnapshot(`fo-stats:${meId}`, outStats);
      return outStats;
    },
  });

  useEffect(() => {
    if (!phone) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["fo-base-v1", phone] });
      void queryClient.invalidateQueries({ queryKey: ["fo-stats-v1"] });
    };
    const channel = supabase
      .channel(dashboardChannelName(phone))
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_scope_assignments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidate_units" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "units" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [phone, queryClient]);

  const dashQ = baseQ;
  const isLoading = baseQ.isLoading;
  const stats = statsQ.data;
  const units = useMemo<UnitNode[]>(() => {
    const UNASSIGNED = "__unassigned__";
    const rows: UnitNode[] = baseUnits.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      customer_name: u.customer_name,
      is_primary: u.is_primary,
      guards: stats?.guardsByUnit[u.id] ?? [],
      co_field_officers: stats?.coFoByUnit[u.id] ?? [],
      pending_onboarding: stats?.pendingByUnit[u.id] ?? 0,
      open_demands: stats?.demandsByUnit[u.id] ?? 0,
      inventory_items: stats?.inventoryByUnit[u.id] ?? 0,
    }));
    const orphaned = stats?.guardsByUnit[UNASSIGNED] ?? [];
    const orphPending = stats?.pendingByUnit[UNASSIGNED] ?? 0;
    if (orphaned.length || orphPending) {
      rows.push({
        id: UNASSIGNED, code: "—", name: "Unassigned", customer_name: "Map these to a client",
        is_primary: false, guards: orphaned, co_field_officers: [], pending_onboarding: orphPending,
        open_demands: stats?.demandsByUnit[UNASSIGNED] ?? 0,
        inventory_items: stats?.inventoryByUnit[UNASSIGNED] ?? 0,
      });
    }
    return rows;
  }, [baseUnits, stats]);

  const data = useMemo(
    () => ({
      meId,
      units,
      guardsTotal: stats?.guardsTotal ?? 0,
      joinedThisWeek: stats?.joinedThisWeek ?? 0,
      joinedLastWeek: stats?.joinedLastWeek ?? 0,
      attendanceRateToday: stats?.attendanceRateToday ?? 0,
      attendanceRateYesterday: stats?.attendanceRateYesterday ?? 0,
      pendingOnboardingTotal: stats?.pendingOnboardingTotal ?? 0,
      pendingOnboardingLastWeek: stats?.pendingOnboardingLastWeek ?? 0,
      openDemandsTotal: stats?.openDemandsTotal ?? 0,
      inventoryItemsTotal: stats?.inventoryItemsTotal ?? 0,
      myStockQty: stats?.myStockQty ?? 0,
      myStockSkus: stats?.myStockSkus ?? 0,
    }),
    [meId, units, stats],
  );

  const pendingIssuanceQ = useQuery({
    queryKey: ["field-officer", "pending-issuance", userId],
    enabled: !!userId && (roleKey === "field_officer" || isSuperAdmin),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,assigned_asset_ids,onboarding_details")
        .eq("status", "approved")
        .eq("onboarding_details->>issuance_status", "pending")
        .eq("onboarding_details->>pending_issuance_fo_id", userId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((rows as unknown) as PendingIssuance[]) ?? [];
    },
  });

  const pendingIssuances = pendingIssuanceQ.data ?? [];
  const pendingAssetCount = pendingIssuances.reduce(
    (sum, row) => sum + (row.onboarding_details?.issuance_asset_ids?.length ?? row.assigned_asset_ids?.length ?? 0),
    0,
  );

  const rehireQ = useRehirePipeline({ mineOnly: true, requestedByCandidateId: data?.meId ?? null });
  const rehirePending = rehireQ.data?.pending ?? [];
  const rehireHint = rehirePending.length
    ? rehireHolderLabel(rehirePending[0], rehireQ.data?.steps ?? [], rehireQ.data?.roleName ?? new Map())
    : `${rehireQ.data?.completedCount ?? 0} completed`;

  const onbDelta = (data?.pendingOnboardingTotal ?? 0) - (data?.pendingOnboardingLastWeek ?? 0);
  const totalListings = data?.guardsTotal ?? 0;
  const attnPresent = Math.round(((data?.attendanceRateToday ?? 0) / 100) * totalListings);
  const totalItems = data?.myStockQty ?? 0;

  return (
    <DashboardShell rightExtras={<FoPeopleInsights />} fixedRightRail>
      <div className="space-y-4 sm:space-y-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4">
          <HeroStat label="Team" value={totalListings} icon={ShieldCheck} tone="blue" to="/admin/my-reportees" />
          <HeroStat label="Present" value={`${attnPresent} (${data?.attendanceRateToday ?? 0}%)`} icon={UserCheck} tone="mint" to="/admin/attendance" badge="Today" />
          <HeroStat label="Inventory" value={totalItems} icon={Warehouse} tone="violet" to="/admin/inventory" className="col-span-2 sm:col-span-1" />
        </div>

        <MarkAttendanceCard candidateId={data?.meId ?? null} />
        {data?.meId && <FieldSenseSummary candidateId={data.meId} />}

        {pendingIssuances.length > 0 && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 shadow-sm sm:rounded-3xl sm:p-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:flex">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Action required</div>
              <h2 className="mt-0.5 text-sm font-bold text-foreground sm:text-base">Issue assets to activate new guard</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {pendingIssuances[0]?.full_name || "New employee"}{pendingIssuances.length > 1 ? ` and ${pendingIssuances.length - 1} more` : ""} awaiting {pendingAssetCount} asset{pendingAssetCount === 1 ? "" : "s"}.
              </p>
            </div>
            <Button asChild size="sm" className="col-span-2 h-9 w-full shrink-0 rounded-full px-3 text-xs sm:w-auto">
              <Link to="/admin/inventory/issuances">Issue</Link>
            </Button>
          </div>
        </section>
        )}

        <section className="min-w-0">
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Overview</div>
              <h2 className="mt-1 text-xl font-bold text-foreground">My workspace</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            <PastelTile
              palette="rose"
              label="Pending onboarding"
              value={data?.pendingOnboardingTotal ?? 0}
              hint="vs last week"
              delta={onbDelta} deltaSuffix="" invertColor
              icon={ClipboardList}
              to="/admin/employees"
            />
            <PastelTile
              palette="violet"
              label="Pending rehire"
              value={rehirePending.length}
              hint={rehireHint}
              delta={0} deltaSuffix=""
              icon={UserCheck}
              to="/admin/employees"
              search={{ tab: "candidate" }}
            />
            <div className="col-span-2 grid grid-cols-1 overflow-hidden rounded-2xl border border-border/50 bg-[rgb(var(--tint-amber))] shadow-sm min-[390px]:grid-cols-2 sm:col-span-2">
              <UanFollowUp fieldOfficerUserId={userId} fieldOfficerCandidateId={data?.meId} compact className="rounded-none border-0 border-r border-border/50 bg-transparent shadow-none hover:bg-card/30 hover:shadow-none" />
              <ContractDesignationFollowUp fieldOfficer compact className="rounded-none border-0 bg-transparent shadow-none hover:bg-card/30 hover:shadow-none" />
            </div>
          </div>
        </section>

      <section className="overflow-hidden rounded-2xl border border-border/70 bg-[rgb(var(--tint-slate))] shadow-sm sm:rounded-3xl">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-foreground">My units</h2>
              <p className="text-[11px] text-muted-foreground">Open a unit to view its team</p>
            </div>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{units.length}</span>
        </div>
        <div className="divide-y divide-border/50">
          {isLoading ? <ListSkeleton rows={3} /> : dashQ.isError ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <div className="text-sm font-semibold text-foreground">Couldn’t load units</div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void dashQ.refetch()}>Retry</Button>
            </div>
          ) : units.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></div>
              <div className="text-sm font-semibold text-foreground">No units yet</div>
              <div className="text-xs text-muted-foreground">Ask HR to map your units.</div>
            </div>
          ) : units.map((u) => <UnitRow key={u.id} unit={u} allUnits={units} />)}
        </div>
      </section>
      </div>

    </DashboardShell>
  );
}

function FoPeopleInsights() {
  const { isLoading, birthdays, anniversaries } = usePeopleInsights();
  return (
    <div className="flex flex-col gap-4">
      <PeopleInsightsCard kind="birthdays" items={birthdays} isLoading={isLoading} />
      <PeopleInsightsCard kind="anniversaries" items={anniversaries} isLoading={isLoading} />
    </div>
  );
}

function FieldSenseSummary({ candidateId }: { candidateId: string }) {
  const todayStr = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const firstOfMonth = `${todayStr.slice(0, 8)}01`;

  const q = useQuery({
    queryKey: ["fo-dashboard-visits-v2", candidateId, todayStr],
    queryFn: async () => {
      const [monthVisitsRes, punchRes, trackRes, candRes, cuRes, esaRes, rpcRes] = await Promise.all([
        supabase
          .from("field_visits" as never)
          .select("id, unit_id, visit_date, visit_seq, customer_rating, check_in_at, check_out_at, visit_notes, client_name, client_signature_url, client_photo_url")
          .eq("candidate_id", candidateId)
          .gte("visit_date", firstOfMonth),
        supabase
          .from("self_attendance_punches" as never)
          .select("check_in_at, check_out_at")
          .eq("candidate_id", candidateId)
          .eq("punch_date", todayStr)
          .maybeSingle(),
        supabase
          .from("field_track_points" as never)
          .select("lat,lng,recorded_at")
          .eq("candidate_id", candidateId)
          .eq("track_date", todayStr)
          .order("recorded_at", { ascending: true }),
        supabase
          .from("candidates" as never)
          .select("unit_id")
          .eq("id", candidateId)
          .maybeSingle(),
        supabase.from("candidate_units").select("unit_id").eq("candidate_id", candidateId),
        supabase
          .from("employee_scope_assignments")
          .select("scope_id,scope_type")
          .eq("candidate_id", candidateId),
        supabase.rpc("current_user_unit_ids"),
      ]);

      // Resolve only this officer's units — never the whole unit table.
      const ids = new Set<string>();
      for (const id of (rpcRes.data ?? []) as string[]) ids.add(id);
      const candUnit = ((candRes.data as unknown) as { unit_id: string | null } | null)?.unit_id ?? null;
      if (candUnit) ids.add(candUnit);
      for (const r of (cuRes.data ?? []) as Array<{ unit_id: string }>) ids.add(r.unit_id);
      const esa = (esaRes.data ?? []) as Array<{ scope_id: string; scope_type: string }>;
      for (const s of esa) if (s.scope_type === "unit") ids.add(s.scope_id);
      const custScopeIds = esa.filter((s) => s.scope_type === "customer").map((s) => s.scope_id);
      if (custScopeIds.length) {
        const { data: orgUnits } = await supabase
          .from("units")
          .select("id")
          .in("customer_id", custScopeIds)
          .eq("is_billable", true);
        for (const r of (orgUnits ?? []) as Array<{ id: string }>) ids.add(r.id);
      }

      let scopedUnits: Array<{ id: string; name: string; customer_name: string }> = [];
      if (ids.size) {
        const { data: unitRows } = await supabase
          .from("units")
          .select("id,name,customer_id")
          .in("id", Array.from(ids));
        const rows = (unitRows ?? []) as Array<{ id: string; name: string; customer_id: string | null }>;
        const custIds = Array.from(new Set(rows.map((u) => u.customer_id).filter(Boolean))) as string[];
        const custMap = new Map<string, string>();
        if (custIds.length) {
          const { data: custs } = await supabase.from("customers").select("id,name").in("id", custIds);
          for (const c of (custs ?? []) as Array<{ id: string; name: string }>) custMap.set(c.id, c.name);
        }
        scopedUnits = rows.map((u) => ({
          id: u.id,
          name: u.name,
          customer_name: (u.customer_id && custMap.get(u.customer_id)) || u.name,
        }));
      }

      return {
        visits: (monthVisitsRes.data ?? []) as Array<{
          id: string;
          unit_id: string;
          visit_date: string;
          visit_seq: number;
          customer_rating: number | null;
          check_in_at: string;
          check_out_at: string | null;
          visit_notes: string | null;
          client_name: string | null;
          client_signature_url: string | null;
          client_photo_url: string | null;
        }>,
        punch: (punchRes.data as { check_in_at: string | null; check_out_at: string | null } | null) ?? null,
        track: ((trackRes.data as unknown) as Array<{ lat: number; lng: number }>) ?? [],
        scopedUnits,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const scopedUnits = useMemo(() => q.data?.scopedUnits ?? [], [q.data?.scopedUnits]);

  const visits = q.data?.visits ?? [];
  const todayVisits = visits.filter((visit) => visit.visit_date === todayStr);
  const openVisit = todayVisits.find((visit) => !visit.check_out_at) ?? null;
  const completedToday = todayVisits.filter((visit) => visit.check_out_at).length;
  const completedTodayVisits = todayVisits
    .filter((visit) => visit.check_out_at)
    .sort((a, b) => new Date(b.check_out_at ?? b.check_in_at).getTime() - new Date(a.check_out_at ?? a.check_in_at).getTime());
  const isOnDuty = !!q.data?.punch?.check_in_at && !q.data?.punch?.check_out_at;
  const nextVisitNumber = completedToday + 1;
  const monthCount = visits.length;
  const rated = visits.filter((v) => v.customer_rating != null);
  const avgRating = rated.length
    ? rated.reduce((s, v) => s + (v.customer_rating ?? 0), 0) / rated.length
    : 0;

  // Hours today
  const hoursLabel = (() => {
    const p = q.data?.punch;
    if (!p?.check_in_at) return "—";
    const start = new Date(p.check_in_at).getTime();
    const end = p.check_out_at ? new Date(p.check_out_at).getTime() : Date.now();
    const mins = Math.max(0, Math.round((end - start) / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  })();
  // Km traveled today
  const kmLabel = (() => {
    const pts = q.data?.track ?? [];
    if (pts.length < 2) return "0.00";
    const toRad = (x: number) => (x * Math.PI) / 180;
    let m = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const dLat = toRad(Number(b.lat) - Number(a.lat));
      const dLng = toRad(Number(b.lng) - Number(a.lng));
      const lat1 = toRad(Number(a.lat));
      const lat2 = toRad(Number(b.lat));
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      m += 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return (m / 1000).toFixed(2);
  })();

  const monthLink = { to: "/admin/field-sense", search: { range: "this_month" } } as const;
  const formatVisitTime = (value: string | null) => value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
  const visitDuration = (checkIn: string, checkOut: string | null) => {
    if (!checkOut) return "In progress";
    const minutes = Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  };

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Field work</div>
          <h2 className="mt-1 font-display text-lg font-bold text-foreground">My client visits</h2>
        </div>
        <Link to="/admin/field-sense" className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline">
          Open Radar →
        </Link>
      </div>

      {openVisit ? (
        <Link to="/admin/field-sense" search={{ range: "today", action: "complete-visit" } as never} className="mb-3 flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 shadow-sm transition hover:border-amber-500/50">
          <div className="min-w-0"><div className="text-sm font-bold text-foreground">Complete visit #{openVisit.visit_seq}</div><div className="mt-0.5 text-xs text-muted-foreground">Add notes, rating, signature and client photo.</div></div>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
        </Link>
      ) : isOnDuty ? (
        <Link to="/admin/field-sense" search={{ range: "today", action: "start-visit" } as never} className="mb-3 flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 shadow-sm transition hover:border-primary/45 hover:bg-primary/10">
          <div className="min-w-0"><div className="text-sm font-bold text-foreground">Start your {nextVisitNumber === 1 ? "first" : "next"} site visit</div><div className="mt-0.5 text-xs text-muted-foreground">Choose a client unit and confirm your GPS location.</div></div>
          <RouteIcon className="h-5 w-5 shrink-0 text-primary" />
        </Link>
      ) : (
        <div className="mb-3 flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 opacity-75">
          <div className="min-w-0"><div className="text-sm font-bold text-foreground">Log in to start client visits</div><div className="mt-0.5 text-xs text-muted-foreground">My Client Visits unlocks after today’s attendance login.</div></div>
          <RouteIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
      )}

      {completedTodayVisits.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Today's visit history</div>
            <Link to="/admin/field-sense" search={{ range: "today" }} className="text-[10px] font-semibold text-primary hover:underline">
              View in Radar
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {completedTodayVisits.map((visit) => {
              const unit = scopedUnits.find((row) => row.id === visit.unit_id);
              return (
                <article
                  key={visit.id}
                  className="px-3 py-3"
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Flag className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-foreground">Visit #{visit.visit_seq} · {unit?.name ?? "Client site"}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{unit?.customer_name ?? unit?.name ?? "Client"}</div>
                    </div>
                    <Link to="/admin/field-sense" search={{ range: "today" }} aria-label={`Open visit ${visit.visit_seq} in Radar`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-primary"><ChevronRight className="h-4 w-4" /></Link>
                  </div>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-secondary/40 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold tabular-nums text-foreground"><Clock className="h-3 w-3 shrink-0 text-muted-foreground" />{formatVisitTime(visit.check_in_at)} → {formatVisitTime(visit.check_out_at)}</div>
                    <div className="text-[10px] text-muted-foreground">{visitDuration(visit.check_in_at, visit.check_out_at)}</div>
                  </div>
                  {(visit.client_name || visit.visit_notes) && <div className="mt-2 space-y-1.5 text-[11px]">
                    {visit.client_name && <div><span className="font-semibold text-foreground">Met:</span> <span className="text-muted-foreground">{visit.client_name}</span></div>}
                    {visit.visit_notes && <p className="rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 leading-relaxed text-muted-foreground">“{visit.visit_notes}”</p>}
                  </div>}
                  {visit.customer_rating != null && <div className="mt-2 flex items-center gap-1" aria-label={`${visit.customer_rating} out of 5 stars`}>
                    {Array.from({ length: 5 }, (_, index) => <span key={index} className={index < Number(visit.customer_rating) ? "text-amber-500" : "text-muted-foreground/30"}>★</span>)}
                    <span className="ml-1 text-[10px] font-semibold text-muted-foreground">{visit.customer_rating}/5</span>
                  </div>}
                  <VisitProofs visitId={visit.id} signaturePath={visit.client_signature_url} photoPath={visit.client_photo_url} />
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Today strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          to="/admin/field-sense"
          search={{ range: "today" }}
          className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm ring-1 ring-sky-200/50 dark:ring-sky-400/15"
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Hours today</div>
          <div className="mt-1 font-display text-base font-bold tabular-nums leading-none text-foreground sm:text-lg">{hoursLabel}</div>
        </Link>
        <Link
          to="/admin/field-sense"
          search={{ range: "today" }}
          className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm ring-1 ring-violet-200/50 dark:ring-violet-400/15"
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Km today</div>
          <div className="mt-1 font-display text-base font-bold tabular-nums leading-none text-foreground sm:text-lg">{kmLabel}</div>
        </Link>
        <Link
          {...monthLink}
          className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm ring-1 ring-emerald-200/50 dark:ring-emerald-400/15"
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Visits (mo)</div>
          <div className="mt-1 font-display text-base font-bold tabular-nums leading-none text-foreground sm:text-lg">{monthCount}</div>
        </Link>
        <Link
          {...monthLink}
          className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm ring-1 ring-amber-200/50 dark:ring-amber-400/15"
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Rating (mo)</div>
          <div className="mt-1 inline-flex items-baseline gap-1 font-display text-base font-bold tabular-nums leading-none text-foreground sm:text-lg">
            {rated.length ? avgRating.toFixed(1) : "—"}
            {rated.length ? <span className="text-amber-500">★</span> : null}
            {rated.length ? <span className="text-[9px] font-medium text-muted-foreground">·{rated.length}</span> : null}
          </div>
        </Link>
      </div>

    </section>
  );
}




function StatBar({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary/60 px-2 py-2 text-center sm:rounded-xl sm:px-3 sm:py-3">
      <div className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px]">{label}</div>
      <div className="mt-0.5 font-display text-base font-bold tabular-nums leading-tight tracking-tight text-foreground sm:text-2xl">{value}</div>
    </div>
  );
}

function HeroStat({ label, value, icon: Icon, tone, to, badge, className }: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; tone: "blue" | "mint" | "violet"; to: string; badge?: string; className?: string }) {
  const surface = {
    blue: "bg-[rgb(var(--tint-blue))]",
    mint: "bg-[rgb(var(--tint-emerald))]",
    violet: "bg-[rgb(var(--tint-violet))]",
  }[tone];
  return (
    <Link to={to} className={cn("group relative flex min-h-[108px] min-w-0 flex-col justify-between rounded-xl border border-border/60 p-3.5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-sm sm:min-h-[140px] sm:rounded-2xl sm:p-5", surface, className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-card/80 text-primary shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        {badge ? <span className="rounded-full bg-card/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary shadow-sm">{badge}</span> : null}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap text-lg font-medium tabular-nums leading-none text-foreground sm:text-3xl">{value}</span>
      </div>
      {!badge ? <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-primary opacity-0 transition group-hover:opacity-100" /> : null}
    </Link>
  );
}



function PastelTile({
  palette, label, value, hint, delta, deltaSuffix, invertColor, icon: Icon, to, search, className,
}: {
  palette: "lime" | "teal" | "rose" | "amber" | "violet";
  label: string; value: number | string; hint: string;
  delta: number; deltaSuffix: string; invertColor?: boolean;
  icon: React.ComponentType<{ className?: string }>; to?: string; search?: Record<string, unknown>; className?: string;
}) {
  const iconTone = palette === "rose" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  const surface = {
    lime: "bg-[rgb(var(--tint-amber))]",
    teal: "bg-[rgb(var(--tint-sky))]",
    rose: "bg-[rgb(var(--tint-rose))]",
    amber: "bg-[rgb(var(--tint-indigo))]",
    violet: "bg-[rgb(var(--tint-violet))]",
  }[palette];

  const positive = invertColor ? delta < 0 : delta > 0;
  const negative = invertColor ? delta > 0 : delta < 0;
  const TrendIcon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const trendCls = delta === 0
    ? "bg-card/70 text-foreground/60"
    : positive ? "bg-card/85 text-emerald-700 dark:text-emerald-300"
    : negative ? "bg-card/85 text-rose-700 dark:text-rose-300"
    : "bg-card/70 text-foreground/60";


  const inner = (
    <div className={cn("relative flex h-full min-h-[104px] min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-border/50 p-3.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-primary/30 hover:shadow-md", surface)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-tight text-foreground sm:text-[13px]">{label}</div>
          <div className="mt-1 line-clamp-1 text-[10px] text-muted-foreground sm:text-[11px]">{hint}</div>
        </div>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", iconTone)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-[25px] font-bold leading-none tabular-nums text-foreground">
          {value}
        </div>
        <div className="flex flex-col items-end gap-1 sm:gap-1.5">
          {delta !== 0 && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${trendCls}`}>
              <TrendIcon className="h-3 w-3" />
              {delta > 0 ? "+" : ""}{delta}{deltaSuffix}
            </span>
          )}
          {to && <ArrowUpRight className="h-4 w-4 text-primary" />}
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to} search={search as never} className={cn("block", className)}>{inner}</Link> : <div className={className}>{inner}</div>;
}

function UnitRow({ unit, allUnits }: { unit: UnitNode; allUnits: UnitNode[] }) {
  const [open, setOpen] = useState(false);
  const [manageGuard, setManageGuard] = useState<Guard | null>(null);
  const total = unit.guards.length;
  const assignableUnits = allUnits.filter((u) => u.id !== "__unassigned__");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-secondary/40 sm:px-4"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
              {unit.name}
              {unit.is_primary && (
                <span className="inline-flex rounded-full bg-emerald-500/15 dark:bg-emerald-400/20 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Primary</span>
              )}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{unit.customer_name} · <span className="font-mono">{unit.code}</span></div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {total} team
        </span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-border/40 bg-secondary/20 px-3.5 py-3 sm:px-4">
          {unit.co_field_officers.length > 0 && (
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                <UserCog className="h-3 w-3" /> Also on this unit ({unit.co_field_officers.length})
              </div>
              <ul className="space-y-0.5">
                {unit.co_field_officers.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-[12px]">
                    <span className="font-medium text-foreground">{f.full_name}</span>
                    {f.employee_code && (
                      <span className="font-mono text-[10px] text-muted-foreground">{f.employee_code}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unit.guards.length === 0 ? (
            <div className="py-1 text-[12px] text-muted-foreground">No active employees on this unit yet.</div>
          ) : (
            <ul className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50 bg-card">
              {unit.guards.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{g.full_name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {g.employee_code ? `${g.employee_code} · ` : ""}{g.designation}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 rounded-full px-2 text-[11px]"
                    onClick={() => setManageGuard(g)}
                  >
                    <MoveRight className="h-3 w-3" /> Manage
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ManageGuardUnitsDialog
        key={manageGuard?.id ?? "closed"}
        guard={manageGuard}
        currentUnitId={unit.id}
        assignableUnits={assignableUnits}
        onClose={() => setManageGuard(null)}
      />
    </div>
  );
}

function ManageGuardUnitsDialog({
  guard,
  currentUnitId,
  assignableUnits,
  onClose,
}: {
  guard: Guard | null;
  currentUnitId: string;
  assignableUnits: UnitNode[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [initialPrimary, setInitialPrimary] = useState<string | null>(null);
  const [desigByUnit, setDesigByUnit] = useState<Record<string, string | null>>({});
  const [initialDesig, setInitialDesig] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = !!guard;

  useEffect(() => {
    if (!guard) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [{ data, error }, candRes] = await Promise.all([
        supabase
          .from("candidate_units")
          .select("unit_id,is_primary,designation_id")
          .eq("candidate_id", guard.id),
        supabase.from("candidates").select("unit_id").eq("id", guard.id).maybeSingle(),
      ]);
      if (cancel) return;
      if (error) {
        toast.error(error.message || "Failed to load client mappings");
      }
      const rows = (data ?? []) as Array<{ unit_id: string; is_primary: boolean | null; designation_id: string | null }>;
      const ids = new Set<string>(rows.map((r) => r.unit_id));
      const homeUnit = (candRes.data as { unit_id?: string | null } | null)?.unit_id ?? null;
      // Only fall back to the legacy candidates.unit_id / roster unit when the
      // guard has no candidate_units rows at all. Never force the roster unit
      // back in — that made un-ticking a unit look like it never saved.
      if (ids.size === 0) {
        if (homeUnit) ids.add(homeUnit);
        else ids.add(currentUnitId);
      }
      const pri =
        rows.find((r) => r.is_primary)?.unit_id ??
        (homeUnit && ids.has(homeUnit) ? homeUnit : null) ??
        (ids.size === 1 ? [...ids][0] : null);
      const desig: Record<string, string | null> = {};
      for (const r of rows) desig[r.unit_id] = r.designation_id ?? null;
      setSelected(new Set(ids));
      setInitial(new Set(ids));
      setPrimaryId(pri);
      setInitialPrimary(pri);
      setDesigByUnit(desig);
      setInitialDesig(desig);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [guard, currentUnitId]);


  const toggle = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    setPrimaryId((p) => (p === uid ? null : p));
  };

  /** Completely unmaps the guard — removes every unit, including the primary. */
  const removeFromAllUnits = async () => {
    if (!guard) return;
    const ok = window.confirm(
      `Remove ${guard.full_name} from every client? They will no longer appear on any roster or attendance sheet until they are mapped again.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("candidate_units")
        .delete()
        .eq("candidate_id", guard.id);
      if (error) throw error;
      const { error: homeErr } = await supabase
        .from("candidates")
        .update({ unit_id: null, designation_id: null, reports_to: null })
        .eq("id", guard.id);
      if (homeErr && !homeErr.message.toLowerCase().includes("row-level security")) throw homeErr;
      toast.success(`${guard.full_name} removed from all clients`);
      await qc.invalidateQueries({ queryKey: ["field-officer-dashboard-v4"] });
      await qc.invalidateQueries({ queryKey: ["my-reportees"] });
      await qc.invalidateQueries({ queryKey: ["admin", "unmapped-guards"] });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to remove the guard from their clients";
      toast.error(msg.includes("row-level security") ? "You don't have permission to remove this guard." : msg);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!guard) return;
    if (selected.size === 0) {
      toast.error('No client ticked — use "Remove from all clients" if this guard should be unmapped.');
      return;
    }
    if (!primaryId || !selected.has(primaryId)) {
      toast.error("Pick a primary client — that is where attendance and the work order are issued.");
      return;
    }
    const missingDesig = [...selected].filter((u) => !desigByUnit[u]);
    if (missingDesig.length) {
      toast.error("Pick the designation this guard fills at every ticked client — attendance and salary follow that designation.");
      return;
    }
    const toAdd = [...selected].filter((u) => !initial.has(u));
    const toRemove = [...initial].filter((u) => !selected.has(u));
    const primaryChanged = primaryId !== initialPrimary;
    const desigChanged = [...selected].filter(
      (u) => initial.has(u) && (initialDesig[u] ?? null) !== (desigByUnit[u] ?? null),
    );
    if (toAdd.length === 0 && toRemove.length === 0 && !primaryChanged && desigChanged.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (toAdd.length) {
        const rows = toAdd.map((unit_id) => ({
          candidate_id: guard.id,
          unit_id,
          is_primary: false,
          designation_id: desigByUnit[unit_id] ?? null,
        }));
        const { data: inserted, error } = await supabase
          .from("candidate_units")
          .insert(rows)
          .select("unit_id");
        if (error) throw error;
        if ((inserted ?? []).length !== rows.length) {
          throw new Error("You don't have permission to map this guard to one of those clients.");

        }
      }
      if (toRemove.length) {
        const { data: removed, error } = await supabase
          .from("candidate_units")
          .delete()
          .eq("candidate_id", guard.id)
          .in("unit_id", toRemove)
          .select("unit_id");
        if (error) throw error;
        if ((removed ?? []).length === 0) {
          throw new Error("Could not remove the unticked unit(s) — you may not have permission.");
        }
      }
      if (primaryChanged) {
        // The DB trigger enforces a single primary, so set the new one first and
        // then clear any stragglers.
        const { data: promoted, error: setErr } = await supabase
          .from("candidate_units")
          .update({ is_primary: true })
          .eq("candidate_id", guard.id)
          .eq("unit_id", primaryId)
          .select("unit_id");
        if (setErr) throw setErr;
        if ((promoted ?? []).length === 0) {
          throw new Error("Could not set the primary client — you may not have permission.");
        }
        const { error: clearErr } = await supabase
          .from("candidate_units")
          .update({ is_primary: false })
          .eq("candidate_id", guard.id)
          .neq("unit_id", primaryId);
        if (clearErr) throw clearErr;
      }

      for (const unitId of desigChanged) {
        const { error: dErr } = await supabase
          .from("candidate_units")
          .update({ designation_id: desigByUnit[unitId] ?? null })
          .eq("candidate_id", guard.id)
          .eq("unit_id", unitId);
        if (dErr) throw dErr;
      }

      // Keep the legacy home unit in sync so rosters, attendance and dashboards
      // follow the primary unit. The candidate's master designation mirrors the
      // designation they fill at the primary unit (salary + payroll-day cap).
      const { error: homeErr } = await supabase
        .from("candidates")
        .update({ unit_id: primaryId, designation_id: desigByUnit[primaryId] ?? null })
        .eq("id", guard.id);
      if (homeErr && !homeErr.message.toLowerCase().includes("row-level security")) throw homeErr;


      toast.success(`Updated ${guard.full_name}'s unit mapping`);
      if (primaryChanged) {
        const r = await autoIssuePostingOrder({ candidateId: guard.id, unitId: primaryId });
        if (r.sent) toast.success(`Work order emailed to ${r.to}`);
        else toast.warning(`Work order not sent — ${r.reason}`);
      }
      await qc.invalidateQueries({ queryKey: ["field-officer-dashboard-v4"] });
      await qc.invalidateQueries({ queryKey: ["my-reportees"] });
      await qc.invalidateQueries({ queryKey: ["admin", "unmapped-guards"] });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update unit mapping";
      toast.error(msg.includes("row-level security") ? "You don't have permission to change this guard's units." : msg);
    } finally {
      setSaving(false);
    }
  };



  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage units</DialogTitle>
          <DialogDescription>
            {guard ? (
              <>Tick every unit <span className="font-semibold text-foreground">{guard.full_name}{guard.employee_code ? ` (${guard.employee_code})` : ""}</span> should cover, then mark one as <span className="font-semibold text-foreground">Primary</span>. Attendance and the work order go to the primary unit; every other unit is a reliever unit for extra duty (ED) only.</>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading current mapping…
          </div>
        ) : (
          <>
            {selected.size > 0 && !primaryId && (
              <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20">
                No primary unit selected — pick one before saving.
              </div>
            )}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {assignableUnits.map((u) => {
              const checked = selected.has(u.id);
              const isPrimary = primaryId === u.id;
              return (
                <div
                  key={u.id}
                  className={`rounded-xl border px-3 py-2.5 transition ${checked ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/60 hover:bg-muted/50"}`}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(u.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{u.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {u.customer_name} · <span className="font-mono">{u.code}</span>
                      </div>
                    </div>
                  </label>
                  {checked && (
                    <div className="mt-2 ml-7 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPrimaryId(u.id)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                            isPrimary
                              ? "bg-emerald-600 text-white"
                              : "bg-secondary text-muted-foreground ring-1 ring-border hover:bg-secondary/70"
                          }`}
                        >
                          {isPrimary ? "Primary unit" : "Set as primary"}
                        </button>
                        {!isPrimary && (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
                            Reliever · ED only
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Designation at this unit {isPrimary ? "(drives salary & attendance)" : "(ED billing rate)"}
                        </p>
                        <UnitDesignationSelect
                          unitId={u.id}
                          value={desigByUnit[u.id] ?? null}
                          onChange={(id) => setDesigByUnit((prev) => ({ ...prev, [u.id]: id }))}
                        />
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
          </>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={removeFromAllUnits}
            disabled={saving || loading}
            data-force-enabled="true"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Remove from all units
          </Button>
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || loading}
            data-force-enabled="true"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save mapping
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pill({ tone, value, label }: { tone: "slate" | "amber" | "violet" | "cyan"; value: number; label: string }) {
  const toneCls = {
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-500/15 dark:bg-amber-400/20 text-amber-700 dark:text-amber-300",
    violet: "bg-violet-100 text-violet-700",
    cyan: "bg-cyan-100 text-cyan-700",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${toneCls}`}>
      <span className="tabular-nums font-semibold">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}
