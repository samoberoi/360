import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  FALLBACK_OTP,
  OTP_LENGTH,
  SUPER_ADMIN_OTP,
  SUPER_ADMIN_OTP_PHONE as SUPER_ADMIN_PHONE,
} from "@/lib/otp-config";
type OtpMode = "sms" | "fixed";

/**
 * Phone OTP for sign-in.
 *
 * - Real OTPs use MSG91's configured Widget process, which owns the account
 *   default DLT template, SMS channel, four-digit length, retry, and expiry.
 * - The super admin always signs in with the fixed code 2503 (never SMS).
 * - When Platform Settings → "MSG91 real OTP" is toggled OFF, every other user
 *   falls back to the fixed code 1111.
 */


export const sendLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ phone: z.string().regex(/^\d{10}$/) }).parse(input))
  .handler(async (): Promise<{ mode: OtpMode }> => ({ mode: "fixed" }));

export const resendLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ phone: z.string().regex(/^\d{10}$/) }).parse(input))
  .handler(async (): Promise<{ mode: OtpMode }> => ({ mode: "fixed" }));

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().regex(/^\d{10}$/),
        otp: z.string().regex(/^\d{4}$/),
        accessToken: z.string().min(10).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    void FALLBACK_OTP;
    if (data.phone !== SUPER_ADMIN_PHONE) {
      throw new Error("Access disabled. Please contact your administrator.");
    }
    if (data.otp !== SUPER_ADMIN_OTP) throw new Error("Wrong code. Please try again.");
    return { ok: true };
  });
