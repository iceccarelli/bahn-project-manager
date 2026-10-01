/**
 * Server-authoritative Gewerk view (BVB-EEA = EEA, PSV-ITK = ITK): the SAME Project aggregate as the Projekte page,
 * filtered to one department's reviews. No separate table, no separate permissions, no separate realtime path:
 *
 *   rows       projects.list (cursor pages, department filter, table projection) → virtualized
 *   KPIs       dashboard.department (read-model counters, scoped to the caller's workspaces)
 *   edits      projects.updateReview (versioned, audited, evented, conflict UI via ConflictHost)
 *   live       collection channel + project:<id> for the rows on screen (useRowScopes)
 *   detail     the live project query (useServerProjectDetail)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineEditCell, RowActions, StatusSelect } from "@/components/workspace/table-parts";
import { ProjectDetailDialog } from "@/components/ProjectDetailDialog";
import ServerMap from "@/components/ServerMap";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import { serverApi } from "@/realtime/serverApi";
import { useRowScopes, useServerFilters, useServerProjectDetail, useServerProjects } from "@/realtime/serverProjects";
import { ServerPager } from "@/realtime/ServerPager";
import { REVIEW_STATUSES } from "@shared/types";
import { APPROVED_STATUSES, BLOCKING_STATUSES, OPEN_STATUSES, normalizeReviewStatus } from "@shared/review-status";
import type { Department } from "@shared/types";
import type { Project, Review } from "@/hooks/useDataQuery";

const ALL = "__all__";

function Kpi({ label, value, caption, tone }: { label: string; value: number | null; caption: string; tone?: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-4xl font-bold ${tone ?? ""}`}>{value === null ? "–" : value.toLocaleString("de-DE")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

export function ServerDepartmentView({ department, title, subtitle, prueferLabel }: { department: Department; title: string; subtitle: string; prueferLabel: string }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [pruefer, setPruefer] = useState("");
  const [view, setView] = useState<"table" | "map">("table");
  const [detailId, setDetailId] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 250); return () => clearTimeout(t); }, [searchInput]);

  const list = useServerProjects({ department, search: search || undefined, region: region || undefined, status: status || undefined, pruefer: pruefer || undefined, sortBy: "projektnummer", sortDir: "asc" });
  const { data: filterOptions } = useServerFilters();
  const kpi = useQuery({ queryKey: ["server", "dashboard", "department", department], queryFn: () => serverApi.dashboard.department.query({ department }), staleTime: 15_000, refetchInterval: 30_000 });
  const detail = useServerProjectDetail(detailId);

  const rows: Project[] = list.data.projects;
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualRows(scrollRef, { count: rows.length, getKey: i => rows[i]?.id ?? i });
  useRowScopes(useMemo(() => v.items.map(vi => rows[vi.index]?.id).filter((x): x is number => typeof x === "number"), [v.items, rows]));
  useEffect(() => { if (list.hasNextPage && !list.isFetchingNextPage && rows.length > 0 && v.lastIndex >= rows.length - 15) list.fetchNextPage(); }, [v.lastIndex, rows.length, list]);

  const counts = useMemo(() => {
    let open = 0, approved = 0, blocked = 0;
    for (const s of kpi.data?.byStatus ?? []) {
      const n = normalizeReviewStatus(s.status);
      if (n && (OPEN_STATUSES as readonly string[]).includes(n)) open += s.count;
      else if (n && (APPROVED_STATUSES as readonly string[]).includes(n)) approved += s.count;
      else if (n && (BLOCKING_STATUSES as readonly string[]).includes(n)) blocked += s.count;
    }
    return { open, approved, blocked };
  }, [kpi.data]);

  const reviewOf = (p: Project): Review | undefined => (p.reviews ?? []).find((r: Review) => r.department === department);

  return (
    <div className="space-y-6 p-6" data-testid="server-department-view">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`${department}-Prüfungen`} value={kpi.data?.total ?? null} caption="in Ihren Regionen" />
        <Kpi label="Offen" value={kpi.data ? counts.open : null} caption="warten auf eine Entscheidung" />
        <Kpi label="Freigegeben" value={kpi.data ? counts.approved : null} caption="Zustimmung / Niederschrift" tone="text-green-700" />
        <Kpi label="Blockiert" value={kpi.data ? counts.blocked : null} caption="abgelehnt oder gestoppt" tone="text-red-700" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input id="dept-search" aria-label={`${department}-Prüfungen durchsuchen`} placeholder="Station, Projektnummer, Projektleitung …" className="w-72" value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        <Select value={region || ALL} onValueChange={x => setRegion(x === ALL ? "" : x)}>
          <SelectTrigger className="w-44" aria-label="Region"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Alle Regionen</SelectItem>{filterOptions.regions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status || ALL} onValueChange={x => setStatus(x === ALL ? "" : x)}>
          <SelectTrigger className="w-48" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Alle Status</SelectItem>{REVIEW_STATUSES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={pruefer || ALL} onValueChange={x => setPruefer(x === ALL ? "" : x)}>
          <SelectTrigger className="w-48" aria-label={prueferLabel}><SelectValue placeholder={prueferLabel} /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Alle Prüfer</SelectItem>{filterOptions.pruefer.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
        <div role="group" aria-label="Ansicht" className="ml-auto flex gap-1">
          {(["table", "map"] as const).map(m => (
            <button key={m} type="button" aria-pressed={view === m} onClick={() => setView(m)} className={`rounded-md border px-3 py-1.5 text-sm ${view === m ? "bg-primary text-white" : "bg-card"}`}>{m === "table" ? "Tabelle" : "Karte"}</button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{list.data.total.toLocaleString("de-DE")}{list.data.totalExact === false ? "+" : ""}</span> {list.data.totalExact === false ? "geladen" : "Projekte mit einer"} {department}-Prüfung{list.data.totalExact === false ? "" : ""}
      </p>

      <div className="relative min-h-[420px] rounded-xl border bg-card shadow-sm">
        {view === "map" ? (
          <ServerMap className="relative h-[60vh] min-h-[380px] w-full" filters={{ search: search || undefined, bahnhofsmanagement: region || undefined, department, reviewStatus: status || undefined, pruefer: pruefer || undefined }} onProjectSelect={setDetailId} />
        ) : list.isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)}</div>
        ) : (
          <div ref={scrollRef} className="max-h-[70vh] overflow-auto" data-testid="projects-scroll">
            <table className="w-full border-collapse text-2xs" {...v.tableProps}>
              <thead className="sticky top-0 z-20 border-b bg-white dark:bg-zinc-950">
                <tr aria-rowindex={1}>
                  <th className="sticky left-0 z-30 w-[52px] bg-white px-3 py-3 text-left font-semibold text-muted-foreground dark:bg-zinc-950">Nr.</th>
                  <th className="sticky left-[52px] z-30 min-w-[168px] border-r bg-white px-4 py-3 text-left font-semibold text-muted-foreground dark:bg-zinc-950">Projektnummer</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Region</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Station</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">{prueferLabel}</th>
                  <th className="px-3 py-3 text-left font-semibold text-muted-foreground">Prüfdatum</th>
                  <th className="px-3 py-3 text-left font-semibold text-muted-foreground">Status</th>
                  <th className="px-3 py-3 text-center font-semibold text-muted-foreground">Aktionen</th>
                </tr>
              </thead>
              <tbody {...v.bodyProps}>
                {v.paddingTop > 0 && <tr data-spacer="" style={{ height: v.paddingTop }}><td colSpan={8} style={{ padding: 0, border: 0 }} /></tr>}
                {v.items.map(vi => {
                  const p = rows[vi.index];
                  if (!p) return null;
                  const r = reviewOf(p);
                  const who = p.projektnummer ?? p.id;
                  return (
                    <tr key={p.id} {...v.rowProps(vi.index)} className="group border-b transition-colors hover:bg-muted/30">
                      <td className="sticky left-0 z-10 bg-white px-3 py-3 font-mono text-muted-foreground dark:bg-zinc-950">{p.id}</td>
                      <td className="sticky left-[52px] z-10 border-r bg-white px-4 py-3 font-mono font-bold dark:bg-zinc-950">{p.projektnummer ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{p.bahnhofsmanagement ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">{p.station ?? "-"}</td>
                      <td className="px-4 py-3">
                        {r ? <InlineEditCell value={r.prueferName} label={`${prueferLabel} von Projekt ${who}`} onSave={val => list.applyReviewEdit(p.id, department, "prueferName" as never, val)} /> : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">{r?.pruefDatum ? new Date(r.pruefDatum).toLocaleDateString("de-DE") : "-"}</td>
                      <td className="px-3 py-3">
                        {r ? <StatusSelect status={r.status} label={`Status ${department} für Projekt ${who}`} onChange={next => list.applyReviewEdit(p.id, department, "status" as never, next)} /> : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-3 py-3"><RowActions project={p} onShowDetails={setDetailId} onEdit={(id, field, value) => list.applyEdit(id, field as never, value)} /></td>
                    </tr>
                  );
                })}
                {v.paddingBottom > 0 && <tr data-spacer="" style={{ height: v.paddingBottom }}><td colSpan={8} style={{ padding: 0, border: 0 }} /></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {view === "table" && !list.isLoading && (
        <ServerPager auto={false} loaded={rows.length} total={list.data.totalExact === false ? undefined : list.data.total} hasNextPage={list.hasNextPage} isFetching={list.isFetchingNextPage} onLoadMore={list.fetchNextPage} />
      )}

      <ProjectDetailDialog project={detail} open={detailId !== null} onOpenChange={o => { if (!o) setDetailId(null); }} onShowStation={() => {}} />
    </div>
  );
}
