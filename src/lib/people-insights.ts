import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { useFieldOfficerUnitScope } from "@/lib/use-fo-unit-scope";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { useUserBranchScope } from "@/lib/use-user-branch-scope";

export type InsightPerson = {
  id: string;
  full_name: string;
  photo_url: string | null;
  mobile: string | null;
  date_of_birth: string | null;
  approved_at: string | null;
  created_at: string | null;
  unit_id: string | null;
  unit_name?: string;
  designation_id: string | null;
  designation_name?: string;
};

export type BirthdayEntry = InsightPerson & { daysUntil: number; nextDate: Date; turningAge: number };
export type AnniversaryEntry = InsightPerson & { daysUntil: number; nextDate: Date; years: number };
export type SixtyPlusEntry = InsightPerson & { age: number };

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function ageFrom(dob: string): number {
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** Next occurrence of the month/day of `date` on or after today. */
export function nextOccurrence(date: string): { next: Date; days: number } {
  const d = new Date(date);
  const today = startOfDay(new Date());
  let candidate = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (candidate < today) candidate = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  const days = Math.round((candidate.getTime() - today.getTime()) / 86400000);
  return { next: candidate, days };
}

export function yearsBetween(from: string, to: Date): number {
  const f = new Date(from);
  let years = to.getFullYear() - f.getFullYear();
  const m = to.getMonth() - f.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < f.getDate())) years--;
  return Math.max(0, years);
}


type InsightsPayload = {
  birthdays?: Array<Omit<BirthdayEntry, "nextDate"> & { nextDate: string }>;
  anniversaries?: Array<Omit<AnniversaryEntry, "nextDate"> & { nextDate: string }>;
  sixtyPlus?: SixtyPlusEntry[];
};

export function usePeopleInsights(options?: { roleKeys?: readonly string[] }) {
  const { isSuperAdmin, roleKey, isFieldOfficer, isBranchManager } = useCurrentUserRole();
  const foScope = useFieldOfficerUnitScope();
  const branchScope = useUserBranchScope();
  const managerScope = useManagerFieldOfficerScope();
  // Operations leaders only follow their own chain: field officers and the
  // managers they report to.
  const roleKeys = options?.roleKeys ? Array.from(options.roleKeys) : null;

  const canAll = isSuperAdmin || roleKey === "leadership" || roleKey === "hr" || roleKey === "admin";
  const showSixtyPlus = isSuperAdmin || roleKey === "leadership";
  // Managers with field officers under them stay inside that chain.
  const managerUnitIds = managerScope.isScoped ? Array.from<string>(managerScope.unitIds) : null;

  const enabled =
    isBranchManager
      ? !branchScope.isLoading
      : isFieldOfficer
        ? !foScope.isLoading
        : !managerScope.isLoading;

  const q = useQuery({
    queryKey: [
      "people-insights",
      {
        canAll,
        isBranchManager,
        isFieldOfficer,
        showSixtyPlus,
        foUnits: Array.from(foScope.unitIds),
        managerUnits: managerUnitIds,
        branch: branchScope.branchId,
        roleKeys,
      },
    ],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<InsightsPayload> => {
      // Scope: field officers to their mapped units, managers to the units of
      // the field officers reporting to them, branch managers without field
      // officers to their branch. Everyone else relies on row level security.
      let unitIds: string[] | null = null;
      if (!canAll || managerUnitIds) {
        if (isFieldOfficer) {
          unitIds = Array.from<string>(foScope.unitIds);
          if (unitIds.length === 0) return {};
        } else if (managerUnitIds) {
          unitIds = managerUnitIds;
          if (unitIds.length === 0) return {};
        } else if (isBranchManager) {
          const branchId = branchScope.branchId;
          if (!branchId) return {};
          const { data: unitsInBranch } = await supabase
            .from("units")
            .select("id")
            .eq("branch_id", branchId);
          unitIds = (((unitsInBranch as unknown) as Array<{ id: string }>) ?? []).map((u) => u.id);
          if (unitIds.length === 0) return {};
        }
      }


      // The whole rolling-12-month computation happens in the database: the
      // browser only ever receives the upcoming entries, never the roster.
      const { data, error } = await supabase.rpc("people_insights" as never, {
        p_unit_ids: unitIds,
        p_days: 366,
        p_sixty: showSixtyPlus,
        p_limit: 200,
        p_role_keys: roleKeys,
      } as never);
      if (error) {
        if (error.code === "PGRST202") return {};
        throw error;
      }
      return ((data ?? {}) as unknown) as InsightsPayload;
    },
  });

  const derived = useMemo(() => {
    const birthdays: BirthdayEntry[] = (q.data?.birthdays ?? []).map((b) => ({
      ...b,
      nextDate: new Date(b.nextDate),
    }));
    const anniversaries: AnniversaryEntry[] = (q.data?.anniversaries ?? []).map((a) => ({
      ...a,
      nextDate: new Date(a.nextDate),
    }));
    const sixtyPlus: SixtyPlusEntry[] = q.data?.sixtyPlus ?? [];
    return { birthdays, anniversaries, sixtyPlus };
  }, [q.data]);

  return {
    isLoading: q.isLoading,
    showSixtyPlus,
    birthdays: derived.birthdays,
    anniversaries: derived.anniversaries,
    sixtyPlus: derived.sixtyPlus,
  };
}
