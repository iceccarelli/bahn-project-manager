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
import type { Express, Request, Response } from "express";
import { isValidScope } from "@shared/domain-events";
import { canSubscribe, canViewProject, workspaceRestriction, type Principal } from "../domain/permissions";
import { OVERFLOW, type ProjectStore, type RealtimeSubscriber } from "../domain/ports";
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

    const abort = new AbortController();
    total++; m.rtConnections.add(1); m.rtReconnects.inc();
    open.set(principal.id, (open.get(principal.id) ?? 0) + 1);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(hb); clearTimeout(age);
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

    // Subscribe BEFORE announcing hello so nothing published after the client
    // learns it is connected can be missed.
    const iterator = opt.subscriber.subscribe({ channels: accepted, signal: abort.signal })[Symbol.asyncIterator]();
    const subscribedAt = performance.now();
    // Read the head AFTER subscribing: anything numbered later reaches us live;
    // anything at or below it that we have not seen is fetched via projects.changes.
    // Coalesced: a login burst shares a handful of queries, and every caller still
    // gets a head read that started AFTER its own subscription.
    const headSeq = (await head?.read(subscribedAt).catch(() => undefined)) ?? null;
    frame("hello", { serverTime: new Date().toISOString(), scopes: accepted, denied, headSeq });

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
}

