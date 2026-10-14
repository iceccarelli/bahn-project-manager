/**
 * Project identity — what the app is allowed to treat as "the same project" across two lists that carry no common id.
 *
 * The Übersichtsliste has no durable identifier: `Projektnummer` repeats (a framework number such as G.011… is shared by
 * dozens of stations), is sometimes empty, and even Projektnummer + Station + Beschreibung repeats because one project
 * is registered once per phase (AP/EP/VEP …) or per Projektvorstellung. A workbook row number moves the moment someone
 * sorts or inserts a row. So identity is built only from fields whose meaning is known, in two strengths:
 *
 *   coreKey  Projektnummer | Station | Projektbeschreibung        — "which piece of work, where"
 *   fullKey  coreKey | Projektstand | Termin Projektvorstellung   — "which registration of it"
 *
 * Both are normalised text (case, accents, punctuation and bracketed qualifiers such as "(Main)" are not identity).
 * Neither is a primary key: a key that two rows share identifies nobody, and callers must treat that as ambiguity
 * (`shared/register/register-plan.ts`), never as a tie-break.
 *
 * Pure, no dependencies: used by the browser, the server, the inspector CLI and the tests.
 */

/** Fold case, accents and punctuation; keep letters and digits. "Bad Hersfeld" and "bad-hersfeld" are the same. */
export function normText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Projektnummer: whitespace and case are not identity ("G.011511006" = "g. 011511006"). */
export function normProjektnummer(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).toUpperCase().replace(/\s+/g, "");
}

/**
 * Station name for comparison. Bracketed qualifiers ("Offenbach (Main) Marktplatz" ↔ "Offenbach Marktplatz") and the
 * Hbf/Hauptbahnhof spelling are not identity; nothing fuzzier than that is attempted — a near match is a candidate for
 * a person to confirm, never a match.
 */
export function normStation(v: unknown): string {
  if (v === null || v === undefined) return "";
  return normText(String(v).replace(/\([^)]*\)/g, " ")).replace(/\bhbf\b/g, "hauptbahnhof");
}

export interface IdentityFields {
  projektnummer: string | null;
  station: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  /** ISO day (yyyy-mm-dd) or null */
  terminProjektvorstellung: string | null;
}

export const coreKey = (f: Pick<IdentityFields, "projektnummer" | "station" | "projektbeschreibung">): string =>
  [normProjektnummer(f.projektnummer), normStation(f.station), normText(f.projektbeschreibung)].join("|");

export const fullKey = (f: IdentityFields): string =>
  [coreKey(f), normText(f.projektstand), (f.terminProjektvorstellung ?? "").slice(0, 10)].join("|");

/** A record with nothing to identify it by cannot be imported: it would match (or create) "anything". */
export const hasIdentity = (f: Pick<IdentityFields, "projektnummer" | "station" | "projektbeschreibung">): boolean =>
  coreKey(f) !== "||";

/**
 * Projektstand is the project's PHASE (AP, EP, VEP, FA, …). A phase is its own registration with its own Prüfungen, Prüfer and
 * Termine: an EP row is never "the AP project moved on". Two stands are compatible only when they are the same phase — or one
 * side states none (a blank cannot contradict). Used wherever two records might be the same registration.
 */
export const standsCompatible = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normText(a);
  const y = normText(b);
  return x === "" || y === "" || x === y;
};
