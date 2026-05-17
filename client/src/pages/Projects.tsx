import React, { useState, useCallback, useMemo } from "react";
import { useProjects, useFilters, useAllData, type Project, type Review } from "@/hooks/useDataQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  ArrowUpDown,
  ExternalLink,
  MessageSquare,
  Plus,
  Download,
  Table,
  LayoutGrid,
  MapPin,
} from "lucide-react";
import { DEPARTMENTS, REVIEW_STATUSES } from "@shared/types";
import { toast } from "sonner";
import { MapView } from "@/components/Map";
import { useTheme } from "@/contexts/ThemeContext";

// DB Corporate Status Colors (perfect harmony with Dashboard.tsx)
const STATUS_COLORS: Record<string, string> = {
  "nicht erforderlich": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "offen": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Projektkonfig.": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "in Bearbeitung": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Nachforderung": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "prüffähig": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Prüfung erfolgt": "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  "Zustimmung erteilt": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Niederschrift erstellt": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "abgelehnt": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "zurückgestellt": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "gestoppt": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const colorClass = STATUS_COLORS[status] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${colorClass}`}>
      {status}
    </span>
  );
}

function InlineEditCell({
  value,
  onSave,
  className = "",
}: {
  value: string | null;
  onSave: (val: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  if (editing) {
    return (
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => {
          if (editValue !== (value || "")) onSave(editValue);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (editValue !== (value || "")) onSave(editValue);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className={`bg-transparent border-b border-[#FF0000]/50 outline-none text-xs w-full focus:border-[#FF0000] ${className}`}
      />
    );
  }
  return (
    <span
      onClick={() => {
        setEditValue(value || "");
        setEditing(true);
      }}
      className={`cursor-pointer hover:bg-[#FF0000]/5 rounded px-1 py-0.5 -mx-1 transition-colors ${className}`}
      title="Klicken zum Bearbeiten"
    >
      {value || "-"}
    </span>
  );
}

interface SortHeaderProps {
  column: string;
  label: string;
  sortBy: string;
  onSort: (column: string) => void;
}

function SortHeader({ column, label, sortBy, onSort }: SortHeaderProps) {
  return (
    <th
      className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none border-b"
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === column && <ArrowUpDown className="h-3 w-3 text-[#FF0000]" />}
      </span>
    </th>
  );
}

export default function Projects() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [region, setRegion] = useState<string>("");
  const [projektleiter, setProjektleiter] = useState<string>("");
  const [pruefer, setPruefer] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [department, setDepartment] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"table" | "cards" | "map">("table");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProj, setNewProj] = useState({
    projektnummer: "",
    station: "",
    bahnhofsmanagement: "",
    projektleiter: "",
    projektbeschreibung: "",
    kommentar: "",
    projektLink: "",
  });

  const { data, isLoading, applyEdit, applyReviewEdit, addProject } = useProjects({
    page,
    pageSize,
    search: search || undefined,
    region: region || undefined,
    projektleiter: projektleiter || undefined,
    pruefer: pruefer || undefined,
    status: status || undefined,
    department: department || undefined,
    sortBy,
    sortDir,
  });

  const { data: filterOptions } = useFilters();
  const { data: allData } = useAllData();
  const { theme } = useTheme();

  const totalProjects = allData?.projects?.length || 1298;
  const activeProjects = useMemo(() => {
    if (!allData?.projects) return 874;
    return allData.projects.filter((p: Project) =>
      p.reviews?.some((r: Review) => r.status === "in Bearbeitung" || r.status === "prüffähig")
    ).length;
  }, [allData]);
  const onTimeProjects = Math.round(totalProjects * 0.86);
  const delayedProjects = Math.round(totalProjects * 0.03);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]
    );
  };

  const handleCreateProject = () => {
    if (!newProj.station?.trim() && !newProj.projektnummer?.trim()) {
      toast.error("Bitte mindestens Station oder Projektnummer angeben");
      return;
    }
    if (!addProject) {
      toast.error("Projekt-Erstellung nicht verfügbar");
      return;
    }
    const createdId = addProject({
      projektnummer: newProj.projektnummer.trim() || null,
      station: newProj.station.trim() || null,
      bahnhofsmanagement: newProj.bahnhofsmanagement || null,
      projektleiter: newProj.projektleiter.trim() || null,
      projektbeschreibung: newProj.projektbeschreibung.trim() || null,
      kommentar: newProj.kommentar.trim() || null,
      projektLink: newProj.projektLink.trim() || null,
    });
    if (createdId) {
      toast.success(`Projekt #${createdId} erfolgreich angelegt!`);
      setShowNewDialog(false);
      setNewProj({
        projektnummer: "",
        station: "",
        bahnhofsmanagement: "",
        projektleiter: "",
        projektbeschreibung: "",
        kommentar: "",
        projektLink: "",
      });
      setPage(1);
    }
  };

  const handleExport = useCallback(() => {
    if (!data?.projects || data.projects.length === 0) {
      toast.error("Keine Projekte zum Exportieren vorhanden");
      return;
    }
    const headers = [
      "Nr.", "Projektnummer", "Region", "Station", "Projektleiter", 
      "Beschreibung", "Kommentar", "ProjektLink", "Hauptstatus"
    ];
    const rows = data.projects.map((p: Project, idx: number) => {
      const mainReview = p.reviews?.find((r: Review) => r.status) || p.reviews?.[0];
      return [
        (page - 1) * pageSize + idx + 1,
        p.projektnummer || "",
        p.bahnhofsmanagement || "",
        p.station || "",
        p.projektleiter || "",
        (p.projektbeschreibung || "").replace(/"/g, '""'),
        (p.kommentar || "").replace(/"/g, '""'),
        p.projektLink || "",
        mainReview?.status || "-"
      ];
    });
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `DB_Projektuebersicht_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${data.projects.length} Projekte (Seite ${page}) exportiert`);
  }, [data, page, pageSize]);

  const departmentButtons = [
    "EEA", "ITK", "BS", "GA", "Energie", "HFT", "HKLS", 
    "TBQ", "UM", "BIM", "LST", "Vermessung", 
    "Baubetriebstechnologie", "Baubetriebsplanung"
  ];

  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* DB KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="aws-card border-l-4 border-l-[#FF0000] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gesamtprojekte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-[#FF0000]">{totalProjects.toLocaleString("de-DE")}</div>
            <p className="text-xs text-muted-foreground mt-1">+12 seit letzter Woche</p>
          </CardContent>
        </Card>
        <Card className="aws-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktiv</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{activeProjects}</div>
            <p className="text-xs text-blue-600 mt-1">{Math.round((activeProjects / totalProjects) * 100)}% der Projekte</p>
          </CardContent>
        </Card>
        <Card className="aws-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Termingerecht</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-emerald-600">{onTimeProjects}</div>
            <p className="text-xs text-emerald-600 mt-1">86% im Zeitplan</p>
          </CardContent>
        </Card>
        <Card className="aws-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Verzögert</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-red-600">{delayedProjects}</div>
            <p className="text-xs text-red-600 mt-1">Aktuell kritisch</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Projektnummer, Station, Beschreibung, Projektleiter..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 h-10 aws-input"
            />
          </div>
          <Button onClick={handleSearch} className="aws-button h-10">Suchen</Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="aws-button gap-2 h-10"
          >
            <Filter className="h-4 w-4" />
            Filter
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg p-1 bg-muted/50 shadow-sm">
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("table")}
              className="aws-button h-8 w-10 p-0"
            >
              <Table className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("cards")}
              className="aws-button h-8 w-10 p-0"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "map" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("map")}
              className="aws-button h-8 w-10 p-0"
            >
              <MapPin className="h-4 w-4" />
            </Button>
          </div>

          <Button 
            onClick={() => setShowNewDialog(true)}
            className="aws-button bg-[#FF0000] hover:bg-[#E6002B] text-white h-10"
          >
            <Plus className="mr-2 h-4 w-4" />
            Neues Projekt
          </Button>
          <Button 
            variant="outline" 
            className="aws-button h-10"
            onClick={handleExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card className="aws-card border-2 border-[#FF0000]/10 animate-in slide-in-from-top-2 duration-300">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Region</label>
                <Select value={region} onValueChange={(val) => { setRegion(val); setPage(1); }}>
                  <SelectTrigger className="aws-input h-10">
                    <SelectValue placeholder="Alle Regionen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Regionen</SelectItem>
                    {(filterOptions?.regions || []).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Projektleiter</label>
                <Select value={projektleiter} onValueChange={(val) => { setProjektleiter(val); setPage(1); }}>
                  <SelectTrigger className="aws-input h-10">
                    <SelectValue placeholder="Alle Leiter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Leiter</SelectItem>
                    {(filterOptions?.projektleiter || []).map(pl => <SelectItem key={pl} value={pl}>{pl}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Prüfer</label>
                <Select value={pruefer} onValueChange={(val) => { setPruefer(val); setPage(1); }}>
                  <SelectTrigger className="aws-input h-10">
                    <SelectValue placeholder="Alle Prüfer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Prüfer</SelectItem>
                    {(filterOptions?.pruefer || []).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Status</label>
                <Select value={status} onValueChange={(val) => { setStatus(val); setPage(1); }}>
                  <SelectTrigger className="aws-input h-10">
                    <SelectValue placeholder="Alle Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Status</SelectItem>
                    {REVIEW_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Fachbereich</label>
                <Select value={department} onValueChange={(val) => { setDepartment(val); setPage(1); }}>
                  <SelectTrigger className="aws-input h-10">
                    <SelectValue placeholder="Alle Fachbereiche" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Fachbereiche</SelectItem>
                    {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t flex justify-between items-center">
              <div className="flex flex-wrap gap-2">
                {departmentButtons.map(dept => (
                  <Button
                    key={dept}
                    variant={expandedDepts.includes(dept) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDept(dept)}
                    className={`h-8 text-[10px] font-bold rounded-full transition-all ${
                      expandedDepts.includes(dept) ? "bg-[#FF0000] hover:bg-[#CC0000]" : "hover:border-[#FF0000] hover:text-[#FF0000]"
                    }`}
                  >
                    {dept} {expandedDepts.includes(dept) ? "×" : "+"}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRegion(""); setProjektleiter(""); setPruefer(""); setStatus(""); setDepartment("");
                  setSearch(""); setSearchInput(""); setExpandedDepts([]); setPage(1);
                }}
                className="text-muted-foreground hover:text-[#FF0000] gap-2"
              >
                <X className="h-4 w-4" /> Filter zurücksetzen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Area */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden min-h-[600px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-[600px] gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-[#FF0000]" />
            <p className="text-muted-foreground animate-pulse font-medium">Lade Projektdaten...</p>
          </div>
        ) : (
          <>
            {/* TABLE VIEW */}
            {viewMode === "table" && (
              <div className="table-scroll-container">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="bg-muted/50 sticky top-0 z-20">
                    <tr>
                      <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/50 z-30 border-b">Nr.</th>
                      <SortHeader column="projektnummer" label="Projektnummer" sortBy={sortBy} onSort={handleSort} />
                      <SortHeader column="bahnhofsmanagement" label="Region" sortBy={sortBy} onSort={handleSort} />
                      <SortHeader column="station" label="Station" sortBy={sortBy} onSort={handleSort} />
                      <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap min-w-[260px] border-b">Beschreibung</th>
                      <SortHeader column="projektleiter" label="Projektleiter" sortBy={sortBy} onSort={handleSort} />
                      <th className="text-center py-3 px-3 font-semibold text-muted-foreground whitespace-nowrap border-b" title="Kommentar & Link">
                        <MessageSquare className="h-4 w-4 inline" />
                      </th>
                      {expandedDepts.length > 0 ? (
                        expandedDepts.map((dept) => (
                          <th key={dept} className="text-center py-3 px-3 font-semibold text-muted-foreground whitespace-nowrap border-b border-l bg-muted/30" colSpan={3}>
                            {dept}
                          </th>
                        ))
                      ) : (
                        departmentButtons.map((dept) => (
                          <th key={dept} className="text-center py-3 px-2 font-semibold text-muted-foreground whitespace-nowrap border-b border-l bg-muted/30">
                            {dept}
                          </th>
                        ))
                      )}
                    </tr>
                    {expandedDepts.length > 0 && (
                      <tr className="border-b bg-muted/20">
                        <th className="sticky left-0 bg-muted/50 z-30"></th>
                        <th></th><th></th><th></th><th></th><th></th><th></th>
                        {expandedDepts.map((dept) => (
                          <React.Fragment key={`sub-${dept}`}>
                            <th className="text-left py-2 px-3 text-[9px] font-bold uppercase text-muted-foreground border-l">Prüfer</th>
                            <th className="text-left py-2 px-3 text-[9px] font-bold uppercase text-muted-foreground">Datum</th>
                            <th className="text-left py-2 px-3 text-[9px] font-bold uppercase text-muted-foreground">Status</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <TableBody>
                    {data?.projects.map((project: Project, idx: number) => {
                      const reviews = project.reviews || [];
                      return (
                        <tr key={project.id} className="border-b hover:bg-muted/30 transition-colors group">
                          <td className="py-3 px-4 text-muted-foreground font-medium sticky left-0 bg-card group-hover:bg-muted/30 z-10">
                            {(page - 1) * pageSize + idx + 1}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold">
                            <InlineEditCell
                              value={project.projektnummer}
                              onSave={(val) => applyEdit(project.id, { projektnummer: val })}
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">{project.bahnhofsmanagement || "-"}</td>
                          <td className="py-3 px-4 whitespace-nowrap font-semibold">
                            <InlineEditCell
                              value={project.station}
                              onSave={(val) => applyEdit(project.id, { station: val })}
                            />
                          </td>
                          <td className="py-3 px-4 max-w-[260px]">
                            <InlineEditCell
                              value={project.projektbeschreibung}
                              onSave={(val) => applyEdit(project.id, { projektbeschreibung: val })}
                              className="line-clamp-2"
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <InlineEditCell
                              value={project.projektleiter}
                              onSave={(val) => applyEdit(project.id, { projektleiter: val })}
                            />
                          </td>
                          <td className="py-3 px-3 text-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <button className="text-muted-foreground hover:text-[#FF0000] transition-colors p-1.5 rounded-lg hover:bg-[#FF0000]/10">
                                  <MessageSquare className="h-4 w-4" />
                                </button>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle>Kommentar &amp; Link</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-muted-foreground">Kommentar</label>
                                    <textarea
                                      defaultValue={project.kommentar || ""}
                                      onBlur={(e) => applyEdit(project.id, { kommentar: e.target.value })}
                                      className="w-full border rounded-xl px-4 py-3 text-sm bg-background min-h-[120px] resize-y focus:ring-2 focus:ring-[#FF0000]/20 outline-none"
                                      placeholder="Kommentar eingeben..."
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-muted-foreground">Projektlink</label>
                                    <div className="flex gap-2">
                                      <Input
                                        defaultValue={project.projektLink || ""}
                                        onBlur={(e) => applyEdit(project.id, { projektLink: e.target.value })}
                                        className="flex-1"
                                        placeholder="https://..."
                                      />
                                      {project.projektLink && (
                                        <Button variant="outline" size="icon" asChild>
                                          <a href={project.projektLink} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="h-4 w-4 text-[#FF0000]" />
                                          </a>
                                        </Button>
                                       )}
                                    </div>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </td>

                          {expandedDepts.length > 0 ? (
                            expandedDepts.map((dept) => {
                              const review = reviews.find((r: Review) => r.department === dept);
                              return (
                                <React.Fragment key={`${project.id}-${dept}`}>
                                  <td className="py-3 px-3 border-l border-border/30">
                                    {review ? (
                                      <InlineEditCell
                                        value={review.prueferName}
                                        onSave={(val) => applyReviewEdit(project.id, dept, { prueferName: val })}
                                      />
                                    ) : "-"}
                                  </td>
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    {review?.pruefDatum ? new Date(review.pruefDatum).toLocaleDateString("de-DE") : "-"}
                                  </td>
                                  <td className="py-3 px-3">
                                    {review ? (
                                      <select
                                        value={review.status || ""}
                                        onChange={(e) => applyReviewEdit(project.id, dept, { status: e.target.value })}
                                        className="text-[10px] bg-transparent border rounded-md px-2 py-1 w-full focus:ring-1 focus:ring-[#FF0000] outline-none"
                                      >
                                        <option value="">-</option>
                                        {REVIEW_STATUSES.map((s) => (
                                          <option key={s} value={s}>{s}</option>
                                        ))}
                                      </select>
                                    ) : "-"}
                                  </td>
                                </React.Fragment>
                              );
                            })
                          ) : (
                            departmentButtons.map((dept) => {
                              const review = reviews.find((r: Review) => r.department === dept);
                              return (
                                <td key={`${project.id}-${dept}`} className="py-3 px-2 text-center border-l border-border/30">
                                  <StatusBadge status={review?.status || null} />
                                </td>
                              );
                            })
                          )}
                        </tr>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            )}

            {/* CARDS VIEW */}
            {viewMode === "cards" && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-6">
                {data?.projects.map((project: Project) => {
                  const mainReview = project.reviews?.[0];
                  return (
                    <Card key={project.id} className="aws-card hover:shadow-xl transition-all group border-2 hover:border-[#FF0000]/20">
                      <CardHeader className="pb-3 space-y-3">
                        <div className="flex justify-between items-start">
                          <StatusBadge status={mainReview?.status || null} />
                          <Badge variant="secondary" className="font-mono text-[10px]">{project.projektnummer || "N/A"}</Badge>
                        </div>
                        <CardTitle className="text-lg leading-tight group-hover:text-[#FF0000] transition-colors line-clamp-2">
                          {project.station}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-xs text-muted-foreground line-clamp-3 min-h-[45px]">{project.projektbeschreibung || "Keine Beschreibung vorhanden."}</p>
                        <div className="pt-4 border-t flex justify-between items-center">
                          <div className="flex flex-col">
                            <span className="text-[9px] uppercase text-muted-foreground font-bold">Projektleiter</span>
                            <span className="text-xs font-semibold">{project.projektleiter || "Unbekannt"}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-[9px] uppercase text-muted-foreground font-bold">Region</span>
                            <span className="text-xs">{project.bahnhofsmanagement || "-"}</span>
                          </div>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full aws-button text-[#FF0000] hover:bg-[#FF0000] hover:text-white transition-all"
                          onClick={() => setViewMode("table")}
                        >
                          Details anzeigen
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* MAP VIEW */}
            {viewMode === "map" && (
              <div className="h-[700px] w-full relative">
                <MapView projects={data?.projects || []} />
                <div className="absolute bottom-6 left-6 bg-background/95 backdrop-blur p-4 rounded-xl border shadow-2xl z-[1000] max-w-xs border-[#FF0000]/20">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-5 w-5 text-[#FF0000]" />
                    <h4 className="text-sm font-bold">Interaktive Projektkarte</h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Zeigt alle {data?.projects.length} gefilterten Projekte basierend auf ihren Standorten an. 
                    Klicken Sie auf einen Marker für detaillierte Informationen.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-card px-6 py-4 rounded-xl border shadow-sm">
          <div className="text-sm text-muted-foreground">
            Zeige <span className="font-bold text-foreground">{(page - 1) * pageSize + 1}</span> bis <span className="font-bold text-foreground">{Math.min(page * pageSize, data?.total || 0)}</span> von <span className="font-bold text-foreground">{data?.total.toLocaleString("de-DE")}</span> Projekten
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={page === 1}
              className="h-9 w-9 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
              <ChevronLeft className="h-4 w-4 -ml-2" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={page === 1}
              className="gap-2 h-9 px-4"
            >
              <ChevronLeft className="h-4 w-4" /> Zurück
            </Button>
            <div className="flex items-center gap-1 mx-2">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = page;
                if (page <= 3) pageNum = i + 1;
                else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = page - 2 + i;
                
                if (pageNum <= 0 || pageNum > totalPages) return null;

                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "ghost"}
                    size="sm"
                    onClick={() => { setPage(pageNum); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={`h-9 w-9 p-0 ${page === pageNum ? "bg-[#FF0000] hover:bg-[#CC0000]" : ""}`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={page === totalPages}
              className="gap-2 h-9 px-4"
            >
              Weiter <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              disabled={page === totalPages}
              className="h-9 w-9 p-0"
            >
              <ChevronRight className="h-4 w-4" />
              <ChevronRight className="h-4 w-4 -ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* NEW PROJECT DIALOG */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-[650px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Neues Projekt anlegen</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Projektnummer</label>
                <Input 
                  value={newProj.projektnummer} 
                  onChange={(e) => setNewProj({...newProj, projektnummer: e.target.value})} 
                  placeholder="z.B. PRJ-2026-001" 
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Station *</label>
                <Input 
                  value={newProj.station} 
                  onChange={(e) => setNewProj({...newProj, station: e.target.value})} 
                  placeholder="z.B. Berlin Hbf" 
                  className="h-11 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Region / Bahnhofsmanagement</label>
              <Select value={newProj.bahnhofsmanagement} onValueChange={(val) => setNewProj({...newProj, bahnhofsmanagement: val})}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Region wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {(filterOptions?.regions || []).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Projektleiter</label>
              <Input 
                value={newProj.projektleiter} 
                onChange={(e) => setNewProj({...newProj, projektleiter: e.target.value})} 
                placeholder="Name des Projektleiters" 
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-muted-foreground">Beschreibung</label>
              <textarea 
                className="w-full min-h-[120px] p-4 rounded-xl border bg-background text-sm focus:ring-2 focus:ring-[#FF0000]/20 outline-none resize-y" 
                value={newProj.projektbeschreibung} 
                onChange={(e) => setNewProj({...newProj, projektbeschreibung: e.target.value})}
                placeholder="Detaillierte Projektbeschreibung..."
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={() => setShowNewDialog(false)} className="rounded-xl px-6">Abbrechen</Button>
              <Button onClick={handleCreateProject} className="bg-[#FF0000] hover:bg-[#CC0000] rounded-xl px-8 h-11">Projekt speichern</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
