/**
 * Composition root for the realtime/data plane. The only file that knows which
 * concrete adapters are in use; everything else takes ports.
 *
 *   REDIS_URL set   → RedisBus  (multi-instance fan-out)
 *   REDIS_URL unset → InProcessBus (single instance; fine for dev and one node)
 */
import type { Pool } from "mysql2/promise";
import { getDb, getPool, getRelayPool } from "../db";
import { ProjectService } from "../domain/projectService";
import type { RealtimePublisher, RealtimeSubscriber } from "../domain/ports";
import { MysqlProjectStore } from "../infra/mysqlProjectStore";
import { MysqlOutbox } from "../infra/mysqlOutbox";
import { m } from "../observability/metrics";
import { InProcessBus } from "../realtime/hub";
import { RedisBus } from "../realtime/redisBus";
import { OutboxRelay } from "../realtime/relay";

export interface Services {
  store: MysqlProjectStore;
  projects: ProjectService;
  publisher: RealtimePublisher;
  subscriber: RealtimeSubscriber;
  relay: OutboxRelay;
  pool: Pool;
  shutdown(): Promise<void>;
}

let services: Services | null = null;

export async function getServices(log: (msg: string, e?: unknown) => void = console.error): Promise<Services | null> {
  if (services) return services;
  const db = await getDb();
  const pool = getPool();
  const relayPool = getRelayPool();
  if (!db || !pool || !relayPool) return null;

  let bus: RealtimePublisher & RealtimeSubscriber;
  const closers: Array<() => Promise<unknown>> = [];
  if (process.env.REDIS_URL) {
    const { default: IORedis } = await import("ioredis");
    const pub = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
    const sub = new IORedis(process.env.REDIS_URL);
    pub.on("error", e => log("[redis:pub]", e));
    sub.on("error", e => log("[redis:sub]", e));
    bus = new RedisBus(pub, sub, e => log("[redis:bus]", e));
    closers.push(() => pub.quit(), () => sub.quit());
  } else {
    bus = new InProcessBus();
  }

  const store = new MysqlProjectStore(db as never);
  const outbox = new MysqlOutbox(relayPool);
  const relay = new OutboxRelay(outbox, bus, { onError: e => log("[outbox]", e) });
  const svc = new ProjectService(store, relay.nudge);

  // Sampled gauges: cheap, and they make saturation visible before it hurts.
  const sampler = setInterval(async () => {
    try {
      m.outboxBacklog.set(await outbox.backlog());
      const p = (pool as any).pool;
      if (p) {
        m.poolInUse.set((p._allConnections?.length ?? 0) - (p._freeConnections?.length ?? 0));
        m.poolQueued.set(p._connectionQueue?.length ?? 0);
      }
    } catch { /* metrics must never break the process */ }
  }, 5000);
  sampler.unref();

  relay.start();
  services = {
    store, projects: svc, publisher: bus, subscriber: bus, relay, pool,
    async shutdown() {
      clearInterval(sampler);
      await relay.stop();
      await Promise.allSettled(closers.map(c => c()));
    },
  };
  return services;
}

export async function requireServices(): Promise<Services> {
  const s = await getServices();
  if (!s) throw new Error("Database not configured");
  return s;
}
