/**
 * Addresses the workbook does not have, supplied by the people who do.
 *
 * ---------------------------------------------------------------------------
 * The problem this closes
 * ---------------------------------------------------------------------------
 * Six departments carry recipient rows in `Hilfsdatei` with a group label and
 * no address. LST is the worst of them: both its rows are empty, so its 52
 * reviews — 22 of them still open — have never produced a notification that
 * reached a person. The macro sent to an empty string and reported success.
 *
 * `departmentsWithoutRecipients()` has named this since the transcription, and
 * for all that time it was called by one script and one test and by nothing a
 * reader ever sees. Detecting a gap and never showing it to anybody who could
 * close it is not much better than not detecting it.
 *
 * ---------------------------------------------------------------------------
 * Why an override store and not a constant
 * ---------------------------------------------------------------------------
 * The address is not knowable from here. It cannot be derived, guessed, or
 * built from a pattern — `vorname.nachname@deutschebahn.com` is right often
 * enough to be genuinely dangerous, and a notification that goes to the wrong
 * real person is worse than one that goes nowhere.
 *
 * So the missing data is captured rather than invented: an operator who knows
 * the address types it, and the entry records who supplied it and when. The
 * Hilfsdatei stays the source of truth for everything it actually contains;
 * this only ever fills a hole the workbook left, and it says on screen that it
 * is doing so.
 */

import type { Department } from "./types";

export interface RecipientOverride {
  department: string;
  name: string;
  mail: string;
  /** Who typed it. Provenance is the whole point — this is not workbook data. */
  addedBy: string;
  /** ISO timestamp. */
  addedAt: string;
}

/**
 * Deliberately strict, and deliberately not RFC 5322.
 *
 * A full-grammar validator accepts `a@b`, quoted locals and bracketed IP
 * literals — all legal, none of them something anyone is typing into a form
 * that routes a Deutsche Bahn Fachprüfung. What has to be caught here is the
 * typo and the placeholder, so the rule is: a local part, one @, a domain with
 * a dot, and a TLD of at least two letters.
 */
const MAIL = /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/;

/** Addresses that look like a person and are not one. */
const PLACEHOLDERS = new Set([
  "test@test.de",
  "a@a.de",
  "x@x.de",
  "mail@mail.de",
  "noreply@deutschebahn.com",
  "no-reply@deutschebahn.com",
]);

export type OverrideProblem =
  | "empty-department"
  | "empty-mail"
  | "malformed-mail"
  | "placeholder-mail"
  | "empty-name";

/**
 * What is wrong with this entry, or null when nothing is.
 *
 * Returns the reason rather than a boolean so the form can say which of the
 * five things it is instead of "ungültig".
 */
export function validateOverride(input: {
  department?: string;
  name?: string;
  mail?: string;
}): OverrideProblem | null {
  const department = (input.department ?? "").trim();
  const name = (input.name ?? "").trim();
  const mail = (input.mail ?? "").trim().toLowerCase();
  if (!department) return "empty-department";
  if (!name) return "empty-name";
  if (!mail) return "empty-mail";
  if (!MAIL.test(mail)) return "malformed-mail";
  if (PLACEHOLDERS.has(mail)) return "placeholder-mail";
  return null;
}

export const OVERRIDE_PROBLEM_TEXT: Record<OverrideProblem, string> = {
  "empty-department": "Kein Gewerk angegeben.",
  "empty-name": "Bitte den Namen der Person eintragen, nicht nur die Adresse.",
  "empty-mail": "Bitte eine E-Mail-Adresse eintragen.",
  "malformed-mail": "Das ist keine vollständige E-Mail-Adresse.",
  "placeholder-mail": "Das ist eine Platzhalter-Adresse — sie erreicht niemanden.",
};

/** Normalise before storing, so two spellings of one address cannot both exist. */
export function normalizeOverride(
  input: { department: string; name: string; mail: string },
  addedBy: string,
  now: string,
): RecipientOverride {
  return {
    department: input.department.trim(),
    name: input.name.trim().replace(/\s+/g, " "),
    mail: input.mail.trim().toLowerCase(),
    addedBy: addedBy.trim() || "unbekannt",
    addedAt: now,
  };
}

/** Everything recorded for one department, newest last. */
export function overridesFor(
  all: readonly RecipientOverride[],
  department: string,
): RecipientOverride[] {
  return all.filter((o) => o.department === department);
}

export interface EffectiveRecipient {
  name: string;
  mail: string;
  /**
   * Where this address came from. The UI must be able to say "aus der
   * Hilfsdatei" or "von <Person> am <Datum> ergänzt" — an address whose
   * provenance is invisible is an address nobody can check.
   */
  source: "hilfsdatei" | "ergaenzt";
  addedBy?: string;
  addedAt?: string;
}

/**
 * Who a department actually reaches: the workbook first, then anything an
 * operator supplied to fill a gap the workbook left.
 *
 * The workbook always wins for addresses it has. This can only ever ADD, never
 * replace — an override that could shadow a real Hilfsdatei address would be a
 * way to silently redirect a notification, and that is not a power this needs.
 */
export function effectiveRecipients(
  department: Department | string,
  fromWorkbook: ReadonlyArray<{ name: string; mail: string }>,
  overrides: readonly RecipientOverride[],
): EffectiveRecipient[] {
  const out: EffectiveRecipient[] = fromWorkbook
    .filter((c) => c.mail.trim() !== "")
    .map((c) => ({ name: c.name, mail: c.mail, source: "hilfsdatei" as const }));
  /*
   * Compared lowercase on BOTH sides.
   *
   * Write-time normalisation lowercases an address, but this function also
   * reads entries stored before that existed and addresses straight out of the
   * workbook, which are written however the workbook writes them. Comparing a
   * normalised override against an un-normalised workbook address let a
   * duplicate through — and a duplicate here is a second copy of a real
   * recipient sitting under an "ergänzt" label, which is exactly the shadowing
   * this function refuses to allow.
   */
  const known = new Set(out.map((c) => c.mail.trim().toLowerCase()));
  for (const o of overridesFor(overrides, String(department))) {
    const mail = o.mail.trim().toLowerCase();
    if (known.has(mail)) continue;
    known.add(mail);
    out.push({
      name: o.name,
      mail,
      source: "ergaenzt",
      addedBy: o.addedBy,
      addedAt: o.addedAt,
    });
  }
  return out;
}

/** Still nobody, after the workbook and every supplied address. */
export function reachesNobody(recipients: readonly EffectiveRecipient[]): boolean {
  return recipients.length === 0;
}
