import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup, TileLayer } from "leaflet";

export type DayMapPoint = { lat: number; lng: number };
export type DayMapVisit = { id: string; seq: number; lat: number; lng: number; label: string; open: boolean };

const STREET = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

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
    if (path.length > 1) L.polyline(path, { color: "#3b82f6", weight: 4, opacity: 0.85 }).addTo(layer);
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
  }, [ready, login, logout, live, trail, visits]);

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
