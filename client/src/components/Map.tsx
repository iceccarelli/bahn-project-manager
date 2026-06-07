import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Project } from "@/hooks/useDataQuery";
import { useStations } from "@/hooks/useStations";
import { buildStationGeo, type ResolvedStation } from "@/lib/stationGeo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Info, Maximize, Minimize, LocateFixed } from "lucide-react";

interface StationGroup {
  key: string;
  name: string;
  lat: number;
  lng: number;
  exact: boolean;
  projects: Project[];
}

interface MapViewProps {
  projects: Project[];
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
  onBoundsChange?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
  onProjectSelect?: (projectId: number) => void;
}

const createDotIcon = (count: number, exact: boolean) => {
  const size = count > 1 ? 34 : 26;
  const bg = exact ? "#FF0000" : "#9ca3af";
  const ring = exact ? "rgba(255,0,0,0.30)" : "rgba(0,0,0,0.18)";
  return L.divIcon({
    className: "db-dot-marker",
    html:
      `<div style="width:${size}px;height:${size}px;background:${bg};` +
      `border:2.5px solid #fff;border-radius:50%;` +
      `box-shadow:0 2px 8px ${ring},0 0 0 3px ${ring};` +
      `display:flex;align-items:center;justify-content:center;color:#fff;` +
      `font-weight:800;font-size:${(size / 2.2).toFixed(0)}px;` +
      `font-family:'DB Sans',system-ui,sans-serif;">${count > 1 ? count : ""}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2], // dot sits exactly ON the station coordinate
    popupAnchor: [0, -(size / 2) - 2],
  });
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function popupHtml(group: StationGroup): string {
  const rows = group.projects
    .slice(0, 12)
    .map(
      (p) =>
        `<button data-pid="${p.id}" style="display:block;width:100%;text-align:left;border:0;` +
        `background:transparent;padding:8px;border-radius:10px;cursor:pointer;margin:0 0 4px;">` +
        `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">` +
        `<span style="font:700 10px ui-monospace,monospace;color:#FF0000;background:rgba(255,0,0,.06);padding:1px 6px;border-radius:4px;">${esc(p.projektnummer || "—")}</span>` +
        `<span style="font-size:9px;color:#555;border:1px solid #ddd;border-radius:6px;padding:1px 6px;">${esc(p.bahnhofsmanagement || "")}</span></div>` +
        `<div style="font:700 12px system-ui;margin-top:4px;line-height:1.3;">${esc(p.projektbeschreibung || p.station || "")}</div>` +
        `<div style="font-size:10px;color:#666;margin-top:3px;">${esc(p.projektleiter || "Unbekannt")}${p.projektstand ? " · " + esc(p.projektstand) : ""}</div>` +
        `</button>`
    )
    .join("");
  const more =
    group.projects.length > 12
      ? `<div style="text-align:center;font-size:10px;color:#888;font-style:italic;padding:4px;">+ ${group.projects.length - 12} weitere Projekte an dieser Station</div>`
      : "";
  return (
    `<div style="min-width:240px;max-width:300px;">` +
    `<div style="font:800 14px system-ui;line-height:1.2;">${esc(group.name)}</div>` +
    `<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:${group.exact ? "#888" : "#b45309"};margin-top:2px;">` +
    `${group.projects.length} ${group.projects.length === 1 ? "Projekt" : "Projekte"}${group.exact ? "" : " · ungenau verortet"}</div>` +
    `<div style="max-height:240px;overflow-y:auto;margin-top:8px;border-top:1px solid #eee;padding-top:6px;">${rows}${more}</div>` +
    `</div>`
  );
}

export const MapView: React.FC<MapViewProps> = ({
  projects,
  initialCenter = { lat: 50.3, lng: 8.6 },
  initialZoom = 8,
  className = "h-full w-full",
  onBoundsChange,
  onProjectSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const didFitRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { rows } = useStations();
  const geo = useMemo(() => buildStationGeo(rows), [rows]);

  // Group every project onto its real station (or region fallback). No city aggregation.
  const groups = useMemo<StationGroup[]>(() => {
    const map = new Map<string, StationGroup>();
    for (const p of projects) {
      const r: ResolvedStation | null = geo.resolve(p.station, p.bahnhofsmanagement);
      if (!r) continue;
      const g = map.get(r.key);
      if (g) g.projects.push(p);
      else map.set(r.key, { key: r.key, name: r.name, lat: r.lat, lng: r.lng, exact: r.exact, projects: [p] });
    }
    return Array.from(map.values());
  }, [projects, geo]);

  const exactCount = useMemo(() => groups.filter((g) => g.exact).reduce((n, g) => n + g.projects.length, 0), [groups]);

  // latest callbacks in refs so the init effect can stay mount-only
  const onBoundsRef = useRef(onBoundsChange);
  const onSelectRef = useRef(onProjectSelect);
  const groupsRef = useRef(groups);
  onBoundsRef.current = onBoundsChange;
  onSelectRef.current = onProjectSelect;
  groupsRef.current = groups;

  // ---- create the map exactly once per mount, and tear it down cleanly ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // guard against a container Leaflet already initialised (StrictMode/HMR)
    if ((el as any)._leaflet_id) return;

    const map = L.map(el, {
      center: [initialCenter.lat, initialCenter.lng],
      zoom: initialZoom,
      scrollWheelZoom: true,
      zoomControl: false,
      preferCanvas: false,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);

    const emitBounds = () => {
      const b = map.getBounds();
      onBoundsRef.current?.({
        minLat: b.getSouthWest().lat,
        maxLat: b.getNorthEast().lat,
        minLng: b.getSouthWest().lng,
        maxLng: b.getNorthEast().lng,
      });
    };
    map.on("moveend", emitBounds);
    map.on("zoomend", emitBounds);

    // delegate clicks inside popups to onProjectSelect
    map.on("popupopen", (e: L.PopupEvent) => {
      const root = (e.popup as any).getElement?.() as HTMLElement | undefined;
      if (!root) return;
      root.querySelectorAll<HTMLElement>("[data-pid]").forEach((btn) => {
        btn.onclick = () => {
          const id = Number(btn.getAttribute("data-pid"));
          if (!Number.isNaN(id)) onSelectRef.current?.(id);
        };
      });
    });

    // size correctly once layout settles
    setTimeout(() => map.invalidateSize(), 0);
    emitBounds();

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      didFitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- (re)draw markers whenever the resolved groups change ----
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const g of groups) {
      const marker = L.marker([g.lat, g.lng], { icon: createDotIcon(g.projects.length, g.exact) });
      marker.bindPopup(popupHtml(g), { minWidth: 240, maxWidth: 320, className: "db-popup" });
      marker.on("click", () => map.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 13), { duration: 0.6 }));
      layer.addLayer(marker);
    }

    if (!didFitRef.current && groups.length) {
      const pts = groups.filter((g) => g.exact).map((g) => [g.lat, g.lng]) as [number, number][];
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts).pad(0.15));
        didFitRef.current = true;
      }
    }
  }, [groups]);

  // keep Leaflet sized when toggling fullscreen
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = groups.filter((g) => g.exact).map((g) => [g.lat, g.lng]) as [number, number][];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15));
  }, [groups]);

  const containerClass = isFullscreen
    ? "fixed inset-0 z-[9999] bg-background"
    : `relative ${className} rounded-2xl overflow-hidden border-2 border-border/50 shadow-2xl bg-muted/5`;

  return (
    <div className={containerClass}>
      <div ref={containerRef} className="h-full w-full z-0" />

      <div className="absolute top-6 left-6 z-[1000] pointer-events-none">
        <Card className="p-4 bg-background/95 backdrop-blur-xl shadow-2xl border-[#FF0000]/30 pointer-events-auto rounded-2xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FF0000] rounded-2xl flex items-center justify-center shadow-xl shadow-[#FF0000]/30">
              <MapPin className="text-white h-7 w-7" />
            </div>
            <div>
              <h4 className="text-base font-black leading-none tracking-tight">Netz-Explorer</h4>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-black mt-1.5">
                {groups.filter((g) => g.exact).length.toLocaleString("de-DE")} Stationen · {exactCount.toLocaleString("de-DE")} Projekte exakt verortet
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="absolute bottom-6 left-6 z-[1000] pointer-events-none">
        <div className="flex flex-col gap-3 bg-background/90 backdrop-blur-lg p-4 rounded-2xl border-2 border-border/50 text-[11px] font-bold pointer-events-auto shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-[#FF0000] border-2 border-white shadow-md" />
            <span className="text-foreground/80">Station (exakt)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-[#FF0000] border-2 border-white flex items-center justify-center text-[9px] text-white font-black shadow-md">
              12
            </div>
            <span className="text-foreground/80">Projekte je Station</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-[#9ca3af] border-2 border-white shadow-md" />
            <span className="text-foreground/80">ungenau (Region)</span>
          </div>
          <div className="pt-2 border-t border-border/50 mt-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <span>Marker klicken zum Zoomen</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute top-6 right-6 z-[1000] flex gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={fitAll}
          title="Alle Stationen anzeigen"
          className="bg-background/95 backdrop-blur-xl border-2 border-border/50 shadow-2xl hover:bg-muted"
        >
          <LocateFixed className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsFullscreen((v) => !v)}
          className="bg-background/95 backdrop-blur-xl border-2 border-border/50 shadow-2xl hover:bg-muted"
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};
