/**
 * Abnahme — the fachtechnische Abnahme checklists of a Gewerk-ITK installation.
 *
 * Why this lives in shared/ and why it is split into template and answers
 * -----------------------------------------------------------------------
 * The prototype this was taken from stores `selected` and `mangel` on every
 * checklist item, so each screen owned a mutable copy of the whole checklist.
 * Here the checklist (what is asked) is an immutable, versioned template and
 * what the Prüfer answered is a separate map keyed by item id. Two consequences:
 *
 *   - The persistence shape is already decided: one `AbnahmeAnswers` per
 *     (project, technik). See ./persistence.ts and docs/abnahme.md.
 *   - Summary and filtering are pure functions over (template, answers), so the
 *     numbers on screen, in a later PDF and in a later Jahresansicht come from
 *     one implementation and cannot disagree.
 *
 * Naming follows the Projektübersicht ITK platform (ELA / Video / WLAN / ZIM /
 * DSA+ / SAA / dBOS) so a `Technik` here is the same word there. All
 * identifiers carry the Abnahme prefix: "Checklist" in this code base already
 * means the 22-question Anmeldung wizard (shared/checklist.ts).
 */

/** Every Technik the ITK platform knows. Order is the order the selector shows. */
export const ABNAHME_TECHNIKEN = ["ZIM", "Video", "DSA+", "dBOS", "ELA", "WLAN", "SAA"] as const;
export type Technik = (typeof ABNAHME_TECHNIKEN)[number];

/**
 * The statuses of one checklist item, verbatim from the prototype (the strings
 * are what a Prüfer sees on paper). "Nicht bewertet" is not a status — it is the
 * absence of an answer, `null`.
 */
export const ABNAHME_STATUS = ["Erfüllt", "Offen", "Entfällt"] as const;
export type AbnahmeStatus = (typeof ABNAHME_STATUS)[number];
export type AbnahmeAnswer = AbnahmeStatus | null;

/** One question on the checklist. Static: it never carries an answer. */
export interface ChecklistItem {
  /** "1.2.3" — unique within a Technik and never renumbered. */
  readonly id: string;
  readonly label: string;
}

export interface ChecklistSection {
  /** "1.2" — the Gliederungsnummer printed in front of the title. */
  readonly number: string;
  /** Title without its number. */
  readonly title: string;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistTemplate {
  readonly technik: Technik;
  /** Bumped when a label or item changes, so a stored answer set can be matched to the text it answered. */
  readonly version: string;
  readonly sections: readonly ChecklistSection[];
}

/** The Prüfer's answer to one item. */
export interface ItemState {
  readonly selected: AbnahmeAnswer;
  /** Free text; only meaningful (and only shown) while `selected === "Offen"`. */
  readonly mangel: string;
}

/** Item id → answer. An item with no entry is "Nicht bewertet". */
export type AbnahmeAnswers = Readonly<Record<string, ItemState>>;

/** Report-header fields the prototype collected. Project-derived ones are prefilled, never required. */
export interface AbnahmeHeader {
  readonly gewerkAnlage: string;
  readonly errichter: string;
}

export const EMPTY_ABNAHME_HEADER: AbnahmeHeader = { gewerkAnlage: "", errichter: "" };

export function isTechnik(value: unknown): value is Technik {
  return typeof value === "string" && (ABNAHME_TECHNIKEN as readonly string[]).includes(value);
}

export function isAbnahmeStatus(value: unknown): value is AbnahmeStatus {
  return typeof value === "string" && (ABNAHME_STATUS as readonly string[]).includes(value);
}
