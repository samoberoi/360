import { SUPER_ADMIN_OTP_PHONE } from "@/lib/otp-config";

/** Returns true when this phone may sign in (super admin or active enabled field officer). */
export async function isPhoneLoginAllowed(phone: string): Promise<boolean> {
  if (phone === SUPER_ADMIN_OTP_PHONE) return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("candidates" as never)
    .select("id")
    .eq("mobile", phone)
    .eq("role_key", "field_officer")
    .eq("status", "active")
    .eq("is_enabled", true)
    .eq("is_disabled", false)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}
