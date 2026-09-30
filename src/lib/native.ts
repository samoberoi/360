/**
 * Native runtime bridge for Capacitor (iOS / Android).
 *
 * Safe to import from browser-only code. All plugin work is dynamic-imported
 * inside `initNative()` so nothing runs during SSR and web-only builds don't
 * pay the cost when Capacitor isn't present.
 */
import { Capacitor } from "@capacitor/core";

let initialized = false;
const NATIVE_LOG_KEY = "radiant.native.debug.v1";
const MAX_NATIVE_LOGS = 80;

export type NativeDebugEntry = {
  at: string;
  area: string;
  message: string;
  details?: unknown;
};

function redactNativeDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") return details;
  if (Array.isArray(details)) return details.map(redactNativeDetails);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|key|password|authorization/i.test(key)) {
      redacted[key] = typeof value === "string" ? `…${value.slice(-8)}` : "[redacted]";
    } else if (value && typeof value === "object") {
      redacted[key] = redactNativeDetails(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function logNativeEvent(area: string, message: string, details?: unknown) {
  if (typeof window === "undefined") return;
  const entry: NativeDebugEntry = {
    at: new Date().toISOString(),
    area,
    message,
    details: redactNativeDetails(details),
  };
  try {
    const raw = window.localStorage.getItem(NATIVE_LOG_KEY);
    const current = raw ? (JSON.parse(raw) as NativeDebugEntry[]) : [];
    const next = [...current, entry].slice(-MAX_NATIVE_LOGS);
    window.localStorage.setItem(NATIVE_LOG_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
  console.info(`[native:${area}] ${message}`, entry.details ?? "");
}

export function getNativeDebugLog(): NativeDebugEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NATIVE_LOG_KEY);
    return raw ? (JSON.parse(raw) as NativeDebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearNativeDebugLog() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(NATIVE_LOG_KEY);
}

export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* fallback below */
  }
  // Capacitor also injects window.Capacitor in the WebView. Keep this as a
  // fallback for older native shells and custom-domain hybrid shells where the
  // npm-side Capacitor singleton can report "web" before bridge hydration.
  const cap = (window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: Record<string, unknown>;
    };
  }).Capacitor;
  try {
    if (cap?.isNativePlatform?.()) return true;
  } catch {
    /* noop */
  }
  const platform = cap?.getPlatform?.();
  if (platform === "ios" || platform === "android") return true;
  // registerPlugin() also adds proxies to Capacitor.Plugins in a normal
  // browser, so a plugin entry only counts when the platform isn't "web".
  if (platform === "web") return false;
  return !!cap?.Plugins?.RadiantBiometrics;
}

export function getNativeRuntimeSnapshot() {
  if (typeof window === "undefined") {
    return {
      platform: "server",
      isNative: false,
      nativeBridgePresent: false,
      pushPluginAvailable: false,
      biometricPluginAvailable: false,
      userAgent: "",
      href: "",
    };
  }

  let platform = "unknown";
  let pushPluginAvailable = false;
  let biometricPluginAvailable = false;
  try {
    platform = Capacitor.getPlatform();
    pushPluginAvailable = Capacitor.isPluginAvailable("PushNotifications");
    biometricPluginAvailable = Capacitor.isPluginAvailable("RadiantBiometrics");
  } catch {
    /* fallback fields below still help diagnostics */
  }

  return {
    platform,
    isNative: isNativePlatform(),
    nativeBridgePresent: !!(window as unknown as { Capacitor?: unknown }).Capacitor,
    pushPluginAvailable,
    biometricPluginAvailable,
    userAgent: window.navigator.userAgent,
    href: window.location.href,
  };
}

export async function initNative(): Promise<void> {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (!isNativePlatform()) return;
  initialized = true;
  logNativeEvent("runtime", "initNative started", getNativeRuntimeSnapshot());

  try {
    const [{ StatusBar, Style }, { SplashScreen }, { Keyboard, KeyboardResize }, { App }] =
      await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/splash-screen"),
        import("@capacitor/keyboard"),
        import("@capacitor/app"),
      ]);

    // Status bar: match app theme, do NOT overlay the web view so safe-area
    // insets from CSS env() still work as expected.
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: "#ffffff" });
    } catch {
      /* iOS ignores setBackgroundColor — safe to swallow */
    }

    // Hide launch splash quickly once the JS bundle is ready.
    try {
      await SplashScreen.hide();
    } catch {
      /* noop */
    }

    // Keep native keyboard from covering inputs; also expose height as a
    // CSS variable so forms can reserve space.
    try {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
      await Keyboard.setScroll({ isDisabled: false });
      Keyboard.addListener("keyboardWillShow", (info) => {
        document.documentElement.style.setProperty(
          "--keyboard-height",
          `${info.keyboardHeight}px`,
        );
        document.documentElement.setAttribute("data-keyboard", "open");
      });
      Keyboard.addListener("keyboardWillHide", () => {
        document.documentElement.style.setProperty("--keyboard-height", "0px");
        document.documentElement.removeAttribute("data-keyboard");
      });
    } catch {
      /* noop */
    }

    // Hardware back button on Android: navigate back in history or exit.
    try {
      App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });
    } catch {
      /* noop */
    }
  } catch (err) {
    // Never let native init crash the web app.
    logNativeEvent("runtime", "initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn("[native] initialization failed", err);
  }

  // Push notifications (APNs on iOS). Prepare listeners, then silently refresh
  // the APNs token on every native launch when permission is already granted.
  // This prevents stale tokens from surviving reinstalls or debug/release swaps.
  try {
    const { initPushNotifications } = await import("./push");
    void initPushNotifications();
  } catch (err) {
    logNativeEvent("push", "prepare import failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    /* noop */
  }

  // Ask for location right alongside notifications so GPS is not left off
  // after install — attendance cannot be marked without it.
  try {
    const { requestLocationPermission } = await import("./location-permission");
    void requestLocationPermission();
  } catch (err) {
    logNativeEvent("location", "prepare import failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    /* noop */
  }
}
