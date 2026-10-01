/**
 * Notification retention. The inbox is durable SQL; it must not grow without bound.
 *   read notifications   deleted after READ_DAYS   (default 30)
 *   any notification     deleted after MAX_DAYS    (default 180) — unread ones also decrement the unread counter
 * Batched (bounded locks), idempotent, safe to run from several instances (a row is deleted by exactly one).
 */
import { sql } from "drizzle-orm";

type Pool = { query(sql: string, args?: unknown[]): Promise<unknown>; getConnection(): Promise<any> };

export async function purgeNotifications(pool: Pool, o: { readDays?: number; maxDays?: number; batch?: number; now?: Date } = {}): Promise<{ deleted: number; unreadDeleted: number }> {
  void sql;
  const readDays = o.readDays ?? Number(process.env.NOTIF_READ_DAYS ?? 30), maxDays = o.maxDays ?? Number(process.env.NOTIF_MAX_DAYS ?? 180), batch = o.batch ?? 1000;
  const now = o.now ?? new Date();
  const readCut = new Date(now.getTime() - readDays * 86_400_000), maxCut = new Date(now.getTime() - maxDays * 86_400_000);
  let deleted = 0, unreadDeleted = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [rows] = (await c.query(
        "SELECT id, userId, workspace, readAt IS NULL AS unread FROM notifications WHERE (readAt IS NOT NULL AND createdAt < ?) OR createdAt < ? ORDER BY id LIMIT ? FOR UPDATE",
        [readCut, maxCut, batch])) as [Array<{ id: number; userId: string; workspace: string | null; unread: number }>];
      if (!rows.length) { await c.commit(); break; }
      await c.query("DELETE FROM notifications WHERE id IN (?)", [rows.map(r => r.id)]);
      const dec = new Map<string, number>();
      for (const r of rows) if (Number(r.unread) === 1) dec.set(`${r.userId}\u0001${r.workspace ?? ""}`, (dec.get(`${r.userId}\u0001${r.workspace ?? ""}`) ?? 0) + 1);
      for (const [k, n] of dec) { const [u, w] = k.split("\u0001"); await c.query("UPDATE notification_unread SET n = GREATEST(0, n - ?) WHERE userId = ? AND workspace = ?", [n, u, w]); unreadDeleted += n; }
      await c.commit();
      deleted += rows.length;
      if (rows.length < batch) break;
    } catch (e) { await c.rollback().catch(() => {}); throw e; } finally { c.release(); }
  }
  return { deleted, unreadDeleted };
}
