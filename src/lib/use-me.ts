import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";

export type MeProfile = {
  id: string | null;
  fullName: string;
  designation: string;
  initials: string;
  roleLabel: string;
  photoUrl: string | null;
};

function toInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * Resolves the current authenticated user's display profile
 * (full name + designation) by looking up their candidate record via phone.
 * Falls back gracefully for the Super Admin.
 */
export function useMe(): MeProfile & { isLoading: boolean } {
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(phone);

  const q = useQuery({
    queryKey: ["me-profile", phone],
    enabled: !!phone,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: cand } = await supabase
        .from("candidates")
        .select("id,full_name,photo_url,designation_id,role_key")
        .eq("mobile", phone)
        .maybeSingle();

      let designation = "";
      if (cand?.designation_id) {
        const { data: d } = await supabase
          .from("designations")
          .select("name")
          .eq("id", cand.designation_id as string)
          .maybeSingle();
        designation = (d?.name as string | undefined) ?? "";
      }
      return {
        id: (cand?.id as string | undefined) ?? null,
        fullName: (cand?.full_name as string | undefined) ?? "",
        designation,
        photoUrl: (cand?.photo_url as string | undefined) ?? null,
        roleKey: (cand?.role_key as string | undefined) ?? "",
      };
    },
  });

  const fullName = isSuperAdmin
    ? "Super Admin"
    : q.data?.fullName || "";
  const designation = isSuperAdmin
    ? "System Owner"
    : q.data?.designation || (q.data?.roleKey ? q.data.roleKey.replace(/_/g, " ") : "");

  return {
    isLoading: q.isLoading,
    id: q.data?.id ?? null,
    fullName,
    designation,
    initials: toInitials(fullName) || (phone ? phone.slice(-2) : "U"),
    roleLabel: designation,
    photoUrl: q.data?.photoUrl ?? null,
  };
}
