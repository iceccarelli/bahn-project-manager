/**
 * ProjectSyncEngine — the client half of the data contract. Framework-free.
 *
 *   server owns state → this engine mirrors it, version by version →
 *   React Query cache is a projection of the engine (see useProjectSync).
 *
 * Guarantees:
 *  - an event is applied only if aggregateVersion === known + 1;
 *  - duplicates (same eventId, or version <= known) are dropped;
 *  - a gap is never bridged blindly: the aggregate is recovered from the
 *    server (missed events, or a snapshot), then buffered events are replayed;
 *  - optimistic edits are an OVERLAY on server state, so an incoming event from
 *    another user never gets clobbered by, or clobbers, a pending local edit
 *    it does not touch.
 */
import { decideEvent, SeenEvents, type DomainEvent } from "@shared/domain-events";
import { EDITABLE_PROJECT_FIELDS, REVIEW_KEY_RE, type ConflictInfo, type ProjectDetail } from "@shared/project-contract";

export interface SyncResult { events: DomainEvent[]; snapshots: ProjectDetail[]; deleted: number[] }
/**
 * Apply one `changes` entry to a project object (returns a new object).
 * `review.<Gewerk>.<field>` edits the matching review row; everything else is a project field.
 */
export function withChange(project: ProjectDetail, key: string, value: string | null): ProjectDetail {
  const m = REVIEW_KEY_RE.exec(key);
  if (!m) return { ...project, [key]: value } as ProjectDetail;
  const [, department, field] = m;
  const reviews = [...(project.reviews ?? [])];
  const i = reviews.findIndex(r => r.department === department);
  const base = i >= 0 ? reviews[i]! : { id: 0, department: department!, prueferName: null, datum: null, status: null, updatedAt: project.updatedAt };
  const next = { ...base, [field!]: value };
  if (i >= 0) reviews[i] = next; else reviews.push(next);
  return { ...project, reviews };
}

export interface FeedPage { events: DomainEvent[]; cursor: number; hasMore: boolean }
export interface EngineDeps {
  /** aggregate-level catch-up: for held versions, what did I miss? */
  sync(known: Array<{ id: number; version: number }>): Promise<SyncResult>;
  /** collection-level catch-up: visible changes after a feed cursor */
  changes(input: { after: number; upTo?: number }): Promise<FeedPage>;
  /** feed events that are not project events (notifications) — forwarded, never treated as projects */
  onOther?(e: DomainEvent): void;
}

export type ProjectChange =
  | { kind: "upsert"; id: number; project: ProjectDetail; source: "server" | "optimistic" | "rollback" }
  | { kind: "remove"; id: number }
  /**
   * The collection changed in a way a patch cannot express for arbitrary
   * filtered/sorted pages (a project appeared here). Owners refetch the
   * affected list queries — a targeted authoritative refresh, not a reload.
   */
  | { kind: "collection-stale"; reason: "created" | "moved-in"; id: number };
export type ApplyOutcome = "applied" | "duplicate" | "stale" | "recovering" | "ignored";

/** A recent remote change, for "Projektstand EP → AP · Markus · vor 2 Sekunden". */
export interface RecentChange { field: string; from: string | null; to: string | null; actorId: string; actorName: string | null; at: string }

interface Pending { mutationId: string; changes: Record<string, string | null> }

export class ProjectSyncEngine {
  private server = new Map<number, ProjectDetail>();
  private pending = new Map<number, Pending[]>();
  private buffered = new Map<number, DomainEvent[]>();
  private recovering = new Map<number, Promise<void>>();
  private seen = new SeenEvents(4096);
  private listeners = new Set<(c: ProjectChange) => void>();
  /** resume position in the change feed; advanced ONLY by authoritative reads, never by live events */
  private feedCursor: number | null = null;
  private catching: Promise<number> | null = null;
  private recent = new Map<number, RecentChange[]>();
  readonly metrics = { applied: 0, duplicates: 0, stale: 0, gaps: 0, recoveries: 0, snapshots: 0 };

  constructor(private readonly deps: EngineDeps) {}

  subscribe(cb: (c: ProjectChange) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private emit(c: ProjectChange) { for (const l of this.listeners) l(c); }

  /** Known server version per tracked aggregate — the reconnect cursor. */
  cursor(): Array<{ id: number; version: number }> {
    return [...this.server].map(([id, p]) => ({ id, version: p.version }));
  }
  get(id: number): ProjectDetail | undefined { return this.view(id); }
  serverVersion(id: number) { return this.server.get(id)?.version; }
  recentChanges(id: number): RecentChange[] { return this.recent.get(id) ?? []; }
  pendingCount() { let n = 0; for (const p of this.pending.values()) n += p.length; return n; }

  /** Load authoritative state (query result or mutation response). Never moves a version backwards. */
  seed(project: ProjectDetail, opts: { silent?: boolean } = {}): void {
    const cur = this.server.get(project.id);
    if (cur && cur.version >= project.version) return;
    this.server.set(project.id, project);
    if (!opts.silent) this.emit({ kind: "upsert", id: project.id, project: this.view(project.id)!, source: "server" });
  }

  /** The feed position captured BEFORE an authoritative list read. First writer wins; only ever moves forward. */
  initCursor(feedHead: number): void {
    if (this.feedCursor === null || feedHead > this.feedCursor) this.feedCursor = this.feedCursor === null ? feedHead : this.feedCursor;
  }
  get cursorValue() { return this.feedCursor; }

  // ---- events ------------------------------------------------------------

  applyEvent(event: DomainEvent): ApplyOutcome {
    if (event.aggregateType !== "project") return "ignored";
    if (this.seen.seen(event.eventId)) { this.metrics.duplicates++; return "duplicate"; }
    const id = Number(event.aggregateId);
    // While an aggregate is being recovered, park events; they replay afterwards.
    if (this.recovering.has(id)) { this.buffer(id, event); return "recovering"; }

    // A project entering this client's collection cannot be patched into
    // arbitrary filtered/sorted pages: signal a targeted list refresh instead of
    // fabricating a half-known row.
    if (!this.server.has(id)) {
      if (event.eventType === "project.created") { this.emit({ kind: "collection-stale", reason: "created", id }); return "applied"; }
      if (event.eventType === "project.updated" && event.context?.workspaceBefore) {
        this.emit({ kind: "collection-stale", reason: "moved-in", id });
        return "applied";
      }
      if (event.eventType === "project.deleted" || event.eventType === "project.removed") { this.emit({ kind: "remove", id }); return "applied"; }
      return "ignored";
    }
    const decision = decideEvent(this.server.get(id)?.version, event);
    switch (decision.kind) {
      case "apply": this.commit(id, event); return "applied";
      case "stale": this.metrics.stale++; return "stale";
      case "unknown-aggregate": return "ignored";
      case "gap":
        this.metrics.gaps++;
        this.buffer(id, event);
        void this.recover(id);
        return "recovering";
    }
  }

  private buffer(id: number, e: DomainEvent) {
    const b = this.buffered.get(id) ?? [];
    b.push(e);
    this.buffered.set(id, b);
  }

  private commit(id: number, e: DomainEvent) {
    this.metrics.applied++;
    if (e.eventType === "project.deleted" || e.eventType === "project.removed") {
      this.server.delete(id); this.pending.delete(id);
      this.emit({ kind: "remove", id });
      return;
    }
    const cur = this.server.get(id);
    const blank = Object.fromEntries(EDITABLE_PROJECT_FIELDS.map(f => [f, null]));
    const next: ProjectDetail = cur ?? ({ id, reviews: [], createdAt: e.timestamp, ...blank } as unknown as ProjectDetail);
    let merged: ProjectDetail = { ...next, version: e.aggregateVersion, updatedAt: e.timestamp };
    for (const [f, c] of Object.entries(e.changes)) merged = withChange(merged, f, c.to);
    this.server.set(id, merged);
    const list = this.recent.get(id) ?? [];
    for (const [field, c] of Object.entries(e.changes)) {
      list.unshift({ field, from: c.from, to: c.to, actorId: e.actorId, actorName: e.actorName ?? null, at: e.timestamp });
    }
    this.recent.set(id, list.slice(0, 20));
    this.emit({ kind: "upsert", id, project: this.view(id)!, source: "server" });
  }

  /** Recover one aggregate from the server, then replay whatever arrived meanwhile. */
  private recover(id: number): Promise<void> {
    const existing = this.recovering.get(id);
    if (existing) return existing;
    let failed = false;
    const run = (async () => {
      this.metrics.recoveries++;
      const version = this.server.get(id)?.version;
      if (version === undefined) return;
      const res = await this.deps.sync([{ id, version }]);
      this.applyRecovery(res);
    })()
      // A failed recovery must not spin: parked events stay parked and the
      // connection layer's post-reconnect resync() repairs the aggregate.
      .catch(() => { failed = true; })
      .finally(() => {
        this.recovering.delete(id);
        if (failed) return;
        const parked = (this.buffered.get(id) ?? []).sort((a, b) => a.aggregateVersion - b.aggregateVersion);
        this.buffered.delete(id);
        // eventIds were marked seen on first receipt; replay bypasses that check
        for (const e of parked) this.replay(e);
      });
    this.recovering.set(id, run);
    return run;
  }

  private replay(e: DomainEvent) {
    const id = Number(e.aggregateId);
    if (!this.server.has(id)) { this.applyUnseen(e); return; }
    const d = decideEvent(this.server.get(id)?.version, e);
    if (d.kind === "apply") this.commit(id, e);
    else if (d.kind === "gap") { this.buffer(id, e); void this.recover(id); }
  }

  /** feed events skip the eventId de-dupe (they are replays by design) but keep version discipline */
  private applyUnseen(e: DomainEvent) {
    const id = Number(e.aggregateId);
    if (this.server.has(id)) { this.replay(e); return; }
    if (e.eventType === "project.created") this.emit({ kind: "collection-stale", reason: "created", id });
    else if (e.eventType === "project.updated" && e.context?.workspaceBefore) this.emit({ kind: "collection-stale", reason: "moved-in", id });
    else if (e.eventType === "project.deleted" || e.eventType === "project.removed") this.emit({ kind: "remove", id });
  }

  /**
   * Collection-level recovery. Reads the feed from the cursor to `upTo` (or the
   * end), applying every visible change: updates to known projects go through
   * normal version discipline; creations / move-ins signal a list refresh;
   * deletions / move-outs remove. Advances the cursor from authoritative
   * responses only. Concurrent calls share one run. Returns the number of
   * visible changes processed.
   */
  catchUp(upTo?: number): Promise<number> {
    if (this.catching) return this.catching;
    const run = (async () => {
      if (this.feedCursor === null) return 0;
      let n = 0;
      for (let guard = 0; guard < 50; guard++) {
        const page = await this.deps.changes({ after: this.feedCursor, ...(upTo !== undefined ? { upTo } : {}) });
        for (const e of page.events) {
          if (e.aggregateType !== "project") { if (!this.seen.seen(e.eventId)) this.deps.onOther?.(e); continue; }
          const id = Number(e.aggregateId);
          const alreadySeen = this.seen.seen(e.eventId);
          if (this.server.has(id)) {
            // Known aggregate: VERSION is the authority, not "have I seen this id". An event that was
            // received live but parked behind a failed recovery must still be applied here; a
            // duplicate of an applied event is `stale` and costs nothing.
            const d = decideEvent(this.server.get(id)?.version, e);
            if (d.kind === "apply") { this.commit(id, e); n++; }
            else if (d.kind === "gap") { this.buffer(id, e); await this.recover(id); n++; }
          } else if (!alreadySeen) {
            // Unknown aggregate (created / moved in / removed): signalled once; a repeat would only re-trigger list refetches
            this.applyUnseen(e); n++;
          }
        }
        this.feedCursor = Math.max(this.feedCursor, page.cursor);
        if (!page.hasMore) break;
      }
      return n;
    })().finally(() => { this.catching = null; });
    this.catching = run;
    return run;
  }

  private applyRecovery(res: SyncResult) {
    for (const s of res.snapshots) {
      this.metrics.snapshots++;
      const cur = this.server.get(s.id);
      if (!cur || cur.version < s.version) {
        this.server.set(s.id, s);
        this.emit({ kind: "upsert", id: s.id, project: this.view(s.id)!, source: "server" });
      }
    }
    for (const e of [...res.events].sort((a, b) => a.aggregateVersion - b.aggregateVersion)) {
      this.seen.seen(e.eventId);
      this.replay(e);
    }
    for (const id of res.deleted) {
      if (this.server.delete(id)) { this.pending.delete(id); this.emit({ kind: "remove", id }); }
    }
  }

  /**
   * Full reconnect recovery for every tracked aggregate. Returns how many
   * aggregates changed, for "Wiederverbunden · 3 Änderungen synchronisiert".
   */
  async resync(upTo?: number): Promise<number> {
    let changed = await this.catchUp(upTo).catch(() => 0);
    const known = this.cursor();
    if (known.length === 0) return changed;
    this.buffered.clear(); // anything parked is covered by the snapshot/events below
    for (let i = 0; i < known.length; i += 200) {
      const chunk = known.slice(i, i + 200);
      const before = new Map(chunk.map(k => [k.id, k.version]));
      const res = await this.deps.sync(chunk);
      this.applyRecovery(res);
      for (const k of chunk) {
        const now = this.server.get(k.id)?.version;
        if (now !== before.get(k.id)) changed++;
      }
    }
    return changed;
  }

  // ---- optimistic edits ---------------------------------------------------

  /** Overlay a local edit immediately. Returns nothing to hold: rollback is by mutationId. */
  optimistic(id: number, mutationId: string, changes: Record<string, string | null>): void {
    if (!this.server.has(id)) return;
    const list = this.pending.get(id) ?? [];
    list.push({ mutationId, changes });
    this.pending.set(id, list);
    this.emit({ kind: "upsert", id, project: this.view(id)!, source: "optimistic" });
  }

  /** Server accepted: adopt its authoritative row and drop the overlay. */
  confirm(id: number, mutationId: string, authoritative: ProjectDetail): void {
    this.dropPending(id, mutationId);
    const cur = this.server.get(id);
    if (!cur || cur.version < authoritative.version) this.server.set(id, authoritative);
    this.emit({ kind: "upsert", id, project: this.view(id)!, source: "server" });
  }

  /** Server refused (conflict, forbidden, validation): remove the overlay; the UI shows why. */
  rollback(id: number, mutationId: string, conflict?: ConflictInfo): void {
    this.dropPending(id, mutationId);
    if (conflict) {
      const cur = this.server.get(id);
      if (!cur || cur.version < conflict.currentVersion) this.server.set(id, conflict.current);
    }
    this.emit({ kind: "upsert", id, project: this.view(id)!, source: "rollback" });
  }

  private dropPending(id: number, mutationId: string) {
    const list = (this.pending.get(id) ?? []).filter(p => p.mutationId !== mutationId);
    if (list.length) this.pending.set(id, list); else this.pending.delete(id);
  }

  /** server state + still-pending local edits */
  private view(id: number): ProjectDetail | undefined {
    const base = this.server.get(id);
    if (!base) return undefined;
    const overlay = this.pending.get(id);
    if (!overlay?.length) return base;
    let out: ProjectDetail = { ...base };
    for (const p of overlay) for (const [k, v] of Object.entries(p.changes)) out = withChange(out, k, v);
    return out;
  }
}
