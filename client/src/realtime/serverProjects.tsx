/**
 * Server-backed replacements for the local project hooks. Same return shapes as
 * the hooks in hooks/useDataQuery.ts so the Projekte page keeps its UI, but the
 * data path is:
 *
 *   server (cursor pages, filters, search)  →  React Query (infinite pages)
 *   ProjectSyncEngine mirrors the versions  →  realtime events patch the cache
 *
 * No localStorage, no data.json, no showAll, no whole-dataset download.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BAHNHOFSMANAGEMENT } from "@shared/bahnhofsmanagement";
import { scope } from "@shared/domain-events";
import type { ProjectDetail, ProjectListItem } from "@shared/project-contract";
import { PROJECT_SORTS } from "@shared/project-contract";
import { deriveProjectMetrics, type ProjectMetrics } from "@shared/project-metrics";
import type { Filters, Project, Review } from "@/hooks/useDataQuery";
import { serverApi } from "./serverApi";
import ConflictDialog from "./ConflictDialog";
import { serverKeys, useProjectEditor, useRt } from "./RealtimeProvider";

/** server row → the shape the existing Projekte components render */
export function toLegacyProject(p: ProjectListItem | ProjectDetail): Project & { syncVersion: number } {
  const reviews: Review[] = (p.reviews ?? []).map(r => ({
    id: r.id, department: r.department, status: r.status, prueferName: r.prueferName, pruefDatum: r.datum,
  })) as Review[];
  return {
    id: p.id,
    syncVersion: p.version,
    projektnummer: p.projektnummer,
    bahnhofsmanagement: p.bahnhofsmanagement,
    station: p.station,
    bahnhofsnummer: p.bahnhofsnummer ?? null,
    streckennummer: p.streckennummer ?? null,
    projektbeschreibung: p.projektbeschreibung ?? null,
    projektstand: p.projektstand,
    projektleiter: p.projektleiter,
    terminProjektvorstellung: p.terminProjektvorstellung,
    kommentar: p.kommentar ?? null,
    projektLink: p.projektLink ?? null,
    reviews,
  };
}

export interface ServerProjectsParams {
  search?: string; region?: string; projektleiter?: string; pruefer?: string; status?: string;
  department?: string; sortBy?: string; sortDir?: "asc" | "desc";
}

const PAGE = 100;

export function useServerProjects(params: ServerProjectsParams) {
  const { engine, retain } = useRt();
  const editor = useProjectEditor();
  const sort = (PROJECT_SORTS as readonly string[]).includes(params.sortBy ?? "") ? (params.sortBy as (typeof PROJECT_SORTS)[number]) : "id";
  const input = useMemo(() => ({
    limit: PAGE,
    sort,
    dir: params.sortDir ?? "desc",
    ...(params.search ? { search: params.search } : {}),
    ...(params.region ? { bahnhofsmanagement: params.region } : {}),
    ...(params.projektleiter ? { projektleiter: params.projektleiter } : {}),
    ...(params.pruefer ? { pruefer: params.pruefer } : {}),
    ...(params.department ? { department: params.department } : {}),
    ...(params.status ? { reviewStatus: params.status } : {}),
    expand: ["reviews", "details"] as ("reviews" | "details")[],
    includeTotal: true,
  }), [sort, params.sortDir, params.search, params.region, params.projektleiter, params.pruefer, params.department, params.status]);

  // Realtime: every workspace channel; the server authorizes each one and reports denials.
  useEffect(() => retain(BAHNHOFSMANAGEMENT.map(w => scope.workspace(w))), [retain]);

  const q = useInfiniteQuery({
    queryKey: [...serverKeys.lists(), input],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await serverApi.projects.list.query({ ...input, ...(pageParam ? { cursor: pageParam } : {}) });
      // Cursor captured BEFORE this snapshot: anything after it reaches us live or via catch-up.
      engine.initCursor(page.feedHead);
      for (const item of page.items) engine.seed({ ...item, reviews: item.reviews ?? [] } as unknown as ProjectDetail, { silent: true });
      return page;
    },
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: Infinity, // realtime + catch-up keep it fresh; create/move-in invalidate it
  });

  const projects = useMemo(
    () => (q.data?.pages.flatMap(p => p.items) ?? []).map(toLegacyProject),
    [q.data],
  );

  const applyEdit = useCallback(async (id: number, field: string, value: unknown) => {
    await editor.edit(id, { [field]: value === "" ? null : (value as string | null) } as never);
  }, [editor]);

  const applyReviewEdit = useCallback(async (projectId: number, department: string, field: string, value: unknown) => {
    const map: Record<string, "prueferName" | "status" | "datum"> = { prueferName: "prueferName", status: "status", pruefDatum: "datum" };
    const target = map[field];
    if (!target) throw new Error(`Feld ${field} nicht bearbeitbar`);
    // versioned + evented like every project edit: every open client updates without refetch
    await editor.editReview(projectId, department, { [target]: (value as string | null) === "" ? null : ((value as string | null) ?? null) });
  }, [editor]);

  return {
    data: { projects, total: q.data?.pages[0]?.total ?? projects.length },
    isLoading: q.isLoading,
    isFetchingNextPage: q.isFetchingNextPage,
    hasNextPage: !!q.hasNextPage,
    fetchNextPage: () => { void q.fetchNextPage(); },
    applyEdit: applyEdit as unknown as (id: number, field: never, value: string) => Promise<void>,
    applyReviewEdit: applyReviewEdit as unknown as (id: number, dept: string, field: never, value: string) => Promise<void>,
    addProject: () => { throw new Error("Projekt anlegen: siehe Projektanmeldung (Servermodus: noch nicht angebunden)"); },
  };
}

export function useServerFilters() {
  const q = useQuery({ queryKey: ["server", "filters"], queryFn: () => serverApi.filters.options.query(), staleTime: 60_000 });
  const data: Filters = q.data ? { regions: q.data.regions, projektleiter: q.data.projektleiter, pruefer: q.data.pruefer } : { regions: [], projektleiter: [], pruefer: [] };
  return { data, isLoading: q.isLoading, isError: q.isError };
}

export function useServerMetrics(): { metrics: ProjectMetrics; isLoading: boolean } {
  const q = useQuery({ queryKey: ["server", "metrics"], queryFn: () => serverApi.dashboard.metrics.query(), staleTime: 30_000, refetchInterval: 60_000 });
  return { metrics: (q.data as ProjectMetrics | undefined) ?? deriveProjectMetrics([]), isLoading: q.isLoading };
}

/** Detail (with reviews) for the open dialog: a live project subscription while it is open. */
export function useServerProjectDetail(id: number | null) {
  const { engine, retain } = useRt();
  useEffect(() => (id === null ? undefined : retain([scope.project(id)])), [retain, id]);
  const q = useQuery({
    queryKey: serverKeys.project(id ?? 0),
    enabled: id !== null,
    queryFn: async () => {
      const p = (await serverApi.projects.get.query({ id: id! })) as ProjectDetail;
      engine.seed(p);
      return engine.get(id!) ?? p;
    },
    staleTime: Infinity,
  });
  return q.data ? toLegacyProject(q.data) : null;
}

/** Mounted once under the provider: renders the structured conflict UI for whichever edit conflicted. */
export function ConflictHost() {
  const editor = useProjectEditor();
  return <ConflictDialog conflict={editor.conflict?.conflict ?? null} onTakeServer={editor.takeServer} onRebase={() => { void editor.rebase(); }} />;
}
