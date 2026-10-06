import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { logActivity, getClientIp } from "@/lib/activity-log";
import { restorePhoneSession } from "@/lib/phone-session.functions";
import { ensureFreshNativeInstall } from "@/lib/native-install-guard";

const STORAGE_KEY = "radiant.auth";
const AUTH_TIMEOUT_MS = 12_000;
const IP_LOOKUP_TIMEOUT_MS = 1_500;
/**
 * OTP verification now happens server-side (MSG91) in `src/lib/otp.functions.ts`.
 * Legacy note kept for the super-admin phone constant below.
 *
 * ⚠️ Session bridging below is still deterministic-credential based ⚠️
 * The OTP below is a hardcoded development bypass used while the SMS gateway
 * integration is pending. Before launch, this MUST be replaced with a real
 * OTP provider (Twilio / MSG91 / Supabase phone auth) and the value should
 * come exclusively from server-side configuration / environment variables.
 *
 * The default OTP and super-admin phone can be overridden via Vite env vars:
 *   VITE_DEMO_OTP            (default: "111111")
 *   VITE_SUPER_ADMIN_PHONE   (default: "8373914073")
 */
export const SUPER_ADMIN_PHONE =
  (import.meta.env.VITE_SUPER_ADMIN_PHONE as string | undefined) ?? "8373914073";

/** Phones with full super-admin access (last 10 digits). */
export const SUPER_ADMIN_PHONES: ReadonlySet<string> = new Set([
  SUPER_ADMIN_PHONE,
]);

export function isSuperAdminPhone(phone: string | null | undefined) {
  if (!phone) return false;
  return SUPER_ADMIN_PHONES.has(phone.replace(/\D/g, "").slice(-10));
}

export type AuthUser = { phone: string; role: "super_admin" | "user" };

export function readStoredAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

// A session is only ever abandoned when the user taps Log out. Everything else
// (offline refresh, background app, flaky network, slow storage broker) is
// treated as recoverable so a refresh can never silently sign somebody out.
let manualSignOut = false;
const isAuthHardFailure = (message: string) => {
  const m = message.toLowerCase();
  return (
    m.includes("invalid refresh token") ||
    m.includes("refresh token not found") ||
    m.includes("already used") ||
    m.includes("user not found") ||
    m.includes("user banned")
  );
};

/** Best-effort session recovery; resolves true when a session is live. */
async function recoverSession(attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return true;
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.data.session?.user) return true;
    const message = refreshed.error?.message ?? "";
    // A genuinely revoked/expired refresh token is the only reason to give up.
    if (message && isAuthHardFailure(message)) return false;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

/**
 * Bridge phone-OTP login into a real Supabase Auth session so RLS works.
 * Each phone gets a deterministic synthetic email + password (pre-launch only).
 */
function credsForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return {
    email: `phone-${digits}@radiantguard.local`,
    password: `RG-${digits}-pre-launch!`,
  };
}

function withTimeout<T>(promise: Promise<T>, message: string, ms = AUTH_TIMEOUT_MS) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function resolveClientIpQuickly() {
  return Promise.race<string>([
    getClientIp(),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(""), IP_LOOKUP_TIMEOUT_MS);
    }),
  ]).catch(() => "");
}

async function authUserFromSession(): Promise<AuthUser | null> {
  // A fresh install or new app version always starts signed out.
  await ensureFreshNativeInstall();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    const stored = readStoredAuthUser();
    // Storage brokering / token refresh can be momentarily unavailable. Try to
    // bring the session back before treating the user as signed out.
    if (stored && !manualSignOut) {
      const ok = await recoverSession();
      if (ok) return stored;
      // Still no session but nothing proved the login invalid — stay signed in
      // and let the next refresh attempt recover it.
      return stored;
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }

  const stored = readStoredAuthUser();
  if (stored) return stored;

  const email = session.user.email ?? "";
  const match = email.match(/^phone-(\d{10})@radiantguard\.local$/i);
  if (!match) return null;

  const phone = `+91${match[1]}`;
  const user: AuthUser = {
    phone,
    role: isSuperAdminPhone(match[1]) ? "super_admin" : "user",
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  return user;
}

async function ensureSupabaseSession(
  phone: string,
  restore: (input: {
    data: { phone: string };
  }) => Promise<{ accessToken: string; refreshToken: string }>,
) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  // Access (super admin / active field officers) is enforced server-side.

  const { email, password } = credsForPhone(phone);
  const signIn = await withTimeout(
    supabase.auth.signInWithPassword({ email, password }),
    "Login is taking too long. Please try again.",
  );
  if (!signIn.error) return;

  // Approved users are pre-provisioned, so a credential failure means this
  // number is not registered/enabled. Never fall back to the privileged
  // restore path — externally hosted builds have no server keys.
  const msg = signIn.error.message ?? "";
  if (/invalid login credentials|email not confirmed|user not found/i.test(msg)) {
    throw new Error(
      "This mobile number is not registered for PLUS 360. Please contact your administrator.",
    );
  }

  let tokens: { accessToken: string; refreshToken: string };
  try {
    tokens = await withTimeout(
      restore({ data: { phone: digits } }),
      "Account restoration is taking too long. Please try again.",
    );
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/supabase|environment variable|service_role/i.test(text)) {
      throw new Error("Sign-in is temporarily unavailable. Please try again in a moment.");
    }
    throw err;
  }
  const restored = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (restored.error || !restored.data.session) {
    throw restored.error ?? new Error("Could not establish a secure session.");
  }
}

export function useAuth() {
  const restoreSession = useServerFn(restorePhoneSession);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Supabase emits auth events on every token refresh and tab focus. Writing
    // a freshly parsed (but identical) user object each time re-rendered the
    // whole admin shell and made large screens like the payroll register
    // flicker. Only change state when the identity actually changes.
    const setUser = (next: AuthUser | null) => {
      setUserState((prev) =>
        JSON.stringify(prev ?? null) === JSON.stringify(next ?? null) ? prev : next,
      );
    };
    const syncStoredUser = () => {
      if (!active) return;
      setUser(readStoredAuthUser());
    };

    const syncFromSession = async () => {
      try {
        const nextUser = await authUserFromSession();
        if (!active) return;
        setUser(nextUser);
      } finally {
        if (!active) return;
        setIsReady(true);
      }
    };

    listeners.add(syncStoredUser);
    window.addEventListener("storage", syncStoredUser);

    void syncFromSession().catch(() => {
      if (!active) return;
      setUser(null);
      setIsReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      void ensureFreshNativeInstall().then((wiped) => {
        // A session restored from before this install is never honoured.
        if (wiped && event === "INITIAL_SESSION") return;
        handleAuthEvent(event, session);
      });
    });
    function handleAuthEvent(
      event: Parameters<Parameters<typeof supabase.auth.onAuthStateChange>[0]>[0],
      session: Parameters<Parameters<typeof supabase.auth.onAuthStateChange>[0]>[1],
    ) {
      if (!active) return;

      if (!session?.user) {
        const stored = readStoredAuthUser();
        // Only an explicit Log out ends the session. A null session from a
        // failed/expired refresh is recovered in the background.
        if (stored && !manualSignOut && event !== "SIGNED_OUT") {
          setUser(stored);
          setIsReady(true);
          void recoverSession();
          return;
        }
        if (stored && !manualSignOut && event === "SIGNED_OUT") {
          setUser(stored);
          setIsReady(true);
          void recoverSession().then((ok) => {
            if (!active || ok) return;
            window.localStorage.removeItem(STORAGE_KEY);
            setUser(null);
          });
          return;
        }
        window.localStorage.removeItem(STORAGE_KEY);
        setUser(null);
        setIsReady(true);
        return;
      }

      const stored = readStoredAuthUser();
      if (stored) {
        setUser(stored);
        setIsReady(true);
        return;
      }

      const email = session.user.email ?? "";
      const match = email.match(/^phone-(\d{10})@radiantguard\.local$/i);
      if (!match) {
        setUser(null);
        setIsReady(true);
        return;
      }

      const nextUser: AuthUser = {
        phone: `+91${match[1]}`,
        role: isSuperAdminPhone(match[1]) ? "super_admin" : "user",
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
      setUser(nextUser);
      setIsReady(true);
    }

    // Keep the session warm: phones suspend timers while the app is in the
    // background, so refresh on resume, on reconnect, and periodically.
    const keepAlive = () => {
      if (!active || manualSignOut || !readStoredAuthUser()) return;
      void recoverSession(1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") keepAlive();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", keepAlive);
    window.addEventListener("online", keepAlive);
    const keepAliveTimer = setInterval(keepAlive, 10 * 60_000);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", keepAlive);
      window.removeEventListener("online", keepAlive);
      clearInterval(keepAliveTimer);
      listeners.delete(syncStoredUser);
      window.removeEventListener("storage", syncStoredUser);
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(
    async (phone: string) => {
      const digits = phone.replace(/\D/g, "").slice(-10);
      const role: AuthUser["role"] = isSuperAdminPhone(digits) ? "super_admin" : "user";
      const ipPromise = resolveClientIpQuickly();
      manualSignOut = false;
      try {
        await ensureSupabaseSession(phone, restoreSession);
      } catch (e) {
        void ipPromise.then((ip) =>
          logActivity({
            module: "Authentication",
            action: "login",
            entityType: "user",
            entityLabel: phone,
            userPhone: phone,
            userRole: role,
            ip,
            status: "failure",
            errorMessage: e instanceof Error ? e.message : String(e),
          }),
        );
        throw e;
      }
      const u: AuthUser = { phone, role };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      // If a different phone had biometric enabled on this device, wipe it so
      // the next Face ID prompt can't sign in as the previous user.
      void (async () => {
        try {
          const { getStoredBiometricPhone, disableBiometric } = await import("./biometric");
          const stored = await getStoredBiometricPhone();
          if (stored) {
            const storedDigits = stored.replace(/\D/g, "").slice(-10);
            if (storedDigits && storedDigits !== digits) {
              await disableBiometric();
            }
          }
        } catch {
          /* noop */
        }
      })();
      void ipPromise.then((ip) =>
        logActivity({
          module: "Authentication",
          action: "login",
          entityType: "user",
          entityLabel: phone,
          userPhone: phone,
          userRole: role,
          ip,
        }),
      );
      emit();
    },
    [restoreSession],
  );

  const logout = useCallback(() => {
    const current = readStoredAuthUser();
    void logActivity({
      module: "Authentication",
      action: "logout",
      entityType: "user",
      entityLabel: current?.phone ?? "",
      userPhone: current?.phone ?? "",
      userRole: current?.role ?? "",
    });
    manualSignOut = true;
    window.localStorage.removeItem(STORAGE_KEY);
    void supabase.auth.signOut();
    emit();
  }, []);

  return { user, login, logout, isReady };
}
