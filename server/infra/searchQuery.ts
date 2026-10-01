/**
 * Global search candidates, computed on the server for the caller's authorization scope.
 * Every query is bounded (LIMIT) and parameterized; a restricted principal's queries carry its workspace filter,
 * the audit group is only returned to principals entitled to the trail, notifications are the caller's own.
 * The client merges these with the static page/Gewerk entries and ranks everything with shared/search.ts.
 */
import type { Pool } from "mysql2/promise";
import type { SearchWireEntry } from "@shared/search-contract";
import { projectHref } from "@shared/handlungsbedarf";

export interface SearchScope { workspaces: readonly string[] | null; userId: string; canAudit: boolean }
const esc = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fmtDay = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");

export async function searchGlobal(pool: Pool, scope: SearchScope, q: string): Promise<SearchWireEntry[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  if (scope.workspaces !== null && scope.workspaces.length === 0) {
    return scope.userId ? notifications(pool, scope.userId, term) : [];
  }
  const like = `%${esc(term)}%`;
  const ws = scope.workspaces;
  const pScope = ws ? " AND p.bahnhofsmanagement IN (?)" : "";
  const pArgs = ws ? [[...ws]] : [];
  const all = async <T>(sql: string, args: unknown[]) => ((await pool.query(sql, args)) as unknown as [T[]])[0];

  const [projects, stations, leaders, reviewers, regions, audit, bookings, notes] = await Promise.all([
    all<{ id: number; projektnummer: string | null; station: string | null; projektleiter: string | null; bm: string | null }>(
      `SELECT p.id, p.projektnummer, p.station, p.projektleiter, p.bahnhofsmanagement AS bm FROM projects p
        WHERE (p.projektnummer LIKE ? OR p.station LIKE ? OR p.projektleiter LIKE ? OR p.bahnhofsnummer LIKE ?)${pScope}
        ORDER BY (p.projektnummer LIKE ?) DESC, p.id DESC LIMIT 12`, [like, like, like, like, ...pArgs, `${esc(term)}%`]),
    all<{ name: string; c: number }>(`SELECT p.station AS name, COUNT(*) c FROM projects p WHERE p.station LIKE ?${pScope} GROUP BY p.station ORDER BY c DESC LIMIT 6`, [like, ...pArgs]),
    all<{ name: string; c: number }>(`SELECT p.projektleiter AS name, COUNT(*) c FROM projects p WHERE p.projektleiter LIKE ?${pScope} GROUP BY p.projektleiter ORDER BY c DESC LIMIT 6`, [like, ...pArgs]),
    all<{ name: string; c: number }>(`SELECT r.prueferName AS name, COUNT(*) c FROM department_reviews r JOIN projects p ON p.id = r.projectId WHERE r.prueferName LIKE ?${pScope} GROUP BY r.prueferName ORDER BY c DESC LIMIT 6`, [like, ...pArgs]),
    all<{ name: string; c: number }>(`SELECT workspace AS name, projects AS c FROM rm_project_stats WHERE workspace <> '' AND workspace LIKE ?${ws ? " AND workspace IN (?)" : ""} AND projects > 0 LIMIT 4`, [like, ...(ws ? [[...ws]] : [])]),
    scope.canAudit
      ? all<{ id: number; entityId: number; entityType: string; label: string | null; userName: string | null; action: string; at: Date }>(
          `SELECT id, entityId, entityType, entityLabel AS label, userName, action, createdAt AS at FROM audit_log
            WHERE (entityLabel LIKE ? OR userName LIKE ?)${ws ? " AND workspace IN (?)" : ""} AND createdAt >= ? ORDER BY id DESC LIMIT 5`,
          [like, like, ...(ws ? [[...ws]] : []), new Date(Date.now() - 30 * 86_400_000)])
      : Promise.resolve([]),
    all<{ id: number; datum: Date; von: string; station: string | null; status: string }>(
      `SELECT id, datum, von, station, status FROM schedule_slots WHERE station LIKE ?${ws ? " AND bahnhofsmanagement IN (?)" : ""} ORDER BY datum DESC LIMIT 5`, [like, ...(ws ? [[...ws]] : [])]),
    scope.userId ? notifications(pool, scope.userId, term) : Promise.resolve([] as SearchWireEntry[]),
  ]);

  const out: SearchWireEntry[] = [];
  for (const p of projects) {
    const nummer = (p.projektnummer ?? "").trim();
    out.push({
      kind: "projekt", label: nummer || `Projekt ${p.id}`, href: projectHref(p.id), weight: 1, projectId: p.id,
      sublabel: [p.station, p.projektleiter].filter(Boolean).join(" · ") || undefined,
      terms: [p.station ?? "", p.projektleiter ?? "", p.bm ?? ""].filter(Boolean),
    });
  }
  for (const s of stations) out.push({ kind: "station", label: s.name, href: `/projects?q=${encodeURIComponent(s.name)}&view=cards`, weight: Number(s.c), sublabel: plural(Number(s.c), "Projekt", "Projekte"), terms: ["station bahnhof"] });
  for (const l of leaders) out.push({ kind: "person", label: l.name, href: `/projects?q=${encodeURIComponent(l.name)}`, weight: Number(l.c), sublabel: `Projektleitung · ${plural(Number(l.c), "Projekt", "Projekte")}`, terms: ["projektleiter projektleitung"] });
  for (const r of reviewers) out.push({ kind: "person", label: r.name, href: `/projects?q=${encodeURIComponent(r.name)}`, weight: Number(r.c), sublabel: `Prüfer · ${plural(Number(r.c), "Prüfung", "Prüfungen")}`, terms: ["prüfer fachspezialist"] });
  for (const r of regions) out.push({ kind: "region", label: r.name, href: `/projects?q=${encodeURIComponent(r.name)}`, weight: Number(r.c), sublabel: `Bahnhofsmanagement · ${plural(Number(r.c), "Projekt", "Projekte")}`, terms: ["region bahnhofsmanagement"] });
  for (const a of audit) out.push({ kind: "audit", label: `${a.label ?? `${a.entityType} ${a.entityId}`}`, href: `/audit?q=${encodeURIComponent(a.label ?? a.userName ?? term)}`, weight: 1, sublabel: `${a.userName ?? "—"} · ${a.action} · ${fmtDay(a.at)}`, terms: [a.userName ?? ""].filter(Boolean) });
  for (const b of bookings) out.push({ kind: "buchung", label: b.station ?? "Termin", href: "/anmeldung", weight: 1, sublabel: `${fmtDay(b.datum)} ${b.von} · ${b.status}`, terms: ["termin buchung fachspezialist"] });
  out.push(...notes);
  return out;
}

async function notifications(pool: Pool, userId: string, term: string): Promise<SearchWireEntry[]> {
  const [rows] = (await pool.query(
    "SELECT id, title, link, createdAt FROM notifications WHERE userId = ? AND (title LIKE ? OR body LIKE ?) ORDER BY id DESC LIMIT 5",
    [userId, `%${esc(term)}%`, `%${esc(term)}%`],
  )) as unknown as [Array<{ id: number; title: string; link: string | null; createdAt: Date }>];
  return rows.map(n => ({ kind: "benachrichtigung" as const, label: n.title, href: n.link && n.link.startsWith("/") ? n.link : "/", weight: 1, sublabel: fmtDay(n.createdAt), terms: ["benachrichtigung meldung"] }));
}
