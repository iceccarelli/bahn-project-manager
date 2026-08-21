/**
 * Resolving a name in the project data to an address in `Hilfsdatei`.
 *
 * ---------------------------------------------------------------------------
 * Why this needs a resolver at all
 * ---------------------------------------------------------------------------
 * The two sources spell people differently. `Hilfsdatei` holds full names
 * ("Emin Er", "Stephan Hartung"). The review rows hold surnames ("Er",
 * "Hartung"). Matching on the full string finds almost nothing:
 *
 *     exact full-name match   1 of 44 reviewer names      32 of 10,489 rows
 *
 * Matching the surname finds most of them, and it is safe to do here because
 * every surname in `Hilfsdatei` is unique — measured, and asserted by
 * contact-resolution.test.ts rather than assumed. SURNAME_INDEX below drops
 * any surname that ever collides, so a future duplicate degrades to
 * "ambiguous" instead of silently addressing mail to the wrong person.
 *
 *     exact full-name match  1 name      32 rows
 *     unique surname match  28 names  6,823 rows
 *     ambiguous surname      0 names      0 rows
 *     no match              15 names  3,634 rows
 *
 * ---------------------------------------------------------------------------
 * What the 15 unmatched names are
 * ---------------------------------------------------------------------------
 * Three of them are not people at all — they are placeholders the workbook
 * writes into the Prüfer column, and 2,799 of the 3,634 unmatched rows are
 * one of those: "Zuordnung erforderlich" (2,551), "Zentrale" (215) and
 * "BSB des BM´s" (33). They are classified as `placeholder` so the UI can say
 * "noch niemand zugeordnet" instead of offering a mail button for a phrase.
 *
 * The remaining 12 names cover 835 rows. Eleven are real reviewers with no row
 * in `Hilfsdatei`:
 *
 *     Colak 250 · Vatter 149 · Engstfeld 127 · Wagner 83 · Oker 54 ·
 *     Matteka 46 · Haag 43 · Bär 23 · Ates 23 · Krejtschi 16 ·
 *     Frousiou-Bauer 15                                  (829 rows)
 *
 * The twelfth is "Herr" (6 rows), which is a truncated entry rather than a
 * name — left as `unknown` rather than declared a placeholder, because what it
 * was truncated from has not been established.
 *
 * That is missing data, not a code defect, and it answers the open Stage 4a
 * question: the gap is 11 people and 829 rows, not the 20 people and 1,083
 * rows that counting full names suggested.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately does NOT do
 * ---------------------------------------------------------------------------
 * It never constructs an address. DB's convention is predictable enough that
 * `vorname.nachname@deutschebahn.com` would look right and be wrong often
 * enough to matter — a mail button that silently goes nowhere is worse than
 * no button. `unknown` stays `unknown`.
 *
 * There is no telephone number here because there is no telephone number in
 * any source: `Hilfsdatei` carries exactly row, group, name and mail (columns
 * A-C), and data.json carries no contact column at all. Adding a phone button
 * would mean inventing the number behind it, so the UI states that none is on
 * file. A Telefon column in `Hilfsdatei` is all that is missing; the extractor
 * and this resolver both need one field added once it exists.
 */

import { CONTACTS, type Contact } from "./contacts";

/**
 * Values the workbook writes into a Prüfer column that are not a person.
 *
 * Deliberately a short, closed list. "Herr" (6 rows) is left out: it looks
 * like a truncated real name rather than a role, and calling it a placeholder
 * would assert something about it that has not been established.
 */
const PLACEHOLDER_NAMES: Readonly<Record<string, string>> = {
  "zuordnung erforderlich": "Noch niemand zugeordnet",
  zentrale: "Zentrale (Sammelpostfach)",
  "bsb des bm´s": "BSB des Bahnhofsmanagements",
  "bsb des bm's": "BSB des Bahnhofsmanagements",
};

const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Last whitespace-separated token. "Duc Minh Nguyen" -> "nguyen". */
const surnameOf = (s: string | null | undefined): string => {
  const parts = norm(s).split(" ").filter(Boolean);
  return parts.length ? (parts[parts.length - 1] as string) : "";
};

/** Only rows that name a person. Rows 10, 38 and 39 are group mailboxes. */
const NAMED_CONTACTS: readonly Contact[] = CONTACTS.filter((c) => c.name.trim() !== "");

const EXACT_INDEX: ReadonlyMap<string, Contact> = new Map(
  NAMED_CONTACTS.map((c) => [norm(c.name), c] as const),
);

/**
 * Surname -> contact, with every colliding surname removed.
 *
 * The removal is the safety property: this file's whole premise is that a
 * surname identifies one person in `Hilfsdatei`, and the index enforces that
 * instead of trusting it. Today nothing is dropped (48 names, 48 surnames);
 * the moment a second Schmidt is added, both stop resolving and the UI shows
 * the department's recipients instead of guessing between them.
 */
const SURNAME_INDEX: ReadonlyMap<string, Contact> = (() => {
  const seen = new Map<string, Contact[]>();
  for (const c of NAMED_CONTACTS) {
    const s = surnameOf(c.name);
    if (!s) continue;
    const bucket = seen.get(s);
    if (bucket) bucket.push(c);
    else seen.set(s, [c]);
  }
  const unique = new Map<string, Contact>();
  for (const [s, bucket] of seen) if (bucket.length === 1) unique.set(s, bucket[0] as Contact);
  return unique;
})();

/** Surnames held by more than one person, which therefore resolve to nobody. */
export const AMBIGUOUS_SURNAMES: readonly string[] = (() => {
  const counts = new Map<string, number>();
  for (const c of NAMED_CONTACTS) {
    const s = surnameOf(c.name);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
})();

export type ContactResolution =
  /** The name matched a `Hilfsdatei` row in full. */
  | { kind: "exact"; contact: Contact }
  /** The name matched exactly one `Hilfsdatei` surname. */
  | { kind: "surname"; contact: Contact }
  /** Two or more people share this surname, so it addresses nobody. */
  | { kind: "ambiguous"; surname: string }
  /** Not a person — a role or a "to be assigned" marker. */
  | { kind: "placeholder"; label: string }
  /** A real name with no row in `Hilfsdatei`. */
  | { kind: "unknown"; name: string }
  /** No name at all in the source row. */
  | { kind: "empty" };

/**
 * Resolve one name from the project or review data.
 *
 * Order matters: exact before surname, so "Emin Er" never falls through to a
 * surname lookup, and placeholders before both, so a phrase is never treated
 * as a name.
 */
export function resolveContact(name: string | null | undefined): ContactResolution {
  const n = norm(name);
  if (!n) return { kind: "empty" };

  const placeholder = PLACEHOLDER_NAMES[n];
  if (placeholder) return { kind: "placeholder", label: placeholder };

  const exact = EXACT_INDEX.get(n);
  if (exact) return { kind: "exact", contact: exact };

  const s = surnameOf(n);
  const bySurname = SURNAME_INDEX.get(s);
  if (bySurname) return { kind: "surname", contact: bySurname };
  if (AMBIGUOUS_SURNAMES.includes(s)) return { kind: "ambiguous", surname: s };

  return { kind: "unknown", name: String(name).trim() };
}

/** The contact behind a resolution, or null when there is nobody to write to. */
export function contactOf(r: ContactResolution): Contact | null {
  return r.kind === "exact" || r.kind === "surname" ? r.contact : null;
}

/**
 * Why a name could not be resolved, in German, for display.
 *
 * Returns null when it resolved — callers render the contact instead.
 */
export function resolutionNote(r: ContactResolution): string | null {
  switch (r.kind) {
    case "exact":
    case "surname":
      return null;
    case "placeholder":
      return r.label;
    case "ambiguous":
      return `Nachname „${r.surname}“ ist in der Hilfsdatei mehrfach vergeben – keine eindeutige Adresse`;
    case "unknown":
      return "Keine Adresse in der Hilfsdatei hinterlegt";
    case "empty":
      return "Kein Name hinterlegt";
  }
}

/**
 * A mailto: with a subject that identifies the project.
 *
 * The subject is built from real fields only; a project with no
 * Projektnummer gets a subject without one rather than a fabricated id.
 */
export function mailtoHref(
  contact: Contact,
  subject?: string | null,
  body?: string | null,
): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const q = params.toString();
  return `mailto:${contact.mail}${q ? `?${q}` : ""}`;
}

/**
 * Microsoft Teams 1:1 chat deep link.
 *
 * Derived from the address already on file — not a second, guessed identifier.
 * Teams resolves `users` against the tenant directory, so this opens a chat
 * with the same person the mail button writes to, and fails visibly in Teams
 * if that address has no account rather than sending into the void.
 */
export function teamsChatHref(contact: Contact, message?: string | null): string {
  const params = new URLSearchParams({ users: contact.mail });
  if (message) params.set("message", message);
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}

/** Display name for a resolution — the Hilfsdatei spelling when we have it. */
export function displayNameOf(r: ContactResolution, fallback: string | null | undefined): string {
  const c = contactOf(r);
  if (c) return c.name;
  if (r.kind === "placeholder") return r.label;
  return String(fallback ?? "").trim() || "Unbekannt";
}
