/**
 * ITK Prüfberichte: import and reads (schema: drizzle/schema.ts `itk_pruefberichte`).
 *
 * Import is an idempotent upsert by (year, laufendeNummer): rows already stored and equal are left alone (no version
 * bump, no write), rows that differ are updated and versioned, new rows are inserted — all in ONE transaction together
 * with ONE audit row for the batch, so a batch is either fully there with its trace or not at all. Re-importing the same
 * workbook changes nothing. Authorization is the caller's job (routers.ts); this file never decides who may do what.
 */
import type { Pool } from "mysql2/promise";
import {
  PRUEFBERICHT_FIELDS,
  type ImportBatchInput,
  type ImportBatchResult,
  type ListInput,
  type PruefberichtPage,
  type PruefberichtRow,
} from "@shared/itk/pruefbericht-contract";
import type { Pruefbericht } from "@shared/itk/pruefbericht-import";

type Db = Record<string, unknown>;

const DATE_FIELDS = new Set<string>(["datum", "termin"]);
const COLUMNS = ["year", "layout", ...PRUEFBERICHT_FIELDS] as const;
/** SELECT list that hands DATE columns back as 'YYYY-MM-DD' strings — never as a JS Date, which would drag a time zone in. */
const SELECT = ["id", "version", ...COLUMNS].map((c) => (DATE_FIELDS.has(c) ? `DATE_FORMAT(\`${c}\`, '%Y-%m-%d') AS \`${c}\`` : `\`${c}\``)).join(", ");

const toRow = (r: Db): PruefberichtRow => ({ ...(r as unknown as PruefberichtRow) });

const same = (stored: Db, rec: Pruefbericht): boolean => COLUMNS.every((c) => (stored[c] ?? null) === ((rec as unknown as Db)[c] ?? null));

export interface Actor {
  name: string | null;
}

export async function importPruefberichte(pool: Pool, batch: ImportBatchInput, actor: Actor): Promise<ImportBatchResult> {
  // A batch must not contain the same key twice: which row would win is not something to decide silently.
  const keys = new Set<string>();
  for (const r of batch.records) {
    const k = `${r.year}|${r.laufendeNummer}`;
    if (keys.has(k)) throw new Error(`Doppelter Schlüssel im Import: ${r.year} / ${r.laufendeNummer}`);
    keys.add(k);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const existing = new Map<string, Db>();
    const where = batch.records.map(() => "(year = ? AND laufendeNummer = ?)").join(" OR ");
    const [found] = (await conn.query(`SELECT ${SELECT} FROM itk_pruefberichte WHERE ${where} FOR UPDATE`, batch.records.flatMap((r) => [r.year, r.laufendeNummer]))) as unknown as [Db[]];
    for (const row of found) existing.set(`${row.year}|${row.laufendeNummer}`, row);

    const inserts: Pruefbericht[] = [];
    const updates: { id: number; rec: Pruefbericht }[] = [];
    let unchanged = 0;
    for (const rec of batch.records) {
      const prior = existing.get(`${rec.year}|${rec.laufendeNummer}`);
      if (!prior) inserts.push(rec);
      else if (same(prior, rec)) unchanged += 1;
      else updates.push({ id: prior.id as number, rec });
    }

    const values = (rec: Pruefbericht) => COLUMNS.map((c) => (rec as unknown as Db)[c] ?? null);
    if (inserts.length) {
      await conn.query(`INSERT INTO itk_pruefberichte (${COLUMNS.map((c) => `\`${c}\``).join(", ")}) VALUES ?`, [inserts.map(values)]);
    }
    for (const u of updates) {
      await conn.query(`UPDATE itk_pruefberichte SET ${COLUMNS.map((c) => `\`${c}\` = ?`).join(", ")}, version = version + 1 WHERE id = ?`, [...values(u.rec), u.id]);
    }

    const years = [...new Set(batch.records.map((r) => r.year))].sort((a, b) => a - b);
    await conn.query(
      "INSERT INTO audit_log (userId, userName, entityType, entityId, action, field, oldValue, newValue, eventId, aggregateVersion, traceId, workspace, entityLabel) VALUES (?)",
      [[
        null, actor.name ?? "unbekannt", "pruefbericht", 0, inserts.length && !updates.length ? "create" : "update", "import", null,
        JSON.stringify({ inserted: inserts.length, updated: updates.length, unchanged, years }),
        null, null, null, null, `${batch.source} · Teil ${batch.part.index}/${batch.part.total}`.slice(0, 255),
      ]],
    );
    await conn.commit();
    return { inserted: inserts.length, updated: updates.length, unchanged };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** Every Prüfbericht, for the view builder (a few thousand rows; the caller caches it). */
export async function loadAllPruefberichte(pool: Pool): Promise<PruefberichtRow[]> {
  const [rows] = (await pool.query(`SELECT ${SELECT} FROM itk_pruefberichte ORDER BY year DESC, id DESC`)) as unknown as [Db[]];
  return rows.map(toRow);
}

const LIKE_COLUMNS = ["laufendeNummer", "bahnhofStrecke", "projektnummer", "zustaendigerPl", "zustaendigerFs", "technik", "taetigkeitsbereich", "beschriftung", "projektname"] as const;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Keyset-paginated list, newest year first (then newest row). Search terms are ANDed; each must match at least one searchable column. */
export async function listPruefberichte(pool: Pool, input: ListInput): Promise<PruefberichtPage> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (input.cursor) {
    const [y, id] = input.cursor.split(":").map(Number);
    where.push("(year < ? OR (year = ? AND id < ?))");
    args.push(y, y, id);
  }
  if (input.year) { where.push("year = ?"); args.push(input.year); }
  if (input.technik) { where.push("technik = ?"); args.push(input.technik); }
  if (input.abgeschlossen) { where.push("abgeschlossen = ?"); args.push(input.abgeschlossen); }
  for (const term of (input.q ?? "").split(/\s+/).filter(Boolean)) {
    where.push(`(${LIKE_COLUMNS.map((c) => `\`${c}\` LIKE ?`).join(" OR ")})`);
    args.push(...LIKE_COLUMNS.map(() => `%${escapeLike(term)}%`));
  }
  const [rows] = (await pool.query(
    `SELECT ${SELECT} FROM itk_pruefberichte ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY year DESC, id DESC LIMIT ?`,
    [...args, input.limit + 1],
  )) as unknown as [Db[]];
  const page = rows.slice(0, input.limit).map(toRow);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > input.limit && last ? `${last.year}:${last.id}` : null };
}
