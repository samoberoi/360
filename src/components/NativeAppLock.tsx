import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, LogOut } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBiometricStatus, signInWithBiometric } from "@/lib/biometric";
import { useAuth } from "@/lib/auth";
import { isNativePlatform, logNativeEvent } from "@/lib/native";
import {
  beginNativeAppUnlockPrompt,
  endNativeAppUnlockPrompt,
  getLastNativeAppPromptAt,
  getLastNativeAppUnlockAt,
  isNativeAppSessionUnlocked,
  isNativeAppUnlockPromptInFlight,
  markNativeAppSessionUnlocked,
  resetNativeAppSessionUnlock,
} from "@/lib/native-app-lock";

type LockMode = "checking" | "locked" | "unlocked";

function lastFour(value: string) {
  return value.replace(/\D/g, "").slice(-4);
}

export function NativeAppLock() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user, isReady, logout } = useAuth();
  const [mode, setMode] = useState<LockMode>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking device security…");

  const userDigits = user?.phone.replace(/\D/g, "").slice(-10) ?? "";


  const requireLock = useCallback(
    async (reason: "launch" | "resume") => {
      if (!isNativePlatform()) {
        setMode("unlocked");
        return false;
      }
      if (!isReady) {
        setMode("checking");
        return false;
      }
      if (!user || pathname === "/login") {
        setMode("unlocked");
        return false;
      }
      if (isNativeAppUnlockPromptInFlight()) {
        return false;
      }
      if (isNativeAppSessionUnlocked()) {
        setMode("unlocked");
        return false;
      }

      const status = await getBiometricStatus();
      if (!status.available || !status.enabled || !status.saved) {
        setMode("unlocked");
        return false;
      }

      logNativeEvent("biometric", "app lock required", { reason });
      setMessage("Face ID is required to unlock PLUS 360.");
      setMode("locked");
      return true;
    },
    [isReady, pathname, user],
  );

  const unlock = useCallback(
    async (reason: "launch" | "resume" | "manual") => {
      if (!beginNativeAppUnlockPrompt()) return;
      setBusy(true);
      setMessage("Waiting for Face ID…");

      try {
        const savedPhone = await signInWithBiometric();
        if (!savedPhone) {
          logNativeEvent("biometric", "app unlock cancelled", { reason });
          setMessage("Face ID is required to unlock PLUS 360.");
          setMode("locked");
          return;
        }

        const savedDigits = savedPhone.replace(/\D/g, "").slice(-10);
        if (userDigits && savedDigits && userDigits !== savedDigits) {
          logNativeEvent("biometric", "app unlock phone mismatch", {
            sessionPhoneSuffix: lastFour(userDigits),
            savedPhoneSuffix: lastFour(savedDigits),
          });
          toast.error("Face ID belongs to another saved phone. Please sign in again.");
          resetNativeAppSessionUnlock();
          logout();
          navigate({ to: "/login", replace: true });
          return;
        }

        markNativeAppSessionUnlocked();
        logNativeEvent("biometric", "app unlock success", { reason });
        setMode("unlocked");
        setMessage("Unlocked");

      } catch (err) {
        logNativeEvent("biometric", "app unlock failed", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
        setMessage("Face ID is required to unlock PLUS 360.");
        setMode("locked");
      } finally {
        setBusy(false);
        endNativeAppUnlockPrompt();
      }
    },
    [logout, navigate, userDigits],
  );

  useEffect(() => {
    if (!isNativePlatform()) {
      setMode("unlocked");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    setMode("checking");
    setMessage("Checking device security…");

    void requireLock("launch").then((required) => {
      if (cancelled || !required) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (isNativeAppSessionUnlocked() || isNativeAppUnlockPromptInFlight()) return;
        void unlock("launch");
      }, 250);
    });

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [requireLock, unlock]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let inactiveAt = 0;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    // Threshold long enough to cover the native Face ID sheet (which itself
    // backgrounds the app). Only truly leaving the app for this long re-locks.
    const RESUME_LOCK_THRESHOLD_MS = 60_000;
    // iOS reports Face ID / native sheets as app inactive/active. Suppress all
    // resume locks close to a biometric prompt to prevent a second prompt loop.
    const POST_PROMPT_GRACE_MS = 90_000;
    // Grace period after a successful unlock to ignore spurious resume events.
    const POST_UNLOCK_GRACE_MS = 5_000;

    void import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      void App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          if (isNativeAppUnlockPromptInFlight()) {
            inactiveAt = 0;
            return;
          }
          inactiveAt = Date.now();
          return;
        }
        if (isNativeAppUnlockPromptInFlight()) {
          inactiveAt = 0;
          return;
        }
        if (Date.now() - getLastNativeAppPromptAt() < POST_PROMPT_GRACE_MS) {
          inactiveAt = 0;
          return;
        }
        // Ignore resumes triggered by the Face ID sheet itself.
        if (Date.now() - getLastNativeAppUnlockAt() < POST_UNLOCK_GRACE_MS) {
          inactiveAt = 0;
          return;
        }
        if (inactiveAt === 0) return;
        if (Date.now() - inactiveAt < RESUME_LOCK_THRESHOLD_MS) return;

        inactiveAt = 0;
        resetNativeAppSessionUnlock();
        void requireLock("resume").then((required) => {
          if (required) void unlock("resume");
        });
      }).then((handle) => {
        cleanup = () => {
          void handle.remove();
        };
      });
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [requireLock, unlock]);


  const visible =
    isNativePlatform() &&
    !!user &&
    pathname !== "/login" &&
    (mode === "checking" || mode === "locked");

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100000] flex min-h-dvh items-center justify-center bg-background px-5 text-foreground">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-border bg-card shadow-lg">
          {busy || mode === "checking" ? (
            <Loader2 className="h-9 w-9 animate-spin text-accent" />
          ) : (
            <Fingerprint className="h-9 w-9 text-accent" />
          )}
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-tight">PLUS 360 locked</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
        <div className="mt-7 space-y-3">
          <Button
            className="h-12 w-full rounded-xl"
            disabled={busy || mode === "checking"}
            onClick={() => void unlock("manual")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            Unlock with Face ID
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-xl"
            onClick={() => {
              resetNativeAppSessionUnlock();
              logout();
              navigate({ to: "/login", replace: true });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}