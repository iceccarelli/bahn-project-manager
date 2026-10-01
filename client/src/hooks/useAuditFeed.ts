/**
 * Data plane of the Änderungshistorie and the Dashboard's activity line.
 *   server build: `audit.page` — keyset-paginated, workspace-scoped, filtered on the server; pages are fetched on demand
 *   demo build:   the browser-local trail (the only one that exists there)
 * Both are mapped to the one `AuditLogEntry` shape the page already renders.
 */
import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { AuditItem, AuditPage } from "@shared/audit-contract";
import { AUDIT_ACTIONS } from "@shared/audit-actions";
import type { AuditLogEntry } from "@/hooks/useDataQuery";
import { SERVER_MODE, serverApi } from "@/realtime/serverApi";
import { useAuditLog } from "@/hooks/useDataQuery";

export interface AuditFeedParams { days: number | null; q: string; statusOnly: boolean }
export interface AuditFeed { entries: AuditLogEntry[]; isLoading: boolean; isError: boolean; hasMore: boolean; loadMore: () => void; loadingMore: boolean }

/** Server row → the entry shape the page renders (severity/correction logic keep working on it). */
export function toAuditEntry(i: AuditItem): AuditLogEntry {
  const action =
    i.entityType === "booking" ? AUDIT_ACTIONS.terminGebucht
    : i.entityType === "checklist" ? AUDIT_ACTIONS.anmeldungEingereicht
    : i.action === "create" ? AUDIT_ACTIONS.projektAngelegt
    : i.action === "delete" ? AUDIT_ACTIONS.projektGeloescht
    : i.department ? AUDIT_ACTIONS.pruefungAktualisiert
    : AUDIT_ACTIONS.projektAktualisiert;
  return {
    id: String(i.id),
    timestamp: i.at,
    user: i.user,
    action,
    details: i.label ?? "",
    meta: {
      ...(i.entityType === "project" ? { projectId: i.entityId } : {}),
      station: i.label,
      department: i.department ?? undefined,
      field: i.field ?? undefined,
      from: i.from,
      to: i.to,
      surface: undefined,
    },
  } as AuditLogEntry;
}

const PAGE = 50;

function useServerAuditFeed(p: AuditFeedParams): AuditFeed {
  const q = useInfiniteQuery({
    queryKey: ["server", "audit", p],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => serverApi.audit.page.query({ cursor: pageParam, limit: PAGE, days: p.days ?? 0, ...(p.q.trim() ? { q: p.q.trim() } : {}), ...(p.statusOnly ? { statusOnly: true } : {}) }) as Promise<AuditPage>,
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: false,
  });
  const entries = (q.data?.pages ?? []).flatMap(pg => pg.items.map(toAuditEntry));
  return { entries, isLoading: q.isLoading, isError: q.isError, hasMore: !!q.hasNextPage, loadMore: () => { void q.fetchNextPage(); }, loadingMore: q.isFetchingNextPage };
}

function useLocalAuditFeed(_p: AuditFeedParams): AuditFeed {
  const q = useAuditLog();
  return { entries: q.data ?? [], isLoading: q.isLoading, isError: q.isError, hasMore: false, loadMore: () => {}, loadingMore: false };
}

export const useAuditFeed: (p: AuditFeedParams) => AuditFeed = SERVER_MODE ? useServerAuditFeed : useLocalAuditFeed;

function useServerActivity(limit: number): AuditLogEntry[] {
  const q = useQuery({
    queryKey: ["server", "activity", limit],
    queryFn: () => serverApi.audit.page.query({ limit, days: 7 }) as Promise<AuditPage>,
    staleTime: 15_000, refetchInterval: 60_000, retry: false, // viewers are not entitled to the trail: an error simply hides the panel's rows
  });
  return (q.data?.items ?? []).map(toAuditEntry);
}
function useLocalActivity(limit: number): AuditLogEntry[] { return (useAuditLog().data ?? []).slice(0, limit); }
/** The newest few entries for the Dashboard's "Team-Aktivität". */
export const useActivityFeed: (limit: number) => AuditLogEntry[] = SERVER_MODE ? useServerActivity : useLocalActivity;

type HistoryProject = { id: number; projektnummer: string | null } | null | undefined;
function useServerProjectHistory(project: HistoryProject): AuditLogEntry[] {
  const id = project?.id;
  const q = useQuery({
    queryKey: ["server", "audit", "project", id],
    enabled: id !== undefined,
    queryFn: () => serverApi.audit.page.query({ entityType: "project", entityId: id!, limit: 8, days: 0 }) as Promise<AuditPage>,
    staleTime: 15_000, retry: false, // viewers are not entitled to the trail: no history block
  });
  return (q.data?.items ?? []).map(toAuditEntry);
}
function useLocalProjectHistory(project: HistoryProject): AuditLogEntry[] {
  const entries = useAuditLog().data;
  return useMemo(() => {
    if (!project || !entries) return [];
    const needles = [project.projektnummer?.trim(), `#${project.id}`].filter(Boolean) as string[];
    return entries.filter((e) => needles.some((n) => e.details?.includes(n))).slice(0, 8);
  }, [project, entries]);
}
/** The latest changes of ONE project (server: its own audit rows by entity id; demo: matched in the local trail). */
export const useProjectHistory: (project: HistoryProject) => AuditLogEntry[] = SERVER_MODE ? useServerProjectHistory : useLocalProjectHistory;
