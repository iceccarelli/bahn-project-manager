import type React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Project } from "@/hooks/useDataQuery";
import { useStations } from "@/hooks/useStations";
import { buildStationGeo, type MatchPrecision, type ResolvedStation } from "@/lib/stationGeo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Info, Maximize, Minimize, LocateFixed } from "lucide-react";
import { DB_RED, DB_RED_RING, DB_RED_SUBTLE } from "@shared/brand";
import { TONE_APPEARANCE } from "@shared/status-appearance";
import { BLOCKING_STATUSES, normalizeReviewStatus, OPEN_STATUSES } from "@shared/review-status";
import { toDate } from "@shared/date";

/**
 * Count a project's reviews by work state and find its earliest open Prüfdatum.
 * Kept outside the component so the grouping memo stays cheap across 1,298
 * projects and ~18,000 review rows.
 */
function workStateOf(p: Project): {
  open: number;
  inProgress: number;
  blocked: number;
  oldestOpen: Date | null;
  overdue: boolean;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let open = 0;
  let inProgress = 0;
  let blocked = 0;
  let oldestOpen: Date | null = null;
  let overdue = false;
  for (const r of p.reviews || []) {
    const status = normalizeReviewStatus(r.status);
    if (!status) continue;
    if ((BLOCKING_STATUSES as readonly string[]).includes(status)) {
      blocked++;
      continue;
    }
    if (!(OPEN_STATUSES as readonly string[]).includes(status)) continue;
    if (status === "in Bearbeitung" || status === "prüffähig") inProgress++;
    else open++;
    const due = toDate(r.pruefDatum);
    if (due) {
      if (!oldestOpen || due < oldestOpen) oldestOpen = due;
      if (due < today) overdue = true;
    }
  }
  return { open, inProgress, blocked, oldestOpen, overdue };
}

interface StationGroup {
  key: string;
  name: string;
  lat: number;
  lng: number;
  precision: MatchPrecision;
  /** true only for precision === "exact" */
  isPrecise: boolean;
  /** at least one project in this group matched an equally-scoring alternative */
  ambiguous: boolean;
  /** how each member project was matched — a station can be reached exactly by
   *  one project and only reconciled by another */
  counts: Record<MatchPrecision, number>;
  /** the matched station's own BM — null for the regional fallback */
  bm: string | null;
  /** reviews here still awaiting a decision */
  openCount: number;
  /** reviews here actively being worked */
  inProgressCount: number;
  /** reviews here refused or halted */
  blockedCount: number;
  /**
   * Earliest Prüfdatum among this station's open reviews, or null when none
   * carries a date. Drives both the draw order and the urgency of the pulse.
   */
  oldestOpen: Date | null;
  /** at least one open review here is past its Prüfdatum */
  overdue: boolean;
  projects: Project[];
}

/**
 * Marker colour encodes match quality honestly:
 *   red    — the project names this exact station
 *   amber  — the name was reconciled (word order / containment); right town,
 *            possibly the wrong stop
 *   grey   — no station matched; the marker sits on the region centroid
 */
const PRECISION_RANK: Record<MatchPrecision, number> = {
  exact: 0,
  tokens: 1,
  fuzzy: 2,
  region: 3,
};

const PRECISION_STYLE: Record<MatchPrecision, { bg: string; ring: string; label: string }> = {
  exact: { bg: DB_RED, ring: DB_RED_RING, label: "exakt" },
  tokens: { bg: "#F59E0B", ring: "rgba(245,158,11,0.28)", label: "zugeordnet" },
  fuzzy: { bg: "#F59E0B", ring: "rgba(245,158,11,0.28)", label: "zugeordnet" },
  region: { bg: "#9ca3af", ring: "rgba(0,0,0,0.18)", label: "ungenau verortet (Region)" },
};

interface MapViewProps {
  projects: Project[];
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  className?: string;
  onBoundsChange?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
  onProjectSelect?: (projectId: number) => void;
}

/**
 * Colour carries the work state, the border carries the geocoding precision.
 *
 * It used to be colour = precision and nothing else, so a station with eleven
 * overdue Prüfungen looked exactly like one with none as long as both had been
 * matched exactly. Precision still matters — a region-centroid marker is not
 * standing where it claims — so it moved to the border: solid white for a real
 * station, dashed and translucent for a regional fallback.
 */
const createDotIcon = (g: StationGroup) => {
  const count = g.projects.length;
  const size = count > 1 ? 34 : 26;
  const active = g.openCount + g.inProgressCount;
  const urgent = g.overdue || g.blockedCount > 0;

  const bg = g.blockedCount > 0
    ? TONE_APPEARANCE.blocked.hex
    : g.openCount > 0
      ? TONE_APPEARANCE.pending.hex
      : g.inProgressCount > 0
        ? TONE_APPEARANCE.active.hex
        : TONE_APPEARANCE.done.hex;

  // A region-centroid dot is deliberately quieter: it is an approximation and
  // should not read as a precise, confident pin.
  const border = g.precision === "region" ? "2px dashed rgba(255,255,255,0.85)" : "2.5px solid #fff";
  const opacity = g.precision === "region" ? 0.72 : 1;

  const pulseClass = active > 0 ? `db-pulse${urgent ? " db-pulse-urgent" : ""}` : "";

  return L.divIcon({
    className: "db-dot-marker",
    html:
      `<div class="db-dot ${pulseClass}" style="width:${size}px;height:${size}px;background:${bg};border:${border};opacity:${opacity};color:${bg};box-shadow:0 2px 8px rgba(0,0,0,.25);font-size:${(size / 2.2).toFixed(0)}px;">` +
      `<span style="color:#fff;">${count > 1 ? count : ""}</span></div>`,
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
        `<button data-pid="${p.id}" style="display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px;border-radius:10px;cursor:pointer;margin:0 0 4px;"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><span style="font:700 10px ui-monospace,monospace;color:${DB_RED};background:${DB_RED_SUBTLE};padding:1px 6px;border-radius:4px;">${esc(p.projektnummer || "—")}</span><span style="font-size:9px;color:#555;border:1px solid #ddd;border-radius:6px;padding:1px 6px;">${esc(p.bahnhofsmanagement || "")}</span></div><div style="font:700 12px system-ui;margin-top:4px;line-height:1.3;">${esc(p.projektbeschreibung || p.station || "")}</div><div style="font-size:10px;color:#666;margin-top:3px;">${esc(p.projektleiter || "Unbekannt")}${p.projektstand ? ` · ${esc(p.projektstand)}` : ""}</div></button>`
    )
    .join("");
  const style = PRECISION_STYLE[group.precision];
  const mix = (Object.keys(PRECISION_STYLE) as MatchPrecision[])
    .filter((k) => group.counts[k] > 0)
    .map((k) => `${group.counts[k]} ${PRECISION_STYLE[k].label}`);
  const more =
    group.projects.length > 12
      ? `<div style="text-align:center;font-size:10px;color:#888;font-style:italic;padding:4px;">+ ${group.projects.length - 12} weitere Projekte an dieser Station</div>`
      : "";
  return (
    `<div style="min-width:240px;max-width:300px;"><div style="font:800 14px system-ui;line-height:1.2;">${esc(group.name)}</div><div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:${group.isPrecise ? "#888" : "#b45309"};margin-top:2px;">${group.projects.length} ${group.projects.length === 1 ? "Projekt" : "Projekte"}${group.isPrecise ? "" : ` · ${esc(style.label)}`}${group.ambiguous ? " · mehrdeutig" : ""}</div>${group.bm ? `<div style="font-size:9px;color:#888;margin-top:1px;">BM ${esc(group.bm)}</div>` : ""}${mix.length > 1
      ? `<div style="font-size:9px;color:#888;margin-top:1px;">${mix.join(" · ")}</div>`
      : ""}<div style="max-height:240px;overflow-y:auto;margin-top:8px;border-top:1px solid #eee;padding-top:6px;">${rows}${more}</div></div>`
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
      const work = workStateOf(p);
      const g = map.get(r.key);
      if (g) {
        g.projects.push(p);
        g.openCount += work.open;
        g.inProgressCount += work.inProgress;
        g.blockedCount += work.blocked;
        g.overdue = g.overdue || work.overdue;
        if (work.oldestOpen && (!g.oldestOpen || work.oldestOpen < g.oldestOpen)) {
          g.oldestOpen = work.oldestOpen;
        }
        g.counts[r.precision] += 1;
        if (r.ambiguous) g.ambiguous = true;
        // marker colour reflects the best evidence for this station
        if (PRECISION_RANK[r.precision] < PRECISION_RANK[g.precision]) {
          g.precision = r.precision;
          g.isPrecise = r.isPrecise;
        }
      } else {
        map.set(r.key, {
          key: r.key,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          precision: r.precision,
          isPrecise: r.isPrecise,
          ambiguous: r.ambiguous,
          bm: r.bm,
          counts: { exact: 0, tokens: 0, fuzzy: 0, region: 0, [r.precision]: 1 } as Record<
            MatchPrecision,
            number
          >,
          projects: [p],
          openCount: work.open,
          inProgressCount: work.inProgress,
          blockedCount: work.blocked,
          oldestOpen: work.oldestOpen,
          overdue: work.overdue,
        });
      }
    }
    /**
     * Oldest first. Markers are added to the layer in this order, so the
     * longest-waiting stations are drawn first and the most recent sit on top,
     * and the staggered reveal below sweeps the map chronologically rather
     * than in whatever order the rows happened to arrive. Stations with no
     * dated open review sort last — they are not waiting on anything.
     */
    return Array.from(map.values()).sort((a, b) => {
      if (a.oldestOpen && b.oldestOpen) return a.oldestOpen.getTime() - b.oldestOpen.getTime();
      if (a.oldestOpen) return -1;
      if (b.oldestOpen) return 1;
      return a.name.localeCompare(b.name, "de");
    });
  }, [projects, geo]);

  /**
   * Projects that could not be placed at all — no station match and no usable
   * BM. Previously these were dropped with `if (!r) continue` and never
   * reported, so the map silently understated its own coverage.
   */
  const placedCount = useMemo(() => groups.reduce((n, g) => n + g.projects.length, 0), [groups]);
  const unplacedCount = projects.length - placedCount;
  /** counted per project, not per marker — a station can host both exact and reconciled matches */
  const exactCount = useMemo(() => groups.reduce((n, g) => n + g.counts.exact, 0), [groups]);
  /** groups sitting on a real station (exact or reconciled), i.e. not a region centroid */
  const stationGroups = useMemo(() => groups.filter((g) => g.precision !== "region"), [groups]);

  // latest callbacks in refs so the init effect can stay mount-only
  const onBoundsRef = useRef(onBoundsChange);
  const onSelectRef = useRef(onProjectSelect);
  const groupsRef = useRef(groups);
  onBoundsRef.current = onBoundsChange;
  onSelectRef.current = onProjectSelect;
  groupsRef.current = groups;

  // ---- create the map exactly once per mount, and tear it down cleanly ----
  //
  // initialCenter and initialZoom are *initial* values by contract. Listing
  // them as dependencies would tear down and rebuild the whole Leaflet
  // instance whenever the parent re-rendered with a new object literal, which
  // means losing the user's pan and zoom on every filter change.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialCenter/initialZoom are initial values by contract — see above
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Leaflet stamps this private field on a container it has already
    // initialised (StrictMode double-invoke, HMR). There is no public API to
    // ask, so the cast is narrowed to the one field rather than widened to any.
    if ((el as HTMLElement & { _leaflet_id?: number })._leaflet_id) return;

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
      const root = (e.popup as L.Popup & { getElement?: () => HTMLElement | undefined })
        .getElement?.();
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

    // `groups` is sorted oldest-open-review first, so adding markers in order
    // sweeps the map chronologically. The stagger is capped: 900 markers at a
    // real per-marker delay would take most of a minute, so the whole reveal is
    // budgeted at ~700ms regardless of how many there are, and skipped entirely
    // for anyone who has asked for reduced motion.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const REVEAL_MS = 700;
    const step = groups.length > 0 ? Math.min(12, REVEAL_MS / groups.length) : 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    groups.forEach((g, i) => {
      const add = () => {
        const marker = L.marker([g.lat, g.lng], { icon: createDotIcon(g) });
        marker.bindPopup(popupHtml(g), { minWidth: 240, maxWidth: 320, className: "db-popup" });
        marker.on("click", () =>
          map.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 13), { duration: 0.6 }),
        );
        layer.addLayer(marker);
      };
      if (reduceMotion || step === 0) add();
      else timers.push(setTimeout(add, i * step));
    });

    if (!didFitRef.current && groups.length) {
      const pts = groups
        .filter((g) => g.precision !== "region")
        .map((g) => [g.lat, g.lng]) as [number, number][];
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts).pad(0.15));
        didFitRef.current = true;
      }
    }

    // Filtering mid-reveal would otherwise let the previous sweep keep dropping
    // markers into a layer that has already been cleared.
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [groups]);

  // Keep Leaflet sized when toggling fullscreen. isFullscreen is the trigger,
  // not a value the body reads: Leaflet needs invalidateSize() after the
  // container's box changes, and this toggle is exactly when that happens.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: isFullscreen is the trigger, not a read value — see above
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = groups
      .filter((g) => g.precision !== "region")
      .map((g) => [g.lat, g.lng]) as [number, number][];
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15));
  }, [groups]);

  const containerClass = isFullscreen
    ? "fixed inset-0 z-[9999] bg-background"
    : `relative ${className} rounded-2xl overflow-hidden border-2 border-border/50 shadow-2xl bg-muted/5`;

  return (
    <div className={containerClass}>
      <div ref={containerRef} className="h-full w-full z-0" />

      <div className="absolute top-6 left-6 z-[1000] pointer-events-none">
        <Card className="p-4 bg-background/95 backdrop-blur-xl shadow-2xl border-primary/30 pointer-events-auto rounded-2xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-xl shadow-primary/30">
              <MapPin className="text-white h-7 w-7" />
            </div>
            <div>
              <h4 className="text-base font-black leading-none tracking-tight">Netz-Explorer</h4>
              <p className="text-2xs text-muted-foreground uppercase tracking-widest font-black mt-1.5">
                {stationGroups.length.toLocaleString("de-DE")} Stationen ·{" "}
                {exactCount.toLocaleString("de-DE")} exakt · {placedCount.toLocaleString("de-DE")}/
                {projects.length.toLocaleString("de-DE")} verortet
              </p>
              {unplacedCount > 0 && (
                <p className="text-2xs text-amber-600 dark:text-amber-500 font-black mt-0.5">
                  {unplacedCount.toLocaleString("de-DE")} ohne Station &amp; ohne BM – nicht darstellbar
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="absolute bottom-6 left-6 z-[1000] pointer-events-none">
        <div className="flex flex-col gap-3 bg-background/90 backdrop-blur-lg p-4 rounded-2xl border-2 border-border/50 text-2xs font-bold pointer-events-auto shadow-xl">
          {/* The legend used to describe the geocoding precision, because that
              was what colour meant. Colour now means work state, so it says so. */}
          {[
            { hex: TONE_APPEARANCE.pending.hex, label: "offen", pulse: true },
            { hex: TONE_APPEARANCE.active.hex, label: "in Bearbeitung", pulse: true },
            { hex: TONE_APPEARANCE.blocked.hex, label: "abgelehnt / gestoppt", pulse: true },
            { hex: TONE_APPEARANCE.done.hex, label: "alle Prüfungen erledigt", pulse: false },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span
                className={`db-dot h-4 w-4 shrink-0 border-2 border-white shadow-md ${row.pulse ? "db-pulse" : ""}`}
                style={{ background: row.hex, color: row.hex }}
              />
              <span className="text-foreground/80">{row.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white bg-primary text-2xs font-black text-white shadow-md">
              12
            </span>
            <span className="text-foreground/80">Projekte je Station</span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="db-dot h-4 w-4 shrink-0 shadow-md"
              style={{ background: TONE_APPEARANCE.pending.hex, border: "2px dashed rgba(255,255,255,.85)", opacity: 0.72 }}
            />
            <span className="text-foreground/80">ungenau verortet (Region)</span>
          </div>
          <div className="pt-2 border-t border-border/50 mt-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              <span>Pulsierend = offene Prüfung · Marker klicken zum Zoomen</span>
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
          aria-label="Alle Stationen anzeigen"
          className="bg-background/95 backdrop-blur-xl border-2 border-border/50 shadow-2xl hover:bg-muted"
        >
          <LocateFixed className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? "Vollbild beenden" : "Vollbild"}
          aria-label={isFullscreen ? "Vollbild beenden" : "Vollbild"}
          className="bg-background/95 backdrop-blur-xl border-2 border-border/50 shadow-2xl hover:bg-muted"
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};
