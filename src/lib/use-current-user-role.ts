import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";

/**
 * Returns the current user's auth uid, role_key, candidate id, and convenience flags.
 */
export function useCurrentUserRole() {
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(phone);

  const q = useQuery({
    queryKey: ["current-user-role", phone],
    enabled: !!phone && !isSuperAdmin,
    queryFn: async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: cand } = await supabase
        .from("candidates")
        .select("id,role_key")
        .eq("mobile", phone)
        .maybeSingle();
      return {
        userId: authUser?.id ?? null,
        roleKey: (cand?.role_key as string | undefined) ?? null,
        candidateId: (cand?.id as string | undefined) ?? null,
      };
    },
  });

  const userId = q.data?.userId ?? null;
  const roleKey = q.data?.roleKey ?? null;
  const candidateId = q.data?.candidateId ?? null;
  return {
    isLoading: q.isLoading,
    userId,
    roleKey,
    candidateId,
    isSuperAdmin,
    isFieldOfficer: !isSuperAdmin && roleKey === "field_officer",
    isBranchManager: !isSuperAdmin && roleKey === "branch_manager",
  };
}
