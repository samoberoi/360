/**
 * Native Face ID / Touch ID helper.
 *
 * Uses the custom `RadiantBiometrics` and `RadiantNativeAuthStore` plugins
 * registered by the iOS and Android shells.
 *
 * Flow (installed app):
 *   1. User logs in with phone + OTP.
 *   2. After OTP verify, `enableBiometric(phone)` runs → iOS prompts
 *      Face ID → phone is saved in the Keychain.
 *   3. Next launch, the Sign-in page shows a "Sign in with Face ID"
 *      prompt reads the phone from secure device storage and signs in.
 *   4. Killing the app keeps the secure entry, so biometric unlock remains
 *      available until the user
 *      explicitly disables it from My Profile.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { isNativePlatform, logNativeEvent } from "./native";

const ENABLED_KEY = "radiant.biometric.enabled";

type RadiantBiometricCheck = {
  available: boolean;
  biometryAvailable?: boolean;
  deviceSecure: boolean;
  biometryType: string;
  label: string;
  code: string;
  reason: string;
};

type RadiantBiometricsPlugin = {
  check(): Promise<RadiantBiometricCheck>;
  authenticate(options: { reason: string }): Promise<{ success: boolean }>;
};

type RadiantNativeAuthStorePlugin = {
  getPhone(): Promise<{ hasPhone?: boolean; phone?: string }>;
  setPhone(options: { phone: string }): Promise<{ saved: boolean }>;
  clearPhone(): Promise<{ cleared: boolean }>;
};

const nativeBiometrics = registerPlugin<RadiantBiometricsPlugin>("RadiantBiometrics");
const nativeAuthStore = registerPlugin<RadiantNativeAuthStorePlugin>("RadiantNativeAuthStore");

function getPlugin<T>(name: string): T | null {
  if (!isNativePlatform()) return null;
  try {
    // Access via the runtime bridge so we don't hard-fail if the plugin
    // isn't registered yet (e.g. old installed build).
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: Record<string, unknown> };
    }).Capacitor;
    const plugin = cap?.Plugins?.[name] as T | undefined;
    if (!plugin) {
      logNativeEvent("biometric", `plugin ${name} not registered`);
      return null;
    }
    return plugin;
  } catch (err) {
    logNativeEvent("biometric", `plugin ${name} lookup failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function biometrics(): RadiantBiometricsPlugin | null {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("RadiantBiometrics")) return null;
  return nativeBiometrics;
}

function store(): RadiantNativeAuthStorePlugin | null {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("RadiantNativeAuthStore")) return null;
  return nativeAuthStore;
}

async function checkNative(): Promise<RadiantBiometricCheck | null> {
  const plugin = biometrics();
  if (!plugin) return null;
  try {
    const info = await plugin.check();
    logNativeEvent("biometric", "check", info);
    return info;
  } catch (err) {
    logNativeEvent("biometric", "check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function isBiometricEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export async function isBiometricAvailable(): Promise<boolean> {
  const info = await checkNative();
  return !!info?.available;
}

/** Require the device's enrolled face or fingerprint for a sensitive action. */
export async function authenticateNativeBiometric(reason: string): Promise<boolean> {
  const plugin = biometrics();
  if (!plugin) return false;
  const info = await plugin.check();
  if (!info.available) throw new Error(info.reason || "Biometric authentication is unavailable.");
  const result = await plugin.authenticate({ reason });
  return result.success;
}

/** Returns the phone currently saved in secure native storage, or null. */
export async function getStoredBiometricPhone(): Promise<string | null> {
  const s = store();
  if (!s) return null;
  try {
    const res = await s.getPhone();
    return res?.phone ?? null;
  } catch {
    return null;
  }
}

export async function getBiometricStatus(): Promise<{
  supported: boolean;
  available: boolean;
  enabled: boolean;
  saved: boolean;
  message: string;
}> {
  if (!isNativePlatform()) {
    return {
      supported: false,
      available: false,
      enabled: false,
      saved: false,
      message: "Open the installed app to use biometric unlock.",
    };
  }

  const info = await checkNative();
  if (!info) {
    return {
      supported: false,
      available: false,
      enabled: false,
      saved: false,
      message: `Biometric plugin not loaded (platform: ${Capacitor.getPlatform()}). Reinstall the app after the latest build.`,
    };
  }

  let saved = false;
  const s = store();
  if (s) {
    try {
      const res = await s.getPhone();
      saved = !!res.phone;
    } catch {
      /* noop */
    }
  }

  const enabled = info.available && (isBiometricEnabled() || saved);
  if (enabled && !isBiometricEnabled() && typeof window !== "undefined") {
    window.localStorage.setItem(ENABLED_KEY, "1");
  }

  return {
    supported: true,
    available: !!info.available,
    enabled,
    saved,
    message: info.available
      ? saved
        ? `${info.label || "Face ID"} is saved on this device.`
        : `${info.label || "Face ID"} is available. Sign in with OTP once to enable it.`
      : info.reason || "Face ID is not available on this device.",
  };
}

/** Prompt native biometrics, then save the phone in secure device storage. */
export async function enableBiometric(phone: string): Promise<void> {
  const plugin = biometrics();
  const s = store();
  if (!plugin || !s) {
    throw new Error(
      "Biometric unlock is only available in the installed app. Reinstall after the latest build.",
    );
  }

  const info = await plugin.check();
  logNativeEvent("biometric", "enable check", info);
  if (!info.available) {
    throw new Error(info.reason || "Biometric unlock is not available on this device.");
  }

  const auth = await plugin.authenticate({
    reason: "Enable Face ID for PLUS 360",
  });
  logNativeEvent("biometric", "enable auth", auth);
  if (!auth?.success) {
    throw new Error("Face ID was not confirmed.");
  }

  const saved = await s.setPhone({ phone });
  logNativeEvent("biometric", "enable saved", saved);
  if (!saved?.saved) {
    throw new Error("Face ID could not save this device.");
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ENABLED_KEY, "1");
  }
}

/** Prompt Face ID and return the stored phone, or null if cancelled. */
export async function signInWithBiometric(): Promise<string | null> {
  const plugin = biometrics();
  const s = store();
  if (!plugin || !s) return null;

  const info = await plugin.check();
  if (!info.available) return null;

  const existing = await s.getPhone();
  if (!existing.phone) return null;

  const auth = await plugin.authenticate({
    reason: "Sign in to PLUS 360",
  });
  if (!auth?.success) return null;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(ENABLED_KEY, "1");
  }
  return existing.phone;
}

export async function disableBiometric(): Promise<void> {
  const s = store();
  if (s) {
    try {
      await s.clearPhone();
      logNativeEvent("biometric", "cleared");
    } catch {
      /* noop */
    }
  }
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ENABLED_KEY);
  }
}
