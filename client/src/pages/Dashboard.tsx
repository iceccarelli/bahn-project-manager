import React, { lazy, Suspense, useState } from 'react';
import { useReveal } from "@/hooks/useReveal";
import { useNearViewport } from "@/hooks/useNearViewport";
/*
 * Leaflet is 150 kB and the Dashboard is the landing page.
 *
 * Imported statically it would join the Dashboard's own chunk and be parsed
 * before the first KPI is painted, on every visit, for a panel that sits below
 * the fold. Lazily it is a separate request that starts immediately and lands
 * while the reader is still reading the four counters above it — same map,
 * same moment it is actually looked at, nothing blocking the numbers.
 *
 * The fallback reserves the exact height the map will occupy, so nothing below
 * it moves when it arrives.
 */
const MapView = lazy(() =>
  import("@/components/Map").then((m) => ({ default: m.MapView })),
);
import { GewerkePortfolio } from "@/components/dashboard/GewerkePortfolio";
import { PortfolioRelief } from "@/components/dashboard/PortfolioRelief";
import { PortfolioDiagnostics } from "@/components/dashboard/PortfolioDiagnostics";
import { EMPTY_METRICS, percent } from '@shared/project-metrics';
import { useLocalMapRows, usePortfolio, useProjectForDialog } from "@/hooks/usePortfolio";
import ServerMap from "@/components/ServerMap";
import { SERVER_MODE } from "@/realtime/serverApi";
import { statusBadgeClass, statusPulseClass, TONE_APPEARANCE } from '@shared/status-appearance';
import { bedarfHref, projectHref, stationHref } from '@shared/handlungsbedarf';
import { Pie3D } from '@/components/dashboard/Pie3D';
import { GewerkeCarousel } from '@/components/dashboard/GewerkeCarousel';
import { normalizeReviewStatus } from '@shared/review-status';
import { formatGerman } from '@shared/date';
import { projectLinkNote, projectLinkUrl } from '@shared/project-link';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
/* Recharts left this file with the flat donut: the chart lives in Pie3D now,
   and the Gewerke breakdown in GewerkeCarousel. */
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FileCheck,
  History,
  MessageSquare,
  Table2,
  TrendingUp,
  Loader2,
  Users,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActivityFeed } from '@/hooks/useAuditFeed';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// DB Corporate Status Colors (perfect harmony with Projects.tsx)

// Exact department order from Übersichtsliste_Dashboard_1.xlsm (perfect consistency)
/*
 * GEWERKE_TILES is gone with the grid it limited.
 *
 * It existed so a heading reading "8 von 14" could not drift from a slice of 8 —
 * an honest fix to a dishonest design. The design was the problem: six Gewerke
 * were never shown, and the eight that were all reported the same number.
 * GewerkePortfolio shows all fourteen.
 */


interface WorkloadItem {
  name: string;
  incoming: number;
  completed: number;
  total: number;
  /** department and projectId are what make a timeline row unique: without them
   *  two Gewerke signed on the same day for the same project share a React key
   *  and one of them is dropped from the render. Measured: 1,509 rows. */
  timeline: Array<{
    date: string;
    action: string;
    project: string;
    department: string;
    projectId: number;
  }>;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [mapAnchor, mapNear] = useNearViewport<HTMLDivElement>();
  const queryClient = useQueryClient();
  // ONE data shape for the page: the server's portfolio read model (server mode) or the same pure derivation over the
  // demo's local rows. The page itself never aggregates a dataset — it renders finished figures.
  const { data: view, isLoading: dataLoading, isError: dataError } = usePortfolio();
  const auditEntries = useActivityFeed(8);
  const [selectedGewerke, setSelectedGewerke] = useState<string | null>(null);
  const [expandedFach, setExpandedFach] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedProject = useProjectForDialog(selectedId);
  // demo build only (the server build's map queries the server for exactly what is in view)
  const localProjects = useLocalMapRows();

  const metrics = view?.metrics ?? EMPTY_METRICS;
  const totalProjects = metrics.total;
  const openReviews = metrics.openReviews;
  const criticalProjects = metrics.blocked;
  const completedProjects = metrics.completed;
  const totalReviews = view?.totalReviews ?? 0;
  const decidedReviews = metrics.approvedReviews + metrics.blockedReviews;
  const successRate = decidedReviews > 0 ? (metrics.approvedReviews / decidedReviews) * 100 : 0;
  const avgReviewsPerProject = totalProjects > 0 ? totalReviews / totalProjects : 0;
  const delayedProjects = view?.delayedProjects ?? 0;

  // Every Bahnhofsmanagement, not the largest five (see git history); the unassigned remainder is stated.
  const REGION_PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#0891b2", "#db2777", "#65a30d"];
  const regionDistribution = (view?.regions ?? []).map((r, i) => ({ ...r, color: REGION_PALETTE[i % REGION_PALETTE.length]! }));
  const regionCount = regionDistribution.length;
  const regionAssigned = regionDistribution.reduce((a, r) => a + r.count, 0);

  const gewerkeStatusData = view?.gewerke ?? [];
  const standings = view?.standings ?? [];
  const aging = view?.aging;
  const concentration = view?.concentration;
  const quality = view?.quality;
  const revealRef = useReveal(totalProjects);
  const fachWorkload: WorkloadItem[] = view?.workload ?? [];
  const toneSlices = view?.tones.slices ?? [];
  const unmappedStatusRows = view?.tones.unmappedStatusRows ?? 0;
  const totalStatusRows = view?.tones.required ?? 0;
  const notRequiredRows = view?.tones.notRequired ?? 0;
  const upcomingDeadlines = (view?.upcoming ?? []).map(u => ({
    id: u.projectId, station: u.station, department: u.department, due: new Date(u.due),
    dueLabel: new Date(u.due).toLocaleDateString("de-DE"), status: u.status, reviewer: u.reviewer, overdue: u.overdue,
  }));
  const handlungsbedarf = view?.bedarf ?? [];

  const relativeTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "gerade eben";
    if (m < 60) return `vor ${m} Min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `vor ${h} Std`;
    return `vor ${Math.floor(h / 24)} Tg`;
  };
  const iconForAction = (action: string) => {
    const a = action.toLowerCase();
    if (a.includes("abgelehnt") || a.includes("nachforderung") || a.includes("eskal")) return AlertTriangle;
    if (a.includes("erstellt") || a.includes("import")) return Zap;
    if (a.includes("erinnerung") || a.includes("benachrichtig")) return Bell;
    if (a.includes("aktualisiert") || a.includes("prüfung")) return Clock;
    return CheckCircle;
  };
  const activityFeed = (auditEntries || []).slice(0, 8).map((e) => ({
    user: e.user,
    action: e.action,
    project: e.details,
    time: relativeTime(e.timestamp),
    icon: iconForAction(e.action),
  }));




  /*
   * Loading and failure were indistinguishable from "everything is zero".
   *
   * The page destructured only `data` and rendered unconditionally, and
   * useAllData returns null while loading, when empty AND when the read failed
   * — the loader in _core/api/client.ts catches its own errors and returns [].
   * So a failed load produced a complete, confident dashboard: "Live Übersicht
   * über alle 0 Projekte", 0 in all four KPI tiles, "0% aller Projekte", empty
   * charts. Fabricated zeros presented as measurements are worse than an error.
   */
  if (dataLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-strong" aria-hidden="true" />
          <p className="text-lg font-medium text-muted-foreground">Lade Projektdaten…</p>
        </div>
      </div>
    );
  }

  if (dataError || !view) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
        <Card className="max-w-md border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-bold">Projektdaten konnten nicht geladen werden</h2>
            <p className="text-sm text-muted-foreground">
              Es sind keine Projekte verfügbar, daher kann keine Kennzahl berechnet werden. Bitte
              die Seite neu laden — bleibt es dabei, fehlt <code className="font-mono">/data.json</code>{" "}
              oder der lokale Speicher ist leer.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Neu laden
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div ref={revealRef} className="space-y-8 p-6 bg-background min-h-screen">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Live Übersicht über alle {totalProjects.toLocaleString('de-DE')} Projekte • {new Date().toLocaleDateString('de-DE')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* "Mit Microsoft 365 verbinden" removed along with its dialog: there
              is no integration to connect to. "Aktualisieren" used to write an
              audit entry reading "Manuelle Synchronisierung ausgelöst" and
              synchronise nothing; it now genuinely refetches. */}
          <Button
            onClick={async () => {
              await queryClient.invalidateQueries();
              toast.success("Daten neu geladen");
            }}
            className="gap-2"
          >
            <TrendingUp className="h-4 w-4" aria-hidden="true" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Gesamtprojekte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-primary-strong">{totalProjects.toLocaleString('de-DE')}</div>
            {/* "+23 seit letzter Woche" stood here. There is no time series in
                the data — no created-at, no snapshot, nothing to difference —
                so the number could only ever have been typed in. */}
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.totalReviews.toLocaleString("de-DE")} Fachprüfungen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Offene Prüfungen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold">{openReviews}</div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Sofortiger Handlungsbedarf</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" /> Abgeschlossen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-emerald-700 dark:text-emerald-400">
              {completedProjects.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              {percent(completedProjects, totalProjects)}% aller Projekte
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-rose-500" /> Kritisch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-rose-700 dark:text-rose-400">{criticalProjects}</div>
            <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">Abgelehnt / gestoppt</p>
          </CardContent>
        </Card>
      </div>

      {/*
        The whole network, between the counters and the relief.

        Same component, same props shape and same behaviour as the map on
        Projekte — one MapView, not a Dashboard copy of one, because a second
        implementation is a second set of station-matching rules to keep in
        step. It is handed every project, not a filtered set: this is the
        overview, and its own Netz-Explorer card states how many of them could
        be placed and how many could not.

        Clicking lands on exactly what was clicked. A project opens that
        project; a station header opens that station's group by id, not by a
        text search for its name — see stationHref.
      */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="min-w-0">
            {/* Not "Netz-Explorer": the map paints a card with that name and the
                real counts on it, and two identical titles stacked on top of
                each other read as a rendering fault. */}
            <h2 className="text-lg font-bold">Alle Projekte auf der Karte</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Jedes Projekt an seiner Station. Farbe zeigt den Arbeitsstand, der Rand die Genauigkeit
              der Verortung. Ein Klick auf ein Projekt öffnet es, ein Klick auf die Station zeigt
              genau deren Projekte.
            </p>
          </div>
          {/*
            Mounted when the reader is on their way down to it, not on load.

            425 marker elements make every keystroke in the search box at the
            top of this page twice as expensive — measured at 68–80 ms worst
            with the map in the DOM against 34–41 ms without it. See
            useNearViewport. The box below reserves the exact height either
            way, so nothing moves when the map arrives.
          */}
          <div
            ref={mapAnchor}
            data-map-mount={mapNear ? "on" : "warten"}
            className="h-[65vh] min-h-[380px] w-full sm:h-[560px] lg:h-[600px]"
          >
            {mapNear ? (
              <Suspense
                fallback={
                  <div className="grid h-full w-full place-items-center rounded-lg border border-border bg-muted/30 text-2xs text-muted-foreground">
                    Karte wird geladen …
                  </div>
                }
              >
                {SERVER_MODE ? (
                  <ServerMap
                    filters={{}}
                    initialCenter={{ lat: 51.1657, lng: 10.4515 }}
                    initialZoom={6}
                    className="relative h-full w-full"
                    onProjectSelect={(id) => setLocation(projectHref(id))}
                  />
                ) : (
                <MapView
                  projects={localProjects}
                  initialCenter={{ lat: 51.1657, lng: 10.4515 }}
                  initialZoom={6}
                  className="relative h-full w-full"
                  onProjectSelect={(id) => setLocation(projectHref(id))}
                  onStationSelect={(station) => setLocation(stationHref(station))}
                />
                )}
              </Suspense>
            ) : (
              <div className="grid h-full w-full place-items-center rounded-lg border border-border bg-muted/30 px-4 text-center text-2xs text-muted-foreground">
                Die Karte wird geladen, sobald sie in den Blick kommt —{" "}
                {totalProjects.toLocaleString("de-DE")} Projekte an ihren Stationen.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* MAIN CONTENT */}
      {/*
        The relief is full width, and that is a measurement rather than a
        preference.
        
        In the 7-of-12 column it had about 650px to work in. A 14×4 grid tilted
        to 44° and yawed to −18° paints roughly 830px wide before the towers'
        side walls are counted, so the far column was clipped on every screen
        and the horizontal scrollbar was doing the work the layout should have
        done. Nothing else on this Dashboard needs the width more than the one
        panel whose whole job is showing the shape of 3.699 Prüfungen at once.
      */}
      <PortfolioRelief standings={standings} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* LEFT COLUMN - CHARTS */}
        <div className="xl:col-span-7 space-y-6">
          {/* Overall Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Status-Verteilung (Alle Gewerke)</CardTitle>
              {/* Says which Prüfzeilen: the panel below counts all 18.172 rows,
                  this pie only the ones that carry a status. Two different
                  numbers under the same word on one screen is drift. */}
              {/*
                What the donut plots, and everything it does not.
                
                It used to chart all 15.646 rows that carry a status, and the
                single biggest band — by a distance — was „nicht relevant":
                rows saying a department is not involved. A status chart whose
                largest slice means „does not apply" answers no question, and
                it disagreed with every workload figure on the site, all of
                which exclude those rows. Now it plots the work and accounts
                for the remainder in full.
              */}
              <p className="text-2xs text-muted-foreground">
                <strong className="font-bold text-foreground">
                  {totalStatusRows.toLocaleString("de-DE")}
                </strong>{" "}
                erforderliche Prüfungen von{" "}
                {metrics.totalReviews.toLocaleString("de-DE")} Prüfzeilen
                {notRequiredRows > 0
                  ? ` · ${notRequiredRows.toLocaleString("de-DE")} „nicht erforderlich"`
                  : ""}
                {unmappedStatusRows > 0
                  ? ` · ${unmappedStatusRows.toLocaleString("de-DE")} ohne bekannten Status`
                  : ""}
              </p>
            </CardHeader>
            <CardContent>
              {/*
                The donut has a body now, and every slice is a way in.
                
                It was a flat disc with a legend and no way to act on any of
                it: „offen 946" and then nothing to click. Pie3D draws the same
                data with a visible edge, lifts the open bands out of it, and
                sends a slice to the projects behind it — counted by the same
                function in shared/handlungsbedarf.ts that sized the slice, so
                the number and the landing set cannot disagree.
              */}
              <Pie3D slices={toneSlices} label="Status-Verteilung über alle Gewerke" height={380} />
            </CardContent>
          </Card>

          {/*
            Was "Status pro Gewerke — 8 von 14", eight tiles of which seven read
            1.298. That figure is the project count, not the workload: EEA needs
            814 checks, ITK 510, HFT 100. Six Gewerke were not shown at all, and
            the two with no approval in their vocabulary — UM and BIM — were
            among the six. Every number below is derived in
            shared/portfolio-metrics.ts and agrees with the Gewerk tabs.
          */}
          <GewerkePortfolio standings={standings} />

          {/* Aging, concentration and the trustworthiness of the rows every
              other panel is built on. */}
          {aging && concentration && quality && <PortfolioDiagnostics aging={aging} concentration={concentration} quality={quality} />}

          {/*
            Detaillierte Ansicht per Gewerke — a carousel, not an empty state.

            It used to open on "Wählen Sie ein Gewerke" and a 📊 emoji: a panel
            three quarters of a screen tall that showed nothing at all until the
            reader guessed there was a dropdown worth using. Most never did, so
            fourteen breakdowns sat behind a control that looked like a filter
            for a chart that was not there.

            Now it always shows one, and moves to the next every four seconds,
            so the whole portfolio goes past without anybody choosing anything.
            Picking a Gewerk from the dropdown pins it — an explicit choice
            always beats the rotation. Pausing is required, not a nicety: WCAG
            2.2.2 covers anything that moves on its own for more than five
            seconds, so there is a pause button, it pauses on hover and on
            focus, and prefers-reduced-motion stops it before it ever starts.
          */}
          <GewerkeCarousel
            data={gewerkeStatusData}
            pinned={selectedGewerke}
            onPin={setSelectedGewerke}
          />
        </div>

        {/* RIGHT COLUMN - FACHSPEZIALISTEN */}
        <div className="xl:col-span-5">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" /> Fachspezialisten Workload
              </CardTitle>
              <p className="text-sm text-muted-foreground">Klicken Sie auf einen Namen für Details</p>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[720px] overflow-auto pr-2">
              {fachWorkload.map((fach, index) => (
                <motion.div
                  key={fach.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="border rounded-2xl overflow-hidden"
                >
                  <button
                    type="button"
                    data-fach-row={fach.name}
                    aria-expanded={expandedFach === fach.name}
                    className="flex w-full items-center justify-between p-4 text-left cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => setExpandedFach(expandedFach === fach.name ? null : fach.name)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="font-mono text-sm text-primary-strong">{fach.name.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="font-semibold">{fach.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fach.incoming.toLocaleString("de-DE")} offen • {fach.completed.toLocaleString("de-DE")} erledigt
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={fach.incoming > 5 ? "destructive" : "secondary"}>
                        {fach.total.toLocaleString("de-DE")} Tasks
                      </Badge>
                      {expandedFach === fach.name ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {expandedFach === fach.name && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t bg-muted/30 px-4 py-4"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{fach.incoming.toLocaleString("de-DE")}</div>
                            <div className="text-xs">Eingehend</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{fach.completed.toLocaleString("de-DE")}</div>
                            <div className="text-xs">Erledigt</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold">{fach.total.toLocaleString("de-DE")}</div>
                            <div className="text-xs">Gesamt</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium mb-2 text-muted-foreground">AKTUELLE AKTIVITÄT</div>
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                            {fach.timeline.length > 0 ? fach.timeline.map((item) => (
                              /* Key was `date-project-action`, which is not
                                 unique: one reviewer signing two Gewerke on the
                                 same project on the same day produced the same
                                 key twice and React dropped the second row —
                                 1,509 rows across the panel. The department is
                                 what distinguishes them, so it is now in the
                                 key and on screen. */
                              /*
                                A row is a link to the project it describes.
                                
                                Reading "offen — Bensheim (EEA)" and then having
                                to go and find Bensheim by hand is the reason
                                this panel got looked at once and never again.
                                The href addresses the project by id, so it is
                                exactly one card however many projects share a
                                Projektnummer — 1.298 of them share 385 — and
                                the card carries "Details anzeigen".
                                
                                The status word itself pulses when the entry is
                                still open, using the same one function every
                                other status surface in the app uses.
                              */
                              <button
                                key={`${item.date}-${item.projectId}-${item.department}-${item.action}`}
                                type="button"
                                data-timeline-entry={item.projectId}
                                onClick={() => setLocation(projectHref(item.projectId))}
                                aria-label={`${item.action} — ${item.project}${item.department ? `, ${item.department}` : ""}, Projekt öffnen`}
                                className="flex w-full items-start gap-3 border-l-2 border-primary py-1 pl-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{formatGerman(item.date) || item.date}</span>
                                <span className="min-w-0">
                                  <span
                                    className={`inline-block rounded-full px-1.5 font-medium ${statusPulseClass(item.action)}`}
                                  >
                                    {item.action}
                                  </span>{" "}
                                  — {item.project}
                                  {item.department && (
                                    <span className="ml-1 text-xs text-muted-foreground">({item.department})</span>
                                  )}
                                </span>
                              </button>
                            )) : (
                              <div className="text-xs text-muted-foreground">Keine kürzlichen Aktivitäten</div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* MANAGER COMMAND CENTER */}
      <div className="pt-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-px flex-1 bg-border" />
          <div className="text-sm font-semibold text-muted-foreground tracking-widest">MANAGER COMMAND CENTER</div>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Four cards, not five. The Microsoft 365 card was removed: it showed
            a pulsing green "connected" dot and three "Verfügbar" labels while
            no integration existed — @azure/msal-browser and @azure/msal-react
            were dependencies with no code behind them, and both buttons only
            raised a toast saying the feature "wird in Kürze aktiviert". */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-l-4 border-l-rose-500">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-5 w-5 text-rose-500" /> Anstehende Prüftermine
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[280px] space-y-2 overflow-auto pr-1">
              {upcomingDeadlines.length > 0 ? (
                upcomingDeadlines.map((d) => (
                  <button
                    key={`${d.id}-${d.department}`}
                    type="button"
                    onClick={() =>
                      setSelectedId(d.id)
                    }
                    className="flex w-full items-start gap-2.5 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Clock
                      className={`mt-0.5 h-4 w-4 shrink-0 ${d.overdue ? "text-rose-500" : "text-amber-500"}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.station}</span>
                      <span className="mt-0.5 block text-2xs text-muted-foreground">
                        {d.department} · {d.dueLabel}
                        {d.overdue ? " · überfällig" : ""}
                        {d.reviewer ? ` · ${d.reviewer}` : ""}
                      </span>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${statusBadgeClass(d.status)} ${statusPulseClass(d.status)}`}
                      >
                        {d.status}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Keine offene Prüfung mit hinterlegtem Termin.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-5 w-5 text-primary-strong" /> Handlungsbedarf
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[280px] space-y-2 overflow-auto pr-1">
              {/*
                Each row is a place you can go.
                
                A count nobody can open is a count nobody can act on, which is
                the opposite of what a panel called "Handlungsbedarf" is for.
                The link carries the bucket key, the Projekte page recomputes
                the same predicate from the same module, and the chip it shows
                states both figures — so the 558 on this badge and the 258
                cards it lands on are visibly the same fact counted two ways,
                not two numbers that disagree.
              */}
              {handlungsbedarf.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  data-bedarf={h.key}
                  disabled={h.rows === 0}
                  onClick={() => setLocation(bedarfHref(h.key))}
                  title={h.basis}
                  aria-label={`${h.label}: ${h.rows} Prüfzeilen in ${h.projects} Projekten — öffnen`}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card"
                >
                  <span className="min-w-0">
                    <span className="block text-sm leading-tight">{h.label}</span>
                    <span className="mt-0.5 block text-2xs text-muted-foreground">
                      in {h.projects.toLocaleString("de-DE")} Projekten
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${
                      h.rows === 0
                        ? "bg-muted text-muted-foreground"
                        : `${TONE_APPEARANCE[h.tone].badge} ${h.awaiting ? "pulse-open" : ""}`
                    }`}
                  >
                    {h.rows.toLocaleString("de-DE")}
                  </span>
                </button>
              ))}
              <p className="pt-1 text-2xs text-muted-foreground">
                Aus {totalReviews.toLocaleString("de-DE")} Prüfzeilen berechnet.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-5 w-5" /> Team-Aktivität
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[280px] space-y-4 overflow-auto pr-1 text-sm">
              {activityFeed.length > 0 ? (
                activityFeed.map((activity) => (
                  <div
                    key={`${activity.user}-${activity.project}-${activity.time}`}
                    className="flex gap-3"
                  >
                    <activity.icon className="mt-1 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold">{activity.user}</span> {activity.action}
                      {activity.project && (
                        <span className="text-muted-foreground"> · {activity.project}</span>
                      )}
                      <div className="mt-0.5 text-2xs text-muted-foreground">{activity.time}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-muted-foreground">
                  Noch keine Änderungen in dieser Sitzung.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-primary-strong" /> Schnellaktionen
              </CardTitle>
            </CardHeader>
            {/* Every button here now does what its label says. The previous four
                wrote an audit entry claiming the work had happened — "Status-Update
                vorbereitet", "Kritische Fälle eskaliert" — and then did nothing,
                which put false records into the very trail the audit page reads. */}
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 text-left leading-tight"
                onClick={() => setLocation("/anmeldung")}
              >
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                Fachspezialistenprüfung anmelden
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 text-left leading-tight"
                onClick={() => setLocation("/projects")}
              >
                <Table2 className="h-4 w-4" aria-hidden="true" />
                Alle {totalProjects.toLocaleString("de-DE")} Projekte öffnen
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 text-left leading-tight"
                onClick={() => setLocation("/audit")}
              >
                <History className="h-4 w-4" aria-hidden="true" />
                Änderungshistorie öffnen
              </Button>
              <Button
                variant="outline"
                className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 text-left leading-tight"
                onClick={() => setLocation("/bvb-eea")}
              >
                <FileCheck className="h-4 w-4" aria-hidden="true" />
                BVB-EEA-Prüfungen ansehen
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ADDITIONAL PROFESSIONAL SECTIONS */}
      <div className="pt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-px flex-1 bg-border" />
          <div className="text-sm font-semibold text-muted-foreground tracking-widest">ERWEITERTE ANALYSE &amp; ÜBERSICHT</div>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Erweiterte Kennzahlen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Prüfungen je Projekt (Ø)</div>
                <div className="font-mono font-bold">{avgReviewsPerProject.toFixed(1)}</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Projekte mit Verzögerung</div>
                <div className="font-mono font-bold text-rose-700 dark:text-rose-400">{delayedProjects.toLocaleString("de-DE")}</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Erfolgsquote (erteilte Zustimmungen)</div>
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{successRate.toFixed(1)}%</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Projekte gesamt</div>
                <div className="font-mono font-bold">{totalProjects.toLocaleString("de-DE")}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Regionale Verteilung — alle {regionCount}
              </CardTitle>
              <p className="text-2xs text-muted-foreground">
                {regionAssigned.toLocaleString("de-DE")} von{" "}
                {totalProjects.toLocaleString("de-DE")} Projekten tragen ein Bahnhofsmanagement.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {regionDistribution.map((r) => (
                  <div key={r.region} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <div className="flex-1">{r.region}</div>
                    <div className="font-mono font-bold">{r.count.toLocaleString("de-DE")}</div>
                    {/* Scaled against the largest region, not the project
                        total: against 1.298 even Frankfurt filled a quarter of
                        its track and the other seven were slivers that could
                        not be told apart. The number beside it is the value;
                        the bar only has to make the ranking visible. */}
                    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-current"
                        style={{
                          width: `${Math.max(4, (r.count / (regionDistribution[0]?.count || 1)) * 100)}%`,
                          color: r.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Performer (Fachspezialisten)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {fachWorkload.slice(0, 6).map((f) => (
                <div key={f.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
                      {/* On an emerald-100 disc: the 700 shade measures 3.4:1 there, the 900 shade 8.9:1. */}
                      <span className="font-mono text-xs text-emerald-900 dark:text-emerald-100">{f.name.slice(0, 2)}</span>
                    </div>
                    <div>{f.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-emerald-700 dark:text-emerald-400">{f.completed}</div>
                    <div className="text-2xs text-muted-foreground">erledigt</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* FINAL SECTION - SYSTEM STATUS */}
      <div className="pt-8">
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-500" /> System Status &amp; Integration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {/* "Datenbank: Online" and "Excel Sync: Aktiv" stood here with
                  pulsing green dots. Both were false for the same reason the
                  third one below was already removed: production is a static
                  SPA (vercel.json declares no functions), there is no database
                  connection and no Excel sync process. Nothing polled them —
                  they were literals styled to look like telemetry. */}
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Daten lokal geladen ({totalProjects.toLocaleString('de-DE')} Projekte)</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Stand: {new Date().toLocaleString('de-DE')} • Version {__APP_VERSION__} • Build {__BUILD_DATE__}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PROJECT DETAIL MODAL */}
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedProject?.station || selectedProject?.projektnummer}
              <Badge variant="outline">{selectedProject?.bahnhofsmanagement}</Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedProject && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Projektleiter</div>
                  <div className="font-medium">{selectedProject.projektleiter}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Beschreibung</div>
                  <div>{selectedProject.projektbeschreibung}</div>
                </div>
              </div>

              <div>
                <div className="font-semibold mb-3">Status pro Gewerke</div>
                {/*
                  Two overflows lived in this grid, both visible at 375px:
                  "Baubetriebstechnologie" is 22 characters of `font-mono` in a
                  half-width tile and painted straight over "Baubetriebsplanung"
                  beside it, and the Badge ships `whitespace-nowrap`, so
                  "Zustimmung erteilt" ran out of its tile and over the
                  neighbour's. `min-w-0` on the tile is what lets either wrap at
                  all — a grid item defaults to `min-width: auto` and refuses to
                  go below its content's intrinsic width.
                */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {selectedProject.reviews.map((review) => (
                    <div key={review.department} className="min-w-0 rounded-xl border p-3">
                      <div className="break-words font-mono text-xs text-muted-foreground">
                        {review.department}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2">
                        {/* Was white text on statusHex(). Those hexes are tuned
                            as chart *fills*; as a text background they measured
                            2.15:1 for "offen" and 2.54:1 for "Zustimmung
                            erteilt", against a 4.5:1 floor. The badge variant of
                            the same tone is built for text and passes. */}
                        {/* Normalised, like every other status surface: the raw
                            string misses the annotated variants entirely. And
                            `whitespace-normal` so a two-word status wraps
                            inside the badge instead of past the tile. */}
                        <Badge
                          variant="outline"
                          className={`min-w-0 whitespace-normal break-words text-left ${statusBadgeClass(
                            normalizeReviewStatus(review.status),
                          )} ${statusPulseClass(review.status)}`}
                        >
                          {normalizeReviewStatus(review.status) ?? review.status ?? "—"}
                        </Badge>
                      </div>
                      <div className="mt-1 break-words text-sm">{review.prueferName || "—"}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {formatGerman(review.pruefDatum) || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Only 66 of the 138 populated projektLink values are URLs; the
                  other 72 are notes. Rendering those as an anchor made a
                  relative href that opened the app's own 404 page. */}
              {projectLinkUrl(selectedProject.projektLink) && (
                <Button variant="outline" asChild>
                  <a
                    href={projectLinkUrl(selectedProject.projektLink) as string}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" /> Projektlink öffnen
                  </a>
                </Button>
              )}
              {projectLinkNote(selectedProject.projektLink) && (
                <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-bold">Projektlink-Feld (kein Link):</span>{" "}
                  {projectLinkNote(selectedProject.projektLink)}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
