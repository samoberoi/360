import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { fetchTodayPunch, pushTelemetry, readBattery, readNetworkType, distanceMeters } from "@/lib/self-attendance";
import { insertTrackPoint } from "@/lib/field-visits";

/** How often (ms) we push the officer's position while on duty. */
const BEACON_INTERVAL_MS = 30_000;
/** Minimum movement (m) before a new track point is stored. */
const MIN_MOVE_METERS = 15;
/** Re-check the punch state at this cadence so check-in/out is picked up without a reload. */
const PUNCH_POLL_MS = 60_000;

type Last = { lat: number; lng: number; at: number } | null;

/**
 * Global live-location beacon for field officers.
 *
 * Mounted once in the admin layout: while the signed-in field officer is on
 * duty (checked in, not checked out), their position is streamed to
 * `self_attendance_punches` telemetry on every screen — not only on Radar —
 * so viewers with Radar access see them move in real time. Track points are
 * appended when they actually move, keeping the day's trail meaningful.
 */
export function useLiveLocationBeacon() {
  const { candidateId, isFieldOfficer } = useCurrentUserRole();
  const punchRef = useRef<{ id: string; onDuty: boolean } | null>(null);
  const lastRef = useRef<Last>(null);

  useEffect(() => {
    if (!isFieldOfficer || !candidateId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    let watchId: number | null = null;
    let pushTimer: number | null = null;
    let punchTimer: number | null = null;
    let current: { lat: number; lng: number; accuracy: number | null } | null = null;

    async function refreshPunch() {
      try {
        const punch = await fetchTodayPunch(candidateId!);
        if (cancelled) return;
        punchRef.current = punch
          ? { id: punch.id, onDuty: !!punch.check_in_at && !punch.check_out_at }
          : null;
      } catch {
        /* keep the last known punch state */
      }
    }

    async function flush() {
      const punch = punchRef.current;
      if (!punch?.onDuty || !current) return;
      const geo = { lat: current.lat, lng: current.lng, accuracy: current.accuracy ?? 0 };
      try {
        const [battery, network] = await Promise.all([readBattery(), readNetworkType()]);
        await pushTelemetry(punch.id, { geo, battery, network });
      } catch {
        /* telemetry is best-effort */
      }
      const prev = lastRef.current;
      const moved = prev ? distanceMeters(prev, geo) : null;
      if (!prev || (moved != null && moved >= MIN_MOVE_METERS)) {
        try {
          await insertTrackPoint({
            candidateId: candidateId!,
            lat: geo.lat,
            lng: geo.lng,
            accuracy: geo.accuracy,
            visitId: null,
          });
        } catch {
          /* trail write is best-effort */
        }
      }
      lastRef.current = { lat: geo.lat, lng: geo.lng, at: Date.now() };
    }

    void refreshPunch();
    punchTimer = window.setInterval(() => void refreshPunch(), PUNCH_POLL_MS);

    watchId = navigator.geolocation.watchPosition(
      (p) => {
        current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
      },
      () => { /* permission denied or unavailable — stay silent */ },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );

    pushTimer = window.setInterval(() => void flush(), BEACON_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshPunch();
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (pushTimer) window.clearInterval(pushTimer);
      if (punchTimer) window.clearInterval(punchTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [candidateId, isFieldOfficer]);
}

/** Realtime subscription helper: run `onChange` whenever live punch telemetry changes. */
export function subscribeLivePunches(onChange: () => void) {
  const channel = supabase
    .channel(`live-punch-telemetry-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "self_attendance_punches" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
