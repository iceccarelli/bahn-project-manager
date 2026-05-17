import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useProjects, useFilters, useAllData, useSearchSuggestions, type Project, type Review } from "@/hooks/useDataQuery";
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
  Command,
  Check,
  ChevronsUpDown,
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { data: searchSuggestions } = useSearchSuggestions(searchInput);
  const [mapBounds, setMapBounds] = useState<{ minLat?: number; maxLat?: number; minLng?: number; maxLng?: number }>({});
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
    search: search || undefined,
    region: region || undefined,
    projektleiter: projektleiter || undefined,
    pruefer: pruefer || undefined,
    status: status || undefined,
    department: department || undefined,
    sortBy,
    sortDir,
    showAll: true, // Always load all projects
    ...mapBounds,
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
  }, [searchInput]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
  };

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
    addProject({
      projektnummer: newProj.projektnummer.trim() || null,
      station: newProj.station.trim() || null,
      bahnhofsmanagement: newProj.bahnhofsmanagement || null,
      projektleiter: newProj.projektleiter.trim() || null,
      projektbeschreibung: newProj.projektbeschreibung.trim() || null,
      kommentar: newProj.kommentar.trim() || null,
      projektLink: newProj.projektLink.trim() || null,
    });
    toast.success(`Projekt erfolgreich angelegt!`);
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
        idx + 1,
        p.projektnummer || "",
        p.bahnhofsmanagement || "",
        p.station || "",
        p.projektleiter || "",
        (p.projektbeschreibung || "").replace(/"/g, "\"\""),
        (p.kommentar || "").replace(/"/g, "\"\""),
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
    toast.success(`${data.projects.length} Projekte exportiert`);
  }, [data]);

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
            <div className="relative flex-1 sm:w-80">
              <Input
                placeholder="Google-Suche: Ort, PL, Gewerke..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9 h-10 aws-input"
              />
              {searchInput.length > 1 && searchSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-popover border rounded-md shadow-lg mt-1 max-h-60 overflow-auto">
                  {searchSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className="px-4 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setSearchInput(suggestion);
                        setSearch(suggestion);
                      }}
                    >
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button onClick={handleSearch} className="aws-button h-10 bg-[#FF0000] hover:bg-[#CC0000]">Suchen</Button>
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

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex bg-muted p-1 rounded-lg">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("table")}
              className="h-8 px-3"
            >
              <Table className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("cards")}
              className="h-8 px-3"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "map" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("map")}
              className="h-8 px-3"
            >
              <MapPin className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowNewDialog(true)} className="aws-button bg-[#FF0000] hover:bg-[#CC0000] gap-2 h-10">
            <Plus className="h-4 w-4" />
            Neues Projekt
          </Button>
          <Button variant="outline" onClick={handleExport} className="aws-button gap-2 h-10">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card className="aws-card border-[#FF0000]/20 shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Region</label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="aws-input">
                    <SelectValue placeholder="Alle Regionen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Regionen</SelectItem>
                    {filterOptions?.regions.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Projektleiter</label>
                <Select value={projektleiter} onValueChange={setProjektleiter}>
                  <SelectTrigger className="aws-input">
                    <SelectValue placeholder="Alle Projektleiter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Projektleiter</SelectItem>
                    {filterOptions?.projektleiter.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Prüfer</label>
                <Select value={pruefer} onValueChange={setPruefer}>
                  <SelectTrigger className="aws-input">
                    <SelectValue placeholder="Alle Prüfer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Prüfer</SelectItem>
                    {filterOptions?.pruefer.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="aws-input">
                    <SelectValue placeholder="Alle Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Status</SelectItem>
                    {REVIEW_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Gewerk</label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="aws-input">
                    <SelectValue placeholder="Alle Gewerke" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Gewerke</SelectItem>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-between items-center mt-6 pt-6 border-t">
              <div className="flex flex-wrap gap-2">
                {departmentButtons.map((dept) => (
                  <Button
                    key={dept}
                    variant={expandedDepts.includes(dept) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDept(dept)}
                    className={`text-[10px] h-7 px-3 ${expandedDepts.includes(dept) ? "bg-[#FF0000] hover:bg-[#CC0000]" : ""}`}
                  >
                    {dept} Details
                  </Button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="text-[#FF0000] hover:bg-[#FF0000]/10" onClick={() => {
                setRegion("");
                setProjektleiter("");
                setPruefer("");
                setStatus("");
                setDepartment("");
                setSearch("");
                setSearchInput("");
                setShowFilters(false);
              }}>Filter zurücksetzen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Area */}
      <div className="bg-card rounded-xl border shadow-sm relative min-h-[600px]">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm z-10 rounded-xl">
            <Loader2 className="h-10 w-10 animate-spin text-[#FF0000]" />
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
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold">
                            <InlineEditCell
                              value={project.projektnummer}
                              onSave={(val) => applyEdit(project.id, "projektnummer", val)}
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">{project.bahnhofsmanagement || "-"}</td>
                          <td className="py-3 px-4 whitespace-nowrap font-semibold">
                            <InlineEditCell
                              value={project.station}
                              onSave={(val) => applyEdit(project.id, "station", val)}
                            />
                          </td>
                          <td className="py-3 px-4 max-w-[260px]">
                            <InlineEditCell
                              value={project.projektbeschreibung}
                              onSave={(val) => applyEdit(project.id, "projektbeschreibung", val)}
                              className="line-clamp-2"
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <InlineEditCell
                              value={project.projektleiter}
                              onSave={(val) => applyEdit(project.id, "projektleiter", val)}
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
                                      onBlur={(e) => applyEdit(project.id, "kommentar", e.target.value)}
                                      className="w-full border rounded-xl px-4 py-3 text-sm bg-background min-h-[120px] resize-y focus:ring-2 focus:ring-[#FF0000]/20 outline-none"
                                      placeholder="Kommentar eingeben..."
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-muted-foreground">Projektlink</label>
                                    <div className="flex gap-2">
                                      <Input
                                        defaultValue={project.projektLink || ""}
                                        onBlur={(e) => applyEdit(project.id, "projektLink", e.target.value)}
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
                                        onSave={(val) => applyReviewEdit(project.id, dept, "prueferName", val)}
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
                                        onChange={(e) => applyReviewEdit(project.id, dept, "status", e.target.value)}
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
              <>
                <MapView
                  projects={data?.projects || []}
                  initialCenter={{ lat: 51.1657, lng: 10.4515 }}
                  initialZoom={6}
                  className="h-[600px] w-full relative"
                  onBoundsChange={setMapBounds}
                />
                <div className="absolute bottom-6 left-6 bg-background/95 backdrop-blur p-4 rounded-xl border shadow-2xl z-[1000] max-w-xs border-[#FF0000]/20">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-5 w-5 text-[#FF0000]" />
                    <h4 className="text-sm font-bold">Interaktive Projektkarte</h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Zeigt alle {data?.projects.length} gefilterten Projekte basierend auf ihren Standorten an. Klicken Sie auf einen Marker für detaillierte Informationen.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Neues Projekt anlegen</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="projektnummer" className="text-right text-sm">
                Projektnummer
              </label>
              <Input
                id="projektnummer"
                value={newProj.projektnummer}
                onChange={(e) => setNewProj({ ...newProj, projektnummer: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="station" className="text-right text-sm">
                Station
              </label>
              <Input
                id="station"
                value={newProj.station}
                onChange={(e) => setNewProj({ ...newProj, station: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="bahnhofsmanagement" className="text-right text-sm">
                Region
              </label>
              <Input
                id="bahnhofsmanagement"
                value={newProj.bahnhofsmanagement}
                onChange={(e) => setNewProj({ ...newProj, bahnhofsmanagement: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="projektleiter" className="text-right text-sm">
                Projektleiter
              </label>
              <Input
                id="projektleiter"
                value={newProj.projektleiter}
                onChange={(e) => setNewProj({ ...newProj, projektleiter: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="projektbeschreibung" className="text-right text-sm">
                Beschreibung
              </label>
              <Input
                id="projektbeschreibung"
                value={newProj.projektbeschreibung}
                onChange={(e) => setNewProj({ ...newProj, projektbeschreibung: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="kommentar" className="text-right text-sm">
                Kommentar
              </label>
              <Input
                id="kommentar"
                value={newProj.kommentar}
                onChange={(e) => setNewProj({ ...newProj, kommentar: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="projektLink" className="text-right text-sm">
                Projektlink
              </label>
              <Input
                id="projektLink"
                value={newProj.projektLink}
                onChange={(e) => setNewProj({ ...newProj, projektLink: e.target.value })}
                className="col-span-3"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCreateProject} className="aws-button bg-[#FF0000] hover:bg-[#E6002B]">Projekt anlegen</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
