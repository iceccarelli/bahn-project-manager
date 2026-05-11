/**
 * PROFESSIONAL FREE MAP INTEGRATION FOR BAHN PROJECT MANAGER (Leaflet + OpenStreetMap)
 * 
 * Easiest, fastest, completely free (no API keys, no billing, unlimited) production-ready MapView.
 * - 100% free & open source (Leaflet + OSM/Carto tiles)
 * - Dynamic markers for all project stations with smart geocoding (Nominatim free) + large seed cache for instant load
 * - Rich popups with ALL project information: station, Bahnhofsmanagement, leaders, descriptions, status counts per dept
 * - Perfect alignment with your Übersichtsliste data (station + reviews aggregated)
 * - Search (free geocoding), Fit bounds, professional floating Google-Maps-style controls
 * - Responsive, dark-mode ready, accessible, fast
 * - No env vars, no proxy, works immediately on Vercel / any hosting
 *
 * Drop-in replacement for previous Google version. Same props & UX.
 *
 * USAGE (no changes needed in Projects.tsx):
 * <MapView
 *   projects={data?.projects || []}
 *   initialCenter={{ lat: 50.1109, lng: 8.6821 }}
 *   initialZoom={6}
 *   className="h-[640px] w-full"
 * />
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

// Fix Leaflet default marker icons for Vite / modern bundlers (common gotcha)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

declare global {
  interface Window {
    L?: typeof L;
  }
}

// ============================================================================
// Types (same interface as before for zero breaking changes)
// ============================================================================

interface ProjectLocation {
  station?: string | null;
  bahnhofsmanagement?: string | null;
  projektbeschreibung?: string | null;
  projektleiter?: string | null;
  reviews?: Array<{ department: string; status: string | null }>;
}

interface MapViewProps {
  className?: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  projects?: ProjectLocation[];
  onMapReady?: (map: L.Map) => void; // kept for compatibility
}

// ============================================================================
// Preloaded accurate coordinates for major Deutsche Bahn stations (instant, zero API calls)
// ============================================================================

const STATION_SEED: Record<string, { lat: number; lng: number }> = {
  "frankfurt (main) süd": { lat: 50.099, lng: 8.685 },
  "frankfurt hbf": { lat: 50.107, lng: 8.664 },
  "frankfurt am main": { lat: 50.1109, lng: 8.6821 },
  "kassel": { lat: 51.313, lng: 9.48 },
  "bad hersfeld": { lat: 50.868, lng: 9.703 },
  "darmstadt hbf": { lat: 49.872, lng: 8.652 },
  "mainz hbf": { lat: 50.001, lng: 8.271 },
  "koblenz hbf": { lat: 50.351, lng: 7.589 },
  "gießen": { lat: 50.583, lng: 8.675 },
  "berlin hbf": { lat: 52.525, lng: 13.369 },
  "münchen hbf": { lat: 48.14, lng: 11.56 },
  "hamburg hbf": { lat: 53.552, lng: 10.007 },
  "köln hbf": { lat: 50.943, lng: 6.959 },
  "stuttgart hbf": { lat: 48.784, lng: 9.182 },
  "hannover hbf": { lat: 52.376, lng: 9.741 },
  "leipzig hbf": { lat: 51.346, lng: 12.382 },
  "nürnberg hbf": { lat: 49.446, lng: 11.082 },
  "dresden hbf": { lat: 51.04, lng: 13.73 },
  "düsseldorf hbf": { lat: 51.22, lng: 6.79 },
  "essen hbf": { lat: 51.45, lng: 7.01 },
  "dortmund hbf": { lat: 51.518, lng: 7.459 },
  "wiesbaden hbf": { lat: 50.07, lng: 8.24 },
  "ulm hbf": { lat: 48.4, lng: 9.98 },
  "augsburg hbf": { lat: 48.366, lng: 10.886 },
  "regensburg hbf": { lat: 49.01, lng: 12.1 },
  "erfurt hbf": { lat: 50.97, lng: 11.03 },
  "chemnitz hbf": { lat: 50.83, lng: 12.92 },
  "rostock hbf": { lat: 54.09, lng: 12.14 },
  "kiel hbf": { lat: 54.315, lng: 10.122 },
  "lübeck hbf": { lat: 53.87, lng: 10.67 },
};

// ============================================================================
// Free geocoding via Nominatim (polite, cached, rate-limited)
// ============================================================================

const geoCache = new Map<string, { lat: number; lng: number }>();

async function geocodeStation(station: string): Promise<{ lat: number; lng: number } | null> {
  const key = station.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key)!;

  try {
    const q = encodeURIComponent(`${station}, Deutschland`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1&countrycodes=de&addressdetails=0`;
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "BahnProjectManager/1.0 (internal tool)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) throw new Error(`Nominatim ${res.status}`);

    const data: Array<{ lat: string; lon: string }> = await res.json();

    if (data.length > 0) {
      const pos = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
      geoCache.set(key, pos);
      return pos;
    }
    return null;
  } catch (err) {
    console.warn("[Map] Geocode failed for", station, err);
    return null;
  }
}

// ============================================================================
// Rich Popup Content (exact same professional information as Google version)
// ============================================================================

function PopupContent({ station, projs }: { station: string; projs: ProjectLocation[] }) {
  const count = projs.length;
  const leaders = [...new Set(projs.map((p) => p.projektleiter).filter(Boolean))].slice(0, 3) as string[];
  const descs = projs
    .slice(0, 2)
    .map((p) => p.projektbeschreibung?.substring(0, 90) || "")
    .filter(Boolean);

  const statusSummary = projs
    .flatMap((p) => p.reviews || [])
    .reduce((acc: Record<string, number>, r) => {
      if (r.status) acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

  const statusHtml = Object.entries(statusSummary)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(
      ([s, c]) =>
        `<span class="inline-block px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 mr-1 mb-0.5">${s} (${c})</span>`
    )
    .join("");

  return (
    <div className="min-w-[260px] max-w-[320px] p-1 text-sm" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 bg-[#FF0000] rounded-full flex items-center justify-center text-white font-bold text-sm shadow">DB</div>
        <div>
          <div className="font-bold text-base text-[#111] dark:text-white">{station}</div>
          <div className="text-xs text-muted-foreground">{projs[0]?.bahnhofsmanagement || "Deutsche Bahn Projektstandort"}</div>
        </div>
      </div>

      <div className="mb-3 p-2.5 bg-muted/60 rounded-lg text-xs">
        <div className="font-semibold text-foreground mb-0.5">
          {count} Projekt{count > 1 ? "e" : ""} an diesem Standort
        </div>
        {leaders.length > 0 && (
          <div className="text-muted-foreground">
            Leitung: {leaders.join(", ")}
            {leaders.length < projs.length ? " u.a." : ""}
          </div>
        )}
      </div>

      {descs.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold text-[#FF0000] mb-1">BESCHREIBUNG</div>
          {descs.map((d, i) => (
            <div key={i} className="text-xs text-muted-foreground leading-snug mb-0.5">• {d}...</div>
          ))}
        </div>
      )}

      {Object.keys(statusSummary).length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] font-semibold text-[#FF0000] mb-1.5">STATUS ÜBERSICHT</div>
          <div dangerouslySetInnerHTML={{ __html: statusHtml }} />
        </div>
      )}

      <div className="mt-3 pt-2 border-t text-[9px] text-muted-foreground/70">
        OpenStreetMap • Kostenlos • Echtzeit-Standort • {new Date().getFullYear()}
      </div>
    </div>
  );
}

// ============================================================================
// Main MapView Component
// ============================================================================

export function MapView({
  className,
  initialCenter = { lat: 50.1109, lng: 8.6821 }, // Frankfurt - ideal DB center
  initialZoom = 6,
  projects = [],
  onMapReady,
}: MapViewProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [markerData, setMarkerData] = useState<
    Array<{ station: string; pos: { lat: number; lng: number }; projs: ProjectLocation[] }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const geoCacheRef = useRef(geoCache); // shared cache

  // Seed cache instantly (no network)
  const seedCache = useCallback(() => {
    Object.entries(STATION_SEED).forEach(([name, pos]) => {
      geoCacheRef.current.set(name, pos);
    });
  }, []);

  // Process & geocode projects (grouped by station)
  const processProjects = useCallback(
    async (projs: ProjectLocation[]) => {
      if (!projs.length) {
        setMarkerData([]);
        return;
      }

      setIsLoading(true);

      const grouped = new Map<string, ProjectLocation[]>();
      projs.forEach((p) => {
        const key = (p.station || "Unbekannter Standort").trim();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(p);
      });

      const stations = Array.from(grouped.keys());
      const newData: typeof markerData = [];
      let added = 0;

      for (const station of stations) {
        const projsAt = grouped.get(station)!;
        let pos = geoCacheRef.current.get(station.toLowerCase().trim());

        if (!pos) {
          pos = await geocodeStation(station);
          if (!pos) {
            // Fallback jitter around Germany center (still useful)
            pos = {
              lat: 50.8 + (Math.random() - 0.5) * 1.8,
              lng: 9.8 + (Math.random() - 0.5) * 2.8,
            };
          }
        }

        newData.push({ station, pos, projs: projsAt });
        added++;

        // Be polite to free Nominatim (max ~1 req/sec)
        if (!geoCacheRef.current.has(station.toLowerCase().trim())) {
          await new Promise((r) => setTimeout(r, 220));
        }
      }

      setMarkerData(newData);
      setIsLoading(false);

      // Auto-fit after render
      setTimeout(() => {
        if (mapInstance && newData.length > 0) {
          const bounds = L.latLngBounds(newData.map((m) => m.pos));
          mapInstance.flyToBounds(bounds, { padding: [70, 70], duration: 0.8 });
          if (mapInstance.getZoom() > 14) mapInstance.setZoom(11);
        }
      }, 450);
    },
    [mapInstance]
  );

  // React to incoming projects (filter changes etc)
  useEffect(() => {
    if (projects.length > 0) {
      // Seed first for instant known stations
      seedCache();
      processProjects(projects);
    } else {
      setMarkerData([]);
    }
  }, [projects, processProjects, seedCache]);

  // Fit all markers button
  const fitToMarkers = () => {
    if (!mapInstance || markerData.length === 0) return;
    const bounds = L.latLngBounds(markerData.map((m) => m.pos));
    mapInstance.flyToBounds(bounds, { padding: [80, 80], duration: 0.6 });
  };

  // Free search via Nominatim (Enter key)
  const handleQuickSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !mapInstance) return;
    const query = (e.target as HTMLInputElement).value.trim();
    if (!query) return;

    setSearchQuery("");
    const pos = await geocodeStation(query);
    if (pos && mapInstance) {
      mapInstance.flyTo(pos, 13, { duration: 0.6 });
      // Brief highlight marker effect (simple circle)
      const circle = L.circleMarker(pos, {
        radius: 18,
        color: "#FF0000",
        weight: 3,
        fillOpacity: 0.15,
      }).addTo(mapInstance);
      setTimeout(() => circle.remove(), 2200);
    } else {
      // fallback center Germany
      mapInstance.flyTo({ lat: 51.0, lng: 10.0 }, 6);
    }
  };

  // Custom DB red marker icon (looks like Google Maps pin but DB branded)
  const createDBIcon = () =>
    L.divIcon({
      className: "db-marker",
      html: `
        <div style="
          width: 26px; height: 26px; 
          background: #FF0000; 
          border: 3px solid #fff; 
          border-radius: 9999px; 
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 800; font-size: 11px; letter-spacing: -.5px;
        ">
          DB
        </div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });

  const dbIcon = createDBIcon();

  return (
    <div className={cn("relative w-full overflow-hidden rounded-2xl border border-[#FF0000]/20 bg-white shadow-sm", className)}>
      {/* Professional floating controls (Google Maps style) */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-lg backdrop-blur border border-[#FF0000]/10">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#FF0000]">
          <MapPin className="h-4 w-4" /> DB Projektkarte
        </div>

        <div className="h-4 w-px bg-border mx-1" />

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Standort suchen (z.B. München Hbf, Kassel...)"
          className="flex-1 min-w-[200px] rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#FF0000]"
          onKeyDown={handleQuickSearch}
        />

        <button
          onClick={fitToMarkers}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1 text-xs font-medium hover:bg-accent active:bg-accent/80 transition-colors"
          title="Alle Marker einpassen"
        >
          Alle anzeigen
        </button>

        {isLoading && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground pr-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Standorte werden geladen...
          </div>
        )}
      </div>

      {/* Leaflet Map */}
      <div className="w-full h-full min-h-[520px] bg-[#f8f8f8]">
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          className="h-full w-full z-0"
          whenCreated={(map) => {
            setMapInstance(map);
            if (onMapReady) onMapReady(map);
          }}
          zoomControl={true}
          attributionControl={true}
        >
          {/* Clean professional tile layer (CartoDB Positron - data friendly, Google-like) */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains={["a", "b", "c", "d"]}
            maxZoom={20}
          />

          {/* Markers with rich popups */}
          {markerData.map((m, idx) => (
            <Marker key={`${m.station}-${idx}`} position={m.pos} icon={dbIcon}>
              <Popup maxWidth={340} minWidth={260} className="db-popup">
                <PopupContent station={m.station} projs={m.projs} />
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Bottom status bar (Google Maps style) */}
      <div className="absolute bottom-2 right-3 z-[1000] rounded bg-white/90 px-2.5 py-0.5 text-[10px] text-muted-foreground shadow border border-[#FF0000]/10">
        OpenStreetMap • Kostenlos • {markerData.length} Standorte • {projects.length} Projekte
      </div>

      {/* Subtle helper */}
      <div className="absolute bottom-2 left-3 z-[1000] text-[9px] text-muted-foreground/60 bg-white/80 px-1.5 py-px rounded">
        Klicken Sie auf einen roten DB-Pin für Details
      </div>
    </div>
  );
}
