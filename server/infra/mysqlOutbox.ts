import type { Pool } from "mysql2/promise";
import { DomainEventSchema, type DomainEvent } from "@shared/domain-events";
import { m } from "../observability/metrics";
import type { OutboxStore } from "../realtime/relay";

const LOCK = "bahn:outbox-relay";

/**
 * MySQL/MariaDB outbox reader. GET_LOCK is connection-scoped, so the whole
 * drain runs on one dedicated connection; if the process dies the lock dies
 * with the connection and another instance takes over.
 */
export class MysqlOutbox implements OutboxStore {
  constructor(private readonly pool: Pool) {}

  async drain(limit: number, publish: (e: DomainEvent) => Promise<void>) {
    const conn = await this.pool.getConnection();
    try {
      const [[lock]] = (await conn.query("SELECT GET_LOCK(?, 0) AS got", [LOCK])) as any;
      if (Number(lock.got) !== 1) return null;
      try {
        // 1) Rows that already own a feedSeq (a previous attempt failed after
        //    numbering them) are re-published FIRST and in sequence order, so the
        //    feed stays ordered even across publish failures. Only when none are
        //    left do we number new rows (oldest id first).
        let [rows] = (await conn.query(
          "SELECT id, envelope, feedSeq FROM domain_events WHERE processedAt IS NULL AND feedSeq IS NOT NULL ORDER BY feedSeq LIMIT ?",
          [limit],
        )) as any[];
        if (!(rows as unknown[]).length) {
          [rows] = (await conn.query(
            "SELECT id, envelope, feedSeq FROM domain_events WHERE processedAt IS NULL ORDER BY id LIMIT ?",
            [limit],
          )) as any[];
          const [[mx]] = (await conn.query("SELECT COALESCE(MAX(feedSeq), 0) AS m FROM domain_events")) as any;
          let seq = Number(mx.m);
          const numbered: Array<[number, number]> = [];
          for (const r of rows as Array<{ id: number; envelope: unknown; feedSeq: number | null }>) {
            // unparseable rows are dead-lettered below and never get a sequence
            try { DomainEventSchema.parse(typeof r.envelope === "string" ? JSON.parse(r.envelope) : r.envelope); } catch { continue; }
            r.feedSeq = ++seq;
            numbered.push([r.id, seq]);
          }
          // persist the numbering BEFORE publishing: a retry must reuse the same numbers
          if (numbered.length) {
            await conn.query(
              `UPDATE domain_events SET feedSeq = CASE id ${numbered.map(() => "WHEN ? THEN ?").join(" ")} END WHERE id IN (?)`,
              [...numbered.flat(), numbered.map(n => n[0])],
            );
          }
        }
        const done: number[] = [];
        const dead: Array<{ id: number; reason: string }> = [];
        let failure: unknown;
        for (const r of rows as Array<{ id: number; envelope: unknown; feedSeq: number | null }>) {
          // A row that can never be published (corrupt / schema-invalid) is
          // dead-lettered so it cannot block every event behind it. A bus
          // failure is different: it is transient, ordering matters, so we
          // stop and retry the same row.
          let env: DomainEvent;
          try {
            env = DomainEventSchema.parse(typeof r.envelope === "string" ? JSON.parse(r.envelope) : r.envelope);
            if (r.feedSeq !== null) env = { ...env, feedSeq: Number(r.feedSeq) };
          } catch (e) {
            dead.push({ id: r.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
            continue;
          }
          try {
            await publish(env);
            done.push(r.id);
          } catch (e) {
            failure = e;
            break;
          }
        }
        if (done.length) await conn.query("UPDATE domain_events SET processedAt = NOW(3) WHERE id IN (?)", [done]);
        for (const d of dead) {
          await conn.query("UPDATE domain_events SET processedAt = NOW(3), failedAt = NOW(3), failureReason = ? WHERE id = ?", [d.reason, d.id]);
        }
        if (dead.length) m.outboxDeadLetters.inc(undefined, dead.length);
        return { published: done.length, ...(failure ? { failure } : {}) };
      } finally {
        await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => {});
      }
    } finally {
      conn.release();
    }
  }

  async backlog(): Promise<number> {
    const [[r]] = (await this.pool.query("SELECT COUNT(*) AS n FROM domain_events WHERE processedAt IS NULL")) as any;
    return Number(r.n);
  }
}
