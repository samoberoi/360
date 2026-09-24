import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const restorePhoneSession = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ phone: z.string().regex(/^\d{10}$/) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { SUPER_ADMIN_OTP_PHONE } = await import("@/lib/otp-config");
    if (data.phone !== SUPER_ADMIN_OTP_PHONE) {
      throw new Error("This account is not enabled.");
    }

    const email = `phone-${data.phone}@radiantguard.local`;
    const password = `RG-${data.phone}-pre-launch!`;

    // Find (or create) the identity, then re-align its password with the
    // deterministic credential so subsequent logins take the fast path.
    const existing = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const found = existing.data?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === email,
    );

    if (found) {
      await supabaseAdmin.auth.admin.updateUserById(found.id, {
        password,
        email_confirm: true,
      });
    } else {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error) throw created.error;
    }

    const link = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });


    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) {
      throw link.error ?? new Error("Could not restore this account.");
    }

    const signedIn = await supabaseAdmin.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error("Could not establish a secure session.");
    }

    return {
      accessToken: signedIn.data.session.access_token,
      refreshToken: signedIn.data.session.refresh_token,
    };
  });