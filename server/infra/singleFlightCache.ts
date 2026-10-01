/**
 * TTL cache with single-flight loading, for read models that are expensive to
 * compute and cheap to serve (dashboard aggregates, filter options).
 *
 *  - N concurrent requests during a cold/expired entry trigger ONE load.
 *  - Stale-while-revalidate: once an entry exists it is served immediately
 *    even after its TTL while ONE background refresh runs, so latency never
 *    spikes for users when an entry expires.
 *  - A failed refresh keeps serving the previous value (bounded by maxStaleMs).
 *
 * Per-process. With several instances each computes at most once per TTL,
 * which is bounded and cheap; a shared L2 (Redis) is a later optimisation.
 */
import { counter } from "../observability/metrics";

const hits = counter("bahn_cache_hits_total", "Read-model cache hits by name and kind (fresh|stale)");
const misses = counter("bahn_cache_misses_total", "Read-model cache misses (a load ran)");

interface Entry<T> { value: T; at: number; refreshing: Promise<void> | null }

export class SingleFlightCache<T> {
  private entry: Entry<T> | null = null;
  private inflight: Promise<T> | null = null;
  constructor(
    private readonly name: string,
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly maxStaleMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate() { if (this.entry) this.entry.at = 0; }

  async get(): Promise<T> {
    const e = this.entry;
    const age = e ? this.now() - e.at : Infinity;
    if (e && age < this.ttlMs) { hits.inc({ name: this.name, kind: "fresh" }); return e.value; }
    if (e && age < this.maxStaleMs) {
      hits.inc({ name: this.name, kind: "stale" });
      if (!e.refreshing) {
        e.refreshing = this.fill().then(() => undefined, () => undefined).finally(() => { if (this.entry === e) e.refreshing = null; });
      }
      return e.value;
    }
    misses.inc({ name: this.name });
    return this.fill();
  }

  private fill(): Promise<T> {
    if (this.inflight) return this.inflight;
    const p = this.load().then(value => {
      this.entry = { value, at: this.now(), refreshing: null };
      return value;
    }).finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }
}
