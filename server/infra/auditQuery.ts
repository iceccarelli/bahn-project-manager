/**
 * Authorization-aware, cursor-paginated audit read.
 *
 *  - restricted principal → only rows stamped with one of ITS workspaces (workspace IN (...)); rows with a NULL scope
 *    (deleted-project backfill gaps, private drafts, global) are visible to unrestricted principals only.
 *  - keyset pagination on the primary key (`id < cursor ORDER BY id DESC`): stable under concurrent inserts, O(page).
 *  - the look-back window bounds the scan of contains-style filters.
 */
import type { Pool } from "mysql2/promise";
import { splitAuditField, type AuditFilter, type AuditItem, type AuditPage } from "@shared/audit-contract";

interface Row { id: number; createdAt: Date; userName: string | null; entityType: AuditItem["entityType"]; entityId: number; entityLabel: string | null; action: AuditItem["action"]; field: string | null; oldValue: string | null; newValue: string | null; aggregateVersion: number | null; workspace: string | null; eventId: string | null }

const esc = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
export const MAX_AUDIT_PAGE = 100;

export async function pageAudit(pool: Pool, workspaces: readonly string[] | null, f: AuditFilter = {}, now = Date.now()): Promise<AuditPage> {
  if (workspaces !== null && workspaces.length === 0) return { items: [], nextCursor: null };
  const limit = Math.min(Math.max(f.limit ?? 50, 1), MAX_AUDIT_PAGE);
  const where: string[] = [];
  const args: unknown[] = [];
  if (workspaces !== null) { where.push("workspace IN (?)"); args.push([...workspaces]); }
  if (f.cursor !== undefined) { where.push("id < ?"); args.push(f.cursor); }
  if (f.entityType) { where.push("entityType = ?"); args.push(f.entityType); }
  if (f.entityId !== undefined) { where.push("entityId = ?"); args.push(f.entityId); }
  if (f.action) { where.push("action = ?"); args.push(f.action); }
  if (f.user) { where.push("userName LIKE ?"); args.push(`${esc(f.user)}%`); }
  if (f.label) { where.push("entityLabel LIKE ?"); args.push(`%${esc(f.label)}%`); }
  if (f.q) { where.push("(userName LIKE ? OR entityLabel LIKE ? OR field LIKE ?)"); args.push(`${esc(f.q)}%`, `%${esc(f.q)}%`, `%${esc(f.q)}%`); }
  if (f.statusOnly) where.push("(field = 'status' OR field LIKE 'review.%.status')");
  const days = f.days ?? 30;
  if (days > 0) { where.push("createdAt >= ?"); args.push(new Date(now - days * 86_400_000)); }
  const [rows] = (await pool.query(
    `SELECT id, createdAt, userName, entityType, entityId, entityLabel, action, field, oldValue, newValue, aggregateVersion, workspace, eventId
       FROM audit_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
    [...args, limit + 1],
  )) as unknown as [Row[]];
  const more = rows.length > limit;
  const items: AuditItem[] = rows.slice(0, limit).map(r => {
    const s = splitAuditField(r.field);
    return {
      id: r.id, at: r.createdAt.toISOString(), user: r.userName ?? "—", entityType: r.entityType, entityId: r.entityId, label: r.entityLabel,
      action: r.action, field: s.field, department: s.department, from: r.oldValue, to: r.newValue, version: r.aggregateVersion, workspace: r.workspace, eventId: r.eventId,
    };
  });
  return { items, nextCursor: more ? items[items.length - 1]!.id : null };
}
