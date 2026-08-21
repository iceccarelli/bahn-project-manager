import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation, useSearch as useRouteSearch } from "wouter";

import {
  TableBody,
} from "@/components/ui/table";
import { useProjects, useFilters, useAllData, useSearchSuggestions, type Project, type Review } from "@/hooks/useDataQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Table, LayoutGrid, MapPin, Filter, X, ArrowUpDown, ExternalLink, MessageSquare, Search, Loader2, Info } from "lucide-react";
import { DEPARTMENTS, REVIEW_STATUSES } from "@shared/types";
import { deriveProjectMetrics, percent } from "@shared/project-metrics";
import { statusBadgeClass } from "@shared/status-appearance";
import { toast } from "sonner";
import { MapView, type StationSelection } from "@/components/Map";
import { ProjectDetailDialog } from "@/components/ProjectDetailDialog";
import { projectLinkUrl } from "@shared/project-link";
// DB Corporate Status Colors (perfect harmony with Dashboard.tsx)

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const colorClass = statusBadgeClass(status);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-medium whitespace-nowrap ${colorClass}`}>
      {status}
    </span>
  );
}

function InlineEditCell({
  value,
  onSave,
  label,
  className = "",
}: {
  value: string | null;
  onSave: (val: string) => void;
  /** What this cell holds, e.g. "Projektstand" — used for the accessible name. */
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  if (editing) {
    return (
      <input
        aria-label={`${label} bearbeiten`}
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
        className={`bg-transparent border-b border-primary/50 outline-none text-xs w-full focus:border-primary ${className}`}
      />
    );
  }
  // A <button>, not a <span onClick>. As a span it was unreachable by keyboard,
  // invisible to assistive tech and had no focus ring — 1,298 rows x 6 editable
  // cells that only a mouse could ever open.
  return (
    <button
      type="button"
      onClick={() => {
        setEditValue(value || "");
        setEditing(true);
      }}
      aria-label={`${label} bearbeiten${value ? `, aktuell ${value}` : ", derzeit leer"}`}
      className={`-mx-1 w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {value || "-"}
    </button>
  );
}

/**
 * A removable filter chip.
 *
 * The dismiss control is a <button>, not an <X> with an onClick. The previous
 * chips rendered the icon directly with a click handler, so a keyboard user
 * could apply a filter from the panel and then had no way to remove it.
 */
function FilterChip({
  label,
  onClear,
  emphasis = false,
}: {
  label: string;
  onClear: () => void;
  emphasis?: boolean;
}) {
  return (
    <Badge
      variant={emphasis ? "default" : "secondary"}
      className="gap-1 pr-1 text-2xs font-bold"
    >
      <span className="max-w-[16rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Filter „${label}" entfernen`}
        className="rounded-full p-0.5 transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/20"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </Badge>
  );
}

interface SortHeaderProps {
  column: string;
  label: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (column: string) => void;
}

function SortHeader({ column, label, sortBy, sortDir, onSort }: SortHeaderProps) {
  const isActive = sortBy === column;
  // aria-sort on the <th> and a real <button> inside it. The whole cell used to
  // be a click handler on a non-interactive element: no keyboard access, and a
  // screen reader had no way to know the table was sorted at all.
  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className="whitespace-nowrap border-b px-4 py-3 text-left font-semibold text-muted-foreground"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 rounded transition-colors select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {label}
        <ArrowUpDown
          className={`h-3 w-3 transition-opacity ${isActive ? "text-primary-strong opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

export default function Projects() {
  /**
   * Seeded from ?q=, so the header's search box has somewhere to land and a
   * result set is linkable. Reading it during useState rather than in an effect
   * means the first render already shows the filtered set — an effect would
   * paint all 1,298 rows and then replace them.
   */
  const initialQuery = useMemo(() => {
    const raw = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    ).get("q");
    return (raw ?? "").trim();
  }, []);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const { data: searchSuggestions } = useSearchSuggestions(searchInput);
  /*
   * Removed: `mapBounds` state fed by the map's onBoundsChange and spread into
   * useProjects. The hook declares minLat/maxLat/minLng/maxLng in its parameter
   * type and never destructures or uses them, so every pan and zoom fired a
   * state update, re-rendered the page and changed nothing — while the count
   * above the map kept saying "1.298 Projekte gefunden" as the user zoomed into
   * one city. A control that appears to filter and does not is worse than no
   * control, so the wiring is gone rather than left looking functional.
   *
   * Filtering by viewport is a real feature; it needs the station geocoding the
   * map already does (buildStationGeo) to be available to the page, which is a
   * change to where that resolution lives, not a prop rename.
   */
  const [region, setRegion] = useState<string>("");
  const [projektleiter, setProjektleiter] = useState<string>("");
  const [pruefer, setPruefer] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [department, setDepartment] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [, setLocation] = useLocation();
  const routeSearch = useRouteSearch();
  const [viewMode, setViewMode] = useState<"table" | "cards" | "map">("table");
  /** Set by the map; narrows the card view to one station's exact project ids. */
  const [stationFocus, setStationFocus] = useState<StationSelection | null>(null);
  /** The card to scroll to and ring after arriving from the map. */
  const [focusProjectId, setFocusProjectId] = useState<number | null>(null);
  /** Which project the detail dialog is showing, if any. */
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);

  const { data, isLoading, applyEdit, applyReviewEdit } = useProjects({
    search: search || undefined,
    region: region || undefined,
    projektleiter: projektleiter || undefined,
    pruefer: pruefer || undefined,
    status: status || undefined,
    department: department || undefined,
    sortBy,
    sortDir,
    showAll: true,
  });

  const { data: filterOptions } = useFilters();
  const { data: allData } = useAllData();


  // KPIs derived from the 18,172 stored review rows, not from multipliers.
  // These four cards previously read Math.round(total * 0.86) and
  // Math.round(total * 0.03); both moved with the row count and with nothing
  // else. shared/project-metrics.ts is the single derivation, so this page and
  // the dashboard cannot show different answers to the same question.
  const metrics = useMemo(() => deriveProjectMetrics(allData?.projects), [allData?.projects]);
  const totalProjects = metrics.total;

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
  }, [searchInput]);

  // Live search: debounce typing so table, cards AND map filter as you type.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Searching again from the header while already on this page changes only the
  // query string; wouter keeps the component mounted, so the initial-state read
  // above never runs a second time.
  useEffect(() => {
    const q = (new URLSearchParams(routeSearch).get("q") ?? "").trim();
    if (q) {
      setSearchInput(q);
      setSearch(q);
      setStationFocus(null);
    }
  }, [routeSearch]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
  };

  // aria-pressed, because these are toggles: they add or remove a department's
  // three columns from the table and had no state exposed to assistive tech.
  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]
    );
  };


  const handleExport = useCallback(() => {
    if (!data?.projects || data.projects.length === 0) {
      toast.error("Keine Projekte zum Exportieren vorhanden");
      return;
    }
    const headers = [
      "Nr.", "Projektnummer", "Region", "Station", "Bhf-Nr.", "Strecken-Nr.",
      "Beschreibung", "Projektstand", "Projektleiter", "Termin PV",
      "Kommentar", "ProjektLink"
    ];
    const rows = data.projects.map((p: Project) => {
      return [
        p.id,
        p.projektnummer || "",
        p.bahnhofsmanagement || "",
        p.station || "",
        p.bahnhofsnummer || "",
        p.streckennummer || "",
        (p.projektbeschreibung || "").replace(/"/g, '""'),
        p.projektstand || "",
        p.projektleiter || "",
        p.terminProjektvorstellung ? new Date(p.terminProjektvorstellung).toLocaleDateString("de-DE") : "",
        (p.kommentar || "").replace(/"/g, '""'),
        p.projektLink || "",
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

  /**
   * Map -> cards.
   *
   * This used to be `setViewMode("table")` plus a toast claiming the project
   * was "in der Tabelle angezeigt" — nothing was selected, filtered or
   * scrolled to, so the toast was the only evidence anything had happened.
   *
   * Now a marker's project switches to the card view, narrows it to that
   * station's exact project ids (the map passes them, so it is an id match and
   * not a substring of the station name), scrolls the card into view and opens
   * its detail dialog.
   */
  const handleMapProjectSelect = useCallback(
    (projectId: number, station: StationSelection) => {
      setStationFocus(station);
      setViewMode("cards");
      setDetailProjectId(projectId);
      setFocusProjectId(projectId);
    },
    [],
  );

  /** The popup's "alle N Projekte" action — same filter, no dialog. */
  const handleStationSelect = useCallback((station: StationSelection) => {
    setStationFocus(station);
    setViewMode("cards");
    setFocusProjectId(null);
    setDetailProjectId(null);
  }, []);

  /**
   * "Alle Projekte dieser Station" from inside the dialog.
   *
   * Reached without a map group, so it falls back to matching the station name
   * across every loaded project — the same set the map would have grouped,
   * derived from the data rather than from the map's geometry.
   */
  const handleShowStationByName = useCallback(
    (stationName: string) => {
      const ids = (allData?.projects ?? [])
        .filter((p: Project) => (p.station ?? "").trim() === stationName.trim())
        .map((p: Project) => p.id);
      setStationFocus({ name: stationName, projectIds: ids });
      setViewMode("cards");
      setFocusProjectId(null);
    },
    [allData],
  );

  const clearStationFocus = useCallback(() => {
    setStationFocus(null);
    setFocusProjectId(null);
  }, []);

  /**
   * The cards actually rendered.
   *
   * Station focus is an id filter layered on top of whatever the search and
   * the filter panel already produced, so clearing it returns to the previous
   * result rather than to everything.
   */
  const visibleProjects = useMemo(() => {
    const list: Project[] = data?.projects ?? [];
    if (!stationFocus) return list;
    const ids = new Set(stationFocus.projectIds);
    return list.filter((p) => ids.has(p.id));
  }, [data, stationFocus]);

  const detailProject = useMemo(
    () =>
      detailProjectId == null
        ? null
        : ((allData?.projects ?? []).find((p: Project) => p.id === detailProjectId) ?? null),
    [detailProjectId, allData],
  );

  // Scroll the card the map pointed at into view once it has rendered, and
  // leave the ring on it long enough to be seen without it becoming permanent.
  //
  // visibleProjects is a deliberate re-run trigger, not a read value: on the
  // first pass the card may not exist yet (the query can still be resolving
  // when the map hands over), and querySelector would find nothing. Re-running
  // when the rendered set changes is what makes the scroll land.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (focusProjectId == null || viewMode !== "cards") return;
    const el = document.querySelector(`[data-project-card="${focusProjectId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusProjectId(null), 2600);
    return () => clearTimeout(t);
  }, [focusProjectId, viewMode, visibleProjects]);

  return (
    <div className="space-y-8 p-6 bg-background min-h-screen">
      {/* KPI cards — every figure derived in shared/project-metrics.ts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gesamtprojekte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary-strong">{totalProjects.toLocaleString("de-DE")}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.totalReviews.toLocaleString("de-DE")} Fachprüfungen
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aktiv</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{metrics.active.toLocaleString("de-DE")}</div>
            <p className="text-xs text-blue-600 mt-1">
              {percent(metrics.active, totalProjects)}% der Projekte in Bearbeitung
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Abgeschlossen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-emerald-600">
              {metrics.completed.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-emerald-600 mt-1">
              alle erforderlichen Prüfungen zugestimmt
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Blockiert</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-red-600">
              {metrics.blocked.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-red-600 mt-1">abgelehnt oder gestoppt</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto min-w-0">
          <div className="relative flex-1 min-w-[180px] sm:flex-none sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <div className="relative flex-1 sm:w-80">
              <Input
                aria-label="Projekte durchsuchen — Ort, Projektleitung oder Gewerk"
                placeholder="Ort, Projektleitung, Gewerk …"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9 h-10 "
              />
              {searchInput.length > 1 && searchSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-popover border rounded-md shadow-lg mt-1 max-h-60 overflow-auto">
                  {searchSuggestions.map((suggestion: string) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="w-full cursor-pointer px-4 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                      /* onClick, not onMouseDown — mousedown never fires from
                         Enter or Space, so this list was mouse-only. */
                      onClick={() => {
                        setSearchInput(suggestion);
                        setSearch(suggestion);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button onClick={handleSearch} className="h-10 bg-primary hover:bg-primary/90 text-white">Suchen</Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            aria-expanded={showFilters}
            aria-controls="projects-filter-panel"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2 h-10"
          >
            <Filter className="h-4 w-4" />
            Filter
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
          {/* Icon-only toggle: without an accessible name a screen reader
              announced three buttons called "button". role=group + aria-pressed
              also communicates which view is active, which the colour change
              alone could not. */}
          <div className="flex bg-muted p-1 rounded-lg" role="group" aria-label="Ansicht">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              aria-label="Tabellenansicht"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
              className="h-8 px-3"
            >
              <Table className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="sm"
              aria-label="Kachelansicht"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
              className="h-8 px-3"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant={viewMode === "map" ? "secondary" : "ghost"}
              size="sm"
              aria-label="Kartenansicht"
              aria-pressed={viewMode === "map"}
              onClick={() => setViewMode("map")}
              className="h-8 px-3"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Button onClick={() => setLocation("/anmeldung")} className="bg-primary hover:bg-primary/90 text-white gap-2 h-10">
            <Plus className="h-4 w-4" />
            Neues Projekt
          </Button>
          <Button variant="outline" onClick={handleExport} className="gap-2 h-10">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <Card id="projects-filter-panel" className="border-primary/20 shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
              <div className="space-y-2">
                <label htmlFor="filter-region" className="text-xs font-bold uppercase text-muted-foreground">Region</label>
                <Select value={region || "all"} onValueChange={(v) => setRegion(v === "all" ? "" : v)}>
                  <SelectTrigger id="filter-region" className="w-full">
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
                <label htmlFor="filter-projektleiter" className="text-xs font-bold uppercase text-muted-foreground">Projektleiter</label>
                <Select value={projektleiter || "all"} onValueChange={(v) => setProjektleiter(v === "all" ? "" : v)}>
                  <SelectTrigger id="filter-projektleiter" className="w-full">
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
                <label htmlFor="filter-pruefer" className="text-xs font-bold uppercase text-muted-foreground">Prüfer</label>
                <Select value={pruefer || "all"} onValueChange={(v) => setPruefer(v === "all" ? "" : v)}>
                  <SelectTrigger id="filter-pruefer" className="w-full">
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
                <label htmlFor="filter-status" className="text-xs font-bold uppercase text-muted-foreground">Status</label>
                <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                  <SelectTrigger id="filter-status" className="w-full">
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
                <label htmlFor="filter-gewerk" className="text-xs font-bold uppercase text-muted-foreground">Gewerk</label>
                <Select value={department || "all"} onValueChange={(v) => setDepartment(v === "all" ? "" : v)}>
                  <SelectTrigger id="filter-gewerk" className="w-full">
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
                    aria-pressed={expandedDepts.includes(dept)}
                    onClick={() => toggleDept(dept)}
                    className={`text-2xs h-7 px-3 ${expandedDepts.includes(dept) ? "bg-primary hover:bg-primary/90 text-white" : ""}`}
                  >
                    {dept} Details
                  </Button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="text-primary-strong hover:bg-primary/10" onClick={() => {
                setRegion("");
                setProjektleiter("");
                setPruefer("");
                setStatus("");
                setDepartment("");
                setSearch("");
                setSearchInput("");
                setExpandedDepts([]);
                setShowFilters(false);
              }}>Filter zurücksetzen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/*
        Results count and active filters.

        Two fixes here. The count read `data.total` unconditionally, which
        would have said "1.298 Projekte gefunden" above twelve rendered cards
        as soon as a station focus was active — the card view now reports what
        it is actually showing. And each chip's dismiss control was a bare
        <X> SVG with an onClick: not focusable, not in the tab order, no role,
        so five filters could be applied by keyboard and none removed.
      */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {(viewMode === "cards" ? visibleProjects.length : data.total).toLocaleString("de-DE")}
            </span>{" "}
            {(viewMode === "cards" ? visibleProjects.length : data.total) === 1
              ? "Projekt"
              : "Projekte"}{" "}
            gefunden
            {stationFocus && viewMode === "cards" && (
              <span className="ml-1">von {data.total.toLocaleString("de-DE")} gefilterten</span>
            )}
          </span>
          {search && <span>für &quot;{search}&quot;</span>}

          {stationFocus && (
            <FilterChip
              label={`Station: ${stationFocus.name}`}
              onClear={clearStationFocus}
              emphasis
            />
          )}
          {region && <FilterChip label={region} onClear={() => setRegion("")} />}
          {projektleiter && <FilterChip label={projektleiter} onClear={() => setProjektleiter("")} />}
          {pruefer && <FilterChip label={pruefer} onClear={() => setPruefer("")} />}
          {status && <FilterChip label={status} onClear={() => setStatus("")} />}
          {department && <FilterChip label={department} onClear={() => setDepartment("")} />}
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-card rounded-xl border shadow-sm relative min-h-[600px]">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm z-10 rounded-xl">
            <Loader2 className="h-10 w-10 animate-spin text-primary-strong" />
            <p className="text-muted-foreground animate-pulse font-medium ml-3">Lade Projektdaten...</p>
          </div>
        ) : (
          <>
            {/* TABLE VIEW */}
            {viewMode === "table" && (
              <div className="overflow-x-auto overflow-y-auto max-h-[75vh]">
                <table className="w-full border-collapse text-2xs">
                  <thead className="bg-white dark:bg-zinc-950 sticky top-0 z-20 border-b">
                    <tr>
                      <th className="text-left py-3 px-3 font-semibold text-muted-foreground whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-950 z-30 border-b min-w-[50px]">Nr.</th>
                      <SortHeader column="projektnummer" label="Projektnummer" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader column="bahnhofsmanagement" label="Region" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader column="station" label="Station" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader column="bahnhofsnummer" label="Bhf-Nr." sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader column="streckennummer" label="Strecken-Nr." sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <th className="text-left py-3 px-4 font-semibold text-muted-foreground whitespace-nowrap min-w-[220px] border-b">Beschreibung</th>
                      <SortHeader column="projektstand" label="Projektstand" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <SortHeader column="projektleiter" label="Projektleiter" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                      <th className="text-left py-3 px-3 font-semibold text-muted-foreground whitespace-nowrap border-b min-w-[100px]">Termin PV</th>
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
                        <th className="sticky left-0 bg-white dark:bg-zinc-950 z-30" />
                        <th /><th /><th /><th /><th /><th /><th /><th /><th /><th />
                        {expandedDepts.map((dept) => (
                          <React.Fragment key={`sub-${dept}`}>
                            <th className="text-left py-2 px-3 text-2xs font-bold uppercase text-muted-foreground border-l">Prüfer</th>
                            <th className="text-left py-2 px-3 text-2xs font-bold uppercase text-muted-foreground">Datum</th>
                            <th className="text-left py-2 px-3 text-2xs font-bold uppercase text-muted-foreground">Status</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <TableBody>
                    {data?.projects.map((project: Project) => {
                      const reviews = project.reviews || [];
                      return (
                        <tr key={project.id} className="border-b hover:bg-muted/30 transition-colors group">
                          <td className="py-3 px-3 text-muted-foreground font-medium sticky left-0 bg-white dark:bg-zinc-950 z-10 border-r font-mono">
                            {project.id}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                            <InlineEditCell
                              value={project.projektnummer}
                              label={`Projektnummer von Projekt ${project.id}`}
                              onSave={(val) => applyEdit(project.id, "projektnummer", val)}
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">{project.bahnhofsmanagement || "-"}</td>
                          <td className="py-3 px-4 whitespace-nowrap font-semibold">
                            <InlineEditCell
                              value={project.station}
                              label={`Station von Projekt ${project.projektnummer ?? project.id}`}
                              onSave={(val) => applyEdit(project.id, "station", val)}
                            />
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground">
                            {project.bahnhofsnummer || "-"}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground">
                            {project.streckennummer || "-"}
                          </td>
                          <td className="py-3 px-4 max-w-[220px]">
                            <InlineEditCell
                              value={project.projektbeschreibung}
                              label={`Projektbeschreibung von Projekt ${project.projektnummer ?? project.id}`}
                              onSave={(val) => applyEdit(project.id, "projektbeschreibung", val)}
                              className="line-clamp-2"
                            />
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <InlineEditCell
                              value={project.projektstand}
                              label={`Projektstand von Projekt ${project.projektnummer ?? project.id}`}
                              onSave={(val) => applyEdit(project.id, "projektstand", val)}
                            />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <InlineEditCell
                              value={project.projektleiter}
                              label={`Projektleitung von Projekt ${project.projektnummer ?? project.id}`}
                              onSave={(val) => applyEdit(project.id, "projektleiter", val)}
                            />
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-2xs">
                            {project.terminProjektvorstellung
                              ? new Date(project.terminProjektvorstellung).toLocaleDateString("de-DE")
                              : "-"}
                          </td>
                          <td className="min-w-[104px] px-3 py-3">
                            {/* A flex row, not two inline buttons: the two 44px
                                touch targets need to be laid out side by side
                                with a gap, and `text-center` on the cell let
                                them wrap instead. */}
                            <div className="cell-actions flex items-center justify-center gap-1">
                            {/* Details reachable from the table too, so the
                                three views expose the same action rather than
                                the card grid being the only way in. */}
                            <button
                              type="button"
                              aria-label={`Details zu Projekt ${project.projektnummer ?? project.id} anzeigen`}
                              title="Details anzeigen"
                              onClick={() => setDetailProjectId(project.id)}
                              className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              <Info className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <Dialog>
                              <DialogTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Kommentar und Link zu Projekt ${project.projektnummer ?? project.id}`}
                                  className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </DialogTrigger>
                              <DialogContent className="max-w-md bg-card">
                                <DialogHeader>
                                  <DialogTitle>Kommentar &amp; Link</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <label
                                      htmlFor={`kommentar-${project.id}`}
                                      className="text-xs font-bold uppercase text-muted-foreground"
                                    >
                                      Kommentar
                                    </label>
                                    <textarea
                                      id={`kommentar-${project.id}`}
                                      defaultValue={project.kommentar || ""}
                                      onBlur={(e) => applyEdit(project.id, "kommentar", e.target.value)}
                                      className="w-full border rounded-xl px-4 py-3 text-sm bg-background min-h-[120px] resize-y focus:ring-2 focus:ring-primary/20 outline-none"
                                      placeholder="Kommentar eingeben …"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label
                                      htmlFor={`projektlink-${project.id}`}
                                      className="text-xs font-bold uppercase text-muted-foreground"
                                    >
                                      Projektlink
                                    </label>
                                    <div className="flex gap-2">
                                      <Input
                                        id={`projektlink-${project.id}`}
                                        defaultValue={project.projektLink || ""}
                                        onBlur={(e) => applyEdit(project.id, "projektLink", e.target.value)}
                                        className="flex-1"
                                        placeholder="https://..."
                                      />
                                      {/* Only when it parses as a URL — see
                                          shared/project-link.ts. And an
                                          icon-only link needs a name. */}
                                      {projectLinkUrl(project.projektLink) && (
                                        <Button variant="outline" size="icon" asChild>
                                          <a
                                            href={projectLinkUrl(project.projektLink) as string}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`Projektlink von ${project.projektnummer ?? project.id} in neuem Tab öffnen`}
                                          >
                                            <ExternalLink className="h-4 w-4 text-primary-strong" aria-hidden="true" />
                                          </a>
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
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
                                        label={`Prüfer ${dept} für Projekt ${project.projektnummer ?? project.id}`}
                                        onSave={(val) => applyReviewEdit(project.id, dept, "prueferName", val)}
                                      />
                                    ) : <span className="text-muted-foreground">-</span>}
                                  </td>
                                  <td className="py-3 px-3 whitespace-nowrap text-2xs">
                                    {review?.pruefDatum ? new Date(review.pruefDatum).toLocaleDateString("de-DE") : "-"}
                                  </td>
                                  <td className="py-3 px-3">
                                    {review ? (
                                      /* The only unlabeled form control in the
                                         app — and it writes. A screen reader
                                         announced "offen, combo box" with no
                                         way to know which Gewerk or project it
                                         belonged to, once per project per
                                         department. */
                                      <select
                                        aria-label={`Status ${dept} für Projekt ${project.projektnummer ?? project.id}`}
                                        value={review.status || ""}
                                        onChange={(e) => applyReviewEdit(project.id, dept, "status", e.target.value)}
                                        className="text-2xs bg-transparent border rounded-md px-2 py-1 w-full focus:ring-1 focus:ring-primary outline-none"
                                      >
                                        <option value="">-</option>
                                        {REVIEW_STATUSES.map((s) => (
                                          <option key={s} value={s}>{s}</option>
                                        ))}
                                      </select>
                                    ) : <span className="text-muted-foreground">-</span>}
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
                {visibleProjects.map((project: Project) => {
                  const mainReview = project.reviews?.find((r: Review) => r.status && r.status !== "nicht erforderlich") || project.reviews?.[0];
                  return (
                    <Card
                      key={project.id}
                      data-project-card={project.id}
                      className={`group border-2 transition-all hover:border-primary/20 hover:shadow-xl ${
                        focusProjectId === project.id
                          ? "border-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
                          : ""
                      }`}
                    >
                      <CardHeader className="pb-3 space-y-3">
                        <div className="flex justify-between items-start">
                          <StatusBadge status={mainReview?.status || null} />
                          <Badge variant="secondary" className="font-mono text-2xs">{project.projektnummer || "N/A"}</Badge>
                        </div>
                        <CardTitle className="text-lg leading-tight group-hover:text-primary-strong transition-colors line-clamp-2">
                          {project.station}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-xs text-muted-foreground line-clamp-3 min-h-[45px]">{project.projektbeschreibung || "Keine Beschreibung vorhanden."}</p>
                        {project.projektstand && (
                          <div className="flex items-center gap-2">
                            <span className="text-2xs uppercase text-muted-foreground font-bold">Stand:</span>
                            <span className="text-xs">{project.projektstand}</span>
                          </div>
                        )}
                        <div className="pt-4 border-t flex justify-between items-center">
                          <div className="flex flex-col">
                            <span className="text-2xs uppercase text-muted-foreground font-bold">Projektleiter</span>
                            <span className="text-xs font-semibold">{project.projektleiter || "Unbekannt"}</span>
                          </div>
                          <div className="flex flex-col text-right">
                            <span className="text-2xs uppercase text-muted-foreground font-bold">Region</span>
                            <span className="text-xs">{project.bahnhofsmanagement || "-"}</span>
                          </div>
                        </div>
                        {/* Was `onClick={() => setViewMode("table")}` — a button
                            labelled "Details anzeigen" that showed no details
                            and did not even select the row it switched to. */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-primary-strong transition-all hover:bg-primary hover:text-white"
                          aria-label={`Details zu Projekt ${project.projektnummer ?? project.id} anzeigen`}
                          onClick={() => setDetailProjectId(project.id)}
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
              /*
                There used to be an "Interaktive Projektkarte" card here,
                positioned `absolute bottom-6 left-6` — but outside the map,
                so it anchored to this page's positioned ancestor rather than
                to the map, and landed on top of the map's own legend: a
                measured 36,252 px² overlap at every viewport from 375 px to
                1440 px, hiding 41 % of the legend. It also claimed to show
                "alle N gefilterten Projekte" while the map itself reports how
                many of those have no station and no BM and cannot be drawn.
                The map's Netz-Explorer card carries the honest counts, so the
                duplicate is gone rather than merely moved.

                Height is now viewport-relative: 600 px of fixed map on a
                667 px-tall phone left no page around it.
              */
              <MapView
                projects={data?.projects || []}
                initialCenter={{ lat: 51.1657, lng: 10.4515 }}
                initialZoom={6}
                className="h-[65vh] min-h-[380px] sm:h-[560px] lg:h-[600px] w-full relative"
                onProjectSelect={handleMapProjectSelect}
                onStationSelect={handleStationSelect}
              />
            )}
          </>
        )}
      </div>

      <ProjectDetailDialog
        project={detailProject}
        open={detailProjectId !== null}
        onOpenChange={(o) => {
          if (!o) setDetailProjectId(null);
        }}
        onShowStation={handleShowStationByName}
      />
    </div>
  );
}
