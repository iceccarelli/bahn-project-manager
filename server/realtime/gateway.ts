/**
 * Realtime gateway: Server-Sent Events over plain HTTP.
 *
 *   GET /api/realtime/stream?scopes=project:12,workspace:frankfurt
 *
 * Why SSE (decision recorded in docs/realtime.md): traffic is server→client
 * (events); client→server actions are ordinary authenticated tRPC calls.
 * SSE needs no sticky sessions, passes proxies, reconnects natively, and each
 * open stream costs one socket and one small object here. WebSockets add
 * bidirectional framing this product does not use.
 *
 * Security: identity is resolved from the request (bearer or cookie) and every
 * requested scope is authorized individually. Denied scopes are reported in the
 * `hello` frame and are never subscribed.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { isValidScope } from "@shared/domain-events";
import { PRESENCE_STATES, PresenceRateLimited, type PresenceService, type PresenceState } from "./presence";
import { canSubscribe, canViewProject, workspaceRestriction, type Principal } from "../domain/permissions";
import { OVERFLOW, type ProjectStore, type RealtimeSubscriber, type SubscriptionIterator } from "../domain/ports";
import { resolveIdentity } from "../_core/identity";
import { eventForPrincipal } from "../domain/eventVisibility";
import { FreshRead } from "../infra/freshRead";
import { m } from "../observability/metrics";
import { traceIdFrom } from "../observability/trace";

export interface GatewayOptions {
  subscriber: RealtimeSubscriber;
  store: Pick<ProjectStore, "versions"> & Partial<Pick<ProjectStore, "feedHead">>;
  resolve?: (req: Request) => Promise<{ principal: Principal } | null>;
  heartbeatMs?: number;
  /** connections older than this are closed so token expiry/revocation is re-evaluated */
  maxAgeMs?: number;
  maxScopes?: number;
  /** ceiling on scopes a live stream may hold after dynamic updates (initial subscribe is bounded by maxScopes) */
  maxStreamScopes?: number;
  /** how long to wait for the transport to confirm the subscriptions before refusing the stream (503) */
  readyTimeoutMs?: number;
  /** live notification frames per stream per window before the rest is collapsed into a `hint` */
  notificationBurst?: number;
  notificationWindowMs?: number;
  /** identity of this process for routing stream-control messages between instances */
  nodeId?: string;
  maxConnectionsPerPrincipal?: number;
  maxConnections?: number;
  onError?: (e: unknown) => void;
}

export function registerRealtimeGateway(app: Express, opt: GatewayOptions) {
  const heartbeatMs = opt.heartbeatMs ?? 15_000;
  const maxAgeMs = opt.maxAgeMs ?? 15 * 60_000;
  const maxScopes = opt.maxScopes ?? 50;
  const perPrincipal = opt.maxConnectionsPerPrincipal ?? Number(process.env.RT_MAX_PER_PRINCIPAL ?? 20);
  const maxConnections = opt.maxConnections ?? Number(process.env.RT_MAX_CONNECTIONS ?? 50_000);
  const resolve = opt.resolve ?? (req => resolveIdentity(req));
  const head = opt.store.feedHead ? new FreshRead(() => opt.store.feedHead!()) : null;
  const open = new Map<string, number>();
  let total = 0;
  const readyTimeoutMs = opt.readyTimeoutMs ?? Number(process.env.RT_READY_TIMEOUT_MS ?? 3000);
  const maxStreamScopes = opt.maxStreamScopes ?? Number(process.env.RT_MAX_STREAM_SCOPES ?? 400);
  const nodeId = opt.nodeId ?? randomUUID().slice(0, 8);

  // ---- live streams of THIS process, addressable by id so their scopes can change without reconnecting ----
  interface Stream { principal: Principal; it: SubscriptionIterator; push(event: string, data: unknown): void; end(): void; lastUpdate: number; recentUpdates: number }
  const streams = new Map<string, Stream>();
  // Redis came back: whatever was published during the gap never reached us. Every open stream re-reads the durable feed
  // (and its notification inbox) now — recovery is prompt and does not depend on the next event or the 30 s client poll.
  opt.subscriber.onTransportRecovered?.(() => { for (const st of streams.values()) { st.push("hint", { kind: "catchup" }); st.push("hint", { kind: "notifications" }); } });

  /** Authorize + apply a scope change on a stream owned by this process. Answers on the stream itself. */
  async function applyScopes(streamId: string, principalId: string, requestId: string, add: string[], remove: string[]) {
    const st = streams.get(streamId);
    if (!st || st.principal.id !== principalId) return; // not ours / not yours: silent (the HTTP side already answered 202)
    const now = Date.now();
    if (now - st.lastUpdate > 1000) { st.lastUpdate = now; st.recentUpdates = 0; }
    if (++st.recentUpdates > 20) { st.push("scopes", { requestId, accepted: [], denied: add, removed: [], error: "rate limited" }); return; }
    const restricted = workspaceRestriction(st.principal) !== null;
    const ids = restricted ? add.filter(x => x.startsWith("project:")).map(x => Number(x.slice(8))).filter(Number.isInteger) : [];
    const known = ids.length ? await opt.store.versions(ids) : new Map<number, { version: number; bahnhofsmanagement: string | null }>();
    const accepted: string[] = [], denied: string[] = [];
    for (const x of add) {
      let ok = canSubscribe(st.principal, x);
      if (ok && restricted && x.startsWith("project:")) { const v = known.get(Number(x.slice(8))); ok = !!v && canViewProject(st.principal, { bahnhofsmanagement: v.bahnhofsmanagement }); }
      if (ok && !st.it.channels.has(x) && st.it.channels.size - remove.length + accepted.length >= maxStreamScopes) ok = false;
      (ok ? accepted : denied).push(x);
    }
    try {
      await st.it.update({ add: accepted, remove });
      // Sent only AFTER the transport confirmed the new channels: from this frame on nothing published to them is missed.
      st.push("scopes", { requestId, accepted, denied, removed: remove, total: st.it.channels.size });
    } catch {
      st.push("scopes", { requestId, accepted: [], denied: add, removed: [], error: "subscribe failed" });
    }
  }
  const ctl = opt.subscriber.control;
  if (ctl) void ctl.onControl(nodeId, msg => {
    const c = msg as { streamId?: string; principalId?: string; requestId?: string; add?: string[]; remove?: string[] };
    if (c?.streamId && c.principalId && c.requestId) void applyScopes(c.streamId, c.principalId, c.requestId, c.add ?? [], c.remove ?? []).catch(e => opt.onError?.(e));
  }).catch(e => opt.onError?.(e));

  app.post("/api/realtime/scopes", async (req: Request, res: Response) => {
    try {
      const identity = await resolve(req);
      if (!identity) { res.status(401).json({ error: "unauthenticated" }); return; }
      const b = (req.body ?? {}) as { streamId?: unknown; requestId?: unknown; add?: unknown; remove?: unknown };
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
      const add = list(b.add), remove = list(b.remove);
      if (typeof b.streamId !== "string" || typeof b.requestId !== "string" || b.requestId.length > 64 || add.length + remove.length === 0 || add.length > 200 || remove.length > 200
        || ![...add, ...remove].every(isValidScope)) { res.status(400).json({ error: "streamId, requestId and 1-200 valid scopes required" }); return; }
      const owner = b.streamId.split(".")[0] ?? "";
      if (owner === nodeId) {
        if (streams.get(b.streamId)?.principal.id !== identity.principal.id) { res.status(404).json({ error: "stream not found" }); return; }
        void applyScopes(b.streamId, identity.principal.id, b.requestId, add, remove).catch(e => opt.onError?.(e));
      } else {
        const delivered = ctl ? await ctl.sendControl(owner, { streamId: b.streamId, principalId: identity.principal.id, requestId: b.requestId, add, remove }) : false;
        if (!delivered) { res.status(404).json({ error: "stream not found" }); return; }
      }
      res.status(202).json({ accepted: true });
    } catch (e) {
      m.rtErrors.inc();
      res.status(503).set("Retry-After", "2").json({ error: "temporarily unavailable" });
      opt.onError?.(e);
    }
  });

  app.get("/api/realtime/stream", async (req: Request, res: Response) => {
    // Express 4 does not catch async errors: an escaped rejection would take the
    // whole process (and every open stream) down. Every failure becomes a 503.
    try {
      await handle(req, res);
    } catch (e) {
      m.rtErrors.inc();
      if (!res.headersSent) res.status(503).set("Retry-After", "2").json({ error: "temporarily unavailable" });
      else if (!res.writableEnded) res.end();
      opt.onError?.(e);
    }
  });

  async function handle(req: Request, res: Response) {
    const identity = await resolve(req);
    if (!identity) { res.status(401).json({ error: "unauthenticated" }); return; }
    const principal = identity.principal;

    if (total >= maxConnections) { res.status(503).set("Retry-After", "5").json({ error: "at capacity" }); return; }
    if ((open.get(principal.id) ?? 0) >= perPrincipal) { res.status(429).json({ error: "too many streams" }); return; }

    const requested = String(req.query.scopes ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (requested.length === 0 || requested.length > maxScopes || !requested.every(isValidScope)) {
      res.status(400).json({ error: `1-${maxScopes} valid scopes required` });
      return;
    }

    // Project channels are authorized against the project's workspace.
    // Only workspace-restricted principals need the row; everyone else may
    // subscribe to any project channel (a channel for a missing project is inert).
    const restricted = workspaceRestriction(principal) !== null;
    const projectIds = restricted ? requested.filter(s => s.startsWith("project:")).map(s => Number(s.slice(8))).filter(Number.isInteger) : [];
    const known = projectIds.length ? await opt.store.versions(projectIds) : new Map<number, { version: number; bahnhofsmanagement: string | null }>();
    const accepted: string[] = [];
    const denied: string[] = [];
    for (const s of requested) {
      let ok = canSubscribe(principal, s);
      if (ok && restricted && s.startsWith("project:")) {
        const v = known.get(Number(s.slice(8)));
        ok = !!v && canViewProject(principal, { bahnhofsmanagement: v.bahnhofsmanagement });
      }
      (ok ? accepted : denied).push(s);
    }
    if (accepted.length === 0) { res.status(403).json({ error: "no authorized scopes", denied }); return; }

    // Subscribe FIRST and wait for the transport's confirmation (Redis: SUBSCRIBE acknowledged) BEFORE
    // anything else: the head read below and the hello that follows are only meaningful once every
    // event published from now on is guaranteed to reach this stream.
    const abort = new AbortController();
    const earlyClose = () => abort.abort();
    req.on("close", earlyClose);
    const iterator = opt.subscriber.subscribe({ channels: accepted, signal: abort.signal })[Symbol.asyncIterator]();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([iterator.ready, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("subscription not confirmed")), readyTimeoutMs); })]);
    } catch (e) {
      abort.abort(); await iterator.return?.();
      req.off("close", earlyClose);
      if (!res.headersSent) res.status(503).set("Retry-After", "2").json({ error: "realtime transport not ready" });
      opt.onError?.(e);
      return;
    } finally { clearTimeout(timer); }
    req.off("close", earlyClose);
    if (abort.signal.aborted) { await iterator.return?.(); return; }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-trace-id": traceIdFrom(req.headers),
    });
    res.write("retry: 3000\n\n");
    const frame = (event: string, data: unknown, id?: string) =>
      res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const streamId = `${nodeId}.${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    total++; m.rtConnections.add(1); m.rtReconnects.inc();
    open.set(principal.id, (open.get(principal.id) ?? 0) + 1);
    streams.set(streamId, { principal, it: iterator, push: frame, end: () => finish(), lastUpdate: 0, recentUpdates: 0 });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(hb); clearTimeout(age);
      streams.delete(streamId);
      abort.abort();
      total--; m.rtConnections.add(-1);
      const n = (open.get(principal.id) ?? 1) - 1;
      if (n <= 0) open.delete(principal.id); else open.set(principal.id, n);
      if (!res.writableEnded) res.end();
    };
    req.on("close", finish);
    res.on("error", finish);

    const hb = setInterval(() => res.write(": hb\n\n"), heartbeatMs);
    const age = setTimeout(() => { frame("reconnect", { reason: "max-age" }); finish(); }, maxAgeMs);
    hb.unref?.(); age.unref?.();

    const subscribedAt = performance.now(); // the subscription is already confirmed
    // Read the head AFTER the confirmed subscribe: anything numbered later reaches us live;
    // anything at or below it that we have not seen is fetched via projects.changes.
    // Coalesced: a login burst shares a handful of queries, and every caller still
    // gets a head read that started AFTER its own (confirmed) subscription.
    const headSeq = (await head?.read(subscribedAt).catch(() => undefined)) ?? null;
    frame("hello", { serverTime: new Date().toISOString(), scopes: accepted, denied, headSeq, streamId });

    const notifTimes: number[] = []; let lastHint = 0;
    const notifBurst = opt.notificationBurst ?? Number(process.env.RT_NOTIF_BURST ?? 5), notifWindowMs = opt.notificationWindowMs ?? 10_000;
    try {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done || finished) break;
        if (value === OVERFLOW) { frame("resync", { reason: "overflow" }); break; }
        // Channels only route. What THIS recipient may see is decided per event,
        // per recipient — a project channel opened before a workspace move must
        // not receive the post-move state.
        const visible = eventForPrincipal(principal, value);
        if (!visible) continue;
        // Notification delivery is throttled per stream: a burst becomes the first few live frames and then ONE
        // `hint` per window telling the client to re-read its (durable, SQL) inbox. Nothing is lost: the rows exist.
        if (visible.aggregateType === "notification") {
          const t = Date.now();
          while (notifTimes.length && t - notifTimes[0]! > notifWindowMs) notifTimes.shift();
          if (notifTimes.length >= notifBurst) {
            if (t - lastHint >= notifWindowMs / 2) { lastHint = t; frame("hint", { kind: "notifications" }); m.rtNotificationsThrottled.inc(); }
            continue;
          }
          notifTimes.push(t);
        }
        m.rtEventAgeMs.observe(Math.max(0, Date.now() - Date.parse(visible.timestamp)));
        m.rtDelivered.inc();
        const ok = frame("domain", visible, visible.eventId);
        if (!ok) await new Promise<void>(r => res.once("drain", r).once("close", r));
      }
    } finally {
      await iterator.return?.();
      finish();
    }
  }

  return {
    /** Graceful shutdown: tell every open stream to reconnect elsewhere and end it now (do not hold the drain open for minutes). */
    drain() { for (const st of [...streams.values()]) { try { st.push("reconnect", { reason: "shutdown" }); } catch { /* socket already gone */ } st.end(); } },
  };
}



/**
 * Presence HTTP API (heartbeat / leave / snapshot). Same identity, same scope
 * authorization as the stream; state lives in Redis (or memory), never in SQL.
 */
export function registerPresenceRoutes(
  app: Express,
  opt: { presence: PresenceService; store: Pick<ProjectStore, "versions">; resolve?: (req: Request) => Promise<{ principal: Principal } | null>; onError?: (e: unknown) => void },
) {
  const resolve = opt.resolve ?? (req => resolveIdentity(req));
  const authorize = async (req: Request, res: Response, scopeKey: unknown): Promise<{ principal: Principal; workspace: string | null } | null> => {
    const identity = await resolve(req);
    if (!identity) { res.status(401).json({ error: "unauthenticated" }); return null; }
    const p = identity.principal;
    if (typeof scopeKey !== "string" || !isValidScope(scopeKey) || !canSubscribe(p, scopeKey)) { res.status(403).json({ error: "scope not allowed" }); return null; }
    let workspace: string | null = null;
    if (scopeKey.startsWith("project:")) {
      const id = Number(scopeKey.slice(8));
      const v = Number.isInteger(id) ? (await opt.store.versions([id])).get(id) : undefined;
      if (!v || !canViewProject(p, { bahnhofsmanagement: v.bahnhofsmanagement })) { res.status(403).json({ error: "scope not allowed" }); return null; }
      workspace = v.bahnhofsmanagement;
    } else if (scopeKey.startsWith("workspace:")) workspace = null;
    return { principal: p, workspace };
  };
  const guard = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (e) { m.rtErrors.inc(); opt.onError?.(e); if (!res.headersSent) res.status(503).json({ error: "temporarily unavailable" }); }
  };
  app.post("/api/realtime/presence", guard(async (req, res) => {
    const { scope: sc, state, tabId } = (req.body ?? {}) as { scope?: unknown; state?: unknown; tabId?: unknown };
    if (!(PRESENCE_STATES as readonly unknown[]).includes(state) || typeof tabId !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(tabId)) { res.status(400).json({ error: "invalid presence" }); return; }
    const a = await authorize(req, res, sc); if (!a) return;
    try { await opt.presence.heartbeat(sc as string, { userId: a.principal.id, name: a.principal.name, tabId, state: state as PresenceState }, a.workspace); }
    catch (e) { if (e instanceof PresenceRateLimited) { res.status(429).set("Retry-After", "10").json({ error: "too many presence updates" }); return; } throw e; }
    res.status(204).end();
  }));
  app.delete("/api/realtime/presence", guard(async (req, res) => {
    const a = await authorize(req, res, req.query.scope); if (!a) return;
    const tabId = String(req.query.tabId ?? "");
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(tabId)) { res.status(400).json({ error: "invalid tab" }); return; }
    try { await opt.presence.leave(req.query.scope as string, a.principal.id, tabId, a.workspace); }
    catch (e) { if (e instanceof PresenceRateLimited) { res.status(429).set("Retry-After", "10").json({ error: "too many presence updates" }); return; } throw e; }
    res.status(204).end();
  }));
  app.get("/api/realtime/presence", guard(async (req, res) => {
    const a = await authorize(req, res, req.query.scope); if (!a) return;
    res.json({ scope: req.query.scope, members: await opt.presence.list(req.query.scope as string) });
  }));
}
