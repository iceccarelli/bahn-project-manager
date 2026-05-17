import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Project } from "@/_core/api/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, MapPin, Navigation, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

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

// Professional DB Red Marker
const createCustomIcon = (isMajor: boolean, count: number = 1) => {
  const size = isMajor ? 32 : 24;
  const color = "#FF0000";
  
  return L.divIcon({
    className: "custom-db-marker",
    html: `
      <div style="
        width: ${size}px; 
        height: ${size}px; 
        background-color: ${color}; 
        border-radius: 50%; 
        border: 2px solid white; 
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: ${size / 2.5}px;
      ">
        ${count > 1 ? count : ""}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// Intelligent City Coordinates & Priority
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
};

// Helper to find coordinates for a station string
const getCoordinates = (station: string | null) => {
  if (!station) return null;
  
  for (const city in CITY_COORDINATES) {
    if (station.toLowerCase().includes(city.toLowerCase())) {
      return { ...CITY_COORDINATES[city], name: city };
    }
  }
  
  return { lat: 51.1657, lng: 10.4515, priority: 3, name: "Unbekannt" };
};

interface MapViewProps {
  projects: Project[];
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
}

const MapHierarchyController = ({ projects }: { projects: Project[] }) => {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map]);

  const groupedProjects = useMemo(() => {
    const groups: Record<string, { lat: number; lng: number; priority: number; name: string; projects: Project[] }> = {};
    
    projects.forEach(p => {
      const coords = getCoordinates(p.station);
      if (coords) {
        const key = `${coords.lat},${coords.lng}`;
        if (!groups[key]) {
          groups[key] = { ...coords, projects: [] };
        }
        groups[key].projects.push(p);
      }
    });
    
    return Object.values(groups);
  }, [projects]);

  const visibleGroups = useMemo(() => {
    return groupedProjects.filter(group => {
      if (zoom < 7) return group.priority === 1;
      if (zoom < 9) return group.priority <= 2;
      return true;
    });
  }, [groupedProjects, zoom]);

  return (
    <MarkerClusterGroup
      chunkedLoading
      maxClusterRadius={50}
      showCoverageOnHover={false}
      spiderfyOnMaxZoom={true}
    >
      {visibleGroups.map((group, idx) => (
        <Marker 
          key={`${group.lat}-${group.lng}-${idx}`} 
          position={[group.lat, group.lng]}
          icon={createCustomIcon(group.priority === 1, group.projects.length)}
        >
          <Popup className="custom-db-popup">
            <div className="p-2 min-w-[240px] max-w-[320px]">
              <div className="flex items-center gap-2 mb-3 border-b pb-2">
                <div className="w-8 h-8 bg-[#FF0000] rounded-lg flex items-center justify-center text-white font-bold">
                  {group.projects.length}
                </div>
                <div>
                  <h3 className="font-bold text-sm leading-tight">{group.name}</h3>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {group.projects.length} {group.projects.length === 1 ? "Projekt" : "Projekte"}
                  </p>
                </div>
              </div>
              
              <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {group.projects.slice(0, 5).map(p => (
                  <div key={p.id} className="p-2 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors border border-transparent hover:border-[#FF0000]/20 group">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground">{p.projektnummer}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1 bg-background">
                        {p.bahnhofsmanagement}
                      </Badge>
                    </div>
                    <p className="text-xs font-medium line-clamp-2 mt-1 group-hover:text-[#FF0000] transition-colors">
                      {p.projektbeschreibung || p.station}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-muted-foreground">PL: {p.projektleiter || "-"}</span>
                      <Navigation className="h-3 w-3 text-[#FF0000] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
                {group.projects.length > 5 && (
                  <p className="text-[10px] text-center text-muted-foreground pt-1 italic">
                    + {group.projects.length - 5} weitere Projekte...
                  </p>
                )}
              </div>
              
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full mt-3 h-8 text-[11px] gap-2 hover:bg-[#FF0000]/5 hover:text-[#FF0000]"
              >
                In Liste anzeigen <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MarkerClusterGroup>
  );
};

export const MapView: React.FC<MapViewProps> = ({
  projects,
  initialCenter = { lat: 51.1657, lng: 10.4515 },
  initialZoom = 6,
  className = "h-full w-full",
}) => {
  return (
    <div className={`relative ${className} rounded-xl overflow-hidden border shadow-inner bg-muted/10`}>
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
      
      <div className="absolute top-4 left-4 z-[1000] pointer-events-none">
        <Card className="p-3 bg-background/90 backdrop-blur shadow-lg border-[#FF0000]/20 pointer-events-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FF0000] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF0000]/20">
              <MapPin className="text-white h-6 w-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold leading-none">Netz-Explorer</h4>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-tighter font-medium">
                {projects.length} Standorte aktiv
              </p>
            </div>
          </div>
        </Card>
      </div>
      
      <div className="absolute bottom-4 left-4 z-[1000] pointer-events-none">
        <div className="flex flex-col gap-2 bg-background/80 backdrop-blur p-2 rounded-lg border text-[10px] font-medium pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF0000] border border-white shadow-sm" />
            <span>Projektstandort</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-[#FF0000] border-2 border-white flex items-center justify-center text-[8px] text-white font-bold shadow-sm">
              5
            </div>
            <span>Projekt-Cluster</span>
          </div>
        </div>
      </div>
    </div>
  );
};
