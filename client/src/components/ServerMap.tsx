/**
 * Server-backed map. The data source is the authorized bounding-box query (`map.query`), NOT the Projects list:
 * pan/zoom asks the server for the markers inside the viewport — grid clusters at low zoom, stations at high
 * zoom — so the map works for the whole dataset without any of it being loaded in the browser, and a restricted
 * principal can only ever receive markers of its own workspaces (the server applies the same predicates as the
 * table). Station popups load their project list lazily (`map.station`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DB_RED } from "@shared/brand";
import type { MapQuery, MapStationQuery } from "@shared/map-contract";
import { serverApi } from "@/realtime/serverApi";

export interface ServerMapFilters {
  search?: string; bahnhofsmanagement?: string; projektstand?: string; projektleiter?: string;
  department?: string; reviewStatus?: string; pruefer?: string;
}
type Bounds = MapQuery["bbox"];

const PRECISION_COLOR = { exact: DB_RED, tokens: "#F59E0B", fuzzy: "#F59E0B", region: "#9ca3af" } as const;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export default function ServerMap({
  filters, onProjectSelect, className, initialCenter = { lat: 51.1657, lng: 10.4515 }, initialZoom = 6,
}: { filters: ServerMapFilters; onProjectSelect?: (id: number) => void; className?: string; initialCenter?: { lat: number; lng: number }; initialZoom?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [view, setView] = useState<{ bbox: Bounds; zoom: number } | null>(null);
  const onSelect = useRef(onProjectSelect);
  onSelect.current = onProjectSelect;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    const node = el.current;
    if (!node || (node as HTMLElement & { _leaflet_id?: number })._leaflet_id) return;
    const m = L.map(node, { center: [initialCenter.lat, initialCenter.lng], zoom: initialZoom, scrollWheelZoom: true, zoomControl: false });
    map.current = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const emit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { // debounce: one query per settled viewport, not per animation frame
        const b = m.getBounds();
        setView({ bbox: { minLat: round(b.getSouth(), 3), maxLat: round(b.getNorth(), 3), minLng: round(b.getWest(), 3), maxLng: round(b.getEast(), 3) }, zoom: Math.round(m.getZoom()) });
      }, 250);
    };
    m.on("moveend", emit); m.on("zoomend", emit);
    emit();
    return () => { clearTimeout(timer); m.remove(); map.current = null; layer.current = null; };
    // biome-ignore lint/correctness/useExhaustiveDependencies: initial center/zoom are mount-only by contract
  }, []);

  const f = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as ServerMapFilters, [filters]);
  const q = useQuery({
    queryKey: ["server", "map", view?.bbox, view?.zoom, f],
    queryFn: () => serverApi.map.query.query({ bbox: view!.bbox, zoom: view!.zoom, ...f }),
    enabled: !!view,
    placeholderData: keepPreviousData, // keep the old markers on screen while the next viewport loads: no flash
    staleTime: 30_000,
  });

  useEffect(() => {
    const g = layer.current, m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    for (const mk of q.data?.markers ?? []) {
      if (mk.kind === "cluster") {
        const size = Math.min(56, 26 + Math.log10(mk.count + 1) * 14);
        const icon = L.divIcon({ className: "", iconSize: [size, size], html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${DB_RED};color:#fff;display:flex;align-items:center;justify-content:center;font:700 12px system-ui;box-shadow:0 0 0 4px rgba(236,0,22,.25)">${mk.count}</div>` });
        L.marker([mk.lat, mk.lng], { icon, keyboard: true, title: `${mk.count} Projekte` }).on("click", () => m.flyTo([mk.lat, mk.lng], Math.min(m.getZoom() + 2, 14))).addTo(g);
      } else {
        const color = PRECISION_COLOR[mk.precision];
        const cm = L.circleMarker([mk.lat, mk.lng], { radius: Math.min(14, 6 + Math.sqrt(mk.count)), color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 });
        cm.bindPopup(() => {
          const box = document.createElement("div");
          box.style.cssText = "min-width:220px;max-width:300px";
          const h = document.createElement("div");
          h.style.cssText = "font:800 14px system-ui";
          h.textContent = mk.name;
          const sub = document.createElement("div");
          sub.style.cssText = "font-size:11px;color:#666;margin:2px 0 6px";
          sub.textContent = `${mk.count} ${mk.count === 1 ? "Projekt" : "Projekte"}${mk.precision === "exact" ? "" : " · ungenau verortet"}`;
          const list = document.createElement("div");
          list.textContent = "Lade …";
          box.append(h, sub, list);
          const input: MapStationQuery = { stationKey: mk.key, ...filtersRef.current };
          void serverApi.map.station.query(input).then(r => {
            list.textContent = "";
            for (const p of r.projects) {
              const b = document.createElement("button");
              b.type = "button";
              b.style.cssText = "display:block;width:100%;text-align:left;padding:6px 4px;border:0;border-bottom:1px solid #eee;background:none;cursor:pointer;font:12px system-ui;min-height:32px";
              b.textContent = `${p.projektnummer ?? `#${p.id}`} · ${p.projektstand ?? "–"}${p.projektleiter ? ` · ${p.projektleiter}` : ""}`;
              b.addEventListener("click", () => onSelect.current?.(p.id));
              list.append(b);
            }
            if (r.total > r.projects.length) { const more = document.createElement("div"); more.style.cssText = "font-size:11px;color:#888;padding:4px"; more.textContent = `+ ${r.total - r.projects.length} weitere`; list.append(more); }
          }).catch(() => { list.textContent = "Projekte konnten nicht geladen werden."; });
          return box;
        });
        cm.addTo(g);
      }
    }
  }, [q.data]);

  return (
    <div className={className} data-testid="server-map">
      <div ref={el} className="h-full w-full" role="application" aria-label="Karte der Projekte" />
      <p role="status" aria-live="polite" className="absolute left-3 top-3 z-[500] rounded-md bg-white/90 px-2 py-1 text-xs shadow dark:bg-zinc-900/90">
        {q.isPending ? "Karte lädt …" : q.isError ? "Karte nicht verfügbar" : `${(q.data?.total ?? 0).toLocaleString("de-DE")} Projekte im Ausschnitt${q.isFetching ? " …" : ""}`}
      </p>
    </div>
  );
}
