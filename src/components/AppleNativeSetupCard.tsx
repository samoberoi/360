import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCircle2, Clipboard, Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  clearNativeDebugLog,
  getNativeDebugLog,
  getNativeRuntimeSnapshot,
  isNativePlatform,
} from "@/lib/native";
import {
  disableBiometric,
  enableBiometric,
  getBiometricStatus,
} from "@/lib/biometric";
import { getPushDebugStatus, registerPushForCurrentUser } from "@/lib/push";
import { getNativePushRegistrationStatus, sendNativeTestPush } from "@/lib/native-push-api";
import { cn } from "@/lib/utils";

type AppleNativeSetupCardProps = {
  compact?: boolean;
  autoStart?: boolean;
  nativeOnly?: boolean;
  className?: string;
};

export function AppleNativeSetupCard({
  compact = false,
  autoStart = false,
  nativeOnly = false,
  className,
}: AppleNativeSetupCardProps) {
  const { user } = useAuth();
  const phoneDigits = useMemo(
    () => (user?.phone ?? "").replace(/\D/g, "").slice(-10),
    [user?.phone],
  );
  const autoAttemptedPhoneRef = useRef<string | null>(null);

  const [nativeSupported, setNativeSupported] = useState(false);
  const [nativeSnapshot, setNativeSnapshot] = useState(() => getNativeRuntimeSnapshot());
  const [pushLoading, setPushLoading] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>("");
  const [pushRegistered, setPushRegistered] = useState(false);
  const [pushTokenCount, setPushTokenCount] = useState(0);
  const [bioStatus, setBioStatus] = useState<string>("");
  const isAndroid = nativeSnapshot.platform === "android";
  const deviceLabel = isAndroid ? "Android device" : nativeSnapshot.platform === "ios" ? "iPhone" : "device";
  const biometricLabel = isAndroid ? "biometric" : "Face ID";

  useEffect(() => {
    const snapshot = getNativeRuntimeSnapshot();
    setNativeSnapshot(snapshot);
    setNativeSupported(isNativePlatform());
    void refreshBiometricStatus();
    void refreshPushStatus();
  }, []);

  useEffect(() => {
    if (!phoneDigits) return;
    void refreshPushStatus();
  }, [phoneDigits]);

  async function refreshPushStatus() {
    try {
      const status = await getNativePushRegistrationStatus();
      setPushRegistered(status.registered);
      setPushTokenCount(status.count);
      if (status.registered) {
        setPushStatus(
          `This iPhone is registered for native notifications${status.count > 1 ? ` (${status.count} active tokens).` : "."}`,
        );
      }
    } catch {
      /* registration status is best-effort */
    }
  }

  useEffect(() => {
    if (!autoStart || !phoneDigits || !isNativePlatform()) return;
    if (autoAttemptedPhoneRef.current === phoneDigits) return;
    autoAttemptedPhoneRef.current = phoneDigits;

    setPushLoading(true);
    void registerPushForCurrentUser()
      .then((result) => {
        setPushStatus(result.message);
        void refreshPushStatus();
        if (result.tokenSaved) {
          toast.success("This iPhone is registered for push notifications");
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Could not register this iPhone for push notifications";
        setPushStatus(message);
      })
      .finally(() => setPushLoading(false));
  }, [autoStart, phoneDigits]);

  async function refreshBiometricStatus() {
    setNativeSnapshot(getNativeRuntimeSnapshot());
    const status = await getBiometricStatus();
    setBioEnabled(status.enabled);
    setBioStatus(status.message);
  }

  async function handleRegisterPush() {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      const result = await registerPushForCurrentUser();
      setPushStatus(result.message);
      await refreshPushStatus();
      if (result.tokenSaved) {
        toast.success("This iPhone is registered for push notifications");
      } else {
        toast.info(result.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not register this iPhone for push notifications";
      setPushStatus(message);
      toast.error(message);
    } finally {
      setPushLoading(false);
    }
  }

  async function handleTestPush() {
    setPushLoading(true);
    try {
      if (isNativePlatform()) {
        const registration = await registerPushForCurrentUser();
        setPushStatus(registration.message);
        await refreshPushStatus();
      }
      const result = await sendNativeTestPush("Hello from PLUS 360!");
      await refreshPushStatus();
      if (result.sent > 0) {
        toast.success(`Test push sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`);
        setPushStatus(result.message || "Push sent.");
      } else {
        const message = result.message || "No registered iPhone tokens found.";
        toast.error(message);
        setPushStatus(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send test push";
      toast.error(message);
      setPushStatus(message);
    } finally {
      setPushLoading(false);
    }
  }

  async function handleToggleBiometric() {
    if (bioBusy) return;
    setBioBusy(true);
    try {
      if (bioEnabled) {
        await disableBiometric();
        setBioEnabled(false);
        setBioStatus("Face ID is disabled on this device.");
        toast.success("Face ID disabled");
      } else {
        const phoneForBio = user?.phone || (phoneDigits ? `+91${phoneDigits}` : "");
        if (!phoneForBio) {
          toast.error("Sign in with your phone number before enabling Face ID.");
          return;
        }
        await enableBiometric(phoneForBio);
        setBioEnabled(true);
        setBioStatus("Face ID is enabled on this iPhone.");
        toast.success("Face ID enabled");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Face ID action failed";
      toast.error(message);
      setBioStatus(message);
    } finally {
      setBioBusy(false);
      void refreshBiometricStatus();
    }
  }

  async function copyNativeDiagnostics() {
    const payload = {
      runtime: getNativeRuntimeSnapshot(),
      push: getPushDebugStatus(),
      biometric: await getBiometricStatus(),
      logs: getNativeDebugLog(),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Native diagnostics copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success("Native diagnostics copied");
    }
  }

  function resetNativeDiagnostics() {
    clearNativeDebugLog();
    setNativeSnapshot(getNativeRuntimeSnapshot());
    toast.success("Native diagnostics cleared");
  }

  if (nativeOnly && !nativeSupported) return null;

  return (
    <div className={cn(
      "rounded-2xl border border-border bg-card shadow-sm",
      compact ? "p-4" : "p-5",
      className,
    )}>
      <div className={cn(
        "flex flex-col gap-4",
        compact ? "xl:flex-row xl:items-start xl:justify-between" : "lg:flex-row lg:items-start lg:justify-between",
      )}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold">Mobile app setup</h2>
          </div>
          <p className={cn("mt-1 text-sm text-muted-foreground", compact && "text-xs")}>
            Register this {deviceLabel} for push notifications and enable {biometricLabel} sign-in.
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>{pushStatus || (nativeSupported ? "Push status not checked yet." : "Open the installed mobile app to use push notifications.")}</p>
            <p>{bioStatus || (`${biometricLabel} status not checked yet.`)}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
            <Badge variant={nativeSnapshot.isNative ? "default" : "outline"}>
              Platform: {nativeSnapshot.platform}
            </Badge>
            <Badge variant={nativeSnapshot.biometricPluginAvailable ? "default" : "outline"}>
              Biometric plugin: {nativeSnapshot.biometricPluginAvailable ? "available" : "missing"}
            </Badge>
            <Badge variant={nativeSnapshot.pushPluginAvailable ? "default" : "outline"}>
              Push plugin: {nativeSnapshot.pushPluginAvailable ? "available" : "missing"}
            </Badge>
            <Badge variant={pushRegistered ? "default" : "outline"}>
              Push: {pushRegistered ? `${pushTokenCount || 1} registered` : "not registered"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRegisterPush} disabled={pushLoading || !nativeSupported}>
            {pushLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : pushRegistered ? <CheckCircle2 className="mr-1.5 h-4 w-4" /> : <Bell className="mr-1.5 h-4 w-4" />}
            {pushRegistered ? "Refresh device" : "Register device"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleTestPush} disabled={pushLoading}>
            {pushLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Bell className="mr-1.5 h-4 w-4" />}
            Send test push
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggleBiometric} disabled={bioBusy || !nativeSupported}>
            {bioBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-1.5 h-4 w-4" />}
            {bioEnabled ? `Disable ${biometricLabel}` : `Enable ${biometricLabel}`}
          </Button>
          <Button variant="secondary" size="sm" onClick={copyNativeDiagnostics}>
            <Clipboard className="mr-1.5 h-4 w-4" />
            Copy diagnostics
          </Button>
          <Button variant="ghost" size="sm" onClick={resetNativeDiagnostics}>
            Clear logs
          </Button>
        </div>
      </div>
    </div>
  );
}