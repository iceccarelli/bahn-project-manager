/**
 * shared/checklist.ts
 * ---------------------------------------------------------------------------
 * The Projektanmeldung checklist — the real entry point of the RB Mitte
 * Fachspezialistenprüfung process, transcribed from
 * "Projektanmeldung Fachspezialistenprüfung_neu.xlsm".
 *
 * Provenance for every constant in this file:
 *   sheet `Formular`      rows 6-9   header fields
 *                         rows 13-34 the 22 numbered checklist entries
 *   sheet `Hilfsdatei`    A2:A3      Ja / Nein
 *                         B27:B29    Freischaltung / Unterschriftenblatt options
 *                         N3:N12     Projektstand   (see shared/projektstand.ts)
 *                         N17:N25    Bahnhofsmanagement (see shared/bahnhofsmanagement.ts)
 *                         N34:N37    Terminstatus   (see TERMIN_STATUS below)
 *   sheet `Checkliste`    rows 15-89 the Unterschriftenblatt signature blocks
 *   VBA module `Makro_mit_Termin`    the trigger rule (see isDepartmentRequired)
 *   VBA modules `Formular` / `Formular_2`  the two modes (see CHECKLIST_MODES)
 *
 * Nothing here is inferred. Where the workbook is internally inconsistent, the
 * inconsistency is documented rather than silently smoothed over.
 */

import type { Department } from "./validation";

// ---------------------------------------------------------------------------
// Answer vocabularies
// ---------------------------------------------------------------------------

/** `Hilfsdatei!A2:A3` — the Ja/Nein dropdown behind F16:F25, F29:F33 and H17:H19. */
export const JA_NEIN = ["Ja", "Nein"] as const;
export type JaNein = (typeof JA_NEIN)[number];

/** `Hilfsdatei!B27:B29` — the dropdown behind F14 (Freischaltung FAA) and F15 (Unterschriftenblatt). */
export const FREISCHALTUNG_OPTIONS = [
  "Erforderlich",
  "Bereits vorhanden",
  "Mieterbaukoordination",
] as const;
export type FreischaltungOption = (typeof FREISCHALTUNG_OPTIONS)[number];

/** `Hilfsdatei!N34:N37` — the status of a slot in the `Zeit auswählen` calendar. */
export const TERMIN_STATUS = [
  "Frei",
  "Gebucht",
  "Vorgebucht für IM",
  "Vorgebucht für IT",
] as const;
export type TerminStatus = (typeof TERMIN_STATUS)[number];

/** Placeholder the workbook writes into a field that has not been answered yet. */
export const UNANSWERED = "Bitte auswählen";
export const UNFILLED = "Bitte ausfüllen";

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * The workbook is really two forms sharing one sheet. `Sub Projektanmeldung()`
 * and `Sub PKonfiguration()` (module `Formular_2`) reconfigure row visibility
 * and default answers. This is why 474 review rows in data.json carry the status
 * "Projektkonfig." — that is the mode, not a review outcome.
 */
export const CHECKLIST_MODES = ["Projektanmeldung", "Projektkonfiguration"] as const;
export type ChecklistMode = (typeof CHECKLIST_MODES)[number];

export type QuestionKind =
  /** administrative — drives a document or a notification, not a review */
  | "admin"
  /** a Gewerk question — may create a department review */
  | "gewerk"
  /** free-text remarks */
  | "notes";

export interface QuestionMode {
  /** shown in this mode? */
  visible: boolean;
  /** value the workbook writes when switching into this mode; null = left as-is */
  default: string | null;
}

export interface ChecklistQuestion {
  /**
   * The number printed in `Formular` column A. NOTE: there is no Nr. 6 — the
   * workbook skips from 5 to 7. 22 numbered entries, not 23.
   */
  nr: number;
  /** stable machine key — safe to persist, unlike nr or row */
  key: string;
  /** source row in `Formular`, kept for traceability back to the workbook */
  formularRow: number;
  /** column B */
  gewerk: string;
  /** column E — null for the three rows that carry no question text */
  question: string | null;
  kind: QuestionKind;
  /**
   * The department whose review this question creates, or null when the answer
   * only triggers a notification (Bahnhofsmanagement, HuBs, ITK-FM) or is
   * administrative.
   */
  department: Department | null;
  /** the dropdown that applies to the primary answer (column F) */
  answerType: "jaNein" | "freischaltung" | "text" | "none";
  /**
   * Rows 17, 18 and 19 carry a SECOND Ja/Nein in column H, labelled in column G.
   * Either answer being "Ja" triggers the review — see isDepartmentRequired.
   */
  secondary?: { label: string };
  /** column G, when it is a hint/comment label rather than a secondary question */
  hint?: string;
  modes: Record<ChecklistMode, QuestionMode>;
}

/** Shorthand: visible in both modes with the same default. */
function both(def: string | null): Record<ChecklistMode, QuestionMode> {
  return {
    Projektanmeldung: { visible: true, default: def },
    Projektkonfiguration: { visible: true, default: def },
  };
}

/**
 * The 22 checklist entries, in workbook order.
 *
 * Mode data is transcribed literally from the two VBA subs. Two quirks are
 * preserved rather than corrected, because correcting them would change
 * behaviour the business currently relies on:
 *   - `Sub Projektanmeldung()` resets F13, F14 and F17..F33 but NOT F15, so the
 *     Unterschriftenblatt answer survives a mode switch. Recorded as
 *     `default: null`.
 *   - In Projektkonfiguration every Gewerk is forced to "Ja" EXCEPT
 *     Baubetriebsplanung (F33 = "Nein"), which is also hidden in that mode.
 */
export const CHECKLIST_QUESTIONS: readonly ChecklistQuestion[] = [
  {
    nr: 1,
    key: "pkpLink",
    formularRow: 13,
    gewerk: "Alle",
    question: "Link zu den auf der PKP zur Prüfung bereitgestellten Dokumenten:",
    kind: "admin",
    department: null,
    answerType: "text",
    modes: {
      Projektanmeldung: { visible: true, default: UNFILLED },
      Projektkonfiguration: { visible: false, default: null },
    },
  },
  {
    nr: 2,
    key: "freischaltungFaa",
    formularRow: 14,
    gewerk: "Alle",
    question: "Freischaltung FAA",
    kind: "admin",
    department: null,
    answerType: "freischaltung",
    hint: 'Wenn Sie "Erforderlich" auswählen, werden die Mitarbeitenden der FAA automatisch über die erforderlichen Freischaltungen informiert.',
    modes: {
      Projektanmeldung: { visible: true, default: UNANSWERED },
      Projektkonfiguration: { visible: true, default: "Erforderlich" },
    },
  },
  {
    nr: 3,
    key: "unterschriftenblatt",
    formularRow: 15,
    gewerk: "Alle",
    question: "Unterschriftenblatt",
    kind: "admin",
    department: null,
    answerType: "freischaltung",
    hint: 'Wenn Sie "Erforderlich" auswählen, wird das Unterschriftenblatt automatisch in Ihrem Downloadordner abgelegt.',
    modes: {
      // NOT reset by Sub Projektanmeldung() — see the note above.
      Projektanmeldung: { visible: true, default: null },
      Projektkonfiguration: { visible: false, default: null },
    },
  },
  {
    nr: 4,
    key: "mitProjektvorstellung",
    formularRow: 16,
    gewerk: "Alle",
    question:
      'Projekt mit Projektvorstellung anmelden?\nBei "Nein" nur nach vorheriger Abstimmung mit Fachspezialisten und TBQ möglich\n(z.B. Sonderprojekte, BSK)',
    kind: "admin",
    department: null,
    answerType: "jaNein",
    hint: "Nur bei Nein ausfüllen\nDatum der Übergabe von vollständigen zu prüfenden Unterlagen:",
    modes: {
      Projektanmeldung: { visible: true, default: "Ja" },
      Projektkonfiguration: { visible: false, default: null },
    },
  },
  {
    nr: 5,
    key: "itk",
    formularRow: 17,
    gewerk: "Informations- und Telekommunikationstechnologien (ITK)",
    question:
      "Sind Telekommunikationsanlagen u.a. bei Arbeiten an: Beschallungsanlagen (Lautsprecher), Zuganzeiger (FIA/ZIM), Uhren, W-Lan, Video betroffen?",
    kind: "gewerk",
    department: "ITK",
    answerType: "jaNein",
    secondary: { label: "sonstige TK-Maßnahme" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 7,
    key: "eea",
    formularRow: 18,
    gewerk: "Eletrotechnische Anlagen (50 Hz)",
    question:
      "Sind elektrotechnischen Anlagen u.a. Arbeiten an: Allgemeine Beleuchtungsanlagen, Notbeleuchtung,\nSchaltgerätekombination (Unterverteiler, Hauptverteiler und Zählerverteiler), Erdungssysteme (PAS, Bahnerde etc.) betroffen?",
    kind: "gewerk",
    department: "EEA",
    answerType: "jaNein",
    secondary: { label: "sonstige elektrotechnische Maßnahme" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 8,
    key: "brandschutz",
    formularRow: 19,
    gewerk: "Brandschutz",
    question: "Sind Brandschutzkonzept, IVE-Studie oder\nsonstige Stellungnahmen notwendig?",
    kind: "gewerk",
    // BS is Brandschutz, not "bauliche Anlagen": the top BS reviewers in
    // data.json are Afteni (506) and Fey (449), who are the Brandschutz
    // specialists in Hilfsdatei rows 6-7.
    department: "BS",
    answerType: "jaNein",
    secondary: { label: "Empfangsgebäude vorhanden ggf.\nRestnutzung" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 9,
    key: "foerdertechnik",
    formularRow: 20,
    gewerk: "Fördertechnik",
    question: "Sind Aufzüge oder Fahrtreppen betroffen?",
    kind: "gewerk",
    department: "HFT",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 10,
    key: "hkls",
    formularRow: 21,
    // "ii" is a footnote marker in the workbook, referring to the note in A4
    // ("Außer Bahnsteigentwässerung - Zuständigkeit DB Immobilien/Kanalmanagement").
    gewerk: "Heizung, Lüftung, Sanitär (HLS)",
    question:
      "Sind Heizungsanlagen, Entlüftung- und/oder Entrauchungsanlagen oder Klimatechnik betroffen?",
    kind: "gewerk",
    department: "HKLS",
    answerType: "jaNein",
    hint: "Außer Bahnsteigentwässerung — Zuständigkeit DB Immobilien/Kanalmanagement",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 11,
    key: "gebaeudeautomation",
    formularRow: 22,
    gewerk: "Gebäudeautomation",
    question:
      "Bei allen TGA-Anlagen, außer ITK\n(z.B. Hebeanlagen | Sicherheitsbeleuchtung | Brandmeldeanlagen) nach Ril 813.0480",
    kind: "gewerk",
    department: "GA",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 12,
    key: "energiemanagement",
    formularRow: 23,
    gewerk: "Energiemanagement",
    question: "Findet eine Medientrennung statt?\nFindet der Einbau eines Stromzählers statt?",
    kind: "gewerk",
    department: "Energie",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 13,
    key: "tbq",
    formularRow: 24,
    gewerk: "TBQ",
    question:
      "Ist z.B. eines der folgenden Themen betroffen?\nEIGV-Einstufung, Planrecht-Einschätzung, CSM, RIL 813.02, Mieterumbau",
    kind: "gewerk",
    department: "TBQ",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 14,
    key: "umweltmanagement",
    formularRow: 25,
    gewerk: "Umweltmanagement",
    question:
      "Ist eine Abarbeitung des Umwelt-Checks erfolgt?\nLiegen Betroffenheiten der dort aufgeführten Umweltbelange vor?\n(z.B. Immissionsschutz, Natur- und Artenschutz, Abfall und Entsorgung, Gewässerschutz...)",
    kind: "gewerk",
    department: "UM",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 15,
    key: "bahnhofsmanagement",
    formularRow: 26,
    gewerk: "Bahnhofsmanagement",
    question: null,
    kind: "gewerk",
    // The BM is a role, not a reviewing department — there is no BM column among
    // the 14. The recipient is resolved from the project's BM (Hilfsdatei rows
    // 50-57), not from this answer.
    department: null,
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: false, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 16,
    key: "hubs",
    formularRow: 27,
    gewerk: "HuBs (FM bauliche Anlagen)",
    question: null,
    kind: "gewerk",
    // Notification only (Hilfsdatei row 60). Adding a 15th department would mean
    // backfilling 1,298 review rows — a data-model change, not a mapping.
    department: null,
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: false, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 17,
    key: "itkFm",
    formularRow: 28,
    gewerk: "ITK (FM technische Anlagen)",
    question: null,
    kind: "gewerk",
    // Notification only (Hilfsdatei rows 61-62). The ITK review is already
    // driven by nr. 5; a second ITK review row cannot exist because
    // department_reviews is unique on (projectId, department).
    department: null,
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: false, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 18,
    key: "bim",
    formularRow: 29,
    gewerk: "BIM-Spezialisten",
    question: "Einbindung und Prüfung nach BIM Methodik",
    kind: "gewerk",
    department: "BIM",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 19,
    key: "lst",
    formularRow: 30,
    gewerk: "LST",
    question:
      "Anlagen der DB Netz AG zum Thema Leit- und Sicherungstechnik, Signalanlagen, Bahnübergänge, Gleisfreimeldeanlagen und sonstige Themen",
    kind: "gewerk",
    department: "LST",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 20,
    key: "vermessung",
    formularRow: 31,
    gewerk: "Vermessung",
    question:
      "Ist eine vermessungstechnische Aufgabenstellung erforderlich; Prüfen ob Punktwolke notwendig",
    kind: "gewerk",
    department: "Vermessung",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 21,
    key: "baubetriebstechnologie",
    formularRow: 32,
    gewerk: "Baubetriebstechnologie",
    question: "Grundsätzlich ist die Einbindung des BBTL erforderlich",
    kind: "gewerk",
    department: "Baubetriebstechnologie",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" },
    },
  },
  {
    nr: 22,
    key: "baubetriebsplanung",
    formularRow: 33,
    gewerk: "Baubetriebsplanung",
    question: "Erst ab Lph 3 zusätzlich zum Baubetriebstechnologen hinzuzufügen",
    kind: "gewerk",
    department: "Baubetriebsplanung",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      // hidden AND forced to "Nein" — the only Gewerk not auto-selected in this mode
      Projektkonfiguration: { visible: false, default: "Nein" },
    },
  },
  {
    nr: 23,
    key: "anmerkungen",
    formularRow: 34,
    gewerk: "Anmerkungen der Projektleitung",
    question: null,
    kind: "notes",
    department: null,
    answerType: "text",
    modes: both(null),
  },
] as const;

/** Lookup by stable key. */
export const CHECKLIST_BY_KEY: Readonly<Record<string, ChecklistQuestion>> = Object.freeze(
  Object.fromEntries(CHECKLIST_QUESTIONS.map((q) => [q.key, q])),
);

/** A checklist question that owns one of the 14 department reviews. */
export type DepartmentQuestion = ChecklistQuestion & { department: Department };

/**
 * The 14 questions that map 1:1 onto the 14 DEPARTMENTS.
 * The bijection is asserted in shared/checklist.test.ts — a typo in the mapping
 * would otherwise silently drop or duplicate a review column.
 */
export const DEPARTMENT_QUESTIONS: readonly DepartmentQuestion[] = CHECKLIST_QUESTIONS.filter(
  (q): q is DepartmentQuestion => q.department !== null,
);

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** One answered row: the primary answer plus the optional secondary Ja/Nein and comment. */
export interface ChecklistAnswer {
  /** primary answer — column F */
  answer: string | null;
  /** secondary answer — column H, only meaningful for itk / eea / brandschutz */
  secondary?: JaNein | null;
  /** free text — column G */
  comment?: string | null;
}

export type ChecklistAnswers = Record<string, ChecklistAnswer>;

/**
 * The trigger rule, straight from `Makro_mit_Termin.PDF_und_Mail`:
 *
 *   If Sheets("Formular").Range("F17") = "Ja" Or Sheets("Formular").Range("H17") = "Ja" Then
 *
 * A department is required when its primary answer is "Ja", or — for the three
 * rows that have one — when the secondary answer is "Ja".
 */
export function isDepartmentRequired(
  question: ChecklistQuestion,
  answers: ChecklistAnswers,
): boolean {
  const a = answers[question.key];
  if (!a) return false;
  if (a.answer === "Ja") return true;
  if (question.secondary && a.secondary === "Ja") return true;
  return false;
}

/** Initial answer set for a mode, exactly as the corresponding VBA sub writes it. */
export function defaultAnswers(mode: ChecklistMode): ChecklistAnswers {
  const out: ChecklistAnswers = {};
  for (const q of CHECKLIST_QUESTIONS) {
    const m = q.modes[mode];
    out[q.key] = {
      answer: m.default,
      secondary: q.secondary ? "Nein" : undefined,
      comment: null,
    };
  }
  return out;
}

/** Questions shown in a given mode, in workbook order. */
export function visibleQuestions(mode: ChecklistMode): ChecklistQuestion[] {
  return CHECKLIST_QUESTIONS.filter((q) => q.modes[mode].visible);
}

export interface GeneratedReview {
  department: Department;
  /** "offen" when the checklist requires this department, "nicht erforderlich" otherwise */
  status: "offen" | "nicht erforderlich";
  /** the checklist key that decided it — for the audit trail */
  decidedBy: string;
  /** true when the secondary Ja/Nein is what triggered it */
  viaSecondary: boolean;
}

/**
 * Turn a completed checklist into the 14 department reviews.
 *
 * Always returns all 14 rows: the reviews that are not required are recorded as
 * "nicht erforderlich" rather than omitted, which is how the existing 18,172
 * rows in data.json are shaped (11,947 of them are "nicht erforderlich").
 */
export function buildDepartmentReviews(answers: ChecklistAnswers): GeneratedReview[] {
  return DEPARTMENT_QUESTIONS.map((q) => {
    const a = answers[q.key];
    const required = isDepartmentRequired(q, answers);
    return {
      department: q.department,
      status: required ? ("offen" as const) : ("nicht erforderlich" as const),
      decidedBy: q.key,
      viaSecondary: required && a?.answer !== "Ja" && Boolean(q.secondary),
    };
  });
}

/** Non-review recipients a completed checklist notifies (Bahnhofsmanagement, HuBs, ITK-FM). */
export function notifiedRoles(answers: ChecklistAnswers): string[] {
  return CHECKLIST_QUESTIONS.filter(
    (q) => q.kind === "gewerk" && q.department === null && isDepartmentRequired(q, answers),
  ).map((q) => q.key);
}

// ---------------------------------------------------------------------------
// Unterschriftenblatt — sheet `Checkliste`, rows 15-89
// ---------------------------------------------------------------------------

export interface SignatureBlock {
  /** organisational unit, column A of the upper row */
  ou: string;
  /** role, column A of the lower row */
  role: string;
  /** blocks marked "zur Kenntnis" acknowledge rather than approve */
  acknowledgeOnly?: true;
  /** the department whose review decides the "erforderlich" tick, when there is one */
  department?: Department;
  /** fixed name printed on the sheet */
  name?: string;
}

/** The 18 signature blocks, in sheet order. */
export const UNTERSCHRIFTENBLATT: readonly SignatureBlock[] = [
  { ou: "I.IP-MI-IM", role: "Infrastrukturmanager" },
  { ou: "I.IP-MI-IW1", role: "Fachspezialist Brandschutz", department: "BS" },
  { ou: "I.IP-MI-IW1", role: "Fachspezialist E-Technik", department: "EEA" },
  { ou: "I.IP-MI-IW1", role: "Fachspezialist ITK", department: "ITK" },
  { ou: "I.IP-MI-IW1", role: "Fachspezialist HKLS", department: "HKLS" },
  { ou: "I.IP-MI-FT", role: "Fachkoordinator Energie", department: "Energie" },
  { ou: "I.SP-MI-IW1", role: "Fachspezialist Fördertechnik", department: "HFT" },
  { ou: "I.IP-MI-FT", role: "Fachkoordinator Gebäudeautomation", department: "GA" },
  { ou: "I.IP-MI-IW", role: "TBQ", department: "TBQ" },
  { ou: "I.IP-MI-IW", role: "Fachspezialist Umwelt", department: "UM" },
  { ou: "I.IP-MI-IW", role: "Fachspezialist BIM", department: "BIM" },
  { ou: "I.IP-MI-IW", role: "Fachspezialist LST", department: "LST" },
  { ou: "I.IP-MI-IW", role: "Fachspezialist Vermessung", department: "Vermessung" },
  { ou: "I.IP-MI-IW1", role: "AGL" },
  { ou: "I.IP-MI-XXX", role: "Bahnhofsmanager" },
  { ou: "I.IP-MI-C", role: "Leiter Vermietung" },
  { ou: "I.IP-MI-I", role: "Leiter Baumanagement" },
  { ou: "I.IFS-MI", role: "Leiter Finanzen/Controlling", acknowledgeOnly: true },
  { ou: "I.IP-MI", role: "Leitung RB Mitte", acknowledgeOnly: true, name: "Stefan Schwinn" },
] as const;

/** Title printed on the Unterschriftenblatt. */
export const UNTERSCHRIFTENBLATT_TITLE =
  "Unterschriftenblatt zur Genehmigung der EP durch den Regionalbereich";
export const UNTERSCHRIFTENBLATT_ISSUER = "DB Station&Service AG";

/**
 * Baubetriebstechnologie and Baubetriebsplanung have no signature block on the
 * Checkliste sheet, even though both are reviewing departments. Exported so the
 * Stage 3 preview can say so instead of silently omitting them.
 */
export const DEPARTMENTS_WITHOUT_SIGNATURE_BLOCK = [
  "Baubetriebstechnologie",
  "Baubetriebsplanung",
] as const;
