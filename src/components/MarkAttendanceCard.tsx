import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, LogIn, LogOut, MapPin, Loader2, Clock, CheckCircle2, AlertTriangle, ExternalLink, Battery, BatteryCharging, Wifi, Signal, Radio } from "lucide-react";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { confirmAction, notifySaved } from "@/components/ConfirmProvider";
import {
  checkIn,
  checkOut,
  fetchTodayPunch,
  getCurrentPosition,
  verifyFaceForAttendance,
  distanceMeters,
  formatDistance,
  mapsUrl,
  pushTelemetry,
  readBattery,
  readNetworkType,
  DEVIATION_THRESHOLD_M,
  type SelfPunch,
} from "@/lib/self-attendance";
import { closeStaleVisits } from "@/lib/field-visits";

import { isNativePlatform } from "@/lib/native";
import { captureAndUploadSelfie, signedSelfieUrl } from "@/lib/selfie";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAttendanceRule } from "@/lib/attendance-rules";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { cn } from "@/lib/utils";

// In-memory reverse-geocode cache keyed by rounded coords.
const placeCache = new Map<string, string>();

function useReverseGeocode(lat: number | null | undefined, lng: number | null | undefined) {
  const [place, setPlace] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    if (lat == null || lng == null) { setPlace(null); return; }
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = placeCache.get(key);
    if (cached) { setPlace(cached); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
          { headers: { "Accept-Language": "en" } },
        );
        if (!res.ok) return;
        const j = (await res.json()) as { address?: Record<string, string>; display_name?: string };
        const a = j.address ?? {};
        const primary = a.neighbourhood || a.suburb || a.village || a.town || a.city_district || a.city || a.county;
        const secondary = a.city || a.town || a.state_district || a.state;
        const label = [primary, secondary && secondary !== primary ? secondary : null]
          .filter(Boolean)
          .join(", ") || (j.display_name?.split(",").slice(0, 2).join(",").trim() ?? null);
        if (!cancelledRef.current && label) {
          placeCache.set(key, label);
          setPlace(label);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelledRef.current = true; clearTimeout(t); };
  }, [lat, lng]);
  return place;
}

function MapLink({
  lat,
  lng,
  label,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  label?: string;
}) {
  const url = mapsUrl(lat, lng);
  const place = useReverseGeocode(lat, lng);
  if (!url || lat == null || lng == null) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex max-w-full flex-col gap-0.5 rounded-md text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      {place && (
        <span className="inline-flex min-w-0 items-start gap-1">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{place}</span>
        </span>
      )}
      <span className={cn("inline-flex items-center gap-1 truncate", place ? "pl-4 text-[10px] font-medium text-muted-foreground" : "")}>
        {!place && <MapPin className="h-3 w-3 shrink-0" />}
        {label ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        <ExternalLink className="h-2.5 w-2.5 opacity-70" />
      </span>
    </a>
  );
}

function AttendanceSelfie({ path, title }: { path: string | null | undefined; title: string }) {
  const [open, setOpen] = useState(false);
  const urlQ = useQuery({
    queryKey: ["attendance-selfie-url", path],
    enabled: Boolean(path),
    staleTime: 8 * 60_000,
    queryFn: () => signedSelfieUrl(path),
  });
  if (!path) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!urlQ.data}
        onClick={() => setOpen(true)}
        className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/40 p-0"
        aria-label={`View ${title.replace(/\s*photo$/i, "")} photo`}
      >
        {urlQ.data ? <img src={urlQ.data} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {urlQ.data && <img src={urlQ.data} alt={title} className="w-full rounded-xl" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function LiveTelemetryStrip({ punch }: { punch: SelfPunch }) {
  const url = mapsUrl(punch.last_lat ?? punch.check_in_lat, punch.last_lng ?? punch.check_in_lng);
  const seen = punch.last_seen_at ? new Date(punch.last_seen_at) : null;
  const secs = seen ? Math.max(0, Math.round((Date.now() - seen.getTime()) / 1000)) : null;
  const seenLabel = secs == null ? "waiting…" : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  const bat = punch.battery_pct;
  const batTone = bat == null ? "text-muted-foreground" : bat <= 20 ? "text-rose-600 dark:text-rose-400" : bat <= 40 ? "text-amber-600 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
  const net = punch.network_type;
  const NetIcon = net === "WiFi" ? Wifi : net === "5G" || net === "4G" ? Signal : Radio;
  return (
    <div className="mobile-glass-control mt-3 flex flex-col gap-2 rounded-xl border border-primary/20 bg-card/65 p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          LIVE · {seenLabel}
        </span>
        <span className={cn("inline-flex items-center gap-1", batTone)}>
          {punch.battery_charging ? <BatteryCharging className="h-3.5 w-3.5" /> : <Battery className="h-3.5 w-3.5" />}
          {bat == null ? "Battery n/a" : `${bat}%${punch.battery_charging ? " ⚡" : ""}`}
        </span>
        <span className="inline-flex items-center gap-1 text-foreground">
          <NetIcon className="h-3.5 w-3.5" />
          {net ?? "Network n/a"}
        </span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <MapPin className="h-4 w-4" />
          View live location
          <ExternalLink className="h-3 w-3 opacity-80" />
        </a>
      )}

    </div>
  );
}



function timeStr(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function currentTimeStr() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function elapsed(from: string | null, to?: string | null) {
  if (!from) return "";
  const end = to ? new Date(to).getTime() : Date.now();
  const ms = end - new Date(from).getTime();
  if (ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export type AllowedUnit = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Present attendance is only accepted at the primary unit. */
  isPrimary?: boolean;
};

export function MarkAttendanceCard({
  candidateId,
  compact,
  allowedUnits,
  proximityThresholdM = 300,
}: {
  candidateId: string | null;
  compact?: boolean;
  /** If provided, check-in is gated: user must be within `proximityThresholdM` of one of these units. */
  allowedUnits?: AllowedUnit[];
  proximityThresholdM?: number;
}) {
  const qc = useQueryClient();
  const role = useCurrentUserRole();
  // Every staff member with an employee profile can mark their own attendance.
  const canPunch = !role.isSuperAdmin && !!(candidateId ?? role.candidateId);
  const { rule: attendanceRule } = useAttendanceRule(role.roleKey);
  const faceRequired = attendanceRule.face_photo_required;
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nearby, setNearby] = useState<Array<{ unit: AllowedUnit; distance: number }>>([]);
  const [pendingGeo, setPendingGeo] = useState<{ geo: import("@/lib/self-attendance").Geo; face: boolean } | null>(null);
  const [locState, setLocState] = useState<"granted" | "denied" | "prompt" | "unavailable" | null>(null);
  const [askingLoc, setAskingLoc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { checkLocationPermission } = await import("@/lib/location-permission");
      const s = await checkLocationPermission();
      if (!cancelled) setLocState(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enableLocation = async () => {
    setAskingLoc(true);
    try {
      const { requestLocationPermission } = await import("@/lib/location-permission");
      const s = await requestLocationPermission();
      setLocState(s);
      if (s === "granted") {
        try {
          await getCurrentPosition();
          toast.success("Location is on");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Turn on GPS to continue");
        }
      } else if (s === "denied") {
        toast.error("Location is blocked. Allow location for this site in your browser or device settings.");
      } else if (s === "unavailable") {
        toast.error("This device cannot provide a location.");
      } else {
        toast.error("Could not get your location. Check that location is on, then try again.");
      }
    } finally {
      setAskingLoc(false);
    }
  };

  const punchQ = useQuery({
    queryKey: ["self-attendance-today", candidateId],
    enabled: !!candidateId,
    queryFn: () => {
      if (!candidateId) return null;
      return fetchTodayPunch(candidateId);
    },
    refetchInterval: 60_000,
  });

  const punch = punchQ.data as SelfPunch | null | undefined;
  const state: "idle" | "in" | "done" = !punch
    ? "idle"
    : punch.check_out_at
    ? "done"
    : "in";

  const gated = Array.isArray(allowedUnits);

  const openVisitQ = useQuery({
    queryKey: ["fo-open-visit", candidateId],
    enabled: !!candidateId,
    queryFn: async () => {
      if (!candidateId) return null;
      // Sweep first: any visit left open on an earlier day is auto-closed at
      // 23:59 of its own date, so it can never block logout again.
      try { await closeStaleVisits(candidateId); } catch { /* noop */ }
      // Only today's open visit can block logout — a visit left open on an
      // earlier day is invisible in Radar and would lock the officer out forever.
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const todayIso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const { data, error } = await supabase
        .from("field_visits" as never)
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("visit_date", todayIso)
        .is("check_out_at", null)
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as { id: string } | null) ?? null;
    },
  });

  const confirmPunch = (action: "in" | "out", location: string) => confirmAction({
    title: action === "in" ? "Confirm log in" : "Confirm log out",
    description: `${currentTimeStr()} · ${location}`,
    confirmText: action === "in" ? "Log in" : "Log out",
    cancelText: "Not now",
  });

  const showPunchError = (action: "in" | "out", error: unknown) => confirmAction({
    title: action === "in" ? "Unable to log in" : "Unable to log out",
    description: error instanceof Error ? error.message : `${action === "in" ? "Login" : "Logout"} could not be completed.`,
    confirmText: "Got it",
    hideCancel: true,
    tone: "warning",
  });

  const performCheckIn = async (unitId: string | null, geo: import("@/lib/self-attendance").Geo | null, face: boolean) => {
    if (!candidateId) throw new Error("Profile not ready.");
    if (!geo) throw new Error("Location is required.");
    const site = (allowedUnits ?? []).find((u) => u.id === unitId)?.name ?? null;
    const selfiePath = faceRequired ? await captureAndUploadSelfie({ label: "Log in", candidateId, geo, site }, "login") : null;
    const [row, battery, network] = await Promise.allSettled([
      checkIn(candidateId, geo, face, unitId, selfiePath),
      readBattery(),
      readNetworkType(),
    ]);
    if (row.status !== "fulfilled") throw row.reason;
    await pushTelemetry(row.value.id, {
      geo,
      battery: battery.status === "fulfilled" ? battery.value : null,
      network: network.status === "fulfilled" ? network.value : null,
    });
    return row.value;
  };

  const inMut = useMutation({
    mutationFn: async () => {
      if (!candidateId) throw new Error("Profile not ready.");
      if (!canPunch) throw new Error("Only field officers can log in and log out from their location.");
      let face = false;
      if (isNativePlatform()) {
        face = await verifyFaceForAttendance("Attendance login", faceRequired);
      }
      // Location is MANDATORY for every attendance punch. Attendance cannot be
      // marked while GPS / location permission is off.
      const geo: import("@/lib/self-attendance").Geo = await getCurrentPosition();

      if (gated) {
        const units = (allowedUnits ?? []).filter((u) => u.latitude != null && u.longitude != null);
        if (units.length === 0) {
          throw new Error("No client locations are configured for you. Ask your admin to set client coordinates.");
        }
        const withDist = units
          .map((u) => ({
            unit: u,
            distance: distanceMeters({ lat: geo!.lat, lng: geo!.lng }, { lat: u.latitude as number, lng: u.longitude as number }) ?? Number.POSITIVE_INFINITY,
          }))
          .sort((a, b) => a.distance - b.distance);

        // More than one assigned unit → the person always chooses where they are.
        if (withDist.length > 1) {
          setNearby(withDist);
          setPendingGeo({ geo, face });
          setPickerOpen(true);
          return null;
        }

        const only = withDist[0];
        if (only.distance > proximityThresholdM) {
          throw new Error(
            `You are ${formatDistance(only.distance)} from ${only.unit.name}. Move within ${proximityThresholdM}m and try again.`,
          );
        }
        const confirmed = await confirmPunch("in", only.unit.name);
        if (!confirmed) return null;
        return await performCheckIn(only.unit.id, geo, face);
      }

      const confirmed = await confirmPunch("in", "Current GPS location");
      if (!confirmed) return null;
      return await performCheckIn(null, geo, face);
    },
    onSuccess: (row) => {
      if (!row) return; // waiting for user to pick unit
      void notifySaved({
        title: "Logged in",
        description: `${timeStr(row.check_in_at)} · ${(allowedUnits ?? []).find((u) => u.id === row.unit_id)?.name ?? "Current GPS location"}`,
        actionText: "Done",
      });
      void qc.invalidateQueries({ queryKey: ["self-attendance-today", candidateId] });
      void qc.invalidateQueries({ queryKey: ["self-attendance-month", candidateId] });
    },
    onError: (e: unknown) => { void showPunchError("in", e); },
    onSettled: () => setBusy(null),
  });

  const confirmUnitMut = useMutation({
    mutationFn: async (unitId: string) => {
      if (!pendingGeo) throw new Error("Location expired. Try again.");
      const picked = nearby.find((item) => item.unit.id === unitId);
      const unitName = picked?.unit.name ?? "Assigned unit";
      if (picked && picked.distance > proximityThresholdM) {
        throw new Error(
          `You are ${formatDistance(picked.distance)} from ${unitName}. Move within ${proximityThresholdM}m of it and try again.`,
        );
      }
      const confirmed = await confirmPunch("in", unitName);
      if (!confirmed) return null;
      return await performCheckIn(unitId, pendingGeo.geo, pendingGeo.face);
    },
    onSuccess: (row) => {
      if (!row) return;
      void notifySaved({
        title: "Logged in",
        description: `${timeStr(row.check_in_at)} · ${nearby.find((item) => item.unit.id === row.unit_id)?.unit.name ?? "Assigned unit"}`,
        actionText: "Done",
      });
      setPickerOpen(false);
      setPendingGeo(null);
      setNearby([]);
      void qc.invalidateQueries({ queryKey: ["self-attendance-today", candidateId] });
      void qc.invalidateQueries({ queryKey: ["self-attendance-month", candidateId] });
    },
    onError: (e: unknown) => { void showPunchError("in", e); },
  });


  const outMut = useMutation({
    mutationFn: async () => {
      if (!punch?.id) throw new Error("No active attendance login.");
      if (!canPunch) throw new Error("Only field officers can log in and log out from their location.");
      if (openVisitQ.data?.id) throw new Error("Complete your active client visit before logging out.");
      let face = false;
      if (isNativePlatform()) {
        face = await verifyFaceForAttendance("Attendance logout", faceRequired);
      }
      const geo = await getCurrentPosition();
      const nearest = (allowedUnits ?? [])
        .filter((unit) => unit.latitude != null && unit.longitude != null)
        .map((unit) => ({
          unit,
          distance: distanceMeters({ lat: geo.lat, lng: geo.lng }, { lat: unit.latitude as number, lng: unit.longitude as number }) ?? Number.POSITIVE_INFINITY,
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      const confirmed = await confirmPunch("out", nearest?.unit.name ?? "Current GPS location");
      if (!confirmed) return null;
      const selfiePath = !faceRequired ? null : await captureAndUploadSelfie(
        { label: "Log out", candidateId: punch.candidate_id, geo, site: nearest?.unit.name ?? null },
        "logout",
      );
      return await checkOut(punch.id, geo, face, selfiePath);
    },
    onSuccess: (row) => {
      if (!row) return;
      const location = (allowedUnits ?? []).find((unit) => unit.id === punch?.unit_id)?.name ?? "Current GPS location";
      void notifySaved({
        title: "Logged out",
        description: `${timeStr(row.check_out_at)} · ${location}`,
        actionText: "Done",
      });
      void qc.invalidateQueries({ queryKey: ["self-attendance-today", candidateId] });
      void qc.invalidateQueries({ queryKey: ["self-attendance-month", candidateId] });
    },
    onError: (e: unknown) => { void showPunchError("out", e); },
    onSettled: () => setBusy(null),
  });

  const duration = useMemo(
    () => (punch?.check_in_at ? elapsed(punch.check_in_at, punch.check_out_at) : ""),
    [punch?.check_in_at, punch?.check_out_at],
  );

  // While checked-in, push live location + battery + network every 45s.
  useEffect(() => {
    if (state !== "in" || !punch?.id) return;
    let cancelled = false;
    const send = async () => {
      try {
        const [geo, battery, network] = await Promise.allSettled([
          getCurrentPosition(),
          readBattery(),
          readNetworkType(),
        ]);
        if (cancelled) return;
        await pushTelemetry(punch.id, {
          geo: geo.status === "fulfilled" ? geo.value : null,
          battery: battery.status === "fulfilled" ? battery.value : null,
          network: network.status === "fulfilled" ? network.value : null,
        });
        void qc.invalidateQueries({ queryKey: ["self-attendance-today", candidateId] });
      } catch {
        /* ignore transient errors */
      }
    };
    void send();
    const t = setInterval(send, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [state, punch?.id, candidateId, qc]);


  const pillClass =
    state === "done"
      ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20"
      : state === "in"
      ? "bg-amber-500/10 text-amber-600 ring-amber-500/20"
      : "bg-destructive/10 text-destructive ring-destructive/20";

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card/90 shadow-sm backdrop-blur-xl sm:rounded-3xl",
        compact ? "p-3.5 sm:p-4" : "p-3.5 sm:p-6",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 sm:gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Fingerprint className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Today</div>
            <h3 className="mt-0.5 text-lg font-bold text-foreground sm:text-xl">My attendance</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
              {isNativePlatform() ? "Biometric and GPS check." : "GPS check. Biometric is available in the app."}
            </p>
          </div>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 sm:px-2.5 sm:text-[11px]", pillClass)}>
          {state === "done" ? (
            <><CheckCircle2 className="h-3.5 w-3.5" /> Completed</>
          ) : state === "in" ? (
            <><Clock className="h-3.5 w-3.5" /> On duty {duration ? `· ${duration}` : ""}</>
          ) : (
            <><Fingerprint className="h-3.5 w-3.5" /> Not marked</>
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-border/50 bg-background/40 p-2 sm:p-2.5">
          <AttendanceSelfie path={punch?.check_in_selfie_path} title="Log in photo" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Log in</div>
            <div className="mt-0.5 font-display text-base font-bold tabular-nums text-foreground sm:text-lg">
              {timeStr(punch?.check_in_at ?? null)}
            </div>
            {punch?.check_in_lat != null && (
              <div className="mt-1 truncate">
                <MapLink lat={punch.check_in_lat} lng={punch.check_in_lng} />
              </div>
            )}
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-border/50 bg-background/40 p-2 sm:p-2.5">
          <AttendanceSelfie path={punch?.check_out_selfie_path} title="Log out photo" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Log out</div>
            <div className="mt-0.5 font-display text-base font-bold tabular-nums text-foreground sm:text-lg">
              {timeStr(punch?.check_out_at ?? null)}
            </div>
            {punch?.check_out_lat != null && (
              <div className="mt-1 truncate">
                <MapLink lat={punch.check_out_lat} lng={punch.check_out_lng} />
              </div>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const dist = distanceMeters(
          punch?.check_in_lat != null && punch?.check_in_lng != null ? { lat: punch.check_in_lat, lng: punch.check_in_lng } : null,
          punch?.check_out_lat != null && punch?.check_out_lng != null ? { lat: punch.check_out_lat, lng: punch.check_out_lng } : null,
        );
        if (dist == null) return null;
        const deviated = dist > DEVIATION_THRESHOLD_M;
        return (
          <div
            className={cn(
              "mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold ring-1",
              deviated
                ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
            )}
          >
            {deviated ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            <span className="min-w-0 flex-1 truncate">
              {deviated ? "Location deviation" : "Same location"} · in → out is {formatDistance(dist)}
            </span>
          </div>
        );
      })()}

      {gated && (allowedUnits?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/40 p-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assigned unit{(allowedUnits?.length ?? 0) > 1 ? "s" : ""} · reference location
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground">
              within {proximityThresholdM}m
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {(allowedUnits ?? []).map((u) => {
              const hasCoords = u.latitude != null && u.longitude != null;
              const ref = hasCoords
                ? { lat: u.latitude as number, lng: u.longitude as number }
                : null;
              const here =
                punch?.last_lat != null && punch?.last_lng != null
                  ? { lat: punch.last_lat, lng: punch.last_lng }
                  : punch?.check_in_lat != null && punch?.check_in_lng != null
                  ? { lat: punch.check_in_lat, lng: punch.check_in_lng }
                  : null;
              const d = ref && here ? distanceMeters(here, ref) : null;
              const within = d != null && d <= proximityThresholdM;
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/40 bg-card/60 px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-foreground">{u.name}</div>
                    {hasCoords ? (
                      <MapLink lat={u.latitude} lng={u.longitude} />
                    ) : (
                      <div className="text-[10px] italic text-muted-foreground">No coordinates set</div>
                    )}
                  </div>
                  {d != null && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
                        within
                          ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
                      )}
                    >
                      {formatDistance(d)} away
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {state === "in" && punch && <LiveTelemetryStrip punch={punch} />}

      {locState && locState !== "granted" && state !== "done" && (
        <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[11px] font-semibold text-destructive">
            {locState === "unavailable"
              ? "Location is not available on this device — attendance needs GPS."
              : "Location (GPS) is off. Attendance cannot be marked until you turn it on."}
          </p>
          {locState !== "unavailable" && (
            <Button
              size="sm"
              variant="outline"
              className="col-span-2 h-9 w-full rounded-lg text-xs font-semibold sm:w-auto"
              disabled={askingLoc}
              onClick={() => void enableLocation()}
            >
              {askingLoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              Turn on GPS
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 sm:mt-4">
        {!role.isLoading && !canPunch && state !== "done" && (
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">
            Only field officers can log in and log out from their location.
          </div>
        )}
        {canPunch && state === "idle" && (
          <Button
            className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm sm:h-12"
            disabled={!candidateId || inMut.isPending || busy === "in" || locState === "denied" || locState === "unavailable"}
            onClick={() => { setBusy("in"); inMut.mutate(); }}
          >
            {inMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Log in now
          </Button>
        )}
        {canPunch && state === "in" && (
          <Button
            className="h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600/90 sm:h-12"
            disabled={outMut.isPending || busy === "out" || locState === "denied" || locState === "unavailable"}
            onClick={() => { setBusy("out"); outMut.mutate(); }}
          >
            {outMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Log out
          </Button>
        )}
        {state === "done" && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-center text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            Attendance recorded for today · {duration}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          onClick={() => !confirmUnitMut.isPending && setPickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Select unit</div>
            <h4 className="mt-0.5 font-display text-base font-bold text-foreground">Where are you logging in?</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick your unit. You must be within {proximityThresholdM}m of it.
            </p>
            <div className="mt-3 space-y-2">
              {nearby.map((n) => {
                const inRange = n.distance <= proximityThresholdM;
                return (
                  <button
                    key={n.unit.id}
                    type="button"
                    disabled={confirmUnitMut.isPending}
                    onClick={() => confirmUnitMut.mutate(n.unit.id)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium text-foreground disabled:opacity-60",
                      inRange
                        ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
                        : "border-border/60 bg-background/60 hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2">{n.unit.name}</span>
                      <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {n.unit.isPrimary ? "Primary" : "Extra duty"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                        inRange ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {inRange ? formatDistance(n.distance) : `${formatDistance(n.distance)} away`}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              className="mt-3 h-9 w-full text-xs"
              onClick={() => setPickerOpen(false)}
              disabled={confirmUnitMut.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
