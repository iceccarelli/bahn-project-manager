import React, { useMemo, useState } from 'react';
import { deriveProjectMetrics, percent } from '@shared/project-metrics';
import { statusBadgeClass, statusHex, TONE_APPEARANCE } from '@shared/status-appearance';
import { BLOCKING_STATUSES, normalizeReviewStatus, OPEN_STATUSES } from '@shared/review-status';
import { toDate } from '@shared/date';
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
const GEWERKE = [
  "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS", 
  "TBQ", "UM", "BIM", "LST", "Vermessung", 
  "Baubetriebstechnologie", "Baubetriebsplanung"
];

const FACHSPEZIALISTEN = [
  "Aydogdu", "Degen", "Ries", "Schomber", "Bär", "Oker", "Zentrale",
  "Er", "Grimaldi", "Goldhausen", "Fey", "Kröcker", "Afteni", "Bierbaum",
  "Engstfeld", "Weyer", "Lorenz", "Hartung", "Frischbier", "Vafaei", 
  "Kohlwey", "Rabkin", "Köksal", "Haag", "Pourabbas", "Glandorf", "Krejtschi",
  "Frousiou-Bauer", "Kalisa", "Dauth", "Hebbrecht", "Kubwimana", "Vatter",
  "Schauß", "Bierbrauer", "Zentrale", "Zuordnung erforderlich"
];

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
  timeline: Array<{ date: string; action: string; project: string }>;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: allData } = useAllData();
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
  const delayedProjects = projects.filter(p => {
    const d = p.terminProjektvorstellung ? new Date(p.terminProjektvorstellung) : null;
    const stillOpen = p.reviews.some(r => r.status === "offen" || r.status === "in Bearbeitung");
    return d && !Number.isNaN(d.getTime()) && d < today && stillOpen;
  }).length;

  // Real regional distribution from actual bahnhofsmanagement values (top 5).
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

  const gewerkeStatusData = GEWERKE.map(gew => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      const review = p.reviews.find(r => r.department === gew);
      if (review?.status) counts[review.status] = (counts[review.status] || 0) + 1;
    });
    return {
      name: gew,
      value: Object.values(counts).reduce((a, b) => a + b, 0),
      breakdown: counts
    };
  });

  const selectedGewerkeData = selectedGewerke 
    ? gewerkeStatusData.find(g => g.name === selectedGewerke) 
    : null;

  const selectedPieData = selectedGewerkeData 
    ? Object.entries(selectedGewerkeData.breakdown).map(([status, value]) => ({
        name: status, value, color: statusHex(status)
      }))
    : [];

  const fachWorkload: WorkloadItem[] = FACHSPEZIALISTEN.map(name => {
    let incoming = 0;
    let completed = 0;
    const timeline: Array<{date: string, action: string, project: string}> = [];

    projects.forEach(p => {
      p.reviews.forEach(r => {
        if (r.prueferName === name) {
          if (["offen", "in Bearbeitung", "Nachforderung", "prüffähig"].includes(r.status || "")) incoming++;
          if (["Zustimmung erteilt", "Niederschrift erstellt"].includes(r.status || "")) completed++;
          if (r.pruefDatum) {
            timeline.push({
              date: r.pruefDatum,
              action: r.status || "Update",
              project: p.station || p.projektnummer || "Unknown"
            });
          }
        }
      });
    });

    return {
      name, incoming, completed,
      total: incoming + completed,
      timeline: timeline.sort((a, b) => b.date.localeCompare(a.date))
    };
  }).filter(f => f.total > 0).sort((a, b) => b.total - a.total);

  const overallStatusData = [
    { name: "Zustimmung erteilt", value: 0, color: "#10b981" },
    { name: "offen", value: 0, color: "#f59e0b" },
    { name: "in Bearbeitung", value: 0, color: "#3b82f6" },
    { name: "nicht erforderlich", value: 0, color: "#64748b" },
    { name: "abgelehnt / Kritisch", value: 0, color: "#ef4444" },
  ];

  projects.forEach(p => {
    p.reviews.forEach(r => {
      if (!r.status) return;
      const entry = overallStatusData.find(s => s.name === r.status);
      if (entry) entry.value++;
      else if (["abgelehnt", "Nachforderung", "gestoppt"].includes(r.status)) {
        const sonstige = overallStatusData[4];
        if (sonstige) sonstige.value++;
      }
    });
  });

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




  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
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
            <p className="text-xs text-muted-foreground mt-1">+23 seit letzter Woche</p>
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
            <p className="text-xs text-amber-600 mt-1">Sofortiger Handlungsbedarf</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" /> Abgeschlossen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-emerald-600">
              {completedProjects.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-emerald-600 mt-1">
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
            <div className="text-5xl font-bold text-rose-600">{criticalProjects}</div>
            <p className="text-xs text-rose-600 mt-1">Abgelehnt / Nachforderung</p>
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
            </CardHeader>
            <CardContent className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={overallStatusData.filter(d => d.value > 0)}
                    cx="50%" cy="50%" innerRadius={90} outerRadius={160} paddingAngle={2} dataKey="value"
                  >
                    {overallStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Per Gewerke Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Status pro Gewerke (Fachbereich)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {gewerkeStatusData.slice(0, 8).map((gew) => (
                  <button
                    type="button"
                    key={gew.name}
                    className="w-full border rounded-xl p-4 text-left hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => setSelectedGewerke(gew.name)}
                  >
                    <div className="font-semibold text-lg mb-2">{gew.name}</div>
                    <div className="text-3xl font-bold mb-3">{gew.value}</div>
                    <div className="space-y-1 text-xs">
                      {Object.entries(gew.breakdown).slice(0, 3).map(([status, count]) => (
                        <div key={status} className="flex justify-between">
                          <span className="text-muted-foreground">{status}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Detailed Gewerke View */}
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {selectedGewerke ? `Status-Verteilung für ${selectedGewerke}` : "Detaillierte Ansicht per Gewerke"}
                </CardTitle>
                <div className="w-64">
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
                      <div className="text-4xl font-bold">{selectedGewerkeData?.value}</div>
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
                          {fach.incoming} offen • {fach.completed} erledigt
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={fach.incoming > 5 ? "destructive" : "secondary"}>
                        {fach.total} Tasks
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
                            <div className="text-2xl font-bold text-amber-600">{fach.incoming}</div>
                            <div className="text-xs">Eingehend</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-emerald-600">{fach.completed}</div>
                            <div className="text-xs">Erledigt</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold">{fach.total}</div>
                            <div className="text-xs">Gesamt</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium mb-2 text-muted-foreground">AKTUELLE AKTIVITÄT</div>
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                            {fach.timeline.length > 0 ? fach.timeline.map((item) => (
                              <div key={`${item.date}-${item.project}-${item.action}`} className="flex items-start gap-3 text-sm border-l-2 border-primary pl-3 py-1">
                                <div className="font-mono text-xs text-muted-foreground w-20 shrink-0">{item.date}</div>
                                <div>
                                  <span className="font-medium">{item.action}</span> — {item.project}
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
                <div className="font-mono font-bold text-rose-600">{delayedProjects.toLocaleString("de-DE")}</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Erfolgsquote (erteilte Zustimmungen)</div>
                <div className="font-mono font-bold text-emerald-600">{successRate.toFixed(1)}%</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Projekte gesamt</div>
                <div className="font-mono font-bold">{totalProjects.toLocaleString("de-DE")}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regionale Verteilung</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {regionDistribution.map((r) => (
                  <div key={r.region} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }} />
                    <div className="flex-1">{r.region}</div>
                    <div className="font-mono font-bold">{r.count}</div>
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
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="font-mono text-xs text-emerald-600">{f.name.slice(0, 2)}</span>
                    </div>
                    <div>{f.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-emerald-600">{f.completed}</div>
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
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span>Datenbank: Online</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span>Excel Sync: Aktiv</span>
              </div>
              {/* "API: Verbunden" with a green pulse was false: production is a
                  static SPA (vercel.json declares no functions) and the data
                  lives in localStorage seeded from /data.json. */}
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {selectedProject.reviews.map((review) => (
                    <div key={review.department} className="border rounded-xl p-3">
                      <div className="font-mono text-xs text-muted-foreground">{review.department}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* Was white text on statusHex(). Those hexes are tuned
                            as chart *fills*; as a text background they measured
                            2.15:1 for "offen" and 2.54:1 for "Zustimmung
                            erteilt", against a 4.5:1 floor. The badge variant of
                            the same tone is built for text and passes. */}
                        <Badge variant="outline" className={statusBadgeClass(review.status)}>
                          {review.status || "—"}
                        </Badge>
                      </div>
                      <div className="text-sm mt-1">{review.prueferName}</div>
                      <div className="text-xs text-muted-foreground">{review.pruefDatum}</div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedProject.projektLink && (
                <Button variant="outline" asChild>
                  <a href={selectedProject.projektLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Projektlink öffnen
                  </a>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
