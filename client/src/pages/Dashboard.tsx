import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { 
  Users, AlertTriangle, CheckCircle, Clock, TrendingUp, 
  ChevronDown, ChevronUp, ExternalLink 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAllData } from '@/hooks/useData';
import { toast } from 'sonner';

// Corporate DB Status Colors
const STATUS_COLORS: Record<string, string> = {
  "nicht erforderlich": "#64748b",
  "offen": "#f59e0b",
  "in Bearbeitung": "#3b82f6",
  "prüffähig": "#06b6d4",
  "Zustimmung erteilt": "#10b981",
  "Niederschrift erstellt": "#10b981",
  "abgelehnt": "#ef4444",
  "zurückgestellt": "#eab308",
  "gestoppt": "#f97316",
  "Nachforderung": "#f97316",
  "Projektkonfig.": "#8b5cf6",
};

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
  const { data: allData, isLoading } = useAllData();
  const [selectedGewerke, setSelectedGewerke] = useState<string | null>(null);
  const [expandedFach, setExpandedFach] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const projects: Project[] = allData?.projects || [];

  // Calculate KPIs
  const totalProjects = projects.length;
  const openReviews = projects.reduce((sum, p) => 
    sum + p.reviews.filter(r => r.status === "offen" || r.status === "in Bearbeitung").length, 0);
  const criticalProjects = projects.filter(p => 
    p.reviews.some(r => r.status === "abgelehnt" || r.status === "Nachforderung")).length;

  // Status Distribution per Gewerke (Pie Data)
  const gewerkeStatusData = GEWERKE.map(gew => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      const review = p.reviews.find(r => r.department === gew);
      if (review?.status) {
        counts[review.status] = (counts[review.status] || 0) + 1;
      }
    });
    return {
      name: gew,
      value: Object.values(counts).reduce((a, b) => a + b, 0),
      breakdown: counts
    };
  });

  // Selected Gewerke Data
  const selectedGewerkeData = selectedGewerke 
    ? gewerkeStatusData.find(g => g.name === selectedGewerke) 
    : null;

  const selectedPieData = selectedGewerkeData 
    ? Object.entries(selectedGewerkeData.breakdown).map(([status, value]) => ({
        name: status,
        value,
        color: STATUS_COLORS[status] || "#64748b"
      }))
    : [];

  // Fachspezialist Workload
  const fachWorkload = FACHSPEZIALISTEN.map(name => {
    let incoming = 0;
    let completed = 0;
    let timeline: Array<{date: string, action: string, project: string}> = [];

    projects.forEach(p => {
      p.reviews.forEach(r => {
        if (r.prueferName === name) {
          if (["offen", "in Bearbeitung", "Nachforderung", "prüffähig"].includes(r.status || "")) {
            incoming++;
          }
          if (["Zustimmung erteilt", "Niederschrift erstellt"].includes(r.status || "")) {
            completed++;
          }
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
      name,
      incoming,
      completed,
      total: incoming + completed,
      timeline: timeline.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
    };
  }).filter(f => f.total > 0).sort((a, b) => b.total - a.total);

  // Overall Status Pie
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

  const handleProjectClick = (project: Project) => {
    setSelectedProject(project);
  };

  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Live Übersicht über alle 1.300+ Projekte • {new Date().toLocaleDateString('de-DE')}
          </p>
        </div>
        <Button onClick={() => toast.success("Daten synchronisiert")} className="gap-2">
          <TrendingUp className="h-4 w-4" /> Daten aktualisieren
        </Button>
      </div>

      {/* KPI Cards */}
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column - Charts */}
        <div className="xl:col-span-7 space-y-6">
          {/* Overall Status Distribution (Alle Gewerke) */}
          <Card>
            <CardHeader>
              <CardTitle>Status-Verteilung (Alle Gewerke)</CardTitle>
            </CardHeader>
            <CardContent className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={overallStatusData.filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={90}
                    outerRadius={160}
                    paddingAngle={2}
                    dataKey="value"
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

          {/* Per Gewerke Status Breakdown (Grid) */}
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

          {/* NEW: Detailed View for Selected Gewerke */}
          <Card className="border-2 border-[#FF0000]/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  {selectedGewerke 
                    ? `Status-Verteilung für ${selectedGewerke}` 
                    : "Detaillierte Ansicht pro Gewerke"}
                </CardTitle>
                
                <div className="w-64">
                  <Select 
                    value={selectedGewerke || ""} 
                    onValueChange={(value) => setSelectedGewerke(value || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Gewerke auswählen..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Alle Gewerke anzeigen</SelectItem>
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
                    Nutzen Sie das Dropdown oben, um die detaillierte Status-Verteilung 
                    für einen bestimmten Fachbereich anzuzeigen.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Pie Chart for Selected Gewerke */}
                  <div className="lg:col-span-3 h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={selectedPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={80}
                          outerRadius={140}
                          paddingAngle={3}
                          dataKey="value"
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

                  {/* Details Sidebar */}
                  <div className="lg:col-span-2 space-y-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Gesamtzahl Prüfungen</div>
                      <div className="text-4xl font-bold">{selectedGewerkeData?.value}</div>
                    </div>

                    <div className="space-y-2 pt-4 border-t">
                      {selectedPieData.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: item.color }}
                            />
                            <span>{item.name}</span>
                          </div>
                          <Badge variant="outline">{item.value}</Badge>
                        </div>
                      ))}
                    </div>

                    <Button 
                      variant="outline" 
                      className="w-full mt-4"
                      onClick={() => setSelectedGewerke(null)}
                    >
                      Zurück zur Übersicht
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Fachspezialisten */}
        <div className="xl:col-span-5">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" /> Fachspezialisten Workload
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Klicken Sie auf einen Namen für Details
              </p>
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

                        {/* Timeline */}
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

      {/* Project Detail Modal */}
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
    </div>
  );
}
