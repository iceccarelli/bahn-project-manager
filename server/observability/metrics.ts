/**
 * Minimal in-process metrics with Prometheus text exposition. No dependency:
 * the set of instruments is small and fixed, and a scrape must never allocate
 * proportionally to traffic. Swap for prom-client/OpenTelemetry without
 * touching call sites (they use counter()/gauge()/histogram()).
 */
type Labels = Record<string, string | number>;
const key = (l?: Labels) => (l ? Object.entries(l).sort().map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",") : "");

class Counter {
  private v = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  inc(l?: Labels, n = 1) { const k = key(l); this.v.set(k, (this.v.get(k) ?? 0) + n); }
  get(l?: Labels) { return this.v.get(key(l)) ?? 0; }
  render() { return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`, ...[...this.v].map(([k, n]) => `${this.name}${k ? `{${k}}` : ""} ${n}`)]; }
}
class Gauge {
  private v = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  set(n: number, l?: Labels) { this.v.set(key(l), n); }
  add(n: number, l?: Labels) { const k = key(l); this.v.set(k, (this.v.get(k) ?? 0) + n); }
  get(l?: Labels) { return this.v.get(key(l)) ?? 0; }
  render() { return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, ...[...this.v].map(([k, n]) => `${this.name}${k ? `{${k}}` : ""} ${n}`)]; }
}
const BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
class Histogram {
  private s = new Map<string, { b: number[]; sum: number; n: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets = BUCKETS_MS) {}
  observe(ms: number, l?: Labels) {
    const k = key(l);
    let e = this.s.get(k);
    if (!e) this.s.set(k, (e = { b: new Array(this.buckets.length).fill(0), sum: 0, n: 0 }));
    for (let i = 0; i < this.buckets.length; i++) if (ms <= this.buckets[i]!) e.b[i]!++;
    e.sum += ms; e.n++;
  }
  /** approximate quantile from bucket upper bounds (conservative: rounds up) */
  quantile(q: number, l?: Labels): number | null {
    const e = this.s.get(key(l));
    if (!e || e.n === 0) return null;
    const target = q * e.n;
    for (let i = 0; i < this.buckets.length; i++) if (e.b[i]! >= target) return this.buckets[i]!;
    return Number.POSITIVE_INFINITY;
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, e] of this.s) {
      const sep = k ? "," : "";
      this.buckets.forEach((b, i) => out.push(`${this.name}_bucket{${k}${sep}le="${b}"} ${e.b[i]}`));
      out.push(`${this.name}_bucket{${k}${sep}le="+Inf"} ${e.n}`, `${this.name}_sum${k ? `{${k}}` : ""} ${e.sum}`, `${this.name}_count${k ? `{${k}}` : ""} ${e.n}`);
    }
    return out;
  }
}

const all: Array<{ render(): string[] }> = [];
export const counter = (n: string, h: string) => { const c = new Counter(n, h); all.push(c); return c; };
export const gauge = (n: string, h: string) => { const g = new Gauge(n, h); all.push(g); return g; };
export const histogram = (n: string, h: string) => { const x = new Histogram(n, h); all.push(x); return x; };
export const renderMetrics = () => all.flatMap(m => m.render()).join("\n") + "\n";

// ---- the instruments the system reports ------------------------------------
export const m = {
  httpMs: histogram("bahn_http_request_ms", "tRPC/HTTP request latency in ms"),
  dbMs: histogram("bahn_db_transaction_ms", "Project write transaction latency in ms"),
  mutations: counter("bahn_mutations_total", "Project mutations by outcome (ok|conflict|replay|error)"),
  conflicts: counter("bahn_conflicts_total", "Version conflicts detected"),
  rtConnections: gauge("bahn_realtime_connections", "Open realtime (SSE) connections on this instance"),
  rtSubscriptions: gauge("bahn_realtime_channel_subscriptions", "Active channel subscriptions on this instance"),
  rtReconnects: counter("bahn_realtime_connects_total", "Realtime connections accepted (reconnects included)"),
  rtErrors: counter("bahn_realtime_gateway_errors_total", "Gateway handler failures answered with 503"),
  unhandled: counter("bahn_unhandled_rejections_total", "Unhandled promise rejections caught by the process-level handler"),
  rtNotificationsThrottled: counter("bahn_realtime_notifications_throttled_total", "Notification frames collapsed into a hint by per-stream delivery throttling"),
  rtDelivered: counter("bahn_realtime_events_delivered_total", "Events written to subscribers"),
  rtDropped: counter("bahn_realtime_events_dropped_total", "Events dropped for slow consumers (client is told to resync)"),
  rtEventAgeMs: histogram("bahn_realtime_event_age_ms", "Event age (now - envelope.timestamp) when delivered to a subscriber"),
  outboxPublished: counter("bahn_outbox_published_total", "Outbox events published"),
  outboxFailures: counter("bahn_outbox_publish_failures_total", "Outbox publish failures"),
  authVerifyMs: histogram("bahn_auth_verify_ms", "OIDC token verification (signature, claims) in ms"),
  identityMs: histogram("bahn_identity_resolve_ms", "Total identity resolution per request in ms (cache hits included)"),
  shed: counter("bahn_requests_shed_total", "Requests rejected with 429 because the DB pool queue was full"),
  outboxDeadLetters: counter("bahn_outbox_dead_letters_total", "Outbox rows quarantined because they can never be published (alert on > 0)"),
  redisUp: gauge("bahn_redis_up", "1 when the shared Redis answered the last readiness/sampler ping, 0 when it did not (alert on 0)"),
  outboxBacklog: gauge("bahn_outbox_backlog", "Unpublished outbox events (sampled)"),
  poolInUse: gauge("bahn_db_pool_connections_in_use", "DB pool connections in use (sampled)"),
  poolQueued: gauge("bahn_db_pool_queued_requests", "DB pool waiters (sampled)"),
};
