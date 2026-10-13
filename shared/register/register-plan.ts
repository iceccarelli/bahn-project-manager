/**
 * Reconciliation of Übersichtsliste records with the projects already in the database — a pure function, so the same
 * decision is reproduced by the preview, by the apply step (which re-plans under row locks) and by the inspector CLI.
 *
 * Classification of every incoming record (see docs/project-register-import.md):
 *
 *   add        no existing project can be the same registration → new project
 *   unchanged  exactly one existing project, nothing the workbook says differs
 *   update     exactly one existing project; the workbook only FILLS empty fields
 *   conflict   exactly one existing project; the workbook would OVERWRITE a non-empty value → held for an explicit decision
 *   ambiguous  more than one defensible project, or an existing project that this record may be an edited version of →
 *              held; the candidates are listed, a person chooses (or says "new")
 *
 * Match evidence, strongest first:
 *   key          a stored source key (an earlier import of this very registration) points at one project
 *   fingerprint  the project's own fields spell out the same fullKey (Projektnummer, Station, Beschreibung, Stand, Termin)
 *   core         same Projektnummer, Station and Beschreibung, and exactly one record on each side; Projektstand and/or
 *                Termin differ — the usual "the project moved on" edit. Their differences surface as overwrites.
 * Anything weaker is never a match. In particular `Projektnummer` alone is not evidence: a framework number is shared by
 * dozens of stations.
 *
 * A blank incoming cell never clears a stored value (there is no "clear" rule), and a stored status is compared by its
 * canonical group, so "Projektkonfiguration" does not overwrite "Projektkonfig.".
 */
import { coreKey, fullKey, normProjektnummer, normStation, normText } from "../project-identity";
import { normalizeReviewStatus } from "../review-status";
import { DEPARTMENTS } from "../validation";
import { REGISTER_FIELD_KEYS, type RegisterFields, type RegisterRecord, type RegisterReviews } from "./register-import";

export interface ExistingProject {
  id: number;
  version: number;
  fields: RegisterFields;
  reviews: RegisterReviews;
}

export type ChangeKind = "fill" | "overwrite";
export interface PlannedChange {
  /** `station` … or `review.<Gewerk>.<status|prueferName|datum>` — the same keys the audit log and events use */
  key: string;
  from: string | null;
  to: string;
  kind: ChangeKind;
}

export type PlanStatus = "add" | "unchanged" | "update" | "conflict" | "ambiguous";
export type MatchBasis = "key" | "fingerprint" | "core";

export interface PlanCandidate {
  projectId: number;
  version: number;
  projektnummer: string | null;
  station: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  terminProjektvorstellung: string | null;
}

export interface PlanRow {
  ref: number;
  /** normalised identity of this registration; the key decisions and stored source keys refer to */
  fullKey: string;
  status: PlanStatus;
  basis?: MatchBasis;
  match?: { projectId: number; version: number };
  candidates: PlanCandidate[];
  changes: PlannedChange[];
  reason?: string;
}

const eq = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");

/**
 * The three identity fields are compared the way identity compares them: a stored "Musterstadt (Main) Marktplatz" and an
 * incoming "Musterstadt Marktplatz" are the same station, so the workbook neither overwrites nor conflicts with the stored
 * spelling (the database's value stands).
 */
const SAME_AS_IDENTITY: Partial<Record<keyof RegisterFields, (v: string) => string>> = {
  projektnummer: normProjektnummer,
  station: normStation,
  projektbeschreibung: normText,
};

/** What the workbook would change on `existing`. Blank incoming values change nothing. */
export function diffRecord(existing: ExistingProject, rec: RegisterRecord): PlannedChange[] {
  const out: PlannedChange[] = [];
  for (const key of REGISTER_FIELD_KEYS) {
    const to = rec.fields[key];
    if (to === null) continue;
    const from = existing.fields[key];
    if (from !== null && eq(from, to)) continue;
    const norm = SAME_AS_IDENTITY[key];
    if (from !== null && norm && norm(from) === norm(to)) continue;
    out.push({ key, from, to, kind: from === null || from === "" ? "fill" : "overwrite" });
  }
  for (const dept of DEPARTMENTS) {
    const inc = rec.reviews[dept];
    if (!inc) continue;
    const cur = existing.reviews[dept];
    for (const f of ["status", "prueferName", "datum"] as const) {
      const to = inc[f];
      if (to === null) continue;
      const from = cur?.[f] ?? null;
      if (from !== null) {
        if (f === "status" ? normalizeReviewStatus(from) === normalizeReviewStatus(to) : eq(from, to)) continue;
      }
      out.push({ key: `review.${dept}.${f}`, from, to, kind: from === null ? "fill" : "overwrite" });
    }
  }
  return out;
}

const candidateOf = (p: ExistingProject): PlanCandidate => ({
  projectId: p.id,
  version: p.version,
  projektnummer: p.fields.projektnummer,
  station: p.fields.station,
  projektbeschreibung: p.fields.projektbeschreibung,
  projektstand: p.fields.projektstand,
  terminProjektvorstellung: p.fields.terminProjektvorstellung,
});

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};

/**
 * @param keyOwners  fullKey → ids of the projects an earlier import stored it for
 */
export function planRegister(
  records: readonly RegisterRecord[],
  existing: readonly ExistingProject[],
  keyOwners: ReadonlyMap<string, readonly number[]> = new Map(),
): PlanRow[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byFull = new Map<string, ExistingProject[]>();
  const byCore = new Map<string, ExistingProject[]>();
  const byPnStation = new Map<string, ExistingProject[]>();
  for (const p of existing) {
    push(byFull, fullKey({ ...p.fields }), p);
    push(byCore, coreKey(p.fields), p);
    if (p.fields.projektnummer) push(byPnStation, `${normProjektnummer(p.fields.projektnummer)}|${normStation(p.fields.station)}`, p);
  }

  // identity is evaluated per record up front, so "claimed by another record's exact match" is order-independent
  const seen = new Set<string>();
  const exact = new Map<RegisterRecord, { ids: number[]; basis: MatchBasis }>();
  const claimed = new Set<number>();
  const incomingCore = new Map<string, number>();
  for (const rec of records) {
    const fk = fullKey({ ...rec.fields });
    if (seen.has(fk)) throw new Error(`Doppelte Identität im Plan (Zeile ${rec.ref}): ${fk}`);
    seen.add(fk);
    incomingCore.set(coreKey(rec.fields), (incomingCore.get(coreKey(rec.fields)) ?? 0) + 1);
    const fromKeys = (keyOwners.get(fk) ?? []).filter((id) => byId.has(id));
    const fromFields = (byFull.get(fk) ?? []).map((p) => p.id);
    const ids = [...new Set([...fromKeys, ...fromFields])];
    exact.set(rec, { ids, basis: fromKeys.length ? "key" : "fingerprint" });
    if (ids.length === 1) claimed.add(ids[0] as number);
  }

  return records.map((rec): PlanRow => {
    const fk = fullKey({ ...rec.fields });
    const ck = coreKey(rec.fields);
    const ex = exact.get(rec) as { ids: number[]; basis: MatchBasis };

    const matched = (p: ExistingProject, basis: MatchBasis): PlanRow => {
      const changes = diffRecord(p, rec);
      const status: PlanStatus = changes.length === 0 ? "unchanged" : changes.some((c) => c.kind === "overwrite") ? "conflict" : "update";
      return { ref: rec.ref, fullKey: fk, status, basis, match: { projectId: p.id, version: p.version }, candidates: [], changes };
    };
    const held = (list: ExistingProject[], reason: string): PlanRow => ({
      ref: rec.ref, fullKey: fk, status: "ambiguous", candidates: list.map(candidateOf), changes: [], reason,
    });

    if (ex.ids.length === 1) return matched(byId.get(ex.ids[0] as number) as ExistingProject, ex.basis);
    if (ex.ids.length > 1) return held(ex.ids.map((id) => byId.get(id) as ExistingProject), "Mehrere bestehende Projekte tragen dieselbe Identität");

    const coreCands = (byCore.get(ck) ?? []).filter((p) => !claimed.has(p.id));
    if (coreCands.length === 1 && incomingCore.get(ck) === 1) return matched(coreCands[0] as ExistingProject, "core");
    if (coreCands.length > 0) return held(coreCands, "Gleiche Projektnummer, Station und Beschreibung, aber Projektstand/Termin lassen keine eindeutige Zuordnung zu");

    // No registration with this description: an existing, otherwise unaccounted-for project at the same Projektnummer
    // and Station may be this very project with an edited description. Creating a second one would duplicate it.
    const pn = normProjektnummer(rec.fields.projektnummer);
    const weak = pn ? (byPnStation.get(`${pn}|${normStation(rec.fields.station)}`) ?? []).filter((p) => !claimed.has(p.id)) : [];
    if (weak.length > 0) return held(weak, "Gleiche Projektnummer und Station, andere Beschreibung — bearbeitetes Projekt oder neue Anmeldung?");

    return { ref: rec.ref, fullKey: fk, status: "add", candidates: [], changes: [] };
  });
}

export interface PlanSummary {
  records: number;
  add: number;
  unchanged: number;
  update: number;
  conflict: number;
  ambiguous: number;
  /** field-level: values that would be written into empty fields / replace existing values */
  fills: number;
  overwrites: number;
}

export function summarizePlan(rows: readonly PlanRow[]): PlanSummary {
  const s: PlanSummary = { records: rows.length, add: 0, unchanged: 0, update: 0, conflict: 0, ambiguous: 0, fills: 0, overwrites: 0 };
  for (const r of rows) {
    s[r.status] += 1;
    for (const c of r.changes) s[c.kind === "fill" ? "fills" : "overwrites"] += 1;
  }
  return s;
}

/**
 * Chunks for transport. Rows that share a Projektnummer travel together (the "claimed" logic above needs the whole
 * Projektnummer group in one plan), unless that would exceed the byte budget — then the group is split, and the effect is
 * only ever more conservative (an unaccounted-for project turns a row `ambiguous`, never a wrong match).
 */
export function chunkRecords(records: readonly RegisterRecord[], opts: { maxRecords?: number; maxBytes?: number } = {}): RegisterRecord[][] {
  const maxRecords = opts.maxRecords ?? 60;
  const maxBytes = opts.maxBytes ?? 180_000;
  const groups = new Map<string, RegisterRecord[]>();
  for (const r of records) {
    const g = normProjektnummer(r.fields.projektnummer) || `~${normStation(r.fields.station)}`;
    push(groups, g, r);
  }
  const chunks: RegisterRecord[][] = [];
  let cur: RegisterRecord[] = [];
  let bytes = 0;
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
    bytes = 0;
  };
  for (const list of [...groups.values()].sort((a, b) => (a[0] as RegisterRecord).ref - (b[0] as RegisterRecord).ref)) {
    for (const r of list) {
      const size = JSON.stringify(r).length;
      const startsGroup = r === list[0];
      // a group is kept together: it starts a new chunk when it does not fit the current one but fits a chunk by itself;
      // only the byte budget (the API body limit) may split it
      if (cur.length > 0 && bytes + size > maxBytes) flush();
      else if (startsGroup && cur.length > 0 && cur.length + list.length > maxRecords) flush();
      cur.push(r);
      bytes += size;
    }
  }
  flush();
  return chunks;
}
