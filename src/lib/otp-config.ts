/** Shared OTP constants (client-safe). */
export const OTP_LENGTH = 4;
export const SUPER_ADMIN_OTP = "2503";
export const FALLBACK_OTP = "1111";
export const SUPER_ADMIN_OTP_PHONE = "8373914073";
/** Phones that sign in with the super-admin PIN instead of a last-4 OTP. */
export const SUPER_ADMIN_OTP_PHONES: ReadonlySet<string> = new Set([
  SUPER_ADMIN_OTP_PHONE,
]);
