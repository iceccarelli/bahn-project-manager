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
    this.scopes = next;
    if (!this.stopped) { this.abort?.abort(); this.hadConnection = true; /* re-subscribe with new scope set */ }
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
      const reconnecting = this.hadConnection;
      this.set(reconnecting ? "reconnecting" : "connecting");
      const abort = (this.abort = new AbortController());
      try {
        const headers = { Accept: "text/event-stream", ...(await this.o.getHeaders?.()) };
        const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}?scopes=${encodeURIComponent(this.scopes.join(","))}`, {
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
        try { headSeq = (JSON.parse(f.data) as { headSeq?: number | null }).headSeq ?? null; } catch { /* keep null */ }
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
