import React, { useState, useCallback } from "react";
import { useProjects, useFilters, type Project, type Review } from "@/hooks/useData";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Search, ChevronLeft, ChevronRight, Filter, X, ArrowUpDown, ExternalLink, MessageSquare } from "lucide-react";
import { DEPARTMENTS, REVIEW_STATUSES } from "@shared/types";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  "nicht erforderlich": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "offen": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Projektkonfig.": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "in Bearbeitung": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Nachforderung": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "prüffähig": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  "Prüfung erfolgt": "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  "Zustimmung erteilt": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Niederschrift erstellt": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "abgelehnt": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "zurückgestellt": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "gestoppt": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const colorClass = STATUS_COLORS[status] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${colorClass}`}>
      {status}
    </span>
  );
}

function InlineEditCell({ value, onSave, className = "" }: { value: string | null; onSave: (val: string) => void; className?: string }) {
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
        className={`bg-transparent border-b border-primary/50 outline-none text-xs w-full ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => { setEditValue(value || ""); setEditing(true); }}
      className={`cursor-pointer hover:bg-accent/50 rounded px-0.5 -mx-0.5 ${className}`}
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
      className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none"
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === column && (
          <ArrowUpDown className="h-3 w-3 text-primary" />
        )}
      </span>
    </th>
  );
}

export default function Projects() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [region, setRegion] = useState<string>("");
  const [projektleiter, setProjektleiter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data, isLoading, applyEdit, applyReviewEdit } = useProjects({
    page,
    pageSize,
    search: search || undefined,
    region: region || undefined,
    projektleiter: projektleiter || undefined,
  });

  const { data: filterOptions } = useFilters();

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const toggleDept = (dept: string) => {
    setExpandedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projektübersicht</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data ? `${data.total.toLocaleString('de-DE')} Projekte` : 'Laden...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filter
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Suche nach Projektnummer, Station, Beschreibung, Projektleiter..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearch} size="sm">Suchen</Button>
            {(search || region || projektleiter) && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput(""); setRegion(""); setProjektleiter(""); setPage(1); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="mt-3 flex flex-wrap gap-3">
              <Select value={region || "all"} onValueChange={(v) => { setRegion(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Region wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Regionen</SelectItem>
                  {(filterOptions?.regions || []).map((r: string) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={projektleiter || "all"} onValueChange={(v) => { setProjektleiter(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Projektleiter wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Projektleiter</SelectItem>
                  {(filterOptions?.projektleiter || []).slice(0, 50).map((p: string) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Department Toggle Buttons */}
      <div className="flex flex-wrap gap-1.5">
        {DEPARTMENTS.map(dept => (
          <Button
            key={dept}
            variant={expandedDepts.includes(dept) ? "default" : "outline"}
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => toggleDept(dept)}
          >
            {dept}
          </Button>
        ))}
        {expandedDepts.length > 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setExpandedDepts([])}>
            Alle ausblenden
          </Button>
        )}
        {expandedDepts.length === 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setExpandedDepts([...DEPARTMENTS])}>
            Alle einblenden
          </Button>
        )}
      </div>

      {/* Data Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/50 z-10">Nr.</th>
                  <SortHeader column="projektnummer" label="Projektnummer" sortBy={sortBy} onSort={handleSort} />
                  <SortHeader column="bahnhofsmanagement" label="Region" sortBy={sortBy} onSort={handleSort} />
                  <SortHeader column="station" label="Station" sortBy={sortBy} onSort={handleSort} />
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap min-w-[200px]">Beschreibung</th>
                  <SortHeader column="projektleiter" label="Projektleiter" sortBy={sortBy} onSort={handleSort} />
                  <th className="text-center py-2.5 px-2 font-medium text-muted-foreground whitespace-nowrap" title="Kommentar & Link">
                    <MessageSquare className="h-3.5 w-3.5 inline" />
                  </th>
                  {expandedDepts.length > 0 ? (
                    expandedDepts.map(dept => (
                      <th key={dept} className="text-center py-2.5 px-2 font-medium text-muted-foreground whitespace-nowrap border-l" colSpan={3}>
                        {dept}
                      </th>
                    ))
                  ) : (
                    DEPARTMENTS.map(dept => (
                      <th key={dept} className="text-center py-2.5 px-1 font-medium text-muted-foreground whitespace-nowrap border-l">
                        <span className="text-[10px]">{dept.length > 5 ? dept.substring(0, 4) : dept}</span>
                      </th>
                    ))
                  )}
                </tr>
                {expandedDepts.length > 0 && (
                  <tr className="border-t">
                    <th className="sticky left-0 bg-muted/50 z-10"></th>
                    <th></th><th></th><th></th><th></th><th></th><th></th>
                    {expandedDepts.map(dept => (
                      <React.Fragment key={`sub-${dept}`}>
                        <th className="text-left py-1 px-2 text-[10px] font-normal text-muted-foreground border-l">Prüfer</th>
                        <th className="text-left py-1 px-2 text-[10px] font-normal text-muted-foreground">Datum</th>
                        <th className="text-left py-1 px-2 text-[10px] font-normal text-muted-foreground">Status</th>
                      </React.Fragment>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {data?.projects.map((project: Project, idx: number) => {
                  const reviews = project.reviews || [];
                  return (
                    <tr key={project.id} className="border-t hover:bg-muted/30 transition-colors group">
                      <td className="py-2 px-3 text-muted-foreground text-xs sticky left-0 bg-card group-hover:bg-muted/30 z-10">
                        {(page - 1) * pageSize + idx + 1}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">
                        <InlineEditCell
                          value={project.projektnummer}
                          onSave={(val) => { applyEdit(project.id, "projektnummer", val); toast.success("Gespeichert"); }}
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-xs">
                        {project.bahnhofsmanagement || '-'}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-xs font-medium">
                        <InlineEditCell
                          value={project.station}
                          onSave={(val) => { applyEdit(project.id, "station", val); toast.success("Gespeichert"); }}
                        />
                      </td>
                      <td className="py-2 px-3 text-xs max-w-[250px]">
                        <InlineEditCell
                          value={project.projektbeschreibung}
                          onSave={(val) => { applyEdit(project.id, "projektbeschreibung", val); toast.success("Gespeichert"); }}
                          className="truncate"
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-xs">
                        <InlineEditCell
                          value={project.projektleiter}
                          onSave={(val) => { applyEdit(project.id, "projektleiter", val); toast.success("Gespeichert"); }}
                        />
                      </td>
                      <td className="py-1 px-2 text-center">
                        <Dialog>
                          <DialogTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                              <MessageSquare className="h-3.5 w-3.5" />
                            </button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md">
                            <DialogHeader>
                              <DialogTitle className="text-sm">Kommentar & Link</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3">
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Kommentar</label>
                                <textarea
                                  defaultValue={project.kommentar || ""}
                                  onBlur={(e) => {
                                    if (e.target.value !== (project.kommentar || "")) {
                                      applyEdit(project.id, "kommentar", e.target.value);
                                      toast.success("Gespeichert");
                                    }
                                  }}
                                  className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[80px] resize-y"
                                  placeholder="Kommentar eingeben..."
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Projektlink</label>
                                <div className="flex gap-2">
                                  <input
                                    defaultValue={project.projektLink || ""}
                                    onBlur={(e) => {
                                      if (e.target.value !== (project.projektLink || "")) {
                                        applyEdit(project.id, "projektLink", e.target.value);
                                        toast.success("Gespeichert");
                                      }
                                    }}
                                    className="flex-1 border rounded px-3 py-2 text-sm bg-background"
                                    placeholder="https://..."
                                  />
                                  {project.projektLink && (
                                    <a href={project.projektLink} target="_blank" rel="noopener noreferrer" className="flex items-center px-2 text-primary hover:text-primary/80">
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </td>
                      {expandedDepts.length > 0 ? (
                        expandedDepts.map(dept => {
                          const review = reviews.find((r: Review) => r.department === dept);
                          return (
                            <React.Fragment key={`${project.id}-${dept}`}>
                              <td className="py-1 px-2 text-xs whitespace-nowrap border-l">
                                {review ? (
                                  <InlineEditCell
                                    value={review.prueferName}
                                    onSave={(val) => { applyReviewEdit(project.id, dept, "prueferName", val); toast.success("Gespeichert"); }}
                                  />
                                ) : '-'}
                              </td>
                              <td className="py-1 px-2 text-xs whitespace-nowrap">
                                {review?.pruefDatum ? new Date(review.pruefDatum).toLocaleDateString('de-DE') : '-'}
                              </td>
                              <td className="py-1 px-2">
                                {review ? (
                                  <select
                                    value={review.status || ''}
                                    onChange={(e) => {
                                      applyReviewEdit(project.id, dept, "status", e.target.value);
                                      toast.success("Gespeichert");
                                    }}
                                    className="text-[10px] bg-transparent border rounded px-1 py-0.5 w-full max-w-[130px] focus:ring-1 focus:ring-primary"
                                  >
                                    <option value="">-</option>
                                    {REVIEW_STATUSES.map(s => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        })
                      ) : (
                        DEPARTMENTS.map(dept => {
                          const review = reviews.find((r: Review) => r.department === dept);
                          return (
                            <td key={`${project.id}-${dept}`} className="py-1 px-1 text-center border-l">
                              <StatusBadge status={review?.status || null} />
                            </td>
                          );
                        })
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
            <span className="text-sm text-muted-foreground">
              Seite {page} von {totalPages} ({data?.total.toLocaleString('de-DE')} Einträge)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {totalPages > 0 && (
                <span className="text-xs text-muted-foreground px-2">
                  {page}/{totalPages}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}