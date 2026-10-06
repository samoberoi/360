import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, TileLayer } from "leaflet";

export type DayMapPoint = { lat: number; lng: number };
export type DayMapVisit = { id: string; seq: number; lat: number; lng: number; label: string; open: boolean };

const STREET = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Thin points closer than `min` metres so routing requests stay small. */
function thin(path: [number, number][], min = 40): [number, number][] {
  const out: [number, number][] = [];
  for (const p of path) {
    const q = out[out.length - 1];
    if (!q) { out.push(p); continue; }
    const dy = (p[0] - q[0]) * 111_000;
    const dx = (p[1] - q[1]) * 111_000 * Math.cos((p[0] * Math.PI) / 180);
    if (Math.hypot(dx, dy) >= min) out.push(p);
  }
  const last = path[path.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

async function osrm(kind: "match" | "route", chunk: [number, number][], signal: AbortSignal): Promise<[number, number][] | null> {
  const coords = chunk.map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)}`).join(";");
  const extra = kind === "match" ? `&radiuses=${chunk.map(() => "40").join(";")}&gaps=split&tidy=true` : "&continue_straight=false";
  const r = await fetch(`https://router.project-osrm.org/${kind}/v1/driving/${coords}?geometries=geojson&overview=full${extra}`, { signal });
  if (!r.ok) return null;
  const j = await r.json();
  const list = (kind === "match" ? j?.matchings : j?.routes) as Array<{ geometry: { coordinates: [number, number][] } }> | undefined;
  if (j?.code !== "Ok" || !list?.length) return null;
  const pts: [number, number][] = [];
  for (const m of kind === "match" ? list : list.slice(0, 1)) for (const [ln, la] of m.geometry.coordinates) pts.push([la, ln]);
  // A split match leaves holes — only trust it if it reaches both ends.
  if (kind === "match" && list.length > 1) return null;
  return pts.length > 1 ? pts : null;
}

/** Draw the trail on real roads: map-match the GPS, and route any part that can't be matched. Never straight lines. */
async function snapToRoads(path: [number, number][], signal: AbortSignal): Promise<[number, number][]> {
  const pts = thin(path);
  if (pts.length < 2) return pts;
  const out: [number, number][] = [];
  const CH = 25;
  for (let i = 0; i < pts.length - 1; i += CH - 1) {
    const chunk = pts.slice(i, i + CH);
    if (chunk.length < 2) break;
    let seg: [number, number][] | null = null;
    try { seg = await osrm("match", chunk, signal); } catch (e) { if (signal.aborted) throw e; }
    if (!seg) { try { seg = await osrm("route", chunk, signal); } catch (e) { if (signal.aborted) throw e; } }
    if (!seg) {
      // Route each hop on its own as a last resort.
      seg = [];
      for (let k = 1; k < chunk.length; k += 1) {
        let hop: [number, number][] | null = null;
        try { hop = await osrm("route", [chunk[k - 1], chunk[k]], signal); } catch (e) { if (signal.aborted) throw e; }
        seg.push(...(hop ?? [chunk[k - 1], chunk[k]]));
      }
    }
    out.push(...seg);
  }
  return out.length > 1 ? out : pts;
}

/** Day trail map: login, visits (numbered), logout, and the GPS trail / live position. */
export function OfficerDayMap({
  login,
  logout,
  live,
  trail,
  visits,
  onVisitClick,
}: {
  login: DayMapPoint | null;
  logout: DayMapPoint | null;
  live: DayMapPoint | null;
  trail: DayMapPoint[];
  visits: DayMapVisit[];
  onVisitClick: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const fittedRef = useRef(false);
  const clickRef = useRef(onVisitClick);
  clickRef.current = onVisitClick;
  const [ready, setReady] = useState(false);
  const [sat, setSat] = useState(false);
  const [roadPath, setRoadPath] = useState<[number, number][] | null>(null);
  const rawKey = `${login?.lat},${login?.lng}|${trail.length}|${trail[trail.length - 1]?.lat}|${logout?.lat}|${live?.lat?.toFixed(4)},${live?.lng?.toFixed(4)}`;
  useEffect(() => {
    const path: [number, number][] = [];
    if (login) path.push([login.lat, login.lng]);
    for (const p of trail) path.push([p.lat, p.lng]);
    if (live && !logout) path.push([live.lat, live.lng]);
    if (logout) path.push([logout.lat, logout.lng]);
    if (path.length < 2) { setRoadPath(null); return; }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      snapToRoads(path, ac.signal).then(setRoadPath).catch(() => {});
    }, 400);
    return () => { ac.abort(); window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !el.current || mapRef.current) return;
      LRef.current = L as unknown as typeof import("leaflet");
      const map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([20.59, 78.96], 5);
      tileRef.current = L.tileLayer(STREET, { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(sat ? SAT : STREET, { attribution: sat ? "© Esri" : "© OpenStreetMap", maxZoom: 19 }).addTo(map);
  }, [sat, ready]);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    const path: [number, number][] = [];
    if (login) path.push([login.lat, login.lng]);
    for (const p of trail) path.push([p.lat, p.lng]);
    if (live && !logout) path.push([live.lat, live.lng]);
    if (logout) path.push([logout.lat, logout.lng]);
    // Only draw road-routed geometry; never a straight connector.
    const drawn: [number, number][] = roadPath ?? [];
    if (drawn.length > 1) L.polyline(drawn, { color: "#3b82f6", weight: 4, opacity: 0.85 }).addTo(layer);
    bounds.push(...path);

    const dot = (p: DayMapPoint, color: string, title: string) => {
      L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(title)
        .addTo(layer);
      bounds.push([p.lat, p.lng]);
    };
    if (login) dot(login, "#22c55e", "Log in");
    if (logout) dot(logout, "#ef4444", "Log out");
    for (const v of visits) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:26px;height:26px;border-radius:9999px;background:${v.open ? "#f59e0b" : "#7c3aed"};color:#fff;font:700 12px system-ui;display:grid;place-items:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${v.seq}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([v.lat, v.lng], { icon }).bindTooltip(`Visit #${v.seq} · ${v.label}`).on("click", () => clickRef.current(v.id)).addTo(layer);
      bounds.push([v.lat, v.lng]);
    }
    if (live && !logout) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:9999px;background:#fff;display:grid;place-items:center;box-shadow:0 0 0 6px rgba(59,130,246,.25)"><div style="width:12px;height:12px;border-radius:9999px;background:#2563eb"></div></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([live.lat, live.lng], { icon }).bindTooltip("Live").addTo(layer);
      bounds.push([live.lat, live.lng]);
    }
    if (!fittedRef.current && bounds.length > 0) {
      fittedRef.current = true;
      if (bounds.length === 1) map.setView(bounds[0], 15);
      else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }, [ready, login, logout, live, trail, visits, roadPath]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="text-sm font-semibold text-foreground">Location &amp; duties map</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-muted-foreground">
          <Legend color="#22c55e" label="Log in" />
          <Legend color="#7c3aed" label="Visits" />
          <Legend color="#ef4444" label="Log out" />
          <Legend color="#3b82f6" label="Trail / live" />
          <button
            type="button"
            onClick={() => setSat((s) => !s)}
            className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-foreground"
          >
            {sat ? "Street" : "Satellite"}
          </button>
        </div>
      </div>
      <div ref={el} className="relative z-0 h-[340px] w-full sm:h-[440px]" />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
