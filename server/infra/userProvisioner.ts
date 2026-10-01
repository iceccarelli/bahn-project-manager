/**
 * Write-behind user provisioning for OIDC identities.
 *
 * Authentication and authorization derive entirely from the verified token, so a
 * first request from a new user must NOT wait for (or hammer) the database. A
 * burst of 10,000 distinct users used to cost 2 queries each on the request
 * path (getUserByOpenId + upsert) against a 10-connection pool. Provisioning is
 * now coalesced: each user is enqueued at most once per TTL, and a background
 * flush writes them in multi-row batches. A failed flush loses nothing that
 * authorization depends on; it is counted and retried on the next sighting.
 */
import { counter } from "../observability/metrics";

export interface ProvisionedUser { openId: string; name: string | null; email: string | null; role: "admin" | "user" }
export type BatchWriter = (users: ProvisionedUser[]) => Promise<void>;

const written = counter("bahn_user_provision_written_total", "OIDC users written by the provisioner");
const failed = counter("bahn_user_provision_failures_total", "Provisioner batch failures");

export class UserProvisioner {
  private pending = new Map<string, ProvisionedUser>();
  private seen = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly write: BatchWriter,
    private readonly opt: { ttlMs?: number; flushMs?: number; batch?: number; maxSeen?: number; now?: () => number } = {},
  ) {}

  /** O(1), never awaits the database. */
  enqueue(u: ProvisionedUser): void {
    const now = (this.opt.now ?? Date.now)();
    const last = this.seen.get(u.openId);
    if (last !== undefined && now - last < (this.opt.ttlMs ?? 10 * 60_000)) return;
    if (this.seen.size >= (this.opt.maxSeen ?? 100_000)) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(u.openId, now);
    this.pending.set(u.openId, u);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opt.flushMs ?? 1000);
      this.timer.unref?.();
    }
  }

  get queued() { return this.pending.size; }

  async flush(): Promise<void> {
    const batchSize = this.opt.batch ?? 500;
    while (this.pending.size) {
      const batch = [...this.pending.values()].slice(0, batchSize);
      for (const u of batch) this.pending.delete(u.openId);
      try { await this.write(batch); written.inc(undefined, batch.length); }
      catch { failed.inc(); for (const u of batch) this.seen.delete(u.openId); /* retried on next sighting */ }
    }
  }
}
