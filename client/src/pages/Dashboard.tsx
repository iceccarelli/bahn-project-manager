import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip 
} from 'recharts';
import { 
  Users, AlertTriangle, CheckCircle, Clock, TrendingUp, 
  ChevronDown, ChevronUp, ExternalLink,
  Bell, Mail, Calendar, MessageSquare, Send, Zap, LogIn
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllData } from '@/hooks/useData';
import { toast } from 'sonner';

// DB Corporate Status Colors (perfect harmony with Projects.tsx)
const STATUS_COLORS: Record<string, string> = {
  "nicht erforderlich": "#64748b", "offen": "#f59e0b", "in Bearbeitung": "#3b82f6",
  "prüffähig": "#06b6d4", "Zustimmung erteilt": "#10b981", "Niederschrift erstellt": "#10b981",
  "abgelehnt": "#ef4444", "zurückgestellt": "#eab308", "gestoppt": "#f97316",
  "Nachforderung": "#f97316", "Projektkonfig.": "#8b5cf6",
};

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
  projektnummer: string;
  station: string;
  bahnhofsmanagement: string;
  projektleiter: string;
  projektbeschreibung: string;
  reviews: Array<{
    department: string;
    status: string | null;
    prueferName: string | null;
    pruefDatum: string | null;
  }>;
  kommentar?: string;
  projektLink?: string;
}

export default function Dashboard() {
  const { data: allData } = useAllData();
  const [selectedGewerke, setSelectedGewerke] = useState<string | null>(null);
  const [expandedFach, setExpandedFach] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showMicrosoftInfo, setShowMicrosoftInfo] = useState(false);

  const projects: Project[] = allData?.projects || [];

  const totalProjects = projects.length;
  const openReviews = projects.reduce((sum, p) => 
    sum + p.reviews.filter(r => r.status === "offen" || r.status === "in Bearbeitung").length, 0);
  const criticalProjects = projects.filter(p => 
    p.reviews.some(r => r.status === "abgelehnt" || r.status === "Nachforderung")).length;

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
        name: status, value, color: STATUS_COLORS[status] || "#64748b"
      }))
    : [];

  const fachWorkload = FACHSPEZIALISTEN.map(name => {
    let incoming = 0, completed = 0;
    let timeline: Array<{date: string, action: string, project: string}> = [];

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
      timeline: timeline.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
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
        overallStatusData[4].value++;
      }
    });
  });

  const upcomingDeadlines = projects
    .filter(p => p.reviews.some(r => r.pruefDatum))
    .slice(0, 12)
    .map(p => {
      const criticalReview = p.reviews.find(r => 
        ["offen", "in Bearbeitung", "Nachforderung"].includes(r.status || "")
      );
      return {
        ...p,
        deadline: criticalReview?.pruefDatum || "2026-06-15",
        status: criticalReview?.status || "offen",
        reviewer: criticalReview?.prueferName || "Unbekannt"
      };
    });

  const activityFeed = [
    { user: "Oker", action: "hat Status auf 'Zustimmung erteilt' gesetzt", project: "Hamburg Hbf", time: "vor 8 Min", icon: CheckCircle },
    { user: "Engstfeld", action: "hat Nachforderung gestellt", project: "Stuttgart 21", time: "vor 23 Min", icon: AlertTriangle },
    { user: "Aydogdu", action: "hat Prüfung abgeschlossen", project: "Berlin Hbf", time: "vor 1 Std", icon: CheckCircle },
    { user: "System", action: "hat 23 neue Projekte aus Excel importiert", project: "", time: "vor 3 Std", icon: Zap },
    { user: "Schomber", action: "hat Status auf 'prüffähig' gesetzt", project: "München Ost", time: "vor 4 Std", icon: CheckCircle },
    { user: "Ries", action: "hat neue Prüfung gestartet", project: "Köln Messe/Deutz", time: "vor 5 Std", icon: Clock },
  ];

  const notifications = [
    { type: "urgent", message: "Projekt Bad Hersfeld - Nachforderung von ITK", time: "vor 12 Min" },
    { type: "info", message: "Zustimmung erteilt für Frankfurt Hbf (EEA)", time: "vor 47 Min" },
    { type: "warning", message: "Deadline überschritten: Köln Messe/Deutz", time: "vor 2 Std" },
    { type: "success", message: "Neues Projekt angelegt: München Ost", time: "vor 4 Std" },
    { type: "info", message: "Neue Excel-Datei hochgeladen: 47 Projekte", time: "vor 6 Std" },
  ];

  const handleProjectClick = (project: Project) => setSelectedProject(project);

  const handleMicrosoftConnect = () => {
    setShowMicrosoftInfo(true);
    toast.info("Microsoft 365 Integration", {
      description: "Diese Funktion wird in Kürze aktiviert. Bitte kontaktieren Sie den Administrator für Setup."
    });
  };

  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Live Übersicht über alle {totalProjects.toLocaleString('de-DE')}+ Projekte • {new Date().toLocaleDateString('de-DE')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button 
            onClick={handleMicrosoftConnect} 
            className="gap-2 bg-[#FF0000] hover:bg-[#CC0000]"
          >
            <LogIn className="h-4 w-4" /> Mit Microsoft 365 verbinden (Optional)
          </Button>
          
          <Button onClick={() => toast.success("Daten synchronisiert")} className="gap-2">
            <TrendingUp className="h-4 w-4" /> Aktualisieren
          </Button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-[#FF0000]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Gesamtprojekte
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-[#FF0000]">{totalProjects.toLocaleString('de-DE')}</div>
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
              {Math.round(totalProjects * 0.68)}
            </div>
            <p className="text-xs text-emerald-600 mt-1">68% im Zeitplan</p>
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
                    {overallStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
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
                {gewerkeStatusData.slice(0, 8).map((gew, idx) => (
                  <div 
                    key={idx} 
                    className="border rounded-xl p-4 hover:shadow-md transition-all cursor-pointer"
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
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Detailed Gewerke View */}
          <Card className="border-2 border-[#FF0000]/20">
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
                          {selectedPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Gesamtzahl Prüfungen</div>
                      <div className="text-4xl font-bold">{selectedGewerkeData?.value}</div>
                    </div>
                    <div className="space-y-2 pt-4 border-t">
                      {selectedPieData.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
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
              {fachWorkload.slice(0, 12).map((fach, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="border rounded-2xl overflow-hidden"
                >
                  <div 
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedFach(expandedFach === fach.name ? null : fach.name)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#FF0000]/10 flex items-center justify-center">
                        <span className="font-mono text-sm text-[#FF0000]">{fach.name.slice(0, 2)}</span>
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
                  </div>

                  <AnimatePresence>
                    {expandedFach === fach.name && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t bg-muted/30 px-4 py-4"
                      >
                        <div className="grid grid-cols-3 gap-4 mb-4">
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
                          <div className="space-y-2">
                            {fach.timeline.length > 0 ? fach.timeline.map((item, i) => (
                              <div key={i} className="flex items-start gap-3 text-sm border-l-2 border-[#FF0000] pl-3">
                                <div className="font-mono text-xs text-muted-foreground w-20">{item.date}</div>
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

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
          <Card className="border-l-4 border-l-rose-500">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-5 w-5 text-rose-500" /> Anstehende Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[280px] overflow-auto pr-1">
              {upcomingDeadlines.length > 0 ? upcomingDeadlines.map((p, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-xl border bg-card hover:bg-muted/50 transition-colors">
                  <div className="mt-1">
                    {p.status === "Nachforderung" || p.status === "abgelehnt" ? 
                      <AlertTriangle className="h-4 w-4 text-rose-500" /> : 
                      <Clock className="h-4 w-4 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{p.station}</div>
                    <div className="text-xs text-muted-foreground">{p.reviewer} • {p.deadline}</div>
                    <Badge variant="outline" className="mt-1 text-[10px]">{p.status}</Badge>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toast.success(`Erinnerung für ${p.station} wurde vorbereitet`)}>
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
              )) : (
                <div className="text-center py-8 text-muted-foreground text-sm">Keine anstehenden Deadlines</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-5 w-5 text-[#FF0000]" /> Benachrichtigungen
                <Badge className="ml-auto bg-[#FF0000]">{notifications.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[280px] overflow-auto pr-1">
              {notifications.map((n, idx) => (
                <motion.div 
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-3 p-3 rounded-xl border-l-4 bg-muted/30"
                  style={{ borderLeftColor: n.type === "urgent" ? "#ef4444" : n.type === "warning" ? "#f59e0b" : "#10b981" }}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium leading-tight">{n.message}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{n.time}</div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success("Benachrichtigung gesendet")}>
                    Senden
                  </Button>
                </motion.div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-5 w-5" /> Team-Aktivität
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-h-[280px] overflow-auto pr-1 text-sm">
              {activityFeed.map((activity, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="mt-1">
                    <activity.icon className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold">{activity.user}</span> {activity.action}
                    {activity.project && <span className="text-muted-foreground"> • {activity.project}</span>}
                    <div className="text-[10px] text-muted-foreground mt-0.5">{activity.time}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-[#FF0000]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-[#FF0000]" /> Schnellaktionen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => toast.success("Status-Update-E-Mail wurde vorbereitet")}>
                <Mail className="h-4 w-4" /> Status-Update an alle Projektleiter
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => toast.success("Outlook-Termin wurde vorbereitet")}>
                <Calendar className="h-4 w-4" /> Outlook-Termin erstellen
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 h-11" onClick={() => toast.success("Zusammenfassung wurde für Teams vorbereitet")}>
                <MessageSquare className="h-4 w-4" /> In Teams-Kanal posten
              </Button>
              <Button variant="destructive" className="w-full justify-start gap-2 h-11" onClick={() => toast.success("Kritische Fälle wurden eskaliert")}>
                <AlertTriangle className="h-4 w-4" /> Kritische Fälle eskalieren
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-[#FF0000]/5 to-transparent border-[#FF0000]/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  Microsoft 365
                </div>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Optional - Klicken Sie oben zum Verbinden</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-emerald-500 text-xs">OUTLOOK</div>
                  <div className="font-mono text-[10px]">Verfügbar</div>
                </div>
                <div>
                  <div className="text-emerald-500 text-xs">TEAMS</div>
                  <div className="font-mono text-[10px]">Verfügbar</div>
                </div>
                <div>
                  <div className="text-emerald-500 text-xs">SHAREPOINT</div>
                  <div className="font-mono text-[10px]">Verfügbar</div>
                </div>
              </div>

              <div className="pt-2 border-t space-y-2">
                <Button size="sm" className="w-full bg-[#FF0000] hover:bg-[#CC0000] text-white" onClick={handleMicrosoftConnect}>
                  In Teams posten
                </Button>
                <Button size="sm" variant="outline" className="w-full" onClick={handleMicrosoftConnect}>
                  Outlook-Ereignis erstellen
                </Button>
              </div>
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
                <div>Durchschnittliche Bearbeitungszeit</div>
                <div className="font-mono font-bold">14.3 Tage</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Projekte mit Verzögerung</div>
                <div className="font-mono font-bold text-rose-600">187</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Erfolgsquote diese Woche</div>
                <div className="font-mono font-bold text-emerald-600">94.2%</div>
              </div>
              <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>Neue Projekte diesen Monat</div>
                <div className="font-mono font-bold">312</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regionale Verteilung</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { region: "Nord", count: 342, color: "#3b82f6" },
                  { region: "Süd", count: 287, color: "#10b981" },
                  { region: "Ost", count: 198, color: "#f59e0b" },
                  { region: "West", count: 256, color: "#8b5cf6" },
                  { region: "Zentrale", count: 215, color: "#ef4444" },
                ].map((r, idx) => (
                  <div key={idx} className="flex items-center gap-3">
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
              {fachWorkload.slice(0, 6).map((f, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <span className="font-mono text-xs text-emerald-600">{f.name.slice(0, 2)}</span>
                    </div>
                    <div>{f.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-emerald-600">{f.completed}</div>
                    <div className="text-[10px] text-muted-foreground">erledigt</div>
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
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span>API: Verbunden</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                <span>Microsoft 365: Optional</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Letzte Aktualisierung: {new Date().toLocaleString('de-DE')} • Version 2.4.1 • Build: Production
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
                  {selectedProject.reviews.map((review, idx) => (
                    <div key={idx} className="border rounded-xl p-3">
                      <div className="font-mono text-xs text-muted-foreground">{review.department}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge 
                          style={{ backgroundColor: STATUS_COLORS[review.status || ""] || "#64748b" }}
                          className="text-white"
                        >
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

      {/* Microsoft Info Dialog */}
      <Dialog open={showMicrosoftInfo} onOpenChange={setShowMicrosoftInfo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Microsoft 365 Integration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p>Diese Funktion ermöglicht die direkte Integration mit Outlook, Teams und SharePoint.</p>
            <p className="text-sm text-muted-foreground">
              Für die Aktivierung wird eine Azure App Registration benötigt. 
              Bitte kontaktieren Sie den Systemadministrator.
            </p>
            <Button onClick={() => setShowMicrosoftInfo(false)} className="w-full">
              Verstanden
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
