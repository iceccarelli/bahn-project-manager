import React, { useMemo, useState } from 'react';
import { GewerkePortfolio } from "@/components/dashboard/GewerkePortfolio";
import { PortfolioRelief } from "@/components/dashboard/PortfolioRelief";
import { PortfolioDiagnostics } from "@/components/dashboard/PortfolioDiagnostics";
import {
  agingOfOpenReviews,
  dataQuality,
  gewerkStandings,
  reviewerConcentration,
} from "@shared/portfolio-metrics";
import { deriveProjectMetrics, percent } from '@shared/project-metrics';
import { statusBadgeClass, statusHex, STATUS_TONE, TONE_APPEARANCE } from '@shared/status-appearance';
import { APPROVED_STATUSES, BLOCKING_STATUSES, normalizeReviewStatus, OPEN_STATUSES, type ReviewStatus } from '@shared/review-status';
import { formatGerman, toDate } from '@shared/date';
import { projectLinkNote, projectLinkUrl } from '@shared/project-link';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip 
} from 'recharts';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllData, useAuditLog } from '@/hooks/useDataQuery';
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

const GEWERKE = [
  "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS", 
  "TBQ", "UM", "BIM", "LST", "Vermessung", 
  "Baubetriebstechnologie", "Baubetriebsplanung"
];

/*
 * The reviewer roster is derived from the data, never listed by hand.
 *
 * It used to be a literal array of 37 entries. Measured against the shipped
 * data.json that list was wrong in two ways at once:
 *
 *   - 8 of the 44 reviewers in the data were missing from it — 985 review rows,
 *     Haberla 512, Colak 250, Wagner 83, Matteka 46, "BSB des BM´s" 33,
 *     Eda Pourabbas 32, Ates 23, Herr 6. Colak alone would have ranked third in
 *     the "Top Performer" list the page renders, and was absent from it.
 *   - "Zentrale" appeared twice, so two rows rendered with the same React key
 *     and its workload was counted twice in the panel total.
 *
 * A derived roster cannot drift from the data it describes.
 */
function reviewerNames(projects: Project[]): string[] {
  const seen = new Set<string>();
  for (const p of projects) {
    for (const r of p.reviews ?? []) {
      const n = (r.prueferName ?? "").trim();
      if (n) seen.add(n);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "de"));
}

interface Project {
  id: number;
  projektnummer: string | null;
  station: string | null;
  bahnhofsmanagement: string | null;
  bahnhofsnummer: string | null;
  streckennummer: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  projektleiter: string | null;
  terminProjektvorstellung: string | null;
  kommentar: string | null;
  projektLink: string | null;
  reviews: Array<{
    department: string;
    status: string | null;
    prueferName: string | null;
    pruefDatum: string | null;
  }>;
}

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
  const queryClient = useQueryClient();
  const { data: allData, isLoading: dataLoading, isError: dataError } = useAllData();
  const { data: auditEntries } = useAuditLog();
  const [selectedGewerke, setSelectedGewerke] = useState<string | null>(null);
  const [expandedFach, setExpandedFach] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const projects: Project[] = allData?.projects || [];

  // Every figure below comes from shared/project-metrics.ts, the same
  // derivation Projects.tsx uses. Two reasons it moved out of this file:
  //
  //  1. "Abgeschlossen" was Math.round(totalProjects * 0.68) — a multiplier,
  //     not a measurement. It read 883; the real figure is 573.
  //  2. The remaining counters compared `r.status` to string literals, so
  //     "Niederschrift erstellt (LP05-05-01-F31)" and the 3,306 other
  //     annotated rows fell through every branch. normalizeReviewStatus maps
  //     them onto the canonical 12 first.
  const metrics = useMemo(() => deriveProjectMetrics(projects), [projects]);
  const totalProjects = metrics.total;
  const openReviews = metrics.openReviews;
  const criticalProjects = metrics.blocked;
  const completedProjects = metrics.completed;
  const totalReviews = metrics.totalReviews;
  const decidedReviews = metrics.approvedReviews + metrics.blockedReviews;
  const successRate = decidedReviews > 0 ? (metrics.approvedReviews / decidedReviews) * 100 : 0;
  const avgReviewsPerProject = totalProjects > 0 ? totalReviews / totalProjects : 0;

  // "Delayed" = presentation date is in the past but at least one review is still open.
  const today = new Date();
  // Was `r.status === "offen" || r.status === "in Bearbeitung"`, which is a
  // third definition of "open" on a page that already had two. It missed
  // Nachforderung and prüffähig entirely and every annotated variant, and
  // reported 304 where the canonical OPEN_STATUSES gives 347. The date also
  // went through `new Date()`, which parses a date-only string as UTC midnight
  // and can shift a whole day west of Greenwich; toDate() is timezone-safe.
  today.setHours(0, 0, 0, 0);
  const delayedProjects = projects.filter(p => {
    const d = toDate(p.terminProjektvorstellung);
    const stillOpen = p.reviews.some(r => {
      const s = normalizeReviewStatus(r.status);
      return s !== null && (OPEN_STATUSES as readonly string[]).includes(s);
    });
    return d !== null && d < today && stillOpen;
  }).length;

  // Real regional distribution from actual bahnhofsmanagement values (top 5).
  const regionCount = new Set(
    projects.map((p) => (p.bahnhofsmanagement ?? "").trim()).filter(Boolean),
  ).size;

  const regionDistribution = (() => {
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.bahnhofsmanagement) counts[p.bahnhofsmanagement] = (counts[p.bahnhofsmanagement] || 0) + 1;
    }
    const palette = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([region, count], i) => ({ region, count, color: palette[i % palette.length] }));
  })();

  // `counts[review.status]` keyed on the raw string, so statusHex() fell
  // through to its neutral fallback: TBQ's 80 "Niederschrift erstellt
  // (LP05-05-01-F31)" rows rendered in exactly the grey used for the 688
  // "nicht erforderlich" rows in the same pie — a completed sign-off painted
  // as irrelevant. That is verbatim the regression status-appearance.ts was
  // written to make impossible.
  const gewerkeStatusData = GEWERKE.map(gew => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      const review = p.reviews.find(r => r.department === gew);
      const status = normalizeReviewStatus(review?.status);
      if (status) counts[status] = (counts[status] || 0) + 1;
    });
    return {
      name: gew,
      value: Object.values(counts).reduce((a, b) => a + b, 0),
      breakdown: counts
    };
  });

  /*
   * The honest per-Gewerk figures.
   *
   * `today` is pinned per render rather than read inside the derivation: an
   * aging bucket that shifts between two calls in the same paint makes the
   * panels disagree with each other for no reason a reader could ever explain.
   */
  const nowMs = useMemo(() => Date.now(), []);
  const standings = useMemo(
    () => gewerkStandings(projects, GEWERKE, nowMs),
    [projects, nowMs],
  );
  const aging = useMemo(() => agingOfOpenReviews(projects, nowMs), [projects, nowMs]);
  const concentration = useMemo(() => reviewerConcentration(projects), [projects]);
  const quality = useMemo(() => dataQuality(projects), [projects]);

  const selectedGewerkeData = selectedGewerke 
    ? gewerkeStatusData.find(g => g.name === selectedGewerke) 
    : null;

  const selectedPieData = selectedGewerkeData 
    ? Object.entries(selectedGewerkeData.breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([status, value]) => ({ name: status, value, color: statusHex(status) }))
    : [];

  /*
   * Workload per reviewer.
   *
   * Three defects, all measured:
   *   - the roster was a hardcoded list missing 8 of the 44 reviewers in the
   *     data (985 rows), so Colak — who ranks third by volume — never appeared
   *     in "Top Performer" at all;
   *   - `includes(r.status)` on raw strings never counted the 80
   *     "Niederschrift erstellt (LP05-05-01-F31)" rows as completed;
   *   - the timeline row carried no department, so two Gewerke signed on the
   *     same day for the same project collapsed onto one React key and 1,509
   *     rows were dropped from the panel.
   */
  const fachWorkload: WorkloadItem[] = useMemo(() => {
    const byName = new Map<string, WorkloadItem>();
    for (const name of reviewerNames(projects)) {
      byName.set(name, { name, incoming: 0, completed: 0, total: 0, timeline: [] });
    }
    for (const p of projects) {
      for (const r of p.reviews ?? []) {
        const name = (r.prueferName ?? "").trim();
        const item = name ? byName.get(name) : undefined;
        if (!item) continue;
        const status = normalizeReviewStatus(r.status);
        if (status && (OPEN_STATUSES as readonly string[]).includes(status)) item.incoming++;
        if (status && (APPROVED_STATUSES as readonly string[]).includes(status)) item.completed++;
        if (r.pruefDatum) {
          item.timeline.push({
            date: r.pruefDatum,
            action: status ?? r.status ?? "Update",
            project: p.station || p.projektnummer || "Ohne Station",
            department: r.department ?? "",
            projectId: p.id,
          });
        }
      }
    }
    return [...byName.values()]
      .map((f) => ({
        ...f,
        total: f.incoming + f.completed,
        timeline: f.timeline.sort((a, b) => b.date.localeCompare(a.date)),
      }))
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [projects]);

  /*
   * Status distribution over every review row.
   *
   * This was five hardcoded buckets matched by exact string. Measured against
   * the shipped data: 15,646 non-null review rows, of which it plotted 14,587
   * and silently dropped 1,059 — Projektkonfig. 474, Prüfung erfolgt 229,
   * Niederschrift erstellt 180 + 80 annotated, zurückgestellt 44,
   * Projektkonfiguration 33, prüffähig 19. Every one of the 260 Niederschrift
   * sign-offs was missing from a chart headed "Alle Gewerke". It also painted
   * Nachforderung red, while status-appearance.ts gives it the amber
   * `attention` tone.
   *
   * Now: one bucket per canonical status, coloured by the same table the
   * badges use, and a row whose status cannot be mapped is counted as
   * unbekannt instead of vanishing.
   */
  const { visibleStatusData, unmappedStatusRows, totalStatusRows } = useMemo(() => {
    const counts = new Map<string, number>();
    let unmapped = 0;
    for (const p of projects) {
      for (const r of p.reviews ?? []) {
        if (!r.status) continue;
        const s = normalizeReviewStatus(r.status);
        if (s === null) { unmapped++; continue; }
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    /*
     * Grouped by tone, not by status.
     *
     * Plotting all 12 canonical statuses made the chart complete but
     * unreadable: status-appearance.ts maps 12 statuses onto 8 tones, so
     * "Zustimmung erteilt" and "Niederschrift erstellt" are the same green and
     * "abgelehnt" and "gestoppt" the same red. Two slices with one colour and
     * two legend entries with one swatch is not a legend. Grouping by tone
     * gives 8 slices, 8 distinct colours, and still counts every row — the
     * tooltip names the statuses inside each.
     */
    const byTone = new Map<string, { value: number; statuses: string[]; color: string }>();
    for (const [status, n] of counts) {
      const tone = STATUS_TONE[status as ReviewStatus];
      const label = TONE_APPEARANCE[tone].label;
      const entry = byTone.get(label) ?? {
        value: 0,
        statuses: [],
        color: TONE_APPEARANCE[tone].hex,
      };
      entry.value += n;
      entry.statuses.push(`${status} (${n.toLocaleString("de-DE")})`);
      byTone.set(label, entry);
    }
    const data = [...byTone.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .map(([name, e]) => ({ name, value: e.value, color: e.color, statuses: e.statuses }));
    if (unmapped > 0) {
      data.push({
        name: "unbekannter Status",
        value: unmapped,
        color: statusHex(null),
        statuses: [],
      });
    }
    return {
      // already filtered: a zero bucket cannot occur, since every bucket is
      // built from a status that was actually counted
      visibleStatusData: data,
      unmappedStatusRows: unmapped,
      totalStatusRows: data.reduce((n, d) => n + d.value, 0),
    };
  }, [projects]);

  // Fixed: Proper typing for upcomingDeadlines (no more union type errors)
  /**
   * Reviews that carry a real Prüfdatum and are still open, soonest first.
   *
   * This used to be `projects.filter(has any pruefDatum).slice(0, 12)` with
   * `deadline: criticalReview?.pruefDatum || "2026-06-15"` and
   * `reviewer: ... || "Unbekannt"`. Three separate problems: the list was not
   * sorted by date at all, so it showed twelve arbitrary projects rather than
   * the nearest deadlines; a project whose critical review had no date got a
   * hardcoded one, which is why every row read 2026-06-15; and an unknown
   * reviewer was rendered as the literal word "Unbekannt".
   */
  const upcomingDeadlines = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows: Array<{
      id: number;
      station: string;
      department: string;
      due: Date;
      dueLabel: string;
      status: string;
      reviewer: string | null;
      overdue: boolean;
    }> = [];
    for (const p of projects) {
      for (const r of p.reviews || []) {
        const status = normalizeReviewStatus(r.status);
        if (!status || !OPEN_STATUSES.includes(status)) continue;
        const due = toDate(r.pruefDatum);
        if (!due) continue; // no date on file — it is not a deadline
        rows.push({
          id: p.id,
          station: p.station || p.projektnummer || `Projekt ${p.id}`,
          department: r.department,
          due,
          dueLabel: due.toLocaleDateString("de-DE"),
          status,
          reviewer: r.prueferName?.trim() || null,
          overdue: due < today,
        });
      }
    }
    return rows.sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 12);
  }, [projects]);

  /**
   * Real alerts, replacing five invented notifications ("Projekt Bad Hersfeld
   * - Nachforderung von ITK", "vor 12 Min", and three more — two of which
   * named stations outside RB Mitte entirely). Every figure here is counted
   * from the review rows.
   */
  const handlungsbedarf = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let overdue = 0;
    let blocked = 0;
    let nachforderung = 0;
    let unassigned = 0;
    for (const p of projects) {
      for (const r of p.reviews || []) {
        const status = normalizeReviewStatus(r.status);
        if (!status) continue;
        if (BLOCKING_STATUSES.includes(status)) blocked++;
        if (status === "Nachforderung") nachforderung++;
        if (OPEN_STATUSES.includes(status)) {
          const due = toDate(r.pruefDatum);
          if (due && due < today) overdue++;
          if (!r.prueferName?.trim()) unassigned++;
        }
      }
    }
    return [
      { key: "overdue", label: "Prüftermin überschritten", count: overdue, tone: "blocked" as const },
      { key: "blocked", label: "abgelehnt oder gestoppt", count: blocked, tone: "blocked" as const },
      { key: "nachforderung", label: "Nachforderung offen", count: nachforderung, tone: "attention" as const },
      { key: "unassigned", label: "offen, ohne Prüfer", count: unassigned, tone: "pending" as const },
    ];
  }, [projects]);

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

  if (dataError || !allData) {
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
    <div className="space-y-8 p-6 bg-background min-h-screen">
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

      {/* MAIN CONTENT */}
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
              <p className="text-2xs text-muted-foreground">
                {totalStatusRows.toLocaleString("de-DE")} von{" "}
                {metrics.totalReviews.toLocaleString("de-DE")} Prüfzeilen tragen einen Status
                {unmappedStatusRows > 0
                  ? ` · ${unmappedStatusRows.toLocaleString("de-DE")} davon unbekannt`
                  : ""}
              </p>
            </CardHeader>
            <CardContent className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* One array, used for both. Recharts matches <Cell> to slice
                      by index, so feeding the Pie a filtered array while
                      mapping Cells from the unfiltered one shifts every colour
                      the moment any bucket reaches zero. */}
                  <Pie
                    data={visibleStatusData}
                    cx="50%" cy="50%" innerRadius={90} outerRadius={160} paddingAngle={2} dataKey="value"
                  >
                    {visibleStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  {/* The tooltip names the statuses folded into each tone, so
                      grouping costs no detail. */}
                  <Tooltip
                    formatter={(value: number, name: string, item: { payload?: { statuses?: string[] } }) => [
                      `${value.toLocaleString("de-DE")} Prüfzeilen${
                        item?.payload?.statuses?.length ? ` — ${item.payload.statuses.join(", ")}` : ""
                      }`,
                      name,
                    ]}
                  />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
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

          <PortfolioRelief standings={standings} />

          {/* Aging, concentration and the trustworthiness of the rows every
              other panel is built on. */}
          <PortfolioDiagnostics aging={aging} concentration={concentration} quality={quality} />

          {/* Detailed Gewerke View */}
          <Card className="border-2 border-primary/20">
            <CardHeader>
              {/* Was `flex items-center justify-between` with a fixed w-64 select:
                  the title and a 256px control cannot share a 327px content box,
                  so <main> measured 406px in a 375px viewport. Stacks below sm. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="min-w-0 break-words">
                  {selectedGewerke ? `Status-Verteilung für ${selectedGewerke}` : "Detaillierte Ansicht per Gewerke"}
                </CardTitle>
                <div className="w-full sm:w-64 sm:shrink-0">
                  <Select 
                    value={selectedGewerke || "all"} 
                    onValueChange={(value) => setSelectedGewerke(value === "all" ? null : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Gewerke auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Gewerke anzeigen</SelectItem>
                      {GEWERKE.map((gew) => (
                        <SelectItem key={gew} value={gew}>{gew}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!selectedGewerke ? (
                <div className="flex flex-col items-center justify-center h-[320px] text-center">
                  <div className="text-6xl mb-4">📊</div>
                  <h3 className="text-xl font-semibold mb-2">Wählen Sie ein Gewerke</h3>
                  <p className="text-muted-foreground max-w-md">
                    Nutzen Sie das Dropdown oben, um die detaillierte Status-Verteilung für einen bestimmten Fachbereich anzuzeigen.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  <div className="lg:col-span-3 h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={selectedPieData}
                          cx="50%" cy="50%" innerRadius={80} outerRadius={140} paddingAngle={3} dataKey="value"
                        >
                          {selectedPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Gesamtzahl Prüfungen</div>
                      <div className="text-4xl font-bold">{selectedGewerkeData?.value?.toLocaleString("de-DE")}</div>
                    </div>
                    <div className="space-y-2 pt-4 border-t">
                      {selectedPieData.map((item) => (
                        <div key={item.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                            <span>{item.name}</span>
                          </div>
                          <Badge variant="outline">{item.value}</Badge>
                        </div>
                      ))}
                    </div>
                    <Button variant="outline" className="w-full mt-4" onClick={() => setSelectedGewerke(null)}>
                      Zurück zur Übersicht
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
                              <div key={`${item.date}-${item.projectId}-${item.department}-${item.action}`} className="flex items-start gap-3 text-sm border-l-2 border-primary pl-3 py-1">
                                <div className="font-mono text-xs text-muted-foreground w-24 shrink-0">{formatGerman(item.date) || item.date}</div>
                                <div className="min-w-0">
                                  <span className="font-medium">{item.action}</span> — {item.project}
                                  {item.department && (
                                    <span className="ml-1 text-xs text-muted-foreground">({item.department})</span>
                                  )}
                                </div>
                              </div>
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
                      setSelectedProject(projects.find((pr) => pr.id === d.id) || null)
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
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${statusBadgeClass(d.status)}`}
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
              {handlungsbedarf.map((h) => (
                <div
                  key={h.key}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
                >
                  <span className="min-w-0 text-sm leading-tight">{h.label}</span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${
                      h.count === 0
                        ? "bg-muted text-muted-foreground"
                        : TONE_APPEARANCE[h.tone].badge
                    }`}
                  >
                    {h.count.toLocaleString("de-DE")}
                  </span>
                </div>
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
                Regionale Verteilung — Top {regionDistribution.length} von {regionCount}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {regionDistribution.map((r) => (
                  <div key={r.region} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <div className="flex-1">{r.region}</div>
                    <div className="font-mono font-bold">{r.count.toLocaleString("de-DE")}</div>
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-current" style={{ width: `${(r.count / totalProjects) * 100}%`, color: r.color }} />
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
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
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
                          )}`}
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
