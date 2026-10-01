/**
 * Ephemeral presence: who is looking at / editing what, right now.
 *
 * Storage is Redis (or memory when there is no Redis) with a TTL per member —
 * NEVER the SQL database: a heartbeat every 15 s from thousands of users would
 * be the hottest write path in the system for data that is worthless a minute
 * later. A member that stops heartbeating disappears when its TTL lapses.
 *
 * Delivery reuses the event envelope and transport (`presence.changed`, a full
 * snapshot of one scope), so authorization, scoping and fan-out are the same
 * code paths as every other event. Presence events are published directly; they
 * are not stored, not numbered in the change feed, and lost ones are healed by
 * the next snapshot.
 */
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { EVENT_SCHEMA_VERSION, isValidScope, type DomainEvent, type ScopeKey } from "@shared/domain-events";
import type { RealtimePublisher } from "../domain/ports";

export const PRESENCE_STATES = ["online", "away", "idle", "viewing", "editing"] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** what a viewer sees: one row per USER (their most active tab wins) */
export interface PresenceEntry { userId: string; name: string | null; state: PresenceState; since: string; tabs: number }

interface Member { userId: string; tabId: string; name: string | null; state: PresenceState; since: string; expiresAt: number }

const RANK: Record<PresenceState, number> = { editing: 5, viewing: 4, online: 3, idle: 2, away: 1 };

export function aggregate(members: Member[]): PresenceEntry[] {
  const by = new Map<string, Member[]>();
  for (const m of members) (by.get(m.userId) ?? by.set(m.userId, []).get(m.userId)!).push(m);
  return [...by.values()]
    .map(ms => {
      const best = ms.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
      return { userId: best.userId, name: best.name, state: best.state, since: best.since, tabs: ms.length };
    })
    .sort((a, b) => RANK[b.state] - RANK[a.state] || (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));
}

export interface PresenceStore {
  /** returns true when the scope's visible snapshot changed */
  heartbeat(scope: ScopeKey, m: Omit<Member, "expiresAt" | "since">, ttlMs: number, now?: number): Promise<boolean>;
  leave(scope: ScopeKey, userId: string, tabId: string): Promise<boolean>;
  list(scope: ScopeKey, now?: number): Promise<PresenceEntry[]>;
  /** drop expired members; returns scopes whose snapshot changed */
  sweep(now?: number): Promise<ScopeKey[]>;
  /** the workspace a project scope belongs to (remembered so an empty snapshot is still routable) */
  workspaceOf(scope: ScopeKey): Promise<string | null>;
  setWorkspace(scope: ScopeKey, workspace: string | null): Promise<void>;
}

const sig = (es: PresenceEntry[]) => es.map(e => `${e.userId}:${e.state}:${e.tabs}`).join("|");

export class MemoryPresenceStore implements PresenceStore {
  private ws = new Map<ScopeKey, string>();
  async workspaceOf(scope: ScopeKey) { return this.ws.get(scope) ?? null; }
  async setWorkspace(scope: ScopeKey, w: string | null) { if (w) this.ws.set(scope, w); }
  private scopes = new Map<ScopeKey, Map<string, Member>>();
  private slot(scope: ScopeKey) { return this.scopes.get(scope) ?? this.scopes.set(scope, new Map()).get(scope)!; }
  private live(scope: ScopeKey, now: number) {
    const s = this.scopes.get(scope);
    if (!s) return [];
    for (const [k, m] of s) if (m.expiresAt <= now) s.delete(k);
    if (!s.size) this.scopes.delete(scope);
    return [...(this.scopes.get(scope)?.values() ?? [])];
  }
  async heartbeat(scope: ScopeKey, m: Omit<Member, "expiresAt" | "since">, ttlMs: number, now = Date.now()) {
    const before = sig(aggregate(this.live(scope, now)));
    const key = `${m.userId}:${m.tabId}`;
    const prev = this.slot(scope).get(key);
    this.slot(scope).set(key, { ...m, since: prev && prev.state === m.state ? prev.since : new Date(now).toISOString(), expiresAt: now + ttlMs });
    return sig(aggregate(this.live(scope, now))) !== before;
  }
  async leave(scope: ScopeKey, userId: string, tabId: string) {
    const now = Date.now();
    const before = sig(aggregate(this.live(scope, now)));
    this.scopes.get(scope)?.delete(`${userId}:${tabId}`);
    return sig(aggregate(this.live(scope, now))) !== before;
  }
  async list(scope: ScopeKey, now = Date.now()) { return aggregate(this.live(scope, now)); }
  async sweep(now = Date.now()) {
    const changed: ScopeKey[] = [];
    for (const scope of [...this.scopes.keys()]) {
      const before = this.scopes.get(scope)!.size;
      this.live(scope, now);
      if ((this.scopes.get(scope)?.size ?? 0) !== before) changed.push(scope);
    }
    return changed;
  }
}

/** Redis: HASH scope → member JSON, ZSET scope → expiry; SET of active scopes for the sweeper. */
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly r: Redis, private readonly prefix = "bahn:pres:") {}
  private h = (s: string) => `${this.prefix}h:${s}`;
  private z = (s: string) => `${this.prefix}z:${s}`;
  private get scopesKey() { return `${this.prefix}scopes`; }
  private get wsKey() { return `${this.prefix}ws`; }

  async workspaceOf(scope: ScopeKey) { return (await this.r.hget(this.wsKey, scope)) ?? null; }
  async setWorkspace(scope: ScopeKey, w: string | null) { if (w) await this.r.hset(this.wsKey, scope, w); }

  private async prune(scope: ScopeKey, now: number) {
    const dead = await this.r.zrangebyscore(this.z(scope), "-inf", now);
    if (dead.length) await this.r.multi().hdel(this.h(scope), ...dead).zrem(this.z(scope), ...dead).exec();
  }
  private async members(scope: ScopeKey, now: number): Promise<Member[]> {
    await this.prune(scope, now);
    const raw = await this.r.hvals(this.h(scope));
    return raw.map(x => JSON.parse(x) as Member);
  }
  async heartbeat(scope: ScopeKey, m: Omit<Member, "expiresAt" | "since">, ttlMs: number, now = Date.now()) {
    const before = sig(aggregate(await this.members(scope, now)));
    const key = `${m.userId}:${m.tabId}`;
    const prevRaw = await this.r.hget(this.h(scope), key);
    const prev = prevRaw ? (JSON.parse(prevRaw) as Member) : null;
    const member: Member = { ...m, since: prev && prev.state === m.state ? prev.since : new Date(now).toISOString(), expiresAt: now + ttlMs };
    await this.r.multi()
      .hset(this.h(scope), key, JSON.stringify(member)).zadd(this.z(scope), member.expiresAt, key)
      .pexpire(this.h(scope), ttlMs * 6).pexpire(this.z(scope), ttlMs * 6).sadd(this.scopesKey, scope).exec();
    return sig(aggregate(await this.members(scope, now))) !== before;
  }
  async leave(scope: ScopeKey, userId: string, tabId: string) {
    const now = Date.now();
    const before = sig(aggregate(await this.members(scope, now)));
    const key = `${userId}:${tabId}`;
    await this.r.multi().hdel(this.h(scope), key).zrem(this.z(scope), key).exec();
    return sig(aggregate(await this.members(scope, now))) !== before;
  }
  async list(scope: ScopeKey, now = Date.now()) { return aggregate(await this.members(scope, now)); }
  async sweep(now = Date.now()) {
    const changed: ScopeKey[] = [];
    for (const scope of await this.r.smembers(this.scopesKey)) {
      const before = (await this.r.hlen(this.h(scope)));
      const live = await this.members(scope, now);
      if (live.length !== before) changed.push(scope);
      if (!live.length) await this.r.srem(this.scopesKey, scope);
    }
    return changed;
  }
}

export function presenceEvent(scope: ScopeKey, entries: PresenceEntry[], workspace: string | null, now = Date.now()): DomainEvent {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION, eventId: randomUUID(), eventType: "presence.changed", aggregateType: "presence",
    aggregateId: scope, aggregateVersion: Math.max(1, now), actorId: "system", timestamp: new Date(now).toISOString(), traceId: "presence",
    changes: { members: { from: null, to: JSON.stringify(entries) } },
    context: { workspace },
  };
}

export const TTL_MS = 45_000;

export interface PresenceLimits {
  /** the same (user, tab, scope, state) heartbeat inside this window is a no-op: it never reaches Redis */
  minHeartbeatIntervalMs: number;
  /** at most one snapshot publish per scope per window; changes inside it are merged into ONE trailing publish */
  coalesceMs: number;
  /** per-user ceiling on heartbeat/leave calls (all scopes together) per window */
  perUserMax: number;
  perUserWindowMs: number;
}
export const DEFAULT_LIMITS: PresenceLimits = {
  minHeartbeatIntervalMs: Number(process.env.PRESENCE_MIN_INTERVAL_MS ?? 5_000),
  coalesceMs: Number(process.env.PRESENCE_COALESCE_MS ?? 500),
  perUserMax: Number(process.env.PRESENCE_USER_MAX ?? 40),
  perUserWindowMs: 10_000,
};
export class PresenceRateLimited extends Error {}

/**
 * Presence must never become a write hotspot. Three layers, none of which touch SQL:
 *   1. per-user ceiling (a misbehaving client cannot flood Redis),
 *   2. per-(user,tab,scope,state) heartbeat throttle (duplicate beats are dropped before Redis),
 *   3. per-scope publish coalescing (a join storm yields one trailing snapshot, not N).
 * State CHANGES (viewing → editing, a new scope, a leave) are never throttled: only repeats are.
 */
export class PresenceService {
  private lastBeat = new Map<string, { at: number; state: PresenceState }>();
  private userWindow = new Map<string, { start: number; n: number }>();
  private pending = new Map<ScopeKey, { timer: ReturnType<typeof setTimeout>; workspace: string | null }>();
  private lastPublish = new Map<ScopeKey, number>();
  readonly stats = { heartbeats: 0, throttled: 0, rateLimited: 0, published: 0, coalesced: 0 };

  constructor(
    private readonly store: PresenceStore,
    private readonly publisher: RealtimePublisher,
    private readonly limits: PresenceLimits = DEFAULT_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {}

  private admit(userId: string) {
    const now = this.clock();
    const w = this.userWindow.get(userId);
    if (!w || now - w.start > this.limits.perUserWindowMs) { this.userWindow.set(userId, { start: now, n: 1 }); this.bound(this.userWindow); return; }
    if (++w.n > this.limits.perUserMax) { this.stats.rateLimited++; throw new PresenceRateLimited(); }
  }
  /** keep the bookkeeping maps bounded (a long-running process sees many users) */
  private bound(m: Map<string, unknown>) { if (m.size > 20_000) m.delete(m.keys().next().value as string); }

  async heartbeat(scope: ScopeKey, who: { userId: string; name: string | null; tabId: string; state: PresenceState }, workspace: string | null) {
    if (!isValidScope(scope)) throw new Error("bad scope");
    this.admit(who.userId);
    this.stats.heartbeats++;
    const key = `${scope}|${who.userId}|${who.tabId}`;
    const now = this.clock();
    const prev = this.lastBeat.get(key);
    if (prev && prev.state === who.state && now - prev.at < this.limits.minHeartbeatIntervalMs) { this.stats.throttled++; return; }
    this.lastBeat.set(key, { at: now, state: who.state }); this.bound(this.lastBeat);
    if (workspace) await this.store.setWorkspace(scope, workspace);
    const changed = await this.store.heartbeat(scope, who, TTL_MS);
    if (changed) this.schedulePublish(scope, workspace);
  }
  async leave(scope: ScopeKey, userId: string, tabId: string, workspace: string | null) {
    this.admit(userId);
    this.lastBeat.delete(`${scope}|${userId}|${tabId}`);
    if (await this.store.leave(scope, userId, tabId)) this.schedulePublish(scope, workspace);
  }
  list(scope: ScopeKey) { return this.store.list(scope); }
  async sweep() { for (const scope of await this.store.sweep()) this.schedulePublish(scope, await this.store.workspaceOf(scope)); }

  /** leading edge immediately, then at most one trailing publish per coalescing window */
  private schedulePublish(scope: ScopeKey, workspace: string | null) {
    const now = this.clock();
    const last = this.lastPublish.get(scope) ?? 0;
    const pend = this.pending.get(scope);
    if (pend) { this.stats.coalesced++; return; }               // a trailing publish is already queued: it will carry the latest snapshot
    if (now - last >= this.limits.coalesceMs) { void this.publish(scope, workspace); return; }
    const timer = setTimeout(() => { this.pending.delete(scope); void this.publish(scope, workspace); }, this.limits.coalesceMs - (now - last));
    (timer as { unref?: () => void }).unref?.();
    this.pending.set(scope, { timer, workspace });
  }
  private async publish(scope: ScopeKey, workspace: string | null) {
    this.lastPublish.set(scope, this.clock()); this.bound(this.lastPublish as Map<string, unknown>);
    this.stats.published++;
    // always the CURRENT snapshot, whatever happened since this publish was scheduled
    await this.publisher.publish(presenceEvent(scope, await this.store.list(scope), workspace)).catch(() => {});
  }
  /** test/shutdown hook */
  flush() { for (const [, p] of this.pending) clearTimeout(p.timer); this.pending.clear(); }
}
