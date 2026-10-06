import { captureAndUploadSelfie } from "@/lib/selfie";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Flag,
  Loader2,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Search,
  Star,
  X,
} from "lucide-react";


import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/SignaturePad";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { capturePhoto } from "@/lib/native-camera";
import { isNativePlatform } from "@/lib/native";
import {
  distanceMeters,
  formatDistance,
  getCurrentPosition,
  mapsUrl,
  pushTelemetry,
  readBattery,
  readNetworkType,
  verifyFaceForAttendance,
  type Geo,
} from "@/lib/self-attendance";
import {
  closeStaleVisits,
  completeVisit,
  createVisit,
  fetchLastVisitPerUnit,
  fetchMonthVisitCounts,
  fetchTodayTrackPoints,
  fetchTodayVisits,
  fetchVisitsInRange,
  findNearestUnit,
  insertTrackPoint,
  resolveRange,
  signedProofUrl,
  uploadVisitProof,
  RANGE_PRESETS,
  type FieldVisit,
  type RangePreset,
} from "@/lib/field-visits";
import { OfficerDayMap } from "@/components/OfficerDayMap";
import { VisitDetailDialog } from "@/components/VisitDetailDialog";
import { FieldSenseRangeFilter } from "@/components/FieldSenseRangeFilter";
import {
  acknowledgeFieldVisitRequest,
  completeFieldVisitRequestForUnit,
  completeFieldVisitRequestByVisit,
  listOpenRequestsForCandidate,
  type FieldVisitRequest,
} from "@/lib/field-visit-requests";


type FoUnit = {
  unit_id: string;
  unit_name: string;
  unit_code: string | null;
  customer_name: string | null;
  branch_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const TRACK_INTERVAL_MS = 15_000;
const NEAREST_MAX_METERS = 500;
/** How close a field officer must be to a known site to mark a visit. */
const SITE_GEOFENCE_METERS = 300;
/** GPS drift allowance added on top of the geofence, capped so it can't be abused. */
const MAX_ACCURACY_ALLOWANCE_M = 150;
/** Above this GPS uncertainty we do not trust the reading enough to save it on the site. */
const MAX_CAPTURE_ACCURACY_M = 200;

function geofenceAllowanceMeters(accuracy: number | null | undefined): number {
  const acc = typeof accuracy === "number" && Number.isFinite(accuracy) ? Math.max(0, accuracy) : 0;
  return SITE_GEOFENCE_METERS + Math.min(acc, MAX_ACCURACY_ALLOWANCE_M);
}

type RouteCoord = {
  lat: number;
  lng: number;
  at: string;
  kind: "punch-in" | "track" | "visit-in" | "visit-out" | "current" | "punch-out";
};

function hasGeo(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);
}

function pushRouteCoord(points: RouteCoord[], point: RouteCoord | null) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
  const prev = points[points.length - 1];
  if (prev) {
    const d = distanceMeters({ lat: prev.lat, lng: prev.lng }, { lat: point.lat, lng: point.lng }) ?? 0;
    if (d < 8 && prev.kind === point.kind) return;
  }
  points.push(point);
}

function unitGeo(unit: FoUnit | null | undefined): { lat: number; lng: number } | null {
  if (!unit || unit.latitude == null || unit.longitude == null) return null;
  const lat = Number(unit.latitude);
  const lng = Number(unit.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function whenAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function todayPunchDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Units come from the pre-joined `field_officer_scope` projection through
 * `get_my_field_scope()` — one indexed lookup by candidate id, no master-table
 * scans. The projection is kept current by database triggers on unit mappings,
 * scope assignments, units and organizations, so reads never recompute scope.
 */
type ScopeRow = {
  unit_id: string;
  unit_name: string;
  unit_code: string | null;
  customer_name: string | null;
  branch_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

const foUnitsCacheKey = (candidateId: string) => `radiant:fo-units:${candidateId}`;

function readUnitsSnapshot(candidateId: string): FoUnit[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(foUnitsCacheKey(candidateId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as FoUnit[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeUnitsSnapshot(candidateId: string, units: FoUnit[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(foUnitsCacheKey(candidateId), JSON.stringify(units));
  } catch {
    /* storage full or unavailable — cache is best-effort */
  }
}

function toFoUnits(rows: ScopeRow[]): FoUnit[] {
  return rows.map((r) => ({
    unit_id: r.unit_id,
    unit_name: r.unit_name,
    unit_code: r.unit_code,
    customer_name: r.customer_name,
    branch_name: r.branch_name,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

async function loadFoUnits(candidateId: string): Promise<FoUnit[]> {
  const me = await supabase.rpc("current_user_candidate_id" as never);
  if ((me.data as string | null) !== candidateId) {
    // Viewer is an admin/manager looking at another officer: load THAT officer's sites.
    const cu = await supabase.from("candidate_units" as never).select("unit_id").eq("candidate_id", candidateId);
    const ids = (((cu.data ?? []) as unknown) as Array<{ unit_id: string }>).map((r) => r.unit_id);
    const fv = await supabase.from("field_visits" as never).select("unit_id").eq("candidate_id", candidateId).limit(1000);
    for (const r of ((fv.data ?? []) as unknown) as Array<{ unit_id: string }>) if (!ids.includes(r.unit_id)) ids.push(r.unit_id);
    if (!ids.length) return [];
    const { data: us } = await supabase
      .from("units" as never)
      .select("id, name, code, shipping_address1, latitude, longitude, customers(name)")
      .in("id", ids);
    return ((((us ?? []) as unknown) as Array<{ id: string; name: string; code: string | null; shipping_address1: string | null; latitude: number | null; longitude: number | null; customers: { name: string } | null }>)).map((u) => ({
      unit_id: u.id,
      unit_name: u.name,
      unit_code: u.code,
      customer_name: u.customers?.name ?? null,
      branch_name: null,
      address: u.shipping_address1,
      latitude: u.latitude,
      longitude: u.longitude,
    })) as FoUnit[];
  }
  const { data, error } = await supabase.rpc("get_my_field_scope" as never);
  let rows = ((data ?? []) as unknown) as ScopeRow[];
  if (error) throw error;
  // Self-heal a cold projection row (first login after a mapping import).
  if (rows.length === 0) {
    const fresh = await supabase.rpc("get_my_field_scope_fresh" as never);
    rows = ((fresh.data ?? []) as unknown) as ScopeRow[];
  }
  const units = toFoUnits(rows);
  // Operations manager: his check-in list is the union of every site mapped to
  // the field officers reporting to him (candidate_reporting_managers →
  // candidate_units), merged with anything assigned to him directly.
  const { data: meRow } = await supabase
    .from("candidates" as never)
    .select("role_key")
    .eq("id", candidateId)
    .maybeSingle();
  if (((meRow as unknown) as { role_key?: string } | null)?.role_key === "operations_manager") {
    const { data: reportees } = await supabase
      .from("candidate_reporting_managers" as never)
      .select("candidate_id")
      .eq("manager_id", candidateId);
    const foIds = (((reportees ?? []) as unknown) as Array<{ candidate_id: string }>).map((r) => r.candidate_id);
    if (foIds.length) {
      const { data: cu } = await supabase
        .from("candidate_units" as never)
        .select("unit_id")
        .in("candidate_id", foIds);
      const have = new Set(units.map((u) => u.unit_id));
      const missing = [...new Set((((cu ?? []) as unknown) as Array<{ unit_id: string }>).map((r) => r.unit_id))].filter(
        (id) => !have.has(id),
      );
      if (missing.length) {
        const { data: extra } = await supabase
          .from("units" as never)
          .select("id, name, code, shipping_address1, latitude, longitude, customers(name)")
          .in("id", missing);
        for (const u of ((extra ?? []) as unknown) as Array<{ id: string; name: string; code: string | null; shipping_address1: string | null; latitude: number | null; longitude: number | null; customers: { name: string } | null }>) {
          units.push({
            unit_id: u.id,
            unit_name: u.name,
            unit_code: u.code,
            customer_name: u.customers?.name ?? null,
            branch_name: null,
            address: u.shipping_address1,
            latitude: u.latitude,
            longitude: u.longitude,
          } as FoUnit);
        }
      }
    }
  }
  // Always include the officer's own home/base unit (e.g. head office) so
  // office visits can be logged — driven by candidates.unit_id, not hardcoded.
  try {
    const { data: homeRow } = await supabase
      .from("candidates" as never)
      .select("unit_id")
      .eq("id", candidateId)
      .maybeSingle();
    const homeId = ((homeRow as unknown) as { unit_id?: string | null } | null)?.unit_id;
    if (homeId && !units.some((u) => u.unit_id === homeId)) {
      const { data: hu } = await supabase
        .from("units" as never)
        .select("id, name, code, shipping_address1, latitude, longitude, customers(name)")
        .eq("id", homeId)
        .maybeSingle();
      const u = (hu as unknown) as { id: string; name: string; code: string | null; shipping_address1: string | null; latitude: number | null; longitude: number | null; customers: { name: string } | null } | null;
      if (u) {
        units.unshift({
          unit_id: u.id,
          unit_name: u.name,
          unit_code: u.code,
          customer_name: u.customers?.name ?? null,
          branch_name: null,
          address: u.shipping_address1,
          latitude: u.latitude,
          longitude: u.longitude,
        } as FoUnit);
      }
    }
  } catch {
    /* non-fatal */
  }
  writeUnitsSnapshot(candidateId, units);
  return units;
}

function ProofThumb({ path, label }: { path: string | null | undefined; label: string }) {
  const q = useQuery({
    queryKey: ["fv-proof", path],
    enabled: !!path,
    staleTime: 8 * 60_000,
    queryFn: async () => (await supabase.storage.from("field-visit-proofs").createSignedUrl(path!, 600)).data?.signedUrl ?? null,
  });
  return (
    <div className="flex flex-col items-center gap-1">
      {q.data ? (
        <a href={q.data} target="_blank" rel="noreferrer">
          <img src={q.data} alt={label} className="h-16 w-16 rounded-md border border-border bg-background object-cover" />
        </a>
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-[9px] text-muted-foreground">
          {path ? "…" : "None"}
        </div>
      )}
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function GeoLink({ label, lat, lng }: { label: string; lat: number | null; lng: number | null }) {
  if (lat == null || lng == null) return <span className="text-muted-foreground">{label}: —</span>;
  return (
    <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${lat},${lng}`}>
      {label}: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
    </a>
  );
}



export function FieldOfficerFieldSense({ candidateId, viewDate }: { candidateId: string; viewDate?: string }) {
  const effectiveDate = viewDate ?? todayPunchDate();
  const isHistorical = !!viewDate && viewDate !== todayPunchDate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    range?: string;
    start?: string;
    end?: string;
    highlight?: string;
    action?: string;
  };
  const presetInput = (search.range as RangePreset | undefined) ?? "today";
  const validPreset: RangePreset = (
    ["today", "yesterday", "this_week", "this_month", "last_month", "last_quarter", "custom"] as RangePreset[]
  ).includes(presetInput) ? presetInput : "today";
  const rangeInfo = useMemo(
    () => resolveRange(validPreset, search.start ?? null, search.end ?? null),
    [validPreset, search.start, search.end],
  );
  const highlight = (search.highlight as "most" | "least" | "unvisited" | undefined) ?? undefined;
  const setRange = (preset: RangePreset, extra?: { start?: string; end?: string; highlight?: string | null }) => {
    void navigate({
      to: "/admin/field-sense",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        range: preset,
        start: preset === "custom" ? extra?.start ?? (prev.start as string | undefined) : undefined,
        end: preset === "custom" ? extra?.end ?? (prev.end as string | undefined) : undefined,
        highlight: extra?.highlight === null ? undefined : extra?.highlight ?? (prev.highlight as string | undefined),
      }),
      replace: true,
    });
  };

  const [pos, setPos] = useState<Geo | null>(null);
  const [posError, setPosError] = useState<string | null>(null);

  // Data — paints from the last known units instantly, refreshes silently.
  const unitsQ = useQuery({
    queryKey: ["fo-fs-units", candidateId],
    queryFn: () => loadFoUnits(candidateId),
    initialData: () => readUnitsSnapshot(candidateId),
    staleTime: 60_000,
    refetchOnMount: "always",
    placeholderData: (prev) => prev,
  });

  const punchQ = useQuery({
    queryKey: ["fo-fs-punch", candidateId, effectiveDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("self_attendance_punches" as never)
        .select("id, check_in_at, check_in_lat, check_in_lng, check_out_at, check_out_lat, check_out_lng, distance_km")
        .eq("candidate_id", candidateId)
        .eq("punch_date", effectiveDate)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as {
        id: string;
        check_in_at: string | null;
        check_in_lat: number | null;
        check_in_lng: number | null;
        check_out_at: string | null;
        check_out_lat: number | null;
        check_out_lng: number | null;
        distance_km: number | string | null;
      } | null) ?? null;
    },
    refetchInterval: isHistorical ? false : 30_000,
  });
  const visitsQ = useQuery({
    queryKey: ["fo-fs-visits", candidateId, effectiveDate],
    queryFn: async () => {
      // Sweep: any visit left open on an earlier day is auto-closed at
      // 23:59 of its own date before we render the list.
      try { await closeStaleVisits(candidateId); } catch { /* noop */ }
      return fetchTodayVisits(candidateId, effectiveDate);
    },
    refetchInterval: isHistorical ? false : 30_000,
  });
  // At midnight, shut down any visit still open — no visit survives past 12 am.
  useEffect(() => {
    if (isHistorical) return;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    const timer = window.setTimeout(async () => {
      try { await closeStaleVisits(candidateId); } catch { /* noop */ }
      qc.invalidateQueries({ queryKey: ["fo-fs-visits", candidateId] });
      qc.invalidateQueries({ queryKey: ["fo-open-visit", candidateId] });
    }, midnight.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [candidateId, isHistorical, qc]);
  const monthCountsQ = useQuery({
    queryKey: ["fo-fs-month-counts", candidateId, effectiveDate.slice(0, 7)],
    queryFn: () => fetchMonthVisitCounts(candidateId),
    staleTime: 60_000,
  });
  const lastVisitQ = useQuery({
    queryKey: ["fo-fs-last-visit", candidateId],
    queryFn: () => fetchLastVisitPerUnit(candidateId),
    staleTime: 60_000,
  });
  const trackQ = useQuery({
    queryKey: ["fo-fs-track", candidateId, effectiveDate],
    queryFn: () => fetchTodayTrackPoints(candidateId, effectiveDate),
    refetchInterval: isHistorical ? false : 15_000,
  });
  const rangeVisitsQ = useQuery({
    queryKey: ["fo-fs-range-visits", candidateId, rangeInfo.start, rangeInfo.end],
    queryFn: () => fetchVisitsInRange(candidateId, rangeInfo.start, rangeInfo.end),
    staleTime: 30_000,
  });
  const requestsQ = useQuery({
    queryKey: ["fo-fs-requests", candidateId],
    queryFn: () => listOpenRequestsForCandidate(candidateId),
    refetchInterval: isHistorical ? false : 20_000,
    enabled: !isHistorical,
  });

  // Only the officer themselves can record a visit (enforced in the database
  // too). Viewers with Radar access see the same day read-only.
  const myCandidateQ = useQuery({
    queryKey: ["my-candidate-id"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_user_candidate_id" as never);
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });
  const isSelf = !myCandidateQ.isLoading && myCandidateQ.data === candidateId;
  const units = unitsQ.data ?? [];
  const visits = visitsQ.data ?? [];
  const openVisit = visits.find((v) => !v.check_out_at) ?? null;
  const completedCount = visits.filter((v) => v.check_out_at).length;
  const isOnDuty = !!punchQ.data?.check_in_at && !punchQ.data?.check_out_at;
  const openVisitUnit = useMemo(
    () => (openVisit ? units.find((u) => u.unit_id === openVisit.unit_id) ?? null : null),
    [openVisit, units],
  );
  const snappedPosition = useMemo(() => unitGeo(openVisitUnit) ?? (isSelf ? pos : null), [openVisitUnit, pos, isSelf]);

  // Initial geolocation + polling for telemetry + track points (live only)
  useEffect(() => {
    // Only the officer's own device reads GPS; viewers must never inject their position.
    if (isHistorical || !isSelf) return;
    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      try {
        const geo = await getCurrentPosition();
        if (cancelled) return;
        setPos(geo);
        setPosError(null);

        // Only write track points + telemetry if on duty
        if (isOnDuty && punchQ.data?.id) {
          try {
            const [bat, net] = await Promise.all([readBattery(), readNetworkType()]);
            await pushTelemetry(punchQ.data.id, { geo, battery: bat, network: net });
          } catch { /* noop */ }
          try {
            await insertTrackPoint({
              candidateId,
              lat: geo.lat,
              lng: geo.lng,
              accuracy: geo.accuracy,
              visitId: openVisit?.id ?? null,
            });
            void qc.invalidateQueries({ queryKey: ["fo-fs-track", candidateId, todayPunchDate()] });
          } catch { /* noop */ }
        }
      } catch (err) {
        if (!cancelled) setPosError(err instanceof Error ? err.message : "Location unavailable");
      }
    }

    void tick();
    timer = window.setInterval(() => void tick(), TRACK_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [candidateId, isOnDuty, isSelf, punchQ.data?.id, openVisit?.id, qc]);

  const track = trackQ.data ?? [];
  const routeCoords = useMemo(() => {
    const points: RouteCoord[] = [];
    const punch = punchQ.data;
    if (punch?.check_in_at && hasGeo(punch.check_in_lat, punch.check_in_lng)) {
      pushRouteCoord(points, {
        lat: Number(punch.check_in_lat),
        lng: Number(punch.check_in_lng),
        at: punch.check_in_at,
        kind: "punch-in",
      });
    }

    const events: RouteCoord[] = [];
    const hasVisitWaypoints = visits.length > 0;
    if (!hasVisitWaypoints) {
      for (const t of track) {
        events.push({
          lat: Number(t.lat),
          lng: Number(t.lng),
          at: t.recorded_at,
          kind: "track",
        });
      }
    }
    for (const v of visits) {
      const unit = units.find((u) => u.unit_id === v.unit_id) ?? null;
      const geo = unitGeo(unit);
      const siteLat = geo?.lat ?? v.check_in_lat;
      const siteLng = geo?.lng ?? v.check_in_lng;
      if (v.check_in_at && hasGeo(siteLat, siteLng)) {
        events.push({ lat: Number(siteLat), lng: Number(siteLng), at: v.check_in_at, kind: "visit-in" });
      }
      const outLat = geo?.lat ?? v.check_out_lat;
      const outLng = geo?.lng ?? v.check_out_lng;
      if (v.check_out_at && hasGeo(outLat, outLng)) {
        events.push({ lat: Number(outLat), lng: Number(outLng), at: v.check_out_at, kind: "visit-out" });
      }
    }
    if (snappedPosition && isOnDuty) {
      events.push({ lat: snappedPosition.lat, lng: snappedPosition.lng, at: new Date().toISOString(), kind: "current" });
    }
    if (punch?.check_out_at && hasGeo(punch.check_out_lat, punch.check_out_lng)) {
      events.push({
        lat: Number(punch.check_out_lat),
        lng: Number(punch.check_out_lng),
        at: punch.check_out_at,
        kind: "punch-out",
      });
    }

    events
      .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng) && !!event.at)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .forEach((event) => pushRouteCoord(points, event));

    return points;
  }, [isOnDuty, punchQ.data, snappedPosition, track, units, visits]);

  // Active-visit route: check-in origin → current position → destination unit.
  // Simulates a live navigation trail so the FO can see the intended route + km to destination.
  const distanceToDest = useMemo(() => {
    if (!openVisitUnit || openVisitUnit.latitude == null || openVisitUnit.longitude == null) return null;
    const from = snappedPosition ?? (openVisit && openVisit.check_in_lat != null && openVisit.check_in_lng != null
      ? { lat: Number(openVisit.check_in_lat), lng: Number(openVisit.check_in_lng) }
      : null);
    if (!from) return null;
    return distanceMeters(from, { lat: Number(openVisitUnit.latitude), lng: Number(openVisitUnit.longitude) });
  }, [openVisit, openVisitUnit, snappedPosition]);


  // Distance list from current position
  const distances = useMemo(() => {
    if (!snappedPosition) return [];
    return units
      .filter((u) => u.latitude != null && u.longitude != null)
      .map((u) => ({
        unit: u,
        d: distanceMeters(snappedPosition, { lat: Number(u.latitude), lng: Number(u.longitude) }) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.d - b.d);
  }, [snappedPosition, units]);

  // Total kms today
  const routeKm = useMemo(() => {
    if (routeCoords.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < routeCoords.length; i += 1) {
      const a = routeCoords[i - 1];
      const b = routeCoords[i];
      const d = distanceMeters({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) });
      if (d != null) sum += d;
    }
    return sum / 1000;
  }, [routeCoords]);
  // Server-calculated distance (filters GPS jitter, poor fixes and jumps).
  const serverKm = Number((punchQ.data as { distance_km?: number | string | null } | null | undefined)?.distance_km);
  const totalKmToday = punchQ.data?.distance_km != null && Number.isFinite(serverKm) ? serverKm : routeKm;


  const canRecord = isSelf && !isHistorical;

  // Check-in / Check-out dialogs
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [preselectUnitId, setPreselectUnitId] = useState<string | null>(null);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const handledActionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!search.action || handledActionRef.current === search.action) return;
    if (!canRecord) return;
    if (search.action === "start-visit" && isOnDuty && !openVisit) setCheckInOpen(true);
    if (search.action === "complete-visit" && openVisit) setCheckOutOpen(true);
    handledActionRef.current = search.action;
  }, [search.action, isOnDuty, openVisit, canRecord]);

  const nextSeq = (visits[visits.length - 1]?.visit_seq ?? 0) + 1;
  const [detailVisitId, setDetailVisitId] = useState<string | null>(null);
  const detailVisit = visits.find((v) => v.id === detailVisitId) ?? null;
  const detailUnit = detailVisit ? units.find((u) => u.unit_id === detailVisit.unit_id) ?? null : null;

  const mapData = useMemo(() => {
    const p = punchQ.data;
    const login = p?.check_in_at && hasGeo(p.check_in_lat, p.check_in_lng) ? { lat: Number(p.check_in_lat), lng: Number(p.check_in_lng) } : null;
    const logout = p?.check_out_at && hasGeo(p.check_out_lat, p.check_out_lng) ? { lat: Number(p.check_out_lat), lng: Number(p.check_out_lng) } : null;
    const trail = track.filter((t) => (t as { counted?: boolean }).counted !== false).map((t) => ({ lat: Number(t.lat), lng: Number(t.lng) })).filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng));
    const mapVisits = visits.flatMap((v) => {
      const u = units.find((x) => x.unit_id === v.unit_id) ?? null;
      const g = unitGeo(u) ?? (hasGeo(v.check_in_lat, v.check_in_lng) ? { lat: Number(v.check_in_lat), lng: Number(v.check_in_lng) } : null);
      return g ? [{ id: v.id, seq: v.visit_seq, lat: g.lat, lng: g.lng, label: u?.unit_name ?? "Site", open: !v.check_out_at }] : [];
    });
    const lastTrail = trail[trail.length - 1] ?? null;
    const live = !isHistorical && isOnDuty ? (pos && isSelf ? { lat: pos.lat, lng: pos.lng } : lastTrail) : null;
    return { login, logout, trail, visits: mapVisits, live };
  }, [punchQ.data, track, visits, units, isHistorical, isOnDuty, pos, isSelf]);

  // Total on-duty time (mm) for the day
  const totalMinutesOnDuty = useMemo(() => {
    if (!punchQ.data?.check_in_at) return 0;
    const start = new Date(punchQ.data.check_in_at).getTime();
    const end = punchQ.data.check_out_at ? new Date(punchQ.data.check_out_at).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 60000));
  }, [punchQ.data?.check_in_at, punchQ.data?.check_out_at]);

  return (
    <div className="space-y-4">
      <style>{`@keyframes fs-ping { 0% { transform: scale(1); opacity: 0.6;} 80%,100% { transform: scale(1.8); opacity: 0;} }`}</style>

      {/* Duty status banner */}
      {!isOnDuty && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Mark your attendance from the dashboard to start tracking visits.
        </div>
      )}

      {/* Emergency / admin-requested visits */}
      <RequestedVisitsPanel
        requests={requestsQ.data ?? []}
        units={units}
        onAcknowledge={async (id: string) => {
          try {
            await acknowledgeFieldVisitRequest(id);
            toast.success("Acknowledged");
            void qc.invalidateQueries({ queryKey: ["fo-fs-requests", candidateId] });
          } catch (e) {
            toast.error((e as Error).message ?? "Failed");
          }
        }}
        onStartVisit={(unitId: string) => {
          if (!canRecord) {
            toast.error("Only this field officer can mark their own visit.");
            return;
          }
          setPreselectUnitId(unitId);
          setCheckInOpen(true);
        }}
      />

      {/* Primary CTA */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Today</div>
          {openVisit ? (
            <>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
                In meeting at {openVisitUnit?.unit_name ?? "site"}
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                {completedCount} completed · {totalKmToday.toFixed(2)} km traveled
                {distanceToDest != null ? ` · ${formatDistance(distanceToDest)} to destination` : ""}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm font-semibold text-foreground">
              {completedCount} visit{completedCount === 1 ? "" : "s"} completed · {totalKmToday.toFixed(2)} km traveled
            </div>
          )}
          {posError && <div className="mt-0.5 text-[11px] font-semibold text-rose-600">{posError}</div>}
        </div>
        {!canRecord ? (
          <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            View only — visits can only be marked by the officer on their own device.
          </div>
        ) : openVisit ? (
          <Button
            size="lg"
            className="h-11 w-full sm:w-auto"
            onClick={() => setCheckOutOpen(true)}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Complete visit #{openVisit.visit_seq}
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-11 w-full sm:w-auto"
            disabled={!isOnDuty || !pos}
            onClick={() => setCheckInOpen(true)}
          >
            <MapPin className="mr-1.5 h-4 w-4" />
            Check in your {nextSeq === 1 ? "first" : nextSeq === 2 ? "second" : nextSeq === 3 ? "third" : `${nextSeq}${nextSeq === 4 ? "th" : "th"}`} visit
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
        <VisitSummary label="Visits" value={`${completedCount}${openVisit ? " +1" : ""}`} />
        <VisitSummary label="Distance" value={`${totalKmToday.toFixed(2)} km`} />
        <VisitSummary
          label="On duty"
          value={isOnDuty || punchQ.data?.check_out_at ? `${Math.floor(totalMinutesOnDuty / 60)}h ${totalMinutesOnDuty % 60}m` : "—"}
        />
      </div>

      <OfficerDayMap
        login={mapData.login}
        logout={mapData.logout}
        live={mapData.live}
        trail={mapData.trail}
        visits={mapData.visits}
        onVisitClick={setDetailVisitId}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="order-2 lg:order-1">
          {/* Units list */}
          <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              My sites ({units.length})
            </div>
            {unitsQ.isLoading ? (
              <div className="py-4 text-center text-[11px] italic text-muted-foreground">Loading…</div>
            ) : units.length === 0 ? (
              <div className="py-4 text-center text-[11px] italic text-muted-foreground">No sites assigned to you yet.</div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {units.map((u) => {
                  const last = lastVisitQ.data?.get(u.unit_id) ?? null;
                  const count = monthCountsQ.data?.get(u.unit_id) ?? 0;
                  const href = mapsUrl(u.latitude, u.longitude);
                  return (
                    <li key={u.unit_id} className="rounded-xl border border-border/50 bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {u.unit_name}
                            {u.unit_code && <span className="ml-1 font-mono text-[10px] text-muted-foreground">({u.unit_code})</span>}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {u.customer_name ?? "—"}{u.branch_name ? ` · ${u.branch_name}` : ""}
                          </div>
                          {u.address && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{u.address}</div>}
                        </div>
                        <div className="shrink-0 text-right text-[10px] font-semibold text-muted-foreground">
                          <div>Last visit</div>
                          <div className="text-foreground">{whenAgo(last)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
                            <Navigation className="h-3 w-3" /> Directions
                          </a>
                        ) : null}
                        <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                          {count} visit{count === 1 ? "" : "s"} this month
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="order-1 lg:order-2">
        <FieldSenseTimeline
          visits={visits}
          units={units}
          openVisit={openVisit}
          openVisitUnit={openVisitUnit}
          distanceToDest={distanceToDest}
          totalKmToday={totalKmToday}
          onCompleteVisit={() => setCheckOutOpen(true)}
          onOpenVisit={setDetailVisitId}
        />
        </div>
      </div>


      {/* Distances strip */}
      {distances.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Distance from you
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {distances.slice(0, 8).map(({ unit, d }) => (
              <div key={unit.unit_id} className="rounded-xl border border-border/50 bg-background/60 p-2.5">
                <div className="truncate text-[12px] font-semibold text-foreground">{unit.unit_name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{unit.customer_name ?? "—"}</div>
                <div className="mt-1 flex items-center gap-1 text-[12px] font-bold text-sky-700 dark:text-sky-300">
                  <Navigation className="h-3 w-3" /> {formatDistance(d)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Range-driven visit history & insights */}
      <RangeInsightsPanel
        units={units}
        visits={rangeVisitsQ.data ?? []}
        loading={rangeVisitsQ.isLoading}
        rangeInfo={rangeInfo}
        highlight={highlight}
        onChangePreset={(preset) => setRange(preset, { highlight: null })}
        onChangeCustom={(start, end) => setRange("custom", { start, end, highlight: null })}
        onClearHighlight={() => setRange(validPreset, { highlight: null })}
      />


      <VisitDetailDialog
        visit={detailVisit}
        unitName={detailUnit?.unit_name ?? "Site"}
        address={detailUnit?.address ?? null}
        onClose={() => setDetailVisitId(null)}
      />

      {checkInOpen && (
        <CheckInDialog
          candidateId={candidateId}
          units={units}
          pos={pos}
          nextSeq={nextSeq}
          preselectUnitId={preselectUnitId}
          prevPoint={
            visits.length > 0
              ? { lat: visits[visits.length - 1].check_out_lat, lng: visits[visits.length - 1].check_out_lng }
              : null
          }
          onClose={() => {
            setCheckInOpen(false);
            setPreselectUnitId(null);
          }}
          onDone={() => {
            setCheckInOpen(false);
            setPreselectUnitId(null);
            void qc.invalidateQueries({ queryKey: ["fo-fs-visits", candidateId, todayPunchDate()] });
            void qc.invalidateQueries({ queryKey: ["fo-fs-track", candidateId, todayPunchDate()] });
            void qc.invalidateQueries({ queryKey: ["fo-fs-requests", candidateId] });
          }}
        />
      )}

      {checkOutOpen && openVisit && (
        <CheckOutDialog
          candidateId={candidateId}
          visit={openVisit}
          unit={units.find((u) => u.unit_id === openVisit.unit_id) ?? null}
          pos={pos}
          onClose={() => setCheckOutOpen(false)}
          onDone={() => {
            setCheckOutOpen(false);
            void qc.invalidateQueries({ queryKey: ["fo-fs-visits", candidateId, todayPunchDate()] });
            void qc.invalidateQueries({ queryKey: ["fo-dashboard-visits-v2", candidateId] });
            void qc.invalidateQueries({ queryKey: ["fo-fs-track", candidateId, todayPunchDate()] });
            void qc.invalidateQueries({ queryKey: ["fo-fs-month-counts", candidateId, todayPunchDate().slice(0, 7)] });
            void qc.invalidateQueries({ queryKey: ["fo-fs-last-visit", candidateId] });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ Check-in dialog ------------------------------ */
function CheckInDialog({
  candidateId,
  units,
  pos,
  nextSeq,
  prevPoint,
  preselectUnitId,
  onClose,
  onDone,
}: {
  candidateId: string;
  units: FoUnit[];
  pos: Geo | null;
  nextSeq: number;
  prevPoint: { lat: number | null; lng: number | null } | null;
  preselectUnitId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const nearest = useMemo(() => (pos ? findNearestUnit(units, pos, NEAREST_MAX_METERS) : null), [pos, units]);
  const [selectedId, setSelectedId] = useState<string>(
    preselectUnitId ?? nearest?.unit.unit_id ?? units[0]?.unit_id ?? "",
  );
  const [sitePickerOpen, setSitePickerOpen] = useState(false);

  const selectedUnit = useMemo(
    () => units.find((u) => u.unit_id === selectedId) ?? null,
    [units, selectedId],
  );
  const selectedGeo = unitGeo(selectedUnit);
  const distanceToSelected = useMemo(
    () => (pos && selectedGeo ? distanceMeters(pos, selectedGeo) : null),
    [pos, selectedGeo],
  );
  const allowance = geofenceAllowanceMeters(pos?.accuracy);
  const atSite = distanceToSelected != null && distanceToSelected <= allowance;
  const willCaptureSiteLocation = !selectedGeo && !!pos;
  const blocked = !!selectedGeo && distanceToSelected != null && !atSite;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select a unit.");
      // Always take a fresh GPS fix at the moment of check-in.
      const pos = await getCurrentPosition().catch(() => {
        throw new Error("Location not available. Turn on GPS and try again.");
      });
      const unit = units.find((u) => u.unit_id === selectedId) ?? null;
      const geo = unitGeo(unit);
      if (geo) {
        const d = distanceMeters(pos, geo);
        if (d == null || d > geofenceAllowanceMeters(pos.accuracy)) {
          throw new Error(
            `You are ${d == null ? "away from" : formatDistance(d) + " away from"} ${unit?.unit_name ?? "this site"}. Check in only after you reach the site.`,
          );
        }
      }
      const selfiePath = await captureAndUploadSelfie(
        { label: "Site visit", candidateId, geo: pos, site: unit?.unit_name ?? null },
        "visit",
      );
      const visit = await createVisit({
        selfiePath,
        candidateId,
        unitId: selectedId,
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        visitSeq: nextSeq,
        prevLat: prevPoint?.lat ?? null,
        prevLng: prevPoint?.lng ?? null,
      });
      // Simulate arrival: snap a track point to the unit so the map draws the
      // route from the previous location all the way to the site.
      if (unit && unit.latitude != null && unit.longitude != null) {
        try {
          await insertTrackPoint({
            candidateId,
            lat: Number(unit.latitude),
            lng: Number(unit.longitude),
            accuracy: null,
            visitId: visit.id,
          });
        } catch { /* noop */ }
      }
      // Site has no coordinates on record yet: store this on-site reading so
      // every future visit to this site can be geofenced against it.
      let capturedSiteLocation = false;
      if (!geo && pos.accuracy <= MAX_CAPTURE_ACCURACY_M) {
        try {
          const { data } = await supabase.rpc("capture_unit_coordinates" as never, {
            _unit_id: selectedId,
            _lat: pos.lat,
            _lng: pos.lng,
            _accuracy: Math.round(pos.accuracy),
          } as never);
          capturedSiteLocation = data === true;
        } catch { /* noop */ }
      }
      // Auto-complete any open admin request for this FO+unit
      try {
        await completeFieldVisitRequestForUnit({
          candidateId,
          unitId: selectedId,
          visitId: visit.id,
        });
      } catch { /* noop */ }
      return { capturedSiteLocation };
    },
    onSuccess: (res) => {
      toast.success(
        res?.capturedSiteLocation
          ? "Checked in — site location saved for future visits"
          : "Checked in",
      );
      onDone();
    },
    onError: (err) => {
      const msg = (err as { message?: string } | null)?.message;
      toast.error(
        msg
          ? /row-level security|permission/i.test(msg)
            ? "Only this field officer can mark their own visit."
            : msg
          : "Failed to check in",
      );
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check in — visit #{nextSeq}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {nearest && nearest.distance <= NEAREST_MAX_METERS ? (
            <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
              Nearest unit: <span className="font-bold">{nearest.unit.unit_name}</span> ({formatDistance(nearest.distance)} away).
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              No unit within {NEAREST_MAX_METERS}m of your location. Pick manually.
            </div>
          )}
          <label className="block text-[11px] font-semibold text-muted-foreground">Client</label>
          <Popover open={sitePickerOpen} onOpenChange={setSitePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-background px-2 text-sm"
              >
                <span className={cn("truncate", !selectedUnit && "text-muted-foreground")}>
                  {selectedUnit
                    ? `${selectedUnit.unit_name}${selectedUnit.customer_name ? ` — ${selectedUnit.customer_name}` : ""}`
                    : "Search and select a site…"}
                </span>
                <Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search site or client…" />
                <CommandList>
                  <CommandEmpty>No site found.</CommandEmpty>
                  <CommandGroup>
                    {units.map((u) => (
                      <CommandItem
                        key={u.unit_id}
                        value={`${u.unit_name} ${u.customer_name ?? ""}`}
                        onSelect={() => {
                          setSelectedId(u.unit_id);
                          setSitePickerOpen(false);
                        }}
                      >
                        <CheckCircle2
                          className={cn(
                            "mr-2 h-4 w-4",
                            u.unit_id === selectedId ? "opacity-100 text-emerald-600" : "opacity-0",
                          )}
                        />
                        <span className="truncate">
                          {u.unit_name}
                          {u.customer_name ? (
                            <span className="text-muted-foreground"> — {u.customer_name}</span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {blocked && (
            <div className="rounded-xl border border-rose-300/60 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
              You are {distanceToSelected != null ? formatDistance(distanceToSelected) : ""} away from{" "}
              <span className="font-bold">{selectedUnit?.unit_name}</span>. Check in only after you reach the site.
            </div>
          )}
          {!blocked && atSite && (
            <div className="rounded-xl border border-emerald-300/60 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
              You are at <span className="font-bold">{selectedUnit?.unit_name}</span>
              {distanceToSelected != null ? ` (${formatDistance(distanceToSelected)} away)` : ""}.
            </div>
          )}
          {willCaptureSiteLocation && (
            <div className="rounded-xl border border-sky-300/60 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
              This site has no saved location yet. Check in only from inside the site — your current location will
              be saved as this site's location for all future visits.
            </div>
          )}
          {pos && (
            <div className="text-[11px] text-muted-foreground">
              Location: {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} (±{Math.round(pos.accuracy)}m)
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !pos || !selectedId || blocked}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirm check-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Check-out dialog ------------------------------ */
function CheckOutDialog({
  candidateId,
  visit,
  unit,
  pos,
  onClose,
  onDone,
}: {
  candidateId: string;
  visit: FieldVisit;
  unit: FoUnit | null;
  pos: Geo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState<string>(visit.visit_notes ?? "");
  const [rating, setRating] = useState<number>(visit.customer_rating ?? 0);
  const [clientName, setClientName] = useState<string>(visit.client_name ?? "");
  const [signature, setSignature] = useState<string>("");
  const [clientPhoto, setClientPhoto] = useState<string>("");
  // (photo capture now handled by capturePhoto helper — no hidden input needed)

  const missing: string[] = [];
  if (!notes.trim()) missing.push("visit notes");
  if (!rating) missing.push("customer rating");
  if (!signature) missing.push("client signature");
  if (!clientPhoto) missing.push("client photo");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!pos) throw new Error("Location not available for checkout.");
      if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
      const sigPath = await uploadVisitProof({
        candidateId,
        visitId: visit.id,
        kind: "signature",
        dataUrl: signature,
      });
      const clientPath = await uploadVisitProof({
        candidateId,
        visitId: visit.id,
        kind: "client",
        dataUrl: clientPhoto,
      });
      // Snap a checkout track point to the unit so the polyline closes on-site
      // before the next segment starts.
      if (unit && unit.latitude != null && unit.longitude != null) {
        try {
          await insertTrackPoint({
            candidateId,
            lat: Number(unit.latitude),
            lng: Number(unit.longitude),
            accuracy: null,
            visitId: visit.id,
          });
        } catch { /* noop */ }
      }
      await completeVisit({
        id: visit.id,
        lat: unit?.latitude != null ? Number(unit.latitude) : pos.lat,
        lng: unit?.longitude != null ? Number(unit.longitude) : pos.lng,
        visitNotes: notes.trim(),
        customerRating: rating,
        clientSignatureUrl: sigPath,
        clientPhotoUrl: clientPath,
        clientName: clientName.trim() || null,
      });
      try {
        await completeFieldVisitRequestByVisit(visit.id);
      } catch { /* noop */ }
    },
    onSuccess: () => {
      toast.success("Visit completed");
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to check out");
    },
  });




  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Complete visit #{visit.visit_seq} — {unit?.unit_name ?? "Client"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Site visit notes *</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Describe what you inspected, observations, action items…"
              className="text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Customer feedback *</label>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => {
                const n = i + 1;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className="p-1"
                    aria-label={`${n} stars`}
                  >
                    <Star
                      className={cn(
                        "h-7 w-7 transition-colors",
                        n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300",
                      )}
                    />
                  </button>
                );
              })}
              <span className="ml-2 text-xs font-semibold text-muted-foreground">
                {rating ? `${rating} / 5` : "Tap to rate"}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Client name (optional)</label>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Mr. Sharma, Branch Manager"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Client signature *</label>
            <SignaturePad value={signature} onChange={(v) => setSignature(v)} height={140} />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Client photo *</label>
            {clientPhoto ? (
              <div className="relative">
                <img src={clientPhoto} alt="Client" className="w-full rounded-lg border border-border object-cover" />
                <button
                  type="button"
                  onClick={() => setClientPhoto("")}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const url = await capturePhoto();
                  if (url) setClientPhoto(url);
                }}
                className="flex h-32 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 text-sm font-semibold text-muted-foreground"
              >
                <Camera className="h-4 w-4" /> {isNativePlatform() ? "Open camera" : "Capture client photo"}
              </button>
            )}
          </div>


          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-[11px] font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              Missing: {missing.join(", ")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || missing.length > 0 || !pos}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Complete visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small helper to resolve signed URL for a stored proof path (for admin views). */
export async function resolveProofUrl(path: string | null) {
  return signedProofUrl(path);
}

// ---------------------------------------------------------------------------
// Timeline column
// ---------------------------------------------------------------------------

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function FieldSenseTimeline(props: {
  visits: FieldVisit[];
  units: FoUnit[];
  openVisit: FieldVisit | null;
  openVisitUnit: FoUnit | null;
  distanceToDest: number | null;
  totalKmToday: number;
  onCompleteVisit: () => void;
  onOpenVisit: (id: string) => void;
}) {
  const {
    onOpenVisit,
    visits,
    units,
    openVisit,
    openVisitUnit,
    distanceToDest,
    totalKmToday,
    onCompleteVisit,
  } = props;

  const unitFor = (id: string) => units.find((u) => u.unit_id === id) ?? null;
  const completedVisits = visits.filter((v) => v.check_out_at);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Today's timeline
        </div>
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <RouteIcon className="h-3 w-3" /> {totalKmToday.toFixed(2)} km
        </div>
      </div>

      <div className="flex-1 space-y-0 overflow-y-auto px-3 py-3">
        {/* Completed visits */}
        {completedVisits.map((v) => {
          const u = unitFor(v.unit_id);
          return (
            <TimelineRow
              key={v.id}
              color="sky"
              icon={<Flag className="h-3.5 w-3.5" />}
              title={`Visit #${v.visit_seq} · ${u?.unit_name ?? "Client"}`}
              time={`${fmtTime(v.check_in_at)} → ${fmtTime(v.check_out_at)}`}
              subtitle={u?.address ?? u?.customer_name ?? ""}
              chip={v.customer_rating != null ? `★ ${v.customer_rating}` : undefined}
              onClick={() => onOpenVisit(v.id)}
            />
          );
        })}

        {/* Active visit */}
        {openVisit && (
          <TimelineRow
            color="amber"
            pulsing
            icon={<Navigation className="h-3.5 w-3.5" />}
            title={`In meeting · ${openVisitUnit?.unit_name ?? "Client"}`}
            time={`${fmtTime(openVisit.check_in_at)} · now`}
            subtitle={
              openVisitUnit?.address ??
              (distanceToDest != null ? `${formatDistance(distanceToDest)} to destination` : "")
            }
            action={
              <Button
                size="sm"
                className="mt-2 h-8 w-full rounded-lg bg-emerald-600 text-[12px] font-semibold text-white hover:bg-emerald-700"
                onClick={onCompleteVisit}
              >
                Complete visit
              </Button>
            }
          />
        )}

        {visits.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-[12px] text-muted-foreground">
            No site visits yet today.
          </div>
        )}
      </div>

    </div>
  );
}

function TimelineRow(props: {
  color: "emerald" | "sky" | "amber" | "slate";
  icon: React.ReactNode;
  title: string;
  time: string;
  subtitle?: string;
  chip?: string;
  action?: React.ReactNode;
  pulsing?: boolean;
  onClick?: () => void;
}) {
  const { color, icon, title, time, subtitle, chip, action, pulsing, onClick } = props;
  const dotColor: Record<typeof props.color, string> = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    slate: "bg-slate-400",
  };
  return (
    <div
      className={cn("relative flex gap-3 py-2", onClick && "cursor-pointer rounded-lg hover:bg-muted/40")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm",
            dotColor[color],
            pulsing && "ring-4 ring-amber-200 animate-pulse",
          )}
        >
          {icon}
        </div>
        <div className="mt-1 w-px flex-1 bg-border/70" />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-[12.5px] font-semibold text-foreground leading-snug">{title}</div>
          {chip && (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              {chip}
            </span>
          )}
        </div>
        <div className="text-[11px] font-medium text-muted-foreground">{time}</div>
        {subtitle && (
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{subtitle}</div>
        )}
        {action}
      </div>
    </div>
  );
}

function VisitSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

type RangeInsightsProps = {
  units: FoUnit[];
  visits: FieldVisit[];
  loading: boolean;
  rangeInfo: { start: string; end: string; label: string; preset: RangePreset };
  highlight?: "most" | "least" | "unvisited";
  onChangePreset: (preset: RangePreset) => void;
  onChangeCustom: (start: string, end: string) => void;
  onClearHighlight: () => void;
};

function RangeInsightsPanel({
  units,
  visits,
  loading,
  rangeInfo,
  highlight,
  onChangePreset,
  onChangeCustom,
  onClearHighlight,
}: RangeInsightsProps) {
  const completed = visits.filter((v) => v.check_out_at);
  const totalVisits = completed.length;
  const rated = completed.filter((v) => v.customer_rating != null);
  const avgRating = rated.length
    ? rated.reduce((s, v) => s + (v.customer_rating ?? 0), 0) / rated.length
    : 0;

  const perUnit = new Map<string, number>();
  for (const v of completed) perUnit.set(v.unit_id, (perUnit.get(v.unit_id) ?? 0) + 1);
  const withCount = units.map((u) => ({ u, count: perUnit.get(u.unit_id) ?? 0 }));
  const visited = withCount.filter((r) => r.count > 0);
  const mostVisited = visited.length ? [...visited].sort((a, b) => b.count - a.count)[0] : null;
  const leastVisited = visited.length
    ? [...visited].sort((a, b) => a.count - b.count)[0]
    : null;
  const unvisited = withCount.filter((r) => r.count === 0);

  const highlightUnitIds = new Set<string>();
  if (highlight === "most" && mostVisited) highlightUnitIds.add(mostVisited.u.unit_id);
  else if (highlight === "least" && leastVisited) highlightUnitIds.add(leastVisited.u.unit_id);
  else if (highlight === "unvisited") for (const r of unvisited) highlightUnitIds.add(r.u.unit_id);

  const displayed =
    highlight === "unvisited"
      ? []
      : highlight && highlightUnitIds.size
      ? completed.filter((v) => highlightUnitIds.has(v.unit_id))
      : completed;

  const highlightLabel =
    highlight === "most"
      ? "Most visited"
      : highlight === "least"
      ? "Least visited"
      : highlight === "unvisited"
      ? "Not visited"
      : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
      {/* Range filter bar */}
      <FieldSenseRangeFilter
        bare
        preset={rangeInfo.preset as RangePreset}
        onPresetChange={(p) => onChangePreset(p)}
        customStart={rangeInfo.start}
        customEnd={rangeInfo.end}
        onCustomChange={(s, e) => onChangeCustom(s, e)}
        resolvedLabel={rangeInfo.start === rangeInfo.end ? rangeInfo.start : `${rangeInfo.start} → ${rangeInfo.end}`}
      />

      {/* Aggregate insights */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-border/50 bg-background/60 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Visits</div>
          <div className="mt-0.5 font-display text-xl font-bold tabular-nums">{totalVisits}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-background/60 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg rating</div>
          <div className="mt-0.5 inline-flex items-baseline gap-1 font-display text-xl font-bold tabular-nums">
            {rated.length ? avgRating.toFixed(1) : "—"}
            {rated.length ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : null}
          </div>
          <div className="text-[10px] text-muted-foreground">{rated.length} rated</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-background/60 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Most visited</div>
          <div className="mt-0.5 truncate text-[13px] font-semibold">
            {mostVisited ? mostVisited.u.customer_name ?? mostVisited.u.unit_name : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {mostVisited ? `${mostVisited.count} visit${mostVisited.count === 1 ? "" : "s"}` : "no visits"}
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-background/60 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Not visited</div>
          <div className="mt-0.5 font-display text-xl font-bold tabular-nums">{unvisited.length}</div>
          <div className="text-[10px] text-muted-foreground">of {units.length} units</div>
        </div>
      </div>

      {/* Highlight callout */}
      {highlightLabel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span>Filter: {highlightLabel} · {rangeInfo.label.toLowerCase()}</span>
          <button
            type="button"
            onClick={onClearHighlight}
            className="ml-auto rounded-md bg-amber-900/10 px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-900/20 dark:bg-amber-200/10 dark:text-amber-100"
          >
            Clear
          </button>
        </div>
      )}

      {/* Visit list / unvisited list */}
      <div className="mt-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {highlight === "unvisited"
            ? `Clients not visited in ${rangeInfo.label.toLowerCase()} (${unvisited.length})`
            : `Visits — ${rangeInfo.label} (${displayed.length})`}
        </div>
        {loading ? (
          <div className="py-4 text-center text-[11px] italic text-muted-foreground">Loading…</div>
        ) : highlight === "unvisited" ? (
          unvisited.length === 0 ? (
            <div className="py-4 text-center text-[11px] italic text-muted-foreground">
              All units visited in this range. 🎉
            </div>
          ) : (
            <ul className="space-y-1.5">
              {unvisited.map(({ u }) => (
                <li key={u.unit_id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
                  <div className="truncate text-[13px] font-semibold">{u.unit_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{u.customer_name ?? "—"}</div>
                </li>
              ))}
            </ul>
          )
        ) : displayed.length === 0 ? (
          <div className="py-4 text-center text-[11px] italic text-muted-foreground">
            No visits in this range.
          </div>
        ) : (
          <ul className="space-y-2">
            {displayed.map((v) => {
              const unit = units.find((u) => u.unit_id === v.unit_id);
              return (
                <li key={v.id} className="rounded-xl border border-border/50 bg-background/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {unit?.unit_name ?? "Client"}
                        <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                          {unit?.customer_name ?? ""}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {v.visit_date} · In {whenAgo(v.check_in_at)}
                        {v.check_out_at ? ` · Out ${whenAgo(v.check_out_at)}` : " · in progress"}
                      </div>
                    </div>
                    {v.customer_rating != null && (
                      <div className="inline-flex items-center gap-0.5 text-amber-500">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "h-3.5 w-3.5",
                              i < (v.customer_rating ?? 0) ? "fill-amber-400" : "opacity-30",
                            )}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {v.visit_notes && (
                    <div className="mt-1.5 rounded-md bg-muted/40 p-2 text-[11px] italic text-muted-foreground">
                      "{v.visit_notes}"
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    <ProofThumb path={v.check_in_selfie_path} label="Check-in selfie" />
                    <ProofThumb path={v.client_photo_url} label="Client photo" />
                    <ProofThumb path={v.client_signature_url} label="Signature" />
                    <div className="flex min-w-0 flex-col gap-1 text-[11px]">
                      {v.client_name && <span className="font-semibold text-foreground">Client: {v.client_name}</span>}
                      <GeoLink label="In" lat={v.check_in_lat} lng={v.check_in_lng} />
                      <GeoLink label="Out" lat={v.check_out_lat} lng={v.check_out_lng} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Requested visits panel ------------------------------ */
function RequestedVisitsPanel({
  requests,
  units,
  onAcknowledge,
  onStartVisit,
}: {
  requests: FieldVisitRequest[];
  units: FoUnit[];
  onAcknowledge: (id: string) => void | Promise<void>;
  onStartVisit: (unitId: string) => void;
}) {
  if (!requests.length) return null;
  const unitById = new Map(units.map((u) => [u.unit_id, u] as const));
  const emergency = requests.filter((r) => r.priority === "emergency").length;

  return (
    <section
      className={
        emergency > 0
          ? "rounded-2xl border-2 border-rose-400 bg-rose-50 p-3 shadow-lg dark:border-rose-500/60 dark:bg-rose-500/10"
          : "rounded-2xl border border-amber-300/60 bg-amber-50 p-3 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10"
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span
            className={
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 " +
              (emergency > 0 ? "bg-rose-500" : "bg-amber-500")
            }
          />
          <span
            className={
              "relative inline-flex h-2.5 w-2.5 rounded-full " +
              (emergency > 0 ? "bg-rose-600" : "bg-amber-600")
            }
          />
        </span>
        <div
          className={
            "text-[11px] font-bold uppercase tracking-[0.22em] " +
            (emergency > 0 ? "text-rose-800 dark:text-rose-200" : "text-amber-800 dark:text-amber-200")
          }
        >
          {emergency > 0 ? "Emergency site visits requested" : "Site visits requested"}
        </div>
        <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-foreground shadow-sm">
          {requests.length}
        </span>
      </div>
      <ul className="space-y-2">
        {requests.map((r) => {
          const u = unitById.get(r.unit_id);
          const priorityCls =
            r.priority === "emergency"
              ? "bg-rose-600 text-white"
              : r.priority === "high"
              ? "bg-amber-500 text-white"
              : "bg-slate-500 text-white";
          const priorityLabel = r.priority === "emergency" ? "EMERGENCY" : r.priority === "high" ? "HIGH" : "NORMAL";
          return (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-xl bg-white/85 p-2.5 ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-900/70"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={"rounded-full px-1.5 py-0.5 text-[10px] font-black tracking-wider " + priorityCls}>
                    {priorityLabel}
                  </span>
                  {r.status === "acknowledged" && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300">
                      Acknowledged
                    </span>
                  )}
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {u ? `${u.customer_name ? `${u.customer_name} — ` : ""}${u.unit_name}` : "Client"}
                  </span>
                </div>
                {r.reason && (
                  <div className="mt-1 text-[12px] leading-snug text-foreground/80">{r.reason}</div>
                )}
                <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                  {whenAgo(r.created_at)} · {u?.address ?? u?.branch_name ?? ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.status === "pending" && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => void onAcknowledge(r.id)}>
                    Acknowledge
                  </Button>
                )}
                <Button size="sm" className="h-8" onClick={() => onStartVisit(r.unit_id)}>
                  <MapPin className="mr-1 h-3.5 w-3.5" /> Start visit
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


