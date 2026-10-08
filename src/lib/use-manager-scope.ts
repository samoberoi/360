import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ROLE_KEYS } from "@/lib/role-keys";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { useFieldOfficerUnitScope } from "@/lib/use-fo-unit-scope";

/** Reporting chains are shallow; this cap only guards against cyclic data. */
const MAX_DEPTH = 8;
const CHUNK = 200;

type PersonRow = {
  id: string;
  role_key: string | null;
  status: string | null;
  is_enabled: boolean | null;
};

export type ManagerFieldOfficerScope = {
  isLoading: boolean;
  /** True when the signed-in user has field officers reporting to them. */
  isScoped: boolean;
  candidateId: string | null;
  /** Field officers anywhere below the signed-in user in the reporting chain. */
  fieldOfficerIds: Set<string>;
  /** Active staff of every role below the signed-in manager. */
  teamMemberIds: Set<string>;
  /** Billable client units those field officers cover. */
  unitIds: Set<string>;
  /** Organizations owning those units. */
  customerIds: Set<string>;
};

function chunked<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function loadSubtree(managerId: string) {
  const fieldOfficerIds = new Set<string>();
  const teamMemberIds = new Set<string>();
  const visited = new Set<string>([managerId]);
  let frontier = [managerId];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const [direct, extra] = await Promise.all([
      supabase.from("candidates").select("id").in("reports_to", frontier).limit(5000),
      supabase
        .from("candidate_reporting_managers")
        .select("candidate_id")
        .in("manager_id", frontier)
        .limit(5000),
    ]);
    if (direct.error) throw direct.error;
    if (extra.error) throw extra.error;

    const ids: string[] = [];
    for (const row of ((direct.data ?? []) as Array<{ id: string }>)) {
      if (!visited.has(row.id)) {
        visited.add(row.id);
        ids.push(row.id);
      }
    }
    for (const row of ((extra.data ?? []) as Array<{ candidate_id: string }>)) {
      if (row.candidate_id && !visited.has(row.candidate_id)) {
        visited.add(row.candidate_id);
        ids.push(row.candidate_id);
      }
    }
    if (ids.length === 0) break;

    const people: PersonRow[] = [];
    for (const part of chunked(ids)) {
      const { data, error } = await supabase
        .from("candidates")
        .select("id,role_key,status,is_enabled")
        .in("id", part);
      if (error) throw error;
      people.push(...(((data ?? []) as unknown) as PersonRow[]));
    }

    const usable = (p: PersonRow) =>
      p.is_enabled !== false && (p.status === "active" || p.status === "approved");
    for (const p of people) {
      if (usable(p)) teamMemberIds.add(p.id);
      if (p.role_key === ROLE_KEYS.FIELD_OFFICER && usable(p)) fieldOfficerIds.add(p.id);
    }
    // Guards never manage anyone, so stopping there keeps the walk small.
    frontier = people
      .filter((p) => p.role_key !== ROLE_KEYS.GUARD && p.role_key !== ROLE_KEYS.SECURITY_GUARD)
      .map((p) => p.id);
  }

  return { fieldOfficerIds, teamMemberIds };
}

async function loadUnitsForOfficers(officerIds: string[]) {
  if (officerIds.length === 0) return { unitIds: [] as string[], customerIds: [] as string[] };
  const candidateUnitIds = new Set<string>();

  for (const part of chunked(officerIds)) {
    const [mapped, home] = await Promise.all([
      supabase.from("candidate_units").select("unit_id").in("candidate_id", part).limit(5000),
      supabase.from("candidates").select("unit_id").in("id", part),
    ]);
    if (mapped.error) throw mapped.error;
    if (home.error) throw home.error;
    for (const row of ((mapped.data ?? []) as Array<{ unit_id: string | null }>)) {
      if (row.unit_id) candidateUnitIds.add(row.unit_id);
    }
    for (const row of ((home.data ?? []) as Array<{ unit_id: string | null }>)) {
      if (row.unit_id) candidateUnitIds.add(row.unit_id);
    }
  }

  // Radiant's own non-billable offices are payroll homes, not work sites.
  const unitIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const part of chunked([...candidateUnitIds])) {
    const { data, error } = await supabase
      .from("units")
      .select("id,is_billable,customer_id")
      .in("id", part);
    if (error) throw error;
    for (const row of ((data ?? []) as unknown as Array<{
      id: string;
      is_billable: boolean | null;
      customer_id: string | null;
    }>)) {
      if (row.is_billable === false) continue;
      unitIds.add(row.id);
      if (row.customer_id) customerIds.add(row.customer_id);
    }
  }
  return { unitIds: [...unitIds], customerIds: [...customerIds] };
}

/**
 * Cumulative scope for a manager: every field officer below them in the
 * reporting chain plus the client units those officers cover. Super admins and
 * field officers themselves are never scoped here (field officers use
 * `useFieldOfficerUnitScope`), and a manager with no field officer reportees
 * keeps their existing row-level-security reach.
 */
export function useManagerFieldOfficerScope(): ManagerFieldOfficerScope {
  const { candidateId, isSuperAdmin, isFieldOfficer, isLoading: roleLoading } = useCurrentUserRole();
  const enabled = !!candidateId && !isSuperAdmin && !isFieldOfficer;

  const q = useQuery({
    queryKey: ["manager-fo-scope", candidateId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!candidateId) throw new Error("Employee profile unavailable.");
      const { fieldOfficerIds, teamMemberIds } = await loadSubtree(candidateId);
      const { unitIds, customerIds } = await loadUnitsForOfficers([...fieldOfficerIds]);
      return { fieldOfficerIds: [...fieldOfficerIds], teamMemberIds: [...teamMemberIds], unitIds, customerIds };
    },
  });

  const fieldOfficerIds = useMemo(() => new Set(q.data?.fieldOfficerIds ?? []), [q.data]);
  const teamMemberIds = useMemo(() => new Set(q.data?.teamMemberIds ?? []), [q.data]);
  const unitIds = useMemo(() => new Set(q.data?.unitIds ?? []), [q.data]);
  const customerIds = useMemo(() => new Set(q.data?.customerIds ?? []), [q.data]);

  return {
    isLoading: roleLoading || (enabled && q.isLoading),
    isScoped: enabled && fieldOfficerIds.size > 0,
    candidateId,
    fieldOfficerIds,
    teamMemberIds,
    unitIds,
    customerIds,
  };
}

/**
 * Unit scope for list screens: a field officer's own units, or — for a manager
 * with field officers reporting to them — the units their officers cover.
 * `isScoped` false means the screen keeps its company-wide reach.
 */
export function useOperationalUnitScope(): {
  isLoading: boolean;
  isScoped: boolean;
  unitIds: Set<string>;
  customerIds: Set<string>;
} {
  const foScope = useFieldOfficerUnitScope();
  const managerScope = useManagerFieldOfficerScope();
  if (foScope.isFieldOfficer) {
    return {
      isLoading: foScope.isLoading,
      isScoped: true,
      unitIds: foScope.unitIds,
      customerIds: foScope.customerIds,
    };
  }
  return {
    isLoading: managerScope.isLoading,
    isScoped: managerScope.isScoped,
    unitIds: managerScope.unitIds,
    customerIds: managerScope.customerIds,
  };
}
