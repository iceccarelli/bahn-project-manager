/**
 * The full Projekte surface, scoped to one Gewerk.
 *
 * /bvb-eea and /psv-itk were read-only tables: eight columns, no KPIs, no
 * search, no filters, no card view, no map, and no way to open a project. The
 * Projekte page had all of it. Two pages that show the same records with a
 * different filter should not be two different products, so this is one
 * implementation and the two routes are ten-line wrappers around it — the same
 * arrangement DepartmentReviewTable introduced, extended to the whole surface
 * rather than just the table.
 *
 * What "scoped to one Gewerk" means precisely: a project appears when it has a
 * review row for this department whose status normalises to something other
 * than "nicht erforderlich". Every count, filter, card, marker and export on
 * the page is derived from that same set, so the KPI row and the result count
 * cannot disagree — which is the failure mode this project has spent its time
 * removing everywhere else.
 *
 * Detail lives in ProjectDetailDialog, unchanged: the same dialog the Projekte
 * page opens, with the same contact routes, the same Projektblatt export and
 * the same audit recording. A second detail view would be a second thing to
 * keep true.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch as useRouteSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Download,
  Filter,
  Info,
  LayoutGrid,
  Loader2,
  MapPin,
  Plus,
  Search,
  Table as TableIcon,
  X,
} from "lucide-react";
import { useAllData, type Project, type Review } from "@/hooks/useDataQuery";
import { MapView, type StationSelection } from "@/components/Map";
import { ProjectDetailDialog } from "@/components/ProjectDetailDialog";
import { useAuditTrail } from "@/hooks/useAuditTrail";
import { statusBadgeClass } from "@shared/status-appearance";
import {
  APPROVED_STATUSES,
  BLOCKING_STATUSES,
  OPEN_STATUSES,
  normalizeReviewStatus,
} from "@shared/review-status";
import { formatGerman } from "@shared/date";
import { documentFilename } from "@shared/generated-stamp";
import type { Department } from "@shared/types";

interface ReviewWorkspaceProps {
  department: Department;
  title: string;
  /** What the list actually contains — not what a reader might hope it does. */
  subtitle: string;
  /** Column header for this Gewerk's reviewer. */
  prueferLabel: string;
}

/** A project plus the one review this page is about. Paired once, used everywhere. */
interface Entry {
  project: Project;
  review: Review;
  status: string | null;
}

const TH = "whitespace-nowrap border-b px-3 py-3 text-left font-semibold text-muted-foreground";

function KpiCard({
  label,
  value,
  caption,
  accent,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  accent?: boolean;
  tone?: string;
}) {
  return (
    <Card className={accent ? "border-l-4 border-l-primary shadow-sm" : "shadow-sm"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-4xl font-bold tabular-nums ${tone ?? ""}`}>
          {value.toLocaleString("de-DE")}
        </div>
        <p className={`mt-1 text-xs ${tone ?? "text-muted-foreground"}`}>{caption}</p>
      </CardContent>
    </Card>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1 text-2xs font-bold">
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

export function ReviewWorkspace({
  department,
  title,
  subtitle,
  prueferLabel,
}: ReviewWorkspaceProps) {
  const { data, isLoading, isError } = useAllData();
  const [, setLocation] = useLocation();
  const routeSearch = useRouteSearch();
  const { recordDocument } = useAuditTrail();

  // Seeded from ?q= for the same reason the Projekte page is: the header search
  // and every deep link have to land somewhere, and a result set has to survive
  // a reload.
  const initialQuery = useMemo(() => {
    const raw = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    ).get("q");
    return (raw ?? "").trim();
  }, []);

  const [searchInput, setSearchInput] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [pruefer, setPruefer] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards" | "map">("table");
  const [stationFocus, setStationFocus] = useState<StationSelection | null>(null);
  const [focusProjectId, setFocusProjectId] = useState<number | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const q = (new URLSearchParams(routeSearch).get("q") ?? "").trim();
    if (q) {
      setSearchInput(q);
      setSearch(q);
      setStationFocus(null);
    }
  }, [routeSearch]);

  /**
   * Every project with a real review for this Gewerk.
   *
   * Normalised before it is compared: ITK stores 3 rows as
   * "Projektkonfiguration" against 51 as "Projektkonfig.", and 80 TBQ rows
   * carry a parenthesised annotation. Matching the raw string drops them.
   */
  const scoped: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const project of data?.projects ?? []) {
      const review = (project.reviews ?? []).find((r) => r.department === department);
      if (!review) continue;
      const s = normalizeReviewStatus(review.status);
      if (s === null || s === "nicht erforderlich") continue;
      out.push({ project, review, status: s });
    }
    return out;
  }, [data, department]);

  /** The vocabularies the filter offers, derived from what is actually here. */
  const filterOptions = useMemo(() => {
    const regions = new Set<string>();
    const statuses = new Set<string>();
    const pruefers = new Set<string>();
    for (const e of scoped) {
      const r = (e.project.bahnhofsmanagement ?? "").trim();
      if (r) regions.add(r);
      if (e.status) statuses.add(e.status);
      const p = (e.review.prueferName ?? "").trim();
      if (p) pruefers.add(p);
    }
    const de = (a: string, b: string) => a.localeCompare(b, "de");
    return {
      regions: [...regions].sort(de),
      statuses: [...statuses].sort(de),
      pruefers: [...pruefers].sort(de),
    };
  }, [scoped]);

  const filtered = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return scoped.filter(({ project, review, status: s }) => {
      if (region && project.bahnhofsmanagement !== region) return false;
      if (status && s !== status) return false;
      if (pruefer && (review.prueferName ?? "") !== pruefer) return false;
      if (terms.length === 0) return true;
      const haystack = [
        project.projektnummer,
        project.station,
        project.projektbeschreibung,
        project.projektleiter,
        project.bahnhofsmanagement,
        project.projektstand,
        project.bahnhofsnummer,
        project.streckennummer,
        review.prueferName,
        s,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return terms.every((t) => haystack.includes(t));
    });
  }, [scoped, search, region, status, pruefer]);

  /** Station focus is an id filter layered on top of the rest. */
  const visible = useMemo(() => {
    if (!stationFocus) return filtered;
    const ids = new Set(stationFocus.projectIds);
    return filtered.filter((e) => ids.has(e.project.id));
  }, [filtered, stationFocus]);

  const kpis = useMemo(() => {
    let open = 0;
    let done = 0;
    let blocked = 0;
    for (const e of scoped) {
      if (!e.status) continue;
      if ((OPEN_STATUSES as readonly string[]).includes(e.status)) open++;
      else if ((APPROVED_STATUSES as readonly string[]).includes(e.status)) done++;
      else if ((BLOCKING_STATUSES as readonly string[]).includes(e.status)) blocked++;
    }
    return { total: scoped.length, open, done, blocked };
  }, [scoped]);

  const detailProject = useMemo(
    () =>
      detailProjectId == null
        ? null
        : ((data?.projects ?? []).find((p) => p.id === detailProjectId) ?? null),
    [detailProjectId, data],
  );

  const handleMapProjectSelect = useCallback((projectId: number, station: StationSelection) => {
    setStationFocus(station);
    setViewMode("cards");
    setDetailProjectId(projectId);
    setFocusProjectId(projectId);
  }, []);

  const handleStationSelect = useCallback((station: StationSelection) => {
    setStationFocus(station);
    setViewMode("cards");
    setFocusProjectId(null);
    setDetailProjectId(null);
  }, []);

  const handleShowStationByName = useCallback(
    (stationName: string) => {
      const ids = scoped
        .filter((e) => (e.project.station ?? "").trim() === stationName.trim())
        .map((e) => e.project.id);
      setStationFocus({ name: stationName, projectIds: ids });
      setViewMode("cards");
      setFocusProjectId(null);
    },
    [scoped],
  );

  // Scroll the card the map pointed at into view once it has rendered, and
  // leave the ring on it long enough to be seen without it becoming permanent.
  //
  // `visible` is a deliberate re-run trigger, not a read value: on the first
  // pass the card may not exist yet — the query can still be resolving when the
  // map hands over — and querySelector would find nothing. Re-running when the
  // rendered set changes is what makes the scroll land. The biome-ignore has to
  // be the line immediately above the hook or it attaches to a comment instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (focusProjectId == null || viewMode !== "cards") return;
    const el = document.querySelector(`[data-project-card="${focusProjectId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusProjectId(null), 2600);
    return () => clearTimeout(t);
  }, [focusProjectId, viewMode, visible]);

  const handleExport = useCallback(() => {
    if (visible.length === 0) return;
    const headers = [
      "Projektnummer", "Region", "Station", "Bhf-Nr.", "Strecken-Nr.",
      "Beschreibung", "Projektstand", "Projektleiter",
      `${department}-Status`, `${department}-Prüfer`, `${department}-Prüfdatum`,
    ];
    const rows = visible.map(({ project, review, status: s }) => [
      project.projektnummer ?? "",
      project.bahnhofsmanagement ?? "",
      project.station ?? "",
      project.bahnhofsnummer ?? "",
      project.streckennummer ?? "",
      (project.projektbeschreibung ?? "").replace(/"/g, '""'),
      project.projektstand ?? "",
      project.projektleiter ?? "",
      s ?? review.status ?? "",
      review.prueferName ?? "",
      formatGerman(review.pruefDatum) || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const name = documentFilename(`DB_${department}_Pruefungen`, [], new Date(), "csv");
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = name;
    link.click();
    URL.revokeObjectURL(objectUrl);
    recordDocument(`${department}-Export`, name, `${visible.length} Einträge`);
  }, [visible, department, recordDocument]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary-strong" aria-hidden="true" />
          <p className="text-lg font-medium text-muted-foreground">Lade {title}…</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background p-6">
        <Card className="max-w-md border-2 border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-bold">Projektdaten konnten nicht geladen werden</h2>
            <p className="text-sm text-muted-foreground">
              Die Datenquelle hat keine Projekte geliefert. Bitte die Seite neu laden — bleibt es
              dabei, fehlt <code className="font-mono">/data.json</code> oder der lokale Speicher
              ist leer.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const anyFilter = Boolean(search || region || status || pruefer || stationFocus);

  return (
    <div className="min-h-screen space-y-8 bg-background p-6">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="mt-2 text-muted-foreground">
          {subtitle} &bull; {kpis.total.toLocaleString("de-DE")}{" "}
          {kpis.total === 1 ? "Eintrag" : "Einträge"} von{" "}
          {data.projects.length.toLocaleString("de-DE")} Projekten
        </p>
      </div>

      {/* The same four-card row the Projekte page uses, counted over this
          Gewerk's rows only. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        <KpiCard
          accent
          label={`${department}-Prüfungen`}
          value={kpis.total}
          caption={`von ${data.projects.length.toLocaleString("de-DE")} Projekten`}
        />
        <KpiCard
          label="Offen"
          value={kpis.open}
          caption="warten auf eine Entscheidung"
          tone="text-amber-700 dark:text-amber-500"
        />
        <KpiCard
          label="Zugestimmt"
          value={kpis.done}
          caption="Zustimmung erteilt oder Niederschrift"
          tone="text-emerald-700 dark:text-emerald-400"
        />
        <KpiCard
          label="Blockiert"
          value={kpis.blocked}
          caption="abgelehnt oder gestoppt"
          tone="text-primary-strong"
        />
      </div>

      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={`${title} durchsuchen`}
              placeholder="Ort, Projektleitung, Prüfer …"
              className="h-10 pl-9"
            />
          </div>
          <Button
            onClick={() => setSearch(searchInput)}
            className="h-10 bg-primary text-white hover:bg-primary/90"
          >
            Suchen
          </Button>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            aria-expanded={showFilters}
            aria-controls={`${department}-filter-panel`}
            onClick={() => setShowFilters((v) => !v)}
            className="h-10 gap-2"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filter
          </Button>

          <div className="ml-auto flex items-center gap-1 rounded-lg bg-muted p-1">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              aria-label="Tabellenansicht"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
              className="h-8 px-3"
            >
              <TableIcon className="h-4 w-4" aria-hidden="true" />
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

          <Button
            onClick={() => setLocation("/anmeldung")}
            className="h-10 gap-2 bg-primary text-white hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Neues Projekt
          </Button>
          <Button variant="outline" onClick={handleExport} className="h-10 gap-2">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </CardContent>
      </Card>

      {showFilters && (
        <Card id={`${department}-filter-panel`} className="border-primary/20 shadow-md">
          <CardContent className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3">
            <div className="space-y-2">
              <label
                htmlFor={`${department}-region`}
                className="text-xs font-bold uppercase text-muted-foreground"
              >
                Region
              </label>
              <Select value={region || "all"} onValueChange={(v) => setRegion(v === "all" ? "" : v)}>
                <SelectTrigger id={`${department}-region`}>
                  <SelectValue placeholder="Alle Regionen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Regionen</SelectItem>
                  {filterOptions.regions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor={`${department}-status`}
                className="text-xs font-bold uppercase text-muted-foreground"
              >
                Status
              </label>
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger id={`${department}-status`}>
                  <SelectValue placeholder="Alle Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Status</SelectItem>
                  {filterOptions.statuses.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor={`${department}-pruefer`}
                className="text-xs font-bold uppercase text-muted-foreground"
              >
                {prueferLabel}
              </label>
              <Select
                value={pruefer || "all"}
                onValueChange={(v) => setPruefer(v === "all" ? "" : v)}
              >
                <SelectTrigger id={`${department}-pruefer`}>
                  <SelectValue placeholder={`Alle ${prueferLabel}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle {prueferLabel}</SelectItem>
                  {filterOptions.pruefers.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The count reports what is on screen, and every active filter is
          visible and removable — including the one the map sets. */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">
            {visible.length.toLocaleString("de-DE")}
          </span>{" "}
          {visible.length === 1 ? "Eintrag" : "Einträge"} gefunden
          {anyFilter && visible.length !== kpis.total
            ? ` von ${kpis.total.toLocaleString("de-DE")}`
            : ""}
        </span>
        {search && <FilterChip label={`Suche: ${search}`} onClear={() => { setSearch(""); setSearchInput(""); }} />}
        {stationFocus && (
          <FilterChip
            label={`Station: ${stationFocus.name}`}
            onClear={() => {
              setStationFocus(null);
              setFocusProjectId(null);
            }}
          />
        )}
        {region && <FilterChip label={region} onClear={() => setRegion("")} />}
        {status && <FilterChip label={status} onClear={() => setStatus("")} />}
        {pruefer && <FilterChip label={pruefer} onClear={() => setPruefer("")} />}
      </div>

      <Card className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="p-12 text-center text-muted-foreground">
              Kein Eintrag entspricht den aktuellen Filtern.
            </p>
          ) : viewMode === "table" ? (
            <div className="max-h-[75vh] overflow-x-auto overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <caption className="sr-only">
                  {title} – {visible.length} Einträge mit Prüfer, Prüfdatum und Status
                </caption>
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr>
                    <th scope="col" className={TH}>Projektnummer</th>
                    <th scope="col" className={TH}>Region</th>
                    <th scope="col" className={TH}>Station</th>
                    <th scope="col" className={TH}>Beschreibung</th>
                    <th scope="col" className={TH}>Projektleiter</th>
                    <th scope="col" className={TH}>{prueferLabel}</th>
                    <th scope="col" className={TH}>Prüfdatum</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>
                      <span className="sr-only">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ project, review, status: s }) => (
                    <tr key={project.id} className="border-b transition-colors hover:bg-muted/30">
                      <td className="max-w-[13rem] break-words px-3 py-3 font-mono text-xs font-medium">
                        {project.projektnummer || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        {project.bahnhofsmanagement || "—"}
                      </td>
                      <td className="max-w-[14rem] break-words px-3 py-3 text-xs font-medium">
                        {project.station || "—"}
                      </td>
                      <td className="max-w-[20rem] px-3 py-3 text-xs">
                        <span className="line-clamp-2">{project.projektbeschreibung || "—"}</span>
                      </td>
                      <td className="max-w-[12rem] break-words px-3 py-3 text-xs">
                        {project.projektleiter || "—"}
                      </td>
                      <td className="max-w-[11rem] break-words px-3 py-3 text-xs">
                        {review.prueferName || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                        {formatGerman(review.pruefDatum) || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-2xs font-medium ${statusBadgeClass(s)}`}
                        >
                          {s ?? review.status ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="cell-actions flex items-center justify-center">
                          <button
                            type="button"
                            aria-label={`Details zu Projekt ${project.projektnummer ?? project.id} anzeigen`}
                            title="Details anzeigen"
                            onClick={() => setDetailProjectId(project.id)}
                            className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <Info className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : viewMode === "cards" ? (
            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map(({ project, review, status: s }) => (
                <Card
                  key={project.id}
                  data-project-card={project.id}
                  className={`group flex h-full flex-col border-2 transition-all hover:border-primary/20 hover:shadow-xl ${
                    focusProjectId === project.id
                      ? "border-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
                      : ""
                  }`}
                >
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-2xs font-medium leading-tight ${statusBadgeClass(s)}`}
                      >
                        {s ?? review.status ?? "—"}
                      </span>
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
                        {prueferLabel}:
                      </span>
                      <span className="truncate text-xs" title={review.prueferName ?? undefined}>
                        {review.prueferName || "—"}
                      </span>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-3 border-t pt-4">
                      <div className="flex min-w-0 flex-col">
                        <span className="text-2xs font-bold uppercase text-muted-foreground">
                          Prüfdatum
                        </span>
                        <span className="truncate text-xs font-semibold tabular-nums">
                          {formatGerman(review.pruefDatum) || "—"}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-col text-right">
                        <span className="text-2xs font-bold uppercase text-muted-foreground">
                          Region
                        </span>
                        <span className="truncate text-xs">
                          {project.bahnhofsmanagement || "—"}
                        </span>
                      </div>
                    </div>
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
              ))}
            </div>
          ) : (
            <MapView
              projects={visible.map((e) => e.project)}
              initialCenter={{ lat: 51.1657, lng: 10.4515 }}
              initialZoom={6}
              className="relative h-[65vh] min-h-[380px] w-full sm:h-[560px] lg:h-[600px]"
              onProjectSelect={handleMapProjectSelect}
              onStationSelect={handleStationSelect}
            />
          )}
        </CardContent>
      </Card>

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

export default ReviewWorkspace;
