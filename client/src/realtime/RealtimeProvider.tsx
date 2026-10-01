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
import { scope as scopeKey, type DomainEvent } from "@shared/domain-events";
import type { DEPARTMENTS } from "@shared/validation";
type Department = (typeof DEPARTMENTS)[number];
import { EDITABLE_PROJECT_FIELDS, reviewChangeKey, type ConflictInfo, type ProjectDetail, type ReviewField, type UpdateProjectInput } from "@shared/project-contract";
import { ProjectSyncEngine, type ProjectChange } from "./projectSyncEngine";
import { PresenceClientStore } from "./presence";
import { NotificationClientStore } from "./notifications";
import { RealtimeConnection, type ConnectionStatus } from "./connection";
import { authHeaders, extractConflict, isRetryable, serverApi } from "./serverApi";

export const serverKeys = {
  project: (id: number) => ["server", "project", id] as const,
  lists: () => ["server", "projects", "list"] as const,
  counts: () => ["server", "projects", "count"] as const,
  bookings: () => ["server", "bookings"] as const,
  checklists: () => ["server", "checklists"] as const,
  shell: () => ["server", "shell"] as const,
};

interface Ctx {
  engine: ProjectSyncEngine;
  connection: RealtimeConnection;
  /** register interest in scopes for the lifetime of a component; returns release */
  retain(scopes: string[]): () => void;
  /** ephemeral presence snapshots received over the stream */
  presence: PresenceClientStore;
  /** live notifications received over the stream */
  notifications: NotificationClientStore;
}
const RealtimeCtx = createContext<Ctx | null>(null);

/** Every field a list row can carry that a change may touch. Reviews are not patched here (own event stream). */
const ROW_FIELDS = [
  ...EDITABLE_PROJECT_FIELDS, "updatedAt", "version", "reviews",
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
    const presence = new PresenceClientStore();
    const notifications = new NotificationClientStore();
    // show it immediately, and let the server-owned unread count / list catch up with one small refetch
    const onNotification = (e: DomainEvent) => { notifications.apply(e); void qc.invalidateQueries({ queryKey: ["server", "notifications"] }); };
    const engine = new ProjectSyncEngine({
      sync: known => serverApi.projects.sync.mutate({ known }) as never,
      changes: input => serverApi.projects.changes.query(input) as never,
      // notifications missed while offline arrive through the same feed
      onOther: e => {
        if (e.aggregateType === "booking") void qc.invalidateQueries({ queryKey: serverKeys.bookings() });
        else if (e.aggregateType === "checklist") void qc.invalidateQueries({ queryKey: serverKeys.checklists() });
        else onNotification(e);
      },
    });
    const connection = new RealtimeConnection({
      url: "/api/realtime/stream",
      getHeaders: authHeaders,
      // scopes of the open stream change in place (rows scrolled in/out of view) instead of reconnecting
      postScopes: async req => {
        const r = await fetch("/api/realtime/scopes", { method: "POST", headers: { ...(await authHeaders()), "content-type": "application/json" }, body: JSON.stringify(req), credentials: "include" });
        return { ok: r.status === 202, status: r.status };
      },
      // rows that just became live-subscribed may have changed while they were not: reconcile exactly those
      onScopesLive: added => {
        const ids = added.filter(x => x.startsWith("project:")).map(x => Number(x.slice(8))).filter(Number.isInteger);
        return ids.length ? engine.syncRows(ids).then(() => undefined) : undefined;
      },
      onEvent: e => {
        if (e.aggregateType === "presence") { presence.apply(e); return; }
        if (e.aggregateType === "notification") { onNotification(e); return; }
        // other aggregates: the durable SQL read is the source, the event says WHICH query is stale
        if (e.aggregateType === "booking") { void qc.invalidateQueries({ queryKey: serverKeys.bookings() }); return; }
        if (e.aggregateType === "checklist") { void qc.invalidateQueries({ queryKey: serverKeys.checklists() }); return; }
        engine.applyEvent(e);
        // creations/deletions/moves change the shell count; plain updates do not
        if (e.eventType !== "project.updated") void qc.invalidateQueries({ queryKey: serverKeys.shell() });
      },
      onHint: kind => {
        if (kind === "notifications") void qc.invalidateQueries({ queryKey: ["server", "notifications"] });
        // the server's transport recovered from an outage: re-read the durable feed now (idempotent, shares one run)
        if (kind === "catchup") void engine.catchUp().catch(() => {});
      },
      // every (re)connect re-reads the durable inbox + unread counter: nothing missed while offline stays hidden
      onSync: ({ headSeq, reconnecting }) => {
        void qc.invalidateQueries({ queryKey: ["server", "notifications"] });
        return reconnecting ? engine.resync(headSeq ?? undefined) : engine.catchUp(headSeq ?? undefined);
      },
    });
    const wanted = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => connection.setScopes([...wanted.keys()]), 250); // coalesce mounts
    };
    return {
      engine, connection, presence, notifications,
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
        void qc.invalidateQueries({ queryKey: serverKeys.counts() });
        void qc.invalidateQueries({ queryKey: serverKeys.shell() });
        return;
      }
      if (c.kind === "remove") { qc.removeQueries({ queryKey: serverKeys.project(c.id) }); void qc.invalidateQueries({ queryKey: serverKeys.counts() }); }
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

export interface EditConflict { projectId: number; conflict: ConflictInfo; changes: UpdateProjectInput["changes"]; review?: { department: string; changes: Partial<Record<ReviewField, string | null>> } }
export interface EditorApi {
  /** optimistic, idempotent, version-checked edit; resolves to the server row or null (rolled back) */
  edit(id: number, changes: UpdateProjectInput["changes"], opts?: { expectedVersion?: number }): Promise<ProjectDetail | null>;
  /** department-review edit: same optimistic/conflict machinery, project-version concurrency */
  editReview(projectId: number, department: string, changes: Partial<Record<ReviewField, string | null>>): Promise<ProjectDetail | null>;
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

  /** One optimistic → send → confirm | rollback cycle, shared by field edits and review edits. */
  const run = useCallback(async (
    id: number,
    optimistic: Record<string, string | null>,
    send: (ctx: { mutationId: string; idempotencyKey: string }) => Promise<{ project: unknown }>,
    onConflict: (c: ConflictInfo) => void,
  ): Promise<ProjectDetail | null> => {
    const mutationId = crypto.randomUUID();
    const idempotencyKey = `m-${mutationId}`; // stable across retries of THIS action
    setError(null);
    setPending(n => n + 1);
    engine.optimistic(id, mutationId, optimistic);
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await send({ mutationId, idempotencyKey });
          engine.confirm(id, mutationId, res.project as ProjectDetail);
          return res.project as ProjectDetail;
        } catch (err) {
          const c = extractConflict(err);
          if (!c && attempt < 3 && isRetryable(err)) { await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); continue; }
          engine.rollback(id, mutationId, c ?? undefined);
          if (c) onConflict(c);
          else setError(err instanceof Error ? err.message : "Fehler");
          return null;
        }
      }
    } finally {
      setPending(n => n - 1);
    }
  }, [engine]);

  const edit = useCallback<EditorApi["edit"]>(async (id, changes, opts = {}) => {
    const expectedVersion = opts.expectedVersion ?? engine.serverVersion(id);
    if (expectedVersion === undefined) { setError("Projekt nicht geladen"); return null; }
    return run(id, changes as Record<string, string | null>,
      ({ mutationId, idempotencyKey }) => serverApi.projects.update.mutate({ id, expectedVersion, changes, idempotencyKey, mutationId }),
      c => setConflict({ projectId: id, conflict: c, changes }));
  }, [engine, run]);

  const editReview = useCallback<EditorApi["editReview"]>(async (projectId, department, changes) => {
    const expectedVersion = engine.serverVersion(projectId);
    if (expectedVersion === undefined) { setError("Projekt nicht geladen"); return null; }
    const optimistic = Object.fromEntries(Object.entries(changes).map(([f, v]) => [reviewChangeKey(department, f as ReviewField), v ?? null]));
    return run(projectId, optimistic,
      ({ mutationId, idempotencyKey }) => serverApi.projects.updateReview.mutate({ projectId, department: department as Department, expectedVersion, changes, idempotencyKey, mutationId }),
      c => setConflict({ projectId, conflict: c, changes: {}, review: { department, changes } }));
  }, [engine, run]);

  const api = useMemo<EditorApi>(() => ({
    edit, editReview, conflict, pending, error,
    takeServer: () => setConflict(null),
    rebase: async () => {
      const c = conflict;
      if (!c) return null;
      setConflict(null);
      // the review path re-sends against the project's current version too
      if (c.review) return run(c.projectId, Object.fromEntries(Object.entries(c.review.changes).map(([f, v]) => [reviewChangeKey(c.review!.department, f as ReviewField), v ?? null])),
        ({ mutationId, idempotencyKey }) => serverApi.projects.updateReview.mutate({ projectId: c.projectId, department: c.review!.department as Department, expectedVersion: c.conflict.currentVersion, changes: c.review!.changes, idempotencyKey, mutationId }),
        next => setConflict({ ...c, conflict: next }));
      return edit(c.projectId, c.changes, { expectedVersion: c.conflict.currentVersion });
    },
  }), [edit, editReview, run, conflict, pending, error]);

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
