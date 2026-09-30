/**
 * Outbox relay: reads committed-but-unpublished events in id order, publishes
 * them, then stamps processedAt. At-least-once: a crash after publish and
 * before the stamp re-publishes on restart, so consumers de-duplicate on eventId.
 *
 * Exactly one relay runs at a time cluster-wide (advisory lock inside the
 * store), which keeps per-aggregate publish order equal to version order.
 */
import { DomainEventSchema, type DomainEvent } from "@shared/domain-events";
import type { RealtimePublisher } from "../domain/ports";
import { m } from "../observability/metrics";

export interface OutboxStore {
  /**
   * Under the cluster-wide relay lock, hand up to `limit` unpublished events
   * (oldest first) to `publish`; acknowledge those it accepted, stop at the
   * first rejection. Returns null if another instance holds the lock.
   */
  drain(limit: number, publish: (e: DomainEvent) => Promise<void>): Promise<{ published: number; failure?: unknown } | null>;
  backlog(): Promise<number>;
}

export interface RelayOptions { batch?: number; pollMs?: number; maxBackoffMs?: number; onError?: (e: unknown) => void }

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private stopped = true;
  private failures = 0;
  constructor(private readonly store: OutboxStore, private readonly publisher: RealtimePublisher, private readonly opt: RelayOptions = {}) {}

  start() {
    this.stopped = false;
    this.schedule(0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise(r => setTimeout(r, 5));
  }
  /** Called right after a COMMIT so publication does not wait for the next poll. */
  nudge = () => { if (!this.stopped) { this.again = true; if (!this.running) this.schedule(0); } };

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  async tick(): Promise<void> {
    if (this.running) { this.again = true; return; }
    this.running = true;
    let next = this.opt.pollMs ?? 250;
    try {
      const limit = this.opt.batch ?? 200;
      const res = await this.store.drain(limit, async e => {
        await this.publisher.publish(DomainEventSchema.parse(e));
      });
      if (res) {
        m.outboxPublished.inc(undefined, res.published);
        if (res.failure) throw res.failure;
        this.failures = 0;
        if (res.published === limit) next = 0; // more waiting
      }
      if (this.again) { this.again = false; next = Math.min(next, 0); }
    } catch (e) {
      m.outboxFailures.inc();
      this.failures++;
      this.opt.onError?.(e);
      next = Math.min(this.opt.maxBackoffMs ?? 10_000, 100 * 2 ** this.failures);
    } finally {
      this.running = false;
      this.schedule(next);
    }
  }
}
