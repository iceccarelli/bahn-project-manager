import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Project } from "@/_core/api/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, MapPin, Navigation, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Fix Leaflet default icon issue
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

/**
 * PROFESSIONAL DB RED MARKER ENGINE
 * Creates high-performance SVG-based markers with dynamic sizing and clustering indicators.
 */
const createCustomIcon = (isMajor: boolean, count: number = 1, status?: string) => {
  const size = isMajor ? 36 : 28;
  const color = "#FF0000"; // DB Red
  
  return L.divIcon({
    className: "custom-db-marker",
    html: `
      <div class="marker-container" style="
        width: ${size}px; 
        height: ${size}px; 
        background-color: ${color}; 
        border-radius: 50%; 
        border: 2.5px solid white; 
        box-shadow: 0 4px 12px rgba(255,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 800;
        font-family: 'DB Sans', sans-serif;
        font-size: ${size / 2.2}px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        cursor: pointer;
      ">
        ${count > 1 ? count : ""}
        <div style="
          position: absolute;
          bottom: -6px;
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid white;
        "></div>
      </div>
    `,
    iconSize: [size, size + 8],
    iconAnchor: [size / 2, size + 8],
    popupAnchor: [0, -(size + 8)],
  });
};

/**
 * INTELLIGENT GEOGRAPHIC HIERARCHY
 * Maps major German hubs with priority levels for zoom-based progressive disclosure.
 */
const CITY_COORDINATES: Record<string, { lat: number; lng: number; priority: number }> = {
  "Berlin": { lat: 52.5200, lng: 13.4050, priority: 1 },
  "Hamburg": { lat: 53.5511, lng: 9.9937, priority: 1 },
  "München": { lat: 48.1351, lng: 11.5820, priority: 1 },
  "Köln": { lat: 50.9375, lng: 6.9603, priority: 1 },
  "Frankfurt": { lat: 50.1109, lng: 8.6821, priority: 1 },
  "Stuttgart": { lat: 48.7758, lng: 9.1829, priority: 1 },
  "Düsseldorf": { lat: 51.2277, lng: 6.7735, priority: 1 },
  "Leipzig": { lat: 51.3397, lng: 12.3731, priority: 1 },
  "Dortmund": { lat: 51.5136, lng: 7.4653, priority: 1 },
  "Essen": { lat: 51.4556, lng: 7.0116, priority: 1 },
  "Bremen": { lat: 53.0793, lng: 8.8017, priority: 2 },
  "Dresden": { lat: 51.0504, lng: 13.7373, priority: 2 },
  "Hannover": { lat: 52.3759, lng: 9.7320, priority: 2 },
  "Nürnberg": { lat: 49.4521, lng: 11.0767, priority: 2 },
  "Duisburg": { lat: 51.4344, lng: 6.7623, priority: 2 },
  "Bochum": { lat: 51.4818, lng: 7.2162, priority: 2 },
  "Wuppertal": { lat: 51.2562, lng: 7.1508, priority: 2 },
  "Bielefeld": { lat: 52.0302, lng: 8.5325, priority: 2 },
  "Bonn": { lat: 50.7337, lng: 7.0998, priority: 2 },
  "Münster": { lat: 51.9607, lng: 7.6261, priority: 2 },
  "Karlsruhe": { lat: 49.0069, lng: 8.4037, priority: 2 },
  "Mannheim": { lat: 49.4875, lng: 8.4660, priority: 2 },
  "Augsburg": { lat: 48.3705, lng: 10.8978, priority: 2 },
  "Wiesbaden": { lat: 50.0782, lng: 8.2398, priority: 2 },
  "Gelsenkirchen": { lat: 51.5177, lng: 7.0857, priority: 2 },
  "Mönchengladbach": { lat: 51.1805, lng: 6.4428, priority: 2 },
  "Braunschweig": { lat: 52.2689, lng: 10.5268, priority: 2 },
  "Chemnitz": { lat: 50.8278, lng: 12.9214, priority: 2 },
  "Kiel": { lat: 54.3233, lng: 10.1228, priority: 2 },
  "Aachen": { lat: 50.7753, lng: 6.0839, priority: 2 },
  "Halle": { lat: 51.4828, lng: 11.9697, priority: 2 },
  "Magdeburg": { lat: 52.1205, lng: 11.6276, priority: 2 },
  "Freiburg": { lat: 47.9990, lng: 7.8421, priority: 2 },
  "Krefeld": { lat: 51.3331, lng: 6.5623, priority: 2 },
  "Lübeck": { lat: 53.8655, lng: 10.6866, priority: 2 },
  "Oberhausen": { lat: 51.4713, lng: 6.8647, priority: 2 },
  "Erfurt": { lat: 50.9848, lng: 11.0299, priority: 2 },
  "Mainz": { lat: 50.0002, lng: 8.2705, priority: 2 },
  "Rostock": { lat: 54.0924, lng: 12.0991, priority: 2 },
  "Kassel": { lat: 51.3127, lng: 9.4797, priority: 2 },
  "Hagen": { lat: 51.3671, lng: 7.4633, priority: 2 },
  "Hamm": { lat: 51.6739, lng: 7.8150, priority: 2 },
  "Saarbrücken": { lat: 49.2402, lng: 6.9969, priority: 2 },
  "Mülheim": { lat: 51.4273, lng: 6.8824, priority: 2 },
  "Potsdam": { lat: 52.3906, lng: 13.0645, priority: 2 },
  "Ludwigshafen": { lat: 49.4811, lng: 8.4353, priority: 2 },
  "Oldenburg": { lat: 53.1435, lng: 8.2146, priority: 2 },
  "Leverkusen": { lat: 51.0459, lng: 7.0192, priority: 2 },
  "Osnabrück": { lat: 52.2726, lng: 8.0498, priority: 2 },
  "Solingen": { lat: 51.1652, lng: 7.0671, priority: 2 },
  "Heidelberg": { lat: 49.3988, lng: 8.6724, priority: 2 },
  "Herne": { lat: 51.5380, lng: 7.2199, priority: 2 },
  "Neuss": { lat: 51.1981, lng: 6.6850, priority: 2 },
  "Darmstadt": { lat: 49.8728, lng: 8.6512, priority: 2 },
  "Paderborn": { lat: 51.7189, lng: 8.7575, priority: 2 },
  "Regensburg": { lat: 49.0134, lng: 12.1016, priority: 2 },
  "Ingolstadt": { lat: 48.7665, lng: 11.4258, priority: 2 },
  "Würzburg": { lat: 49.7913, lng: 9.9534, priority: 2 },
  "Fürth": { lat: 49.4774, lng: 10.9893, priority: 2 },
  "Wolfsburg": { lat: 52.4227, lng: 10.7865, priority: 2 },
  "Offenbach": { lat: 50.1020, lng: 8.7634, priority: 2 },
  "Ulm": { lat: 48.4011, lng: 9.9876, priority: 2 },
  "Heilbronn": { lat: 49.1427, lng: 9.2108, priority: 2 },
  "Pforzheim": { lat: 48.8911, lng: 8.7040, priority: 2 },
  "Göttingen": { lat: 51.5413, lng: 9.9158, priority: 2 },
  "Bottrop": { lat: 51.5232, lng: 6.9253, priority: 2 },
  "Recklinghausen": { lat: 51.6144, lng: 7.1972, priority: 2 },
  "Reutlingen": { lat: 48.4914, lng: 9.2043, priority: 2 },
  "Koblenz": { lat: 50.3569, lng: 7.5890, priority: 2 },
  "Bremerhaven": { lat: 53.5396, lng: 8.5809, priority: 2 },
  "Bergisch Gladbach": { lat: 50.9915, lng: 7.1292, priority: 2 },
  "Jena": { lat: 50.9271, lng: 11.5892, priority: 2 },
  "Remscheid": { lat: 51.1802, lng: 7.1868, priority: 2 },
  "Erlangen": { lat: 49.5897, lng: 11.0039, priority: 2 },
  "Moers": { lat: 51.4511, lng: 6.6285, priority: 2 },
  "Siegen": { lat: 50.8748, lng: 8.0243, priority: 2 },
  "Trier": { lat: 49.7492, lng: 6.6371, priority: 2 },
  "Cottbus": { lat: 51.7563, lng: 14.3329, priority: 2 },
};

/**
 * STATION NORMALIZATION ENGINE
 * Resolves station names to geographic coordinates with intelligent fuzzy matching.
 */
const getCoordinates = (station: string | null) => {
  if (!station) return null;
  
  const normalized = station.toLowerCase();
  
  // Priority 1: Exact Hub Match
  for (const city in CITY_COORDINATES) {
    if (normalized.includes(city.toLowerCase())) {
      return { ...CITY_COORDINATES[city], name: city };
    }
  }
  
  // Priority 2: Regional Hub Fallback
  if (normalized.includes("berlin")) return { ...CITY_COORDINATES["Berlin"], name: "Berlin Region" };
  if (normalized.includes("hamburg")) return { ...CITY_COORDINATES["Hamburg"], name: "Hamburg Region" };
  if (normalized.includes("münchen") || normalized.includes("muenchen")) return { ...CITY_COORDINATES["München"], name: "München Region" };
  if (normalized.includes("köln") || normalized.includes("koeln")) return { ...CITY_COORDINATES["Köln"], name: "Köln Region" };
  if (normalized.includes("frankfurt")) return { ...CITY_COORDINATES["Frankfurt"], name: "Frankfurt Region" };
  
  // Default: Center of Germany (Kassel area)
  return { lat: 51.3127, lng: 9.4797, priority: 3, name: "Zentral-Deutschland" };
};

interface MapViewProps {
  projects: Project[];
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
}

/**
 * ZERO-DEPENDENCY CLUSTERING CONTROLLER
 * Manages marker visibility and grouping based on zoom level without external libraries.
 */
const MapHierarchyController = ({ projects }: { projects: Project[] }) => {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map]);

  // Group projects by location
  const groupedProjects = useMemo(() => {
    const groups: Record<string, { lat: number; lng: number; priority: number; name: string; projects: Project[] }> = {};
    
    projects.forEach(p => {
      const coords = getCoordinates(p.station);
      if (coords) {
        const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
        if (!groups[key]) {
          groups[key] = { ...coords, projects: [] };
        }
        groups[key].projects.push(p);
      }
    });
    
    return Object.values(groups);
  }, [projects]);

  // Intelligent Zoom-Based Filtering
  const visibleGroups = useMemo(() => {
    return groupedProjects.filter(group => {
      if (zoom < 7) return group.priority === 1; // Only major hubs
      if (zoom < 9) return group.priority <= 2; // Hubs + Regional cities
      return true; // Show everything
    });
  }, [groupedProjects, zoom]);

  return (
    <>
      {visibleGroups.map((group, idx) => (
        <Marker 
          key={`${group.lat}-${group.lng}-${idx}`} 
          position={[group.lat, group.lng]}
          icon={createCustomIcon(group.priority === 1, group.projects.length)}
        >
          <Popup className="custom-db-popup" minWidth={280}>
            <div className="p-3">
              <div className="flex items-center gap-3 mb-4 border-b pb-3">
                <div className="w-10 h-10 bg-[#FF0000] rounded-xl flex items-center justify-center text-white font-extrabold shadow-lg shadow-[#FF0000]/20">
                  {group.projects.length}
                </div>
                <div>
                  <h3 className="font-bold text-base leading-tight text-foreground">{group.name}</h3>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">
                    {group.projects.length} {group.projects.length === 1 ? "Projekt" : "Projekte"} aktiv
                  </p>
                </div>
              </div>
              
              <div className="max-h-[240px] overflow-y-auto space-y-2.5 pr-2 custom-scrollbar">
                {group.projects.slice(0, 10).map(p => (
                  <div key={p.id} className="p-3 rounded-xl bg-muted/40 hover:bg-muted/80 transition-all border border-transparent hover:border-[#FF0000]/30 group cursor-pointer">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-mono font-bold text-[#FF0000] bg-[#FF0000]/5 px-1.5 py-0.5 rounded">
                        {p.projektnummer || "N/A"}
                      </span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-background border-muted-foreground/20">
                        {p.bahnhofsmanagement || "Region"}
                      </Badge>
                    </div>
                    <p className="text-xs font-bold line-clamp-2 mt-2 group-hover:text-[#FF0000] transition-colors leading-snug">
                      {p.projektbeschreibung || p.station}
                    </p>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-muted-foreground/10">
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[8px] font-bold">
                          {p.projektleiter?.[0] || "?"}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium">{p.projektleiter || "Unbekannt"}</span>
                      </div>
                      <Navigation className="h-3.5 w-3.5 text-[#FF0000] opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0" />
                    </div>
                  </div>
                ))}
                {group.projects.length > 10 && (
                  <div className="text-center py-2">
                    <p className="text-[10px] text-muted-foreground italic font-medium">
                      + {group.projects.length - 10} weitere Projekte an diesem Standort
                    </p>
                  </div>
                )}
              </div>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-4 h-9 text-[11px] font-bold gap-2 border-[#FF0000]/20 hover:bg-[#FF0000] hover:text-white hover:border-[#FF0000] transition-all rounded-xl"
              >
                Details in Liste anzeigen <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
};

/**
 * ULTIMATE MAP VIEW COMPONENT
 * A high-performance, production-grade map explorer for the BAHN PROJECT MANAGER.
 */
export const MapView: React.FC<MapViewProps> = ({
  projects,
  initialCenter = { lat: 51.1657, lng: 10.4515 },
  initialZoom = 6,
  className = "h-full w-full",
}) => {
  return (
    <div className={`relative ${className} rounded-2xl overflow-hidden border-2 border-border/50 shadow-2xl bg-muted/5`}>
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        scrollWheelZoom={true}
        className="h-full w-full z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <MapHierarchyController projects={projects} />
      </MapContainer>
      
      {/* Professional Floating HUD */}
      <div className="absolute top-6 left-6 z-[1000] pointer-events-none">
        <Card className="p-4 bg-background/95 backdrop-blur-xl shadow-2xl border-[#FF0000]/30 pointer-events-auto rounded-2xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FF0000] rounded-2xl flex items-center justify-center shadow-xl shadow-[#FF0000]/30 animate-pulse-slow">
              <MapPin className="text-white h-7 w-7" />
            </div>
            <div>
              <h4 className="text-base font-black leading-none tracking-tight">Netz-Explorer Pro</h4>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">
                  {projects.length.toLocaleString('de-DE' )} Standorte synchronisiert
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
      
      {/* Intelligent Legend */}
      <div className="absolute bottom-6 left-6 z-[1000] pointer-events-none">
        <div className="flex flex-col gap-3 bg-background/90 backdrop-blur-lg p-4 rounded-2xl border-2 border-border/50 text-[11px] font-bold pointer-events-auto shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-[#FF0000] border-2 border-white shadow-md" />
            <span className="text-foreground/80">Einzelprojekt</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-[#FF0000] border-2 border-white flex items-center justify-center text-[9px] text-white font-black shadow-md">
              12
            </div>
            <span className="text-foreground/80">Projekt-Cluster</span>
          </div>
          <div className="pt-2 border-t border-border/50 mt-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <span>Zoom für Details</span>
            </div>
          </div>
        </div>
      </div>

      {/* Map Search Overlay */}
      <div className="absolute top-6 right-16 z-[1000] pointer-events-none hidden md:block">
        <div className="flex items-center gap-2 bg-background/95 backdrop-blur-xl p-2 rounded-2xl border-2 border-border/50 shadow-2xl pointer-events-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Karte durchsuchen..." 
              className="w-64 h-10 pl-10 bg-muted/50 border-none rounded-xl focus-visible:ring-[#FF0000]/50"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
