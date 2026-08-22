/**
 * The closed vocabulary of things the Änderungshistorie records.
 *
 * Every audit entry used to be a free-text string written at the call site, so
 * the log carried "Projekt erstellt" and "Projekt aktualisiert" and
 * "Fachspezialistenprüfung angemeldet" with nothing tying them together, and
 * AuditLog.tsx had to guess a tone from a regex over the verb. Adding a new
 * kind of event meant inventing a phrase and hoping the regex matched it.
 *
 * ---------------------------------------------------------------------------
 * "geöffnet", not "gesendet"
 * ---------------------------------------------------------------------------
 * A mailto: hands the message to the user's own mail client and a Teams deep
 * link opens the compose box. Neither tells the app what happened next — the
 * user may send it, edit it, or close it. Recording "E-Mail gesendet" would
 * put a claim in an audit trail that the app cannot substantiate, which is
 * exactly the class of defect this project has spent its time removing. The
 * entries say what is actually known: the message was composed and handed over.
 *
 * The same reasoning gives "PDF erzeugt" rather than "PDF gedruckt": the app
 * produces the file, the printing is the user's business.
 */

export const AUDIT_ACTIONS = {
  /** A field on a project changed. */
  projektAktualisiert: "Projekt aktualisiert",
  /** A Fachprüfung's status, Prüfer or Datum changed. */
  pruefungAktualisiert: "Prüfung aktualisiert",
  /** The Anmeldung wizard created a project and its 14 review rows. */
  projektAngelegt: "Projekt angelegt",
  /** A checklist was submitted — the reason those 14 review rows look as they do. */
  anmeldungEingereicht: "Anmeldung eingereicht",
  projektGeloescht: "Projekt gelöscht",
  /** A wizard draft was written to local storage. */
  entwurfGespeichert: "Entwurf gespeichert",
  /** A Fachspezialistenprüfung slot was taken. */
  terminGebucht: "Termin gebucht",
  /** A PDF was produced and handed to the browser. */
  pdfErzeugt: "PDF erzeugt",
  /** A CSV or other tabular export was produced. */
  exportErzeugt: "Export erzeugt",
  /** A prefilled mail was handed to the user's mail client. */
  mailGeoeffnet: "E-Mail vorbereitet",
  /** A prefilled Teams chat was opened. */
  teamsGeoeffnet: "Teams-Nachricht vorbereitet",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Every action, for the log's filter and for tests. */
export const AUDIT_ACTION_LIST: readonly AuditAction[] = Object.values(AUDIT_ACTIONS);

export type AuditTone = "create" | "update" | "review" | "document" | "message" | "delete";

/**
 * Tone per action, as a total map.
 *
 * `Record<AuditAction, AuditTone>` is the load-bearing part: add an action
 * above without giving it a tone and this file stops compiling. AuditLog.tsx
 * used a chain of regexes over the action text instead, so a new action fell
 * through to the default and rendered as an anonymous grey row.
 */
export const AUDIT_TONE: Record<AuditAction, AuditTone> = {
  [AUDIT_ACTIONS.projektAktualisiert]: "update",
  [AUDIT_ACTIONS.pruefungAktualisiert]: "review",
  [AUDIT_ACTIONS.projektAngelegt]: "create",
  [AUDIT_ACTIONS.anmeldungEingereicht]: "create",
  [AUDIT_ACTIONS.projektGeloescht]: "delete",
  [AUDIT_ACTIONS.entwurfGespeichert]: "update",
  [AUDIT_ACTIONS.terminGebucht]: "create",
  [AUDIT_ACTIONS.pdfErzeugt]: "document",
  [AUDIT_ACTIONS.exportErzeugt]: "document",
  [AUDIT_ACTIONS.mailGeoeffnet]: "message",
  [AUDIT_ACTIONS.teamsGeoeffnet]: "message",
};

/**
 * Historic phrases that predate this vocabulary.
 *
 * Entries already written to a user's local storage keep their old wording
 * forever — the log is append-only and there is no migration step. Mapping
 * them here means an existing trail still renders with the right tone instead
 * of degrading the moment the vocabulary tightened.
 */
const LEGACY_TONE: Record<string, AuditTone> = {
  "Projekt erstellt": "create",
  "Fachspezialistenprüfung angemeldet": "create",
};

/** The tone for any action string, including ones written before this file. */
export function auditTone(action: string): AuditTone {
  const known = AUDIT_TONE[action as AuditAction];
  if (known) return known;
  const legacy = LEGACY_TONE[action];
  if (legacy) return legacy;
  // Deliberately last, and deliberately narrow: an unrecognised action is an
  // update rather than an invented category.
  return "update";
}
