import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MarkMode = "home_office" | "mapped_site" | "anywhere";

export type AttendanceRule = {
  role_key: string;
  mark_mode: MarkMode;
  allowed_distance_m: number;
  save_new_site_locations: boolean;
  face_photo_required: boolean;
};

export const MARK_MODE_LABEL: Record<MarkMode, string> = {
  home_office: "Home office only",
  mapped_site: "Mapped site only",
  anywhere: "Anywhere",
};

export const DEFAULT_RULE = (role_key: string): AttendanceRule => ({
  role_key,
  mark_mode: role_key === "field_officer" ? "anywhere" : "home_office",
  allowed_distance_m: 300,
  save_new_site_locations: true,
  face_photo_required: role_key === "field_officer",
});

export async function fetchAttendanceRules(): Promise<AttendanceRule[]> {
  const { data, error } = await supabase.from("attendance_location_rules" as never).select("*");
  if (error) throw error;
  return (data ?? []) as unknown as AttendanceRule[];
}

export async function saveAttendanceRule(rule: AttendanceRule): Promise<void> {
  const { error } = await supabase
    .from("attendance_location_rules" as never)
    .upsert(rule as never, { onConflict: "role_key" });
  if (error) throw error;
}

/** Rule that applies to a role (falls back to sensible defaults). */
export function useAttendanceRule(roleKey: string | null | undefined) {
  const q = useQuery({
    queryKey: ["attendance-location-rules"],
    queryFn: fetchAttendanceRules,
    staleTime: 5 * 60_000,
  });
  const key = roleKey ?? "";
  const rule = q.data?.find((r) => r.role_key === key) ?? DEFAULT_RULE(key);
  return { rule, isLoading: q.isLoading };
}
