/**
 * Wires the framework-free engine into React:
 *
 *   server ──tRPC──▶ engine ──▶ React Query cache ──▶ UI
 *   server ──SSE──▶ engine ──▶ React Query cache ──▶ UI      (patches, no refetch)
 *
 * The UI only ever reads the React Query cache. The engine is the single place
 * that decides whether an incoming change is applied, dropped, or triggers
 * recovery.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { scope as scopeKey } from "@shared/domain-events";
import type { ConflictInfo, ProjectDetail, UpdateProjectInput } from "@shared/project-contract";
import { ProjectSyncEngine, type ProjectChange } from "./projectSyncEngine";
import { RealtimeConnection, type ConnectionStatus } from "./connection";
import { authHeaders, extractConflict, isRetryable, serverApi } from "./serverApi";

export const serverKeys = {
  project: (id: number) => ["server", "project", id] as const,
  lists: () => ["server", "projects", "list"] as const,
  shell: () => ["server", "shell"] as const,
};

interface Ctx {
  engine: ProjectSyncEngine;
  connection: RealtimeConnection;
  /** register interest in scopes for the lifetime of a component; returns release */
  retain(scopes: string[]): () => void;
}
const RealtimeCtx = createContext<Ctx | null>(null);

const SUMMARY_FIELDS = ["projektnummer", "bahnhofsmanagement", "station", "projektstand", "projektleiter", "terminProjektvorstellung", "updatedAt", "version"] as const;

/** Patch one project into every cached list page — no refetch. */
function patchLists(qc: QueryClient, c: ProjectChange) {
  qc.setQueriesData<{ pages?: Array<{ items: Array<{ id: number }> }>; items?: Array<{ id: number }> }>(
    { queryKey: serverKeys.lists() },
    old => {
      if (!old) return old;
      const patchItems = (items: Array<{ id: number }>) => {
        if (c.kind === "remove") return items.filter(i => i.id !== c.id);
        return items.map(i => {
          if (i.id !== c.id) return i;
          const next: Record<string, unknown> = { ...i };
          for (const f of SUMMARY_FIELDS) next[f] = (c.project as unknown as Record<string, unknown>)[f];
          return next as unknown as { id: number };
        });
      };
      if (old.pages) return { ...old, pages: old.pages.map(p => ({ ...p, items: patchItems(p.items) })) };
      if (old.items) return { ...old, items: patchItems(old.items) };
      return old;
    },
  );
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const ctx = useMemo<Ctx>(() => {
    const engine = new ProjectSyncEngine({ sync: known => serverApi.projects.sync.mutate({ known }) as never });
    const connection = new RealtimeConnection({
      url: "/api/realtime/stream",
      getHeaders: authHeaders,
      onEvent: e => {
        engine.applyEvent(e);
        // creations/deletions change the shell count; nothing else does
        if (e.eventType !== "project.updated") void qc.invalidateQueries({ queryKey: serverKeys.shell() });
      },
      onReconnect: () => engine.resync(),
    });
    const wanted = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => connection.setScopes([...wanted.keys()]), 250); // coalesce mounts
    };
    return {
      engine, connection,
      retain(scopes) {
        for (const s of scopes) wanted.set(s, (wanted.get(s) ?? 0) + 1);
        apply();
        return () => {
          for (const s of scopes) { const n = (wanted.get(s) ?? 1) - 1; if (n <= 0) wanted.delete(s); else wanted.set(s, n); }
          apply();
        };
      },
    };
  }, [qc]);

  useEffect(() => {
    const unsub = ctx.engine.subscribe(c => {
      if (c.kind === "remove") { qc.removeQueries({ queryKey: serverKeys.project(c.id) }); }
      else qc.setQueryData(serverKeys.project(c.id), c.project);
      patchLists(qc, c);
    });
    ctx.connection.start();
    const on = () => ctx.connection.notifyOnline(true), off = () => ctx.connection.notifyOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { unsub(); ctx.connection.stop(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [ctx, qc]);

  return <RealtimeCtx.Provider value={ctx}>{children}</RealtimeCtx.Provider>;
}

const useRt = () => {
  const c = useContext(RealtimeCtx);
  if (!c) throw new Error("RealtimeProvider missing");
  return c;
};
export const useOptionalRealtime = () => useContext(RealtimeCtx);

export function useConnectionStatus(): ConnectionStatus {
  const { connection } = useRt();
  return useSyncExternalStore(cb => connection.subscribe(cb), () => connection.getStatus());
}

/** Watch a workspace channel (e.g. while a list is on screen). */
export function useWorkspaceScope(workspace: string | null) {
  const { retain } = useRt();
  useEffect(() => (workspace ? retain([scopeKey.workspace(workspace)]) : undefined), [retain, workspace]);
}

/** One project, live: initial read from the server, then patched by events. */
export function useLiveProject(id: number) {
  const { engine, retain } = useRt();
  useEffect(() => retain([scopeKey.project(id)]), [retain, id]);
  const q = useQuery({
    queryKey: serverKeys.project(id),
    queryFn: async () => {
      const p = (await serverApi.projects.get.query({ id })) as ProjectDetail;
      engine.seed(p);
      return engine.get(id) ?? p;
    },
    staleTime: Number.POSITIVE_INFINITY, // realtime keeps it fresh; resync repairs it after gaps
  });
  const recent = engine.recentChanges(id);
  return { ...q, recent };
}

export interface FieldEditState { conflict: ConflictInfo | null; error: string | null; pending: boolean }

/** Optimistic, idempotent, version-checked edit with structured conflict handling. */
export function useEditProject(id: number) {
  const { engine } = useRt();
  const [state, setState] = useState<FieldEditState>({ conflict: null, error: null, pending: false });
  const last = useRef<{ changes: UpdateProjectInput["changes"] } | null>(null);

  const submit = useCallback(async (changes: UpdateProjectInput["changes"], opts: { expectedVersion?: number } = {}) => {
    const expectedVersion = opts.expectedVersion ?? engine.serverVersion(id);
    if (expectedVersion === undefined) throw new Error("Projekt nicht geladen");
    const mutationId = crypto.randomUUID();
    const idempotencyKey = `m-${mutationId}`; // stable across retries of THIS action
    last.current = { changes };
    setState({ conflict: null, error: null, pending: true });
    engine.optimistic(id, mutationId, changes as Record<string, string | null>);
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await serverApi.projects.update.mutate({ id, expectedVersion, changes, idempotencyKey, mutationId });
        engine.confirm(id, mutationId, res.project as ProjectDetail);
        setState({ conflict: null, error: null, pending: false });
        return res;
      } catch (err) {
        const conflict = extractConflict(err);
        if (!conflict && attempt < 3 && isRetryable(err)) { await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); continue; }
        engine.rollback(id, mutationId, conflict ?? undefined);
        setState({ conflict, error: conflict ? null : err instanceof Error ? err.message : "Fehler", pending: false });
        return null;
      }
    }
  }, [engine, id]);

  return {
    ...state,
    submit,
    /** discard my edit, keep the server's value */
    takeServer: () => setState(s => ({ ...s, conflict: null })),
    /** re-apply my edit on top of the server's current version */
    rebase: async () => {
      const c = state.conflict, l = last.current;
      if (!c || !l) return null;
      return submit(l.changes, { expectedVersion: c.currentVersion });
    },
  };
}

export function useShellSummary() {
  const q = useQuery({
    queryKey: serverKeys.shell(),
    queryFn: () => serverApi.projects.shellSummary.query(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return { projectCount: q.data?.projectCount ?? null, lastUpdatedAt: q.data?.lastUpdatedAt ?? null, isError: q.isError, isLoading: q.isLoading };
}
