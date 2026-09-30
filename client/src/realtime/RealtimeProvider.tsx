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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { scope as scopeKey } from "@shared/domain-events";
import { EDITABLE_PROJECT_FIELDS, type ConflictInfo, type ProjectDetail, type UpdateProjectInput } from "@shared/project-contract";
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

/** Every field a list row can carry that a change may touch. Reviews are not patched here (own event stream). */
const ROW_FIELDS = [
  ...EDITABLE_PROJECT_FIELDS, "updatedAt", "version",
] as const;

/** Patch one project into every cached list page — no refetch. */
function patchLists(qc: QueryClient, c: Extract<ProjectChange, { kind: "upsert" | "remove" }>) {
  qc.setQueriesData<{ pages?: Array<{ items: Array<{ id: number }> }>; items?: Array<{ id: number }> }>(
    { queryKey: serverKeys.lists() },
    old => {
      if (!old) return old;
      const patchItems = (items: Array<{ id: number }>) => {
        if (c.kind === "remove") return items.filter(i => i.id !== c.id);
        return items.map(i => {
          if (i.id !== c.id) return i;
          const next: Record<string, unknown> = { ...i };
          for (const f of ROW_FIELDS) if (f in (c.project as object)) next[f] = (c.project as unknown as Record<string, unknown>)[f];
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
    const engine = new ProjectSyncEngine({
      sync: known => serverApi.projects.sync.mutate({ known }) as never,
      changes: input => serverApi.projects.changes.query(input) as never,
    });
    const connection = new RealtimeConnection({
      url: "/api/realtime/stream",
      getHeaders: authHeaders,
      onEvent: e => {
        engine.applyEvent(e);
        // creations/deletions/moves change the shell count; plain updates do not
        if (e.eventType !== "project.updated") void qc.invalidateQueries({ queryKey: serverKeys.shell() });
      },
      onSync: ({ headSeq, reconnecting }) =>
        reconnecting ? engine.resync(headSeq ?? undefined) : engine.catchUp(headSeq ?? undefined),
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
      if (c.kind === "collection-stale") {
        // create / move-in: targeted authoritative refresh of the list queries + the shell count
        void qc.invalidateQueries({ queryKey: serverKeys.lists() });
        void qc.invalidateQueries({ queryKey: serverKeys.shell() });
        return;
      }
      if (c.kind === "remove") qc.removeQueries({ queryKey: serverKeys.project(c.id) });
      else qc.setQueryData(serverKeys.project(c.id), c.project);
      patchLists(qc, c);
    });
    ctx.connection.start();
    // Safety net against silent transport loss (e.g. a Redis subscriber blip):
    // a cheap indexed feed read reconciles anything a live stream dropped.
    const poll = setInterval(() => { void ctx.engine.catchUp().catch(() => {}); }, 30_000);
    const on = () => ctx.connection.notifyOnline(true), off = () => ctx.connection.notifyOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { unsub(); clearInterval(poll); ctx.connection.stop(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [ctx, qc]);

  return (
    <RealtimeCtx.Provider value={ctx}>
      <EditorProvider>{children}</EditorProvider>
    </RealtimeCtx.Provider>
  );
}

export const useRt = () => {
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

export interface EditConflict { projectId: number; conflict: ConflictInfo; changes: UpdateProjectInput["changes"] }
export interface EditorApi {
  /** optimistic, idempotent, version-checked edit; resolves to the server row or null (rolled back) */
  edit(id: number, changes: UpdateProjectInput["changes"], opts?: { expectedVersion?: number }): Promise<ProjectDetail | null>;
  /** the single active conflict (rendered by <ConflictHost/>) */
  conflict: EditConflict | null;
  pending: number;
  error: string | null;
  takeServer(): void;
  rebase(): Promise<ProjectDetail | null>;
}

const EditorCtx = createContext<EditorApi | null>(null);

function EditorProvider({ children }: { children: ReactNode }) {
  const { engine } = useRt();
  const [conflict, setConflict] = useState<EditConflict | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const edit = useCallback<EditorApi["edit"]>(async (id, changes, opts = {}) => {
    const expectedVersion = opts.expectedVersion ?? engine.serverVersion(id);
    if (expectedVersion === undefined) { setError("Projekt nicht geladen"); return null; }
    const mutationId = crypto.randomUUID();
    const idempotencyKey = `m-${mutationId}`; // stable across retries of THIS action
    setError(null);
    setPending(n => n + 1);
    engine.optimistic(id, mutationId, changes as Record<string, string | null>);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await serverApi.projects.update.mutate({ id, expectedVersion, changes, idempotencyKey, mutationId });
          engine.confirm(id, mutationId, res.project as ProjectDetail);
          return res.project as ProjectDetail;
        } catch (err) {
          const c = extractConflict(err);
          if (!c && attempt < 3 && isRetryable(err)) { await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); continue; }
          engine.rollback(id, mutationId, c ?? undefined);
          if (c) setConflict({ projectId: id, conflict: c, changes });
          else setError(err instanceof Error ? err.message : "Fehler");
          return null;
        }
      }
    } finally {
      setPending(n => n - 1);
    }
  }, [engine]);

  const api = useMemo<EditorApi>(() => ({
    edit, conflict, pending, error,
    takeServer: () => setConflict(null),
    rebase: async () => {
      const c = conflict;
      if (!c) return null;
      setConflict(null);
      return edit(c.projectId, c.changes, { expectedVersion: c.conflict.currentVersion });
    },
  }), [edit, conflict, pending, error]);

  return <EditorCtx.Provider value={api}>{children}</EditorCtx.Provider>;
}

export function useProjectEditor(): EditorApi {
  const c = useContext(EditorCtx);
  if (!c) throw new Error("RealtimeProvider missing");
  return c;
}

/** Per-project convenience over the shared editor. */
export function useEditProject(id: number) {
  const editor = useProjectEditor();
  return {
    submit: (changes: UpdateProjectInput["changes"], opts?: { expectedVersion?: number }) => editor.edit(id, changes, opts),
    conflict: editor.conflict?.projectId === id ? editor.conflict.conflict : null,
    error: editor.error,
    pending: editor.pending > 0,
    takeServer: editor.takeServer,
    rebase: editor.rebase,
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
