/**
 * Coalesced "read no older than T" — leader/follower batching.
 *
 * `read(after)` returns the result of a load that STARTED at or after `after`.
 * Concurrent callers share loads instead of each issuing one, so a burst of N
 * connections costs a handful of queries, yet no caller is ever handed a value
 * older than its own subscription (which a plain TTL cache could do — and for
 * the feed head that would silently lose events).
 */
export class FreshRead<T> {
  private running: { startedAt: number; promise: Promise<T> } | null = null;
  private queued: Promise<T> | null = null;
  loads = 0;
  constructor(private readonly load: () => Promise<T>, private readonly now: () => number = () => performance.now()) {}

  read(after: number): Promise<T> {
    if (this.running && this.running.startedAt >= after) return this.running.promise;
    if (!this.queued) {
      const settle = this.running ? this.running.promise.then(() => undefined, () => undefined) : Promise.resolve();
      this.queued = settle.then(() => { this.queued = null; return this.start(); });
    }
    return this.queued;
  }

  private start(): Promise<T> {
    this.loads++;
    const promise = this.load();
    const entry = { startedAt: this.now(), promise };
    this.running = entry;
    const clear = () => { if (this.running === entry) this.running = null; };
    promise.then(clear, clear);
    return promise;
  }
}
