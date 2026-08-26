import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useReveal } from "@/hooks/useReveal";
import { useLocation, useSearch as useRouteSearch } from "wouter";

import {
  TableBody,
} from "@/components/ui/table";
import { useProjects, useFilters, useAllData, type Project, type Review } from "@/hooks/useDataQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Table, LayoutGrid, MapPin, Filter, X, MessageSquare, Loader2 } from "lucide-react";
import { DEPARTMENTS, REVIEW_STATUSES } from "@shared/types";
import { deriveProjectMetrics, percent } from "@shared/project-metrics";
import { statusBadgeClass, statusPulseClass } from "@shared/status-appearance";
import {
  bedarfFor,
  countBedarf,
  countTones,
  projectMatchesBedarf,
  projectMatchesTone,
  toneFor,
  type BedarfKey,
} from "@shared/handlungsbedarf";
import type { StatusTone } from "@shared/status-appearance";
import { toast } from "sonner";
import { MapView, type StationSelection } from "@/components/Map";
import { ProjectDetailDialog } from "@/components/ProjectDetailDialog";
import { documentFilename } from "@shared/generated-stamp";
import { useAuditTrail } from "@/hooks/useAuditTrail";
import { useTableStream } from "@/hooks/useTableStream";
import { FilterSearch } from "@/components/workspace/FilterSearch";
import {
  InlineEditCell,
  RowActions,
  SortHeader,
  StatusSelect,
} from "@/components/workspace/table-parts";
// DB Corporate Status Colors (perfect harmony with Dashboard.tsx)

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const colorClass = statusBadgeClass(status);
  return (
    /* `min-w-0` and a truncating child: `whitespace-nowrap` alone made this
       badge an unshrinkable flex item, so it and the Projektnummer beside it
       pushed each other out of the card. */
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-2xs font-medium leading-tight ${colorClass} ${statusPulseClass(status)}`}
    >
      {status}
    </span>
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
  /*
   * Two link-in filters, both addressed the same way station focus already is:
   * an id set layered over whatever the search and the filter panel produced.
   *
   *   ?bedarf=overdue   the Dashboard's "Prüftermin überschritten" badge
   *   ?projekt=42       one row of a reviewer's timeline
   *
   * The predicate behind `bedarf` is shared/handlungsbedarf.ts — the same
   * function that produced the number on the badge. A page that recomputed
   * "overdue" itself would drift from that badge the first time either side
   * learned about a status, and a link that lands on a different set than the
   * number promised is worse than no link at all.
   */
  const [bedarfFocus, setBedarfFocus] = useState<BedarfKey | null>(null);
  const [projectFocus, setProjectFocus] = useState<number | null>(null);
  /** ?tone=pending — a slice of the Dashboard's status donut. */
  const [toneFocus, setToneFocus] = useState<StatusTone | null>(null);
  /** ?gewerk=GA — set when the slice came from one Gewerk's own donut. */
  const [toneGewerk, setToneGewerk] = useState<string | null>(null);
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
  const { recordDocument } = useAuditTrail();
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
  /* The wave through the 1.298 rows. Decoration only — every row is in the DOM
     and countable from the first paint; see client/src/lib/motion.ts. */
  const streamRef = useTableStream();
  /* The page arrives a section at a time; keyed on the view so switching
     between table, cards and map plays the cascade for the new one. */
  const revealRef = useReveal(viewMode);

  /* Local midnight, pinned once: the same boundary the Dashboard's badge used,
     so the set here and the count there cannot disagree by a few hours. */
  const todayMidnight = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);


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
    const params = new URLSearchParams(routeSearch);
    const view = params.get("view");
    if (view === "map" || view === "cards" || view === "table") setViewMode(view);
    const q = (params.get("q") ?? "").trim();
    if (q) {
      setSearchInput(q);
      setSearch(q);
      setStationFocus(null);
    }

    // `bedarfFor` rejects anything that did not come from us, so a hand-typed
    // ?bedarf=überfällig shows everything rather than an empty page blamed on
    // the data.
    const bedarf = bedarfFor(params.get("bedarf"));
    setBedarfFocus(bedarf ? bedarf.key : null);

    const tone = toneFor(params.get("tone"));
    setToneFocus(tone);
    const gewerk = (params.get("gewerk") ?? "").trim();
    setToneGewerk(tone && gewerk ? gewerk : null);

    /*
     * ?station=<Name>&projekte=1,2,3 — a station group from a map marker.
     *
     * The ids are what makes this exact: the page cannot re-derive the group,
     * because the grouping lives in the map's buildStationGeo and folds
     * ambiguous and region-fallback matches together. Ids that are not
     * integers are dropped rather than guessed at, and a link with no usable
     * id at all is treated as no station link — never as "show everything".
     */
    const stationName = (params.get("station") ?? "").trim();
    const stationIds = (params.get("projekte") ?? "")
      .split(",")
      .map((raw) => Number(raw.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (stationName && stationIds.length > 0) {
      setStationFocus({ name: stationName, projectIds: stationIds });
      setSearchInput("");
      setSearch("");
    }

    const projektRaw = params.get("projekt");
    const projekt = projektRaw === null ? Number.NaN : Number(projektRaw);
    setProjectFocus(Number.isInteger(projekt) && projekt > 0 ? projekt : null);

    // Arriving with either focus clears the leftover text search: the reader
    // asked for a set, not for that set intersected with whatever was typed
    // here twenty minutes ago.
    if (bedarf || tone || Number.isInteger(projekt)) {
      if (!(stationName && stationIds.length > 0)) setStationFocus(null);
      if (!q) {
        setSearchInput("");
        setSearch("");
      }
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
    // Date AND time, from the same stamp every PDF uses: two exports on one
    // day were two files with the same name, and the second replaced the first.
    const exportName = documentFilename("DB_Projektuebersicht", [], new Date(), "csv");
    link.download = exportName;
    link.click();
    URL.revokeObjectURL(url);
    recordDocument("CSV-Export", exportName, `${data.projects.length} Projekte`);
    toast.success(`${data.projects.length} Projekte exportiert`);
  }, [data, recordDocument]);

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
    let list: Project[] = data?.projects ?? [];
    if (stationFocus) {
      const ids = new Set(stationFocus.projectIds);
      list = list.filter((p) => ids.has(p.id));
    }
    if (projectFocus !== null) {
      list = list.filter((p) => p.id === projectFocus);
    }
    if (bedarfFocus) {
      // `todayMidnight` is pinned per render so 1,298 calls cannot straddle a
      // date boundary and disagree with each other about "overdue".
      list = list.filter((p) => projectMatchesBedarf(p, bedarfFocus, todayMidnight));
    }
    if (toneFocus) {
      // The Gewerk is passed INTO the predicate, not applied as a second
      // filter: "a project with an open row and a GA row" is a much larger set
      // than "a project with an open GA row", and only the second is what the
      // slice counted.
      list = list.filter((p) => projectMatchesTone(p, toneFocus, toneGewerk ?? undefined));
    }
    return list;
  }, [data, stationFocus, projectFocus, bedarfFocus, toneFocus, toneGewerk, todayMidnight]);

  /** The same reconciliation the Handlungsbedarf chip prints, for a slice. */
  const toneSummary = useMemo(() => {
    if (!toneFocus) return null;
    const counted = countTones(allData?.projects ?? [], toneGewerk ?? undefined);
    return counted.find((c) => c.tone === toneFocus) ?? null;
  }, [toneFocus, toneGewerk, allData]);

  /**
   * The reconciliation the chip prints.
   *
   * The badge that sent the reader here counted PRÜFZEILEN — 558 of them. This
   * page can only list PROJEKTE, and those 558 rows sit in 258 of them. Both
   * numbers are right and they are not the same number, so the chip states
   * both rather than leaving somebody to notice the gap and quietly stop
   * trusting the screen.
   */
  const bedarfSummary = useMemo(() => {
    if (!bedarfFocus) return null;
    return (
      countBedarf(allData?.projects ?? [], todayMidnight).find((c) => c.key === bedarfFocus) ?? null
    );
  }, [bedarfFocus, allData, todayMidnight]);

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
    <div ref={revealRef} className="space-y-8 p-6 bg-background min-h-screen">
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
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              {percent(metrics.active, totalProjects)}% der Projekte in Bearbeitung
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Abgeschlossen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-emerald-700 dark:text-emerald-400">
              {metrics.completed.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              alle erforderlichen Prüfungen zugestimmt
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Blockiert</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-red-600 dark:text-red-400">
              {metrics.blocked.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">abgelehnt oder gestoppt</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto min-w-0">
          <div className="relative flex-1 min-w-[180px] sm:flex-none sm:w-80">
            {/* Was a bespoke input with its own suggestion list, fed by an
                endpoint that matched raw substrings and returned whichever ten
                rows came first in file order. Same control, same index and the
                same German folding as the header palette now. */}
            <FilterSearch
              id="projects-search"
              value={searchInput}
              onChange={setSearchInput}
              onSubmit={setSearch}
              ariaLabel="Projekte durchsuchen — Ort, Projektleitung oder Gewerk"
              placeholder="Ort, Projektleitung, Gewerk …"
            />
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
          {bedarfSummary && (
            <FilterChip
              label={`${bedarfSummary.label}: ${bedarfSummary.rows.toLocaleString("de-DE")} Prüfzeilen in ${bedarfSummary.projects.toLocaleString("de-DE")} Projekten`}
              onClear={() => {
                setBedarfFocus(null);
                setLocation("/projects?view=cards");
              }}
              emphasis
            />
          )}
          {toneSummary && (
            <FilterChip
              label={`${toneGewerk ? `${toneGewerk} · ` : ""}${toneSummary.label}: ${toneSummary.rows.toLocaleString("de-DE")} Prüfzeilen in ${toneSummary.projects.toLocaleString("de-DE")} Projekten`}
              onClear={() => {
                setToneFocus(null);
                setToneGewerk(null);
                setLocation("/projects?view=cards");
              }}
              emphasis
            />
          )}
          {projectFocus !== null && (
            <FilterChip
              label={`Projekt #${projectFocus}`}
              onClear={() => {
                setProjectFocus(null);
                setLocation("/projects?view=cards");
              }}
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
                      <th className="sticky left-0 z-30 w-[52px] min-w-[52px] whitespace-nowrap border-b bg-white px-3 py-3 text-left font-semibold text-muted-foreground dark:bg-zinc-950">Nr.</th>
                      {/* The row's identity pins to the left. With 14 Gewerk
                          columns to the right, scrolling to reach one took the
                          Projektnummer off screen and left a wall of statuses
                          belonging to nothing a reader could name. */}
                      <SortHeader
                        column="projektnummer"
                        label="Projektnummer"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                        className="sticky left-[52px] z-30 w-[168px] min-w-[168px] border-r bg-white dark:bg-zinc-950"
                      />
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
                        <th className="sticky left-0 z-30 bg-white dark:bg-zinc-950" />
                        <th className="sticky left-[52px] z-30 border-r bg-white dark:bg-zinc-950" />
                        <th /><th /><th /><th /><th /><th /><th /><th /><th />
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
                  <TableBody ref={streamRef}>
                    {data?.projects.map((project: Project) => {
                      const reviews = project.reviews || [];
                      return (
                        <tr key={project.id} className="border-b hover:bg-muted/30 transition-colors group">
                          <td className="sticky left-0 z-10 w-[52px] min-w-[52px] bg-white px-3 py-3 font-mono font-medium text-muted-foreground dark:bg-zinc-950">
                            {project.id}
                          </td>
                          <td className="sticky left-[52px] z-10 w-[168px] min-w-[168px] max-w-[168px] break-words border-r bg-white px-4 py-3 font-mono font-bold dark:bg-zinc-950">
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
                            <RowActions
                              project={project}
                              onShowDetails={setDetailProjectId}
                              onEdit={applyEdit}
                            />
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
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 whitespace-nowrap text-2xs">
                                    {review?.pruefDatum ? new Date(review.pruefDatum).toLocaleDateString("de-DE") : "-"}
                                  </td>
                                  <td className="py-3 px-3">
                                    {review ? (
                                      <StatusSelect
                                        status={review.status}
                                        label={`Status ${dept} für Projekt ${project.projektnummer ?? project.id}`}
                                        onChange={(next) =>
                                          applyReviewEdit(project.id, dept, "status", next)
                                        }
                                      />
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                </React.Fragment>
                              );
                            })
                          ) : (
                            departmentButtons.map((dept) => {
                              const review = reviews.find((r: Review) => r.department === dept);
                              return (
                                <td key={`${project.id}-${dept}`} className="border-l border-border/30 px-2 py-3 text-center">
                                  {/*
                                    Was a read-only badge. Fourteen columns of
                                    the one value a Prüfer opens this table to
                                    change, and no way to change it without
                                    first expanding the Gewerk.
                                  */}
                                  {review ? (
                                    <StatusSelect
                                      status={review.status}
                                      label={`Status ${dept} für Projekt ${project.projektnummer ?? project.id}`}
                                      onChange={(next) =>
                                        applyReviewEdit(project.id, dept, "status", next)
                                      }
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
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
                    /*
                      Four layout defects lived in this card, all visible in one
                      screenshot of the grid:
                    
                      1. `flex justify-between` over two `whitespace-nowrap`
                         badges with no `min-w-0`. A 76-character Projektnummer
                         cannot shrink, so the row grew past the card and the
                         Projektnummer was clipped mid-string at the border —
                         measured as a 1,863px² overlap with the status badge
                         and 1,526px² with the neighbouring card.
                      2. No `h-full`, so a card whose Station wraps to two lines
                         is taller than the one beside it and "Details anzeigen"
                         sits at a different height in every column. The grid
                         stretches the items; the card has to fill that height
                         and push its footer down with `mt-auto`.
                      3. `line-clamp-3 min-h-[45px]` — a 3-line clamp on a
                         2-line box, so a long description overflowed the
                         reserved space and shifted everything below it.
                      4. `text-right` on the Region column while Projektleiter
                         is left-aligned: a two-line name pushed "REGION" off
                         its own baseline. Two equal grid columns hold both.
                    */
                    <Card
                      key={project.id}
                      data-project-card={project.id}
                      className={`group flex h-full flex-col border-2 transition-all hover:border-primary/20 hover:shadow-xl ${
                        focusProjectId === project.id
                          ? "border-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
                          : ""
                      }`}
                    >
                      {/*
                        Status and Projektnummer on separate rows.
                      
                        Side by side they were two unshrinkable pills in one
                        230px row: as a flex row they overflowed the card, and
                        once both were allowed to shrink they split the width
                        evenly and BOTH became unreadable — "Zustimmun…" next to
                        "G.011800063.01.…". A Projektnummer is an identifier;
                        half of one is worth nothing. Stacked, the status keeps
                        its full label and the number wraps in full.
                      */}
                      <CardHeader className="space-y-2 pb-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <StatusBadge status={mainReview?.status || null} />
                        </div>
                        <p className="break-all font-mono text-2xs leading-tight text-muted-foreground">
                          {project.projektnummer || "ohne Projektnummer"}
                        </p>
                        <CardTitle className="line-clamp-2 min-h-[2.75rem] text-lg leading-tight transition-colors group-hover:text-primary-strong">
                          {project.station || "Ohne Station"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col gap-4">
                        <p className="line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted-foreground">
                          {project.projektbeschreibung || "Keine Beschreibung vorhanden."}
                        </p>
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-2xs font-bold uppercase text-muted-foreground">
                            Stand:
                          </span>
                          <span className="truncate text-xs" title={project.projektstand ?? undefined}>
                            {project.projektstand || "—"}
                          </span>
                        </div>
                        <div className="mt-auto grid grid-cols-2 gap-3 border-t pt-4">
                          <div className="flex min-w-0 flex-col">
                            <span className="text-2xs font-bold uppercase text-muted-foreground">Projektleiter</span>
                            <span
                              className="line-clamp-2 text-xs font-semibold leading-tight"
                              title={project.projektleiter ?? undefined}
                            >
                              {project.projektleiter || "Unbekannt"}
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-col text-right">
                            <span className="text-2xs font-bold uppercase text-muted-foreground">Region</span>
                            <span
                              className="line-clamp-2 text-xs leading-tight"
                              title={project.bahnhofsmanagement ?? undefined}
                            >
                              {project.bahnhofsmanagement || "—"}
                            </span>
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
