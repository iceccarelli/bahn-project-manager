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
  type LinkCandidates,
  type LinkSummary,
  type ListInput,
  type PruefberichtListRow,
  type PruefberichtPage,
  type PruefberichtRow,
} from "@shared/itk/pruefbericht-contract";
import { indexProjects, matchPruefbericht, UNMATCHED_TEXT } from "@shared/itk/project-link";
import { normProjektnummer } from "@shared/project-identity";
import type { Pruefbericht } from "@shared/itk/pruefbericht-import";
import { technikArtOf } from "@shared/itk/vocab";

type Db = Record<string, unknown>;

const DATE_FIELDS = new Set<string>(["datum", "termin"]);
const COLUMNS = ["year", "layout", ...PRUEFBERICHT_FIELDS, "technikArt"] as const;
/** SELECT list that hands DATE columns back as 'YYYY-MM-DD' strings — never as a JS Date, which would drag a time zone in. */
const SELECT_COLUMNS = ["id", "version", "projectId", "projectLinkSource", ...COLUMNS] as const;
const SELECT = SELECT_COLUMNS.map((c) => (DATE_FIELDS.has(c) ? `DATE_FORMAT(\`${c}\`, '%Y-%m-%d') AS \`${c}\`` : `\`${c}\``)).join(", ");
/** The same list for a query that joins `projects` (whose columns share names like id, projektnummer). */
const SELECT_PB = SELECT_COLUMNS.map((c) => (DATE_FIELDS.has(c) ? `DATE_FORMAT(pb.\`${c}\`, '%Y-%m-%d') AS \`${c}\`` : `pb.\`${c}\``)).join(", ");

const toRow = (r: Db): PruefberichtRow => ({ ...(r as unknown as PruefberichtRow) });

/** The record as stored: what the workbook said, plus the one derived column (recomputed here, never trusted from the caller). */
const withDerived = (rec: Pruefbericht): Db => ({ ...(rec as unknown as Db), technikArt: technikArtOf(rec) });
const same = (stored: Db, rec: Db): boolean => COLUMNS.every((c) => (stored[c] ?? null) === (rec[c] ?? null));

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

    const inserts: Db[] = [];
    const updates: { id: number; rec: Db }[] = [];
    let unchanged = 0;
    for (const input of batch.records) {
      const rec = withDerived(input);
      const prior = existing.get(`${rec.year}|${rec.laufendeNummer}`);
      if (!prior) inserts.push(rec);
      else if (same(prior, rec)) unchanged += 1;
      else updates.push({ id: prior.id as number, rec });
    }

    const values = (rec: Db) => COLUMNS.map((c) => rec[c] ?? null);
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

const LIKE_COLUMNS = ["laufendeNummer", "bahnhofStrecke", "projektnummer", "zustaendigerPl", "zustaendigerFs", "technikArt", "technik", "taetigkeitsbereich", "beschriftung", "projektname", "agPl"] as const;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

const toListRow = (r: Db): PruefberichtListRow => {
  const { projectNummer, projectStation, ...row } = r as Db & { projectNummer: string | null; projectStation: string | null };
  return { ...(row as unknown as PruefberichtRow), project: row.projectId === null ? null : { projektnummer: projectNummer ?? null, station: projectStation ?? null } };
};
const LIST_SELECT = `${SELECT_PB}, p.projektnummer AS projectNummer, p.station AS projectStation`;
const LIST_FROM = "itk_pruefberichte pb LEFT JOIN projects p ON p.id = pb.projectId";

/** Keyset-paginated list, newest year first (then newest row). Search terms are ANDed; each must match at least one searchable column. */
export async function listPruefberichte(pool: Pool, input: ListInput): Promise<PruefberichtPage> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (input.cursor) {
    const [y, id] = input.cursor.split(":").map(Number);
    where.push("(pb.year < ? OR (pb.year = ? AND pb.id < ?))");
    args.push(y, y, id);
  }
  if (input.year) { where.push("pb.year = ?"); args.push(input.year); }
  if (input.technik) { where.push("pb.technikArt = ?"); args.push(input.technik); }
  if (input.abgeschlossen) { where.push("pb.abgeschlossen = ?"); args.push(input.abgeschlossen); }
  if (input.verknuepfung === "verknuepft") where.push("pb.projectId IS NOT NULL");
  if (input.verknuepfung === "offen") where.push("pb.projectId IS NULL");
  if (input.projectId) { where.push("pb.projectId = ?"); args.push(input.projectId); }
  if (input.grund === "keine-projektnummer") where.push("(pb.projektnummer IS NULL OR TRIM(pb.projektnummer) = '')");
  for (const term of (input.q ?? "").split(/\s+/).filter(Boolean)) {
    where.push(`(${LIKE_COLUMNS.map((c) => `pb.\`${c}\` LIKE ?`).join(" OR ")} OR p.projektnummer LIKE ? OR p.station LIKE ?)`);
    args.push(...LIKE_COLUMNS.map(() => `%${escapeLike(term)}%`), `%${escapeLike(term)}%`, `%${escapeLike(term)}%`);
  }
  const [rows] = (await pool.query(
    `SELECT ${LIST_SELECT} FROM ${LIST_FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY pb.year DESC, pb.id DESC LIMIT ?`,
    [...args, input.limit + 1],
  )) as unknown as [Db[]];
  const page = rows.slice(0, input.limit).map(toListRow);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > input.limit && last ? `${last.year}:${last.id}` : null };
}

/** Every report linked to one project (newest first). Authorization — project visible AND reports viewable — is the caller's. */
export async function pruefberichteOfProject(pool: Pool, projectId: number): Promise<PruefberichtListRow[]> {
  const [rows] = (await pool.query(`SELECT ${LIST_SELECT} FROM ${LIST_FROM} WHERE pb.projectId = ? ORDER BY pb.year DESC, pb.id DESC LIMIT 200`, [projectId])) as unknown as [Db[]];
  return rows.map(toListRow);
}

/**
 * The projects a report could belong to: every project carrying its Projektnummer, with the verdict of the evidence rule
 * (shared/itk/project-link.ts). Suggestions for a person to choose from — only `unique` is ever applied automatically.
 */
export async function linkCandidatesOf(pool: Pool, id: number): Promise<LinkCandidates | null> {
  const [found] = (await pool.query("SELECT projektnummer, bahnhofStrecke FROM itk_pruefberichte WHERE id = ?", [id])) as unknown as [Array<{ projektnummer: string | null; bahnhofStrecke: string | null }>];
  const pb = found[0];
  if (!pb) return null;
  const pn = normProjektnummer(pb.projektnummer);
  if (!pn) return { verdict: "unmatched", reason: UNMATCHED_TEXT["keine-projektnummer"], candidates: [] };
  const [rows] = (await pool.query(
    "SELECT id, projektnummer, station, projektbeschreibung, projektstand, bahnhofsmanagement FROM projects WHERE UPPER(REPLACE(projektnummer, ' ', '')) = ? ORDER BY station, id LIMIT 100",
    [pn],
  )) as unknown as [Array<{ id: number; projektnummer: string | null; station: string | null; projektbeschreibung: string | null; projektstand: string | null; bahnhofsmanagement: string | null }>];
  const verdict = matchPruefbericht(pb, indexProjects(rows.map((r) => ({ id: r.id, projektnummer: r.projektnummer, station: r.station }))));
  const stationOk = new Set(verdict.status === "unique" ? [verdict.projectId] : verdict.status === "ambiguous" ? verdict.candidateIds : []);
  return {
    verdict: verdict.status,
    reason: verdict.status === "unmatched" ? UNMATCHED_TEXT[verdict.reason] : null,
    candidates: rows.map((r) => ({
      projectId: r.id, projektnummer: r.projektnummer, station: r.station, projektbeschreibung: r.projektbeschreibung?.slice(0, 300) ?? null,
      projektstand: r.projektstand, bahnhofsmanagement: r.bahnhofsmanagement,
      evidence: stationOk.has(r.id) ? ("projektnummer+station" as const) : ("projektnummer" as const),
    })),
  };
}

/** How many reports are linked and why the others are not — the same evidence rule the automatic link uses, read-only. */
export async function linkSummary(pool: Pool): Promise<LinkSummary> {
  const [[count]] = (await pool.query("SELECT COUNT(*) total, SUM(projectId IS NOT NULL) linked FROM itk_pruefberichte")) as unknown as [Array<{ total: number; linked: number | null }>];
  const [open] = (await pool.query("SELECT projektnummer, bahnhofStrecke FROM itk_pruefberichte WHERE projectId IS NULL")) as unknown as [Array<{ projektnummer: string | null; bahnhofStrecke: string | null }>];
  const [projects] = (await pool.query("SELECT id, projektnummer, station FROM projects WHERE projektnummer IS NOT NULL AND TRIM(projektnummer) <> ''")) as unknown as [Array<{ id: number; projektnummer: string | null; station: string | null }>];
  const byPn = indexProjects(projects);
  const out: LinkSummary = { total: Number(count?.total ?? 0), linked: Number(count?.linked ?? 0), open: open.length, ambiguous: 0, unmatched: {} };
  for (const r of open) {
    const v = matchPruefbericht(r, byPn);
    // a "unique" verdict on an UNLINKED report is a report the automatic link has not run for yet
    if (v.status === "ambiguous") out.ambiguous += 1;
    else if (v.status === "unmatched") out.unmatched[v.reason] = (out.unmatched[v.reason] ?? 0) + 1;
    else out.unmatched["automatisch-zuordenbar"] = (out.unmatched["automatisch-zuordenbar"] ?? 0) + 1;
  }
  return out;
}
