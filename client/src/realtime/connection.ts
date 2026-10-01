/**
 * RealtimeConnection — a fetch-based SSE client with an explicit state machine.
 *
 *   connecting → connected ⇄ degraded
 *        ↓            ↓
 *   reconnecting → resynchronizing → connected
 *   offline (navigator.onLine === false)
 *
 * fetch (not EventSource) so the request can carry an Authorization header
 * (OIDC bearer) as well as cookies. Reconnect uses exponential backoff with
 * full jitter. After every reconnect the owner's `onReconnect` runs BEFORE the
 * state returns to `connected`, so the UI never claims "Live" while stale.
 */
import { SseParser } from "@shared/sse";
import { DomainEventSchema, type DomainEvent } from "@shared/domain-events";

export type ConnectionState = "connecting" | "connected" | "degraded" | "reconnecting" | "offline" | "resynchronizing";

export interface ConnectionStatus { state: ConnectionState; lastSyncedChanges: number | null; attempt: number; since: number }

export interface ConnectionOptions {
  url: string;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;
  onEvent(e: DomainEvent): void;
  /**
   * Called on EVERY hello (first connect included) with the server's feed head.
   * Must bring local state up to that head; returns how many changes it applied.
   * On a reconnect the status is `resynchronizing` until it settles.
   */
  onSync?(hello: { headSeq: number | null; reconnecting: boolean }): Promise<number>;
  /**
   * Change the live stream's scopes without reconnecting (POST /api/realtime/scopes). The server answers on the
   * stream with a `scopes` frame once the new channels are CONFIRMED; only then is an added scope considered live.
   */
  postScopes?(req: { streamId: string; requestId: string; add: string[]; remove: string[] }): Promise<{ ok: boolean; status: number }>;
  /** called after added scopes are confirmed live: rows subscribed late must be reconciled with the server */
  onScopesLive?(added: string[]): void | Promise<void>;
  /** how many scopes go in the connect URL; the rest are added right after hello */
  initialScopeLimit?: number;
  heartbeatMs?: number;
  backoff?: { baseMs: number; maxMs: number };
  random?: () => number;
  now?: () => number;
  isOnline?: () => boolean;
}

export class RealtimeConnection {
  private status: ConnectionStatus;
  private listeners = new Set<(s: ConnectionStatus) => void>();
  private scopes: string[] = [];
  /** what the SERVER currently holds for this stream (confirmed), and its id */
  private live = new Set<string>();
  private denied = new Set<string>();
  private streamId: string | null = null;
  private acks = new Map<string, (f: { accepted: string[]; denied: string[]; removed: string[]; error?: string }) => void>();
  private reconciling = false;
  private reconcileAgain = false;
  private reqSeq = 0;
  private abort: AbortController | null = null;
  private stopped = true;
  private hadConnection = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly o: Required<Pick<ConnectionOptions, "heartbeatMs" | "backoff" | "random" | "now" | "isOnline">> & ConnectionOptions;

  constructor(opt: ConnectionOptions) {
    this.o = {
      heartbeatMs: 15_000,
      backoff: { baseMs: 500, maxMs: 6_000 },
      random: Math.random,
      now: Date.now,
      isOnline: () => (typeof navigator === "undefined" || navigator.onLine !== false),
      ...opt,
    };
    this.status = { state: "connecting", lastSyncedChanges: null, attempt: 0, since: this.o.now() };
  }

  getStatus() { return this.status; }
  subscribe(l: (s: ConnectionStatus) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  private set(state: ConnectionState, patch: Partial<ConnectionStatus> = {}) {
    this.status = { ...this.status, ...patch, state, since: this.o.now() };
    for (const l of this.listeners) l(this.status);
  }

  setScopes(scopes: string[]) {
    const next = [...new Set(scopes)].sort();
    if (next.join() === this.scopes.join()) return;
    const hadNone = this.scopes.length === 0;
    this.scopes = next;
    if (this.stopped) return;
    // Live stream + a way to change it: adjust in place (no reconnect, no hello, no resync).
    if (this.streamId && this.o.postScopes && !hadNone && this.status.state !== "reconnecting" && this.status.state !== "offline") { void this.reconcile(); return; }
    // otherwise the next (re)connect carries the whole set
    if (hadNone || !this.streamId || !this.o.postScopes) { this.abort?.abort(); this.hadConnection = this.hadConnection || !hadNone; }
  }

  /** Bring the server's confirmed scopes in line with the wanted ones. Serialized; falls back to a reconnect on any failure. */
  private async reconcile(): Promise<void> {
    if (this.reconciling) { this.reconcileAgain = true; return; }
    this.reconciling = true;
    try {
      do {
        this.reconcileAgain = false;
        const streamId = this.streamId;
        if (!streamId || !this.o.postScopes) return;
        const want = new Set(this.scopes);
        const add = [...want].filter(x => !this.live.has(x) && !this.denied.has(x));
        const remove = [...this.live].filter(x => !want.has(x));
        for (let i = 0; i < Math.max(add.length, remove.length); i += 100) {
          const a = add.slice(i, i + 100), r = remove.slice(i, i + 100);
          const requestId = `r${++this.reqSeq}`;
          const ack = new Promise<{ accepted: string[]; denied: string[]; removed: string[]; error?: string } | null>(res => {
            this.acks.set(requestId, f => res(f));
            setTimeout(() => { if (this.acks.delete(requestId)) res(null); }, 6000);
          });
          let post: { ok: boolean; status: number };
          try { post = await this.o.postScopes({ streamId, requestId, add: a, remove: r }); } catch { post = { ok: false, status: 0 }; }
          if (!post.ok) { this.acks.delete(requestId); this.abort?.abort(); return; } // stream unknown/unreachable: reconnect with the full set
          const f = await ack;
          if (!f || f.error === "subscribe failed") { this.abort?.abort(); return; }
          for (const x of f.accepted) this.live.add(x);
          for (const x of f.removed) this.live.delete(x);
          for (const x of f.denied) this.denied.add(x);
          if (f.accepted.length) await Promise.resolve(this.o.onScopesLive?.(f.accepted)).catch(() => {});
        }
      } while (this.reconcileAgain);
    } finally { this.reconciling = false; }
  }

  /** scopes for the connect URL: everything that is not a per-row scope first, then rows up to the limit */
  private initialScopes(): string[] {
    const limit = this.o.initialScopeLimit ?? 40;
    const base = this.scopes.filter(x => !x.startsWith("project:")), rows = this.scopes.filter(x => x.startsWith("project:"));
    return [...base, ...rows].slice(0, Math.max(limit, base.length));
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }
  stop() {
    this.stopped = true;
    this.abort?.abort();
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }
  /** Browser online/offline hooks call this. */
  notifyOnline(online: boolean) {
    if (this.stopped) return;
    if (!online) { this.set("offline"); this.abort?.abort(); }
    else if (this.status.state !== "connected") {
      // the network is back: do not sit out a backoff timer that was sized for an outage
      this.set("reconnecting", { attempt: 0 });
      this.abort?.abort();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.wake?.();
    }
  }
  private wake: (() => void) | null = null;

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    // No frame (events OR heartbeats) for 2.5 intervals → the pipe is stalled.
    this.watchdog = setTimeout(() => {
      if (this.status.state === "connected") this.set("degraded");
      // a second missed window means it is dead, not slow
      this.watchdog = setTimeout(() => this.abort?.abort(), this.o.heartbeatMs * 1.5);
    }, this.o.heartbeatMs * 2.5);
  }

  private async loop() {
    while (!this.stopped) {
      if (!this.o.isOnline()) {
        this.set("offline");
        await new Promise<void>(r => { this.wake = r; });
        this.wake = null;
        continue;
      }
      if (this.scopes.length === 0) { await this.sleep(200); continue; }
      this.streamId = null; this.live.clear(); this.denied.clear(); this.acks.clear();
      const reconnecting = this.hadConnection;
      this.set(reconnecting ? "reconnecting" : "connecting");
      const abort = (this.abort = new AbortController());
      try {
        const headers = { Accept: "text/event-stream", ...(await this.o.getHeaders?.()) };
        const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}?scopes=${encodeURIComponent(this.initialScopes().join(","))}`, {
          headers, signal: abort.signal, credentials: "include", cache: "no-store",
        });
        if (!res.ok || !res.body) {
          if (res.status === 401 || res.status === 403) { this.set("offline"); return this.stop(); }
          throw new Error(`stream ${res.status}`);
        }
        const parser = new SseParser();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        this.armWatchdog();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          this.armWatchdog();
          if (this.status.state === "degraded") this.set("connected");
          for (const f of parser.feed(value)) await this.handle(f, reconnecting);
        }
      } catch {
        /* aborted or failed: fall through to backoff */
      }
      if (this.watchdog) clearTimeout(this.watchdog);
      if (this.stopped) break;
      this.hadConnection = this.hadConnection || this.status.attempt >= 0;
      const attempt = this.status.attempt + 1;
      this.set(this.o.isOnline() ? "reconnecting" : "offline", { attempt });
      const cap = Math.min(this.o.backoff.maxMs, this.o.backoff.baseMs * 2 ** Math.min(attempt, 10));
      await this.sleep(this.o.random() * cap); // full jitter
    }
  }

  private async handle(f: { event: string; data: string }, reconnecting: boolean) {
    switch (f.event) {
      case "hello": {
        this.hadConnection = true;
        let headSeq: number | null = null;
        try {
          const h = JSON.parse(f.data) as { headSeq?: number | null; streamId?: string; scopes?: string[]; denied?: string[] };
          headSeq = h.headSeq ?? null;
          this.streamId = h.streamId ?? null;
          this.live = new Set(h.scopes ?? []);
          this.denied = new Set(h.denied ?? []);
        } catch { /* keep null */ }
        // scopes beyond the connect-URL limit (and anything wanted since) are added without another round of reconnecting
        if (this.streamId && this.o.postScopes) void this.reconcile();
        if (reconnecting && this.o.onSync) {
          this.set("resynchronizing");
          let n = 0;
          try { n = await this.o.onSync({ headSeq, reconnecting: true }); } catch { /* the periodic catch-up retries */ }
          this.set("connected", { attempt: 0, lastSyncedChanges: n });
        } else {
          this.set("connected", { attempt: 0 });
          // first connect: reconcile silently with the list snapshot's cursor
          void this.o.onSync?.({ headSeq, reconnecting: false }).catch(() => {});
        }
        break;
      }
      case "domain": {
        const parsed = DomainEventSchema.safeParse(JSON.parse(f.data));
        if (parsed.success) this.o.onEvent(parsed.data);
        break;
      }
      case "scopes": {
        try { const d = JSON.parse(f.data) as { requestId: string; accepted: string[]; denied: string[]; removed: string[]; error?: string }; this.acks.get(d.requestId)?.(d); this.acks.delete(d.requestId); } catch { /* ignore */ }
        break;
      }
      case "resync":
      case "reconnect":
        // server asked us to start over (overflow / max-age): drop and reconnect
        this.abort?.abort();
        break;
    }
  }

  private sleep(ms: number) {
    return new Promise<void>(r => { this.retryTimer = setTimeout(r, ms); this.wake = r; });
  }
}
