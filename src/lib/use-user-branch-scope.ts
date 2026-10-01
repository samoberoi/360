import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";

export type UserBranchScope = {
  isLoading: boolean;
  isScoped: boolean; // true if the current user is locked to a single branch
  branchId: string | null; // the branch UUID they are scoped to
  branchLabel: string; // human label, e.g. "BR2 – BANGALORE"
};

/**
 * Returns the branch scope for the current logged-in user.
 * - Super admin: not scoped (sees everything).
 * - Users with a `branch` row in `employee_scope_assignments`: scoped to that branch.
 * - Field officers / branch managers / guards without a direct branch row:
 *   derived from any `unit` scope row via units.branch_id.
 * - Everyone else: not scoped.
 */
export function useUserBranchScope(): UserBranchScope {
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(phone);

  const q = useQuery({
    queryKey: ["user-branch-scope", phone],
    enabled: !!phone && !isSuperAdmin,
    queryFn: async () => {
      const { data: cand, error: cErr } = await supabase
        .from("candidates")
        .select("id,role_key")
        .eq("mobile", phone)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!cand?.id) return null;
      const roleKey = (cand as { role_key?: string }).role_key ?? "";
      if (roleKey === "inventory_manager" || roleKey === "inventory") return null;

      const branchScopedRoles = new Set([
        "branch_manager",
        "field_officer",
        "guard",
        "security_guard",
      ]);

      // 1) Direct branch scope row wins.
      const { data: direct, error: dErr } = await supabase
        .from("employee_scope_assignments")
        .select("scope_id,scope_label")
        .eq("candidate_id", cand.id)
        .eq("scope_type", "branch")
        .limit(1)
        .maybeSingle();
      if (dErr) throw dErr;
      if (direct?.scope_id) return direct;

      // 2) Fallback for branch-scoped roles: derive from any unit scope row.
      if (branchScopedRoles.has(roleKey)) {
        const { data: unitRows, error: uErr } = await supabase
          .from("employee_scope_assignments")
          .select("scope_id")
          .eq("candidate_id", cand.id)
          .eq("scope_type", "unit");
        if (uErr) throw uErr;
        const unitIds = (unitRows ?? [])
          .map((r: { scope_id: string }) => r.scope_id)
          .filter(Boolean);
        if (unitIds.length) {
          const { data: units, error: unErr } = await supabase
            .from("units")
            .select("branch_id")
            .in("id", unitIds);
          if (unErr) throw unErr;
          const branchId = (units ?? [])
            .map((u: { branch_id: string | null }) => u.branch_id)
            .find((b): b is string => !!b);
          if (branchId) {
            const { data: br } = await supabase
              .from("branches")
              .select("name,code")
              .eq("id", branchId)
              .maybeSingle();
            const b = br as { name?: string; code?: string } | null;
            const label = b
              ? `${b.code ?? ""}${b.code && b.name ? " – " : ""}${b.name ?? ""}`.trim()
              : "";
            return { scope_id: branchId, scope_label: label };
          }
        }
      }

      // 3) Second fallback for FO / branch_manager / guard: derive branch from
      // candidate_units mapping (field officers are often mapped via
      // candidate_units instead of employee_scope_assignments).
      if (branchScopedRoles.has(roleKey)) {
        const { data: cuRows, error: cuErr } = await supabase
          .from("candidate_units")
          .select("unit_id")
          .eq("candidate_id", cand.id);
        if (cuErr) throw cuErr;
        const unitIds2 = (cuRows ?? []).map((r: { unit_id: string }) => r.unit_id).filter(Boolean);
        if (unitIds2.length) {
          const { data: units2 } = await supabase
            .from("units")
            .select("branch_id")
            .in("id", unitIds2);
          const branchId = (units2 ?? [])
            .map((u: { branch_id: string | null }) => u.branch_id)
            .find((b): b is string => !!b);
          if (branchId) {
            const { data: br } = await supabase
              .from("branches")
              .select("name,code")
              .eq("id", branchId)
              .maybeSingle();
            const b = br as { name?: string; code?: string } | null;
            const label = b
              ? `${b.code ?? ""}${b.code && b.name ? " – " : ""}${b.name ?? ""}`.trim()
              : "";
            return { scope_id: branchId, scope_label: label };
          }
        }
      }
      return null;
    },
  });

  if (isSuperAdmin) {
    return { isLoading: false, isScoped: false, branchId: null, branchLabel: "" };
  }
  if (q.isLoading) {
    return { isLoading: true, isScoped: false, branchId: null, branchLabel: "" };
  }
  if (q.data?.scope_id) {
    return {
      isLoading: false,
      isScoped: true,
      branchId: q.data.scope_id as string,
      branchLabel: (q.data.scope_label as string) || "",
    };
  }
  return { isLoading: false, isScoped: false, branchId: null, branchLabel: "" };
}
