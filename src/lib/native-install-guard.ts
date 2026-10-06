import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform, logNativeEvent } from "@/lib/native";

/**
 * Fresh install / new app version => always start at the login screen.
 *
 * Android can restore WebView storage from a cloud backup after reinstall and
 * iOS keeps Keychain items after uninstall, so a stale session could reappear
 * in a newly installed app. We stamp the installed native build in local
 * storage; whenever the stamp is missing or differs from the running build,
 * every saved sign-in (session, cached user, saved biometric phone) is wiped.
 * Web publishes do not change the native build, so they never sign anyone out.
 */
const MARK = "plus360.native-install-build";
let pending: Promise<boolean> | null = null;

async function run(): Promise<boolean> {
  if (typeof window === "undefined" || !isNativePlatform()) return false;
  let build = "";
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    build = `${info.version}(${info.build})`;
  } catch {
    return false;
  }
  if (!build) return false;
  const prev = window.localStorage.getItem(MARK);
  if (prev === build) return false;

  logNativeEvent("auth", "new app install/version — clearing saved sign-in", { prev, build });
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* noop */
  }
  try {
    Object.keys(window.localStorage).forEach((k) => {
      if (k === "radiant.auth" || k.startsWith("sb-") || k.startsWith("rbac") || k.includes("auth")) {
        window.localStorage.removeItem(k);
      }
    });
    window.sessionStorage.clear();
  } catch {
    /* noop */
  }
  try {
    const { disableBiometric } = await import("@/lib/biometric");
    await disableBiometric();
  } catch {
    /* noop */
  }
  window.localStorage.setItem(MARK, build);
  return true;
}

/** Resolves true when this launch wiped a stale sign-in. Runs once per launch. */
export function ensureFreshNativeInstall(): Promise<boolean> {
  if (!pending) pending = run().catch(() => false);
  return pending;
}
