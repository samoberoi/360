import { SUPER_ADMIN_OTP_PHONES } from "@/lib/otp-config";

/**
 * Returns true when this phone may sign in: super admins, or an active enabled
 * person whose role_key is a staff role defined in the `roles` table (field
 * officer, operations manager, branch manager, DGM, ...). Data-driven.
 */
export async function isPhoneLoginAllowed(phone: string): Promise<boolean> {
  if (SUPER_ADMIN_OTP_PHONES.has(phone)) return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("candidates" as never)
    .select("role_key")
    .eq("mobile", phone)
    .eq("status", "active")
    .eq("is_enabled", true)
    .eq("is_disabled", false)
    .limit(5);
  const rows = (data ?? []) as Array<{ role_key: string | null }>;
  const keys = rows.map((r) => r.role_key).filter((k): k is string => !!k);
  if (!keys.length) return false;
  const { data: roles } = await supabaseAdmin.from("roles" as never).select("key").in("key", keys).limit(1);
  return Array.isArray(roles) && roles.length > 0;
}
