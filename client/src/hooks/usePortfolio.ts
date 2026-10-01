/**
 * Data plane of the Dashboard. One shape — `PortfolioView` — whichever build runs:
 *   server build: `dashboard.portfolio` (derived and authorized on the server, cached per scope)
 *   demo build:   the same pure derivation (shared/portfolio-view.ts) over the browser-local rows
 * SERVER_MODE is a build-time constant, so exactly one branch of hooks exists in a given artifact.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PortfolioView, ReelView } from "@shared/portfolio-contract";
import { buildPortfolio, buildReelView } from "@shared/portfolio-view";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { useServerProjectDetail } from "@/realtime/serverProjects";
import { useAllProjects, useAuditLog, type Project } from "@/hooks/useDataQuery";

interface Result<T> { data: T | undefined; isLoading: boolean; isError: boolean }

function useServerPortfolio(): Result<PortfolioView> {
  const q = useQuery({ queryKey: ["server", "portfolio"], queryFn: () => serverApi.dashboard.portfolio.query() as Promise<PortfolioView>, staleTime: 30_000, refetchInterval: 60_000 });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError };
}

function useLocalPortfolio(): Result<PortfolioView> {
  const q = useAllProjects();
  const projects = q.data?.projects;
  const data = useMemo(() => (projects && projects.length ? buildPortfolio(projects, Date.now()) : undefined), [projects]);
  return { data, isLoading: q.isLoading, isError: q.isError || (!q.isLoading && !data) };
}

export const usePortfolio: () => Result<PortfolioView> = SERVER_MODE ? useServerPortfolio : useLocalPortfolio;

function useServerReel(department: string | null): Result<ReelView> {
  const q = useQuery({ queryKey: ["server", "reel", department], enabled: department !== null, queryFn: () => serverApi.dashboard.reel.query({ department: department! }) as Promise<ReelView>, staleTime: 60_000 });
  return { data: q.data, isLoading: q.isLoading, isError: q.isError };
}

function useLocalReel(department: string | null): Result<ReelView> {
  const projects = useAllProjects().data?.projects;
  const audit = useAuditLog().data;
  const data = useMemo(() => (department && projects ? buildReelView(projects, department, audit ?? []) : undefined), [department, projects, audit]);
  return { data, isLoading: false, isError: false };
}

/** The reel of one Gewerk, built on demand (hover/focus), never for all fourteen on mount. */
export const useReel: (department: string | null) => Result<ReelView> = SERVER_MODE ? useServerReel : useLocalReel;

function useServerDialogProject(id: number | null): Project | null {
  return useServerProjectDetail(id) as unknown as Project | null;
}
function useLocalDialogProject(id: number | null): Project | null {
  const projects = useAllProjects().data?.projects;
  return useMemo(() => (id === null ? null : projects?.find(p => p.id === id) ?? null), [id, projects]);
}
/** The project behind a clicked row: a live server subscription, or a lookup in the demo's local rows. */
export const useProjectForDialog: (id: number | null) => Project | null = SERVER_MODE ? useServerDialogProject : useLocalDialogProject;

const NONE: Project[] = [];
function useNoMapRows(): Project[] { return NONE; }
function useLocalRows(): Project[] { return useAllProjects().data?.projects ?? NONE; }
/** Rows for the demo build's client-side map. The server build never loads rows for the map (ServerMap queries bbox/zoom). */
export const useLocalMapRows: () => Project[] = SERVER_MODE ? useNoMapRows : useLocalRows;

/**
 * The reconciliation numbers a drill-down chip prints ("N Prüfzeilen in M Projekten"), from the SAME server figures the
 * Dashboard showed (one cached computation per scope), only fetched while a drill is active. The demo build computes them
 * from its local rows on the page itself.
 */
function useServerDrillCounts(enabled: boolean, bedarf: string | null, tone: string | null, gewerk: string | null) {
  const q = useQuery({ queryKey: ["server", "portfolio"], queryFn: () => serverApi.dashboard.portfolio.query() as Promise<PortfolioView>, staleTime: 30_000, enabled });
  const v = q.data;
  return useMemo(() => {
    if (!v) return { bedarf: null, tone: null };
    const b = bedarf ? v.bedarf.find(x => x.key === bedarf) ?? null : null;
    const slices = gewerk ? v.gewerke.find(g => g.name === gewerk)?.slices : v.tones.slices;
    const t = tone ? slices?.find(x => x.tone === tone) ?? null : null;
    return { bedarf: b, tone: t };
  }, [v, bedarf, tone, gewerk]);
}
function useNoDrillCounts(_e: boolean, _b: string | null, _t: string | null, _g: string | null) { return { bedarf: null, tone: null } as { bedarf: import("@shared/handlungsbedarf").BedarfCount | null; tone: import("@shared/handlungsbedarf").ToneCount | null }; }
export const useDrillCounts: typeof useServerDrillCounts = SERVER_MODE ? useServerDrillCounts : (useNoDrillCounts as unknown as typeof useServerDrillCounts);
