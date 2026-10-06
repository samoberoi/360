import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Battery, BatteryCharging, Radio, Signal, Star, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentUserRole } from "@/lib/use-current-user-role";
import { FieldOfficerFieldSense } from "@/components/FieldOfficerFieldSense";
import { RANGE_PRESETS, resolveRange, type RangePreset } from "@/lib/field-visits";
import { FieldSenseRangeFilter } from "@/components/FieldSenseRangeFilter";
import { AdminVisitProgressCard } from "@/components/AdminVisitProgressCard";
import { AdminFieldOfficerUnitsCard } from "@/components/AdminFieldOfficerUnitsCard";
import { OperationsDeployments } from "@/components/OperationsDeployments";
import { ReportingOrgChart } from "@/components/ReportingOrgChart";
import { useCurrentPermissions } from "@/lib/rbac";
import { AdminEscalationRequestsCard } from "@/components/AdminEscalationRequestsCard";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { ROLE_KEYS } from "@/lib/role-keys";



export const Route = createFileRoute("/admin/field-sense/")({
  component: FieldSensePage,
  validateSearch: (search: Record<string, unknown>): { range?: string; start?: string; end?: string; highlight?: string; action?: string } => ({
    range: (search.range as string | undefined) ?? undefined,
    start: (search.start as string | undefined) ?? undefined,
    end: (search.end as string | undefined) ?? undefined,
    highlight: (search.highlight as string | undefined) ?? undefined,
    action: (search.action as string | undefined) ?? undefined,
  }),
  head: () => ({
    meta: [
      { title: "Radar — Live field officers on India map" },
      { name: "description", content: "Live map of on-duty field officers with battery and network telemetry." },
      { property: "og:title", content: "Radar — Live field officers" },
      { property: "og:description", content: "Live map of on-duty field officers with battery and network telemetry." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type LivePunch = {
  id: string;
  candidate_id: string;
  check_in_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  battery_pct: number | null;
  battery_charging: boolean | null;
  network_type: string | null;
  candidate?: {
    full_name: string | null;
    employee_code: string | null;
    role_key: string | null;
    mobile: string | null;
  } | null;
};

function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function seenLabel(iso: string | null): string {
  if (!iso) return "no ping";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function batteryTone(bat: number | null): string {
  if (bat == null) return "#64748b";
  if (bat <= 20) return "#e11d48";
  if (bat <= 40) return "#d97706";
  return "#059669";
}

function netLabel(net: string | null): string {
  return net ?? "n/a";
}

function popupHtml(r: LivePunch): string {
  const name = r.candidate?.full_name ?? "Field officer";
  const code = r.candidate?.employee_code ?? "—";
  const bat = r.battery_pct;
  const batText = bat == null ? "n/a" : `${bat}%${r.battery_charging ? " ⚡" : ""}`;
  const batColor = batteryTone(bat);
  const net = netLabel(r.network_type);
  const seen = seenLabel(r.last_seen_at);
  return `
    <div style="font-family: ui-sans-serif, system-ui; min-width: 180px;">
      <div style="font-weight: 700; font-size: 13px; color:#0f172a;">${name}</div>
      <div style="font-size: 11px; color:#64748b; margin-top:2px;">${code} · ${seen}</div>
      <div style="display:flex; gap:10px; margin-top:8px; font-size:12px; font-weight:600;">
        <span style="color:${batColor};">🔋 ${batText}</span>
        <span style="color:#0f172a;">📶 ${net}</span>
      </div>
    </div>
  `;
}

function FieldSensePage() {
  const { isFieldOfficer, roleKey, candidateId, isLoading } = useCurrentUserRole();
  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (isFieldOfficer && candidateId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Site Visits"
          description="Check in and out at assigned sites and review today's visits."
          crumbs={[{ label: "Admin", to: "/admin/field-dashboard" }, { label: "Site Visits" }]}
        />
        <FieldOfficerFieldSense candidateId={candidateId} />
      </div>
    );
  }
  // Operations manager: own site check-in (union of his officers' sites) on top
  // of a Radar view scoped to just his team.
  if ((roleKey === ROLE_KEYS.OPERATIONS_MANAGER || roleKey === "branch_manager" || roleKey === "dgm") && candidateId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Team Radar"
          description="Your field officers' live status, plus your own site check-ins across all their sites."
          crumbs={[{ label: "Admin", to: "/admin/dashboard" }, { label: "Radar" }]}
        />
        <FieldOfficerFieldSense candidateId={candidateId} />
        <AdminFieldSense />
      </div>
    );
  }
  return <AdminFieldSense />;
}

function AdminFieldSense() {
  const qc = useQueryClient();
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const tileRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const LRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [mapKind, setMapKind] = useState<"street" | "satellite">("street");



  // Operations managers see only their reporting field officers on the map.
  const mgrScope = useManagerFieldOfficerScope();
  const scopeKey = mgrScope.isScoped
    ? [...mgrScope.fieldOfficerIds].sort().join(",")
    : "all";

  const q = useQuery({
    queryKey: ["field-sense-live", today(), scopeKey],
    refetchInterval: 15_000,
    queryFn: async (): Promise<LivePunch[]> => {
      const { data, error } = await supabase
        .from("self_attendance_punches" as never)
        .select(
          "id, candidate_id, check_in_at, last_lat, last_lng, last_seen_at, battery_pct, battery_charging, network_type, candidate:candidates!inner(full_name, employee_code, role_key, mobile)",
        )
        .eq("punch_date", today())
        .not("check_in_at", "is", null)
        .is("check_out_at", null)
        .eq("candidate.role_key", "field_officer")
        .order("last_seen_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as LivePunch[];
      return mgrScope.isScoped
        ? rows.filter((r) => mgrScope.fieldOfficerIds.has(r.candidate_id))
        : rows;
    },
  });

  const totalsQ = useQuery({
    queryKey: ["field-sense-totals", scopeKey],
    staleTime: 60_000,
    queryFn: async () => {
      if (mgrScope.isScoped) return { fo: mgrScope.fieldOfficerIds.size };
      const fo = await supabase
        .from("candidates" as never)
        .select("id", { count: "exact", head: true })
        .eq("role_key", "field_officer")
        .in("status", ["approved", "active"]);
      return { fo: fo.count ?? 0 };
    },
  });

  // Init map (client-only, dynamic import)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapEl.current) return;
      LRef.current = L;
      const map = L.map(mapEl.current, {
        center: [22.9734, 78.6569], // Center of India
        zoom: 5,
        zoomControl: true,
        attributionControl: true,
      });
      tileRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();
    };
  }, []);

  // Realtime updates
  useEffect(() => {
    const name = `field-sense-${Math.random().toString(36).slice(2)}`;
    const ch = supabase.channel(name);
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "self_attendance_punches" },
      () => void qc.invalidateQueries({ queryKey: ["field-sense-live", today()] }),
    ).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);

  const rows = useMemo(() => (q.data ?? []).filter((r) => r.last_lat != null && r.last_lng != null), [q.data]);

  const liveFoCount = rows.length;
  const totalFo = totalsQ.data?.fo ?? 0;

  // Sync markers
  useEffect(() => {
    if (!ready || !mapRef.current || !LRef.current) return;
    const L = LRef.current;
    const map = mapRef.current;
    const seen = new Set<string>();

    // Group rows sharing (approx) same coordinate so overlapping pins fan out
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${(r.last_lat as number).toFixed(5)},${(r.last_lng as number).toFixed(5)}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    const offsetFor = (r: (typeof rows)[number]): [number, number] => {
      const key = `${(r.last_lat as number).toFixed(5)},${(r.last_lng as number).toFixed(5)}`;
      const group = groups.get(key)!;
      if (group.length < 2) return [r.last_lat as number, r.last_lng as number];
      const idx = group.findIndex((g) => g.id === r.id);
      const radius = 0.00012; // ~13m
      const angle = (2 * Math.PI * idx) / group.length;
      return [
        (r.last_lat as number) + radius * Math.cos(angle),
        (r.last_lng as number) + radius * Math.sin(angle),
      ];
    };

    for (const r of rows) {
      const [lat, lng] = offsetFor(r);
      seen.add(r.id);
      const html = popupHtml(r);
      const initial = (r.candidate?.full_name ?? "F").trim().charAt(0).toUpperCase();
      const color = batteryTone(r.battery_pct);
      const icon = L.divIcon({
        className: "field-sense-pin",
        html: `<div style="position:relative;">
          <div style="width:34px;height:34px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.25);border:3px solid #fff;">${initial}</div>
          <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:fs-ping 1.6s ease-out infinite;"></span>
        </div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      const existing = markersRef.current.get(r.id);
      if (existing) {
        existing.setLatLng([lat, lng]);
        existing.setIcon(icon);
        existing.setPopupContent(html);
      } else {
        const m = L.marker([lat, lng], { icon }).addTo(map);
        m.bindPopup(html);
        m.bindTooltip(html, { direction: "top", offset: [0, -18], opacity: 1 });
        markersRef.current.set(r.id, m);
      }
    }


    // Remove stale
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        map.removeLayer(m);
        markersRef.current.delete(id);
      }
    }

    // Auto-fit
    if (rows.length > 0) {
      const bounds = L.latLngBounds(rows.map((r) => [r.last_lat as number, r.last_lng as number]));
      if (rows.length === 1) {
        map.setView(bounds.getCenter(), 14, { animate: true });
      } else {
        map.fitBounds(bounds.pad(0.25), { maxZoom: 14, animate: true });
      }
    }
  }, [rows, ready]);

  // Switch tile layer between street/satellite
  useEffect(() => {
    if (!ready || !mapRef.current || !LRef.current) return;
    const L = LRef.current;
    const map = mapRef.current;
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = (mapKind === "street"
      ? L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 })
      : L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { attribution: "© Esri, Maxar, Earthstar Geographics", maxZoom: 19 },
        )
    ).addTo(map);
  }, [mapKind, ready]);


  return (
    <div className="space-y-4">
      <PageHeader
        title="Radar"
        description="Live map of on-duty field officers with battery and network telemetry."
        crumbs={[{ label: "Admin", to: "/admin/dashboard" }, { label: "Radar" }]}
      />

      <style>{`@keyframes fs-ping { 0% { transform: scale(1); opacity: 0.6;} 80%,100% { transform: scale(1.8); opacity: 0;} }`}</style>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="Field Officers" total={totalFo} live={liveFoCount} tone="sky" />
        <StatTile label="With GPS Ping" total={(q.data ?? []).length} live={rows.length} tone="amber" />
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Live map</div>
          <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setMapKind("street")}
              className={mapKind === "street" ? "rounded-md bg-foreground px-2 py-1 text-background" : "rounded-md px-2 py-1 text-muted-foreground"}
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => setMapKind("satellite")}
              className={mapKind === "satellite" ? "rounded-md bg-foreground px-2 py-1 text-background" : "rounded-md px-2 py-1 text-muted-foreground"}
            >
              Satellite
            </button>
          </div>
        </div>
        <div ref={mapEl} style={{ height: "520px", width: "100%" }} />
        {q.isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 text-xs font-semibold text-muted-foreground">
            Loading live field officers…
          </div>
        )}
        {!q.isLoading && rows.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-16 mx-auto w-fit rounded-full bg-background/90 px-4 py-2 text-xs font-semibold text-muted-foreground shadow ring-1 ring-border/60">
            No field officer is currently checked in with a GPS ping.
          </div>
        )}
      </section>


      <div className="grid gap-4 xl:grid-cols-2">
        <AdminVisitProgressCard />
        <AdminFieldOfficerUnitsCard />
      </div>

      <OperationsDeployments />

      <AdminEscalationRequestsCard />

      <FieldSenseLeaderboards />

      <SuperAdminOrgChart />
    </div>
  );
}

function SuperAdminOrgChart() {
  const { isSuperAdmin } = useCurrentPermissions();
  return isSuperAdmin ? <ReportingOrgChart /> : null;
}

// ------------------------ Leaderboards ------------------------

type LbPreset = Exclude<RangePreset, "custom"> | "custom";

type FoStats = {
  candidate_id: string;
  full_name: string;
  employee_code: string | null;
  visits: number;
  ratedCount: number;
  avgRating: number | null;
  km: number;
};

type UnitStats = {
  unit_id: string;
  unit_name: string;
  customer_name: string | null;
  visits: number;
};


function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function FieldSenseLeaderboards() {
  const mgrScope = useManagerFieldOfficerScope();
  const lbScopeKey = mgrScope.isScoped ? [...mgrScope.fieldOfficerIds].sort().join(",") : "all";
  const [preset, setPreset] = useState<LbPreset>("this_month");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const resolved = useMemo(
    () => resolveRange(preset as RangePreset, customStart || null, customEnd || null),
    [preset, customStart, customEnd],
  );

  const dataQ = useQuery({
    queryKey: ["field-sense-lb", resolved.start, resolved.end, lbScopeKey],
    enabled: !mgrScope.isLoading,
    staleTime: 30_000,
    queryFn: async () => {
      const [foRes, visitsRes, tracksRes, unitsRes, custRes, punchesRes] = await Promise.all([
        supabase
          .from("candidates" as never)
          .select("id, full_name, employee_code")
          .eq("role_key", "field_officer")
          .in("status", ["approved", "active"]),
        supabase
          .from("field_visits" as never)
          .select("candidate_id, unit_id, customer_rating, check_in_at, check_in_lat, check_in_lng, check_out_at")
          .gte("visit_date", resolved.start)
          .lte("visit_date", resolved.end)
          .not("check_out_at", "is", null),
        supabase
          .from("field_track_points" as never)
          .select("candidate_id, track_date, lat, lng, recorded_at")
          .gte("track_date", resolved.start)
          .lte("track_date", resolved.end)
          .order("recorded_at", { ascending: true }),
        supabase.from("units" as never).select("id, name, customer_id, latitude, longitude"),
        supabase.from("customers" as never).select("id, name"),
        supabase
          .from("self_attendance_punches" as never)
          .select("candidate_id, punch_date, distance_km, check_in_at, check_in_lat, check_in_lng, check_out_at, check_out_lat, check_out_lng")
          .gte("punch_date", resolved.start)
          .lte("punch_date", resolved.end),
      ]);

      const inScope = (id: string) => !mgrScope.isScoped || mgrScope.fieldOfficerIds.has(id);
      const fos = (((foRes.data ?? []) as unknown) as Array<{ id: string; full_name: string; employee_code: string | null }>).filter((f) => inScope(f.id));
      const visits = (((visitsRes.data ?? []) as unknown) as Array<{ candidate_id: string }>).filter((v) => inScope(v.candidate_id)) as unknown as Array<{
        candidate_id: string;
        unit_id: string;
        customer_rating: number | null;
        check_in_at: string | null;
        check_in_lat: number | string | null;
        check_in_lng: number | string | null;
      }>;
      const tracks = ((tracksRes.data ?? []) as unknown) as Array<{
        candidate_id: string;
        track_date: string;
        lat: number | string;
        lng: number | string;
      }>;
      const units = ((unitsRes.data ?? []) as unknown) as Array<{
        id: string;
        name: string;
        customer_id: string | null;
        latitude: number | string | null;
        longitude: number | string | null;
      }>;
      const customers = ((custRes.data ?? []) as unknown) as Array<{ id: string; name: string }>;
      const punches = ((punchesRes.data ?? []) as unknown) as Array<{
        candidate_id: string;
        punch_date: string;
        distance_km: number | string | null;
        check_in_at: string | null;
        check_in_lat: number | string | null;
        check_in_lng: number | string | null;
        check_out_at: string | null;
        check_out_lat: number | string | null;
        check_out_lng: number | string | null;
      }>;

      const unitById = new Map(units.map((u) => [u.id, u]));
      const custById = new Map(customers.map((c) => [c.id, c.name]));

      // FO aggregates
      const visitByCand = new Map<string, { visits: number; ratings: number[] }>();
      for (const v of visits) {
        const row = visitByCand.get(v.candidate_id) ?? { visits: 0, ratings: [] };
        row.visits += 1;
        if (v.customer_rating != null) row.ratings.push(Number(v.customer_rating));
        visitByCand.set(v.candidate_id, row);
      }

      // Distance per candidate: build day-by-day waypoints (punch-in → site
      // visits in order → punch-out), sum haversine, and apply a road factor
      // so numbers align with the FO map (which follows real roads via OSRM).
      // Fall back to raw GPS-ping haversine when waypoints are missing, and
      // always take the larger of the two so we don't undercount motion.
      const ROAD_FACTOR = 1.3;
      const isNum = (n: unknown): n is number => Number.isFinite(Number(n));
      const toPt = (lat: unknown, lng: unknown) =>
        isNum(lat) && isNum(lng) ? { lat: Number(lat), lng: Number(lng) } : null;
      const dateKey = (iso: string | null | undefined, fallback: string) =>
        iso ? iso.slice(0, 10) : fallback;

      // 1) Raw ping haversine
      const rawKmByCand = new Map<string, number>();
      const grouped = new Map<string, Array<{ lat: number; lng: number }>>();
      for (const p of tracks) {
        const key = `${p.candidate_id}|${p.track_date}`;
        const arr = grouped.get(key) ?? [];
        arr.push({ lat: Number(p.lat), lng: Number(p.lng) });
        grouped.set(key, arr);
      }
      for (const [key, pts] of grouped) {
        const cand = key.split("|")[0];
        let m = 0;
        for (let i = 1; i < pts.length; i += 1) m += haversineM(pts[i - 1], pts[i]);
        rawKmByCand.set(cand, (rawKmByCand.get(cand) ?? 0) + m / 1000);
      }

      // 2) Waypoint distance per candidate/day
      const wpKmByCand = new Map<string, number>();
      const dayBucket = new Map<string, Array<{ pt: { lat: number; lng: number }; at: number; kind: string }>>();
      const pushWp = (cand: string, day: string, pt: { lat: number; lng: number } | null, at: string | null, kind: string) => {
        if (!pt || !at) return;
        const k = `${cand}|${day}`;
        const arr = dayBucket.get(k) ?? [];
        arr.push({ pt, at: new Date(at).getTime(), kind });
        dayBucket.set(k, arr);
      };
      for (const pu of punches) {
        pushWp(pu.candidate_id, pu.punch_date, toPt(pu.check_in_lat, pu.check_in_lng), pu.check_in_at ?? pu.punch_date, "punch-in");
        pushWp(pu.candidate_id, pu.punch_date, toPt(pu.check_out_lat, pu.check_out_lng), pu.check_out_at, "punch-out");
      }
      for (const v of visits) {
        const u = unitById.get(v.unit_id);
        const site = toPt(u?.latitude, u?.longitude) ?? toPt(v.check_in_lat, v.check_in_lng);
        const day = dateKey(v.check_in_at, "");
        if (!day) continue;
        pushWp(v.candidate_id, day, site, v.check_in_at, "visit-in");
      }
      for (const [key, arr] of dayBucket) {
        const cand = key.split("|")[0];
        arr.sort((a, b) => a.at - b.at);
        let m = 0;
        for (let i = 1; i < arr.length; i += 1) m += haversineM(arr[i - 1].pt, arr[i].pt);
        wpKmByCand.set(cand, (wpKmByCand.get(cand) ?? 0) + (m * ROAD_FACTOR) / 1000);
      }

      // 3) Stored road-snapped distance from FO app (source of truth)
      const storedKmByCand = new Map<string, number>();
      for (const pu of punches) {
        const v = Number(pu.distance_km);
        if (!Number.isFinite(v) || v <= 0) continue;
        storedKmByCand.set(pu.candidate_id, (storedKmByCand.get(pu.candidate_id) ?? 0) + v);
      }

      const foStats: FoStats[] = fos.map((f) => {
        const v = visitByCand.get(f.id);
        const ratings = v?.ratings ?? [];
        const stored = storedKmByCand.get(f.id) ?? 0;
        const km = stored > 0
          ? stored
          : Math.max(rawKmByCand.get(f.id) ?? 0, wpKmByCand.get(f.id) ?? 0);
        return {
          candidate_id: f.id,
          full_name: f.full_name,
          employee_code: f.employee_code,
          visits: v?.visits ?? 0,
          ratedCount: ratings.length,
          avgRating: ratings.length ? ratings.reduce((s, x) => s + x, 0) / ratings.length : null,
          km: Number(km.toFixed(2)),
        };
      });

      // Unit aggregates — include ALL units so zero-visit units surface in "Least visited"
      const unitCount = new Map<string, number>();
      for (const v of visits) {
        unitCount.set(v.unit_id, (unitCount.get(v.unit_id) ?? 0) + 1);
      }
      const unitStats: UnitStats[] = units.map((u) => ({
        unit_id: u.id,
        unit_name: u.name ?? "—",
        customer_name: u.customer_id ? custById.get(u.customer_id) ?? null : null,
        visits: unitCount.get(u.id) ?? 0,
      }));

      return { foStats, unitStats };
    },
  });

  const foStats = dataQ.data?.foStats ?? [];
  const unitStats = dataQ.data?.unitStats ?? [];

  const foByVisitsDesc = [...foStats].sort((a, b) => b.visits - a.visits || a.full_name.localeCompare(b.full_name));
  const foByVisitsAsc = [...foStats].sort((a, b) => a.visits - b.visits || a.full_name.localeCompare(b.full_name));
  const rated = foStats.filter((f) => f.avgRating != null);
  const foByRatingDesc = [...rated].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));
  const foByRatingAsc = [...rated].sort((a, b) => (a.avgRating ?? 0) - (b.avgRating ?? 0));
  const foByKmDesc = [...foStats].sort((a, b) => b.km - a.km);
  const foByKmAsc = [...foStats].sort((a, b) => a.km - b.km);
  const unitsDesc = [...unitStats].sort((a, b) => b.visits - a.visits || a.unit_name.localeCompare(b.unit_name));
  const unitsAsc = [...unitStats].sort((a, b) => a.visits - b.visits || a.unit_name.localeCompare(b.unit_name));

  return (
    <section className="space-y-3">
      {/* Filter bar */}
      <FieldSenseRangeFilter
        preset={preset as RangePreset}
        onPresetChange={(p) => setPreset(p as LbPreset)}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
        resolvedLabel={`${resolved.label} · ${resolved.start === resolved.end ? resolved.start : `${resolved.start} → ${resolved.end}`}`}
      />

      {dataQ.isLoading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-xs italic text-muted-foreground shadow-sm">
          Crunching leaderboards…
        </div>
      ) : (
        <>
          {/* Field officer leaderboards */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Leaderboard
              title="Field officers · Most visits"
              tone="sky"
              rows={foByVisitsDesc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: r.employee_code ?? "—",
                metric: `${r.visits}`,
                metricLabel: r.visits === 1 ? "visit" : "visits",
              })}
              emptyLabel="No visits recorded in range."
            />
            <Leaderboard
              title="Field officers · Least visits"
              tone="rose"
              rows={foByVisitsAsc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: r.employee_code ?? "—",
                metric: `${r.visits}`,
                metricLabel: r.visits === 1 ? "visit" : "visits",
              })}
              emptyLabel="No visits recorded in range."
            />
            <Leaderboard
              title="Field officers · Highest rating"
              tone="amber"
              rows={foByRatingDesc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: `${r.ratedCount} rated`,
                metric: (r.avgRating ?? 0).toFixed(2),
                metricLabel: "avg ★",
              })}
              emptyLabel="No client ratings in range."
              accent={<Star className="h-3.5 w-3.5 text-amber-500" />}
            />
            <Leaderboard
              title="Field officers · Lowest rating"
              tone="violet"
              rows={foByRatingAsc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: `${r.ratedCount} rated`,
                metric: (r.avgRating ?? 0).toFixed(2),
                metricLabel: "avg ★",
              })}
              emptyLabel="No client ratings in range."
              accent={<Star className="h-3.5 w-3.5 text-violet-500" />}
            />
            <Leaderboard
              title="Field officers · Distance traveled (high → low)"
              tone="emerald"
              rows={foByKmDesc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: r.employee_code ?? "—",
                metric: r.km.toFixed(2),
                metricLabel: "km",
              })}
              emptyLabel="No GPS trail recorded in range."
            />
            <Leaderboard
              title="Field officers · Distance traveled (low → high)"
              tone="slate"
              rows={foByKmAsc}
              render={(r) => ({
                key: r.candidate_id,
                primary: r.full_name,
                secondary: r.employee_code ?? "—",
                metric: r.km.toFixed(2),
                metricLabel: "km",
              })}
              emptyLabel="No GPS trail recorded in range."
            />
          </div>

          {/* Units + Customers */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Leaderboard
              title="Clients · Most visited"
              tone="sky"
              rows={unitsDesc}
              render={(r) => ({
                key: r.unit_id,
                primary: r.unit_name,
                secondary: r.customer_name ?? "—",
                metric: `${r.visits}`,
                metricLabel: r.visits === 1 ? "visit" : "visits",
              })}
              emptyLabel="No clients visited in range."
            />
            <Leaderboard
              title="Clients · Least visited"
              tone="rose"
              rows={unitsAsc}
              render={(r) => ({
                key: r.unit_id,
                primary: r.unit_name,
                secondary: r.customer_name ?? "—",
                metric: `${r.visits}`,
                metricLabel: r.visits === 1 ? "visit" : "visits",
              })}
              emptyLabel="No clients visited in range."
            />
          </div>
        </>
      )}
    </section>
  );
}

const LB_TONES: Record<string, string> = {
  sky: "text-sky-700 dark:text-sky-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  violet: "text-violet-700 dark:text-violet-300",
  rose: "text-rose-700 dark:text-rose-300",
  slate: "text-slate-700 dark:text-slate-300",
};

function Leaderboard<T>({
  title,
  tone,
  rows,
  render,
  emptyLabel,
  accent,
}: {
  title: string;
  tone: keyof typeof LB_TONES;
  rows: T[];
  render: (r: T) => { key: string; primary: string; secondary: string; metric: string; metricLabel: string };
  emptyLabel: string;
  accent?: React.ReactNode;
}) {
  const top = rows.slice(0, 8);
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
      <div className={`mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] ${LB_TONES[tone]}`}>
        {accent}
        {title}
        <span className="text-muted-foreground">({rows.length})</span>
      </div>
      {top.length === 0 ? (
        <div className="py-4 text-center text-[11px] italic text-muted-foreground">{emptyLabel}</div>
      ) : (
        <ol className="space-y-1.5">
          {top.map((r, i) => {
            const item = render(r);
            return (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-foreground/90 text-[11px] font-bold text-background">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{item.primary}</div>
                    {item.secondary ? (
                      <div className="truncate text-[11px] text-muted-foreground">{item.secondary}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-baseline gap-1 tabular-nums">
                  <span className="font-display text-base font-bold text-foreground">{item.metric}</span>
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">{item.metricLabel}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}


const TILE_TONES: Record<string, { ring: string; dot: string; live: string; total: string }> = {
  sky: { ring: "ring-sky-200/70", dot: "bg-sky-500", live: "text-sky-700 dark:text-sky-300", total: "text-slate-900 dark:text-slate-100" },
  emerald: { ring: "ring-emerald-200/70", dot: "bg-emerald-500", live: "text-emerald-700 dark:text-emerald-300", total: "text-slate-900 dark:text-slate-100" },
  violet: { ring: "ring-violet-200/70", dot: "bg-violet-500", live: "text-violet-700 dark:text-violet-300", total: "text-slate-900 dark:text-slate-100" },
  amber: { ring: "ring-amber-200/70", dot: "bg-amber-500", live: "text-amber-700 dark:text-amber-300", total: "text-slate-900 dark:text-slate-100" },
};

function StatTile({ label, total, live, tone }: { label: string; total: number; live: number; tone: keyof typeof TILE_TONES }) {
  const t = TILE_TONES[tone];
  return (
    <div className={`rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm ring-1 ${t.ring}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-[22px] font-semibold leading-none ${t.total}`}>{total.toLocaleString()}</div>
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">total</div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={`relative flex h-1.5 w-1.5`}>
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${t.dot} opacity-60`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${t.dot}`} />
        </span>
        <span className={`text-[11px] font-bold ${t.live}`}>{live.toLocaleString()} live now</span>
      </div>
    </div>
  );
}

